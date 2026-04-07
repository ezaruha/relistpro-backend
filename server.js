const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3456;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));

// ═══ DATA PERSISTENCE ═══
const DATA_DIR = (() => {
  for (const d of ['/data', process.env.TMPDIR, '/tmp']) {
    if (d && fs.existsSync(d)) {
      try { fs.accessSync(d, fs.constants.W_OK); return d; } catch {}
    }
  }
  return '/tmp';
})();
const DATA_FILE = path.join(DATA_DIR, 'relistpro_data.json');

let users = {};       // username -> { hash, token, created }
let sessions = {};    // userId -> { csrf, cookies, domain, memberId, storedAt }
let pendingActivations = []; // [{ itemId, userId, activateAt }]

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const d = JSON.parse(raw);
      users = d.users || {};
      sessions = d.sessions || {};
      pendingActivations = d.pendingActivations || [];
      console.log(`[RP] Loaded data: ${Object.keys(users).length} users, ${Object.keys(sessions).length} sessions, ${pendingActivations.length} pending activations`);
    }
  } catch (e) {
    console.error('[RP] Load data error:', e.message);
  }
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ users, sessions, pendingActivations }), 'utf8');
  } catch (e) {
    console.error('[RP] Save data error:', e.message);
  }
}

// ═══ CRYPTO HELPERS ═══
async function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, (err, key) => {
      if (err) return reject(err);
      resolve(`${salt}:${key.toString('hex')}`);
    });
  });
}

async function verifyPassword(password, stored) {
  return new Promise((resolve, reject) => {
    const [salt, keyHex] = stored.split(':');
    if (!salt || !keyHex) return resolve(false);
    crypto.scrypt(password, salt, 64, (err, key) => {
      if (err) return reject(err);
      try {
        resolve(crypto.timingSafeEqual(Buffer.from(keyHex, 'hex'), key));
      } catch { resolve(false); }
    });
  });
}

function generateToken() {
  return 'rp_' + crypto.randomBytes(24).toString('base64url');
}

// ═══ STATUS NORMALISATION ═══
function normalizeItem(raw) {
  let status = 'active';
  if (raw.is_draft) {
    status = 'draft';
  } else if (raw.is_hidden) {
    status = 'hidden';
  } else if (raw.is_closed) {
    status = 'sold';
  } else if (raw.is_reserved) {
    status = 'reserved';
  } else {
    const s = String(raw.status || raw.user_item_status || '').toLowerCase();
    if (s === 'sold' || s === 'closed') status = 'sold';
    else if (s === 'draft') status = 'draft';
    else if (s === 'reserved') status = 'reserved';
    else if (s === 'hidden') status = 'hidden';
  }
  return { ...raw, status };
}

// ═══ HEALTH CHECK ═══
app.get('/', (req, res) => {
  res.json({
    name: 'RelistPro Backend',
    version: '2.0.0',
    status: 'running',
    uptime: Math.floor(process.uptime()) + 's',
    sessions: Object.keys(sessions).length
  });
});
app.get('/health', (req, res) => res.json({ ok: true }));

