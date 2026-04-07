const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3456;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));

// In-memory stores (Railway keeps these alive while running)
const sessions = {};   // userId -> { csrf, cookies, domain, memberId }
const users = {};       // simple token-based auth

// ═══ HEALTH CHECK (Railway uses this) ═══
app.get('/', (req, res) => {
  res.json({ 
    name: 'RelistPro Backend', 
    version: '1.0.0', 
    status: 'running',
    uptime: Math.floor(process.uptime()) + 's',
    sessions: Object.keys(sessions).length
  });
});

app.get('/health', (req, res) => res.json({ ok: true }));

// ═══ AUTH — simple token system ═══
app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  if (users[username]) return res.status(409).json({ error: 'User exists' });
  const token = 'rp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  users[username] = { password, token, created: new Date().toISOString() };
  res.json({ ok: true, token });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = users[username];
  if (!user || user.password !== password) return res.status(401).json({ error: 'Invalid credentials' });
  res.json({ ok: true, token: user.token });
});

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  const found = Object.entries(users).find(([, u]) => u.token === token);
  if (!found) return res.status(401).json({ error: 'Invalid token' });
  req.user = { id: found[0], username: found[0] };
  next();
}

// ═══ SESSION — extension stores Vinted session here ═══
app.post('/api/session/store', auth, (req, res) => {
  const { csrf, cookies, domain, memberId } = req.body;
  sessions[req.user.id] = { csrf, cookies, domain: domain || 'www.vinted.co.uk', memberId, storedAt: new Date().toISOString() };
  console.log(`[RP] Session stored for ${req.user.id} (member ${memberId})`);
  res.json({ ok: true });
});

app.get('/api/session/status', auth, (req, res) => {
  const s = sessions[req.user.id];
  if (!s) return res.json({ active: false });
  res.json({ active: true, memberId: s.memberId, domain: s.domain, storedAt: s.storedAt });
});

// ═══ VINTED PROXY — server-side API calls using stored session ═══
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

// Fetch all wardrobe items (paginated)
app.get('/api/vinted/dressing/:memberId', auth, async (req, res) => {
  const session = sessions[req.user.id];
  if (!session) return res.status(401).json({ error: 'No session. Sync from Vinted first.' });
  try {
    const items = [];
    let page = 1;
    while (page <= 50) {
      const resp = await vintedFetch(session, `/api/v2/users/${req.params.memberId}/items?page=${page}&per_page=96&order=relevance`);
      if (!resp.ok) { console.log(`[RP] Vinted ${resp.status} on page ${page}`); break; }
      const data = await resp.json();
      const pageItems = data.items || data.user_items || [];
      if (!pageItems.length) break;
      items.push(...pageItems);
      page++;
      await new Promise(r => setTimeout(r, 300));
    }
    console.log(`[RP] Fetched ${items.length} items for member ${req.params.memberId}`);
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

// Create item (draft-first)
app.post('/api/vinted/items/create', auth, async (req, res) => {
  const session = sessions[req.user.id];
  if (!session) return res.status(401).json({ error: 'No session' });
  try {
    const payload = { ...req.body, is_draft: true };
    const resp = await vintedFetch(session, '/api/v2/items', { method: 'POST', body: payload });
    const data = await resp.json();
    const newId = data.item?.id || data.id;
    if (newId) {
      // Schedule activation in 15-20 minutes
      const delay = (15 + Math.random() * 5) * 60 * 1000;
      setTimeout(async () => {
        try {
          await vintedFetch(session, `/api/v2/items/${newId}`, { method: 'PUT', body: { is_draft: false } });
          console.log(`[RP] Draft ${newId} activated`);
        } catch (e) { console.log(`[RP] Draft activation failed: ${newId}`, e.message); }
      }, delay);
      console.log(`[RP] Draft ${newId} created, activating in ${Math.round(delay / 60000)}m`);
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
    res.json({ ok: resp.ok });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ═══ START ═══
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[RelistPro Backend] v1.0.0 running on port ${PORT}`);
});
