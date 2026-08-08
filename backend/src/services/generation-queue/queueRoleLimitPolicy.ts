import { getAuthDb } from '../../database/authDb'
import { GenerationQueueModel } from '../../models/GenerationQueue'
import { parseWorkflowRoleQueueLimits } from '../../models/Workflow'
import type { GenerationQueueJobStatus } from '../../types/generationQueue'
import type { WorkflowRecord } from '../../types/workflow'

/** 회원 1인의 자리(slot)를 차지하는 상태. routes/generation-queue/queue-route-helpers.ts 의 ACTIVE_QUEUE_STATUSES 와 동일해야 한다. */
const ACTIVE_QUEUE_STATUSES: GenerationQueueJobStatus[] = ['queued', 'dispatching', 'running']

/** 시스템 그룹의 한국어 표기. 커스텀 그룹은 저장된 name 을 그대로 쓴다. */
const BUILT_IN_GROUP_LABELS_KO: Record<string, string> = {
  anonymous: '익명',
  guest: '게스트',
  admin: '관리자',
}

type WorkflowRoleQueueLimitWorkflow = Pick<WorkflowRecord, 'id' | 'public_queue_role_limits'>

interface RequesterPrimaryGroupRow {
  group_key: string
  name: string
}

export interface WorkflowRoleQueueLimitState {
  groupKey: string
  groupLabel: string
  limit: number
  active: number
}

/**
 * 요청자의 등급 = 소속 권한 그룹 중 priority 가 가장 높은 그룹.
 * (상속 부모는 항상 더 낮은 priority 라 직접 멤버십만 보면 된다.)
 * 멤버십이 없으면 세션 account_type('admin'|'guest')의 시스템 그룹으로 폴백한다.
 */
function resolveRequesterPrimaryGroup(accountId: number, accountType: string | null): RequesterPrimaryGroupRow | null {
  const db = getAuthDb()
  const membershipRow = db.prepare(`
    SELECT g.group_key, g.name
    FROM auth_account_group_memberships agm
    INNER JOIN auth_permission_groups g ON g.id = agm.group_id
    WHERE agm.account_id = ?
    ORDER BY g.priority DESC, g.id ASC
    LIMIT 1
  `).get(accountId) as RequesterPrimaryGroupRow | undefined

  if (membershipRow) {
    return membershipRow
  }

  if (!accountType) {
    return null
  }

  const fallbackRow = db.prepare(`
    SELECT group_key, name
    FROM auth_permission_groups
    WHERE group_key = ?
  `).get(accountType) as RequesterPrimaryGroupRow | undefined

  return fallbackRow ?? { group_key: accountType, name: accountType }
}

function resolveGroupLabel(group: RequesterPrimaryGroupRow) {
  return BUILT_IN_GROUP_LABELS_KO[group.group_key] ?? (group.name.trim() || group.group_key)
}

/**
 * 요청자에게 적용되는 등급별 동시 대기열 상태를 계산한다.
 * 제한이 없거나(미설정 등급 포함) 요청자를 특정할 수 없으면 null.
 * 제한은 회원 개인 단위다: 같은 등급이라도 각자 자기 활성 잡 수만 계산된다.
 */
export function resolveWorkflowRoleQueueLimitState(input: {
  workflow: WorkflowRoleQueueLimitWorkflow
  accountId: number | null
  accountType: string | null
}): WorkflowRoleQueueLimitState | null {
  const limits = parseWorkflowRoleQueueLimits(input.workflow.public_queue_role_limits)
  if (!limits) {
    return null
  }

  // bootstrap(무인증 모드)·시스템 enqueue 는 계정이 없어 개인별 카운트가 불가능하므로 제한하지 않는다.
  if (input.accountId === null) {
    return null
  }

  const primaryGroup = resolveRequesterPrimaryGroup(input.accountId, input.accountType)
  if (!primaryGroup) {
    return null
  }

  const limit = limits[primaryGroup.group_key]
  if (limit === undefined) {
    return null
  }

  const active = GenerationQueueModel.countListRecords({
    statuses: ACTIVE_QUEUE_STATUSES,
    workflowId: input.workflow.id,
    requesterAccountId: input.accountId,
  })

  return {
    groupKey: primaryGroup.group_key,
    groupLabel: resolveGroupLabel(primaryGroup),
    limit,
    active,
  }
}

/**
 * enqueue 직전 검사. 요청을 받아들이면 등급 제한을 넘는 경우에만 위반 상태를 돌려준다.
 * 호출 지점과 잡 생성 사이에 await 가 없어야 카운트-생성 레이스가 없다(better-sqlite3 동기 API 전제).
 */
export function checkWorkflowRoleQueueLimit(input: {
  workflow: WorkflowRoleQueueLimitWorkflow
  accountId: number | null
  accountType: string | null
  requestedCount: number
}): WorkflowRoleQueueLimitState | null {
  const state = resolveWorkflowRoleQueueLimitState(input)
  if (!state) {
    return null
  }

  return state.active + input.requestedCount > state.limit ? state : null
}

/** 위반 시 사용자에게 그대로 노출되는 안내 문구. */
export function buildWorkflowRoleQueueLimitMessage(state: WorkflowRoleQueueLimitState): string {
  if (state.limit <= 0) {
    return `${state.groupLabel} 등급은 이 워크플로우에서 대기열을 만들 수 없어.`
  }

  if (state.active >= state.limit) {
    return `${state.groupLabel} 등급은 이 워크플로우에서 동시에 ${state.limit}개까지만 대기열을 만들 수 있어. 이미 진행 중인 요청 ${state.active}개가 끝난 뒤에 다시 시도해줘.`
  }

  const remaining = state.limit - state.active
  return `${state.groupLabel} 등급은 이 워크플로우에서 동시에 ${state.limit}개까지만 대기열을 만들 수 있어. 지금 ${state.active}개가 진행 중이라 ${remaining}개까지만 추가할 수 있어.`
}