// ═══ AUTH ═══
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  if (users[username]) return res.status(409).json({ error: 'User exists' });
  try {
    const hash = await hashPassword(password);
    const token = generateToken();
    users[username] = { hash, token, created: new Date().toISOString() };
    saveData();
    res.json({ ok: true, token });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const user = users[username];
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  try {
    // Support legacy plain-text passwords during migration
    let valid = false;
    if (user.hash && user.hash.includes(':')) {
      valid = await verifyPassword(password, user.hash);
    } else if (user.password) {
      valid = (user.password === password);
      if (valid) {
        // Upgrade to hashed
        user.hash = await hashPassword(password);
        delete user.password;
        saveData();
      }
    }
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    res.json({ ok: true, token: user.token });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  const found = Object.entries(users).find(([, u]) => u.token === token);
  if (!found) return res.status(401).json({ error: 'Invalid token' });
  req.user = { id: found[0], username: found[0] };
  next();
}

// ═══ SESSION ═══
app.post('/api/session/store', auth, (req, res) => {
  const { csrf, cookies, domain, memberId } = req.body;
  sessions[req.user.id] = { csrf, cookies, domain: domain || 'www.vinted.co.uk', memberId, storedAt: new Date().toISOString() };
  saveData();
  console.log(`[RP] Session stored for ${req.user.id} (member ${memberId})`);
  res.json({ ok: true });
});

app.get('/api/session/status', auth, (req, res) => {
  const s = sessions[req.user.id];
  if (!s) return res.json({ active: false });
  res.json({ active: true, memberId: s.memberId, domain: s.domain, storedAt: s.storedAt });
});

// ═══ VINTED PROXY ═══
async function vintedFetch(session, path, options = {}) {
  const domain = session.domain || 'www.vinted.co.uk';
  const url = `https://${domain}${path}`;
  const resp = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'Cookie': session.cookies,
      'X-CSRF-Token': session.csrf,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  return resp;
}

// Fetch all wardrobe items — locked to authenticated user's own session memberId
app.get('/api/vinted/dressing/:memberId', auth, async (req, res) => {
  const session = sessions[req.user.id];
  if (!session) return res.status(401).json({ error: 'No session. Sync from Vinted first.' });

  // Security: memberId must match the authenticated session
  if (session.memberId && req.params.memberId !== session.memberId) {
    return res.status(403).json({ error: 'memberId does not match your session' });
  }
  const memberId = session.memberId || req.params.memberId;

  // Default to returning only active items; pass ?status=all to get everything
  const filterStatus = req.query.status || 'active';

  try {
    const seen = new Set();
    const items = [];
    let page = 1;
    while (page <= 50) {
      const resp = await vintedFetch(
        session,
        `/api/v2/users/${memberId}/items?page=${page}&per_page=96&order=newest_first`
      );
      if (!resp.ok) { console.log(`[RP] Vinted ${resp.status} on page ${page}`); break; }
      const data = await resp.json();
      const pageItems = data.items || data.user_items || [];
      if (!pageItems.length) break;

      for (const raw of pageItems) {
        const id = String(raw.id);
        if (seen.has(id)) continue; // dedupe across pages
        seen.add(id);
        const item = normalizeItem(raw);
        if (filterStatus === 'all' || item.status === filterStatus) {
          items.push(item);
        }
      }
      page++;
      await new Promise(r => setTimeout(r, 300));
    }
    console.log(`[RP] Fetched ${items.length} ${filterStatus} items for member ${memberId}`);
    res.json({ ok: true, items, total: items.length });
  } catch (e) {
    console.error('[RP] Dressing error:', e.message);
    res.status(502).json({ error: e.message });
  }
});

// Delete an item
app.delete('/api/vinted/items/:itemId', auth, async (req, res) => {
  const session = sessions[req.user.id];
  if (!session) return res.status(401).json({ error: 'No session' });
  try {
    const resp = await vintedFetch(session, `/api/v2/items/${req.params.itemId}`, { method: 'DELETE' });
    res.json({ ok: resp.ok, status: resp.status });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Create item as draft, schedule activation
app.post('/api/vinted/items/create', auth, async (req, res) => {
  const session = sessions[req.user.id];
  if (!session) return res.status(401).json({ error: 'No session' });
  try {
    const payload = { ...req.body, is_draft: true };
    const resp = await vintedFetch(session, '/api/v2/items', { method: 'POST', body: payload });
    const data = await resp.json();
    const newId = data.item?.id || data.id;
    if (newId) {
      const delayMs = (15 + Math.random() * 5) * 60 * 1000;
      const activateAt = Date.now() + delayMs;
      pendingActivations.push({ itemId: String(newId), userId: req.user.id, activateAt });
      saveData();
      scheduleActivation(req.user.id, String(newId), delayMs);
      console.log(`[RP] Draft ${newId} created, activating in ${Math.round(delayMs / 60000)}m`);
    }
    res.json({ ok: true, itemId: newId, draft: true });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Activate a draft manually
app.post('/api/vinted/items/:itemId/activate', auth, async (req, res) => {
  const session = sessions[req.user.id];
  if (!session) return res.status(401).json({ error: 'No session' });
  try {
    const resp = await vintedFetch(session, `/api/v2/items/${req.params.itemId}`, { method: 'PUT', body: { is_draft: false } });
    removePendingActivation(String(req.params.itemId));
    res.json({ ok: resp.ok });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ═══ BACKGROUND WORKER — activate pending drafts ═══
function scheduleActivation(userId, itemId, delayMs) {
  setTimeout(async () => {
    const session = sessions[userId];
    if (!session) {
      console.log(`[RP] No session for draft activation ${itemId} — will retry on next restart`);
      return;
    }
    try {
      const resp = await vintedFetch(session, `/api/v2/items/${itemId}`, { method: 'PUT', body: { is_draft: false } });
      if (resp.ok) {
        console.log(`[RP] Draft ${itemId} activated`);
        removePendingActivation(itemId);
      } else {
        console.log(`[RP] Draft ${itemId} activation returned ${resp.status}`);
      }
    } catch (e) {
      console.log(`[RP] Draft activation failed: ${itemId}`, e.message);
    }
  }, delayMs);
}

function removePendingActivation(itemId) {
  const before = pendingActivations.length;
  pendingActivations = pendingActivations.filter(pa => pa.itemId !== itemId);
  if (pendingActivations.length !== before) saveData();
}

function recoverPendingActivations() {
  if (!pendingActivations.length) return;
  const now = Date.now();
  console.log(`[RP] Recovering ${pendingActivations.length} pending draft activations`);
  for (const pa of [...pendingActivations]) {
    const delay = Math.max(0, pa.activateAt - now);
    scheduleActivation(pa.userId, pa.itemId, delay);
    console.log(`[RP] Rescheduled draft ${pa.itemId} in ${Math.round(delay / 60000)}m`);
  }
}

// ═══ START ═══
loadData();
recoverPendingActivations();
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[RelistPro Backend] v2.0.0 running on port ${PORT} | data: ${DATA_FILE}`);
});
