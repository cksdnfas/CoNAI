import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { db } from '../../database/init';
import { GroupModel, ImageGroupModel } from '../../models/Group';
import { MediaMetadataModel } from '../../models/Image/MediaMetadataModel';
import { MediaPostprocessVisibilityService } from '../../services/mediaPostprocessVisibilityService';
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

const compositeHashesSchema = z.array(z.string().trim().min(1)).min(1).max(500)
  .describe('Image composite hashes from search_images or generation results; duplicates are processed once');
const existingGroupPathSchema = z.string().trim().min(1).max(1024).optional()
  .describe("Existing custom image group path, e.g. 'ProjectName/Effects'. Never creates groups; use instead of the corresponding group ID.");

/** Removal and move lookups must never create a group for a mistyped path. */
function resolveExistingGroup(groupId?: number, groupPath?: string): number {
  if ((groupId !== undefined) === (groupPath !== undefined)) {
    throw new Error('Specify exactly one group ID or group path');
  }
  if (groupPath !== undefined) {
    const resolved = GroupPathService.resolve(groupPath, { create: false });
    if (!resolved) throw new Error(`Group path not found: ${groupPath}`);
    return resolved.groupId;
  }
  if (groupId === undefined || !GroupModel.findById(groupId)) {
    throw new Error(`Group ${groupId} not found`);
  }
  return groupId;
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
    "Resolve group_path like 'ProjectName/Effects' to an image group id. With create=true (default) missing groups are created under their parent. Use create=false to look up an existing group without creating it. Generation tools accept group_path directly, so this step is optional before generation.",
    {
      group_path: z.string().trim().min(1).max(1024).describe("Slash-separated library group path, e.g. 'ProjectName/Effects' (max 5 levels); not a filesystem path"),
      create: z.boolean().default(true).describe('Create missing groups along the path'),
    },
    async ({ group_path, create }) => {
      try {
        const resolved = GroupPathService.resolve(group_path, { create });
        if (!resolved) {
          return textResult({ found: false, path: group_path });
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
    'Add existing library images (by composite_hash) to a custom image group, given by group_id or group_path. Other memberships are preserved. Existing auto-collected memberships are converted to manual and survive auto-collection reruns. Missing images are reported in missing_hashes; database errors roll back the whole batch.',
    {
      composite_hashes: compositeHashesSchema,
      group_id: z.number().int().positive().optional(),
      group_path: mcpGroupPathSchema,
    },
    async ({ composite_hashes, group_id, group_path }) => {
      try {
        return textResult(db.transaction(() => {
          const targetGroupId = resolveMcpTargetGroup(group_id, group_path);
          if (!targetGroupId) {
            throw new Error('group_id or group_path is required');
          }
          return {
            group_id: targetGroupId,
            path: GroupPathService.getPathLabel(targetGroupId),
            ...ImageGroupModel.addImagesToGroupManually(targetGroupId, composite_hashes),
          };
        }).immediate());
      } catch (error) {
        return errorResult('Failed to add images to group', error);
      }
    },
  );

  server.tool(
    'get_image_groups',
    'List the direct custom image group memberships of an existing library image, with group IDs, full paths and manual/auto collection types. Watched-folder groups and inherited parent memberships are not included.',
    { composite_hash: z.string().trim().min(1) },
    async ({ composite_hash }) => {
      try {
        const metadata = MediaMetadataModel.findByHash(composite_hash);
        if (!MediaPostprocessVisibilityService.isReadyRecord(metadata)) {
          throw new Error(`Image with hash ${composite_hash} not found`);
        }
        const groups = ImageGroupModel.findGroupsByImage(composite_hash).map((membership) => ({
          group_id: membership.group_id,
          path: GroupPathService.getPathLabel(membership.group_id),
          collection_type: membership.collection_type,
        }));
        return textResult({ composite_hash, groups, total: groups.length });
      } catch (error) {
        return errorResult('Failed to get image groups', error);
      }
    },
  );

  server.tool(
    'remove_images_from_group',
    'Remove direct memberships from one existing custom image group, without deleting files or changing other groups. This is NOT a persistent exclusion: matching images may return on auto-collection. Missing memberships are skipped; database errors roll back the whole batch.',
    {
      composite_hashes: compositeHashesSchema,
      group_id: z.number().int().positive().optional(),
      group_path: existingGroupPathSchema,
    },
    async ({ composite_hashes, group_id, group_path }) => {
      try {
        return textResult(db.transaction(() => {
          const groupId = resolveExistingGroup(group_id, group_path);
          let removed = 0;
          const skipped_hashes: string[] = [];
          for (const hash of new Set(composite_hashes)) {
            if (ImageGroupModel.removeImageFromGroup(groupId, hash)) removed += 1;
            else skipped_hashes.push(hash);
          }
          return {
            group_id: groupId,
            path: GroupPathService.getPathLabel(groupId),
            removed,
            skipped: skipped_hashes.length,
            skipped_hashes,
            auto_collection_may_readd: true,
          };
        }).immediate());
      } catch (error) {
        return errorResult('Failed to remove images from group', error);
      }
    },
  );

  server.tool(
    'move_images_between_groups',
    'Atomically move selected direct image memberships between two different existing custom groups. Specify one ID or path per group. Only source members are moved; others are skipped. Target memberships become manual, even if already auto-collected. Other groups and files are unchanged. Source auto-collection may add the images back; this is not a persistent exclusion. Create missing target groups first with resolve_image_group_path.',
    {
      composite_hashes: compositeHashesSchema,
      source_group_id: z.number().int().positive().optional(),
      source_group_path: existingGroupPathSchema,
      target_group_id: z.number().int().positive().optional(),
      target_group_path: existingGroupPathSchema,
    },
    async ({ composite_hashes, source_group_id, source_group_path, target_group_id, target_group_path }) => {
      try {
        return textResult(db.transaction(() => {
          const sourceId = resolveExistingGroup(source_group_id, source_group_path);
          const targetId = resolveExistingGroup(target_group_id, target_group_path);
          if (sourceId === targetId) throw new Error('Source and target groups must be different');
          const hashes: string[] = [];
          const skipped_hashes: string[] = [];
          for (const hash of new Set(composite_hashes)) {
            if (ImageGroupModel.isImageInGroup(sourceId, hash)) hashes.push(hash);
            else skipped_hashes.push(hash);
          }
          const assigned = ImageGroupModel.addImagesToGroupManually(targetId, hashes);
          if (assigned.missing_hashes.length > 0) {
            throw new Error('Source contains missing images; move rolled back');
          }
          for (const hash of hashes) {
            if (!ImageGroupModel.removeImageFromGroup(sourceId, hash)) {
              throw new Error('Failed to remove source membership; move rolled back');
            }
          }
          return {
            source_group_id: sourceId,
            source_path: GroupPathService.getPathLabel(sourceId),
            target_group_id: targetId,
            target_path: GroupPathService.getPathLabel(targetId),
            moved: hashes.length,
            added: assigned.added,
            converted: assigned.converted,
            already_in_target: assigned.skipped,
            skipped: skipped_hashes.length,
            skipped_hashes,
            auto_collection_may_readd: true,
          };
        }).immediate());
      } catch (error) {
        return errorResult('Failed to move images between groups', error);
      }
    },
  );
}
