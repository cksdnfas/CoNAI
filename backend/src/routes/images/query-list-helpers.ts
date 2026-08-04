import fs from 'fs';
import path from 'path';
import { runtimePaths } from '../../config/runtimePaths';
import { ImageFileModel } from '../../models/Image/ImageFileModel';
import { MediaMetadataModel } from '../../models/Image/MediaMetadataModel';
import type { ImageSearchParamsInput } from '../../models/Image/ImageSearchHelpers';
import { ImageSafetyService } from '../../services/imageSafetyService';
import { MediaPostprocessVisibilityService } from '../../services/mediaPostprocessVisibilityService';
import type { ImageFileRecord, ImageListResponse, ImageMetadataRecord } from '../../types/image';
import { enrichCompactImageWithFileView, enrichImageWithFileView } from './utils';

type ImageListData = NonNullable<ImageListResponse['data']>;
type ImageListItem = ReturnType<typeof enrichCompactImageWithFileView>;
const THUMBNAIL_EXISTENCE_CACHE_TTL_MS = 30_000;
const thumbnailExistenceCache = new Map<string, { exists: boolean; expiresAt: number }>();

export interface BatchThumbnailLookupResult {
  success: boolean;
  thumbnailPath?: string;
  mimeType?: string;
  error?: string;
}

type ImageSearchRouteSortBy = 'upload_date' | 'filename' | 'file_size' | 'width' | 'height';
type ImageSearchRouteSortOrder = 'ASC' | 'DESC';

export interface ImageSearchRouteRequest {
  searchParams: ImageSearchParamsInput;
  page: number;
  limit: number;
  sortBy: ImageSearchRouteSortBy;
  sortOrder: ImageSearchRouteSortOrder;
}

export type BatchThumbnailLookupResults = Record<string, BatchThumbnailLookupResult>;

/** Parse the shared image-search body shape without changing existing number coercion. */
export function buildImageSearchParams(body: Record<string, any>): ImageSearchParamsInput {
  return {
    search_text: body.search_text,
    negative_text: body.negative_text,
    ai_tool: body.ai_tool,
    model_name: body.model_name,
    min_width: body.min_width ? parseInt(body.min_width, 10) : undefined,
    max_width: body.max_width ? parseInt(body.max_width, 10) : undefined,
    min_height: body.min_height ? parseInt(body.min_height, 10) : undefined,
    max_height: body.max_height ? parseInt(body.max_height, 10) : undefined,
    min_file_size: body.min_file_size ? parseInt(body.min_file_size, 10) : undefined,
    max_file_size: body.max_file_size ? parseInt(body.max_file_size, 10) : undefined,
    start_date: body.start_date,
    end_date: body.end_date,
    group_id: body.group_id !== undefined ? parseInt(body.group_id, 10) : undefined
  };
}

/** Parse the full advanced-search route payload while preserving existing defaults/coercion. */
export function buildImageSearchRouteRequest(body: Record<string, any>): ImageSearchRouteRequest {
  const page = body.page === undefined ? 1 : body.page;
  const limit = body.limit === undefined ? 20 : body.limit;
  const sortBy = body.sortBy === undefined ? 'first_seen_date' : body.sortBy;
  const sortOrder = body.sortOrder === undefined ? 'DESC' : body.sortOrder;

  return {
    searchParams: buildImageSearchParams(body),
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
    sortBy: (sortBy === 'first_seen_date' ? 'upload_date' : sortBy) as ImageSearchRouteSortBy,
    sortOrder: sortOrder as ImageSearchRouteSortOrder,
  };
}

/** Build the shared image-list payload while preserving route-specific paging overrides. */
export function buildImageListResponse(
  images: ImageListItem[],
  total: number,
  page: number,
  limit: number,
  options?: {
    hasMore?: boolean;
    totalPages?: number;
    totalKnown?: boolean;
    nextCursorDate?: string | null;
    nextCursorValue?: string | number | null;
    nextCursorHash?: string | null;
  }
): ImageListResponse {
  const data: ImageListData = {
    images,
    total,
    page,
    limit,
    totalPages: options?.totalPages ?? (limit > 0 ? Math.ceil(total / limit) : 0)
  };

  if (options?.hasMore !== undefined) {
    data.hasMore = options.hasMore;
  }
  if (options?.totalKnown !== undefined) {
    data.totalKnown = options.totalKnown;
  }
  if (options?.nextCursorDate !== undefined) {
    data.nextCursorDate = options.nextCursorDate;
  }
  if (options?.nextCursorValue !== undefined) {
    data.nextCursorValue = options.nextCursorValue;
  }
  if (options?.nextCursorHash !== undefined) {
    data.nextCursorHash = options.nextCursorHash;
  }

  return {
    success: true,
    data
  };
}

/** Enrich raw rows first, then build the shared list payload. */
export function buildEnrichedImageListResponse(
  items: any[],
  total: number,
  page: number,
  limit: number,
  options?: {
    hasMore?: boolean;
    totalPages?: number;
    totalKnown?: boolean;
    nextCursorDate?: string | null;
    nextCursorValue?: string | number | null;
    nextCursorHash?: string | null;
  }
): ImageListResponse {
  return buildImageListResponse(
    items.map(enrichCompactImageWithFileView),
    total,
    page,
    limit,
    options
  );
}

