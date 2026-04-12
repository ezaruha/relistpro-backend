const { CONDITIONS, COLORS } = require('./constants');
const { esc, clearErrorField, estimatePostEta } = require('./helpers');
const { getChat, activeAccount, ensureMulti, saveChatState } = require('./state');

let _bot = null;
let _deps = {};

function init({ bot }) {
  _bot = bot;
}

function setDeps(d) {
  Object.assign(_deps, d);
}

// Route the user into the edit step for a specific field. Used both by the
// review-panel edit buttons and the publish-error walkthrough (which jumps
// the user directly into each broken field in turn).
async function enterEditStep(chatId, field) {
  const c = getChat(chatId);
  const L = c.listing;
  if (!L) return;
  const f = String(field || '').toLowerCase();
  switch (f) {
    case 'title':
      c.step = 'editing_title';
      saveChatState(chatId);
      return _bot.sendMessage(chatId, `✏️ Title needs a fix.\n\nCurrent: *${esc(L.title || '—')}*\n\nType the new title:`, { parse_mode: 'MarkdownV2' });
    case 'description':
    case 'desc':
      c.step = 'editing_desc';
      saveChatState(chatId);
      return _bot.sendMessage(chatId, `✏️ Description needs a fix.\n\nType the new description:`);
    case 'price':
      c.step = 'editing_price';
      saveChatState(chatId);
      return _bot.sendMessage(chatId, `💰 Price needs a fix.\n\nCurrent: £${L.price || '—'}\n\nType the new price (number only):`);
    case 'brand':
      c.step = 'editing_brand';
      saveChatState(chatId);
      return _bot.sendMessage(chatId, `🏷️ Brand needs a fix.\n\nCurrent: ${L.brand || 'None'}\n\nType the brand name to search (or "none" to clear):`);
    case 'condition': {
      const keyboard = CONDITIONS.map(x => ([{ text: `${x.emoji} ${x.label}`, callback_data: `cond:${x.id}` }]));
      return _bot.sendMessage(chatId, '📦 Condition needs a fix. Pick one:', { reply_markup: { inline_keyboard: keyboard } });
    }
    case 'color':
    case 'colour': {
      const rows = [];
      for (let i = 0; i < COLORS.length; i += 3) {
        rows.push(COLORS.slice(i, i + 3).map(x => ({ text: x.label, callback_data: `color:${x.id}` })));
      }
      return _bot.sendMessage(chatId, '🎨 Colour needs a fix. Pick one:', { reply_markup: { inline_keyboard: rows } });
    }
    case 'category':
    case 'catalog':
      c.step = 'searching_cat';
      saveChatState(chatId);
      return _bot.sendMessage(chatId, '📂 Category needs a fix.\n\nType a category name to search (e.g. "hoodie", "jeans", "stroller"):');
    case 'size':
      if (!L.catalog_id) {
        return _bot.sendMessage(chatId, '📏 Size needs a fix, but pick a category first.');
      }
      return _deps.showSizePicker(chatId);
    case 'parcel':
    case 'package':
    case 'package_size':
      return _deps.showPackageSizePicker(chatId);
    case 'isbn':
      c.step = 'editing_isbn';
      saveChatState(chatId);
      return _bot.sendMessage(chatId,
        `📖 ISBN needs a fix.\n\n` +
        `Vinted requires an ISBN for books. Find it on the back cover or copyright page ` +
        `— it's a 10 or 13 digit number (sometimes with dashes).\n\n` +
        `Current: ${L.isbn || 'Not set'}\n\n` +
        `Type the ISBN (or "none" if this isn't a book and you need to change category):`
      );
    case 'photos':
      c.photos = [];
      c.step = 'collecting_photos_for_review';
      saveChatState(chatId);
      return _bot.sendMessage(chatId,
        `📸 Photos were rejected. Send your new photos now (as a media group), ` +
        `then type /ready when you're done.`
      );
    default:
      // Unknown field — fall back to the review panel so user can pick manually.
      c._errorWalkthroughFallback = true;
      return showSummary(chatId);
  }
}

