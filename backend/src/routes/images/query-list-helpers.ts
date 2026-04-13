import fs from 'fs';
import { resolveUploadsPath } from '../../config/runtimePaths';
import { ImageFileModel } from '../../models/Image/ImageFileModel';
import { MediaMetadataModel } from '../../models/Image/MediaMetadataModel';
import type { ImageSearchParamsInput } from '../../models/Image/ImageSearchHelpers';
import { QueryCacheService } from '../../services/QueryCacheService';
import { ImageSafetyService } from '../../services/imageSafetyService';
import type { ImageFileRecord, ImageListResponse, ImageMetadataRecord } from '../../types/image';
import { enrichCompactImageWithFileView, enrichImageWithFileView } from './utils';

type ImageListData = NonNullable<ImageListResponse['data']>;
type ImageListItem = ReturnType<typeof enrichCompactImageWithFileView>;

export interface BatchThumbnailLookupResult {
  success: boolean;
  thumbnailPath?: string;
  mimeType?: string;
  error?: string;
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

/** Build the shared image-list payload while preserving route-specific paging overrides. */
export function buildImageListResponse(
  images: ImageListItem[],
  total: number,
  page: number,
  limit: number,
  options?: {
    hasMore?: boolean;
    totalPages?: number;
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
export function sortImagesByCompositeHashes(compositeHashes: string[], images: ImageListItem[]): ImageListItem[] {
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

/** Load metadata through the existing cache path before falling back to the DB. */
function findCachedMetadataByHash(hash: string): ImageMetadataRecord | null {
  const cached = QueryCacheService.getMetadataCache(hash);
  if (cached) {
    return cached as ImageMetadataRecord;
  }

  const metadata = MediaMetadataModel.findByHash(hash);
  if (metadata) {
    QueryCacheService.setMetadataCache(hash, metadata);
  }

  return metadata;
}

/** Resolve the best thumbnail path for non-video files without changing fallback order. */
function resolveThumbnailPath(metadata: ImageMetadataRecord, file: ImageFileRecord): string {
  if (metadata.thumbnail_path && fs.existsSync(resolveUploadsPath(metadata.thumbnail_path))) {
    return metadata.thumbnail_path;
  }

  return file.original_file_path;
}

/** Build one batch-thumbnail lookup result while keeping per-hash failures isolated. */
function buildBatchThumbnailLookupResult(hash: string): BatchThumbnailLookupResult {
  try {
    const metadata = findCachedMetadataByHash(hash);
    if (!metadata) {
      return { success: false, error: 'Not found' };
    }

    if (ImageSafetyService.isHidden(metadata.rating_score)) {
      return { success: false, error: 'Hidden by safety policy' };
    }

    const files = ImageFileModel.findActiveByHash(hash);
    if (files.length === 0) {
      return { success: false, error: 'File not found' };
    }

    const file = files[0];
    if (file.mime_type && file.mime_type.startsWith('video/')) {
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

  hashes.forEach((hash) => {
    results[hash] = buildBatchThumbnailLookupResult(hash);
  });

  return results;
}
