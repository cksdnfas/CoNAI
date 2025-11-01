import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { ImageProcessor } from '../../services/imageProcessor';
import { ImageMetadataModel } from '../../models/Image/ImageMetadataModel';
import { ImageFileModel } from '../../models/Image/ImageFileModel';
import { PromptCollectionService } from '../../services/promptCollectionService';
import { runtimePaths } from '../../config/runtimePaths';
import { successResponse, errorResponse } from '@comfyui-image-manager/shared';
import { QueryCacheService } from '../../services/QueryCacheService';

const router = Router();
const UPLOAD_BASE_PATH = runtimePaths.uploadsDir;

/**
 * 이미지 삭제 (composite_hash 기반, 새 구조)
 * DELETE /api/images/:compositeHash
 */
router.delete('/:compositeHash', asyncHandler(async (req: Request, res: Response) => {
  try {
    const compositeHash = req.params.compositeHash;

    if (!compositeHash || compositeHash.length !== 48) {
      return res.status(400).json(errorResponse('Invalid composite hash'));
    }

    // 메타데이터 조회
    const metadata = await ImageMetadataModel.findByHash(compositeHash);

    if (!metadata) {
      return res.status(404).json(errorResponse('Image not found'));
    }

    // 파일 경로 조회
    const files = await ImageFileModel.findActiveByHash(compositeHash);

    // 프롬프트 사용 횟수 감산 (비동기로 처리, 오류가 있어도 삭제는 계속 진행)
    try {
      console.log('🔍 Removing prompts from collection...');
      await PromptCollectionService.removeFromImage(
        metadata.prompt || null,
        metadata.negative_prompt || null
      );
      console.log('✅ Prompts removed from collection successfully');
    } catch (promptError) {
      console.warn('⚠️ Failed to remove prompts from collection (non-critical):', promptError);
    }

    // 파일 삭제 (비디오와 이미지 구분)
    if (files.length > 0) {
      const mimeType = files[0].mime_type;
      const isVideo = mimeType?.startsWith('video/');

      if (isVideo) {
        const { VideoProcessor } = await import('../../services/videoProcessor');
        // 모든 파일에 대해 삭제 시도
        for (const file of files) {
          try {
            await VideoProcessor.deleteVideoFiles(
              file.original_file_path,
              metadata.thumbnail_path || '',
              metadata.optimized_path || '',
              UPLOAD_BASE_PATH
            );
          } catch (fileError) {
            console.warn(`⚠️ Failed to delete video file: ${file.original_file_path}`, fileError);
          }
        }
      } else {
        // 이미지 파일 삭제
        for (const file of files) {
          try {
            await ImageProcessor.deleteImageFiles(
              file.original_file_path,
              metadata.thumbnail_path || '',
              metadata.optimized_path || '',
              UPLOAD_BASE_PATH
            );
          } catch (fileError) {
            console.warn(`⚠️ Failed to delete image file: ${file.original_file_path}`, fileError);
          }
        }
      }
    }

    // 데이터베이스에서 삭제 (CASCADE로 image_files, image_groups도 자동 삭제)
    const deleted = await ImageMetadataModel.delete(compositeHash);

    if (deleted) {
      // 캐시 무효화 (삭제 성공 시)
      QueryCacheService.invalidateImageCache(compositeHash);
      console.log('🗑️ Cache invalidated for deleted image');

      return res.json(successResponse({ message: 'Image deleted successfully' }));
    } else {
      return res.status(500).json(errorResponse('Failed to delete image from database'));
    }
  } catch (error) {
    console.error('Delete image error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to delete image';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

export { router as managementRoutes };
