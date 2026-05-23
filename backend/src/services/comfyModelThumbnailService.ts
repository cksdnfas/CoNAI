import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { runtimePaths } from '../config/runtimePaths';
import { ComfyUIServerModel } from '../models/ComfyUIServer';
import { normalizeComfyModelOptionPath } from './comfyDropdownAutoCollectionService';
import { ImageProcessor } from './imageProcessor';

const SUPPORTED_PREVIEW_FOLDERS = new Set(['checkpoints', 'loras', 'diffusion_models', 'unet_gguf']);
const NEGATIVE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PREVIEW_SOURCE_BYTES = 16 * 1024 * 1024;

type ComfyModelFileRecord = {
  name: string;
  pathIndex: number;
  modified: number | string;
  size: number | string;
};

export type ComfyModelThumbnailResolveInput = {
  folder: unknown;
  value: unknown;
};

export type ComfyModelThumbnailResolveResult =
  | { status: 'ok'; filePath: string; cacheKey: string }
  | { status: 'invalid'; message: string }
  | { status: 'missing'; message: string }
  | { status: 'unavailable'; message: string };

const inFlightThumbnailResolutions = new Map<string, Promise<ComfyModelThumbnailResolveResult>>();

function getThumbnailCacheRoot() {
  return path.join(runtimePaths.tempDir, 'comfy-model-thumbnails');
}

function getThumbnailSourceRoot() {
  return path.join(getThumbnailCacheRoot(), 'sources');
}

function isPlainModelFolder(value: string) {
  return /^[A-Za-z0-9_.-]+$/.test(value);
}

function normalizeFolder(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const folder = value.trim();
  if (!folder || !isPlainModelFolder(folder) || !SUPPORTED_PREVIEW_FOLDERS.has(folder)) {
    return null;
  }

  return folder;
}

function normalizeRequestedModelValue(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = normalizeComfyModelOptionPath(value);
  if (!normalized || normalized.length > 1_024 || normalized.includes('\0')) {
    return null;
  }

  if (/^[A-Za-z]:/.test(normalized) || normalized.startsWith('\\')) {
    return null;
  }

  const parts = normalized.split('\\').filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === '.' || part === '..')) {
    return null;
  }

  return normalized;
}

function parseModelRecord(value: unknown): ComfyModelFileRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.name !== 'string' || !record.name.trim()) {
    return null;
  }

  const pathIndex = Number(record.pathIndex ?? record.path_index);
  if (!Number.isInteger(pathIndex) || pathIndex < 0) {
    return null;
  }

  return {
    name: record.name,
    pathIndex,
    modified: typeof record.modified === 'number' || typeof record.modified === 'string' ? record.modified : 0,
    size: typeof record.size === 'number' || typeof record.size === 'string' ? record.size : 0,
  };
}

function parseModelList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(parseModelRecord).filter((record): record is ComfyModelFileRecord => record !== null);
}

function buildCacheKey(input: {
  serverId: number;
  folder: string;
  modelName: string;
  pathIndex: number;
  modified: number | string;
  size: number | string;
}) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ version: 2, ...input }))
    .digest('hex');
}

function getCachePaths(cacheKey: string) {
  const root = getThumbnailCacheRoot();
  return {
    imagePath: path.join(root, `${cacheKey}.webp`),
    missingPath: path.join(root, `${cacheKey}.missing.json`),
    sourcePath: path.join(getThumbnailSourceRoot(), `${cacheKey}.source`),
  };
}

async function readMissingUntil(missingPath: string) {
  try {
    const raw = await fs.promises.readFile(missingPath, 'utf8');
    const parsed = JSON.parse(raw) as { missingUntil?: unknown };
    return typeof parsed.missingUntil === 'number' ? parsed.missingUntil : 0;
  } catch {
    return 0;
  }
}

async function writeMissingMarker(missingPath: string) {
  await fs.promises.mkdir(path.dirname(missingPath), { recursive: true });
  await fs.promises.writeFile(
    missingPath,
    JSON.stringify({ missingUntil: Date.now() + NEGATIVE_CACHE_TTL_MS }, null, 2),
    'utf8',
  );
}

async function removeMissingMarker(missingPath: string) {
  try {
    await fs.promises.rm(missingPath, { force: true });
  } catch {
    // ignore stale cache cleanup failure
  }
}

function encodeComfyFilenameForRoute(modelName: string) {
  return encodeURIComponent(normalizeComfyModelOptionPath(modelName));
}

async function fetchModelList(serverEndpoint: string, folder: string) {
  const response = await axios.get(`/experiment/models/${encodeURIComponent(folder)}`, {
    baseURL: serverEndpoint,
    timeout: 120_000,
    headers: { Accept: 'application/json' },
  });

  return parseModelList(response.data);
}

