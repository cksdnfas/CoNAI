import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { PromptCollectionModel } from '../../models/PromptCollection';
import { PromptGroupModel } from '../../models/PromptGroup';
import { PromptGroupService } from '../../services/promptGroupService';
import { PromptCollectionService } from '../../services/promptCollectionService';
import { runtimePaths } from '../../config/runtimePaths';
import { errorResult, textResult } from '../toolResults';

const BACKUPS_DIR = path.join(runtimePaths.basePath, 'backups');

function resolveBackupPath(filename: string): { filename: string; filePath: string } {
  const normalized = filename.endsWith('.json') ? filename : `${filename}.json`;
  if (!/^[A-Za-z0-9._-]+\.json$/.test(normalized) || normalized.includes('..') || path.basename(normalized) !== normalized) {
    throw new Error('Invalid backup filename');
  }
  const filePath = path.resolve(BACKUPS_DIR, normalized);
  if (path.dirname(filePath) !== path.resolve(BACKUPS_DIR)) {
    throw new Error('Invalid backup filename');
  }
  return { filename: normalized, filePath };
}

function ensureBackupsDir(): void {
  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  }
}

export function registerPromptOrganizationTools(server: McpServer): void {

  // ─── 조회 도구 ───

  server.registerTool(
    'get_prompt_group_structure',
    { description: 'Get prompt group hierarchy and counts before reorganizing. Use get_prompts_in_group to inspect a selected group.', inputSchema: z.object({
      type: z.enum(['positive', 'negative', 'auto']).default('positive').describe('Prompt type'),
      include_hidden: z.boolean().default(true).describe('Include hidden groups'),
    }) },
    async ({ type, include_hidden }) => {
      try {
        const groups = await PromptGroupService.getAllGroups(include_hidden, type);

        return textResult({
          groups,
          total_groups: groups.length,
          type,
        });
      } catch (error) {
        return errorResult(`Error: ${(error as Error).message}`);
      }
    }
  );

  server.registerTool(
    'get_prompts_in_group',
    { description: 'Read a page of group prompts with has_more/next_page; follow next_page using the same filters. If the group is wrong, select it from get_prompt_group_structure.', inputSchema: z.object({
      group_id: z.number().int().min(0).describe('Group ID (0 for Unclassified)'),
      type: z.enum(['positive', 'negative', 'auto']).default('positive').describe('Prompt type'),
      page: z.number().int().min(1).default(1).describe('Page number'),
      limit: z.number().int().min(1).max(100).default(50).describe('Results per page'),
      query: z.string().default('').describe('Literal contains search'),
      sort_by: z.enum(['usage_count', 'created_at', 'prompt']).default('usage_count'),
      sort_order: z.enum(['ASC', 'DESC']).default('DESC'),
      include_total: z.boolean().default(true).describe('Request exact contains-search total; false omits total and skips counting, useful on subsequent pages'),
    }) },
    async ({ group_id, type, page, limit, query, sort_by, sort_order, include_total }) => {
      try {
        const result = await PromptGroupService.getPromptsInGroup(
          group_id === 0 ? null : group_id,
          type,
          page,
          limit,
          query,
          sort_by,
          sort_order,
          include_total
        );

        return textResult({
          group_id,
          prompts: result.prompts,
          total: result.total,
          has_more: result.has_more,
          next_page: result.has_more ? page + 1 : null,
          page,
          limit,
          type,
        });
      } catch (error) {
        return errorResult(`Error: ${(error as Error).message}`);
      }
    }
  );

  // ─── 분류 도구 ───

  server.registerTool(
    'batch_create_groups',
    { description: 'Create prompt groups; returns created/existing IDs and per-group errors. Protected LoRA/Danbooru-managed destinations may refuse changes; correct reported names/parents and retry only failures.', inputSchema: z.object({
      groups: z.array(z.object({
        group_name: z.string().min(1).describe('Group name'),
        display_order: z.number().int().optional().describe('Display order'),
        is_visible: z.boolean().default(true).describe('Visibility'),
        parent_id: z.number().int().optional().describe('Parent group ID'),
      })).min(1).max(50).describe('Groups to create; existing names return their IDs'),
      type: z.enum(['positive', 'negative', 'auto']).default('positive').describe('Prompt type'),
    }) },
    async ({ groups, type }) => {
      try {
        // Through the service, as the prompt screen does: it refuses the protected LoRA name and Danbooru-managed parents.
        // A refusal is reported on its own group, so the groups made before it are not hidden behind a bare error.
        const results: Array<{ group_name: string; group_id?: number; is_new?: boolean; error?: string }> = [];
        for (const group of groups) {
          const existing = PromptGroupModel.findByName(group.group_name, type);
          try {
            const groupId = await PromptGroupService.createGroup(
              {
                group_name: group.group_name,
                display_order: group.display_order,
                is_visible: group.is_visible,
                parent_id: group.parent_id ?? null,
              },
              type
            );
            results.push({ group_name: group.group_name, group_id: groupId, is_new: !existing });
          } catch (error) {
            results.push({ group_name: group.group_name, error: (error as Error).message });
          }
        }
        const failed = results.filter(r => r.error !== undefined).length;

        return textResult({
          results,
          created: results.filter(r => r.is_new).length,
          existing: results.filter(r => r.is_new === false).length,
          failed,
          type,
        }, failed === results.length ? { isError: true } : {});
      } catch (error) {
        return errorResult(`Error: ${(error as Error).message}`);
      }
    }
  );

  server.registerTool(
    'move_prompts_between_groups',
    { description: 'Assign/move prompts to a group; returns moved/failed counts and the first error. Protected LoRA/Danbooru groups may refuse changes; inspect the error and choose an allowed target.', inputSchema: z.object({
      prompt_ids: z.array(z.number().int()).min(1).max(100).optional().describe('Specific prompt IDs; takes precedence over source_group_id; supply one selector'),
      source_group_id: z.number().int().min(0).optional().describe('Move all source prompts when prompt_ids is omitted; 0 means Unclassified'),
      target_group_id: z.number().int().min(0).describe('Target group ID (0 for Unclassified)'),
      type: z.enum(['positive', 'negative', 'auto']).default('positive').describe('Prompt type'),
    }) },
    async ({ prompt_ids, source_group_id, target_group_id, type }) => {
      try {
        if (!prompt_ids && source_group_id === undefined) {
          return errorResult('Error: Either prompt_ids or source_group_id must be provided');
        }

        const actualTargetId = target_group_id === 0 ? null : target_group_id;
        let promptIds: number[] = [];

        if (prompt_ids && prompt_ids.length > 0) {
          promptIds = prompt_ids;
        } else if (source_group_id !== undefined) {
          // source 그룹의 모든 프롬프트 조회 후 이동
          const sourceId = source_group_id === 0 ? null : source_group_id;
          promptIds = PromptCollectionModel.getPromptsByGroupId(sourceId, type).map((prompt) => prompt.id as number);
        }

        // The prompt screen's rules apply here too: the protected LoRA group and the groups Danbooru manages.
        const { moved, failed, firstError } = await PromptCollectionService.movePromptsToGroup(promptIds, actualTargetId, type);

        return textResult({
          moved_count: moved,
          fail_count: failed,
          ...(firstError ? { first_error: firstError } : {}),
          total: moved + failed,
          source_group_id: source_group_id ?? null,
          target_group_id,
          type,
        });
      } catch (error) {
        return errorResult(`Error: ${(error as Error).message}`);
      }
    }
  );

  // ─── 백업 도구 ───

  server.registerTool(
    'backup_prompt_data',
    { description: 'Back up all prompt groups and prompts for positive, negative and auto types to JSON; returns filename and counts. If the filename is invalid, omit it to generate one.', inputSchema: z.object({
      filename: z.string().optional().describe('Custom backup filename (auto-generated if omitted)'),
    }) },
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
          app: 'conai',
          backup_date: new Date().toISOString(),
          metadata,
          data,
        };

        const actualFilename = filename || `prompt_backup_${new Date().toISOString().replace(/[:.]/g, '-')}`;
        const resolvedBackup = resolveBackupPath(actualFilename);
        const filePath = resolvedBackup.filePath;

        fs.writeFileSync(filePath, JSON.stringify(backup), 'utf-8');

        return textResult({
          success: true,
          filename: resolvedBackup.filename,
          metadata,
        });
      } catch (error) {
        return errorResult(`Error: ${(error as Error).message}`);
      }
    }
  );

  server.registerTool(
    'restore_prompt_data',
    { description: 'Restore prompt groups, assignments and settings from a backup; updates existing prompts and creates missing ones. Returns per-type counts. If missing/invalid, choose a valid file from list_backups.', inputSchema: z.object({
      filename: z.string().describe('Backup filename (in the backups directory)'),
    }) },
    async ({ filename }) => {
      try {
        const filePath = resolveBackupPath(filename).filePath;

        if (!fs.existsSync(filePath)) {
          return errorResult(`Error: Backup file not found: ${filename}`);
        }

        const raw = fs.readFileSync(filePath, 'utf-8');
        const backup = JSON.parse(raw);

        if (!backup.version || !backup.data) {
          return errorResult('Error: Invalid backup file format');
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

        return textResult({
          success: true,
          backup_date: backup.backup_date,
          results,
        });
      } catch (error) {
        return errorResult(`Error: ${(error as Error).message}`);
      }
    }
  );

  server.registerTool(
    'list_backups',
    { description: 'List all available prompt data backup files in the backups directory.', inputSchema: z.object({}) },
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

        return textResult({
          backups: files,
          total: files.length,
        });
      } catch (error) {
        return errorResult(`Error: ${(error as Error).message}`);
      }
    }
  );
}
