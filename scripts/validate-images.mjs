import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const root = process.cwd(); const products = JSON.parse(await readFile(join(root, 'src/data/catalog.generated.json'), 'utf8')); const errors = []; let localCount = 0;
for (const product of products) for (const image of product.images || []) {
  if (!image.localOriginal) { if (image.originalSrc) errors.push(`missing local image: ${product.slug}`); continue; }
  localCount += 1; const path = join(root, 'public', image.localOriginal.replace(/^\//, ''));
  if (!existsSync(path)) { errors.push(`missing file: ${image.localOriginal}`); continue; }
  try { const metadata = await sharp(path).metadata(); if (metadata.width !== image.width || metadata.height !== image.height) errors.push(`dimension mismatch: ${product.slug}`); } catch (error) { errors.push(`decode failure: ${product.slug} (${error.message})`); }
  for (const variant of [...(image.variants?.avif || []), ...(image.variants?.webp || [])]) if (!existsSync(join(root, 'public', variant.src.replace(/^\//, '')))) errors.push(`missing variant: ${variant.src}`);
  if (image.cutout) { const cutoutPath = join(root, 'public', image.cutout.src.replace(/^\//, '')); if (!existsSync(cutoutPath)) errors.push(`missing cutout: ${image.cutout.src}`); else try { const metadata = await sharp(cutoutPath).metadata(); if (!metadata.hasAlpha) errors.push(`cutout missing alpha: ${product.slug}`); if (metadata.width !== image.width || metadata.height !== image.height) errors.push(`cutout dimension mismatch: ${product.slug}`); } catch (error) { errors.push(`cutout decode failure: ${product.slug} (${error.message})`); } for (const variant of [...(image.cutout.variants?.avif || []), ...(image.cutout.variants?.webp || [])]) if (!existsSync(join(root, 'public', variant.src.replace(/^\//, '')))) errors.push(`missing cutout variant: ${variant.src}`); }
}
const report = { productCount: products.length, localImageCount: localCount, missingSourceCount: products.flatMap((product) => product.images || []).filter((image) => !image.localOriginal).length, errors };
console.log(JSON.stringify(report, null, 2)); if (errors.length) process.exit(1);
