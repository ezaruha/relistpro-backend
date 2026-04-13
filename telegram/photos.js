const { clearErrorField } = require('./helpers');
const { getChat, activeAccount, ensureMulti, ensureLoaded, saveChatState, loadedFromDb } = require('./state');

let _bot = null;
let _store = null;

// Lazy deps — set after all modules are loaded to avoid circular requires
let processPhotos = null;
let showSummary = null;
let refreshVintedSession = null;

function setDeps({ processPhotos: pp, showSummary: ss, refreshVintedSession: rvs }) {
  if (pp) processPhotos = pp;
  if (ss) showSummary = ss;
  if (rvs) refreshVintedSession = rvs;
}

function init({ bot, store }) {
  _bot = bot;
  _store = store;

  bot.on('photo', async (msg) => {
    const chatId = msg.chat.id;
    await ensureLoaded(chatId);
    const c = getChat(chatId);
    ensureMulti(c);

    // If no account in memory, force a fresh DB load (in case save was delayed)
    if (!activeAccount(c)) {
      loadedFromDb.delete(chatId);
      await ensureLoaded(chatId);
    }
    if (!activeAccount(c)) {
      return bot.sendMessage(chatId,
        'Not connected yet.\n\n' +
        'To get started:\n' +
        '1. Install the RelistPro Chrome extension\n' +
        '2. Register an account in the extension\n' +
        '3. Log into vinted.co.uk → click extension → Sync\n' +
        '4. Come back here → /login with your username & password');
    }

    // Pre-flight: check if Vinted session exists before user goes through wizard
    if (c.step === 'idle') {
      const acct = activeAccount(c);
      try {
        let sess = await _store.getSession(acct.userId);
        if (sess) {
          // Non-destructive CSRF re-derive — same safe path used pre-post.
          sess = await refreshVintedSession(sess, acct.userId).catch(() => sess);
        }
        if (!sess) {
          return bot.sendMessage(chatId,
            '⚠️ Your Vinted login for ' + (acct.vintedName || acct.username) + ' has expired (your Telegram login is fine).\n\n' +
            'To refresh:\n' +
            '1. Open vinted.co.uk in Chrome\n' +
            '2. Click the RelistPro extension → Sync\n' +
            '3. Come back here and send your photos again');
        }
      } catch {}
    }

    // If in review with no photos, accept photos for the current listing
    if (c.step === 'review' && (!c.photos || !c.photos.length)) {
      c.step = 'collecting_photos_for_review';
      c.photos = [];
    }

    // If a post is actively running (posting step), start a new listing queue
    if (c.step === 'posting' || c.step === 'sched_input') {
      c._nextListing = c._nextListing || { photos: [], caption: null };
      c._nextListing.photos.push(msg);
      if (msg.caption) c._nextListing.caption = msg.caption;
      if (!c._nextListingNotified) {
        c._nextListingNotified = true;
        bot.sendMessage(chatId,
          `📸 Got photos for a new listing. Your previous post is still running — this one will queue after it.`
        ).catch(() => {});
      }
      return;
    }

    // If mid-wizard or review (with photos already), ask user what to do
    if (c.step.startsWith('wiz_') || c.step === 'review' || c.step === 'analyzing') {
      const kb = [
        [{ text: '📝 Continue current listing', callback_data: 'resume' }],
        [{ text: '🆕 Start new listing', callback_data: 'newlisting' }],
      ];
      c.pendingPhoto = msg;
      return bot.sendMessage(chatId, 'You have a listing in progress. What would you like to do?', {
        reply_markup: { inline_keyboard: kb }
      });
    }

    // Start fresh collection if idle
    if (c.step === 'idle') {
      c.step = 'collecting_photos';
      c.photos = [];
      c.caption = null;
      c._firstPhotoMsgId = null;
      if (!c._firstPhotoTipSent) {
        c._firstPhotoTipSent = true;
        bot.sendMessage(chatId,
          '📸 Send all your photos — the first 5 matter most! AI reads them to detect brand, size, condition and set a price.\n\n' +
          'Tip: Include a label close-up and any flaws.'
        ).catch(() => {});
      }
    }

    // Capture the first photo's message_id so we can reply to it on completion
    if (!c._firstPhotoMsgId) c._firstPhotoMsgId = msg.message_id;

    if (c.step !== 'collecting_photos' && c.step !== 'collecting_photos_for_review' && c.step !== 'collecting_proof_photos') {
      return bot.sendMessage(chatId, 'Finish or /cancel your current listing first.');
    }

    // Download highest-res version.
    // IMPORTANT: push a placeholder SYNCHRONOUSLY (before the async download)
    // so media-group photos preserve the user's selection order.
    const photo = msg.photo[msg.photo.length - 1];
    const slot = { _mid: msg.message_id, fileId: photo.file_id, base64: null };
    c.photos.push(slot);
    try {
      const os = require('os');
      const fs = require('fs');
      let filePath, lastErr;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          filePath = await bot.downloadFile(photo.file_id, os.tmpdir());
          break;
        } catch (e) {
          lastErr = e;
          console.warn(`[TG] photo download attempt ${attempt}/3 failed: ${e.message}`);
          if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 500));
        }
      }
      if (!filePath) throw lastErr || new Error('download failed');
      const buffer = fs.readFileSync(filePath);
      try { fs.unlinkSync(filePath); } catch (_) {}
      if (!buffer.length) throw new Error('Empty file');
      slot.base64 = buffer.toString('base64');
    } catch (e) {
      console.error('[TG] Photo download error:', e.message);
      const idx = c.photos.indexOf(slot);
      if (idx >= 0) c.photos.splice(idx, 1);
      return bot.sendMessage(chatId, `Can't download the photo (${e.message}). Try sending it again.`);
    }

    if (msg.caption) c.caption = msg.caption;

    // Debounce — wait for more photos in media group
    if (c.photoTimer) clearTimeout(c.photoTimer);
    if (c.step === 'collecting_photos_for_review') {
      // Photos for an existing listing — go back to review, no AI re-analysis
      c.photoTimer = setTimeout(async () => {
        c.step = 'review';
        // Walkthrough recovery: if the Vinted post was rejected for photos,
        // the new batch clears that error field so showSummary can advance.
        if (c.listing?._errorWalkthrough && c.listing?._errorFields?.includes('photos')) {
          clearErrorField(c, 'photos');
        }
        saveChatState(chatId);
        await bot.sendMessage(chatId, `📸 Got ${c.photos.length} photo(s) for your listing. Type /ready to continue.`);
        showSummary(chatId);
      }, 2000);
    } else if (c.step === 'collecting_proof_photos') {
      // Authenticity proof photos — just append, user taps Done to continue
      c.photoTimer = setTimeout(async () => {
        saveChatState(chatId);
        await bot.sendMessage(chatId,
          `📸 Got ${c.photos.length} photo(s) total. Send more proof shots, or tap Done when finished.`,
          { reply_markup: { inline_keyboard: [
            [{ text: '✅ Done — continue listing', callback_data: 'auth:proofdone' }]
          ]}}
        );
      }, 2000);
    } else {
      c.photoTimer = setTimeout(() => processPhotos(chatId), 2000);
    }
  });
}

module.exports = { init, setDeps };
