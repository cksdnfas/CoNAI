// 실행 단위 협조적 취소(abort)의 유일한 소유 모듈이다.
// shared.ts 는 GraphExecutionLog 모델을 import 하므로 DB 초기화 부수효과가 있다. 이 파일은 계약 스크립트가
// DB 없이 스케줄러/취소 규약을 그대로 실행할 수 있어야 해서 validate.ts 와 같은 leaf 제약을 지킨다.
// → models/ 나 database/ 를 절대 import 하지 않는다.

/** 그래프 실행 취소 신호의 공용 문구. 실행기는 이 메시지를 cancelled 종료로 해석한다. */
export const GRAPH_EXECUTION_CANCELLED_MESSAGE = '__GRAPH_EXECUTION_CANCELLED__'

const DEFAULT_ABORT_DRAIN_TIMEOUT_MS = 30_000

export type GraphAbortReasonKind =
  | 'user_cancel' // 사용자/스케줄 취소 요청
  | 'node_failure' // 형제 노드 실패로 인한 협조적 중단
  | 'workflow_stop' // system.workflow_stop (GraphWorkflowStoppedError)
  | 'shutdown' // 프로세스 종료 드레인

export type GraphAbortReason = {
  kind: GraphAbortReasonKind
  nodeId?: string | null
  message?: string | null
}

/** 실행이 abort 된 뒤 노드 엔진이 조기 종료할 때 쓰는 에러. */
export class GraphAbortError extends Error {
  constructor(public readonly reason: GraphAbortReason) {
    super(reason.message || GRAPH_EXECUTION_CANCELLED_MESSAGE)
    this.name = 'GraphAbortError'
  }
}

export type ExecutionAbortHandle = {
  executionId: number
  signal: AbortSignal
  /** 노드 엔진은 호출하지 않는다. 스케줄러/레지스트리 전용. */
  abort: (reason: GraphAbortReason) => void
  getReason: () => GraphAbortReason | null
}

/** abort 인지가 필요한 최소 컨텍스트 형태. `ExecutionContext` 가 구조적으로 만족한다. */
export type AbortAwareExecutionContext = {
  executionId: number
  signal: AbortSignal
  getAbortReason: () => GraphAbortReason | null
}

/** 실행 컨텍스트는 `GraphWorkflowExecutor.execute()` 의 지역 변수라서 외부에서 도달할 방법이 없다. 그래서 레지스트리를 둔다. */
const abortHandlesByExecutionId = new Map<number, ExecutionAbortHandle>()

/** 실행 단위 abort 핸들을 만든다. 첫 사유만 채택하는 1회성 abort 이다. */
export function createExecutionAbortHandle(executionId: number): ExecutionAbortHandle {
  const controller = new AbortController()
  let reason: GraphAbortReason | null = null

  return {
    executionId,
    signal: controller.signal,
    abort: (nextReason: GraphAbortReason) => {
      if (reason !== null) {
        return
      }

      reason = nextReason
      controller.abort(new GraphAbortError(nextReason))
    },
    getReason: () => reason,
  }
}

/** 실행 시작 시 핸들을 등록한다. 해제 책임은 실행기의 finally 한 곳에 모은다. */
export function registerExecutionAbortHandle(handle: ExecutionAbortHandle) {
  abortHandlesByExecutionId.set(handle.executionId, handle)
}

/** 실행 종료 시 핸들을 해제한다. 등록 id 가 누수되지 않게 finally 에서만 호출한다. */
export function unregisterExecutionAbortHandle(executionId: number) {
  abortHandlesByExecutionId.delete(executionId)
}

/** 외부(큐/라우트)에서 실행 중인 그래프에 abort 를 요청한다. 인프로세스 실행에만 도달한다. */
export function requestGraphExecutionAbort(executionId: number, reason: GraphAbortReason) {
  const handle = abortHandlesByExecutionId.get(executionId)
  if (!handle) {
    return false
  }

  handle.abort(reason)
  return true
}

/** 실행 id 만 아는 쓰기 지점(아티팩트/승격)이 abort 여부를 판정할 때 쓴다. */
export function isGraphExecutionAborted(executionId: number) {
  return abortHandlesByExecutionId.get(executionId)?.signal.aborted === true
}

