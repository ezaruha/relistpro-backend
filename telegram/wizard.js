const { WIZARD_STEPS, CONDITIONS, COLORS, PACKAGE_SIZES } = require('./constants');
const { esc, matchColor, clearErrorField, normalizeText, withTimeout } = require('./helpers');
const { getChat, activeAccount, saveChatState, ensureMulti } = require('./state');
const { analyzeWithAI } = require('./ai');

let bot, store, vintedFetch;

// Lazy references — set via setDeps() to break circular imports.
let _deps = {};
function setDeps(d) { Object.assign(_deps, d); }

function init(ctx) {
  bot = ctx.bot;
  store = ctx.store;
  vintedFetch = ctx.vintedFetch;
}

// ── Build fallback description when AI returns nothing usable ──

function buildFallbackDescription(analysis) {
  const title = (analysis && analysis.title) ? String(analysis.title).trim() : '';
  const brand = (analysis && analysis.brand) ? String(analysis.brand).trim() : '';
  const cond = (analysis && analysis.condition) ? String(analysis.condition).trim().toLowerCase() : '';
  const parts = [];
  if (brand && title) parts.push(`${brand} ${title}`);
  else if (title) parts.push(title);
  else if (brand) parts.push(brand);
  else parts.push('Item');
  if (cond) parts.push(`in ${cond} condition`);
  const out = parts.join(' ') + '.';
  return out.length >= 5 ? out : 'Pre-owned item in good condition.';
}

// ── Process photos: AI analysis → field mapping → auto-resolve ──

async function processPhotos(chatId) {
  const c = getChat(chatId);
  c.step = 'analyzing';
  const acctName = activeAccount(c)?.vintedName || activeAccount(c)?.username || '';
  const acctInfo = acctName ? ` for ${acctName}` : '';

  await bot.sendMessage(chatId,
    `📸 Got ${c.photos.length} photo(s)${acctInfo}. Analyzing with AI — detecting brand, condition, estimating price...\n\nThis takes a few seconds.`
  );

  try {
    // Send up to 20 photos to AI (Anthropic limit) — more photos = better label detection
    const photosForAI = c.photos.slice(0, 20).map(p => p.base64);
    const analysis = await analyzeWithAI(photosForAI, c.caption);

    // Map condition text to status_id
    const condMatch = CONDITIONS.find(x =>
      x.label.toLowerCase() === (analysis.condition || '').toLowerCase()
    );

    // Auto-match primary color (fuzzy — aliases + partial).
    // Symmetric with brand/size: if AI confidence is 'low', leave blank
    // so the review card surfaces it as missing instead of posting a guess.
    const colorConf = analysis.confidence?.color || 'medium';
    const c1Match = colorConf === 'low' ? null : matchColor(analysis.color);
    let colorId = c1Match?.id || null;
    let colorName = c1Match?.label || (colorConf === 'low' ? '' : (analysis.color || ''));

    // Secondary colour — same gate. A low-confidence primary usually means
    // the secondary is even less reliable, so drop it too in that case.
    const c2Match = colorConf === 'low' ? null : matchColor(analysis.color2);
    let color2Id = c2Match?.id || null;
    let color2Name = c2Match?.label || '';

    // Auto-match parcel size from AI recommendation
    let pkgId = null, pkgName = '';
    if (analysis.parcel_size) {
      const pkgMatch = PACKAGE_SIZES.find(p => p.title.toLowerCase() === analysis.parcel_size.toLowerCase());
      if (pkgMatch) { pkgId = pkgMatch.id; pkgName = pkgMatch.title; }
    }

    // Reset dup-prompt flags — each new listing must answer again
    delete c._dupChecked;
    delete c._dupEdit;
    c.listing = {
      title: analysis.title || 'Untitled item',
      description: (analysis.description && analysis.description.trim().length >= 5)
        ? analysis.description
        : buildFallbackDescription(analysis),
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
      color2: color2Name,
      color2_id: color2Id,
      material: analysis.material || '',
      gender: analysis.gender || '',
      package_size_id: pkgId,
      package_size_name: pkgName,
      aiConfidence: analysis.confidence || { brand: 'medium', size: 'medium', color: 'medium' },
    };

    saveChatState(chatId);
  } catch (e) {
    console.error('[TG] AI analysis error:', e.message);
    c.step = 'idle';
    bot.sendMessage(chatId, 'AI analysis failed: ' + e.message + '\nTry sending the photos again.');
    return;
  }

  // Resolve runs outside the AI try/catch so a Vinted autocomplete hang
  // or error gets reported as itself, not as "AI analysis failed".
  try {
    await bot.sendMessage(chatId, '🤖 Resolving category, size and brand…');
    await autoResolveListing(chatId);
  } catch (e) {
    console.error('[TG] autoResolveListing error:', e.message);
    // Fall through to the wizard so the user can finish manually.
    await bot.sendMessage(chatId,
      `⚠️ Auto-resolve failed: ${e.message}\n\nI'll ask you for the missing fields in the wizard.`
    );
    try { await proceedToReview(chatId); }
    catch (e2) {
      c.step = 'idle';
      await bot.sendMessage(chatId, `Couldn't recover: ${e2.message}. Try /cancel and start over.`);
    }
  }
}

