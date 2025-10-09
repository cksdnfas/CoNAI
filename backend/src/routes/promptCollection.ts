import { Router, Request, Response } from 'express';
import { PromptCollectionService } from '../services/promptCollectionService';
import { PromptCollectionResponse } from '../types/promptCollection';

const router = Router();

/**
 * 프롬프트 검색 (그룹 정보 포함)
 * GET /api/prompt-collection/search
 */
router.get('/search', async (req: Request, res: Response) => {
  try {
    const {
      q: query = '',
      type = 'both',
      page = '1',
      limit = '20',
      sortBy = 'usage_count',
      sortOrder = 'DESC',
      group_id
    } = req.query;

    let groupId: number | null | undefined = undefined;
    if (group_id !== undefined) {
      groupId = group_id === '0' || group_id === 'null' ? null : parseInt(group_id as string);
    }

    const result = await PromptCollectionService.searchPromptsWithGroups(
      query as string,
      type as 'positive' | 'negative' | 'both',
      parseInt(page as string),
      parseInt(limit as string),
      sortBy as 'usage_count' | 'created_at' | 'prompt',
      sortOrder as 'ASC' | 'DESC',
      groupId
    );

    const response: PromptCollectionResponse = {
      success: true,
      data: result.prompts
    };

    res.json({
      ...response,
      group_info: result.group_info,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total: result.total,
        totalPages: Math.ceil(result.total / parseInt(limit as string))
      }
    });
    return;
  } catch (error) {
    console.error('Error in prompt search:', error);
    const response: PromptCollectionResponse = {
      success: false,
      error: 'Failed to search prompts'
    };
    return res.status(500).json(response);
  }
});

/**
 * 동의어 그룹에서 검색
 * GET /api/prompt-collection/search-synonyms
 */
router.get('/search-synonyms', async (req: Request, res: Response) => {
  try {
    const { q: query, type = 'positive' } = req.query;

    if (!query) {
      const response: PromptCollectionResponse = {
        success: false,
        error: 'Query parameter is required'
      };
      return res.status(400).json(response);
    }

    const result = await PromptCollectionService.searchInSynonymGroup(
      query as string,
      type as 'positive' | 'negative'
    );

    const response: PromptCollectionResponse = {
      success: true,
      data: result
    };

    return res.json(response);

  } catch (error) {
    console.error('Error in synonym search:', error);
    const response: PromptCollectionResponse = {
      success: false,
      error: 'Failed to search in synonym group'
    };
    return res.status(500).json(response);
  }
});

/**
 * 프롬프트 통계 조회
 * GET /api/prompt-collection/statistics
 */
router.get('/statistics', async (req: Request, res: Response) => {
  try {
    const statistics = await PromptCollectionService.getStatistics();

    const response: PromptCollectionResponse = {
      success: true,
      data: statistics
    };

    return res.json(response);

  } catch (error) {
    console.error('Error getting statistics:', error);
    const response: PromptCollectionResponse = {
      success: false,
      error: 'Failed to get statistics'
    };
    return res.status(500).json(response);
  }
});

/**
 * 인기 프롬프트 조회
 * GET /api/prompt-collection/top
 */
router.get('/top', async (req: Request, res: Response) => {
  try {
    const {
      limit = '20',
      type = 'both'
    } = req.query;

    const result = await PromptCollectionService.getTopPrompts(
      parseInt(limit as string),
      type as 'positive' | 'negative' | 'both'
    );

    const response: PromptCollectionResponse = {
      success: true,
      data: result
    };

    return res.json(response);

  } catch (error) {
    console.error('Error getting top prompts:', error);
    const response: PromptCollectionResponse = {
      success: false,
      error: 'Failed to get top prompts'
    };
    return res.status(500).json(response);
  }
});

/**
 * 그룹 프롬프트 조회
 * GET /api/prompt-collection/group/:groupId
 */
router.get('/group/:groupId', async (req: Request, res: Response) => {
  try {
    const { groupId } = req.params;
    const { type = 'positive' } = req.query;

    const result = await PromptCollectionService.getGroupPrompts(
      parseInt(groupId),
      type as 'positive' | 'negative'
    );

    const response: PromptCollectionResponse = {
      success: true,
      data: result
    };

    return res.json(response);

  } catch (error) {
    console.error('Error getting group prompts:', error);
    const response: PromptCollectionResponse = {
      success: false,
      error: 'Failed to get group prompts'
    };
    return res.status(500).json(response);
  }
});

/**
 * 동의어 설정
 * POST /api/prompt-collection/synonyms
 */
router.post('/synonyms', async (req: Request, res: Response) => {
  try {
    const { mainPrompt, synonyms, type = 'positive' } = req.body;

    if (!mainPrompt || !Array.isArray(synonyms)) {
      const response: PromptCollectionResponse = {
        success: false,
        error: 'mainPrompt and synonyms array are required'
      };
      return res.status(400).json(response);
    }

    const result = await PromptCollectionService.setSynonyms(
      mainPrompt,
      synonyms,
      type
    );

    const response: PromptCollectionResponse = {
      success: true,
      data: {
        message: `Successfully set synonyms. Merged ${result.mergedCount} existing prompts.`,
        mainPromptId: result.mainPromptId,
        mergedCount: result.mergedCount
      }
    };

    return res.json(response);

  } catch (error) {
    console.error('Error setting synonyms:', error);
    const response: PromptCollectionResponse = {
      success: false,
      error: 'Failed to set synonyms'
    };
    return res.status(500).json(response);
  }
});

