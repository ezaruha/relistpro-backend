const { CONDITIONS, COLORS, PACKAGE_SIZES } = require('./constants');
const { esc, clearErrorField, normalizeText } = require('./helpers');
const { getChat, activeAccount, ensureMulti, ensureLoaded, saveChatState, saveChatAccounts } = require('./state');
const { aiEdit, aiSyncCompanion } = require('./ai');

// ── Context (set once via init) ──
let bot, db, store, app;

// ── Lazy deps (set via setDeps to break circular requires) ──
let doLogin, fetchVintedAccounts, invalidateVintedAcctCache, refreshVintedSession;
let showSummary, enterEditStep;
let wizardNext, askWizardStep, proceedToReview, processPhotos;
let searchCategories, selectCategory;
let showSizePicker, selectSize, showPackageSizePicker, selectPackageSize;
let searchBrands, isHighRiskBrand, triggerAuthGate, resumeAfterAuthGate,
    getUnbrandedId, getProofChecklist, stripBrandFromText, lookupVintedBrand;
let createListing, isAdminAccount;
let vintedFetch, verifyPassword;

function setDeps(deps) {
  ({
    doLogin, fetchVintedAccounts, invalidateVintedAcctCache, refreshVintedSession,
    showSummary, enterEditStep,
    wizardNext, askWizardStep, proceedToReview, processPhotos,
    searchCategories, selectCategory,
    showSizePicker, selectSize, showPackageSizePicker, selectPackageSize,
    searchBrands, isHighRiskBrand, triggerAuthGate, resumeAfterAuthGate,
    getUnbrandedId, getProofChecklist, stripBrandFromText, lookupVintedBrand,
    createListing, isAdminAccount,
    vintedFetch, verifyPassword,
  } = deps);
}

// ──────────────────────────────────────────
// COMMANDS
// ──────────────────────────────────────────

// First-time setup text shown to un-logged-in users.
function sendSetupGuide(chatId) {
  return bot.sendMessage(chatId,
    `Welcome to *RelistPro Bot* \u{1F6CD}\uFE0F\n\n` +
    `List items on Vinted in seconds \u2014 just send photos\\!\n\n` +
    `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n` +
    `*Setup \\(one\\-time\\):*\n\n` +
    `1\uFE0F\u20E3 *Install the Chrome extension*\n` +
    `Download RelistPro from the Chrome Web Store and install it\n\n` +
    `2\uFE0F\u20E3 *Create your account*\n` +
    `Click the extension icon \u2192 Register with a username \\& password\n\n` +
    `3\uFE0F\u20E3 *Sync your Vinted session*\n` +
    `Log into vinted\\.co\\.uk in Chrome\n` +
    `Click the RelistPro extension \u2192 hit *Sync*\n` +
    `This shares your Vinted login cookies with the bot\n\n` +
    `4\uFE0F\u20E3 *Connect here*\n` +
    `Tap /login \u2192 enter your RelistPro username \\& password\n` +
    `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\n` +
    `*Once connected:*\n` +
    `\u{1F4F8} Send photos of your item\n` +
    `\u{1F916} AI generates title, description, price, brand\n` +
    `\u270F\uFE0F Review \\& edit anything you want\n` +
    `\u{1F680} Hit POST TO VINTED \u2014 done\\!\n\n` +
    `*Multiple Vinted accounts?*\n` +
    `/login with each account, then /switch between them\n\n` +
    `*Need help?* Tap /help anytime`,
    { parse_mode: 'MarkdownV2' }
  );
}

// One-tap main menu for logged-in users. Rendered on /start, /menu, and
// the no-arg /login so the user never needs to retype credentials.
async function showMainMenu(chatId) {
  const c = getChat(chatId);
  ensureMulti(c);
  const active = activeAccount(c);
  if (!active) return sendSetupGuide(chatId);

  // Fetch linked Vinted accounts for the active RelistPro user.
  const { accounts: vintedAccounts, plan, cap } = await fetchVintedAccounts(chatId);
  const activeVinted = vintedAccounts.find(a => a.active) || vintedAccounts[0];

  const rpName = esc(active.username);
  const vtName = activeVinted
    ? esc(activeVinted.vintedName || ('ID ' + activeVinted.memberId))
    : esc('_not linked_');
  const linkedLine = vintedAccounts.length > 1
    ? `\n${vintedAccounts.length} Vinted accounts linked`
    : '';

  const rows = [
    [{ text: '\u{1F4F8} Continue posting', callback_data: 'menu:continue' }],
  ];
  if (vintedAccounts.length > 1) {
    rows.push([{ text: '\u{1F504} Switch Vinted account', callback_data: 'menu:switch' }]);
  }
  rows.push([{ text: '\u{1F6CD}\uFE0F Manage Vinted accounts', callback_data: 'menu:vmanage' }]);
  rows.push([{ text: '\u{1F501} Switch RelistPro account', callback_data: 'menu:switchrp' }]);
  rows.push([{ text: '\u{1F44B} Log out RelistPro', callback_data: 'menu:logout' }]);
  rows.push([{ text: '\u{1F9F9} Clean up chat', callback_data: 'menu:clean' }]);

  return bot.sendMessage(chatId,
    `\u{1F44B} *Welcome back*\n\n` +
    `\u{1F464} RelistPro: *${rpName}*\n` +
    `\u{1F6CD}\uFE0F Vinted: *${vtName}*${linkedLine}\n\n` +
    `What do you want to do?`,
    { parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: rows } }
  );
}

