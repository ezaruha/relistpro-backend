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
let sharp = null;
try {
  sharp = require('sharp');
  console.log('[TG] sharp loaded OK — photo re-editing enabled');
} catch (e) {
  console.error('[TG] CRITICAL: sharp not available — photo re-editing disabled:', e.message);
}

// Vinted usernames that get the "admin" duplicate-check prompt (case-insensitive)
const ADMIN_VINTED_USERNAMES = ['zaruha'];

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
// Verified Vinted UK catalog IDs (scraped from vinted.co.uk/catalog April 2026)
const CATEGORIES = [
  // ══════════════════════════════════════════════════════════
  // WOMEN > CLOTHING
  // ══════════════════════════════════════════════════════════
  // ── Women > Tops & T-shirts (12) ──
  { id: 1043, title: 'Women > Tops > Blouses', keywords: ['blouse','women blouse'] },
  { id: 221, title: 'Women > Tops > T-shirts', keywords: ['t-shirt','tshirt','tee','women t-shirt','women tee'] },
  { id: 1041, title: 'Women > Tops > Crop tops', keywords: ['crop top','cropped'] },
  { id: 224, title: 'Women > Tops > Long-sleeved tops', keywords: ['long sleeve','women long sleeve'] },
  { id: 534, title: 'Women > Tops > Vest tops', keywords: ['vest','tank top','cami','vest top'] },
  { id: 222, title: 'Women > Tops > Shirts', keywords: ['shirt','women shirt'] },
  { id: 223, title: 'Women > Tops > Short-sleeved tops', keywords: ['short sleeve','women short sleeve'] },
  { id: 14, title: 'Women > Tops > Camis', keywords: ['camisole','women cami'] },
  { id: 1042, title: 'Women > Tops > Off-the-shoulder tops', keywords: ['off shoulder','bardot'] },
  { id: 1835, title: 'Women > Tops > Bodysuits', keywords: ['bodysuit','body'] },
  { id: 225, title: 'Women > Tops > 3/4-sleeve tops', keywords: ['3/4 sleeve'] },
  { id: 1044, title: 'Women > Tops > Halterneck tops', keywords: ['halterneck','halter'] },
  { id: 227, title: 'Women > Tops > Tunics', keywords: ['tunic'] },
  { id: 1837, title: 'Women > Tops > Peplum tops', keywords: ['peplum'] },
  { id: 1045, title: 'Women > Tops > Turtlenecks', keywords: ['turtleneck','roll neck','polo neck'] },
  { id: 228, title: 'Women > Tops > Other tops', keywords: ['women top','top'] },
  // ── Women > Dresses (10) ──
  { id: 1065, title: 'Women > Dresses > Summer dresses', keywords: ['summer dress','sundress'] },
  { id: 1055, title: 'Women > Dresses > Long dresses', keywords: ['long dress','maxi dress','maxi'] },
  { id: 1774, title: 'Women > Dresses > Special-occasion dresses', keywords: ['special occasion dress','prom dress','evening dress'] },
  { id: 1056, title: 'Women > Dresses > Midi dresses', keywords: ['midi dress','midi'] },
  { id: 178, title: 'Women > Dresses > Mini dresses', keywords: ['mini dress'] },
  { id: 1059, title: 'Women > Dresses > Casual dresses', keywords: ['casual dress'] },
  { id: 1058, title: 'Women > Dresses > Little black dresses', keywords: ['little black dress','lbd'] },
  { id: 1057, title: 'Women > Dresses > Formal & work dresses', keywords: ['formal dress','work dress'] },
  { id: 1061, title: 'Women > Dresses > Strapless dresses', keywords: ['strapless dress','bandeau dress'] },
  { id: 179, title: 'Women > Dresses > Denim dresses', keywords: ['denim dress','jeans dress'] },
  { id: 1779, title: 'Women > Dresses > Winter dresses', keywords: ['winter dress','knitted dress'] },
  { id: 176, title: 'Women > Dresses > Other dresses', keywords: ['dress','gown','women dress'] },
  // ── Women > Jumpers & Sweaters (13) ──
  { id: 1917, title: 'Women > Jumpers > Jumpers', keywords: ['jumper','women jumper','pullover'] },
  { id: 196, title: 'Women > Jumpers > Hoodies & sweatshirts', keywords: ['hoodie','sweatshirt','women hoodie'] },
  { id: 194, title: 'Women > Jumpers > Cardigans', keywords: ['cardigan','women cardigan'] },
  { id: 1874, title: 'Women > Jumpers > Waistcoats', keywords: ['waistcoat','women waistcoat','gilet'] },
  { id: 1067, title: 'Women > Jumpers > Kimonos', keywords: ['kimono'] },
  { id: 195, title: 'Women > Jumpers > Boleros', keywords: ['bolero','shrug'] },
  { id: 197, title: 'Women > Jumpers > Other jumpers', keywords: ['sweater','knitwear','knit'] },
  // ── Women > Outerwear (1037) ──
  { id: 1908, title: 'Women > Outerwear > Jackets', keywords: ['jacket','bomber','denim jacket','women jacket'] },
  { id: 1907, title: 'Women > Outerwear > Coats', keywords: ['coat','parka','puffer','trench','raincoat','women coat'] },
  { id: 2524, title: 'Women > Outerwear > Gilets & body warmers', keywords: ['gilet','body warmer','women gilet'] },
  { id: 1773, title: 'Women > Outerwear > Capes & ponchos', keywords: ['cape','poncho'] },
  // ── Women > Trousers & Leggings (9) ──
  { id: 1071, title: 'Women > Trousers > Wide-leg trousers', keywords: ['wide leg','palazzo'] },
  { id: 525, title: 'Women > Trousers > Leggings', keywords: ['leggings','women leggings'] },
  { id: 1846, title: 'Women > Trousers > Straight-leg trousers', keywords: ['straight leg trousers'] },
  { id: 187, title: 'Women > Trousers > Tailored trousers', keywords: ['tailored','women tailored'] },
  { id: 184, title: 'Women > Trousers > Leather trousers', keywords: ['leather trousers'] },
  { id: 1070, title: 'Women > Trousers > Cropped trousers & chinos', keywords: ['chinos','cropped trousers'] },
  { id: 185, title: 'Women > Trousers > Skinny trousers', keywords: ['skinny trousers'] },
  { id: 526, title: 'Women > Trousers > Harem pants', keywords: ['harem pants','harem'] },
  { id: 189, title: 'Women > Trousers > Other trousers', keywords: ['trousers','pants','joggers','cargo','women trousers'] },
  // ── Women > Jeans (183) ──
  { id: 1844, title: 'Women > Jeans > Skinny jeans', keywords: ['skinny jeans','women skinny'] },
  { id: 1845, title: 'Women > Jeans > Straight jeans', keywords: ['straight jeans','women straight'] },
  { id: 1842, title: 'Women > Jeans > High waisted jeans', keywords: ['high waisted','high waist jeans','mom jeans'] },
  { id: 1843, title: 'Women > Jeans > Ripped jeans', keywords: ['ripped jeans','distressed jeans'] },
  { id: 1841, title: 'Women > Jeans > Flared jeans', keywords: ['flared jeans','wide leg jeans','bootcut'] },
  { id: 1839, title: 'Women > Jeans > Boyfriend jeans', keywords: ['boyfriend jeans'] },
  { id: 1840, title: 'Women > Jeans > Cropped jeans', keywords: ['cropped jeans'] },
  { id: 1864, title: 'Women > Jeans > Other jeans', keywords: ['jeans','denim','women jeans'] },
  // ── Women > Skirts (11) ──
  { id: 198, title: 'Women > Skirts > Mini skirts', keywords: ['mini skirt'] },
  { id: 199, title: 'Women > Skirts > Midi skirts', keywords: ['midi skirt'] },
  { id: 200, title: 'Women > Skirts > Maxi skirts', keywords: ['maxi skirt'] },
  { id: 2927, title: 'Women > Skirts > Knee-length skirts', keywords: ['knee length skirt','pencil skirt'] },
  { id: 2928, title: 'Women > Skirts > Asymmetric skirts', keywords: ['asymmetric skirt'] },
  // ── Women > Shorts & Cropped (15) ──
  { id: 538, title: 'Women > Shorts > Denim shorts', keywords: ['denim shorts','jean shorts'] },
  { id: 1099, title: 'Women > Shorts > High-waisted shorts', keywords: ['high waisted shorts'] },
  { id: 203, title: 'Women > Shorts > Knee-length shorts', keywords: ['knee length shorts','bermuda'] },
  { id: 1103, title: 'Women > Shorts > Cargo shorts', keywords: ['cargo shorts'] },
  { id: 1101, title: 'Women > Shorts > Lace shorts', keywords: ['lace shorts'] },
  { id: 1100, title: 'Women > Shorts > Leather shorts', keywords: ['leather shorts'] },
  { id: 204, title: 'Women > Shorts > Cropped trousers', keywords: ['cropped trousers','capri'] },
  { id: 1838, title: 'Women > Shorts > Low-waisted shorts', keywords: ['low waisted shorts'] },
  { id: 205, title: 'Women > Shorts > Other shorts', keywords: ['shorts','hot pants','women shorts'] },
  // ── Women > Activewear (73) ──
  { id: 576, title: 'Women > Activewear > Tops & t-shirts', keywords: ['sports top','gym top','women sports top'] },
  { id: 572, title: 'Women > Activewear > Tracksuits', keywords: ['tracksuit','women tracksuit'] },
  { id: 578, title: 'Women > Activewear > Shorts', keywords: ['gym shorts','sports shorts','women sports shorts'] },
  { id: 573, title: 'Women > Activewear > Trousers', keywords: ['gym leggings','sports leggings','yoga pants'] },
  { id: 574, title: 'Women > Activewear > Dresses', keywords: ['sports dress','tennis dress'] },
  { id: 1439, title: 'Women > Activewear > Sports bras', keywords: ['sports bra'] },
  { id: 571, title: 'Women > Activewear > Outerwear', keywords: ['sports jacket','running jacket'] },
  { id: 577, title: 'Women > Activewear > Hoodies & sweatshirts', keywords: ['sports hoodie','gym hoodie'] },
  { id: 575, title: 'Women > Activewear > Skirts', keywords: ['sports skirt','tennis skirt'] },
  { id: 3268, title: 'Women > Activewear > Team shirts & jerseys', keywords: ['women team shirt','women jersey'] },
  { id: 579, title: 'Women > Activewear > Sports accessories', keywords: ['sports accessories','gym accessories'] },
  { id: 580, title: 'Women > Activewear > Other activewear', keywords: ['activewear','sportswear','gym','running','yoga'] },
  // ── Women > Swimwear (28) ──
  { id: 219, title: 'Women > Swimwear > Bikinis & tankinis', keywords: ['bikini','tankini'] },
  { id: 218, title: 'Women > Swimwear > One-pieces', keywords: ['swimsuit','one-piece','bathing suit'] },
  { id: 1780, title: 'Women > Swimwear > Cover-ups & sarongs', keywords: ['cover up','sarong','beach cover'] },
  { id: 220, title: 'Women > Swimwear > Other swimwear', keywords: ['swimwear','swimming','beachwear'] },
  // ── Women > Lingerie & Nightwear (29) ──
  { id: 119, title: 'Women > Lingerie > Bras', keywords: ['bra','bralette'] },
  { id: 120, title: 'Women > Lingerie > Panties', keywords: ['panties','knickers','thong','underwear'] },
  { id: 229, title: 'Women > Lingerie > Sets', keywords: ['lingerie set','underwear set'] },
  { id: 123, title: 'Women > Lingerie > Nightwear', keywords: ['pyjamas','nightwear','sleepwear','nightdress'] },
  { id: 1030, title: 'Women > Lingerie > Dressing gowns', keywords: ['dressing gown','robe','bathrobe'] },
  { id: 1262, title: 'Women > Lingerie > Socks', keywords: ['women socks'] },
  { id: 1263, title: 'Women > Lingerie > Tights & stockings', keywords: ['tights','stockings','hosiery'] },
  { id: 1781, title: 'Women > Lingerie > Shapewear', keywords: ['shapewear','corset'] },
  { id: 1847, title: 'Women > Lingerie > Lingerie accessories', keywords: ['lingerie accessories'] },
  { id: 124, title: 'Women > Lingerie > Other lingerie', keywords: ['lingerie'] },
  // ── Women > Jumpsuits & Playsuits (1035) ──
  { id: 1131, title: 'Women > Jumpsuits & Playsuits > Jumpsuits', keywords: ['jumpsuit','dungarees'] },
  { id: 1132, title: 'Women > Jumpsuits & Playsuits > Playsuits', keywords: ['playsuit','romper'] },
  { id: 1134, title: 'Women > Jumpsuits & Playsuits > Other', keywords: ['women jumpsuit','women playsuit'] },
  // ── Women > Suits & Blazers (8) ──
  { id: 532, title: 'Women > Suits > Blazers', keywords: ['blazer','women blazer'] },
  { id: 1126, title: 'Women > Suits > Skirt suits', keywords: ['skirt suit'] },
  { id: 1125, title: 'Women > Suits > Trouser suits', keywords: ['trouser suit','women suit'] },
  { id: 1128, title: 'Women > Suits > Suit separates', keywords: ['suit separates'] },
  { id: 1129, title: 'Women > Suits > Other suits', keywords: ['women formal'] },
  // ── Women > Other clothing ──
  { id: 18, title: 'Women > Other clothing', keywords: ['women clothing'] },
  { id: 1176, title: 'Women > Maternity clothes', keywords: ['maternity','pregnancy','pregnant'] },
  { id: 1782, title: 'Women > Costumes & special outfits', keywords: ['costume','fancy dress','halloween','women costume'] },
  { id: 5491, title: 'Women > Skorts', keywords: ['skort'] },
  // ══════════════════════════════════════════════════════════
  // WOMEN > SHOES (16)
  // ══════════════════════════════════════════════════════════
  { id: 2632, title: 'Women > Shoes > Trainers', keywords: ['women trainers','women sneakers'] },
  { id: 543, title: 'Women > Shoes > Heels', keywords: ['heels','high heels','stilettos'] },
  { id: 1049, title: 'Women > Shoes > Boots', keywords: ['women boots','ankle boots','knee boots','chelsea boots'] },
  { id: 2949, title: 'Women > Shoes > Sandals', keywords: ['women sandals'] },
  { id: 2630, title: 'Women > Shoes > Sports shoes', keywords: ['women sports shoes','running shoes'] },
  { id: 2952, title: 'Women > Shoes > Flip-flops & slides', keywords: ['flip flops','slides','women slides'] },
  { id: 2954, title: 'Women > Shoes > Boat shoes, loafers & moccasins', keywords: ['loafers','moccasins','boat shoes'] },
  { id: 2623, title: 'Women > Shoes > Clogs & mules', keywords: ['clogs','mules'] },
  { id: 2955, title: 'Women > Shoes > Ballerinas', keywords: ['ballerinas','ballet flats','flats'] },
  { id: 215, title: 'Women > Shoes > Slippers', keywords: ['women slippers'] },
  { id: 2951, title: 'Women > Shoes > Lace-up shoes', keywords: ['lace up shoes','brogues','women brogues'] },
  { id: 2953, title: 'Women > Shoes > Espadrilles', keywords: ['espadrilles'] },
  { id: 2950, title: 'Women > Shoes > Mary Janes & T-bar shoes', keywords: ['mary jane','t-bar'] },
  // ══════════════════════════════════════════════════════════
  // WOMEN > BAGS (19)
  // ══════════════════════════════════════════════════════════
  { id: 156, title: 'Women > Bags > Handbags', keywords: ['handbag'] },
  { id: 158, title: 'Women > Bags > Shoulder bags', keywords: ['shoulder bag','crossbody'] },
  { id: 552, title: 'Women > Bags > Tote bags', keywords: ['tote','tote bag'] },
  { id: 157, title: 'Women > Bags > Backpacks', keywords: ['backpack','rucksack','women backpack'] },
  { id: 159, title: 'Women > Bags > Clutches', keywords: ['clutch','evening bag'] },
  { id: 160, title: 'Women > Bags > Wallets & purses', keywords: ['purse','women wallet','coin purse'] },
  { id: 161, title: 'Women > Bags > Makeup bags', keywords: ['makeup bag','cosmetic bag','toiletry bag'] },
  { id: 1784, title: 'Women > Bags > Satchels & messenger bags', keywords: ['satchel','messenger bag'] },
  { id: 2940, title: 'Women > Bags > Beach bags', keywords: ['beach bag'] },
  { id: 2942, title: 'Women > Bags > Bucket bags', keywords: ['bucket bag'] },
  { id: 1848, title: 'Women > Bags > Bum bags', keywords: ['bum bag','fanny pack','belt bag'] },
  { id: 1849, title: 'Women > Bags > Holdalls & duffel bags', keywords: ['holdall','duffel','weekender'] },
  { id: 2945, title: 'Women > Bags > Hobo bags', keywords: ['hobo bag'] },
  { id: 2939, title: 'Women > Bags > Wristlets', keywords: ['wristlet'] },
  { id: 2943, title: 'Women > Bags > Garment bags', keywords: ['garment bag'] },
  { id: 1850, title: 'Women > Bags > Luggage & suitcases', keywords: ['luggage','suitcase','travel bag'] },
  { id: 2941, title: 'Women > Bags > Briefcases', keywords: ['briefcase','women briefcase'] },
  { id: 2944, title: 'Women > Bags > Gym bags', keywords: ['gym bag','sports bag'] },
  // ══════════════════════════════════════════════════════════
  // WOMEN > ACCESSORIES (1187)
  // ══════════════════════════════════════════════════════════
  // ── Women > Jewellery (21) ──
  { id: 164, title: 'Women > Jewellery > Necklaces', keywords: ['necklace','pendant','chain'] },
  { id: 163, title: 'Women > Jewellery > Earrings', keywords: ['earrings','studs','hoops'] },
  { id: 165, title: 'Women > Jewellery > Bracelets', keywords: ['bracelet','bangle'] },
  { id: 553, title: 'Women > Jewellery > Rings', keywords: ['ring','women ring'] },
  { id: 166, title: 'Women > Jewellery > Jewellery sets', keywords: ['jewellery set','jewelry set'] },
  { id: 167, title: 'Women > Jewellery > Brooches', keywords: ['brooch','pin'] },
  { id: 2938, title: 'Women > Jewellery > Charms & pendants', keywords: ['charm','pendant'] },
  { id: 2937, title: 'Women > Jewellery > Body jewellery', keywords: ['body jewellery','body chain'] },
  { id: 1785, title: 'Women > Jewellery > Anklets', keywords: ['anklet'] },
  { id: 162, title: 'Women > Jewellery > Other jewellery', keywords: ['jewellery','jewelry','women jewellery'] },
  // ── Women > Other Accessories ──
  { id: 88, title: 'Women > Accessories > Hats & caps', keywords: ['hat','beanie','beret','women cap','women hat'] },
  { id: 89, title: 'Women > Accessories > Scarves & shawls', keywords: ['scarf','shawl','women scarf'] },
  { id: 1852, title: 'Women > Accessories > Keyrings', keywords: ['keyring','key chain'] },
  { id: 1123, title: 'Women > Accessories > Hair accessories', keywords: ['hair clip','headband','scrunchie','hair tie','hair accessory'] },
  { id: 26, title: 'Women > Accessories > Sunglasses', keywords: ['women sunglasses','women glasses'] },
  { id: 22, title: 'Women > Accessories > Watches', keywords: ['women watch','ladies watch'] },
  { id: 20, title: 'Women > Accessories > Belts', keywords: ['women belt','ladies belt'] },
  { id: 90, title: 'Women > Accessories > Gloves', keywords: ['women gloves','mittens'] },
  { id: 2931, title: 'Women > Accessories > Bandanas & headscarves', keywords: ['bandana','headscarf'] },
  { id: 1851, title: 'Women > Accessories > Umbrellas', keywords: ['umbrella'] },
  { id: 2932, title: 'Women > Accessories > Handkerchiefs', keywords: ['handkerchief'] },
  { id: 1140, title: 'Women > Accessories > Other accessories', keywords: ['accessory','women accessory'] },
  // ══════════════════════════════════════════════════════════
  // WOMEN > BEAUTY (146)
  // ══════════════════════════════════════════════════════════
  { id: 964, title: 'Women > Beauty > Make-up', keywords: ['makeup','make-up','lipstick','foundation','mascara','eyeshadow'] },
  { id: 948, title: 'Women > Beauty > Facial care', keywords: ['facial care','face cream','moisturiser','serum','cleanser'] },
  { id: 1906, title: 'Women > Beauty > Beauty tools', keywords: ['beauty tools','makeup brush','mirror','tweezers'] },
  { id: 956, title: 'Women > Beauty > Body care', keywords: ['body cream','body lotion','shower gel','bath bomb'] },
  { id: 152, title: 'Women > Beauty > Perfume', keywords: ['perfume','fragrance','eau de toilette','women perfume'] },
  { id: 1902, title: 'Women > Beauty > Hair care', keywords: ['hair care','shampoo','conditioner','hair mask','hair straightener'] },
  { id: 960, title: 'Women > Beauty > Nail care', keywords: ['nail polish','nail care','manicure'] },
  { id: 1264, title: 'Women > Beauty > Hand care', keywords: ['hand cream','hand care'] },
  { id: 153, title: 'Women > Beauty > Other beauty', keywords: ['beauty','skincare'] },
  // ══════════════════════════════════════════════════════════
  // MEN > CLOTHING (2050)
  // ══════════════════════════════════════════════════════════
  // ── Men > Tops & T-shirts (76) ──
  { id: 77, title: 'Men > Tops > T-shirts', keywords: ['men t-shirt','mens tee','men tshirt'] },
  { id: 536, title: 'Men > Tops > Shirts', keywords: ['men shirt','mens shirt','dress shirt'] },
  { id: 5492, title: 'Men > Tops > Polo shirts', keywords: ['polo','polo shirt','men polo'] },
  { id: 560, title: 'Men > Tops > Vests & sleeveless', keywords: ['men vest','sleeveless','men tank top'] },
  // ── Men > Jumpers & Sweaters (79) ──
  { id: 267, title: 'Men > Jumpers > Hoodies & sweaters', keywords: ['men hoodie','mens hoodie','men sweatshirt'] },
  { id: 1811, title: 'Men > Jumpers > Jumpers', keywords: ['men jumper','mens jumper','men pullover'] },
  { id: 1812, title: 'Men > Jumpers > Zip-through hoodies', keywords: ['zip hoodie','zip through hoodie'] },
  { id: 1813, title: 'Men > Jumpers > Crew neck jumpers', keywords: ['crew neck','crewneck'] },
  { id: 264, title: 'Men > Jumpers > V-neck jumpers', keywords: ['v-neck jumper','v neck'] },
  { id: 1815, title: 'Men > Jumpers > Chunky-knit jumpers', keywords: ['chunky knit','cable knit'] },
  { id: 1814, title: 'Men > Jumpers > Long jumpers', keywords: ['long jumper'] },
  { id: 266, title: 'Men > Jumpers > Cardigans', keywords: ['men cardigan','mens cardigan'] },
  { id: 265, title: 'Men > Jumpers > Turtleneck jumpers', keywords: ['men turtleneck','men roll neck'] },
  { id: 1825, title: 'Men > Jumpers > Sleeveless jumpers', keywords: ['sleeveless jumper','tank top jumper'] },
  { id: 268, title: 'Men > Jumpers > Other jumpers', keywords: ['mens sweater','knitwear'] },
  // ── Men > Outerwear (1206) ──
  { id: 2052, title: 'Men > Outerwear > Jackets', keywords: ['men jacket','mens jacket','bomber','men bomber'] },
  { id: 2051, title: 'Men > Outerwear > Coats', keywords: ['men coat','mens coat','men parka','men puffer'] },
  { id: 2553, title: 'Men > Outerwear > Gilets & body warmers', keywords: ['men gilet','men body warmer'] },
  { id: 2552, title: 'Men > Outerwear > Ponchos', keywords: ['men poncho'] },
  // ── Men > Trousers (34) ──
  { id: 1821, title: 'Men > Trousers > Joggers', keywords: ['men joggers','mens joggers','tracksuit bottoms'] },
  { id: 1820, title: 'Men > Trousers > Chinos', keywords: ['men chinos','chinos'] },
  { id: 261, title: 'Men > Trousers > Tailored trousers', keywords: ['men tailored','men formal trousers'] },
  { id: 260, title: 'Men > Trousers > Wide-legged trousers', keywords: ['men wide leg'] },
  { id: 259, title: 'Men > Trousers > Skinny trousers', keywords: ['men skinny trousers'] },
  { id: 271, title: 'Men > Trousers > Cropped trousers', keywords: ['men cropped trousers'] },
  { id: 263, title: 'Men > Trousers > Other trousers', keywords: ['men trousers','mens pants','mens cargo'] },
  // ── Men > Jeans (257) ──
  { id: 1819, title: 'Men > Jeans > Straight fit', keywords: ['men straight jeans'] },
  { id: 1818, title: 'Men > Jeans > Slim fit', keywords: ['men slim jeans','slim fit jeans'] },
  { id: 1817, title: 'Men > Jeans > Skinny', keywords: ['men skinny jeans'] },
  { id: 1816, title: 'Men > Jeans > Ripped', keywords: ['men ripped jeans','men distressed jeans'] },
  // ── Men > Shorts (80) ──
  { id: 1823, title: 'Men > Shorts > Chino shorts', keywords: ['men chino shorts'] },
  { id: 1824, title: 'Men > Shorts > Denim shorts', keywords: ['men denim shorts'] },
  { id: 1822, title: 'Men > Shorts > Cargo shorts', keywords: ['men cargo shorts'] },
  { id: 272, title: 'Men > Shorts > Other shorts', keywords: ['men shorts','mens shorts'] },
  // ── Men > Activewear (30) ──
  { id: 584, title: 'Men > Activewear > Tops & t-shirts', keywords: ['men sports top','men gym top'] },
  { id: 3267, title: 'Men > Activewear > Team shirts & jerseys', keywords: ['football shirt','jersey','team shirt','football top'] },
  { id: 582, title: 'Men > Activewear > Tracksuits', keywords: ['men tracksuit','mens tracksuit'] },
  { id: 581, title: 'Men > Activewear > Outerwear', keywords: ['men sports jacket'] },
  { id: 586, title: 'Men > Activewear > Shorts', keywords: ['men sports shorts','men gym shorts'] },
  { id: 583, title: 'Men > Activewear > Trousers', keywords: ['men sports trousers','men gym trousers'] },
  { id: 585, title: 'Men > Activewear > Pullovers & sweaters', keywords: ['men sports pullover'] },
  { id: 587, title: 'Men > Activewear > Sports accessories', keywords: ['men sports accessories'] },
  { id: 588, title: 'Men > Activewear > Other activewear', keywords: ['men sportswear','men gym','men activewear'] },
  // ── Men > Other clothing ──
  { id: 84, title: 'Men > Swimwear', keywords: ['men swimwear','swim trunks','swim shorts'] },
  { id: 85, title: 'Men > Socks & underwear', keywords: ['men socks','men underwear','boxers','briefs'] },
  { id: 2910, title: 'Men > Sleepwear', keywords: ['men pyjamas','men sleepwear','men dressing gown'] },
  { id: 92, title: 'Men > Costumes & special outfits', keywords: ['men costume','men fancy dress'] },
  { id: 83, title: 'Men > Other clothing', keywords: ['men clothing'] },
  // ── Men > Suits & Blazers (32) ──
  { id: 1786, title: 'Men > Suits > Suit jackets & blazers', keywords: ['men blazer','suit jacket','mens blazer'] },
  { id: 1789, title: 'Men > Suits > Suit sets', keywords: ['men suit','suit set'] },
  { id: 1787, title: 'Men > Suits > Suit trousers', keywords: ['suit trousers','men formal trousers'] },
  { id: 1788, title: 'Men > Suits > Waistcoats', keywords: ['men waistcoat'] },
  { id: 1790, title: 'Men > Suits > Wedding suits', keywords: ['wedding suit','morning suit'] },
  { id: 1866, title: 'Men > Suits > Other suits', keywords: ['men formal'] },
  // ══════════════════════════════════════════════════════════
  // MEN > SHOES (1231)
  // ══════════════════════════════════════════════════════════
  { id: 1242, title: 'Men > Shoes > Trainers', keywords: ['men trainers','mens sneakers','men sneakers'] },
  { id: 1452, title: 'Men > Shoes > Sports shoes', keywords: ['men sports shoes','men running shoes'] },
  { id: 1233, title: 'Men > Shoes > Boots', keywords: ['men boots','mens boots'] },
  { id: 1238, title: 'Men > Shoes > Formal shoes', keywords: ['men formal shoes','dress shoes','oxford','brogues'] },
  { id: 2656, title: 'Men > Shoes > Boat shoes, loafers & moccasins', keywords: ['men loafers','men moccasins','boat shoes'] },
  { id: 2969, title: 'Men > Shoes > Flip-flops & slides', keywords: ['men flip flops','men slides'] },
  { id: 2659, title: 'Men > Shoes > Slippers', keywords: ['men slippers'] },
  { id: 2968, title: 'Men > Shoes > Sandals', keywords: ['men sandals','mens sandals'] },
  { id: 2970, title: 'Men > Shoes > Clogs & mules', keywords: ['men clogs','men mules'] },
  { id: 2657, title: 'Men > Shoes > Espadrilles', keywords: ['men espadrilles'] },
  // ══════════════════════════════════════════════════════════
  // MEN > ACCESSORIES (82)
  // ══════════════════════════════════════════════════════════
  { id: 86, title: 'Men > Accessories > Hats & caps', keywords: ['men hat','mens hat','men cap','snapback'] },
  { id: 94, title: 'Men > Accessories > Bags & backpacks', keywords: ['men bag','mens bag','men rucksack','men backpack'] },
  { id: 95, title: 'Men > Accessories > Jewellery', keywords: ['men jewellery','men chain','men ring','men bracelet'] },
  { id: 2956, title: 'Men > Accessories > Ties & bow ties', keywords: ['tie','bow tie','cufflinks'] },
  { id: 97, title: 'Men > Accessories > Watches', keywords: ['men watch','mens watch'] },
  { id: 87, title: 'Men > Accessories > Scarves & shawls', keywords: ['men scarf','mens scarf'] },
  { id: 98, title: 'Men > Accessories > Sunglasses', keywords: ['men sunglasses','mens sunglasses'] },
  { id: 96, title: 'Men > Accessories > Belts', keywords: ['men belt','mens belt'] },
  { id: 91, title: 'Men > Accessories > Gloves', keywords: ['men gloves','mens gloves'] },
  { id: 2960, title: 'Men > Accessories > Bandanas & headscarves', keywords: ['men bandana'] },
  { id: 2959, title: 'Men > Accessories > Braces', keywords: ['braces','suspenders'] },
  { id: 2957, title: 'Men > Accessories > Pocket squares', keywords: ['pocket square'] },
  { id: 99, title: 'Men > Accessories > Other accessories', keywords: ['men accessory','men accessories','wallet','card holder'] },
  // ══════════════════════════════════════════════════════════
  // MEN > GROOMING (139)
  // ══════════════════════════════════════════════════════════
  { id: 145, title: 'Men > Grooming > Aftershave & cologne', keywords: ['aftershave','cologne','men fragrance','men perfume'] },
  { id: 141, title: 'Men > Grooming > Body care', keywords: ['men body care','men shower gel'] },
  { id: 143, title: 'Men > Grooming > Facial care', keywords: ['men facial care','men moisturiser'] },
  { id: 2055, title: 'Men > Grooming > Tools & accessories', keywords: ['men grooming tools','razor','trimmer'] },
  { id: 1863, title: 'Men > Grooming > Grooming kits', keywords: ['grooming kit','men gift set'] },
  { id: 140, title: 'Men > Grooming > Hair care', keywords: ['men hair care','pomade','wax','hair gel'] },
  { id: 142, title: 'Men > Grooming > Hand & nail care', keywords: ['men hand care'] },
  { id: 144, title: 'Men > Grooming > Make-up', keywords: ['men makeup'] },
  { id: 968, title: 'Men > Grooming > Other grooming', keywords: ['grooming','men grooming'] },
  // ══════════════════════════════════════════════════════════
  // KIDS (1193)
  // ══════════════════════════════════════════════════════════
  // ── Kids > Girls clothing (1195) ──
  { id: 1247, title: 'Kids > Girls > Dresses', keywords: ['girls dress','girl dress'] },
  { id: 1245, title: 'Kids > Girls > Tops & T-shirts', keywords: ['girls top','girls t-shirt'] },
  { id: 1249, title: 'Kids > Girls > Trousers, shorts & dungarees', keywords: ['girls trousers','girls shorts','girls dungarees'] },
  { id: 1246, title: 'Kids > Girls > Jumpers & hoodies', keywords: ['girls jumper','girls hoodie'] },
  { id: 1244, title: 'Kids > Girls > Outerwear', keywords: ['girls coat','girls jacket'] },
  { id: 1248, title: 'Kids > Girls > Skirts', keywords: ['girls skirt'] },
  { id: 1594, title: 'Kids > Girls > Sleepwear & nightwear', keywords: ['girls pyjamas','girls nightwear'] },
  { id: 1251, title: 'Kids > Girls > Swimwear', keywords: ['girls swimwear','girls bikini','girls swimsuit'] },
  { id: 2080, title: 'Kids > Girls > Formal wear', keywords: ['girls formal','flower girl','girls party dress'] },
  { id: 1253, title: 'Kids > Girls > Activewear', keywords: ['girls activewear','girls sportswear'] },
  { id: 1252, title: 'Kids > Girls > Underwear & socks', keywords: ['girls underwear','girls socks'] },
  { id: 1606, title: 'Kids > Girls > Fancy dress & costumes', keywords: ['girls costume','girls fancy dress'] },
  { id: 1510, title: 'Kids > Girls > Clothing bundles', keywords: ['girls bundle','girls clothing bundle'] },
  { id: 1254, title: 'Kids > Girls > Other', keywords: ['girls clothing'] },
  // ── Kids > Girls > Shoes (1255) ──
  { id: 1255, title: 'Kids > Girls > Shoes', keywords: ['girls shoes'] },
  // ── Kids > Girls > Bags (1258) ──
  { id: 1258, title: 'Kids > Girls > Bags & backpacks', keywords: ['girls bag','girls backpack'] },
  // ── Kids > Girls > Accessories (1574) ──
  { id: 1574, title: 'Kids > Girls > Accessories', keywords: ['girls accessories','girls jewellery','girls hat'] },
  // ── Kids > Boys clothing (1194) ──
  { id: 1198, title: 'Kids > Boys > Tops & T-shirts', keywords: ['boys top','boys t-shirt'] },
  { id: 1200, title: 'Kids > Boys > Trousers, shorts & dungarees', keywords: ['boys trousers','boys shorts','boys dungarees'] },
  { id: 1199, title: 'Kids > Boys > Jumpers & hoodies', keywords: ['boys jumper','boys hoodie'] },
  { id: 1197, title: 'Kids > Boys > Outerwear', keywords: ['boys coat','boys jacket'] },
  { id: 1204, title: 'Kids > Boys > Activewear', keywords: ['boys activewear','boys sportswear','boys football'] },
  { id: 1752, title: 'Kids > Boys > Sleepwear', keywords: ['boys pyjamas','boys sleepwear'] },
  { id: 1202, title: 'Kids > Boys > Swimwear', keywords: ['boys swimwear','boys swim trunks'] },
  { id: 2083, title: 'Kids > Boys > Formal wear', keywords: ['boys formal','boys suit','page boy'] },
  { id: 1203, title: 'Kids > Boys > Underwear & socks', keywords: ['boys underwear','boys socks'] },
  { id: 1762, title: 'Kids > Boys > Fancy dress & costumes', keywords: ['boys costume','boys fancy dress'] },
  { id: 1760, title: 'Kids > Boys > Clothing bundles', keywords: ['boys bundle','boys clothing bundle'] },
  { id: 1205, title: 'Kids > Boys > Other', keywords: ['boys clothing'] },
  // ── Kids > Boys > Shoes (1256) ──
  { id: 1256, title: 'Kids > Boys > Shoes', keywords: ['boys shoes'] },
  // ── Kids > Boys > Bags (1257) ──
  { id: 1257, title: 'Kids > Boys > Bags & backpacks', keywords: ['boys bag','boys backpack'] },
  // ── Kids > Boys > Accessories (1714) ──
  { id: 1714, title: 'Kids > Boys > Accessories', keywords: ['boys accessories','boys hat','boys cap'] },
  // ── Kids > Baby ──
  { id: 1243, title: 'Kids > Baby girls clothing', keywords: ['baby girl','baby dress','newborn girl'] },
  { id: 1196, title: 'Kids > Baby boys clothing', keywords: ['baby boy','babygrow','onesie','romper','newborn boy'] },
  // ── Kids > Toys (1499) ──
  { id: 1730, title: 'Kids > Toys > Toy figures & accessories', keywords: ['action figure','figurine','toy figure'] },
  { id: 1764, title: 'Kids > Toys > Soft toys & stuffed animals', keywords: ['teddy','plush','soft toy','stuffed animal','cuddly toy'] },
  { id: 1767, title: 'Kids > Toys > Blocks & building toys', keywords: ['lego','blocks','building','duplo','megabloks'] },
  { id: 3375, title: 'Kids > Toys > Toy cars, trains & vehicles', keywords: ['toy car','toy train','hot wheels','matchbox'] },
  { id: 1731, title: 'Kids > Toys > Dolls & accessories', keywords: ['doll','barbie','dolls house'] },
  { id: 3314, title: 'Kids > Toys > Arts & crafts', keywords: ['arts crafts','colouring','painting','craft kit'] },
  { id: 3344, title: 'Kids > Toys > Baby activities & toys', keywords: ['baby toy','rattle','teether','activity mat'] },
  { id: 1725, title: 'Kids > Toys > Electronic toys', keywords: ['electronic toy','vtech','leapfrog'] },
  { id: 3336, title: 'Kids > Toys > Novelty & fidget toys', keywords: ['fidget','fidget spinner','slime','novelty toy'] },
  { id: 1763, title: 'Kids > Toys > Educational toys', keywords: ['educational toy','learning toy','montessori'] },
  { id: 3329, title: 'Kids > Toys > Dress up & pretend play', keywords: ['pretend play','play kitchen','dress up'] },
  { id: 1771, title: 'Kids > Toys > Outdoor & sports toys', keywords: ['outdoor toy','ride on','scooter','trampoline'] },
  { id: 1766, title: 'Kids > Toys > Musical toys', keywords: ['musical toy','toy instrument','xylophone'] },
  // ── Kids > Pushchairs, carriers & car seats (1496) ──
  { id: 1612, title: 'Kids > Buggies & pushchairs', keywords: ['stroller','pushchair','pram','buggy'] },
  { id: 3383, title: 'Kids > Car seats', keywords: ['car seat','child seat'] },
  { id: 3384, title: 'Kids > Booster seats', keywords: ['booster seat'] },
  { id: 3461, title: 'Kids > Baby carriers & wraps', keywords: ['baby carrier','sling','wrap','baby wrap'] },
  { id: 1511, title: 'Kids > Buggy accessories', keywords: ['buggy accessories','pram accessories'] },
  { id: 3385, title: 'Kids > Car seat accessories', keywords: ['car seat accessories'] },
  // ── Kids > Sleep & bedding (3296) ──
  { id: 3297, title: 'Kids > Bedding, blankets & throws', keywords: ['baby blanket','kids bedding','cot bedding'] },
  { id: 3307, title: 'Kids > Sleep sacks & wearable blankets', keywords: ['sleep sack','sleeping bag','wearable blanket'] },
  { id: 3309, title: 'Kids > Swaddles', keywords: ['swaddle'] },
  { id: 3303, title: 'Kids > Baby monitors', keywords: ['baby monitor'] },
  { id: 3306, title: 'Kids > Nightlights', keywords: ['nightlight','night light'] },
  // ── Kids > Nursing & feeding (3432) ──
  { id: 3444, title: 'Kids > Cups, dishes & utensils', keywords: ['sippy cup','baby plate','baby bowl','baby spoon'] },
  { id: 3435, title: 'Kids > Bottle feeding', keywords: ['baby bottle','bottles'] },
  { id: 3453, title: 'Kids > Breastfeeding', keywords: ['breast pump','nursing bra','breastfeeding'] },
  { id: 3434, title: 'Kids > Bibs', keywords: ['bib','weaning bib'] },
  { id: 3458, title: 'Kids > Dummies & soothers', keywords: ['dummy','soother','pacifier'] },
  { id: 3460, title: 'Kids > Sterilisers', keywords: ['steriliser','bottle steriliser'] },
  { id: 3450, title: 'Kids > High chairs', keywords: ['high chair','highchair'] },
  { id: 3443, title: 'Kids > Muslins & burp cloths', keywords: ['muslin','burp cloth'] },
  // ── Kids > Bathing & changing (3393) ──
  { id: 3394, title: 'Kids > Baby changing bags', keywords: ['changing bag','nappy bag'] },
  { id: 3412, title: 'Kids > Bathing', keywords: ['baby bath','bath seat','bath toy'] },
  { id: 3417, title: 'Kids > Potties', keywords: ['potty','toilet training','potty training'] },
  // ── Kids > Other ──
  { id: 1498, title: 'Kids > Furniture & decor', keywords: ['kids furniture','cot','crib','baby furniture','nursery'] },
  { id: 1501, title: 'Kids > School supplies', keywords: ['school','lunch box','pencil case','school bag'] },
  { id: 1502, title: 'Kids > Other kids items', keywords: ['kids','children'] },
  // ══════════════════════════════════════════════════════════
  // HOME (1918)
  // ══════════════════════════════════════════════════════════
  { id: 1934, title: 'Home > Home accessories', keywords: ['decoration','ornament','vase','candle','frame','mirror','wall art','home decor'] },
  { id: 1920, title: 'Home > Tableware', keywords: ['plate','mug','cup','bowl','glass','cutlery','dinnerware'] },
  { id: 1919, title: 'Home > Textiles', keywords: ['blanket','pillow','cushion','towel','bedding','curtain','rug','duvet','throw'] },
  { id: 2915, title: 'Home > Celebrations & holidays', keywords: ['christmas','easter','halloween','party','decorations'] },
  { id: 5106, title: 'Home > Pet care', keywords: ['pet','dog','cat','collar','lead','pet bed','pet toy'] },
  { id: 3811, title: 'Home > Tools & DIY', keywords: ['tools','drill','screwdriver','diy','hardware'] },
  { id: 5428, title: 'Home > Office supplies', keywords: ['office','stationery','desk organiser','pen','notebook'] },
  { id: 3477, title: 'Home > Kitchen tools', keywords: ['utensil','grater','peeler','kitchen tool'] },
  { id: 3474, title: 'Home > Small kitchen appliances', keywords: ['kettle','toaster','blender','air fryer','coffee machine'] },
  { id: 3812, title: 'Home > Outdoor & garden', keywords: ['garden','outdoor','plant pot','planter','bbq','garden furniture'] },
  { id: 3476, title: 'Home > Cookware & bakeware', keywords: ['pan','pot','baking tray','casserole','cookware'] },
  { id: 3478, title: 'Home > Household care', keywords: ['cleaning','storage','organiser','laundry'] },
  { id: 3154, title: 'Home > Furniture', keywords: ['furniture','shelf','table','chair','desk','cabinet'] },
  { id: 3475, title: 'Home > Large appliances', keywords: ['washing machine','fridge','oven','dishwasher'] },
  // ══════════════════════════════════════════════════════════
  // ENTERTAINMENT (2309)
  // ══════════════════════════════════════════════════════════
  // ── Books (2312) ──
  { id: 2319, title: 'Entertainment > Books > Literature & fiction', keywords: ['novel','fiction','book','paperback','hardback'] },
  { id: 2318, title: 'Entertainment > Books > Kids & young adults', keywords: ['children book','kids book','young adult'] },
  { id: 2320, title: 'Entertainment > Books > Non-fiction', keywords: ['non-fiction','nonfiction','biography','history','cookbook'] },
  { id: 5426, title: 'Entertainment > Books > Textbooks', keywords: ['textbook','study','revision','university'] },
  { id: 5425, title: 'Entertainment > Books > Comics, manga & graphic novels', keywords: ['comic','manga','graphic novel'] },
  { id: 5427, title: 'Entertainment > Books > Colouring & activity books', keywords: ['colouring book','activity book','puzzle book'] },
  // ── Video (3037) ──
  { id: 3045, title: 'Entertainment > Video > DVD', keywords: ['dvd','dvds'] },
  { id: 3044, title: 'Entertainment > Video > Blu-ray', keywords: ['blu-ray','bluray','blu ray'] },
  { id: 3048, title: 'Entertainment > Video > VHS', keywords: ['vhs','video tape'] },
  { id: 3042, title: 'Entertainment > Video > 4K Blu-ray', keywords: ['4k blu-ray','4k'] },
  // ── Music (3036) ──
  { id: 3039, title: 'Entertainment > Music > CDs', keywords: ['cd','cds','album'] },
  { id: 3041, title: 'Entertainment > Music > Vinyl records', keywords: ['vinyl','record','lp','12 inch'] },
  { id: 3038, title: 'Entertainment > Music > Audio cassettes', keywords: ['cassette','tape','audio cassette'] },
  // ── Magazines (5424) ──
  { id: 5424, title: 'Entertainment > Magazines', keywords: ['magazine','magazines'] },
  // ══════════════════════════════════════════════════════════
  // ELECTRONICS (2994)
  // ══════════════════════════════════════════════════════════
  // ── Video games & consoles (3002) ──
  { id: 3026, title: 'Electronics > Video games > Games', keywords: ['video game','game','ps5 game','ps4 game','xbox game','switch game'] },
  { id: 3025, title: 'Electronics > Video games > Consoles', keywords: ['console','playstation','xbox','nintendo','ps5','ps4','switch'] },
  { id: 3570, title: 'Electronics > Video games > Controllers', keywords: ['controller','gamepad','joystick'] },
  { id: 3571, title: 'Electronics > Video games > Gaming headsets', keywords: ['gaming headset'] },
  { id: 3576, title: 'Electronics > Video games > Virtual reality', keywords: ['vr','virtual reality','oculus','quest'] },
  { id: 3024, title: 'Electronics > Video games > Accessories', keywords: ['gaming accessories','gaming mouse','gaming keyboard'] },
  // ── Mobile phones & communication (3565) ──
  { id: 3661, title: 'Electronics > Mobile phones', keywords: ['phone','iphone','samsung','mobile','smartphone'] },
  { id: 3662, title: 'Electronics > Phone accessories', keywords: ['phone case','screen protector','phone charger','phone accessories'] },
  // ── Computers & accessories (3564) ──
  { id: 3580, title: 'Electronics > Computers > Laptops', keywords: ['laptop','macbook','chromebook'] },
  { id: 3581, title: 'Electronics > Computers > Desktop computers', keywords: ['desktop','pc','computer'] },
  { id: 3590, title: 'Electronics > Computers > Monitors', keywords: ['monitor','screen','display'] },
  { id: 3587, title: 'Electronics > Computers > Keyboards', keywords: ['keyboard','mechanical keyboard'] },
  { id: 3588, title: 'Electronics > Computers > Mice', keywords: ['mouse','mice','trackpad'] },
  { id: 3585, title: 'Electronics > Computers > Laptop accessories', keywords: ['laptop case','laptop bag','laptop stand'] },
  { id: 3582, title: 'Electronics > Computers > Parts & components', keywords: ['graphics card','gpu','ram','ssd','cpu','motherboard'] },
  { id: 3586, title: 'Electronics > Computers > Docking stations & USB hubs', keywords: ['dock','usb hub','docking station'] },
  { id: 3593, title: 'Electronics > Computers > Webcams', keywords: ['webcam'] },
  { id: 3595, title: 'Electronics > Computers > Printers', keywords: ['printer','scanner'] },
  { id: 3584, title: 'Electronics > Computers > Computer accessories', keywords: ['computer accessories'] },
  // ── Audio, headphones & hi-fi (3566) ──
  { id: 3678, title: 'Electronics > Audio > Headphones & earbuds', keywords: ['headphones','earphones','airpods','earbuds'] },
  { id: 3681, title: 'Electronics > Audio > Portable speakers', keywords: ['speaker','bluetooth speaker','portable speaker'] },
  { id: 3682, title: 'Electronics > Audio > Smart speakers', keywords: ['smart speaker','echo','alexa','google home'] },
  { id: 3683, title: 'Electronics > Audio > Home audio systems', keywords: ['home audio','hi-fi','stereo','sound system','soundbar'] },
  { id: 3679, title: 'Electronics > Audio > Handheld music players', keywords: ['mp3 player','ipod','walkman'] },
  { id: 3680, title: 'Electronics > Audio > Portable radios', keywords: ['radio','portable radio','dab radio'] },
  { id: 3686, title: 'Electronics > Audio > Audio accessories', keywords: ['audio cable','aux cable','audio accessories'] },
  // ── Cameras & accessories (3054) ──
  { id: 3060, title: 'Electronics > Cameras > Cameras', keywords: ['camera','dslr','mirrorless','compact camera'] },
  { id: 3061, title: 'Electronics > Cameras > Lenses', keywords: ['lens','camera lens'] },
  { id: 3716, title: 'Electronics > Cameras > Camera drones', keywords: ['drone','camera drone','dji'] },
  { id: 3067, title: 'Electronics > Cameras > Tripods & monopods', keywords: ['tripod','monopod'] },
  { id: 3062, title: 'Electronics > Cameras > Flashes', keywords: ['flash','speedlight'] },
  { id: 3063, title: 'Electronics > Cameras > Memory cards', keywords: ['memory card','sd card','micro sd'] },
  { id: 3059, title: 'Electronics > Cameras > Accessories', keywords: ['camera accessories','camera bag','camera strap'] },
  // ── Other electronics ──
  { id: 3567, title: 'Electronics > Tablets & e-readers', keywords: ['tablet','ipad','kindle','e-reader'] },
  { id: 3569, title: 'Electronics > Beauty & personal care electronics', keywords: ['hair straightener','hair dryer','electric toothbrush'] },
  { id: 3568, title: 'Electronics > TV & home cinema', keywords: ['tv','television','projector','home cinema'] },
  { id: 3004, title: 'Electronics > Wearables', keywords: ['smartwatch','apple watch','fitbit','fitness tracker'] },
  { id: 2995, title: 'Electronics > Other devices', keywords: ['charger','cable','adapter','electronics','gadget','tech'] },
  // ══════════════════════════════════════════════════════════
  // HOBBIES & COLLECTABLES (4824)
  // ══════════════════════════════════════════════════════════
  { id: 4874, title: 'Hobbies > Trading cards', keywords: ['trading cards','pokemon cards','yugioh','football cards'] },
  { id: 5151, title: 'Hobbies > Arts & crafts', keywords: ['arts','crafts','sewing','knitting','crochet','yarn','fabric'] },
  { id: 4901, title: 'Hobbies > Memorabilia', keywords: ['memorabilia','signed','autograph','collectible'] },
  { id: 4881, title: 'Hobbies > Board games', keywords: ['board game','monopoly','chess','scrabble'] },
  { id: 4882, title: 'Hobbies > Puzzles', keywords: ['puzzle','jigsaw'] },
  { id: 4895, title: 'Hobbies > Coins & banknotes', keywords: ['coin','banknote','numismatic'] },
  { id: 4883, title: 'Hobbies > Tabletop & miniature gaming', keywords: ['warhammer','miniature','tabletop','d&d','dungeons'] },
  { id: 4825, title: 'Hobbies > Musical instruments & gear', keywords: ['guitar','keyboard','drum','instrument','amplifier','music'] },
  { id: 4916, title: 'Hobbies > Gaming accessories', keywords: ['gaming accessories'] },
  { id: 4894, title: 'Hobbies > Postcards', keywords: ['postcard','postcards'] },
  { id: 4888, title: 'Hobbies > Stamps', keywords: ['stamp','stamps','philately'] },
  { id: 4906, title: 'Hobbies > Collectables storage', keywords: ['display case','storage box','binder'] },
  // ══════════════════════════════════════════════════════════
  // SPORTS (4332)
  // ══════════════════════════════════════════════════════════
  { id: 4340, title: 'Sports > Equestrian', keywords: ['horse','equestrian','saddle','riding','bridle'] },
  { id: 4334, title: 'Sports > Fitness, running & yoga', keywords: ['fitness','running','yoga','weights','gym equipment','treadmill'] },
  { id: 4333, title: 'Sports > Cycling', keywords: ['cycling','bicycle','bike','helmet','cycling jersey'] },
  { id: 4336, title: 'Sports > Water sports', keywords: ['swimming','diving','surfing','wetsuit','snorkelling','kayak'] },
  { id: 4335, title: 'Sports > Outdoor sports', keywords: ['hiking','camping','climbing','tent','sleeping bag','backpack'] },
  { id: 4337, title: 'Sports > Team sports', keywords: ['football','rugby','cricket','basketball','hockey','netball'] },
  { id: 4339, title: 'Sports > Golf', keywords: ['golf','golf club','golf ball','golf bag'] },
  { id: 4342, title: 'Sports > Boxing & martial arts', keywords: ['boxing','martial arts','gloves','mma','karate'] },
  { id: 4341, title: 'Sports > Skateboards & scooters', keywords: ['skateboard','scooter','rollerblades','roller skates'] },
  { id: 4343, title: 'Sports > Casual sports & games', keywords: ['darts','table tennis','badminton set','croquet'] },
  { id: 4344, title: 'Sports > Winter sports', keywords: ['skiing','snowboard','ski','ice skating'] },
  { id: 4338, title: 'Sports > Racquet sports', keywords: ['tennis','badminton','squash','racket','racquet'] },
];

