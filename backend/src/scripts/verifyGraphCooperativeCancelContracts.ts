import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  abortableDelay,
  createExecutionAbortHandle,
  createGraphCancelHooks,
  isGraphCancellationError,
  registerExecutionAbortHandle,
  requestGraphExecutionAbort,
  resolveAbortReasonForError,
  throwIfGraphExecutionAborted,
  unregisterExecutionAbortHandle,
  GraphAbortError,
  GRAPH_EXECUTION_CANCELLED_MESSAGE,
} from '../services/graph-workflow-executor/execution-abort'
import {
  getGraphNodeThrottleActiveCount,
  runReadyGraphNodes,
  type GraphNodeThrottleLane,
} from '../services/graph-workflow-executor/node-scheduler'
import { resolveLlmRequestFailure } from '../services/llmProviderService'

// node-scheduler / execution-abort 은 leaf 라서 DB 없이 실제 스케줄링을 그대로 돌릴 수 있다.
// 계약이 소스 regex 뿐이면 "형제 abort 후 in-flight 0" 같은 시점 규약을 고정할 수 없기 때문에 런타임 단언을 우선한다.

const unhandledRejections: unknown[] = []
process.on('unhandledRejection', (reason) => {
  unhandledRejections.push(reason)
})

function source(relativePath: string) {
  return readFileSync(resolve(process.cwd(), 'src', relativePath), 'utf8')
}

function buildDependencies(nodeIds: string[], edges: Array<[string, string]> = []) {
  const dependenciesByNode = new Map<string, Set<string>>()
  for (const nodeId of nodeIds) {
    dependenciesByNode.set(nodeId, new Set<string>())
  }
  for (const [sourceNodeId, targetNodeId] of edges) {
    dependenciesByNode.get(targetNodeId)?.add(sourceNodeId)
  }
  return dependenciesByNode
}

function waitForAbort(signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    signal.addEventListener('abort', () => resolve(), { once: true })
  })
}

/** 1 + 2 + 3 + 4: 형제 abort / allSettled 드레인 / 첫 실패 보존 / unhandled rejection 0건 */
async function assertSiblingAbortAndDrainContract() {
  const handle = createExecutionAbortHandle(9001)
  const observedAbort = new Map<string, boolean>()
  let inFlight = 0

  const failFirst = new Error('node A exploded first')
  const failSecond = new Error('node B exploded later')

  const scheduled = runReadyGraphNodes({
    orderedNodeIds: ['A', 'B', 'C'],
    dependenciesByNode: buildDependencies(['A', 'B', 'C']),
    signal: handle.signal,
    abort: handle.abort,
    executeNode: async (nodeId) => {
      inFlight += 1
      try {
        if (nodeId === 'A') {
          throw failFirst
        }

        await waitForAbort(handle.signal)
        observedAbort.set(nodeId, handle.signal.aborted)
        throw nodeId === 'B' ? failSecond : new GraphAbortError({ kind: 'node_failure', nodeId })
      } finally {
        inFlight -= 1
      }
    },
  })

  const thrown = await scheduled.then(() => null, (error) => error)

  assert.equal(observedAbort.get('B'), true, '형제 노드 B 는 abort signal 을 관측해야 한다')
  assert.equal(observedAbort.get('C'), true, '형제 노드 C 는 abort signal 을 관측해야 한다')
  assert.equal(inFlight, 0, 'runReadyGraphNodes 가 reject 하는 시점에 in-flight 노드는 0개여야 한다')
  assert.equal(thrown, failFirst, '먼저 실패한 노드의 에러가 그대로 throw 되어야 한다')
  assert.equal(handle.getReason()?.kind, 'node_failure', '노드 실패는 node_failure 사유로 형제를 abort 해야 한다')
  assert.equal(handle.getReason()?.nodeId, 'A', 'abort 사유는 첫 실패 노드를 가리켜야 한다')
}

