import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const lines = (await readFile('public/_redirects', 'utf8')).split('\n').map((line) => line.trim()).filter(Boolean); const sources = new Set(); const errors = []; let productRules = 0;
for (const line of lines) { const [from, to] = line.split(/\s+/); if (!from || !to) errors.push(`invalid redirect: ${line}`); if (sources.has(from)) errors.push(`duplicate source: ${from}`); sources.add(from); if (from === to) errors.push(`redirect loop: ${line}`); if (from.startsWith('/dt_galleries/')) { productRules += 1; const target = join('dist', to.replace(/^\//, ''), 'index.html'); if (!existsSync(target)) errors.push(`missing built target: ${to}`); } if (from.startsWith('/gallery_entries/') && !from.includes('*')) { const target = join('dist', to.replace(/^\//, ''), 'index.html'); if (!existsSync(target)) errors.push(`missing built category target: ${to}`); } }
const report = { ruleCount: lines.length, productRules, errors }; console.log(JSON.stringify(report, null, 2)); if (errors.length) process.exit(1);
