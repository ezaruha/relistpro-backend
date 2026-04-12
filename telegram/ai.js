const { ANALYSIS_MODEL } = require('./constants');

let _sharp = null;
try { _sharp = require('sharp'); } catch (_) {}

async function resizeForAI(base64) {
  if (!_sharp) return base64;
  try {
    const buf = Buffer.from(base64, 'base64');
    const out = await _sharp(buf)
      .resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    return out.toString('base64');
  } catch (_) { return base64; }
}

function extractJson(text) {
  if (!text) throw new Error('empty response');
  const fenced = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  const raw = fenced ? fenced[1] : (text.match(/\{[\s\S]*\}/)?.[0] || text);
  return JSON.parse(raw);
}

async function analyzeWithAI(photos, caption) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured on server');

  const captionCtx = caption ? `\n\nThe seller provided this info: "${caption}"  — use it to fill in details like brand, size, price, etc. Trust the seller's info over visual guesses.` : '';

  const selected = photos.slice(0, 5);
  const resized = await Promise.all(selected.map(p => {
    const raw = typeof p === 'string' ? p : p.base64 || p;
    return resizeForAI(raw);
  }));
  const imageBlocks = resized.map(data => ({
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data }
  }));

  const systemPrompt = `Expert Vinted UK reseller. Analyze every detail from photos to create perfect listings.

CRITICAL: You have ${imageBlocks.length} photo(s). Check EVERY photo — don't rely on photo 1 alone. Labels, tags, and size info often appear only on photos 2+. If you can't find info in photo 1, keep looking in photos 2, 3, 4... Front of item, back, inside label, care label, size label, and detail shots may each be separate photos.

PHOTOS: Examine ALL photos carefully. Look at:
- Labels, tags, care labels, size labels (front AND back of garment)
- Logos, branding, embroidery, prints
- Material texture and composition
- Stitching quality, wear marks, stains, damage
- Zips, buttons, hardware details
- Wash care symbols for material clues

TITLE: Max 60 chars. Format: [Brand] [Item] [Detail]. Search-friendly words only. Brand first if visible. Don't shout in ALL CAPS.
DESCRIPTION: 4-6 lines. Hook, key details (material/fit/style), measurements if visible, condition notes, hashtags. No filler. No "This is a...". Don't shout in ALL CAPS.
PRICE: Vinted UK used prices, NOT retail. Fast fashion £3-12, mid-range £8-20, premium £15-40, sportswear £10-35, designer £40-200+. NWT=60-70% retail, very good=30-50%, good=20-35%.
CONDITION: Check ALL photos for wear/damage. NWT=visible tags attached, NwoT=unworn no tags, Very good=minimal wear, Good=some wear, Satisfactory=visible damage.
BRAND: ONLY return a brand if you can clearly READ the brand name on a label, tag, logo print, engraving or embroidery. Do NOT guess based on silhouette, colour scheme, stripes, or style — a three-stripe pattern is not proof of Adidas, a swoosh-like curve is not proof of Nike, and a generic sportswear look is not proof of any brand. If the only brand-like evidence is shape, style, or vibe, return null and set confidence.brand to "low". If you can partially read letters on a label and you're confident about the reading, return that brand with confidence "medium". Return the brand EXACTLY as it appears on the label (don't normalise "adidas" to "Adidas" or the opposite).
CATEGORY: Return a structured path like "Women > Dresses > Midi dresses" or "Men > Jumpers > Hoodies" or "Kids > Girls > Tops" — use > as separator. Be as specific as possible to the leaf level.
COLOR: Primary color. One of: Black,White,Grey,Blue,Red,Green,Yellow,Pink,Orange,Purple,Brown,Beige,Cream,Multicolour,Khaki,Turquoise,Silver,Gold,Navy,Burgundy,Coral,Light blue. If item has a pattern/print, use Multicolour.
COLOR2: Secondary color if item is two-tone. null if single color.
SIZE: Read size labels/tags carefully. Return EXACTLY what the label says (e.g. "M", "UK 10", "EU 38", "S/M", "6-8", "XL", "One size"). This is critical — check ALL photos for size tags (inside garment, waistband, neck label).
MATERIAL: Read care labels. Return composition (e.g. "100% cotton", "80% polyester 20% elastane", "faux leather"). null if not visible.
PARCEL: Estimate weight category. "Small" (under 2kg, fits large letter), "Medium" (2-5kg, shoebox), "Large" (5-10kg, large box).
GENDER: "women", "men", "kids", "unisex" based on the item style and any labels.
CONFIDENCE: For each of brand, size, color — return "high" if you're sure from a clear label/logo, "medium" if inferring from context, "low" if not visible in any photo.

EXAMPLES — these show the exact output shape you must return. Don't copy the values; just match the structure and tone.

EXAMPLE 1 — Women's H&M black midi dress, 3 photos (front, back, inside label):
{
  "title": "H&M Black Midi Dress Size 10",
  "description": "Elegant black midi dress from H&M in a flattering A-line cut.\\nSoft polyester fabric with a subtle stretch — comfortable for all-day wear.\\nWorn twice, no marks or damage, comes from a smoke-free home.\\n#hm #blackdress #midi #smart",
  "suggested_price": 12,
  "brand": "H&M",
  "condition": "Very good",
  "category_hint": "Women > Dresses > Midi dresses",
  "color": "Black",
  "color2": null,
  "material": "95% polyester 5% elastane",
  "size_hint": "UK 10",
  "gender": "women",
  "parcel_size": "Small",
  "confidence": { "brand": "high", "size": "high", "color": "high" },
  "style_tags": ["smart", "office", "evening", "classic", "a-line"]
}

EXAMPLE 2 — Men's unbranded grey hoodie, 2 photos (front, inside label showing "M"):
{
  "title": "Grey Pullover Hoodie Size M",
  "description": "Classic grey pullover hoodie, perfect everyday staple.\\nSoft cotton-blend fleece inside, kangaroo pocket at the front.\\nGood condition with minimal wear — the drawcord is intact.\\n#hoodie #grey #menswear #basics",
  "suggested_price": 10,
  "brand": null,
  "condition": "Good",
  "category_hint": "Men > Jumpers & sweaters > Hoodies",
  "color": "Grey",
  "color2": null,
  "material": "80% cotton 20% polyester",
  "size_hint": "M",
  "gender": "men",
  "parcel_size": "Small",
  "confidence": { "brand": "low", "size": "high", "color": "high" },
  "style_tags": ["casual", "everyday", "basics", "streetwear", "loungewear"]
}`;

  const userContent = [
    ...imageBlocks,
    { type: 'text', text:
      `Analyze ${imageBlocks.length > 1 ? `these ${imageBlocks.length} photos` : 'this photo'} thoroughly and create a Vinted listing. Check EVERY photo for labels, tags, size info, brand logos, damage, etc.${captionCtx}\n\n` +
      `Return ONLY valid JSON (no markdown, no backticks, no explanation):\n` +
      `{\n` +
      `  "title": "searchable title max 60 chars (no ALL CAPS)",\n` +
      `  "description": "4-6 line description with hashtags (no ALL CAPS)",\n` +
      `  "suggested_price": <realistic used price in GBP as number>,\n` +
      `  "brand": "detected brand or null",\n` +
      `  "condition": "New with tags|New without tags|Very good|Good|Satisfactory",\n` +
      `  "category_hint": "Section > Category > Subcategory (e.g. Women > Tops > T-shirts)",\n` +
      `  "color": "primary color from allowed list",\n` +
      `  "color2": "secondary color or null",\n` +
      `  "material": "fabric composition or null",\n` +
      `  "size_hint": "EXACTLY what size label says or null",\n` +
      `  "gender": "women|men|kids|unisex",\n` +
      `  "parcel_size": "Small|Medium|Large",\n` +
      `  "confidence": { "brand": "high|medium|low", "size": "high|medium|low", "color": "high|medium|low" },\n` +
      `  "style_tags": ["up to 5 relevant style keywords for description"]\n` +
      `}`
    }
  ];

  async function callApi(temperature, usePrefill) {
    const msgs = [{ role: 'user', content: userContent }];
    if (usePrefill) msgs.push({ role: 'assistant', content: '{' });
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: ANALYSIS_MODEL,
        max_tokens: 1000,
        temperature,
        system: systemPrompt,
        messages: msgs
      })
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`API ${resp.status}: ${errText.slice(0, 200)}`);
    }
    const data = await resp.json();
    const raw = data.content?.[0]?.text || '';
    if (usePrefill && !raw.startsWith('{')) return '{' + raw;
    return raw;
  }

  let text;
  try {
    text = await callApi(0.2, true);
    return extractJson(text);
  } catch (e) {
    console.warn('[TG] analyzeWithAI: prefill attempt failed:', e.message, '— retrying without prefill');
  }
  text = await callApi(0, false);
  try {
    return extractJson(text);
  } catch (e2) {
    throw new Error('AI returned no valid JSON: ' + e2.message);
  }
}

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

