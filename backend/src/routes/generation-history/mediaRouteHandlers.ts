import type { NextFunction, Request, Response } from 'express';
import { HistoryQueryRepository } from '../../repositories/history/HistoryQueryRepository';
import { GenerationHistoryService } from '../../services/generationHistoryService';
import { audioResultsByQueueJob } from '../../services/audio/audioJobCandidates';
import { sendAudioCandidateFile } from '../audioCandidateFileResponse';
import { MediaMetadataFileQueries } from '../../models/Image/MediaMetadataFileQueries';
import {
  getExistingActiveFilePathOrBlock,
  serveThumbnailOrOriginal,
  streamCacheableFile,
  streamRangeFile,
  streamBatchDownloadArchive,
} from '../images/query-file-helpers';
import { enrichImageWithFileView } from '../images/utils';
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

  const records = HistoryQueryRepository.findAllWithMetadata({ ids: uniqueHistoryIds, limit: uniqueHistoryIds.length })
    .filter((record) => canAccessHistoryRecord(req, record));
  const compositeHashes = Array.from(new Set(records.map(getHistoryCompositeHash).filter((hash): hash is string => Boolean(hash))));

  if (compositeHashes.length === 0) {
    res.status(404).json({ success: false, error: 'No downloadable generation history images were found' });
    return;
  }

  const streamed = await streamBatchDownloadArchive(res, compositeHashes, downloadType, { includeHidden: true });
  if (!streamed) {
    res.status(404).json({ success: false, error: `No downloadable ${downloadType} files were found` });
    return;
  }

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

/**
 * Stream one sound of a history row's run through the history scope (owner check), so the generation page plays it
 * without the audio workspace permission. The candidate must belong to the row's queue job.
 */
export async function handleHistoryAudio(req: Request, res: Response, next: NextFunction, id: string, candidateId: string) {
  const historyId = parseInt(id, 10);
  if (!Number.isInteger(historyId) || historyId <= 0) {
    res.status(400).json({ success: false, error: 'Invalid generation history id' });
    return;
  }

  const record = await GenerationHistoryService.getHistoryDetail(historyId);
  if (!record) {
    res.status(404).json({ success: false, error: 'Generation history not found' });
    return;
  }

  if (!canAccessHistoryRecord(req, record)) {
    res.status(403).json({ success: false, error: 'Not allowed to access this generation history item' });
    return;
  }

  const queueJobId = record.queue_job_id;
  const result = typeof queueJobId === 'number' ? audioResultsByQueueJob([queueJobId]).get(queueJobId)?.find((entry) => entry.id === candidateId) : undefined;
  if (!result) {
    res.status(404).json({ success: false, error: 'Generation history audio not found' });
    return;
  }

  const { audioCandidateFile } = await import('../../services/audio/audioService');
  const { candidate, file } = audioCandidateFile(result.id);
  sendAudioCandidateFile(req, res, next, candidate, file);
}

export async function handleHistoryThumbnail(req: Request, res: Response, id: string) {
  const media = await getAccessibleHistoryMediaOrBlock(req, res, id);
  if (!media) {
    return;
  }

  await serveThumbnailOrOriginal(req, res, media.compositeHash, media.metadata, media.file);
}

/** Return full image detail through the authorized history scope, including hidden-rated media. */
export async function handleHistoryImageDetail(req: Request, res: Response, id: string) {
  const media = await getAccessibleHistoryMediaOrBlock(req, res, id);
  if (!media) {
    return;
  }

  const image = MediaMetadataFileQueries.findByHashWithFile(media.compositeHash, { includeHidden: true });
  if (!image) {
    res.status(404).json({ success: false, error: 'Generation history image not found' });
    return;
  }

  const historyMediaBaseUrl = `/api/generation-history/${media.record.id}`;
  res.json({
    success: true,
    data: {
      ...enrichImageWithFileView(image),
      generation_history_id: media.record.id,
      detail_scope_key: `generation-history:${media.record.id}`,
      detail_url: `${historyMediaBaseUrl}/image`,
      thumbnail_url: `${historyMediaBaseUrl}/thumbnail`,
      image_url: `${historyMediaBaseUrl}/file`,
    },
  });
}
