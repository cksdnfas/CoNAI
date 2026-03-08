import { Router, Request, Response } from 'express';
import { MediaMetadataModel } from '../../models/Image/MediaMetadataModel';
import { ImageFileModel } from '../../models/Image/ImageFileModel';
import { asyncHandler } from '../../middleware/errorHandler';
import { successResponse, errorResponse } from '@conai/shared';
import { enrichImageWithFileView } from './utils';

const router = Router();

/**
 * Composite Hash로 메타데이터 조회
 * GET /api/images/metadata/:composite_hash
 *
 * Hash 길이로 이미지/비디오 자동 판단:
 * - 48자: 이미지 (pHash + dHash + aHash)
 * - 32자: 비디오/애니메이션 (MD5)
 */
router.get('/:composite_hash', asyncHandler(async (req: Request, res: Response) => {
  const { composite_hash } = req.params;

  if (!composite_hash) {
    return res.status(400).json(errorResponse('Composite hash is required'));
  }

  // Hash 길이로 타입 판단
  const isVideo = composite_hash.length === 32;
  const isImage = composite_hash.length === 48;

  if (!isVideo && !isImage) {
    return res.status(400).json(errorResponse('Invalid composite hash format'));
  }

  try {
    // 먼저 파일 정보를 조회하여 실제 file_type 확인
    const files = await ImageFileModel.findActiveByHash(composite_hash);
    if (!files || files.length === 0) {
      return res.status(404).json(errorResponse('File not found'));
    }

    // 통합 media_metadata 테이블에서 조회
    const metadata = await MediaMetadataModel.findByHash(composite_hash);

    if (!metadata) {
      return res.status(404).json(errorResponse('Metadata not found'));
    }

    // ImageRecord 구조로 변환 (실제 file_type 사용)
    const enrichedMetadata = enrichImageWithFileView({
      ...metadata,
      file_id: files[0].id,
      original_file_path: files[0].original_file_path,
      file_size: files[0].file_size,
      mime_type: files[0].mime_type,
      file_type: files[0].file_type  // 실제 파일 타입 사용
    });

    return res.json(successResponse(enrichedMetadata));
  } catch (error) {
    console.error('Error fetching metadata:', error);
    return res.status(500).json(errorResponse('Failed to fetch metadata'));
  }
}));

export default router;
