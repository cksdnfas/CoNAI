import type { Request, Response } from 'express';
import { GenerationHistoryModel } from '../../models/GenerationHistory';
import { GenerationHistoryService } from '../../services/generationHistoryService';
import {
  buildBatchDownloadArchive,
  getExistingActiveFilePathOrBlock,
  serveThumbnailOrOriginal,
  streamCacheableFile,
  streamRangeFile,
} from '../images/query-file-helpers';
import {
  buildMissingHistoryFileWarning,
  canAccessHistoryRecord,
  getAccessibleHistoryMediaOrBlock,
  getHistoryCompositeHash,
  parseImageDownloadType,
} from './historyRouteHelpers';

export async function handleHistoryBatchDownload(req: Request, res: Response) {
  const historyIds: number[] = Array.isArray(req.body?.historyIds)
    ? req.body.historyIds
        .map((value: unknown) => Number(value))
        .filter((value: number) => Number.isInteger(value) && value > 0)
    : [];
  const uniqueHistoryIds = Array.from(new Set(historyIds)).slice(0, 500);
  const downloadType = parseImageDownloadType(req.body?.type);

  if (uniqueHistoryIds.length === 0) {
    res.status(400).json({ success: false, error: 'No valid generation history ids provided' });
    return;
  }

  const records = uniqueHistoryIds
    .map((historyId) => GenerationHistoryModel.findByIdWithMetadata(historyId))
    .filter((record): record is Exclude<ReturnType<typeof GenerationHistoryModel.findByIdWithMetadata>, null> => record !== null)
    .filter((record) => canAccessHistoryRecord(req, record));
  const compositeHashes = Array.from(new Set(records.map(getHistoryCompositeHash).filter((hash): hash is string => Boolean(hash))));

  if (compositeHashes.length === 0) {
    res.status(404).json({ success: false, error: 'No downloadable generation history images were found' });
    return;
  }

  const archive = await buildBatchDownloadArchive(compositeHashes, downloadType, { includeHidden: true });
  if (!archive) {
    res.status(404).json({ success: false, error: `No downloadable ${downloadType} files were found` });
    return;
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Length', archive.zipBuffer.length);
  res.setHeader('Content-Disposition', `attachment; filename="${archive.archiveName}"; filename*=UTF-8''${encodeURIComponent(archive.archiveName)}`);
  res.send(archive.zipBuffer);
}

export async function handleHistoryFile(req: Request, res: Response, id: string) {
  const media = await getAccessibleHistoryMediaOrBlock(req, res, id);
  if (!media) {
    return;
  }

  const originalPath = getExistingActiveFilePathOrBlock(res, media.file, {
    missingError: 'File not found on disk',
    warnMessage: buildMissingHistoryFileWarning(media.file.original_file_path),
  });

  if (!originalPath) {
    return;
  }

  const mimeType = media.file.mime_type;
  if (mimeType && mimeType.startsWith('video/')) {
    streamRangeFile(req, res, originalPath, mimeType);
    return;
  }

  await streamCacheableFile(req, res, originalPath, mimeType);
}

export async function handleHistoryThumbnail(req: Request, res: Response, id: string) {
  const media = await getAccessibleHistoryMediaOrBlock(req, res, id);
  if (!media) {
    return;
  }

  await serveThumbnailOrOriginal(req, res, media.compositeHash, media.metadata, media.file);
}

export async function handleHistoryImageUpload(req: Request, res: Response, id: string) {
  if (!req.file) {
    res.status(400).json({
      success: false,
      error: 'No image file uploaded',
    });
    return;
  }

  const history = GenerationHistoryModel.findById(parseInt(id));
  if (!history) {
    res.status(404).json({
      success: false,
      error: 'Generation history not found',
    });
    return;
  }

  await GenerationHistoryService.processAndUploadImage(
    parseInt(id),
    req.file.buffer,
    history.service_type,
  );

  res.json({
    success: true,
    message: 'Image processed and uploaded successfully',
  });
}
