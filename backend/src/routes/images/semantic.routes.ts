import { Router, Request, Response } from 'express';
import { errorResponse, successResponse } from '@conai/shared';
import { asyncHandler, cancellableAsyncHandler } from '../../middleware/asyncHandler';
import { db } from '../../database/init';
import { MediaMetadataModel } from '../../models/Image/MediaMetadataModel';
import { ImageSafetyService } from '../../services/imageSafetyService';
import { MediaPostprocessVisibilityService } from '../../services/mediaPostprocessVisibilityService';
import {
  searchImagesByText,
  imageVectorAvailability,
  similarImagesByVector,
  type ImageVectorHit,
  type SimilarImageBasis,
} from '../../services/embeddings/imageIndex';
import { embeddingFeatureOn } from '../../services/aiWorker/textEmbeddingService';
import { routeParam } from '../routeParam';
import { parseIntegerWithFallback, sendRouteBadRequest } from '../routeValidation';
import { enrichImageWithFileView } from './utils';

/**
 * Embedding-based image search:
 *   GET /api/images/semantic-search?q=&limit=     images matching a description (needs image search on)
 *   GET /api/images/:id/similar-content?limit=    images showing similar things (image vectors)
 *   GET /api/images/:id/similar-style?limit=      images drawn in a similar style (Kaloscope 3 style vectors)
 *   GET /api/images/:id/vector-similarity         { content, style }: which of the two this image can be searched by
 * `similarity` is the cosine score × 100. Hidden rating tiers and unfinished uploads never come back.
 */

const router = Router();
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_QUERY_CHARS = 500;

function parseLimit(value: unknown) {
  return Math.min(MAX_LIMIT, Math.max(1, parseIntegerWithFallback(value, DEFAULT_LIMIT)));
}

/** Full image rows (one active file each) for the hits, in hit order, enriched like the gallery's. */
function hydrate(hits: ImageVectorHit[]) {
  if (hits.length === 0) return [];
  const rows = db.prepare(`
    SELECT im.*, f.id as file_id, f.original_file_path, f.file_size, f.mime_type, f.file_status, f.file_type, f.folder_id, wf.folder_name
    FROM media_metadata im
    LEFT JOIN image_files f ON im.composite_hash = f.composite_hash AND f.file_status = 'active'
    LEFT JOIN watched_folders wf ON f.folder_id = wf.id
    WHERE im.composite_hash IN (${hits.map(() => '?').join(', ')})
    GROUP BY im.composite_hash
  `).all(...hits.map((hit) => hit.compositeHash)) as Array<Record<string, unknown> & { composite_hash: string }>;
  const byHash = new Map(rows.map((row) => [row.composite_hash, row]));
  return hits.flatMap((hit) => {
    const row = byHash.get(hit.compositeHash);
    return row ? [{ image: enrichImageWithFileView(row), similarity: Math.round(hit.score * 1000) / 10 }] : [];
  });
}

router.get('/semantic-search', cancellableAsyncHandler(async (req, res, signal) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!query) {
    sendRouteBadRequest(res, 'q is required');
    return;
  }
  if (!embeddingFeatureOn('imageSearch')) {
    res.status(409).json(errorResponse('Image search is off (settings → embeddings)'));
    return;
  }
  const limit = parseLimit(req.query.limit);
  const hits = await searchImagesByText(query.slice(0, MAX_QUERY_CHARS), limit, { signal });
  if (!hits) {
    res.status(503).json(errorResponse('The embedding model is not available right now'));
    return;
  }
  const images = hydrate(hits);
  res.json(successResponse({ images, total: images.length, query: { q: query, limit } }));
}));

/** The image a per-image request is about, or null after answering 404/403 (missing, unfinished or hidden). */
function visibleTarget(req: Request, res: Response): string | null {
  const compositeHash = routeParam(req.params.id);
  const target = MediaMetadataModel.findByHash(compositeHash);
  if (!target || !MediaPostprocessVisibilityService.isReadyRecord(target)) {
    res.status(404).json(errorResponse('Image metadata not found'));
    return null;
  }
  if (ImageSafetyService.isHidden(target.rating_score)) {
    res.status(403).json(errorResponse('This image is hidden by the current safety policy'));
    return null;
  }
  return compositeHash;
}

function similarRoute(basis: SimilarImageBasis) {
  return asyncHandler(async (req: Request, res: Response) => {
    const compositeHash = visibleTarget(req, res);
    if (!compositeHash) return;
    if (basis === 'content' && !embeddingFeatureOn('imageSearch')) {
      res.status(409).json(errorResponse('Image search is off (settings → embeddings)'));
      return;
    }
    const limit = parseLimit(req.query.limit);
    const hits = similarImagesByVector(compositeHash, basis, limit);
    if (!hits) {
      res.status(409).json(errorResponse(basis === 'style'
        ? 'This image has no style vector yet (Kaloscope runs on it first)'
        : 'This image has no image vector yet (it is still being indexed)'));
      return;
    }
    const similar = hydrate(hits);
    res.json(successResponse({ similar, total: similar.length, query: { imageId: compositeHash, basis, limit } }));
  });
}

router.get('/:id/vector-similarity', asyncHandler(async (req: Request, res: Response) => {
  const compositeHash = visibleTarget(req, res);
  if (!compositeHash) return;
  res.json(successResponse(imageVectorAvailability(compositeHash)));
}));
router.get('/:id/similar-content', similarRoute('content'));
router.get('/:id/similar-style', similarRoute('style'));

export { router as semanticImageRoutes };
