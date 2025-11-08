import { Router, Request, Response } from 'express';
import { GroupModel, ImageGroupModel } from '../models/Group';
import { AutoCollectionService } from '../services/autoCollectionService';
import { ComplexFilterService } from '../services/complexFilterService';
import {
  GroupResponse,
  GroupCreateData,
  GroupUpdateData,
  validateId,
  successResponse,
  errorResponse,
  PAGINATION,
  ComplexFilter,
  AutoCollectCondition
} from '@comfyui-image-manager/shared';
import { asyncHandler } from '../middleware/errorHandler';
import { enrichImageRecord } from './images/utils';
import path from 'path';
import fs from 'fs';
import { resolveUploadsPath } from '../config/runtimePaths';

const router = Router();

/**
 * Validate auto-collect conditions (supports both legacy and ComplexFilter formats)
 */
function validateAutoCollectConditions(conditions: AutoCollectCondition[] | ComplexFilter): { valid: boolean; errors: string[] } {
  // Check if it's ComplexFilter format
  const isComplexFilter = conditions && typeof conditions === 'object' && !Array.isArray(conditions);

  if (isComplexFilter) {
    // Use ComplexFilterService for ComplexFilter validation
    return ComplexFilterService.validateFilter(conditions as ComplexFilter);
  } else {
    // Use AutoCollectionService for legacy format validation
    return AutoCollectionService.validateConditions(conditions as AutoCollectCondition[]);
  }
}

/**
 * 모든 그룹 조회 (통계 포함)
 * GET /api/groups
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  try {
    const groups = await GroupModel.findAllWithStats();
    return res.json(successResponse(groups));
  } catch (error) {
    console.error('Error getting groups:', error);
    return res.status(500).json(errorResponse('Failed to get groups'));
  }
}));

/**
 * 특정 그룹의 썸네일 이미지 조회 (랜덤)
 * GET /api/groups/:id/thumbnail
 */
