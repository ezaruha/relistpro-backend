let sharp = null;
try {
  sharp = require('sharp');
  console.log('[TG] sharp loaded OK — photo re-editing enabled');
} catch (e) {
  console.error('[TG] CRITICAL: sharp not available — photo re-editing disabled:', e.message);
}

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

    const deg = rand(0.8, 2.8) * (Math.random() > 0.5 ? 1 : -1);
    img = img.rotate(deg, { background: { r: 0, g: 0, b: 0, alpha: 0 } });

    let rotated = await img.png().toBuffer({ resolveWithObject: true });
    w = rotated.info.width;
    h = rotated.info.height;
    img = sharp(rotated.data);

    const skx = rand(-0.025, 0.025);
    const sky = rand(-0.025, 0.025);
    img = img.affine([[1, skx], [sky, 1]], { background: { r: 0, g: 0, b: 0, alpha: 0 } });

    let affined = await img.png().toBuffer({ resolveWithObject: true });
    w = affined.info.width;
    h = affined.info.height;
    img = sharp(affined.data);

    const cropT = Math.floor(h * rand(0.04, 0.09));
    const cropB = Math.floor(h * rand(0.04, 0.09));
    const cropL = Math.floor(w * rand(0.04, 0.09));
    const cropR = Math.floor(w * rand(0.04, 0.09));
    const newW = Math.max(1, w - cropL - cropR);
    const newH = Math.max(1, h - cropT - cropB);
    img = img.extract({ left: cropL, top: cropT, width: newW, height: newH });

    const brightness = 1 + rand(-0.10, 0.10);
    const saturation = rand(0.90, 1.10);
    const hue = ri(-8, 8);
    img = img.modulate({ brightness, saturation, hue });

    const gamma = rand(1.00, 1.20);
    img = img.gamma(gamma);

    img = img.sharpen({ sigma: 0.5 + rand(0, 0.5) });

    const out = await img.jpeg({ quality: 92, mozjpeg: true }).toBuffer();
    return out.toString('base64');
  } catch (e) {
    console.error('[TG] processPhotoForReupload error:', e.message);
    throw new Error(`photo re-edit failed: ${e.message}`);
  }
}

function hasSharp() { return !!sharp; }

module.exports = { processPhotoForReupload, hasSharp };
