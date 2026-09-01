import { readFile } from 'node:fs/promises';
import { zipEntry, cleanText, headerColumns } from './shared.mjs';

const MAX_COLUMNS = 80;

/**
 * Extract cell text from ODS XML markup (handles <text:s/>, <text:s text:c="N"/>
 * and nested draw frames which carry no text).
 */
function cellText(cellMarkup) {
  const paragraphs = cellMarkup.match(/<text:p[\s\S]*?<\/text:p>|<text:p[^>]*\/>/g) || [];
  const text = paragraphs
    .map((paragraph) =>
      paragraph
        .replace(/<text:s text:c="(\d+)"[^>]*\/>/g, (_, count) => ' '.repeat(Number(count)))
        .replace(/<text:s[^>]*\/>/g, ' ')
        .replace(/<text:tab[^>]*\/>/g, ' ')
        .replace(/<[^>]+>/g, ''),
    )
    .join(' ');
  return cleanText(text);
}

function parseCells(rowMarkup) {
  const cells = [];
  const cellRe = /<(table:table-cell|table:covered-table-cell)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/g;
  let match;
  while ((match = cellRe.exec(rowMarkup))) {
    const attributes = match[2];
    const body = match[4] || '';
    const repeat = Number(/table:number-columns-repeated="(\d+)"/.exec(attributes)?.[1] || 1);
    const value = /office:value="([^"]+)"/.exec(attributes);
    const images = [...body.matchAll(/<draw:image[^>]*xlink:href="([^"]+)"/g)].map((entry) => entry[1]);
    const cell = {
      text: cellText(body),
      value: value ? Number(value[1]) : null,
      valueType: /office:value-type="([^"]+)"/.exec(attributes)?.[1] || null,
      images,
      covered: match[1] === 'table:covered-table-cell',
    };
    for (let index = 0; index < repeat && cells.length < MAX_COLUMNS; index += 1) cells.push(cell);
  }
  return cells;
}

/**
 * Parse an ODS spreadsheet into sheet rows with expanded column addressing.
 * Returns rows: [{ table, rowNumber, cells: [{ text, value, images, covered }] }]
 */
export async function parseOds(filePath) {
  const buffer = await readFile(filePath);
  const xml = zipEntry(buffer, 'content.xml').toString('utf8');
  const rows = [];
  const tableRe = /<table:table [^>]*table:name="([^"]+)"[^>]*>([\s\S]*?)<\/table:table>/g;
  let tableMatch;
  while ((tableMatch = tableRe.exec(xml))) {
    const tableName = tableMatch[1];
    const body = tableMatch[2];
    const rowRe = /<table:table-row([^>]*)>([\s\S]*?)<\/table:table-row>/g;
    let rowNumber = 1;
    let rowMatch;
    while ((rowMatch = rowRe.exec(body))) {
      const repeat = Number(/table:number-rows-repeated="(\d+)"/.exec(rowMatch[1])?.[1] || 1);
      const cells = parseCells(rowMatch[2]);
      const hasContent = cells.some((cell) => cell.text || cell.value != null || cell.images.length);
      if (hasContent) rows.push({ table: tableName, rowNumber, cells });
      rowNumber += repeat;
    }
  }
  return rows;
}

/**
 * Turn parsed ODS rows into product records:
 * { rowNumber, code, name, price, imageRef, title }
 */
export function extractOdsProducts(rows) {
  const records = [];
  let columns = null;
  let title = null;
  for (const row of rows) {
    const texts = row.cells.map((cell) => cell.text);
    const header = headerColumns(texts.map((text) => text || ''));
    if (header) {
      columns = header;
      continue;
    }
    if (!columns) {
      const candidate = texts.find((text) => text && /LINHA|TABELA/i.test(text) && text.length <= 60);
      if (candidate && !title) title = candidate;
      continue;
    }
    const codeCell = row.cells[columns.code];
    const nameCell = row.cells[columns.name];
    const priceCell = row.cells[columns.price];
    const name = nameCell?.text || '';
    const price = priceCell?.value ?? null;
    if (!name || price == null || !(price > 0)) continue;
    if (/^OBS\b/i.test(name)) continue;
    const code = codeCell?.text || (codeCell?.value != null ? String(codeCell.value) : '');
    const imageEntry = row.cells.flatMap((cell) => cell.images)[0] || null;
    records.push({
      rowNumber: row.rowNumber,
      code: code.trim(),
      name,
      price,
      imageRef: imageEntry ? { kind: 'ods', entry: imageEntry } : null,
    });
  }
  return { title, records };
}