// ── Auto-resolve category, size, brand from AI analysis ──

async function autoResolveListing(chatId) {
  const c = getChat(chatId);
  const L = c.listing;
  if (!L) return;
  const acct = activeAccount(c);
  const session = acct ? await store.getSession(acct.userId).catch(() => null) : null;

  if (!session) {
    await bot.sendMessage(chatId,
      '⚠️ No Vinted session stored yet — I can\'t auto-resolve size or brand.\n\n' +
      'Open Vinted in Chrome with the RelistPro extension and sync, then post again for full auto-fill. ' +
      'Continuing with manual entry…'
    );
  }

  const warnings = [];

  // Category first — size lookup needs catalog_id.
  if (!L.catalog_id) {
    try {
      if (session) await withTimeout(_deps.ensureLiveCatalog(session), 12000, 'live catalog refresh');
    } catch (e) {
      console.log(`[TG] autoResolve ensureLiveCatalog skipped: ${e.message}`);
    }
    try {
      const cat = await _deps.autoResolveCategory(L);
      if (cat) {
        L.catalog_id = cat.id;
        L.category_name = cat.path || cat.title || `ID: ${cat.id}`;
        console.log(`[TG] autoResolve category → ${L.category_name} (id=${cat.id})`);
      } else {
        console.log('[TG] autoResolve category → no match');
        warnings.push('category');
      }
    } catch (e) {
      console.log(`[TG] autoResolve category → error: ${e.message}`);
      warnings.push('category');
    }
  }

  // Size: AI hint → Vinted size match → fall back to "One size" if catalog allows.
  if (!L.size_id && L.catalog_id && session) {
    try {
      const s = await withTimeout(_deps.autoResolveSize(session, L), 15000, 'size lookup');
      if (s) {
        L.size_id = s.id;
        L.size_name = s.title;
        console.log(`[TG] autoResolve size → ${s.title} (id=${s.id})`);
      } else {
        const one = await withTimeout(_deps.findOneSize(session, L.catalog_id), 10000, 'one-size lookup');
        if (one) {
          L.size_id = one.id;
          L.size_name = one.title;
          console.log(`[TG] autoResolve size → fallback One size (id=${one.id})`);
        } else {
          console.log('[TG] autoResolve size → no match, user must pick manually');
          warnings.push('size');
        }
      }
    } catch (e) {
      console.log(`[TG] autoResolve size → error: ${e.message}`);
      warnings.push('size');
    }
  }

  // Brand: if AI confidence is "low" we DO NOT trust the string at all.
  if (L.aiConfidence?.brand === 'low') {
    console.log(`[TG] autoResolve brand → dropping low-confidence AI guess "${L.brand}"`);
    L.brand = '';
    L.brand_id = null;
  } else if (!L.brand_id && L.brand && session) {
    try {
      const b = await withTimeout(_deps.lookupVintedBrand(session, L.brand), 12000, 'brand lookup');
      if (b && b.score >= 60) {
        L.brand_id = b.id;
        L.brand = b.title;
        console.log(`[TG] autoResolve brand → ${b.title} (id=${b.id}, score=${b.score})`);
      } else {
        if (b) console.log(`[TG] autoResolve brand → ignoring weak match "${b.title}" (score=${b.score}) for "${L.brand}"`);
        L.brand = normalizeText(L.brand, 'title');
        L.brand_id = null;
        console.log(`[TG] autoResolve brand → "${L.brand}" (plain text, Vinted will create on post)`);
      }
    } catch (e) {
      console.log(`[TG] autoResolve brand → error: ${e.message}`);
      L.brand = normalizeText(L.brand, 'title');
      L.brand_id = null;
    }
  }

  if (warnings.length) {
    await bot.sendMessage(chatId,
      `⚠️ Couldn't auto-resolve: ${warnings.join(', ')}. I'll ask you for ${warnings.length > 1 ? 'those' : 'that'} in the next step.`
    );
  }

  saveChatState(chatId);

  // Brand still empty? Ask the user before the summary.
  if (!L.brand || !String(L.brand).trim()) {
    return promptFastBrand(chatId);
  }

  return proceedToReview(chatId);
}