/** 5: 외부 생성 레인 슬롯이 abort 경로에서도 반드시 반납된다 (전역 상태라 누락 시 이후 모든 실행이 굶는다) */
async function assertThrottleSlotRecoveryContract() {
  const lane: GraphNodeThrottleLane = 'external_generation'
  assert.equal(getGraphNodeThrottleActiveCount(lane), 0, '시나리오 시작 전 레인은 비어 있어야 한다')

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const handle = createExecutionAbortHandle(9100 + attempt)
    const failure = new Error(`throttled node failed on attempt ${attempt}`)

    const thrown = await runReadyGraphNodes({
      orderedNodeIds: ['gen-a', 'gen-b'],
      dependenciesByNode: buildDependencies(['gen-a', 'gen-b']),
      signal: handle.signal,
      abort: handle.abort,
      getNodeThrottleLane: () => lane,
      executeNode: async (nodeId) => {
        if (nodeId === 'gen-a') {
          throw failure
        }
        await waitForAbort(handle.signal)
        throw new GraphAbortError({ kind: 'node_failure', nodeId })
      },
    }).then(() => null, (error) => error)

    assert.equal(thrown, failure, `attempt ${attempt}: 첫 실패가 보존되어야 한다`)
    assert.equal(getGraphNodeThrottleActiveCount(lane), 0, `attempt ${attempt}: abort 후 레인 activeCount 는 0 으로 복귀해야 한다`)
  }
}

/** 6: 레지스트리 취소 요청이 스케줄러를 취소 문구로 끝내고 새 노드를 시작하지 않는다 */
async function assertUserCancelContract() {
  const executionId = 9200
  const handle = createExecutionAbortHandle(executionId)
  registerExecutionAbortHandle(handle)

  const startedNodeIds: string[] = []
  let releaseFirstNode: (() => void) | null = null
  const firstNodeStarted = new Promise<void>((resolveStarted) => {
    releaseFirstNode = resolveStarted
  })

  try {
    const scheduled = runReadyGraphNodes({
      orderedNodeIds: ['first', 'second'],
      dependenciesByNode: buildDependencies(['first', 'second'], [['first', 'second']]),
      signal: handle.signal,
      abort: handle.abort,
      executeNode: async (nodeId) => {
        startedNodeIds.push(nodeId)
        releaseFirstNode?.()
        await waitForAbort(handle.signal)
        throw new GraphAbortError({ kind: 'user_cancel', nodeId })
      },
    })

    await firstNodeStarted
    assert.equal(requestGraphExecutionAbort(executionId, { kind: 'user_cancel' }), true, '레지스트리로 실행 중 abort 를 요청할 수 있어야 한다')

    const thrown = await scheduled.then(() => null, (error) => error)
    assert.equal(isGraphCancellationError(thrown), true, '사용자 취소는 취소 계열 에러로 끝나야 한다')
    assert.deepEqual(startedNodeIds, ['first'], '취소 이후에는 새 노드를 시작하지 않아야 한다')
    assert.equal(handle.getReason()?.kind, 'user_cancel', 'abort 사유는 첫 사유(user_cancel)로 고정되어야 한다')

    assert.equal(
      isGraphCancellationError(new Error(GRAPH_EXECUTION_CANCELLED_MESSAGE)),
      true,
      '취소 문구 에러는 cancelled 종료로 분류되어야 한다',
    )
    assert.equal(
      isGraphCancellationError(new GraphAbortError({ kind: 'node_failure', nodeId: 'x' })),
      false,
      '형제 실패로 죽은 노드의 abort 는 failed 종료 분류를 바꾸면 안 된다',
    )
    assert.equal(resolveAbortReasonForError(new Error('boom'), 'n1').kind, 'node_failure', '일반 실패는 node_failure 로 매핑되어야 한다')

    const stoppedError = new Error('__GRAPH_EXECUTION_STOPPED__')
    stoppedError.name = 'GraphWorkflowStoppedError'
    assert.equal(resolveAbortReasonForError(stoppedError, 'n1').kind, 'workflow_stop', 'workflow_stop 은 별도 사유로 매핑되어야 한다')
  } finally {
    unregisterExecutionAbortHandle(executionId)
  }
}

