import { Router, Request, Response } from 'express';
import { routeParam } from './routeParam';
import { PromptCollectionService } from '../services/promptCollectionService';
import { PromptGroupService } from '../services/promptGroupService';
import { hasAdminAccess, requirePermission } from '../middleware/authMiddleware';
import { toPublicDanbooruDbInfo, type DanbooruBrowserDatabaseInfo } from '../services/danbooruBrowser/dbResolver';
import { db } from '../database/init';
import { PromptCollectionModel } from '../models/PromptCollection';
import { PromptGroupModel } from '../models/PromptGroup';
import { getPromptCollectionTableName } from '../utils/promptTables';
import { isProtectedLoRAGroup } from '../services/promptCollectionProtection';
import { nativeEditRevision, requireNativeEditRevision } from '../services/nativeEditRevision';
import { getAuthDb } from '../database/authDb';
import {
  successResponse,
  errorResponse,
  PAGINATION,
  validateId,
} from '@conai/shared';

const router = Router();

type PromptCollectionType = 'positive' | 'negative' | 'auto';
type PromptCollectionSearchType = PromptCollectionType | 'both';
type PromptCollectionSortBy = 'usage_count' | 'created_at' | 'prompt';
type PromptCollectionSortOrder = 'ASC' | 'DESC';

function parseRouteId(value: string | string[] | undefined, label: string): number {
  return validateId(routeParam(value), label);
}

