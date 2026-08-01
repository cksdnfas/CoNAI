import { GroupModel } from '../../../models/Group'
import { AutoCollectionService } from '../../autoCollectionService'
import { AutoFolderGroupService } from '../../autoFolderGroupService'
import { RuntimeJobRunner, type RuntimeJobContext } from '../runtimeJobRunner'

/**
 * 그룹 재매칭 잡 (`runGroupRematchJob.ts` 에서 이동).
 *
 * 실행 위치는 예전과 같이 별도 Node 프로세스(`execution: 'subprocess'`)다. 달라진 것은 상태 저장소로,
 * temp 디렉터리의 JSON 파일 대신 `runtime_jobs` 테이블을 쓴다. 그 덕에
 * - 쓰기 도중 폴링이 겹쳐 `JSON.parse` 가 터지는 창이 사라졌고,
 * - 재시작/자식 크래시로 잡이 영구 `running` 에 고착되지 않으며,
 * - `all-auto-collect` 를 그룹 경계에서 취소할 수 있다.
 */

export interface GroupAutoCollectJobParams {
  groupId: number
}

export type AllAutoCollectJobParams = Record<string, never>
export type AutoFolderRebuildJobParams = Record<string, never>

interface GroupAutoCollectEntry {
  group_id: number
  group_name: string
  images_added: number
  images_removed: number
  execution_time: number
}

export interface AllAutoCollectJobResult {
  results: GroupAutoCollectEntry[]
  total_groups: number
  total_images_added: number
  total_images_removed: number
}

function parseGroupId(params: GroupAutoCollectJobParams): number {
  const groupId = Number(params?.groupId)
  if (!Number.isInteger(groupId) || groupId <= 0) {
    throw new Error(`Invalid group id: ${String(params?.groupId)}`)
  }

  return groupId
}

/** Run auto-collection for one group. 진행률 해상도는 1단계뿐이라 total=1 로 고정한다. */
async function runGroupAutoCollect(ctx: RuntimeJobContext<GroupAutoCollectJobParams>) {
  const groupId = parseGroupId(ctx.params)
  ctx.flush({ total: 1, processed: 0, currentLabel: `group:${groupId}` })
  ctx.throwIfCancelled()

  const result = await AutoCollectionService.runAutoCollectionForGroup(groupId)
  ctx.flush({ total: 1, processed: 1, succeeded: 1, currentLabel: result.group_name })
  return result
}

/** Run auto-collection for every auto-collect enabled group, one group at a time. */
async function runAllAutoCollect(ctx: RuntimeJobContext<AllAutoCollectJobParams>): Promise<AllAutoCollectJobResult> {
  const groups = GroupModel.findAutoCollectEnabled()
  const results: GroupAutoCollectEntry[] = []

  ctx.flush({
    total: groups.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
    currentLabel: groups[0]?.name ?? null,
  })

  let succeeded = 0
  let failed = 0

  for (const group of groups) {
    // 그룹 경계가 유일한 안전한 취소 지점이다. 그룹 하나의 재매칭은 원자적으로 끝나야 한다.
    ctx.throwIfCancelled()
    ctx.report({ currentLabel: group.name })

    try {
      const result = await AutoCollectionService.runAutoCollectionForGroup(group.id)
      results.push(result)
      succeeded++
    } catch (error) {
      console.error(`Auto collection failed for group ${group.name} (${group.id}):`, error)
      ctx.recordError(`group:${group.id}`, error)
      results.push({
        group_id: group.id,
        group_name: group.name,
        images_added: 0,
        images_removed: 0,
        execution_time: 0,
      })
      failed++
    }

    ctx.report({
      processed: succeeded + failed,
      succeeded,
      failed,
      currentLabel: group.name,
    })
    await ctx.yield()
  }

  ctx.flush({ processed: succeeded + failed, succeeded, failed, currentLabel: null })

  return {
    results,
    total_groups: results.length,
    total_images_added: results.reduce((sum, item) => sum + item.images_added, 0),
    total_images_removed: results.reduce((sum, item) => sum + item.images_removed, 0),
  }
}

/** Rebuild every auto-folder group. 단일 서비스 호출이라 진행률은 0% 또는 100% 다. */
async function runAutoFolderRebuild(ctx: RuntimeJobContext<AutoFolderRebuildJobParams>) {
  ctx.flush({ total: 1, processed: 0, currentLabel: 'auto-folder-rebuild' })
  ctx.throwIfCancelled()

  const result = await AutoFolderGroupService.rebuildAllFolderGroups()
  if (!result.success) {
    throw new Error(result.error || 'Failed to rebuild auto-folder groups')
  }

  ctx.flush({ total: 1, processed: 1, succeeded: 1, currentLabel: null })
  return result
}

export function registerGroupRematchJobHandlers(): void {
  RuntimeJobRunner.register<GroupAutoCollectJobParams, unknown>({
    kind: 'group-auto-collect',
    // 그룹별 1개. 다른 그룹의 재매칭은 서로를 막지 않는다.
    singletonKey: (params) => `group-auto-collect:${params?.groupId ?? 'unknown'}`,
    execution: 'subprocess',
    handler: runGroupAutoCollect,
  })

  RuntimeJobRunner.register<AllAutoCollectJobParams, AllAutoCollectJobResult>({
    kind: 'all-auto-collect',
    singletonKey: () => 'all-auto-collect',
    execution: 'subprocess',
    handler: runAllAutoCollect,
  })

  RuntimeJobRunner.register<AutoFolderRebuildJobParams, unknown>({
    kind: 'auto-folder-rebuild',
    singletonKey: () => 'auto-folder-rebuild',
    execution: 'subprocess',
    handler: runAutoFolderRebuild,
  })
}
