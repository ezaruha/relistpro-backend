const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3456;
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || null;
let stripe = null;
if (STRIPE_SECRET) { try { stripe = require('stripe')(STRIPE_SECRET); } catch(e) { console.log('[RP] Stripe not installed'); } }

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ═══ JSON FALLBACK (used when DATABASE_URL not set) ═══
const DATA_DIR = (() => {
  for (const d of ['/data', process.env.TMPDIR, '/tmp']) {
    if (d && fs.existsSync(d)) { try { fs.accessSync(d, fs.constants.W_OK); return d; } catch {} }
  }
  return '/tmp';
})();
const DATA_FILE = path.join(DATA_DIR, 'relistpro_data.json');
let users = {}, sessions = {}, pendingActivations = [];
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      users = d.users || {}; sessions = d.sessions || {}; pendingActivations = d.pendingActivations || [];
      console.log(`[RP] JSON fallback: ${Object.keys(users).length} users`);
    }
  } catch(e) { console.error('[RP] Load error:', e.message); }
}
function saveData() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify({ users, sessions, pendingActivations })); } catch(e) {}
}

// ═══ PLANS ═══
// Two plans only — match the actual extension features so the limits make sense.
// repostsPerMonth: hard cap on reposts per calendar month (null = unlimited).
// Free is generous enough to try everything; Pro removes all caps.
const PLANS = {
  free: { name:'Free', price:0,    itemLimit:50,   scheduleLimit:1,    repostsPerMonth:30,   backupLimit:50,   autoReply:false, analyticsMonths:1,
          features:['Up to 50 active items','30 reposts / month','1 schedule','50 backups','Manual messages'] },
  pro:  { name:'Pro',  price:9.99, itemLimit:null, scheduleLimit:null, repostsPerMonth:null, backupLimit:null, autoReply:true,  analyticsMonths:24,
          features:['Unlimited items','Unlimited reposts','Unlimited schedules','Unlimited backups','Auto-reply to messages','Full analytics history','Bulk repost & multi-quantity'] }
};

// Compute usage stats for a user across the current month
async function getUserUsage(userId) {
  if (!db.hasDb()) return { repostsThisMonth:0, itemsTotal:0, schedulesActive:0, actionsTotal:0 };
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
  try {
    const [repostsR, itemsR, schedulesR, actionsR] = await Promise.all([
      db.query("SELECT COUNT(*) AS n FROM rp_actions WHERE user_id=$1 AND type='repost' AND status='success' AND created_at>=$2", [userId, monthStart]),
      db.query("SELECT COUNT(*) AS n FROM rp_items WHERE user_id=$1 AND status!='sold'", [userId]),
      db.query("SELECT COUNT(*) AS n FROM rp_schedules WHERE user_id=$1 AND active=true", [userId]),
      db.query("SELECT COUNT(*) AS n FROM rp_actions WHERE user_id=$1", [userId])
    ]);
    return {
      repostsThisMonth: parseInt(repostsR.rows[0].n,10)||0,
      itemsTotal: parseInt(itemsR.rows[0].n,10)||0,
      schedulesActive: parseInt(schedulesR.rows[0].n,10)||0,
      actionsTotal: parseInt(actionsR.rows[0].n,10)||0
    };
  } catch(e) { console.error('[RP] Usage error:', e.message); return { repostsThisMonth:0, itemsTotal:0, schedulesActive:0, actionsTotal:0 }; }
}

// ═══ CRYPTO ═══
async function hashPassword(p) {
  return new Promise((res,rej) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(p, salt, 64, (err,key) => err ? rej(err) : res(`${salt}:${key.toString('hex')}`));
  });
}
async function verifyPassword(p, stored) {
  return new Promise((res,rej) => {
    const [salt,kh] = stored.split(':');
    if (!salt||!kh) return res(false);
    crypto.scrypt(p, salt, 64, (err,key) => {
      if (err) return rej(err);
      try { res(crypto.timingSafeEqual(Buffer.from(kh,'hex'),key)); } catch { res(false); }
    });
  });
}
function generateToken() { return 'rp_' + crypto.randomBytes(24).toString('base64url'); }

// ═══ STORAGE ADAPTER (DB preferred, JSON fallback) ═══
const store = {
  async getUser(username) {
    if (db.hasDb()) {
      const r = await db.query('SELECT * FROM rp_users WHERE username=$1', [username]);
      return r.rows[0] || null;
    }
    const u = users[username]; return u ? { id:username, username, ...u } : null;
  },
  async getUserByToken(token) {
    if (db.hasDb()) {
      const r = await db.query('SELECT * FROM rp_users WHERE token=$1', [token]);
      return r.rows[0] || null;
    }
    const found = Object.entries(users).find(([,u]) => u.token === token);
    return found ? { id:found[0], username:found[0], plan:'free', ...found[1] } : null;
  },
  async getUserById(id) {
    if (db.hasDb()) {
      const r = await db.query('SELECT * FROM rp_users WHERE id=$1', [id]);
      return r.rows[0] || null;
    }
    return null;
  },
  async createUser(username, hash, token, email) {
    if (db.hasDb()) {
      const r = await db.query(
        'INSERT INTO rp_users (username,email,password_hash,token) VALUES ($1,$2,$3,$4) RETURNING *',
        [username, email||null, hash, token]
      );
      return r.rows[0];
    }
    users[username] = { hash, token, created: new Date().toISOString() }; saveData();
    return { id:username, username, plan:'free', ...users[username] };
  },
  async updateUserToken(id, token) {
    if (db.hasDb()) {
      await db.query('UPDATE rp_users SET token=$1, updated_at=NOW() WHERE id=$2', [token, id]);
    } else {
      if (users[id]) { users[id].token = token; saveData(); }
    }
  },
  async updateUserPlan(id, plan, expiresAt, stripeCustomerId, stripeSubId) {
    if (db.hasDb()) {
      await db.query(
        'UPDATE rp_users SET plan=$1,plan_expires_at=$2,stripe_customer_id=COALESCE($3,stripe_customer_id),stripe_subscription_id=COALESCE($4,stripe_subscription_id),updated_at=NOW() WHERE id=$5',
        [plan, expiresAt||null, stripeCustomerId||null, stripeSubId||null, id]
      );
    } else {
      if (users[id]) { users[id].plan = plan; saveData(); }
    }
  },
  async getSession(userId) {
    if (db.hasDb()) {
      const r = await db.query('SELECT * FROM rp_sessions WHERE user_id=$1', [userId]);
      return r.rows[0] ? { csrf:r.rows[0].csrf, cookies:r.rows[0].cookies, domain:r.rows[0].domain, memberId:r.rows[0].member_id, storedAt:r.rows[0].stored_at } : null;
    }
    return sessions[userId] || null;
  },
  async setSession(userId, { csrf, cookies, domain, memberId }) {
    if (db.hasDb()) {
      await db.query(
        'INSERT INTO rp_sessions (user_id,csrf,cookies,domain,member_id,stored_at) VALUES ($1,$2,$3,$4,$5,NOW()) ON CONFLICT (user_id) DO UPDATE SET csrf=$2,cookies=$3,domain=$4,member_id=$5,stored_at=NOW()',
        [userId, csrf, cookies, domain||'www.vinted.co.uk', memberId||null]
      );
    } else {
      sessions[userId] = { csrf, cookies, domain:domain||'www.vinted.co.uk', memberId, storedAt:new Date().toISOString() }; saveData();
    }
  },
  async getPendingActivations(userId) {
    if (db.hasDb()) {
      const r = await db.query('SELECT * FROM rp_pending_activations WHERE user_id=$1', [userId]);
      return r.rows.map(row => ({ itemId:row.item_id, userId:row.user_id, activateAt:new Date(row.activate_at).getTime(), draftData:row.draft_data, uploadSessionId:row.upload_session_id }));
    }
    return pendingActivations.filter(p => p.userId === userId);
  },
  async addPendingActivation(pa) {
    if (db.hasDb()) {
      await db.query(
        'INSERT INTO rp_pending_activations (item_id,user_id,activate_at,draft_data,upload_session_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (item_id,user_id) DO UPDATE SET activate_at=$3,draft_data=$4,upload_session_id=$5',
        [pa.itemId, pa.userId, new Date(pa.activateAt).toISOString(), pa.draftData||{}, pa.uploadSessionId||null]
      );
    } else {
      pendingActivations = pendingActivations.filter(p => p.itemId !== pa.itemId); pendingActivations.push(pa); saveData();
    }
  },
  async removePendingActivation(itemId, userId) {
    if (db.hasDb()) {
      await db.query('DELETE FROM rp_pending_activations WHERE item_id=$1 AND user_id=$2', [itemId, userId]);
    } else {
      const before = pendingActivations.length;
      pendingActivations = pendingActivations.filter(p => p.itemId !== itemId);
      if (pendingActivations.length !== before) saveData();
    }
  },
  async getAllPendingActivations() {
    if (db.hasDb()) {
      const r = await db.query('SELECT * FROM rp_pending_activations ORDER BY activate_at ASC');
      return r.rows.map(row => ({ itemId:row.item_id, userId:row.user_id, activateAt:new Date(row.activate_at).getTime(), draftData:row.draft_data, uploadSessionId:row.upload_session_id }));
    }
    return [...pendingActivations];
  },
  async getSettings(userId) {
    if (db.hasDb()) {
      const r = await db.query('SELECT data FROM rp_settings WHERE user_id=$1', [userId]);
      return r.rows[0]?.data || {};
    }
    return {};
  },
  async setSettings(userId, data) {
    if (db.hasDb()) {
      await db.query('INSERT INTO rp_settings (user_id,data) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET data=$2', [userId, data]);
    }
  }
};