/** 7: abortableDelay 는 abort 시 즉시 풀리고 타이머를 남기지 않는다 */
async function assertAbortableDelayContract() {
  const controller = new AbortController()
  const timerBaseline = process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout').length

  const startedAt = Date.now()
  const pending = abortableDelay(60_000, controller.signal)
  controller.abort()
  await pending

  assert.ok(Date.now() - startedAt < 5_000, 'abort 된 delay 는 대기 시간을 채우지 않고 즉시 풀려야 한다')
  const timerAfter = process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout').length
  assert.ok(timerAfter <= timerBaseline, 'abort 된 delay 는 타이머를 남기지 않아야 한다')

  const alreadyAborted = new AbortController()
  alreadyAborted.abort()
  await abortableDelay(60_000, alreadyAborted.signal)
}

/** 8: AbortSignal.any 가용성 (하위 Node 배포 사고 방지) */
function assertAbortSignalAnyAvailability() {
  assert.equal(typeof AbortSignal.any, 'function', 'AbortSignal.any 는 런타임에서 사용 가능해야 한다')
  assert.equal(typeof AbortSignal.timeout, 'function', 'AbortSignal.timeout 은 런타임에서 사용 가능해야 한다')

  const external = new AbortController()
  const composed = AbortSignal.any([external.signal, AbortSignal.timeout(60_000)])
  assert.equal(composed.aborted, false, '합성 signal 은 구성 요소가 발화하기 전에는 abort 되지 않아야 한다')
  external.abort()
  assert.equal(composed.aborted, true, '외부 signal 이 끊기면 합성 signal 도 끊겨야 한다')
}

/** 9: 취소와 타임아웃이 동시에 가능한 상황에서 external 이 먼저면 타임아웃으로 오분류하지 않는다 */
function assertLlmFailureClassificationContract() {
  const abortError = new Error('This operation was aborted')
  abortError.name = 'AbortError'

  const cancelled = resolveLlmRequestFailure({
    error: abortError,
    endpoint: 'http://localhost:1234/v1/chat/completions',
    timeoutMs: 600_000,
    externalAborted: true,
    timeoutAborted: true,
  })
  assert.equal(cancelled, abortError, '외부 취소가 먼저면 원 에러가 그대로 전달되어야 한다')

  const timedOut = resolveLlmRequestFailure({
    error: abortError,
    endpoint: 'http://localhost:1234/v1/chat/completions',
    timeoutMs: 600_000,
    externalAborted: false,
    timeoutAborted: true,
  })
  assert.equal(
    timedOut instanceof Error ? timedOut.message : '',
    'LLM provider request timed out after 600000ms: http://localhost:1234/v1/chat/completions',
    '외부 취소가 없으면 GRAPH-1 의 타임아웃 문구가 유지되어야 한다',
  )
}

/**
 * ComfyUI 직행 경로 취소 훅. 서비스의 `maybeCancel` 은 옵션이 없으면 완전한 no-op 이라
 * 훅을 넘기지 않으면 최대 1시간 폴링이 취소 불가였다. 여기서는 `waitForCompletion` 의 maybeCancel 규약을
 * 그대로 재현해서 훅 쌍이 실제로 폴링을 끊는지 확인한다.
 */
