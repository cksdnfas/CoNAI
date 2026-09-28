import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { GroupModel, ImageGroupModel } from '../../models/Group';
import { GroupPathError, GroupPathService } from '../../services/groupPathService';
import { mcpGroupPathSchema, resolveMcpTargetGroup } from './mcpTargetGroup';

type GroupSummary = {
  id: number;
  name: string;
  parent_id: number | null;
  path: string;
  image_count: number;
  child_count: number;
};

function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function errorResult(prefix: string, error: unknown) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: `${prefix}: ${error instanceof Error ? error.message : String(error)}` }],
  };
}

/** 전체 그룹을 루트부터의 경로와 함께 평탄화한다. */
function listGroupSummaries(): GroupSummary[] {
  const groups = GroupModel.findAllWithHierarchy();
  const byId = new Map(groups.map((group) => [group.id, group]));
  const pathCache = new Map<number, string>();

  const buildPath = (id: number, guard = 0): string => {
    const cached = pathCache.get(id);
    if (cached !== undefined) return cached;
    const group = byId.get(id);
    if (!group) return '';
    const parentPath = group.parent_id && guard < 10 ? buildPath(group.parent_id, guard + 1) : '';
    const path = parentPath ? `${parentPath}/${group.name}` : group.name;
    pathCache.set(id, path);
    return path;
  };

  return groups
    .map((group) => ({
      id: group.id,
      name: group.name,
      parent_id: group.parent_id ?? null,
      path: buildPath(group.id),
      image_count: group.image_count ?? 0,
      child_count: group.child_count ?? 0,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function registerImageGroupTools(server: McpServer): void {
  server.tool(
    'list_image_groups',
    "List image groups (the library's folder-like collections) with their full 'Parent/Child' paths and image counts.",
    {
      under_path: z.string().trim().min(1).optional().describe("Only return this group and its descendants, e.g. 'ProjectName'"),
      query: z.string().trim().min(1).optional().describe('Case-insensitive substring filter on the full path'),
    },
    async ({ under_path, query }) => {
      try {
        let groups = listGroupSummaries();

        if (under_path) {
          const root = GroupPathService.resolve(under_path, { create: false });
          if (!root) {
            return textResult({ groups: [], total: 0, message: `Group path not found: ${under_path}` });
          }
          const prefix = `${root.path.toLowerCase()}/`;
          groups = groups.filter((group) => group.id === root.groupId || group.path.toLowerCase().startsWith(prefix));
        }

        if (query) {
          const needle = query.toLowerCase();
          groups = groups.filter((group) => group.path.toLowerCase().includes(needle));
        }

        return textResult({ groups, total: groups.length });
      } catch (error) {
        if (error instanceof GroupPathError) {
          return errorResult('Invalid group path', error);
        }
        return errorResult('Failed to list image groups', error);
      }
    },
  );

  server.tool(
    'resolve_image_group_path',
    "Resolve an image group path like 'ProjectName/Effects' to a group id. With create=true (default) missing groups are created under their parent.",
    {
      path: z.string().trim().min(1).max(1024).describe("Slash-separated group path, e.g. 'ProjectName/Effects' (max 5 levels)"),
      create: z.boolean().default(true).describe('Create missing groups along the path'),
    },
    async ({ path, create }) => {
      try {
        const resolved = GroupPathService.resolve(path, { create });
        if (!resolved) {
          return textResult({ found: false, path });
        }
        return textResult({
          found: true,
          group_id: resolved.groupId,
          path: resolved.path,
          segments: resolved.segments,
          created_group_ids: resolved.createdGroupIds,
        });
      } catch (error) {
        return errorResult('Failed to resolve group path', error);
      }
    },
  );

  server.tool(
    'add_images_to_group',
    'Add existing library images (by composite_hash) to an image group, given by group_id or group_path. Assignments are manual and survive auto-collection reruns.',
    {
      composite_hashes: z.array(z.string().trim().min(1)).min(1).max(500).describe('Image composite hashes (from search_images or generation results)'),
      group_id: z.number().int().positive().optional(),
      group_path: mcpGroupPathSchema,
    },
    async ({ composite_hashes, group_id, group_path }) => {
      try {
        const targetGroupId = resolveMcpTargetGroup(group_id, group_path);
        if (!targetGroupId) {
          throw new Error('group_id or group_path is required');
        }

        let added = 0;
        let skipped = 0;
        // 이미 들어 있거나 존재하지 않는 hash 는 addImageToGroup 이 false 를 돌려준다.
        for (const compositeHash of new Set(composite_hashes)) {
          if (ImageGroupModel.addImageToGroup(targetGroupId, compositeHash, 'manual')) {
            added += 1;
          } else {
            skipped += 1;
          }
        }

        return textResult({
          group_id: targetGroupId,
          path: GroupPathService.getPathLabel(targetGroupId),
          added,
          skipped,
        });
      } catch (error) {
        return errorResult('Failed to add images to group', error);
      }
    },
  );
}
