const chats = new Map();
const loadedFromDb = new Set();

let _db = null;
let _store = null;
let _tableReady = null;
let _bot = null;

function init({ db, store, bot }) {
  _db = db;
  _store = store;
  _bot = bot;
  _tableReady = initTelegramTable();
}

function getChat(chatId) {
  if (!chats.has(chatId)) chats.set(chatId, { step: 'idle', accounts: [], activeIdx: -1 });
  return chats.get(chatId);
}

function activeAccount(c) {
  if (!c.accounts || !c.accounts.length) return null;
  if (c.activeIdx < 0 || c.activeIdx >= c.accounts.length) {
    c.activeIdx = 0;
  }
  return c.accounts[c.activeIdx];
}

function ensureMulti(c) {
  if (!c.accounts) c.accounts = [];
  if (c.userId && !c.accounts.length) {
    c.accounts.push({ userId: c.userId, token: c.token, username: c.username });
    c.activeIdx = 0;
    delete c.userId; delete c.token; delete c.username;
  }
  if (c.activeIdx == null) c.activeIdx = c.accounts.length ? 0 : -1;
}

async function saveChatState(chatId) {
  if (!_db || !_db.hasDb()) return;
  const c = chats.get(chatId);
  if (!c) return;
  if (!c.accounts?.length) return;
  await _tableReady;
  try {
    const accts = JSON.stringify(c.accounts || []);
    const photoRefs = c.photos?.length
      ? JSON.stringify(c.photos.map(p => ({ fileId: p.fileId, _mid: p._mid })))
      : null;
    await _db.query(
      `INSERT INTO rp_telegram_chats (chat_id, accounts, active_idx, listing, photos, wizard_idx, step, tz_offset, onboarding_done)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (chat_id) DO UPDATE SET
         accounts=$2, active_idx=$3, listing=$4, photos=$5,
         wizard_idx=$6, step=$7, tz_offset=COALESCE($8, rp_telegram_chats.tz_offset),
         onboarding_done=COALESCE($9, rp_telegram_chats.onboarding_done),
         updated_at=NOW()`,
      [
        String(chatId),
        accts,
        c.activeIdx ?? -1,
        c.listing ? JSON.stringify(c.listing) : null,
        photoRefs,
        c.wizardIdx ?? 0,
        c.step || 'idle',
        c.tz_offset ?? null,
        c.onboarding_done ?? null
      ]
    );
  } catch (e) {
    console.error('[TG] Save state error:', e.message);
    try { await saveChatAccounts(chatId, c.accounts || [], c.activeIdx ?? -1); } catch {}
  }
}

