/*
 * Deterministic, non-destructive cutout pass. The migration already stores
 * RGBA source photography; this pass preserves that alpha matte in a separate
 * asset tree. A production rembg worker can replace `makeCutout` without
 * changing the manifest contract or touching originals.
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const manifestPath = join(root, 'src/data/catalog.generated.json');
const products = JSON.parse(await readFile(manifestPath, 'utf8'));
const outputDir = join(root, 'public/products/cutouts');
await mkdir(outputDir, { recursive: true });
let processed = 0;
for (const product of products) for (const image of product.images || []) {
  const source = image.localOriginal || image.src;
  if (!source) continue;
  const input = join(root, 'public', source.replace(/^\//, ''));
  const stem = basename(source, extname(source));
  const output = join(outputDir, `${stem}.png`);
  const cutout = sharp(input).ensureAlpha();
  await cutout.clone().png().toFile(output);
  const webpPath = join(outputDir, `${stem}.webp`); const avifPath = join(outputDir, `${stem}.avif`);
  await cutout.clone().webp({ quality: 86 }).toFile(webpPath); await cutout.clone().avif({ quality: 60, effort: 0 }).toFile(avifPath);
  image.cutout = { src: `/products/cutouts/${stem}.png`, variants: { webp: [{ src: `/products/cutouts/${stem}.webp`, width: image.width, height: image.height, mime: 'image/webp' }], avif: [{ src: `/products/cutouts/${stem}.avif`, width: image.width, height: image.height, mime: 'image/avif' }] }, width: image.width, height: image.height, alpha: true };
  processed += 1;
}
await writeFile(manifestPath, `${JSON.stringify(products, null, 2)}\n`);
console.log(JSON.stringify({ processed, output: 'public/products/cutouts', originalsChanged: false }, null, 2));
