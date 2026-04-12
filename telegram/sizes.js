// telegram/sizes.js — size resolution, picker UI, and selection logic

const { clearErrorField } = require('./helpers');
const { getChat, activeAccount, saveChatState } = require('./state');

let bot = null;
let vintedFetch = null;
let store = null;

// Injected later: wizardNext, showSummary (circular-dep safe)
let _wizardNext = null;
let _showSummary = null;

function init(ctx) {
  bot = ctx.bot;
  vintedFetch = ctx.vintedFetch;
  store = ctx.store;
}

function setCallbacks({ wizardNext, showSummary }) {
  _wizardNext = wizardNext;
  _showSummary = showSummary;
}

// ──────────────────────────────────────────
// NORMALISE SIZE HINT
// ──────────────────────────────────────────

// Map common size-label variants onto what Vinted's size groups actually store.
// Vinted uses letter sizes (S/M/L) and bare numerics — not "Medium" or "EU 38".
// Returns an array of candidates to try in order; always includes the raw hint.
function normaliseSizeHint(hint) {
  const h = hint.trim().toUpperCase();
  const out = [];
  const wordMap = {
    'EXTRA SMALL': 'XS', 'X SMALL': 'XS', 'XSMALL': 'XS',
    'SMALL': 'S',
    'MEDIUM': 'M', 'MED': 'M',
    'LARGE': 'L',
    'EXTRA LARGE': 'XL', 'X LARGE': 'XL', 'XLARGE': 'XL',
    'XX LARGE': 'XXL', 'XXLARGE': 'XXL', '2XL': 'XXL',
    'XXX LARGE': 'XXXL', '3XL': 'XXXL',
  };
  if (wordMap[h]) out.push(wordMap[h]);
  // "EU 38" / "UK 10" / "US 6" → bare number
  const sys = h.match(/^(?:EU|UK|US)\s*([\d.]+)$/);
  if (sys) out.push(sys[1]);
  // "6-8" or "6/8" → try each end individually
  const range = h.match(/^(\d+)\s*[-/]\s*(\d+)$/);
  if (range) { out.push(range[1]); out.push(range[2]); }
  // "ONE SIZE" variants → let Vinted's row match on its own title
  if (/^(ONE\s*SIZE|OS|ONESIZE)$/.test(h)) out.push('ONE SIZE');
  out.push(h);
  return Array.from(new Set(out));
}

// ──────────────────────────────────────────
// AUTO-RESOLVE SIZE
// ──────────────────────────────────────────

// Try to match AI size_hint against Vinted's size_groups for the current
// catalog. Returns {id, title}|null. No UI side effect.
async function autoResolveSize(session, L) {
  if (!L.catalog_id || !L.size_hint) return null;
  if (L.aiConfidence?.size === 'low') return null;
  const hint = L.size_hint.trim().toUpperCase();
  const candidates = normaliseSizeHint(hint);
  try {
    const resp = await vintedFetch(session, `/api/v2/size_groups?catalog_ids=${L.catalog_id}`);
    if (!resp.ok) return null;
    const data = await resp.json();
    const groups = data.size_groups || data.catalog_sizes || data.sizes || [];
    const all = [];
    for (const g of groups) {
      for (const s of (g.sizes || [g])) {
        if (s.id && s.title) all.push({ id: s.id, title: s.title });
      }
    }
    // Try exact match against every normalised candidate first.
    for (const cand of candidates) {
      const m = all.find(s => s.title.toUpperCase() === cand);
      if (m) return m;
    }
    // Fallback: substring / reverse-substring against the raw hint (legacy behaviour).
    let m = all.find(s => s.title.toUpperCase().includes(hint));
    if (!m) m = all.find(s => hint.includes(s.title.toUpperCase()) && s.title.length > 1);
    return m || null;
  } catch { return null; }
}

// ──────────────────────────────────────────
// FIND "ONE SIZE"
// ──────────────────────────────────────────

// Fallback: "One size" lookup for categories that support it.
async function findOneSize(session, catalogId) {
  try {
    const resp = await vintedFetch(session, `/api/v2/size_groups?catalog_ids=${catalogId}`);
    if (!resp.ok) return null;
    const data = await resp.json();
    const groups = data.size_groups || data.catalog_sizes || data.sizes || [];
    const all = [];
    for (const g of groups) {
      for (const s of (g.sizes || [g])) {
        if (s.id && s.title) all.push({ id: s.id, title: s.title });
      }
    }
    return all.find(s => /one\s*size/i.test(s.title)) || null;
  } catch { return null; }
}

