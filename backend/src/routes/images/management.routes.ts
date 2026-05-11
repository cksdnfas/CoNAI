import { Router, Request, Response } from 'express';
import { routeParam } from '../routeParam';
import { asyncHandler } from '../../middleware/errorHandler';
import { requireAdmin } from '../../middleware/authMiddleware';
import { ImageMetadataEditError, ImageMetadataEditService } from '../../services/imageMetadataEditService';
import { ImageManagementService } from '../../services/imageManagementService';
import { successResponse, errorResponse } from '@conai/shared';
import { enrichImageWithFileView } from './utils';

const router = Router();

function handleMetadataEditError(res: Response, error: unknown, fallbackMessage: string) {
  if (error instanceof ImageMetadataEditError) {
    return res.status(error.status).json(errorResponse(error.message));
  }

  return res.status(500).json(errorResponse(error instanceof Error ? error.message : fallbackMessage));
}

function sendMetadataDownload(res: Response, result: Awaited<ReturnType<typeof ImageMetadataEditService.prepareMetadataDownload>>) {
  const encodedName = encodeURIComponent(result.downloadName);

  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${result.downloadName}"; filename*=UTF-8''${encodedName}`);
  res.setHeader('X-CoNAI-Metadata-Rewrite', result.metadataRewriteState);
  res.setHeader('X-CoNAI-Metadata-XMP', result.xmpApplied ? 'applied' : 'empty');
  res.setHeader('X-CoNAI-Metadata-EXIF', result.exifApplied ? 'applied' : 'empty');

  return res.send(result.buffer);
}

/**
 * 기존 이미지 메타를 수정한 파일을 즉시 다운로드
 */
router.post('/:compositeHash/rewrite-metadata/download', asyncHandler(async (req: Request, res: Response) => {
  const compositeHash = routeParam(req.params.compositeHash);
  if (!compositeHash) {
    return res.status(400).json(errorResponse('Composite hash is required'));
  }

  try {
    const result = await ImageMetadataEditService.prepareMetadataDownload(compositeHash, {
      metadataPatch: req.body?.metadataPatch,
      quality: req.body?.quality,
      format: req.body?.format,
    });

    return sendMetadataDownload(res, result);
  } catch (error) {
    console.error('❌ Existing image metadata download error:', error);
    return handleMetadataEditError(res, error, 'Metadata rewrite download failed');
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

  try {
    const result = await ImageMetadataEditService.saveMetadata(compositeHash, {
      metadataPatch: req.body?.metadataPatch,
    });

    return res.json(successResponse(enrichImageWithFileView(result.image)));
  } catch (error) {
    console.error('❌ Save image metadata error:', error);
    return handleMetadataEditError(res, error, 'Failed to save image metadata');
  }
}));

/**
 * 다중 이미지 삭제 (composite_hash 기반)
 * DELETE /api/images/bulk
 *
 * Body: { compositeHashes: string[] }
 */
router.delete('/bulk', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const { compositeHashes } = req.body as { compositeHashes: string[] };

  if (!Array.isArray(compositeHashes) || compositeHashes.length === 0) {
    return res.status(400).json(errorResponse('compositeHashes array is required'));
  }

  const result = await ImageManagementService.deleteImagesBulk(compositeHashes);

  return res.json(successResponse(result));
}));

/**
 * 이미지 삭제 (composite_hash 기반, 통합 삭제 서비스 사용)
 * DELETE /api/images/:compositeHash
 */
router.delete('/:compositeHash', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const compositeHash = routeParam(req.params.compositeHash);
  const result = await ImageManagementService.deleteImageByCompositeHash(compositeHash);

  res.json(successResponse(result));
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
router.delete('/files/bulk', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const { fileIds } = req.body as { fileIds: number[] };

  if (!Array.isArray(fileIds) || fileIds.length === 0) {
    return res.status(400).json(errorResponse('fileIds array is required'));
  }

  const result = await ImageManagementService.deleteImageFilesBulk(fileIds);

  return res.json(successResponse(result));
}));

export { router as managementRoutes };
