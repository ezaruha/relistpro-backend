const { CATEGORIES, CATALOG_TTL_MS } = require('./constants');
const { esc, clearErrorField } = require('./helpers');
const { getChat, activeAccount, saveChatState } = require('./state');
const { aiPickCategory } = require('./ai');

// ── Injected via init() ──
let bot = null;
let store = null;
let vintedFetch = null;

// ── Module-level catalog cache ──
let _liveCatalogCache = null;
let _catalogFetchPromise = null;
let _catalogFetchedAt = 0;
let _liveCatalogBackoffUntil = 0;

function init(ctx) {
  bot = ctx.bot;
  store = ctx.store;
  vintedFetch = ctx.vintedFetch;
}

// Get category list (live if fetched, fallback to hardcoded)
function getCategories() {
  return _liveCatalogCache || CATEGORIES;
}

// Fetch live Vinted catalog tree (lazy, cached with TTL)
async function fetchLiveCatalog(session) {
  if (!session) return null;
  if (_liveCatalogCache && (Date.now() - _catalogFetchedAt) < CATALOG_TTL_MS) return _liveCatalogCache;
  try {
    const resp = await vintedFetch(session, '/api/v2/catalogs');
    if (!resp.ok) {
      console.log(`[TG] Live catalog fetch failed: ${resp.status}`);
      return null;
    }
    const data = await resp.json();
    const tree = data.catalogs || data.catalog || data || [];
    const flat = [];
    const walk = (nodes, parentPath) => {
      if (!Array.isArray(nodes)) return;
      for (const n of nodes) {
        const title = n.title || n.name || '';
        const path = parentPath ? `${parentPath} > ${title}` : title;
        const kids = n.catalogs || n.children || [];
        if ((!kids || !kids.length) && n.id) {
          flat.push({
            id: n.id,
            title: path,
            path,
            keywords: [title.toLowerCase(), ...title.toLowerCase().split(/\s+/)].filter(Boolean)
          });
        }
        if (kids && kids.length) walk(kids, path);
      }
    };
    walk(Array.isArray(tree) ? tree : [tree], '');
    if (flat.length >= 50) {
      _liveCatalogCache = flat;
      _catalogFetchedAt = Date.now();
      console.log(`[TG] Live catalog loaded: ${flat.length} leaf categories`);
      return flat;
    }
    console.log(`[TG] Live catalog too small (${flat.length}), using hardcoded`);
    return null;
  } catch (e) {
    console.log(`[TG] Live catalog fetch error: ${e.message}`);
    return null;
  }
}

async function ensureLiveCatalog(session) {
  if (_liveCatalogCache) return _liveCatalogCache;
  // Negative cache: Vinted's catalog endpoint has been 404ing for a while.
  // Back off for 1h after a failure instead of spamming a dead URL on
  // every photo analysis (~1–2s latency + log noise per listing).
  if (Date.now() < _liveCatalogBackoffUntil) return null;
  if (!_catalogFetchPromise) {
    _catalogFetchPromise = fetchLiveCatalog(session)
      .then(r => {
        if (!r) _liveCatalogBackoffUntil = Date.now() + 60 * 60 * 1000;
        return r;
      })
      .catch(e => {
        _liveCatalogBackoffUntil = Date.now() + 60 * 60 * 1000;
        console.warn('[TG] live catalog fetch failed, backing off 1h:', e.message);
        return null;
      })
      .finally(() => { _catalogFetchPromise = null; });
  }
  return _catalogFetchPromise;
}

// Search categories by keyword — uses hardcoded list (always works) + API fallback
function searchCategoriesByKeyword(keyword) {
  const q = keyword.toLowerCase().trim();
  if (!q) return [];

  const cats = getCategories();
  // Score each category by keyword match
  const scored = [];
  for (const cat of cats) {
    let score = 0;
    const catTitle = cat.title || '';
    const catPath = cat.path || catTitle;
    // Check title match
    if (catTitle.toLowerCase().includes(q) || catPath.toLowerCase().includes(q)) score += 10;
    // Check keyword matches (live catalog has keywords too; hardcoded always has them)
    const kws = cat.keywords || [catTitle.toLowerCase(), ...catTitle.toLowerCase().split(/\s+/)];
    for (const kw of kws) {
      if (kw.includes(q) || q.includes(kw)) score += 5;
      // Partial word match
      const words = q.split(/\s+/);
      for (const w of words) {
        if (w.length >= 3 && kw.includes(w)) score += 2;
      }
    }
    if (score > 0) scored.push({ id: cat.id, title: catTitle, score, path: catPath, hasChildren: false });
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 8);
}

