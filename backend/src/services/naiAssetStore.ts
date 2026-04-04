import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import { publicUrls, runtimePaths } from '../config/runtimePaths';
import { normalizeBase64ImageData } from '../utils/nai/requestBuilder';

interface StoredNaiAssetImageFields {
  image_data_url?: string;
  image_path?: string;
  thumbnail_path?: string;
  image_url?: string;
  thumbnail_url?: string;
}

export interface StoredNaiVibeAsset extends StoredNaiAssetImageFields {
  id: string;
  label: string;
  description?: string | null;
  model: string;
  encoded: string;
  strength: number;
  information_extracted: number;
  created_date: string;
}

export interface StoredNaiCharacterReferenceAsset extends StoredNaiAssetImageFields {
  id: string;
  label: string;
  description?: string | null;
  type: 'character' | 'style' | 'character&style';
  strength: number;
  fidelity: number;
  created_date: string;
  has_letterbox: boolean;
}

const SAVE_ROOT = path.join(runtimePaths.basePath, 'save');
const VIBE_ROOT = path.join(SAVE_ROOT, 'vibe_transfer');
const CHARACTER_REFERENCE_ROOT = path.join(SAVE_ROOT, 'character_reference');
const CHARACTER_REFERENCE_LETTERBOX_ROOT = path.join(CHARACTER_REFERENCE_ROOT, 'letterboxed');
const CHARACTER_REFERENCE_THUMBNAIL_ROOT = path.join(CHARACTER_REFERENCE_ROOT, 'thumbnails');
const THUMBNAIL_DIRNAME = 'thumbnails';
const THUMBNAIL_SIZE = 512;
const THUMBNAIL_QUALITY = 82;

function ensureDirectory(targetPath: string) {
  if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(targetPath, { recursive: true });
  }
}

function slugifyModel(model: string) {
  return model
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'unknown-model';
}

function sha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function decodeImageBuffer(image: string) {
  return Buffer.from(normalizeBase64ImageData(image) || image, 'base64');
}