// Verified Vinted UK color IDs (scraped from vinted.co.uk)
const COLORS = [
  { id: 1, label: 'Black' }, { id: 12, label: 'White' }, { id: 3, label: 'Grey' },
  { id: 9, label: 'Blue' }, { id: 7, label: 'Red' }, { id: 10, label: 'Green' },
  { id: 8, label: 'Yellow' }, { id: 5, label: 'Pink' }, { id: 11, label: 'Orange' },
  { id: 6, label: 'Purple' }, { id: 2, label: 'Brown' }, { id: 4, label: 'Beige' },
  { id: 18, label: 'Cream' }, { id: 15, label: 'Multicolour' },
  { id: 16, label: 'Khaki' }, { id: 17, label: 'Turquoise' },
  { id: 13, label: 'Silver' }, { id: 14, label: 'Gold' },
  { id: 25, label: 'Navy' }, { id: 21, label: 'Burgundy' },
  { id: 20, label: 'Coral' }, { id: 24, label: 'Light blue' },
];

// Fuzzy color alias map — maps common AI descriptions to COLORS labels
const COLOR_ALIASES = {
  'dark blue': 'Navy', 'indigo': 'Navy', 'midnight': 'Navy', 'navy blue': 'Navy',
  'royal blue': 'Blue', 'cobalt': 'Blue', 'electric blue': 'Blue',
  'baby blue': 'Light blue', 'sky blue': 'Light blue', 'pale blue': 'Light blue', 'powder blue': 'Light blue',
  'off white': 'Cream', 'off-white': 'Cream', 'ivory': 'Cream', 'ecru': 'Cream', 'nude': 'Cream', 'bone': 'Cream',
  'hot pink': 'Pink', 'magenta': 'Pink', 'fuchsia': 'Pink', 'rose': 'Pink', 'salmon': 'Pink', 'blush': 'Pink',
  'dark red': 'Burgundy', 'wine': 'Burgundy', 'maroon': 'Burgundy', 'oxblood': 'Burgundy', 'bordeaux': 'Burgundy', 'crimson': 'Burgundy',
  'olive': 'Khaki', 'army green': 'Khaki', 'military green': 'Khaki', 'sage': 'Khaki',
  'forest green': 'Green', 'dark green': 'Green', 'emerald': 'Green', 'mint': 'Green', 'lime': 'Green', 'moss': 'Green',
  'lilac': 'Purple', 'lavender': 'Purple', 'violet': 'Purple', 'plum': 'Purple', 'mauve': 'Purple',
  'camel': 'Brown', 'tan': 'Brown', 'chocolate': 'Brown', 'tobacco': 'Brown', 'rust': 'Brown', 'caramel': 'Brown', 'mocha': 'Brown',
  'teal': 'Turquoise', 'aqua': 'Turquoise', 'cyan': 'Turquoise',
  'charcoal': 'Grey', 'light grey': 'Grey', 'dark grey': 'Grey', 'gray': 'Grey', 'silver grey': 'Grey', 'slate': 'Grey',
  'rose gold': 'Gold', 'champagne': 'Gold', 'bronze': 'Gold',
  'multicolor': 'Multicolour', 'multi': 'Multicolour', 'multi-color': 'Multicolour', 'multicoloured': 'Multicolour', 'patterned': 'Multicolour', 'floral': 'Multicolour', 'striped': 'Multicolour', 'printed': 'Multicolour',
  'coral pink': 'Coral', 'peach': 'Coral',
  'mustard': 'Yellow', 'lemon': 'Yellow',
  'tangerine': 'Orange', 'amber': 'Orange',
  'jet black': 'Black', 'noir': 'Black',
  'pure white': 'White', 'snow': 'White',
  'beige': 'Beige',
};