async function showSummary(chatId) {
  const c = getChat(chatId);
  const L = c.listing;

  if (!L) {
    c.step = 'idle';
    saveChatState(chatId);
    return _bot.sendMessage(chatId, 'No listing in progress. Send photos to start a new one.');
  }

  // Publish-error walkthrough: if there are still error fields to fix, jump
  // the user into the next one instead of showing the review panel. Once all
  // are cleared, drop the walkthrough flag and render the summary below so
  // the user can confirm with POST TO VINTED.
  if (L._errorWalkthrough && !c._errorWalkthroughFallback) {
    const remaining = Array.isArray(L._errorFields) ? L._errorFields : [];
    if (remaining.length) {
      return enterEditStep(chatId, remaining[0]);
    }
    delete L._errorWalkthrough;
    _bot.sendMessage(chatId,
      '✅ All errors fixed. Review your listing below and tap *POST TO VINTED* to publish.',
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }
  delete c._errorWalkthroughFallback;

  // Persist full state (listing + photos) so it survives redeploys
  saveChatState(chatId);

  const catDisplay = L.category_name || (L.catalog_id ? `ID: ${L.catalog_id}` : 'Not set');
  const sizeDisplay = L.size_name || (L.size_id ? `ID: ${L.size_id}` : 'Not set');
  const colorDisplay = L.color || 'Not set';
  const condDisplay = L.condition || 'Not set';
  const brandDisplay = L.brand || 'Not set';
  const pkgDisplay = L.package_size_name || (L.package_size_id ? `ID: ${L.package_size_id}` : 'Not set');

  const ready = L.catalog_id && L.price > 0 && L.status_id;
  const missingFields = [];
  if (!L.catalog_id) missingFields.push('Category');
  if (!L.package_size_id) missingFields.push('Parcel size');

  ensureMulti(c);
  const acct = activeAccount(c);
  const vintedLabel = acct.vintedName ? `${acct.vintedName} @ ${acct.vintedDomain}` : acct.username;

  let text = `✅ *LISTING READY*\n📤 Posting to: *${esc(vintedLabel)}*\n\n` +
    `*Title:* ${esc(L.title)}\n\n` +
    `*Description:*\n${esc(L.description)}\n\n` +
    `*Price:* £${esc(String(L.price))}\n` +
    `*Brand:* ${esc(brandDisplay)}\n` +
    `*Condition:* ${esc(condDisplay)}\n` +
    `*Category:* ${esc(catDisplay)}\n` +
    `*Size:* ${esc(sizeDisplay)}\n` +
    `*Colour:* ${esc(colorDisplay)}\n` +
    `*Parcel size:* ${esc(pkgDisplay)}\n` +
    `*Photos:* ${c.photos.length}\n`;

  if (missingFields.length) {
    text += `\n⚠️ *Missing:* ${missingFields.join(', ')} — tap to set`;
  } else {
    const etaMin = Math.max(1, Math.round(estimatePostEta(c.photos.length) / 60000));
    text += `\n🟢 *All fields complete\\!* Tap POST TO VINTED to list your item, or edit any field below\\.`;
    text += `\n\n⚠️ _Double\\-check *Category* and *Colour* — the AI can get these wrong\\. Tap to change if needed\\._`;
    text += `\n⏱ _Posting runs in your real browser \\(\\~${etaMin} min\\) — slower than a direct API, but the only way to avoid account bans\\._`;
  }

  const errFields = new Set(L._errorFields || []);
  if (errFields.size) {
    text += `\n\n⚠️ *Last publish failed on:* ${esc(Array.from(errFields).join(', '))}`;
  }
  const warn = (f, base) => errFields.has(f) ? '⚠️ ' + base : base;

  // Force edit mode when there are publish errors to fix, so the user
  // immediately sees the field buttons instead of having to tap "Edit".
  const editMode = c._summaryEditOpen || errFields.size > 0;

  // If an edit just finished, confirm it. In the error-walkthrough path
  // we keep the field grid visible so the user can chew through each
  // broken field; otherwise we show a clear two-button prompt asking
  // whether to POST now or edit more. Always send as a NEW message on
  // edit so the user sees a fresh confirmation at the bottom of the chat.
  let justEditedPrompt = false;
  let forceNewMessage = false;
  if (c._justEdited) {
    const fieldLabel = c._justEdited;
    text = `✅ Updated ${esc(fieldLabel)}\\.\n\n🚀 *Post to Vinted now, or edit more?*\n\n` + text;
    if (errFields.size === 0) justEditedPrompt = true;
    forceNewMessage = true;
  }
  delete c._justEdited;

  let keyboard;
  if (justEditedPrompt) {
    keyboard = [];
    if (ready) keyboard.push([{ text: '🚀 POST TO VINTED NOW', callback_data: 'post' }]);
    keyboard.push([{ text: '✏️ Edit more', callback_data: 'edit:picker' }]);
  } else if (editMode) {
    keyboard = [
      [{ text: warn('title', '✏️ Title'), callback_data: 'edit:title' }, { text: warn('description', '✏️ Description'), callback_data: 'edit:desc' }, { text: warn('price', '💰 Price'), callback_data: 'edit:price' }],
      [{ text: warn('category', '📂 Category'), callback_data: 'pick:cat' }, { text: warn('size', '📏 Size'), callback_data: 'pick:size' }, { text: warn('brand', '🏷️ Brand'), callback_data: 'edit:brand' }],
      [{ text: warn('color', '🎨 Colour'), callback_data: 'pick:color' }, { text: warn('condition', '📦 Condition'), callback_data: 'pick:cond' }, { text: warn('parcel', '📮 Parcel size'), callback_data: 'pick:pkg' }],
      [{ text: '📷 Photos', callback_data: 'edit:photos' }, { text: '⬅️ Done editing', callback_data: 'edit:done' }],
    ];
    if (ready) keyboard.unshift([{ text: '🚀 POST TO VINTED', callback_data: 'post' }]);
  } else {
    keyboard = [];
    if (ready) keyboard.push([{ text: '🚀 POST TO VINTED', callback_data: 'post' }]);
    keyboard.push([{ text: '✏️ Edit something', callback_data: 'edit:picker' }]);
  }
  keyboard.push([{ text: '❌ Cancel', callback_data: 'cancel' }]);

  const opts = { parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: keyboard } };

  // Edit existing summary or send new one. After a user edit we always
  // send a fresh message so the confirmation appears at the bottom of
  // the chat instead of silently mutating a scrolled-up message.
  if (c.summaryMsgId && !forceNewMessage) {
    try {
      await _bot.editMessageText(text, { chat_id: chatId, message_id: c.summaryMsgId, ...opts });
      return;
    } catch (e) {
      console.log('[TG] showSummary edit failed, resending:', e.message);
    }
  }
  try {
    const sent = await _bot.sendMessage(chatId, text, opts);
    c.summaryMsgId = sent.message_id;
  } catch (e) {
    // Last-ditch: MarkdownV2 parse failed somewhere — resend as plain text
    // so the user never sees "nothing happens" after an edit.
    console.error('[TG] showSummary MarkdownV2 failed, falling back to plain:', e.message);
    const plain = text.replace(/\\([_*\[\]()~`>#+\-=|{}.!\\])/g, '$1').replace(/[*_`]/g, '');
    const sent = await _bot.sendMessage(chatId, plain, { reply_markup: opts.reply_markup });
    c.summaryMsgId = sent.message_id;
  }
}

module.exports = { showSummary, enterEditStep, init, setDeps };
