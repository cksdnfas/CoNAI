import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import type { Request, Response } from 'express';
import { runtimePaths, resolveUploadsPath } from '../../config/runtimePaths';
import { MediaMetadataModel } from '../../models/Image/MediaMetadataModel';
import { ImageFileModel } from '../../models/Image/ImageFileModel';
import { ImageSafetyService } from '../../services/imageSafetyService';
import { ThumbnailGenerator } from '../../utils/thumbnailGenerator';
import type { ImageFileRecord, ImageMetadataRecord } from '../../types/image';
import {
  getCompositeHashOrBlock,
  getMimeTypeFromFilePath,
  streamCacheableFile,
  streamRangeFile,
} from './query-file-response-helpers';

export { getCompositeHashOrBlock, getMimeTypeFromFilePath, streamCacheableFile, streamRangeFile };

export type ImageDownloadType = 'original' | 'thumbnail';

export const MAX_BATCH_DOWNLOAD_FILE_COUNT = 200;
export const MAX_BATCH_DOWNLOAD_TOTAL_SOURCE_BYTES = 512 * 1024 * 1024;

export class BatchDownloadLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BatchDownloadLimitError';
  }
}

/** Load visible metadata for one image and block hidden-policy access centrally. */
export async function getVisibleMetadataOrBlock(res: Response, compositeHash: string) {
  const metadata = await MediaMetadataModel.findByHash(compositeHash);

  if (!metadata) {
    res.status(404).json({
      success: false,
      error: 'Metadata not found'
    });
    return null;
  }

  if (ImageSafetyService.isHidden(metadata.rating_score)) {
    res.status(403).json({
      success: false,
      error: 'This image is hidden by the current safety policy'
    });
    return null;
  }

  return metadata;
}

/** Load the active file row for one composite hash and send the shared not-found response if absent. */
export async function getActiveFileOrBlock(res: Response, compositeHash: string, errorMessage: string) {
  const files = await ImageFileModel.findActiveByHash(compositeHash);

  if (!files || files.length === 0) {
    res.status(404).json({
      success: false,
      error: errorMessage
    });
    return null;
  }

  return files[0] as ImageFileRecord;
}

/** Resolve the active file path and mark the DB row missing when the file disappeared on disk. */
export function getExistingActiveFilePathOrBlock(
  res: Response,
  file: ImageFileRecord,
  options: {
    missingError: string
    warnMessage?: string
  },
) {
  const filePath = resolveUploadsPath(file.original_file_path);

  if (!fs.existsSync(filePath)) {
    if (options.warnMessage) {
      console.warn(options.warnMessage);
    }
    ImageFileModel.updateStatus(file.id, 'missing');
    res.status(404).json({
      success: false,
      error: options.missingError
    });
    return null;
  }

  return filePath;
}

/** Serve the thumbnail path, regenerate it when missing, or fall back to the original file. */
export async function serveThumbnailOrOriginal(
  req: Request,
  res: Response,
  compositeHash: string,
  metadata: ImageMetadataRecord,
  file: ImageFileRecord,
) {
  const mimeType = file.mime_type;
  const fileType = file.file_type;

  if ((mimeType && mimeType.startsWith('video/')) || fileType === 'animated') {
    const originalPath = getExistingActiveFilePathOrBlock(res, file, {
      missingError: 'Video file not found',
      warnMessage: `[ImageServe] Video file missing on disk: ${resolveUploadsPath(file.original_file_path)}`,
    });

    if (!originalPath) {
      return;
    }

    streamRangeFile(req, res, originalPath, mimeType);
    return;
  }

  let thumbnailPath = metadata.thumbnail_path
    ? path.join(runtimePaths.tempDir, metadata.thumbnail_path)
    : null;

  let serveOriginal = false;

  if (!thumbnailPath || !fs.existsSync(thumbnailPath)) {
    const originalPath = getExistingActiveFilePathOrBlock(res, file, {
      missingError: 'Thumbnail and original file not found',
      warnMessage: `[ImageServe] Both thumbnail and original missing: ${file.original_file_path}`,
    });

    if (!originalPath) {
      return;
    }

    try {
      console.log(`[ImageServe] Regenerating missing thumbnail for ${compositeHash}`);
      const relativeThumbPath = await ThumbnailGenerator.generateThumbnail(originalPath, compositeHash);
      MediaMetadataModel.update(compositeHash, { thumbnail_path: relativeThumbPath });
      thumbnailPath = path.join(runtimePaths.tempDir, relativeThumbPath);

      if (!fs.existsSync(thumbnailPath)) {
        serveOriginal = true;
      }
    } catch (err) {
      console.error(`[ImageServe] Failed to regenerate thumbnail: ${err}`);
      serveOriginal = true;
    }
  }

  if (serveOriginal) {
    const originalPath = getExistingActiveFilePathOrBlock(res, file, {
      missingError: 'Original file not found',
    });

    if (!originalPath) {
      return;
    }

    await streamCacheableFile(req, res, originalPath, mimeType);
    return;
  }

  if (!thumbnailPath) {
    res.status(404).json({ success: false, error: 'Thumbnail path error' });
    return;
  }

  await streamCacheableFile(req, res, thumbnailPath, 'image/webp');
}

