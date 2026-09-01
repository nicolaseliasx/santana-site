import { readFile } from 'node:fs/promises';
import { zipEntry, cleanText, headerColumns } from './shared.mjs';

function columnToIndex(letters) {
  let index = 0;
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

/** Map drawing anchors (0-based from row) to media targets for one sheet. */
function parseDrawing(drawingXml, relsXml) {
  const rels = new Map(
    [...relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/>/g)].map((match) => [match[1], match[2]]),
  );
  const anchors = [];
  const anchorRe = /<(xdr:twoCellAnchor|xdr:oneCellAnchor|xdr:absoluteAnchor)\b[^>]*>([\s\S]*?)<\/\1>/g;
  let match;
  while ((match = anchorRe.exec(drawingXml))) {
    const body = match[2];
    const row = /<xdr:from>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/.exec(body)?.[1];
    const col = /<xdr:from>[\s\S]*?<xdr:col>(\d+)<\/xdr:col>/.exec(body)?.[1];
    const embed = /<a:blip[^>]*r:embed="([^"]+)"/.exec(body)?.[1];
    if (row == null || col == null || !embed) continue;
    const target = rels.get(embed);
    if (!target) continue;
    anchors.push({ row: Number(row), col: Number(col), entry: target.replace('../', 'xl/') });
  }
  return anchors;
}

/**
 * Parse an XLSX workbook (first sheet with a product header) into product
 * records with row-anchored images.
 */
export async function parseXlsx(filePath) {
  const buffer = await readFile(filePath);
  const sharedXml = zipEntry(buffer, 'xl/sharedStrings.xml').toString('utf8');
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) =>
    cleanText(match[1].replace(/<[^>]+>/g, '')),
  );

  const workbookXml = zipEntry(buffer, 'xl/workbook.xml').toString('utf8');
  const sheetNames = [...workbookXml.matchAll(/<sheet[^>]*\/>/g)].map((sheet) => ({
    id: /r:id="([^"]+)"/.exec(sheet[0])?.[1],
  }));
  const workbookRels = zipEntry(buffer, 'xl/_rels/workbook.xml.rels').toString('utf8');
  const relTargets = new Map(
    [...workbookRels.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/>/g)].map((match) => [
      match[1],
      match[2].replace(/^worksheets\//, 'xl/worksheets/'),
    ]),
  );

  const sheets = sheetNames.map((sheet) => relTargets.get(sheet.id)).filter((target) => target && !target.includes('theme'));
  const records = [];
  let title = null;

  for (const sheetPath of sheets) {
    const sheetXml = zipEntry(buffer, sheetPath).toString('utf8');
    const relPath = sheetPath.replace('xl/worksheets/', 'xl/worksheets/_rels/') + '.rels';
    let anchors = [];
    try {
      const sheetRels = zipEntry(buffer, relPath).toString('utf8');
      const drawingTarget = /Type="[^"]*\/drawing"[^>]*Target="([^"]+)"/.exec(sheetRels)?.[1];
      if (drawingTarget) {
        const drawingPath = drawingTarget.replace('../', 'xl/').replace(/^\/?xl\//, 'xl/');
        const normalized = drawingPath.startsWith('xl') ? drawingPath : `xl/${drawingTarget.replace('../', '')}`;
        const drawingXml = zipEntry(buffer, normalized).toString('utf8');
        const drawingRelPath = normalized.replace('xl/drawings/', 'xl/drawings/_rels/') + '.rels';
        const drawingRels = zipEntry(buffer, drawingRelPath).toString('utf8');
        anchors = parseDrawing(drawingXml, drawingRels);
      }
    } catch {
      anchors = [];
    }

    const rows = [];
    const rowRe = /<row[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
    let rowMatch;
    while ((rowMatch = rowRe.exec(sheetXml))) {
      const rowNumber = Number(rowMatch[1]);
      const cells = {};
      const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      let cellMatch;
      while ((cellMatch = cellRe.exec(rowMatch[2]))) {
        const attributes = cellMatch[1];
        const body = cellMatch[2] || '';
        const reference = /r="([A-Z]+)(\d+)"/.exec(attributes)?.[1];
        if (!reference) continue;
        const type = /t="([^"]+)"/.exec(attributes)?.[1] || 'n';
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '';
        const inline = /<is>([\s\S]*?)<\/is>/.exec(body)?.[1];
        let text = '';
        let value = null;
        if (type === 's') text = shared[Number(raw)] ?? '';
        else if (type === 'inlineStr') text = cleanText((inline || '').replace(/<[^>]+>/g, ''));
        else if (raw !== '') {
          value = Number(raw);
          text = raw;
        }
        cells[columnToIndex(reference)] = { text, value };
      }
      rows.push({ rowNumber, cells });
    }

    let columns = null;
    let headerRow = -1;
    for (const row of rows) {
      const indices = Object.keys(row.cells).map(Number).sort((a, b) => a - b);
      const maxIndex = indices.length ? indices[indices.length - 1] : -1;
      const texts = Array.from({ length: maxIndex + 1 }, (_, index) => row.cells[index]?.text ?? '');
      const header = headerColumns(texts.map((text) => (text ? text : '')));
      if (header) {
        columns = header;
        headerRow = row.rowNumber;
        continue;
      }
      if (!columns) {
        const candidate = texts.find((text) => text && /TABELA|LINHA/i.test(text) && text.length <= 60);
        if (candidate && !title) title = candidate;
        continue;
      }
      const name = row.cells[columns.name]?.text || '';
      const price = row.cells[columns.price]?.value ?? null;
      if (!name || price == null || !(price > 0)) continue;
      if (/^OBS\b/i.test(name)) continue;
      const code = (row.cells[columns.code]?.text || '').trim();
      records.push({
        rowNumber: row.rowNumber,
        code,
        name,
        price,
        imageRef: null,
      });
    }
    if (!records.length) continue;

    // Images anchor inside the product's physical footprint (data row + the
    // row below it): the owner is the last product at or above the anchor row.
    // Anchors above the header row belong to the company logo block.
    const productAnchors = anchors.filter((anchor) => anchor.row + 1 > headerRow);
    for (const anchor of productAnchors) {
      const anchorRow = anchor.row + 1;
      const owner = records.filter((record) => record.rowNumber <= anchorRow).pop();
      if (owner && !owner.imageRef) {
        owner.imageRef = { kind: 'xlsx', entry: anchor.entry };
      }
    }
    break;
  }
  return { title, records };
}