// ═══ NORMALISE ITEM STATUS ═══
function normalizeItem(raw) {
  let status = 'active';
  if (raw.is_draft) status = 'draft';
  else if (raw.is_hidden) status = 'hidden';
  else if (raw.item_closing_action === 'sold' || raw.is_closed) status = 'sold';
  else if (raw.is_reserved) status = 'reserved';
  else {
    const s = String(raw.status || raw.user_item_status || '').toLowerCase();
    if (s === 'sold' || s === 'closed') status = 'sold';
    else if (['draft','reserved','hidden'].includes(s)) status = s;
  }
  return { ...raw, status };
}

// ═══ HEALTH ═══
app.get('/health', (req, res) => res.json({ ok:true }));
app.get('/api/health', (req, res) => res.json({ ok:true, version:'3.0.0', db:db.hasDb() }));

// ═══ AUTH ═══
app.post('/api/auth/register', async (req, res) => {
  const { username, password, email } = req.body;
  if (!username || !password) return res.status(400).json({ error:'username and password required' });
  try {
    const existing = await store.getUser(username);
    if (existing) return res.status(409).json({ error:'User exists' });
    const hash = await hashPassword(password);
    const token = generateToken();
    await store.createUser(username, hash, token, email);
    res.json({ ok:true, token });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await store.getUser(username);
    if (!user) return res.status(401).json({ error:'Invalid credentials' });
    let valid = false;
    if (user.password_hash && user.password_hash.includes(':')) {
      valid = await verifyPassword(password, user.password_hash);
    } else if (user.hash && user.hash.includes(':')) {
      valid = await verifyPassword(password, user.hash);
    } else if (user.password) {
      valid = (user.password === password);
    }
    if (!valid) return res.status(401).json({ error:'Invalid credentials' });
    res.json({ ok:true, token:user.token, plan:user.plan||'free' });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ═══ AUTH MIDDLEWARE ═══
async function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error:'No token' });
  try {
    const user = await store.getUserByToken(token);
    if (!user) return res.status(401).json({ error:'Invalid token' });
    req.user = user;
    next();
  } catch(e) { res.status(500).json({ error:e.message }); }
}

// ═══ USER PROFILE ═══
app.get('/api/user/profile', auth, async (req, res) => {
  const session = await store.getSession(req.user.id);
  const plan = req.user.plan || 'free';
  const planInfo = PLANS[plan] || PLANS.free;
  const usage = await getUserUsage(req.user.id);
  // Compute remaining + percentages so the client can render bars without re-doing math
  const limits = {
    reposts: planInfo.repostsPerMonth,
    items: planInfo.itemLimit,
    schedules: planInfo.scheduleLimit
  };
  const remaining = {
    reposts: limits.reposts==null ? null : Math.max(0, limits.reposts - usage.repostsThisMonth),
    items: limits.items==null ? null : Math.max(0, limits.items - usage.itemsTotal),
    schedules: limits.schedules==null ? null : Math.max(0, limits.schedules - usage.schedulesActive)
  };
  res.json({
    ok:true,
    signedIn:true,
    username: req.user.username,
    email: req.user.email||null,
    plan,
    planInfo,
    planExpires: req.user.plan_expires_at||null,
    vintedConnected: !!session,
    vintedMemberId: session?.memberId||null,
    vintedDomain: session?.domain||null,
    createdAt: req.user.created_at||req.user.created||null,
    usage,
    limits,
    remaining
  });
});

app.patch('/api/user/profile', auth, async (req, res) => {
  const { email } = req.body;
  if (db.hasDb() && email) {
    try { await db.query('UPDATE rp_users SET email=$1,updated_at=NOW() WHERE id=$2', [email, req.user.id]); }
    catch(e) { return res.status(500).json({ error:e.message }); }
  }
  res.json({ ok:true });
});

