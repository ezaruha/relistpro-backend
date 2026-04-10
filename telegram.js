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
    await tableReady; // ensure table exists before writing
    try {
      const accts = JSON.stringify(c.accounts || []);
      // Save only fileIds for photos (not base64 — too large for JSONB, causes save to fail)
      const photoRefs = c.photos?.length
        ? JSON.stringify(c.photos.map(p => ({ fileId: p.fileId })))
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
              c.photos.push({ base64: buffer.toString('base64'), fileId: ref.fileId });
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
      console.log(`[TG] Downloading photo file_id=${photo.file_id}`);
      // Use bot.downloadFile which uses the library's built-in HTTP client
      // (fetch() fails on Railway for Telegram file URLs)
      const os = require('os');
      const fs = require('fs');
      const filePath = await bot.downloadFile(photo.file_id, os.tmpdir());
      const buffer = fs.readFileSync(filePath);
      try { fs.unlinkSync(filePath); } catch (_) {}
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
    if (!L) {
      c.step = 'idle';
      return bot.sendMessage(chatId, 'Listing data lost. Send photos to start a new listing.');
    }
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
COLOR: One of: Black,White,Grey,Blue,Red,Green,Yellow,Pink,Orange,Purple,Brown,Beige,Cream,Multicolour,Khaki,Turquoise,Silver,Gold,Navy,Burgundy,Coral,Light blue.`;

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
      if (col) { c.listing.color1_id = col.id; c.listing.color = col.label; console.log(`[TG] Color selected: ${col.label} (id=${col.id})`); }
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

  // Use AI to pick the best category from our list
  async function aiPickCategory(itemDescription) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return [];
    try {
      const catList = CATEGORIES.map(c => `${c.id}: ${c.title}`).join('\n');
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
      return ids.map(id => CATEGORIES.find(c => c.id === id)).filter(Boolean);
    } catch (e) {
      console.error('[TG] AI category pick error:', e.message);
      return [];
    }
  }

  async function searchCategories(chatId, query) {
    const c = getChat(chatId);
    const inWiz = c.step.startsWith('wiz_');
    const header = inWiz ? '📂 Step 4/9 — Category\n\n' : '';

    // 1. Search hardcoded categories by keyword
    let matches = searchCategoriesByKeyword(query);
    console.log(`[TG] Category search "${query}": ${matches.length} keyword matches`);

    // 2. Try individual words from the query
    if (!matches.length && query.includes(' ')) {
      const words = query.split(/\s+/).filter(w => w.length >= 3);
      for (const word of words) {
        matches = searchCategoriesByKeyword(word);
        if (matches.length) { console.log(`[TG] Found via word "${word}"`); break; }
      }
    }

    // 3. Try each part of category_hint
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
    const match = CATEGORIES.find(x => x.id === catId);
    c.listing.catalog_id = catId;
    c.listing.category_name = match ? match.title : `ID: ${catId}`;
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
      console.log(`[TG] Draft values: catalog_id=${L.catalog_id}, status_id=${L.status_id}, color1_id=${L.color1_id}, package_size_id=${L.package_size_id}, brand_id=${L.brand_id}, size_id=${L.size_id}, price=${L.price}`);
      const uuid = crypto.randomBytes(16).toString('hex');
      const draft = {
        id: null,
        currency: 'GBP',
        temp_uuid: uuid,
        title: normalizeTitle(L.title),
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
          // Use server's canonical photo list for completion (matches DOTB)
          const refreshedPhotos = (refreshed.photos || []).map(p => ({ id: p.id, orientation: p.orientation || 0 }));
          completionDraft = buildCompletionDraft(refreshed, refreshedPhotos.length ? refreshedPhotos : photoIds);
          // Re-apply user's chosen values — server refresh can override them with defaults
          completionDraft.title = normalizeTitle(L.title);
          completionDraft.description = L.description;
          completionDraft.catalog_id = L.catalog_id || refreshed.catalog_id || null;
          completionDraft.status_id = L.status_id || refreshed.status_id || null;
          completionDraft.price = L.price;
          completionDraft.package_size_id = L.package_size_id || refreshed.package_size_id || null;
          completionDraft.color_ids = L.color1_id
            ? [L.color1_id, L.color2_id].filter(Boolean)
            : [refreshed.color1_id, refreshed.color2_id].filter(Boolean);
          completionDraft.brand_id = L.brand_id || refreshed.brand_id || null;
          completionDraft.brand = L.brand || refreshed.brand || null;
          completionDraft.size_id = L.size_id || refreshed.size_id || null;
        }
      }
      completionDraft.id = draftId; // String, matching DOTB

      console.log(`[TG] Completion payload: id=${completionDraft.id}, catalog_id=${completionDraft.catalog_id}, color_ids=${JSON.stringify(completionDraft.color_ids)}, photos=${completionDraft.assigned_photos?.length}, temp_uuid=${completionDraft.temp_uuid?.slice(0,8)}...`);

      const completeResp = await vintedFetch(session, `/api/v2/item_upload/drafts/${draftId}/completion`, {
        method: 'POST',
        body: { draft: completionDraft, feedback_id: null, parcel: null, push_up: false, upload_session_id: completionDraft.temp_uuid }
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

  // Normalize title for Vinted — sentence case, no ALL CAPS
  function normalizeTitle(title) {
    if (!title) return '';
    const t = String(title);
    // If more than half the letters are uppercase, convert to sentence case
    const letters = t.replace(/[^a-zA-Z]/g, '');
    const upperCount = (t.match(/[A-Z]/g) || []).length;
    if (letters.length > 3 && upperCount > letters.length * 0.5) {
      return t.toLowerCase().replace(/(^|\.\s+|!\s+|\?\s+)([a-z])/g, (_, pre, c) => pre + c.toUpperCase());
    }
    return t;
  }

  function esc(text) {
    if (!text) return '';
    return String(text).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
  }

  console.log('[TG] All handlers registered');
  return bot;
};