/** 관측용 abort 사유 조회. abort 전에는 null. */
export function getGraphExecutionAbortReason(executionId: number): GraphAbortReason | null {
  return abortHandlesByExecutionId.get(executionId)?.getReason() ?? null
}

function buildAbortError(reason: GraphAbortReason | null, executionId: number, nodeId?: string | null) {
  const resolvedReason: GraphAbortReason = reason ?? { kind: 'user_cancel', nodeId: nodeId ?? null, message: null }
  return new GraphAbortError({
    ...resolvedReason,
    nodeId: nodeId ?? resolvedReason.nodeId ?? null,
    message: resolvedReason.message ?? `Graph execution ${executionId} was aborted`,
  })
}

/** abort 이후 진입한 노드 작업을 조기 종료시킨다. */
export function throwIfExecutionAborted(context: AbortAwareExecutionContext, nodeId?: string | null): void {
  if (!context.signal.aborted) {
    return
  }

  throw buildAbortError(context.getAbortReason(), context.executionId, nodeId)
}

/** 컨텍스트를 받지 않는 쓰기 진입점(아티팩트 저장 등)을 위한 레지스트리 기반 가드. */
export function throwIfGraphExecutionAborted(executionId: number, nodeId?: string | null): void {
  if (!isGraphExecutionAborted(executionId)) {
    return
  }

  throw buildAbortError(getGraphExecutionAbortReason(executionId), executionId, nodeId)
}

/** 취소/중단 계열 에러인지 판정한다. terminal 상태를 failed 가 아니라 cancelled 로 확정할 때 쓴다. */
export function isGraphCancellationError(error: unknown) {
  if (error instanceof GraphAbortError) {
    return error.reason.kind !== 'node_failure'
  }

  return error instanceof Error && error.message === GRAPH_EXECUTION_CANCELLED_MESSAGE
}

/** 첫 실패 에러를 형제 abort 사유로 옮긴다. 상태 확정 분기와 같은 판정을 쓰도록 한 곳에 모은다. */
export function resolveAbortReasonForError(error: unknown, nodeId: string): GraphAbortReason {
  if (error instanceof GraphAbortError) {
    return { ...error.reason, nodeId: error.reason.nodeId ?? nodeId }
  }

  // GraphWorkflowStoppedError 는 shared.ts 소유라 leaf 제약 때문에 이름으로 판정한다.
  if (error instanceof Error && error.name === 'GraphWorkflowStoppedError') {
    return { kind: 'workflow_stop', nodeId, message: error.message }
  }

  if (error instanceof Error && error.message === GRAPH_EXECUTION_CANCELLED_MESSAGE) {
    return { kind: 'user_cancel', nodeId, message: null }
  }

  return {
    kind: 'node_failure',
    nodeId,
    message: error instanceof Error ? error.message : String(error),
  }
}

/** 취소 가능한 sleep. abort 시 타이머를 정리하고 즉시 resolve 한다. */
export function abortableDelay(ms: number, signal?: AbortSignal) {
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
      // 장수명 실행 signal 에 리스너가 쌓이지 않도록 once 등록과 해제를 반드시 짝으로 맞춘다.
      signal?.removeEventListener('abort', finish)
      resolve()
    }

    const timer = setTimeout(finish, ms)
    signal?.addEventListener('abort', finish, { once: true })
  })
}

/** 형제 노드 드레인 상한. 관측 불가 경로가 섞여도 실행 응답이 영원히 막히지 않게 한다. */
export function getGraphAbortDrainTimeoutMs() {
  const configured = Number(process.env.CONAI_GRAPH_ABORT_DRAIN_TIMEOUT_MS)
  if (Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured)
  }

  return DEFAULT_ABORT_DRAIN_TIMEOUT_MS
}

/** 취소 훅만 받는 외부 서비스(ComfyUI 폴링 등)에 넘길 shouldCancel/onCancelRequested 쌍을 만든다. */
export function createGraphCancelHooks(
  context: AbortAwareExecutionContext,
  onCancelRequested?: () => void | Promise<void>,
) {
  let notified = false

  return {
    shouldCancel: () => context.signal.aborted,
    onCancelRequested: async () => {
      if (notified) {
        return
      }

      notified = true
      await onCancelRequested?.()
    },
  }
}
