import { Router, Request, Response } from 'express';
import { ImageSimilarityService } from '../../services/imageSimilarity';
import { asyncHandler } from '../../middleware/errorHandler';
import { successResponse, errorResponse } from '@conai/shared';
import { resolveUploadsPath } from '../../config/runtimePaths';
import fs from 'fs/promises';
import path from 'path';

const router = Router();

/**
 * 이미지 파일의 Composite Hash 생성
 * POST /api/images/generate-hash
 *
 * Body:
 * - file_path: 상대 경로 (uploads/ 기준)
 *
 * 안전장치용: 해시가 없는 이미지에 대해 해시 생성
 */
router.post('/generate-hash', asyncHandler(async (req: Request, res: Response) => {
  const { file_path } = req.body;

  if (!file_path) {
    return res.status(400).json(errorResponse('file_path is required'));
  }

  try {
    const targetPath = file_path;

    // 절대 경로 변환
    const absolutePath = resolveUploadsPath(targetPath);

    // 파일 존재 확인
    try {
      await fs.access(absolutePath);
    } catch {
      return res.status(404).json(errorResponse('Image file not found on disk'));
    }

    // 이미지 타입 확인 (비디오는 다른 처리 필요)
    const ext = path.extname(absolutePath).toLowerCase();
    const videoExtensions = ['.mp4', '.webm', '.mov', '.avi', '.mkv'];
    const animatedExtensions = ['.gif', '.apng'];

    if (videoExtensions.includes(ext) || animatedExtensions.includes(ext)) {
      return res.status(400).json(errorResponse('Video/animated files require different hash generation method'));
    }

    // 해시 생성
    const hashResult = await ImageSimilarityService.generateCompositeHash(absolutePath);

    if (!hashResult || !hashResult.compositeHash) {
      return res.status(500).json(errorResponse('Failed to generate hash'));
    }

    // DB에 해시 저장은 백그라운드 프로세서에 맡김
    // 여기서는 해시 생성만 수행하고 반환

    return res.json(successResponse({
      composite_hash: hashResult.compositeHash,
      perceptual_hash: hashResult.perceptualHash,
      dhash: hashResult.dHash,
      ahash: hashResult.aHash,
      file_path: targetPath,
      saved_to_db: false  // 백그라운드 프로세서가 나중에 저장
    }));
  } catch (error) {
    console.error('Error generating hash:', error);
    return res.status(500).json(errorResponse('Failed to generate hash'));
  }
}));

export default router;
