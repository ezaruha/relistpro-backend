// ═══════════════════════════════════════════════════════════════════
// RelistPro Telegram Bot — list items on Vinted by sending photos
// ═══════════════════════════════════════════════════════════════════
//
// Setup:
//   1. Message @BotFather on Telegram → /newbot → copy the token
//   2. Set env vars on Railway:
//      - TELEGRAM_BOT_TOKEN=<your bot token>
//      - ANTHROPIC_API_KEY=<your key>  (already set if AI analysis works)
//   3. Deploy — bot starts automatically
//   4. Open your bot in Telegram → /login username password → send photos
//
// Optional: set TELEGRAM_WEBHOOK_URL for webhook mode (recommended on Railway)
//   e.g. TELEGRAM_WEBHOOK_URL=https://relistpro-backend-production.up.railway.app/api/telegram/webhook

const crypto = require('crypto');

// ── Vinted condition statuses (UK) ──
const CONDITIONS = [
  { id: 6, label: 'New with tags', emoji: '🏷️' },
  { id: 1, label: 'New without tags', emoji: '✨' },
  { id: 2, label: 'Very good', emoji: '👍' },
  { id: 3, label: 'Good', emoji: '👌' },
  { id: 4, label: 'Satisfactory', emoji: '🔧' },
];

// ── Common colors ──
const COLORS = [
  { id: 1, label: 'Black' }, { id: 3, label: 'White' }, { id: 2, label: 'Grey' },
  { id: 12, label: 'Blue' }, { id: 7, label: 'Red' }, { id: 9, label: 'Green' },
  { id: 11, label: 'Yellow' }, { id: 20, label: 'Pink' }, { id: 10, label: 'Orange' },
  { id: 17, label: 'Purple' }, { id: 6, label: 'Brown' }, { id: 5, label: 'Beige' },
  { id: 4, label: 'Cream' }, { id: 22, label: 'Multicolour' },
];

// ── Chat sessions (in-memory, keyed by chatId) ──
const chats = new Map();

function getChat(chatId) {
  if (!chats.has(chatId)) chats.set(chatId, { step: 'idle', accounts: [], activeIdx: -1 });
  return chats.get(chatId);
}

// Get the active account for a chat (sugar)
function activeAccount(c) {
  if (c.activeIdx < 0 || c.activeIdx >= c.accounts.length) return null;
  return c.accounts[c.activeIdx];
}

// Migrate old single-account sessions to multi-account format
function ensureMulti(c) {
  if (!c.accounts) c.accounts = [];
  if (c.userId && !c.accounts.length) {
    c.accounts.push({ userId: c.userId, token: c.token, username: c.username });
    c.activeIdx = 0;
    delete c.userId; delete c.token; delete c.username;
  }
  if (c.activeIdx == null) c.activeIdx = c.accounts.length ? 0 : -1;
}

