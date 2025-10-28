import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { WildcardModel, WildcardCreateData, WildcardUpdateData } from '../models/Wildcard';
import { WildcardService } from '../services/wildcardService';

const router = Router();

/**
 * 모든 와일드카드 조회
 * GET /api/wildcards
 * Query params:
 *   - withItems: 'true' | 'false' (default: 'true')
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  try {
    const withItems = req.query.withItems !== 'false';

    const wildcards = withItems
      ? WildcardModel.findAllWithItems()
      : WildcardModel.findAll();

    return res.json({
      success: true,
      data: wildcards
    });
  } catch (error) {
    console.error('Error getting wildcards:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get wildcards'
    });
  }
}));

/**
 * 특정 와일드카드 조회
 * GET /api/wildcards/:id
 */
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid wildcard ID'
    });
  }

  try {
    const wildcard = WildcardModel.findByIdWithItems(id);

    if (!wildcard) {
      return res.status(404).json({
        success: false,
        error: 'Wildcard not found'
      });
    }

    return res.json({
      success: true,
      data: wildcard
    });
  } catch (error) {
    console.error('Error getting wildcard:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get wildcard'
    });
  }
}));

/**
 * 와일드카드 생성
 * POST /api/wildcards
 * Body: WildcardCreateData
 */
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  try {
    const data: WildcardCreateData = req.body;

    // 유효성 검증
    if (!data.name || typeof data.name !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Name is required'
      });
    }

    // 항목 유효성 검증 (적어도 하나의 도구에 항목이 있어야 함)
    if (!data.items || typeof data.items !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Items object is required'
      });
    }

    const hasComfyuiItems = Array.isArray(data.items.comfyui) && data.items.comfyui.length > 0;
    const hasNaiItems = Array.isArray(data.items.nai) && data.items.nai.length > 0;

    if (!hasComfyuiItems && !hasNaiItems) {
      return res.status(400).json({
        success: false,
        error: 'At least one item is required for either ComfyUI or NAI'
      });
    }

    // 이름 중복 체크
    const existing = WildcardModel.findByName(data.name);
    if (existing) {
      return res.status(409).json({
        success: false,
        error: 'Wildcard with this name already exists'
      });
    }

    // 생성
    const wildcard = WildcardModel.create(data);
    const wildcardWithItems = WildcardModel.findByIdWithItems(wildcard.id);

    // 순환 참조 검사
    const circularPath = WildcardService.detectCircularReference(wildcard.id);
    if (circularPath) {
      return res.status(201).json({
        success: true,
        data: wildcardWithItems,
        warning: `Circular reference detected: ${circularPath.join(' -> ')}`
      });
    }

    return res.status(201).json({
      success: true,
      data: wildcardWithItems
    });
  } catch (error) {
    console.error('Error creating wildcard:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to create wildcard'
    });
  }
}));

/**
 * 와일드카드 수정
 * PUT /api/wildcards/:id
 * Body: WildcardUpdateData
 */
router.put('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid wildcard ID'
    });
  }

  try {
    const data: WildcardUpdateData = req.body;

    // 존재 여부 확인
    const existing = WildcardModel.findById(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Wildcard not found'
      });
    }

    // 이름 중복 체크 (이름 변경 시)
    if (data.name && data.name !== existing.name) {
      const duplicate = WildcardModel.findByName(data.name);
      if (duplicate) {
        return res.status(409).json({
          success: false,
          error: 'Wildcard with this name already exists'
        });
      }
    }

    // 수정
    const wildcard = WildcardModel.update(id, data);
    const wildcardWithItems = WildcardModel.findByIdWithItems(wildcard.id);

    // 순환 참조 검사
    const circularPath = WildcardService.detectCircularReference(wildcard.id);
    if (circularPath) {
      return res.json({
        success: true,
        data: wildcardWithItems,
        warning: `Circular reference detected: ${circularPath.join(' -> ')}`
      });
    }

    return res.json({
      success: true,
      data: wildcardWithItems
    });
  } catch (error) {
    console.error('Error updating wildcard:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update wildcard'
    });
  }
}));

/**
 * 와일드카드 삭제
 * DELETE /api/wildcards/:id
 */
router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid wildcard ID'
    });
  }

  try {
    const deleted = WildcardModel.delete(id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Wildcard not found'
      });
    }

    return res.json({
      success: true,
      message: 'Wildcard deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting wildcard:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to delete wildcard'
    });
  }
}));

/**
 * 와일드카드 파싱 (프리뷰용)
 * POST /api/wildcards/parse
 * Body: { text: string, tool: 'comfyui' | 'nai', count?: number }
 */
router.post('/parse', asyncHandler(async (req: Request, res: Response) => {
  try {
    const { text, tool, count = 1 } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Text is required'
      });
    }

    if (!tool || (tool !== 'comfyui' && tool !== 'nai')) {
      return res.status(400).json({
        success: false,
        error: 'Valid tool is required (comfyui or nai)'
      });
    }

    const parsedCount = Math.min(Math.max(parseInt(count) || 1, 1), 10); // 1-10 범위로 제한

    const results = WildcardService.parseMultiple(text, tool, parsedCount);

    return res.json({
      success: true,
      data: {
        original: text,
        results,
        usedWildcards: WildcardService.extractWildcardNames(text)
      }
    });
  } catch (error) {
    console.error('Error parsing wildcards:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to parse wildcards'
    });
  }
}));

/**
 * 와일드카드 통계
 * GET /api/wildcards/statistics
 */
router.get('/stats/summary', asyncHandler(async (req: Request, res: Response) => {
  try {
    const statistics = WildcardService.getStatistics();

    return res.json({
      success: true,
      data: statistics
    });
  } catch (error) {
    console.error('Error getting wildcard statistics:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get statistics'
    });
  }
}));

/**
 * 순환 참조 검사
 * GET /api/wildcards/:id/circular-check
 */
router.get('/:id/circular-check', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid wildcard ID'
    });
  }

  try {
    const wildcard = WildcardModel.findById(id);
    if (!wildcard) {
      return res.status(404).json({
        success: false,
        error: 'Wildcard not found'
      });
    }

    const circularPath = WildcardService.detectCircularReference(id);

    return res.json({
      success: true,
      data: {
        hasCircularReference: circularPath !== null,
        circularPath: circularPath || []
      }
    });
  } catch (error) {
    console.error('Error checking circular reference:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to check circular reference'
    });
  }
}));

export default router;