// ── Authenticity gate → summary tail ──

async function proceedToReview(chatId) {
  const c = getChat(chatId);
  const L = c.listing;
  if (!L) return;
  const effectiveName = L.brand || '';
  if (L.brand_id > 0 && !c._authChecked && _deps.isHighRiskBrand(effectiveName)) {
    c._authPrevStep = 'review';
    return _deps.triggerAuthGate(chatId, effectiveName);
  }
  c.step = 'review';
  c._summaryEditOpen = false;
  saveChatState(chatId);
  return _deps.showSummary(chatId);
}

// ── Ask the user to type a brand when AI couldn't detect one ──

async function promptFastBrand(chatId) {
  const c = getChat(chatId);
  c.step = 'fast_brand_prompt';
  saveChatState(chatId);
  return bot.sendMessage(chatId,
    `🏷️ *Brand?*\n\n` +
    `I couldn't read a brand off your photos. Type the brand name and I'll try to match it in Vinted's catalogue — if it's not there I'll still post it as plain text.\n\n` +
    `If the item is unbranded or you don't know, tap the button below.`,
    {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [
        [{ text: '🏷️ Post as Unbranded', callback_data: 'fast:unbranded' }],
      ]}
    }
  );
}

// ── Show package size picker (used by wizard parcel step) ──

async function showPackageSizePicker(chatId) {
  const c = getChat(chatId);
  const inWiz = c.step.startsWith('wiz_');
  const header = inWiz ? '📮 Step 9/9 — Parcel Size\n\n' : '';

  // Try fetching live package sizes from Vinted
  let sizes = PACKAGE_SIZES;
  try {
    const acct = activeAccount(c);
    if (acct) {
      const session = await store.getSession(acct.userId);
      if (session) {
        const resp = await vintedFetch(session, '/api/v2/package_sizes');
        if (resp.ok) {
          const data = await resp.json();
          const live = data.package_sizes || data;
          if (Array.isArray(live) && live.length) {
            sizes = live.map(s => ({
              id: s.id,
              title: s.title || s.name || `Size ${s.id}`,
              desc: s.description || s.custom_title || ''
            }));
            console.log(`[TG] Loaded ${sizes.length} package sizes from Vinted`);
          }
        }
      }
    }
  } catch (e) {
    console.log('[TG] Package size fetch failed, using hardcoded:', e.message);
  }

  c.packageSizeCache = sizes;

  const rows = sizes.map(s => [{
    text: s.desc ? `${s.title} — ${s.desc}` : s.title,
    callback_data: `pkg:${s.id}`
  }]);
  rows.push([{ text: '📐 Enter custom dimensions', callback_data: 'pkg:custom' }]);
  rows.push([{ text: '⏭️ Skip', callback_data: 'pkg:0' }]);

  bot.sendMessage(chatId, header + 'Select parcel size:', {
    reply_markup: { inline_keyboard: rows }
  });
}

// ── Ask the current wizard step ──