async function fetchPreviewBuffer(serverEndpoint: string, folder: string, model: ComfyModelFileRecord) {
  const previewPath = [
    '/experiment/models/preview',
    encodeURIComponent(folder),
    encodeURIComponent(String(model.pathIndex)),
    encodeComfyFilenameForRoute(model.name),
  ].join('/');

  const response = await axios.get<ArrayBuffer>(previewPath, {
    baseURL: serverEndpoint,
    timeout: 120_000,
    responseType: 'arraybuffer',
    validateStatus: (status) => status === 200 || status === 404,
    headers: { Accept: 'image/*' },
    maxContentLength: MAX_PREVIEW_SOURCE_BYTES,
  });

  if (response.status === 404) {
    return null;
  }

  const contentType = String(response.headers['content-type'] ?? '').toLowerCase();
  if (!contentType.startsWith('image/')) {
    return null;
  }

  const buffer = Buffer.isBuffer(response.data) ? response.data : Buffer.from(response.data);
  if (buffer.length === 0 || buffer.length > MAX_PREVIEW_SOURCE_BYTES) {
    return null;
  }

  return buffer;
}

async function generateCachedThumbnail(input: {
  serverEndpoint: string;
  folder: string;
  model: ComfyModelFileRecord;
  imagePath: string;
  missingPath: string;
  sourcePath: string;
}) {
  const previewBuffer = await fetchPreviewBuffer(input.serverEndpoint, input.folder, input.model);
  if (!previewBuffer) {
    await writeMissingMarker(input.missingPath);
    return null;
  }

  await fs.promises.mkdir(path.dirname(input.imagePath), { recursive: true });
  await fs.promises.mkdir(path.dirname(input.sourcePath), { recursive: true });
  await fs.promises.writeFile(input.sourcePath, previewBuffer);
  try {
    await ImageProcessor.generateThumbnail(input.sourcePath, input.imagePath);
    await removeMissingMarker(input.missingPath);
  } finally {
    try {
      await fs.promises.rm(input.sourcePath, { force: true });
    } catch {
      // ignore temp source cleanup failure
    }
  }

  return input.imagePath;
}

async function resolveWithCache(input: {
  serverEndpoint: string;
  cacheKey: string;
  folder: string;
  model: ComfyModelFileRecord;
}): Promise<ComfyModelThumbnailResolveResult> {
  const paths = getCachePaths(input.cacheKey);

  if (fs.existsSync(paths.imagePath)) {
    return { status: 'ok', filePath: paths.imagePath, cacheKey: input.cacheKey };
  }

  const missingUntil = await readMissingUntil(paths.missingPath);
  if (missingUntil > Date.now()) {
    return { status: 'missing', message: 'Model thumbnail not found' };
  }

  const existing = inFlightThumbnailResolutions.get(input.cacheKey);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    if (fs.existsSync(paths.imagePath)) {
      return { status: 'ok', filePath: paths.imagePath, cacheKey: input.cacheKey } as ComfyModelThumbnailResolveResult;
    }

    const generatedPath = await generateCachedThumbnail({
      serverEndpoint: input.serverEndpoint,
      folder: input.folder,
      model: input.model,
      ...paths,
    });

    if (!generatedPath) {
      return { status: 'missing', message: 'Model thumbnail not found' } as ComfyModelThumbnailResolveResult;
    }

    return { status: 'ok', filePath: generatedPath, cacheKey: input.cacheKey } as ComfyModelThumbnailResolveResult;
  })();

  inFlightThumbnailResolutions.set(input.cacheKey, promise);
  try {
    return await promise;
  } finally {
    inFlightThumbnailResolutions.delete(input.cacheKey);
  }
}

export async function resolveComfyModelThumbnail(input: ComfyModelThumbnailResolveInput): Promise<ComfyModelThumbnailResolveResult> {
  const folder = normalizeFolder(input.folder);
  if (!folder) {
    return { status: 'invalid', message: 'Invalid ComfyUI model folder' };
  }

  const requestedValue = normalizeRequestedModelValue(input.value);
  if (!requestedValue) {
    return { status: 'invalid', message: 'Invalid ComfyUI model value' };
  }

  const server = ComfyUIServerModel.findDefaultActive() ?? ComfyUIServerModel.findDefault();
  if (!server || server.backend_type === 'modal') {
    return { status: 'unavailable', message: 'Representative ComfyUI server is not available' };
  }

  const modelList = await fetchModelList(server.endpoint, folder);
  const model = modelList.find((entry) => normalizeComfyModelOptionPath(entry.name) === requestedValue);
  if (!model) {
    return { status: 'missing', message: 'Model not found on representative ComfyUI server' };
  }

  const normalizedModelName = normalizeComfyModelOptionPath(model.name);
  const cacheKey = buildCacheKey({
    serverId: server.id,
    folder,
    modelName: normalizedModelName,
    pathIndex: model.pathIndex,
    modified: model.modified,
    size: model.size,
  });

  return resolveWithCache({
    serverEndpoint: server.endpoint,
    cacheKey,
    folder,
    model,
  });
}
