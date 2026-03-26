import fs from 'fs';
import path from 'path';
import { Router, Request, Response } from 'express';
import { routeParam } from '../routeParam';
import { asyncHandler } from '../../middleware/errorHandler';
import { DeletionService } from '../../services/deletionService';
import { ImageMetadataWriteService, ImageOutputFormat } from '../../services/imageMetadataWriteService';
import { AIMetadata } from '../../services/metadata/types';
import { MediaMetadataModel } from '../../models/Image/MediaMetadataModel';
import { ImageFileModel } from '../../models/Image/ImageFileModel';
import { ImageMetadataEditRevisionModel } from '../../models/Image/ImageMetadataEditRevisionModel';
import { db } from '../../database/init';
import { resolveUploadsPath } from '../../config/runtimePaths';
import { successResponse, errorResponse } from '@conai/shared';
import { QueryCacheService } from '../../services/QueryCacheService';
import { enrichImageWithFileView } from './utils';
import { ImageFileRecord, ImageMetadataRecord } from '../../types/image';
import { copyToRecycleBin } from '../../utils/recycleBin';

const router = Router();

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
    throw new Error('metadataPatch must be a JSON object');
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

  throw new Error('Unsupported source image format');
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

async function getEditableImageTarget(compositeHash: string) {
  const files = await ImageFileModel.findActiveByHash(compositeHash);
  if (!files || files.length === 0) {
    return { error: errorResponse('File not found'), status: 404 as const };
  }

  const activeFile = files[0];
  if (activeFile.file_type !== 'image') {
    return { error: errorResponse('Only static images support metadata editing right now'), status: 400 as const };
  }

  const metadata = await MediaMetadataModel.findByHash(compositeHash);
  if (!metadata) {
    return { error: errorResponse('Metadata not found'), status: 404 as const };
  }

  const originalPath = resolveUploadsPath(activeFile.original_file_path);
  if (!fs.existsSync(originalPath)) {
    ImageFileModel.updateStatus(activeFile.id, 'missing');
    return { error: errorResponse('Original file not found on disk'), status: 404 as const };
  }

  return {
    activeFile,
    metadata,
    originalPath,
  };
}

/**
 * 기존 이미지 메타를 수정한 파일을 즉시 다운로드
 */
router.post('/:compositeHash/rewrite-metadata/download', asyncHandler(async (req: Request, res: Response) => {
  const compositeHash = routeParam(req.params.compositeHash);
  if (!compositeHash) {
    return res.status(400).json(errorResponse('Composite hash is required'));
  }

  const target = await getEditableImageTarget(compositeHash);
  if ('error' in target) {
    return res.status(target.status ?? 500).json(target.error);
  }

  try {
    const metadataPatch = parseMetadataPatch(req.body?.metadataPatch);
    const rawQuality = typeof req.body?.quality === 'number' ? req.body.quality : Number(req.body?.quality ?? 90);
    const requestedFormat = typeof req.body?.format === 'string' ? req.body.format.trim().toLowerCase() : '';
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

    const downloadName = buildDownloadFileName(target.activeFile.original_file_path, outputFormat);
    const encodedName = encodeURIComponent(downloadName);

    res.setHeader('Content-Type', buildOutputMimeType(outputFormat));
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"; filename*=UTF-8''${encodedName}`);
    res.setHeader('X-CoNAI-Metadata-Rewrite', metadataPatch ? 'patched' : 'preserved');
    res.setHeader('X-CoNAI-Metadata-XMP', rewritten.xmpApplied ? 'applied' : 'empty');
    res.setHeader('X-CoNAI-Metadata-EXIF', rewritten.exifApplied ? 'applied' : 'empty');

    return res.send(rewritten.buffer);
  } catch (error) {
    console.error('❌ Existing image metadata download error:', error);
    if (error instanceof Error && error.message === 'metadataPatch must be a JSON object') {
      return res.status(400).json(errorResponse(error.message));
    }
    if (error instanceof Error && error.message === 'Unsupported source image format') {
      return res.status(400).json(errorResponse(error.message));
    }
    return res.status(500).json(errorResponse(error instanceof Error ? error.message : 'Metadata rewrite download failed'));
  }
}));