async function buildLetterboxedPng(imageBuffer: Buffer) {
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width ?? 1024;
  const height = metadata.height ?? 1024;
  const target = Math.abs(width - height) < Math.min(width, height) * 0.12
    ? { width: 1472, height: 1472 }
    : width >= height
      ? { width: 1536, height: 1024 }
      : { width: 1024, height: 1536 };

  return sharp(imageBuffer)
    .resize(target.width, target.height, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png()
    .toBuffer();
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeJsonFile(filePath: string, value: unknown) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function toSaveRelativePath(filePath: string) {
  return path.relative(runtimePaths.saveDir, filePath).replace(/\\/g, '/');
}

function buildSaveFileUrl(relativePath: string | undefined) {
  if (!relativePath) {
    return undefined;
  }

  return `${publicUrls.saveBaseUrl}/${relativePath.split('/').map(encodeURIComponent).join('/')}`;
}

async function writePngFile(outputPath: string, input: Buffer) {
  await sharp(input).png().toFile(outputPath);
}

async function writeThumbnailFile(source: string | Buffer, outputPath: string) {
  ensureDirectory(path.dirname(outputPath));
  await sharp(source)
    .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({
      quality: THUMBNAIL_QUALITY,
      effort: 4,
    })
    .toFile(outputPath);
}

function buildStoredAssetResponse<T extends StoredNaiAssetImageFields>(record: T): T {
  return {
    ...record,
    image_data_url: undefined,
    image_url: buildSaveFileUrl(record.image_path),
    thumbnail_url: buildSaveFileUrl(record.thumbnail_path),
  };
}

async function ensureVibeAssetFiles(record: StoredNaiVibeAsset, filePath: string): Promise<StoredNaiVibeAsset> {
  const modelDir = path.dirname(filePath);
  const imagePath = path.join(modelDir, `${record.id}.png`);
  const thumbnailPath = path.join(modelDir, THUMBNAIL_DIRNAME, `${record.id}.webp`);
  let changed = false;

  if (!fs.existsSync(imagePath) && record.image_data_url) {
    ensureDirectory(path.dirname(imagePath));
    await writePngFile(imagePath, decodeImageBuffer(record.image_data_url));
    changed = true;
  }

  if (fs.existsSync(imagePath) && !fs.existsSync(thumbnailPath)) {
    await writeThumbnailFile(imagePath, thumbnailPath);
    changed = true;
  }

  const nextImagePath = fs.existsSync(imagePath) ? toSaveRelativePath(imagePath) : undefined;
  const nextThumbnailPath = fs.existsSync(thumbnailPath) ? toSaveRelativePath(thumbnailPath) : undefined;
  const nextRecord: StoredNaiVibeAsset = {
    ...record,
    image_path: nextImagePath,
    thumbnail_path: nextThumbnailPath,
  };

  if (nextRecord.image_data_url && nextImagePath) {
    delete nextRecord.image_data_url;
    changed = true;
  }

  if (record.image_path !== nextRecord.image_path || record.thumbnail_path !== nextRecord.thumbnail_path) {
    changed = true;
  }

  if (changed) {
    writeJsonFile(filePath, nextRecord);
  }

  return nextRecord;
}

async function ensureCharacterReferenceAssetFiles(
  record: StoredNaiCharacterReferenceAsset,
  metadataPath: string,
): Promise<StoredNaiCharacterReferenceAsset> {
  const assetId = path.basename(metadataPath, '.json');
  const imagePath = path.join(CHARACTER_REFERENCE_ROOT, `${assetId}.png`);
  const thumbnailPath = path.join(CHARACTER_REFERENCE_THUMBNAIL_ROOT, `${assetId}.webp`);
  let changed = false;

  if (!fs.existsSync(imagePath) && record.image_data_url) {
    ensureDirectory(path.dirname(imagePath));
    await writePngFile(imagePath, decodeImageBuffer(record.image_data_url));
    changed = true;
  }

  if (fs.existsSync(imagePath) && !fs.existsSync(thumbnailPath)) {
    await writeThumbnailFile(imagePath, thumbnailPath);
    changed = true;
  }

  const nextImagePath = fs.existsSync(imagePath) ? toSaveRelativePath(imagePath) : undefined;
  const nextThumbnailPath = fs.existsSync(thumbnailPath) ? toSaveRelativePath(thumbnailPath) : undefined;
  const nextRecord: StoredNaiCharacterReferenceAsset = {
    ...record,
    image_path: nextImagePath,
    thumbnail_path: nextThumbnailPath,
  };

  if (nextRecord.image_data_url && nextImagePath) {
    delete nextRecord.image_data_url;
    changed = true;
  }

  if (record.image_path !== nextRecord.image_path || record.thumbnail_path !== nextRecord.thumbnail_path) {
    changed = true;
  }

  if (changed) {
    writeJsonFile(metadataPath, nextRecord);
  }

  return nextRecord;
}

/** Persist one encoded vibe payload so the user can reuse it without re-encoding. */
export async function saveNaiVibeAsset(input: {
  label?: string;
  description?: string;
  model: string;
  image?: string;
  encoded: string;
  strength?: number;
  information_extracted?: number;
}) {
  ensureDirectory(VIBE_ROOT);
  const modelDir = path.join(VIBE_ROOT, slugifyModel(input.model));
  ensureDirectory(modelDir);
  ensureDirectory(path.join(modelDir, THUMBNAIL_DIRNAME));

  const normalizedEncoded = input.encoded.trim();
  if (!normalizedEncoded) {
    throw new Error('Encoded vibe data is required');
  }

  const assetId = sha256(`${input.model}:${normalizedEncoded}`);
  const imagePath = path.join(modelDir, `${assetId}.png`);
  const thumbnailPath = path.join(modelDir, THUMBNAIL_DIRNAME, `${assetId}.webp`);

  if (input.image) {
    const imageBuffer = decodeImageBuffer(input.image);
    await writePngFile(imagePath, imageBuffer);
    await writeThumbnailFile(imageBuffer, thumbnailPath);
  }

  const record: StoredNaiVibeAsset = {
    id: assetId,
    label: input.label?.trim() || `vibe-${assetId.slice(0, 8)}`,
    description: input.description?.trim() || undefined,
    model: input.model,
    image_path: fs.existsSync(imagePath) ? toSaveRelativePath(imagePath) : undefined,
    thumbnail_path: fs.existsSync(thumbnailPath) ? toSaveRelativePath(thumbnailPath) : undefined,
    encoded: normalizedEncoded,
    strength: typeof input.strength === 'number' ? input.strength : 0.6,
    information_extracted: typeof input.information_extracted === 'number' ? input.information_extracted : 1,
    created_date: new Date().toISOString(),
  };

  const filePath = path.join(modelDir, `${assetId}.json`);
  writeJsonFile(filePath, record);
  return buildStoredAssetResponse(record);
}

/** List all stored vibe payloads, optionally scoped to one model family. */
export async function listNaiVibeAssets(model?: string) {
  ensureDirectory(VIBE_ROOT);
  const targetDirs = model
    ? [path.join(VIBE_ROOT, slugifyModel(model))]
    : fs.readdirSync(VIBE_ROOT, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => path.join(VIBE_ROOT, entry.name));

  const records: StoredNaiVibeAsset[] = [];
  for (const targetDir of targetDirs) {
    if (!fs.existsSync(targetDir)) {
      continue;
    }

    for (const fileName of fs.readdirSync(targetDir).filter((entry) => entry.endsWith('.json'))) {
      const filePath = path.join(targetDir, fileName);
      const record = readJsonFile<StoredNaiVibeAsset>(filePath);
      if (!record) {
        continue;
      }

      records.push(await ensureVibeAssetFiles(record, filePath));
    }
  }

  return records
    .sort((left, right) => right.created_date.localeCompare(left.created_date))
    .map((record) => buildStoredAssetResponse(record));
}

function findVibeAssetFilePath(assetId: string) {
  if (!fs.existsSync(VIBE_ROOT)) {
    return null;
  }

  const directories = fs.readdirSync(VIBE_ROOT, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  for (const directory of directories) {
    const filePath = path.join(VIBE_ROOT, directory.name, `${assetId}.json`);
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }

  return null;
}

async function loadNaiVibeAssetRecord(assetId: string) {
  const filePath = findVibeAssetFilePath(assetId);
  if (!filePath) {
    return null;
  }

  const record = readJsonFile<StoredNaiVibeAsset>(filePath);
  if (!record) {
    return null;
  }

  return ensureVibeAssetFiles(record, filePath);
}

/** Load one stored vibe payload with its full encoded payload. */
export async function getNaiVibeAsset(assetId: string) {
  const record = await loadNaiVibeAssetRecord(assetId);
  return record ? buildStoredAssetResponse(record) : null;
}

/** Delete one stored vibe payload. */
export function deleteNaiVibeAsset(assetId: string) {
  const filePath = findVibeAssetFilePath(assetId);
  if (!filePath) {
    return false;
  }

  const modelDir = path.dirname(filePath);
  const targets = [
    filePath,
    path.join(modelDir, `${assetId}.png`),
    path.join(modelDir, THUMBNAIL_DIRNAME, `${assetId}.webp`),
  ];

  let deleted = false;
  for (const targetPath of targets) {
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
      deleted = true;
    }
  }

  return deleted;
}

/** Update one stored vibe payload's editable metadata. */
export async function updateNaiVibeAsset(assetId: string, input: {
  label?: string;
  description?: string;
}) {
  const filePath = findVibeAssetFilePath(assetId);
  if (!filePath) {
    return null;
  }

  const hydratedRecord = await loadNaiVibeAssetRecord(assetId);
  if (!hydratedRecord) {
    return null;
  }
  const nextRecord: StoredNaiVibeAsset = {
    ...hydratedRecord,
    label: input.label?.trim() || hydratedRecord.label,
    description: input.description?.trim() || undefined,
  };

  writeJsonFile(filePath, nextRecord);
  return buildStoredAssetResponse(nextRecord);
}

/** Persist one character-reference image and its prepared letterboxed derivative. */
export async function saveNaiCharacterReferenceAsset(input: {
  label?: string;
  description?: string;
  image: string;
  type?: 'character' | 'style' | 'character&style';
  strength?: number;
  fidelity?: number;
}) {
  ensureDirectory(CHARACTER_REFERENCE_ROOT);
  ensureDirectory(CHARACTER_REFERENCE_LETTERBOX_ROOT);
  ensureDirectory(CHARACTER_REFERENCE_THUMBNAIL_ROOT);

  const imageBuffer = decodeImageBuffer(input.image);
  const assetId = sha256(input.image);
  const originalPath = path.join(CHARACTER_REFERENCE_ROOT, `${assetId}.png`);
  const thumbnailPath = path.join(CHARACTER_REFERENCE_THUMBNAIL_ROOT, `${assetId}.webp`);
  const letterboxedPath = path.join(CHARACTER_REFERENCE_LETTERBOX_ROOT, `${assetId}.png`);
  const letterboxedPng = await buildLetterboxedPng(imageBuffer);

  await writePngFile(originalPath, imageBuffer);
  await writeThumbnailFile(imageBuffer, thumbnailPath);
  fs.writeFileSync(letterboxedPath, letterboxedPng);

  const metadata: StoredNaiCharacterReferenceAsset = {
    id: assetId,
    label: input.label?.trim() || `reference-${assetId.slice(0, 8)}`,
    description: input.description?.trim() || undefined,
    image_path: toSaveRelativePath(originalPath),
    thumbnail_path: toSaveRelativePath(thumbnailPath),
    type: input.type || 'character&style',
    strength: typeof input.strength === 'number' ? input.strength : 0.6,
    fidelity: typeof input.fidelity === 'number' ? input.fidelity : 1,
    created_date: new Date().toISOString(),
    has_letterbox: true,
  };

  const metadataPath = path.join(CHARACTER_REFERENCE_ROOT, `${assetId}.json`);
  writeJsonFile(metadataPath, metadata);
  return buildStoredAssetResponse(metadata);
}

/** List all saved character-reference assets. */
export async function listNaiCharacterReferenceAssets() {
  ensureDirectory(CHARACTER_REFERENCE_ROOT);
  const records: StoredNaiCharacterReferenceAsset[] = [];

  for (const fileName of fs.readdirSync(CHARACTER_REFERENCE_ROOT).filter((entry) => entry.endsWith('.json'))) {
    const metadataPath = path.join(CHARACTER_REFERENCE_ROOT, fileName);
    const record = readJsonFile<StoredNaiCharacterReferenceAsset>(metadataPath);
    if (!record) {
      continue;
    }

    records.push(await ensureCharacterReferenceAssetFiles(record, metadataPath));
  }

  return records
    .sort((left, right) => right.created_date.localeCompare(left.created_date))
    .map((record) => buildStoredAssetResponse(record));
}

/** Delete one stored character-reference asset and its derived files. */
export function deleteNaiCharacterReferenceAsset(assetId: string) {
  const targets = [
    path.join(CHARACTER_REFERENCE_ROOT, `${assetId}.png`),
    path.join(CHARACTER_REFERENCE_ROOT, `${assetId}.json`),
    path.join(CHARACTER_REFERENCE_LETTERBOX_ROOT, `${assetId}.png`),
    path.join(CHARACTER_REFERENCE_THUMBNAIL_ROOT, `${assetId}.webp`),
  ];

  let deleted = false;
  for (const targetPath of targets) {
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
      deleted = true;
    }
  }

  return deleted;
}

/** Update one stored character-reference asset's editable metadata. */
export async function updateNaiCharacterReferenceAsset(assetId: string, input: {
  label?: string;
  description?: string;
}) {
  const metadataPath = path.join(CHARACTER_REFERENCE_ROOT, `${assetId}.json`);
  if (!fs.existsSync(metadataPath)) {
    return null;
  }

  const record = readJsonFile<StoredNaiCharacterReferenceAsset>(metadataPath);
  if (!record) {
    return null;
  }

  const hydratedRecord = await ensureCharacterReferenceAssetFiles(record, metadataPath);
  const nextRecord: StoredNaiCharacterReferenceAsset = {
    ...hydratedRecord,
    label: input.label?.trim() || hydratedRecord.label,
    description: input.description?.trim() || undefined,
  };

  writeJsonFile(metadataPath, nextRecord);
  return buildStoredAssetResponse(nextRecord);
}
