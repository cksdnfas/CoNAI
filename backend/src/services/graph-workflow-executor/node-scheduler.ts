// 준비 노드 스케줄러. graphWorkflowExecutor.ts 는 6개 모델을 import 하므로 계약 스크립트가 실제 스케줄링을
// 돌려볼 수 없다. 그래서 스케줄러만 leaf 로 분리한다 → models/ database/ import 금지.
import {
  abortableDelay,
  getGraphAbortDrainTimeoutMs,
  resolveAbortReasonForError,
  GRAPH_EXECUTION_CANCELLED_MESSAGE,
  type GraphAbortReason,
} from './execution-abort'

const DEFAULT_MAX_PARALLEL_READY_NODES = 8
const DEFAULT_EXTERNAL_GENERATION_NODE_CONCURRENCY = 4
const THROTTLE_WAIT_POLL_INTERVAL_MS = 250

export type GraphNodeThrottleLane = 'external_generation'

const graphNodeThrottleState: Record<GraphNodeThrottleLane, { activeCount: number; waiters: Set<() => void> }> = {
  external_generation: {
    activeCount: 0,
    waiters: new Set<() => void>(),
  },
}

function parsePositiveIntegerEnv(name: string, fallback: number) {
  const rawValue = process.env[name]
  const numericValue = Number(rawValue)
  if (Number.isFinite(numericValue) && numericValue > 0) {
    return Math.floor(numericValue)
  }

  return fallback
}

function getMaxParallelReadyNodes() {
  return parsePositiveIntegerEnv('CONAI_GRAPH_READY_NODE_CONCURRENCY', DEFAULT_MAX_PARALLEL_READY_NODES)
}

function getGraphNodeThrottleLimit(lane: GraphNodeThrottleLane) {
  if (lane === 'external_generation') {
    return parsePositiveIntegerEnv('CONAI_GRAPH_EXTERNAL_GENERATION_NODE_CONCURRENCY', DEFAULT_EXTERNAL_GENERATION_NODE_CONCURRENCY)
  }

  return 1
}

function tryAcquireGraphNodeThrottleSlot(lane: GraphNodeThrottleLane) {
  const state = graphNodeThrottleState[lane]
  if (state.activeCount >= getGraphNodeThrottleLimit(lane)) {
    return false
  }

  state.activeCount += 1
  return true
}

function releaseGraphNodeThrottleSlot(lane: GraphNodeThrottleLane) {
  const state = graphNodeThrottleState[lane]
  state.activeCount = Math.max(0, state.activeCount - 1)
  const waiters = Array.from(state.waiters)
  state.waiters.clear()
  for (const waiter of waiters) {
    waiter()
  }
}

/** 레인 점유 상태를 읽는다. 슬롯이 abort 경로에서도 반납되는지 계약으로 고정하기 위한 관측 창구다. */
export function getGraphNodeThrottleActiveCount(lane: GraphNodeThrottleLane) {
  return graphNodeThrottleState[lane].activeCount
}

function waitForGraphNodeThrottleAvailability(lane: GraphNodeThrottleLane, signal?: AbortSignal) {
  const state = graphNodeThrottleState[lane]
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }

    let settled = false
    const finish = () => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timer)
      state.waiters.delete(waiter)
      // 실행 signal 은 장수명이라 once 등록과 해제를 반드시 짝으로 맞춘다.
      signal?.removeEventListener('abort', finish)
      resolve()
    }

    const waiter = () => {
      finish()
    }
    const timer = setTimeout(finish, THROTTLE_WAIT_POLL_INTERVAL_MS)
    state.waiters.add(waiter)
    signal?.addEventListener('abort', finish, { once: true })
  })
}

export type NoRunnableNodesDiagnostic = {
  pendingNodeIds: string[]
  completedNodeIds: string[]
  runningNodeIds: string[]
  readyNodeIds: string[]
  blockedDependencies: Array<{
    nodeId: string
    waitingFor: string[]
  }>
}

export class GraphExecutionNoRunnableNodesError extends Error {
  constructor(public readonly diagnostic: NoRunnableNodesDiagnostic) {
    super('Graph execution could not make progress because no runnable nodes were available')
    this.name = 'GraphExecutionNoRunnableNodesError'
  }
}

export type RunReadyGraphNodesParams = {
  orderedNodeIds: string[]
  dependenciesByNode: Map<string, Set<string>>
  signal: AbortSignal
  abort: (reason: GraphAbortReason) => void
  shouldCancel?: () => boolean
  getNodeThrottleLane?: (nodeId: string) => GraphNodeThrottleLane | null
  executeNode: (nodeId: string) => Promise<void>
  onNodeSettled?: (nodeId: string, error: unknown | null) => void
  onDrainTimeout?: (pendingNodeIds: string[]) => void
}

