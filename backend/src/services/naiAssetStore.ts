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
let vibeAssetFileIndex: Map<string, string> | null = null;
let characterAssetMetadataIndex: Map<string, string> | null = null;

async function ensureDirectory(targetPath: string) {
  await fs.promises.mkdir(targetPath, { recursive: true });
}

async function fileExists(targetPath: string) {
  return fs.promises.access(targetPath).then(() => true, () => false);
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

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.promises.readFile(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath: string, value: unknown) {
  await fs.promises.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

/** Build the vibe metadata path index once instead of scanning directories per request. */
async function getVibeAssetFileIndex(): Promise<Map<string, string>> {
  if (vibeAssetFileIndex) {
    return vibeAssetFileIndex;
  }

  const index = new Map<string, string>();
  const directories = await fs.promises.readdir(VIBE_ROOT, { withFileTypes: true }).catch(() => []);
  for (const directory of directories) {
    if (!directory.isDirectory() || directory.name === THUMBNAIL_DIRNAME) {
      continue;
    }

    const modelDir = path.join(VIBE_ROOT, directory.name);
    const files = await fs.promises.readdir(modelDir, { withFileTypes: true }).catch(() => []);
    for (const file of files) {
      if (file.isFile() && file.name.endsWith('.json')) {
        index.set(path.basename(file.name, '.json'), path.join(modelDir, file.name));
      }
    }
  }

  vibeAssetFileIndex = index;
  return index;
}

/** Build the character-reference metadata index once per process. */
async function getCharacterAssetMetadataIndex(): Promise<Map<string, string>> {
  if (characterAssetMetadataIndex) {
    return characterAssetMetadataIndex;
  }

  const index = new Map<string, string>();
  const files = await fs.promises.readdir(CHARACTER_REFERENCE_ROOT, { withFileTypes: true }).catch(() => []);
  for (const file of files) {
    if (file.isFile() && file.name.endsWith('.json')) {
      index.set(path.basename(file.name, '.json'), path.join(CHARACTER_REFERENCE_ROOT, file.name));
    }
  }

  characterAssetMetadataIndex = index;
  return index;
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
  await ensureDirectory(path.dirname(outputPath));
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

  if (!(await fileExists(imagePath)) && record.image_data_url) {
    await ensureDirectory(path.dirname(imagePath));
    await writePngFile(imagePath, decodeImageBuffer(record.image_data_url));
    changed = true;
  }

  if (await fileExists(imagePath) && !(await fileExists(thumbnailPath))) {
    await writeThumbnailFile(imagePath, thumbnailPath);
    changed = true;
  }

  const nextImagePath = await fileExists(imagePath) ? toSaveRelativePath(imagePath) : undefined;
  const nextThumbnailPath = await fileExists(thumbnailPath) ? toSaveRelativePath(thumbnailPath) : undefined;
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
    await writeJsonFile(filePath, nextRecord);
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

  if (!(await fileExists(imagePath)) && record.image_data_url) {
    await ensureDirectory(path.dirname(imagePath));
    await writePngFile(imagePath, decodeImageBuffer(record.image_data_url));
    changed = true;
  }

  if (await fileExists(imagePath) && !(await fileExists(thumbnailPath))) {
    await writeThumbnailFile(imagePath, thumbnailPath);
    changed = true;
  }

  const nextImagePath = await fileExists(imagePath) ? toSaveRelativePath(imagePath) : undefined;
  const nextThumbnailPath = await fileExists(thumbnailPath) ? toSaveRelativePath(thumbnailPath) : undefined;
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
    await writeJsonFile(metadataPath, nextRecord);
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
  await ensureDirectory(VIBE_ROOT);
  const modelDir = path.join(VIBE_ROOT, slugifyModel(input.model));
  await ensureDirectory(modelDir);
  await ensureDirectory(path.join(modelDir, THUMBNAIL_DIRNAME));

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
    image_path: await fileExists(imagePath) ? toSaveRelativePath(imagePath) : undefined,
    thumbnail_path: await fileExists(thumbnailPath) ? toSaveRelativePath(thumbnailPath) : undefined,
    encoded: normalizedEncoded,
    strength: typeof input.strength === 'number' ? input.strength : 0.6,
    information_extracted: typeof input.information_extracted === 'number' ? input.information_extracted : 1,
    created_date: new Date().toISOString(),
  };

  const filePath = path.join(modelDir, `${assetId}.json`);
  await writeJsonFile(filePath, record);
  vibeAssetFileIndex?.set(assetId, filePath);
  return buildStoredAssetResponse(record);
}

/** List all stored vibe payloads, optionally scoped to one model family. */
export async function listNaiVibeAssets(model?: string) {
  await ensureDirectory(VIBE_ROOT);
  const indexedPaths = Array.from((await getVibeAssetFileIndex()).values());
  const targetModelDir = model ? path.join(VIBE_ROOT, slugifyModel(model)) : null;

  const records: StoredNaiVibeAsset[] = [];
  for (const filePath of indexedPaths) {
    if (targetModelDir && path.dirname(filePath) !== targetModelDir) {
      continue;
    }

    const record = await readJsonFile<StoredNaiVibeAsset>(filePath);
    if (!record) {
      continue;
    }

    records.push(await ensureVibeAssetFiles(record, filePath));
  }

  return records
    .sort((left, right) => right.created_date.localeCompare(left.created_date))
    .map((record) => buildStoredAssetResponse(record));
}

async function findVibeAssetFilePath(assetId: string) {
  return (await getVibeAssetFileIndex()).get(assetId) ?? null;
}

async function loadNaiVibeAssetRecord(assetId: string) {
  const filePath = await findVibeAssetFilePath(assetId);
  if (!filePath) {
    return null;
  }

  const record = await readJsonFile<StoredNaiVibeAsset>(filePath);
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
export async function deleteNaiVibeAsset(assetId: string) {
  const filePath = await findVibeAssetFilePath(assetId);
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
    if (await fileExists(targetPath)) {
      await fs.promises.unlink(targetPath);
      deleted = true;
    }
  }

  if (deleted) {
    vibeAssetFileIndex?.delete(assetId);
  }
  return deleted;
}

/** Update one stored vibe payload's editable metadata. */
export async function updateNaiVibeAsset(assetId: string, input: {
  label?: string;
  description?: string;
}) {
  const filePath = await findVibeAssetFilePath(assetId);
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

  await writeJsonFile(filePath, nextRecord);
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
  await ensureDirectory(CHARACTER_REFERENCE_ROOT);
  await ensureDirectory(CHARACTER_REFERENCE_LETTERBOX_ROOT);
  await ensureDirectory(CHARACTER_REFERENCE_THUMBNAIL_ROOT);

  const imageBuffer = decodeImageBuffer(input.image);
  const assetId = sha256(input.image);
  const originalPath = path.join(CHARACTER_REFERENCE_ROOT, `${assetId}.png`);
  const thumbnailPath = path.join(CHARACTER_REFERENCE_THUMBNAIL_ROOT, `${assetId}.webp`);
  const letterboxedPath = path.join(CHARACTER_REFERENCE_LETTERBOX_ROOT, `${assetId}.png`);
  const letterboxedPng = await buildLetterboxedPng(imageBuffer);

  await writePngFile(originalPath, imageBuffer);
  await writeThumbnailFile(imageBuffer, thumbnailPath);
  await fs.promises.writeFile(letterboxedPath, letterboxedPng);

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
  await writeJsonFile(metadataPath, metadata);
  characterAssetMetadataIndex?.set(assetId, metadataPath);
  return buildStoredAssetResponse(metadata);
}

/** List all saved character-reference assets. */
export async function listNaiCharacterReferenceAssets() {
  await ensureDirectory(CHARACTER_REFERENCE_ROOT);
  const records: StoredNaiCharacterReferenceAsset[] = [];

  const metadataPaths = Array.from((await getCharacterAssetMetadataIndex()).values());
  for (const metadataPath of metadataPaths) {
    const record = await readJsonFile<StoredNaiCharacterReferenceAsset>(metadataPath);
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
export async function deleteNaiCharacterReferenceAsset(assetId: string) {
  const targets = [
    path.join(CHARACTER_REFERENCE_ROOT, `${assetId}.png`),
    path.join(CHARACTER_REFERENCE_ROOT, `${assetId}.json`),
    path.join(CHARACTER_REFERENCE_LETTERBOX_ROOT, `${assetId}.png`),
    path.join(CHARACTER_REFERENCE_THUMBNAIL_ROOT, `${assetId}.webp`),
  ];

  let deleted = false;
  for (const targetPath of targets) {
    if (await fileExists(targetPath)) {
      await fs.promises.unlink(targetPath);
      deleted = true;
    }
  }

  if (deleted) {
    characterAssetMetadataIndex?.delete(assetId);
  }
  return deleted;
}

/** Update one stored character-reference asset's editable metadata. */
export async function updateNaiCharacterReferenceAsset(assetId: string, input: {
  label?: string;
  description?: string;
}) {
  const metadataPath = path.join(CHARACTER_REFERENCE_ROOT, `${assetId}.json`);
  if (!(await fileExists(metadataPath))) {
    return null;
  }

  const record = await readJsonFile<StoredNaiCharacterReferenceAsset>(metadataPath);
  if (!record) {
    return null;
  }

  const hydratedRecord = await ensureCharacterReferenceAssetFiles(record, metadataPath);
  const nextRecord: StoredNaiCharacterReferenceAsset = {
    ...hydratedRecord,
    label: input.label?.trim() || hydratedRecord.label,
    description: input.description?.trim() || undefined,
  };

  await writeJsonFile(metadataPath, nextRecord);
  return buildStoredAssetResponse(nextRecord);
}
