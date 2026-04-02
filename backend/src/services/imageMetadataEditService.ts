import fs from 'fs';
import path from 'path';
import { db } from '../database/init';
import { resolveUploadsPath } from '../config/runtimePaths';
import { ImageFileModel } from '../models/Image/ImageFileModel';
import { ImageMetadataEditRevisionModel } from '../models/Image/ImageMetadataEditRevisionModel';
import { MediaMetadataModel } from '../models/Image/MediaMetadataModel';
import { AIMetadata } from './metadata/types';
import { ImageMetadataWriteService, ImageOutputFormat } from './imageMetadataWriteService';
import { QueryCacheService } from './QueryCacheService';
import { copyToRecycleBin } from '../utils/recycleBin';
import { ImageFileRecord, ImageMetadataRecord } from '../types/image';

export class ImageMetadataEditError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'ImageMetadataEditError';
  }
}

interface EditableImageTarget {
  activeFile: ImageFileRecord;
  metadata: ImageMetadataRecord;
  originalPath: string;
}

export interface PrepareMetadataDownloadInput {
  metadataPatch?: unknown;
  quality?: unknown;
  format?: unknown;
}

export interface PrepareMetadataDownloadResult {
  buffer: Buffer;
  contentType: string;
  downloadName: string;
  metadataRewriteState: 'patched' | 'preserved';
  xmpApplied: boolean;
  exifApplied: boolean;
}

export interface SaveImageMetadataInput {
  metadataPatch?: unknown;
}

export interface SaveImageMetadataResult {
  image: ImageMetadataRecord & {
    file_id: number;
    original_file_path: string;
    file_size: number;
    mime_type: string | null;
    file_type: string;
  };
}

