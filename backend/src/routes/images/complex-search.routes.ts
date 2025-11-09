import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { ComplexFilterService } from '../../services/complexFilterService';
import {
  ComplexSearchRequest,
  ComplexSearchResponse,
  ComplexFilter
} from '@comfyui-image-manager/shared';
import { enrichImageRecord } from './utils';

const router = Router();

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
    let result: { images: any[]; total: number };

    // Simple search mode (quick text search)
    if (requestBody.simple_search?.text) {
      // Simple search: search in positive prompt + auto_tags only (no negative prompt, no weight filtering)
      const searchText = requestBody.simple_search.text;

      // Use basic search with text matching in positive prompt and auto_tags
      // This is a simplified version - we'll use complex filter with OR logic
      const simpleFilter: ComplexFilter = {
        or_group: [
          {
            category: 'positive_prompt',
            type: 'prompt_contains',
            value: searchText
          },
          {
            category: 'auto_tag',
            type: 'auto_tag_general',
            value: searchText,
            min_score: 0,
            max_score: 1
          },
          {
            category: 'auto_tag',
            type: 'auto_tag_character',
            value: searchText,
            min_score: 0,
            max_score: 1
          }
        ]
      };

      result = await ComplexFilterService.executeComplexSearch(
        simpleFilter,
        {
          ai_tool: requestBody.ai_tool,
          model_name: requestBody.model_name,
          start_date: requestBody.start_date,
          end_date: requestBody.end_date
        },
        { page, limit, sortBy, sortOrder }
      );
    }
    // Complex filter mode (advanced search)
    else if (requestBody.complex_filter) {
      // Validate filter
      const validation = ComplexFilterService.validateFilter(requestBody.complex_filter);
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          error: `Invalid filter: ${validation.errors.join(', ')}`
        } as ComplexSearchResponse);
      }

      result = await ComplexFilterService.executeComplexSearch(
        requestBody.complex_filter,
        {
          ai_tool: requestBody.ai_tool,
          model_name: requestBody.model_name,
          start_date: requestBody.start_date,
          end_date: requestBody.end_date
        },
        { page, limit, sortBy, sortOrder }
      );
    }
    // No filter specified - return error
    else {
      return res.status(400).json({
        success: false,
        error: 'Either simple_search or complex_filter must be provided'
      } as ComplexSearchResponse);
    }

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
    let ids: string[]; // composite_hash[]

    // Simple search mode
    if (requestBody.simple_search?.text) {
      const searchText = requestBody.simple_search.text;

      const simpleFilter: ComplexFilter = {
        or_group: [
          {
            category: 'positive_prompt',
            type: 'prompt_contains',
            value: searchText
          },
          {
            category: 'auto_tag',
            type: 'auto_tag_general',
            value: searchText,
            min_score: 0,
            max_score: 1
          },
          {
            category: 'auto_tag',
            type: 'auto_tag_character',
            value: searchText,
            min_score: 0,
            max_score: 1
          }
        ]
      };

      ids = await ComplexFilterService.executeComplexSearchIds(
        simpleFilter,
        {
          ai_tool: requestBody.ai_tool,
          model_name: requestBody.model_name,
          start_date: requestBody.start_date,
          end_date: requestBody.end_date
        }
      );
    }
    // Complex filter mode
    else if (requestBody.complex_filter) {
      // Validate filter
      const validation = ComplexFilterService.validateFilter(requestBody.complex_filter);
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          error: `Invalid filter: ${validation.errors.join(', ')}`
        });
      }

      ids = await ComplexFilterService.executeComplexSearchIds(
        requestBody.complex_filter,
        {
          ai_tool: requestBody.ai_tool,
          model_name: requestBody.model_name,
          start_date: requestBody.start_date,
          end_date: requestBody.end_date
        }
      );
    }
    // No filter specified
    else {
      return res.status(400).json({
        success: false,
        error: 'Either simple_search or complex_filter must be provided'
      });
    }

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
