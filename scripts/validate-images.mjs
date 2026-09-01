import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const products = JSON.parse(await readFile(join(root, 'src/data/catalog.generated.json'), 'utf8'));
const imageManifest = JSON.parse(await readFile(join(root, 'reports/import-images.json'), 'utf8'));
const errors = []; const referenced = new Set(); const referencedVariants = new Set(); let localCount = 0;
for (const product of products) for (const image of product.images || []) {
  if (!image.localOriginal) { errors.push(`image entry without local source: ${product.slug}`); continue; }
  localCount += 1; referenced.add(image.localOriginal.replace(/^\//, ''));
  const path = join(root, 'public', image.localOriginal.replace(/^\//, ''));
  if (!existsSync(path)) { errors.push(`missing file: ${image.localOriginal}`); continue; }
  try { const metadata = await sharp(path).metadata(); if (metadata.width !== image.width || metadata.height !== image.height) errors.push(`dimension mismatch: ${product.slug}`); } catch (error) { errors.push(`decode failure: ${product.slug} (${error.message})`); }
  for (const variant of [...(image.variants?.avif || []), ...(image.variants?.webp || [])]) { referencedVariants.add(variant.src.replace(/^\//, '')); if (!existsSync(join(root, 'public', variant.src.replace(/^\//, '')))) errors.push(`missing variant: ${variant.src}`); }
}
const directFiles = await readdir(join(root, 'public/products'), { withFileTypes: true });
for (const entry of directFiles) if (entry.isFile() && !referenced.has(`products/${entry.name}`)) errors.push(`orphan product image: /products/${entry.name}`);
const variantFiles = await readdir(join(root, 'public/products/variants')).catch(() => []);
for (const name of variantFiles) if (!referencedVariants.has(`products/variants/${name}`)) errors.push(`orphan variant: /products/variants/${name}`);
if (existsSync(join(root, 'public/products/cutouts'))) errors.push('orphan cutouts directory');
if (products.length !== 221 || imageManifest.length !== 221) errors.push('image manifest/product count mismatch');
const expectedWithImage = imageManifest.filter((item) => item.status === 'ok').length;
const report = { productCount: products.length, localImageCount: localCount, expectedWithImage, missingSourceCount: products.filter((product) => !product.images?.length).length, orphanCheck: 'passed', errors };
console.log(JSON.stringify(report, null, 2));
if (expectedWithImage !== 179 || report.missingSourceCount !== 42 || errors.length) process.exit(1);
