/**
 * posting.js — Listing creation, command ticker, extension status.
 *
 * Owns the "POST to Vinted" pipeline: validate listing ➜ photo re-edit
 * (dup-defeat) ➜ enqueue rp_commands row ➜ poll progress ➜ render result.
 */

const { escMd2, fmtDur, estimatePostEta, titleWithSize, normalizeText } = require('./helpers');
const { getChat, activeAccount, ensureMulti, saveChatState, saveFailedListing, linkSnapshotToCommand } = require('./state');
const { ADMIN_VINTED_USERNAMES } = require('./constants');
const { processPhotoForReupload, hasSharp } = require('./photo-edit');

// ── Injected via init() ──
let bot, db, store;

// ── Lazy deps (circular-safe) ──
let _showSummary;

function setDeps({ showSummary }) {
  if (showSummary) _showSummary = showSummary;
}

function showSummary(chatId) {
  if (!_showSummary) throw new Error('posting.js: showSummary not wired via setDeps');
  return _showSummary(chatId);
}

function init(ctx) {
  bot = ctx.bot;
  db = ctx.db;
  store = ctx.store;
}

// ─── Vinted account resolution ──────────────────────────────────────

const _vintedAcctCache = new Map();

async function fetchVintedAccounts(chatId) {
  const c = getChat(chatId);
  const acct = activeAccount(c);
  if (!acct) return { accounts: [], plan: 'free', cap: 1 };
  const cached = _vintedAcctCache.get(chatId);
  if (cached && (Date.now() - cached.at) < 30_000) return cached.data;
  if (!db || !db.hasDb()) {
    const s = await store.getSession(acct.userId).catch(() => null);
    const data = {
      accounts: s ? [{
        memberId: s.memberId, domain: s.domain, active: true,
        storedAt: s.storedAt, vintedName: acct.vintedName || null, cookiesFresh: true,
      }] : [],
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
    const PLANS = { free: 3, starter: 3, pro: Infinity };
    const cap = PLANS[plan] ?? 3;
    const accounts = r.rows.map(row => ({
      memberId: row.member_id,
      domain: row.domain,
      active: !!row.is_active,
      storedAt: row.stored_at,
      vintedName: row.vinted_name || null,
      cookiesFresh: row.stored_at
        ? (Date.now() - new Date(row.stored_at).getTime() < 4 * 60 * 60 * 1000) : false,
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

async function activeVintedMemberId(chatId) {
  const { accounts } = await fetchVintedAccounts(chatId);
  const active = accounts.find(a => a.active);
  return active?.memberId || accounts[0]?.memberId || null;
}

// ─── Extension status ───────────────────────────────────────────────

const _extStatusCache = new Map(); // userId -> { at, data }

async function getExtensionStatus(userId) {
  if (!db || !db.hasDb() || !userId) return { alive: false, sessions: [] };
  const cached = _extStatusCache.get(userId);
  if (cached && Date.now() - cached.at < 60 * 1000) return cached.data;
  try {
    const u = await db.query(
      'SELECT last_extension_poll_at FROM rp_users WHERE id=$1',
      [userId]
    );
    const last = u.rows[0]?.last_extension_poll_at;
    const lastMs = last ? Date.parse(last) : 0;
    const alive = lastMs ? (Date.now() - lastMs < 5 * 60 * 1000) : false;
    const s = await db.query(
      'SELECT member_id, domain, stored_at FROM rp_sessions WHERE user_id=$1',
      [userId]
    );
    const sessions = s.rows.map(r => ({
      memberId: r.member_id,
      domain: r.domain,
      cookiesFresh: r.stored_at ? (Date.now() - Date.parse(r.stored_at) < 4 * 60 * 60 * 1000) : false,
    }));
    const data = { alive, lastPollMsAgo: lastMs ? Date.now() - lastMs : null, sessions };
    _extStatusCache.set(userId, { at: Date.now(), data });
    return data;
  } catch (e) {
    console.log('[TG] getExtensionStatus error:', e.message);
    return { alive: false, sessions: [] };
  }
}

// ─── Admin check ────────────────────────────────────────────────────

function isAdminAccount(c) {
  const acct = activeAccount(c);
  if (!acct) return false;
  const names = [acct.vintedName, acct.username].filter(Boolean).map(s => String(s).toLowerCase());
  return names.some(n => ADMIN_VINTED_USERNAMES.includes(n));
}

// ─── Progress rendering ─────────────────────────────────────────────

function renderProgress({ stage_label, eta_ms, stuckInQueue, elapsed_ms }) {
  const elapsed = fmtDur(elapsed_ms || 0);
  const overrun = !stuckInQueue && (eta_ms || 0) <= 0 && (elapsed_ms || 0) > 30000;
  const timerLine = overrun
    ? `⏱ ${escMd2(elapsed)} elapsed · finishing up`
    : `⏱ ${escMd2(elapsed)} elapsed · \\~${escMd2(fmtDur(eta_ms || 0))} remaining`;
  const subtitle = stuckInQueue
    ? '_⏳ Waiting for Chrome to pick this up\\. Open a Vinted tab if your browser is asleep\\._'
    : overrun
      ? '_🕐 Posts take 2\\-4 min to look natural to Vinted\\._'
      : '_💡 Send more photos now to queue another listing\\._';
  return (
    `📤 *Posting to Vinted*\n\n` +
    `${escMd2(stage_label || 'Running in your browser')}\n` +
    `${timerLine}\n\n` +
    subtitle
  );
}

function renderFinal(cmd, elapsedMs) {
  const dur = fmtDur(elapsedMs || 0);
  if (cmd.status === 'completed') {
    const title = cmd.result?.title || cmd.result?.new_item_id || 'listing';
    return `✅ *Posted in ${escMd2(dur)}*\n\n${escMd2(title)}`;
  }
  if (cmd.status === 'cancelled') {
    return `❌ *Cancelled after ${escMd2(dur)}*\n\n📸 _Send new photos when you're ready to try again\\._`;
  }
  const err = cmd.result?.error || 'unknown error';
  return `❌ *Post failed after ${escMd2(dur)}*\n\n${escMd2(err)}\n\n🔁 _Tap Retry below, or send new photos to start fresh\\._`;
}

// ─── Main posting handler ───────────────────────────────────────────

async function createListing(chatId, scheduledAt) {
  const c = getChat(chatId);
  ensureMulti(c);
  const L = c.listing;
  const acct = activeAccount(c);

  if (!L) {
    c.step = 'idle';
    return bot.sendMessage(chatId, 'No listing data found. Send photos to start a new listing.');
  }
  if (!L.catalog_id || !L.status_id) {
    c.step = 'review';
    return showSummary(chatId);
  }
  if (!acct) {
    c.step = 'idle';
    return bot.sendMessage(chatId, 'Not connected. Use /login first, then send photos.');
  }
  if (!c.photos || !c.photos.length) {
    c.step = 'review';
    return bot.sendMessage(chatId,
      '📸 No photos attached. Send your photos for this listing first, then tap 🚀 POST TO VINTED again.',
      { reply_markup: { inline_keyboard: [
        [{ text: '❌ Cancel listing', callback_data: 'cancel' }]
      ]}}
    );
  }

  // The safe post path requires Postgres (rp_commands + rp_command_photos)
  // so the extension can pick up the job and post from the user's real
  // browser. Without DB we'd have to route through the legacy inline path
  // which posts from the Railway datacenter IP — the exact pattern that
  // got the previous account permabanned for "fraudulent purposes".
  // Refuse to post rather than silently re-enable that vector.
  if (!db || !db.hasDb()) {
    console.error('[TG] createListing BLOCKED for chat ' + chatId + ': DATABASE_URL is not set — refusing to post via Railway-side fallback to protect the Vinted account from the ban vector that hit tonyfrancoz.');
    c.step = 'review'; saveChatState(chatId);
    return bot.sendMessage(chatId,
      '🛑 *Posting is disabled*\n\n' +
      'The safe post path (through your Chrome extension) needs Postgres to queue commands, and this backend is running without `DATABASE_URL`.\n\n' +
      '⚠️ *Why I refuse to fall back:* the legacy path posts directly from the Railway server IP. That is the exact pattern that got the previous account permabanned for "fraudulent purposes". I will not route through it silently.\n\n' +
      'Fix: set `DATABASE_URL` on the Railway backend so the extension command-channel is active, then tap POST again.',
      { parse_mode: 'Markdown' }
    );
  }

  // Daily limit check (25 posts/day)
  try {
    const today = await db.query(
      `SELECT COUNT(*) FROM rp_commands
       WHERE user_id=$1 AND type='post_new' AND status IN ('queued','claimed','in_progress','completed')
       AND created_at > NOW() - INTERVAL '24 hours'`,
      [acct.userId]
    );
    if (parseInt(today.rows[0].count) >= 25) {
      c.step = 'review';
      return bot.sendMessage(chatId,
        '⚠️ Daily limit reached (25 posts). Try again tomorrow to keep your account safe.');
    }
  } catch (_) {}

  // Sort photos by Telegram message_id and drop failed downloads
  c.photos = c.photos.filter(p => p && p.base64).sort((a, b) => (a._mid || 0) - (b._mid || 0));

  // ── Mandatory photo re-editing when user opted in to duplicate defeat ──
  if (c._dupEdit) {
    if (!hasSharp()) {
      c.step = 'review'; saveChatState(chatId);
      return bot.sendMessage(chatId,
        '❌ Photo re-editing is unavailable on this server (sharp module missing). Cannot safely post duplicates.');
    }
    const prep = await bot.sendMessage(chatId, `🎨 Re-editing ${c.photos.length} photo(s) to avoid duplicate detection...`);
    const edited = [];
    for (let i = 0; i < c.photos.length; i++) {
      try {
        const b64 = await processPhotoForReupload(c.photos[i].base64);
        edited.push({ ...c.photos[i], base64: b64 });
      } catch (e) {
        c.step = 'review'; saveChatState(chatId);
        return bot.sendMessage(chatId,
          `❌ Photo ${i + 1} re-edit failed: ${e.message}\n\nStopped the post instead of uploading originals that would flag as duplicates.`);
      }
    }
    c.photos = edited;
    c._dupEdit = false;
    bot.deleteMessage(chatId, prep.message_id).catch(() => {});
  }

  c.step = 'posting';

  // Build the draft spec the extension will replay into Vinted
  const draftSpec = {
    title: titleWithSize(L),
    description: normalizeText(L.description, 'sentence'),
    brand_id: L.brand_id || null,
    brand: L.brand ? normalizeText(L.brand, 'title') : null,
    size_id: L.size_id || null,
    catalog_id: L.catalog_id,
    status_id: L.status_id,
    price: L.price,
    currency: 'GBP',
    package_size_id: L.package_size_id || null,
    color_ids: [L.color1_id, L.color2_id].filter(Boolean),
    isbn: L.isbn || null,
    custom_parcel: L.custom_parcel || null,
  };

  // Vinted rejects drafts whose description is <5 chars (code 99).
  // Title is guaranteed >= 5 chars (processPhotos defaults to "Untitled item").
  if (!draftSpec.description || draftSpec.description.trim().length < 5) {
    console.log('[TG] createListing: description too short, falling back to title');
    draftSpec.description = draftSpec.title;
  }

  const photoCount = c.photos.length;
  const eta_ms = estimatePostEta(photoCount);
  const idempotencyKey = `tg:${chatId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

  // Resolve the currently-active Vinted account for this RelistPro user.
  // The command gets pinned to that memberId so the extension only runs
  // it when the browser is logged into the matching Vinted account.
  const targetMemberId = await activeVintedMemberId(chatId).catch(() => null);
  if (!targetMemberId) {
    c.step = 'review';
    return bot.sendMessage(chatId,
      '❌ *No Vinted account linked yet.*\n\n' +
      'To connect:\n' +
      '1. Open *vinted.co.uk* in Chrome and sign in\n' +
      '2. Click the RelistPro extension icon → *Sync*\n' +
      '3. Come back here and tap *POST* again',
      { parse_mode: 'Markdown' });
  }

  // ── P6 preflight gate ──
  // Read-only DB check: is there a stored session, is the extension
  // polling right now, and are the cookies fresh? No Vinted network
  // calls from Railway — those are the datacenter-IP signal we killed
  // in P1. If any layer fails, refuse to enqueue so the post can't
  // burn the session (or a 400-cooldown on the new account).
  try {
    const session = await store.getSession(acct.userId, targetMemberId).catch(() => null);
    if (!session) {
      c.step = 'review'; saveChatState(chatId);
      return bot.sendMessage(chatId,
        '❌ *No Vinted account linked yet.*\n\n' +
        'To connect:\n' +
        '1. Open *vinted.co.uk* in Chrome and sign in\n' +
        '2. Click the RelistPro extension icon → *Sync*\n' +
        '3. Come back here and tap *POST* again',
        { parse_mode: 'Markdown' });
    }

    const extStatus = await getExtensionStatus(acct.userId).catch(() => ({ alive: false }));
    if (!extStatus.alive) {
      c.step = 'review'; saveChatState(chatId);
      return bot.sendMessage(chatId,
        '⚠️ *Your RelistPro extension isn\'t online.*\n\n' +
        'The bot can\'t run the post without the extension polling from Chrome. To fix:\n' +
        '1. Open *vinted.co.uk* in Chrome\n' +
        '2. Make sure RelistPro is enabled at chrome://extensions\n' +
        '3. Click the extension icon → *Sync*\n' +
        '4. Wait ~60s, then tap *POST* again',
        { parse_mode: 'Markdown' });
    }

    const storedMs = session.storedAt ? new Date(session.storedAt).getTime() : 0;
    const sessionAgeMs = storedMs ? Date.now() - storedMs : Infinity;
    if (sessionAgeMs > 4 * 60 * 60 * 1000) {
      c.step = 'review'; saveChatState(chatId);
      return bot.sendMessage(chatId,
        '⚠️ *Your Vinted session is old* (>4 hours).\n\n' +
        'Open Chrome with the RelistPro extension running, then tap *POST* again. The extension auto-syncs when active.',
        { parse_mode: 'Markdown' });
    }
  } catch (e) {
    console.error('[TG] createListing P6 preflight error:', e.message);
    c.step = 'review'; saveChatState(chatId);
    return bot.sendMessage(chatId,
      '\u274C Could not verify your browser connection: ' + e.message + '\n\nMake sure Chrome is open with RelistPro active, then tap POST again.'
    );
  }

  let cmdId;
  try {
    // Enqueue the command row
    const ins = await db.query(
      `INSERT INTO rp_commands
         (user_id, target_member_id, type, status, eta_ms, payload, source, idempotency_key, scheduled_at)
       VALUES ($1, $2, 'post_new', 'queued', $3, $4, 'telegram', $5, $6)
       RETURNING id`,
      [acct.userId, targetMemberId, eta_ms,
       JSON.stringify({ draft: draftSpec, photo_count: photoCount }),
       idempotencyKey, scheduledAt || null]
    );
    cmdId = ins.rows[0].id;

    // Link the listing snapshot (saved at review time) to this command
    linkSnapshotToCommand(chatId, cmdId).catch(() => {});

    // Stage photos as bytea rows
    for (let i = 0; i < c.photos.length; i++) {
      const buf = Buffer.from(c.photos[i].base64, 'base64');
      await db.query(
        `INSERT INTO rp_command_photos (command_id, idx, mime, data) VALUES ($1, $2, $3, $4)`,
        [cmdId, i, 'image/jpeg', buf]
      );
    }
  } catch (e) {
    console.error('[TG] createListing enqueue failed:', e.message);
    c.step = 'review';
    return bot.sendMessage(chatId, `❌ Couldn't queue post: ${e.message}`);
  }

  // Initial status message
  let statusMsg;
  if (scheduledAt) {
    const schedMs = new Date(scheduledAt).getTime();
    const diffMin = Math.max(0, Math.round((schedMs - Date.now()) / 60000));
    const timeStr = new Date(scheduledAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true });
    const schedText = `📅 Scheduled for ${timeStr}\n\nYour listing will post automatically when Chrome is open.\n\n💡 Send more photos to start another listing.`;
    statusMsg = await bot.sendMessage(chatId, schedText, {
      reply_markup: { inline_keyboard: [[{ text: '❌ Cancel scheduled post', callback_data: `cmd:cancel:${cmdId}` }]] },
    });
  } else {
    const initialText = renderProgress({
      stage_label: 'Queued — waiting for Chrome',
      eta_ms,
      elapsed_ms: 0,
    });
    try {
      statusMsg = await bot.sendMessage(chatId, initialText, {
        parse_mode: 'MarkdownV2',
        reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: `cmd:cancel:${cmdId}` }]] },
      });
    } catch (e) {
      statusMsg = await bot.sendMessage(chatId, '📤 Posting via your browser…', {
        reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: `cmd:cancel:${cmdId}` }]] },
      });
    }
  }

  // Track the in-flight command on the chat so the user can pipeline another
  c._activeCommands = c._activeCommands || {};
  c._activeCommands[cmdId] = {
    msgId: statusMsg.message_id,
    startedAt: Date.now(),
    replyToMsgId: c._firstPhotoMsgId || null,
    scheduledAt: scheduledAt || null,
  };

  bot.sendMessage(chatId,
    '✅ Queued! Send photos for your next item anytime.'
  ).catch(() => {});

  // Reset wizard state — photos now owned by the command. Pipelining allowed.
  c.step = 'idle';
  c.photos = [];
  c.listing = null;
  c.summaryMsgId = null;
  c.catalogCache = null;
  c._firstPhotoMsgId = null;
  delete c._lastDraftId;
  delete c._retried;
  delete c._dupChecked;
  delete c._dupEdit;
  saveChatState(chatId);

  startCommandTicker(chatId, cmdId, statusMsg.message_id, acct);
}

