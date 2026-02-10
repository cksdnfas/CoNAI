import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CustomDropdownListModel } from '../../models/CustomDropdownList';
import { WildcardModel, WildcardItemModel } from '../../models/Wildcard';

export function registerResourceTools(server: McpServer): void {
  // 커스텀 드롭다운 목록 조회 (경량)
  server.tool(
    'list_custom_dropdown_lists',
    'List all custom dropdown lists (e.g. LoRA models, preprocessors, checkpoints). Returns list names and item counts without the actual items.',
    {},
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
            text: JSON.stringify(summary, null, 2),
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
  server.tool(
    'search_custom_dropdown_items',
    'Search items within a specific custom dropdown list by keyword. Useful for finding specific LoRA models, preprocessors, checkpoints, etc.',
    {
      list_name: z.string().describe('Name of the dropdown list to search in'),
      query: z.string().optional().describe('Search keyword to filter items (case-insensitive). If omitted, returns all items with pagination.'),
      page: z.number().int().min(1).default(1).describe('Page number'),
      limit: z.number().int().min(1).max(200).default(50).describe('Results per page'),
    },
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

  // 와일드카드 검색
  server.tool(
    'search_wildcards',
    'Search wildcards by name, browse hierarchy, or list root wildcards. Wildcards are prompt building blocks with ComfyUI/NAI variants.',
    {
      query: z.string().optional().describe('Search keyword for wildcard name (partial match)'),
      parent_id: z.number().int().optional().describe('Filter by parent wildcard ID (for hierarchy browsing)'),
      roots_only: z.boolean().default(false).describe('Only return root-level wildcards (no parent)'),
      include_items: z.boolean().default(false).describe('Include wildcard items (prompt content) in results'),
      tool: z.enum(['comfyui', 'nai']).optional().describe('When include_items=true, only return items for this tool'),
      page: z.number().int().min(1).default(1).describe('Page number'),
      limit: z.number().int().min(1).max(200).default(50).describe('Results per page'),
    },
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
}
