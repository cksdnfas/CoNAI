import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { PromptCollectionModel } from '../../models/PromptCollection';
import { PromptGroupModel } from '../../models/PromptGroup';

export function registerPromptTools(server: McpServer): void {
  // 프롬프트 검색
  server.tool(
    'search_prompts',
    'Search prompts stored in the system. Supports positive, negative, and auto-generated prompt types.',
    {
      query: z.string().describe('Search keyword'),
      type: z.enum(['positive', 'negative', 'auto']).default('positive').describe('Prompt type to search'),
      page: z.number().int().min(1).default(1).describe('Page number'),
      limit: z.number().int().min(1).max(100).default(20).describe('Results per page'),
      sort_by: z.enum(['usage_count', 'created_at', 'prompt']).default('usage_count').describe('Sort field'),
      sort_order: z.enum(['ASC', 'DESC']).default('DESC').describe('Sort order'),
    },
    async ({ query, type, page, limit, sort_by, sort_order }) => {
      try {
        let result;
        switch (type) {
          case 'negative':
            result = PromptCollectionModel.searchNegativePrompts(query, page, limit, sort_by, sort_order);
            break;
          case 'auto':
            result = PromptCollectionModel.searchAutoPrompts(query, page, limit, sort_by, sort_order);
            break;
          default:
            result = PromptCollectionModel.searchPrompts(query, page, limit, sort_by, sort_order);
            break;
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              prompts: result.prompts,
              total: result.total,
              page,
              limit,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `Error searching prompts: ${(error as Error).message}` }],
        };
      }
    }
  );

  // 가장 많이 사용된 프롬프트 조회
  server.tool(
    'get_most_used_prompts',
    'Get the most frequently used prompts, sorted by usage count.',
    {
      limit: z.number().int().min(1).max(100).default(20).describe('Number of prompts to return'),
    },
    async ({ limit }) => {
      try {
        const prompts = PromptCollectionModel.getMostUsedPrompts(limit);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(prompts, null, 2),
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

  // 프롬프트 그룹 목록 조회
  server.tool(
    'list_prompt_groups',
    'List all prompt groups with prompt counts. Supports positive, negative, and auto-generated prompt types.',
    {
      type: z.enum(['positive', 'negative', 'auto']).default('positive').describe('Prompt group type'),
      include_hidden: z.boolean().default(false).describe('Include hidden groups'),
    },
    async ({ type, include_hidden }) => {
      try {
        const groups = PromptGroupModel.findAllWithCounts(include_hidden, type);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(groups, null, 2),
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
}
