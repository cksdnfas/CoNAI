import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { ImageProcessor } from '../../services/imageProcessor';
import { ImageModel } from '../../models/Image';
import { PromptCollectionService } from '../../services/promptCollectionService';
import { runtimePaths } from '../../config/runtimePaths';
import { validateId, successResponse, errorResponse } from '@comfyui-image-manager/shared';

const router = Router();
const UPLOAD_BASE_PATH = runtimePaths.uploadsDir;

/**
 * 이미지 삭제
 */
router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  try {
    const id = validateId(req.params.id, 'Image ID');

    // 이미지 정보 조회
    const image = await ImageModel.findById(id);

    if (!image) {
      return res.status(404).json(errorResponse('Image not found'));
    }

    // 프롬프트 사용 횟수 감산 (비동기로 처리, 오류가 있어도 삭제는 계속 진행)
    try {
      console.log('🔍 Removing prompts from collection...');
      await PromptCollectionService.removeFromImage(
        image.prompt || null,
        image.negative_prompt || null
      );
      console.log('✅ Prompts removed from collection successfully');
    } catch (promptError) {
      console.warn('⚠️ Failed to remove prompts from collection (non-critical):', promptError);
    }

    // 파일 삭제 (비디오와 이미지 구분)
    const isVideo = image.mime_type?.startsWith('video/');

    if (isVideo) {
      const { VideoProcessor } = await import('../../services/videoProcessor');
      await VideoProcessor.deleteVideoFiles(
        image.file_path,
        image.thumbnail_path,
        image.optimized_path,
        UPLOAD_BASE_PATH
      );
    } else {
      await ImageProcessor.deleteImageFiles(
        image.file_path,
        image.thumbnail_path,
        image.optimized_path || '',
        UPLOAD_BASE_PATH
      );
    }

    // 데이터베이스에서 삭제
    const deleted = await ImageModel.delete(id);

    if (deleted) {
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
