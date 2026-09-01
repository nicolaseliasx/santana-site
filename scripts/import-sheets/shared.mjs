import { unzipSync } from 'fflate';

/** Extract one entry (binary) from a zip container (ODS/XLSX). */
export function zipEntry(buffer, name) {
  const files = unzipSync(buffer, { filter: (file) => file.name === name });
  const file = files[name];
  if (!file) throw new Error(`entry not found in container: ${name}`);
  return Buffer.from(file);
}

export function decodeXmlEntities(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

/** Collapse whitespace and trim (sheet cells often carry stray padding). */
export function cleanText(value) {
  return decodeXmlEntities(value).replace(/\s+/g, ' ').trim();
}

/** Dedupe key: no accents, lowercase, collapsed spaces (approved decision 2). */
export function normalizeName(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function slugify(value) {
  return normalizeName(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-') || 'produto';
}

/** Deterministic pt-BR currency formatting ("R$ 14.098,60"). */
export function formatBRL(value) {
  const fixed = (Math.round(value * 100) / 100).toFixed(2).split('.');
  const integer = fixed[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${integer},${fixed[1]}`;
}

export function parsePrice(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value).replace(/[R$\s\u00a0]/gi, '').replace(/\./g, '').replace(',', '.');
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : null;
}

const HEADER_CODE = /^c[oó]d(igo|\.)?$/i;
const HEADER_NAME = /^equipamento(s)?$/i;
const HEADER_UNIT_PRICE = /^valor\s*unit/i;
const HEADER_PRICE = /^valor(es)?$/i;

/**
 * Locate the code/name/price columns from a header row.
 * `texts` is an array of cleaned cell texts indexed by spreadsheet column.
 */
export function headerColumns(texts) {
  let code = -1;
  let name = -1;
  let unitPrice = -1;
  let price = -1;
  texts.forEach((text, index) => {
    const value = normalizeName(text);
    if (HEADER_CODE.test(value)) code = index;
    else if (HEADER_NAME.test(value)) name = index;
    else if (HEADER_UNIT_PRICE.test(value)) unitPrice = index;
    else if (HEADER_PRICE.test(value)) price = index;
  });
  if (code === -1 || name === -1 || (unitPrice === -1 && price === -1)) return null;
  return { code, name, price: unitPrice !== -1 ? unitPrice : price, unitPrice: unitPrice !== -1 };
}
