import { Router, Request, Response } from 'express';
import { GroupModel, ImageGroupModel } from '../models/Group';
import { AutoCollectionService } from '../services/autoCollectionService';
import { GroupResponse, GroupCreateData, GroupUpdateData } from '../types/group';
import { asyncHandler } from '../middleware/errorHandler';
import { enrichImageRecord } from './images/utils';
import path from 'path';
import fs from 'fs';
import { resolveUploadsPath } from '../config/runtimePaths';

const router = Router();

/**
 * 모든 그룹 조회 (통계 포함)
 * GET /api/groups
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  try {
    const groups = await GroupModel.findAllWithStats();

    const response: GroupResponse = {
      success: true,
      data: groups
    };

    return res.json(response);
  } catch (error) {
    console.error('Error getting groups:', error);
    const response: GroupResponse = {
      success: false,
      error: 'Failed to get groups'
    };
    return res.status(500).json(response);
  }
}));

/**
 * 특정 그룹의 썸네일 이미지 조회 (랜덤)
 * GET /api/groups/:id/thumbnail
 */
router.get('/:id/thumbnail', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid group ID'
    } as GroupResponse);
  }

  try {
    const randomImage = await ImageGroupModel.findRandomImageForGroup(id);

    if (!randomImage) {
      return res.status(404).json({
        success: false,
        error: 'No images found in group'
      } as GroupResponse);
    }

    // 썸네일 파일 경로 결정 (thumbnail_path가 있으면 사용, 없으면 원본 사용)
    const imagePath = randomImage.thumbnail_path || randomImage.file_path;
    // uploads 디렉토리 기준으로 절대 경로 생성
    const fullPath = resolveUploadsPath(imagePath);

    // 파일 존재 여부 확인
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({
        success: false,
        error: 'Image file not found'
      } as GroupResponse);
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
    const response: GroupResponse = {
      success: false,
      error: 'Failed to get group thumbnail'
    };
    return res.status(500).json(response);
  }
}));

/**
 * 특정 그룹 조회
 * GET /api/groups/:id
 */
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid group ID'
    } as GroupResponse);
  }

  try {
    const group = await GroupModel.findById(id);

    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found'
      } as GroupResponse);
    }

    const response: GroupResponse = {
      success: true,
      data: group
    };

    return res.json(response);
  } catch (error) {
    console.error('Error getting group:', error);
    const response: GroupResponse = {
      success: false,
      error: 'Failed to get group'
    };
    return res.status(500).json(response);
  }
}));

/**
 * 새 그룹 생성
 * POST /api/groups
 */
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const { name, description, color, parent_id, auto_collect_enabled, auto_collect_conditions } = req.body;

  if (!name) {
    return res.status(400).json({
      success: false,
      error: 'Group name is required'
    } as GroupResponse);
  }

  // 자동수집 조건 유효성 검사
  if (auto_collect_enabled && auto_collect_conditions) {
    const validation = AutoCollectionService.validateConditions(auto_collect_conditions);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: `Invalid auto collection conditions: ${validation.errors.join(', ')}`
      } as GroupResponse);
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

    const response: GroupResponse = {
      success: true,
      data: {
        id: groupId,
        message: 'Group created successfully'
      }
    };

    return res.status(201).json(response);
  } catch (error) {
    console.error('Error creating group:', error);
    const response: GroupResponse = {
      success: false,
      error: (error as Error).message.includes('UNIQUE') ? 'Group name already exists' : 'Failed to create group'
    };
    return res.status(500).json(response);
  }
}));

/**
 * 그룹 업데이트
 * PUT /api/groups/:id
 */
router.put('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const { name, description, color, parent_id, auto_collect_enabled, auto_collect_conditions } = req.body;

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid group ID'
    } as GroupResponse);
  }

  // 자동수집 조건 유효성 검사
  if (auto_collect_enabled && auto_collect_conditions) {
    const validation = AutoCollectionService.validateConditions(auto_collect_conditions);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: `Invalid auto collection conditions: ${validation.errors.join(', ')}`
      } as GroupResponse);
    }
  }

  try {
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
      return res.status(404).json({
        success: false,
        error: 'Group not found'
      } as GroupResponse);
    }

    // 자동수집 조건이 변경된 경우 재실행
    if (auto_collect_enabled && auto_collect_conditions) {
      try {
        await AutoCollectionService.runAutoCollectionForGroup(id);
      } catch (autoCollectError) {
        console.warn('Auto collection failed after group update:', autoCollectError);
      }
    }

    const response: GroupResponse = {
      success: true,
      data: {
        message: 'Group updated successfully'
      }
    };

    return res.json(response);
  } catch (error) {
    console.error('Error updating group:', error);
    const response: GroupResponse = {
      success: false,
      error: (error as Error).message.includes('UNIQUE') ? 'Group name already exists' : 'Failed to update group'
    };
    return res.status(500).json(response);
  }
}));

/**
 * 그룹 삭제
 * DELETE /api/groups/:id
 */
router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid group ID'
    } as GroupResponse);
  }

  try {
    const deleted = await GroupModel.delete(id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Group not found'
      } as GroupResponse);
    }

    const response: GroupResponse = {
      success: true,
      data: {
        message: 'Group deleted successfully'
      }
    };

    return res.json(response);
  } catch (error) {
    console.error('Error deleting group:', error);
    const response: GroupResponse = {
      success: false,
      error: 'Failed to delete group'
    };
    return res.status(500).json(response);
  }
}));

/**
 * 특정 그룹의 이미지 목록 조회
 * GET /api/groups/:id/images
 */