// Clothing category IDs — used to decide when to append size to title
// Built from CATEGORIES: Women/Men/Kids, excluding shoes/bags/accessories/etc.
const CLOTHING_CATEGORY_IDS = new Set(
  CATEGORIES
    .filter(c => {
      const title = (c.title || '').toLowerCase();
      const isWMK = /^(women|men|kids) > /i.test(c.title || '');
      const isNonClothing = /(shoes|bags|jewellery|accessories|beauty|grooming|toys|pushchairs|nursing|bathing|sleep)/i.test(title);
      return isWMK && !isNonClothing;
    })
    .map(c => c.id)
);

// Live Vinted category tree cache (filled lazily on first category search)
let _liveCatalogCache = null;
let _catalogFetchPromise = null;
let _catalogFetchedAt = 0;
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;

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

  // ── Read-only session "refresh": re-derive CSRF only, never mutate cookies ──
  // Used by /login, /status, and any non-post caller. Does NOT call
  // /web/api/auth/refresh (that's performVintedRefresh below), so it can
  // never invalidate the user's browser session.
  async function refreshVintedSession(session, userId) {
    const domain = session.domain || 'www.vinted.co.uk';
    try {
      const pageResp = await fetch(`https://${domain}/`, {
        headers: {
          'Cookie': session.cookies,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });
      const html = await pageResp.text();
      const csrfMatch = html.match(/"CSRF_TOKEN\\?":\\?"([^"\\]+)\\?"/);
      if (csrfMatch) {
        session.csrf = csrfMatch[1];
        console.log(`[TG] Re-derived CSRF for user ${userId} (read-only, no cookie mutation)`);
      }
    } catch (e) {
      console.log('[TG] CSRF re-derive failed (using existing):', e.message);
    }
    return session;
  }

  // ── Real Vinted token refresh — rotates access_token_web + refresh_token_web ──
  // Only called from the Telegram post path, and only AFTER a cheap probe
  // confirms the current cookies are actually 401. The browser desync this
  // used to cause is healed by the Chrome extension's reconcileCookies(),
  // which reads the rotated tokens from /api/session/get on its next wake
  // and writes them back into local chrome.cookies.
  async function performVintedRefresh(session, userId) {
    const domain = session.domain || 'www.vinted.co.uk';
    const resp = await fetch(`https://${domain}/web/api/auth/refresh`, {
      method: 'POST',
      headers: {
        'Cookie': session.cookies,
        'X-CSRF-Token': session.csrf || '',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      },
    });
    if (!resp.ok) throw new Error(`refresh failed: ${resp.status}`);

    const setCookies = typeof resp.headers.getSetCookie === 'function'
      ? resp.headers.getSetCookie()
      : (resp.headers.raw?.()['set-cookie'] || []);
    if (!setCookies.length) throw new Error('refresh returned no Set-Cookie');

    const cookieMap = new Map();
    session.cookies.split('; ').forEach(c => {
      const [k, ...v] = c.split('=');
      if (k) cookieMap.set(k.trim(), v.join('='));
    });
    for (const sc of setCookies) {
      const first = sc.split(';')[0];
      const eq = first.indexOf('=');
      if (eq <= 0) continue;
      const k = first.slice(0, eq).trim();
      const v = first.slice(eq + 1).trim();
      if (k) cookieMap.set(k, v);
    }
    for (const k of ['access_token_web', 'refresh_token_web']) {
      if (!cookieMap.has(k)) throw new Error(`refresh missing ${k}`);
    }
    session.cookies = Array.from(cookieMap.entries()).map(([k, v]) => `${k}=${v}`).join('; ');

    await store.setSession(userId, {
      csrf: session.csrf,
      cookies: session.cookies,
      domain: session.domain,
      memberId: session.memberId,
    });
    console.log(`[TG] Rotated Vinted tokens for user ${userId} — extension will reconcile on next wake`);
    return session;
  }

  // Probe-then-refresh helper: returns a session that's known-good, or
  // throws SESSION_EXPIRED if the refresh attempt also fails. Never called
  // speculatively — only from the post path.
  async function ensureFreshSession(session, userId) {
    try {
      const probe = await vintedFetch(session, '/api/v2/users/' + (session.memberId || 'self'));
      if (probe.ok) return session;
      if (probe.status !== 401) return session; // non-auth error, let caller handle
    } catch (e) {
      // network error — let the caller deal with it, no refresh
      return session;
    }
    console.log(`[TG] Probe returned 401 for user ${userId}, running performVintedRefresh`);
    try {
      return await performVintedRefresh(session, userId);
    } catch (e) {
      console.error(`[TG] performVintedRefresh failed for user ${userId}:`, e.message);
      const err = new Error('SESSION_EXPIRED');
      err.cause = e;
      throw err;
    }
  }

  // ── Persist chat accounts to DB so logins survive restarts ──
  // ── Save full chat state to DB (accounts + active listing + photos) ──
  async function saveChatState(chatId) {
    if (!db || !db.hasDb()) return;
    const c = chats.get(chatId);
    if (!c) return;
    await tableReady; // ensure table exists before writing
    try {
      const accts = JSON.stringify(c.accounts || []);
      // Save only fileIds + Telegram message_id for photos (not base64 — too
      // large for JSONB). _mid preserves media-group selection order on restore.
      const photoRefs = c.photos?.length
        ? JSON.stringify(c.photos.map(p => ({ fileId: p.fileId, _mid: p._mid })))
        : null;
      console.log(`[TG] Saving state: chat=${chatId} accounts=${c.accounts?.length || 0} idx=${c.activeIdx} step=${c.step} photos=${c.photos?.length || 0}`);
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
          photoRefs,
          c.wizardIdx ?? 0,
          c.step || 'idle'
        ]
      );
      console.log(`[TG] State saved OK for chat ${chatId}`);
    } catch (e) {
      console.error('[TG] Save state error:', e.message);
      // Fallback: at least save accounts so login persists
      try { await saveChatAccounts(chatId, c.accounts || [], c.activeIdx ?? -1); } catch {}
    }
  }

  // Save the current listing to the failed-retry queue (caps at 5 per chat)
  async function saveFailedListing(chatId, errorSummary) {
    if (!db || !db.hasDb()) return;
    const c = chats.get(chatId);
    if (!c || !c.listing) return;
    await tableReady;
    try {
      const acct = activeAccount(c);
      const photoRefs = (c.photos || []).map(p => ({ fileId: p.fileId, _mid: p._mid })).filter(r => r.fileId);
      if (!photoRefs.length) {
        console.log('[TG] saveFailedListing skipped — no fileIds');
        return;
      }
      await db.query(
        `INSERT INTO rp_telegram_failed_listings
           (chat_id, listing, photo_refs, account_idx, account_name, error_summary)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          String(chatId),
          JSON.stringify(c.listing),
          JSON.stringify(photoRefs),
          c.activeIdx ?? 0,
          acct?.vintedName || acct?.username || null,
          (errorSummary || '').slice(0, 500),
        ]
      );
      await db.query(
        `DELETE FROM rp_telegram_failed_listings
         WHERE id IN (
           SELECT id FROM rp_telegram_failed_listings
           WHERE chat_id=$1 ORDER BY created_at DESC OFFSET 5
         )`,
        [String(chatId)]
      );
      console.log(`[TG] saveFailedListing OK for chat ${chatId}`);
    } catch (e) { console.error('[TG] saveFailedListing error:', e.message); }
  }

  // Shortcut: save just accounts (lightweight, no photos)
  async function saveChatAccounts(chatId, accounts, activeIdx) {
    if (!db || !db.hasDb()) return;
    await tableReady;
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
    await tableReady;
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

      // Failed-listing retry queue (last 5 per chat)
      await db.query(`
        CREATE TABLE IF NOT EXISTS rp_telegram_failed_listings (
          id            SERIAL PRIMARY KEY,
          chat_id       TEXT NOT NULL,
          listing       JSONB NOT NULL,
          photo_refs    JSONB NOT NULL,
          account_idx   INTEGER,
          account_name  TEXT,
          error_summary TEXT,
          created_at    TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await db.query(`CREATE INDEX IF NOT EXISTS rp_tg_failed_chat_created ON rp_telegram_failed_listings (chat_id, created_at DESC)`);
      console.log('[TG] Chat persistence table ready');
    } catch (e) { console.error('[TG] Table init error:', e.message); }
  }
  const tableReady = initTelegramTable();

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
      c.wizardIdx = saved.wizardIdx ?? 0;
      c.step = saved.step || 'idle';
      // Re-download photos from Telegram using saved fileIds
      const photoRefs = saved.photos || [];
      if (photoRefs.length && photoRefs[0].fileId) {
        console.log(`[TG] Re-downloading ${photoRefs.length} photo(s) from Telegram...`);
        c.photos = [];
        const os = require('os');
        const fs = require('fs');
        for (const ref of photoRefs) {
          try {
            const filePath = await bot.downloadFile(ref.fileId, os.tmpdir());
            const buffer = fs.readFileSync(filePath);
            try { fs.unlinkSync(filePath); } catch (_) {}
            if (buffer.length) {
              c.photos.push({ base64: buffer.toString('base64'), fileId: ref.fileId, _mid: ref._mid });
            }
          } catch (e) {
            console.error(`[TG] Re-download failed for ${ref.fileId}: ${e.message}`);
          }
        }
        console.log(`[TG] Restored ${c.photos.length}/${photoRefs.length} photo(s) for chat ${chatId}`);
      } else {
        c.photos = [];
      }
      console.log(`[TG] Restored listing for chat ${chatId} (step=${c.step})`);
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
    { command: 'ready',  description: 'Continue after fixing a failed step' },
    { command: 'cancel', description: 'Abort current listing' },
    { command: 'retry',  description: 'Resume a failed listing (last 5)' },
    { command: 'logout', description: 'Disconnect current account' },
    { command: 'help',   description: 'Show all commands' },
  ]).then(() => console.log('[TG] Commands menu registered'));

  // ──────────────────────────────────────────
  // COMMANDS
  // ──────────────────────────────────────────

  bot.onText(/\/start(?:@\S+)?/, async (msg) => {
    await ensureLoaded(msg.chat.id);
    const c = getChat(msg.chat.id);
    ensureMulti(c);
    const connected = activeAccount(c);

    if (connected) {
      // Already logged in — show quick guide
      const rpName = esc(connected.username);
      const vtName = esc(connected.vintedName || '_not detected_');
      return bot.sendMessage(msg.chat.id,
        `Welcome back\\! ✅\n\n` +
        `👤 RelistPro: *${rpName}*\n` +
        `🛍️ Vinted: *${vtName}*\n\n` +
        `📸 *Send photos* of an item to list it on Vinted\n` +
        `Add a caption with details like "Nike hoodie size M £25"\n\n` +
        `*Commands:*\n` +
        `/status — check your Vinted session\n` +
        `/switch — switch between accounts\n` +
        `/cancel — abort current listing\n` +
        `/logout — disconnect account\n` +
        `/help — show all commands`,
        { parse_mode: 'MarkdownV2' }
      );
    }

    // Not logged in — full setup guide
    bot.sendMessage(msg.chat.id,
      `Welcome to *RelistPro Bot* 🛍️\n\n` +
      `List items on Vinted in seconds — just send photos\\!\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `*Setup \\(one\\-time\\):*\n\n` +
      `1️⃣ *Install the Chrome extension*\n` +
      `Download RelistPro from the Chrome Web Store and install it\n\n` +
      `2️⃣ *Create your account*\n` +
      `Click the extension icon → Register with a username \\& password\n\n` +
      `3️⃣ *Sync your Vinted session*\n` +
      `Log into vinted\\.co\\.uk in Chrome\n` +
      `Click the RelistPro extension → hit *Sync*\n` +
      `This shares your Vinted login cookies with the bot\n\n` +
      `4️⃣ *Connect here*\n` +
      `Tap /login → enter your RelistPro username \\& password\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `*Once connected:*\n` +
      `📸 Send photos of your item\n` +
      `🤖 AI generates title, description, price, brand\n` +
      `✏️ Review \\& edit anything you want\n` +
      `🚀 Hit POST TO VINTED — done\\!\n\n` +
      `*Multiple Vinted accounts?*\n` +
      `/login with each account, then /switch between them\n\n` +
      `*Need help?* Tap /help anytime`,
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
      `/ready — continue after fixing a failed step\n` +
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

    // Already connected? Confirm the persistent state instead of making the
    // user re-enter credentials. Sessions persist in the DB indefinitely, so
    // once the extension has synced there's nothing to re-sync on each login.
    if (args.length === 0 && c.accounts?.length) {
      const lines = c.accounts.map((a, i) => {
        const mark = i === c.activeIdx ? '➤' : ' ';
        const vn = a.vintedName ? ` → 🛍️ ${a.vintedName}` : '';
        return `${mark} ${a.username}${vn}`;
      }).join('\n');
      return bot.sendMessage(chatId,
        `✅ You're already connected — no need to sync or log in again.\n\n${lines}\n\n` +
        `📸 Send photos to list an item.\n` +
        `🔄 /switch to change active account\n` +
        `➕ To add another account: /login <username> <password>\n` +
        `👋 /logout to disconnect`
      );
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
        return bot.sendMessage(chatId, `No RelistPro account found for "${username}". Double-check the spelling — usernames are the ones you picked when registering in the Chrome extension. If you haven't registered yet, do that first, then come back and /login.`);
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

      const vintedDisplay = vintedName || '_not detected_';
      const countMsg = c.accounts.length > 1 ? `\n${c.accounts.length} accounts linked\\. Use /switch to change\\.` : '';
      bot.sendMessage(chatId,
        `✅ *Logged in*\n\n` +
        `👤 RelistPro: *${esc(username)}*\n` +
        `🛍️ Vinted: *${esc(vintedDisplay)}* \\(${esc(session.domain)}\\)\n` +
        `${countMsg}\n` +
        `📸 Send me photos of an item to list it\\!`,
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
    if (!c.accounts.length) return bot.sendMessage(msg.chat.id, 'Not connected yet.\n\nFollow these steps:\n1. Install RelistPro Chrome extension\n2. Register an account in the extension\n3. Log into vinted.co.uk → click extension → Sync\n4. Come back here and tap /login');

    const statusMsg = await bot.sendMessage(msg.chat.id, 'Checking connection...');

    const lines = [];
    for (let i = 0; i < c.accounts.length; i++) {
      const a = c.accounts[i];
      const session = await store.getSession(a.userId);
      const active = i === c.activeIdx ? ' [active]' : '';
      const header = `${i + 1}. 👤 ${a.username} → 🛍️ ${a.vintedName || 'not detected'}${active}`;

      if (!session) {
        lines.push(`${header}\n   ❌ No Vinted session — open Chrome → RelistPro extension → Sync`);
        continue;
      }

      // Test if session is actually alive by making a lightweight API call
      let sessionAlive = false;
      try {
        const testResp = await vintedFetch(session, '/api/v2/users/' + (session.memberId || 'self'));
        sessionAlive = testResp.ok;
        if (!sessionAlive && testResp.status === 401) {
          // Try refreshing
          try {
            await refreshVintedSession(session, a.userId);
            const retryResp = await vintedFetch(session, '/api/v2/users/' + (session.memberId || 'self'));
            sessionAlive = retryResp.ok;
          } catch {}
        }
      } catch {}

      if (sessionAlive) {
        lines.push(`${header}\n   ✅ Vinted session active (${session.domain})`);
      } else {
        lines.push(`${header}\n   ⚠️ Vinted session expired — open Chrome → RelistPro extension → Sync`);
      }
    }

    bot.editMessageText(`*Account Status*\n\n${lines.join('\n\n')}\n\n📸 Send photos to list an item`, {
      chat_id: msg.chat.id, message_id: statusMsg.message_id, parse_mode: 'Markdown'
    });
  });

  bot.onText(/\/switch(?:@\S+)?/, async (msg) => {
    const chatId = msg.chat.id;
    await ensureLoaded(chatId);
    const c = getChat(chatId);
    ensureMulti(c);
    if (c.accounts.length < 2) return bot.sendMessage(chatId, c.accounts.length ? 'Only one account linked. Use /login to add another.' : 'No accounts linked. Use /login first.');

    const rows = [];
    for (const [i, a] of c.accounts.entries()) {
      const vt = a.vintedName || '(no Vinted name)';
      const label = `${a.username} → ${vt}${i === c.activeIdx ? ' [current]' : ''}`;
      rows.push([{ text: label.slice(0, 64), callback_data: `sw:${i}` }]);
    }
    bot.sendMessage(chatId, 'Switch to which account?\n(RelistPro → Vinted)', { reply_markup: { inline_keyboard: rows } });
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

  // ── /ready — "I'm done fixing this step, continue" ──
  // Used by the publish-error walkthrough (user types /ready after fixing a
  // broken field), and also as a manual advance after re-sending photos.
  bot.onText(/\/ready(?:@\S+)?/, async (msg) => {
    const chatId = msg.chat.id;
    await ensureLoaded(chatId);
    const c = getChat(chatId);
    ensureMulti(c);
    if (!c.listing) {
      return bot.sendMessage(chatId, 'Nothing to continue. Send photos to start a new listing.');
    }
    const L = c.listing;
    // If the photos error is still outstanding but the user has already
    // resent photos, mark it fixed so showSummary can advance.
    if (L._errorWalkthrough && Array.isArray(L._errorFields) &&
        L._errorFields.includes('photos') && c.photos?.length) {
      clearErrorField(c, 'photos');
    }
    c.step = 'review';
    c.summaryMsgId = null;
    saveChatState(chatId);
    return showSummary(chatId);
  });

  bot.onText(/^\/retry(?:@\S+)?$/i, async (msg) => {
    const chatId = msg.chat.id;
    await ensureLoaded(chatId);
    if (!db || !db.hasDb()) return bot.sendMessage(chatId, 'Database not available.');
    try {
      const r = await db.query(
        `SELECT id, listing, account_name, error_summary, created_at
         FROM rp_telegram_failed_listings
         WHERE chat_id=$1 ORDER BY created_at DESC LIMIT 5`,
        [String(chatId)]
      );
      if (!r.rows.length) return bot.sendMessage(chatId, 'No failed listings saved.');
      const rows = r.rows.map(row => {
        const L = typeof row.listing === 'string' ? JSON.parse(row.listing) : row.listing;
        const label = `${L.title || 'Untitled'} — £${L.price || '?'} (${row.account_name || 'acct'})`;
        return [{ text: label.slice(0, 60), callback_data: `retry:${row.id}` }];
      });
      return bot.sendMessage(chatId, '🔁 Pick a failed listing to retry:', {
        reply_markup: { inline_keyboard: rows }
      });
    } catch (e) {
      console.error('[TG] /retry error:', e.message);
      return bot.sendMessage(chatId, 'Could not load failed listings.');
    }
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
    if (!activeAccount(c)) return bot.sendMessage(chatId,
      'Not connected yet.\n\n' +
      'To get started:\n' +
      '1. Install the RelistPro Chrome extension\n' +
      '2. Register an account in the extension\n' +
      '3. Log into vinted.co.uk → click extension → Sync\n' +
      '4. Come back here → /login with your username & password');

    // Pre-flight: check if Vinted session exists before user goes through wizard
    if (c.step === 'idle') {
      const acct = activeAccount(c);
      try {
        const sess = await store.getSession(acct.userId);
        if (!sess) {
          return bot.sendMessage(chatId,
            '⚠️ No Vinted session found for ' + (acct.vintedName || acct.username) + '.\n\n' +
            'To fix:\n' +
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

    if (c.step !== 'collecting_photos' && c.step !== 'collecting_photos_for_review' && c.step !== 'collecting_proof_photos') {
      return bot.sendMessage(chatId, 'Finish or /cancel your current listing first.');
    }

    // Download highest-res version.
    // IMPORTANT: push a placeholder SYNCHRONOUSLY (before the async download)
    // so media-group photos preserve the user's selection order. Telegram
    // fires the 'photo' event in message_id order; if we waited to push until
    // after `await bot.downloadFile`, faster downloads would land first and
    // reorder the upload. We sort by `_mid` again before uploading, belt and
    // braces, in case the Telegram client queues events out of order.
    const photo = msg.photo[msg.photo.length - 1];
    const slot = { _mid: msg.message_id, fileId: photo.file_id, base64: null };
    c.photos.push(slot);
    try {
      console.log(`[TG] Downloading photo file_id=${photo.file_id} mid=${msg.message_id}`);
      // Use bot.downloadFile which uses the library's built-in HTTP client
      // (fetch() fails on Railway for Telegram file URLs)
      const os = require('os');
      const fs = require('fs');
      const filePath = await bot.downloadFile(photo.file_id, os.tmpdir());
      const buffer = fs.readFileSync(filePath);
      try { fs.unlinkSync(filePath); } catch (_) {}
      if (!buffer.length) throw new Error('Empty file');
      slot.base64 = buffer.toString('base64');
      console.log(`[TG] Photo downloaded: ${buffer.length} bytes mid=${msg.message_id}`);
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

  // ──────────────────────────────────────────
  // PROCESS PHOTOS → AI ANALYSIS
  // ──────────────────────────────────────────

  // ── Step-by-step wizard order ──
  const WIZARD_STEPS = ['title', 'description', 'price', 'category', 'size', 'condition', 'colour', 'brand', 'parcel', 'confirm'];

  // ── Authenticity gate ──
  // Brands Vinted runs through authenticity verification. Selecting one of
  // these triggers an automated counterfeit check; a mismatch can ban the
  // account. We prompt the user to either add proof photos, switch to
  // "Unbranded", or cancel before the listing ever reaches Vinted.
  const HIGH_RISK_BRANDS = new Set([
    'gucci','louis vuitton','lv','prada','balenciaga','dior','christian dior',
    'chanel','burberry','moncler','stone island','canada goose','nike','jordan',
    'air jordan','off-white','off white','hermes','hermès','yves saint laurent',
    'ysl','saint laurent','fendi','versace','armani','giorgio armani','emporio armani',
    'ralph lauren','polo ralph lauren','patagonia','supreme','palace','trapstar',
    'corteiz','the north face','north face','arc\'teryx','arcteryx','bottega veneta',
    'celine','céline','goyard','loewe','valentino','givenchy','loro piana',
    'rolex','omega','cartier','audemars piguet','patek philippe','tag heuer'
  ]);

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

  // Strip a brand word (and hyphen/space variants of a multi-word brand) from
  // a piece of text, case-insensitive, with whole-word boundaries. Used when
  // the user explicitly opts into cleaning the title/description after
  // switching to Unbranded.
  function stripBrandFromText(text, brand) {
    if (!text || !brand) return text;
    const parts = String(brand).trim().split(/[\s-]+/).filter(Boolean);
    if (!parts.length) return text;
    const escaped = parts.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = escaped.join('[\\s-]+');
    const re = new RegExp(`\\b${pattern}\\b`, 'gi');
    return text.replace(re, '').replace(/\s{2,}/g, ' ').replace(/^\s*[-,:;]\s*/, '').trim();
  }

  // Cached Vinted "Unbranded" brand id per domain.
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

      // Auto-match primary color (fuzzy — aliases + partial)
      const c1Match = matchColor(analysis.color);
      let colorId = c1Match?.id || null;
      let colorName = c1Match?.label || analysis.color || '';

      // Auto-match secondary color (fuzzy)
      const c2Match = matchColor(analysis.color2);
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
        color2: color2Name,
        color2_id: color2Id,
        material: analysis.material || '',
        gender: analysis.gender || '',
        package_size_id: pkgId,
        package_size_name: pkgName,
        aiConfidence: analysis.confidence || { brand: 'medium', size: 'medium', color: 'medium' },
      };

      console.log(`[TG] AI analysis: brand=${analysis.brand}, size=${analysis.size_hint}, color=${analysis.color}/${analysis.color2}, material=${analysis.material}, parcel=${analysis.parcel_size}, gender=${analysis.gender}`);

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
      // If AI detected a brand, auto-search Vinted with it. This resolves
      // a real brand_id (blind "Keep" used to leave brand_id=null → untagged
      // listings) AND lets the authenticity gate fire for verified brands.
      if (L.brand) {
        await bot.sendMessage(chatId, `🏷️ Step 8/9 — Brand\n\nAI detected: ${L.brand}\n\nLooking up in Vinted...`);
        return searchBrands(chatId, L.brand);
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

    const imageBlocks = photos.slice(0, 20).map(p => ({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: typeof p === 'string' ? p : p.base64 || p }
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
BRAND: Check labels, logos, tags in ALL photos. Read text on labels carefully. Guess if partial logo visible. null if truly unidentifiable.
CATEGORY: Return a structured path like "Women > Dresses > Midi dresses" or "Men > Jumpers > Hoodies" or "Kids > Girls > Tops" — use > as separator. Be as specific as possible to the leaf level.
COLOR: Primary color. One of: Black,White,Grey,Blue,Red,Green,Yellow,Pink,Orange,Purple,Brown,Beige,Cream,Multicolour,Khaki,Turquoise,Silver,Gold,Navy,Burgundy,Coral,Light blue. If item has a pattern/print, use Multicolour.
COLOR2: Secondary color if item is two-tone. null if single color.
SIZE: Read size labels/tags carefully. Return EXACTLY what the label says (e.g. "M", "UK 10", "EU 38", "S/M", "6-8", "XL", "One size"). This is critical — check ALL photos for size tags (inside garment, waistband, neck label).
MATERIAL: Read care labels. Return composition (e.g. "100% cotton", "80% polyester 20% elastane", "faux leather"). null if not visible.
PARCEL: Estimate weight category. "Small" (under 2kg, fits large letter), "Medium" (2-5kg, shoebox), "Large" (5-10kg, large box).
GENDER: "women", "men", "kids", "unisex" based on the item style and any labels.
CONFIDENCE: For each of brand, size, color — return "high" if you're sure from a clear label/logo, "medium" if inferring from context, "low" if not visible in any photo.`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1200,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: [
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
        return bot.sendMessage(chatId, `✏️ Title needs a fix.\n\nCurrent: *${esc(L.title || '—')}*\n\nType the new title:`, { parse_mode: 'MarkdownV2' });
      case 'description':
      case 'desc':
        c.step = 'editing_desc';
        saveChatState(chatId);
        return bot.sendMessage(chatId, `✏️ Description needs a fix.\n\nType the new description:`);
      case 'price':
        c.step = 'editing_price';
        saveChatState(chatId);
        return bot.sendMessage(chatId, `💰 Price needs a fix.\n\nCurrent: £${L.price || '—'}\n\nType the new price (number only):`);
      case 'brand':
        c.step = 'editing_brand';
        saveChatState(chatId);
        return bot.sendMessage(chatId, `🏷️ Brand needs a fix.\n\nCurrent: ${L.brand || 'None'}\n\nType the brand name to search (or "none" to clear):`);
      case 'condition': {
        const keyboard = CONDITIONS.map(x => ([{ text: `${x.emoji} ${x.label}`, callback_data: `cond:${x.id}` }]));
        return bot.sendMessage(chatId, '📦 Condition needs a fix. Pick one:', { reply_markup: { inline_keyboard: keyboard } });
      }
      case 'color':
      case 'colour': {
        const rows = [];
        for (let i = 0; i < COLORS.length; i += 3) {
          rows.push(COLORS.slice(i, i + 3).map(x => ({ text: x.label, callback_data: `color:${x.id}` })));
        }
        return bot.sendMessage(chatId, '🎨 Colour needs a fix. Pick one:', { reply_markup: { inline_keyboard: rows } });
      }
      case 'category':
      case 'catalog':
        c.step = 'searching_cat';
        saveChatState(chatId);
        return bot.sendMessage(chatId, '📂 Category needs a fix.\n\nType a category name to search (e.g. "hoodie", "jeans", "stroller"):');
      case 'size':
        if (!L.catalog_id) {
          return bot.sendMessage(chatId, '📏 Size needs a fix, but pick a category first.');
        }
        return showSizePicker(chatId);
      case 'parcel':
      case 'package':
      case 'package_size':
        return showPackageSizePicker(chatId);
      case 'isbn':
        c.step = 'editing_isbn';
        saveChatState(chatId);
        return bot.sendMessage(chatId,
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
        return bot.sendMessage(chatId,
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
      return bot.sendMessage(chatId, 'No listing in progress. Send photos to start a new one.');
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
      bot.sendMessage(chatId,
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

    const errFields = new Set(L._errorFields || []);
    if (errFields.size) {
      text += `\n\n⚠️ *Last publish failed on:* ${esc(Array.from(errFields).join(', '))}`;
    }
    const warn = (f, base) => errFields.has(f) ? '⚠️ ' + base : base;

    const keyboard = [
      [{ text: warn('title', '✏️ Title'), callback_data: 'edit:title' }, { text: warn('description', '✏️ Description'), callback_data: 'edit:desc' }, { text: warn('price', '💰 Price'), callback_data: 'edit:price' }],
      [{ text: warn('category', '📂 Category'), callback_data: 'pick:cat' }, { text: warn('size', '📏 Size'), callback_data: 'pick:size' }, { text: warn('brand', '🏷️ Brand'), callback_data: 'edit:brand' }],
      [{ text: warn('color', '🎨 Colour'), callback_data: 'pick:color' }, { text: warn('condition', '📦 Condition'), callback_data: 'pick:cond' }, { text: warn('parcel', '📮 Parcel size'), callback_data: 'pick:pkg' }],
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
        const vt = a.vintedName || 'not detected';
        return bot.editMessageText(
          `✅ Switched account\n\n👤 RelistPro: ${a.username}\n🛍️ Vinted: ${vt}\n\n📸 Send photos to list on this account.`,
          { chat_id: chatId, message_id: query.message.message_id }
        );
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
      clearErrorField(c, 'condition');
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
      if (col) { c.listing.color1_id = col.id; c.listing.color = col.label; console.log(`[TG] Color selected: ${col.label} (id=${col.id})`); }
      clearErrorField(c, 'color');
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
    if (data === 'pkg:custom') {
      c.step = c.step.startsWith('wiz_') ? 'wiz_custom_parcel' : 'custom_parcel';
      return bot.sendMessage(chatId,
        '📐 Enter custom parcel dimensions:\n\n' +
        'Format: `weight length width height`\n' +
        'Example: `2 30 20 15` (2kg, 30×20×15 cm)\n\n' +
        'Or just type the weight in kg (e.g. `3`)',
        { parse_mode: 'Markdown' }
      );
    }
    if (data.startsWith('pkg:')) {
      const id = parseInt(data.split(':')[1]);
      return selectPackageSize(chatId, id);
    }

    // ── Sync accept/reject ──
    if (data === 'sync:accept') {
      if (c.step === 'confirm_desc_sync' && c.pendingSyncDesc) {
        c.listing.description = c.pendingSyncDesc;
        clearErrorField(c, 'description');
      } else if (c.step === 'confirm_title_sync' && c.pendingSyncTitle) {
        c.listing.title = c.pendingSyncTitle;
        clearErrorField(c, 'title');
      }
      delete c.pendingSyncDesc;
      delete c.pendingSyncTitle;
      c.step = 'review';
      c.summaryMsgId = null;
      saveChatState(chatId);
      return showSummary(chatId);
    }
    if (data === 'sync:reject') {
      delete c.pendingSyncDesc;
      delete c.pendingSyncTitle;
      c.step = 'review';
      c.summaryMsgId = null;
      saveChatState(chatId);
      return showSummary(chatId);
    }

    // ── Brand: search again prompt ──
    if (data === 'brand:search') {
      c.step = c.step.startsWith('wiz_') ? 'wiz_brand' : 'editing_brand';
      return bot.sendMessage(chatId, 'Type a brand name to search:');
    }

    // ── Brand search results ──
    if (data.startsWith('brand:')) {
      const parts = data.split(':');
      const bid = parseInt(parts[1]);
      c.listing.brand_id = bid > 0 ? bid : null;
      // brand:<id>:<textName> — with text = keep it as plain text brand.
      // brand:0: (empty text) = explicit "No brand", clear any AI-detected
      // brand so it doesn't leak into the listing.
      const textName = parts.slice(2).join(':');
      if (textName) c.listing.brand = textName;
      else if (bid === 0) c.listing.brand = '';
      clearErrorField(c, 'brand');

      // Authenticity gate: if this is a Vinted-verified brand and we haven't
      // already run the gate for this listing, stop here and ask the user to
      // add proof photos, switch to Unbranded, or cancel.
      const effectiveName = textName || c.listing.brand || '';
      if (bid > 0 && !c._authChecked && isHighRiskBrand(effectiveName)) {
        c._authPrevStep = c.step;
        c._authGateBrandName = effectiveName;
        c.step = 'auth_gate';
        saveChatState(chatId);
        const checklist = getProofChecklist(c.listing.category_name);
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

      if (c.step.startsWith('wiz_')) return wizardNext(chatId);
      c.step = 'review';
      return showSummary(chatId);
    }

    // ── Authenticity gate: user has proof photos ──
    if (data === 'auth:proof') {
      c.step = 'collecting_proof_photos';
      saveChatState(chatId);
      const checklist = getProofChecklist(c.listing?.category_name);
      const listText = checklist.map(s => `• ${s}`).join('\n');
      return bot.sendMessage(chatId,
        `📸 Send your authenticity photos now. Recommended shots:\n${listText}\n\n` +
        `They will be added to the listing alongside your product shots. Tap Done when finished.`,
        { reply_markup: { inline_keyboard: [
          [{ text: '✅ Done — continue listing', callback_data: 'auth:proofdone' }]
        ]}}
      );
    }

    if (data === 'auth:proofdone') {
      if (c.step === 'collecting_proof_photos') {
        await bot.sendMessage(chatId, `✅ Added ${c.photos?.length || 0} photo(s) total. Continuing...`);
      }
      return resumeAfterAuthGate(chatId);
    }

    // ── Authenticity gate: post as Unbranded ──
    if (data === 'auth:unbranded') {
      const originalBrand = c._authGateBrandName || c.listing.brand || '';
      try {
        const acct = activeAccount(c);
        const session = acct ? await store.getSession(acct.userId) : null;
        const ubId = session ? await getUnbrandedId(session) : null;
        c.listing.brand_id = ubId || null;
        c.listing.brand = 'Unbranded';
        console.log(`[TG] Auth gate → Unbranded (id=${ubId})`);
      } catch (e) {
        console.error('[TG] auth:unbranded error:', e.message);
        c.listing.brand_id = null;
        c.listing.brand = 'Unbranded';
      }

      const origTitle = c.listing.title || '';
      const origDesc = c.listing.description || '';
      const strippedTitle = stripBrandFromText(origTitle, originalBrand);
      const strippedDesc = stripBrandFromText(origDesc, originalBrand);
      const changedTitle = strippedTitle !== origTitle;
      const changedDesc = strippedDesc !== origDesc;

      if (!originalBrand || (!changedTitle && !changedDesc)) {
        await bot.sendMessage(chatId, '🏷️ Brand switched to *Unbranded*\\. Continuing\\.\\.\\.', { parse_mode: 'MarkdownV2' });
        return resumeAfterAuthGate(chatId);
      }

      if (changedTitle && strippedTitle.length < 3) {
        await bot.sendMessage(chatId,
          `🏷️ Brand switched to Unbranded. Title would be empty after removing "${originalBrand}", keeping it as-is. Continuing...`);
        return resumeAfterAuthGate(chatId);
      }

      c._authStripPreview = { originalBrand, strippedTitle, strippedDesc, changedTitle, changedDesc };

      const lines = [
        `🏷️ Brand switched to *Unbranded*.`,
        ``,
        `Vinted also scans titles and descriptions for brand words. Want me to strip "${originalBrand}" from them?`,
        ``,
      ];
      if (changedTitle) {
        lines.push(`*Title now:* ${origTitle}`);
        lines.push(`*Title after:* ${strippedTitle}`);
        lines.push(``);
      }
      if (changedDesc) {
        const d1 = origDesc.length > 120 ? origDesc.slice(0, 117) + '...' : origDesc;
        const d2 = strippedDesc.length > 120 ? strippedDesc.slice(0, 117) + '...' : strippedDesc;
        lines.push(`*Description now:* ${d1}`);
        lines.push(`*Description after:* ${d2}`);
      }

      return bot.sendMessage(chatId, lines.join('\n'), {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [
          [{ text: '✂️ Yes — strip brand word', callback_data: 'auth:strip:yes' }],
          [{ text: '📝 No — keep as-is', callback_data: 'auth:strip:no' }],
        ]}
      });
    }

    if (data === 'auth:strip:yes') {
      const p = c._authStripPreview;
      if (p) {
        if (p.changedTitle) c.listing.title = p.strippedTitle;
        if (p.changedDesc) c.listing.description = p.strippedDesc;
        console.log(`[TG] Auth gate strip applied: brand="${p.originalBrand}"`);
      }
      delete c._authStripPreview;
      await bot.sendMessage(chatId, '✂️ Brand word stripped. Continuing...');
      return resumeAfterAuthGate(chatId);
    }

    if (data === 'auth:strip:no') {
      delete c._authStripPreview;
      await bot.sendMessage(chatId, '📝 Keeping title and description as-is. Continuing...');
      return resumeAfterAuthGate(chatId);
    }

    // ── Authenticity gate: cancel the whole listing ──
    if (data === 'auth:cancel') {
      c.step = 'idle';
      c.photos = [];
      c.listing = null;
      c.summaryMsgId = null;
      c.catalogCache = null;
      delete c._authChecked;
      delete c._authPrevStep;
      delete c._authGateBrandName;
      delete c._authStripPreview;
      saveChatState(chatId);
      return bot.sendMessage(chatId, '❌ Listing cancelled. Send new photos whenever you\'re ready.');
    }

    // ── Retry a saved failed listing ──
    if (data.startsWith('retry:')) {
      if (!db || !db.hasDb()) return bot.sendMessage(chatId, 'Database not available.');
      const rowId = parseInt(data.split(':')[1]);
      const r = await db.query(
        `SELECT listing, photo_refs, account_idx FROM rp_telegram_failed_listings WHERE id=$1 AND chat_id=$2`,
        [rowId, String(chatId)]
      );
      if (!r.rows.length) return bot.sendMessage(chatId, 'Retry entry not found (may have been cleared).');
      const row = r.rows[0];
      const parseJ = (v) => typeof v === 'string' ? JSON.parse(v) : v;
      const listing = parseJ(row.listing);
      const photoRefs = parseJ(row.photo_refs) || [];

      ensureMulti(c);
      if (row.account_idx != null && row.account_idx < c.accounts.length) {
        c.activeIdx = row.account_idx;
      }

      c.listing = listing;
      delete c.listing._failedDraftId;
      delete c.listing._errorFields;
      delete c._dupChecked;
      delete c._dupEdit;
      delete c._lastDraftId;
      delete c._retried;
      c.summaryMsgId = null;
      c.step = 'review';

      c.photos = [];
      const os = require('os');
      const fs = require('fs');
      const status = await bot.sendMessage(chatId, `🔁 Re-downloading ${photoRefs.length} photo(s)...`);
      for (const ref of photoRefs) {
        try {
          const filePath = await bot.downloadFile(ref.fileId, os.tmpdir());
          const buffer = fs.readFileSync(filePath);
          try { fs.unlinkSync(filePath); } catch (_) {}
          if (buffer.length) c.photos.push({ base64: buffer.toString('base64'), fileId: ref.fileId, _mid: ref._mid });
        } catch (e) {
          console.error(`[TG] Retry download failed for ${ref.fileId}:`, e.message);
        }
      }
      if (!c.photos.length) {
        await bot.editMessageText(
          '❌ Photos could not be re-downloaded from Telegram (fileIds may have expired). Please resend photos.',
          { chat_id: chatId, message_id: status.message_id }
        ).catch(() => {});
        return;
      }
      await bot.editMessageText(`✅ Restored ${c.photos.length} photo(s). Review and tap POST.`, {
        chat_id: chatId, message_id: status.message_id
      }).catch(() => {});
      saveChatState(chatId);
      return showSummary(chatId);
    }

    // ── POST ──
    // Ordering guarantee: dup prompt runs BEFORE any Vinted network call, on new listings and retries alike.
    if (data === 'post') {
      // Admin-only duplicate check: ask if this listing exists on another account.
      // If yes, photos are rewritten via sharp to defeat Vinted's perceptual hash.
      if (isAdminAccount(c) && !c._dupChecked) {
        c.step = 'confirm_dup';
        saveChatState(chatId);
        return bot.sendMessage(chatId,
          '🔍 Is this listing already posted on another account?\n\n' +
          'If yes, I will re-edit all photos (rotate/crop/colour tweaks) before posting, so Vinted won\'t flag them as duplicates.',
          { reply_markup: { inline_keyboard: [
            [{ text: '✅ Yes — edit photos first', callback_data: 'dup:yes' }],
            [{ text: '❌ No — post as-is', callback_data: 'dup:no' }]
          ]}}
        );
      }
      return createListing(chatId);
    }

    // ── Duplicate prompt response (admin-only) ──
    if (data === 'dup:yes') {
      c._dupChecked = true;
      c._dupEdit = true;
      c.step = 'review';
      saveChatState(chatId);
      return createListing(chatId);
    }
    if (data === 'dup:no') {
      c._dupChecked = true;
      c._dupEdit = false;
      c.step = 'review';
      saveChatState(chatId);
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
      const newTitle = msg.text.slice(0, 60);
      c.listing.title = newTitle;
      clearErrorField(c, 'title');
      const syncMsg = await bot.sendMessage(chatId, '🔄 Updating description to match...');
      try {
        const synced = await aiSyncCompanion('title', newTitle, 'description', c.listing.description || '', c.listing);
        if (synced && synced.length > 10) {
          c.pendingSyncDesc = synced;
          c.step = 'confirm_desc_sync';
          saveChatState(chatId);
          bot.deleteMessage(chatId, syncMsg.message_id).catch(() => {});
          return bot.sendMessage(chatId,
            `📝 Updated description:\n\n${synced}\n\nUse this update?`,
            { reply_markup: { inline_keyboard: [
              [{ text: '✅ Accept', callback_data: 'sync:accept' }, { text: '❌ Keep old', callback_data: 'sync:reject' }]
            ]}}
          );
        }
      } catch (e) { console.log('[TG] sync desc failed:', e.message); }
      bot.deleteMessage(chatId, syncMsg.message_id).catch(() => {});
      c.step = 'review';
      c.summaryMsgId = null;
      return showSummary(chatId);
    }

    if (c.step === 'editing_desc') {
      c.listing.description = msg.text;
      clearErrorField(c, 'description');
      const syncMsg = await bot.sendMessage(chatId, '🔄 Updating title to match...');
      try {
        const synced = await aiSyncCompanion('description', msg.text, 'title', c.listing.title || '', c.listing);
        if (synced && synced.length > 3) {
          c.pendingSyncTitle = synced.slice(0, 60);
          c.step = 'confirm_title_sync';
          saveChatState(chatId);
          bot.deleteMessage(chatId, syncMsg.message_id).catch(() => {});
          return bot.sendMessage(chatId,
            `📝 Updated title:\n\n"${c.pendingSyncTitle}"\n\nUse this update?`,
            { reply_markup: { inline_keyboard: [
              [{ text: '✅ Accept', callback_data: 'sync:accept' }, { text: '❌ Keep old', callback_data: 'sync:reject' }]
            ]}}
          );
        }
      } catch (e) { console.log('[TG] sync title failed:', e.message); }
      bot.deleteMessage(chatId, syncMsg.message_id).catch(() => {});
      c.step = 'review';
      c.summaryMsgId = null;
      return showSummary(chatId);
    }

    if (c.step === 'editing_price') {
      const price = parseFloat(msg.text.replace(/[^0-9.]/g, ''));
      if (isNaN(price) || price <= 0) return bot.sendMessage(chatId, 'Enter a valid price (e.g. 25 or 14.50):');
      c.listing.price = Math.round(price * 100) / 100;
      clearErrorField(c, 'price');
      c.step = 'review';
      return showSummary(chatId);
    }

    if (c.step === 'editing_isbn') {
      const raw = msg.text.trim();
      if (/^(none|skip|no)$/i.test(raw)) {
        c.listing.isbn = null;
        clearErrorField(c, 'isbn');
        c.step = 'review';
        await bot.sendMessage(chatId, 'OK, ISBN cleared. If the category is Books you may still need to fix that.');
        return showSummary(chatId);
      }
      const digits = raw.replace(/[^0-9Xx]/g, '');
      if (digits.length !== 10 && digits.length !== 13) {
        return bot.sendMessage(chatId, 'ISBN must be 10 or 13 digits (dashes OK). Try again, or type "none" to clear:');
      }
      c.listing.isbn = digits;
      clearErrorField(c, 'isbn');
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

    if (c.step === 'wiz_custom_parcel' || c.step === 'custom_parcel') {
      const parts = msg.text.trim().split(/[\s,x×]+/).map(Number).filter(n => !isNaN(n) && n > 0);
      if (!parts.length) return bot.sendMessage(chatId, 'Enter at least a weight in kg (e.g. "2") or full dimensions "2 30 20 15"');
      c.listing.custom_parcel = {
        weight: parts[0],
        length: parts[1] || null,
        width: parts[2] || null,
        height: parts[3] || null,
      };
      // Pick the closest standard package size by weight
      const w = parts[0];
      let bestPkg = null;
      if (w <= 2) bestPkg = 1;       // Small
      else if (w <= 5) bestPkg = 2;   // Medium
      else bestPkg = 3;               // Large
      c.listing.package_size_id = bestPkg;
      const pkg = PACKAGE_SIZES.find(p => p.id === bestPkg);
      c.listing.package_size_name = pkg ? `${pkg.title} (custom: ${w}kg)` : `Custom: ${w}kg`;
      const dimStr = parts.length >= 4 ? ` ${parts[1]}×${parts[2]}×${parts[3]}cm` : '';
      bot.sendMessage(chatId, `📦 Custom parcel: ${w}kg${dimStr} → mapped to "${pkg?.title || 'Size ' + bestPkg}"`);
      if (c.step === 'wiz_custom_parcel') return wizardNext(chatId);
      c.step = 'review';
      return showSummary(chatId);
    }

    // ── Catch-all: guide the user on what to do next ──
    if (c.step === 'idle') {
      ensureMulti(c);
      if (!activeAccount(c)) {
        return bot.sendMessage(chatId,
          'To get started:\n' +
          '1. Install RelistPro Chrome extension\n' +
          '2. Register an account in the extension\n' +
          '3. Log into vinted.co.uk → click extension → Sync\n' +
          '4. Come back here → /login with your username & password\n\n' +
          'Once logged in, send photos of an item to create a listing.');
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

    if (c.step === 'collecting_proof_photos') {
      return bot.sendMessage(chatId, '📸 Send authenticity proof photos, then tap Done.');
    }
  });

  // ──────────────────────────────────────────
  // CATEGORY SEARCH (hardcoded + AI fallback)
  // ──────────────────────────────────────────

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

  // Use AI to pick the best category from our list
  async function aiPickCategory(itemDescription) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return [];
    try {
      const cats = getCategories();
      // Cap at 400 to keep prompt small; prefer live catalog when present
      const catList = cats.slice(0, 400).map(c => `${c.id}: ${c.path || c.title}`).join('\n');
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
          system: `You are a Vinted category matcher. Given an item description, pick the 3 best matching categories from the list below. Return ONLY a JSON array of category IDs (numbers).\n\nCategories:\n${catList}`,
          messages: [{ role: 'user', content: `Item: ${itemDescription}` }]
        })
      });
      const data = await resp.json();
      const text = data.content?.[0]?.text?.trim() || '';
      const arr = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] || '[]');
      const ids = arr.filter(id => typeof id === 'number');
      const allCats = getCategories();
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
      matches = await aiPickCategory(itemDesc);
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
      // Look for it in groups, or use well-known Vinted "One size" ID
      const oneSize = groups.find(g => /one\s*size/i.test(g.title || ''));
      if (oneSize) {
        c.listing.size_id = oneSize.id;
        c.listing.size_name = oneSize.title;
      } else {
        c.listing.size_id = null;
        c.listing.size_name = 'N/A';
      }
      console.log(`[TG] No sizes for catalog_id=${c.listing.catalog_id}, defaulting to: ${c.listing.size_name} (id=${c.listing.size_id})`);
      if (c.step.startsWith('wiz_')) return wizardNext(chatId);
      return bot.sendMessage(chatId, `No sizes for this category — using "${c.listing.size_name}".`);
    }

    // Cache for title lookup when user selects
    c.sizeCache = allSizes;
    c.sizeCacheGroups = groups;

    // Try to auto-match AI-detected size — but only if confidence is not low
    const hint = (c.listing.size_hint || '').trim().toUpperCase();
    const sizeConfLow = c.listing.aiConfidence?.size === 'low';
    let autoMatched = null;
    if (hint && !sizeConfLow) {
      // Try exact match first, then partial
      autoMatched = allSizes.find(s => s.title.toUpperCase() === hint);
      if (!autoMatched) autoMatched = allSizes.find(s => s.title.toUpperCase().includes(hint));
      if (!autoMatched) autoMatched = allSizes.find(s => hint.includes(s.title.toUpperCase()) && s.title.length > 1);
      if (autoMatched) {
        console.log(`[TG] Auto-matched size: "${hint}" → "${autoMatched.title}" (id=${autoMatched.id})`);
      }
    }

    // Show as rows of 4
    const rows = [];
    for (let i = 0; i < Math.min(allSizes.length, 32); i += 4) {
      rows.push(allSizes.slice(i, i + 4).map(s => ({
        text: s.title + (autoMatched && s.id === autoMatched.id ? ' ✓' : ''),
        callback_data: `size:${s.id}`
      })));
    }
    // If AI detected a size, show accept button
    if (autoMatched) {
      rows.unshift([{ text: `✅ Use detected: ${autoMatched.title}`, callback_data: `size:${autoMatched.id}` }]);
    }
    rows.push([{ text: '⏭️ Skip (use "One size" if available)', callback_data: 'size:0' }]);

    const sizeWarn = sizeConfLow ? ' ⚠️ (low confidence — verify)' : '';
    const sizeInfo = hint ? `\nAI detected: ${c.listing.size_hint}${sizeWarn}` : '';
    const header = c.step.startsWith('wiz_') ? `📏 Step 5/9 — Size${sizeInfo}\n\nSelect size:` : `Select size:${sizeInfo}`;
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
      // User skipped — try to fall back to "One size" if available for this catalog
      const oneSizeGroup = (c.sizeCacheGroups || []).find(g => /one\s*size/i.test(g.title || ''));
      const oneSizeFlat = (c.sizeCache || []).find(s => /one\s*size/i.test(s.title || ''));
      const oneSize = oneSizeGroup || oneSizeFlat;
      if (oneSize) {
        c.listing.size_id = oneSize.id;
        c.listing.size_name = oneSize.title;
        console.log(`[TG] User skipped size — defaulted to "${oneSize.title}" (id=${oneSize.id})`);
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
    if (c.step.startsWith('wiz_')) return wizardNext(chatId);
    c.step = 'review';
    return showSummary(chatId);
  }

  // ──────────────────────────────────────────
  // PACKAGE SIZE PICKER
  // ──────────────────────────────────────────

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
    // Allow entering custom dimensions if Vinted needs them
    rows.push([{ text: '📐 Enter custom dimensions', callback_data: 'pkg:custom' }]);
    rows.push([{ text: '⏭️ Skip', callback_data: 'pkg:0' }]);

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
      const pkg = (c.packageSizeCache || PACKAGE_SIZES).find(p => p.id === pkgId);
      c.listing.package_size_id = pkgId;
      c.listing.package_size_name = pkg ? pkg.title : `ID: ${pkgId}`;
    }
    clearErrorField(c, 'parcel');
    if (c.step.startsWith('wiz_')) return wizardNext(chatId);
    c.step = 'review';
    return showSummary(chatId);
  }

  // ──────────────────────────────────────────
  // BRAND SEARCH
  // ──────────────────────────────────────────

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

    if (!brands.length) {
      // Persist the queried brand as plain text so it still appears in the listing
      if (c.listing) {
        c.listing.brand = normalizeText(query, 'title');
        c.listing.brand_id = null;
        saveChatState(chatId);
      }
      const displayBrand = (c.listing?.brand || query);
      return bot.sendMessage(chatId,
        `🏷️ Brand "${query}" not found in Vinted's database.\n\nYour listing will be posted with "${displayBrand}" as text (no brand tag). You can search again with a different spelling.`,
        { reply_markup: { inline_keyboard: [
          [{ text: '✅ Continue without tag', callback_data: 'brand:0:' + displayBrand.slice(0, 30) }],
          [{ text: '🔍 Search again', callback_data: 'brand:search' }]
        ]}}
      );
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
      return bot.sendMessage(chatId, '⚠️ No Vinted session found.\n\nTo fix:\n1. Open vinted.co.uk in Chrome\n2. Click RelistPro extension → Sync\n3. Come back here and tap POST again');
    }

    // Refresh CSRF (read-only), then probe cookies and rotate tokens if 401.
    try {
      session = await refreshVintedSession(session, acct.userId);
      console.log('[TG] CSRF re-derived before posting');
    } catch (e) {
      console.log('[TG] Pre-post CSRF re-derive failed:', e.message);
    }
    try {
      session = await ensureFreshSession(session, acct.userId);
    } catch (e) {
      if (e.message === 'SESSION_EXPIRED') {
        c.step = 'review';
        saveChatState(chatId);
        const acctName = activeAccount(c)?.vintedName || activeAccount(c)?.username || 'your account';
        return bot.sendMessage(chatId,
          `⚠️ Vinted session expired for ${acctName} and auto-refresh failed.\n\n` +
          `To fix this:\n` +
          `1. Open vinted.co.uk in Chrome and log in again\n` +
          `2. Click RelistPro extension → Sync\n` +
          `3. Come back here and tap POST again`
        );
      }
      console.log('[TG] ensureFreshSession non-auth error:', e.message);
    }

    console.log(`[TG] Posting for ${acct.username}, domain=${session.domain}, csrf=${session.csrf?.slice(0,12)}..., cookies=${session.cookies?.length} chars`);

    try {
      // ── Step 0: Mandatory photo re-editing when user tapped "edit duplicates" ──
      // Fail LOUD — never silently upload originals when the user asked for edits.
      if (c._dupEdit) {
        if (!sharp) {
          c.step = 'review';
          saveChatState(chatId);
          return bot.sendMessage(chatId,
            '❌ Photo re-editing is unavailable on this server (sharp module missing). ' +
            'Cannot safely post duplicates. Tell the operator to check Railway logs for "sharp".'
          );
        }
        await bot.editMessageText(`🎨 Re-editing ${c.photos.length} photo(s) to avoid duplicate detection...`, {
          chat_id: chatId, message_id: statusMsg.message_id
        }).catch(() => {});
        const editedPhotos = [];
        for (let i = 0; i < c.photos.length; i++) {
          try {
            const edited = await processPhotoForReupload(c.photos[i].base64);
            editedPhotos.push({ ...c.photos[i], base64: edited });
            console.log(`[TG] Photo ${i + 1}/${c.photos.length} re-edited OK`);
          } catch (e) {
            console.error(`[TG] Photo ${i + 1} re-edit failed:`, e.message);
            c.step = 'review';
            saveChatState(chatId);
            return bot.sendMessage(chatId,
              `❌ Photo ${i + 1} re-edit failed: ${e.message}\n\n` +
              `I stopped the post instead of silently uploading the original — that would have flagged as duplicate. ` +
              `Try re-sending the photos, or post with "No — as-is" if you're sure this item isn't duplicated.`
            );
          }
        }
        c.photos = editedPhotos;
        c._dupEdit = false;
        await bot.editMessageText(`Uploading ${c.photos.length} photo(s) to Vinted...`, {
          chat_id: chatId, message_id: statusMsg.message_id
        }).catch(() => {});
      }

      // ── Step 1: Upload photos ──
      // Sort by Telegram message_id to restore user's selection order
      // (media-group downloads race, so the push order isn't reliable).
      // Drop any slots where the download failed (base64 still null).
      c.photos = c.photos
        .filter(p => p && p.base64)
        .sort((a, b) => (a._mid || 0) - (b._mid || 0));
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
      console.log(`[TG] Draft values: catalog_id=${L.catalog_id}, status_id=${L.status_id}, color1_id=${L.color1_id}, package_size_id=${L.package_size_id}, brand_id=${L.brand_id}, size_id=${L.size_id}, price=${L.price}`);
      const uuid = crypto.randomBytes(16).toString('hex');
      const draft = {
        id: null,
        currency: 'GBP',
        temp_uuid: uuid,
        title: titleWithSize(L),
        description: normalizeText(L.description, 'sentence'),
        brand_id: L.brand_id || null,
        brand: L.brand ? normalizeText(L.brand, 'title') : null,
        size_id: L.size_id || null,
        catalog_id: L.catalog_id,
        status_id: L.status_id,
        price: L.price,
        package_size_id: L.package_size_id || null,
        color_ids: L.color1_id ? [L.color1_id] : [],
        assigned_photos: photoIds,
        is_unisex: null,
        isbn: L.isbn || null,
        video_game_rating_id: null,
        shipment_prices: { domestic: null, international: null },
        measurement_length: null,
        measurement_width: null,
        item_attributes: [],
        manufacturer: null,
      };

      // Include custom parcel dimensions if user entered them
      const parcel = L.custom_parcel ? {
        weight: L.custom_parcel.weight || null,
        length: L.custom_parcel.length || null,
        width: L.custom_parcel.width || null,
        height: L.custom_parcel.height || null,
      } : null;

      const createResp = await vintedFetch(session, '/api/v2/item_upload/drafts', {
        method: 'POST',
        body: { draft, feedback_id: null, parcel, upload_session_id: uuid }
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
          const serverPhotos = (refreshed.photos || []).map(p => ({ id: p.id, orientation: p.orientation || 0 }));
          // Reorder server photos to match our original upload order
          const uploadOrderIds = photoIds.map(p => p.id);
          const byId = new Map(serverPhotos.map(p => [p.id, p]));
          const reordered = uploadOrderIds.filter(id => byId.has(id)).map(id => byId.get(id));
          for (const p of serverPhotos) if (!uploadOrderIds.includes(p.id)) reordered.push(p);
          const finalPhotos = reordered.length ? reordered : photoIds;
          completionDraft = buildCompletionDraft(refreshed, finalPhotos);
          // Re-apply user's chosen values — server refresh can override them with defaults
          completionDraft.title = titleWithSize(L);
          completionDraft.description = normalizeText(L.description, 'sentence');
          completionDraft.catalog_id = L.catalog_id || refreshed.catalog_id || null;
          completionDraft.status_id = L.status_id || refreshed.status_id || null;
          completionDraft.price = L.price;
          completionDraft.package_size_id = L.package_size_id || refreshed.package_size_id || null;
          completionDraft.color_ids = L.color1_id
            ? [L.color1_id, L.color2_id].filter(Boolean)
            : [refreshed.color1_id, refreshed.color2_id].filter(Boolean);
          completionDraft.brand_id = L.brand_id || refreshed.brand_id || null;
          completionDraft.brand = L.brand ? normalizeText(L.brand, 'title') : (refreshed.brand || null);
          completionDraft.size_id = L.size_id || refreshed.size_id || null;
          if (L.isbn) completionDraft.isbn = L.isbn;
        }
      }
      completionDraft.id = draftId; // String, matching DOTB

      console.log(`[TG] Completion payload: id=${completionDraft.id}, catalog_id=${completionDraft.catalog_id}, color_ids=${JSON.stringify(completionDraft.color_ids)}, photos=${completionDraft.assigned_photos?.length}, temp_uuid=${completionDraft.temp_uuid?.slice(0,8)}...`);

      const completeResp = await vintedFetch(session, `/api/v2/item_upload/drafts/${draftId}/completion`, {
        method: 'POST',
        body: { draft: completionDraft, feedback_id: null, parcel: parcel || null, push_up: false, upload_session_id: completionDraft.temp_uuid }
      });

      if (!completeResp.ok) {
        const errBody = await completeResp.json().catch(() => ({}));
        const errors = errBody.errors || errBody.message_errors || {};
        const errorLines = [];
        const errorFields = new Set();

        const addError = (field, msg) => {
          errorLines.push(`• ${field}: ${msg}`);
          const f = String(field).toLowerCase();
          if (/color|colour/.test(f)) errorFields.add('color');
          else if (/catalog|category/.test(f)) errorFields.add('category');
          else if (/\bsize\b/.test(f)) errorFields.add('size');
          else if (/brand/.test(f)) errorFields.add('brand');
          else if (/price/.test(f)) errorFields.add('price');
          else if (/title/.test(f)) errorFields.add('title');
          else if (/description/.test(f)) errorFields.add('description');
          else if (/package|parcel|shipping/.test(f)) errorFields.add('parcel');
          else if (/status|condition/.test(f)) errorFields.add('condition');
          else if (/photo/.test(f)) errorFields.add('photos');
          else if (/isbn/.test(f)) errorFields.add('isbn');
        };

        if (Array.isArray(errors)) {
          errors.forEach(e => addError(e.field || 'unknown', e.message || e.value || 'invalid'));
        } else {
          Object.entries(errors).forEach(([k, v]) => {
            const msg = Array.isArray(v) ? v.join(', ') : (typeof v === 'object' ? JSON.stringify(v) : v);
            addError(k, msg);
          });
        }

        console.error(`[TG] Publish failed for draft ${draftId}:`, errorLines.join('; ') || completeResp.status);

        // PRESERVE state — let user fix and retry from bot
        c.listing._failedDraftId = draftId;
        c.listing._errorFields = Array.from(errorFields);
        // Walkthrough mode: showSummary will route the user into each broken
        // field's edit step one at a time, then return to the review panel
        // with POST TO VINTED once everything is cleared.
        c.listing._errorWalkthrough = errorFields.size > 0;
        c.step = 'review';
        c.summaryMsgId = null;
        saveChatState(chatId);
        await saveFailedListing(chatId, errorLines.join('; '));

        await bot.editMessageText(
          `❌ Publishing failed. Let's fix these:\n\n${errorLines.join('\n') || 'Unknown error'}\n\nI'll walk you through each one.`,
          { chat_id: chatId, message_id: statusMsg.message_id }
        ).catch(() => {});

        return showSummary(chatId);
      }

      // ── Success! ──
      const itemUrl = `https://${domain}/items/${draftId}`;

      await bot.editMessageText(
        `*Item listed successfully\\!* 🎉\n\n` +
        `*${esc(L.title)}* — £${L.price}\n\n` +
        `[View on Vinted](${esc(itemUrl)})`,
        { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'MarkdownV2' }
      );

      // Check-listing reminder
      bot.sendMessage(chatId,
        `✅ Please open your listing on Vinted and check that photos, description, price and details look right!\n\n${itemUrl}`,
        { disable_web_page_preview: true }
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
      delete c._retried;
      delete c._dupChecked;
      delete c._dupEdit;
      saveChatState(chatId);

    } catch (e) {
      console.error('[TG] Listing error:', e.message);

      // Vinted session expired — try auto-refresh, then guide user
      if (e.message === 'SESSION_EXPIRED') {
        // Try rotating tokens via the real refresh endpoint (once).
        let refreshed = false;
        try {
          if (session) {
            session = await performVintedRefresh(session, acct.userId);
            const testResp = await vintedFetch(session, '/api/v2/users/' + (session.memberId || 'self'));
            if (testResp.ok) {
              refreshed = true;
              console.log('[TG] Auto-refresh after SESSION_EXPIRED succeeded');
            }
          }
        } catch (re) {
          console.error('[TG] performVintedRefresh after SESSION_EXPIRED failed:', re.message);
        }

        if (refreshed && !c._retried) {
          // Retry posting with refreshed session (once only)
          c._retried = true;
          bot.sendMessage(chatId, '🔄 Session refreshed automatically. Retrying...');
          return createListing(chatId);
        }
        delete c._retried;

        c.photos = [];
        c.step = 'review';
        saveChatState(chatId);
        const acctName = activeAccount(c)?.vintedName || activeAccount(c)?.username || 'your account';
        return bot.sendMessage(chatId,
          `⚠️ Vinted session expired for ${acctName}.\n\n` +
          `To fix this:\n` +
          `1. Open vinted.co.uk in Chrome\n` +
          `2. Click RelistPro extension → Sync\n` +
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

  // Normalize text for Vinted — sentence/title case, no ALL CAPS
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

  // Fuzzy color matching against COLORS + COLOR_ALIASES
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

  // Returns true if a category ID represents clothing (not shoes/bags/accessories)
  function isClothingCategory(catalogId) {
    if (!catalogId) return false;
    if (CLOTHING_CATEGORY_IDS.has(catalogId)) return true;
    if (_liveCatalogCache) {
      const entry = _liveCatalogCache.find(c => c.id === catalogId);
      if (entry) {
        const path = (entry.path || '').toLowerCase();
        const isWMK = /^(women|men|kids)\b/.test(path);
        const isNonClothing = /(shoes|bags|jewellery|accessories|beauty|grooming|toys|pushchairs|nursing|bathing|sleep)/.test(path);
        return isWMK && !isNonClothing;
      }
    }
    return false;
  }

  // Build title for posting — append size for clothing, normalize case
  function titleWithSize(L) {
    let t = normalizeText(L.title, 'sentence');
    const sz = L.size_name;
    const hasValidSize = sz && sz !== 'N/A' && sz !== 'Not set' && sz !== '';
    if (hasValidSize && isClothingCategory(L.catalog_id)) {
      const sizeInTitle = new RegExp(`\\b(size\\s+)?${sz.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (!sizeInTitle.test(t)) {
        const suffix = ` - Size ${sz}`;
        if ((t + suffix).length <= 80) t += suffix;
        else t = t.slice(0, 80 - suffix.length).trim() + suffix;
      }
    }
    return t;
  }

  // Clear a field from the _errorFields list (after user edits it)
  function clearErrorField(c, field) {
    if (c.listing?._errorFields) {
      c.listing._errorFields = c.listing._errorFields.filter(f => f !== field);
    }
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
    if (!_catalogFetchPromise) {
      _catalogFetchPromise = fetchLiveCatalog(session).finally(() => { _catalogFetchPromise = null; });
    }
    return _catalogFetchPromise;
  }

  // AI sync companion: when title edited, update description (and vice versa)
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

  function esc(text) {
    if (!text) return '';
    return String(text).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
  }

  // True if the active Vinted account is on the admin allow-list.
  function isAdminAccount(c) {
    const acct = activeAccount(c);
    if (!acct) return false;
    const names = [acct.vintedName, acct.username].filter(Boolean).map(s => String(s).toLowerCase());
    return names.some(n => ADMIN_VINTED_USERNAMES.includes(n));
  }

  // Port of chrome-extension/src/photo-engine.js to sharp.
  // Applies geometric (rotate/skew/crop) + colour edits to break Vinted's
  // perceptual hash, then re-encodes as JPEG. Input & output are base64 strings.
  async function processPhotoForReupload(base64) {
    if (!sharp) throw new Error('sharp module not loaded on this server');
    const rand = (a, b) => Math.random() * (b - a) + a;
    const ri = (a, b) => Math.floor(rand(a, b + 1));
    try {
      const buf = Buffer.from(base64, 'base64');
      let img = sharp(buf, { failOn: 'none' });
      const meta = await img.metadata();
      let w = meta.width || 1000;
      let h = meta.height || 1000;

      // 1. Rotation (0.8–2.8 degrees, random direction)
      const deg = rand(0.8, 2.8) * (Math.random() > 0.5 ? 1 : -1);
      img = img.rotate(deg, { background: { r: 0, g: 0, b: 0, alpha: 0 } });

      // Let sharp compute new dims after rotation
      let rotated = await img.png().toBuffer({ resolveWithObject: true });
      w = rotated.info.width;
      h = rotated.info.height;
      img = sharp(rotated.data);

      // 2. Skew (affine) — small both axes
      const skx = rand(-0.025, 0.025);
      const sky = rand(-0.025, 0.025);
      img = img.affine([[1, skx], [sky, 1]], { background: { r: 0, g: 0, b: 0, alpha: 0 } });

      let affined = await img.png().toBuffer({ resolveWithObject: true });
      w = affined.info.width;
      h = affined.info.height;
      img = sharp(affined.data);

      // 3. Crop (2–9% off each side)
      const cropT = Math.floor(h * rand(0.04, 0.09));
      const cropB = Math.floor(h * rand(0.04, 0.09));
      const cropL = Math.floor(w * rand(0.04, 0.09));
      const cropR = Math.floor(w * rand(0.04, 0.09));
      const newW = Math.max(1, w - cropL - cropR);
      const newH = Math.max(1, h - cropT - cropB);
      img = img.extract({ left: cropL, top: cropT, width: newW, height: newH });

      // 4. Colour edits — pick 4–6 random from the pool (matches PhotoEngine chain count)
      const brightness = 1 + rand(-0.10, 0.10);  // ±10%
      const saturation = rand(0.90, 1.10);       // ±10%
      const hue = ri(-8, 8);                     // small hue drift (proxy for temp)
      img = img.modulate({ brightness, saturation, hue });

      // Gamma 0.92–1.08 — sharp gamma accepts 1.0–3.0, so map to allowed range
      const gamma = rand(1.00, 1.20);
      img = img.gamma(gamma);

      // Light sharpen
      img = img.sharpen({ sigma: 0.5 + rand(0, 0.5) });

      // 5. Re-encode JPEG at 0.92 quality (matches PhotoEngine)
      const out = await img.jpeg({ quality: 92, mozjpeg: true }).toBuffer();
      return out.toString('base64');
    } catch (e) {
      console.error('[TG] processPhotoForReupload error:', e.message);
      throw new Error(`photo re-edit failed: ${e.message}`);
    }
  }

  console.log('[TG] All handlers registered');
  return bot;
};