/**
 * 동의어 제거
 * DELETE /api/prompt-collection/synonyms/:promptId
 */
router.delete('/synonyms/:promptId', async (req: Request, res: Response) => {
  try {
    const { promptId } = req.params;
    const { synonym, type = 'positive' } = req.body;

    if (!synonym) {
      const response: PromptCollectionResponse = {
        success: false,
        error: 'synonym is required'
      };
      return res.status(400).json(response);
    }

    const result = await PromptCollectionService.removeSynonym(
      parseInt(promptId),
      synonym,
      type
    );

    const response: PromptCollectionResponse = {
      success: true,
      data: {
        message: result ? 'Synonym removed successfully' : 'Synonym not found',
        removed: result
      }
    };

    return res.json(response);

  } catch (error) {
    console.error('Error removing synonym:', error);
    const response: PromptCollectionResponse = {
      success: false,
      error: 'Failed to remove synonym'
    };
    return res.status(500).json(response);
  }
});

/**
 * 프롬프트 삭제
 * DELETE /api/prompt-collection/:promptId
 */
router.delete('/:promptId', async (req: Request, res: Response) => {
  try {
    const { promptId } = req.params;
    const { type = 'positive' } = req.query;

    const result = await PromptCollectionService.deletePrompt(
      parseInt(promptId),
      type as 'positive' | 'negative'
    );

    const response: PromptCollectionResponse = {
      success: true,
      data: {
        message: result ? 'Prompt deleted successfully' : 'Prompt not found',
        deleted: result
      }
    };

    return res.json(response);

  } catch (error) {
    console.error('Error deleting prompt:', error);
    const response: PromptCollectionResponse = {
      success: false,
      error: 'Failed to delete prompt'
    };
    return res.status(500).json(response);
  }
});

/**
 * 그룹 ID 설정 (동의어와 별개 기능)
 * PUT /api/prompt-collection/group
 */
router.put('/group', async (req: Request, res: Response) => {
  try {
    const { promptId, groupId, type = 'positive' } = req.body;

    if (!promptId) {
      const response: PromptCollectionResponse = {
        success: false,
        error: 'promptId is required'
      };
      return res.status(400).json(response);
    }

    const result = await PromptCollectionService.setGroupId(
      parseInt(promptId),
      groupId ? parseInt(groupId) : null,
      type
    );

    const response: PromptCollectionResponse = {
      success: true,
      data: {
        message: result ? 'Group ID set successfully' : 'Prompt not found',
        updated: result
      }
    };

    return res.json(response);

  } catch (error) {
    console.error('Error setting group ID:', error);
    const response: PromptCollectionResponse = {
      success: false,
      error: 'Failed to set group ID'
    };
    return res.status(500).json(response);
  }
});

/**
 * 프롬프트 수집 (수동)
 * POST /api/prompt-collection/collect
 */
router.post('/collect', async (req: Request, res: Response) => {
  try {
    const { prompt, negativePrompt } = req.body;

    await PromptCollectionService.collectFromImage(prompt, negativePrompt);

    const response: PromptCollectionResponse = {
      success: true,
      data: {
        message: 'Prompts collected successfully'
      }
    };

    return res.json(response);

  } catch (error) {
    console.error('Error collecting prompts:', error);
    const response: PromptCollectionResponse = {
      success: false,
      error: 'Failed to collect prompts'
    };
    return res.status(500).json(response);
  }
});

/**
 * 프롬프트를 그룹에 할당
 * PUT /api/prompt-collection/assign-group
 */
router.put('/assign-group', async (req: Request, res: Response) => {
  try {
    const { prompt_id, group_id, type = 'positive' } = req.body;

    if (!prompt_id) {
      const response: PromptCollectionResponse = {
        success: false,
        error: 'prompt_id is required'
      };
      return res.status(400).json(response);
    }

    const result = await PromptCollectionService.assignPromptToGroup(
      parseInt(prompt_id),
      group_id ? parseInt(group_id) : null,
      type
    );

    const response: PromptCollectionResponse = {
      success: true,
      data: {
        message: result ? 'Prompt assigned to group successfully' : 'Prompt not found',
        assigned: result
      }
    };

    return res.json(response);

  } catch (error) {
    console.error('Error assigning prompt to group:', error);
    const response: PromptCollectionResponse = {
      success: false,
      error: 'Failed to assign prompt to group'
    };
    return res.status(500).json(response);
  }
});

/**
 * 그룹별 통계 조회
 * GET /api/prompt-collection/group-statistics
 */
router.get('/group-statistics', async (req: Request, res: Response) => {
  try {
    const { type = 'positive' } = req.query;

    const statistics = await PromptCollectionService.getGroupStatistics(type as 'positive' | 'negative');

    const response: PromptCollectionResponse = {
      success: true,
      data: statistics
    };

    return res.json(response);

  } catch (error) {
    console.error('Error getting group statistics:', error);
    const response: PromptCollectionResponse = {
      success: false,
      error: 'Failed to get group statistics'
    };
    return res.status(500).json(response);
  }
});

export default router;