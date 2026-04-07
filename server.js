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
  } else if (raw.is_hidden && !raw.can_edit) {
    status = 'hidden'; // delayed publication
  } else if (raw.is_hidden) {
    status = 'hidden';
  } else if (raw.item_closing_action === 'sold' || raw.is_closed) {
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
        `/api/v2/wardrobe/${memberId}/items?page=${page}&per_page=96&order=newest_first`
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

// Delete an item (Vinted uses POST .../delete, not DELETE)
app.delete('/api/vinted/items/:itemId', auth, async (req, res) => {
  const session = sessions[req.user.id];
  if (!session) return res.status(401).json({ error: 'No session' });
  try {
    const resp = await vintedFetch(session, `/api/v2/items/${req.params.itemId}/delete`, { method: 'POST' });
    res.json({ ok: resp.ok, status: resp.status });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Create item as draft via Vinted's item_upload flow, schedule activation
app.post('/api/vinted/items/create', auth, async (req, res) => {
  const session = sessions[req.user.id];
  if (!session) return res.status(401).json({ error: 'No session' });
  try {
    const uuid = crypto.randomBytes(16).toString('hex');
    const draftPayload = {
      draft: { ...req.body, temp_uuid: uuid },
      feedback_id: null, parcel: null, upload_session_id: uuid
    };
    const resp = await vintedFetch(session, '/api/v2/item_upload/drafts', { method: 'POST', body: draftPayload });
    const data = await resp.json();
    const draft = data.draft || data;
    const draftId = String(draft.id || '');
    if (draftId) {
      const delayMs = (15 + Math.random() * 5) * 60 * 1000;
      pendingActivations.push({ itemId: draftId, userId: req.user.id, activateAt: Date.now() + delayMs, draftData: draft, uploadSessionId: uuid });
      saveData();
      scheduleActivation(req.user.id, draftId, delayMs);
      console.log(`[RP] Draft ${draftId} created, activating in ${Math.round(delayMs / 60000)}m`);
    }
    res.json({ ok: true, itemId: draftId, draft: true });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Activate a draft manually
app.post('/api/vinted/items/:itemId/activate', auth, async (req, res) => {
  const session = sessions[req.user.id];
  if (!session) return res.status(401).json({ error: 'No session' });
  try {
    const pa = pendingActivations.find(p => p.itemId === req.params.itemId);
    let resp;
    if (pa?.draftData) {
      resp = await vintedFetch(session, `/api/v2/item_upload/drafts/${req.params.itemId}/completion`, {
        method: 'POST',
        body: { draft: pa.draftData, feedback_id: null, parcel: null, push_up: false, upload_session_id: pa.uploadSessionId || pa.draftData.temp_uuid }
      });
    } else {
      resp = await vintedFetch(session, `/api/v2/items/${req.params.itemId}`, { method: 'PUT', body: { is_draft: false } });
    }
    removePendingActivation(String(req.params.itemId));
    res.json({ ok: resp.ok });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ═══ PHOTO RE-UPLOAD — download from CDN then re-upload before old item is deleted ═══
async function reuploadPhotos(session, photos) {
  const domain = session.domain || 'www.vinted.co.uk';
  const results = [];
  for (const photo of photos) {
    try {
      const photoUrl = photo.full_size_url || photo.url || photo.high_resolution?.url;
      if (!photoUrl) { results.push({ id: photo.id, orientation: photo.orientation || 0 }); continue; }

      // Download from CDN (public URLs, no auth needed)
      const imgResp = await fetch(photoUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      if (!imgResp.ok) { results.push({ id: photo.id, orientation: photo.orientation || 0 }); continue; }
      const imgBuffer = await imgResp.arrayBuffer();

      // Re-upload to Vinted (do NOT set Content-Type — let fetch set multipart boundary)
      const uuid = crypto.randomBytes(16).toString('hex');
      const form = new FormData();
      form.append('photo[type]', 'item');
      form.append('photo[temp_uuid]', uuid);
      form.append('photo[file]', new Blob([imgBuffer], { type: 'image/jpeg' }), 'photo.jpg');

      const uploadResp = await fetch(`https://${domain}/api/v2/photos`, {
        method: 'POST',
        headers: {
          'Cookie': session.cookies,
          'X-CSRF-Token': session.csrf,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        body: form
      });

      if (uploadResp.ok) {
        const data = await uploadResp.json();
        const newId = data.photo?.id || data.id;
        if (newId) {
          results.push({ id: newId, orientation: photo.orientation || 0 });
          console.log(`[RP] Photo ${photo.id} → ${newId}`);
          await new Promise(r => setTimeout(r, 300));
          continue;
        }
      }
      console.log(`[RP] Photo reupload failed for ${photo.id}: ${uploadResp.status}`);
    } catch (e) {
      console.log(`[RP] Photo reupload error for ${photo.id}:`, e.message);
    }
    // Fallback: keep original ID (may not work after deletion, but better than nothing)
    results.push({ id: photo.id, orientation: photo.orientation || 0 });
  }
  return results;
}

// ═══ DRAFT PAYLOAD BUILDER (mirrors DOTB's qd() / _b() functions) ═══
function buildDraftPayload(item) {
  // price can be {amount: "10.00", currency_code: "GBP"} or a plain number
  const priceVal = typeof item.price === 'object' && item.price?.amount
    ? parseFloat(item.price.amount)
    : parseFloat(item.price) || 0;
  const currency = typeof item.price === 'object'
    ? (item.price.currency_code || 'GBP')
    : (item.currency || 'GBP');
  return {
    id: null,
    currency,
    temp_uuid: crypto.randomBytes(16).toString('hex'),
    title: item.title || '',
    description: item.description || '',
    brand_id: item.brand_id || null,
    brand: item.brand || null,
    size_id: item.size_id || null,
    catalog_id: item.catalog_id || item.category_id || null,
    isbn: item.isbn || null,
    is_unisex: item.is_unisex === true ? true : item.is_unisex === false ? false : null,
    status_id: item.status_id || null,
    video_game_rating_id: item.video_game_rating_id || null,
    price: priceVal,
    package_size_id: item.package_size_id || null,
    shipment_prices: { domestic: null, international: null },
    // DOTB: color_ids comes from color1_id + color2_id, NOT a color_ids array
    color_ids: [item.color1_id, item.color2_id].filter(Boolean),
    // DOTB: assigned_photos maps existing photo ids with orientation
    assigned_photos: (item.photos || []).map(p => ({ id: p.id, orientation: p.orientation || 0 })),
    measurement_length: item.measurement_length || null,
    measurement_width: item.measurement_width || null,
    item_attributes: item.item_attributes || [],
    manufacturer: item.manufacturer || null
  };
}

// ═══ BACKGROUND WORKER — activate pending drafts ═══
function scheduleActivation(userId, itemId, delayMs) {
  setTimeout(async () => {
    const session = sessions[userId];
    if (!session) {
      console.log(`[RP] No session for draft activation ${itemId} — will retry on next restart`);
      return;
    }
    try {
      const pa = pendingActivations.find(p => p.itemId === itemId);
      let resp;
      if (pa?.draftData) {
        // New draft flow: complete the draft to publish
        resp = await vintedFetch(session, `/api/v2/item_upload/drafts/${itemId}/completion`, {
          method: 'POST',
          body: { draft: pa.draftData, feedback_id: null, parcel: null, push_up: false, upload_session_id: pa.uploadSessionId || pa.draftData.temp_uuid }
        });
      } else {
        // Legacy flow: mark is_draft=false
        resp = await vintedFetch(session, `/api/v2/items/${itemId}`, { method: 'PUT', body: { is_draft: false } });
      }
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

// Fetch inbox (conversations)
app.get('/api/vinted/inbox', auth, async (req, res) => {
  const session = sessions[req.user.id];
  if (!session) return res.status(401).json({ error: 'No session' });
  try {
    const page = req.query.page || 1;
    const resp = await vintedFetch(session, `/api/v2/inbox?page=${page}&per_page=20`);
    const data = await resp.json();
    res.json({ ok: true, conversations: data.conversations || data.items || [], pagination: data.pagination });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Send a reply in a conversation
app.post('/api/vinted/conversations/:id/reply', auth, async (req, res) => {
  const session = sessions[req.user.id];
  if (!session) return res.status(401).json({ error: 'No session' });
  const { body } = req.body;
  if (!body) return res.status(400).json({ error: 'body required' });
  try {
    const resp = await vintedFetch(session, `/api/v2/conversations/${req.params.id}/replies`, { method: 'POST', body: { body } });
    const data = await resp.json();
    res.json({ ok: resp.ok, message: data.message || data });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Repost an item — create new draft FIRST, then delete original, then publish
app.post('/api/vinted/items/:itemId/repost', auth, async (req, res) => {
  const session = sessions[req.user.id];
  if (!session) return res.status(401).json({ error: 'No session' });
  const { itemId } = req.params;
  try {
    // 1. Fetch item in upload format (has price.amount, color1_id, catalog_id etc.)
    const getResp = await vintedFetch(session, `/api/v2/item_upload/items/${itemId}`);
    if (!getResp.ok) return res.status(getResp.status).json({ error: `Item fetch failed: ${getResp.status}` });
    const item = (await getResp.json()).item;
    if (!item) return res.status(404).json({ error: 'Item not found in response' });

    // 2. Re-upload photos BEFORE touching original (CDN URLs still valid while item exists)
    console.log(`[RP] Reuploading ${(item.photos||[]).length} photos for ${itemId}...`);
    const freshPhotos = await reuploadPhotos(session, item.photos || []);

    // 3. Create new draft with fresh photo IDs
    const draft = buildDraftPayload(item);
    draft.assigned_photos = freshPhotos;
    const uuid = draft.temp_uuid;
    const createResp = await vintedFetch(session, '/api/v2/item_upload/drafts', {
      method: 'POST',
      body: { draft, feedback_id: null, parcel: null, upload_session_id: uuid }
    });
    if (!createResp.ok) {
      const err = await createResp.json().catch(() => ({}));
      return res.status(createResp.status).json({ error: 'Draft creation failed', details: err });
    }
    const newDraft = (await createResp.json()).draft;
    const newId = String(newDraft?.id || '');
    if (!newId) return res.status(500).json({ error: 'No draft id returned' });

    // 4. Hide original, short delay, then delete (DOTB pattern)
    await vintedFetch(session, `/api/v2/items/${itemId}/is_hidden`, { method: 'PUT', body: { is_hidden: true } });
    await new Promise(r => setTimeout(r, 400 + Math.random() * 400));
    await vintedFetch(session, `/api/v2/items/${itemId}/delete`, { method: 'POST' });

    // 5. Short delay then publish the new draft
    await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
    const completionDraft = { ...draft, id: parseInt(newId) };
    const completeResp = await vintedFetch(session, `/api/v2/item_upload/drafts/${newId}/completion`, {
      method: 'POST',
      body: { draft: completionDraft, feedback_id: null, parcel: null, push_up: false, upload_session_id: uuid }
    });

    console.log(`[RP] Reposted ${itemId} → ${newId} (publish status: ${completeResp.status})`);
    res.json({ ok: completeResp.ok, oldId: itemId, newId, published: completeResp.ok });
  } catch (e) {
    console.error('[RP] Repost error:', e.message);
    res.status(502).json({ error: e.message });
  }
});

// ═══ START ═══
loadData();
recoverPendingActivations();
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[RelistPro Backend] v2.0.0 running on port ${PORT} | data: ${DATA_FILE}`);
});