async function assertComfyCancelHookContract() {
  const handle = createExecutionAbortHandle(9300)
  let cancelRequestCount = 0
  const hooks = createGraphCancelHooks({
    executionId: 9300,
    signal: handle.signal,
    getAbortReason: handle.getReason,
  }, () => {
    cancelRequestCount += 1
  })

  assert.equal(await hooks.shouldCancel(), false, 'abort 전에는 폴링을 끊지 않아야 한다')

  // comfyuiService.waitForCompletion 의 maybeCancel 과 동일한 순서: shouldCancel → onCancelRequested → throw
  let cancelHandled = false
  const maybeCancel = async (promptId: string) => {
    if (!(await hooks.shouldCancel())) {
      return
    }
    if (!cancelHandled) {
      cancelHandled = true
      await hooks.onCancelRequested()
    }
    throw new Error(`ComfyUI execution cancelled: ${promptId}`)
  }

  let polls = 0
  const fakeWaitForCompletion = async () => {
    for (let attempt = 0; attempt < 1800; attempt += 1) {
      await maybeCancel('prompt-1')
      polls += 1
      await abortableDelay(1, handle.signal)
      await maybeCancel('prompt-1')
    }
    throw new Error('ComfyUI execution timeout')
  }

  const waiting = fakeWaitForCompletion()
  handle.abort({ kind: 'user_cancel' })
  const thrown = await waiting.then(() => null, (error) => error)

  assert.equal(thrown instanceof Error ? thrown.message : '', 'ComfyUI execution cancelled: prompt-1', 'abort 후 폴링은 취소로 끝나야 한다')
  assert.equal(cancelRequestCount, 1, '업스트림 prompt 취소는 정확히 한 번만 요청되어야 한다')
  assert.ok(polls < 1800, 'abort 된 폴링은 1800회 상한까지 돌면 안 된다')

  await hooks.onCancelRequested()
  assert.equal(cancelRequestCount, 1, 'onCancelRequested 는 재호출해도 중복 요청하지 않아야 한다')
}

/** abort 이후 아티팩트/승격 진입점이 실제로 막히는지 (레지스트리 기반 가드) */
async function assertLateWriteGuardContract() {
  const executionId = 9400
  const handle = createExecutionAbortHandle(executionId)
  registerExecutionAbortHandle(handle)

  try {
    assert.doesNotThrow(() => throwIfGraphExecutionAborted(executionId, 'n1'), 'abort 전에는 쓰기를 막지 않아야 한다')
    handle.abort({ kind: 'user_cancel' })
    assert.throws(
      () => throwIfGraphExecutionAborted(executionId, 'n1'),
      (error: unknown) => error instanceof GraphAbortError && error.reason.nodeId === 'n1',
      'abort 이후 쓰기 진입점은 GraphAbortError 로 막혀야 한다',
    )
  } finally {
    unregisterExecutionAbortHandle(executionId)
  }

  assert.doesNotThrow(() => throwIfGraphExecutionAborted(executionId, 'n1'), '해제된 실행 id 는 더 이상 abort 로 판정되지 않아야 한다')
}