async function askWizardStep(chatId) {
  const c = getChat(chatId);
  const L = c.listing;
  if (!L) {
    c.step = 'idle';
    return bot.sendMessage(chatId, 'Listing data lost. Send photos to start a new listing.');
  }
  const stepName = WIZARD_STEPS[c.wizardIdx];

  if (stepName === 'title') {
    c.step = 'wiz_title';
    const conf = L.aiConfidence || {};
    const warnTag = (key) => conf[key] === 'low' ? ' ⚠️ (low confidence — verify)' : '';
    let detected = '';
    if (L.brand) detected += `  Brand: ${L.brand}${warnTag('brand')}\n`;
    if (L.size_hint) detected += `  Size: ${L.size_hint}${warnTag('size')}\n`;
    if (L.material) detected += `  Material: ${L.material}\n`;
    if (L.color) detected += `  Colour: ${L.color}${L.color2 ? ' / ' + L.color2 : ''}${warnTag('color')}\n`;
    if (L.condition) detected += `  Condition: ${L.condition}\n`;
    if (L.gender) detected += `  Gender: ${L.gender}\n`;
    if (L.package_size_name) detected += `  Parcel: ${L.package_size_name}\n`;
    if (detected) detected = `\nAI detected from photos:\n${detected}`;
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
      const searchTerm = L.category_hint
        ? L.category_hint.split('/').filter(Boolean).pop() || L.title
        : (L.title || '').split(' ').slice(0, 2).join(' ');
      if (searchTerm) return await _deps.searchCategories(chatId, searchTerm);
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
    return _deps.showSizePicker(chatId);
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
        text: x.label + (x.id === L.color1_id ? ' ✓' : (x.id === L.color2_id ? ' ✓2' : '')),
        callback_data: `color:${x.id}`
      })));
    }
    const colorDisplay = L.color ? (L.color2 ? `${L.color} / ${L.color2}` : L.color) : 'Not detected';
    const lowConf = L.aiConfidence?.color === 'low';
    const forcePick = !L.color1_id || lowConf;
    if (L.color1_id && !forcePick) rows.push([{ text: '✅ Keep: ' + colorDisplay, callback_data: 'wiz:accept' }]);
    rows.push([{ text: '⏭️ Skip (may stay as draft on Vinted)', callback_data: 'wiz:accept' }]);
    const prompt = forcePick
      ? `🎨 Step 7/9 — Colour\n\n⚠️ Color ${!L.color1_id ? 'not detected' : 'low confidence'}${L.color ? ` (AI said "${L.color}")` : ''}.\nPlease pick one — items without a colour often stay as drafts on Vinted.`
      : `🎨 Step 7/9 — Colour\n\nAI detected: ${colorDisplay}\n\nTap a colour below, or skip:`;
    return bot.sendMessage(chatId, prompt, { reply_markup: { inline_keyboard: rows } });
  }

  if (stepName === 'brand') {
    c.step = 'wiz_brand';
    if (L.brand) {
      await bot.sendMessage(chatId, `🏷️ Step 8/9 — Brand\n\nAI detected: ${L.brand}\n\nLooking up in Vinted...`);
      return _deps.searchBrands(chatId, L.brand);
    }
    return bot.sendMessage(chatId,
      `🏷️ Step 8/9 — Brand\n\nNo brand detected.\n\nType a brand name to search, or tap Skip:`,
      { reply_markup: { inline_keyboard: [
        [{ text: '⏭️ No brand / Skip', callback_data: 'brand:0:' }]
      ]}}
    );
  }

  if (stepName === 'parcel') {
    c.step = 'wiz_parcel';
    return showPackageSizePicker(chatId);
  }

  if (stepName === 'confirm') {
    c.step = 'review';
    return _deps.showSummary(chatId);
  }
}

// ── Advance wizard to next step ──

function wizardNext(chatId) {
  const c = getChat(chatId);
  c.wizardIdx = (c.wizardIdx || 0) + 1;
  saveChatState(chatId);
  if (c.wizardIdx >= WIZARD_STEPS.length) {
    c.step = 'review';
    return _deps.showSummary(chatId);
  }
  return askWizardStep(chatId);
}

function selectPackageSize(chatId, pkgId) {
  const c = getChat(chatId);
  if (pkgId === 0) {
    c.listing.package_size_id = null;
    c.listing.package_size_name = 'N/A';
  } else {
    const pkg = (c.packageSizeCache || PACKAGE_SIZES).find(p => p.id === pkgId);
    c.listing.package_size_id = pkgId;
    c.listing.package_size_name = pkg ? pkg.title : `ID: ${pkgId}`;
  }
  clearErrorField(c, 'parcel');
  if (c.step.startsWith('wiz_')) return wizardNext(chatId);
  c.step = 'review';
  c._justEdited = 'parcel';
  return _deps.showSummary(chatId);
}

module.exports = {
  init,
  setDeps,
  askWizardStep,
  wizardNext,
  autoResolveListing,
  proceedToReview,
  promptFastBrand,
  processPhotos,
  buildFallbackDescription,
  showPackageSizePicker,
  selectPackageSize,
};