// ─── Command ticker ─────────────────────────────────────────────────
// Poll the command row and edit the status message every ~3.5 s.
// One ticker per command; a single chat can run several in parallel.

function startCommandTicker(chatId, cmdId, msgId, acct) {
  const startedAt = Date.now();
  let lastText = '';
  let fiveMinNagSent = false;
  let fifteenMinNagSent = false;
  const MAX_TICKER_MS = 20 * 60 * 1000; // 20 minutes
  const intervalId = setInterval(async () => {
    try {
      // Hard timeout — auto-fail if extension never completed
      if (Date.now() - startedAt > MAX_TICKER_MS) {
        clearInterval(intervalId);
        const timeoutErr = { error: 'Timed out — Chrome extension did not complete the post within 20 minutes. Make sure Chrome is open with the RelistPro extension active.' };
        await db.query(
          `UPDATE rp_commands SET status='failed', result=$3, completed_at=NOW(), updated_at=NOW()
           WHERE id=$1 AND user_id=$2 AND status NOT IN ('completed','failed','cancelled')`,
          [cmdId, acct.userId, timeoutErr]
        ).catch(() => {});
        const timeoutText = renderFinal({ status: 'failed', result: timeoutErr }, MAX_TICKER_MS);
        await bot.editMessageText(timeoutText, {
          chat_id: chatId, message_id: msgId, parse_mode: 'MarkdownV2',
          reply_markup: { inline_keyboard: [[{ text: '\u{1F501} Retry', callback_data: `cmd:retry:${cmdId}` }]] },
        }).catch(() => {});
        bot.sendMessage(chatId,
          '\u274C Post timed out after 20 minutes.\n\nMake sure Chrome is open with the RelistPro extension active on a Vinted page, then try again.'
        ).catch(() => {});
        return;
      }

      const r = await db.query(
        `SELECT id, status, stage, stage_label, progress_pct, eta_ms, result, created_at
           FROM rp_commands WHERE id = $1 AND user_id = $2`,
        [cmdId, acct.userId]
      );
      if (!r.rows.length) { clearInterval(intervalId); return; }
      const cmd = r.rows[0];

      if (['completed', 'failed', 'cancelled'].includes(cmd.status)) {
        clearInterval(intervalId);
        const c = getChat(chatId);
        const tracking = (c._activeCommands && c._activeCommands[cmdId]) || {};
        const replyToMsgId = tracking.replyToMsgId;
        if (c._activeCommands) delete c._activeCommands[cmdId];
        const elapsed = Date.now() - startedAt;
        const finalText = renderFinal(cmd, elapsed);
        let kb;
        if (cmd.status === 'completed' && cmd.result?.listing_url) {
          kb = { inline_keyboard: [[{ text: '🔗 View on Vinted', url: cmd.result.listing_url }]] };
        } else if (cmd.status === 'failed') {
          kb = { inline_keyboard: [[{ text: '🔁 Retry', callback_data: `cmd:retry:${cmdId}` }]] };
        }
        await bot.editMessageText(finalText, {
          chat_id: chatId, message_id: msgId, parse_mode: 'MarkdownV2', reply_markup: kb,
        }).catch(() => {});
        saveChatState(chatId);

        if (cmd.status === 'completed') {
          const title = cmd.result?.title || 'your item';
          const url = cmd.result?.listing_url;
          const body = `✅ *Posted\\!* Send more photos for your next item\\.\n\n${escMd2(title)}`;
          const opts = {
            parse_mode: 'MarkdownV2',
            reply_to_message_id: replyToMsgId || undefined,
            allow_sending_without_reply: true,
          };
          if (url) opts.reply_markup = { inline_keyboard: [[{ text: '🔗 View on Vinted', url }]] };
          bot.sendMessage(chatId, body, opts).catch(e => {
            if (/reply/i.test(e.message)) {
              delete opts.reply_to_message_id;
              bot.sendMessage(chatId, body, opts).catch(() => {});
            }
          });
        } else if (cmd.status === 'failed') {
          const errText = cmd.result?.error || 'unknown error';
          const errLower = errText.toLowerCase();
          const isBan = ['cooldown', 'banned', 'captcha', 'blocked'].some(k => errLower.includes(k));
          const isRetryable = ['timeout', 'network', 'navigation', 'extension', 'chrome', 'crash']
            .some(k => errLower.includes(k));

          if (isRetryable && !isBan) {
            // Auto-retry: notify user, retry in 5 min unless cancelled
            const retryMsg = await bot.sendMessage(chatId,
              `❌ Post failed: ${errText}\n\nI'll retry this automatically in 5 minutes when the queue is free. Tap cancel if you don't want that.`,
              {
                reply_to_message_id: replyToMsgId || undefined,
                allow_sending_without_reply: true,
                reply_markup: { inline_keyboard: [[{ text: '❌ Cancel retry', callback_data: `cancelretry:${cmdId}` }]] },
              }
            ).catch(() => null);

            // Set up 5-min auto-retry timer
            c._pendingRetry = {
              cmdId,
              acctUserId: acct.userId,
              retryMsgId: retryMsg?.message_id,
              timer: setTimeout(async () => {
                if (c._pendingRetry?.cmdId !== cmdId) return;
                delete c._pendingRetry;
                try {
                  // Check no active commands for this user
                  const active = await db.query(
                    `SELECT id FROM rp_commands WHERE user_id=$1 AND status IN ('queued','claimed','in_progress') AND id != $2`,
                    [acct.userId, cmdId]
                  );
                  // Find optimal timing
                  let retryScheduledAt = null;
                  const lastDone = await db.query(
                    `SELECT completed_at FROM rp_commands WHERE user_id=$1 AND status='completed' ORDER BY completed_at DESC LIMIT 1`,
                    [acct.userId]
                  );
                  if (lastDone.rows[0]?.completed_at) {
                    const sinceLastMs = Date.now() - new Date(lastDone.rows[0].completed_at).getTime();
                    if (sinceLastMs < 10 * 60 * 1000) {
                      retryScheduledAt = new Date(new Date(lastDone.rows[0].completed_at).getTime() + 10 * 60 * 1000);
                    }
                  }

                  await db.query(
                    `UPDATE rp_commands SET status='queued', result='{}', scheduled_at=$2, updated_at=NOW(), completed_at=NULL
                     WHERE id=$1`,
                    [cmdId, retryScheduledAt]
                  );

                  const msg = active.rows.length
                    ? '🔁 Retrying after your current post finishes.'
                    : '🔁 Retrying your post now.';
                  bot.sendMessage(chatId, msg).catch(() => {});
                  // Re-start ticker
                  const statusMsg2 = await bot.sendMessage(chatId,
                    renderProgress({ stage_label: 'Queued — retrying', eta_ms: estimatePostEta(4), elapsed_ms: 0 }),
                    { parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: `cmd:cancel:${cmdId}` }]] } }
                  ).catch(() => null);
                  if (statusMsg2) {
                    startCommandTicker(chatId, cmdId, statusMsg2.message_id, acct);
                  }
                } catch (e) {
                  console.error('[TG] auto-retry error:', e.message);
                  bot.sendMessage(chatId, 'Auto-retry failed. Use /retry to try again manually.').catch(() => {});
                }
              }, 5 * 60 * 1000),
            };
          } else {
            // Non-retryable failure
            const msg = isBan
              ? `❌ Post failed: ${errText}\n\nThis isn't a temporary issue — auto-retry is paused. Use /retry once the cooldown ends.`
              : `❌ Post failed: ${errText}\n\nUse /retry to try again, or send new photos to start fresh.`;
            bot.sendMessage(chatId, msg, {
              reply_to_message_id: replyToMsgId || undefined,
              allow_sending_without_reply: true,
            }).catch(() => {});
          }
        }
        return;
      }

      // Handle scheduled countdown display
      const tracking = (getChat(chatId)._activeCommands || {})[cmdId];
      if (tracking?.scheduledAt && cmd.status === 'queued') {
        const schedMs = new Date(tracking.scheduledAt).getTime();
        if (schedMs > Date.now()) {
          const diffMin = Math.max(1, Math.round((schedMs - Date.now()) / 60000));
          const timeStr = new Date(tracking.scheduledAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true });
          const schedText = `📅 Scheduled to post at ${timeStr}\n⏱ Posting in ~${diffMin} min\n\n💡 Send more photos to queue another listing.`;
          if (schedText !== lastText) {
            lastText = schedText;
            await bot.editMessageText(schedText, {
              chat_id: chatId, message_id: msgId,
              reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: `cmd:cancel:${cmdId}` }]] },
            }).catch(() => {});
          }
          return;
        }
      }

      // Stuck in queue >45 s? Swap subtitle to the "open Chrome" hint.
      const ageMs = Date.now() - new Date(cmd.created_at).getTime();
      const stuckInQueue = cmd.status === 'queued' && ageMs > 45000;

      // Nag at 5 min — actionable reminder
      if (cmd.status === 'queued' && ageMs > 5 * 60 * 1000 && !fiveMinNagSent) {
        fiveMinNagSent = true;
        bot.sendMessage(chatId,
          '\u23F3 Still waiting for Chrome to pick up this post (5 min).\n\n' +
          '1. Open Chrome on your computer\n' +
          '2. Go to any Vinted page\n' +
          '3. Make sure the RelistPro extension is active\n\n' +
          'The post will start automatically once Chrome connects.'
        ).catch(() => {});
      }
      // Last warning at 15 min — will timeout at 20
      if (cmd.status === 'queued' && ageMs > 15 * 60 * 1000 && !fifteenMinNagSent) {
        fifteenMinNagSent = true;
        bot.sendMessage(chatId,
          '\u26A0\uFE0F This post will time out in 5 minutes if Chrome doesn\'t connect.\n\n' +
          'Cancel and try again later if your computer isn\'t available.'
        ).catch(() => {});
      }

      // Synthesise a smooth local countdown — reuse ETA from the row but
      // subtract elapsed, so the timer doesn't jump when the extension
      // updates stage mid-way through.
      const elapsed = Date.now() - startedAt;
      const totalEta = cmd.eta_ms || estimatePostEta(4);
      const remain = Math.max(0, totalEta - elapsed);

      const text = renderProgress({
        stage_label: cmd.stage_label || (stuckInQueue ? 'Waiting for Chrome' : 'Running in your browser'),
        eta_ms: remain,
        stuckInQueue,
        elapsed_ms: elapsed,
      });
      if (text === lastText) return; // nothing changed — skip the edit
      lastText = text;
      await bot.editMessageText(text, {
        chat_id: chatId, message_id: msgId, parse_mode: 'MarkdownV2',
        reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: `cmd:cancel:${cmdId}` }]] },
      }).catch(e => {
        if (/429/.test(e.message)) { /* Telegram rate limit, next tick will catch up */ }
        else if (/message is not modified/i.test(e.message)) { /* ignore */ }
        else console.log('[TG] ticker edit error:', e.message);
      });
    } catch (e) {
      console.log('[TG] ticker poll error:', e.message);
    }
  }, 3500);
}

// ─── Exports ────────────────────────────────────────────────────────

module.exports = {
  init,
  setDeps,
  createListing,
  startCommandTicker,
  getExtensionStatus,
  isAdminAccount,
  fetchVintedAccounts,
  invalidateVintedAcctCache,
  activeVintedMemberId,
  renderProgress,
  renderFinal,
};