// Change password — requires current password to authorise the change.
// On success the existing token is preserved (no forced re-login).
app.post('/api/auth/change-password', auth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error:'currentPassword and newPassword are required' });
  if (newPassword.length < 8) return res.status(400).json({ error:'New password must be at least 8 characters' });
  try {
    const user = await store.getUser(req.user.username);
    if (!user) return res.status(404).json({ error:'User not found' });
    let valid = false;
    if (user.password_hash && user.password_hash.includes(':')) valid = await verifyPassword(currentPassword, user.password_hash);
    else if (user.hash && user.hash.includes(':')) valid = await verifyPassword(currentPassword, user.hash);
    if (!valid) return res.status(401).json({ error:'Current password is incorrect' });
    const newHash = await hashPassword(newPassword);
    if (db.hasDb()) {
      await db.query('UPDATE rp_users SET password_hash=$1,updated_at=NOW() WHERE id=$2', [newHash, req.user.id]);
    } else {
      users[req.user.username].hash = newHash; saveData();
    }
    res.json({ ok:true });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ═══ SESSION ═══
app.post('/api/session/store', auth, async (req, res) => {
  const { csrf, cookies, domain, memberId } = req.body;
  try {
    await store.setSession(req.user.id, { csrf, cookies, domain, memberId });
    console.log(`[RP] Session stored for ${req.user.username} (member ${memberId})`);
    res.json({ ok:true });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.get('/api/session/status', auth, async (req, res) => {
  const s = await store.getSession(req.user.id);
  if (!s) return res.json({ active:false });
  res.json({ active:true, memberId:s.memberId, domain:s.domain, storedAt:s.storedAt });
});

// ═══ SYNC (extension posts all data here after each scrape) ═══
app.post('/api/sync', auth, async (req, res) => {
  if (!db.hasDb()) return res.json({ ok:true, stored:false, reason:'no-db' });
  const { items, sold, snapshots, messages, schedules, settings } = req.body || {};
  const userId = req.user.id;
  try {
    // Upsert items + write append-only backup snapshots
    if (items && typeof items === 'object') {
      for (const [itemId, it] of Object.entries(items)) {
        const price = typeof it.price === 'object' ? parseFloat(it.price?.amount||0) : parseFloat(it.price||0);
        const image = it.photos?.[0]?.url || it.image || it.photo || null;
        await db.query(`
          INSERT INTO rp_items (item_id,user_id,title,description,price,currency,status,image,views,favourites,repost_count,last_repost,cost_price,stock_qty,first_seen,sold_at,raw_data)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
          ON CONFLICT (item_id,user_id) DO UPDATE SET
            title=$3,description=$4,price=$5,currency=$6,status=$7,image=$8,
            views=$9,favourites=$10,repost_count=$11,last_repost=$12,
            cost_price=COALESCE($13,rp_items.cost_price),stock_qty=$14,sold_at=$16,raw_data=$17
        `, [itemId, userId, it.title||'', it.description||'', price, it.currency||'GBP',
            it.status||'active', image, it.views||0, it.favourites||0,
            it.repostCount||0, it.lastRepost||null, it.costPrice||null,
            it.stockQty||1, it.firstSeen||new Date().toISOString(), it.soldAt||null,
            JSON.stringify(it)]);

        // Backup snapshot — only if content changed since the last one (avoid spam)
        try {
          const lastBackup = await db.query(
            'SELECT title,description,price,photos FROM rp_item_backups WHERE user_id=$1 AND item_id=$2 ORDER BY backed_up_at DESC LIMIT 1',
            [userId, itemId]
          );
          const photos = Array.isArray(it.photos) ? it.photos.map(p => ({ id: p.id, url: p.url || p.full_size_url || null })) : [];
          const last = lastBackup.rows[0];
          const changed = !last
            || last.title !== (it.title || '')
            || (last.description || '') !== (it.description || '')
            || parseFloat(last.price || 0) !== price
            || JSON.stringify(last.photos || []) !== JSON.stringify(photos);
          if (changed) {
            await db.query(`
              INSERT INTO rp_item_backups (user_id,item_id,title,description,price,currency,brand,size,photos,raw_data)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            `, [userId, itemId, it.title || '', it.description || '', price, it.currency || 'GBP',
                it.brand || '', it.size || '', JSON.stringify(photos), JSON.stringify(it)]);
            // Prune to last 5 snapshots per item
            await db.query(`
              DELETE FROM rp_item_backups
              WHERE user_id=$1 AND item_id=$2
                AND id NOT IN (SELECT id FROM rp_item_backups WHERE user_id=$1 AND item_id=$2 ORDER BY backed_up_at DESC LIMIT 5)
            `, [userId, itemId]);
          }
        } catch (be) { console.warn('[RP] Backup write failed for', itemId, be.message); }
      }
    }
    // Upsert sold items
    if (Array.isArray(sold)) {
      for (const s of sold) {
        await db.query(`
          INSERT INTO rp_sold_items (item_id,user_id,title,price,sold_at,image,buyer_name)
          VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (item_id,user_id) DO NOTHING
        `, [s.id, userId, s.title||'', parseFloat(s.price||0), s.soldAt||null, s.image||null, s.buyerName||'']);
      }
    }
    // Upsert snapshots
    if (snapshots && typeof snapshots === 'object') {
      for (const [date, sn] of Object.entries(snapshots)) {
        await db.query(`
          INSERT INTO rp_snapshots (user_id,snap_date,total_views,total_favs,item_count)
          VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id,snap_date) DO UPDATE SET total_views=$3,total_favs=$4,item_count=$5
        `, [userId, date, sn.totalViews||0, sn.totalFavs||0, sn.count||0]);
      }
    }
    // Upsert messages (keep latest 200)
    if (Array.isArray(messages)) {
      for (const m of messages.slice(0,200)) {
        await db.query(`
          INSERT INTO rp_messages (id,user_id,conv_id,type,username,body,time,auto_replied,item_title)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id,user_id) DO NOTHING
        `, [m.id, userId, m.convId||'', m.type||'question', m.user||'', m.text||'', m.time||null, m.autoReplied||false, m.itemTitle||'']);
      }
    }
    // Replace schedules
    if (Array.isArray(schedules)) {
      await db.query('DELETE FROM rp_schedules WHERE user_id=$1', [userId]);
      for (const s of schedules) {
        const id = s.id || crypto.randomUUID();
        await db.query(`
          INSERT INTO rp_schedules (id,user_id,name,active,freq,hour_of_day,start_hour,end_hour,item_ids,next_run,last_run,date,slot,executed,tz_offset)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT (id,user_id) DO NOTHING
        `, [id, userId, s.name||'Schedule', s.active!==false, s.freq||1, s.hour||12, s.start||9, s.end||21, s.items||[], s.nextRun||null, s.lastRun||null, s.date||null, s.slot||null, s.executed||false, s.tz_offset!=null?s.tz_offset:0]);
      }
    }
    // Save settings
    if (settings) { await store.setSettings(userId, settings); }
    res.json({ ok:true, stored:true });
  } catch(e) {
    console.error('[RP] Sync error:', e.message);
    res.status(500).json({ error:e.message });
  }
});

// ═══ ITEM BACKUPS — recover items lost to failed reposts ═══
// List the latest backup for every item the user owns
app.get('/api/items/backups', auth, async (req, res) => {
  if (!db.hasDb()) return res.json({ ok:false, error:'Database not configured' });
  try {
    const r = await db.query(`
      SELECT DISTINCT ON (item_id) item_id, title, description, price, currency, brand, size, photos, raw_data, backed_up_at
      FROM rp_item_backups
      WHERE user_id=$1
      ORDER BY item_id, backed_up_at DESC
    `, [req.user.id]);
    res.json({ ok:true, backups: r.rows });
  } catch (e) {
    console.error('[RP] Backups list error:', e.message);
    res.status(500).json({ ok:false, error:e.message });
  }
});

// Get every snapshot for one specific item (newest first)
app.get('/api/items/backups/:itemId', auth, async (req, res) => {
  if (!db.hasDb()) return res.json({ ok:false, error:'Database not configured' });
  try {
    const r = await db.query(
      'SELECT id,item_id,title,description,price,currency,brand,size,photos,raw_data,backed_up_at FROM rp_item_backups WHERE user_id=$1 AND item_id=$2 ORDER BY backed_up_at DESC',
      [req.user.id, req.params.itemId]
    );
    res.json({ ok:true, snapshots: r.rows });
  } catch (e) {
    console.error('[RP] Backup fetch error:', e.message);
    res.status(500).json({ ok:false, error:e.message });
  }
});

// Manual backup write — content script can call this directly before risky operations
app.post('/api/items/backup', auth, async (req, res) => {
  if (!db.hasDb()) return res.json({ ok:false, error:'Database not configured' });
  const { item } = req.body || {};
  if (!item || !item.id) return res.status(400).json({ ok:false, error:'item.id required' });
  try {
    const price = typeof item.price === 'object' ? parseFloat(item.price?.amount||0) : parseFloat(item.price||0);
    const photos = Array.isArray(item.photos) ? item.photos.map(p => ({ id: p.id, url: p.url || p.full_size_url || null })) : [];
    await db.query(`
      INSERT INTO rp_item_backups (user_id,item_id,title,description,price,currency,brand,size,photos,raw_data)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `, [req.user.id, String(item.id), item.title||'', item.description||'', price, item.currency||'GBP',
        item.brand||'', item.size||'', JSON.stringify(photos), JSON.stringify(item)]);
    await db.query(`
      DELETE FROM rp_item_backups
      WHERE user_id=$1 AND item_id=$2
        AND id NOT IN (SELECT id FROM rp_item_backups WHERE user_id=$1 AND item_id=$2 ORDER BY backed_up_at DESC LIMIT 5)
    `, [req.user.id, String(item.id)]);
    res.json({ ok:true });
  } catch (e) {
    console.error('[RP] Manual backup error:', e.message);
    res.status(500).json({ ok:false, error:e.message });
  }
});

// ═══ DASHBOARD DATA (web dashboard reads here) ═══
app.get('/api/dashboard', auth, async (req, res) => {
  if (!db.hasDb()) return res.json({ ok:false, error:'Database not configured' });
  const userId = req.user.id;
  const plan = req.user.plan || 'free';
  const planInfo = PLANS[plan] || PLANS.free;
  try {
    const [itemsR, soldR, snapshotsR, messagesR, schedulesR, actionsR, settingsR, sessionR] = await Promise.all([
      db.query('SELECT * FROM rp_items WHERE user_id=$1 ORDER BY first_seen DESC', [userId]),
      db.query('SELECT * FROM rp_sold_items WHERE user_id=$1 ORDER BY sold_at DESC NULLS LAST', [userId]),
      db.query('SELECT * FROM rp_snapshots WHERE user_id=$1 ORDER BY snap_date DESC LIMIT 365', [userId]),
      db.query('SELECT * FROM rp_messages WHERE user_id=$1 ORDER BY time DESC LIMIT 200', [userId]),
      db.query('SELECT * FROM rp_schedules WHERE user_id=$1', [userId]),
      db.query('SELECT id,type,item_id,new_item_id,item_title,status,details,created_at FROM rp_actions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200', [userId]),
      store.getSettings(userId),
      store.getSession(userId)
    ]);
    // Build items object keyed by item_id
    const items = {};
    for (const row of itemsR.rows) {
      items[row.item_id] = {
        id:row.item_id, title:row.title, description:row.description, price:parseFloat(row.price||0),
        currency:row.currency, status:row.status, image:row.image, views:row.views,
        favourites:row.favourites, repostCount:row.repost_count, lastRepost:row.last_repost,
        costPrice:row.cost_price ? parseFloat(row.cost_price) : null,
        stockQty:row.stock_qty, firstSeen:row.first_seen, soldAt:row.sold_at,
        ...(row.raw_data||{})
      };
    }
    const sold = soldR.rows.map(row => ({
      id:row.item_id, title:row.title, price:parseFloat(row.price||0),
      soldAt:row.sold_at, image:row.image, buyerName:row.buyer_name
    }));
    const snapshots = {};
    for (const row of snapshotsR.rows) {
      snapshots[row.snap_date.toISOString().slice(0,10)] = { totalViews:row.total_views, totalFavs:row.total_favs, count:row.item_count };
    }
    const messages = messagesR.rows.map(row => ({
      id:row.id, convId:row.conv_id, type:row.type, user:row.username, text:row.body,
      time:row.time, autoReplied:row.auto_replied, itemTitle:row.item_title
    }));
    const schedules = schedulesR.rows.map(row => ({
      id:row.id, name:row.name, active:row.active, freq:row.freq, hour:row.hour_of_day,
      start:row.start_hour, end:row.end_hour, items:row.item_ids, nextRun:row.next_run, lastRun:row.last_run,
      date:row.date||null, slot:row.slot||null, executed:row.executed||false, tz_offset:row.tz_offset||0
    }));
    const actions = actionsR.rows.map(row => ({
      id:row.id, type:row.type, itemId:row.item_id, newItemId:row.new_item_id,
      itemTitle:row.item_title, status:row.status, details:row.details||{},
      createdAt:row.created_at
    }));
    const totalRevenue = sold.reduce((s,i) => s+(i.price||0), 0);
    const usage = await getUserUsage(userId);
    const limits = { reposts:planInfo.repostsPerMonth, items:planInfo.itemLimit, schedules:planInfo.scheduleLimit };
    const remaining = {
      reposts: limits.reposts==null ? null : Math.max(0, limits.reposts - usage.repostsThisMonth),
      items: limits.items==null ? null : Math.max(0, limits.items - usage.itemsTotal),
      schedules: limits.schedules==null ? null : Math.max(0, limits.schedules - usage.schedulesActive)
    };
    res.json({ ok:true, items, sold, snapshots, messages, schedules, actions, settings:settingsR,
      totalRevenue, plan, planInfo, usage, limits, remaining,
      profile: {
        signedIn:true, username:req.user.username, email:req.user.email||null,
        plan, planInfo, planExpires:req.user.plan_expires_at||null
      },
      account: { memberId:sessionR?.memberId, domain:sessionR?.domain, connected:!!sessionR }
    });
  } catch(e) {
    console.error('[RP] Dashboard error:', e.message);
    res.status(500).json({ error:e.message });
  }
});

// ═══ SUBSCRIPTIONS ═══
app.get('/api/subscriptions/plans', (req, res) => {
  res.json({ ok:true, plans:PLANS });
});

app.get('/api/subscriptions/current', auth, async (req, res) => {
  const plan = req.user.plan || 'free';
  res.json({ ok:true, plan, planInfo:PLANS[plan]||PLANS.free, expires:req.user.plan_expires_at||null });
});

app.post('/api/subscriptions/checkout', auth, async (req, res) => {
  const { plan, successUrl, cancelUrl } = req.body;
  if (!PLANS[plan] || plan === 'free') return res.status(400).json({ error:'Invalid plan' });
  if (!stripe) return res.json({ ok:false, manual:true, message:'To upgrade, contact support at support@relistpro.com', plan, price:PLANS[plan].price });
  try {
    const priceIds = { pro: process.env.STRIPE_PRICE_PRO, business: process.env.STRIPE_PRICE_BUSINESS };
    if (!priceIds[plan]) return res.status(400).json({ error:'Stripe price not configured for this plan' });
    let customerId = req.user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({ email:req.user.email||undefined, metadata:{ userId:req.user.id, username:req.user.username } });
      customerId = customer.id;
      await store.updateUserPlan(req.user.id, req.user.plan||'free', null, customerId, null);
    }
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price:priceIds[plan], quantity:1 }],
      mode: 'subscription',
      success_url: successUrl || `${req.headers.origin}/app?upgrade=success`,
      cancel_url: cancelUrl || `${req.headers.origin}/app?upgrade=cancelled`,
      metadata: { userId:req.user.id, plan }
    });
    res.json({ ok:true, url:session.url });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post('/api/webhooks/stripe', express.raw({ type:'application/json' }), async (req, res) => {
  if (!stripe) return res.json({ ok:false });
  const sig = req.headers['stripe-signature'];
  let event;
  try { event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET); }
  catch(e) { return res.status(400).json({ error:e.message }); }
  try {
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object;
      const { userId, plan } = s.metadata || {};
      if (userId && plan) {
        const sub = s.subscription ? await stripe.subscriptions.retrieve(s.subscription) : null;
        const expires = sub ? new Date(sub.current_period_end * 1000).toISOString() : null;
        await store.updateUserPlan(userId, plan, expires, s.customer, s.subscription);
        console.log(`[RP] Plan upgraded: ${userId} → ${plan}`);
      }
    } else if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      const cus = await stripe.customers.retrieve(sub.customer);
      const userId = cus.metadata?.userId;
      if (userId) { await store.updateUserPlan(userId, 'free', null, null, null); }
    } else if (event.type === 'customer.subscription.updated') {
      const sub = event.data.object;
      const cus = await stripe.customers.retrieve(sub.customer);
      const userId = cus.metadata?.userId;
      if (userId && sub.status !== 'active') { await store.updateUserPlan(userId, 'free', null, null, null); }
    }
    res.json({ received:true });
  } catch(e) { console.error('[RP] Webhook error:', e.message); res.status(500).json({ error:e.message }); }
});

