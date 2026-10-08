import type { AutoCollectCondition, ComplexFilter, GroupCreateData, GroupUpdateData } from '@conai/shared';
import { GroupModel } from '../models/Group';
import { AutoCollectionService } from './autoCollectionService';
import { ComplexFilterService } from './complexFilterService';
import { getGroupHierarchyService } from './groupHierarchyService';
import { GROUP_NAME_CONFLICT_MESSAGE, isGroupNameConflictError } from './groupPathService';
import { GroupRematchJobService, type GroupRematchJobRecord } from './groupRematchJobService';

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
