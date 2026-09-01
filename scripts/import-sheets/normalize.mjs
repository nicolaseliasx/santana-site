import { normalizeName, slugify, formatBRL } from './shared.mjs';

const BAR_FAMILY = /barra(s)? |barra_|halter|dumbell|kett?ebell|anilha|safety bar|peso livre/;

/**
 * Approved decision 2: exact-normalized-name dedupe between TB4PL (newer) and
 * POWER LINE. TB4PL supplies code + price; the image with the larger pixel
 * area wins (ties go to TB4PL).
 */
export function mergeTubolar(tb4pl, powerLine) {
  const powerByName = new Map(powerLine.records.map((record) => [normalizeName(record.name), record]));
  const usedPowerLineRows = new Set();
  const merged = [];
  const merges = [];
  for (const record of tb4pl.records) {
    const key = normalizeName(record.name);
    const candidate = powerByName.get(key);
    if (!candidate) {
      merged.push(record);
      continue;
    }
    usedPowerLineRows.add(candidate);
    const chosenImage = pickLargerImage(record.imageRef, candidate.imageRef);
    merged.push({
      ...record,
      imageRef: chosenImage,
      mergedFrom: [{ file: powerLine.file, rowNumber: candidate.rowNumber, code: candidate.code, price: candidate.price }],
    });
    merges.push({
      key,
      tb4pl: rowSummary(tb4pl.file, record),
      powerLine: rowSummary(powerLine.file, candidate),
      kept: { code: record.code, price: record.price, imageFrom: chosenImage ? chosenImage.source : null },
    });
  }
  const leftovers = powerLine.records.filter((record) => !usedPowerLineRows.has(record));
  return { merged, leftovers, merges };
}

function rowSummary(file, record) {
  return { file, rowNumber: record.rowNumber, code: record.code, name: record.name, price: record.price };
}

function pickLargerImage(primary, secondary) {
  if (!primary) return secondary ? { ...secondary, source: 'powerline' } : null;
  if (!secondary) return { ...primary, source: 'tb4pl' };
  const primaryArea = (primary.width || 0) * (primary.height || 0);
  const secondaryArea = (secondary.width || 0) * (secondary.height || 0);
  return secondaryArea > primaryArea ? { ...secondary, source: 'powerline' } : { ...primary, source: 'tb4pl' };
}

/**
 * Assemble the final ordered dataset: merged tubolar line first, then the
 * remaining POWER LINE rows, articulada, bancos/suportes and acessórios.
 */
export function buildDataset({ tb4pl, powerLine, articulada, bancos, acessorios, oldCatalog }) {
  const { merged, leftovers, merges } = mergeTubolar(tb4pl, powerLine);

  const buckets = [
    { file: tb4pl.file, categorySlug: 'linha-tubolar-4pl-power-line', records: merged },
    { file: powerLine.file, categorySlug: 'linha-tubolar-4pl-power-line', records: leftovers },
    { file: articulada.file, categorySlug: 'linha-articulada-convergente', records: articulada.records },
    { file: bancos.file, categorySlug: 'suportes-e-bancos', records: bancos.records },
    { file: acessorios.file, categorySlug: null, records: acessorios.records, acessorios: true },
  ];

  const oldByNormalizedName = new Map(oldCatalog.map((product) => [normalizeName(product.name), product]));

  const slugSeen = new Map();
  const codeSeen = new Map();
  const duplicateCodes = [];
  const anomalies = [];
  const products = [];

  for (const bucket of buckets) {
    for (const record of bucket.records) {
      const baseSlug = slugify(record.name);
      let slug = baseSlug;
      let suffix = slugSeen.get(baseSlug) || 0;
      if (suffix > 0) slug = `${baseSlug}-${suffix + 1}`;
      slugSeen.set(baseSlug, suffix + 1);

      let categorySlug = bucket.categorySlug;
      if (bucket.acessorios) {
        const text = normalizeName(`${slug} ${record.name}`);
        categorySlug = BAR_FAMILY.test(text) ? 'barras-e-acessorios' : 'funcional-e-crosfit';
      }

      let duplicateCode = false;
      if (record.code) {
        const seenKey = `${bucket.file}::${record.code}`;
        if (codeSeen.has(seenKey)) {
          duplicateCode = true;
          const existing = codeSeen.get(seenKey);
          if (!duplicateCodes.some((entry) => entry.file === bucket.file && entry.code === record.code)) {
            duplicateCodes.push({ file: bucket.file, code: record.code, rows: [existing, record.rowNumber] });
          } else {
            duplicateCodes.find((entry) => entry.file === bucket.file && entry.code === record.code).rows.push(record.rowNumber);
          }
        } else {
          codeSeen.set(seenKey, record.rowNumber);
        }
      }

      if (record.price <= 0) anomalies.push({ type: 'non-positive-price', file: bucket.file, rowNumber: record.rowNumber, name: record.name });

      const oldProduct = oldByNormalizedName.get(normalizeName(record.name));
      const sourceRows = [{ file: bucket.file, rowNumber: record.rowNumber }];
      if (record.mergedFrom) sourceRows.push({ file: record.mergedFrom[0].file, rowNumber: record.mergedFrom[0].rowNumber });

      products.push({
        slug,
        code: record.code || undefined,
        name: record.name,
        price: record.price,
        priceFormatted: formatBRL(record.price),
        categorySlug,
        categorySlugs: [categorySlug],
        legacyUrls: oldProduct ? oldProduct.legacyUrls || [] : [],
        sourceRows,
        mergedFrom: record.mergedFrom,
        duplicateCode,
        matchedOldSlug: oldProduct ? oldProduct.slug : null,
        image: record.imageRef
          ? {
              kind: record.imageRef.kind,
              container: record.imageRef.file,
              entry: record.imageRef.entry,
              cacheFile: record.imageRef.cacheFile || null,
              width: record.imageRef.width || null,
              height: record.imageRef.height || null,
            }
          : null,
      });
    }
  }

  products.forEach((product, index) => {
    product.legacyId = index + 1;
    product.id = String(index + 1);
  });

  const withoutImages = products.filter((product) => !product.image).map((product) => ({ slug: product.slug, name: product.name, file: product.sourceRows[0].file, rowNumber: product.sourceRows[0].rowNumber }));
  const matchedOld = products.filter((product) => product.matchedOldSlug);
  const unmatchedOld = oldCatalog.filter((product) => {
    const normalized = normalizeName(product.name);
    return !products.some((candidate) => normalizeName(candidate.name) === normalized);
  });

  return {
    products,
    report: {
      counts: {
        tb4plRows: tb4pl.records.length,
        powerLineRows: powerLine.records.length,
        articuladaRows: articulada.records.length,
        bancosRows: bancos.records.length,
        acessoriosRows: acessorios.records.length,
        mergedExactNames: merges.length,
        totalRows: tb4pl.records.length + powerLine.records.length + articulada.records.length + bancos.records.length + acessorios.records.length,
        finalProducts: products.length,
        withImages: products.length - withoutImages.length,
        withoutImages: withoutImages.length,
        oldCatalogSize: oldCatalog.length,
        oldSlugsMatched: matchedOld.length,
        oldSlugsGone: unmatchedOld.length,
      },
      merges,
      duplicateCodes,
      withoutImages,
      anomalies,
    },
  };
}
