import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { PromptCollectionModel } from '../../models/PromptCollection';
import { PromptGroupModel } from '../../models/PromptGroup';
import { PromptGroupService } from '../../services/promptGroupService';
import { runtimePaths } from '../../config/runtimePaths';

const BACKUPS_DIR = path.join(runtimePaths.basePath, 'backups');

function ensureBackupsDir(): void {
  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  }
}

export function registerPromptOrganizationTools(server: McpServer): void {

  // ─── 조회 도구 ───

  server.tool(
    'get_prompt_group_structure',
    'Get the complete prompt group structure including hierarchy, prompt counts, and unclassified count. Use this first to understand the current organization before making changes. Supports positive, negative, and auto prompt types.',
    {
      type: z.enum(['positive', 'negative', 'auto']).default('positive').describe('Prompt type'),
      include_hidden: z.boolean().default(true).describe('Include hidden groups'),
    },
    async ({ type, include_hidden }) => {
      try {
        const groups = await PromptGroupService.getAllGroups(include_hidden, type);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              groups,
              total_groups: groups.length,
              type,
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

  server.tool(
    'get_unclassified_prompts',
    'Get prompts not assigned to any group (Unclassified). Returns a paginated batch for AI-assisted classification. Maximum 50 per request. Supports positive, negative, and auto prompt types.',
    {
      type: z.enum(['positive', 'negative', 'auto']).default('positive').describe('Prompt type'),
      page: z.number().int().min(1).default(1).describe('Page number'),
      limit: z.number().int().min(1).max(50).default(50).describe('Results per page (max 50)'),
    },
    async ({ type, page, limit }) => {
      try {
        const result = await PromptGroupService.getPromptsInGroup(0, type, page, limit);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              prompts: result.prompts,
              total: result.total,
              page,
              limit,
              type,
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

  server.tool(
    'get_prompts_in_group',
    'Get all prompts currently assigned to a specific group. Use group_id=0 for unclassified prompts. Supports positive, negative, and auto prompt types.',
    {
      group_id: z.number().int().min(0).describe('Group ID (0 for Unclassified)'),
      type: z.enum(['positive', 'negative', 'auto']).default('positive').describe('Prompt type'),
      page: z.number().int().min(1).default(1).describe('Page number'),
      limit: z.number().int().min(1).max(100).default(50).describe('Results per page'),
    },
    async ({ group_id, type, page, limit }) => {
      try {
        const result = await PromptGroupService.getPromptsInGroup(
          group_id === 0 ? null : group_id,
          type,
          page,
          limit
        );

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              group_id,
              prompts: result.prompts,
              total: result.total,
              page,
              limit,
              type,
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

  // ─── 분류 도구 ───

  server.tool(
    'create_prompt_group',
    'Create a new prompt group. If a group with the same name already exists, returns the existing group ID. Use parent_id to create sub-groups in a hierarchy. Supports positive, negative, and auto prompt types.',
    {
      group_name: z.string().min(1).describe('Name for the new group'),
      type: z.enum(['positive', 'negative', 'auto']).default('positive').describe('Prompt type'),
      display_order: z.number().int().optional().describe('Display order (auto-assigned if omitted)'),
      is_visible: z.boolean().default(true).describe('Whether the group is visible'),
      parent_id: z.number().int().optional().describe('Parent group ID for hierarchy'),
    },
    async ({ group_name, type, display_order, is_visible, parent_id }) => {
      try {
        const existing = PromptGroupModel.findByName(group_name, type);
        const groupId = PromptGroupModel.create(
          { group_name, display_order, is_visible, parent_id: parent_id ?? null },
          type
        );

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              group_id: groupId,
              group_name,
              is_new: !existing,
              type,
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

  server.tool(
    'batch_create_groups',
    'Create multiple prompt groups at once. Each group name must be unique. Returns created/existing group IDs. Supports positive, negative, and auto prompt types.',
    {
      groups: z.array(z.object({
        group_name: z.string().min(1).describe('Group name'),
        display_order: z.number().int().optional().describe('Display order'),
        is_visible: z.boolean().default(true).describe('Visibility'),
        parent_id: z.number().int().optional().describe('Parent group ID'),
      })).min(1).max(50).describe('Groups to create (max 50)'),
      type: z.enum(['positive', 'negative', 'auto']).default('positive').describe('Prompt type'),
    },
    async ({ groups, type }) => {
      try {
        const results = groups.map(group => {
          const existing = PromptGroupModel.findByName(group.group_name, type);
          const groupId = PromptGroupModel.create(
            {
              group_name: group.group_name,
              display_order: group.display_order,
              is_visible: group.is_visible,
              parent_id: group.parent_id ?? null,
            },
            type
          );
          return {
            group_name: group.group_name,
            group_id: groupId,
            is_new: !existing,
          };
        });

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              results,
              created: results.filter(r => r.is_new).length,
              existing: results.filter(r => !r.is_new).length,
              type,
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

  server.tool(
    'assign_prompts_to_group',
    'Assign one or more prompts to a group by their prompt IDs. Use target_group_id=0 to move back to Unclassified. This is the primary tool for AI-assisted prompt classification. Supports positive, negative, and auto prompt types.',
    {
      prompt_ids: z.array(z.number().int()).min(1).max(100).describe('Prompt IDs to assign'),
      target_group_id: z.number().int().min(0).describe('Target group ID (0 for Unclassified)'),
      type: z.enum(['positive', 'negative', 'auto']).default('positive').describe('Prompt type'),
    },
    async ({ prompt_ids, target_group_id, type }) => {
      try {
        const actualGroupId = target_group_id === 0 ? null : target_group_id;
        let successCount = 0;
        let failCount = 0;

        for (const promptId of prompt_ids) {
          const result = PromptCollectionModel.setGroupId(promptId, actualGroupId, type);
          if (result) {
            successCount++;
          } else {
            failCount++;
          }
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success_count: successCount,
              fail_count: failCount,
              total: prompt_ids.length,
              target_group_id,
              type,
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

  server.tool(
    'move_prompts_between_groups',
    'Move prompts from one group to another. Provide specific prompt_ids OR source_group_id to move all prompts from that group. Use target_group_id=0 for Unclassified. Supports positive, negative, and auto prompt types.',
    {
      prompt_ids: z.array(z.number().int()).optional().describe('Specific prompt IDs to move'),
      source_group_id: z.number().int().min(0).optional().describe('Source group ID to move ALL prompts from (0 for Unclassified)'),
      target_group_id: z.number().int().min(0).describe('Target group ID (0 for Unclassified)'),
      type: z.enum(['positive', 'negative', 'auto']).default('positive').describe('Prompt type'),
    },
    async ({ prompt_ids, source_group_id, target_group_id, type }) => {
      try {
        if (!prompt_ids && source_group_id === undefined) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: 'Error: Either prompt_ids or source_group_id must be provided' }],
          };
        }

        const actualTargetId = target_group_id === 0 ? null : target_group_id;
        let movedCount = 0;

        if (prompt_ids && prompt_ids.length > 0) {
          for (const promptId of prompt_ids) {
            const result = PromptCollectionModel.setGroupId(promptId, actualTargetId, type);
            if (result) movedCount++;
          }
        } else if (source_group_id !== undefined) {
          // source 그룹의 모든 프롬프트 조회 후 이동
          const sourceId = source_group_id === 0 ? null : source_group_id;
          const { prompts, total } = await PromptGroupService.getPromptsInGroup(sourceId, type, 1, 10000);

          for (const prompt of prompts) {
            const result = PromptCollectionModel.setGroupId(prompt.id, actualTargetId, type);
            if (result) movedCount++;
          }
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              moved_count: movedCount,
              source_group_id: source_group_id ?? null,
              target_group_id,
              type,
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

  // ─── 백업 도구 ───

  server.tool(
    'backup_prompt_data',
    'Create a full JSON backup of all prompt data (groups + prompts + settings) for all three types (positive, negative, auto). Saves to the backups directory.',
    {
      filename: z.string().optional().describe('Custom backup filename (auto-generated if omitted)'),
    },
    async ({ filename }) => {
      try {
        ensureBackupsDir();

        const types = ['positive', 'negative', 'auto'] as const;
        const data: Record<string, { groups: any[]; prompts: any[] }> = {};
        const metadata: Record<string, number> = {};

        for (const type of types) {
          const groups = PromptGroupModel.exportForJSON(type);
          const prompts = PromptCollectionModel.exportAllPrompts(type);

          data[type] = { groups, prompts };
          metadata[`${type}_groups`] = groups.length;
          metadata[`${type}_prompts`] = prompts.length;
        }

        const backup = {
          version: '1.0',
          app: 'comfyui-image-manager',
          backup_date: new Date().toISOString(),
          metadata,
          data,
        };

        const actualFilename = filename || `prompt_backup_${new Date().toISOString().replace(/[:.]/g, '-')}`;
        const filePath = path.join(BACKUPS_DIR, `${actualFilename}.json`);

        fs.writeFileSync(filePath, JSON.stringify(backup, null, 2), 'utf-8');

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              file_path: filePath,
              filename: `${actualFilename}.json`,
              metadata,
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

  server.tool(
    'restore_prompt_data',
    'Restore prompt data from a JSON backup file. This restores group structures and prompt-group assignments. Existing prompts are updated, missing prompts are created.',
    {
      filename: z.string().describe('Backup filename (in the backups directory)'),
    },
    async ({ filename }) => {
      try {
        const filePath = path.join(BACKUPS_DIR, filename);

        if (!fs.existsSync(filePath)) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `Error: Backup file not found: ${filename}` }],
          };
        }

        const raw = fs.readFileSync(filePath, 'utf-8');
        const backup = JSON.parse(raw);

        if (!backup.version || !backup.data) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: 'Error: Invalid backup file format' }],
          };
        }

        const types = ['positive', 'negative', 'auto'] as const;
        const results: Record<string, any> = {};

        for (const type of types) {
          const typeData = backup.data[type];
          if (!typeData) continue;

          // 그룹 복원
          let groupResult = { success: true, reassigned_groups: [] as any[], updated_prompts: 0, message: '' };
          if (typeData.groups && typeData.groups.length > 0) {
            groupResult = await PromptGroupService.importFromJSON(
              {
                groups: typeData.groups,
                metadata: {
                  export_date: backup.backup_date,
                  total_groups: typeData.groups.length,
                  type,
                },
              },
              type
            );
          }

          // 프롬프트 설정 복원
          let promptsUpdated = 0;
          if (typeData.prompts && typeData.prompts.length > 0) {
            // group_id 리매핑 적용
            const idMap = new Map<number, number>();
            for (const r of groupResult.reassigned_groups) {
              idMap.set(r.old_id, r.new_id);
            }

            const remappedPrompts = typeData.prompts.map((p: any) => ({
              ...p,
              group_id: p.group_id ? (idMap.get(p.group_id) ?? p.group_id) : null,
            }));

            promptsUpdated = PromptCollectionModel.importSettings(remappedPrompts, type);
          }

          results[type] = {
            groups_restored: typeData.groups?.length ?? 0,
            prompts_updated: promptsUpdated,
            group_reassignments: groupResult.reassigned_groups.length,
          };
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              backup_date: backup.backup_date,
              results,
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

  server.tool(
    'list_backups',
    'List all available prompt data backup files in the backups directory.',
    {},
    async () => {
      try {
        ensureBackupsDir();

        const files = fs.readdirSync(BACKUPS_DIR)
          .filter(f => f.endsWith('.json'))
          .map(filename => {
            const filePath = path.join(BACKUPS_DIR, filename);
            const stat = fs.statSync(filePath);

            let metadata = null;
            try {
              const raw = fs.readFileSync(filePath, 'utf-8');
              const parsed = JSON.parse(raw);
              metadata = {
                version: parsed.version,
                backup_date: parsed.backup_date,
                ...parsed.metadata,
              };
            } catch {
              // 메타데이터 파싱 실패시 무시
            }

            return {
              filename,
              size_bytes: stat.size,
              modified_at: stat.mtime.toISOString(),
              metadata,
            };
          })
          .sort((a, b) => b.modified_at.localeCompare(a.modified_at));

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              backups: files,
              total: files.length,
              backups_dir: BACKUPS_DIR,
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
