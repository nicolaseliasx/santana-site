import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd(); const products = JSON.parse(await readFile(join(root, 'src/data/catalog.generated.json'), 'utf8')); const categoryFiles = (await readdir(join(root, 'src/content/categories'))).filter((file) => file.endsWith('.md')); const errors = [];
const slugs = new Set(); const ids = new Set(); const categoryCounts = {};
for (const product of products) {
  if (!product.slug || slugs.has(product.slug)) errors.push(`duplicate/missing slug: ${product.slug}`); slugs.add(product.slug);
  if (!Number.isInteger(product.legacyId) || ids.has(product.legacyId)) errors.push(`duplicate/missing legacyId: ${product.legacyId}`); ids.add(product.legacyId);
  if (!product.name || /^(produto|equipamento)\s+\d+$/i.test(product.name)) errors.push(`invented name: ${product.slug}`);
  if (product.code && /^SF-\d{3}$/i.test(product.code) && !product.sourceTrace?.some((trace) => trace.field?.includes('code'))) errors.push(`invented code: ${product.slug}`);
  if (/consulte nossa equipe|informações verificadas|equipamento santana fitness:/i.test(`${product.summary || ''} ${product.description || ''}`)) errors.push(`generic filler: ${product.slug}`);
  if (!Array.isArray(product.sourceTrace) || product.sourceTrace.length === 0) errors.push(`missing source trace: ${product.slug}`);
  if (!Array.isArray(product.features) || !Array.isArray(product.specifications) || !Array.isArray(product.images)) errors.push(`malformed fields: ${product.slug}`);
  for (const category of product.categorySlugs || []) categoryCounts[category] = (categoryCounts[category] || 0) + 1;
  for (const image of product.images || []) if (!image.originalSrc && image.localOriginal) errors.push(`image provenance missing: ${product.slug}`);
}
const report = { sourceCount: 363, generatedCount: products.length, categoryCounts, categorylessCount: products.filter((product) => !product.categorySlugs?.length).length, uncategorizedCount: products.filter((product) => product.categorySlugs?.includes('uncategorized')).length, staleContentFiles: categoryFiles.length === 0 ? ['categories'] : [], errors };
console.log(JSON.stringify(report, null, 2));
if (products.length < 363 || report.uncategorizedCount > 0 || errors.length || report.staleContentFiles.length) process.exit(1);