function buildDownloadFileName(originalName: string, format: ImageOutputFormat): string {
  const baseName = path.basename(originalName, path.extname(originalName)) || 'rewritten-image';
  const safeBaseName = baseName.replace(/[\\/:*?"<>|]/g, '_');
  const extension = format === 'jpeg' ? 'jpg' : format;
  return `${safeBaseName}.${extension}`;
}

function buildEditedFileName(originalName: string, format: ImageOutputFormat): string {
  const parsed = path.parse(originalName);
  const extension = format === 'jpeg' ? '.jpg' : `.${format}`;
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const baseName = (parsed.name || 'image').replace(/(?:__metaedit_\d{14})+$/g, '');
  const safeName = baseName.replace(/[\\/:*?"<>|]/g, '_');
  return `${safeName}__metaedit_${stamp}${extension}`;
}

function buildOutputMimeType(format: ImageOutputFormat): string {
  if (format === 'png') {
    return 'image/png';
  }

  if (format === 'jpeg') {
    return 'image/jpeg';
  }

  return 'image/webp';
}

function parseMetadataPatch(value: unknown): Partial<AIMetadata> | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ImageMetadataEditError('metadataPatch must be a JSON object', 400);
  }

  return value as Partial<AIMetadata>;
}

function resolveStoredOutputFormat(file: Pick<ImageFileRecord, 'original_file_path' | 'mime_type'>): ImageOutputFormat {
  const extension = path.extname(file.original_file_path || '').toLowerCase();
  if (extension === '.png') {
    return 'png';
  }

  if (extension === '.jpg' || extension === '.jpeg') {
    return 'jpeg';
  }

  if (extension === '.webp') {
    return 'webp';
  }

  const mimeType = file.mime_type?.toLowerCase();
  if (mimeType === 'image/png') {
    return 'png';
  }

  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
    return 'jpeg';
  }

  if (mimeType === 'image/webp') {
    return 'webp';
  }

  throw new ImageMetadataEditError('Unsupported source image format', 400);
}

function syncRawNaiParameters(rawNaiParameters: string | null, metadataPatch: Partial<AIMetadata>): string | null | undefined {
  if (!rawNaiParameters || !rawNaiParameters.trim()) {
    return rawNaiParameters;
  }

  try {
    const parsed = JSON.parse(rawNaiParameters) as Record<string, any>;
    const nextRaw = { ...parsed };

    const nextPositivePrompt = metadataPatch.positive_prompt !== undefined ? metadataPatch.positive_prompt : metadataPatch.prompt;
    if (nextPositivePrompt !== undefined) {
      if (nextPositivePrompt === null) {
        delete nextRaw.prompt;
        if (nextRaw.v4_prompt?.caption && typeof nextRaw.v4_prompt.caption === 'object') {
          nextRaw.v4_prompt.caption.base_caption = null;
        }
      } else {
        nextRaw.prompt = nextPositivePrompt;
        if (nextRaw.v4_prompt?.caption && typeof nextRaw.v4_prompt.caption === 'object') {
          nextRaw.v4_prompt.caption.base_caption = nextPositivePrompt;
        }
      }
    }

    const nextNegativePrompt = metadataPatch.negative_prompt !== undefined ? metadataPatch.negative_prompt : metadataPatch.uc;
    if (nextNegativePrompt !== undefined) {
      if (nextNegativePrompt === null) {
        delete nextRaw.uc;
        if (nextRaw.v4_negative_prompt?.caption && typeof nextRaw.v4_negative_prompt.caption === 'object') {
          nextRaw.v4_negative_prompt.caption.base_caption = null;
        }
      } else {
        nextRaw.uc = nextNegativePrompt;
        if (nextRaw.v4_negative_prompt?.caption && typeof nextRaw.v4_negative_prompt.caption === 'object') {
          nextRaw.v4_negative_prompt.caption.base_caption = nextNegativePrompt;
        }
      }
    }

    return JSON.stringify(nextRaw);
  } catch {
    return rawNaiParameters;
  }
}

function buildMetadataRecordUpdates(currentMetadata: ImageMetadataRecord, metadataPatch: Partial<AIMetadata>): Partial<ImageMetadataRecord> {
  const prompt = metadataPatch.positive_prompt !== undefined ? metadataPatch.positive_prompt : metadataPatch.prompt;
  const negativePrompt = metadataPatch.negative_prompt !== undefined ? metadataPatch.negative_prompt : metadataPatch.uc;

  return {
    prompt: prompt as string | null | undefined,
    negative_prompt: negativePrompt as string | null | undefined,
    model_name: metadataPatch.model as string | null | undefined,
    steps: metadataPatch.steps as number | null | undefined,
    sampler: metadataPatch.sampler as string | null | undefined,
    raw_nai_parameters: syncRawNaiParameters(currentMetadata.raw_nai_parameters, metadataPatch),
  };
}

function buildEditableMetadataSnapshot(metadata: ImageMetadataRecord) {
  return {
    prompt: metadata.prompt ?? null,
    negative_prompt: metadata.negative_prompt ?? null,
    model_name: metadata.model_name ?? null,
    steps: metadata.steps ?? null,
    sampler: metadata.sampler ?? null,
    raw_nai_parameters: metadata.raw_nai_parameters ?? null,
    metadata_updated_date: metadata.metadata_updated_date,
  };
}

function buildUniqueSiblingPath(targetPath: string): string {
  if (!fs.existsSync(targetPath)) {
    return targetPath;
  }

  const parsed = path.parse(targetPath);
  let index = 1;
  while (true) {
    const candidate = path.join(parsed.dir, `${parsed.name} (${index})${parsed.ext}`);
    if (!fs.existsSync(candidate)) {
      return candidate;
    }
    index += 1;
  }
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function deleteFileWithRetry(filePath: string): Promise<void> {
  const retryDelaysMs = [120, 240, 480, 960, 1600, 2400];
  let lastError: unknown = null;

  for (let attemptIndex = 0; attemptIndex <= retryDelaysMs.length; attemptIndex += 1) {
    try {
      if (!fs.existsSync(filePath)) {
        return;
      }
      await fs.promises.unlink(filePath);
      return;
    } catch (error) {
      lastError = error;
      const code = error && typeof error === 'object' && 'code' in error ? (error as NodeJS.ErrnoException).code : null;
      const shouldRetry = code === 'EBUSY' || code === 'EPERM' || code === 'EACCES' || code === 'UNKNOWN';
      if (!shouldRetry || attemptIndex >= retryDelaysMs.length) {
        break;
      }
      await sleep(retryDelaysMs[attemptIndex]);
    }
  }

  throw lastError;
}

function deleteFileInBackground(filePath: string) {
  const scheduleDelaysMs = [0, 5000, 15000, 30000, 60000, 180000, 300000];

  const runAttempt = (attemptIndex: number) => {
    setTimeout(async () => {
      try {
        await deleteFileWithRetry(filePath);
        console.log(`🧹 Cleaned up replaced source file: ${filePath}`);
      } catch (error) {
        if (attemptIndex + 1 < scheduleDelaysMs.length) {
          runAttempt(attemptIndex + 1);
          return;
        }
        console.warn(`⚠️ Background cleanup still could not delete old file: ${filePath}`, error);
      }
    }, scheduleDelaysMs[attemptIndex]);
  };

  runAttempt(0);
}

async function getEditableImageTarget(compositeHash: string): Promise<EditableImageTarget> {
  const files = await ImageFileModel.findActiveByHash(compositeHash);
  if (!files || files.length === 0) {
    throw new ImageMetadataEditError('File not found', 404);
  }

  const activeFile = files[0];
  if (activeFile.file_type !== 'image') {
    throw new ImageMetadataEditError('Only static images support metadata editing right now', 400);
  }

  const metadata = await MediaMetadataModel.findByHash(compositeHash);
  if (!metadata) {
    throw new ImageMetadataEditError('Metadata not found', 404);
  }

  const originalPath = resolveUploadsPath(activeFile.original_file_path);
  if (!fs.existsSync(originalPath)) {
    ImageFileModel.updateStatus(activeFile.id, 'missing');
    throw new ImageMetadataEditError('Original file not found on disk', 404);
  }

  return {
    activeFile,
    metadata,
    originalPath,
  };
}

export class ImageMetadataEditService {
  /** Build a rewritten image buffer for immediate metadata-download responses. */
  static async prepareMetadataDownload(compositeHash: string, input: PrepareMetadataDownloadInput): Promise<PrepareMetadataDownloadResult> {
    const target = await getEditableImageTarget(compositeHash);
    const metadataPatch = parseMetadataPatch(input.metadataPatch);
    const rawQuality = typeof input.quality === 'number' ? input.quality : Number(input.quality ?? 90);
    const requestedFormat = typeof input.format === 'string' ? input.format.trim().toLowerCase() : '';
    const outputFormat = requestedFormat === 'png' || requestedFormat === 'webp' || requestedFormat === 'jpeg' || requestedFormat === 'jpg'
      ? (requestedFormat === 'jpg' ? 'jpeg' : requestedFormat)
      : resolveStoredOutputFormat(target.activeFile);

    const rewritten = await ImageMetadataWriteService.writeFileAsFormatBuffer(target.originalPath, {
      format: outputFormat,
      quality: Number.isFinite(rawQuality) ? rawQuality : 90,
      sourcePathForMetadata: target.originalPath,
      originalFileName: path.basename(target.activeFile.original_file_path),
      mimeType: target.activeFile.mime_type || buildOutputMimeType(outputFormat),
      metadataPatch,
    });

    return {
      buffer: rewritten.buffer,
      contentType: buildOutputMimeType(outputFormat),
      downloadName: buildDownloadFileName(target.activeFile.original_file_path, outputFormat),
      metadataRewriteState: metadataPatch ? 'patched' : 'preserved',
      xmpApplied: rewritten.xmpApplied,
      exifApplied: rewritten.exifApplied,
    };
  }

  /** Save edited metadata by creating a replacement file, updating DB state, and recording a revision row. */
  static async saveMetadata(compositeHash: string, input: SaveImageMetadataInput): Promise<SaveImageMetadataResult> {
    const target = await getEditableImageTarget(compositeHash);
    const metadataPatch = parseMetadataPatch(input.metadataPatch);

    if (!metadataPatch || Object.keys(metadataPatch).length === 0) {
      throw new ImageMetadataEditError('metadataPatch is required', 400);
    }

    let stagedFilePath: string | null = null;
    let nextFilePath: string | null = null;
    let recycleBinPath: string | null = null;
    let saveCommitted = false;

    try {
      const outputFormat = resolveStoredOutputFormat(target.activeFile);
      const inputBuffer = await fs.promises.readFile(target.originalPath);
      const rewritten = await ImageMetadataWriteService.writeBufferAsFormatBuffer(inputBuffer, {
        format: outputFormat,
        quality: 100,
        lossless: outputFormat === 'webp',
        sourcePathForMetadata: target.originalPath,
        originalFileName: path.basename(target.activeFile.original_file_path),
        mimeType: target.activeFile.mime_type || buildOutputMimeType(outputFormat),
        metadataPatch,
      });

      const targetDirectory = path.dirname(target.originalPath);
      const nextRelativeName = buildEditedFileName(path.basename(target.activeFile.original_file_path), outputFormat);
      nextFilePath = buildUniqueSiblingPath(path.join(targetDirectory, nextRelativeName));
      stagedFilePath = `${nextFilePath}.stage`;

      await fs.promises.writeFile(stagedFilePath, rewritten.buffer);
      await fs.promises.rename(stagedFilePath, nextFilePath);
      stagedFilePath = null;

      recycleBinPath = await copyToRecycleBin(target.originalPath);

      if (!nextFilePath || !recycleBinPath) {
        throw new Error('Replacement paths were not prepared');
      }

      const committedNextFilePath = nextFilePath;
      const committedRecycleBinPath = recycleBinPath;
      const nextFileStat = await fs.promises.stat(committedNextFilePath);
      const metadataUpdates = buildMetadataRecordUpdates(target.metadata, metadataPatch);
      const nextMetadataSnapshot = {
        ...buildEditableMetadataSnapshot(target.metadata),
        ...metadataUpdates,
      };

      let nextImageFileId = 0;

      db.transaction(() => {
        ImageFileModel.updateStatus(target.activeFile.id, 'deleted');
        nextImageFileId = ImageFileModel.create({
          composite_hash: compositeHash,
          file_type: target.activeFile.file_type,
          original_file_path: committedNextFilePath,
          folder_id: target.activeFile.folder_id,
          file_status: 'active',
          file_size: nextFileStat.size,
          mime_type: target.activeFile.mime_type,
          file_modified_date: nextFileStat.mtime.toISOString(),
        });
        MediaMetadataModel.update(compositeHash, metadataUpdates);
        ImageMetadataEditRevisionModel.create({
          composite_hash: compositeHash,
          image_file_id: target.activeFile.id,
          previous_file_path: target.originalPath,
          replacement_file_path: committedNextFilePath,
          recycle_bin_path: committedRecycleBinPath,
          previous_metadata_json: JSON.stringify(buildEditableMetadataSnapshot(target.metadata)),
          next_metadata_json: JSON.stringify(nextMetadataSnapshot),
        });
      })();
      saveCommitted = true;

      void deleteFileInBackground(target.originalPath);
      QueryCacheService.invalidateImageCache(compositeHash, false);

      const updatedMetadata = await MediaMetadataModel.findByHash(compositeHash);
      if (!updatedMetadata) {
        throw new Error('Updated metadata could not be loaded');
      }

      return {
        image: {
          ...updatedMetadata,
          file_id: nextImageFileId,
          original_file_path: committedNextFilePath,
          file_size: nextFileStat.size,
          mime_type: target.activeFile.mime_type,
          file_type: target.activeFile.file_type,
        },
      };
    } catch (error) {
      if (!saveCommitted) {
        if (stagedFilePath && fs.existsSync(stagedFilePath)) {
          await fs.promises.unlink(stagedFilePath).catch(() => undefined);
        }

        if (nextFilePath && fs.existsSync(nextFilePath)) {
          await fs.promises.unlink(nextFilePath).catch(() => undefined);
        }

        if (recycleBinPath && fs.existsSync(recycleBinPath)) {
          await fs.promises.unlink(recycleBinPath).catch(() => undefined);
        }
      }

      throw error;
    }
  }
}
