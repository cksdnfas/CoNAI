import { hasConfiguredAuth } from '../routes/auth-route-helpers';
import { GroupModel, ImageGroupModel } from '../models/Group';
import { AuthAccessControlService } from './authAccessControlService';
import { GroupPathError, GroupPathService } from './groupPathService';

/**
 * 생성 요청의 "대상 그룹" 입력(id 또는 `프로젝트/이펙트` 경로)을 검증하고 그룹 id 로 확정한다.
 * 대기열 HTTP, MCP, 그래프 워크플로우 실행이 같은 규칙을 쓴다.
 *
 * 경로는 없는 단계를 만들어 가며 해석하므로, 다른 검증을 모두 통과한 뒤 마지막에 호출해야
 * 거절될 요청 때문에 그룹이 생기지 않는다.
 */

export type GenerationTargetGroupInput = {
  groupId?: unknown;
  groupPath?: unknown;
};

export type GenerationTargetGroupResult =
  | { ok: true; groupId: number | null; path: string | null }
  | { ok: false; status: 400 | 403 | 404; error: string };

const GROUP_PERMISSION_KEY = 'images.edit';

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && !(typeof value === 'string' && value.trim() === '');
}

/** Callers already enforce the trusted HTTP/bootstrap boundary. Configured null accounts never inherit it. */
function hasGroupPermission(accountId: number | null | undefined, permission: string): boolean {
  if (accountId == null) return !hasConfiguredAuth() && AuthAccessControlService.resolveBootstrapAccess().permissionKeys.includes(permission);
  return AuthAccessControlService.hasPermission(accountId, permission);
}

/** 그룹 지정 권한. 그룹 생성/이미지 추가 라우트와 같은 권한 키를 요구한다. */
export function canAssignGenerationGroup(accountId: number | null | undefined): boolean {
  return hasGroupPermission(accountId, GROUP_PERMISSION_KEY);
}

/**
 * 생성 기록(history) 행이 없는 추가 출력(예: Comfy 배치의 2번째 이후 이미지)을 그룹에 직접 넣는다.
 * 대표 이미지는 history 의 assigned_group_id 경로로 들어가므로 중복돼도 무해하다(UNIQUE 무시).
 */
export function assignGeneratedMediaToGroup(groupId: number | null | undefined, compositeHashes: string[]): number {
  if (!groupId || compositeHashes.length === 0) {
    return 0;
  }
  if (!GroupModel.findById(groupId)) {
    console.warn(`⚠️ Target group ${groupId} no longer exists; skipped assigning ${compositeHashes.length} generated output(s)`);
    return 0;
  }
  let added = 0;
  for (const compositeHash of new Set(compositeHashes)) {
    if (ImageGroupModel.addImageToGroup(groupId, compositeHash, 'manual')) {
      added += 1;
    }
  }
  return added;
}

export class GenerationTargetGroupService {
  /** 입력이 하나라도 있는지(권한 검사 여부 판단용). */
  static hasTarget(input: GenerationTargetGroupInput): boolean {
    return hasValue(input.groupId) || hasValue(input.groupPath);
  }

  /**
   * 권한 검사 없이 입력을 해석한다. 호출자가 `canAssignGenerationGroup` 으로 먼저 거른다.
   * 경로가 주어지면 없는 그룹을 만든다.
   */
  static resolve(input: GenerationTargetGroupInput): GenerationTargetGroupResult {
    const hasId = hasValue(input.groupId);
    const hasPath = hasValue(input.groupPath);

    if (!hasId && !hasPath) {
      return { ok: true, groupId: null, path: null };
    }

    if (hasId && hasPath) {
      return { ok: false, status: 400, error: 'Specify either a group id or a group path, not both' };
    }

    if (hasPath) {
      try {
        const resolved = GroupPathService.resolveOrCreate(input.groupPath);
        return { ok: true, groupId: resolved.groupId, path: resolved.path };
      } catch (error) {
        if (error instanceof GroupPathError) {
          return { ok: false, status: 400, error: error.message };
        }
        throw error;
      }
    }

    const groupId = typeof input.groupId === 'number' ? input.groupId : Number(input.groupId);
    if (!Number.isInteger(groupId) || groupId <= 0) {
      return { ok: false, status: 400, error: 'Group id must be a positive integer' };
    }
    if (!GroupModel.findById(groupId)) {
      return { ok: false, status: 404, error: `Group ${groupId} not found` };
    }
    return { ok: true, groupId, path: GroupPathService.getPathLabel(groupId) };
  }

  /** 권한 검사 + 해석을 한 번에. */
  static resolveForAccount(accountId: number | null | undefined, input: GenerationTargetGroupInput): GenerationTargetGroupResult {
    if (!this.hasTarget(input)) {
      return { ok: true, groupId: null, path: null };
    }
    if (!canAssignGenerationGroup(accountId)) {
      return { ok: false, status: 403, error: 'Group permission is required to assign generated images to a group' };
    }
    if (hasValue(input.groupPath) && !hasGroupPermission(accountId, 'images.edit')) {
      return { ok: false, status: 403, error: 'Group creation permission is required to resolve generated image group paths' };
    }
    return this.resolve(input);
  }
}