/** Preserve requested composite-hash ordering after DB batch loads. */
function sortImagesByCompositeHashes(compositeHashes: string[], images: ImageListItem[]): ImageListItem[] {
  const imagesByHash = new Map(images.map((image) => [image.composite_hash, image]));

  return compositeHashes
    .map((hash) => imagesByHash.get(hash))
    .filter((image): image is ImageListItem => !!image);
}

/** Build the ordered batch-image response from one DB batch query result. */
export function buildBatchImageListResponse(compositeHashes: string[], items: any[]): ImageListResponse {
  const enrichedImages = items.map(enrichCompactImageWithFileView);
  const sortedImages = sortImagesByCompositeHashes(compositeHashes, enrichedImages);

  return buildImageListResponse(sortedImages, sortedImages.length, 1, sortedImages.length);
}

/**
 * Absolute location of a stored thumbnail.
 *
 * `media_metadata.thumbnail_path` is relative to the **temp** directory, not the
 * uploads directory. Resolving it against uploads (as this helper used to) made
 * the existence check always fail, so every batch lookup silently degraded to the
 * original file.
 */
function resolveThumbnailFilePath(thumbnailPath: string): string {
  return path.isAbsolute(thumbnailPath) ? thumbnailPath : path.join(runtimePaths.tempDir, thumbnailPath);
}

/** True when the row's stored thumbnail (or video poster) is present on disk. */
function hasStoredThumbnail(metadata: Pick<ImageMetadataRecord, 'thumbnail_path'>): boolean {
  return Boolean(metadata.thumbnail_path) && cachedFileExists(resolveThumbnailFilePath(metadata.thumbnail_path!));
}

/** Resolve the best thumbnail path for non-video files without changing fallback order. */
function resolveThumbnailPath(metadata: ImageMetadataRecord, file: ImageFileRecord): string {
  if (hasStoredThumbnail(metadata)) {
    return metadata.thumbnail_path!;
  }

  return file.original_file_path;
}

/** Cache filesystem existence checks across repeated thumbnail batches. */
function cachedFileExists(filePath: string): boolean {
  const now = Date.now();
  const cached = thumbnailExistenceCache.get(filePath);
  if (cached && cached.expiresAt > now) {
    return cached.exists;
  }

  const exists = fs.existsSync(filePath);
  thumbnailExistenceCache.set(filePath, { exists, expiresAt: now + THUMBNAIL_EXISTENCE_CACHE_TTL_MS });
  return exists;
}

/** Build one batch-thumbnail lookup result while keeping per-hash failures isolated. */
function buildBatchThumbnailLookupResult(
  hash: string,
  metadata: ImageMetadataRecord | undefined,
  file: ImageFileRecord | undefined,
): BatchThumbnailLookupResult {
  try {
    if (!metadata) {
      return { success: false, error: 'Not found' };
    }

    if (!MediaPostprocessVisibilityService.isReadyRecord(metadata)) {
      return { success: false, error: 'Not found' };
    }

    if (ImageSafetyService.isHidden(metadata.rating_score)) {
      return { success: false, error: 'Hidden by safety policy' };
    }

    if (!file) {
      return { success: false, error: 'File not found' };
    }

    // Video rows carry a webp poster frame once Phase 2 (or the backfill job) has
    // produced one. Before HEAVY-2 they always pointed at the original file here,
    // which is why a batch lookup for a page of videos resolved to raw video bytes.
    if (file.mime_type && file.mime_type.startsWith('video/')) {
      if (hasStoredThumbnail(metadata)) {
        return {
          success: true,
          thumbnailPath: metadata.thumbnail_path!,
          mimeType: 'image/webp'
        };
      }

      return {
        success: true,
        thumbnailPath: file.original_file_path,
        mimeType: file.mime_type
      };
    }

    return {
      success: true,
      thumbnailPath: resolveThumbnailPath(metadata, file),
      mimeType: 'image/webp'
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/** Build the batch-thumbnail lookup payload for the full hash list. */
export function buildBatchThumbnailLookupResults(hashes: string[]): BatchThumbnailLookupResults {
  const results: BatchThumbnailLookupResults = {};
  const uniqueHashes = Array.from(new Set(hashes));
  const metadataByHash = new Map(
    MediaMetadataModel.findByHashes(uniqueHashes).map((metadata) => [metadata.composite_hash, metadata]),
  );
  const fileByHash = new Map<string, ImageFileRecord>();

  for (const file of ImageFileModel.findActiveByHashes(uniqueHashes)) {
    if (file.composite_hash && !fileByHash.has(file.composite_hash)) {
      fileByHash.set(file.composite_hash, file);
    }
  }

  hashes.forEach((hash) => {
    results[hash] = buildBatchThumbnailLookupResult(hash, metadataByHash.get(hash), fileByHash.get(hash));
  });

  return results;
}