async function aiSyncCompanion(sourceField, sourceValue, targetField, targetValue) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const prompt = sourceField === 'title'
    ? `The listing title was just changed to: "${sourceValue}"\n\nCurrent description:\n"${targetValue}"\n\nUpdate the description so it's consistent with the new title. Keep it 4-6 lines, keep relevant hashtags, keep the same tone. Return ONLY the updated description, no preamble.`
    : `The listing description was just changed to:\n"${sourceValue}"\n\nCurrent title: "${targetValue}"\n\nUpdate the title so it matches the description's key details (brand, item type, color, size if mentioned). Max 60 chars. Return ONLY the updated title, no preamble, no quotes.`;
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: 'You update Vinted listing fields to stay consistent. Return only the new value, no quotes, no explanation.',
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const result = data.content?.[0]?.text?.trim().replace(/^["']|["']$/g, '');
    return result || null;
  } catch { return null; }
}

async function aiPickCategory(itemDescription, shortlist, getCategories) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];
  try {
    const allCats = getCategories();
    let catList;
    if (shortlist && shortlist.length) {
      catList = shortlist.map(c => `${c.id}: ${c.path || c.title}`).join('\n');
    } else {
      catList = allCats.slice(0, 400).map(c => `${c.id}: ${c.path || c.title}`).join('\n');
    }
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
        temperature: 0,
        system: `You are a Vinted category matcher. Given an item description, pick the 3 best matching categories from the list below. Prefer the most specific leaf category that matches the actual item type. Match the correct section (Women/Men/Kids) based on the description. Return ONLY a JSON array of category IDs (numbers), best first.\n\nCategories:\n${catList}`,
        messages: [{ role: 'user', content: `Item: ${itemDescription}` }]
      })
    });
    const data = await resp.json();
    const text = data.content?.[0]?.text?.trim() || '';
    const arr = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] || '[]');
    const ids = arr.filter(id => typeof id === 'number');
    return ids.map(id => {
      const found = allCats.find(c => c.id === id);
      if (!found) return null;
      return { id: found.id, title: found.title, path: found.path || found.title };
    }).filter(Boolean);
  } catch (e) {
    console.error('[TG] AI category pick error:', e.message);
    return [];
  }
}

module.exports = {
  analyzeWithAI,
  extractJson,
  aiEdit,
  aiSyncCompanion,
  aiPickCategory,
};