/**
 * 기존 이미지 메타를 원본 파일 + DB에 저장
 */
router.patch('/:compositeHash/metadata', asyncHandler(async (req: Request, res: Response) => {
  const compositeHash = routeParam(req.params.compositeHash);
  if (!compositeHash) {
    return res.status(400).json(errorResponse('Composite hash is required'));
  }

  const target = await getEditableImageTarget(compositeHash);
  if ('error' in target) {
    return res.status(target.status ?? 500).json(target.error);
  }

  let stagedFilePath: string | null = null;
  let nextFilePath: string | null = null;
  let recycleBinPath: string | null = null;
  let saveCommitted = false;

  try {
    const metadataPatch = parseMetadataPatch(req.body?.metadataPatch);
    if (!metadataPatch || Object.keys(metadataPatch).length === 0) {
      return res.status(400).json(errorResponse('metadataPatch is required'));
    }

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

    return res.json(successResponse(enrichImageWithFileView({
      ...updatedMetadata,
      file_id: nextImageFileId,
      original_file_path: committedNextFilePath,
      file_size: nextFileStat.size,
      mime_type: target.activeFile.mime_type,
      file_type: target.activeFile.file_type,
    })));
  } catch (error) {
    console.error('❌ Save image metadata error:', error);

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

    if (error instanceof Error && error.message === 'metadataPatch must be a JSON object') {
      return res.status(400).json(errorResponse(error.message));
    }
    return res.status(500).json(errorResponse(error instanceof Error ? error.message : 'Failed to save image metadata'));
  }
}));

/**
 * 이미지 삭제 (composite_hash 기반, 통합 삭제 서비스 사용)
 * DELETE /api/images/:compositeHash
 *
 * 삭제 전략:
 * - composite_hash 중복 시: image_files 테이블에서만 삭제
 * - composite_hash 단일 시: 파일 + 메타데이터 모두 삭제
 * - RecycleBin 설정에 따라 파일 보호 또는 완전 삭제
 */
router.delete('/:compositeHash', asyncHandler(async (req: Request, res: Response) => {
  const compositeHash = routeParam(req.params.compositeHash);

  // 통합 삭제 서비스 호출
  await DeletionService.deleteImage(compositeHash);

  // 캐시 완전 무효화 (삭제는 모든 페이지에 영향)
  QueryCacheService.invalidateImageCache(compositeHash, true);
  console.log('🗑️ All caches invalidated for deleted image');

  res.json(successResponse({ message: 'Image deleted successfully' }));
}));

/**
 * 개별 파일 일괄 삭제 (file_id 기반)
 * DELETE /api/images/files/bulk
 *
 * Body: { fileIds: number[] }
 *
 * 중복 파일 개별 삭제 지원:
 * - 각 file_id의 물리 파일을 RecycleBin으로 이동
 * - 마지막 파일이면 메타데이터도 정리
 */
router.delete('/files/bulk', asyncHandler(async (req: Request, res: Response) => {
  const { fileIds } = req.body as { fileIds: number[] };

  if (!Array.isArray(fileIds) || fileIds.length === 0) {
    return res.status(400).json(errorResponse('fileIds array is required'));
  }

  console.log(`🗑️ Bulk file deletion requested: ${fileIds.length} files`);

  const results = {
    deleted: 0,
    failed: 0,
    errors: [] as string[]
  };

  // 각 file_id를 순차적으로 삭제
  for (const fileId of fileIds) {
    try {
      const success = await DeletionService.deleteImageFile(fileId);
      if (success) {
        results.deleted++;
      } else {
        results.failed++;
        results.errors.push(`File ${fileId} not found`);
      }
    } catch (error) {
      results.failed++;
      results.errors.push(`File ${fileId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      console.error(`❌ Failed to delete file ${fileId}:`, error);
    }
  }

  // 캐시 완전 무효화
  QueryCacheService.invalidateImageCache(undefined, true);
  console.log('🗑️ All caches invalidated after bulk deletion');

  return res.json(successResponse({
    message: `Deleted ${results.deleted} file(s)`,
    details: results
  }));
}));

export { router as managementRoutes };