// Reliably hide + delete an item on Vinted with retry logic
async function deleteVintedItem(session, itemId, label) {
  const tag = label || 'RP';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // Hide first
      await vintedFetch(session, `/api/v2/items/${itemId}/is_hidden`, { method:'PUT', body:{ is_hidden:true } });
      await new Promise(r => setTimeout(r, 400 + Math.random() * 400));
      // Delete
      const delResp = await vintedFetch(session, `/api/v2/items/${itemId}/delete`, { method:'POST' });
      if (delResp.ok || delResp.status === 404) {
        console.log(`[${tag}] Deleted old item ${itemId} (attempt ${attempt}, status ${delResp.status})`);
        return true;
      }
      console.log(`[${tag}] Delete ${itemId} attempt ${attempt} failed: ${delResp.status}`);
    } catch (e) {
      console.log(`[${tag}] Delete ${itemId} attempt ${attempt} error: ${e.message}`);
    }
    if (attempt < 3) await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
  }
  console.log(`[${tag}] Failed to delete ${itemId} after 3 attempts`);
  return false;
}

// ═══ VINTED PROXY ═══
async function vintedFetch(session, urlPath, options = {}) {
  const domain = session.domain || 'www.vinted.co.uk';
  const resp = await fetch(`https://${domain}${urlPath}`, {
    method: options.method || 'GET',
    headers: { 'Cookie':session.cookies, 'X-CSRF-Token':session.csrf, 'Content-Type':'application/json', 'Accept':'application/json', 'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  return resp;
}

app.get('/api/vinted/dressing/:memberId', auth, async (req, res) => {
  const session = await store.getSession(req.user.id);
  if (!session) return res.status(401).json({ error:'No session. Sync from Vinted first.' });
  if (session.memberId && req.params.memberId !== session.memberId) return res.status(403).json({ error:'memberId mismatch' });
  const memberId = session.memberId || req.params.memberId;
  const filterStatus = req.query.status || 'active';
  try {
    const seen = new Set(), items = [];
    let page = 1;
    while (page <= 50) {
      const resp = await vintedFetch(session, `/api/v2/wardrobe/${memberId}/items?page=${page}&per_page=96&order=newest_first`);
      if (!resp.ok) break;
      const data = await resp.json();
      const pageItems = data.items || data.user_items || [];
      if (!pageItems.length) break;
      for (const raw of pageItems) {
        const id = String(raw.id);
        if (seen.has(id)) continue;
        seen.add(id);
        const item = normalizeItem(raw);
        if (filterStatus === 'all' || item.status === filterStatus) items.push(item);
      }
      page++;
      await new Promise(r => setTimeout(r, 300));
    }
    res.json({ ok:true, items, total:items.length });
  } catch(e) { res.status(502).json({ error:e.message }); }
});

app.delete('/api/vinted/items/:itemId', auth, async (req, res) => {
  const session = await store.getSession(req.user.id);
  if (!session) return res.status(401).json({ error:'No session' });
  try {
    const resp = await vintedFetch(session, `/api/v2/items/${req.params.itemId}/delete`, { method:'POST' });
    res.json({ ok:resp.ok, status:resp.status });
  } catch(e) { res.status(502).json({ error:e.message }); }
});

app.post('/api/vinted/items/create', auth, async (req, res) => {
  const session = await store.getSession(req.user.id);
  if (!session) return res.status(401).json({ error:'No session' });
  try {
    const uuid = crypto.randomBytes(16).toString('hex');
    const draftPayload = { draft:{ ...req.body, temp_uuid:uuid }, feedback_id:null, parcel:null, upload_session_id:uuid };
    const resp = await vintedFetch(session, '/api/v2/item_upload/drafts', { method:'POST', body:draftPayload });
    const data = await resp.json();
    const draft = data.draft || data;
    const draftId = String(draft.id || '');
    if (draftId) {
      const delayMs = (15 + Math.random() * 5) * 60 * 1000;
      const pa = { itemId:draftId, userId:req.user.id, activateAt:Date.now()+delayMs, draftData:draft, uploadSessionId:uuid };
      await store.addPendingActivation(pa);
      scheduleActivation(req.user.id, draftId, delayMs);
    }
    res.json({ ok:true, itemId:draftId, draft:true });
  } catch(e) { res.status(502).json({ error:e.message }); }
});

app.post('/api/vinted/items/:itemId/activate', auth, async (req, res) => {
  const session = await store.getSession(req.user.id);
  if (!session) return res.status(401).json({ error:'No session' });
  try {
    const pas = await store.getPendingActivations(req.user.id);
    const pa = pas.find(p => p.itemId === req.params.itemId);
    let resp;
    if (pa?.draftData) {
      resp = await vintedFetch(session, `/api/v2/item_upload/drafts/${req.params.itemId}/completion`, {
        method:'POST', body:{ draft:pa.draftData, feedback_id:null, parcel:null, push_up:false, upload_session_id:pa.uploadSessionId||pa.draftData.temp_uuid }
      });
    } else {
      resp = await vintedFetch(session, `/api/v2/items/${req.params.itemId}`, { method:'PUT', body:{ is_draft:false } });
    }
    await store.removePendingActivation(String(req.params.itemId), req.user.id);
    res.json({ ok:resp.ok });
  } catch(e) { res.status(502).json({ error:e.message }); }
});

async function reuploadPhotos(session, photos) {
  const domain = session.domain || 'www.vinted.co.uk';
  const results = [];
  for (const photo of photos) {
    try {
      const photoUrl = photo.full_size_url || photo.url || photo.high_resolution?.url;
      if (!photoUrl) { console.log(`[RP] Photo ${photo.id}: no URL, skipping`); continue; }
      const imgResp = await fetch(photoUrl, { headers:{ 'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
      if (!imgResp.ok) { console.log(`[RP] Photo ${photo.id}: fetch failed (${imgResp.status}), skipping`); continue; }
      const imgBuffer = await imgResp.arrayBuffer();
      const uuid = crypto.randomBytes(16).toString('hex');
      const form = new FormData();
      form.append('photo[type]', 'item');
      form.append('photo[temp_uuid]', uuid);
      form.append('photo[file]', new Blob([imgBuffer], { type:'image/jpeg' }), 'photo.jpg');
      const uploadResp = await fetch(`https://${domain}/api/v2/photos`, {
        method:'POST',
        headers:{ 'Cookie':session.cookies, 'X-CSRF-Token':session.csrf, 'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        body:form
      });
      if (uploadResp.ok) {
        const data = await uploadResp.json();
        const newId = data.photo?.id || data.id;
        if (newId) { results.push({ id:newId, orientation:photo.orientation||0 }); await new Promise(r => setTimeout(r,300)); continue; }
      }
    } catch(e) { console.log(`[RP] Photo ${photo.id}: error ${e.message}, skipping`); }
  }
  if (!results.length && photos.length) {
    console.log(`[RP] WARNING: All ${photos.length} photo re-uploads failed`);
  }
  return results;
}

function buildDraftPayload(item) {
  const priceVal = typeof item.price === 'object' && item.price?.amount ? parseFloat(item.price.amount) : parseFloat(item.price) || 0;
  const currency = typeof item.price === 'object' ? (item.price.currency_code||'GBP') : (item.currency||'GBP');
  return {
    id:null, currency, temp_uuid:crypto.randomBytes(16).toString('hex'),
    title:item.title||'', description:item.description||'',
    brand_id:item.brand_id||null, brand:item.brand||null, size_id:item.size_id||null,
    catalog_id:item.catalog_id||item.category_id||null, isbn:item.isbn||null,
    is_unisex:item.is_unisex===true?true:item.is_unisex===false?false:null,
    status_id:item.status_id||null, video_game_rating_id:item.video_game_rating_id||null,
    price:priceVal, package_size_id:item.package_size_id||null,
    shipment_prices:{ domestic:null, international:null },
    color_ids:[item.color1_id,item.color2_id].filter(Boolean),
    assigned_photos:(item.photos||[]).map(p => ({ id:p.id, orientation:p.orientation||0 })),
    measurement_length:item.measurement_length||null, measurement_width:item.measurement_width||null,
    item_attributes:item.item_attributes||[], manufacturer:item.manufacturer||null
  };
}

function scheduleActivation(userId, itemId, delayMs) {
  setTimeout(async () => {
    const session = await store.getSession(userId);
    if (!session) return;
    try {
      const pas = await store.getPendingActivations(userId);
      const pa = pas.find(p => p.itemId === itemId);
      let resp;
      if (pa?.draftData) {
        resp = await vintedFetch(session, `/api/v2/item_upload/drafts/${itemId}/completion`, {
          method:'POST', body:{ draft:pa.draftData, feedback_id:null, parcel:null, push_up:false, upload_session_id:pa.uploadSessionId||pa.draftData.temp_uuid }
        });
      } else {
        resp = await vintedFetch(session, `/api/v2/items/${itemId}`, { method:'PUT', body:{ is_draft:false } });
      }
      if (resp.ok) { console.log(`[RP] Draft ${itemId} activated`); await store.removePendingActivation(itemId, userId); }
      else console.log(`[RP] Draft ${itemId} activation returned ${resp.status}`);
    } catch(e) { console.log(`[RP] Draft activation failed ${itemId}:`, e.message); }
  }, delayMs);
}

async function recoverPendingActivations() {
  const all = await store.getAllPendingActivations();
  if (!all.length) return;
  console.log(`[RP] Recovering ${all.length} pending activations`);
  for (const pa of all) {
    const delay = Math.max(0, pa.activateAt - Date.now());
    scheduleActivation(pa.userId, pa.itemId, delay);
  }
}

app.get('/api/vinted/inbox', auth, async (req, res) => {
  const session = await store.getSession(req.user.id);
  if (!session) return res.status(401).json({ error:'No session' });
  try {
    const resp = await vintedFetch(session, `/api/v2/inbox?page=${req.query.page||1}&per_page=20`);
    const data = await resp.json();
    res.json({ ok:true, conversations:data.conversations||data.items||[], pagination:data.pagination });
  } catch(e) { res.status(502).json({ error:e.message }); }
});

app.post('/api/vinted/conversations/:id/reply', auth, async (req, res) => {
  const session = await store.getSession(req.user.id);
  if (!session) return res.status(401).json({ error:'No session' });
  const { body } = req.body;
  if (!body) return res.status(400).json({ error:'body required' });
  try {
    const resp = await vintedFetch(session, `/api/v2/conversations/${req.params.id}/replies`, { method:'POST', body:{ body } });
    const data = await resp.json();
    res.json({ ok:resp.ok, message:data.message||data });
  } catch(e) { res.status(502).json({ error:e.message }); }
});

app.post('/api/vinted/items/:itemId/repost', auth, async (req, res) => {
  const session = await store.getSession(req.user.id);
  if (!session) return res.status(401).json({ error:'No session' });
  const { itemId } = req.params;
  const { freshPhotos:browserPhotos } = req.body || {};
  try {
    let item = null;
    const getResp = await vintedFetch(session, `/api/v2/item_upload/items/${itemId}`);
    if (getResp.ok) {
      item = (await getResp.json()).item;
    }
    // If item not found on Vinted, try to recover from backend backup
    if (!item) {
      console.log(`[RP] Item ${itemId} not found on Vinted (${getResp.status}), trying backup...`);
      if (db.hasDb()) {
        const bk = await db.query(
          'SELECT raw_data FROM rp_item_backups WHERE user_id=$1 AND item_id=$2 ORDER BY backed_up_at DESC LIMIT 1',
          [req.user.id, itemId]
        );
        if (bk.rows[0] && bk.rows[0].raw_data) {
          item = bk.rows[0].raw_data;
          if (!item.id) item.id = itemId;
          console.log(`[RP] Recovered item ${itemId} from backup — title: ${item.title}`);
        }
      }
      if (!item) return res.status(404).json({ error:'Item not found on Vinted and no backup available' });
    }
    let freshPhotos;
    if (browserPhotos && browserPhotos.length > 0) {
      freshPhotos = browserPhotos;
      console.log(`[RP] Using ${freshPhotos.length} browser photos for ${itemId}`);
    } else {
      console.log(`[RP] Server-side re-upload for ${itemId}...`);
      freshPhotos = await reuploadPhotos(session, item.photos || []);
    }
    const draft = buildDraftPayload(item);
    draft.assigned_photos = freshPhotos;
    const uuid = draft.temp_uuid;
    const createResp = await vintedFetch(session, '/api/v2/item_upload/drafts', {
      method:'POST', body:{ draft, feedback_id:null, parcel:null, upload_session_id:uuid }
    });
    if (!createResp.ok) {
      const err = await createResp.json().catch(() => ({}));
      return res.status(createResp.status).json({ error:'Draft creation failed', details:err });
    }
    const newDraft = (await createResp.json()).draft;
    const newId = String(newDraft?.id || '');
    if (!newId) return res.status(500).json({ error:'No draft id returned' });
    await deleteVintedItem(session, itemId, 'RP');
    await new Promise(r => setTimeout(r, 800 + Math.random() * 400));
    const refreshResp = await vintedFetch(session, `/api/v2/item_upload/items/${newId}`);
    const refreshedItem = refreshResp.ok ? (await refreshResp.json()).item : null;
    await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));
    const completionDraft = refreshedItem ? buildDraftPayload(refreshedItem) : { ...draft, id:parseInt(newId) };
    completionDraft.id = parseInt(newId);
    completionDraft.assigned_photos = freshPhotos; // Always use freshly uploaded photo IDs
    const completionUuid = completionDraft.temp_uuid || uuid;
    const completeResp = await vintedFetch(session, `/api/v2/item_upload/drafts/${newId}/completion`, {
      method:'POST', body:{ draft:completionDraft, feedback_id:null, parcel:null, push_up:false, upload_session_id:completionUuid }
    });
    const completeBody = await completeResp.json().catch(() => ({}));
    // Unhide the new listing — Vinted can leave it hidden after publish
    if (completeResp.ok) {
      await new Promise(r => setTimeout(r, 1000));
      try { await vintedFetch(session, `/api/v2/items/${newId}/is_hidden`, { method:'PUT', body:{ is_hidden:false } }); } catch(_) {}
      // Transfer old item → new in DB
      if (db.hasDb()) {
        try { await db.query('UPDATE rp_items SET item_id=$1, repost_count=repost_count+1, last_repost=NOW() WHERE item_id=$2 AND user_id=$3', [newId, itemId, req.user.id]); } catch(_) {}
      }
    }
    console.log(`[RP] Reposted ${itemId} → ${newId} (${completeResp.status})`);
    res.json({ ok:completeResp.ok, oldId:itemId, newId, published:completeResp.ok, details:completeBody });
  } catch(e) {
    console.error('[RP] Repost error:', e.message);
    res.status(502).json({ error:e.message });
  }
});

// ═══ BACKEND REPOST QUEUE — works when browser is closed ═══
// Accepts one or more item IDs and reposts them server-side with staggered timing.
// The response returns immediately; reposts run in background.
app.post('/api/repost-queue', auth, async (req, res) => {
  const { itemIds } = req.body || {};
  if (!Array.isArray(itemIds) || !itemIds.length) return res.status(400).json({ error:'itemIds array required' });
  const session = await store.getSession(req.user.id);
  if (!session) return res.status(401).json({ error:'No Vinted session. Sync from Vinted first.' });
  const userId = req.user.id;
  // Quota check
  const planInfo = PLANS[req.user.plan || 'free'] || PLANS.free;
  if (planInfo.repostsPerMonth != null) {
    const usage = await getUserUsage(userId);
    if (usage.repostsThisMonth + itemIds.length > planInfo.repostsPerMonth) {
      return res.status(429).json({ ok:false, error:`Would exceed repost quota (${planInfo.repostsPerMonth}/month). ${Math.max(0, planInfo.repostsPerMonth - usage.repostsThisMonth)} remaining.`, quotaExceeded:true });
    }
  }
  // Respond immediately — work runs in background
  res.json({ ok:true, queued:itemIds.length });
  // Process reposts in background with staggered timing
  (async () => {
    for (let i = 0; i < itemIds.length; i++) {
      const itemId = String(itemIds[i]);
      try {
        // Fetch item from Vinted, fall back to backup
        let item = null;
        const getResp = await vintedFetch(session, `/api/v2/item_upload/items/${itemId}`);
        if (getResp.ok) item = (await getResp.json()).item;
        if (!item && db.hasDb()) {
          const bk = await db.query('SELECT raw_data FROM rp_item_backups WHERE user_id=$1 AND item_id=$2 ORDER BY backed_up_at DESC LIMIT 1', [userId, itemId]);
          if (bk.rows[0] && bk.rows[0].raw_data) { item = bk.rows[0].raw_data; if (!item.id) item.id = itemId; }
        }
        if (!item) {
          await logAction(userId, 'repost', { itemId, status:'failed', details:{ source:'backend-queue', error:'Item not found' } });
          continue;
        }
        // Re-upload photos
        const freshPhotos = await reuploadPhotos(session, item.photos || []);
        const draft = buildDraftPayload(item);
        draft.assigned_photos = freshPhotos;
        const uuid = draft.temp_uuid;
        // Create draft
        const createResp = await vintedFetch(session, '/api/v2/item_upload/drafts', {
          method:'POST', body:{ draft, feedback_id:null, parcel:null, upload_session_id:uuid }
        });
        if (!createResp.ok) {
          await logAction(userId, 'repost', { itemId, itemTitle:item.title, status:'failed', details:{ source:'backend-queue', error:'Draft creation failed' } });
          continue;
        }
        const newDraft = (await createResp.json()).draft;
        const newId = String(newDraft?.id || '');
        // Delete original — always try, even if initial GET failed (item may still exist)
        await deleteVintedItem(session, itemId, 'RP-queue');
        // Refresh & complete
        await new Promise(r => setTimeout(r, 800 + Math.random() * 400));
        const refreshResp = await vintedFetch(session, `/api/v2/item_upload/items/${newId}`);
        const refreshedItem = refreshResp.ok ? (await refreshResp.json()).item : null;
        await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));
        const completionDraft = refreshedItem ? buildDraftPayload(refreshedItem) : { ...draft, id:parseInt(newId) };
        completionDraft.id = parseInt(newId);
        completionDraft.assigned_photos = freshPhotos;
        const completeResp = await vintedFetch(session, `/api/v2/item_upload/drafts/${newId}/completion`, {
          method:'POST', body:{ draft:completionDraft, feedback_id:null, parcel:null, push_up:false, upload_session_id:completionDraft.temp_uuid || uuid }
        });
        if (completeResp.ok) {
          try { await vintedFetch(session, `/api/v2/items/${newId}/is_hidden`, { method:'PUT', body:{ is_hidden:false } }); } catch(_) {}
          console.log(`[RP-queue] Reposted ${itemId} → ${newId}`);
          await logAction(userId, 'repost', { itemId, newItemId:newId, itemTitle:item.title, status:'success', details:{ source:'backend-queue' } });
          if (db.hasDb()) {
            try { await db.query('UPDATE rp_items SET item_id=$1, repost_count=repost_count+1, last_repost=NOW() WHERE item_id=$2 AND user_id=$3', [newId, itemId, userId]); } catch(_) {}
          }
        } else {
          await logAction(userId, 'repost', { itemId, itemTitle:item.title, status:'failed', details:{ source:'backend-queue', error:`Publish failed (${completeResp.status})` } });
        }
        // Stagger between items
        if (i < itemIds.length - 1) await new Promise(r => setTimeout(r, 60000 + Math.random() * 60000));
      } catch (e) {
        console.error(`[RP-queue] Error for ${itemId}:`, e.message);
        await logAction(userId, 'repost', { itemId, status:'failed', details:{ source:'backend-queue', error:e.message } });
      }
    }
    console.log(`[RP-queue] Finished ${itemIds.length} items for user ${userId}`);
  })();
});

// ═══ REPOST LOG (called by extension after browser-side repost — updates DB immediately) ═══
// ═══ ACTIVITY LOG ═══
app.post('/api/actions', auth, async (req, res) => {
  if (!db.hasDb()) return res.json({ ok:false });
  const { type, itemId, newItemId, itemTitle, status, details } = req.body || {};
  if (!type) return res.status(400).json({ error:'type required' });
  try {
    const r = await db.query(
      `INSERT INTO rp_actions(user_id,type,item_id,new_item_id,item_title,status,details)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,created_at`,
      [req.user.id, type, itemId||null, newItemId||null, itemTitle||null, status||'success', JSON.stringify(details||{})]
    );
    res.json({ ok:true, id:r.rows[0].id, createdAt:r.rows[0].created_at });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.get('/api/actions', auth, async (req, res) => {
  if (!db.hasDb()) return res.json({ ok:true, actions:[] });
  const limit = Math.min(parseInt(req.query.limit||'200',10), 1000);
  try {
    const r = await db.query(
      `SELECT id,type,item_id,new_item_id,item_title,status,details,created_at
       FROM rp_actions WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`,
      [req.user.id, limit]
    );
    const actions = r.rows.map(row => ({
      id:row.id, type:row.type, itemId:row.item_id, newItemId:row.new_item_id,
      itemTitle:row.item_title, status:row.status, details:row.details||{},
      createdAt:row.created_at
    }));
    res.json({ ok:true, actions });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post('/api/vinted/items/:itemId/repost-log', auth, async (req, res) => {
  const { newId, edits } = req.body || {};
  try {
    // Enforce monthly quota
    const planInfo = PLANS[req.user.plan||'free'] || PLANS.free;
    if (planInfo.repostsPerMonth != null) {
      const usage = await getUserUsage(req.user.id);
      if (usage.repostsThisMonth >= planInfo.repostsPerMonth) {
        return res.status(429).json({ ok:false, error:`Repost quota reached for ${planInfo.name} plan (${planInfo.repostsPerMonth}/month). Upgrade to continue.`, quotaExceeded:true });
      }
    }
    if (db.hasDb()) {
      const now = new Date().toISOString();
      if (newId && newId !== req.params.itemId) {
        // Fetch current raw_data to merge repostEdits into it
        const existing = await db.query('SELECT raw_data FROM rp_items WHERE item_id=$1 AND user_id=$2', [req.params.itemId, req.user.id]);
        let raw = {};
        try { raw = JSON.parse(existing.rows[0]?.raw_data || '{}'); } catch {}
        const prevEdits = raw.repostEdits || [];
        const newRepostEdits = edits && edits.length ? [edits, ...prevEdits.slice(0,4)] : prevEdits;
        const updatedRaw = JSON.stringify(Object.assign({}, raw, { lastRepost: now, repostEdits: newRepostEdits, repostCount: (raw.repostCount||0)+1 }));
        await db.query(
          `UPDATE rp_items SET item_id=$1,last_repost=$2,repost_count=repost_count+1,status='active',raw_data=$5
           WHERE item_id=$3 AND user_id=$4`,
          [newId, now, req.params.itemId, req.user.id, updatedRaw]
        );
      } else {
        await db.query(
          'UPDATE rp_items SET repost_count=repost_count+1,last_repost=$1 WHERE item_id=$2 AND user_id=$3',
          [now, req.params.itemId, req.user.id]
        );
      }
      // Always log to activity feed
      try {
        const titleR = await db.query('SELECT title FROM rp_items WHERE item_id=$1 AND user_id=$2', [newId||req.params.itemId, req.user.id]);
        await db.query(
          `INSERT INTO rp_actions(user_id,type,item_id,new_item_id,item_title,status,details)
           VALUES($1,'repost',$2,$3,$4,'success',$5)`,
          [req.user.id, req.params.itemId, newId||null, titleR.rows[0]?.title||null, JSON.stringify({edits:edits||[]})]
        );
      } catch {}
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══ MOBILE LISTER ═══

app.post('/api/vinted/photos/upload', auth, async (req, res) => {
  const session = await store.getSession(req.user.id);
  if (!session) return res.status(401).json({ error:'No session' });
  const { imageData, mimeType = 'image/jpeg' } = req.body;
  if (!imageData) return res.status(400).json({ error:'imageData required' });
  try {
    const buffer = Buffer.from(imageData, 'base64');
    const uuid = crypto.randomBytes(16).toString('hex');
    const domain = session.domain || 'www.vinted.co.uk';
    const form = new FormData();
    form.append('photo[type]', 'item');
    form.append('photo[temp_uuid]', uuid);
    form.append('photo[file]', new Blob([buffer], { type: mimeType }), 'photo.jpg');
    const resp = await fetch(`https://${domain}/api/v2/photos`, {
      method: 'POST',
      headers: { 'Cookie':session.cookies, 'X-CSRF-Token':session.csrf, 'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      body: form
    });
    if (!resp.ok) { const t = await resp.text(); return res.status(resp.status).json({ error:'Vinted photo upload failed', detail:t.slice(0,200) }); }
    const data = await resp.json();
    const photoId = data.photo?.id || data.id;
    if (!photoId) return res.status(500).json({ error:'No photo ID returned', data });
    res.json({ ok:true, photoId, tempUuid:uuid });
  } catch(e) { res.status(502).json({ error:e.message }); }
});

app.post('/api/ai/analyze', auth, async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error:'ANTHROPIC_API_KEY not configured' });
  const { imageData, mimeType = 'image/jpeg' } = req.body;
  if (!imageData) return res.status(400).json({ error:'imageData required' });
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'x-api-key':apiKey, 'anthropic-version':'2023-06-01' },
      body: JSON.stringify({
        model: 'claude-opus-4-6',
        max_tokens: 1024,
        messages: [{ role:'user', content: [
          { type:'image', source:{ type:'base64', media_type:mimeType, data:imageData } },
          { type:'text', text:'Analyze this item for a Vinted UK listing. Return ONLY valid JSON (no markdown, no extra text) with exactly these fields:\n{\n  "title": "concise title max 60 chars",\n  "description": "2-3 sentences about item, condition, notable details",\n  "suggested_price": 0,\n  "brand": "brand name or null",\n  "condition": "New with tags" | "New without tags" | "Very good" | "Good" | "Satisfactory",\n  "category_hint": "e.g. women tops, men shoes, kids dress, bags, accessories"\n}' }
        ]}]
      })
    });
    const data = await resp.json();
    const text = data.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return res.status(500).json({ error:'AI returned no JSON', raw:text.slice(0,200) });
    const parsed = JSON.parse(match[0]);
    res.json({ ok:true, ...parsed });
  } catch(e) { res.status(502).json({ error:e.message }); }
});

app.get('/api/vinted/catalogs', auth, async (req, res) => {
  const session = await store.getSession(req.user.id);
  if (!session) return res.status(401).json({ error:'No session' });
  try {
    const resp = await vintedFetch(session, '/api/v2/catalogs');
    const data = await resp.json();
    res.json(data);
  } catch(e) { res.status(502).json({ error:e.message }); }
});

app.get('/api/vinted/sizes', auth, async (req, res) => {
  const session = await store.getSession(req.user.id);
  if (!session) return res.status(401).json({ error:'No session' });
  const catalogId = req.query.catalog_id;
  try {
    const path = catalogId ? `/api/v2/catalog_sizes?catalog_ids[]=${catalogId}` : '/api/v2/catalog_sizes';
    const resp = await vintedFetch(session, path);
    const data = await resp.json();
    res.json(data);
  } catch(e) { res.status(502).json({ error:e.message }); }
});

app.get('/api/vinted/brands', auth, async (req, res) => {
  const session = await store.getSession(req.user.id);
  if (!session) return res.status(401).json({ error:'No session' });
  const q = req.query.q || '';
  try {
    const resp = await vintedFetch(session, `/api/v2/brands?q=${encodeURIComponent(q)}&per_page=20`);
    const data = await resp.json();
    res.json(data);
  } catch(e) { res.status(502).json({ error:e.message }); }
});

app.get('/api/vinted/item-statuses', auth, async (req, res) => {
  const session = await store.getSession(req.user.id);
  if (!session) return res.status(401).json({ error:'No session' });
  try {
    const resp = await vintedFetch(session, '/api/v2/item_statuses');
    const data = await resp.json();
    res.json(data);
  } catch(e) { res.status(502).json({ error:e.message }); }
});

app.get('/api/vinted/package-sizes', auth, async (req, res) => {
  const session = await store.getSession(req.user.id);
  if (!session) return res.status(401).json({ error:'No session' });
  try {
    const resp = await vintedFetch(session, '/api/v2/package_sizes');
    const data = await resp.json();
    res.json(data);
  } catch(e) { res.status(502).json({ error:e.message }); }
});

// ═══ SERVER-SIDE SCHEDULE EXECUTOR ═══
// Runs every 5 minutes — checks all users' schedules and executes due reposts.
// This is what makes 24/7 operation possible without the browser extension running.
async function checkAllSchedules() {
  if (!db.hasDb()) return;
  try {
    const now = new Date();
    const rows = (await db.query('SELECT * FROM rp_schedules WHERE active=true')).rows;
    console.log(`[RP-cron] Checking ${rows.length} active schedule(s) at ${now.toISOString()}`);
    for (const row of rows) {
      const userId = row.user_id;
      const items = row.item_ids || [];
      if (!items.length) continue;

      // Determine if schedule is due
      let isDue = false;
      if (row.date && row.slot) {
        // One-shot: date+slot model
        if (row.executed) continue;
        // Parse as UTC then adjust for user's timezone offset
        // tz_offset is from getTimezoneOffset(): positive = west of UTC, negative = east
        // e.g. BST (UTC+1) = -60. To convert user local time to UTC: add tz_offset minutes
        const fireAt = new Date(row.date + 'T' + row.slot + ':00Z');
        const tzOffset = row.tz_offset || 0;
        fireAt.setMinutes(fireAt.getMinutes() + tzOffset);
        console.log(`[RP-cron] Schedule ${row.id}: fireAt=${fireAt.toISOString()} (tz_offset=${tzOffset}), now=${now.toISOString()}, due=${fireAt <= now}`);
        if (isNaN(fireAt.getTime()) || fireAt > now) continue;
        isDue = true;
      } else {
        // Legacy recurring model
        if (!row.next_run) continue;
        const hour = now.getHours();
        if (hour < (row.start_hour || 9) || hour > (row.end_hour || 21)) continue;
        if (new Date(row.next_run) > now) continue;
        isDue = true;
      }
      if (!isDue) continue;

      // Get user session
      const session = await store.getSession(userId);
      if (!session) {
        console.log(`[RP-cron] Schedule ${row.id}: no session for user ${userId}, skipping`);
        continue;
      }

      // Quota check
      const user = await store.getUserById(userId);
      const planInfo = PLANS[(user && user.plan) || 'free'] || PLANS.free;
      if (planInfo.repostsPerMonth != null) {
        const usage = await getUserUsage(userId);
        if (usage.repostsThisMonth >= planInfo.repostsPerMonth) {
          console.log(`[RP-cron] Schedule ${row.id}: user ${userId} hit repost quota, skipping`);
          continue;
        }
      }

      console.log(`[RP-cron] Executing schedule ${row.id} for user ${userId} — ${items.length} items`);

      for (let j = 0; j < items.length; j++) {
        const itemId = items[j];
        try {
          // Fetch item from Vinted, fall back to backup
          let item = null;
          const getResp = await vintedFetch(session, `/api/v2/item_upload/items/${itemId}`);
          if (getResp.ok) {
            item = (await getResp.json()).item;
          }
          if (!item) {
            // Try backup
            const bk = await db.query(
              'SELECT raw_data FROM rp_item_backups WHERE user_id=$1 AND item_id=$2 ORDER BY backed_up_at DESC LIMIT 1',
              [userId, itemId]
            );
            if (bk.rows[0] && bk.rows[0].raw_data) {
              item = bk.rows[0].raw_data;
              if (!item.id) item.id = itemId;
              console.log(`[RP-cron] Recovered item ${itemId} from backup`);
            }
          }
          if (!item) {
            console.log(`[RP-cron] Item ${itemId} not found, no backup — skipping`);
            await logAction(userId, 'repost', { itemId, itemTitle: null, status: 'failed', details: { source: 'server-schedule', scheduleId: row.id, error: 'Item not found and no backup' } });
            continue;
          }

          // Re-upload photos
          const freshPhotos = await reuploadPhotos(session, item.photos || []);
          const draft = buildDraftPayload(item);
          draft.assigned_photos = freshPhotos;
          const uuid = draft.temp_uuid;

          // Create draft
          const createResp = await vintedFetch(session, '/api/v2/item_upload/drafts', {
            method: 'POST', body: { draft, feedback_id: null, parcel: null, upload_session_id: uuid }
          });
          if (!createResp.ok) {
            const err = await createResp.json().catch(() => ({}));
            console.log(`[RP-cron] Draft creation failed for ${itemId}:`, JSON.stringify(err));
            await logAction(userId, 'repost', { itemId, itemTitle: item.title, status: 'failed', details: { source: 'server-schedule', scheduleId: row.id, error: 'Draft creation failed' } });
            continue;
          }
          const newDraft = (await createResp.json()).draft;
          const newId = String(newDraft?.id || '');

          // Delete original — always try, even if initial GET failed
          await deleteVintedItem(session, itemId, 'RP-cron');

          // Refresh & complete
          await new Promise(r => setTimeout(r, 800 + Math.random() * 400));
          const refreshResp = await vintedFetch(session, `/api/v2/item_upload/items/${newId}`);
          const refreshedItem = refreshResp.ok ? (await refreshResp.json()).item : null;
          await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));
          const completionDraft = refreshedItem ? buildDraftPayload(refreshedItem) : { ...draft, id: parseInt(newId) };
          completionDraft.id = parseInt(newId);
          completionDraft.assigned_photos = freshPhotos; // Always use freshly uploaded photo IDs
          const completeResp = await vintedFetch(session, `/api/v2/item_upload/drafts/${newId}/completion`, {
            method: 'POST', body: { draft: completionDraft, feedback_id: null, parcel: null, push_up: false, upload_session_id: completionDraft.temp_uuid || uuid }
          });

          // Unhide the new listing
          if (completeResp.ok) {
            try { await vintedFetch(session, `/api/v2/items/${newId}/is_hidden`, { method:'PUT', body:{ is_hidden:false } }); } catch(_) {}
            console.log(`[RP-cron] Reposted ${itemId} → ${newId}`);
            await logAction(userId, 'repost', { itemId, newItemId: newId, itemTitle: item.title, status: 'success', details: { source: 'server-schedule', scheduleId: row.id } });
            // Update item in DB — transfer old to new ID
            if (db.hasDb()) {
              try {
                await db.query(`UPDATE rp_items SET item_id=$1, repost_count=repost_count+1, last_repost=NOW() WHERE item_id=$2 AND user_id=$3`, [newId, itemId, userId]);
              } catch (_) {}
            }
          } else {
            console.log(`[RP-cron] Publish failed for ${itemId} → ${newId}: ${completeResp.status}`);
            await logAction(userId, 'repost', { itemId, itemTitle: item.title, status: 'failed', details: { source: 'server-schedule', scheduleId: row.id, error: `Publish failed (${completeResp.status})` } });
          }

          // Stagger between items
          if (j < items.length - 1) {
            await new Promise(r => setTimeout(r, 60000 + Math.random() * 60000));
          }
        } catch (e) {
          console.error(`[RP-cron] Repost error for item ${itemId}:`, e.message);
          await logAction(userId, 'repost', { itemId, itemTitle: null, status: 'failed', details: { source: 'server-schedule', scheduleId: row.id, error: e.message } });
        }
      }

      // Mark schedule as executed / advance to next
      if (row.date && row.slot) {
        await db.query('UPDATE rp_schedules SET executed=true WHERE id=$1 AND user_id=$2', [row.id, userId]);
      } else {
        const next = new Date();
        next.setDate(next.getDate() + (row.freq || 1));
        next.setHours(row.hour_of_day || 12, Math.floor(Math.random() * 60), 0);
        await db.query('UPDATE rp_schedules SET last_run=NOW(), next_run=$1 WHERE id=$2 AND user_id=$3', [next.toISOString(), row.id, userId]);
      }
    }
  } catch (e) {
    console.error('[RP-cron] checkAllSchedules error:', e.message);
  }
}

// Helper: log action for server-side operations
async function logAction(userId, type, data) {
  if (!db.hasDb()) return;
  try {
    await db.query(
      `INSERT INTO rp_actions(user_id,type,item_id,new_item_id,item_title,status,details) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [userId, type, data.itemId || null, data.newItemId || null, data.itemTitle || null, data.status || 'success', JSON.stringify(data.details || {})]
    );
  } catch (e) { console.error('[RP-cron] logAction error:', e.message); }
}

// ═══ TELEGRAM BOT ═══
const initTelegram = require('./telegram');

// ═══ START ═══
(async () => {
  if (!db.hasDb()) loadData();
  await db.initSchema();
  await recoverPendingActivations();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[RelistPro] v3.0.0 on port ${PORT} | db:${db.hasDb()} | stripe:${!!stripe}`);

    // Server-side schedule executor — runs every 5 minutes, works even when browser is closed
    if (db.hasDb()) {
      setTimeout(checkAllSchedules, 10000); // Run once 10s after startup
      setInterval(checkAllSchedules, 5 * 60 * 1000);
      console.log('[RP-cron] Schedule executor started (every 5 min)');
    }

    // Start Telegram bot AFTER server is listening (webhook needs Express ready)
    try {
      initTelegram({ store, vintedFetch, verifyPassword, app, db });
    } catch (e) {
      console.error('[TG] Failed to start:', e.message);
    }
  });
})();
