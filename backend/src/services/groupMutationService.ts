import type { AutoCollectCondition, ComplexFilter, GroupCreateData, GroupUpdateData } from '@conai/shared';
import { GroupModel } from '../models/Group';
import { AutoCollectionService } from './autoCollectionService';
import { ComplexFilterService } from './complexFilterService';
import { getGroupHierarchyService } from './groupHierarchyService';
import { GROUP_NAME_CONFLICT_MESSAGE, isGroupNameConflictError } from './groupPathService';
import { GroupRematchJobService, type GroupRematchJobRecord } from './groupRematchJobService';
import { executeGroupMove, GroupMoveError } from './groupMoveService';
import type { GroupMoveOptions } from '@conai/shared';

/** A request the caller can fix; routes answer 400, MCP tools report the message. */
export class GroupMutationError extends Error {}

function validateAutoCollectConditions(conditions: AutoCollectCondition[] | ComplexFilter): { valid: boolean; errors: string[] } {
  const isComplexFilter = conditions && typeof conditions === 'object' && !Array.isArray(conditions);
  return isComplexFilter
    ? ComplexFilterService.validateFilter(conditions as ComplexFilter)
    : AutoCollectionService.validateConditions(conditions as AutoCollectCondition[]);
}

/** Conditions are checked only when the request enables auto-collection and supplies them. */
function requireValidAutoCollect(enabled: boolean | undefined, conditions: AutoCollectCondition[] | ComplexFilter | undefined) {
  if (!enabled || !conditions) return;
  const validation = validateAutoCollectConditions(conditions);
  if (!validation.valid) throw new GroupMutationError(`Invalid auto collection conditions: ${validation.errors.join(', ')}`);
}

/** Start the group's auto-collect job; a failed start never fails the save itself. */
function startAutoCollect(groupId: number, requestedByAccountId: number | null, label: string): GroupRematchJobRecord | null {
  try {
    return GroupRematchJobService.startJobProcess('group-auto-collect', { groupId, requestedByAccountId });
  } catch (error) {
    console.warn(`Auto collection job failed to start ${label}:`, error);
    return null;
  }
}

function rethrowNameConflict(error: unknown): never {
  if (isGroupNameConflictError(error)) throw new GroupMutationError(GROUP_NAME_CONFLICT_MESSAGE);
  throw error;
}

/** Create a custom group; enabled conditions start an auto-collect job right away. */
export function createCustomGroup(data: GroupCreateData, requestedByAccountId: number | null) {
  if (typeof data.name !== 'string' || !data.name.trim()) throw new GroupMutationError('Group name is required');
  if (data.parent_id !== undefined && data.parent_id !== null) {
    if (getGroupHierarchyService().calculateDepth(data.parent_id) >= 4) {
      throw new GroupMutationError('Maximum hierarchy depth (5 levels) would be exceeded');
    }
  }
  requireValidAutoCollect(data.auto_collect_enabled, data.auto_collect_conditions);

  let id: number;
  try {
    id = GroupModel.create(data);
  } catch (error) {
    rethrowNameConflict(error);
  }
  const autoCollectJob = data.auto_collect_enabled && data.auto_collect_conditions ? startAutoCollect(id, requestedByAccountId, 'for new group') : null;
  return { id, autoCollectJob };
}

/** Update a custom group. `updated` is false when the group is missing or nothing changed. */
export function updateCustomGroup(id: number, data: GroupUpdateData, requestedByAccountId: number | null) {
  if (data.parent_id !== undefined) {
    const validation = getGroupHierarchyService().validateHierarchy(id, data.parent_id);
    if (!validation.valid) throw new GroupMutationError(validation.error || 'Invalid hierarchy');
  }
  requireValidAutoCollect(data.auto_collect_enabled, data.auto_collect_conditions);

  let updated: boolean;
  try {
    updated = GroupModel.update(id, data);
  } catch (error) {
    rethrowNameConflict(error);
  }
  const autoCollectJob = updated && data.auto_collect_enabled && data.auto_collect_conditions ? startAutoCollect(id, requestedByAccountId, 'after group update') : null;
  return { updated, autoCollectJob };
}

const BULK_GROUP_LIMIT = 500;

function requireGroupIds(ids: unknown): number[] {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > BULK_GROUP_LIMIT || !ids.every((id) => Number.isInteger(id) && id > 0)) {
    throw new GroupMutationError(`Group IDs must be 1-${BULK_GROUP_LIMIT} positive integers`);
  }
  return [...new Set(ids as number[])];
}

/**
 * Delete several custom groups in one transaction. Without cascade their child groups move to the top level, as with a
 * single delete; images only lose the membership.
 */
export function deleteCustomGroups(ids: unknown, cascade: boolean) {
  return GroupModel.deleteMany(requireGroupIds(ids), cascade);
}

/** Move several custom groups under one parent (null: top level); any invalid move cancels the whole batch. */
export function moveCustomGroups(ids: unknown, parentId: number | null, _requestedByAccountId: number | null, options: GroupMoveOptions = {}) {
  const groupIds = requireGroupIds(ids);
  if (options.edit) {
    if (groupIds.length !== 1 || typeof options.edit !== 'object' || Array.isArray(options.edit) || options.edit.parent_id !== undefined) throw new GroupMutationError('Move edit requires one group and no nested parent_id');
    if (options.edit.name !== undefined && (typeof options.edit.name !== 'string' || !options.edit.name.trim())) throw new GroupMutationError('Group name is required');
    requireValidAutoCollect(options.edit.auto_collect_enabled, options.edit.auto_collect_conditions);
    const { name, description, color, auto_collect_enabled, auto_collect_conditions, emoticon_enabled } = options.edit;
    options = { ...options, edit: { name: name?.trim(), description, color, auto_collect_enabled, auto_collect_conditions, emoticon_enabled } };
  }
  if (parentId !== null && (!Number.isInteger(parentId) || parentId <= 0 || !GroupModel.findById(parentId))) {
    throw new GroupMutationError('Target parent group not found');
  }
  try {
    const result = executeGroupMove(groupIds, parentId, options);
    if (!options.preview && options.edit?.auto_collect_enabled && options.edit.auto_collect_conditions && !result.merged[groupIds[0]]) startAutoCollect(groupIds[0], _requestedByAccountId, 'after group move/edit');
    return result;
  } catch (error) {
    if (error instanceof GroupMoveError) throw new GroupMutationError(error.message);
    rethrowNameConflict(error);
  }
}
