import { Router, Request, Response } from 'express';
import { routeParam } from './routeParam';
import { PromptGroupService } from '../services/promptGroupService';
import { PromptGroupResponse } from '../types/promptGroup';

const router = Router();

/**
 * 그룹별로 묶인 프롬프트 조회 (배지 표시용)
 * GET /api/prompt-groups/grouped-prompts
 */
router.get('/grouped-prompts', async (req: Request, res: Response) => {
  try {
    const { type = 'positive' } = req.query;

    const result = await PromptGroupService.getGroupedPrompts(type as 'positive' | 'negative');

    const response: PromptGroupResponse = {
      success: true,
      data: result
    };

    return res.json(response);

  } catch (error) {
    console.error('Error getting grouped prompts:', error);
    const response: PromptGroupResponse = {
      success: false,
      error: 'Failed to get grouped prompts'
    };
    return res.status(500).json(response);
  }
});

/**
 * JSON으로 그룹 설정 내보내기
 * GET /api/prompt-groups/export
 */
router.get('/export', async (req: Request, res: Response) => {
  try {
    const { type = 'positive' } = req.query;

    const exportData = await PromptGroupService.exportToJSON(type as 'positive' | 'negative');

    // 파일 다운로드 헤더 설정
    const filename = `prompt_groups_${type}_${new Date().toISOString().split('T')[0]}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json');

    return res.json(exportData);

  } catch (error) {
    console.error('Error exporting groups:', error);
    const response: PromptGroupResponse = {
      success: false,
      error: 'Failed to export groups'
    };
    return res.status(500).json(response);
  }
});

/**
 * 모든 그룹 조회 (프롬프트 수 포함)
 * GET /api/prompt-groups
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const {
      include_hidden = 'false',
      type = 'positive'
    } = req.query;

    const groups = await PromptGroupService.getAllGroups(
      include_hidden === 'true',
      type as 'positive' | 'negative'
    );

    const response: PromptGroupResponse = {
      success: true,
      data: groups
    };

    return res.json(response);

  } catch (error) {
    console.error('Error getting groups:', error);
    const response: PromptGroupResponse = {
      success: false,
      error: 'Failed to get groups'
    };
    return res.status(500).json(response);
  }
});

/**
 * 그룹 순서 일괄 업데이트
 * PUT /api/prompt-groups/reorder
 */
router.put('/reorder', async (req: Request, res: Response) => {
  try {
    const { group_orders, type = 'positive' } = req.body;

    if (!Array.isArray(group_orders)) {
      const response: PromptGroupResponse = {
        success: false,
        error: 'group_orders must be an array'
      };
      return res.status(400).json(response);
    }

    const updatedCount = await PromptGroupService.updateGroupOrders(group_orders, type);

    const response: PromptGroupResponse = {
      success: true,
      data: {
        updated_count: updatedCount,
        message: `Successfully updated ${updatedCount} group orders`
      }
    };

    return res.json(response);

  } catch (error) {
    console.error('Error updating group orders:', error);
    const response: PromptGroupResponse = {
      success: false,
      error: 'Failed to update group orders'
    };
    return res.status(500).json(response);
  }
});

/**
 * 프롬프트를 다른 그룹으로 이동
 * PUT /api/prompt-groups/move-prompt
 */
router.put('/move-prompt', async (req: Request, res: Response) => {
  try {
    const { prompt_id, target_group_id, type = 'positive' } = req.body;

    if (prompt_id === undefined || prompt_id === null) {
      const response: PromptGroupResponse = {
        success: false,
        error: 'prompt_id is required'
      };
      return res.status(400).json(response);
    }

    const result = await PromptGroupService.movePromptToGroup(
      Number(prompt_id),
      target_group_id ? Number(target_group_id) : null,
      type
    );

    const success = result;

    const response: PromptGroupResponse = {
      success: true,
      data: {
        moved: success,
        message: success ? 'Prompt moved successfully' : 'Prompt not found'
      }
    };

    return res.json(response);

  } catch (error) {
    console.error('Error moving prompt:', error);
    const response: PromptGroupResponse = {
      success: false,
      error: 'Failed to move prompt'
    };
    return res.status(500).json(response);
  }
});

/**
 * 특정 그룹 조회
 * GET /api/prompt-groups/:id
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = routeParam(req.params.id);
    const { type = 'positive' } = req.query;

    const groupId = id === '0' ? null : parseInt(id);

    if (groupId !== null && isNaN(groupId)) {
      const response: PromptGroupResponse = {
        success: false,
        error: 'Invalid group ID'
      };
      return res.status(400).json(response);
    }

    const group = await PromptGroupService.getGroupById(groupId, type as 'positive' | 'negative');

    if (!group) {
      const response: PromptGroupResponse = {
        success: false,
        error: 'Group not found'
      };
      return res.status(404).json(response);
    }

    const response: PromptGroupResponse = {
      success: true,
      data: group
    };

    return res.json(response);

  } catch (error) {
    console.error('Error getting group:', error);
    const response: PromptGroupResponse = {
      success: false,
      error: 'Failed to get group'
    };
    return res.status(500).json(response);
  }
});

/**
 * 특정 그룹의 프롬프트 목록 조회
 * GET /api/prompt-groups/:id/prompts
 */
router.get('/:id/prompts', async (req: Request, res: Response) => {
  try {
    const id = routeParam(req.params.id);
    const {
      type = 'positive',
      page = '1',
      limit = '20'
    } = req.query;

    const groupId = id === '0' ? null : parseInt(id);

    if (groupId !== null && isNaN(groupId)) {
      const response: PromptGroupResponse = {
        success: false,
        error: 'Invalid group ID'
      };
      return res.status(400).json(response);
    }

    const result = await PromptGroupService.getPromptsInGroup(
      groupId,
      type as 'positive' | 'negative',
      parseInt(page as string),
      parseInt(limit as string)
    );

    const response: PromptGroupResponse = {
      success: true,
      data: {
        ...result,
        pagination: {
          page: parseInt(page as string),
          limit: parseInt(limit as string),
          total: result.total,
          totalPages: Math.ceil(result.total / parseInt(limit as string))
        }
      }
    };

    return res.json(response);

  } catch (error) {
    console.error('Error getting group prompts:', error);
    const response: PromptGroupResponse = {
      success: false,
      error: 'Failed to get group prompts'
    };
    return res.status(500).json(response);
  }
});

/**
 * 새 그룹 생성
 * POST /api/prompt-groups
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { group_name, display_order, is_visible, parent_id, type = 'positive' } = req.body;

    if (!group_name) {
      const response: PromptGroupResponse = {
        success: false,
        error: 'group_name is required'
      };
      return res.status(400).json(response);
    }

    const groupId = await PromptGroupService.createGroup(
      {
        group_name,
        display_order,
        is_visible,
        parent_id
      },
      type
    );

    const response: PromptGroupResponse = {
      success: true,
      data: {
        id: groupId,
        message: 'Group created successfully'
      }
    };

    return res.status(201).json(response);

  } catch (error) {
    console.error('Error creating group:', error);
    const response: PromptGroupResponse = {
      success: false,
      error: 'Failed to create group'
    };
    return res.status(500).json(response);
  }
});

/**
 * 그룹 정보 업데이트
 * PUT /api/prompt-groups/:id
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = routeParam(req.params.id);
    const { group_name, display_order, is_visible, type = 'positive' } = req.body;

    const groupId = parseInt(id);

    if (isNaN(groupId)) {
      const response: PromptGroupResponse = {
        success: false,
        error: 'Invalid group ID'
      };
      return res.status(400).json(response);
    }

    const success = await PromptGroupService.updateGroup(
      groupId,
      {
        group_name,
        display_order,
        is_visible
      },
      type
    );

    const response: PromptGroupResponse = {
      success: true,
      data: {
        updated: success,
        message: success ? 'Group updated successfully' : 'Group not found'
      }
    };

    return res.json(response);

  } catch (error) {
    console.error('Error updating group:', error);
    const response: PromptGroupResponse = {
      success: false,
      error: 'Failed to update group'
    };
    return res.status(500).json(response);
  }
});

/**
 * 그룹 삭제
 * DELETE /api/prompt-groups/:id
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = routeParam(req.params.id);
    const { type = 'positive' } = req.query;

    const groupId = parseInt(id);

    if (isNaN(groupId)) {
      const response: PromptGroupResponse = {
        success: false,
        error: 'Invalid group ID'
      };
      return res.status(400).json(response);
    }

    const success = await PromptGroupService.deleteGroup(groupId, type as 'positive' | 'negative');

    const response: PromptGroupResponse = {
      success: true,
      data: {
        deleted: success,
        message: success ? 'Group deleted successfully' : 'Group not found'
      }
    };

    return res.json(response);

  } catch (error) {
    console.error('Error deleting group:', error);
    const response: PromptGroupResponse = {
      success: false,
      error: 'Failed to delete group'
    };
    return res.status(500).json(response);
  }
});

/**
 * JSON에서 그룹 설정 가져오기
 * POST /api/prompt-groups/import
 */
router.post('/import', async (req: Request, res: Response) => {
  try {
    const { type = 'positive' } = req.query;
    const importData = req.body;

    if (!importData.groups || !Array.isArray(importData.groups)) {
      const response: PromptGroupResponse = {
        success: false,
        error: 'Invalid import data format'
      };
      return res.status(400).json(response);
    }

    const result = await PromptGroupService.importFromJSON(importData, type as 'positive' | 'negative');

    const response: PromptGroupResponse = {
      success: result.success,
      data: result,
      error: result.success ? undefined : result.message
    };

    if (result.success) {
      return res.json(response);
    } else {
      return res.status(500).json(response);
    }

  } catch (error) {
    console.error('Error importing groups:', error);
    const response: PromptGroupResponse = {
      success: false,
      error: 'Failed to import groups'
    };
    return res.status(500).json(response);
  }
});

export default router;