async function saveFailedListing(chatId, errorSummary) {
  if (!_db || !_db.hasDb()) return;
  const c = chats.get(chatId);
  if (!c || !c.listing) return;
  await _tableReady;
  try {
    const acct = activeAccount(c);
    const photoRefs = (c.photos || []).map(p => ({ fileId: p.fileId, _mid: p._mid })).filter(r => r.fileId);
    if (!photoRefs.length) return;
    await _db.query(
      `INSERT INTO rp_telegram_failed_listings
         (chat_id, listing, photo_refs, account_idx, account_name, error_summary)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        String(chatId),
        JSON.stringify(c.listing),
        JSON.stringify(photoRefs),
        c.activeIdx ?? 0,
        acct?.vintedName || acct?.username || null,
        (errorSummary || '').slice(0, 500),
      ]
    );
    await _db.query(
      `DELETE FROM rp_telegram_failed_listings
       WHERE id IN (
         SELECT id FROM rp_telegram_failed_listings
         WHERE chat_id=$1 ORDER BY created_at DESC OFFSET 5
       )`,
      [String(chatId)]
    );
  } catch (e) { console.error('[TG] saveFailedListing error:', e.message); }
}

async function saveChatAccounts(chatId, accounts, activeIdx) {
  if (!_db || !_db.hasDb()) return;
  await _tableReady;
  try {
    await _db.query(
      `INSERT INTO rp_telegram_chats (chat_id, accounts, active_idx)
       VALUES ($1, $2, $3)
       ON CONFLICT (chat_id) DO UPDATE SET accounts=$2, active_idx=$3, updated_at=NOW()`,
      [String(chatId), JSON.stringify(accounts), activeIdx]
    );
  } catch (e) { console.error('[TG] Save chat error:', e.message); }
}

async function loadChatState(chatId) {
  if (!_db || !_db.hasDb()) return null;
  await _tableReady;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await _db.query(
        'SELECT accounts, active_idx, listing, photos, wizard_idx, step, tz_offset, onboarding_done FROM rp_telegram_chats WHERE chat_id=$1',
        [String(chatId)]
      );
      if (r.rows[0]) {
        const row = r.rows[0];
        const parseJsonb = (val, fallback) => {
          if (!val) return fallback;
          if (typeof val === 'string') { try { return JSON.parse(val); } catch { return fallback; } }
          return val;
        };
        return {
          accounts: parseJsonb(row.accounts, []),
          activeIdx: row.active_idx,
          listing: parseJsonb(row.listing, null),
          photos: parseJsonb(row.photos, null),
          wizardIdx: row.wizard_idx ?? 0,
          step: row.step || 'idle',
          tz_offset: row.tz_offset ?? null,
          onboarding_done: !!row.onboarding_done
        };
      }
      return null;
    } catch (e) {
      console.error(`[TG] Load state error (attempt ${attempt + 1}):`, e.message);
      if (attempt === 0) await new Promise(r => setTimeout(r, 500));
    }
  }
  return null;
}

async function ensureLoaded(chatId) {
  const c = getChat(chatId);
  const needAccounts = !c.accounts?.length;
  const needListing = !loadedFromDb.has(chatId);
  if (!needAccounts && !needListing) return;

  let saved;
  try {
    saved = await loadChatState(chatId);
  } catch (e) {
    console.error(`[TG] ensureLoaded DB error for chat ${chatId}:`, e.message);
    return;
  }

  if (saved?.accounts?.length && !c.accounts.length) {
    const savedIdx = saved.activeIdx ?? 0;
    const keep = saved.accounts[savedIdx] || saved.accounts[0];
    c.accounts = [keep];
    c.activeIdx = 0;
    if (saved.accounts.length > 1) {
      saveChatState(chatId).catch(() => {});
    }
  }

  if (needAccounts && !c.accounts.length && _db && _db.hasDb()) {
    try {
      const userRows = await _db.query(
        'SELECT id, username, token FROM rp_users WHERE telegram_chat_id=$1',
        [String(chatId)]
      );
      if (userRows.rows.length) {
        const recovered = [];
        for (const row of userRows.rows) {
          const sess = await _store.getSession(row.id).catch(() => null);
          recovered.push({
            userId: row.id,
            token: row.token,
            username: row.username,
            vintedName: null,
            vintedDomain: sess?.domain || null,
            memberId: sess?.memberId || null,
          });
        }
        if (recovered.length) {
          c.accounts = recovered;
          c.activeIdx = 0;
          saveChatState(chatId).catch(() => {});
        }
      }
    } catch (e) {
      console.error(`[TG] rp_users fallback failed for chat ${chatId}:`, e.message);
    }
  }

  if (c.accounts?.length) {
    try { await hydrateVintedNames(c, chatId); } catch (_) {}
  }

  if (saved?.tz_offset != null && c.tz_offset == null) c.tz_offset = saved.tz_offset;
  if (saved?.onboarding_done && !c.onboarding_done) c.onboarding_done = true;

  if (needListing) {
    loadedFromDb.add(chatId);
    if (saved?.listing && !c.listing) {
      c.listing = saved.listing;
      c.wizardIdx = saved.wizardIdx ?? 0;
      c.step = saved.step || 'idle';
      const photoRefs = saved.photos || [];
      if (photoRefs.length && photoRefs[0].fileId && _bot) {
        c.photos = [];
        const os = require('os');
        const fs = require('fs');
        for (const ref of photoRefs) {
          try {
            const filePath = await _bot.downloadFile(ref.fileId, os.tmpdir());
            const buffer = fs.readFileSync(filePath);
            try { fs.unlinkSync(filePath); } catch (_) {}
            if (buffer.length) {
              c.photos.push({ base64: buffer.toString('base64'), fileId: ref.fileId, _mid: ref._mid });
            }
          } catch (e) {
            console.error(`[TG] Re-download failed for ${ref.fileId}: ${e.message}`);
          }
        }
      } else {
        c.photos = [];
      }
    }
  }
}

async function hydrateVintedNames(c, chatId) {
  if (!c?.accounts?.length) return;
  let changed = false;
  for (const acct of c.accounts) {
    if (acct.vintedName) continue;
    try {
      const session = await _store.getSession(acct.userId).catch(() => null);
      if (!session) continue;
      if (!acct.memberId && session.memberId) acct.memberId = session.memberId;
      if (!acct.vintedDomain && session.domain) acct.vintedDomain = session.domain;
      if (session.vintedName && session.vintedName !== acct.vintedName) {
        acct.vintedName = session.vintedName;
        changed = true;
      }
    } catch (_) {}
  }
  if (changed) {
    try { await saveChatAccounts(chatId, c.accounts, c.activeIdx ?? 0); } catch (_) {}
  }
}

async function initTelegramTable() {
  if (!_db || !_db.hasDb()) return;
  try {
    await _db.query(`
      CREATE TABLE IF NOT EXISTS rp_telegram_chats (
        chat_id TEXT PRIMARY KEY,
        accounts JSONB NOT NULL DEFAULT '[]',
        active_idx INTEGER DEFAULT 0,
        listing JSONB,
        photos JSONB,
        wizard_idx INTEGER DEFAULT 0,
        step TEXT DEFAULT 'idle',
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await _db.query(`ALTER TABLE rp_telegram_chats ADD COLUMN IF NOT EXISTS listing JSONB`);
    await _db.query(`ALTER TABLE rp_telegram_chats ADD COLUMN IF NOT EXISTS photos JSONB`);
    await _db.query(`ALTER TABLE rp_telegram_chats ADD COLUMN IF NOT EXISTS wizard_idx INTEGER DEFAULT 0`);
    await _db.query(`ALTER TABLE rp_telegram_chats ADD COLUMN IF NOT EXISTS step TEXT DEFAULT 'idle'`);
    await _db.query(`ALTER TABLE rp_telegram_chats ADD COLUMN IF NOT EXISTS tz_offset INTEGER`);
    await _db.query(`ALTER TABLE rp_telegram_chats ADD COLUMN IF NOT EXISTS onboarding_done BOOLEAN DEFAULT FALSE`);

    await _db.query(`
      CREATE TABLE IF NOT EXISTS rp_telegram_failed_listings (
        id            SERIAL PRIMARY KEY,
        chat_id       TEXT NOT NULL,
        listing       JSONB NOT NULL,
        photo_refs    JSONB NOT NULL,
        account_idx   INTEGER,
        account_name  TEXT,
        error_summary TEXT,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await _db.query(`CREATE INDEX IF NOT EXISTS rp_tg_failed_chat_created ON rp_telegram_failed_listings (chat_id, created_at DESC)`);
    console.log('[TG] Chat persistence table ready');
  } catch (e) { console.error('[TG] Table init error:', e.message); }
}

async function saveListingSnapshot(chatId, c) {
  if (!_db || !_db.hasDb()) return null;
  await _tableReady;
  try {
    const acct = activeAccount(c);
    const listing = {
      title: c.title, description: c.description, price: c.price,
      brand_id: c.brand_id, brand_title: c.brand_title,
      catalog_id: c.catalog_id, category_path: c.category_path,
      size_id: c.size_id, size_title: c.size_title,
      status_id: c.status_id, color1_id: c.color1_id, color2_id: c.color2_id,
      package_size_id: c.package_size_id,
      photo_count: (c.photos || []).length
    };
    const res = await _db.query(
      `INSERT INTO rp_listing_snapshots (chat_id, user_id, listing)
       VALUES ($1, $2, $3) RETURNING id`,
      [String(chatId), acct?.userId || null, JSON.stringify(listing)]
    );
    const snapId = res.rows[0]?.id;
    if (snapId && c.photos?.length) {
      for (let i = 0; i < c.photos.length; i++) {
        const buf = Buffer.isBuffer(c.photos[i].base64)
          ? c.photos[i].base64
          : Buffer.from(c.photos[i].base64, 'base64');
        await _db.query(
          `INSERT INTO rp_listing_snapshot_photos (snapshot_id, idx, data, mime)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [snapId, i, buf, c.photos[i].mime || 'image/jpeg']
        );
      }
    }
    // Keep only last 5 snapshots per chat
    await _db.query(
      `DELETE FROM rp_listing_snapshots WHERE chat_id=$1 AND id NOT IN (
        SELECT id FROM rp_listing_snapshots WHERE chat_id=$1 ORDER BY created_at DESC LIMIT 5
      )`, [String(chatId)]
    ).catch(() => {});
    return snapId;
  } catch (e) {
    console.error('[TG] saveListingSnapshot error:', e.message);
    return null;
  }
}

