import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const lines = (await readFile('public/_redirects', 'utf8')).split('\n').map((line) => line.trim()).filter(Boolean);
const products = JSON.parse(await readFile('src/data/catalog.generated.json', 'utf8'));
const oldProducts = JSON.parse(await readFile('reports/import-sheets.old-catalog.json', 'utf8'));
const errors = []; const sources = new Map();
for (const line of lines) {
  const [from, to, status] = line.split(/\s+/);
  if (!from || !to || !status || !/^\d{3}!?$/.test(status)) errors.push(`invalid redirect: ${line}`);
  if (sources.has(from)) errors.push(`duplicate source: ${from}`);
  sources.set(from, { to, status: Number.parseInt(status, 10) });
  if (from === to) errors.push(`redirect loop: ${line}`);
  if (Number.parseInt(status, 10) === 301 && /^\/produtos\//.test(to) && !existsSync(join('dist', to.replace(/^\//, ''), 'index.html'))) errors.push(`missing built product target: ${to}`);
  if (Number.parseInt(status, 10) === 301 && /^\/categorias\//.test(to) && !existsSync(join('dist', to.replace(/^\//, ''), 'index.html'))) errors.push(`missing built category target: ${to}`);
  if (Number.parseInt(status, 10) === 410 && to === '/removed/' && !existsSync(join('dist', 'removed', 'index.html'))) errors.push('missing built removed target');
}
const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const nameMap = new Map();
for (const product of products) nameMap.set(normalize(product.name), [...(nameMap.get(normalize(product.name)) || []), product]);
let productRules = 0;
for (const oldProduct of oldProducts) {
  const matches = nameMap.get(normalize(oldProduct.name)) || [];
  const target = matches.length === 1 ? matches[0] : null;
  const paths = new Set([...(oldProduct.legacyUrls || []), `/dt_galleries/${oldProduct.slug}/`, `/produtos/${oldProduct.slug}/`]);
  for (const path of paths) {
    if (target && path === `/produtos/${target.slug}/`) continue;
    const rule = sources.get(path); if (!rule) { errors.push(`missing old URL: ${path}`); continue; }
    productRules += 1;
    const expectedStatus = target ? 301 : 410; const expectedTarget = target ? `/produtos/${target.slug}/` : '/removed/';
    if (rule.status !== expectedStatus || rule.to !== expectedTarget) errors.push(`wrong old URL rule: ${path}`);
  }
}
const report = { ruleCount: lines.length, productRules, coveredOldProducts: oldProducts.length, errors };
console.log(JSON.stringify(report, null, 2));
const requiredProductRules = oldProducts.reduce((count, oldProduct) => {
  const matches = nameMap.get(normalize(oldProduct.name)) || [];
  const target = matches.length === 1 ? matches[0] : null;
  return count + 2 - (target && oldProduct.slug === target.slug ? 1 : 0);
}, 0);
if (productRules < requiredProductRules || errors.length) process.exit(1);