router.get('/:id/images', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const collectionType = req.query.collection_type as 'manual' | 'auto';

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid group ID'
    } as GroupResponse);
  }

  try {
    const result = await ImageGroupModel.findImagesByGroup(id, page, limit, collectionType);

    // URL과 구조화된 메타데이터 추가
    const enrichedImages = result.images.map(enrichImageRecord);

    const response: GroupResponse = {
      success: true,
      data: {
        images: enrichedImages,
        pagination: {
          page,
          limit,
          total: result.total,
          totalPages: Math.ceil(result.total / limit)
        }
      }
    };

    return res.json(response);
  } catch (error) {
    console.error('Error getting group images:', error);
    const response: GroupResponse = {
      success: false,
      error: 'Failed to get group images'
    };
    return res.status(500).json(response);
  }
}));

/**
 * 이미지를 그룹에 수동 추가
 * POST /api/groups/:id/images
 */
router.post('/:id/images', asyncHandler(async (req: Request, res: Response) => {
  const groupId = parseInt(req.params.id);
  const { image_id, order_index = 0 } = req.body;

  if (isNaN(groupId) || !image_id) {
    return res.status(400).json({
      success: false,
      error: 'Group ID and image ID are required'
    } as GroupResponse);
  }

  try {
    // 이미 그룹에 속해있는지 확인
    const alreadyInGroup = await ImageGroupModel.isImageInGroup(groupId, image_id);
    if (alreadyInGroup) {
      return res.status(409).json({
        success: false,
        error: 'Image is already in the group'
      } as GroupResponse);
    }

    await ImageGroupModel.addImageToGroup(groupId, image_id, 'manual', order_index);

    const response: GroupResponse = {
      success: true,
      data: {
        message: 'Image added to group successfully'
      }
    };

    return res.status(201).json(response);
  } catch (error) {
    console.error('Error adding image to group:', error);
    const response: GroupResponse = {
      success: false,
      error: 'Failed to add image to group'
    };
    return res.status(500).json(response);
  }
}));

/**
 * 여러 이미지를 그룹에 수동 추가
 * POST /api/groups/:id/images/bulk
 */
router.post('/:id/images/bulk', asyncHandler(async (req: Request, res: Response) => {
  const groupId = parseInt(req.params.id);
  const { image_ids } = req.body;

  if (isNaN(groupId) || !image_ids || !Array.isArray(image_ids) || image_ids.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Group ID and image IDs array are required'
    } as GroupResponse);
  }

  try {
    let addedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    for (const imageId of image_ids) {
      try {
        // 이미 그룹에 속해있는지 확인
        const alreadyInGroup = await ImageGroupModel.isImageInGroup(groupId, imageId);
        if (alreadyInGroup) {
          skippedCount++;
          continue;
        }

        await ImageGroupModel.addImageToGroup(groupId, imageId, 'manual', 0);
        addedCount++;
      } catch (error) {
        errors.push(`Image ${imageId}: ${(error as Error).message}`);
      }
    }

    const response: GroupResponse = {
      success: true,
      data: {
        message: `Bulk add completed: ${addedCount} added, ${skippedCount} skipped`,
        added_count: addedCount,
        skipped_count: skippedCount,
        errors: errors.length > 0 ? errors : undefined
      }
    };

    return res.status(201).json(response);
  } catch (error) {
    console.error('Error bulk adding images to group:', error);
    const response: GroupResponse = {
      success: false,
      error: 'Failed to bulk add images to group'
    };
    return res.status(500).json(response);
  }
}));

/**
 * 그룹에서 이미지 제거
 * DELETE /api/groups/:id/images/:imageId
 */
router.delete('/:id/images/:imageId', asyncHandler(async (req: Request, res: Response) => {
  const groupId = parseInt(req.params.id);
  const imageId = parseInt(req.params.imageId);

  if (isNaN(groupId) || isNaN(imageId)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid group ID or image ID'
    } as GroupResponse);
  }

  try {
    const removed = await ImageGroupModel.removeImageFromGroup(groupId, imageId);

    if (!removed) {
      return res.status(404).json({
        success: false,
        error: 'Image not found in group'
      } as GroupResponse);
    }

    const response: GroupResponse = {
      success: true,
      data: {
        message: 'Image removed from group successfully'
      }
    };

    return res.json(response);
  } catch (error) {
    console.error('Error removing image from group:', error);
    const response: GroupResponse = {
      success: false,
      error: 'Failed to remove image from group'
    };
    return res.status(500).json(response);
  }
}));

/**
 * 그룹의 자동수집 실행
 * POST /api/groups/:id/auto-collect
 */
router.post('/:id/auto-collect', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid group ID'
    } as GroupResponse);
  }

  try {
    const result = await AutoCollectionService.runAutoCollectionForGroup(id);

    const response: GroupResponse = {
      success: true,
      data: result
    };

    return res.json(response);
  } catch (error) {
    console.error('Error running auto collection:', error);
    const response: GroupResponse = {
      success: false,
      error: (error as Error).message || 'Failed to run auto collection'
    };
    return res.status(500).json(response);
  }
}));

/**
 * 모든 그룹의 자동수집 실행
 * POST /api/groups/auto-collect-all
 */
router.post('/auto-collect-all', asyncHandler(async (req: Request, res: Response) => {
  try {
    const results = await AutoCollectionService.runAutoCollectionForAllGroups();

    const response: GroupResponse = {
      success: true,
      data: {
        results,
        total_groups: results.length,
        total_images_added: results.reduce((sum, r) => sum + r.images_added, 0),
        total_images_removed: results.reduce((sum, r) => sum + r.images_removed, 0)
      }
    };

    return res.json(response);
  } catch (error) {
    console.error('Error running auto collection for all groups:', error);
    const response: GroupResponse = {
      success: false,
      error: 'Failed to run auto collection for all groups'
    };
    return res.status(500).json(response);
  }
}));

export { router as groupRoutes };