// ── Inline login (called by /login handler and text handler) ──
async function _doLogin(chatId, username, password) {
  const c = getChat(chatId);
  ensureMulti(c);

  try {
    const user = await store.getUser(username);
    if (!user) {
      c.step = 'idle';
      return bot.sendMessage(chatId, `No RelistPro account found for "${username}". Double-check the spelling \u2014 usernames are the ones you picked when registering in the Chrome extension. If you haven't registered yet, do that first, then come back and /login.`);
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
    // the extension during sync from the user's own IP.
    const vintedName = session.vintedName || null;

    c.accounts = [{ userId: user.id, token: user.token, username: user.username, vintedName, vintedDomain: session.domain, memberId: session.memberId }];
    c.activeIdx = 0;
    c.step = 'idle';
    await saveChatState(chatId);
    // Store telegram chat_id on the user record for dashboard linking.
    try {
      await db.query('UPDATE rp_users SET telegram_chat_id=NULL WHERE telegram_chat_id=$1 AND id<>$2', [String(chatId), user.id]);
      await db.query('UPDATE rp_users SET telegram_chat_id=$1,updated_at=NOW() WHERE id=$2', [String(chatId), user.id]);
    } catch(e) { /* non-critical */ }

    const vintedDisplay = vintedName || '_not detected yet \u2014 sync RelistPro from Chrome_';
    bot.sendMessage(chatId,
      `\u2705 *Logged in*\n\n` +
      `\u{1F464} RelistPro: *${esc(username)}*\n` +
      `\u{1F6CD}\uFE0F Vinted: *${esc(vintedDisplay)}* \\(${esc(session.domain)}\\)\n\n` +
      `\u{1F4F8} Send me photos of an item to list it\\!`,
      { parse_mode: 'MarkdownV2' });
  } catch (e) {
    console.error('[TG] Login error:', e.message);
    c.step = 'idle';
    bot.sendMessage(chatId, 'Login failed: ' + e.message);
  }
}

// ──────────────────────────────────────────
// init — register all bot handlers
// ──────────────────────────────────────────

function init(ctx) {
  ({ bot, db, store, app } = ctx);

  // ── /start ──
  bot.onText(/\/start(?:@\S+)?/, async (msg) => {
    await ensureLoaded(msg.chat.id);
    const c = getChat(msg.chat.id);
    ensureMulti(c);
    if (activeAccount(c)) return showMainMenu(msg.chat.id);
    return sendSetupGuide(msg.chat.id);
  });

  // ── /menu ──
  bot.onText(/\/menu(?:@\S+)?/, async (msg) => {
    await ensureLoaded(msg.chat.id);
    return showMainMenu(msg.chat.id);
  });

  // ── /help ──
  bot.onText(/\/help(?:@\S+)?/, async (msg) => {
    await ensureLoaded(msg.chat.id);
    const c = getChat(msg.chat.id);
    ensureMulti(c);
    const connected = activeAccount(c);

    let text = `*RelistPro Bot \u2014 Commands*\n\n`;

    if (!connected) {
      text += `\u26A0\uFE0F *Not connected yet\\!*\n` +
        `Tap /login and I'll ask for your details\n\n`;
    } else {
      text += `\u2705 Connected as *${esc(connected.username)}*\n\n`;
    }

    text += `/login \u2014 connect a RelistPro account\n` +
      `/menu \u2014 switch Vinted account, manage, or clean up\n` +
      `/status \u2014 check connection \\& Vinted session\n` +
      `/ready \u2014 continue after fixing a failed step\n` +
      `/cancel \u2014 abort current listing\n` +
      `/logout \u2014 disconnect RelistPro from this chat\n\n` +
      `*To list an item:* just send photos\\!`;

    bot.sendMessage(msg.chat.id, text, { parse_mode: 'MarkdownV2' });
  });

  // ── /login ──
  bot.onText(/\/login(?:@\S+)?(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    await ensureLoaded(chatId);
    const c = getChat(chatId);
    ensureMulti(c);

    const args = (match[1] || '').trim().split(/\s+/).filter(Boolean);

    if (args.length >= 2) {
      // Inline login: /login username password
      return _doLogin(chatId, args[0], args[1]);
    }

    // Already connected? Show the one-tap menu instead.
    if (args.length === 0 && c.accounts?.length) {
      return showMainMenu(chatId);
    }

    // Conversational login — ask for username first
    c.step = 'login_username';
    bot.sendMessage(chatId, 'What\'s your RelistPro username?');
  });

  // ── /status ──
  bot.onText(/\/status(?:@\S+)?/, async (msg) => {
    await ensureLoaded(msg.chat.id);
    const c = getChat(msg.chat.id);
    ensureMulti(c);
    if (!c.accounts.length) return bot.sendMessage(msg.chat.id, 'Not connected yet.\n\nFollow these steps:\n1. Install RelistPro Chrome extension\n2. Register an account in the extension\n3. Log into vinted.co.uk \u2192 click extension \u2192 Sync\n4. Come back here and tap /login');

    const statusMsg = await bot.sendMessage(msg.chat.id, 'Checking connection...');

    const lines = [];
    for (let i = 0; i < c.accounts.length; i++) {
      const a = c.accounts[i];
      const session = await store.getSession(a.userId);
      const active = i === c.activeIdx ? ' [active]' : '';
      const header = `${i + 1}. \u{1F464} ${a.username} \u2192 \u{1F6CD}\uFE0F ${a.vintedName || 'not detected'}${active}`;

      if (!session) {
        lines.push(`${header}\n   \u274C No Vinted session \u2014 open Chrome \u2192 RelistPro extension \u2192 Sync`);
        continue;
      }

      // Test if session is actually alive by making a lightweight API call
      let sessionAlive = false;
      try {
        const testResp = await vintedFetch(session, '/api/v2/users/' + (session.memberId || 'self'));
        sessionAlive = testResp.ok;
        if (!sessionAlive && testResp.status === 401) {
          // Try refreshing
          try {
            await refreshVintedSession(session, a.userId);
            const retryResp = await vintedFetch(session, '/api/v2/users/' + (session.memberId || 'self'));
            sessionAlive = retryResp.ok;
          } catch {}
        }
      } catch {}

      if (sessionAlive) {
        lines.push(`${header}\n   \u2705 Vinted session active (${session.domain})`);
      } else {
        lines.push(`${header}\n   \u26A0\uFE0F Vinted session expired \u2014 open Chrome \u2192 RelistPro extension \u2192 Sync`);
      }
    }

    bot.editMessageText(`*Account Status*\n\n${lines.join('\n\n')}\n\n\u{1F4F8} Send photos to list an item`, {
      chat_id: msg.chat.id, message_id: statusMsg.message_id, parse_mode: 'Markdown'
    });
  });

  // ── /switch ──
  bot.onText(/\/switch(?:@\S+)?/, async (msg) => {
    const chatId = msg.chat.id;
    await ensureLoaded(chatId);
    const c = getChat(chatId);
    ensureMulti(c);
    if (!c.accounts.length) return bot.sendMessage(chatId, 'Not connected. Use /login first.');
    const { accounts: vintedAccounts } = await fetchVintedAccounts(chatId);
    if (vintedAccounts.length < 2) {
      return bot.sendMessage(chatId,
        "You've only linked one Vinted account.\n\n" +
        "To add another: log into a different Vinted account in Chrome with the RelistPro extension running. " +
        "It'll sync automatically."
      );
    }
    const rows = vintedAccounts.map(v => {
      const name = v.vintedName || ('ID ' + v.memberId);
      const staleTag = v.cookiesFresh ? '' : ' (stale)';
      return [{
        text: `${v.active ? '\u2705 ' : ''}${name}${staleTag}`.slice(0, 64),
        callback_data: `vswitch:${v.memberId}`,
      }];
    });
    rows.push([{ text: '\u2B05\uFE0F Back', callback_data: 'menu:back' }]);
    bot.sendMessage(chatId, 'Pick which Vinted account to post on:', { reply_markup: { inline_keyboard: rows } });
  });

  // ── /logout ──
  bot.onText(/\/logout(?:@\S+)?/, async (msg) => {
    const chatId = msg.chat.id;
    await ensureLoaded(chatId);
    const c = getChat(chatId);
    ensureMulti(c);
    if (!c.accounts.length) return bot.sendMessage(chatId, 'Not connected.');
    const removed = c.accounts[0];
    if (db && db.hasDb()) {
      try { await db.query('UPDATE rp_users SET telegram_chat_id=NULL WHERE id=$1', [removed.userId]); } catch (_) {}
    }
    c.accounts = [];
    c.activeIdx = -1;
    c.step = 'idle';
    await saveChatAccounts(chatId, c.accounts, c.activeIdx);
    invalidateVintedAcctCache(chatId);
    bot.sendMessage(chatId, `\u{1F44B} Logged out of ${removed.username}. Use /login to connect a different RelistPro account.`);
  });

  // ── /cancel ──
  bot.onText(/\/cancel(?:@\S+)?/, async (msg) => {
    await ensureLoaded(msg.chat.id);
    const c = getChat(msg.chat.id);
    c.step = 'idle';
    c.photos = [];
    c.listing = null;
    c.catalogCache = null;
    bot.sendMessage(msg.chat.id, 'Listing cancelled. Send new photos whenever you\'re ready.');
  });

  // ── /ready — "I'm done fixing this step, continue" ──
  bot.onText(/\/ready(?:@\S+)?/, async (msg) => {
    const chatId = msg.chat.id;
    await ensureLoaded(chatId);
    const c = getChat(chatId);
    ensureMulti(c);
    if (!c.listing) {
      return bot.sendMessage(chatId, 'Nothing to continue. Send photos to start a new listing.');
    }
    const L = c.listing;
    if (L._errorWalkthrough && Array.isArray(L._errorFields) &&
        L._errorFields.includes('photos') && c.photos?.length) {
      clearErrorField(c, 'photos');
    }
    c.step = 'review';
    c.summaryMsgId = null;
    saveChatState(chatId);
    return showSummary(chatId);
  });

  // ── /retry ──
  bot.onText(/^\/retry(?:@\S+)?$/i, async (msg) => {
    const chatId = msg.chat.id;
    await ensureLoaded(chatId);
    if (!db || !db.hasDb()) return bot.sendMessage(chatId, 'Database not available.');
    try {
      const r = await db.query(
        `SELECT id, listing, account_name, error_summary, created_at
         FROM rp_telegram_failed_listings
         WHERE chat_id=$1 ORDER BY created_at DESC LIMIT 5`,
        [String(chatId)]
      );
      if (!r.rows.length) return bot.sendMessage(chatId, 'No failed listings saved.');
      const rows = r.rows.map(row => {
        const L = typeof row.listing === 'string' ? JSON.parse(row.listing) : row.listing;
        const label = `${L.title || 'Untitled'} \u2014 \u00A3${L.price || '?'} (${row.account_name || 'acct'})`;
        return [{ text: label.slice(0, 60), callback_data: `retry:${row.id}` }];
      });
      return bot.sendMessage(chatId, '\u{1F501} Pick a failed listing to retry:', {
        reply_markup: { inline_keyboard: rows }
      });
    } catch (e) {
      console.error('[TG] /retry error:', e.message);
      return bot.sendMessage(chatId, 'Could not load failed listings.');
    }
  });

  // ──────────────────────────────────────────
  // CALLBACK QUERY HANDLER (inline buttons)
  // ──────────────────────────────────────────

  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    try {
    bot.answerCallbackQuery(query.id);
    await ensureLoaded(chatId);
    const c = getChat(chatId);

    // ── Command channel: cancel an in-flight post ──
    if (data.startsWith('cmd:cancel:')) {
      const cmdId = data.slice('cmd:cancel:'.length);
      const acct = activeAccount(c);
      if (!acct) return;
      let affected = 0;
      try {
        const r = await db.query(
          `UPDATE rp_commands
              SET status = 'cancelled', updated_at = NOW(), completed_at = NOW()
            WHERE id = $1 AND user_id = $2
              AND status IN ('queued','claimed','in_progress')
            RETURNING id`,
          [cmdId, acct.userId]
        );
        affected = r.rowCount || 0;
      } catch (e) {
        console.log('[TG] cmd:cancel error:', e.message);
      }
      bot.answerCallbackQuery(query.id, { text: affected ? 'Cancelled' : 'Already finished', show_alert: false }).catch(() => {});
      const tracking = (c._activeCommands && c._activeCommands[cmdId]) || {};
      const replyToMsgId = tracking.replyToMsgId;
      if (affected) {
        bot.sendMessage(chatId,
          '\u274C *Cancelled\\.* Your post has been stopped\\.\n\n' +
          '\u{1F4F8} Send new photos whenever you\'re ready to try again, or /menu for other options\\.',
          {
            parse_mode: 'MarkdownV2',
            reply_to_message_id: replyToMsgId || undefined,
            allow_sending_without_reply: true
          }
        ).catch(() => {});
      } else {
        bot.sendMessage(chatId,
          'That post is already done \u2014 nothing to cancel. \u{1F4F8} Send new photos to start the next one.'
        ).catch(() => {});
      }
      return;
    }

    // ── Command channel: retry a failed post ──
    if (data.startsWith('cmd:retry:')) {
      const cmdId = data.slice('cmd:retry:'.length);
      const acct = activeAccount(c);
      if (!acct) return;
      try {
        const r = await db.query(
          `SELECT payload FROM rp_commands WHERE id = $1 AND user_id = $2`,
          [cmdId, acct.userId]
        );
        if (!r.rows.length) return bot.sendMessage(chatId, 'That command is gone from the queue \u2014 send new photos to start fresh.');
        const payload = r.rows[0].payload || {};
        const draft = payload.draft || {};
        c.listing = {
          title: draft.title, description: draft.description,
          brand_id: draft.brand_id, brand: draft.brand,
          size_id: draft.size_id,
          catalog_id: draft.catalog_id, status_id: draft.status_id,
          price: draft.price,
          package_size_id: draft.package_size_id,
          color1_id: draft.color_ids?.[0] || null,
          color2_id: draft.color_ids?.[1] || null,
          isbn: draft.isbn || null,
          custom_parcel: draft.custom_parcel || null,
        };
        c.step = 'review';
        c.photos = []; // photos have to be re-sent
        saveChatState(chatId);
        await bot.sendMessage(chatId,
          '\u{1F501} Reloaded the listing details. Re-send your photos, then tap \u{1F680} POST TO VINTED to try again.');
        return showSummary(chatId);
      } catch (e) {
        console.log('[TG] cmd:retry error:', e.message);
        return;
      }
    }

    // ── Legacy sw: shim ──
    if (data.startsWith('sw:')) {
      return showMainMenu(chatId);
    }

    // ── Main menu actions (from showMainMenu) ──
    if (data === 'menu:continue') {
      return bot.sendMessage(chatId, '\u{1F4F8} Send photos of an item to start a listing.');
    }

    if (data === 'menu:switch') {
      const { accounts: vintedAccounts } = await fetchVintedAccounts(chatId);
      if (vintedAccounts.length < 2) {
        return bot.sendMessage(chatId,
          "You've only linked one Vinted account.\n\n" +
          "To add another: log into a different Vinted account in Chrome with the RelistPro extension running. " +
          "It'll sync automatically on the next extension poll."
        );
      }
      const rows = vintedAccounts.map(v => {
        const name = v.vintedName || ('ID ' + v.memberId);
        const staleTag = v.cookiesFresh ? '' : ' (stale)';
        return [{
          text: `${v.active ? '\u2705 ' : ''}${name}${staleTag}`.slice(0, 64),
          callback_data: `vswitch:${v.memberId}`,
        }];
      });
      rows.push([{ text: '\u2B05\uFE0F Back', callback_data: 'menu:back' }]);
      return bot.sendMessage(chatId, 'Pick which Vinted account to post on:',
        { reply_markup: { inline_keyboard: rows } });
    }

    if (data.startsWith('vswitch:')) {
      const memberId = data.slice('vswitch:'.length);
      const acct = activeAccount(c);
      if (!acct) return;
      try {
        const resp = await fetch(`http://localhost:${process.env.PORT || 3456}/api/vinted-accounts/${encodeURIComponent(memberId)}/activate`, {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + acct.token, 'Content-Type': 'application/json' },
        });
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({}));
          return bot.sendMessage(chatId, `\u274C Couldn't switch: ${body.error || resp.status}`);
        }
      } catch (e) {
        return bot.sendMessage(chatId, `\u274C Switch failed: ${e.message}`);
      }
      invalidateVintedAcctCache(chatId);
      return showMainMenu(chatId);
    }

    if (data === 'menu:vmanage') {
      const { accounts: vintedAccounts, plan, cap } = await fetchVintedAccounts(chatId);
      if (!vintedAccounts.length) {
        return bot.sendMessage(chatId,
          'No Vinted accounts linked yet.\n\n' +
          'Log into Vinted in Chrome with the RelistPro extension and it will sync automatically.'
        );
      }
      const capLabel = cap === Infinity || cap === null ? 'unlimited' : String(cap);
      const rows = vintedAccounts.map(v => {
        const name = v.vintedName || ('ID ' + v.memberId);
        return [{
          text: `${v.active ? '\u2705 ' : '\u26AA '}${name}`.slice(0, 64),
          callback_data: `vmanage:${v.memberId}`,
        }];
      });
      rows.push([{ text: '\u2B05\uFE0F Back', callback_data: 'menu:back' }]);
      return bot.sendMessage(chatId,
        `\u{1F6CD}\uFE0F *Linked Vinted accounts* (${vintedAccounts.length}/${esc(capLabel)} on *${esc(plan)}*)\n\n` +
        `Tap an account to activate it or remove it.\n` +
        `To add another: log into Vinted in Chrome \u2014 it syncs automatically.`,
        { parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: rows } }
      );
    }

    if (data.startsWith('vmanage:')) {
      const memberId = data.slice('vmanage:'.length);
      const { accounts: vintedAccounts } = await fetchVintedAccounts(chatId);
      const v = vintedAccounts.find(a => a.memberId === memberId);
      if (!v) return showMainMenu(chatId);
      const name = v.vintedName || ('ID ' + v.memberId);
      const rows = [];
      if (!v.active) rows.push([{ text: '\u2705 Set as active', callback_data: `vswitch:${memberId}` }]);
      rows.push([{ text: '\u{1F5D1}\uFE0F Remove', callback_data: `vremove:${memberId}` }]);
      rows.push([{ text: '\u2B05\uFE0F Back', callback_data: 'menu:vmanage' }]);
      return bot.sendMessage(chatId,
        `*${esc(name)}*\n_Member ID: ${esc(memberId)}_${v.active ? '\n\n\u2705 Currently active' : ''}`,
        { parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: rows } });
    }

    if (data.startsWith('vremove:')) {
      const memberId = data.slice('vremove:'.length);
      const acct = activeAccount(c);
      if (!acct) return;
      try {
        const resp = await fetch(`http://localhost:${process.env.PORT || 3456}/api/vinted-accounts/${encodeURIComponent(memberId)}`, {
          method: 'DELETE',
          headers: { 'Authorization': 'Bearer ' + acct.token },
        });
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({}));
          return bot.sendMessage(chatId, `\u274C Couldn't remove: ${body.error || resp.status}`);
        }
      } catch (e) {
        return bot.sendMessage(chatId, `\u274C Remove failed: ${e.message}`);
      }
      invalidateVintedAcctCache(chatId);
      await bot.sendMessage(chatId, '\u{1F5D1}\uFE0F Removed.');
      return showMainMenu(chatId);
    }

    if (data === 'menu:back') {
      return showMainMenu(chatId);
    }

    if (data === 'menu:logout') {
      ensureMulti(c);
      if (!c.accounts.length) {
        return sendSetupGuide(chatId);
      }
      const removed = c.accounts[0];
      if (db && db.hasDb()) {
        try { await db.query('UPDATE rp_users SET telegram_chat_id=NULL WHERE id=$1', [removed.userId]); } catch (_) {}
      }
      c.accounts = [];
      c.activeIdx = -1;
      c.step = 'idle';
      await saveChatAccounts(chatId, c.accounts, c.activeIdx);
      invalidateVintedAcctCache(chatId);
      await bot.sendMessage(chatId, `\u{1F44B} Logged out of *${esc(removed.username)}*\\.\n\nUse /login to connect a different RelistPro account\\.`,
        { parse_mode: 'MarkdownV2' });
      return sendSetupGuide(chatId);
    }

    if (data === 'menu:switchrp') {
      ensureMulti(c);
      if (c.accounts?.length && db && db.hasDb()) {
        try { await db.query('UPDATE rp_users SET telegram_chat_id=NULL WHERE id=$1', [c.accounts[0].userId]); } catch (_) {}
      }
      c.accounts = [];
      c.activeIdx = -1;
      c.step = 'login_username';
      await saveChatAccounts(chatId, c.accounts, c.activeIdx);
      invalidateVintedAcctCache(chatId);
      return bot.sendMessage(chatId,
        '\u{1F501} *Switching RelistPro account*\n\n' +
        'What\'s the username of the account you want to log into?',
        { parse_mode: 'Markdown' });
    }

    if (data === 'menu:clean') {
      const sent = (c._sentIds || []).slice();
      c._sentIds = [];
      let deleted = 0, skipped = 0;
      for (const mid of sent) {
        try {
          await bot.deleteMessage(chatId, mid);
          deleted++;
        } catch (_) {
          skipped++;
        }
      }
      c.listing = null;
      c.photos = [];
      c.wizardIdx = 0;
      c.step = 'idle';
      c.summaryMsgId = null;
      delete c._dupChecked; delete c._dupEdit; delete c._authChecked;
      delete c._authPrevStep; delete c._authGateBrandName;
      delete c._summaryEditOpen; delete c._justEdited;
      await saveChatState(chatId);

      const total = sent.length;
      const note = skipped > 0
        ? `\n\n\u2139\uFE0F Telegram doesn't let me delete messages older than 48 h or messages you sent yourself. Use Telegram's *Clear history* option for a fully clean chat.`
        : '';
      return bot.sendMessage(chatId,
        `\u{1F9F9} Cleaned up ${deleted}/${total} bot message(s) and reset the draft listing.\n\n` +
        `Your account(s) and your last 5 saved listings are still here \u2014 use /retry to see them.${note}`,
        { parse_mode: 'Markdown' }
      );
    }

    // ── Resume / New listing ──
    if (data === 'resume') {
      return askWizardStep(chatId);
    }
    if (data === 'newlisting') {
      c.step = 'collecting_photos';
      c.photos = [];
      c.listing = null;
      c.summaryMsgId = null;
      c.wizardIdx = 0;
      c.catalogCache = null;
      c.caption = null;
      saveChatState(chatId);
      bot.editMessageText('Previous listing discarded. Send photos for your new item.', { chat_id: chatId, message_id: query.message.message_id });
      return;
    }

    // ── Cancel ──
    if (data === 'cancel') {
      c.step = 'idle';
      c.photos = [];
      c.listing = null;
      c.summaryMsgId = null;
      c.wizardIdx = 0;
      saveChatState(chatId);
      return bot.editMessageText('Listing cancelled. Send new photos whenever you\'re ready.', { chat_id: chatId, message_id: query.message.message_id });
    }

    // ── Wizard accept (keep AI suggestion, move to next step) ──
    if (data === 'wiz:accept') {
      return wizardNext(chatId);
    }

    // ── Wizard edit (AI-assisted) ──
    if (data === 'wiz:edit:title') {
      c.step = 'wiz_edit_title';
      return bot.sendMessage(chatId, `Current title:\n"${c.listing.title}"\n\nWhat would you like to change? Describe in your own words (e.g. "make it shorter", "add Nike brand", "remove the size"):`);
    }
    if (data === 'wiz:edit:desc') {
      c.step = 'wiz_edit_desc';
      return bot.sendMessage(chatId, `Current description:\n"${c.listing.description}"\n\nWhat would you like to change? (e.g. "make it more casual", "add that it's never worn", "mention it's stretchy material"):`);
    }
    if (data === 'wiz:edit:price') {
      c.step = 'wiz_edit_price';
      return bot.sendMessage(chatId, `Current price: \u00A3${c.listing.price}\n\nWhat would you like to change? (e.g. "lower it", "make it \u00A315", "price it higher"):`);
    }

    // ── Expand / collapse the review keyboard ──
    if (data === 'edit:picker') {
      c._summaryEditOpen = true;
      c.summaryMsgId = null;
      saveChatState(chatId);
      return showSummary(chatId);
    }
    if (data === 'edit:done') {
      c._summaryEditOpen = false;
      c.summaryMsgId = null;
      saveChatState(chatId);
      return showSummary(chatId);
    }

    // ── Edit text fields (from final review) ──
    if (data === 'edit:title') {
      c.step = 'editing_title';
      return bot.sendMessage(chatId, `Current title: *${esc(c.listing.title)}*\n\nType the new title:`, { parse_mode: 'MarkdownV2' });
    }
    if (data === 'edit:desc') {
      c.step = 'editing_desc';
      return bot.sendMessage(chatId, 'Type the new description:');
    }
    if (data === 'edit:price') {
      c.step = 'editing_price';
      return bot.sendMessage(chatId, `Current price: \u00A3${c.listing.price}\n\nType the new price (number only):`);
    }
    if (data === 'edit:brand') {
      c.step = 'editing_brand';
      return bot.sendMessage(chatId, `Current brand: ${c.listing.brand || 'None'}\n\nType the brand name to search (or "none" to clear):`);
    }
    if (data === 'edit:photos') {
      return enterEditStep(chatId, 'photos');
    }

    // ── Pick condition ──
    if (data === 'pick:cond') {
      const keyboard = CONDITIONS.map(x => ([{
        text: `${x.emoji} ${x.label}`,
        callback_data: `cond:${x.id}`
      }]));
      return bot.sendMessage(chatId, 'Select condition:', { reply_markup: { inline_keyboard: keyboard } });
    }
    if (data.startsWith('cond:')) {
      const id = parseInt(data.split(':')[1]);
      const cond = CONDITIONS.find(x => x.id === id);
      if (cond) { c.listing.status_id = cond.id; c.listing.condition = cond.label; }
      clearErrorField(c, 'condition');
      if (c.step.startsWith('wiz_')) return wizardNext(chatId);
      c.step = 'review';
      c._justEdited = 'condition';
      return showSummary(chatId);
    }

    // ── Pick colour ──
    if (data === 'pick:color') {
      const rows = [];
      for (let i = 0; i < COLORS.length; i += 3) {
        rows.push(COLORS.slice(i, i + 3).map(x => ({
          text: x.label, callback_data: `color:${x.id}`
        })));
      }
      return bot.sendMessage(chatId, 'Select colour:', { reply_markup: { inline_keyboard: rows } });
    }
    if (data.startsWith('color:')) {
      const id = parseInt(data.split(':')[1]);
      const col = COLORS.find(x => x.id === id);
      if (col) { c.listing.color1_id = col.id; c.listing.color = col.label; console.log(`[TG] Color selected: ${col.label} (id=${col.id})`); }
      clearErrorField(c, 'color');
      if (c.step.startsWith('wiz_')) return wizardNext(chatId);
      c.step = 'review';
      c._justEdited = 'colour';
      return showSummary(chatId);
    }

    // ── Pick category ──
    if (data === 'pick:cat') {
      c.step = c.step.startsWith('wiz_') ? 'wiz_category' : 'searching_cat';
      return bot.sendMessage(chatId, 'Type a category name to search (e.g. "hoodie", "jeans", "stroller"):');
    }
    if (data === 'cat:search') {
      if (!c.step.startsWith('wiz_')) c.step = 'searching_cat';
      return bot.sendMessage(chatId, 'Type a category name to search (e.g. "t-shirt", "trainers", "dress"):');
    }
    if (data.startsWith('cat:')) {
      const id = parseInt(data.split(':')[1]);
      await selectCategory(chatId, id);
      if (c.step.startsWith('wiz_')) return wizardNext(chatId);
      c.step = 'review';
      c._justEdited = 'category';
      return showSummary(chatId);
    }

    // ── Pick size ──
    if (data === 'pick:size') {
      if (!c.listing.catalog_id) return bot.sendMessage(chatId, 'Pick a category first.');
      return showSizePicker(chatId);
    }
    if (data.startsWith('size:')) {
      const id = parseInt(data.split(':')[1]);
      return selectSize(chatId, id);
    }

    // ── Pick package size ──
    if (data === 'pick:pkg') {
      return showPackageSizePicker(chatId);
    }
    if (data === 'pkg:custom') {
      c.step = c.step.startsWith('wiz_') ? 'wiz_custom_parcel' : 'custom_parcel';
      return bot.sendMessage(chatId,
        '\u{1F4D0} Enter custom parcel dimensions:\n\n' +
        'Format: `weight length width height`\n' +
        'Example: `2 30 20 15` (2kg, 30\u00D720\u00D715 cm)\n\n' +
        'Or just type the weight in kg (e.g. `3`)',
        { parse_mode: 'Markdown' }
      );
    }
    if (data.startsWith('pkg:')) {
      const id = parseInt(data.split(':')[1]);
      return selectPackageSize(chatId, id);
    }

    // ── Sync accept/reject ──
    if (data === 'sync:accept') {
      let syncedLabel = null;
      if (c.step === 'confirm_desc_sync' && c.pendingSyncDesc) {
        c.listing.description = c.pendingSyncDesc;
        clearErrorField(c, 'description');
        syncedLabel = 'description';
      } else if (c.step === 'confirm_title_sync' && c.pendingSyncTitle) {
        c.listing.title = c.pendingSyncTitle;
        clearErrorField(c, 'title');
        syncedLabel = 'title';
      }
      delete c.pendingSyncDesc;
      delete c.pendingSyncTitle;
      c.step = 'review';
      c.summaryMsgId = null;
      if (syncedLabel) c._justEdited = syncedLabel;
      saveChatState(chatId);
      return showSummary(chatId);
    }
    if (data === 'sync:reject') {
      delete c.pendingSyncDesc;
      delete c.pendingSyncTitle;
      c.step = 'review';
      c.summaryMsgId = null;
      saveChatState(chatId);
      return showSummary(chatId);
    }

    // ── Brand: search again prompt ──
    if (data === 'brand:search') {
      c.step = c.step.startsWith('wiz_') ? 'wiz_brand' : 'editing_brand';
      return bot.sendMessage(chatId, 'Type a brand name to search:');
    }

    // ── Brand search results ──
    if (data.startsWith('brand:')) {
      const parts = data.split(':');
      const bid = parseInt(parts[1]);
      c.listing.brand_id = bid > 0 ? bid : null;
      const textName = parts.slice(2).join(':');
      if (textName) c.listing.brand = textName;
      else if (bid === 0) c.listing.brand = '';
      clearErrorField(c, 'brand');

      // Authenticity gate
      const effectiveName = textName || c.listing.brand || '';
      if (bid > 0 && !c._authChecked && isHighRiskBrand(effectiveName)) {
        c._authPrevStep = c.step;
        return triggerAuthGate(chatId, effectiveName);
      }

      if (c.step.startsWith('wiz_')) return wizardNext(chatId);
      c.step = 'review';
      c._justEdited = 'brand';
      return showSummary(chatId);
    }

    // ── Fast-path brand prompt: user tapped "Post as Unbranded" ──
    if (data === 'fast:unbranded') {
      if (c.step !== 'fast_brand_prompt') return;
      const acct = activeAccount(c);
      const session = acct ? await store.getSession(acct.userId).catch(() => null) : null;
      const ubId = session ? await getUnbrandedId(session).catch(() => null) : null;
      c.listing.brand = 'Unbranded';
      c.listing.brand_id = ubId || null;
      clearErrorField(c, 'brand');
      await bot.sendMessage(chatId, '\u{1F3F7}\uFE0F Brand set to Unbranded. Continuing...');
      return proceedToReview(chatId);
    }

    // ── Authenticity gate: user has proof photos ──
    if (data === 'auth:proof') {
      c.step = 'collecting_proof_photos';
      saveChatState(chatId);
      const checklist = getProofChecklist(c.listing?.category_name);
      const listText = checklist.map((s, i) => `${i + 1}. ${s}`).join('\n');
      const existing = c.photos?.length || 0;
      return bot.sendMessage(chatId,
        `\u{1F4F8} *Send authenticity photos now*\n\n` +
        `Take 3\u20134 close-up shots and send them here. You already have ${existing} product photo(s); these get added on top.\n\n` +
        `*What to shoot (in order):*\n${listText}\n\n` +
        `*Tips for photos Vinted will accept:*\n` +
        `\u2022 Good light \u2014 daylight near a window is best\n` +
        `\u2022 Hold the phone steady, tap to focus on the label\n` +
        `\u2022 Fill the frame with the label \u2014 no need to show the whole garment\n` +
        `\u2022 If text is blurry, take it again \u2014 OCR has to read it\n\n` +
        `When you're done, tap *Done*. If Vinted rejects the listing anyway, you can always add more photos and repost.`,
        { parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [
          [{ text: '\u2705 Done \u2014 continue listing', callback_data: 'auth:proofdone' }]
        ]}}
      );
    }

    if (data === 'auth:proofdone') {
      if (c.step === 'collecting_proof_photos') {
        await bot.sendMessage(chatId, `\u2705 Added ${c.photos?.length || 0} photo(s) total. Continuing...`);
      }
      return resumeAfterAuthGate(chatId);
    }

    // ── Authenticity gate: post as Unbranded ──
    if (data === 'auth:unbranded') {
      const originalBrand = c._authGateBrandName || c.listing.brand || '';
      try {
        const acct = activeAccount(c);
        const session = acct ? await store.getSession(acct.userId) : null;
        const ubId = session ? await getUnbrandedId(session) : null;
        c.listing.brand_id = ubId || null;
        c.listing.brand = 'Unbranded';
        console.log(`[TG] Auth gate \u2192 Unbranded (id=${ubId})`);
      } catch (e) {
        console.error('[TG] auth:unbranded error:', e.message);
        c.listing.brand_id = null;
        c.listing.brand = 'Unbranded';
      }

      const origTitle = c.listing.title || '';
      const origDesc = c.listing.description || '';
      const strippedTitle = stripBrandFromText(origTitle, originalBrand);
      const strippedDesc = stripBrandFromText(origDesc, originalBrand);
      const changedTitle = strippedTitle !== origTitle;
      const changedDesc = strippedDesc !== origDesc;

      if (!originalBrand || (!changedTitle && !changedDesc)) {
        await bot.sendMessage(chatId, '\u{1F3F7}\uFE0F Brand switched to *Unbranded*\\. Continuing\\.\\.\\.', { parse_mode: 'MarkdownV2' });
        return resumeAfterAuthGate(chatId);
      }

      if (changedTitle && strippedTitle.length < 3) {
        await bot.sendMessage(chatId,
          `\u{1F3F7}\uFE0F Brand switched to Unbranded. Title would be empty after removing "${originalBrand}", keeping it as-is. Continuing...`);
        return resumeAfterAuthGate(chatId);
      }

      c._authStripPreview = { originalBrand, strippedTitle, strippedDesc, changedTitle, changedDesc };

      const lines = [
        `\u{1F3F7}\uFE0F Brand switched to *Unbranded*.`,
        ``,
        `Vinted also scans titles and descriptions for brand words. Want me to strip "${originalBrand}" from them?`,
        ``,
      ];
      if (changedTitle) {
        lines.push(`*Title now:* ${origTitle}`);
        lines.push(`*Title after:* ${strippedTitle}`);
        lines.push(``);
      }
      if (changedDesc) {
        const d1 = origDesc.length > 120 ? origDesc.slice(0, 117) + '...' : origDesc;
        const d2 = strippedDesc.length > 120 ? strippedDesc.slice(0, 117) + '...' : strippedDesc;
        lines.push(`*Description now:* ${d1}`);
        lines.push(`*Description after:* ${d2}`);
      }

      return bot.sendMessage(chatId, lines.join('\n'), {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [
          [{ text: '\u2702\uFE0F Yes \u2014 strip brand word', callback_data: 'auth:strip:yes' }],
          [{ text: '\u{1F4DD} No \u2014 keep as-is', callback_data: 'auth:strip:no' }],
        ]}
      });
    }

    if (data === 'auth:strip:yes') {
      const p = c._authStripPreview;
      if (p) {
        if (p.changedTitle) c.listing.title = p.strippedTitle;
        if (p.changedDesc) c.listing.description = p.strippedDesc;
        console.log(`[TG] Auth gate strip applied: brand="${p.originalBrand}"`);
      }
      delete c._authStripPreview;
      await bot.sendMessage(chatId, '\u2702\uFE0F Brand word stripped. Continuing...');
      return resumeAfterAuthGate(chatId);
    }

    if (data === 'auth:strip:no') {
      delete c._authStripPreview;
      await bot.sendMessage(chatId, '\u{1F4DD} Keeping title and description as-is. Continuing...');
      return resumeAfterAuthGate(chatId);
    }

    // ── Authenticity gate: cancel the whole listing ──
    if (data === 'auth:cancel') {
      c.step = 'idle';
      c.photos = [];
      c.listing = null;
      c.summaryMsgId = null;
      c.catalogCache = null;
      delete c._authChecked;
      delete c._authPrevStep;
      delete c._authGateBrandName;
      delete c._authStripPreview;
      saveChatState(chatId);
      return bot.sendMessage(chatId, '\u274C Listing cancelled. Send new photos whenever you\'re ready.');
    }

    // ── Retry a saved failed listing ──
    if (data.startsWith('retry:')) {
      if (!db || !db.hasDb()) return bot.sendMessage(chatId, 'Database not available.');
      const rowId = parseInt(data.split(':')[1]);
      const r = await db.query(
        `SELECT listing, photo_refs, account_idx FROM rp_telegram_failed_listings WHERE id=$1 AND chat_id=$2`,
        [rowId, String(chatId)]
      );
      if (!r.rows.length) return bot.sendMessage(chatId, 'Retry entry not found (may have been cleared).');
      const row = r.rows[0];
      const parseJ = (v) => typeof v === 'string' ? JSON.parse(v) : v;
      const listing = parseJ(row.listing);
      const photoRefs = parseJ(row.photo_refs) || [];

      ensureMulti(c);
      if (row.account_idx != null && row.account_idx < c.accounts.length) {
        c.activeIdx = row.account_idx;
      }

      c.listing = listing;
      delete c.listing._failedDraftId;
      delete c.listing._errorFields;
      delete c._dupChecked;
      delete c._dupEdit;
      delete c._lastDraftId;
      delete c._retried;
      c.summaryMsgId = null;
      c.step = 'review';

      c.photos = [];
      const os = require('os');
      const fs = require('fs');
      const status = await bot.sendMessage(chatId, `\u{1F501} Re-downloading ${photoRefs.length} photo(s)...`);
      for (const ref of photoRefs) {
        try {
          const filePath = await bot.downloadFile(ref.fileId, os.tmpdir());
          const buffer = fs.readFileSync(filePath);
          try { fs.unlinkSync(filePath); } catch (_) {}
          if (buffer.length) c.photos.push({ base64: buffer.toString('base64'), fileId: ref.fileId, _mid: ref._mid });
        } catch (e) {
          console.error(`[TG] Retry download failed for ${ref.fileId}:`, e.message);
        }
      }
      if (!c.photos.length) {
        await bot.editMessageText(
          '\u274C Photos could not be re-downloaded from Telegram (fileIds may have expired). Please resend photos.',
          { chat_id: chatId, message_id: status.message_id }
        ).catch(() => {});
        return;
      }
      await bot.editMessageText(`\u2705 Restored ${c.photos.length} photo(s). Review and tap POST.`, {
        chat_id: chatId, message_id: status.message_id
      }).catch(() => {});
      saveChatState(chatId);
      return showSummary(chatId);
    }

    // ── POST ──
    if (data === 'post') {
      if (isAdminAccount(c) && !c._dupChecked) {
        c.step = 'confirm_dup';
        saveChatState(chatId);
        return bot.sendMessage(chatId,
          '\u{1F50D} Is this listing already posted on another account?\n\n' +
          'If yes, I will re-edit all photos (rotate/crop/colour tweaks) before posting, so Vinted won\'t flag them as duplicates.',
          { reply_markup: { inline_keyboard: [
            [{ text: '\u2705 Yes \u2014 edit photos first', callback_data: 'dup:yes' }],
            [{ text: '\u274C No \u2014 post as-is', callback_data: 'dup:no' }]
          ]}}
        );
      }
      return createListing(chatId);
    }

    // ── Duplicate prompt response (admin-only) ──
    if (data === 'dup:yes') {
      c._dupChecked = true;
      c._dupEdit = true;
      c.step = 'review';
      saveChatState(chatId);
      return createListing(chatId);
    }
    if (data === 'dup:no') {
      c._dupChecked = true;
      c._dupEdit = false;
      c.step = 'review';
      saveChatState(chatId);
      return createListing(chatId);
    }
    } catch (e) {
      console.error('[TG] Callback error:', e.message, e.stack);
      try { bot.sendMessage(chatId, 'Something went wrong. Try again or /cancel.'); } catch {}
    }
  });

  // ──────────────────────────────────────────
  // TEXT HANDLER (for field edits)
  // ──────────────────────────────────────────

  bot.on('message', async (msg) => {
    if (!msg.text || msg.photo) return; // skip photo messages
    const chatId = msg.chat.id;
    await ensureLoaded(chatId);
    const c = getChat(chatId);

    // Skip slash commands — they're handled by onText handlers
    if (msg.text.startsWith('/')) return;

    // ── Login flow ──
    if (c.step === 'login_username') {
      c.loginUsername = msg.text.trim();
      c.step = 'login_password';
      return bot.sendMessage(chatId, 'Got it. Now what\'s your password?');
    }

    if (c.step === 'login_password') {
      const password = msg.text.trim();
      const username = c.loginUsername;
      delete c.loginUsername;
      try { await bot.deleteMessage(chatId, msg.message_id); } catch {}
      return _doLogin(chatId, username, password);
    }

    // ── Wizard text inputs ──
    if (c.step === 'wiz_title') {
      c.listing.title = msg.text.slice(0, 60);
      return wizardNext(chatId);
    }

    if (c.step === 'wiz_description') {
      c.listing.description = msg.text;
      return wizardNext(chatId);
    }

    if (c.step === 'wiz_price') {
      const price = parseFloat(msg.text.replace(/[^0-9.]/g, ''));
      if (isNaN(price) || price <= 0) return bot.sendMessage(chatId, 'Enter a valid price (e.g. 25 or 14.50):');
      c.listing.price = Math.round(price * 100) / 100;
      return wizardNext(chatId);
    }

    // ── AI-assisted edits (user describes what to change) ──
    if (c.step === 'wiz_edit_title') {
      bot.sendMessage(chatId, '\u270F\uFE0F Updating title...');
      try {
        const result = await aiEdit('title', c.listing.title, msg.text);
        c.listing.title = result.slice(0, 60);
      } catch (e) {
        console.error('[TG] AI edit error:', e.message);
        c.listing.title = msg.text.slice(0, 60);
      }
      c.step = 'wiz_title';
      return askWizardStep(chatId);
    }

    if (c.step === 'wiz_edit_desc') {
      bot.sendMessage(chatId, '\u270F\uFE0F Updating description...');
      try {
        const result = await aiEdit('description', c.listing.description, msg.text);
        c.listing.description = result;
      } catch (e) {
        console.error('[TG] AI edit error:', e.message);
        c.listing.description = msg.text;
      }
      c.step = 'wiz_description';
      return askWizardStep(chatId);
    }

    if (c.step === 'wiz_edit_price') {
      const directPrice = parseFloat(msg.text.replace(/[^0-9.]/g, ''));
      if (!isNaN(directPrice) && directPrice > 0 && /^\s*[\u00A3$\u20AC]?\s*\d/.test(msg.text)) {
        c.listing.price = Math.round(directPrice * 100) / 100;
        c.step = 'wiz_price';
        return askWizardStep(chatId);
      }
      bot.sendMessage(chatId, '\u270F\uFE0F Adjusting price...');
      try {
        const result = await aiEdit('price', `\u00A3${c.listing.price}`, msg.text);
        const newPrice = parseFloat(result.replace(/[^0-9.]/g, ''));
        if (!isNaN(newPrice) && newPrice > 0) c.listing.price = Math.round(newPrice * 100) / 100;
      } catch (e) {
        console.error('[TG] AI edit error:', e.message);
      }
      c.step = 'wiz_price';
      return askWizardStep(chatId);
    }

    if (c.step === 'wiz_brand') {
      if (msg.text.toLowerCase() === 'none' || msg.text.toLowerCase() === 'skip') {
        c.listing.brand = '';
        c.listing.brand_id = null;
        return wizardNext(chatId);
      }
      return searchBrands(chatId, msg.text);
    }

    // ── Review edit inputs (from final summary) ──
    if (c.step === 'editing_title') {
      const newTitle = msg.text.slice(0, 60);
      c.listing.title = newTitle;
      clearErrorField(c, 'title');
      const syncMsg = await bot.sendMessage(chatId, '\u{1F504} Updating description to match...');
      try {
        const synced = await aiSyncCompanion('title', newTitle, 'description', c.listing.description || '', c.listing);
        if (synced && synced.length > 10) {
          c.pendingSyncDesc = synced;
          c.step = 'confirm_desc_sync';
          saveChatState(chatId);
          bot.deleteMessage(chatId, syncMsg.message_id).catch(() => {});
          return bot.sendMessage(chatId,
            `\u{1F4DD} Updated description:\n\n${synced}\n\nUse this update?`,
            { reply_markup: { inline_keyboard: [
              [{ text: '\u2705 Accept', callback_data: 'sync:accept' }, { text: '\u274C Keep old', callback_data: 'sync:reject' }]
            ]}}
          );
        }
      } catch (e) { console.log('[TG] sync desc failed:', e.message); }
      bot.deleteMessage(chatId, syncMsg.message_id).catch(() => {});
      c.step = 'review';
      c.summaryMsgId = null;
      c._justEdited = 'title';
      return showSummary(chatId);
    }

    if (c.step === 'editing_desc') {
      c.listing.description = msg.text;
      clearErrorField(c, 'description');
      const syncMsg = await bot.sendMessage(chatId, '\u{1F504} Updating title to match...');
      try {
        const synced = await aiSyncCompanion('description', msg.text, 'title', c.listing.title || '', c.listing);
        if (synced && synced.length > 3) {
          c.pendingSyncTitle = synced.slice(0, 60);
          c.step = 'confirm_title_sync';
          saveChatState(chatId);
          bot.deleteMessage(chatId, syncMsg.message_id).catch(() => {});
          return bot.sendMessage(chatId,
            `\u{1F4DD} Updated title:\n\n"${c.pendingSyncTitle}"\n\nUse this update?`,
            { reply_markup: { inline_keyboard: [
              [{ text: '\u2705 Accept', callback_data: 'sync:accept' }, { text: '\u274C Keep old', callback_data: 'sync:reject' }]
            ]}}
          );
        }
      } catch (e) { console.log('[TG] sync title failed:', e.message); }
      bot.deleteMessage(chatId, syncMsg.message_id).catch(() => {});
      c.step = 'review';
      c.summaryMsgId = null;
      c._justEdited = 'description';
      return showSummary(chatId);
    }

    if (c.step === 'editing_price') {
      const price = parseFloat(msg.text.replace(/[^0-9.]/g, ''));
      if (isNaN(price) || price <= 0) return bot.sendMessage(chatId, 'Enter a valid price (e.g. 25 or 14.50):');
      c.listing.price = Math.round(price * 100) / 100;
      clearErrorField(c, 'price');
      c.step = 'review';
      c._justEdited = 'price';
      return showSummary(chatId);
    }

    if (c.step === 'editing_isbn') {
      const raw = msg.text.trim();
      if (/^(none|skip|no)$/i.test(raw)) {
        c.listing.isbn = null;
        clearErrorField(c, 'isbn');
        c.step = 'review';
        c._justEdited = 'ISBN';
        await bot.sendMessage(chatId, 'OK, ISBN cleared. If the category is Books you may still need to fix that.');
        return showSummary(chatId);
      }
      const digits = raw.replace(/[^0-9Xx]/g, '');
      if (digits.length !== 10 && digits.length !== 13) {
        return bot.sendMessage(chatId, 'ISBN must be 10 or 13 digits (dashes OK). Try again, or type "none" to clear:');
      }
      c.listing.isbn = digits;
      clearErrorField(c, 'isbn');
      c.step = 'review';
      c._justEdited = 'ISBN';
      return showSummary(chatId);
    }

    if (c.step === 'editing_brand') {
      if (msg.text.toLowerCase() === 'none') {
        c.listing.brand = '';
        c.listing.brand_id = null;
        c.step = 'review';
        c._justEdited = 'brand';
        return showSummary(chatId);
      }
      return searchBrands(chatId, msg.text);
    }

    // ── Fast-path brand prompt (AI couldn't detect a brand) ──
    if (c.step === 'fast_brand_prompt') {
      const raw = (msg.text || '').trim();
      if (!raw) return bot.sendMessage(chatId, 'Type a brand name, or tap "Post as Unbranded".');
      if (/^(none|skip|unbranded|no)$/i.test(raw)) {
        const acct = activeAccount(c);
        const session = acct ? await store.getSession(acct.userId).catch(() => null) : null;
        const ubId = session ? await getUnbrandedId(session).catch(() => null) : null;
        c.listing.brand = 'Unbranded';
        c.listing.brand_id = ubId || null;
        clearErrorField(c, 'brand');
        await bot.sendMessage(chatId, '\u{1F3F7}\uFE0F Brand set to Unbranded. Continuing...');
        return proceedToReview(chatId);
      }
      const acct = activeAccount(c);
      const session = acct ? await store.getSession(acct.userId).catch(() => null) : null;
      if (!session) {
        c.listing.brand = normalizeText(raw, 'title');
        c.listing.brand_id = null;
        await bot.sendMessage(chatId, `\u{1F3F7}\uFE0F Brand set to "${c.listing.brand}". Continuing...`);
        return proceedToReview(chatId);
      }
      const lookingMsg = await bot.sendMessage(chatId, `\u{1F50E} Looking up "${raw}" in Vinted's catalogue...`);
      const b = await lookupVintedBrand(session, raw);
      bot.deleteMessage(chatId, lookingMsg.message_id).catch(() => {});
      if (b && b.score >= 60) {
        c.listing.brand = b.title;
        c.listing.brand_id = b.id;
        clearErrorField(c, 'brand');
        await bot.sendMessage(chatId, `\u2705 Matched: *${b.title}*`, { parse_mode: 'Markdown' });
      } else {
        c.listing.brand = normalizeText(raw, 'title');
        c.listing.brand_id = null;
        clearErrorField(c, 'brand');
        if (b) {
          await bot.sendMessage(chatId,
            `\u2139\uFE0F Closest Vinted brand was "${b.title}" which doesn't look like what you typed. Posting "${c.listing.brand}" as plain text instead \u2014 Vinted will add it to their catalogue on your first listing with this brand.`);
        } else {
          await bot.sendMessage(chatId,
            `\u2139\uFE0F "${c.listing.brand}" isn't in Vinted's catalogue. I'll post it as plain text \u2014 Vinted will add it to their catalogue on your first listing with this brand.`);
        }
      }
      return proceedToReview(chatId);
    }

    if (c.step === 'searching_cat' || c.step === 'wiz_category') {
      return searchCategories(chatId, msg.text);
    }

    if (c.step === 'wiz_custom_parcel' || c.step === 'custom_parcel') {
      const parts = msg.text.trim().split(/[\s,x\u00D7]+/).map(Number).filter(n => !isNaN(n) && n > 0);
      if (!parts.length) return bot.sendMessage(chatId, 'Enter at least a weight in kg (e.g. "2") or full dimensions "2 30 20 15"');
      c.listing.custom_parcel = {
        weight: parts[0],
        length: parts[1] || null,
        width: parts[2] || null,
        height: parts[3] || null,
      };
      const w = parts[0];
      let bestPkg = null;
      if (w <= 2) bestPkg = 1;
      else if (w <= 5) bestPkg = 2;
      else bestPkg = 3;
      c.listing.package_size_id = bestPkg;
      const pkg = PACKAGE_SIZES.find(p => p.id === bestPkg);
      c.listing.package_size_name = pkg ? `${pkg.title} (custom: ${w}kg)` : `Custom: ${w}kg`;
      const dimStr = parts.length >= 4 ? ` ${parts[1]}\u00D7${parts[2]}\u00D7${parts[3]}cm` : '';
      bot.sendMessage(chatId, `\u{1F4E6} Custom parcel: ${w}kg${dimStr} \u2192 mapped to "${pkg?.title || 'Size ' + bestPkg}"`);
      if (c.step === 'wiz_custom_parcel') return wizardNext(chatId);
      c.step = 'review';
      return showSummary(chatId);
    }

    // ── Catch-all: guide the user on what to do next ──
    if (c.step === 'idle') {
      ensureMulti(c);
      if (!activeAccount(c)) {
        return bot.sendMessage(chatId,
          'To get started:\n' +
          '1. Install RelistPro Chrome extension\n' +
          '2. Register an account in the extension\n' +
          '3. Log into vinted.co.uk \u2192 click extension \u2192 Sync\n' +
          '4. Come back here \u2192 /login with your username & password\n\n' +
          'Once logged in, send photos of an item to create a listing.');
      }
      const acctName = activeAccount(c)?.vintedName || activeAccount(c)?.username || 'Vinted';
      return bot.sendMessage(chatId, `\u{1F4F8} Send me photos of an item to list on ${acctName}!\n\nYou can also add a caption with details like "Nike hoodie size M \u00A325".`);
    }

    if (c.step === 'review') {
      return bot.sendMessage(chatId, 'You have a listing ready for review. Use the buttons above to edit or post it, or /cancel to start over.');
    }

    if (c.step === 'analyzing') {
      return bot.sendMessage(chatId, 'Still analyzing your photos \u2014 please wait a moment...');
    }

    if (c.step === 'posting') {
      return bot.sendMessage(chatId, 'Your item is being posted to Vinted \u2014 please wait...');
    }

    if (c.step === 'collecting_photos') {
      return bot.sendMessage(chatId, '\u{1F4F8} Send more photos, or wait a moment \u2014 I\'ll start analyzing once you\'re done.');
    }

    if (c.step === 'collecting_photos_for_review') {
      return bot.sendMessage(chatId, '\u{1F4F8} Send photos for your listing. Once done, I\'ll take you back to the summary.');
    }

    if (c.step === 'collecting_proof_photos') {
      return bot.sendMessage(chatId, '\u{1F4F8} Send authenticity proof photos, then tap Done.');
    }
  });
}

module.exports = {
  sendSetupGuide,
  showMainMenu,
  init,
  setDeps,
};
