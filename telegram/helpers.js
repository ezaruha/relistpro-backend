const { COLORS, COLOR_ALIASES, CLOTHING_CATEGORY_IDS } = require('./constants');

function esc(text) {
  if (!text) return '';
  return String(text).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

function escMd2(s) {
  return String(s == null ? '' : s).replace(/[_*\[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

function normalizeText(text, mode = 'sentence') {
  if (!text) return '';
  const t = String(text);
  const letters = t.replace(/[^a-zA-Z]/g, '');
  const upperCount = (t.match(/[A-Z]/g) || []).length;
  const isShouty = letters.length > 3 && upperCount > letters.length * 0.5;

  if (mode === 'title') {
    const smallWords = new Set(['and', 'of', 'the', 'for', 'in', 'on', 'at', 'to', 'a', 'an', '&']);
    return t.toLowerCase().split(/(\s+|-)/).map((word, i) => {
      if (!word.trim() || word === '-') return word;
      if (i > 0 && smallWords.has(word.toLowerCase())) return word.toLowerCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    }).join('');
  }

  if (isShouty) {
    return t.toLowerCase().replace(/(^|\.\s+|!\s+|\?\s+|\n+)([a-z])/g, (_, pre, c) => pre + c.toUpperCase());
  }
  return t;
}

function matchColor(colorStr) {
  if (!colorStr) return null;
  const s = String(colorStr).trim().toLowerCase();
  if (!s) return null;
  let hit = COLORS.find(x => x.label.toLowerCase() === s);
  if (hit) return { id: hit.id, label: hit.label };
  const alias = COLOR_ALIASES[s];
  if (alias) {
    hit = COLORS.find(x => x.label.toLowerCase() === alias.toLowerCase());
    if (hit) return { id: hit.id, label: hit.label };
  }
  for (const [aliasKey, canon] of Object.entries(COLOR_ALIASES)) {
    if (s.includes(aliasKey)) {
      hit = COLORS.find(x => x.label.toLowerCase() === canon.toLowerCase());
      if (hit) return { id: hit.id, label: hit.label };
    }
  }
  for (const col of COLORS) {
    const lab = col.label.toLowerCase();
    const re = new RegExp(`\\b${lab.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    if (re.test(s)) return { id: col.id, label: col.label };
  }
  return null;
}

function isClothingCategory(catalogId, liveCatalogCache) {
  if (!catalogId) return false;
  if (CLOTHING_CATEGORY_IDS.has(catalogId)) return true;
  if (liveCatalogCache) {
    const entry = liveCatalogCache.find(c => c.id === catalogId);
    if (entry) {
      const path = (entry.path || '').toLowerCase();
      const isWMK = /^(women|men|kids)\b/.test(path);
      const isNonClothing = /(shoes|bags|jewellery|accessories|beauty|grooming|toys|pushchairs|nursing|bathing|sleep)/.test(path);
      return isWMK && !isNonClothing;
    }
  }
  return false;
}

function titleWithSize(L, liveCatalogCache) {
  let t = normalizeText(L.title, 'title');
  const sz = L.size_name;
  const hasValidSize = sz && sz !== 'N/A' && sz !== 'Not set' && sz !== '';
  if (hasValidSize && isClothingCategory(L.catalog_id, liveCatalogCache)) {
    const sizeInTitle = new RegExp(`\\b(size\\s+)?${sz.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (!sizeInTitle.test(t)) {
      const suffix = ` - Size ${sz}`;
      if ((t + suffix).length <= 80) t += suffix;
      else t = t.slice(0, 80 - suffix.length).trim() + suffix;
    }
  }
  return t;
}

function clearErrorField(c, field) {
  if (c.listing?._errorFields) {
    c.listing._errorFields = c.listing._errorFields.filter(f => f !== field);
  }
}

function estimatePostEta(photoCount) {
  const warming = 4500;
  const perPhoto = 3500;
  const betweenPhoto = 1750 * Math.max(0, photoCount - 1);
  const reviewPhotos = 7000;
  const title = 14000;
  const desc = 17500;
  const details = 25000;
  const finalReview = 35000;
  const prePublish = 5500;
  const publish = 2250;
  return warming + perPhoto * photoCount + betweenPhoto +
         reviewPhotos + title + desc + details + finalReview + prePublish + publish;
}

function fmtDur(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function browserHeaders(domain, referPath = '/') {
  return {
    'Referer': `https://${domain}${referPath}`,
    'Origin': `https://${domain}`,
    'Accept-Language': 'en-GB,en;q=0.9',
    'sec-ch-ua': '"Google Chrome";v="120", "Chromium";v="120", "Not=A?Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'X-Requested-With': 'XMLHttpRequest',
  };
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

module.exports = {
  esc,
  escMd2,
  normalizeText,
  matchColor,
  isClothingCategory,
  titleWithSize,
  clearErrorField,
  estimatePostEta,
  fmtDur,
  browserHeaders,
  withTimeout,
};