// ──────────────────────────────────────────
// SIZE PICKER UI
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

    // Flatten size groups
    const allSizes = [];
    for (const group of groups) {
      const sizes = group.sizes || [group];
      for (const s of sizes) {
        if (s.id && s.title) allSizes.push({ id: s.id, title: s.title });
      }
    }

    if (!allSizes.length) {
      // Default to "One size" — Vinted's universal fallback
      const oneSize = groups.find(g => /one\s*size/i.test(g.title || ''));
      if (oneSize) {
        c.listing.size_id = oneSize.id;
        c.listing.size_name = oneSize.title;
      } else {
        c.listing.size_id = null;
        c.listing.size_name = 'N/A';
      }
      clearErrorField(c, 'size');
      console.log(`[TG] No sizes for catalog_id=${c.listing.catalog_id}, defaulting to: ${c.listing.size_name} (id=${c.listing.size_id})`);
      if (c.step.startsWith('wiz_')) return _wizardNext(chatId);
      // Review path: refresh summary with confirmation + give user a way to
      // change category if they actually need a size.
      await bot.sendMessage(chatId,
        `\u2139\uFE0F This category has no size options \u2014 set to "${c.listing.size_name}".\n` +
        `If you need a specific size, change the category instead.`,
        { reply_markup: { inline_keyboard: [
          [{ text: '\uD83D\uDCC2 Change category', callback_data: 'pick:cat' }]
        ]}}
      );
      c.step = 'review';
      c._justEdited = 'size';
      return _showSummary(chatId);
    }

    // Cache for title lookup when user selects
    c.sizeCache = allSizes;
    c.sizeCacheGroups = groups;

    // Try to auto-match AI-detected size — but only if confidence is not low
    const hint = (c.listing.size_hint || '').trim().toUpperCase();
    const sizeConfLow = c.listing.aiConfidence?.size === 'low';
    let autoMatched = null;
    if (hint && !sizeConfLow) {
      autoMatched = allSizes.find(s => s.title.toUpperCase() === hint);
      if (!autoMatched) autoMatched = allSizes.find(s => s.title.toUpperCase().includes(hint));
      if (!autoMatched) autoMatched = allSizes.find(s => hint.includes(s.title.toUpperCase()) && s.title.length > 1);
      if (autoMatched) {
        console.log(`[TG] Auto-matched size: "${hint}" \u2192 "${autoMatched.title}" (id=${autoMatched.id})`);
      }
    }

    // Show as rows of 4
    const rows = [];
    for (let i = 0; i < Math.min(allSizes.length, 32); i += 4) {
      rows.push(allSizes.slice(i, i + 4).map(s => ({
        text: s.title + (autoMatched && s.id === autoMatched.id ? ' \u2713' : ''),
        callback_data: `size:${s.id}`
      })));
    }
    // If AI detected a size, show accept button
    if (autoMatched) {
      rows.unshift([{ text: `\u2705 Use detected: ${autoMatched.title}`, callback_data: `size:${autoMatched.id}` }]);
    }
    rows.push([{ text: '\u23ED\uFE0F Skip (use "One size" if available)', callback_data: 'size:0' }]);

    const sizeWarn = sizeConfLow ? ' \u26A0\uFE0F (low confidence \u2014 verify)' : '';
    const sizeInfo = hint ? `\nAI detected: ${c.listing.size_hint}${sizeWarn}` : '';
    const header = c.step.startsWith('wiz_') ? `\uD83D\uDCCF Step 5/9 \u2014 Size${sizeInfo}\n\nSelect size:` : `Select size:${sizeInfo}`;
    bot.sendMessage(chatId, header, { reply_markup: { inline_keyboard: rows } });
  } catch (e) {
    console.error('[TG] Size picker error:', e.message);
    // Skip size step
    c.listing.size_id = null;
    c.listing.size_name = 'N/A';
    if (c.step.startsWith('wiz_')) return _wizardNext(chatId);
    await bot.sendMessage(chatId, 'Could not load sizes \u2014 set to "N/A". Try again or change the category.');
    c.step = 'review';
    c._justEdited = 'size';
    return _showSummary(chatId);
  }
}

// ──────────────────────────────────────────
// SELECT SIZE (callback handler)
// ──────────────────────────────────────────

async function selectSize(chatId, sizeId) {
  const c = getChat(chatId);
  if (sizeId === 0) {
    // User skipped — try to fall back to "One size" if available for this catalog
    const oneSizeGroup = (c.sizeCacheGroups || []).find(g => /one\s*size/i.test(g.title || ''));
    const oneSizeFlat = (c.sizeCache || []).find(s => /one\s*size/i.test(s.title || ''));
    const oneSize = oneSizeGroup || oneSizeFlat;
    if (oneSize) {
      c.listing.size_id = oneSize.id;
      c.listing.size_name = oneSize.title;
      console.log(`[TG] User skipped size \u2014 defaulted to "${oneSize.title}" (id=${oneSize.id})`);
    } else {
      c.listing.size_id = null;
      c.listing.size_name = 'N/A';
    }
  } else {
    c.listing.size_id = sizeId;
    const cached = c.sizeCache?.find(s => s.id === sizeId);
    c.listing.size_name = cached?.title || `ID: ${sizeId}`;
  }
  clearErrorField(c, 'size');
  if (c.step.startsWith('wiz_')) return _wizardNext(chatId);
  c.step = 'review';
  c._justEdited = 'size';
  return _showSummary(chatId);
}

module.exports = {
  init,
  setCallbacks,
  autoResolveSize,
  normaliseSizeHint,
  findOneSize,
  showSizePicker,
  selectSize,
};
