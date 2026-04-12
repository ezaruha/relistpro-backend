const { HIGH_RISK_BRANDS } = require('./constants');
const { esc, clearErrorField, normalizeText } = require('./helpers');
const { getChat, activeAccount, saveChatState } = require('./state');

// ── Injected dependencies ──────────────────────────────────
let bot, vintedFetch, store;
// Circular deps (wizard.js / review.js) — set later via setDeps()
let wizardNext, showSummary;

function init(ctx) {
  bot         = ctx.bot;
  vintedFetch = ctx.vintedFetch;
  store       = ctx.store;
}

function setDeps(deps) {
  if (deps.wizardNext)  wizardNext  = deps.wizardNext;
  if (deps.showSummary) showSummary = deps.showSummary;
}

// ── High-risk brand helpers ────────────────────────────────

function isHighRiskBrand(name) {
  if (!name) return false;
  const n = String(name).toLowerCase().trim();
  if (HIGH_RISK_BRANDS.has(n)) return true;
  for (const b of HIGH_RISK_BRANDS) {
    if (n.includes(b) || b.includes(n)) return true;
  }
  return false;
}

function getProofChecklist(categoryName) {
  const cat = String(categoryName || '').toLowerCase();
  if (/dress|skirt|top|shirt|blouse|trouser|jean|coat|jacket|hoodie|sweatshirt|knit|suit/.test(cat)) {
    return [
      'Sewn-in care/composition label (zoomed)',
      'Inner brand + size label',
      'Any serial / RFID / authenticity tag',
      'Stitching close-up (seams or logo embroidery)'
    ];
  }
  if (/bag|handbag|purse|clutch|backpack|tote/.test(cat)) {
    return [
      'Inner leather heat stamp / brand embossing',
      'Date code or serial number (inside pocket or tag)',
      'Zipper pull showing brand engraving',
      'Authenticity card / dust bag / receipt if available'
    ];
  }
  if (/shoe|trainer|sneaker|boot|heel|sandal/.test(cat)) {
    return [
      'Inner tongue label: size, style code, country',
      'Sole close-up (pattern + branding)',
      'Stitching around the toe and heel',
      'Box label if you still have it'
    ];
  }
  if (/watch/.test(cat)) {
    return [
      'Caseback: engraving / serial number',
      'Crown and crown-logo close-up',
      'Dial macro (applied indices, logo alignment)',
      'Papers / warranty card if available'
    ];
  }
  if (/belt|sunglass|wallet|scarf|jewel|accessor/.test(cat)) {
    return [
      'Brand engraving / etching',
      'Inside or back of the item showing stamp/label',
      'Any serial number or hologram',
      'Dust bag / box / receipt if available'
    ];
  }
  return [
    'Sewn-in or stamped brand label (zoomed)',
    'Any serial / date code / style number',
    'Stitching or construction close-up',
    'Receipt / authenticity card if available'
  ];
}

// ── Text utilities ─────────────────────────────────────────

/**
 * Strip a brand word (and hyphen/space variants of a multi-word brand) from
 * a piece of text, case-insensitive, with whole-word boundaries.
 */
function stripBrandFromText(text, brand) {
  if (!text || !brand) return text;
  const parts = String(brand).trim().split(/[\s-]+/).filter(Boolean);
  if (!parts.length) return text;
  const escaped = parts.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = escaped.join('[\\s-]+');
  const re = new RegExp(`\\b${pattern}\\b`, 'gi');
  return text.replace(re, '').replace(/\s{2,}/g, ' ').replace(/^\s*[-,:;]\s*/, '').trim();
}

