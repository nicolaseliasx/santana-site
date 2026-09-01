#!/usr/bin/env node
/**
 * Fase 2 — imagens do novo catálogo:
 *   1. copia originais de reports/staging-images/ para public/products/<slug>.<ext>
 *   2. gera variantes WebP/AVIF (640/1024/1440, nunca acima do original) — padrão do migrate-images.mjs
 *   3. remove TODOS os arquivos antigos de public/products/ e variants/ não referenciados
 *   4. escreve reports/import-images.json (metadados por produto)
 *   5. gera reports/import-sheets.contact-sheet.html para auditoria visual
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const dataset = JSON.parse(await readFile(join(root, 'reports/import-sheets.dataset.json'), 'utf8'));
const outDir = join(root, 'public/products');
const variantDir = join(outDir, 'variants');
await mkdir(variantDir, { recursive: true });

const keep = new Set();
const manifest = [];
const repairOnly = process.argv.includes('--repair-missing');

// Rebuild only the audited manifest when the imported binaries and variants
// already exist. This keeps catalogue generation fast and deterministic.
if (process.argv.includes('--manifest-only')) {
  for (const product of dataset) {
    if (!product.image) { manifest.push({ slug: product.slug, status: 'missing' }); continue; }
    const ext = product.image.format === 'png' ? 'png' : 'jpg';
    const filename = `${product.slug}.${ext}`;
    const localPath = join(outDir, filename);
    if (!existsSync(localPath)) { manifest.push({ slug: product.slug, status: 'missing' }); continue; }
    const bytes = await readFile(localPath);
    const metadata = await sharp(bytes).metadata();
    const hash = createHash('sha256').update(bytes).digest('hex');
    const image = { originalSrc: `sheet://${product.image.container}#${product.image.entry}`, localOriginal: `/products/${filename}`, variants: { fallback: [{ src: `/products/${filename}`, width: metadata.width, height: metadata.height, bytes: bytes.length, mime: `image/${metadata.format}` }] }, alt: `Equipamento ${product.name} — vista principal`, width: metadata.width, height: metadata.height, hash, isPrimary: true, src: `/products/${filename}` };
    const variantName = new RegExp(`^${product.slug.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}-(\\\\d+)-[a-f0-9]{10}\\\\.(?:webp|avif)$`);
    for (const format of ['webp', 'avif']) {
      const variants = [];
      for (const name of await readdir(variantDir)) {
        if (!name.endsWith(`.${format}`)) continue;
        const match = name.match(variantName);
        if (!match) continue;
        const width = Number(match[1]); const height = Math.round((width * metadata.height) / metadata.width);
        const variantPath = join(variantDir, name); const variantBytes = await readFile(variantPath);
        variants.push({ src: `/products/variants/${name}`, width, height, bytes: variantBytes.length, mime: `image/${format}` });
        keep.add(`variants/${name}`);
      }
      if (variants.length) image.variants[format] = variants.sort((a, b) => a.width - b.width);
    }
    keep.add(filename); manifest.push({ slug: product.slug, status: 'ok', image });
  }
  await writeFile(join(root, 'reports/import-images.json'), JSON.stringify(manifest, null, 2));
  const cards = dataset.map((product) => {
    const img = product.image ? `/products/${product.slug}.${product.image.format === 'png' ? 'png' : 'jpg'}` : null;
    return `<figure class="card${img ? '' : ' empty'}"><img src="${img ?? ''}" loading="lazy" alt=""><figcaption><b>${product.name}</b><span>${product.code ?? ''} · ${product.priceFormatted} · ${product.line}</span><span>${img ? product.image.container.split('.').slice(0, -1).join('.') : 'SEM IMAGEM'}</span></figcaption></figure>`;
  }).join('\n');
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Auditoria — catálogo MAR/2026</title><style>body{font-family:system-ui,sans-serif;margin:1rem;background:#111;color:#eee}h1{font-size:1.2rem}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:.75rem}.card{margin:0;background:#1c1c1c;border-radius:8px;overflow:hidden}.card img{width:100%;height:180px;object-fit:contain;background:#fff}.card.empty img{display:none}.card figcaption{padding:.5rem;display:flex;flex-direction:column;gap:.15rem;font-size:.72rem}.card span{color:#9a9}.card.empty{outline:2px dashed #955}</style></head><body><h1>Auditoria visual — ${dataset.length} produtos (${dataset.filter((p) => p.image).length} com imagem)</h1><div class="grid">${cards}</div></body></html>`;
  await writeFile(join(root, 'reports/import-sheets.contact-sheet.html'), html);
  console.log(`Manifest rebuilt: ${manifest.filter((item) => item.status === 'ok').length} products with image.`);
  process.exit(0);
}

for (const product of dataset) {
  if (repairOnly) {
    const expectedExtension = product.image?.format === 'png' ? 'png' : 'jpg';
    if (!product.image || existsSync(join(outDir, `${product.slug}.${expectedExtension}`))) continue;
  }
  if (!product.image) { manifest.push({ slug: product.slug, status: 'missing' }); continue; }
  const staging = join(root, 'reports/staging-images', product.image.stagingPath);
  if (!existsSync(staging)) { manifest.push({ slug: product.slug, status: 'missing' }); continue; }
  const bytes = await readFile(staging);
  const metadata = await sharp(bytes).metadata();
  const ext = metadata.format === 'png' ? 'png' : 'jpg';
  const filename = `${product.slug}.${ext}`;
  const local = `/products/${filename}`;
  await writeFile(join(outDir, filename), bytes);
  keep.add(filename);
  const hash = createHash('sha256').update(bytes).digest('hex');

  const image = {
    originalSrc: `sheet://${product.image.container}#${product.image.entry}`,
    localOriginal: local,
    variants: {
      fallback: [{ src: local, width: metadata.width, height: metadata.height, bytes: bytes.length, mime: `image/${metadata.format}` }],
    },
    alt: `Equipamento ${product.name} — vista principal`,
    width: metadata.width,
    height: metadata.height,
    hash,
    isPrimary: true,
    src: local,
  };
  for (const width of [640, 1024, 1440].filter((candidate) => candidate < metadata.width)) {
    const stem = `${product.slug}-${width}-${hash.slice(0, 10)}`;
    const [webp, avif] = await Promise.all([
      sharp(bytes).resize({ width, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer(),
      sharp(bytes).resize({ width, withoutEnlargement: true }).avif({ quality: 70 }).toBuffer(),
    ]);
    const webpName = `${stem}.webp`; const avifName = `${stem}.avif`;
    await Promise.all([writeFile(join(variantDir, webpName), webp), writeFile(join(variantDir, avifName), avif)]);
    keep.add(`variants/${webpName}`); keep.add(`variants/${avifName}`);
    const height = Math.round((width * metadata.height) / metadata.width);
    image.variants.webp = [...(image.variants.webp || []), { src: `/products/variants/${webpName}`, width, height, bytes: webp.length, mime: 'image/webp' }];
    image.variants.avif = [...(image.variants.avif || []), { src: `/products/variants/${avifName}`, width, height, bytes: avif.length, mime: 'image/avif' }];
  }
  manifest.push({ slug: product.slug, status: 'ok', image });
}

if (repairOnly) {
  console.log(`Repaired ${manifest.filter((item) => item.status === 'ok').length} missing imported images.`);
  process.exit(0);
}

// limpeza: remove arquivos antigos não referenciados
let removed = 0;
for (const name of await readdir(outDir)) {
  if (name === 'variants') continue;
  if (!keep.has(name)) { await rm(join(outDir, name), { force: true }); removed += 1; }
}
for (const name of await readdir(variantDir)) {
  if (!keep.has(`variants/${name}`)) { await rm(join(variantDir, name), { force: true }); removed += 1; }
}

await writeFile(join(root, 'reports/import-images.json'), JSON.stringify(manifest, null, 2));

// contact sheet para auditoria visual do usuário
const cards = dataset.map((product) => {
  const img = product.image ? `/products/${product.slug}.${product.image.format === 'png' ? 'png' : 'jpg'}` : null;
  return `<figure class="card${img ? '' : ' empty'}"><img src="${img ?? ''}" loading="lazy" alt=""><figcaption><b>${product.name}</b><span>${product.code ?? ''} · ${product.priceFormatted} · ${product.line}</span><span>${img ? product.image.container.split('.').slice(0, -1).join('.') : 'SEM IMAGEM'}</span></figcaption></figure>`;
}).join('\n');
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Auditoria — catálogo MAR/2026</title><style>body{font-family:system-ui,sans-serif;margin:1rem;background:#111;color:#eee}h1{font-size:1.2rem}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:.75rem}.card{margin:0;background:#1c1c1c;border-radius:8px;overflow:hidden}.card img{width:100%;height:180px;object-fit:contain;background:#fff}.card.empty img{display:none}.card figcaption{padding:.5rem;display:flex;flex-direction:column;gap:.15rem;font-size:.72rem}.card span{color:#9a9}.card.empty{outline:2px dashed #955}</style></head><body><h1>Auditoria visual — ${dataset.length} produtos (${dataset.filter((p) => p.image).length} com imagem)</h1><div class="grid">${cards}</div></body></html>`;
await writeFile(join(root, 'reports/import-sheets.contact-sheet.html'), html);

const ok = manifest.filter((m) => m.status === 'ok').length;
console.log(`Imagens: ${ok} produtos com imagem, ${manifest.length - ok} sem. Arquivos antigos removidos: ${removed}.`);
