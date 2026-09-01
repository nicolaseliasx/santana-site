/*
 * Condense tall product photos by collapsing sparse interior bands where only
 * thin continuous elements (cables, straps) pass through. Dense product rows
 * and purely empty gaps are never cut, so no part is lost or detached.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const root = process.cwd();
const dryRun = process.argv.includes('--dry-run');
const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
const onlySlug = onlyArg ? onlyArg.slice(7) : null;
const minRatio = 2.0;
const keepEdges = 35;
const minRun = 100;
const manifestPath = join(root, 'src/data/catalog.generated.json');
const products = JSON.parse(await readFile(manifestPath, 'utf8'));

const rowProfile = async (filePath) => {
  const { data, info } = await sharp(filePath).raw().toBuffer({ resolveWithObject: true });
  const rows = new Uint32Array(info.height);
  for (let y = 0; y < info.height; y += 1) {
    let count = 0;
    for (let x = 0; x < info.width; x += 1) {
      const i = (y * info.width + x) * info.channels;
      const alpha = info.channels === 4 ? data[i + 3] : 255;
      if (alpha > 30 && !(data[i] > 245 && data[i + 1] > 245 && data[i + 2] > 245)) count += 1;
    }
    rows[y] = count;
  }
  return { rows, width: info.width, height: info.height };
};

const keepRanges = (rows, width) => {
  const sparseMax = Math.max(90, Math.round(0.2 * width));
  const isSparse = (y) => rows[y] >= 8 && rows[y] <= sparseMax;
  const kept = [];
  let cursor = 0;
  let y = 0;
  while (y < rows.length) {
    if (!isSparse(y)) { y += 1; continue; }
    let end = y;
    while (end + 1 < rows.length && isSparse(end + 1)) end += 1;
    const interior = y > 40 && end < rows.length - 41;
    const length = end - y + 1;
    if (interior && length >= minRun) {
      if (y > cursor) kept.push([cursor, y - 1]);
      kept.push([y, y + keepEdges - 1], [end - keepEdges + 1, end]);
      cursor = end + 1;
      y = end + 1;
    } else {
      y += 1;
    }
  }
  if (cursor < rows.length) kept.push([cursor, rows.length - 1]);
  return kept;
};

const stack = async (filePath, ranges) => {
  const parts = [];
  for (const [top, bottom] of ranges) {
    const buffer = await sharp(filePath).extract({ left: 0, top, width: await sharp(filePath).metadata().then((m) => m.width), height: bottom - top + 1 }).png().toBuffer();
    parts.push(buffer);
  }
  const metas = await Promise.all(parts.map((buffer) => sharp(buffer).metadata()));
  const width = metas[0].width;
  const height = metas.reduce((sum, meta) => sum + meta.height, 0);
  let offset = 0;
  const composites = [];
  for (let index = 0; index < parts.length; index += 1) {
    composites.push({ input: parts[index], top: offset, left: 0 });
    offset += metas[index].height;
  }
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(composites).png({ compressionLevel: 9 }).toBuffer();
};

const report = [];
for (const product of products) {
  if (onlySlug && product.slug !== onlySlug) continue;
  const image = product.images?.[0];
  if (!image?.localOriginal) continue;
  const ratio = image.height / image.width;
  if (ratio < minRatio) continue;
  const filePath = join(root, 'public', image.localOriginal.replace(/^\//, ''));
  const { rows, width, height } = await rowProfile(filePath);
  const ranges = keepRanges(rows, width);
  const newHeight = ranges.reduce((sum, [top, bottom]) => sum + bottom - top + 1, 0);
  if (newHeight >= height - 80) {
    report.push({ slug: product.slug, action: 'skip', reason: 'sem vão comprimível', width, height });
    continue;
  }
  if (dryRun) {
    report.push({ slug: product.slug, action: 'would-condense', width, height, newHeight, ratio: (newHeight / width).toFixed(2) });
    continue;
  }
  const buffer = await stack(filePath, ranges);
  await writeFile(filePath, buffer);
  const meta = await sharp(buffer).metadata();
  const bytes = buffer.length;
  const hash = createHash('sha256').update(buffer).digest('hex');
  image.width = meta.width;
  image.height = meta.height;
  image.hash = hash;
  const fallback = image.variants?.fallback?.[0];
  if (fallback) {
    fallback.width = meta.width;
    fallback.height = meta.height;
    fallback.bytes = bytes;
  }
  report.push({ slug: product.slug, action: 'condensed', width: meta.width, height: meta.height, before: `${width}x${height}`, ratio: (meta.height / meta.width).toFixed(2), bytes });
}

if (!dryRun) await writeFile(manifestPath, `${JSON.stringify(products, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
