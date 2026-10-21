import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { CustomDropdownListModel } from '../../models/CustomDropdownList';
import { WildcardModel, WildcardItemModel } from '../../models/Wildcard';
import { WildcardService } from '../../services/wildcardService';

export function registerResourceTools(server: McpServer): void {
  // 커스텀 드롭다운 목록 조회 (경량)
  server.registerTool(
    'list_custom_dropdown_lists',
    { description: 'List all custom dropdown lists (e.g. LoRA models, preprocessors, checkpoints). Returns list names and item counts without the actual items.', inputSchema: z.object({}) },
    async () => {
      try {
        const lists = CustomDropdownListModel.findAll();

        const summary = lists.map(list => ({
          id: list.id,
          name: list.name,
          description: list.description,
          item_count: list.items.length,
          is_auto_collected: list.is_auto_collected,
          source_path: list.source_path,
        }));

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(summary),
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

  // 커스텀 드롭다운 아이템 검색
  server.registerTool(
    'search_custom_dropdown_items',
    { description: 'Search items within a specific custom dropdown list by keyword. Useful for finding specific LoRA models, preprocessors, checkpoints, etc.', inputSchema: z.object({
      list_name: z.string().describe('Name of the dropdown list to search in'),
      query: z.string().optional().describe('Search keyword to filter items (case-insensitive). If omitted, returns all items with pagination.'),
      page: z.number().int().min(1).default(1).describe('Page number'),
      limit: z.number().int().min(1).max(200).default(50).describe('Results per page'),
    }) },
    async ({ list_name, query, page, limit }) => {
      try {
        const list = CustomDropdownListModel.findByName(list_name);
        if (!list) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `Dropdown list "${list_name}" not found` }],
          };
        }

        // 아이템 필터링
        let filtered = list.items;
        if (query) {
          const lowerQuery = query.toLowerCase();
          filtered = list.items.filter(item => item.toLowerCase().includes(lowerQuery));
        }

        // 페이지네이션
        const total = filtered.length;
        const offset = (page - 1) * limit;
        const paginated = filtered.slice(offset, offset + limit);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              list_name: list.name,
              items: paginated,
              total,
              page,
              limit,
            }),
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

  // 와일드카드 검색
  server.registerTool(
    'search_wildcards',
    { description: 'Search wildcards by name, browse hierarchy, or list root wildcards. Wildcards are prompt building blocks with General/ComfyUI/NAI variants.', inputSchema: z.object({
      query: z.string().optional().describe('Search keyword for wildcard name (partial match)'),
      parent_id: z.number().int().optional().describe('Filter by parent wildcard ID (for hierarchy browsing)'),
      roots_only: z.boolean().default(false).describe('Only return root-level wildcards (no parent)'),
      include_items: z.boolean().default(false).describe('Include wildcard items (prompt content) in results'),
      tool: z.enum(['general', 'comfyui', 'nai']).optional().describe('When include_items=true, only return items for this tool'),
      page: z.number().int().min(1).default(1).describe('Page number'),
      limit: z.number().int().min(1).max(200).default(50).describe('Results per page'),
    }) },
    async (params) => {
      try {
        let wildcards: any[];
        let total: number;

        if (params.query) {
          // 이름 검색
          const result = WildcardModel.search(params.query, params.page, params.limit);
          wildcards = result.wildcards;
          total = result.total;
        } else if (params.parent_id !== undefined) {
          // 특정 부모의 자식 조회
          const allChildren = WildcardModel.findByParentId(params.parent_id);
          total = allChildren.length;
          const offset = (params.page - 1) * params.limit;
          wildcards = allChildren.slice(offset, offset + params.limit);
        } else if (params.roots_only) {
          // 루트만 조회
          const allRoots = WildcardModel.findRoots();
          total = allRoots.length;
          const offset = (params.page - 1) * params.limit;
          wildcards = allRoots.slice(offset, offset + params.limit);
        } else {
          // 전체 조회 (페이지네이션)
          const allWildcards = WildcardModel.findAll();
          total = allWildcards.length;
          const offset = (params.page - 1) * params.limit;
          wildcards = allWildcards.slice(offset, offset + params.limit);
        }

        // 결과 구성
        const results = wildcards.map(w => {
          const entry: any = {
            id: w.id,
            name: w.name,
            description: w.description,
            parent_id: w.parent_id,
            type: w.type,
            chain_option: w.chain_option,
            include_children: w.include_children === 1,
            only_children: w.only_children === 1,
            children_count: WildcardModel.countChildren(w.id),
          };

          if (params.include_items) {
            const items = params.tool
              ? WildcardItemModel.findByWildcardIdAndTool(w.id, params.tool)
              : WildcardItemModel.findByWildcardId(w.id);
            entry.items = items.map(item => ({
              tool: item.tool,
              content: item.content,
              weight: item.weight,
            }));
          }

          return entry;
        });

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              wildcards: results,
              total,
              page: params.page,
              limit: params.limit,
            }),
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

  // 랜덤 프롬프트 미리보기 (생성 화면의 미리보기와 같은 해석기)
  server.registerTool(
    'preview_random_prompt',
    { description: 'Expand a prompt\'s random syntax into sample prompts with the same resolver generation uses: wildcards (++name++, __name__, __name|2__), Danbooru tag groups (__tag:group__), my prompt groups (__my:group__), chains and weight ranges. Each sample is an independent draw and the real generation draws again, so use it to check what a prompt can produce, not to predict the next image.', inputSchema: z.object({
      text: z.string().trim().min(1).max(8000).describe('Prompt text containing random syntax'),
      tool: z.enum(['comfyui', 'nai', 'codex', 'general']).describe('Engine whose wildcard variants to use (comfyui, nai, codex; general = shared items)'),
      count: z.number().int().min(1).max(10).default(3).describe('Number of samples'),
      prompt_kind: z.enum(['positive', 'negative']).default('positive').describe('Which prompt field; __my:group__ picks from positive or negative prompt groups accordingly'),
    }) },
    async ({ text, tool, count, prompt_kind }) => {
      try {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              samples: WildcardService.parseMultiple(text, tool, count, prompt_kind),
              used_wildcards: WildcardService.extractWildcardNames(text),
            }),
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
