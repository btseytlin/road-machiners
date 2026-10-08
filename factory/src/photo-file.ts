import { lstatSync, readFileSync } from 'node:fs';

export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const PHOTO_MAX_SIDES = 10000;

export type PhotoFile = { bytes: Buffer; mime: string; name: string };

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function readPhoto(path: string): PhotoFile {
  requireRegularFile(path);
  const bytes = readFileSync(path);
  const mime = sniff(bytes);
  if (mime === null) throw new Error(`Image ${path} is not a PNG, JPEG or WebP file.`);
  const sides = mime === 'image/png' ? pngSides(bytes) : 0;
  if (sides > PHOTO_MAX_SIDES) throw new Error(`Image ${path} is too large, its sides add up to ${sides} pixels and Telegram takes ${PHOTO_MAX_SIDES}.`);
  return { bytes, mime, name: path.split('/').pop() ?? 'photo' };
}

function requireRegularFile(path: string): void {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat || !stat.isFile()) throw new Error(`Image ${path} is missing or is not a regular file.`);
  if (stat.size === 0 || stat.size > PHOTO_MAX_BYTES) throw new Error(`Image ${path} is ${stat.size} bytes, the limit is ${PHOTO_MAX_BYTES}.`);
}

const pngSides = (bytes: Buffer): number => bytes.readUInt32BE(16) + bytes.readUInt32BE(20);
const isPng = (bytes: Buffer): boolean => bytes.length >= 24 && bytes.subarray(0, 8).equals(PNG_MAGIC);
const isJpeg = (bytes: Buffer): boolean => bytes.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
const isWebp = (bytes: Buffer): boolean => bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP';

function sniff(bytes: Buffer): string | null {
  if (isPng(bytes)) return 'image/png';
  if (isJpeg(bytes)) return 'image/jpeg';
  return isWebp(bytes) ? 'image/webp' : null;
}