/**
 * 준비된 노드를 병렬로 굴리되, 첫 실패/취소가 생기면 형제 노드를 abort 하고 전원 정착까지 드레인한다.
 * `runningNodes` 에 담기는 프라미스는 절대 reject 하지 않는다 → `Promise.race` 가 조기 reject 하지 않고,
 * 고아 노드가 terminal 이후에 늦게 쓰기를 시도하는 창이 구조적으로 사라진다.
 */
export async function runReadyGraphNodes(params: RunReadyGraphNodesParams) {
  const pendingNodeIds = new Set(params.orderedNodeIds)
  const completedNodeIds = new Set<string>()
  const runningNodes = new Map<string, Promise<void>>()
  let firstError: unknown = null

  const drain = async () => {
    const inFlight = Array.from(runningNodes.values())
    if (inFlight.length === 0) {
      return
    }

    // 드레인은 무한 대기 위험이 있다(태거처럼 signal 을 관측하지 않는 경로). 상한을 넘기면 로그만 남기고 진행하고,
    // 초과한 노드는 late-write 가드가 계속 막는다.
    const drainTimerController = new AbortController()
    const drained = await Promise.race([
      Promise.allSettled(inFlight).then(() => true as const),
      abortableDelay(getGraphAbortDrainTimeoutMs(), drainTimerController.signal).then(() => false as const),
    ])
    drainTimerController.abort()

    if (!drained) {
      params.onDrainTimeout?.(Array.from(runningNodes.keys()))
    }
  }

  while (pendingNodeIds.size > 0 || runningNodes.size > 0) {
    if (firstError === null && (params.signal.aborted || params.shouldCancel?.() === true)) {
      params.abort({ kind: 'user_cancel', message: null })
      firstError = new Error(GRAPH_EXECUTION_CANCELLED_MESSAGE)
    }

    if (firstError !== null) {
      // 실패/취소가 확정되면 새 노드를 더 시작하지 않는다. 남은 인플라이트는 아래 드레인이 책임진다.
      break
    }

    const readyNodeIds = params.orderedNodeIds.filter((nodeId) => {
      if (!pendingNodeIds.has(nodeId) || runningNodes.has(nodeId)) {
        return false
      }

      const dependencies = params.dependenciesByNode.get(nodeId) ?? new Set<string>()
      for (const dependencyNodeId of dependencies) {
        if (!completedNodeIds.has(dependencyNodeId)) {
          return false
        }
      }

      return true
    })

    let startedNode = false
    let throttleBlockedLane: GraphNodeThrottleLane | null = null
    const maxParallelReadyNodes = getMaxParallelReadyNodes()

    for (const nodeId of readyNodeIds) {
      if (runningNodes.size >= maxParallelReadyNodes) {
        break
      }

      const throttleLane = params.getNodeThrottleLane?.(nodeId) ?? null
      if (throttleLane && !tryAcquireGraphNodeThrottleSlot(throttleLane)) {
        throttleBlockedLane = throttleLane
        continue
      }

      pendingNodeIds.delete(nodeId)
      startedNode = true
      const runPromise = params.executeNode(nodeId)
        .then(
          () => {
            completedNodeIds.add(nodeId)
            params.onNodeSettled?.(nodeId, null)
          },
          (error) => {
            // reject 를 여기서 흡수해야 Promise.race 가 형제를 버려두고 빠져나가지 않는다.
            if (firstError === null) {
              firstError = error
              params.abort(resolveAbortReasonForError(error, nodeId))
            }
            params.onNodeSettled?.(nodeId, error)
          },
        )
        .finally(() => {
          // 스로틀 상태는 모듈 전역이라 abort 경로에서 반납이 빠지면 이후 모든 실행이 굶는다.
          if (throttleLane) {
            releaseGraphNodeThrottleSlot(throttleLane)
          }
          runningNodes.delete(nodeId)
        })
      runningNodes.set(nodeId, runPromise)
    }

    if (runningNodes.size === 0) {
      if (!startedNode && throttleBlockedLane && readyNodeIds.length > 0) {
        await waitForGraphNodeThrottleAvailability(throttleBlockedLane, params.signal)
        continue
      }

      const pendingNodeIdList = Array.from(pendingNodeIds)
      throw new GraphExecutionNoRunnableNodesError({
        pendingNodeIds: pendingNodeIdList,
        completedNodeIds: Array.from(completedNodeIds),
        runningNodeIds: Array.from(runningNodes.keys()),
        readyNodeIds,
        blockedDependencies: pendingNodeIdList.map((nodeId) => {
          const dependencies = params.dependenciesByNode.get(nodeId) ?? new Set<string>()
          return {
            nodeId,
            waitingFor: Array.from(dependencies).filter((dependencyNodeId) => !completedNodeIds.has(dependencyNodeId)),
          }
        }),
      })
    }

    await Promise.race(runningNodes.values())
  }

  await drain()

  if (firstError !== null) {
    throw firstError
  }
}