/** Normalize a brand-ish string for comparison: lowercase, alphanumeric only. */
function normBrand(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ── Unbranded ID (cached per domain) ──────────────────────

const unbrandedIdByDomain = new Map();

async function getUnbrandedId(session) {
  const domain = session?.domain || 'www.vinted.co.uk';
  if (unbrandedIdByDomain.has(domain)) return unbrandedIdByDomain.get(domain);
  try {
    const resp = await vintedFetch(session, `/api/v2/brands?keyword=unbranded`);
    if (resp.ok) {
      const data = await resp.json();
      const list = data.brands || [];
      const match = list.find(b => /^unbranded$/i.test(b.title || b.name || ''));
      if (match?.id) {
        unbrandedIdByDomain.set(domain, match.id);
        return match.id;
      }
    }
  } catch (e) { console.error('[TG] getUnbrandedId error:', e.message); }
  unbrandedIdByDomain.set(domain, null);
  return null;
}

// ── Brand matching / lookup ────────────────────────────────

/**
 * Score a Vinted brand result against the user's query. Higher = better.
 * Returns 0 when the candidate is noise (no shared token with the query).
 */
function scoreBrandMatch(query, candidateTitle) {
  const q = normBrand(query);
  const c = normBrand(candidateTitle);
  if (!q || !c) return 0;
  if (q === c) return 100;
  if (c.startsWith(q) && q.length >= 3) return 80;
  if (q.startsWith(c) && c.length >= 3) return 60;
  const qTokens = String(query).toLowerCase().split(/\s+/).filter(t => t.length >= 2);
  const cTokensRaw = String(candidateTitle).toLowerCase().split(/\s+/).filter(t => t.length >= 2);
  const cTokens = cTokensRaw.map(normBrand).filter(Boolean);
  // Whole-token match — "Spirit" inside "Spirit Motors" qualifies, but
  // "Spirit" inside "Inspiration" does not, because "inspiration" is a
  // single token and its normalised form doesn't equal "spirit".
  const qFirst = normBrand(qTokens[0] || '');
  if (qFirst && cTokens.includes(qFirst)) return 40;
  return 0;
}

/**
 * Five-strategy brand lookup against /api/v2/brands. Returns {id,title,score}|null
 * — no UI side effect, safe to call from the fast-post path.
 */
async function lookupVintedBrand(session, query) {
  if (!query) return null;
  const tried = new Set();
  const tryQ = async (q) => {
    if (!q || tried.has(q.toLowerCase())) return [];
    tried.add(q.toLowerCase());
    try {
      const r = await vintedFetch(session, `/api/v2/brands?q=${encodeURIComponent(q)}&per_page=10`);
      if (!r.ok) return [];
      const d = await r.json();
      return d.brands || [];
    } catch { return []; }
  };
  let b = await tryQ(query);
  if (!b.length) b = await tryQ(query.replace(/\s+/g, ''));
  if (!b.length) b = await tryQ(query.replace(/[^a-zA-Z0-9\s]/g, '').trim());
  if (!b.length && query.includes(' ')) b = await tryQ(query.split(/\s+/)[0]);
  if (!b.length && query.includes(' ')) {
    const partsW = query.split(/\s+/);
    b = await tryQ(partsW[partsW.length - 1]);
  }
  if (!b.length) return null;
  // Rank by match score and take the best — Vinted's search is fuzzy and
  // often returns unrelated brands first. Reject anything that isn't a
  // real match so callers fall through to plain-text.
  const ranked = b
    .map(x => ({ raw: x, score: scoreBrandMatch(query, x.title || x.name || '') }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) return null;
  const best = ranked[0].raw;
  return { id: best.id, title: best.title || best.name, score: ranked[0].score };
}

// ── Authenticity gate ──────────────────────────────────────

async function triggerAuthGate(chatId, effectiveName) {
  const c = getChat(chatId);
  c._authGateBrandName = effectiveName;
  c.step = 'auth_gate';
  saveChatState(chatId);
  const checklist = getProofChecklist(c.listing?.category_name);
  const listText = checklist.map(s => `• ${esc(s)}`).join('\n');
  const brandEsc = esc(effectiveName);
  return bot.sendMessage(chatId,
    `⚠️ *Authenticity check — ${brandEsc}*\n\n` +
    `Vinted automatically reviews every listing tagged with a verified brand like *${brandEsc}*\\. ` +
    `Their system looks for counterfeits using image matching, label/tag text OCR, and seller history\\. ` +
    `If the listing fails that check, the item is delisted and the account gets a strike — repeat strikes lead to a permanent counterfeit ban with no appeal and lost inventory\\.\n\n` +
    `You have three ways forward, each with a different tradeoff:\n\n` +
    `📸 *I have proof — add photos*\n` +
    `Best option if the item is genuine\\. You'll send close\\-ups of the label, care tag, stitching, serial sticker etc\\. ` +
    `These get attached to the listing and satisfy Vinted's check\\. Listing stays tagged as *${brandEsc}* and gets the full brand\\-search traffic\\.\n\n` +
    `🏷️ *Post as Unbranded*\n` +
    `Safe fallback if you don't have proof shots handy\\. The listing posts without the brand tag, so Vinted skips the counterfeit check entirely\\. ` +
    `Downside: you lose the brand tag and the brand\\-search SEO — the item sells slower and usually for less\\. The word *${brandEsc}* will also be stripped from the title and description\\.\n\n` +
    `❌ *Cancel this listing*\n` +
    `Drops the draft completely\\. Pick this if you want to gather proof shots first and come back later\\.\n\n` +
    `Vinted usually wants these proof shots for this category:\n${listText}`,
    {
      parse_mode: 'MarkdownV2',
      reply_markup: { inline_keyboard: [
        [{ text: '📸 I have proof — add photos', callback_data: 'auth:proof' }],
        [{ text: '🏷️ Post as Unbranded', callback_data: 'auth:unbranded' }],
        [{ text: '❌ Cancel this listing', callback_data: 'auth:cancel' }],
      ]}
    }
  );
}

function resumeAfterAuthGate(chatId) {
  const c = getChat(chatId);
  c._authChecked = true;
  const wasWiz = (c._authPrevStep || '').startsWith('wiz_');
  delete c._authPrevStep;
  delete c._authGateBrandName;
  delete c._authStripPreview;
  clearErrorField(c, 'brand');
  if (wasWiz) {
    c.step = 'wiz_brand';
    return wizardNext(chatId);
  }
  c.step = 'review';
  return showSummary(chatId);
}

// ── Interactive brand search (picker UI) ───────────────────

async function searchBrands(chatId, query) {
  const c = getChat(chatId);
  const acct = activeAccount(c);
  if (!acct) return bot.sendMessage(chatId, 'No account.');
  const session = await store.getSession(acct.userId);
  if (!session) return bot.sendMessage(chatId, 'No Vinted session.');

  const tried = new Set();
  const tryQuery = async (q) => {
    if (!q || tried.has(q.toLowerCase())) return [];
    tried.add(q.toLowerCase());
    try {
      const resp = await vintedFetch(session, `/api/v2/brands?q=${encodeURIComponent(q)}&per_page=10`);
      if (!resp.ok) return [];
      const data = await resp.json();
      return data.brands || [];
    } catch { return []; }
  };

  // Strategy 1: as-typed
  let brands = await tryQuery(query);
  // Strategy 2: remove spaces
  if (!brands.length) brands = await tryQuery(query.replace(/\s+/g, ''));
  // Strategy 3: remove special chars
  if (!brands.length) brands = await tryQuery(query.replace(/[^a-zA-Z0-9\s]/g, '').trim());
  // Strategy 4: first word only
  if (!brands.length && query.includes(' ')) brands = await tryQuery(query.split(/\s+/)[0]);
  // Strategy 5: last word only
  if (!brands.length && query.includes(' ')) {
    const parts = query.split(/\s+/);
    brands = await tryQuery(parts[parts.length - 1]);
  }

  const displayQuery = normalizeText(query, 'title');

  if (!brands.length) {
    if (c.listing) {
      c.listing.brand = displayQuery;
      c.listing.brand_id = null;
      saveChatState(chatId);
    }
    return bot.sendMessage(chatId,
      `🏷️ "${displayQuery}" isn't in Vinted's catalogue.\n\nYour listing will be posted with "${displayQuery}" as plain text — Vinted will add it to their catalogue on the first listing with this brand.`,
      { reply_markup: { inline_keyboard: [
        [{ text: `✅ Post as "${displayQuery}"`, callback_data: `brand:0:${displayQuery.slice(0, 30)}` }],
        [{ text: '🔍 Search again', callback_data: 'brand:search' }]
      ]}}
    );
  }

  // Rank results so a real match beats Vinted's fuzzy noise
  const ranked = brands
    .map(b => ({ raw: b, score: scoreBrandMatch(query, b.title || b.name || '') }))
    .sort((a, b) => b.score - a.score);

  const topScore = ranked[0]?.score || 0;
  // No result even loosely matches what the user typed
  if (topScore === 0) {
    if (c.listing) {
      c.listing.brand = displayQuery;
      c.listing.brand_id = null;
      saveChatState(chatId);
    }
    const suggestions = brands.slice(0, 3).map(b => b.title || b.name).join(', ');
    return bot.sendMessage(chatId,
      `🏷️ Nothing in Vinted's catalogue matches "${displayQuery}".\n\n` +
      (suggestions ? `Closest unrelated results: ${suggestions}\n\n` : '') +
      `I'll post "${displayQuery}" as plain text — Vinted will add it to their catalogue on the first listing with this brand.`,
      { reply_markup: { inline_keyboard: [
        [{ text: `✅ Post as "${displayQuery}"`, callback_data: `brand:0:${displayQuery.slice(0, 30)}` }],
        [{ text: '🔍 Search again', callback_data: 'brand:search' }]
      ]}}
    );
  }

  // Have at least one reasonable match — show ranked list + plain-text escape hatch
  const rows = ranked.slice(0, 6).map(r => {
    const b = r.raw;
    const title = b.title || b.name;
    const tick = r.score >= 80 ? ' ✓' : '';
    return [{ text: `${title}${tick}`, callback_data: `brand:${b.id}:${title.slice(0, 40)}` }];
  });
  rows.push([{ text: `✅ Post as "${displayQuery}" (plain text)`, callback_data: `brand:0:${displayQuery.slice(0, 30)}` }]);
  rows.push([{ text: '🚫 No brand', callback_data: 'brand:0:' }]);

  bot.sendMessage(chatId, `Select a brand for "${displayQuery}":`, { reply_markup: { inline_keyboard: rows } });
}

// ── Exports ────────────────────────────────────────────────

module.exports = {
  init,
  setDeps,
  isHighRiskBrand,
  getProofChecklist,
  stripBrandFromText,
  normBrand,
  scoreBrandMatch,
  lookupVintedBrand,
  getUnbrandedId,
  triggerAuthGate,
  resumeAfterAuthGate,
  searchBrands,
};
