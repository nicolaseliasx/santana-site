import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
import { headerColumns, normalizeName } from './shared.mjs';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_TRAILER = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const JPEG_TRAILER = Buffer.from([0xff, 0xd9]);

function extractImageBlob(range) {
  const png = range.indexOf(PNG_SIGNATURE);
  const jpeg = png === -1 ? range.indexOf(JPEG_SIGNATURE) : -1;
  if (png !== -1) {
    const end = range.indexOf(PNG_TRAILER, png);
    if (end !== -1) return { bytes: range.subarray(png, end + PNG_TRAILER.length), ext: 'png' };
  }
  if (jpeg !== -1) {
    const end = range.indexOf(JPEG_TRAILER, jpeg + JPEG_SIGNATURE.length);
    if (end !== -1) return { bytes: range.subarray(jpeg, end + JPEG_TRAILER.length), ext: 'jpg' };
  }
  return null;
}

/** Concatenate BIFF record bodies: the seed record plus its CONTINUE records. */
function concatRecordBodies(data, parts) {
  const total = parts.reduce((sum, [start, end]) => sum + end - start, 0);
  const out = Buffer.alloc(total);
  let offset = 0;
  for (const [start, end] of parts) {
    data.copy(out, offset, start, end);
    offset += end - start;
  }
  return out;
}

function walkEscher(buffer, start, end, visit, depth = 0) {
  let position = start;
  while (position + 8 <= end) {
    const versionInstance = buffer.readUInt16LE(position);
    const type = buffer.readUInt16LE(position + 2);
    const length = buffer.readUInt32LE(position + 4);
    const version = versionInstance & 0xf;
    const bodyStart = position + 8;
    const bodyEnd = Math.min(end, bodyStart + length);
    visit({ type, instance: versionInstance >> 4, version, bodyStart, bodyEnd, depth });
    if (version === 0xf) walkEscher(buffer, bodyStart, bodyEnd, visit, depth + 1);
    position = bodyEnd;
  }
}

/**
 * Parse a legacy BIFF8 .xls: cell values via SheetJS, row anchors + picture
 * indices via Escher (MSODRAWING), image bytes from the drawing group BStore.
 * Extracted BLIPs are cached to `cacheDir` as blip-<index>.<ext>.
 */
export async function parseXls(filePath, cacheDir) {
  const buffer = await readFile(filePath);
  const cfb = XLSX.CFB.read(buffer, { type: 'buffer' });
  const workbookEntry = cfb.FullPaths.findIndex((path) => /\/(Workbook|Book)$/.test(path));
  const data = cfb.FileIndex[workbookEntry].content;

  // Split the Workbook stream into BIFF records, stitching CONTINUE records.
  const groupParts = [];
  const drawingParts = [];
  let current = null;
  let position = 0;
  while (position + 4 <= data.length) {
    const id = data.readUInt16LE(position);
    const length = data.readUInt16LE(position + 2);
    const body = [position + 4, position + 4 + length];
    if (id === 0x00eb) {
      current = groupParts;
      groupParts.push(body);
    } else if (id === 0x00ec) {
      current = [];
      drawingParts.push(current);
      current.push(body);
    } else if (id === 0x003c && current) {
      current.push(body);
    } else {
      current = null;
    }
    position += 4 + length;
  }
  const groupStream = concatRecordBodies(data, groupParts);

  // Collect BStore entries (BSE records) in order; picture index is 1-based.
  const bseRanges = [];
  walkEscher(groupStream, 0, groupStream.length, (record) => {
    if (record.type === 0xf007) bseRanges.push(groupStream.subarray(record.bodyStart, record.bodyEnd));
  });
  await mkdir(cacheDir, { recursive: true });
  const blips = new Map();
  for (let index = 0; index < bseRanges.length; index += 1) {
    const blob = extractImageBlob(bseRanges[index]);
    if (!blob) continue;
    const name = `blip-${String(index + 1).padStart(2, '0')}.${blob.ext}`;
    await writeFile(join(cacheDir, name), blob.bytes);
    blips.set(index + 1, { name, bytes: blob.bytes });
  }

  // Per-shape anchors + picture references from the MSODRAWING records.
  const shapes = [];
  for (const parts of drawingParts) {
    const stream = concatRecordBodies(data, parts);
    let anchor = null;
    let pib = null;
    walkEscher(stream, 0, stream.length, (record) => {
      if (record.type === 0xf010 && record.bodyEnd - record.bodyStart >= 18) {
        anchor = {
          col: stream.readUInt16LE(record.bodyStart + 2),
          row: stream.readUInt16LE(record.bodyStart + 6),
        };
      }
      if (record.type === 0xf00b) {
        for (let property = 0; property < record.instance; property += 1) {
          const pid = stream.readUInt16LE(record.bodyStart + property * 6) & 0x3fff;
          const value = stream.readUInt32LE(record.bodyStart + property * 6 + 2);
          if (pid === 0x0104) pib = value;
        }
      }
    });
    if (anchor && pib != null) shapes.push({ ...anchor, pib });
  }

  // Cell grid via SheetJS (dense rows, 0-based).
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });

  let columns = null;
  let title = null;
  const records = [];
  grid.forEach((row, rowIndex) => {
    const texts = row.map((cell) => (cell == null ? '' : normalizeName(String(cell))));
    const header = headerColumns(texts);
    if (header) {
      columns = header;
      return;
    }
    if (!columns) {
      const candidate = row.find((cell) => typeof cell === 'string' && /LINHA|TABELA/i.test(cell) && String(cell).length <= 60);
      if (candidate && !title) title = String(candidate).trim();
      return;
    }
    const name = row[columns.name];
    const price = row[columns.price];
    if (typeof name !== 'string' || !name.trim() || typeof price !== 'number' || !(price > 0)) return;
    if (/^OBS\b/i.test(name)) return;
    const code = row[columns.code];
    const shape = shapes.find((item) => item.row === rowIndex);
    const blip = shape ? blips.get(shape.pib) : null;
    records.push({
      rowNumber: rowIndex + 1,
      code: code == null ? '' : String(code).trim(),
      name: name.replace(/\s+/g, ' ').trim(),
      price,
      imageRef: blip ? { kind: 'xls', entry: `blip:${shape.pib}`, cacheFile: blip.name } : null,
    });
  });

  return { title, records, blipCount: blips.size, shapeCount: shapes.length };
}
