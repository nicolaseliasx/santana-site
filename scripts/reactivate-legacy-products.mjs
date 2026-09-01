/**
 * Reactivates legacy catalogue products (Cardio Pro + Academia de Praças lines)
 * from reports/import-sheets.old-catalog.json into the live catalogue.
 *
 * - Canonical target: every old-catalog entry in `linha-cardio-pro` or
 *   `linha-academia-de-pracas` that is not part of the original imported set.
 * - Downloads images[0].originalSrc to public/products/<slug>.png (sharp-validated).
 * - Appends the product to src/data/catalog.generated.json and mirrors it in
 *   src/content/products/<slug>.md. Idempotent: re-running replaces by slug and
 *   never touches the original imported products.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const readJson = async (file) => JSON.parse(await readFile(join(root, file), 'utf8'));
const expectedTargets = 28;
const reactivationCategories = ['linha-cardio-pro', 'linha-academia-de-pracas'];

const oldCatalog = await readJson('reports/import-sheets.old-catalog.json');
const generated = await readJson('src/data/catalog.generated.json');

const isReactivated = (product) => Array.isArray(product.sourceTrace) && product.sourceTrace.some((trace) => trace.field === 'reactivation');
const baseSlugs = new Set(generated.filter((product) => !isReactivated(product)).map((product) => product.slug));
const targets = oldCatalog.filter((product) => !baseSlugs.has(product.slug) && Array.isArray(product.categorySlugs) && product.categorySlugs.some((category) => reactivationCategories.includes(category)));
if (targets.length !== expectedTargets) {
  console.error(`Expected ${expectedTargets} legacy targets, found ${targets.length}:`, targets.map((product) => product.slug));
  process.exit(1);
}

const lineName = (product) => (product.categorySlugs.includes('linha-cardio-pro') ? 'Cardio Pro' : 'Academia de Praças');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fetchWithRetry = async (url, attempts = 4) => {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: 'follow' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await wait(500 * attempt ** 2);
    }
  }
  throw lastError;
};

const reactivated = [];
const skipped = [];
let downloadedImages = 0;

for (const legacy of targets) {
  const originalSrc = legacy.images?.[0]?.originalSrc;
  if (!originalSrc || !/^https:\/\//.test(originalSrc)) {
    skipped.push({ slug: legacy.slug, motivo: 'sem imagem original disponível (images[0].originalSrc vazio)' });
    continue;
  }
  try {
    const buffer = await fetchWithRetry(originalSrc);
    const metadata = await sharp(buffer).metadata();
    if (!metadata.width || !metadata.height) throw new Error('imagem sem dimensões decodificáveis');
    const hash = createHash('sha256').update(buffer).digest('hex');
    const local = `/products/${legacy.slug}.png`;
    await writeFile(join(root, 'public', 'products', `${legacy.slug}.png`), buffer);
    downloadedImages += 1;
    const record = {
      id: String(legacy.id),
      legacyId: legacy.legacyId,
      slug: legacy.slug,
      name: legacy.name,
      categorySlugs: legacy.categorySlugs,
      summary: `Equipamento ${legacy.name} da linha ${lineName(legacy)}.`,
      features: [],
      specifications: [],
      images: [{
        originalSrc,
        localOriginal: local,
        variants: { fallback: [{ src: local, width: metadata.width, height: metadata.height, bytes: buffer.length, mime: 'image/png' }] },
        alt: `Equipamento ${legacy.name} — vista principal`,
        width: metadata.width,
        height: metadata.height,
        hash,
        isPrimary: true,
        src: local
      }],
      legacyUrls: legacy.legacyUrls || [],
      sourceTrace: [...(legacy.sourceTrace || []), { kind: 'legacy-page', identifier: `old-catalog.json:${legacy.legacyId}`, field: 'reactivation' }],
      featured: false
    };
    reactivated.push(record);
  } catch (error) {
    skipped.push({ slug: legacy.slug, motivo: `falha ao baixar/decodificar imagem: ${error.message}` });
  }
}

// Replace previously reactivated entries by slug (keeping any older ones that
// are no longer in the target set), then append the new records at the end.
const reactivatedSlugs = new Set(reactivated.map((product) => product.slug));
const merged = [
  ...generated.filter((product) => !isReactivated(product)),
  ...generated.filter((product) => isReactivated(product) && !reactivatedSlugs.has(product.slug)),
  ...reactivated
];
await writeFile(join(root, 'src/data/catalog.generated.json'), `${JSON.stringify(merged, null, 2)}\n`);
for (const record of reactivated) {
  await writeFile(join(root, 'src/content/products', `${record.slug}.md`), `---\n${JSON.stringify(record, null, 2)}\n---\n`);
}

console.log(JSON.stringify({ reativados: reactivated.length, imagensBaixadas: downloadedImages, pulados: skipped }, null, 2));
