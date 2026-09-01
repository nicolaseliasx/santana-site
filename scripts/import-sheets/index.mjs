#!/usr/bin/env node
/**
 * Importa o catálogo MAR/2026 a partir das planilhas na raiz do workspace.
 * Fontes: 3x ODS + 1x XLSX + 1x XLS (BIFF8) + PDF (só extração de JPEGs).
 * Saídas:
 *   reports/import-sheets.dataset.json  (dataset normalizado + dedupe TB4PL×POWER LINE)
 *   reports/staging-images/             (binários extraídos) + manifest.json
 *   reports/import-sheets.json          (relatório de auditoria)
 *   reports/pdf-images/                 (JPEGs do PDF, uso futuro manual)
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import sharp from 'sharp';
import * as XLSX from 'xlsx';

const ROOT = process.cwd();
const REPO_ROOT = join(ROOT, '..');
const SOURCE_DIR = REPO_ROOT;
const REPORTS = join(ROOT, 'reports');
const STAGING = join(REPORTS, 'staging-images');
const PDF_IMAGES = join(REPORTS, 'pdf-images');

const FILES = {
  tb4pl: 'TABELA TB4PL MAR 2026.ods',
  powerline: 'LINHA POWER LINE MAR 26.ods',
  acessorios: 'tabela acessórios.ods',
  bancos: 'TABELA SANTANA DE BANCOS SUPORTES.xlsx',
  articulada: 'LINHA ARTICULADA MAR 2026.xls',
  pdf: 'catalago atual com bordas.pdf',
};

const LINES = {
  tb4pl: { label: 'Tubular 4" (TB4PL)', categorySlug: 'linha-tubolar-4pl-power-line' },
  powerline: { label: 'Power Line (Tubular 4")', categorySlug: 'linha-tubolar-4pl-power-line' },
  acessorios: { label: 'Acessórios', categorySlug: null },
  bancos: { label: 'Bancos e Suportes', categorySlug: 'suportes-e-bancos' },
  articulada: { label: 'Articulada', categorySlug: 'linha-articulada-convergente' },
};

const stripTags = (html) => html
  .replace(/<text:s\b[^>]*\/>/g, ' ')
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/\s+/g, ' ')
  .trim();

const parseBrl = (text) => {
  const m = String(text).replace(/\u00a0/g, ' ').match(/R\$\s*([\d.]+)\s*,\s*(\d{2})/);
  if (!m) return null;
  return Number(`${m[1].replace(/\./g, '')}.${m[2]}`);
};

const normName = (value) => String(value ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');

const slugify = (value) => normName(value).replace(/\s+/g, '-').replace(/^-+|-+$/g, '') || 'produto';

const fmtBrl = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const stagingManifest = [];
let stagingSeq = 0;

async function stageImage(container, entry, bytes) {
  const hash = createHash('sha256').update(bytes).digest('hex');
  const existing = stagingManifest.find((item) => item.hash === hash);
  if (existing) return { ...existing, dedup: true };
  let type;
  try { type = await sharp(bytes).metadata(); } catch { type = null; }
  if (!type || !type.width || !type.height) return null;
  const ext = type.format === 'png' ? 'png' : 'jpg';
  const name = `img-${String(++stagingSeq).padStart(3, '0')}.${ext}`;
  await writeFile(join(STAGING, name), bytes);
  const record = {
    container, entry, stagingPath: `${name}`, hash,
    width: type.width, height: type.height, format: type.format,
    bytes: bytes.length,
  };
  stagingManifest.push(record);
  return record;
}

/* --------------------------------- ODS --------------------------------- */