router.get('/:id/thumbnail', asyncHandler(async (req: Request, res: Response) => {
  try {
    const id = validateId(req.params.id, 'Group ID');

    const randomImage = await ImageGroupModel.findRandomImageForGroup(id);

    if (!randomImage) {
      return res.status(404).json(errorResponse('No images found in group'));
    }

    // 썸네일 파일 경로 사용 (media_metadata에 저장됨)
    if (!randomImage.thumbnail_path) {
      return res.status(404).json(errorResponse('Thumbnail not found for image'));
    }

    const fullPath = resolveUploadsPath(randomImage.thumbnail_path);

    // 파일 존재 여부 확인
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json(errorResponse('Image file not found'));
    }

    // 이미지 파일 직접 전송
    const ext = path.extname(fullPath).toLowerCase();
    let contentType = 'image/jpeg'; // 기본값

    switch (ext) {
      case '.png':
        contentType = 'image/png';
        break;
      case '.gif':
        contentType = 'image/gif';
        break;
      case '.webp':
        contentType = 'image/webp';
        break;
      case '.jpg':
      case '.jpeg':
      default:
        contentType = 'image/jpeg';
        break;
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600'); // 1시간 캐시

    return res.sendFile(fullPath);
  } catch (error) {
    console.error('Error getting group thumbnail:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to get group thumbnail';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

/**
 * 특정 그룹 조회
 * GET /api/groups/:id
 */
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  try {
    const id = validateId(req.params.id, 'Group ID');

    const group = await GroupModel.findById(id);

    if (!group) {
      return res.status(404).json(errorResponse('Group not found'));
    }

    return res.json(successResponse(group));
  } catch (error) {
    console.error('Error getting group:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to get group';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

/**
 * 새 그룹 생성
 * POST /api/groups
 */
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const { name, description, color, parent_id, auto_collect_enabled, auto_collect_conditions } = req.body;

  if (!name) {
    return res.status(400).json(errorResponse('Group name is required'));
  }

  // 자동수집 조건 유효성 검사 (ComplexFilter 지원)
  if (auto_collect_enabled && auto_collect_conditions) {
    const validation = validateAutoCollectConditions(auto_collect_conditions);
    if (!validation.valid) {
      return res.status(400).json(
        errorResponse(`Invalid auto collection conditions: ${validation.errors.join(', ')}`)
      );
    }
  }

  try {
    const groupData: GroupCreateData = {
      name,
      description,
      color,
      parent_id,
      auto_collect_enabled,
      auto_collect_conditions
    };

    const groupId = await GroupModel.create(groupData);

    // 자동수집이 활성화된 경우 즉시 실행
    if (auto_collect_enabled && auto_collect_conditions) {
      try {
        await AutoCollectionService.runAutoCollectionForGroup(groupId);
      } catch (autoCollectError) {
        console.warn('Auto collection failed for new group:', autoCollectError);
      }
    }

    return res.status(201).json(
      successResponse({
        id: groupId,
        message: 'Group created successfully'
      })
    );
  } catch (error) {
    console.error('Error creating group:', error);
    const errorMessage = (error as Error).message.includes('UNIQUE')
      ? 'Group name already exists'
      : 'Failed to create group';
    return res.status(500).json(errorResponse(errorMessage));
  }
}));

/**
 * 그룹 업데이트
 * PUT /api/groups/:id
 */
router.put('/:id', asyncHandler(async (req: Request, res: Response) => {
  try {
    const id = validateId(req.params.id, 'Group ID');
    const { name, description, color, parent_id, auto_collect_enabled, auto_collect_conditions } = req.body;

    // 자동수집 조건 유효성 검사 (ComplexFilter 지원)
    if (auto_collect_enabled && auto_collect_conditions) {
      const validation = validateAutoCollectConditions(auto_collect_conditions);
      if (!validation.valid) {
        return res.status(400).json(
          errorResponse(`Invalid auto collection conditions: ${validation.errors.join(', ')}`)
        );
      }
    }

    const groupData: GroupUpdateData = {
      name,
      description,
      color,
      parent_id,
      auto_collect_enabled,
      auto_collect_conditions
    };

    const updated = await GroupModel.update(id, groupData);

    if (!updated) {
      return res.status(404).json(errorResponse('Group not found'));
    }

    // 자동수집 조건이 변경된 경우 재실행
    if (auto_collect_enabled && auto_collect_conditions) {
      try {
        await AutoCollectionService.runAutoCollectionForGroup(id);
      } catch (autoCollectError) {
        console.warn('Auto collection failed after group update:', autoCollectError);
      }
    }

    return res.json(successResponse({ message: 'Group updated successfully' }));
  } catch (error) {
    console.error('Error updating group:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to update group';
    if ((errorMessage as string).includes('UNIQUE')) {
      return res.status(400).json(errorResponse('Group name already exists'));
    }
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

/**
 * 그룹 삭제
 * DELETE /api/groups/:id
 */
router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  try {
    const id = validateId(req.params.id, 'Group ID');

    const deleted = await GroupModel.delete(id);

    if (!deleted) {
      return res.status(404).json(errorResponse('Group not found'));
    }

    return res.json(successResponse({ message: 'Group deleted successfully' }));
  } catch (error) {
    console.error('Error deleting group:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to delete group';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

/**
 * 특정 그룹의 이미지 목록 조회
 * GET /api/groups/:id/images
 */
router.get('/:id/images', asyncHandler(async (req: Request, res: Response) => {
  try {
    const id = validateId(req.params.id, 'Group ID');
    const page = parseInt(req.query.page as string) || PAGINATION.DEFAULT_PAGE;
    const limit = parseInt(req.query.limit as string) || PAGINATION.GROUP_IMAGES_LIMIT;
    const collectionType = req.query.collection_type as 'manual' | 'auto';

    const result = await ImageGroupModel.findImagesByGroup(id, page, limit, collectionType);

    // URL과 구조화된 메타데이터 추가
    const enrichedImages = result.images.map(enrichImageRecord);

    return res.json(
      successResponse({
        images: enrichedImages,
        pagination: {
          page,
          limit,
          total: result.total,
          totalPages: Math.ceil(result.total / limit)
        }
      })
    );
  } catch (error) {
    console.error('Error getting group images:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to get group images';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

/**
 * 이미지를 그룹에 수동 추가
 * POST /api/groups/:id/images
 */
router.post('/:id/images', asyncHandler(async (req: Request, res: Response) => {
  try {
    const groupId = validateId(req.params.id, 'Group ID');
    const { composite_hash, order_index = 0 } = req.body;

    if (!composite_hash) {
      return res.status(400).json(errorResponse('Composite hash is required'));
    }

    // 이미 그룹에 속해있는지 확인
    const collectionType = await ImageGroupModel.getCollectionType(groupId, composite_hash);

    if (collectionType === 'manual') {
      return res.status(409).json(errorResponse('Image is already manually added to the group'));
    } else if (collectionType === 'auto') {
      // 자동수집된 이미지를 수동으로 전환
      const converted = await ImageGroupModel.convertToManual(groupId, composite_hash);
      if (converted) {
        return res.status(200).json(
          successResponse({
            message: 'Image converted from auto-collection to manual',
            converted: true
          })
        );
      }
    }

    // 그룹에 없는 이미지를 새로 추가
    await ImageGroupModel.addImageToGroup(groupId, composite_hash, 'manual', order_index);

    return res.status(201).json(
      successResponse({
        message: 'Image added to group successfully',
        converted: false
      })
    );
  } catch (error) {
    console.error('Error adding image to group:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to add image to group';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

/**
 * 여러 이미지를 그룹에 수동 추가
 * POST /api/groups/:id/images/bulk
 */
router.post('/:id/images/bulk', asyncHandler(async (req: Request, res: Response) => {
  try {
    const groupId = validateId(req.params.id, 'Group ID');
    const { composite_hashes } = req.body;

    if (!composite_hashes || !Array.isArray(composite_hashes) || composite_hashes.length === 0) {
      return res.status(400).json(errorResponse('Composite hashes array is required'));
    }

    let addedCount = 0;
    let convertedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    for (const compositeHash of composite_hashes) {
      try {
        // 이미 그룹에 속해있는지 확인
        const collectionType = await ImageGroupModel.getCollectionType(groupId, compositeHash);

        if (collectionType === 'manual') {
          skippedCount++;
          continue;
        } else if (collectionType === 'auto') {
          const converted = await ImageGroupModel.convertToManual(groupId, compositeHash);
          if (converted) {
            convertedCount++;
          }
          continue;
        }

        // 그룹에 없는 이미지를 새로 추가
        await ImageGroupModel.addImageToGroup(groupId, compositeHash, 'manual', 0);
        addedCount++;
      } catch (error) {
        errors.push(`Image ${compositeHash}: ${(error as Error).message}`);
      }
    }

    return res.status(201).json(
      successResponse({
        message: `Bulk add completed: ${addedCount} added, ${convertedCount} converted, ${skippedCount} skipped`,
        added_count: addedCount,
        converted_count: convertedCount,
        skipped_count: skippedCount,
        errors: errors.length > 0 ? errors : undefined
      })
    );
  } catch (error) {
    console.error('Error bulk adding images to group:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to bulk add images to group';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

/**
 * 그룹에서 이미지 제거
 * DELETE /api/groups/:id/images/:compositeHash
 *
 * Note: 파라미터 이름은 imageId지만 실제로는 composite_hash를 받습니다
 */
router.delete('/:id/images/:imageId', asyncHandler(async (req: Request, res: Response) => {
  try {
    const groupId = validateId(req.params.id, 'Group ID');
    const compositeHash = req.params.imageId; // composite_hash로 사용

    const removed = await ImageGroupModel.removeImageFromGroup(groupId, compositeHash);

    if (!removed) {
      return res.status(404).json(errorResponse('Image not found in group'));
    }

    return res.json(successResponse({ message: 'Image removed from group successfully' }));
  } catch (error) {
    console.error('Error removing image from group:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to remove image from group';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

/**
 * 그룹의 자동수집 실행
 * POST /api/groups/:id/auto-collect
 */
router.post('/:id/auto-collect', asyncHandler(async (req: Request, res: Response) => {
  try {
    const id = validateId(req.params.id, 'Group ID');

    const result = await AutoCollectionService.runAutoCollectionForGroup(id);

    return res.json(successResponse(result));
  } catch (error) {
    console.error('Error running auto collection:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to run auto collection';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

/**
 * 모든 그룹의 자동수집 실행
 * POST /api/groups/auto-collect-all
 */
router.post('/auto-collect-all', asyncHandler(async (req: Request, res: Response) => {
  try {
    const results = await AutoCollectionService.runAutoCollectionForAllGroups();

    return res.json(
      successResponse({
        results,
        total_groups: results.length,
        total_images_added: results.reduce((sum, r) => sum + r.images_added, 0),
        total_images_removed: results.reduce((sum, r) => sum + r.images_removed, 0)
      })
    );
  } catch (error) {
    console.error('Error running auto collection for all groups:', error);
    return res.status(500).json(errorResponse('Failed to run auto collection for all groups'));
  }
}));

/**
 * 그룹에 속한 모든 이미지 파일 ID 조회 (선택 기능용)
 * GET /api/groups/:id/image-ids
 *
 * Note: image_files.id 배열을 반환 (중복 이미지 개별 선택 가능)
 */
router.get('/:id/image-ids', asyncHandler(async (req: Request, res: Response) => {
  try {
    const id = validateId(req.params.id, 'Group ID');

    const fileIds = await ImageGroupModel.getImageFileIdsForGroup(id);

    return res.json(successResponse({
      ids: fileIds,
      total: fileIds.length
    }));
  } catch (error) {
    console.error('Error getting image IDs from group:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to get image IDs from group';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

/**
 * 그룹의 랜덤 이미지 조회 (전체 이미지 정보 포함)
 * GET /api/groups/:id/random-image
 */
router.get('/:id/random-image', asyncHandler(async (req: Request, res: Response) => {
  try {
    const id = validateId(req.params.id, 'Group ID');

    const randomImage = await ImageGroupModel.findRandomImageForGroup(id);

    if (!randomImage) {
      return res.status(404).json(errorResponse('No images found in group'));
    }

    return res.json(successResponse(enrichImageRecord(randomImage)));
  } catch (error) {
    console.error('Error getting random image from group:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to get random image from group';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
}));

export { router as groupRoutes };
