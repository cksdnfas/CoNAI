import crypto from 'crypto';
import fs from 'fs';
import sharp, { type Sharp } from 'sharp';
import { db } from '../database/init';
import { resolveUploadsPath } from '../config/runtimePaths';
import { toWindowsLongPathIfNeeded } from '../utils/pathResolver';

/** Ids keep the 48-hex shape of the perceptual composite, so length-based checks keep working. */
const IDENTITY_LENGTH = 48;

/**
 * Pixel-exact fingerprint of a still image: SHA-256 over the size and the decoded RGBA pixels (EXIF orientation
 * applied). Re-encoding losslessly or editing metadata keeps it; any pixel change (a recolour) changes it.
 */
export async function computePixelHash(input: string | Sharp): Promise<string> {
  const image = typeof input === 'string' ? sharp(toWindowsLongPathIfNeeded(input)) : input.clone();
  const { data, info } = await image.rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return crypto.createHash('sha256').update(`${info.width}x${info.height}x${info.channels}:`).update(data).digest('hex');
}

type IdentityRow = { composite_hash: string; pixel_hash: string | null };

function activeFilePath(compositeHash: string) {
  const row = db.prepare(`
    SELECT original_file_path FROM image_files
    WHERE composite_hash = ? AND file_status = 'active'
    ORDER BY id LIMIT 1
  `).get(compositeHash) as { original_file_path: string } | undefined;
  if (!row) return null;
  const filePath = resolveUploadsPath(row.original_file_path);
  return fs.existsSync(toWindowsLongPathIfNeeded(filePath)) ? filePath : null;
}

/**
 * The pixel hash of an existing row, computed from its file and stored the first time it is needed. Null when the
 * file is gone or unreadable (the caller then cannot tell the two apart).
 */
async function ensureRowPixelHash(row: IdentityRow, excludePath: string | null): Promise<string | null> {
  if (row.pixel_hash) return row.pixel_hash;
  const filePath = activeFilePath(row.composite_hash);
  if (!filePath || (excludePath && filePath === excludePath)) return null;
  try {
    const pixelHash = await computePixelHash(filePath);
    db.prepare('UPDATE media_metadata SET pixel_hash = ? WHERE composite_hash = ? AND pixel_hash IS NULL').run(pixelHash, row.composite_hash);
    return pixelHash;
  } catch {
    return null;
  }
}

/**
 * The library id for a still image.
 *
 * 1. A row with the same pixels → that row.
 * 2. An older row whose id is this image's perceptual composite (the previous identity) → that row if its pixels are
 *    the same (or cannot be read, keeping the old behaviour), otherwise this image is different and gets its own id.
 * 3. Otherwise a new id from the pixel hash.
 *
 * Perceptual hashes stay on the row for similarity and duplicate search; they just no longer decide identity.
 */
export async function resolveImageIdentity(params: {
  filePath: string;
  perceptualCompositeHash: string;
  source?: Sharp;
}): Promise<{ compositeHash: string; pixelHash: string }> {
  const pixelHash = await computePixelHash(params.source ?? params.filePath);

  const samePixels = db.prepare('SELECT composite_hash, pixel_hash FROM media_metadata WHERE pixel_hash = ? LIMIT 1').get(pixelHash) as IdentityRow | undefined;
  if (samePixels) return { compositeHash: samePixels.composite_hash, pixelHash };

  const legacy = db.prepare('SELECT composite_hash, pixel_hash FROM media_metadata WHERE composite_hash = ?').get(params.perceptualCompositeHash) as IdentityRow | undefined;
  if (legacy) {
    const legacyPixels = await ensureRowPixelHash(legacy, params.filePath);
    if (legacyPixels === null || legacyPixels === pixelHash) {
      return { compositeHash: legacy.composite_hash, pixelHash };
    }
  }

  return { compositeHash: pixelHash.slice(0, IDENTITY_LENGTH), pixelHash };
}

/** Record the pixel hash on a row created (or found) for it, so look-alikes are told apart without re-reading files. */
export function recordPixelHash(compositeHash: string, pixelHash: string) {
  db.prepare('UPDATE media_metadata SET pixel_hash = ? WHERE composite_hash = ? AND pixel_hash IS NULL').run(pixelHash, compositeHash);
}