async function linkSnapshotToCommand(chatId, commandId) {
  if (!_db || !_db.hasDb()) return;
  await _tableReady;
  try {
    await _db.query(
      `UPDATE rp_listing_snapshots SET command_id=$1
       WHERE chat_id=$2 AND command_id IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [commandId, String(chatId)]
    );
  } catch (e) { console.error('[TG] linkSnapshot error:', e.message); }
}

async function loadSnapshotForCommand(commandId) {
  if (!_db || !_db.hasDb()) return null;
  await _tableReady;
  try {
    const snap = await _db.query(
      `SELECT id, listing FROM rp_listing_snapshots WHERE command_id=$1`, [commandId]
    );
    if (!snap.rows.length) return null;
    const row = snap.rows[0];
    const listing = typeof row.listing === 'string' ? JSON.parse(row.listing) : row.listing;
    const photoRows = await _db.query(
      `SELECT idx, data, mime FROM rp_listing_snapshot_photos WHERE snapshot_id=$1 ORDER BY idx`,
      [row.id]
    );
    const photos = photoRows.rows.map(r => ({
      base64: Buffer.isBuffer(r.data) ? r.data.toString('base64') : r.data,
      mime: r.mime || 'image/jpeg'
    }));
    return { listing, photos };
  } catch (e) {
    console.error('[TG] loadSnapshot error:', e.message);
    return null;
  }
}

module.exports = {
  init,
  getChat,
  activeAccount,
  ensureMulti,
  saveChatState,
  saveFailedListing,
  saveChatAccounts,
  loadChatState,
  ensureLoaded,
  loadedFromDb,
  saveListingSnapshot,
  linkSnapshotToCommand,
  loadSnapshotForCommand,
};
