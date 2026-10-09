import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { db } from '../../database/init';
import { GroupModel, ImageGroupModel } from '../../models/Group';
import { MediaMetadataModel } from '../../models/Image/MediaMetadataModel';
import { MediaPostprocessVisibilityService } from '../../services/mediaPostprocessVisibilityService';
import { GroupPathError, GroupPathService } from '../../services/groupPathService';
import { mcpGroupPathSchema, resolveMcpTargetGroup } from './mcpTargetGroup';
import {
  buildGroupAutoCollectFilter,
  GROUP_AUTO_COLLECT_AI_TOOLS,
  GROUP_AUTO_COLLECT_OPERATORS,
  GROUP_AUTO_COLLECT_RULE_LIMIT,
  GROUP_AUTO_COLLECT_SCOPES,
  readGroupAutoCollectRules,
  type GroupRecord,
} from '@conai/shared';
import type { McpRequestContext } from '../context';
import { createCustomGroup, updateCustomGroup } from '../../services/groupMutationService';
import { GroupRematchJobService, type GroupRematchJobRecord } from '../../services/groupRematchJobService';

type GroupSummary = {
  id: number;
  name: string;
  parent_id: number | null;
  path: string;
  image_count: number;
  child_count: number;
};

function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
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

const autoCollectRulesSchema = z.array(z.object({
  scope: z.enum(GROUP_AUTO_COLLECT_SCOPES).describe(
    "positive / negative: text contained in the positive / negative prompt; auto_tag: an auto tagger tag (general or character), e.g. 'misty_(pokemon)'; "
    + `model: checkpoint name; lora: LoRA name; ai_tool: one of ${GROUP_AUTO_COLLECT_AI_TOOLS.join(', ')}`,
  ),
  operator: z.enum(GROUP_AUTO_COLLECT_OPERATORS).default('AND').describe('AND: every AND rule must match; OR: at least one OR rule must match; NOT: matching images are excluded'),
  value: z.string().trim().min(1).max(500),
})).min(1).max(GROUP_AUTO_COLLECT_RULE_LIMIT)
  .describe('Complete auto-collect rule list (replaces any previous conditions). The same rules the group editor shows as chips.');

/** Group names are path segments; a slash would make the group unreachable by path. */
const groupNameSchema = z.string().trim().min(1).max(200).refine((name) => !/[/\\]/.test(name), 'Group name cannot contain / or \\');

function summarizeJob(job: GroupRematchJobRecord | null) {
  return job ? { job_id: job.job_id, status: job.status } : null;
}

/** Settings view of one custom group; conditions the rules cannot express are returned raw instead of dropped. */
function describeGroup(group: GroupRecord) {
  const stats = GroupModel.findAllWithStats().find((row) => row.id === group.id);
  const rules = readGroupAutoCollectRules(group.auto_collect_conditions);
  return {
    group_id: group.id,
    name: group.name,
    path: GroupPathService.getPathLabel(group.id),
    parent_id: group.parent_id ?? null,
    description: group.description ?? null,
    color: group.color ?? null,
    emoticon_enabled: Boolean(group.emoticon_enabled),
    image_count: stats?.image_count ?? 0,
    auto_collected_count: stats?.auto_collected_count ?? 0,
    manual_added_count: stats?.manual_added_count ?? 0,
    auto_collect: {
      enabled: Boolean(group.auto_collect_enabled),
      rules,
      ...(rules === null ? { custom_conditions: group.auto_collect_conditions, note: 'These conditions cannot be shown as rules; passing auto_collect_rules replaces them.' } : {}),
      last_run: group.auto_collect_last_run ?? null,
    },
  };
}

function resolveParentGroup(parentId?: number, parentPath?: string): number | null {
  if (parentId === undefined && parentPath === undefined) return null;
  return resolveExistingGroup(parentId, parentPath);
}