async function resolveThumbnailDownloadFile(compositeHash: string, metadata: ImageMetadataRecord, file: ImageFileRecord) {
  let thumbnailPath = metadata.thumbnail_path
    ? path.join(runtimePaths.tempDir, metadata.thumbnail_path)
    : null;

  if (thumbnailPath && fs.existsSync(thumbnailPath)) {
    return {
      filePath: thumbnailPath,
      extension: path.extname(thumbnailPath) || '.webp',
    };
  }

  const originalPath = resolveUploadsPath(file.original_file_path);
  if (!fs.existsSync(originalPath)) {
    return null;
  }

  try {
    const relativeThumbPath = await ThumbnailGenerator.generateThumbnail(originalPath, compositeHash);
    MediaMetadataModel.update(compositeHash, { thumbnail_path: relativeThumbPath });
    const regeneratedPath = path.join(runtimePaths.tempDir, relativeThumbPath);
    if (fs.existsSync(regeneratedPath)) {
      return {
        filePath: regeneratedPath,
        extension: path.extname(regeneratedPath) || '.webp',
      };
    }
  } catch (error) {
    console.error(`[ImageDownload] Failed to regenerate thumbnail for ${file.composite_hash}:`, error);
  }

  return null;
}

export async function resolveDownloadFileForType(
  compositeHash: string,
  metadata: ImageMetadataRecord,
  file: ImageFileRecord,
  downloadType: ImageDownloadType,
) {
  if (downloadType === 'thumbnail') {
    return resolveThumbnailDownloadFile(compositeHash, metadata, file);
  }

  const originalPath = resolveUploadsPath(file.original_file_path);
  if (!fs.existsSync(originalPath)) {
    return null;
  }

  return {
    filePath: originalPath,
    extension: path.extname(file.original_file_path) || '.bin',
  };
}

/** Build a zip archive from visible active files for batch download. */
export async function buildBatchDownloadArchive(
  compositeHashes: string[],
  downloadType: ImageDownloadType = 'original',
  options: { includeHidden?: boolean } = {},
) {
  const zip = new AdmZip();
  const usedNames = new Map<string, number>();
  let addedCount = 0;
  let totalSourceBytes = 0;

  for (const compositeHash of compositeHashes.slice(0, MAX_BATCH_DOWNLOAD_FILE_COUNT)) {
    const metadata = MediaMetadataModel.findByHash(compositeHash);
    if (!metadata || (!options.includeHidden && ImageSafetyService.isHidden(metadata.rating_score))) {
      continue;
    }

    const files = ImageFileModel.findActiveByHash(compositeHash);
    if (files.length === 0) {
      continue;
    }

    const file = files[0];
    const resolved = await resolveDownloadFileForType(compositeHash, metadata, file, downloadType);
    if (!resolved) {
      continue;
    }

    const stats = fs.statSync(resolved.filePath);
    totalSourceBytes += stats.size;
    if (totalSourceBytes > MAX_BATCH_DOWNLOAD_TOTAL_SOURCE_BYTES) {
      throw new BatchDownloadLimitError(`Batch download is limited to ${MAX_BATCH_DOWNLOAD_TOTAL_SOURCE_BYTES} bytes of source files`);
    }

    const parsedName = path.parse(file.original_file_path);
    const baseName = parsedName.name || `${compositeHash}`;
    const extension = downloadType === 'thumbnail'
      ? resolved.extension || '.webp'
      : (parsedName.ext || resolved.extension || '.bin');
    const candidateName = `${baseName}${extension}`;
    const duplicateCount = usedNames.get(candidateName) || 0;
    usedNames.set(candidateName, duplicateCount + 1);
    const finalName = duplicateCount === 0
      ? candidateName
      : `${baseName}-${duplicateCount}${extension}`;

    zip.addLocalFile(resolved.filePath, '', finalName);
    addedCount += 1;
  }

  if (addedCount === 0) {
    return null;
  }

  return {
    archiveName: `conai-images-${downloadType}-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`,
    zipBuffer: zip.toBuffer()
  };
}
