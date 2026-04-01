import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import { runtimePaths } from '../config/runtimePaths';
import { normalizeBase64ImageData } from '../utils/nai/requestBuilder';

export interface StoredNaiVibeAsset {
  id: string;
  label: string;
  description?: string | null;
  model: string;
  image_data_url?: string;
  encoded: string;
  strength: number;
  information_extracted: number;
  created_date: string;
}

export interface StoredNaiCharacterReferenceAsset {
  id: string;
  label: string;
  description?: string | null;
  image_data_url: string;
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

async function toPngDataUrl(imageBuffer: Buffer) {
  const pngBuffer = await sharp(imageBuffer).png().toBuffer();
  return `data:image/png;base64,${pngBuffer.toString('base64')}`;
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

  const normalizedEncoded = input.encoded.trim();
  if (!normalizedEncoded) {
    throw new Error('Encoded vibe data is required');
  }

  const assetId = sha256(`${input.model}:${normalizedEncoded}`);
  const imageBuffer = input.image ? decodeImageBuffer(input.image) : undefined;
  const imageDataUrl = imageBuffer ? await toPngDataUrl(imageBuffer) : undefined;
  const record: StoredNaiVibeAsset = {
    id: assetId,
    label: input.label?.trim() || `vibe-${assetId.slice(0, 8)}`,
    description: input.description?.trim() || undefined,
    model: input.model,
    image_data_url: imageDataUrl,
    encoded: normalizedEncoded,
    strength: typeof input.strength === 'number' ? input.strength : 0.6,
    information_extracted: typeof input.information_extracted === 'number' ? input.information_extracted : 1,
    created_date: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(modelDir, `${assetId}.json`), JSON.stringify(record, null, 2), 'utf8');
  return record;
}

/** List all stored vibe payloads, optionally scoped to one model family. */
export function listNaiVibeAssets(model?: string) {
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
      const record = readJsonFile<StoredNaiVibeAsset>(path.join(targetDir, fileName));
      if (record) {
        records.push(record);
      }
    }
  }

  return records.sort((left, right) => right.created_date.localeCompare(left.created_date));
}

/** Delete one stored vibe payload. */
export function deleteNaiVibeAsset(assetId: string) {
  if (!fs.existsSync(VIBE_ROOT)) {
    return false;
  }

  const directories = fs.readdirSync(VIBE_ROOT, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  for (const directory of directories) {
    const filePath = path.join(VIBE_ROOT, directory.name, `${assetId}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  }

  return false;
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

  const imageBuffer = decodeImageBuffer(input.image);
  const assetId = sha256(input.image);
  const originalPng = await sharp(imageBuffer).png().toBuffer();
  const letterboxedPng = await buildLetterboxedPng(imageBuffer);
  const metadata: StoredNaiCharacterReferenceAsset = {
    id: assetId,
    label: input.label?.trim() || `reference-${assetId.slice(0, 8)}`,
    description: input.description?.trim() || undefined,
    image_data_url: `data:image/png;base64,${originalPng.toString('base64')}`,
    type: input.type || 'character&style',
    strength: typeof input.strength === 'number' ? input.strength : 0.6,
    fidelity: typeof input.fidelity === 'number' ? input.fidelity : 1,
    created_date: new Date().toISOString(),
    has_letterbox: true,
  };

  fs.writeFileSync(path.join(CHARACTER_REFERENCE_ROOT, `${assetId}.png`), originalPng);
  fs.writeFileSync(path.join(CHARACTER_REFERENCE_LETTERBOX_ROOT, `${assetId}.png`), letterboxedPng);
  fs.writeFileSync(path.join(CHARACTER_REFERENCE_ROOT, `${assetId}.json`), JSON.stringify(metadata, null, 2), 'utf8');
  return metadata;
}

/** List all saved character-reference assets. */
export function listNaiCharacterReferenceAssets() {
  ensureDirectory(CHARACTER_REFERENCE_ROOT);
  const records: StoredNaiCharacterReferenceAsset[] = [];

  for (const fileName of fs.readdirSync(CHARACTER_REFERENCE_ROOT).filter((entry) => entry.endsWith('.json'))) {
    const record = readJsonFile<StoredNaiCharacterReferenceAsset>(path.join(CHARACTER_REFERENCE_ROOT, fileName));
    if (record) {
      records.push(record);
    }
  }

  return records.sort((left, right) => right.created_date.localeCompare(left.created_date));
}

/** Delete one stored character-reference asset and its derived files. */
export function deleteNaiCharacterReferenceAsset(assetId: string) {
  const targets = [
    path.join(CHARACTER_REFERENCE_ROOT, `${assetId}.png`),
    path.join(CHARACTER_REFERENCE_ROOT, `${assetId}.json`),
    path.join(CHARACTER_REFERENCE_LETTERBOX_ROOT, `${assetId}.png`),
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
