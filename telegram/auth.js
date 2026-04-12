const { esc, browserHeaders } = require('./helpers');
const { getChat, activeAccount, ensureMulti, saveChatState, saveChatAccounts } = require('./state');

let bot, db, store, vintedFetch, verifyPassword, DISABLE_BACKEND_VINTED;

// Per-chat 30s cache of the /api/vinted-accounts list so menu renders
// don't re-query on every tap.
const _vintedAcctCache = new Map();

function init(ctx) {
  bot               = ctx.bot;
  db                = ctx.db;
  store             = ctx.store;
  vintedFetch       = ctx.vintedFetch;
  verifyPassword    = ctx.verifyPassword;
  DISABLE_BACKEND_VINTED = ctx.DISABLE_BACKEND_VINTED;
}

// ── Read-only session "refresh": re-derive CSRF only, never mutate cookies ──
// Used by /login, /status, and any non-post caller. Does NOT call
// /web/api/auth/refresh (that's performVintedRefresh below), so it can
// never invalidate the user's browser session.
async function refreshVintedSession(session, userId) {
  if (DISABLE_BACKEND_VINTED) return session;
  const domain = session.domain || 'www.vinted.co.uk';
  try {
    const pageResp = await fetch(`https://${domain}/`, {
      headers: {
        'Cookie': session.cookies,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    const html = await pageResp.text();
    const csrfMatch = html.match(/"CSRF_TOKEN\\?":\\?"([^"\\]+)\\?"/);
    if (csrfMatch) {
      session.csrf = csrfMatch[1];
      console.log(`[TG] Re-derived CSRF for user ${userId} (read-only, no cookie mutation)`);
    }
  } catch (e) {
    console.log('[TG] CSRF re-derive failed (using existing):', e.message);
  }
  return session;
}

// ── Real Vinted token refresh — rotates access_token_web + refresh_token_web ──
// Only called from the Telegram post path, and only AFTER a cheap probe
// confirms the current cookies are actually 401. The browser desync this
// used to cause is healed by the Chrome extension's reconcileCookies(),
// which reads the rotated tokens from /api/session/get on its next wake
// and writes them back into local chrome.cookies.
async function performVintedRefresh(session, userId) {
  if (DISABLE_BACKEND_VINTED) {
    return session;
  }
  const domain = session.domain || 'www.vinted.co.uk';
  const resp = await fetch(`https://${domain}/web/api/auth/refresh`, {
    method: 'POST',
    headers: {
      'Cookie': session.cookies,
      'X-CSRF-Token': session.csrf || '',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      ...browserHeaders(domain, '/'),
    },
  });
  if (!resp.ok) throw new Error(`refresh failed: ${resp.status}`);

  const setCookies = typeof resp.headers.getSetCookie === 'function'
    ? resp.headers.getSetCookie()
    : (resp.headers.raw?.()['set-cookie'] || []);
  if (!setCookies.length) throw new Error('refresh returned no Set-Cookie');

  const cookieMap = new Map();
  session.cookies.split('; ').forEach(c => {
    const [k, ...v] = c.split('=');
    if (k) cookieMap.set(k.trim(), v.join('='));
  });
  for (const sc of setCookies) {
    const first = sc.split(';')[0];
    const eq = first.indexOf('=');
    if (eq <= 0) continue;
    const k = first.slice(0, eq).trim();
    const v = first.slice(eq + 1).trim();
    if (k) cookieMap.set(k, v);
  }
  for (const k of ['access_token_web', 'refresh_token_web']) {
    if (!cookieMap.has(k)) throw new Error(`refresh missing ${k}`);
  }
  session.cookies = Array.from(cookieMap.entries()).map(([k, v]) => `${k}=${v}`).join('; ');

  await store.setSession(userId, {
    csrf: session.csrf,
    cookies: session.cookies,
    domain: session.domain,
    memberId: session.memberId,
  });
  console.log(`[TG] Rotated Vinted tokens for user ${userId} — extension will reconcile on next wake`);
  return session;
}

// Probe-then-refresh helper: returns a session that's known-good, or
// throws SESSION_EXPIRED if the refresh attempt also fails. Never called
// speculatively — only from the post path.
async function ensureFreshSession(session, userId) {
  if (DISABLE_BACKEND_VINTED) return session;
  try {
    const probe = await vintedFetch(session, '/api/v2/users/' + (session.memberId || 'self'));
    if (probe.ok) return session;
    if (probe.status !== 401) return session; // non-auth error, let caller handle
  } catch (e) {
    // network error — let the caller deal with it, no refresh
    return session;
  }
  console.log(`[TG] Probe returned 401 for user ${userId}, running performVintedRefresh`);
  try {
    return await performVintedRefresh(session, userId);
  } catch (e) {
    console.error(`[TG] performVintedRefresh failed for user ${userId}:`, e.message);
    const err = new Error('SESSION_EXPIRED');
    err.cause = e;
    throw err;
  }
}

// ── doLogin: validates credentials, stores session, clears old bindings ──
async function doLogin(chatId, username, password) {
  const c = getChat(chatId);
  ensureMulti(c);

  try {
    const user = await store.getUser(username);
    if (!user) {
      c.step = 'idle';
      return bot.sendMessage(chatId, `No RelistPro account found for "${username}". Double-check the spelling — usernames are the ones you picked when registering in the Chrome extension. If you haven't registered yet, do that first, then come back and /login.`);
    }

    let valid = false;
    const hash = user.password_hash || user.hash;
    if (hash && hash.includes(':')) valid = await verifyPassword(password, hash);
    if (!valid) {
      c.step = 'idle';
      return bot.sendMessage(chatId, 'Wrong password. Try /login again.');
    }

    const session = await store.getSession(user.id);
    if (!session) {
      c.step = 'idle';
      return bot.sendMessage(chatId, 'No Vinted session found.\n\nOpen Vinted in your Chrome browser, click the RelistPro extension and sync first. Then come back and /login again.');
    }

    // Vinted display name comes from rp_sessions.vinted_name, written by
    // the extension during sync from the user's own IP. No Railway->Vinted
    // probe here — that was the P1 datacenter-IP signal we killed.
    const vintedName = session.vintedName || null;

    // Clear any stale binding on the new user's row, then replace the
    // chat's account list with just this one. Matches the "one chat =
    // one RelistPro login" invariant (see ensureLoaded collapse).
    c.accounts = [{ userId: user.id, token: user.token, username: user.username, vintedName, vintedDomain: session.domain, memberId: session.memberId }];
    c.activeIdx = 0;
    c.step = 'idle';
    await saveChatState(chatId);
    // Store telegram chat_id on the user record for dashboard linking.
    // First clear any other user currently bound to this chat so the
    // ensureLoaded fallback doesn't resurrect the previous login.
    try {
      await db.query('UPDATE rp_users SET telegram_chat_id=NULL WHERE telegram_chat_id=$1 AND id<>$2', [String(chatId), user.id]);
      await db.query('UPDATE rp_users SET telegram_chat_id=$1,updated_at=NOW() WHERE id=$2', [String(chatId), user.id]);
    } catch(e) { /* non-critical */ }

    const vintedDisplay = vintedName || '_not detected yet — sync RelistPro from Chrome_';
    bot.sendMessage(chatId,
      `✅ *Logged in*\n\n` +
      `👤 RelistPro: *${esc(username)}*\n` +
      `🛍️ Vinted: *${esc(vintedDisplay)}* \\(${esc(session.domain)}\\)\n\n` +
      `📸 Send me photos of an item to list it\\!`,
      { parse_mode: 'MarkdownV2' });
  } catch (e) {
    console.error('[TG] Login error:', e.message);
    c.step = 'idle';
    bot.sendMessage(chatId, 'Login failed: ' + e.message);
  }
}

// ── fetchVintedAccounts: fetches linked Vinted accounts with plan/cap ──
async function fetchVintedAccounts(chatId) {
  const c = getChat(chatId);
  const acct = activeAccount(c);
  if (!acct) return { accounts: [], plan: 'free', cap: 1 };
  const cached = _vintedAcctCache.get(chatId);
  if (cached && (Date.now() - cached.at) < 30_000) return cached.data;
  if (!db || !db.hasDb()) {
    // JSON fallback: return whatever the single session looks like.
    const s = await store.getSession(acct.userId).catch(() => null);
    const data = {
      accounts: s ? [{ memberId: s.memberId, domain: s.domain, active: true, storedAt: s.storedAt, vintedName: acct.vintedName || null, cookiesFresh: true }] : [],
      plan: 'free', cap: 1,
    };
    _vintedAcctCache.set(chatId, { at: Date.now(), data });
    return data;
  }
  try {
    const r = await db.query(`
      SELECT s.member_id, s.domain, s.stored_at, s.vinted_name,
             (u.active_member_id = s.member_id) AS is_active,
             u.plan
        FROM rp_sessions s
        JOIN rp_users u ON u.id = s.user_id
       WHERE s.user_id = $1
       ORDER BY s.stored_at DESC`, [acct.userId]);
    const plan = r.rows[0]?.plan || 'free';
    const PLANS = { free: 1, starter: 3, pro: Infinity };
    const cap = PLANS[plan] ?? 1;
    const accounts = r.rows.map(row => ({
      memberId: row.member_id,
      domain: row.domain,
      active: !!row.is_active,
      storedAt: row.stored_at,
      vintedName: row.vinted_name || null,
      cookiesFresh: row.stored_at ? (Date.now() - new Date(row.stored_at).getTime() < 30 * 60 * 1000) : false,
    }));
    const data = { accounts, plan, cap };
    _vintedAcctCache.set(chatId, { at: Date.now(), data });
    return data;
  } catch (e) {
    console.log('[TG] fetchVintedAccounts error:', e.message);
    return { accounts: [], plan: 'free', cap: 1 };
  }
}

function invalidateVintedAcctCache(chatId) {
  _vintedAcctCache.delete(chatId);
}

// Returns the currently-active Vinted memberId for the given chat's RP
// user, or null if none are linked. Hits the cache; fresh reads happen
// via fetchVintedAccounts.
async function activeVintedMemberId(chatId) {
  const { accounts } = await fetchVintedAccounts(chatId);
  const active = accounts.find(a => a.active);
  return active?.memberId || accounts[0]?.memberId || null;
}

module.exports = {
  init,
  doLogin,
  refreshVintedSession,
  performVintedRefresh,
  ensureFreshSession,
  fetchVintedAccounts,
  invalidateVintedAcctCache,
  activeVintedMemberId,
  _vintedAcctCache,
};
