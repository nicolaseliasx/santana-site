import { mkdir, writeFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const JPEG_TRAILER = Buffer.from([0xff, 0xd9]);

/**
 * Extract embedded DCTDecode JPEG streams from a PDF by magic bytes into
 * `outDir`. Each file is validated through sharp (decode must succeed).
 * Returns the list of written file names.
 */
export async function extractPdfJpegs(pdfPath, outDir) {
  const buffer = await readFile(pdfPath);
  const streams = [];
  let position = 0;
  while ((position = buffer.indexOf(JPEG_SIGNATURE, position)) !== -1) {
    const end = buffer.indexOf(JPEG_TRAILER, position + JPEG_SIGNATURE.length);
    if (end === -1) break;
    const bytes = buffer.subarray(position, end + JPEG_TRAILER.length);
    position = end + JPEG_TRAILER.length;
    // Real DCTDecode streams start with a proper SOI+marker; skip tiny false positives.
    if (bytes.length < 1024) continue;
    streams.push(bytes);
  }
  await mkdir(outDir, { recursive: true });
  const written = [];
  for (let index = 0; index < streams.length; index += 1) {
    const name = `pdf-${String(index + 1).padStart(2, '0')}.jpg`;
    try {
      const metadata = await sharp(streams[index]).metadata();
      if (!metadata.width || !metadata.height) continue;
      await writeFile(join(outDir, name), streams[index]);
      written.push({ name, width: metadata.width, height: metadata.height, bytes: streams[index].length });
    } catch {
      // Not a decodable JPEG stream — skip silently, reported via count diff.
    }
  }
  return written;
}