/** 10 ~ 17: 소스 정적 단언 */
function assertStaticSourceContracts() {
  const schedulerSource = source('services/graph-workflow-executor/node-scheduler.ts')
  const abortSource = source('services/graph-workflow-executor/execution-abort.ts')
  const executorSource = source('services/graphWorkflowExecutor.ts')
  const executionModelSource = source('models/GraphExecution.ts')
  const providerSource = source('services/llmProviderService.ts')
  const comfySource = source('services/graph-workflow-executor/execute-comfy.ts')
  const artifactsSource = source('services/graph-workflow-executor/artifacts.ts')
  const promotionSource = source('services/graph-workflow-executor/final-result-promotion.ts')

  // 10
  assert.ok(
    schedulerSource.includes('Promise.allSettled('),
    'node scheduler should drain in-flight siblings with Promise.allSettled before rethrowing the first error',
  )
  // 11
  assert.doesNotMatch(
    schedulerSource,
    /from '\.\.?\/\.\.?\/models\//,
    'node scheduler must stay a leaf module so contract scripts can run real scheduling without a database',
  )
  // 12
  assert.doesNotMatch(
    abortSource,
    /from '\.\.?\/\.\.?\/(models|database)\//,
    'execution abort registry must stay a leaf module free of model and database imports',
  )
  // 13
  assert.doesNotMatch(
    executorSource,
    /GraphExecutionModel\.updateStatus\(/,
    'graph executor must not overwrite terminal rows; it should finalize through updateStatusIfActive',
  )
  assert.ok(
    executorSource.includes('let terminalStatusWritten = false')
      && executorSource.includes('GraphExecutionModel.updateStatusIfActive(executionId, status'),
    'graph executor should write the terminal status exactly once through a single finalize helper',
  )
  assert.ok(
    executorSource.includes('unregisterExecutionAbortHandle(executionId)')
      && executorSource.includes('setExecutionDebugMode(executionId, false)'),
    'graph executor should release the abort registry in the same finally as the debug flag',
  )
  assert.ok(
    executorSource.includes('failedNodeIdHint === null && !(error instanceof GraphAbortError)'),
    'siblings killed by an abort must not steal the first-failure node hint',
  )
  // 14
  assert.match(
    executionModelSource,
    /static updateStatusIfActive\([\s\S]*status NOT IN \('completed', 'failed', 'cancelled'\)/,
    'updateStatusIfActive should refuse to overwrite terminal executions in SQL',
  )
  // 15
  assert.ok(
    providerSource.includes('AbortSignal.timeout(') && providerSource.includes('AbortSignal.any('),
    'LLM provider requests should compose the caller signal with the request timeout, not replace it',
  )
  assert.ok(
    providerSource.includes('DEFAULT_LLM_REQUEST_TIMEOUT_MS = 600_000')
      && providerSource.includes('CONAI_LLM_REQUEST_TIMEOUT_MS')
      && providerSource.includes('LLM provider request timed out after ${'),
    'LLM request timeout constants and error wording must stay unchanged',
  )
  // 16
  assert.match(
    comfySource,
    /collectGeneratedOutputs\(promptId, \{[\s\S]*shouldCancel: cancelHooks\.shouldCancel[\s\S]*onCancelRequested: cancelHooks\.onCancelRequested/,
    'direct ComfyUI collection must forward cancel hooks or the service-side maybeCancel stays a no-op',
  )
  // 17
  assert.match(
    artifactsSource,
    /export async function saveArtifactBuffer\([\s\S]*?throwIfGraphExecutionAborted\(executionId, nodeId\)/,
    'saveArtifactBuffer should refuse artifact writes after the execution was aborted',
  )
  assert.match(
    artifactsSource,
    /export async function saveCanonicalMediaArtifactReference\([\s\S]*?throwIfGraphExecutionAborted\(executionId, nodeId\)/,
    'saveCanonicalMediaArtifactReference should refuse artifact writes after the execution was aborted',
  )
  assert.match(
    artifactsSource,
    /export function saveMetadataArtifact\([\s\S]*?isGraphExecutionAborted\(executionId\)/,
    'saveMetadataArtifact should skip debug metadata rows after the execution was aborted',
  )
  assert.match(
    promotionSource,
    /export async function promoteFinalResultArtifactToGenerationHistory\([\s\S]*?throwIfGraphExecutionAborted\(params\.executionId/,
    'aborted executions must not promote final results into generation history',
  )

  // 취소 문구는 leaf 가 원본이고 queue-wait 는 재노출만 한다(기존 계약 스크립트의 import 경로 유지).
  const queueWaitSource = source('services/graph-workflow-executor/queue-wait.ts')
  assert.ok(
    queueWaitSource.includes("export { GRAPH_EXECUTION_CANCELLED_MESSAGE } from './execution-abort'")
      && queueWaitSource.includes('abortableDelay(QUEUE_POLL_INTERVAL_MS, params.context.signal)'),
    'graph queue wait should wake immediately on abort and re-export the shared cancellation sentinel',
  )
}

async function main() {
  await assertSiblingAbortAndDrainContract()
  await assertThrottleSlotRecoveryContract()
  await assertUserCancelContract()
  await assertAbortableDelayContract()
  assertAbortSignalAnyAvailability()
  assertLlmFailureClassificationContract()
  await assertComfyCancelHookContract()
  await assertLateWriteGuardContract()
  assertStaticSourceContracts()

  // 4: 비-reject 래퍼 덕분에 어떤 시나리오에서도 미처리 rejection 이 남으면 안 된다.
  await new Promise((resolveTick) => setImmediate(resolveTick))
  assert.deepEqual(unhandledRejections, [], '협조적 취소 시나리오는 unhandled rejection 을 남기면 안 된다')

  console.log('Graph cooperative cancel contracts verified.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