function parseOds(fileName) {
  const zip = new AdmZip(join(SOURCE_DIR, fileName));
  const xml = zip.readAsText('content.xml');
  const pictures = new Map();
  for (const entry of zip.getEntries()) {
    if (entry.entryName.startsWith('Pictures/')) pictures.set(entry.entryName, entry.getData());
  }
  const rowMatches = [...xml.matchAll(/<table:table-row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:table-row>)/g)];
  const rows = [];
  rowMatches.forEach((match, index) => {
    const body = match[2] == null ? '' : match[2];
    let cells = [];
    const cellMatches = body.matchAll(/<table:table-cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:table-cell>)/g);
    for (const cm of cellMatches) {
      const attrs = cm[1] || '';
      const inner = cm[2] || '';
      const repeated = Number((attrs.match(/number-columns-repeated="(\d+)"/) || [])[1] || 1);
      const value = (attrs.match(/office:value="([^"]+)"/) || [])[1];
      const text = stripTags((inner.match(/<text:p[\s\S]*?<\/text:p>/g) || []).join(' '));
      const images = [...inner.matchAll(/<draw:image\b[^>]*xlink:href="([^"]+)"/g)].map((m) => m[1]);
      const cell = { text, value: value == null ? null : Number(value), images };
      const times = Math.min(repeated, 40);
      for (let i = 0; i < times; i += 1) cells.push(cell);
    }
    rows.push({ rowNumber: index + 1, cells });
  });
  const products = [];
  const skipped = [];
  for (const row of rows) {
    const texts = row.cells.map((c) => c.text).filter((t) => t && !t.includes('R$'));
    const priceCell = row.cells.find((c) => c.text.includes('R$'));
    const price = priceCell ? (Number.isFinite(priceCell.value) ? priceCell.value : parseBrl(priceCell.text)) : null;
    const code = texts[0] || null;
    const name = texts[1] || null;
    const imageHref = row.cells.flatMap((c) => c.images)[0] || null;
    const looksLikeProduct = Boolean(name && /[a-z]/i.test(name) && name.length >= 3 && price && price > 0 && code);
    if (!looksLikeProduct) {
      if (code || (name && price)) skipped.push({ rowNumber: row.rowNumber, reason: 'incomplete', code, name, price });
      continue;
    }
    products.push({
      rowNumber: row.rowNumber,
      code: code.replace(/\s+/g, ' ').trim(),
      name: name.replace(/\s+/g, ' ').trim(),
      price,
      imageRef: imageHref ? { container: fileName, entry: imageHref.replace(/^\.?\//, '') } : null,
    });
  }
  return { products, skipped, pictures };
}

/* --------------------------------- XLSX -------------------------------- */

function parseXlsx(fileName) {
  const zip = new AdmZip(join(SOURCE_DIR, fileName));
  const strings = [...zip.readAsText('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => stripTags([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(' ')));
  const sheet = zip.readAsText('xl/worksheets/sheet1.xml');
  const rels = {};
  const relXml = zip.readAsText('xl/drawings/_rels/drawing1.xml.rels');
  for (const m of relXml.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/>/g)) rels[m[1]] = m[2];
  const anchorByRow = new Map();
  const anchorList = [];
  for (const m of zip.readAsText('xl/drawings/drawing1.xml').matchAll(/<(xdr:twoCellAnchor|xdr:oneCellAnchor)\b[\s\S]*?<\/\1>/g)) {
    const block = m[0];
    const from = Number((block.match(/<xdr:from><xdr:col>\d+<\/xdr:col><xdr:colOff>\d+<\/xdr:colOff><xdr:row>(\d+)<\/xdr:row>/) || [])[1] ?? -1);
    const to = Number((block.match(/<xdr:to><xdr:col>\d+<\/xdr:col><xdr:colOff>\d+<\/xdr:colOff><xdr:row>(\d+)<\/xdr:row>/) || [])[1] ?? from);
    const embed = (block.match(/r:embed="([^"]+)"/) || [])[1];
    if (from < 0 || !embed || !rels[embed]) continue;
    anchorList.push({ from, to, center: (from + to) / 2, target: rels[embed].replace(/^\.\.\//, 'xl/') });
  }
  if (!anchorByRow.size && !anchorList.length) { /* sem desenhos */ }
  const media = new Map();
  for (const entry of zip.getEntries()) if (entry.entryName.startsWith('xl/media/')) media.set(entry.entryName, entry.getData());

  const rows = [...sheet.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)];
  const cellsByRow = new Map();
  for (const m of rows) {
    const rowNum = Number(m[1]);
    const cells = {};
    for (const cm of m[2].matchAll(/<c\b([^>]*)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = String(cm[1] ?? cm[2] ?? '');
      const inner = cm[3] ?? '';
      const col = (attrs.match(/r="([A-Z]+)\d+"/) || [])[1];
      const type = (attrs.match(/t="(\w+)"/) || [])[1];
      const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      if (!col || v == null) continue;
      cells[col] = type === 's' ? strings[Number(v)] : v;
    }
    cellsByRow.set(rowNum, cells);
  }
  let headerCols = null;
  for (const [rowNum, cells] of cellsByRow) {
    const values = Object.values(cells).map((v) => String(v ?? ''));
    if (values.some((v) => /c[oó]d/i.test(v)) && values.some((v) => /equipamento/i.test(v))) {
      const colOf = (re) => Object.entries(cells).find(([, v]) => re.test(String(v)))?.[0];
      headerCols = { code: colOf(/^C[ÓO]D/), name: colOf(/EQUIPAMENTO/), value: colOf(/^VALOR/) };
      if (headerCols.code && headerCols.name && headerCols.value) break;
      headerCols = null;
    }
  }
  if (!headerCols) throw new Error(`header não encontrado em ${fileName}`);
  const products = [];
  const skipped = [];
  for (const [rowNum, cells] of [...cellsByRow.entries()].sort((a, b) => a[0] - b[0])) {
    const code = String(cells[headerCols.code] ?? '').trim();
    const name = String(cells[headerCols.name] ?? '').replace(/\s+/g, ' ').trim();
    const price = Number(cells[headerCols.value]);
    const isProduct = Boolean(code && name && /[a-z]/i.test(name) && Number.isFinite(price) && price > 0);
    if (!isProduct) {
      if (code && name) skipped.push({ rowNumber: rowNum, reason: 'incomplete', code, name, price });
      continue;
    }
    products.push({ rowNumber: rowNum, code, name, price, imageRef: null });
  }
  // atribuição por proximidade global: pares (produto, âncora) ordenados por distância
  const usable = anchorList.filter((a) => a.to - a.from <= 1);
  const pairs = [];
  products.forEach((product, pi) => {
    usable.forEach((anchor, ai) => {
      const dist = Math.abs(anchor.center + 1 - product.rowNumber);
      if (dist <= 1.6) pairs.push({ dist, center: anchor.center, pi, ai });
    });
  });
  pairs.sort((a, b) => a.dist - b.dist || a.center - b.center || products[a.pi].rowNumber - products[b.pi].rowNumber);
  const prodTaken = new Set(); const anchorTaken = new Set();
  for (const pair of pairs) {
    if (prodTaken.has(pair.pi) || anchorTaken.has(pair.ai)) continue;
    prodTaken.add(pair.pi); anchorTaken.add(pair.ai);
    products[pair.pi].imageRef = { container: fileName, entry: usable[pair.ai].target };
  }
  return { products, skipped, media };
}

/* --------------------------- XLS (BIFF8 + Escher) ---------------------- */

function cfbReadStream(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const ssz = 2 ** dv.getUint16(30, true);
  const dirStart = dv.getUint32(48, true);
  const difatSect = dv.getInt32(68, true);
  const difat = [];
  for (let i = 0; i < 109; i += 1) { const v = dv.getUint32(76 + i * 4, true); if (v < 0xfffffffc) difat.push(v); }
  let s = difatSect; const per = ssz / 4 - 1;
  while (s >= 0 && s < 0xfffffffc) {
    for (let i = 0; i < per; i += 1) { const v = dv.getUint32((s + 1) * ssz + i * 4, true); if (v < 0xfffffffc) difat.push(v); }
    s = dv.getInt32((s + 1) * ssz + per * 4, true);
  }
  const fat = [];
  for (const sec of difat) for (let o = 0; o < ssz; o += 4) fat.push(dv.getUint32((sec + 1) * ssz + o, true));
  const sectOff = (x) => (x + 1) * ssz;
  const chain = (start) => { const out = []; let x = start; const seen = new Set(); while (x < 0xfffffffc && !seen.has(x)) { seen.add(x); out.push(x); x = fat[x]; } return out; };
  const readStream = (start, size) => Buffer.concat(chain(start).map((sc) => buf.subarray(sectOff(sc), sectOff(sc) + ssz))).subarray(0, size > 0 ? size : undefined);
  const dir = readStream(dirStart, 0);
  const entries = [];
  for (let o = 0; o < dir.length; o += 128) {
    const nl = dir.readUInt16LE(o + 64); if (nl === 0) break;
    entries.push({ name: dir.toString('utf16le', o, o + nl - 2), start: dir.readInt32LE(o + 116), size: Number(dir.readBigUInt64LE(o + 120)) });
  }
  return { entries, readStream };
}

function escherRecords(buf, off = 0, end = buf.length, depth = 0, acc = []) {
  while (off + 8 <= end) {
    const vi = buf.readUInt16LE(off); const ty = buf.readUInt16LE(off + 2); const size = buf.readUInt32LE(off + 4);
    acc.push({ depth, ty, inst: vi >> 4, size, off });
    if ((vi & 0xf) === 0xf) escherRecords(buf, off + 8, Math.min(end, off + 8 + size), depth + 1, acc);
    off += 8 + size;
  }
  return acc;
}

function jpegSlices(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length - 3; i += 1) {
    if (!(bytes[i] === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff)) continue;
    const start = i;
    let j = start + 2;
    let done = false;
    while (j < bytes.length - 1) {
      if (bytes[j] === 0xff && bytes[j + 1] === 0xd9) { done = true; break; }
      if (bytes[j] === 0xff && bytes[j + 1] === 0xda) {
        let k = j + 2;
        while (k < bytes.length - 1) { if (bytes[k] === 0xff && bytes[k + 1] === 0xd9) break; k += 1; }
        j = k; done = true; break;
      }
      if (bytes[j] !== 0xff) { done = false; break; }
      const len = bytes.readUInt16BE(j + 2);
      j += 2 + len;
    }
    if (done && j - start > 2000) out.push(bytes.subarray(start, j + 2));
    if (out.length >= 4) break;
  }
  return out;
}

function pngSlices(bytes) {
  const out = [];
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let from = 0;
  while (from < bytes.length - 8) {
    const start = bytes.indexOf(sig, from);
    if (start < 0) break;
    let j = start + 8;
    while (j < bytes.length - 8) {
      const len = bytes.readUInt32BE(j);
      if (bytes.toString('ascii', j + 4, j + 8) === 'IEND') { j += 12; break; }
      j += 12 + len;
    }
    if (j <= bytes.length && j > start + 8) out.push(bytes.subarray(start, j));
    from = (start + 8);
    if (out.length >= 3) break;
  }
  return out;
}

function sliceImage(bytes) {
  return [...pngSlices(bytes), ...jpegSlices(bytes)].sort((a, b) => b.length - a.length);
}

function parseXls(fileName) {
  const raw = readFileSync(join(SOURCE_DIR, fileName));
  const { entries, readStream } = cfbReadStream(raw);
  const wbEntry = entries.find((e) => e.name === 'Workbook') || entries.find((e) => /book/i.test(e.name));
  const st = readStream(wbEntry.start, wbEntry.size);

  // SheetJS para células
  const wb = XLSX.read(raw, { type: 'buffer', cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });

  // Escher: MSODRAWINGGROUP (0x00EB) + MSODRAWING (0x00EC) com CONTINUEs
  let o = 0; let group = null; let chainOn = false; const drawingBlobs = []; let cur = null;
  while (o + 4 <= st.length) {
    const t = st.readUInt16LE(o); const size = st.readUInt16LE(o + 2);
    if (t === 0x00eb) { group = [st.subarray(o + 4, o + 4 + size)]; chainOn = true; o += 4 + size; continue; }
    if (t === 0x003c && chainOn) { group.push(st.subarray(o + 4, o + 4 + size)); o += 4 + size; continue; }
    if (t === 0x00ec) { if (cur) drawingBlobs.push(cur); cur = [st.subarray(o + 4, o + 4 + size)]; chainOn = false; o += 4 + size; continue; }
    if (t === 0x003c && cur) { cur.push(st.subarray(o + 4, o + 4 + size)); o += 4 + size; continue; }
    if (cur) { drawingBlobs.push(cur); cur = null; }
    o += 4 + size;
  }
  if (cur) drawingBlobs.push(cur);
  const blobs = drawingBlobs.map((parts) => Buffer.concat(parts));

  // BStore (FBSE) no grupo
  const g = Buffer.concat(group);
  const gacc = escherRecords(g);
  const fbses = gacc.filter((r) => r.ty === 0xf007);
  const bstore = fbses.map((r) => {
    const body = g.subarray(r.off + 8, r.off + 8 + r.size);
    return { uid: body.subarray(2, 18).toString('hex'), candidates: sliceImage(body) };
  });

  // shapes: anchor (0-based row) + índice BLIP (prop 0441 no payload do Sp 0xF00B)
  const shapeMap = new Map();
  blobs.forEach((b) => {
    const acc = escherRecords(b);
    const anchor = acc.find((r) => r.ty === 0xf010);
    const sp = acc.find((r) => r.ty === 0xf00b);
    if (!anchor || !sp) return;
    const a = b.subarray(anchor.off + 8, anchor.off + 8 + 18);
    const row0 = a.readUInt16LE(6); const col0 = a.readUInt16LE(2);
    const payload = b.subarray(sp.off + 8, sp.off + 8 + sp.size);
    let blip = null;
    for (let i = 0; i + 4 <= payload.length; i += 1) {
      if (payload[i] === 0x04 && payload[i + 1] === 0x41) { blip = payload.readUInt16LE(i + 2); break; }
    }
    if (blip == null || blip < 1 || blip > bstore.length) return;
    if (!shapeMap.has(row0)) shapeMap.set(row0, { blip, col0 });
  });

  // header do XLS: EQUIPAMENTO | CODIGO | UNIDADE | VALOR | TOTAL
  let headerIdx = -1; let cols = null;
  for (let i = 0; i < matrix.length; i += 1) {
    const row = matrix[i] || [];
    const up = row.map((c) => String(c ?? '').toUpperCase().trim());
    const nameCol = up.findIndex((c) => c === 'EQUIPAMENTO');
    const codeCol = up.findIndex((c) => /C[ÓO]DIGO/.test(c));
    const valCol = up.findIndex((c) => /^VALOR$/.test(c));
    if (nameCol >= 0 && codeCol >= 0 && valCol >= 0) { headerIdx = i; cols = { name: nameCol, code: codeCol, value: valCol }; break; }
  }
  if (headerIdx < 0) throw new Error(`header não encontrado em ${fileName}`);
  const products = []; const skipped = [];
  for (let i = headerIdx + 1; i < matrix.length; i += 1) {
    const row = matrix[i] || [];
    const code = String(row[cols.code] ?? '').replace(/\s+/g, ' ').trim();
    const name = String(row[cols.name] ?? '').replace(/\s+/g, ' ').trim();
    const price = Number(row[cols.value]);
    if (!code && !name) continue;
    if (/^OBS/.test(name) || /^OBS/.test(code)) break;
    const isProduct = Boolean(code && name && /[a-z]/i.test(name) && Number.isFinite(price) && price > 0);
    if (!isProduct) { skipped.push({ rowNumber: i + 1, reason: 'incomplete', code, name, price }); continue; }
    const shape = shapeMap.get(i);
    products.push({
      rowNumber: i + 1,
      code, name, price,
      imageRef: shape && bstore[shape.blip - 1]?.candidates?.length
        ? { container: fileName, entry: `escher:blip${shape.blip}:row${i}` }
        : null,
      xlsBlip: shape ? shape.blip : null,
    });
  }
  return { products, skipped, bstore };
}

/* --------------------------------- PDF --------------------------------- */

function extractPdfJpegs(fileName, outDir) {
  const buf = readFileSync(join(SOURCE_DIR, fileName));
  const found = [];
  let i = 0;
  while (i < buf.length - 3) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd8 && buf[i + 2] === 0xff && buf[i + 3] === 0xe0) {
      let len = buf.readUInt16BE(i + 4);
      let j = i + 2;
      let done = false;
      while (j < buf.length - 1) {
        if (buf[j] === 0xff && buf[j + 1] === 0xd9) { done = true; break; }
        if (buf[j] === 0xff && buf[j + 1] === 0xda) {
          let k = j + 2;
          while (k < buf.length - 1) { if (buf[k] === 0xff && buf[k + 1] === 0xd9) break; k += 1; }
          j = k; done = true; break;
        }
        len = buf.readUInt16BE(j + 2);
        j += 2 + len;
      }
      if (done && j - i > 5000) { found.push(buf.subarray(i, j + 2)); i = j + 2; continue; }
    }
    i += 1;
  }
  return found;
}

/* ------------------------------- Pipeline ------------------------------ */

const accessoryCategory = (name) => (/barra|halter|anilha|dumbbell|kettlebell|peso/i.test(name) ? 'barras-e-acessorios' : 'funcional-e-crosfit');

const run = async () => {
  await rm(STAGING, { recursive: true, force: true });
  await rm(PDF_IMAGES, { recursive: true, force: true });
  await mkdir(STAGING, { recursive: true });
  await mkdir(PDF_IMAGES, { recursive: true });

  const sources = {};
  for (const key of ['tb4pl', 'powerline', 'acessorios']) {
    const { products, skipped, pictures } = parseOds(FILES[key]);
    sources[key] = { products, skipped, pictures };
    console.log(`${FILES[key]}: ${products.length} produtos, ${pictures.size} imagens`);
  }
  {
    const { products, skipped, media } = parseXlsx(FILES.bancos);
    sources.bancos = { products, skipped, pictures: media };
    console.log(`${FILES.bancos}: ${products.length} produtos, ${media.size} imagens`);
  }
  {
    const { products, skipped, bstore } = parseXls(FILES.articulada);
    sources.articulada = { products, skipped, pictures: null, bstore };
    console.log(`${FILES.articulada}: ${products.length} produtos, ${bstore.filter((b) => b.candidates.length).length} BLIPs`);
  }

  // staging: resolve binários por imageRef
  const stagedByKey = new Map();
  const stageAll = async (key) => {
    const src = sources[key];
    for (const product of src.products) {
      if (!product.imageRef) continue;
      let bytes = null;
      if (key === 'articulada') {
        const blip = Number(product.imageRef.entry.match(/blip(\d+)/)?.[1] || 0);
        const cands = src.bstore[blip - 1]?.candidates || [];
        let bestPixels = -1;
        for (const cand of cands) {
          try {
            const meta = await sharp(cand).metadata();
            if (meta.width && meta.height && meta.width * meta.height > bestPixels) {
              bestPixels = meta.width * meta.height; bytes = cand;
            }
          } catch { /* candidato inválido */ }
        }
      } else {
        bytes = src.pictures.get(product.imageRef.entry) || null;
      }
      if (!bytes) { product.imageRef = null; continue; }
      const staged = await stageImage(product.imageRef.container, product.imageRef.entry, bytes);
      if (!staged) { product.imageRef = null; continue; }
      stagedByKey.set(`${key}:${product.rowNumber}`, staged);
    }
  };
  for (const key of Object.keys(sources)) await stageAll(key);

  // PDF (apenas arquivado para uso posterior)
  const pdfJpegs = extractPdfJpegs(FILES.pdf, PDF_IMAGES);
  for (let i = 0; i < pdfJpegs.length; i += 1) await writeFile(join(PDF_IMAGES, `pdf-p${String(i + 1).padStart(2, '0')}.jpg`), pdfJpegs[i]);
  console.log(`PDF: ${pdfJpegs.length} JPEGs extraídos para reports/pdf-images/`);

  // dedupe TB4PL × POWER LINE por nome exato normalizado
  const tbByName = new Map(sources.tb4pl.products.map((p) => [normName(p.name), p]));
  const merges = [];
  const powerlineOnly = [];
  for (const pl of sources.powerline.products) {
    const key = normName(pl.name);
    const twin = tbByName.get(key);
    if (!twin) { powerlineOnly.push(pl); continue; }
    const a = stagedByKey.get(`tb4pl:${twin.rowNumber}`);
    const b = stagedByKey.get(`powerline:${pl.rowNumber}`);
    const areaA = a ? (a.width || 0) * (a.height || 0) : 0;
    const areaB = b ? (b.width || 0) * (b.height || 0) : 0;
    const useTbImage = areaA >= areaB;
    if (useTbImage && a) stagedByKey.set(`tb4pl:${twin.rowNumber}`, a);
    else if (b) stagedByKey.set(`tb4pl:${twin.rowNumber}`, b);
    twin.mergedFrom = { file: FILES.powerline, rowNumber: pl.rowNumber, code: pl.code, price: pl.price };
    if (!twin.imageRef && pl.imageRef) twin.imageRef = pl.imageRef;
    merges.push({ name: twin.name, kept: { code: twin.code, price: twin.price, file: FILES.tb4pl }, dropped: { code: pl.code, price: pl.price, file: FILES.powerline }, imageFrom: useTbImage ? FILES.tb4pl : FILES.powerline });
  }

  // ordenação final do catálogo
  const ordered = [
    ...sources.tb4pl.products.map((p) => ({ key: 'tb4pl', p })),
    ...powerlineOnly.map((p) => ({ key: 'powerline', p })),
    ...sources.articulada.products.map((p) => ({ key: 'articulada', p })),
    ...sources.bancos.products.map((p) => ({ key: 'bancos', p })),
    ...sources.acessorios.products.map((p) => ({ key: 'acessorios', p })),
  ];

  const slugSeen = new Map();
  const codeSeen = new Map();
  const dataset = ordered.map(({ key, p }, index) => {
    let slug = slugify(p.name);
    if (slugSeen.has(slug)) { const n = slugSeen.get(slug) + 1; slugSeen.set(slug, n); slug = `${slug}-${n}`; } else slugSeen.set(slug, 1);
    const staged = stagedByKey.get(`${key}:${p.rowNumber}`) || null;
    const line = LINES[key];
    const categorySlug = line.categorySlug || accessoryCategory(p.name);
    const record = {
      id: String(index + 1),
      legacyId: index + 1,
      slug,
      name: p.name,
      code: p.code,
      price: p.price,
      priceFormatted: fmtBrl(p.price),
      line: line.label,
      lineKey: key,
      categorySlug,
      sourceFile: FILES[key],
      rowNumber: p.rowNumber,
      image: staged ? { stagingPath: staged.stagingPath, container: staged.container, entry: staged.entry, width: staged.width, height: staged.height, format: staged.format, bytes: staged.bytes, sha256: staged.hash } : null,
      mergedFrom: p.mergedFrom || null,
      flags: { duplicateCode: false, noImage: !staged },
    };
    if (p.code) {
      const ck = `${key}:${p.code}`;
      codeSeen.set(ck, (codeSeen.get(ck) || 0) + 1);
    }
    return record;
  });
  // marca TODOS os registros com código repetido no mesmo arquivo
  const dupIndex = new Map();
  for (const r of dataset) { const ck = `${r.lineKey}:${r.code}`; dupIndex.set(ck, (dupIndex.get(ck) || 0) + 1); }
  for (const r of dataset) r.flags.duplicateCode = dupIndex.get(`${r.lineKey}:${r.code}`) > 1;

  await writeFile(join(REPORTS, 'staging-images', 'manifest.json'), JSON.stringify(stagingManifest, null, 2));
  await writeFile(join(REPORTS, 'import-sheets.dataset.json'), JSON.stringify(dataset, null, 2));

  const report = {
    generatedAt: new Date().toISOString(),
    sourceFiles: FILES,
    counts: {
      perFile: Object.fromEntries(Object.entries(sources).map(([k, v]) => [FILES[k], { products: v.products.length, skippedRows: v.skipped.length }])),
      totalRaw: Object.values(sources).reduce((acc, s) => acc + s.products.length, 0),
      mergesTb4plPowerLine: merges.length,
      finalProducts: dataset.length,
      withImage: dataset.filter((r) => r.image).length,
      withoutImage: dataset.filter((r) => !r.image).length,
      duplicateCodes: dataset.filter((r) => r.flags.duplicateCode).length,
    },
    merges,
    withoutImage: dataset.filter((r) => !r.image).map((r) => ({ slug: r.slug, name: r.name, code: r.code, sourceFile: r.sourceFile, rowNumber: r.rowNumber })),
    duplicateCodes: dataset.filter((r) => r.flags.duplicateCode).map((r) => ({ slug: r.slug, name: r.name, code: r.code, sourceFile: r.sourceFile })),
    skippedRows: Object.fromEntries(Object.entries(sources).map(([k, v]) => [FILES[k], v.skipped])),
    pdfImagesExtracted: pdfJpegs.length,
    stagingImages: stagingManifest.length,
  };
  await writeFile(join(REPORTS, 'import-sheets.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.counts, null, 2));
};

run().catch((error) => { console.error(error); process.exit(1); });
