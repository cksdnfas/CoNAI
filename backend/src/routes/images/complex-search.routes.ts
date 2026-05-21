import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { ComplexFilterService } from '../../services/complexFilterService';
import {
  ComplexSearchRequest,
  ComplexSearchResponse,
  ComplexFilter,
} from '@conai/shared';
import { enrichImageRecord } from './utils';

const router = Router();

type SearchScope = {
  ai_tool?: string;
  model_name?: string;
  start_date?: string;
  end_date?: string;
};

function buildSimpleSearchFilter(searchText: string): ComplexFilter {
  return {
    or_group: [
      {
        category: 'positive_prompt',
        type: 'prompt_contains',
        value: searchText,
      },
      {
        category: 'auto_tag',
        type: 'auto_tag_general',
        value: searchText,
        min_score: 0,
        max_score: 1,
      },
      {
        category: 'auto_tag',
        type: 'auto_tag_character',
        value: searchText,
        min_score: 0,
        max_score: 1,
      },
    ],
  };
}

function buildSearchScope(requestBody: ComplexSearchRequest): SearchScope {
  return {
    ai_tool: requestBody.ai_tool,
    model_name: requestBody.model_name,
    start_date: requestBody.start_date,
    end_date: requestBody.end_date,
  };
}

function resolveSearchFilter(requestBody: ComplexSearchRequest): { filter?: ComplexFilter; error?: string } {
  if (requestBody.simple_search?.text) {
    return { filter: buildSimpleSearchFilter(requestBody.simple_search.text) };
  }

  if (requestBody.complex_filter) {
    const validation = ComplexFilterService.validateFilter(requestBody.complex_filter);
    if (!validation.valid) {
      return { error: `Invalid filter: ${validation.errors.join(', ')}` };
    }

    return { filter: requestBody.complex_filter };
  }

  return { error: 'Either simple_search or complex_filter must be provided' };
}

/**
 * Complex search with AND/OR/NOT filtering
 * POST /api/images/search/complex
 *
 * Request body: ComplexSearchRequest
 * {
 *   simple_search?: { text: string },
 *   complex_filter?: {
 *     exclude_group?: FilterCondition[],
 *     or_group?: FilterCondition[],
 *     and_group?: FilterCondition[]
 *   },
 *   ai_tool?: string,
 *   model_name?: string,
 *   start_date?: string,
 *   end_date?: string,
 *   page?: number,
 *   limit?: number,
 *   sortBy?: 'upload_date' | 'filename' | 'file_size' | 'width' | 'height',
 *   sortOrder?: 'ASC' | 'DESC'
 * }
 */
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const requestBody = req.body as ComplexSearchRequest;

  // Extract pagination and sorting
  const page = requestBody.page || 1;
  const limit = requestBody.limit || 25;
  const sortBy = requestBody.sortBy || 'upload_date';
  const sortOrder = requestBody.sortOrder || 'DESC';

  try {
    const { filter, error } = resolveSearchFilter(requestBody);
    if (!filter) {
      return res.status(400).json({
        success: false,
        error,
      } as ComplexSearchResponse);
    }

    const result = await ComplexFilterService.executeComplexSearch(
      filter,
      buildSearchScope(requestBody),
      { page, limit, sortBy, sortOrder, includeStats: false }
    );

    // Enrich images with URLs and structured metadata
    const enrichedImages = result.images.map(enrichImageRecord);

    const response: ComplexSearchResponse = {
      success: true,
      data: {
        images: enrichedImages,
        total: result.total,
        page,
        limit,
        totalPages: Math.ceil(result.total / limit)
      }
    };

    return res.json(response);
  } catch (error) {
    console.error('Complex search error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Complex search failed'
    } as ComplexSearchResponse);
  }
}));

/**
 * Complex search returning only image IDs (for random selection)
 * POST /api/images/search/complex/ids
 *
 * Request body: ComplexSearchRequest (without pagination)
 */
router.post('/ids', asyncHandler(async (req: Request, res: Response) => {
  const requestBody = req.body as ComplexSearchRequest;

  try {
    const { filter, error } = resolveSearchFilter(requestBody);
    if (!filter) {
      return res.status(400).json({
        success: false,
        error,
      });
    }

    const ids = await ComplexFilterService.executeComplexSearchIds(
      filter,
      buildSearchScope(requestBody)
    );

    return res.json({
      success: true,
      data: {
        ids,
        total: ids.length
      }
    });
  } catch (error) {
    console.error('Complex search IDs error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get search IDs'
    });
  }
}));

/**
 * Validate complex filter
 * POST /api/images/search/complex/validate
 *
 * Request body: ComplexFilter
 */
router.post('/validate', asyncHandler(async (req: Request, res: Response) => {
  const filter = req.body as ComplexFilter;

  try {
    const validation = ComplexFilterService.validateFilter(filter);

    return res.json({
      success: true,
      data: validation
    });
  } catch (error) {
    console.error('Filter validation error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Validation failed'
    });
  }
}));

export default router;
