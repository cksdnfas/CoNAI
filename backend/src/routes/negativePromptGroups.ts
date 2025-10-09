import { Router, Request, Response } from 'express';
import { PromptGroupService } from '../services/promptGroupService';
import { PromptGroupResponse } from '../types/promptGroup';

const router = Router();

/**
 * 모든 네거티브 프롬프트 그룹 조회 (프롬프트 수 포함)
 * GET /api/negative-prompt-groups
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { include_hidden = 'false' } = req.query;

    const groups = await PromptGroupService.getAllGroups(
      include_hidden === 'true',
      'negative'
    );

    const response: PromptGroupResponse = {
      success: true,
      data: groups
    };

    return res.json(response);

  } catch (error) {
    console.error('Error getting negative prompt groups:', error);
    const response: PromptGroupResponse = {
      success: false,
      error: 'Failed to get negative prompt groups'
    };
    return res.status(500).json(response);
  }
});

/**
 * 특정 네거티브 프롬프트 그룹 조회
 * GET /api/negative-prompt-groups/:id
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const groupId = id === '0' ? null : parseInt(id);

    if (groupId !== null && isNaN(groupId)) {
      const response: PromptGroupResponse = {
        success: false,
        error: 'Invalid group ID'
      };
      return res.status(400).json(response);
    }

    const group = await PromptGroupService.getGroupById(groupId, 'negative');

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
    console.error('Error getting negative prompt group:', error);
    const response: PromptGroupResponse = {
      success: false,
      error: 'Failed to get negative prompt group'
    };
    return res.status(500).json(response);
  }
});

/**
 * 특정 네거티브 프롬프트 그룹의 프롬프트 목록 조회
 * GET /api/negative-prompt-groups/:id/prompts
 */
router.get('/:id/prompts', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { page = '1', limit = '20' } = req.query;

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
      'negative',
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
    console.error('Error getting negative prompt group prompts:', error);
    const response: PromptGroupResponse = {
      success: false,
      error: 'Failed to get negative prompt group prompts'
    };
    return res.status(500).json(response);
  }
});

/**
 * 새 네거티브 프롬프트 그룹 생성
 * POST /api/negative-prompt-groups
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { group_name, display_order, is_visible } = req.body;

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
        is_visible
      },
      'negative'
    );

    const response: PromptGroupResponse = {
      success: true,
      data: {
        id: groupId,
        message: 'Negative prompt group created successfully'
      }
    };

    return res.status(201).json(response);

  } catch (error) {
    console.error('Error creating negative prompt group:', error);
    const response: PromptGroupResponse = {
      success: false,
      error: 'Failed to create negative prompt group'
    };
    return res.status(500).json(response);
  }
});

/**
 * 네거티브 프롬프트 그룹 정보 업데이트
 * PUT /api/negative-prompt-groups/:id
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { group_name, display_order, is_visible } = req.body;

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
      'negative'
    );

    const response: PromptGroupResponse = {
      success: true,
      data: {
        updated: success,
        message: success ? 'Negative prompt group updated successfully' : 'Group not found'
      }
    };

    return res.json(response);

  } catch (error) {
    console.error('Error updating negative prompt group:', error);
    const response: PromptGroupResponse = {
      success: false,
      error: 'Failed to update negative prompt group'
    };
    return res.status(500).json(response);
  }
});

/**
 * 네거티브 프롬프트 그룹 삭제
 * DELETE /api/negative-prompt-groups/:id
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const groupId = parseInt(id);

    if (isNaN(groupId)) {
      const response: PromptGroupResponse = {
        success: false,
        error: 'Invalid group ID'
      };
      return res.status(400).json(response);
    }

    const success = await PromptGroupService.deleteGroup(groupId, 'negative');

    const response: PromptGroupResponse = {
      success: true,
      data: {
        deleted: success,
        message: success ? 'Negative prompt group deleted successfully' : 'Group not found'
      }
    };

    return res.json(response);

  } catch (error) {
    console.error('Error deleting negative prompt group:', error);
    const response: PromptGroupResponse = {
      success: false,
      error: 'Failed to delete negative prompt group'
    };
    return res.status(500).json(response);
  }
});

/**
 * 네거티브 프롬프트 그룹 순서 일괄 업데이트
 * PUT /api/negative-prompt-groups/reorder
 */
router.put('/reorder', async (req: Request, res: Response) => {
  try {
    const { group_orders } = req.body;

    if (!Array.isArray(group_orders)) {
      const response: PromptGroupResponse = {
        success: false,
        error: 'group_orders must be an array'
      };
      return res.status(400).json(response);
    }

    const updatedCount = await PromptGroupService.updateGroupOrders(group_orders, 'negative');

    const response: PromptGroupResponse = {
      success: true,
      data: {
        updated_count: updatedCount,
        message: `Successfully updated ${updatedCount} negative prompt group orders`
      }
    };

    return res.json(response);

  } catch (error) {
    console.error('Error updating negative prompt group orders:', error);
    const response: PromptGroupResponse = {
      success: false,
      error: 'Failed to update negative prompt group orders'
    };
    return res.status(500).json(response);
  }
});

/**
 * 네거티브 프롬프트를 다른 그룹으로 이동
 * PUT /api/negative-prompt-groups/move-prompt
 */
router.put('/move-prompt', async (req: Request, res: Response) => {
  try {
    const { prompt_id, target_group_id } = req.body;

    if (!prompt_id) {
      const response: PromptGroupResponse = {
        success: false,
        error: 'prompt_id is required'
      };
      return res.status(400).json(response);
    }

    const success = await PromptGroupService.movePromptToGroup(
      parseInt(prompt_id),
      target_group_id ? parseInt(target_group_id) : null,
      'negative'
    );

    const response: PromptGroupResponse = {
      success: true,
      data: {
        moved: success,
        message: success ? 'Negative prompt moved successfully' : 'Prompt not found'
      }
    };

    return res.json(response);

  } catch (error) {
    console.error('Error moving negative prompt:', error);
    const response: PromptGroupResponse = {
      success: false,
      error: 'Failed to move negative prompt'
    };
    return res.status(500).json(response);
  }
});

/**
 * JSON으로 네거티브 프롬프트 그룹 설정 내보내기
 * GET /api/negative-prompt-groups/export
 */
router.get('/export', async (req: Request, res: Response) => {
  try {
    const exportData = await PromptGroupService.exportToJSON('negative');

    // 파일 다운로드 헤더 설정
    const filename = `negative_prompt_groups_${new Date().toISOString().split('T')[0]}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json');

    return res.json(exportData);

  } catch (error) {
    console.error('Error exporting negative prompt groups:', error);
    const response: PromptGroupResponse = {
      success: false,
      error: 'Failed to export negative prompt groups'
    };
    return res.status(500).json(response);
  }
});

/**
 * JSON에서 네거티브 프롬프트 그룹 설정 가져오기
 * POST /api/negative-prompt-groups/import
 */
router.post('/import', async (req: Request, res: Response) => {
  try {
    const importData = req.body;

    if (!importData.groups || !Array.isArray(importData.groups)) {
      const response: PromptGroupResponse = {
        success: false,
        error: 'Invalid import data format'
      };
      return res.status(400).json(response);
    }

    const result = await PromptGroupService.importFromJSON(importData, 'negative');

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
    console.error('Error importing negative prompt groups:', error);
    const response: PromptGroupResponse = {
      success: false,
      error: 'Failed to import negative prompt groups'
    };
    return res.status(500).json(response);
  }
});

export default router;