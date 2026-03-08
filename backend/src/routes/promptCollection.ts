import { Router, Request, Response } from 'express';
import { PromptCollectionService } from '../services/promptCollectionService';
import { PromptCollectionResponse,
successResponse,
errorResponse,
paginatedResponse,
PAGINATION,
validateId } from '@conai/shared';

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

    return res.json({
      ...successResponse(result.prompts),
      group_info: result.group_info,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total: result.total,
        totalPages: Math.ceil(result.total / parseInt(limit as string))
      }
    });
  } catch (error) {
    console.error('Error in prompt search:', error);
    return res.status(500).json(errorResponse('Failed to search prompts'));
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
      return res.status(400).json(errorResponse('Query parameter is required'));
    }

    const result = await PromptCollectionService.searchInSynonymGroup(
      query as string,
      type as 'positive' | 'negative'
    );

    return res.json(successResponse(result));
  } catch (error) {
    console.error('Error in synonym search:', error);
    return res.status(500).json(errorResponse('Failed to search in synonym group'));
  }
});

/**
 * 프롬프트 통계 조회
 * GET /api/prompt-collection/statistics
 */
router.get('/statistics', async (req: Request, res: Response) => {
  try {
    const statistics = await PromptCollectionService.getStatistics();
    return res.json(successResponse(statistics));
  } catch (error) {
    console.error('Error getting statistics:', error);
    return res.status(500).json(errorResponse('Failed to get statistics'));
  }
});

/**
 * 인기 프롬프트 조회
 * GET /api/prompt-collection/top
 */
router.get('/top', async (req: Request, res: Response) => {
  try {
    const {
      limit = String(PAGINATION.GROUP_IMAGES_LIMIT),
      type = 'both'
    } = req.query;

    const result = await PromptCollectionService.getTopPrompts(
      parseInt(limit as string),
      type as 'positive' | 'negative' | 'both'
    );

    return res.json(successResponse(result));
  } catch (error) {
    console.error('Error getting top prompts:', error);
    return res.status(500).json(errorResponse('Failed to get top prompts'));
  }
});

/**
 * 그룹 프롬프트 조회
 * GET /api/prompt-collection/group/:groupId
 */
router.get('/group/:groupId', async (req: Request, res: Response) => {
  try {
    const groupId = validateId(req.params.groupId, 'Group ID');
    const { type = 'positive' } = req.query;

    const result = await PromptCollectionService.getGroupPrompts(
      groupId,
      type as 'positive' | 'negative'
    );

    return res.json(successResponse(result));
  } catch (error) {
    console.error('Error getting group prompts:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to get group prompts';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
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
      return res.status(400).json(errorResponse('mainPrompt and synonyms array are required'));
    }

    const result = await PromptCollectionService.setSynonyms(
      mainPrompt,
      synonyms,
      type
    );

    return res.json(successResponse({
      message: `Successfully set synonyms. Merged ${result.mergedCount} existing prompts.`,
      mainPromptId: result.mainPromptId,
      mergedCount: result.mergedCount
    }));
  } catch (error) {
    console.error('Error setting synonyms:', error);
    return res.status(500).json(errorResponse('Failed to set synonyms'));
  }
});

/**
 * 동의어 제거
 * DELETE /api/prompt-collection/synonyms/:promptId
 */
router.delete('/synonyms/:promptId', async (req: Request, res: Response) => {
  try {
    const promptId = validateId(req.params.promptId, 'Prompt ID');
    const { synonym, type = 'positive' } = req.body;

    if (!synonym) {
      return res.status(400).json(errorResponse('synonym is required'));
    }

    const result = await PromptCollectionService.removeSynonym(
      promptId,
      synonym,
      type
    );

    return res.json(successResponse({
      message: result ? 'Synonym removed successfully' : 'Synonym not found',
      removed: result
    }));
  } catch (error) {
    console.error('Error removing synonym:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to remove synonym';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
  }
});

/**
 * 프롬프트 삭제
 * DELETE /api/prompt-collection/:promptId
 */
router.delete('/:promptId', async (req: Request, res: Response) => {
  try {
    const promptId = validateId(req.params.promptId, 'Prompt ID');
    const { type = 'positive' } = req.query;

    const result = await PromptCollectionService.deletePrompt(
      promptId,
      type as 'positive' | 'negative'
    );

    return res.json(successResponse({
      message: result ? 'Prompt deleted successfully' : 'Prompt not found',
      deleted: result
    }));
  } catch (error) {
    console.error('Error deleting prompt:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to delete prompt';
    const statusCode = errorMessage.includes('Invalid') ? 400 : 500;
    return res.status(statusCode).json(errorResponse(errorMessage));
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
      return res.status(400).json(errorResponse('promptId is required'));
    }

    const result = await PromptCollectionService.setGroupId(
      parseInt(promptId),
      groupId ? parseInt(groupId) : null,
      type
    );

    return res.json(successResponse({
      message: result ? 'Group ID set successfully' : 'Prompt not found',
      updated: result
    }));
  } catch (error) {
    console.error('Error setting group ID:', error);
    return res.status(500).json(errorResponse('Failed to set group ID'));
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

    return res.json(successResponse({
      message: 'Prompts collected successfully'
    }));
  } catch (error) {
    console.error('Error collecting prompts:', error);
    return res.status(500).json(errorResponse('Failed to collect prompts'));
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
      return res.status(400).json(errorResponse('prompt_id is required'));
    }

    const result = await PromptCollectionService.assignPromptToGroup(
      parseInt(prompt_id),
      group_id ? parseInt(group_id) : null,
      type
    );

    return res.json(successResponse({
      message: result ? 'Prompt assigned to group successfully' : 'Prompt not found',
      assigned: result
    }));
  } catch (error) {
    console.error('Error assigning prompt to group:', error);
    return res.status(500).json(errorResponse('Failed to assign prompt to group'));
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

    return res.json(successResponse(statistics));
  } catch (error) {
    console.error('Error getting group statistics:', error);
    return res.status(500).json(errorResponse('Failed to get group statistics'));
  }
});

/**
 * 프롬프트 대량 할당
 * POST /api/prompt-collection/batch-assign
 */
router.post('/batch-assign', async (req: Request, res: Response) => {
  try {
    const { prompts, group_id, type = 'positive' } = req.body;

    if (!Array.isArray(prompts) || prompts.length === 0) {
      return res.status(400).json(errorResponse('prompts array is required and must not be empty'));
    }

    const result = await PromptCollectionService.batchAssignPromptsToGroup(
      prompts,
      group_id !== undefined && group_id !== null ? parseInt(group_id) : null,
      type
    );

    return res.json(successResponse({
      message: `Batch assignment completed. Created: ${result.created}, Updated: ${result.updated}, Failed: ${result.failed.length}`,
      ...result
    }));
  } catch (error) {
    console.error('Error batch assigning prompts:', error);
    return res.status(500).json(errorResponse('Failed to batch assign prompts'));
  }
});

export default router;
