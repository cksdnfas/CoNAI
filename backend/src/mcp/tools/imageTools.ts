import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ImageSearchModel } from '../../models/Image/ImageSearchModel';
import { MediaMetadataModel } from '../../models/Image/MediaMetadataModel';
import { GenerationHistoryModel } from '../../models/GenerationHistory';
import { AutoTagSearchService } from '../../services/autoTagSearchService';
import { AutoTagSearchParams, TagFilter } from '../../types/autoTag';

export function registerImageTools(server: McpServer): void {
  // 이미지 고급 검색
  server.tool(
    'search_images',
    'Search images stored in the system by prompt text, AI tool, model, dimensions, file size, date range, or group.',
    {
      search_text: z.string().optional().describe('Search in positive prompts'),
      negative_text: z.string().optional().describe('Search in negative prompts'),
      ai_tool: z.string().optional().describe('Filter by AI tool (e.g., "ComfyUI", "NovelAI", "Stable Diffusion")'),
      model_name: z.string().optional().describe('Filter by model name'),
      min_width: z.number().int().optional().describe('Minimum image width'),
      max_width: z.number().int().optional().describe('Maximum image width'),
      min_height: z.number().int().optional().describe('Minimum image height'),
      max_height: z.number().int().optional().describe('Maximum image height'),
      start_date: z.string().optional().describe('Start date filter (YYYY-MM-DD)'),
      end_date: z.string().optional().describe('End date filter (YYYY-MM-DD)'),
      group_id: z.number().int().optional().describe('Filter by group ID'),
      page: z.number().int().min(1).default(1).describe('Page number'),
      limit: z.number().int().min(1).max(100).default(20).describe('Results per page'),
      sort_by: z.enum(['upload_date', 'filename', 'file_size', 'width', 'height']).default('upload_date').describe('Sort field'),
      sort_order: z.enum(['ASC', 'DESC']).default('DESC').describe('Sort order'),
    },
    async (params) => {
      try {
        const { page, limit, sort_by, sort_order, ...searchParams } = params;

        const result = await ImageSearchModel.advancedSearch(
          searchParams,
          page,
          limit,
          sort_by,
          sort_order
        );

        // 응답 크기를 줄이기 위해 핵심 필드만 추출
        const images = result.images.map((img: any) => ({
          composite_hash: img.composite_hash,
          width: img.width,
          height: img.height,
          ai_tool: img.ai_tool,
          model_name: img.model_name,
          prompt: img.prompt ? (img.prompt.length > 200 ? img.prompt.substring(0, 200) + '...' : img.prompt) : null,
          negative_prompt: img.negative_prompt ? (img.negative_prompt.length > 100 ? img.negative_prompt.substring(0, 100) + '...' : img.negative_prompt) : null,
          seed: img.seed,
          steps: img.steps,
          cfg_scale: img.cfg_scale,
          sampler: img.sampler,
          first_seen_date: img.first_seen_date,
          file_size: img.file_size,
          original_file_path: img.original_file_path,
        }));

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              images,
              total: result.total,
              page,
              limit,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `Error searching images: ${(error as Error).message}` }],
        };
      }
    }
  );

  // 이미지 메타데이터 상세 조회
  server.tool(
    'get_image_metadata',
    'Get detailed metadata for a specific image by its composite hash.',
    {
      composite_hash: z.string().describe('The 48-character composite hash of the image'),
    },
    async ({ composite_hash }) => {
      try {
        const metadata = MediaMetadataModel.findByHash(composite_hash);

        if (!metadata) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `Image with hash ${composite_hash} not found` }],
          };
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(metadata, null, 2),
          }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `Error: ${(error as Error).message}` }],
        };
      }
    }
  );

  // 이미지 생성 이력 조회
  server.tool(
    'get_generation_history',
    'Get image generation history records. Supports filtering by service type (comfyui/novelai) and generation status.',
    {
      service_type: z.enum(['comfyui', 'novelai']).optional().describe('Filter by service type'),
      generation_status: z.enum(['pending', 'processing', 'completed', 'failed']).optional().describe('Filter by generation status'),
      limit: z.number().int().min(1).max(100).default(20).describe('Number of records to return'),
      offset: z.number().int().min(0).default(0).describe('Offset for pagination'),
    },
    async ({ service_type, generation_status, limit, offset }) => {
      try {
        const filters: any = { limit, offset };
        if (service_type) filters.service_type = service_type;
        if (generation_status) filters.generation_status = generation_status;

        const records = GenerationHistoryModel.findAllWithMetadata(filters);
        const total = GenerationHistoryModel.count(filters);

        // 응답 크기를 줄이기 위해 핵심 필드만 추출
        const summary = records.map(r => ({
          id: r.id,
          service_type: r.service_type,
          generation_status: r.generation_status,
          created_at: r.created_at,
          completed_at: r.completed_at,
          positive_prompt: r.positive_prompt ? (r.positive_prompt.length > 200 ? r.positive_prompt.substring(0, 200) + '...' : r.positive_prompt) : null,
          negative_prompt: r.negative_prompt ? (r.negative_prompt.length > 100 ? r.negative_prompt.substring(0, 100) + '...' : r.negative_prompt) : null,
          width: r.width,
          height: r.height,
          nai_model: r.nai_model,
          nai_seed: r.nai_seed,
          workflow_name: r.workflow_name,
          composite_hash: r.composite_hash || (r as any).actual_composite_hash,
          error_message: r.error_message,
        }));

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              records: summary,
              total,
              limit,
              offset,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `Error: ${(error as Error).message}` }],
        };
      }
    }
  );

  // 자동 태그 기반 이미지 검색
  server.tool(
    'search_images_by_tags',
    'Search images by auto-generated tags (WD Tagger). Supports tag name search, character search, rating filter, and rating score range.',
    {
      tags: z.string().optional().describe('Comma-separated tag names to search (e.g. "long_hair, blue_eyes, school_uniform")'),
      min_tag_score: z.number().min(0).max(1).optional().describe('Minimum confidence score for tag matching (0-1)'),
      character: z.string().optional().describe('Character name to search for'),
      rating: z.enum(['general', 'sensitive', 'questionable', 'explicit']).optional().describe('Filter by dominant rating category'),
      min_rating_score: z.number().optional().describe('Minimum weighted rating score'),
      max_rating_score: z.number().optional().describe('Maximum weighted rating score'),
      has_auto_tags: z.boolean().optional().describe('Filter by auto-tag existence (true=tagged only, false=untagged only)'),
      search_text: z.string().optional().describe('Search in positive prompts'),
      ai_tool: z.string().optional().describe('Filter by AI tool (e.g. "ComfyUI", "NovelAI")'),
      model_name: z.string().optional().describe('Filter by model name'),
      page: z.number().int().min(1).default(1).describe('Page number'),
      limit: z.number().int().min(1).max(100).default(20).describe('Results per page'),
      sort_by: z.enum(['upload_date', 'filename', 'file_size', 'width', 'height']).default('upload_date').describe('Sort field'),
      sort_order: z.enum(['ASC', 'DESC']).default('DESC').describe('Sort order'),
    },
    async (params) => {
      try {
        // 평면 파라미터 → AutoTagSearchParams 변환
        const autoTagParams: AutoTagSearchParams = {
          has_auto_tags: params.has_auto_tags,
          page: params.page,
          limit: params.limit,
          sortBy: params.sort_by,
          sortOrder: params.sort_order,
        };

        // 태그 파싱
        if (params.tags) {
          const tagNames = params.tags.split(',').map(t => t.trim()).filter(t => t.length > 0);
          autoTagParams.general_tags = tagNames.map(tag => {
            const filter: TagFilter = { tag };
            if (params.min_tag_score !== undefined) {
              filter.min_score = params.min_tag_score;
            }
            return filter;
          });
        }

        // 캐릭터 필터
        if (params.character) {
          autoTagParams.character = { name: params.character };
        }

        // 레이팅 필터
        if (params.rating) {
          autoTagParams.rating = {
            [params.rating]: { min: 0.5 },
          };
        }

        // 레이팅 스코어 필터
        if (params.min_rating_score !== undefined || params.max_rating_score !== undefined) {
          autoTagParams.rating_score = {
            min_score: params.min_rating_score,
            max_score: params.max_rating_score,
          };
        }

        // 유효성 검증
        const validation = AutoTagSearchService.validateSearchParams(autoTagParams);
        if (!validation.valid) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `Invalid parameters: ${validation.errors.join(', ')}` }],
          };
        }

        // 기본 검색 파라미터
        const basicSearchParams = {
          search_text: params.search_text,
          ai_tool: params.ai_tool,
          model_name: params.model_name,
        };

        const result = await ImageSearchModel.searchByAutoTags(autoTagParams, basicSearchParams);

        const images = result.images.map((img: any) => ({
          composite_hash: img.composite_hash,
          width: img.width,
          height: img.height,
          ai_tool: img.ai_tool,
          model_name: img.model_name,
          prompt: img.prompt ? (img.prompt.length > 200 ? img.prompt.substring(0, 200) + '...' : img.prompt) : null,
          seed: img.seed,
          first_seen_date: img.first_seen_date,
          rating_score: img.rating_score,
          original_file_path: img.original_file_path,
        }));

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              images,
              total: result.total,
              page: params.page,
              limit: params.limit,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `Error searching by tags: ${(error as Error).message}` }],
        };
      }
    }
  );
}