export function registerImageGroupTools(server: McpServer, context: McpRequestContext): void {
  const requesterAccountId = context.requester?.accountId ?? null;

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

  server.tool(
    'get_image_group',
    'Read one custom image group\'s settings: name, path, description, color, image counts and its auto-collect state and rules. Read this before changing a group with update_image_group.',
    {
      group_id: z.number().int().positive().optional(),
      group_path: existingGroupPathSchema,
    },
    async ({ group_id, group_path }) => {
      try {
        const group = GroupModel.findById(resolveExistingGroup(group_id, group_path));
        if (!group) throw new Error('Group not found');
        return textResult(describeGroup(group));
      } catch (error) {
        return errorResult('Failed to get image group', error);
      }
    },
  );

  server.tool(
    'create_image_group',
    'Create one custom image group, optionally under an existing parent (max 5 levels; sibling names are unique, case-insensitive). With auto_collect_rules the group collects matching library images: auto-collection is enabled and its first run starts right away in the background. For an empty group by path alone, resolve_image_group_path is enough.',
    {
      name: groupNameSchema,
      parent_id: z.number().int().positive().optional().describe('Existing parent group ID; omit both parent fields for a top-level group'),
      parent_path: existingGroupPathSchema.describe("Existing parent group path, e.g. 'Characters'. Never creates the parent."),
      description: z.string().trim().max(2000).optional(),
      color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional().describe('Accent color like #7c3aed'),
      auto_collect_rules: autoCollectRulesSchema.optional(),
    },
    async ({ name, parent_id, parent_path, description, color, auto_collect_rules }) => {
      try {
        const parentId = resolveParentGroup(parent_id, parent_path);
        const { id, autoCollectJob } = createCustomGroup({
          name,
          parent_id: parentId,
          description: description || undefined,
          color,
          auto_collect_enabled: Boolean(auto_collect_rules),
          auto_collect_conditions: auto_collect_rules ? buildGroupAutoCollectFilter(auto_collect_rules) : undefined,
        }, requesterAccountId);
        return textResult({ ...describeGroup(GroupModel.findById(id)!), auto_collect_job: summarizeJob(autoCollectJob) });
      } catch (error) {
        return errorResult('Failed to create image group', error);
      }
    },
  );

  server.tool(
    'update_image_group',
    'Change one custom image group\'s name, description, color or auto-collect settings. Only given fields change. auto_collect_rules replaces the whole rule list and enables auto-collection; auto_collect_enabled=false stops future collection (images already collected stay). Saving enabled rules starts a background auto-collect run. Moving or deleting groups is not available here.',
    {
      group_id: z.number().int().positive().optional(),
      group_path: existingGroupPathSchema,
      name: groupNameSchema.optional(),
      description: z.string().trim().max(2000).optional().describe('Empty string clears the description'),
      color: z.string().trim().regex(/^(#[0-9a-fA-F]{6})?$/).optional().describe('Accent color like #7c3aed; empty string clears it'),
      auto_collect_enabled: z.boolean().optional(),
      auto_collect_rules: autoCollectRulesSchema.optional(),
    },
    async ({ group_id, group_path, name, description, color, auto_collect_enabled, auto_collect_rules }) => {
      try {
        const id = resolveExistingGroup(group_id, group_path);
        const group = GroupModel.findById(id)!;
        const enabled = auto_collect_enabled ?? (auto_collect_rules ? true : undefined);
        if (auto_collect_rules && enabled === false) throw new Error('auto_collect_rules requires auto_collect_enabled to stay true');
        let conditions = auto_collect_rules ? buildGroupAutoCollectFilter(auto_collect_rules) : undefined;
        if (enabled && !conditions) {
          // Re-enabling keeps the stored conditions; they are re-validated and collected again.
          if (!group.auto_collect_conditions?.trim()) throw new Error('This group has no auto-collect conditions; pass auto_collect_rules');
          conditions = JSON.parse(group.auto_collect_conditions);
        }
        if ([name, description, color, enabled, conditions].every((value) => value === undefined)) throw new Error('Nothing to update');
        const { autoCollectJob } = updateCustomGroup(id, {
          name,
          description: description === undefined ? undefined : description || null,
          color: color === undefined ? undefined : color || null,
          auto_collect_enabled: enabled,
          auto_collect_conditions: conditions,
        }, requesterAccountId);
        return textResult({ ...describeGroup(GroupModel.findById(id)!), auto_collect_job: summarizeJob(autoCollectJob) });
      } catch (error) {
        return errorResult('Failed to update image group', error);
      }
    },
  );

  server.tool(
    'run_group_auto_collect',
    'Run auto-collection again for one custom group that has auto-collect enabled. It runs in the background; the result reports the job id and status. Creating or updating a group with rules already starts a run.',
    {
      group_id: z.number().int().positive().optional(),
      group_path: existingGroupPathSchema,
    },
    async ({ group_id, group_path }) => {
      try {
        const id = resolveExistingGroup(group_id, group_path);
        if (!GroupModel.findById(id)?.auto_collect_enabled) throw new Error('Auto-collect is not enabled for this group');
        const job = GroupRematchJobService.startJobProcess('group-auto-collect', { groupId: id, requestedByAccountId: requesterAccountId });
        return textResult({ group_id: id, path: GroupPathService.getPathLabel(id), auto_collect_job: summarizeJob(job) });
      } catch (error) {
        return errorResult('Failed to run group auto-collect', error);
      }
    },
  );
}