async function searchCategories(chatId, query) {
  const c = getChat(chatId);
  const inWiz = c.step.startsWith('wiz_');
  const header = inWiz ? '📂 Step 4/9 — Category\n\n' : '';

  // Lazy-load live Vinted catalog (cached 24h) — falls back to CATEGORIES silently
  const acct = activeAccount(c);
  if (acct) {
    try {
      const session = await store.getSession(acct.userId);
      if (session) await ensureLiveCatalog(session);
    } catch {}
  }

  // 0. If category_hint is a structured path (e.g. "Women > Tops > T-shirts"), use it first
  let matches = [];
  if (c.listing?.category_hint) {
    const pathParts = c.listing.category_hint.split(/\s*[>\/]\s*/).map(p => p.trim()).filter(Boolean);
    if (pathParts.length >= 2) {
      // The AI analysis also carries a `gender` field — cross-check it so
      // a men's item with a sloppy hint doesn't land under a women's category.
      const hintGender = (c.listing?.gender || '').toLowerCase();
      const genderSection = hintGender === 'women' ? 'women'
        : hintGender === 'men' ? 'men'
        : hintGender === 'kids' ? 'kids'
        : null;
      for (let i = pathParts.length - 1; i >= 0; i--) {
        const partMatches = searchCategoriesByKeyword(pathParts[i]);
        if (partMatches.length) {
          matches = partMatches
            .map(m => {
              const mTitle = (m.path || m.title || '').toLowerCase();
              // Weighted scoring: section (first part) and leaf (last part)
              // matter far more than middle parts. Middle parts are
              // cosmetic; section sets the department and leaf identifies
              // the actual item type.
              let score = pathParts.reduce((acc, part, idx) => {
                if (!mTitle.includes(part.toLowerCase())) return acc;
                if (idx === 0) return acc + 10;
                if (idx === pathParts.length - 1) return acc + 5;
                return acc + 1;
              }, 0);
              // Strong gender cross-check: if AI gave us a gender and the
              // candidate's section doesn't match, heavily penalise it.
              if (genderSection) {
                const mSection = mTitle.split('>')[0].trim();
                if (mSection.includes(genderSection)) score += 8;
                else score -= 12;
              }
              return { ...m, _score: score };
            })
            .sort((a, b) => b._score - a._score)
            .slice(0, 8);
          console.log(`[TG] Structured path match via "${pathParts[i]}": ${matches.length} (gender=${genderSection || 'none'})`);
          break;
        }
      }
    }
  }

  // 1. Search by keyword
  if (!matches.length) {
    matches = searchCategoriesByKeyword(query);
    console.log(`[TG] Category search "${query}": ${matches.length} keyword matches`);
  }

  // 2. Try individual words from the query
  if (!matches.length && query.includes(' ')) {
    const words = query.split(/\s+/).filter(w => w.length >= 3);
    for (const word of words) {
      matches = searchCategoriesByKeyword(word);
      if (matches.length) { console.log(`[TG] Found via word "${word}"`); break; }
    }
  }

  // 3. Try each part of category_hint (legacy slash-separated)
  if (!matches.length && c.listing?.category_hint) {
    const parts = c.listing.category_hint.split(/[\/>,]+/).map(p => p.trim()).filter(p => p && p !== query);
    for (const part of parts) {
      matches = searchCategoriesByKeyword(part);
      if (matches.length) { console.log(`[TG] Found via hint part "${part}"`); break; }
    }
  }

  // 4. Ask AI to pick the best category from our list
  if (!matches.length) {
    const itemDesc = c.listing ? `${c.listing.title || ''} ${query}`.trim() : query;
    matches = await aiPickCategory(itemDesc, null, getCategories);
    if (matches.length) console.log(`[TG] AI picked ${matches.length} categories`);
  }

  if (!matches.length) {
    return bot.sendMessage(chatId, header + `No match for "${query}". Try a different term (e.g. "hoodie", "stroller", "trainers"):`, {
      reply_markup: { inline_keyboard: [[{ text: '🔍 Search again', callback_data: 'cat:search' }]] }
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
  const match = getCategories().find(x => x.id === catId);
  c.listing.catalog_id = catId;
  c.listing.category_name = match ? (match.title || match.path || `ID: ${catId}`) : `ID: ${catId}`;
  clearErrorField(c, 'category');
  console.log(`[TG] Category selected: ${c.listing.category_name} (catalog_id=${catId})`);
  c.listing.size_id = null;
  c.listing.size_name = '';
  // NOTE: caller must handle wizard-next / review transitions
  // since wizardNext and showSummary live in other modules.
  // Return the chat object so the caller can route appropriately.
  return c;
}

// Pick the top-scored category for the AI hint. Returns {id, title, path}|null.
// Same structured-path + keyword + gender scoring as searchCategories, but
// returns silently without rendering a picker.
async function autoResolveCategory(L) {
  if (!L.category_hint && !L.title) return null;
  const hint = L.category_hint || L.title;
  const parts = hint.split(/\s*[>\/]\s*/).map(p => p.trim()).filter(Boolean);
  const hintGender = (L.gender || '').toLowerCase();
  const gSection = hintGender === 'women' ? 'women'
    : hintGender === 'men' ? 'men'
    : hintGender === 'kids' ? 'kids' : null;

  let matches = [];
  if (parts.length >= 2) {
    for (let i = parts.length - 1; i >= 0 && !matches.length; i--) {
      const pm = searchCategoriesByKeyword(parts[i]);
      if (!pm.length) continue;
      matches = pm.map(m => {
        const mt = (m.path || m.title || '').toLowerCase();
        let score = parts.reduce((a, p, idx) => {
          if (!mt.includes(p.toLowerCase())) return a;
          if (idx === 0) return a + 10;
          if (idx === parts.length - 1) return a + 5;
          return a + 1;
        }, 0);
        if (gSection) {
          const ms = mt.split('>')[0].trim();
          score += ms.includes(gSection) ? 8 : -12;
        }
        return { ...m, _score: score };
      }).sort((a, b) => b._score - a._score);
    }
  }
  if (!matches.length) matches = searchCategoriesByKeyword(hint);
  if (!matches.length && L.title) {
    const words = L.title.split(/\s+/).filter(w => w.length >= 3);
    for (const w of words) {
      const m = searchCategoriesByKeyword(w);
      if (m.length) { matches = m; break; }
    }
  }

  // If keyword scoring has a clear, unambiguous winner — take it and skip
  // the AI round trip. Otherwise, build a shortlist of the top candidates
  // across the whole catalog and let the AI pick. "Clear winner" = top score
  // ≥15 AND a ≥5 gap over second place; anything less is likely a substring
  // collision that the AI can disambiguate from the item description.
  const top = matches[0];
  const second = matches[1];
  const clearWinner = top && (top._score || 0) >= 15
    && (!second || (top._score - (second._score || 0)) >= 5);

  if (clearWinner) return top;

  // Build shortlist: existing matches + broader keyword search for every
  // part of the hint + title words, deduped by id, capped at 40.
  const shortlistMap = new Map();
  const addAll = (rows) => {
    for (const r of rows || []) {
      if (r && r.id && !shortlistMap.has(r.id)) shortlistMap.set(r.id, r);
    }
  };
  addAll(matches);
  for (const p of parts) addAll(searchCategoriesByKeyword(p));
  if (L.title) {
    for (const w of L.title.split(/\s+/).filter(w => w.length >= 3)) {
      addAll(searchCategoriesByKeyword(w));
    }
  }
  const shortlist = Array.from(shortlistMap.values()).slice(0, 40);

  const itemDesc = `${L.title || ''} — ${hint}${gSection ? ' (' + gSection + ')' : ''}`.trim();
  const aiPicks = await aiPickCategory(itemDesc, shortlist.length ? shortlist : null, getCategories);
  if (aiPicks.length) return aiPicks[0];

  // Last resort: whatever the keyword scoring turned up, even if weak.
  return top || null;
}

module.exports = {
  init,
  getCategories,
  fetchLiveCatalog,
  ensureLiveCatalog,
  searchCategoriesByKeyword,
  searchCategories,
  selectCategory,
  autoResolveCategory,
};
