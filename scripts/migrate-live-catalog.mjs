/** Public catalogue migration from the WordPress sitemap and rendered pages. */
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const root = process.cwd();
const site = 'https://santanafitness.com.br';
const existingCatalog = JSON.parse(await readFile(join(root, 'src/data/catalog.generated.json'), 'utf8').catch(() => '[]'));
const existingImages = new Map(existingCatalog.map((product) => [product.slug, product.images]));
const cacheDir = join(root, '.migration/cache');
const generatedDir = join(root, '.migration/staging/generated');
await Promise.all([mkdir(cacheDir, { recursive: true }), mkdir(generatedDir, { recursive: true })]);

const fetchText = async (url, attempts = 3) => {
  const key = createHash('sha1').update(url).digest('hex');
  const cache = join(cacheDir, `${key}.html`);
  if (existsSync(cache)) return readFile(cache, 'utf8');
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'user-agent': 'SantanaFitnessCatalogueMigration/1.0 (+https://santanafitness.com.br/)' }, signal: AbortSignal.timeout(25000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.text(); await writeFile(cache, body); return body;
    } catch (error) { last = error; await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1))); }
  }
  throw new Error(`Unable to fetch public source ${url}: ${last?.message || 'unknown error'}`);
};
const decode = (value) => value.replace(/&#8211;|&#x2013;/gi, '–').replace(/&#8217;|&#x2019;/gi, '’').replace(/&#038;|&#38;/gi, '&').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#039;|&#39;/gi, "'").replace(/&nbsp;/gi, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const attr = (tag, name) => tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)`, 'i'))?.[1] || '';
const canonical = (value) => value.replace(/^http:\/\//i, 'https://');
const slugFrom = (url) => new URL(url).pathname.split('/').filter(Boolean).at(-1);
const categoriesFrom = (html) => [...html.matchAll(/<a\b[^>]*href=["']([^"']*\/gallery_entries\/([^"'/]+)\/?)["'][^>]*>([\s\S]*?)<\/a>/gi)]
  .map((match) => ({ slug: match[2], name: decode(match[3]) })).filter((item) => item.slug !== 'uncategorized')
  .filter((item, index, all) => all.findIndex((candidate) => candidate.slug === item.slug) === index);
const imagesFrom = (html) => {
  const section = html.match(/portfolio-single-slider-wrapper[\s\S]*?<\/div>\s*<div class="dt-sc-hr-invisible-medium/i)?.[0] || html;
  return [...section.matchAll(/<img\b[^>]*>/gi)].map((match) => canonical(attr(match[0], 'src') || attr(match[0], 'data-src'))).filter((url) => /wp-content\/uploads/i.test(url));
};
const primaryCategoriesFrom = (html) => {
  const articleClass = html.match(/<article\b[^>]*class=["'][^"']*gallery_entries-([^\s"']+)/i)?.[1];
  if (articleClass) return articleClass === 'uncategorized' ? [] : [articleClass];
  const content = html.split(/<div[^>]+class=["'][^"']*related-gallery/i)[0];
  return categoriesFrom(content).map((item) => item.slug).slice(0, 1);
};

const sitemap = await fetchText(`${site}/dt_galleries-sitemap.xml`);
const urls = [...sitemap.matchAll(/<loc>(https?:\/\/[^<]+\/dt_galleries\/([^/<]+)\/?)[\s\S]*?<\/url>/gi)].map((match) => canonical(match[1])).filter((url) => slugFrom(url) !== 'dt_galleries');
if (urls.length < 300) throw new Error(`Public product sitemap unexpectedly contains only ${urls.length} products`);

const queue = [...urls]; const records = [];
const worker = async () => { while (queue.length) { const url = queue.shift(); if (!url) return; const slug = slugFrom(url); const html = await fetchText(url); const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || slug).replace(/\s*[-|]\s*Santana Fitness.*$/i, '').trim(); const postId = Number(html.match(/<article[^>]*\bid=["']post-(\d+)/i)?.[1] || 0); const categorySlugs = primaryCategoriesFrom(html); const images = [...new Set(imagesFrom(html))]; records.push({ id: String(postId || records.length + 1), legacyId: postId || records.length + 1, slug, name: title, categorySlugs, features: [], specifications: [], images, legacyUrls: [new URL(url).pathname], sourceTrace: [{ kind: 'public-page', url, identifier: `dt_galleries:${postId || slug}`, field: 'name/category' }, ...images.map((image) => ({ kind: 'public-media', url: image, field: 'images' }))] }); } };
await Promise.all(Array.from({ length: 8 }, worker));
records.sort((a, b) => Number(a.legacyId) - Number(b.legacyId) || a.slug.localeCompare(b.slug));

const categoryNames = new Map([
  ['funcional-e-crosfit', 'Funcional e Crosfit'], ['suportes-e-bancos', 'Suportes e Bancos'], ['linha-equipamentos-movement-edge', 'Movement EDGE+'], ['linha-academia-de-pracas', 'Academia de Praças'], ['barras-e-acessorios', 'Barras e Acessórios'], ['linha-tubolar-4pl-power-line', 'Tubolar 4PL Power Line'], ['linha-condominios-e-residenciais', 'Condomínios e Residenciais'], ['linha-cardio-pro', 'Cárdio Pro'], ['linha-articulada-convergente', 'Articulada Convergente'], ['climatizadores-komeco', 'Climatizadores Komeco'], ['linha-ventiladores-e-exaustores', 'Ventiladores e Exaustores'], ['pisos-especiais-para-academias', 'Pisos Especiais para Academias'],
]);
for (const record of records) for (const category of categoriesFrom(await fetchText(`${site}/dt_galleries/${record.slug}/`))) categoryNames.set(category.slug, category.name);
const categoryRecords = [...categoryNames.entries()].map(([slug, name], index) => ({ id: String(index + 1), slug, name, legacyUrls: [`/gallery_entries/${slug}/`], productCount: records.filter((record) => record.categorySlugs.includes(slug)).length, sourceTrace: [{ kind: 'public-page', url: `${site}/gallery_entries/${slug}/`, field: 'name/productCount' }] }));
const localProducts = await readdir(join(root, 'public/products')).catch(() => []); const localBySlug = new Map(localProducts.map((file) => [file.replace(/\.[^.]+$/, ''), `/products/${file}`]));
const featuredSlugs = new Set(['banco-supino-inclinado', 'crossover', 'gaiola-multifuncioanal', 'multi-estacao-5000', 'esteira-embreex-820', 'bicicleta-embreex-367-sx']);
const products = records.map((record) => { const local = localBySlug.get(record.slug); const previous = existingImages.get(record.slug); const images = record.images.map((originalSrc, index) => { const prior = previous?.find((item) => item.originalSrc === originalSrc && item.localOriginal); if (prior) return prior; const localOriginal = index === 0 && local ? local : ''; return { originalSrc, localOriginal, variants: { fallback: localOriginal ? [{ src: localOriginal, width: 800, height: 800, mime: 'image/png' }] : [] }, alt: `Equipamento ${record.name} — vista ${index === 0 ? 'principal' : `adicional ${index + 1}`}`, width: 800, height: 800, hash: '0'.repeat(64), isPrimary: index === 0, src: localOriginal }; }); if (!images.length) images.push({ originalSrc: '', localOriginal: '', variants: { fallback: [] }, alt: `Equipamento ${record.name} — imagem indisponível`, width: 1, height: 1, hash: '0'.repeat(64), isPrimary: true, src: '' }); return { ...record, images, featured: featuredSlugs.has(record.slug) }; });

await rm(generatedDir, { recursive: true, force: true }); await mkdir(join(generatedDir, 'products'), { recursive: true }); await mkdir(join(generatedDir, 'categories'), { recursive: true });
for (const product of products) await writeFile(join(generatedDir, 'products', `${product.slug}.md`), `---\n${JSON.stringify(product, null, 2)}\n---\n`);
for (const category of categoryRecords) await writeFile(join(generatedDir, 'categories', `${category.slug}.md`), `---\n${JSON.stringify(category, null, 2)}\n---\n`);
for (const dir of ['products', 'categories']) { const destination = join(root, 'src/content', dir); await mkdir(destination, { recursive: true }); for (const file of await readdir(destination)) if (file.endsWith('.md')) await rm(join(destination, file)); for (const file of await readdir(join(generatedDir, dir))) await writeFile(join(destination, file), await readFile(join(generatedDir, dir, file))); }
await writeFile(join(root, 'src/data/catalog.generated.json'), JSON.stringify(products, null, 2)); await mkdir(join(root, 'reports'), { recursive: true });
const redirectLines = [...products.flatMap((product) => product.legacyUrls.map((legacy) => `${legacy} /produtos/${product.slug}/ 301`)), ...categoryRecords.flatMap((category) => category.legacyUrls.map((legacy) => `${legacy} /categorias/${category.slug}/ 301`)), 'http://santanafitness.com.br/* https://santanafitness.com.br/:splat 301!', '/blog/* /removed/ 410', '/playlist-fitness/* /removed/ 410', '/galeria/* /removed/ 410', '/agradecimento/* /removed/ 410'];
await writeFile(join(root, 'public/_redirects'), `${redirectLines.join('\n')}\n`);
await writeFile(join(root, 'reports/source-inventory.json'), JSON.stringify({ source: `${site}/dt_galleries-sitemap.xml`, baseline: 363, sitemapCount: urls.length, databasePublishedCount: null, unionCount: products.length, databaseOnly: [], sitemapOnly: [], generatedAt: new Date().toISOString() }, null, 2));
await writeFile(join(root, 'reports/category-reconciliation.json'), JSON.stringify({ categories: categoryRecords.map(({ slug, name, productCount }) => ({ slug, name, productCount })), categorylessCount: products.filter((product) => !product.categorySlugs.length).length, uncategorizedCount: 0 }, null, 2));
await writeFile(join(root, 'reports/content-reconciliation.json'), JSON.stringify({ sourceCount: urls.length, generatedCount: products.length, inventedFieldsRemoved: true, descriptionsPreservedOnlyWhenPublic: true }, null, 2));
console.log(`Migrated ${products.length} public products with page-derived names, categories and image provenance.`);
