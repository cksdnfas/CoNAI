import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { PromptCollectionModel } from '../../models/PromptCollection';
import { PromptGroupModel } from '../../models/PromptGroup';
import { danbooruBrowserService, resolveDanbooruDbInfo } from '../../services/danbooruBrowserService';

function searchDanbooru(query: string, section: 'all' | 'tags' | 'artists' | 'characters', page: number, limit: number, relatedTagLimit: number) {
  const available = resolveDanbooruDbInfo().available;
  if (!available) return { available: false, status: 'not_installed' as const };
  try {
    const params = { q: query, page, limit };
    const characters = section === 'all' || section === 'characters'
      ? danbooruBrowserService.listCharacters({ ...params, relatedTagLimit }) : undefined;
    return {
      available: true,
      status: 'ready' as const,
      ...(section === 'all' || section === 'tags' ? { tags: danbooruBrowserService.listTags(params) } : {}),
      ...(section === 'all' || section === 'artists' ? { artists: danbooruBrowserService.listArtists(params) } : {}),
      ...(characters ? { characters: {
        ...characters,
        // Tag lookup does not grant access to character image files.
        items: characters.items.map(({ images: _images, ...character }) => character),
      } } : {}),
    };
  } catch {
    // An optional dictionary failure must not discard saved prompts or expose server paths.
    return { available: true, status: 'error' as const, error: 'The installed Danbooru database could not be searched.' };
  }
}

export function registerPromptTools(server: McpServer): void {
  // 프롬프트 검색
  server.registerTool(
    'search_prompts',
    { description: 'Search saved prompts AND the installed Danbooru tag dictionary together by default. Use this for tag names, artists and characters, not image search. Danbooru character results include copyrights and related tags (with translations and scores) for composing prompts. The prompts/total fields describe saved prompts; danbooru contains separately paginated dictionary results and availability. Dictionary names can be used as prompt text, but their IDs are not saved prompt IDs.', inputSchema: z.object({
      query: z.string().describe('Search keyword; Danbooru supports tag names with spaces or underscores and Korean translations'),
      source: z.enum(['all', 'stored', 'danbooru']).default('all').describe('Search both sources by default, or only saved prompts / installed Danbooru DB'),
      danbooru_section: z.enum(['all', 'tags', 'artists', 'characters']).default('all').describe('Dictionary section; characters includes related tags and copyrights'),
      related_tag_limit: z.number().int().min(0).max(100).default(30).describe('Maximum related tags per character'),
      type: z.enum(['positive', 'negative', 'auto']).default('positive').describe('Saved prompt type; does not filter Danbooru tags'),
      page: z.number().int().min(1).default(1).describe('Page number'),
      limit: z.number().int().min(1).max(100).default(20).describe('Results per source/section page; characters caps at 30. Follow each section pagination'),
      sort_by: z.enum(['usage_count', 'created_at', 'prompt']).default('usage_count').describe('Saved prompt sort field; dictionary results use Danbooru post count'),
      sort_order: z.enum(['ASC', 'DESC']).default('DESC').describe('Saved prompt sort order'),
    }) },
    async ({ query, source, danbooru_section, related_tag_limit, type, page, limit, sort_by, sort_order }) => {
      try {
        let result;
        if (source === 'danbooru') {
          result = { prompts: [], total: 0 };
        } else switch (type) {
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
              source,
              ...(source !== 'stored' ? { danbooru: searchDanbooru(query, danbooru_section, page, limit, related_tag_limit) } : {}),
            }),
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
  server.registerTool(
    'get_most_used_prompts',
    { description: 'Get the most frequently used prompts, sorted by usage count.', inputSchema: z.object({
      limit: z.number().int().min(1).max(100).default(20).describe('Number of prompts to return'),
    }) },
    async ({ limit }) => {
      try {
        const prompts = PromptCollectionModel.getMostUsedPrompts(limit);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(prompts),
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
  server.registerTool(
    'list_prompt_groups',
    { description: 'List all prompt groups with prompt counts. Supports positive, negative, and auto-generated prompt types.', inputSchema: z.object({
      type: z.enum(['positive', 'negative', 'auto']).default('positive').describe('Prompt group type'),
      include_hidden: z.boolean().default(false).describe('Include hidden groups'),
    }) },
    async ({ type, include_hidden }) => {
      try {
        const groups = PromptGroupModel.findAllWithCounts(include_hidden, type);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(groups),
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
