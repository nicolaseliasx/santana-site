#!/usr/bin/env node
/** Generate the site catalogue from the audited MAR/2026 import manifests. */
import { readFile, readdir, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const readJson = async (path) => JSON.parse(await readFile(join(root, path), 'utf8'));
const dataset = await readJson('reports/import-sheets.dataset.json');
const imageManifest = await readJson('reports/import-images.json');
const oldCatalog = await readJson('reports/import-sheets.old-catalog.json');

if (dataset.length !== 221) throw new Error(`Expected 221 imported products, got ${dataset.length}`);
if (!Array.isArray(imageManifest) || imageManifest.length !== dataset.length) throw new Error('Image manifest does not match the imported dataset');

const normalize = (value) => String(value ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const categoryNames = new Map([
  ['funcional-e-crosfit', 'Funcional e Crosfit'],
  ['suportes-e-bancos', 'Suportes e Bancos'],
  ['barras-e-acessorios', 'Barras e Acessórios'],
  ['linha-tubolar-4pl-power-line', 'Tubolar 4PL Power Line'],
  ['linha-articulada-convergente', 'Articulada Convergente'],
]);
const sourceTraceFor = (record) => {
  const traces = [{
    kind: 'derived',
    identifier: `${record.sourceFile}:${record.rowNumber}`,
    field: 'name/code/price/category',
  }];
  if (record.mergedFrom) traces.push({
    kind: 'derived',
    identifier: `${record.mergedFrom.file}:${record.mergedFrom.rowNumber}`,
    field: 'deduplicated merge',
  });
  if (record.image) traces.push({
    kind: 'derived',
    identifier: `${record.image.container}#${record.image.entry}`,
    field: 'image',
  });
  return traces;
};

const newNameMap = new Map();
for (const record of dataset) {
  const key = normalize(record.name);
  newNameMap.set(key, [...(newNameMap.get(key) || []), record]);
}
const oldMatches = (oldProduct) => {
  const matches = newNameMap.get(normalize(oldProduct.name)) || [];
  return matches.length === 1 ? matches[0] : null;
};

const products = dataset.map((record, index) => {
  const importedImage = imageManifest[index];
  if (importedImage.slug !== record.slug) throw new Error(`Image manifest order mismatch at ${record.slug}`);
  const images = importedImage.status === 'ok' && importedImage.image ? [importedImage.image] : [];
  return {
    id: record.id,
    legacyId: record.legacyId,
    slug: record.slug,
    name: record.name,
    code: record.code,
    price: record.price,
    priceFormatted: record.priceFormatted,
    categorySlugs: [record.categorySlug],
    summary: `Equipamento ${record.name} da linha ${record.line}.`,
    features: [],
    specifications: [],
    images,
    legacyUrls: oldMatches({ name: record.name })?.legacyUrls || [],
    sourceTrace: sourceTraceFor(record),
    featured: Boolean(images.length && index < 8),
  };
});

const categoryRecords = [...new Set(dataset.map((record) => record.categorySlug))].map((slug, index) => ({
  id: String(index + 1),
  slug,
  name: categoryNames.get(slug) || slug,
  legacyUrls: [`/gallery_entries/${slug}/`],
  productCount: products.filter((product) => product.categorySlugs.includes(slug)).length,
  sourceTrace: [{ kind: 'derived', identifier: `reports/import-sheets.dataset.json:${slug}`, field: 'name/productCount' }],
}));

const productDir = join(root, 'src/content/products');
const categoryDir = join(root, 'src/content/categories');
await mkdir(productDir, { recursive: true });
await mkdir(categoryDir, { recursive: true });
for (const file of await readdir(productDir)) if (file.endsWith('.md')) await rm(join(productDir, file));
for (const file of await readdir(categoryDir)) if (file.endsWith('.md')) await rm(join(categoryDir, file));
const frontmatter = (record) => `---\n${JSON.stringify(record, null, 2)}\n---\n`;
for (const product of products) await writeFile(join(productDir, `${product.slug}.md`), frontmatter(product));
for (const category of categoryRecords) await writeFile(join(categoryDir, `${category.slug}.md`), frontmatter(category));
await writeFile(join(root, 'src/data/catalog.generated.json'), `${JSON.stringify(products, null, 2)}\n`);

const referencedOriginals = new Set(products.flatMap((product) => product.images).map((image) => image.localOriginal.replace(/^\/products\//, '')));
const referencedVariants = new Set(products.flatMap((product) => product.images).flatMap((image) => [...(image.variants?.avif || []), ...(image.variants?.webp || [])]).map((variant) => variant.src.replace(/^\/products\//, '')));
for (const entry of await readdir(join(root, 'public/products'), { withFileTypes: true })) {
  if (entry.isFile() && !referencedOriginals.has(entry.name)) await rm(join(root, 'public/products', entry.name));
}
for (const entry of await readdir(join(root, 'public/products/variants'), { withFileTypes: true }).catch(() => [])) {
  if (entry.isFile() && !referencedVariants.has(`variants/${entry.name}`)) await rm(join(root, 'public/products/variants', entry.name));
}
await rm(join(root, 'public/products/cutouts'), { recursive: true, force: true });

const groupForCategory = new Map([
  ['funcional-e-crosfit', 'funcional-e-crossfit'],
  ['suportes-e-bancos', 'bancos-e-suportes'],
  ['barras-e-acessorios', 'barras-halteres-e-anilhas'],
  ['linha-tubolar-4pl-power-line', 'musculacao'],
  ['linha-articulada-convergente', 'musculacao'],
]);
const redirectLines = [];
const addedSources = new Set();
const addRedirect = (from, to, status) => {
  if (addedSources.has(from)) return;
  addedSources.add(from);
  redirectLines.push(`${from} ${to} ${status}`);
};
for (const oldProduct of oldCatalog) {
  const target = oldMatches(oldProduct);
  const paths = new Set([
    ...(oldProduct.legacyUrls || []),
    `/dt_galleries/${oldProduct.slug}/`,
    `/produtos/${oldProduct.slug}/`,
  ]);
  for (const path of paths) {
    const destination = target ? `/produtos/${target.slug}/` : '/removed/';
    if (path === destination) continue;
    addRedirect(path, destination, target ? 301 : 410);
  }
}
for (const category of categoryRecords) {
  const target = groupForCategory.get(category.slug);
  addRedirect(category.legacyUrls[0], target ? `/categorias/${target}/` : '/removed/', target ? 301 : 410);
}
addRedirect('/blog/*', '/removed/', 410);
addRedirect('/playlist-fitness/*', '/removed/', 410);
addRedirect('/galeria/*', '/removed/', 410);
addRedirect('/agradecimento/*', '/removed/', 410);
await writeFile(join(root, 'public/_redirects'), `${redirectLines.join('\n')}\n`);

const spotChecks = [...new Set(dataset.map((record) => record.lineKey))].flatMap((lineKey) =>
  dataset.filter((record) => record.lineKey === lineKey).slice(0, 2).map((record) => {
    const product = products.find((candidate) => candidate.slug === record.slug);
    const hasImage = Boolean(product?.images.length);
    return {
      lineKey,
      sourceFile: record.sourceFile,
      rowNumber: record.rowNumber,
      slug: record.slug,
      expected: { code: record.code, name: record.name, price: record.price, hasImage: Boolean(record.image) },
      generated: { code: product?.code, name: product?.name, price: product?.price, hasImage },
      matches: Boolean(product && product.code === record.code && product.name === record.name && product.price === record.price && hasImage === Boolean(record.image)),
    };
  }),
);
if (spotChecks.length !== 10 || spotChecks.some((check) => !check.matches)) throw new Error('Import spot-check failed');
await writeFile(join(root, 'reports/import-validation.json'), JSON.stringify({ generatedAt: new Date().toISOString(), checks: spotChecks }, null, 2));
console.log(`Generated ${products.length} products, ${categoryRecords.length} categories and ${redirectLines.length} redirects.`);