function parseOptionalGroupId(value: unknown): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value === '0' || value === 'null' ? null : parseInt(value as string);
}

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

    const groupId = parseOptionalGroupId(group_id);

    const result = await PromptCollectionService.searchPromptsWithGroups(
      query as string,
      type as PromptCollectionSearchType,
      parseInt(page as string),
      parseInt(limit as string),
      sortBy as PromptCollectionSortBy,
      sortOrder as PromptCollectionSortOrder,
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
      type as PromptCollectionType
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
      type as PromptCollectionSearchType
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
    const groupId = parseRouteId(req.params.groupId, 'Group ID');
    const { type = 'positive' } = req.query;

    const result = await PromptCollectionService.getGroupPrompts(
      groupId,
      type as PromptCollectionType
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
router.post('/synonyms', requirePermission('prompts.update'), async (req: Request, res: Response) => {
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
router.delete('/synonyms/:promptId', requirePermission('prompts.update'), async (req: Request, res: Response) => {
  try {
    const promptId = parseRouteId(req.params.promptId, 'Prompt ID');
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
 * 프롬프트 그룹 일괄 해석
 * POST /api/prompt-collection/resolve-groups
 */
router.post('/resolve-groups', async (req: Request, res: Response) => {
  try {
    const { prompts, type = 'positive' } = req.body;

    if (!Array.isArray(prompts)) {
      return res.status(400).json(errorResponse('prompts array is required'));
    }

    const result = await PromptCollectionService.resolvePromptsWithGroups(
      prompts.map((value) => String(value ?? '')),
      type as PromptCollectionType
    );

    return res.json(successResponse(result));
  } catch (error) {
    console.error('Error resolving prompt groups:', error);
    return res.status(500).json(errorResponse('Failed to resolve prompt groups'));
  }
});

/** Keep the Danbooru DB server paths in grouping results for admins only. */
function withDanbooruDatabaseForViewer<T extends { database: DanbooruBrowserDatabaseInfo }>(req: Request, result: T) {
  return hasAdminAccess(req) ? result : { ...result, database: toPublicDanbooruDbInfo(result.database) };
}

/**
 * 단부루 taxonomy 기반 프롬프트 그룹 자동 구성 미리보기
 * GET /api/prompt-collection/danbooru-grouping/preview
 */
router.get('/danbooru-grouping/preview', async (req: Request, res: Response) => {
  try {
    const includeAssignedPrompts = req.query.includeAssignedPrompts === 'true' || req.query.include_assigned_prompts === 'true';
    const mode = req.query.mode === 'overwrite-existing' || includeAssignedPrompts ? 'overwrite-existing' : 'unclassified-only';
    const language = req.query.language === 'ko' ? 'ko' : 'en';
    const result = PromptGroupService.previewDanbooruGrouping({ mode, language, includeAssignedPrompts });
    return res.json(successResponse(withDanbooruDatabaseForViewer(req, result)));
  } catch (error) {
    console.error('Error previewing Danbooru grouping:', error);
    return res.status(500).json(errorResponse(error instanceof Error ? error.message : 'Failed to preview Danbooru grouping'));
  }
});

/**
 * 단부루 taxonomy 기반 프롬프트 그룹 자동 구성 적용
 * POST /api/prompt-collection/danbooru-grouping/apply
 */
router.post('/danbooru-grouping/apply', requirePermission('prompts.create'), requirePermission('prompts.update'), async (req: Request, res: Response) => {
  try {
    const includeAssignedPrompts = req.body?.includeAssignedPrompts === true || req.body?.include_assigned_prompts === true;
    const mode = req.body?.mode === 'overwrite-existing' || includeAssignedPrompts ? 'overwrite-existing' : 'unclassified-only';
    const language = req.body?.language === 'ko' ? 'ko' : 'en';
    const result = PromptGroupService.applyDanbooruGrouping({ mode, language, includeAssignedPrompts });
    return res.json(successResponse(withDanbooruDatabaseForViewer(req, result)));
  } catch (error) {
    console.error('Error applying Danbooru grouping:', error);
    return res.status(500).json(errorResponse(error instanceof Error ? error.message : 'Failed to apply Danbooru grouping'));
  }
});

/**
 * 프롬프트 삭제
 * DELETE /api/prompt-collection/:promptId
 */
router.delete('/:promptId', requirePermission('prompts.delete'), async (req: Request, res: Response) => {
  try {
    const promptId = parseRouteId(req.params.promptId, 'Prompt ID');
    const { type = 'positive' } = req.query;

    const result = await PromptCollectionService.deletePrompt(
      promptId,
      type as PromptCollectionType
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
router.put('/group', requirePermission('prompts.update'), async (req: Request, res: Response) => {
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
router.post('/collect', requirePermission('prompts.create'), async (req: Request, res: Response) => {
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
router.put('/assign-group', requirePermission('prompts.update'), async (req: Request, res: Response) => {
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

    const statistics = await PromptCollectionService.getGroupStatistics(type as PromptCollectionType);

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
router.post('/batch-assign', requirePermission('prompts.update'), async (req: Request, res: Response) => {
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

/** Native authoring preserves collected usage counts and locked auto-managed groups. */
function promptAuthorInput(req: Request) {
  const type = req.body?.type;
  const prompt = req.body?.prompt;
  const synonyms = req.body?.synonyms ?? [];
  const groupId = req.body?.group_id === 0 || req.body?.group_id == null ? null : req.body.group_id;
  if (!['positive', 'negative', 'auto'].includes(type) || typeof prompt !== 'string' || !prompt.trim() || prompt.length > 8000 || !Array.isArray(synonyms) || synonyms.length > 100 || synonyms.some((item: unknown) => typeof item !== 'string' || item.length > 8000) || (groupId !== null && (!Number.isSafeInteger(groupId) || groupId < 1))) throw new Error('프롬프트 입력을 확인해줘.');
  if (groupId !== null) {
    const group = PromptGroupModel.findById(groupId, type);
    if (!group || isProtectedLoRAGroup(group) || PromptGroupService.isDanbooruManagedGroupId(groupId, type)) throw new Error('자동 관리 그룹에는 프롬프트를 작성할 수 없어.');
  }
  return { type: type as PromptCollectionType, prompt: prompt.trim(), synonyms: [...new Set(synonyms.map((item: string) => item.trim()).filter(Boolean))], groupId };
}
router.get('/item/:id', (req, res, next) => requirePermission(getAuthDb().prepare('SELECT 1 FROM auth_permissions WHERE permission_key = ?').get('prompts.view') ? 'prompts.view' : 'page.prompts.view')(req, res, next), (req: Request, res: Response) => {
  const type = req.query.type;
  if (!['positive', 'negative', 'auto'].includes(String(type))) return res.status(400).json(errorResponse('Invalid prompt type'));
  const record = PromptCollectionModel.findById(Number(req.params.id), type as PromptCollectionType);
  if (!record) return res.status(404).json(errorResponse('Prompt not found'));
  return res.json(successResponse({ ...record, synonyms: record.synonyms ? JSON.parse(record.synonyms) : [], type, assistant_revision: nativeEditRevision(record) }));
});
router.post('/item', requirePermission('prompts.create'), (req: Request, res: Response) => {
  try {
    const input = promptAuthorInput(req);
    const table = getPromptCollectionTableName(input.type);
    const id = db.transaction(() => {
      if (db.prepare(`SELECT 1 FROM ${table} WHERE prompt = ?`).get(input.prompt)) return null;
      return Number(db.prepare(`INSERT INTO ${table} (prompt, usage_count, group_id, synonyms) VALUES (?, 0, ?, ?)`).run(input.prompt, input.groupId, JSON.stringify(input.synonyms)).lastInsertRowid);
    })();
    if (id === null) return res.status(409).json(errorResponse('같은 프롬프트가 이미 있어.'));
    return res.status(201).json(successResponse({ id }));
  } catch (error) { return res.status(400).json(errorResponse(error instanceof Error ? error.message : 'Invalid prompt')); }
});
router.put('/item/:id', requirePermission('prompts.update'), (req: Request, res: Response) => {
  try {
    const input = promptAuthorInput(req);
    const id = Number(req.params.id);
    const table = getPromptCollectionTableName(input.type);
    const status = db.transaction(() => {
      const current = PromptCollectionModel.findById(id, input.type);
      if (!current) return 404;
      if (!requireNativeEditRevision(req, res, current)) return 409;
      if (current.group_id && (isProtectedLoRAGroup(PromptGroupModel.findById(current.group_id, input.type)) || PromptGroupService.isDanbooruManagedGroupId(current.group_id, input.type))) return 403;
      if (db.prepare(`SELECT 1 FROM ${table} WHERE prompt = ? AND id <> ?`).get(input.prompt, id)) return 409;
      db.prepare(`UPDATE ${table} SET prompt = ?, group_id = ?, synonyms = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(input.prompt, input.groupId, JSON.stringify(input.synonyms), id);
      return 200;
    })();
    if (res.headersSent) return;
    return status === 200 ? res.json(successResponse({ id })) : res.status(status).json(errorResponse(status === 403 ? '자동 관리 프롬프트는 수정할 수 없어.' : status === 404 ? 'Prompt not found' : '같은 이름이 있거나 프롬프트가 바뀌었어.'));
  } catch (error) { return res.status(400).json(errorResponse(error instanceof Error ? error.message : 'Invalid prompt')); }
});

export default router;
