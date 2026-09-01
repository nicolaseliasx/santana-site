import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const readJson = async (file) => JSON.parse(await readFile(join(root, file), 'utf8'));
const products = await readJson('src/data/catalog.generated.json');
const dataset = await readJson('reports/import-sheets.dataset.json');
const categoryFiles = (await readdir(join(root, 'src/content/categories'))).filter((file) => file.endsWith('.md')).sort();
const productFiles = (await readdir(join(root, 'src/content/products'))).filter((file) => file.endsWith('.md')).sort();
const errors = [];
const slugs = new Set(); const ids = new Set(); const legacyIds = new Set(); const categoryCounts = {};
const expectedSlugs = new Set(dataset.map((product) => product.slug));
const expectedCategories = [...new Set(dataset.map((product) => product.categorySlug))].sort().map((slug) => `${slug}.md`);
const expectedPrice = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

for (const product of products) {
  if (!product.slug || slugs.has(product.slug)) errors.push(`duplicate/missing slug: ${product.slug}`); slugs.add(product.slug);
  if (!product.id || ids.has(product.id)) errors.push(`duplicate/missing id: ${product.id}`); ids.add(product.id);
  if (!Number.isInteger(product.legacyId) || legacyIds.has(product.legacyId)) errors.push(`duplicate/missing legacyId: ${product.legacyId}`); legacyIds.add(product.legacyId);
  if (!product.name || /^(produto|equipamento)\s+\d+$/i.test(product.name)) errors.push(`invented name: ${product.slug}`);
  if (!Number.isFinite(product.price) || product.price <= 0) errors.push(`invalid price: ${product.slug}`);
  if (product.priceFormatted !== expectedPrice(product.price)) errors.push(`invalid formatted price: ${product.slug}`);
  if (!product.code || !Array.isArray(product.categorySlugs) || product.categorySlugs.length !== 1) errors.push(`missing imported fields: ${product.slug}`);
  if (!Array.isArray(product.sourceTrace) || product.sourceTrace.length === 0 || !product.sourceTrace.some((trace) => /[^:]+:\d+/.test(trace.identifier || ''))) errors.push(`missing source file/line trace: ${product.slug}`);
  if (!Array.isArray(product.features) || !Array.isArray(product.specifications) || !Array.isArray(product.images)) errors.push(`malformed fields: ${product.slug}`);
  for (const category of product.categorySlugs || []) categoryCounts[category] = (categoryCounts[category] || 0) + 1;
}
const contentSlugs = new Set(productFiles.map((file) => file.slice(0, -3)));
for (const slug of expectedSlugs) if (!contentSlugs.has(slug)) errors.push(`missing product content: ${slug}`);
for (const slug of contentSlugs) if (!expectedSlugs.has(slug)) errors.push(`stale product content: ${slug}`);
if (JSON.stringify(categoryFiles) !== JSON.stringify(expectedCategories)) errors.push('category content files do not match imported categories');

const report = { sourceCount: dataset.length, generatedCount: products.length, categoryCounts, categoryFileCount: categoryFiles.length, productFileCount: productFiles.length, categorylessCount: products.filter((product) => !product.categorySlugs?.length).length, uncategorizedCount: products.filter((product) => product.categorySlugs?.includes('uncategorized')).length, errors };
console.log(JSON.stringify(report, null, 2));
if (products.length !== 221 || productFiles.length !== 221 || report.categorylessCount || report.uncategorizedCount || errors.length) process.exit(1);