// ═══ MAIN INIT ═══
module.exports = function initTelegram({ store, vintedFetch, verifyPassword, app }) {
  let TelegramBot;
  try { TelegramBot = require('node-telegram-bot-api'); } catch {
    console.log('[TG] node-telegram-bot-api not installed — bot disabled');
    return;
  }

  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!BOT_TOKEN) { console.log('[TG] No TELEGRAM_BOT_TOKEN — bot disabled'); return; }

  const WEBHOOK_URL = process.env.TELEGRAM_WEBHOOK_URL;
  const bot = new TelegramBot(BOT_TOKEN, { polling: !WEBHOOK_URL });

  if (WEBHOOK_URL) {
    bot.setWebHook(WEBHOOK_URL);
    app.post('/api/telegram/webhook', (req, res) => {
      bot.processUpdate(req.body);
      res.sendStatus(200);
    });
    console.log('[TG] Bot started (webhook)');
  } else {
    console.log('[TG] Bot started (polling)');
  }

  // ── Register command menu (shows in Telegram's command list) ──
  bot.setMyCommands([
    { command: 'start',  description: 'Welcome message & setup guide' },
    { command: 'login',  description: 'Connect account — /login user pass' },
    { command: 'switch', description: 'Switch between linked Vinted accounts' },
    { command: 'status', description: 'Check connection & Vinted session' },
    { command: 'cancel', description: 'Abort current listing' },
    { command: 'logout', description: 'Disconnect current account' },
    { command: 'help',   description: 'Show all commands' },
  ]).then(() => console.log('[TG] Commands menu registered'));

  // ──────────────────────────────────────────
  // COMMANDS
  // ──────────────────────────────────────────

  bot.onText(/\/start(?:@\S+)?/, (msg) => {
    bot.sendMessage(msg.chat.id,
      `Welcome to *RelistPro Bot* 🛍️\n\n` +
      `List items on Vinted in seconds — just send photos\\!\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `*How it works:*\n\n` +
      `1️⃣ *Connect your account*\n` +
      `Send: /login your\\_username your\\_password\n` +
      `\\(Use your RelistPro account — register via the Chrome extension first\\)\n\n` +
      `2️⃣ *Send photos*\n` +
      `Take photos of your item and send them here \\(1\\-5 photos\\)\\.  You can add a caption like "Nike hoodie size M £25"\n\n` +
      `3️⃣ *AI generates your listing*\n` +
      `Title, description, price, brand, condition — all auto\\-generated\\. You review and edit anything you want\\.\n\n` +
      `4️⃣ *Pick category \\& post*\n` +
      `Choose the Vinted category, size, parcel size, then hit *POST TO VINTED*\\.\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `*Commands:*\n` +
      `/login — connect a RelistPro account\n` +
      `/switch — switch between accounts\n` +
      `/status — check connection\n` +
      `/cancel — abort current listing\n` +
      `/logout — disconnect account\n` +
      `/help — show this again\n\n` +
      `*Multiple Vinted accounts?*\n` +
      `Just /login with each RelistPro account \\(one per Vinted account\\), then use /switch to pick which one to post to\\.`,
      { parse_mode: 'MarkdownV2' }
    );
  });

  bot.onText(/\/help(?:@\S+)?/, (msg) => {
    const c = getChat(msg.chat.id);
    ensureMulti(c);
    const connected = activeAccount(c);

    let text = `*RelistPro Bot — Commands*\n\n`;

    if (!connected) {
      text += `⚠️ *Not connected yet\\!*\n` +
        `Send: /login your\\_username your\\_password\n\n`;
    } else {
      text += `✅ Connected as *${esc(connected.username)}*\n\n`;
    }

    text += `/login \\<user\\> \\<pass\\> — connect a RelistPro account\n` +
      `/switch — switch between linked accounts\n` +
      `/status — check connection \\& Vinted session\n` +
      `/cancel — abort current listing\n` +
      `/logout — disconnect current account\n` +
      `/logout all — disconnect all accounts\n\n` +
      `*To list an item:* just send photos\\!`;

    bot.sendMessage(msg.chat.id, text, { parse_mode: 'MarkdownV2' });
  });

  bot.onText(/\/login(?:@\S+)? (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const parts = match[1].trim().split(/\s+/);
    if (parts.length < 2) return bot.sendMessage(chatId, 'Usage: /login username password');
    const [username, password] = parts;

    try {
      const user = await store.getUser(username);
      if (!user) return bot.sendMessage(chatId, 'User not found. Register via the extension first.');

      let valid = false;
      const hash = user.password_hash || user.hash;
      if (hash && hash.includes(':')) valid = await verifyPassword(password, hash);
      if (!valid) return bot.sendMessage(chatId, 'Wrong password.');

      const session = await store.getSession(user.id);
      if (!session) return bot.sendMessage(chatId, 'No Vinted session found. Open Vinted in Chrome, sync with the extension first, then try again.');

      const c = getChat(chatId);
      ensureMulti(c);

      // Check if already linked
      const existing = c.accounts.findIndex(a => a.username === username);
      if (existing >= 0) {
        // Update token and switch to it
        c.accounts[existing].token = user.token;
        c.accounts[existing].userId = user.id;
        c.activeIdx = existing;
      } else {
        c.accounts.push({ userId: user.id, token: user.token, username: user.username });
        c.activeIdx = c.accounts.length - 1;
      }
      c.step = 'idle';

      const countMsg = c.accounts.length > 1 ? `\n${c.accounts.length} accounts linked\\. Use /switch to change\\.` : '';
      bot.sendMessage(chatId, `Connected as *${esc(username)}*\\! Vinted session active \\(${esc(session.domain)}\\)\\.${countMsg}\n\nSend me photos of an item to list\\.`, { parse_mode: 'MarkdownV2' });
    } catch (e) {
      console.error('[TG] Login error:', e.message);
      bot.sendMessage(chatId, 'Login failed: ' + e.message);
    }
  });

  bot.onText(/\/status(?:@\S+)?/, async (msg) => {
    const c = getChat(msg.chat.id);
    ensureMulti(c);
    if (!c.accounts.length) return bot.sendMessage(msg.chat.id, 'Not connected. Use /login first.');

    const lines = [];
    for (let i = 0; i < c.accounts.length; i++) {
      const a = c.accounts[i];
      const session = await store.getSession(a.userId);
      const active = i === c.activeIdx ? ' (active)' : '';
      const vinted = session
        ? `${session.domain} (member ${session.memberId})`
        : 'NO SESSION — sync from Chrome';
      lines.push(`${i + 1}. ${a.username}${active} — ${vinted}`);
    }
    bot.sendMessage(msg.chat.id, `Linked accounts:\n${lines.join('\n')}`);
  });

  bot.onText(/\/switch(?:@\S+)?/, async (msg) => {
    const chatId = msg.chat.id;
    const c = getChat(chatId);
    ensureMulti(c);
    if (c.accounts.length < 2) return bot.sendMessage(chatId, c.accounts.length ? 'Only one account linked. Use /login to add another.' : 'No accounts linked. Use /login first.');

    const rows = [];
    for (const [i, a] of c.accounts.entries()) {
      const session = await store.getSession(a.userId);
      const domain = session ? session.domain : 'no session';
      const label = i === c.activeIdx ? `${a.username} (${domain}) [current]` : `${a.username} (${domain})`;
      rows.push([{ text: label, callback_data: `sw:${i}` }]);
    }
    bot.sendMessage(chatId, 'Switch to which account?', { reply_markup: { inline_keyboard: rows } });
  });

  bot.onText(/\/logout(?:@\S+)?(.*)/, (msg, match) => {
    const chatId = msg.chat.id;
    const c = getChat(chatId);
    ensureMulti(c);
    const arg = (match[1] || '').trim().toLowerCase();

    if (arg === 'all') {
      chats.delete(chatId);
      return bot.sendMessage(chatId, 'All accounts disconnected.');
    }

    if (!c.accounts.length) return bot.sendMessage(chatId, 'Not connected.');

    // Remove the active account
    const removed = c.accounts.splice(c.activeIdx, 1)[0];
    if (c.accounts.length) {
      c.activeIdx = 0;
      bot.sendMessage(chatId, `Removed ${removed.username}. Switched to ${c.accounts[0].username}.`);
    } else {
      c.activeIdx = -1;
      c.step = 'idle';
      bot.sendMessage(chatId, `Removed ${removed.username}. No accounts left.`);
    }
  });

  bot.onText(/\/cancel(?:@\S+)?/, (msg) => {
    const c = getChat(msg.chat.id);
    c.step = 'idle';
    c.photos = [];
    c.listing = null;
    c.catalogCache = null;
    bot.sendMessage(msg.chat.id, 'Listing cancelled. Send new photos whenever you\'re ready.');
  });

  // ──────────────────────────────────────────
  // PHOTO HANDLER
  // ──────────────────────────────────────────

  bot.on('photo', async (msg) => {
    const chatId = msg.chat.id;
    const c = getChat(chatId);
    ensureMulti(c);
    if (!activeAccount(c)) return bot.sendMessage(chatId, 'Not connected. Use /login first.');

    // Start fresh collection if idle
    if (c.step === 'idle' || c.step === 'review') {
      c.step = 'collecting_photos';
      c.photos = [];
      c.caption = null;
    }

    if (c.step !== 'collecting_photos') {
      return bot.sendMessage(chatId, 'Finish or /cancel your current listing first.');
    }

    // Download highest-res version
    const photo = msg.photo[msg.photo.length - 1];
    try {
      const fileLink = await bot.getFileLink(photo.file_id);
      const resp = await fetch(fileLink);
      const buffer = Buffer.from(await resp.arrayBuffer());
      c.photos.push({ base64: buffer.toString('base64'), fileId: photo.file_id });
    } catch (e) {
      console.error('[TG] Photo download error:', e.message);
      return bot.sendMessage(chatId, 'Failed to download photo. Try again.');
    }

    if (msg.caption) c.caption = msg.caption;

    // Debounce — wait for more photos in media group
    if (c.photoTimer) clearTimeout(c.photoTimer);
    c.photoTimer = setTimeout(() => processPhotos(chatId), 2000);
  });

  // ──────────────────────────────────────────
  // PROCESS PHOTOS → AI ANALYSIS
  // ──────────────────────────────────────────

  async function processPhotos(chatId) {
    const c = getChat(chatId);
    c.step = 'analyzing';

    const statusMsg = await bot.sendMessage(chatId,
      `Got ${c.photos.length} photo(s). Analyzing with AI...`
    );

    try {
      const analysis = await analyzeWithAI(c.photos[0].base64, c.caption);

      // Map condition text to status_id
      const condMatch = CONDITIONS.find(x =>
        x.label.toLowerCase() === (analysis.condition || '').toLowerCase()
      );

      c.listing = {
        title: analysis.title || 'Untitled item',
        description: analysis.description || '',
        price: analysis.suggested_price || 10,
        brand: analysis.brand || '',
        brand_id: null,
        condition: condMatch ? condMatch.label : 'Good',
        status_id: condMatch ? condMatch.id : 3,
        catalog_id: null,
        category_hint: analysis.category_hint || '',
        category_name: '',
        size_id: null,
        size_name: '',
        color: analysis.color || '',
        color1_id: null,
        package_size_id: null,
        package_size_name: '',
      };

      // Try to auto-match color
      if (analysis.color) {
        const colorMatch = COLORS.find(x =>
          x.label.toLowerCase() === analysis.color.toLowerCase()
        );
        if (colorMatch) {
          c.listing.color1_id = colorMatch.id;
          c.listing.color = colorMatch.label;
        }
      }

      c.step = 'review';
      await showSummary(chatId);
    } catch (e) {
      console.error('[TG] AI analysis error:', e.message);
      c.step = 'idle';
      bot.sendMessage(chatId, 'AI analysis failed: ' + e.message + '\nTry sending the photos again.');
    }
  }

  // ──────────────────────────────────────────
  // AI ANALYSIS
  // ──────────────────────────────────────────

  async function analyzeWithAI(base64, caption) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured on server');

    const captionCtx = caption ? `\nThe seller says: "${caption}"` : '';

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
            { type: 'text', text:
              `You are a Vinted UK listing expert. Analyze this item photo and create a compelling listing.${captionCtx}\n\n` +
              `Return ONLY valid JSON (no markdown, no backticks):\n` +
              `{\n` +
              `  "title": "concise, searchable title max 60 chars — include brand if visible",\n` +
              `  "description": "2-4 sentences. Mention brand, condition, material, style, fit. Honest and appealing. Include hashtags at end.",\n` +
              `  "suggested_price": <number in GBP>,\n` +
              `  "brand": "brand name or null",\n` +
              `  "condition": "New with tags" | "New without tags" | "Very good" | "Good" | "Satisfactory",\n` +
              `  "category_hint": "e.g. women/clothing/tops, men/shoes/trainers, kids/clothing/dresses",\n` +
              `  "color": "main color (Black, White, Grey, Blue, Red, Green, Yellow, Pink, Orange, Purple, Brown, Beige, Cream, Multicolour)"\n` +
              `}`
            }
          ]
        }]
      })
    });

    const data = await resp.json();
    const text = data.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('AI returned no JSON');
    return JSON.parse(match[0]);
  }

  // ──────────────────────────────────────────
  // SUMMARY DISPLAY
  // ──────────────────────────────────────────

  async function showSummary(chatId) {
    const c = getChat(chatId);
    const L = c.listing;

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
    const acctLabel = c.accounts.length > 1 ? ` \\(${esc(acct.username)}\\)` : '';

    let text = `*LISTING PREVIEW*${acctLabel}\n\n` +
      `*Title:* ${esc(L.title)}\n\n` +
      `*Description:*\n${esc(L.description)}\n\n` +
      `*Price:* £${L.price}\n` +
      `*Brand:* ${esc(brandDisplay)}\n` +
      `*Condition:* ${esc(condDisplay)}\n` +
      `*Category:* ${esc(catDisplay)}\n` +
      `*Size:* ${esc(sizeDisplay)}\n` +
      `*Colour:* ${esc(colorDisplay)}\n` +
      `*Parcel size:* ${esc(pkgDisplay)}\n` +
      `*Photos:* ${c.photos.length}\n`;

    if (missingFields.length) {
      text += `\n⚠️ *Required:* ${missingFields.join(', ')}`;
    }

    const keyboard = [
      [{ text: '✏️ Title', callback_data: 'edit:title' }, { text: '✏️ Description', callback_data: 'edit:desc' }, { text: '💰 Price', callback_data: 'edit:price' }],
      [{ text: '📂 Category', callback_data: 'pick:cat' }, { text: '📏 Size', callback_data: 'pick:size' }, { text: '🏷️ Brand', callback_data: 'edit:brand' }],
      [{ text: '🎨 Colour', callback_data: 'pick:color' }, { text: '📦 Condition', callback_data: 'pick:cond' }, { text: '📮 Parcel size', callback_data: 'pick:pkg' }],
    ];

    if (ready) {
      keyboard.push([{ text: '✅ POST TO VINTED', callback_data: 'post' }]);
    }
    keyboard.push([{ text: '❌ Cancel', callback_data: 'cancel' }]);

    const opts = { parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: keyboard } };

    // Edit existing summary or send new one
    if (c.summaryMsgId) {
      try {
        await bot.editMessageText(text, { chat_id: chatId, message_id: c.summaryMsgId, ...opts });
        return;
      } catch { /* falls through to send new */ }
    }
    const sent = await bot.sendMessage(chatId, text, opts);
    c.summaryMsgId = sent.message_id;
  }

  // ──────────────────────────────────────────
  // CALLBACK QUERY HANDLER (inline buttons)
  // ──────────────────────────────────────────

  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const c = getChat(chatId);
    const data = query.data;

    bot.answerCallbackQuery(query.id);

    // ── Switch account ──
    if (data.startsWith('sw:')) {
      ensureMulti(c);
      const idx = parseInt(data.split(':')[1]);
      if (idx >= 0 && idx < c.accounts.length) {
        c.activeIdx = idx;
        c.step = 'idle';
        c.photos = [];
        c.listing = null;
        c.summaryMsgId = null;
        c.catalogCache = null;
        const a = c.accounts[idx];
        return bot.editMessageText(`Switched to ${a.username}. Send photos to list on this account.`, { chat_id: chatId, message_id: query.message.message_id });
      }
      return;
    }

    // ── Cancel ──
    if (data === 'cancel') {
      c.step = 'idle';
      c.photos = [];
      c.listing = null;
      c.summaryMsgId = null;
      return bot.editMessageText('Listing cancelled.', { chat_id: chatId, message_id: query.message.message_id });
    }

    // ── Edit text fields ──
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
      return bot.sendMessage(chatId, `Current price: £${c.listing.price}\n\nType the new price (number only):`);
    }
    if (data === 'edit:brand') {
      c.step = 'editing_brand';
      return bot.sendMessage(chatId, `Current brand: ${c.listing.brand || 'None'}\n\nType the brand name to search (or "none" to clear):`);
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
      c.step = 'review';
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
      if (col) { c.listing.color1_id = col.id; c.listing.color = col.label; }
      c.step = 'review';
      return showSummary(chatId);
    }

    // ── Pick category ──
    if (data === 'pick:cat') {
      return showCategoryPicker(chatId, null);
    }
    if (data.startsWith('cat:')) {
      const id = parseInt(data.split(':')[1]);
      return selectCategory(chatId, id);
    }
    if (data.startsWith('nav:')) {
      const id = parseInt(data.split(':')[1]);
      return showCategoryPicker(chatId, id);
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
    if (data.startsWith('pkg:')) {
      const id = parseInt(data.split(':')[1]);
      return selectPackageSize(chatId, id);
    }

    // ── Brand search results ──
    if (data.startsWith('brand:')) {
      const parts = data.split(':');
      c.listing.brand_id = parseInt(parts[1]);
      c.listing.brand = parts.slice(2).join(':'); // brand name may contain colons
      c.step = 'review';
      return showSummary(chatId);
    }

    // ── POST ──
    if (data === 'post') {
      return createListing(chatId);
    }
  });

  // ──────────────────────────────────────────
  // TEXT HANDLER (for field edits)
  // ──────────────────────────────────────────

  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    const chatId = msg.chat.id;
    const c = getChat(chatId);

    if (c.step === 'editing_title') {
      c.listing.title = msg.text.slice(0, 60);
      c.step = 'review';
      return showSummary(chatId);
    }

    if (c.step === 'editing_desc') {
      c.listing.description = msg.text;
      c.step = 'review';
      return showSummary(chatId);
    }

    if (c.step === 'editing_price') {
      const price = parseFloat(msg.text.replace(/[^0-9.]/g, ''));
      if (isNaN(price) || price <= 0) return bot.sendMessage(chatId, 'Enter a valid price (e.g. 25 or 14.50):');
      c.listing.price = Math.round(price * 100) / 100;
      c.step = 'review';
      return showSummary(chatId);
    }

    if (c.step === 'editing_brand') {
      if (msg.text.toLowerCase() === 'none') {
        c.listing.brand = '';
        c.listing.brand_id = null;
        c.step = 'review';
        return showSummary(chatId);
      }
      // Search Vinted brands
      return searchBrands(chatId, msg.text);
    }

    if (c.step === 'searching_cat') {
      return searchCategories(chatId, msg.text);
    }
  });

  // ──────────────────────────────────────────
  // CATEGORY PICKER
  // ──────────────────────────────────────────

  async function fetchCatalogs(chatId) {
    const c = getChat(chatId);
    if (c.catalogCache) return c.catalogCache;

    const session = await store.getSession(activeAccount(c).userId);
    if (!session) return null;

    const resp = await vintedFetch(session, '/api/v2/catalogs');
    if (!resp.ok) return null;
    const data = await resp.json();
    c.catalogCache = data.catalogs || [];
    return c.catalogCache;
  }

  function findCatalog(catalogs, id) {
    for (const cat of catalogs) {
      if (cat.id === id) return cat;
      if (cat.catalogs?.length) {
        const found = findCatalog(cat.catalogs, id);
        if (found) return found;
      }
    }
    return null;
  }

  function flattenCatalogs(catalogs, path = '', results = []) {
    for (const cat of catalogs) {
      const fullPath = path ? `${path} > ${cat.title}` : cat.title;
      results.push({ id: cat.id, title: cat.title, path: fullPath, hasChildren: !!(cat.catalogs?.length) });
      if (cat.catalogs?.length) flattenCatalogs(cat.catalogs, fullPath, results);
    }
    return results;
  }

  async function showCategoryPicker(chatId, parentId) {
    const catalogs = await fetchCatalogs(chatId);
    if (!catalogs) return bot.sendMessage(chatId, 'Failed to load categories. Check Vinted session.');

    let items;
    if (parentId) {
      const parent = findCatalog(catalogs, parentId);
      items = parent?.catalogs || [];
    } else {
      items = catalogs;
    }

    if (!items.length) {
      // Leaf node — select it
      if (parentId) return selectCategory(chatId, parentId);
      return bot.sendMessage(chatId, 'No categories found.');
    }

    const rows = items.map(cat => [{
      text: cat.title + (cat.catalogs?.length ? ' >' : ''),
      callback_data: cat.catalogs?.length ? `nav:${cat.id}` : `cat:${cat.id}`
    }]);

    // Add a "search" button and "select this level" if applicable
    const extra = [];
    if (parentId) {
      extra.push({ text: '✅ Select this category', callback_data: `cat:${parentId}` });
      extra.push({ text: '⬅️ Back to top', callback_data: 'pick:cat' });
    }
    extra.push({ text: '🔍 Search by name', callback_data: 'cat:search' });
    rows.push(extra);

    bot.sendMessage(chatId, parentId ? 'Pick a subcategory:' : 'Pick a category:', {
      reply_markup: { inline_keyboard: rows }
    });
  }

  bot.on('callback_query', async (query) => {
    if (query.data === 'cat:search') {
      bot.answerCallbackQuery(query.id);
      const c = getChat(query.message.chat.id);
      c.step = 'searching_cat';
      return bot.sendMessage(query.message.chat.id, 'Type a category name to search (e.g. "t-shirt", "trainers", "dress"):');
    }
  });

  async function searchCategories(chatId, query) {
    const catalogs = await fetchCatalogs(chatId);
    if (!catalogs) return bot.sendMessage(chatId, 'Failed to load categories.');

    const flat = flattenCatalogs(catalogs);
    const q = query.toLowerCase();
    const matches = flat.filter(x => x.path.toLowerCase().includes(q)).slice(0, 8);

    if (!matches.length) {
      return bot.sendMessage(chatId, `No categories match "${query}". Try again or /cancel.`);
    }

    const rows = matches.map(m => [{
      text: m.path,
      callback_data: m.hasChildren ? `nav:${m.id}` : `cat:${m.id}`
    }]);

    const c = getChat(chatId);
    c.step = 'review';

    bot.sendMessage(chatId, `Found ${matches.length} match(es):`, {
      reply_markup: { inline_keyboard: rows }
    });
  }

  async function selectCategory(chatId, catId) {
    const catalogs = await fetchCatalogs(chatId);
    const flat = flattenCatalogs(catalogs || []);
    const match = flat.find(x => x.id === catId);

    const c = getChat(chatId);
    c.listing.catalog_id = catId;
    c.listing.category_name = match ? match.path : `ID: ${catId}`;
    c.listing.size_id = null;
    c.listing.size_name = '';
    c.step = 'review';
    return showSummary(chatId);
  }

  // ──────────────────────────────────────────
  // SIZE PICKER
  // ──────────────────────────────────────────

  async function showSizePicker(chatId) {
    const c = getChat(chatId);
    const session = await store.getSession(activeAccount(c).userId);
    if (!session) return bot.sendMessage(chatId, 'No Vinted session.');

    const resp = await vintedFetch(session, `/api/v2/catalog_sizes?catalog_ids[]=${c.listing.catalog_id}`);
    if (!resp.ok) return bot.sendMessage(chatId, 'Failed to load sizes.');

    const data = await resp.json();
    const groups = data.catalog_sizes || data.sizes || [];

    if (!groups.length) {
      c.listing.size_id = null;
      c.listing.size_name = 'N/A';
      return bot.sendMessage(chatId, 'No sizes available for this category. Continuing without size.');
    }

    // Flatten size groups
    const allSizes = [];
    for (const group of groups) {
      const sizes = group.sizes || [group];
      for (const s of sizes) {
        if (s.id && s.title) allSizes.push({ id: s.id, title: s.title });
      }
    }

    if (!allSizes.length) return bot.sendMessage(chatId, 'No sizes found for this category.');

    // Show as rows of 4
    const rows = [];
    for (let i = 0; i < Math.min(allSizes.length, 32); i += 4) {
      rows.push(allSizes.slice(i, i + 4).map(s => ({
        text: s.title, callback_data: `size:${s.id}`
      })));
    }
    rows.push([{ text: '⏭️ Skip (no size)', callback_data: 'size:0' }]);

    bot.sendMessage(chatId, 'Select size:', { reply_markup: { inline_keyboard: rows } });
  }

  async function selectSize(chatId, sizeId) {
    const c = getChat(chatId);
    if (sizeId === 0) {
      c.listing.size_id = null;
      c.listing.size_name = 'N/A';
    } else {
      c.listing.size_id = sizeId;
      c.listing.size_name = `ID: ${sizeId}`;
    }
    c.step = 'review';
    return showSummary(chatId);
  }

  // ──────────────────────────────────────────
  // PACKAGE SIZE PICKER
  // ──────────────────────────────────────────

  async function showPackageSizePicker(chatId) {
    const c = getChat(chatId);
    const session = await store.getSession(activeAccount(c).userId);
    if (!session) return bot.sendMessage(chatId, 'No Vinted session.');

    const resp = await vintedFetch(session, '/api/v2/package_sizes');
    if (!resp.ok) return bot.sendMessage(chatId, 'Failed to load parcel sizes.');

    const data = await resp.json();
    const sizes = data.package_sizes || [];

    if (!sizes.length) return bot.sendMessage(chatId, 'No parcel sizes available.');

    const rows = sizes.map(s => [{
      text: `${s.title}${s.description ? ' — ' + s.description.slice(0, 30) : ''}`,
      callback_data: `pkg:${s.id}`
    }]);

    bot.sendMessage(chatId, 'Select parcel size:', { reply_markup: { inline_keyboard: rows } });
  }

  async function selectPackageSize(chatId, pkgId) {
    const c = getChat(chatId);
    c.listing.package_size_id = pkgId;
    c.listing.package_size_name = `ID: ${pkgId}`;
    c.step = 'review';
    return showSummary(chatId);
  }

  // ──────────────────────────────────────────
  // BRAND SEARCH
  // ──────────────────────────────────────────

  async function searchBrands(chatId, query) {
    const c = getChat(chatId);
    const session = await store.getSession(activeAccount(c).userId);
    if (!session) return bot.sendMessage(chatId, 'No Vinted session.');

    const resp = await vintedFetch(session, `/api/v2/brands?q=${encodeURIComponent(query)}&per_page=10`);
    if (!resp.ok) return bot.sendMessage(chatId, 'Brand search failed.');

    const data = await resp.json();
    const brands = data.brands || [];

    if (!brands.length) {
      return bot.sendMessage(chatId, `No brands found for "${query}". Try a different name, or type "none" to skip.`);
    }

    const rows = brands.slice(0, 8).map(b => [{
      text: b.title || b.name,
      callback_data: `brand:${b.id}:${(b.title || b.name).slice(0, 40)}`
    }]);
    rows.push([{ text: '🚫 No brand', callback_data: 'brand:0:' }]);

    c.step = 'review';
    bot.sendMessage(chatId, 'Select brand:', { reply_markup: { inline_keyboard: rows } });
  }

  // ──────────────────────────────────────────
  // CREATE LISTING
  // ──────────────────────────────────────────

  async function createListing(chatId) {
    const c = getChat(chatId);
    const L = c.listing;

    if (!L.catalog_id || !L.status_id) {
      return bot.sendMessage(chatId, 'Category and condition are required before posting.');
    }

    c.step = 'posting';
    const statusMsg = await bot.sendMessage(chatId, `Uploading ${c.photos.length} photo(s) to Vinted...`);

    const session = await store.getSession(activeAccount(c).userId);
    if (!session) return bot.sendMessage(chatId, 'Vinted session expired. Sync from Chrome extension and try again.');

    try {
      // ── Step 1: Upload photos ──
      const photoIds = [];
      const domain = session.domain || 'www.vinted.co.uk';

      for (let i = 0; i < c.photos.length; i++) {
        const buffer = Buffer.from(c.photos[i].base64, 'base64');
        const uuid = crypto.randomBytes(16).toString('hex');
        const form = new FormData();
        form.append('photo[type]', 'item');
        form.append('photo[temp_uuid]', uuid);
        form.append('photo[file]', new Blob([buffer], { type: 'image/jpeg' }), 'photo.jpg');

        const uploadResp = await fetch(`https://${domain}/api/v2/photos`, {
          method: 'POST',
          headers: {
            'Cookie': session.cookies,
            'X-CSRF-Token': session.csrf,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          },
          body: form
        });

        if (!uploadResp.ok) {
          const errText = await uploadResp.text().catch(() => '');
          throw new Error(`Photo ${i + 1} upload failed (${uploadResp.status}): ${errText.slice(0, 100)}`);
        }

        const photoData = await uploadResp.json();
        const photoId = photoData.photo?.id || photoData.id;
        if (!photoId) throw new Error(`Photo ${i + 1}: no ID returned`);
        photoIds.push({ id: photoId, orientation: 0 });

        if (i < c.photos.length - 1) await new Promise(r => setTimeout(r, 500));
      }

      await bot.editMessageText(`Photos uploaded. Creating listing...`, {
        chat_id: chatId, message_id: statusMsg.message_id
      });

      // ── Step 2: Create draft ──
      const uuid = crypto.randomBytes(16).toString('hex');
      const draft = {
        id: null,
        currency: 'GBP',
        temp_uuid: uuid,
        title: L.title,
        description: L.description,
        brand_id: L.brand_id || null,
        brand: L.brand || null,
        size_id: L.size_id || null,
        catalog_id: L.catalog_id,
        status_id: L.status_id,
        price: L.price,
        package_size_id: L.package_size_id || null,
        color_ids: L.color1_id ? [L.color1_id] : [],
        assigned_photos: photoIds,
        is_unisex: null,
        isbn: null,
        video_game_rating_id: null,
        shipment_prices: { domestic: null, international: null },
        measurement_length: null,
        measurement_width: null,
        item_attributes: [],
        manufacturer: null,
      };

      const createResp = await vintedFetch(session, '/api/v2/item_upload/drafts', {
        method: 'POST',
        body: { draft, feedback_id: null, parcel: null, upload_session_id: uuid }
      });

      if (!createResp.ok) {
        const err = await createResp.json().catch(() => ({}));
        throw new Error(`Draft creation failed (${createResp.status}): ${JSON.stringify(err).slice(0, 200)}`);
      }

      const createData = await createResp.json();
      const newDraft = createData.draft || createData;
      const draftId = String(newDraft.id || '');
      if (!draftId) throw new Error('No draft ID returned');

      await bot.editMessageText(`Draft created. Publishing...`, {
        chat_id: chatId, message_id: statusMsg.message_id
      });

      // ── Step 3: Small delay then activate ──
      await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));

      // Refresh the draft to get server-side defaults
      const refreshResp = await vintedFetch(session, `/api/v2/item_upload/items/${draftId}`);
      let completionDraft = draft;
      if (refreshResp.ok) {
        const refreshed = (await refreshResp.json()).item;
        if (refreshed) {
          completionDraft = buildCompletionDraft(refreshed, photoIds);
        }
      }
      completionDraft.id = parseInt(draftId);

      const completeResp = await vintedFetch(session, `/api/v2/item_upload/drafts/${draftId}/completion`, {
        method: 'POST',
        body: { draft: completionDraft, feedback_id: null, parcel: null, push_up: false, upload_session_id: uuid }
      });

      if (!completeResp.ok) {
        const errBody = await completeResp.json().catch(() => ({}));
        // Check if there are validation errors we can show
        const errors = errBody.errors || errBody.message_errors || {};
        const errorLines = Object.entries(errors).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`);
        if (errorLines.length) {
          throw new Error(`Vinted validation errors:\n${errorLines.join('\n')}`);
        }
        throw new Error(`Publish failed (${completeResp.status}): ${JSON.stringify(errBody).slice(0, 200)}`);
      }

      // ── Success! ──
      const itemUrl = `https://${domain}/items/${draftId}`;

      await bot.editMessageText(
        `*Item listed successfully\\!*\n\n` +
        `*${esc(L.title)}* — £${L.price}\n\n` +
        `[View on Vinted](${esc(itemUrl)})`,
        { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'MarkdownV2' }
      );

      console.log(`[TG] Listed item ${draftId} for user ${activeAccount(c).username}`);

      // Reset state
      c.step = 'idle';
      c.photos = [];
      c.listing = null;
      c.summaryMsgId = null;
      c.catalogCache = null;

    } catch (e) {
      console.error('[TG] Listing error:', e.message);
      c.step = 'review';
      bot.sendMessage(chatId, `Failed to post: ${e.message}\n\nYou can try again or /cancel.`);
    }
  }

  function buildCompletionDraft(item, photoIds) {
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
      is_unisex: item.is_unisex ?? null,
      status_id: item.status_id || null,
      video_game_rating_id: item.video_game_rating_id || null,
      price: priceVal,
      package_size_id: item.package_size_id || null,
      shipment_prices: { domestic: null, international: null },
      color_ids: [item.color1_id, item.color2_id].filter(Boolean),
      assigned_photos: photoIds || (item.photos || []).map(p => ({ id: p.id, orientation: p.orientation || 0 })),
      measurement_length: item.measurement_length || null,
      measurement_width: item.measurement_width || null,
      item_attributes: item.item_attributes || [],
      manufacturer: item.manufacturer || null,
    };
  }

  // ──────────────────────────────────────────
  // UTILS
  // ──────────────────────────────────────────

  function esc(text) {
    if (!text) return '';
    return String(text).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
  }

  console.log('[TG] All handlers registered');
  return bot;
};
