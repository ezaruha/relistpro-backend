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

// ── Vinted UK package sizes (hardcoded — API often fails) ──
const PACKAGE_SIZES = [
  { id: 1, title: 'Small', desc: 'Up to 2kg, fits in a large letter' },
  { id: 2, title: 'Medium', desc: 'Up to 5kg, shoebox size' },
  { id: 3, title: 'Large', desc: 'Up to 10kg, large box' },
];

// ── Vinted UK categories (hardcoded with real IDs — API often fails) ──
const CATEGORIES = [
  // Women
  { id: 1904, title: 'Women > Tops & T-shirts', keywords: ['top','t-shirt','tshirt','blouse','shirt','tank','vest','cami','crop top'] },
  { id: 1907, title: 'Women > Dresses', keywords: ['dress','midi','maxi','mini dress','gown','sundress'] },
  { id: 1913, title: 'Women > Jumpers & Cardigans', keywords: ['jumper','sweater','cardigan','pullover','knitwear','knit'] },
  { id: 1911, title: 'Women > Coats & Jackets', keywords: ['coat','jacket','blazer','bomber','parka','puffer','denim jacket','raincoat','trench'] },
  { id: 1905, title: 'Women > Trousers', keywords: ['trousers','pants','chinos','leggings','joggers','cargo'] },
  { id: 1903, title: 'Women > Jeans', keywords: ['jeans','denim','skinny jeans','mom jeans','wide leg jeans','straight jeans'] },
  { id: 1909, title: 'Women > Skirts', keywords: ['skirt','mini skirt','midi skirt','maxi skirt','pleated'] },
  { id: 1906, title: 'Women > Shorts', keywords: ['shorts','hot pants','denim shorts'] },
  { id: 1918, title: 'Women > Hoodies & Sweatshirts', keywords: ['hoodie','sweatshirt','hoody'] },
  { id: 16, title: 'Women > Shoes', keywords: ['shoes','heels','boots','sandals','trainers','sneakers','flats','loafers','pumps','platforms'] },
  { id: 2066, title: 'Women > Bags', keywords: ['bag','handbag','purse','tote','crossbody','clutch','backpack','shoulder bag','rucksack'] },
  { id: 1908, title: 'Women > Activewear', keywords: ['activewear','sportswear','gym','running','yoga','sports bra','leggings'] },
  { id: 1927, title: 'Women > Swimwear', keywords: ['swimwear','bikini','swimsuit','bathing suit','swimming'] },
  { id: 1929, title: 'Women > Lingerie', keywords: ['lingerie','bra','underwear','knickers','pyjamas','nightwear','sleepwear'] },
  { id: 2048, title: 'Women > Accessories', keywords: ['accessory','scarf','hat','gloves','belt','jewellery','jewelry','watch','sunglasses','hair'] },
  // Men
  { id: 2050, title: 'Men > T-shirts', keywords: ['men t-shirt','men tshirt','mens top','mens tee'] },
  { id: 2052, title: 'Men > Shirts', keywords: ['men shirt','mens shirt','dress shirt','casual shirt'] },
  { id: 2056, title: 'Men > Jumpers & Cardigans', keywords: ['men jumper','mens sweater','men cardigan','men knitwear'] },
  { id: 2055, title: 'Men > Coats & Jackets', keywords: ['men coat','mens jacket','men blazer','men puffer','men parka','men bomber'] },
  { id: 2051, title: 'Men > Trousers', keywords: ['men trousers','mens pants','men chinos','men joggers','mens cargo'] },
  { id: 2049, title: 'Men > Jeans', keywords: ['men jeans','mens jeans','mens denim'] },
  { id: 2053, title: 'Men > Shorts', keywords: ['men shorts','mens shorts','swim shorts'] },
  { id: 2058, title: 'Men > Hoodies & Sweatshirts', keywords: ['men hoodie','mens sweatshirt','men hoody','mens hoodie'] },
  { id: 5, title: 'Men > Shoes', keywords: ['men shoes','mens trainers','mens sneakers','mens boots','mens sandals','mens loafers'] },
  { id: 2059, title: 'Men > Bags', keywords: ['men bag','mens backpack','mens rucksack','gym bag','messenger bag'] },
  { id: 2054, title: 'Men > Activewear', keywords: ['men sportswear','mens activewear','mens gym','men running','football shirt','jersey'] },
  { id: 2070, title: 'Men > Accessories', keywords: ['men accessory','mens hat','mens belt','mens wallet','mens scarf','tie','cufflinks'] },
  // Kids
  { id: 381, title: 'Kids > Girls clothing', keywords: ['girls','girl dress','girls top','girls coat','girls school'] },
  { id: 411, title: 'Kids > Boys clothing', keywords: ['boys','boy shirt','boys top','boys coat','boys school'] },
  { id: 459, title: 'Kids > Baby clothing', keywords: ['baby','babygrow','onesie','romper','newborn','toddler','infant'] },
  { id: 495, title: 'Kids > Shoes', keywords: ['kids shoes','children shoes','baby shoes','school shoes'] },
  // Home & other
  { id: 1791, title: 'Home > Home textile', keywords: ['blanket','pillow','cushion','towel','bedding','curtain','rug','duvet','throw'] },
  { id: 1796, title: 'Home > Decoration', keywords: ['decoration','ornament','vase','candle','frame','mirror','wall art','home decor'] },
  { id: 1786, title: 'Home > Tableware', keywords: ['plate','mug','cup','bowl','glass','kitchen','cookware','cutlery'] },
  { id: 2368, title: 'Entertainment > Books', keywords: ['book','novel','textbook','reading','manga','comic'] },
  { id: 2379, title: 'Entertainment > Video games', keywords: ['game','video game','console','playstation','xbox','nintendo','ps5','ps4'] },
  { id: 2373, title: 'Entertainment > Music & Video', keywords: ['vinyl','record','cd','dvd','blu-ray','cassette'] },
  { id: 2425, title: 'Pets > Pet accessories', keywords: ['pet','dog','cat','collar','lead','pet bed','pet toy'] },
  { id: 1774, title: 'Kids > Strollers & car seats', keywords: ['stroller','pushchair','pram','car seat','buggy','travel system','baby carrier','highchair'] },
  { id: 1775, title: 'Kids > Toys', keywords: ['toy','teddy','doll','lego','puzzle','board game','plush','action figure'] },
  { id: 1778, title: 'Kids > Nursery', keywords: ['nursery','cot','crib','baby monitor','changing mat','baby bath','steriliser'] },
  { id: 2380, title: 'Electronics', keywords: ['phone','tablet','laptop','headphones','speaker','camera','charger','smartwatch','iphone','samsung','airpods'] },
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

// Tracks which chats have been loaded from DB this session
const loadedFromDb = new Set();

// Get the active account for a chat (sugar)
function activeAccount(c) {
  if (!c.accounts || !c.accounts.length) return null;
  if (c.activeIdx < 0 || c.activeIdx >= c.accounts.length) {
    c.activeIdx = 0; // auto-fix bad index
  }
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
module.exports = function initTelegram({ store, vintedFetch, verifyPassword, app, db }) {

  // ── Refresh Vinted session server-side (get fresh CSRF + cookies) ──
  async function refreshVintedSession(session, userId) {
    const domain = session.domain || 'www.vinted.co.uk';
    try {
      // 1) Try the auth refresh endpoint (like DOTB does in-browser)
      const refreshResp = await fetch(`https://${domain}/web/api/auth/refresh`, {
        method: 'POST',
        headers: {
          'Cookie': session.cookies,
          'X-CSRF-Token': session.csrf,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
        },
        redirect: 'manual', // capture Set-Cookie before redirect
      });

      // Grab new cookies from the response
      const setCookies = refreshResp.headers.getSetCookie?.() || [];
      if (setCookies.length) {
        // Parse existing cookies into a map
        const cookieMap = {};
        session.cookies.split(';').forEach(c => {
          const [k, ...v] = c.trim().split('=');
          if (k) cookieMap[k.trim()] = v.join('=');
        });
        // Update with new cookies from response
        for (const sc of setCookies) {
          const [pair] = sc.split(';');
          const [k, ...v] = pair.split('=');
          if (k) cookieMap[k.trim()] = v.join('=');
        }
        session.cookies = Object.entries(cookieMap).map(([k,v]) => `${k}=${v}`).join('; ');

        // Try to extract new CSRF from a page fetch
        try {
          const pageResp = await fetch(`https://${domain}/`, {
            headers: { 'Cookie': session.cookies, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          });
          const html = await pageResp.text();
          const csrfMatch = html.match(/"CSRF_TOKEN\\?":\\?"([^"\\]+)\\?"/);
          if (csrfMatch) {
            session.csrf = csrfMatch[1];
            console.log('[TG] Refreshed CSRF token from page');
          }
          // Also grab cookies from this response
          const pageCookies = pageResp.headers.getSetCookie?.() || [];
          for (const sc of pageCookies) {
            const [pair] = sc.split(';');
            const [k, ...v] = pair.split('=');
            if (k) cookieMap[k.trim()] = v.join('=');
          }
          session.cookies = Object.entries(cookieMap).map(([k,v]) => `${k}=${v}`).join('; ');
        } catch {}

        // Save updated session
        await store.setSession(userId, session);
        console.log(`[TG] Session refreshed for user ${userId}`);
      }
    } catch (e) {
      console.log('[TG] Session refresh failed:', e.message);
    }
    return session;
  }

  // ── Persist chat accounts to DB so logins survive restarts ──
  // ── Save full chat state to DB (accounts + active listing + photos) ──
  async function saveChatState(chatId) {
    if (!db || !db.hasDb()) return;
    const c = chats.get(chatId);
    if (!c) return;
    try {
      const accts = JSON.stringify(c.accounts || []);
      console.log(`[TG] Saving state: chat=${chatId} accounts=${c.accounts?.length || 0} idx=${c.activeIdx} step=${c.step}`);
      await db.query(
        `INSERT INTO rp_telegram_chats (chat_id, accounts, active_idx, listing, photos, wizard_idx, step)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (chat_id) DO UPDATE SET
           accounts=$2, active_idx=$3, listing=$4, photos=$5,
           wizard_idx=$6, step=$7, updated_at=NOW()`,
        [
          String(chatId),
          accts,
          c.activeIdx ?? -1,
          c.listing ? JSON.stringify(c.listing) : null,
          c.photos?.length ? JSON.stringify(c.photos) : null,
          c.wizardIdx ?? 0,
          c.step || 'idle'
        ]
      );
      console.log(`[TG] State saved OK for chat ${chatId}`);
    } catch (e) { console.error('[TG] Save state error:', e.message); }
  }

  // Shortcut: save just accounts (lightweight, no photos)
  async function saveChatAccounts(chatId, accounts, activeIdx) {
    if (!db || !db.hasDb()) return;
    try {
      await db.query(
        `INSERT INTO rp_telegram_chats (chat_id, accounts, active_idx)
         VALUES ($1, $2, $3)
         ON CONFLICT (chat_id) DO UPDATE SET accounts=$2, active_idx=$3, updated_at=NOW()`,
        [String(chatId), JSON.stringify(accounts), activeIdx]
      );
    } catch (e) { console.error('[TG] Save chat error:', e.message); }
  }

  async function loadChatState(chatId) {
    if (!db || !db.hasDb()) return null;
    try {
      const r = await db.query(
        'SELECT accounts, active_idx, listing, photos, wizard_idx, step FROM rp_telegram_chats WHERE chat_id=$1',
        [String(chatId)]
      );
      if (r.rows[0]) {
        const row = r.rows[0];
        // pg returns JSONB as parsed objects, but handle string fallback too
        const parseJsonb = (val, fallback) => {
          if (!val) return fallback;
          if (typeof val === 'string') { try { return JSON.parse(val); } catch { return fallback; } }
          return val;
        };
        const result = {
          accounts: parseJsonb(row.accounts, []),
          activeIdx: row.active_idx,
          listing: parseJsonb(row.listing, null),
          photos: parseJsonb(row.photos, null),
          wizardIdx: row.wizard_idx ?? 0,
          step: row.step || 'idle'
        };
        console.log(`[TG] Loaded state: chat=${chatId} accounts=${result.accounts.length} idx=${result.activeIdx} step=${result.step}`);
        return result;
      }
      console.log(`[TG] No saved state for chat ${chatId}`);
    } catch (e) { console.error('[TG] Load state error:', e.message); }
    return null;
  }

  // Init the telegram_chats table (adds new columns if needed)
  async function initTelegramTable() {
    if (!db || !db.hasDb()) return;
    try {
      await db.query(`
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
      // Add columns if table already exists without them
      await db.query(`ALTER TABLE rp_telegram_chats ADD COLUMN IF NOT EXISTS listing JSONB`);
      await db.query(`ALTER TABLE rp_telegram_chats ADD COLUMN IF NOT EXISTS photos JSONB`);
      await db.query(`ALTER TABLE rp_telegram_chats ADD COLUMN IF NOT EXISTS wizard_idx INTEGER DEFAULT 0`);
      await db.query(`ALTER TABLE rp_telegram_chats ADD COLUMN IF NOT EXISTS step TEXT DEFAULT 'idle'`);
      console.log('[TG] Chat persistence table ready');
    } catch (e) { console.error('[TG] Table init error:', e.message); }
  }
  initTelegramTable();

  // Load full chat state from DB if not yet loaded this session
  async function ensureLoaded(chatId) {
    if (loadedFromDb.has(chatId)) return;
    loadedFromDb.add(chatId);
    const saved = await loadChatState(chatId);
    if (!saved) return;
    const c = getChat(chatId);
    if (saved.accounts.length && !c.accounts.length) {
      c.accounts = saved.accounts;
      c.activeIdx = saved.activeIdx ?? 0;
      console.log(`[TG] Restored ${c.accounts.length} account(s) for chat ${chatId}`);
    }
    if (saved.listing && !c.listing) {
      c.listing = saved.listing;
      c.photos = saved.photos || [];
      c.wizardIdx = saved.wizardIdx ?? 0;
      c.step = saved.step || 'idle';
      console.log(`[TG] Restored listing + ${(c.photos||[]).length} photo(s) for chat ${chatId}`);
    }
  }
  let TelegramBot;
  try { TelegramBot = require('node-telegram-bot-api'); } catch {
    console.log('[TG] node-telegram-bot-api not installed — bot disabled');
    return;
  }

  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!BOT_TOKEN) { console.log('[TG] No TELEGRAM_BOT_TOKEN — bot disabled'); return; }

  const WEBHOOK_URL = process.env.TELEGRAM_WEBHOOK_URL;
  let botMode = 'polling';

  // Use polling — works reliably on Railway without needing webhook URL config
  const bot = new TelegramBot(BOT_TOKEN, {
    polling: {
      autoStart: true,
      params: { timeout: 30 }
    }
  });

  // If webhook URL is set, switch to webhook mode instead
  if (WEBHOOK_URL) {
    bot.stopPolling();
    bot.setWebHook(WEBHOOK_URL);
    app.post('/api/telegram/webhook', (req, res) => {
      bot.processUpdate(req.body);
      res.sendStatus(200);
    });
    botMode = 'webhook';
  }

  // Error handling — log but don't crash
  bot.on('polling_error', (err) => {
    console.error('[TG] Polling error:', err.code, err.message);
  });
  bot.on('error', (err) => {
    console.error('[TG] Error:', err.message);
  });

  // Verify bot token works
  bot.getMe().then((me) => {
    console.log(`[TG] Bot started (${botMode}) — @${me.username}`);
  }).catch((err) => {
    console.error('[TG] Bot token invalid or network error:', err.message);
  });

  // Debug endpoint to check bot status
  app.get('/api/telegram/status', (req, res) => {
    res.json({ ok: true, mode: botMode, token_set: !!BOT_TOKEN, webhook: WEBHOOK_URL || null });
  });

  // ── Register command menu (shows in Telegram's command list) ──
  bot.setMyCommands([
    { command: 'start',  description: 'Welcome message & setup guide' },
    { command: 'login',  description: 'Connect your RelistPro account' },
    { command: 'switch', description: 'Switch between linked Vinted accounts' },
    { command: 'status', description: 'Check connection & Vinted session' },
    { command: 'cancel', description: 'Abort current listing' },
    { command: 'logout', description: 'Disconnect current account' },
    { command: 'help',   description: 'Show all commands' },
  ]).then(() => console.log('[TG] Commands menu registered'));

  // ──────────────────────────────────────────
  // COMMANDS
  // ──────────────────────────────────────────

  bot.onText(/\/start(?:@\S+)?/, async (msg) => {
    await ensureLoaded(msg.chat.id);
    bot.sendMessage(msg.chat.id,
      `Welcome to *RelistPro Bot* 🛍️\n\n` +
      `List items on Vinted in seconds — just send photos\\!\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `*How it works:*\n\n` +
      `1️⃣ *Connect your account*\n` +
      `Tap /login — I'll ask for your username and password step by step\n` +
      `\\(Use your RelistPro account — register via the Chrome extension first\\)\n\n` +
      `2️⃣ *Send photos*\n` +
      `Take photos of your item and send them here \\(up to 20 photos\\)\\.  You can add a caption like "Nike hoodie size M £25"\n\n` +
      `3️⃣ *AI generates your listing*\n` +
      `Title, description, price, brand, condition — all auto\\-generated\\. You review and edit anything you want\\.\n\n` +
      `4️⃣ *Pick category \\& post*\n` +
      `Choose the Vinted category, size, parcel size, then hit *POST TO VINTED*\\.\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `*Commands:*\n` +
      `/login — connect your account\n` +
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

  bot.onText(/\/help(?:@\S+)?/, async (msg) => {
    await ensureLoaded(msg.chat.id);
    const c = getChat(msg.chat.id);
    ensureMulti(c);
    const connected = activeAccount(c);

    let text = `*RelistPro Bot — Commands*\n\n`;

    if (!connected) {
      text += `⚠️ *Not connected yet\\!*\n` +
        `Tap /login and I'll ask for your details\n\n`;
    } else {
      text += `✅ Connected as *${esc(connected.username)}*\n\n`;
    }

    text += `/login — connect a RelistPro account\n` +
      `/switch — switch between linked accounts\n` +
      `/status — check connection \\& Vinted session\n` +
      `/cancel — abort current listing\n` +
      `/logout — disconnect current account\n` +
      `/logout all — disconnect all accounts\n\n` +
      `*To list an item:* just send photos\\!`;

    bot.sendMessage(msg.chat.id, text, { parse_mode: 'MarkdownV2' });
  });

  bot.onText(/\/login(?:@\S+)?(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    await ensureLoaded(chatId);
    const c = getChat(chatId);
    ensureMulti(c);

    const args = (match[1] || '').trim().split(/\s+/).filter(Boolean);

    if (args.length >= 2) {
      // Inline login: /login username password
      return doLogin(chatId, args[0], args[1]);
    }

    // Conversational login — ask for username first
    c.step = 'login_username';
    bot.sendMessage(chatId, 'What\'s your RelistPro username?');
  });

  async function doLogin(chatId, username, password) {
    const c = getChat(chatId);
    ensureMulti(c);

    try {
      const user = await store.getUser(username);
      if (!user) {
        c.step = 'idle';
        return bot.sendMessage(chatId, 'User not found. Register via the Chrome extension first, then come back here.');
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

      // Fetch Vinted profile to show the real Vinted username
      let vintedName = null;
      if (session.memberId) {
        try {
          // Try refreshing session first to ensure fresh cookies
          const freshSession = await refreshVintedSession(session, user.id);
          const profileResp = await vintedFetch(freshSession, `/api/v2/users/${session.memberId}`);
          if (profileResp.ok) {
            const profileData = await profileResp.json();
            vintedName = profileData.user?.login || profileData.user?.username || null;
          }
        } catch (e) {
          console.log('[TG] Profile fetch failed:', e.message);
        }
      }

      // Check if already linked
      const existing = c.accounts.findIndex(a => a.username === username);
      if (existing >= 0) {
        c.accounts[existing].token = user.token;
        c.accounts[existing].userId = user.id;
        c.accounts[existing].vintedName = vintedName || c.accounts[existing].vintedName;
        c.accounts[existing].vintedDomain = session.domain;
        c.accounts[existing].memberId = session.memberId;
        c.activeIdx = existing;
      } else {
        c.accounts.push({ userId: user.id, token: user.token, username: user.username, vintedName, vintedDomain: session.domain, memberId: session.memberId });
        c.activeIdx = c.accounts.length - 1;
      }
      c.step = 'idle';
      await saveChatState(chatId);
      console.log(`[TG] Login complete: chat=${chatId} accounts=${c.accounts.length} idx=${c.activeIdx} user=${username}`);

      const vintedLabel = vintedName || username;
      const countMsg = c.accounts.length > 1 ? `\n${c.accounts.length} accounts linked\\. Use /switch to change\\.` : '';
      bot.sendMessage(chatId,
        `✅ Logged in as *${esc(vintedLabel)}*\n` +
        `Vinted: ${esc(session.domain)}\n` +
        `${countMsg}\n` +
        `📸 Send me photos of an item to list on *${esc(vintedLabel)}*'s Vinted\\!`,
        { parse_mode: 'MarkdownV2' });
    } catch (e) {
      console.error('[TG] Login error:', e.message);
      c.step = 'idle';
      bot.sendMessage(chatId, 'Login failed: ' + e.message);
    }
  }

  bot.onText(/\/status(?:@\S+)?/, async (msg) => {
    await ensureLoaded(msg.chat.id);
    const c = getChat(msg.chat.id);
    ensureMulti(c);
    if (!c.accounts.length) return bot.sendMessage(msg.chat.id, 'Not connected. Use /login first.');

    const lines = [];
    for (let i = 0; i < c.accounts.length; i++) {
      const a = c.accounts[i];
      const session = await store.getSession(a.userId);
      const active = i === c.activeIdx ? ' [active]' : '';
      const vintedLabel = a.vintedName || session?.memberId || '?';
      const vinted = session
        ? `Vinted: ${vintedLabel} (${session.domain})`
        : 'NO SESSION — sync from Chrome';
      lines.push(`${i + 1}. ${a.username}${active}\n   ${vinted}`);
    }
    bot.sendMessage(msg.chat.id, `Linked accounts:\n\n${lines.join('\n\n')}`);
  });

  bot.onText(/\/switch(?:@\S+)?/, async (msg) => {
    const chatId = msg.chat.id;
    await ensureLoaded(chatId);
    const c = getChat(chatId);
    ensureMulti(c);
    if (c.accounts.length < 2) return bot.sendMessage(chatId, c.accounts.length ? 'Only one account linked. Use /login to add another.' : 'No accounts linked. Use /login first.');

    const rows = [];
    for (const [i, a] of c.accounts.entries()) {
      const vintedLabel = a.vintedName ? `${a.vintedName} @ ${a.vintedDomain || '?'}` : a.username;
      const label = i === c.activeIdx ? `${vintedLabel} [current]` : vintedLabel;
      rows.push([{ text: label, callback_data: `sw:${i}` }]);
    }
    bot.sendMessage(chatId, 'Switch to which account?', { reply_markup: { inline_keyboard: rows } });
  });

  bot.onText(/\/logout(?:@\S+)?(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    await ensureLoaded(chatId);
    const c = getChat(chatId);
    ensureMulti(c);
    const arg = (match[1] || '').trim().toLowerCase();

    if (arg === 'all') {
      chats.delete(chatId);
      saveChatAccounts(chatId, [], -1);
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
    saveChatAccounts(chatId, c.accounts, c.activeIdx);
  });

  bot.onText(/\/cancel(?:@\S+)?/, async (msg) => {
    await ensureLoaded(msg.chat.id);
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
    await ensureLoaded(chatId);
    const c = getChat(chatId);
    ensureMulti(c);
    console.log(`[TG] Photo received: chat=${chatId} accounts=${c.accounts?.length} idx=${c.activeIdx} step=${c.step}`);
    // If no account in memory, force a fresh DB load (in case save was delayed)
    if (!activeAccount(c) && db && db.hasDb()) {
      loadedFromDb.delete(chatId);
      await ensureLoaded(chatId);
      console.log(`[TG] Force reload: accounts=${c.accounts?.length} idx=${c.activeIdx}`);
    }
    if (!activeAccount(c)) return bot.sendMessage(chatId, 'Not connected. Use /login first.');

    // If in review with no photos, accept photos for the current listing
    if (c.step === 'review' && (!c.photos || !c.photos.length)) {
      c.step = 'collecting_photos_for_review';
      c.photos = [];
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
    }

    if (c.step !== 'collecting_photos' && c.step !== 'collecting_photos_for_review') {
      return bot.sendMessage(chatId, 'Finish or /cancel your current listing first.');
    }

    // Download highest-res version
    const photo = msg.photo[msg.photo.length - 1];
    try {
      const fileLink = await bot.getFileLink(photo.file_id);
      console.log(`[TG] Downloading photo: ${fileLink}`);
      const resp = await fetch(fileLink, {
        headers: { 'User-Agent': 'RelistPro/1.0' }
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buffer = Buffer.from(await resp.arrayBuffer());
      if (!buffer.length) throw new Error('Empty file');
      c.photos.push({ base64: buffer.toString('base64'), fileId: photo.file_id });
      console.log(`[TG] Photo downloaded: ${buffer.length} bytes`);
    } catch (e) {
      console.error('[TG] Photo download error:', e.message);
      return bot.sendMessage(chatId, `Can't download the photo (${e.message}). Try sending it again.`);
    }

    if (msg.caption) c.caption = msg.caption;

    // Debounce — wait for more photos in media group
    if (c.photoTimer) clearTimeout(c.photoTimer);
    if (c.step === 'collecting_photos_for_review') {
      // Photos for an existing listing — go back to review, no AI re-analysis
      c.photoTimer = setTimeout(async () => {
        c.step = 'review';
        saveChatState(chatId);
        await bot.sendMessage(chatId, `📸 Got ${c.photos.length} photo(s) for your listing. Ready to post!`);
        showSummary(chatId);
      }, 2000);
    } else {
      c.photoTimer = setTimeout(() => processPhotos(chatId), 2000);
    }
  });

  // ──────────────────────────────────────────
  // PROCESS PHOTOS → AI ANALYSIS
  // ──────────────────────────────────────────

  // ── Step-by-step wizard order ──
  const WIZARD_STEPS = ['title', 'description', 'price', 'category', 'size', 'condition', 'colour', 'brand', 'parcel', 'confirm'];

  async function processPhotos(chatId) {
    const c = getChat(chatId);
    c.step = 'analyzing';
    const acctName = activeAccount(c)?.vintedName || activeAccount(c)?.username || '';
    const acctInfo = acctName ? ` for ${acctName}` : '';

    await bot.sendMessage(chatId,
      `📸 Got ${c.photos.length} photo(s)${acctInfo}. Analyzing with AI — detecting brand, condition, estimating price...\n\nThis takes a few seconds.`
    );

    try {
      // Send up to 5 photos to AI (balances detection quality vs cost)
      const photosForAI = c.photos.slice(0, 5).map(p => p.base64);
      const analysis = await analyzeWithAI(photosForAI, c.caption);

      // Map condition text to status_id
      const condMatch = CONDITIONS.find(x =>
        x.label.toLowerCase() === (analysis.condition || '').toLowerCase()
      );

      // Auto-match color
      let colorId = null, colorName = analysis.color || '';
      if (analysis.color) {
        const colorMatch = COLORS.find(x => x.label.toLowerCase() === analysis.color.toLowerCase());
        if (colorMatch) { colorId = colorMatch.id; colorName = colorMatch.label; }
      }

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
        size_hint: analysis.size_hint || '',
        color: colorName,
        color1_id: colorId,
        material: analysis.material || '',
        package_size_id: null,
        package_size_name: '',
      };

      // Start wizard at step 0 (title)
      c.wizardIdx = 0;
      saveChatState(chatId);
      await askWizardStep(chatId);
    } catch (e) {
      console.error('[TG] AI analysis error:', e.message);
      c.step = 'idle';
      bot.sendMessage(chatId, 'AI analysis failed: ' + e.message + '\nTry sending the photos again.');
    }
  }

  // ── Ask the current wizard step ──
  async function askWizardStep(chatId) {
    const c = getChat(chatId);
    const L = c.listing;
    const stepName = WIZARD_STEPS[c.wizardIdx];

    if (stepName === 'title') {
      c.step = 'wiz_title';
      let detected = '';
      if (L.brand) detected += `  Brand: ${L.brand}\n`;
      if (L.size_hint) detected += `  Size: ${L.size_hint}\n`;
      if (L.material) detected += `  Material: ${L.material}\n`;
      if (L.color) detected += `  Colour: ${L.color}\n`;
      if (detected) detected = `\nDetected:\n${detected}`;
      return bot.sendMessage(chatId,
        `📝 Step 1/9 — Title\n\n` +
        `AI suggestion:\n"${L.title}"${detected}\n\n` +
        `Tap Accept to keep, Edit to tweak with AI, or just type a new title below:`,
        { reply_markup: { inline_keyboard: [
          [{ text: '✅ Accept', callback_data: 'wiz:accept' }, { text: '✏️ Edit', callback_data: 'wiz:edit:title' }],
          [{ text: '❌ Cancel listing', callback_data: 'cancel' }]
        ]}}
      );
    }

    if (stepName === 'description') {
      c.step = 'wiz_description';
      return bot.sendMessage(chatId,
        `📝 Step 2/9 — Description\n\n` +
        `AI suggestion:\n"${L.description}"\n\n` +
        `Tap Accept to keep, Edit to tweak (e.g. "make shorter", "add that it's new"), or type a full replacement:`,
        { reply_markup: { inline_keyboard: [
          [{ text: '✅ Accept', callback_data: 'wiz:accept' }, { text: '✏️ Edit', callback_data: 'wiz:edit:desc' }],
        ]}}
      );
    }

    if (stepName === 'price') {
      c.step = 'wiz_price';
      return bot.sendMessage(chatId,
        `💰 Step 3/9 — Price\n\n` +
        `AI suggestion: £${L.price}\n\n` +
        `Tap Accept, Edit (e.g. "lower it", "make it £20"), or type a price:`,
        { reply_markup: { inline_keyboard: [
          [{ text: `✅ Accept £${L.price}`, callback_data: 'wiz:accept' }, { text: '✏️ Edit', callback_data: 'wiz:edit:price' }],
        ]}}
      );
    }

    if (stepName === 'category') {
      c.step = 'wiz_category';
      try {
        // Always search — uses hardcoded categories (no API needed)
        const searchTerm = L.category_hint
          ? L.category_hint.split('/').filter(Boolean).pop() || L.title
          : (L.title || '').split(' ').slice(0, 2).join(' ');
        if (searchTerm) return await searchCategories(chatId, searchTerm);
        return bot.sendMessage(chatId, '📂 Step 4/9 — Category\n\nType a category name below (e.g. "t-shirt", "hoodie", "trainers", "stroller"):');
      } catch (e) {
        console.error('[TG] Category step error:', e.message);
        return bot.sendMessage(chatId, '📂 Step 4/9 — Category\n\nType a category name below (e.g. "t-shirt", "hoodie", "trainers", "stroller"):');
      }
    }

    if (stepName === 'size') {
      c.step = 'wiz_size';
      if (!L.catalog_id) {
        c.wizardIdx++;
        return askWizardStep(chatId);
      }
      return showSizePicker(chatId);
    }

    if (stepName === 'condition') {
      c.step = 'wiz_condition';
      const keyboard = CONDITIONS.map(x => ([{
        text: `${x.emoji} ${x.label}${x.id === L.status_id ? ' ✓' : ''}`,
        callback_data: `cond:${x.id}`
      }]));
      return bot.sendMessage(chatId,
        `📦 Step 6/9 — Condition\n\nAI detected: ${L.condition}\n\nTap a button below to select the item's condition:`,
        { reply_markup: { inline_keyboard: keyboard } }
      );
    }

    if (stepName === 'colour') {
      c.step = 'wiz_colour';
      const rows = [];
      for (let i = 0; i < COLORS.length; i += 3) {
        rows.push(COLORS.slice(i, i + 3).map(x => ({
          text: x.label + (x.id === L.color1_id ? ' ✓' : ''), callback_data: `color:${x.id}`
        })));
      }
      if (L.color1_id) rows.push([{ text: '✅ Keep: ' + L.color, callback_data: 'wiz:accept' }]);
      rows.push([{ text: '⏭️ Skip', callback_data: 'wiz:accept' }]);
      return bot.sendMessage(chatId,
        `🎨 Step 7/9 — Colour\n\nAI detected: ${L.color || 'Not set'}\n\nTap a colour below, or skip:`,
        { reply_markup: { inline_keyboard: rows } }
      );
    }

    if (stepName === 'brand') {
      c.step = 'wiz_brand';
      const kb = [];
      if (L.brand) kb.push([{ text: `✅ Keep: ${L.brand}`, callback_data: 'wiz:accept' }]);
      kb.push([{ text: '⏭️ No brand / Skip', callback_data: 'wiz:accept' }]);
      return bot.sendMessage(chatId,
        `🏷️ Step 8/9 — Brand\n\nAI detected: ${L.brand || 'None'}\n\nTap Keep/Skip, or type a brand name below to search:`,
        { reply_markup: { inline_keyboard: kb } }
      );
    }

    if (stepName === 'parcel') {
      c.step = 'wiz_parcel';
      return showPackageSizePicker(chatId);
    }

    if (stepName === 'confirm') {
      c.step = 'review';
      return showSummary(chatId);
    }
  }

  // ── Advance wizard to next step ──
  function wizardNext(chatId) {
    const c = getChat(chatId);
    c.wizardIdx = (c.wizardIdx || 0) + 1;
    saveChatState(chatId);
    if (c.wizardIdx >= WIZARD_STEPS.length) {
      c.step = 'review';
      return showSummary(chatId);
    }
    return askWizardStep(chatId);
  }

  // ──────────────────────────────────────────
  // AI ANALYSIS
  // ──────────────────────────────────────────

  async function analyzeWithAI(photos, caption) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured on server');

    const captionCtx = caption ? `\n\nThe seller provided this info: "${caption}"  — use it to fill in details like brand, size, price, etc. Trust the seller's info over visual guesses.` : '';

    const imageBlocks = photos.slice(0, 5).map(p => ({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: typeof p === 'string' ? p : p.base64 || p }
    }));

    const systemPrompt = `Expert Vinted UK reseller. Create listings that sell fast.

TITLE: Max 60 chars. Format: [Brand] [Item] [Detail] [Size]. Search-friendly words only. Brand first if visible.
DESCRIPTION: 3-5 lines. Hook, details (material/fit), condition, hashtags. No filler. No "This is a...".
PRICE: Vinted UK used prices, NOT retail. Fast fashion £3-12, mid-range £8-20, premium £15-40, sportswear £10-35, designer £40-200+. NWT=60-70% retail, very good=30-50%, good=20-35%.
CONDITION: Check photos for wear. NWT=visible tags only, NwoT=unworn, Very good=minimal wear, Good=some wear, Satisfactory=visible damage.
BRAND: Check labels, logos, tags in ALL photos. Guess if partial logo visible. null if unidentifiable.
CATEGORY: Vinted path like "women/clothing/tops" or "kids/strollers". Be specific.
COLOR: One of: Black,White,Grey,Blue,Red,Green,Yellow,Pink,Orange,Purple,Brown,Beige,Cream,Multicolour.`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: [
            ...imageBlocks,
            { type: 'text', text:
              `Analyze ${imageBlocks.length > 1 ? 'these photos' : 'this photo'} and create a Vinted listing.${captionCtx}\n\n` +
              `Return ONLY valid JSON (no markdown, no backticks, no explanation):\n` +
              `{\n` +
              `  "title": "searchable title following the rules above",\n` +
              `  "description": "4-6 line description with hashtags, following the rules above",\n` +
              `  "suggested_price": <realistic used price in GBP as a number>,\n` +
              `  "brand": "detected brand name or null",\n` +
              `  "condition": "New with tags|New without tags|Very good|Good|Satisfactory",\n` +
              `  "category_hint": "vinted/category/path",\n` +
              `  "color": "one of the allowed colors",\n` +
              `  "material": "fabric/material if identifiable or null",\n` +
              `  "size_hint": "detected size from tags/labels or null"\n` +
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
  // AI EDIT — applies user's edit instruction to a field
  // ──────────────────────────────────────────

  async function aiEdit(field, currentValue, instruction) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system: `Edit a Vinted listing ${field}. Apply the user's instruction. Return ONLY the updated value, nothing else.`,
        messages: [{
          role: 'user',
          content: `Current ${field}: ${currentValue}\n\nUser wants: ${instruction}\n\nReturn only the updated ${field}:`
        }]
      })
    });

    const data = await resp.json();
    const result = data.content?.[0]?.text?.trim();
    if (!result) throw new Error('AI returned empty');
    return result;
  }

  // ──────────────────────────────────────────
  // SUMMARY DISPLAY
  // ──────────────────────────────────────────

  async function showSummary(chatId) {
    const c = getChat(chatId);
    const L = c.listing;

    if (!L) {
      c.step = 'idle';
      saveChatState(chatId);
      return bot.sendMessage(chatId, 'No listing in progress. Send photos to start a new one.');
    }

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
      `*Price:* £${L.price}\n` +
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
      text += `\n🟢 *All fields complete\\!* Tap POST TO VINTED to list your item, or edit any field below\\.`;
    }

    const keyboard = [
      [{ text: '✏️ Title', callback_data: 'edit:title' }, { text: '✏️ Description', callback_data: 'edit:desc' }, { text: '💰 Price', callback_data: 'edit:price' }],
      [{ text: '📂 Category', callback_data: 'pick:cat' }, { text: '📏 Size', callback_data: 'pick:size' }, { text: '🏷️ Brand', callback_data: 'edit:brand' }],
      [{ text: '🎨 Colour', callback_data: 'pick:color' }, { text: '📦 Condition', callback_data: 'pick:cond' }, { text: '📮 Parcel size', callback_data: 'pick:pkg' }],
    ];

    if (ready) {
      keyboard.unshift([{ text: '🚀 POST TO VINTED', callback_data: 'post' }]);
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
    const data = query.data;

    try {
    bot.answerCallbackQuery(query.id);
    await ensureLoaded(chatId);
    const c = getChat(chatId);

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
        saveChatAccounts(chatId, c.accounts, c.activeIdx);
        return bot.editMessageText(`Switched to ${a.username}. Send photos to list on this account.`, { chat_id: chatId, message_id: query.message.message_id });
      }
      return;
    }

    // ── Resume / New listing ──
    if (data === 'resume') {
      // Go back to wherever they were
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

    // ── Wizard edit (AI-assisted: ask user what to change, AI applies it) ──
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
      return bot.sendMessage(chatId, `Current price: £${c.listing.price}\n\nWhat would you like to change? (e.g. "lower it", "make it £15", "price it higher"):`);
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
      // If in wizard, advance; if in review, go back to summary
      if (c.step.startsWith('wiz_')) return wizardNext(chatId);
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
      if (c.step.startsWith('wiz_')) return wizardNext(chatId);
      c.step = 'review';
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
      return selectCategory(chatId, id);
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
      c.listing.brand = parts.slice(2).join(':');
      if (c.step.startsWith('wiz_')) return wizardNext(chatId);
      c.step = 'review';
      return showSummary(chatId);
    }

    // ── POST ──
    if (data === 'post') {
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
    if (!msg.text || msg.photo) return; // skip photo messages — handled by photo handler
    const chatId = msg.chat.id;
    await ensureLoaded(chatId);
    const c = getChat(chatId);

    console.log(`[TG] message: "${msg.text.slice(0,30)}" step=${c.step}`);

    // Skip slash commands — they're handled by onText handlers
    if (msg.text.startsWith('/')) return;

    // ── Login flow ──
    if (c.step === 'login_username') {
      console.log(`[TG] Got username: ${msg.text.trim()}`);
      c.loginUsername = msg.text.trim();
      c.step = 'login_password';
      return bot.sendMessage(chatId, 'Got it. Now what\'s your password?');
    }

    if (c.step === 'login_password') {
      console.log(`[TG] Got password for ${c.loginUsername}`);
      const password = msg.text.trim();
      const username = c.loginUsername;
      delete c.loginUsername;
      try { await bot.deleteMessage(chatId, msg.message_id); } catch {}
      return doLogin(chatId, username, password);
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
      bot.sendMessage(chatId, '✏️ Updating title...');
      try {
        const result = await aiEdit('title', c.listing.title, msg.text);
        c.listing.title = result.slice(0, 60);
      } catch (e) {
        console.error('[TG] AI edit error:', e.message);
        c.listing.title = msg.text.slice(0, 60); // fallback: use their text directly
      }
      c.step = 'wiz_title';
      return askWizardStep(chatId);
    }

    if (c.step === 'wiz_edit_desc') {
      bot.sendMessage(chatId, '✏️ Updating description...');
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
      // Check if user just typed a number directly
      const directPrice = parseFloat(msg.text.replace(/[^0-9.]/g, ''));
      if (!isNaN(directPrice) && directPrice > 0 && /^\s*[£$€]?\s*\d/.test(msg.text)) {
        c.listing.price = Math.round(directPrice * 100) / 100;
        c.step = 'wiz_price';
        return askWizardStep(chatId);
      }
      bot.sendMessage(chatId, '✏️ Adjusting price...');
      try {
        const result = await aiEdit('price', `£${c.listing.price}`, msg.text);
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
      return searchBrands(chatId, msg.text);
    }

    if (c.step === 'searching_cat' || c.step === 'wiz_category') {
      return searchCategories(chatId, msg.text);
    }

    // ── Catch-all: guide the user on what to do next ──
    if (c.step === 'idle') {
      ensureMulti(c);
      if (!activeAccount(c)) {
        return bot.sendMessage(chatId, 'To get started, connect your account with /login\n\nOnce logged in, send photos of an item to create a listing.');
      }
      const acctName = activeAccount(c)?.vintedName || activeAccount(c)?.username || 'Vinted';
      return bot.sendMessage(chatId, `📸 Send me photos of an item to list on ${acctName}!\n\nYou can also add a caption with details like "Nike hoodie size M £25".`);
    }

    if (c.step === 'review') {
      return bot.sendMessage(chatId, 'You have a listing ready for review. Use the buttons above to edit or post it, or /cancel to start over.');
    }

    if (c.step === 'analyzing') {
      return bot.sendMessage(chatId, 'Still analyzing your photos — please wait a moment...');
    }

    if (c.step === 'posting') {
      return bot.sendMessage(chatId, 'Your item is being posted to Vinted — please wait...');
    }

    if (c.step === 'collecting_photos') {
      return bot.sendMessage(chatId, '📸 Send more photos, or wait a moment — I\'ll start analyzing once you\'re done.');
    }

    if (c.step === 'collecting_photos_for_review') {
      return bot.sendMessage(chatId, '📸 Send photos for your listing. Once done, I\'ll take you back to the summary.');
    }
  });

  // ──────────────────────────────────────────
  // CATEGORY SEARCH (hardcoded + AI fallback)
  // ──────────────────────────────────────────

  // Search categories by keyword — uses hardcoded list (always works) + API fallback
  function searchCategoriesByKeyword(keyword) {
    const q = keyword.toLowerCase().trim();
    if (!q) return [];

    // Score each category by keyword match
    const scored = [];
    for (const cat of CATEGORIES) {
      let score = 0;
      // Check title match
      if (cat.title.toLowerCase().includes(q)) score += 10;
      // Check keyword matches
      for (const kw of cat.keywords) {
        if (kw.includes(q) || q.includes(kw)) score += 5;
        // Partial word match
        const words = q.split(/\s+/);
        for (const w of words) {
          if (w.length >= 3 && kw.includes(w)) score += 2;
        }
      }
      if (score > 0) scored.push({ ...cat, score, path: cat.title, hasChildren: false });
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 8);
  }

  // Use AI to suggest alternative category search terms
  async function aiCategoryTerms(itemDescription) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return [];
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 100,
          system: `Given an item, return 3-5 simple search keywords for finding it on Vinted marketplace. Think of parent categories and synonyms. Example: "stroller" → ["pushchair","pram","buggy","baby"]. Return ONLY a JSON array of strings.`,
          messages: [{ role: 'user', content: `Item: ${itemDescription}` }]
        })
      });
      const data = await resp.json();
      const text = data.content?.[0]?.text?.trim() || '';
      const arr = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] || '[]');
      return arr.filter(t => typeof t === 'string').slice(0, 5);
    } catch (e) {
      console.error('[TG] AI category terms error:', e.message);
      return [];
    }
  }

  async function searchCategories(chatId, query) {
    const c = getChat(chatId);
    const inWiz = c.step.startsWith('wiz_');
    const header = inWiz ? '📂 Step 4/9 — Category\n\n' : '';

    // 1. Search hardcoded categories first (always works, no API needed)
    let matches = searchCategoriesByKeyword(query);
    console.log(`[TG] Category search "${query}": ${matches.length} local matches`);

    // 2. If no matches, try each part of category_hint
    if (!matches.length && c.listing?.category_hint) {
      const parts = c.listing.category_hint.split('/').filter(p => p && p !== query);
      for (const part of parts) {
        matches = searchCategoriesByKeyword(part);
        if (matches.length) { console.log(`[TG] Found via hint part "${part}"`); break; }
      }
    }

    // 3. If still nothing, ask AI for alternative terms (cheap haiku call)
    if (!matches.length) {
      const itemDesc = c.listing ? `${c.listing.title || ''} ${query}`.trim() : query;
      const altTerms = await aiCategoryTerms(itemDesc);
      console.log(`[TG] AI category terms: ${altTerms.join(', ')}`);
      for (const term of altTerms) {
        matches = searchCategoriesByKeyword(term);
        if (matches.length) { console.log(`[TG] Found via AI term "${term}"`); break; }
      }
    }

    if (!matches.length) {
      // Last resort: show top-level categories to pick from
      const topCats = CATEGORIES.filter((_, i) => i % 3 === 0).slice(0, 10);
      const rows = topCats.map(m => [{ text: m.title, callback_data: `cat:${m.id}` }]);
      rows.push([{ text: '🔍 Search different term', callback_data: 'cat:search' }]);
      return bot.sendMessage(chatId, header + `No exact match for "${query}". Pick the closest category or search again:`, {
        reply_markup: { inline_keyboard: rows }
      });
    }

    const rows = matches.map(m => [{
      text: m.path || m.title,
      callback_data: `cat:${m.id}`
    }]);
    rows.push([{ text: '🔍 Search different term', callback_data: 'cat:search' }]);

    bot.sendMessage(chatId, header + `Found ${matches.length} match(es) for "${query}":`, {
      reply_markup: { inline_keyboard: rows }
    });
  }

  async function selectCategory(chatId, catId) {
    const c = getChat(chatId);
    // Look up name from hardcoded list
    const match = CATEGORIES.find(x => x.id === catId);
    c.listing.catalog_id = catId;
    c.listing.category_name = match ? match.title : `ID: ${catId}`;
    c.listing.size_id = null;
    c.listing.size_name = '';
    if (c.step.startsWith('wiz_')) return wizardNext(chatId);
    c.step = 'review';
    return showSummary(chatId);
  }

  // ──────────────────────────────────────────
  // SIZE PICKER
  // ──────────────────────────────────────────

  async function showSizePicker(chatId) {
    const c = getChat(chatId);
    try {
    const acct = activeAccount(c);
    if (!acct) throw new Error('No account');
    const session = await store.getSession(acct.userId);
    if (!session) throw new Error('No session');

    const resp = await vintedFetch(session, `/api/v2/size_groups?catalog_ids=${c.listing.catalog_id}`);
    if (!resp.ok) throw new Error(`sizes API returned ${resp.status}`);

    const data = await resp.json();
    const groups = data.size_groups || data.catalog_sizes || data.sizes || [];

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
    // Cache for title lookup when user selects
    c.sizeCache = allSizes;

    if (!allSizes.length) return bot.sendMessage(chatId, 'No sizes found for this category.');

    // Show as rows of 4
    const rows = [];
    for (let i = 0; i < Math.min(allSizes.length, 32); i += 4) {
      rows.push(allSizes.slice(i, i + 4).map(s => ({
        text: s.title, callback_data: `size:${s.id}`
      })));
    }
    rows.push([{ text: '⏭️ Skip (no size)', callback_data: 'size:0' }]);

    const header = c.step.startsWith('wiz_') ? '📏 Step 5/9 — Size\n\nSelect size:' : 'Select size:';
    bot.sendMessage(chatId, header, { reply_markup: { inline_keyboard: rows } });
    } catch (e) {
      console.error('[TG] Size picker error:', e.message);
      // Skip size step
      c.listing.size_id = null;
      c.listing.size_name = 'N/A';
      if (c.step.startsWith('wiz_')) return wizardNext(chatId);
      bot.sendMessage(chatId, 'Could not load sizes. Skipping.');
    }
  }

  async function selectSize(chatId, sizeId) {
    const c = getChat(chatId);
    if (sizeId === 0) {
      c.listing.size_id = null;
      c.listing.size_name = 'N/A';
    } else {
      c.listing.size_id = sizeId;
      const cached = c.sizeCache?.find(s => s.id === sizeId);
      c.listing.size_name = cached?.title || `ID: ${sizeId}`;
    }
    if (c.step.startsWith('wiz_')) return wizardNext(chatId);
    c.step = 'review';
    return showSummary(chatId);
  }

  // ──────────────────────────────────────────
  // PACKAGE SIZE PICKER
  // ──────────────────────────────────────────

  function showPackageSizePicker(chatId) {
    const c = getChat(chatId);
    const inWiz = c.step.startsWith('wiz_');
    const header = inWiz ? '📮 Step 9/9 — Parcel Size\n\n' : '';

    const rows = PACKAGE_SIZES.map(s => [{
      text: `${s.title} — ${s.desc}`, callback_data: `pkg:${s.id}`
    }]);

    bot.sendMessage(chatId, header + 'Select parcel size:', {
      reply_markup: { inline_keyboard: rows }
    });
  }

  function selectPackageSize(chatId, pkgId) {
    const c = getChat(chatId);
    if (pkgId === 0) {
      c.listing.package_size_id = null;
      c.listing.package_size_name = 'N/A';
    } else {
      const pkg = PACKAGE_SIZES.find(p => p.id === pkgId);
      c.listing.package_size_id = pkgId;
      c.listing.package_size_name = pkg ? pkg.title : `ID: ${pkgId}`;
    }
    if (c.step.startsWith('wiz_')) return wizardNext(chatId);
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

    bot.sendMessage(chatId, 'Select brand:', { reply_markup: { inline_keyboard: rows } });
  }

  // ──────────────────────────────────────────
  // CREATE LISTING
  // ──────────────────────────────────────────

  async function createListing(chatId) {
    const c = getChat(chatId);
    ensureMulti(c);
    const L = c.listing;

    if (!L) {
      c.step = 'idle';
      return bot.sendMessage(chatId, 'No listing data found. Send photos to start a new listing.');
    }

    if (!L.catalog_id || !L.status_id) {
      c.step = 'review';
      return showSummary(chatId);
    }

    const acct = activeAccount(c);
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

    c.step = 'posting';
    const statusMsg = await bot.sendMessage(chatId, `Uploading ${c.photos.length} photo(s) to Vinted...`);

    let session;
    try {
      session = await store.getSession(acct.userId);
    } catch (e) {
      console.error('[TG] Session fetch error:', e.message);
    }

    if (!session) {
      c.step = 'review';
      return bot.sendMessage(chatId, 'Vinted session expired. Sync from Chrome extension, then come back and tap POST again.');
    }

    console.log(`[TG] Posting for ${acct.username}, domain=${session.domain}, csrf=${session.csrf?.slice(0,12)}..., cookies=${session.cookies?.length} chars`);

    try {
      // ── Step 1: Upload photos ──
      const photoIds = [];
      const domain = session.domain || 'www.vinted.co.uk';

      for (let i = 0; i < c.photos.length; i++) {
        const buffer = Buffer.from(c.photos[i].base64, 'base64');
        const uuid = crypto.randomUUID();

        // Use native FormData + Blob (matches DOTB's approach exactly)
        const form = new FormData();
        form.append('photo[type]', 'item');
        form.append('photo[file]', new Blob([buffer], { type: 'image/jpeg' }), 'photo.jpg');
        form.append('photo[temp_uuid]', uuid);

        const uploadResp = await fetch(`https://${domain}/api/v2/photos`, {
          method: 'POST',
          headers: {
            'Cookie': session.cookies,
            'X-CSRF-Token': session.csrf,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
          body: form
        });

        if (!uploadResp.ok) {
          const errText = await uploadResp.text().catch(() => '');
          console.error(`[TG] Photo ${i + 1} upload error (${uploadResp.status}):`, errText.slice(0, 200));
          if (uploadResp.status === 401) {
            throw new Error('SESSION_EXPIRED');
          }
          throw new Error(`Photo ${i + 1} upload failed (${uploadResp.status}): ${errText.slice(0, 100)}`);
        }

        const photoData = await uploadResp.json();
        const photoId = photoData.photo?.id || photoData.id;
        if (!photoId) throw new Error(`Photo ${i + 1}: no ID returned`);
        photoIds.push({ id: photoId, orientation: 0 });
        console.log(`[TG] Photo ${i + 1} uploaded: id=${photoId}`);

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
      c._lastDraftId = draftId; // Save for error recovery

      await bot.editMessageText(`Draft created. Publishing...`, {
        chat_id: chatId, message_id: statusMsg.message_id
      });

      // ── Step 3: Small delay then activate ──
      await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));

      // Refresh the draft to get server-side defaults (shipping, attributes, etc.)
      const refreshResp = await vintedFetch(session, `/api/v2/item_upload/items/${draftId}`);
      let completionDraft = draft;
      if (refreshResp.ok) {
        const refreshed = (await refreshResp.json()).item;
        if (refreshed) {
          completionDraft = buildCompletionDraft(refreshed, photoIds);
          // Re-apply user's chosen values — server refresh can override them with defaults
          completionDraft.title = L.title;
          completionDraft.description = L.description;
          completionDraft.catalog_id = L.catalog_id;
          completionDraft.status_id = L.status_id;
          completionDraft.price = L.price;
          completionDraft.package_size_id = L.package_size_id || null;
          completionDraft.color_ids = L.color1_id ? [L.color1_id] : [];
          completionDraft.brand_id = L.brand_id || null;
          completionDraft.brand = L.brand || null;
          completionDraft.size_id = L.size_id || null;
        }
      }
      completionDraft.id = parseInt(draftId);

      const completeResp = await vintedFetch(session, `/api/v2/item_upload/drafts/${draftId}/completion`, {
        method: 'POST',
        body: { draft: completionDraft, feedback_id: null, parcel: null, push_up: false, upload_session_id: uuid }
      });

      if (!completeResp.ok) {
        const errBody = await completeResp.json().catch(() => ({}));
        const errors = errBody.errors || errBody.message_errors || {};
        let errorLines;
        if (Array.isArray(errors)) {
          // Vinted code 99 format: [{ field: "title", value: "...", message: "..." }, ...]
          errorLines = errors.map(e => {
            const field = e.field || 'unknown';
            const msg = e.message || e.value || JSON.stringify(e);
            return `${field}: ${msg}`;
          });
        } else {
          errorLines = Object.entries(errors).map(([k, v]) =>
            `${k}: ${Array.isArray(v) ? v.join(', ') : (typeof v === 'object' ? JSON.stringify(v) : v)}`
          );
        }
        const draftUrl = `https://${domain}/items/${draftId}/edit`;

        // Draft exists on Vinted — tell user to finish there
        c.step = 'idle';
        c.photos = [];
        c.listing = null;
        c.summaryMsgId = null;
        saveChatState(chatId);

        const acctName = activeAccount(c)?.vintedName || activeAccount(c)?.username || 'your account';
        let errMsg = `Publishing failed but your draft is saved on Vinted (${acctName}).\n\n`;
        if (errorLines.length) {
          errMsg += `Issues:\n${errorLines.join('\n')}\n\n`;
        }
        errMsg += `Open your draft to fix and publish:\n${draftUrl}\n\n`;
        errMsg += 'Send new photos to create another listing.';

        console.error(`[TG] Publish failed for draft ${draftId}:`, errorLines.join('; ') || completeResp.status);
        return bot.sendMessage(chatId, errMsg);
      }

      // ── Success! ──
      const itemUrl = `https://${domain}/items/${draftId}`;

      await bot.editMessageText(
        `*Item listed successfully\\!* 🎉\n\n` +
        `*${esc(L.title)}* — £${L.price}\n\n` +
        `[View on Vinted](${esc(itemUrl)})`,
        { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'MarkdownV2' }
      );

      // Follow-up message with next action
      bot.sendMessage(chatId, '📸 Send more photos to list another item, or use /help to see all commands.');

      console.log(`[TG] Listed item ${draftId} for user ${activeAccount(c).username}`);

      // Reset state
      c.step = 'idle';
      c.photos = [];
      c.listing = null;
      c.summaryMsgId = null;
      c.catalogCache = null;
      delete c._lastDraftId;
      saveChatState(chatId);

    } catch (e) {
      console.error('[TG] Listing error:', e.message);

      // Vinted session expired — clear photos, keep listing, guide user
      if (e.message === 'SESSION_EXPIRED') {
        c.photos = [];
        c.step = 'review';
        saveChatState(chatId);
        const acctName = activeAccount(c)?.vintedName || activeAccount(c)?.username || 'your account';
        return bot.sendMessage(chatId,
          `⚠️ Vinted session expired for ${acctName}.\n\n` +
          `To fix this:\n` +
          `1. Open Vinted in Chrome on your computer\n` +
          `2. Click the RelistPro extension and sync\n` +
          `3. Come back here, send your photos again, and tap POST\n\n` +
          `Your listing details are saved — you only need to re-upload photos.`
        );
      }

      // If we have a draftId, it means draft was created — tell user it's saved
      if (c._lastDraftId) {
        const dom = session?.domain || acct?.vintedDomain || 'www.vinted.co.uk';
        const dUrl = `https://${dom}/items/${c._lastDraftId}/edit`;
        c.step = 'idle';
        c.photos = [];
        c.listing = null;
        c.summaryMsgId = null;
        delete c._lastDraftId;
        saveChatState(chatId);
        return bot.sendMessage(chatId,
          `Something went wrong: ${e.message}\n\n` +
          `Your draft is saved on Vinted — open it to finish:\n${dUrl}\n\n` +
          `Send new photos to create another listing.`
        );
      }

      // No draft created yet — clear photos (they can't be reused), keep listing details
      if (c.listing) {
        c.photos = [];
        c.step = 'review';
        saveChatState(chatId);
        bot.sendMessage(chatId,
          `Failed: ${e.message}\n\n` +
          `Your listing details are saved but photos need to be re-uploaded.\n` +
          `📸 Send your photos again, then tap 🚀 POST TO VINTED to retry.`
        );
        return showSummary(chatId);
      }

      // Listing state lost — start fresh
      c.step = 'idle';
      saveChatState(chatId);
      bot.sendMessage(chatId, `Failed: ${e.message}\n\nSend new photos to start a fresh listing.`);
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
