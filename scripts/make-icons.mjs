import sharp from 'sharp';
import { mkdirSync } from 'fs';

/**
 * Generates extension icons from icons/logo-bird.png (1254x1254 artwork on a
 * black square):
 * - trims the black border, masks corners transparent (rounded square)
 * - 128px: full artwork (store icon)
 * - 48/32/16px: bird-only crop — the "Bol." wordmark is illegible that small
 */

const SOURCE = 'icons/logo-bird.png';

function roundedMask(size, radiusRatio = 0.22) {
  const r = Math.round(size * radiusRatio);
  return Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" fill="#fff"/></svg>`,
  );
}

mkdirSync('public/icons', { recursive: true });

// Trim the black margin around the rounded-square artwork.
const trimmed = await sharp(SOURCE).trim({ threshold: 25 }).toBuffer();
const meta = await sharp(trimmed).metadata();
const side = Math.min(meta.width, meta.height);

// --- 128: full artwork, rounded transparent corners ---
await sharp(trimmed)
  .resize(128, 128, { fit: 'cover' })
  .composite([{ input: roundedMask(128), blend: 'dest-in' }])
  .png()
  .toFile('public/icons/icon128.png');
console.log('icon128.png (full artwork)');

// --- Bird-only crop for small sizes ---
// The bird + branch sit in the upper-center of the artwork; the wordmark is in
// the bottom ~25%. Crop a centered square over the bird.
const crop = {
  left: Math.round(side * 0.16),
  top: Math.round(side * 0.05),
  width: Math.round(side * 0.65),
  height: Math.round(side * 0.65),
};
const bird = await sharp(trimmed).extract(crop).toBuffer();

for (const size of [48, 32, 16]) {
  await sharp(bird)
    .resize(size, size, { fit: 'cover' })
    .composite([{ input: roundedMask(size, 0.24), blend: 'dest-in' }])
    .png()
    .toFile(`public/icons/icon${size}.png`);
  console.log(`icon${size}.png (bird crop)`);
}

// Large preview of the small-icon crop for visual verification (source dir —
// not shipped; public/icons/ gets copied into dist/).
await sharp(bird).resize(256, 256).png().toFile('icons/crop-preview.png');
console.log('icons/crop-preview.png (verification only, not shipped)');
