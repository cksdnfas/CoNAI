import { doesNotMatch, match, ok, deepEqual, equal } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  RUNTIME_STREAM_DEGRADE_FAILURE_COUNT,
  RUNTIME_STREAM_WATCHDOG_MS,
  isRuntimeEventStreamEnabled,
  resolveStreamFallbackInterval,
  resolveStreamReconnectDelayMs,
} from '../features/runtime-events/runtime-event-fallback'

const frontendTypesSource = readFileSync(resolve(process.cwd(), 'src/lib/runtime-events-types.ts'), 'utf8')
const backendTypesSource = readFileSync(resolve(process.cwd(), '../backend/src/types/runtimeEvents.ts'), 'utf8')
const streamSource = readFileSync(resolve(process.cwd(), 'src/lib/runtime-event-stream.ts'), 'utf8')
const providerSource = readFileSync(resolve(process.cwd(), 'src/app/providers.tsx'), 'utf8')
const bridgeSource = readFileSync(resolve(process.cwd(), 'src/features/runtime-events/use-runtime-event-query-bridge.ts'), 'utf8')
const queueHeaderWidgetSource = readFileSync(
  resolve(process.cwd(), 'src/features/image-generation/components/generation-queue-header-widget.tsx'),
  'utf8',
)
const historyPanelSource = readFileSync(
  resolve(process.cwd(), 'src/features/image-generation/components/generation-history-panel.tsx'),
  'utf8',
)
const historyPanelHelpersSource = readFileSync(
  resolve(process.cwd(), 'src/features/image-generation/components/generation-history-panel-helpers.ts'),
  'utf8',
)
const reservationsPanelSource = readFileSync(
  resolve(process.cwd(), 'src/features/image-generation/components/workflow-reservations-panel.tsx'),
  'utf8',
)

/** Extract one string-literal union declared as `export type <name> = 'a' | 'b'`. */
function readUnionLiterals(source: string, typeName: string): string[] {
  const declaration = new RegExp(`export type ${typeName} =([\\s\\S]*?)\\r?\\n\\r?\\n`).exec(source)
  if (!declaration) {
    throw new Error(`expected ${typeName} to be declared as a string literal union`)
  }

  return [...declaration[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]).sort()
}

function assertTypeMirrorHasNoDrift() {
  for (const typeName of ['RuntimeEventTopic', 'RuntimeEventName']) {
    deepEqual(
      readUnionLiterals(frontendTypesSource, typeName),
      readUnionLiterals(backendTypesSource, typeName),
      `${typeName} must stay identical between backend and frontend runtime event types`,
    )
  }

  match(
    frontendTypesSource,
    /export interface QueueJobEventPayload \{[\s\S]*?cancel_requested_at: string \| null[\s\S]*?cancel_origin: string \| null[\s\S]*?provider_submit_state: string \| null[\s\S]*?provider_submit_started_at: string \| null[\s\S]*?provider_cancel_state: string \| null[\s\S]*?submit_attempt_count: number \| null/,
    'queue job events must carry the cancellation protocol columns promoted by the queue cancel redesign',
  )
}

function assertSingleConnectionPolicy() {
  match(
    streamSource,
    /new EventSource\(/,
    'the runtime event stream module must own the only EventSource instance',
  )

  for (const [label, source] of [
    ['providers.tsx', providerSource],
    ['use-runtime-event-query-bridge.ts', bridgeSource],
    ['generation-queue-header-widget.tsx', queueHeaderWidgetSource],
    ['generation-history-panel.tsx', historyPanelSource],
    ['workflow-reservations-panel.tsx', reservationsPanelSource],
  ] as const) {
    doesNotMatch(
      source,
      /new EventSource\(/,
      `${label} must not open its own stream: HTTP/1.1 allows only 6 connections per origin, so the tab keeps exactly one`,
    )
  }

  match(
    streamSource,
    /const handlerSets = new Set<RuntimeEventStreamHandlers>\(\)/,
    'the stream must be reference counted so React StrictMode double mounts do not open two connections',
  )
  match(
    streamSource,
    /visibilitychange/,
    'a hidden tab must be able to release its connection slot',
  )
}

function assertProviderPlacement() {
  match(
    providerSource,
    /<QueryClientProvider client=\{queryClient\}>[\s\S]*?<RuntimeEventStreamProvider>/,
    'RuntimeEventStreamProvider must mount inside QueryClientProvider because the bridge uses useQueryClient',
  )

  const streamProviderSource = readFileSync(
    resolve(process.cwd(), 'src/features/runtime-events/runtime-event-stream-provider.tsx'),
    'utf8',
  )
  match(
    streamProviderSource,
    /const hasStreamPermission = \(authStatusQuery\.data\?\.permissionKeys \?\? \[\]\)\.includes\(RUNTIME_EVENT_STREAM_PERMISSION_KEY\)[\s\S]*?if \(!hasStreamPermission\) \{[\s\S]*?setStatus\('unsupported'\)/,
    'the provider must not open a stream for accounts the server would reject, or anonymous pages reconnect forever',
  )

  const backendPermissionKey = /RUNTIME_EVENT_TOPIC_PERMISSION_KEY = '([^']+)'/.exec(backendTypesSource)?.[1]
  const frontendPermissionKey = /RUNTIME_EVENT_STREAM_PERMISSION_KEY = '([^']+)'/.exec(frontendTypesSource)?.[1]
  ok(backendPermissionKey, 'backend runtime events must declare the required permission key')
  equal(
    frontendPermissionKey,
    backendPermissionKey,
    'the client-side stream gate must use the same permission key as the server guard',
  )
}

/** Read one numeric millisecond constant declared in the bridge. */
function readBridgeConstantMs(constantName: string) {
  const declaration = new RegExp(`const ${constantName} = ([0-9_]+)\\b`).exec(bridgeSource)
  if (!declaration) {
    throw new Error(`the runtime event bridge must declare ${constantName} as a numeric millisecond budget`)
  }

  return Number(declaration[1].replace(/_/g, ''))
}

function assertCacheBridgePolicy() {
  match(
    bridgeSource,
    /case 'queue\.job\.status':[\s\S]*?applyQueueEventToCaches\(queryClient, queuePayload\)[\s\S]*?scheduleInvalidate\(\[QUEUE_QUERY_KEY_PREFIX\], QUEUE_INVALIDATE_DEBOUNCE_MS\)/,
    'queue status events must patch the cache immediately and then debounce one invalidation for server-derived fields',
  )
  match(
    bridgeSource,
    /queryClient\.setQueryData<QueueListResponse>/,
    'the bridge must patch cached queue rows instead of waiting for a refetch',
  )

  // QLIST-3: 큐 진행 전이(dispatching/running)는 히스토리 표면을 건드리지 않는다.
  // 히스토리는 `history.record.*` 가 정본이고, 히스토리 행을 쓰지 않는 `queued -> cancelled`
  // 확정 경로만 예외로 남긴다.
  match(
    bridgeSource,
    /function affectsHistorySurface\(payload: QueueJobEventPayload\) \{[\s\S]*?TERMINAL_QUEUE_EVENT_STATUSES\.has\(payload\.status\) \|\| payload\.cancel_requested === true/,
    'queue-driven history invalidation must be limited to terminal transitions and cancel requests',
  )
  match(
    bridgeSource,
    /if \(affectsHistorySurface\(queuePayload\)\) \{[\s\S]*?scheduleInvalidate\(\[HISTORY_QUERY_KEY_PREFIX\], HISTORY_INVALIDATE_DEBOUNCE_MS\)/,
    'the bridge must gate history invalidation behind the queue-event history relevance check',
  )

  const queueDebounceMs = readBridgeConstantMs('QUEUE_INVALIDATE_DEBOUNCE_MS')
  const historyDebounceMs = readBridgeConstantMs('HISTORY_INVALIDATE_DEBOUNCE_MS')
  const maxWaitMs = readBridgeConstantMs('INVALIDATE_MAX_WAIT_MS')

  ok(
    queueDebounceMs >= 2_000,
    `queue invalidation must stay debounced at 2s or slower so N clients do not multiply refetches, got ${queueDebounceMs}ms`,
  )
  ok(
    historyDebounceMs >= 2_000,
    `history invalidation must stay debounced at 2s or slower, got ${historyDebounceMs}ms`,
  )
  ok(
    maxWaitMs >= queueDebounceMs && maxWaitMs >= historyDebounceMs && maxWaitMs <= 3_000,
    `the invalidation max-wait ceiling must bound every debounce within the 3s UI freshness budget, got ${maxWaitMs}ms`,
  )
  match(
    bridgeSource,
    /const remainingMaxWaitMs = Math\.max\(0, firstRequestedAt \+ INVALIDATE_MAX_WAIT_MS - now\)[\s\S]*?Math\.min\(delayMs, remainingMaxWaitMs\)/,
    'a trailing debounce must never starve under a continuous event stream: cap it with the max-wait ceiling',
  )
  match(
    bridgeSource,
    /invalidateQueries\(\{ queryKey: \[prefix\], refetchType: 'active' \}\)/,
    'the bridge must only refetch active queries so background surfaces stay idle',
  )
  match(
    bridgeSource,
    /const resyncAll = useCallback\(\(\) => \{[\s\S]*?QUEUE_QUERY_KEY_PREFIX,[\s\S]*?HISTORY_QUERY_KEY_PREFIX,[\s\S]*?GRAPH_SCHEDULE_QUERY_KEY_PREFIX,[\s\S]*?GRAPH_BROWSE_CONTENT_QUERY_KEY_PREFIX,/,
    'reconnects must resync every surface the stream owns so the gap window is corrected',
  )
}

function assertFallbackWrapping() {
  const wrappedSurfaces: Array<[string, string, number]> = [
    ['generation-queue-header-widget.tsx', queueHeaderWidgetSource, 3],
    ['generation-history-panel.tsx', historyPanelSource, 1],
    ['workflow-reservations-panel.tsx', reservationsPanelSource, 1],
  ]

  for (const [label, source, expectedWrapCount] of wrappedSurfaces) {
    const refetchIntervalCount = (source.match(/refetchInterval: \(/g) ?? []).length
    const wrapCount = (source.match(/resolveStreamFallbackInterval\(runtimeStreamStatus,/g) ?? []).length

    equal(
      refetchIntervalCount,
      expectedWrapCount,
      `${label} should keep exactly ${expectedWrapCount} polling site(s) under stream control`,
    )
    equal(
      wrapCount,
      expectedWrapCount,
      `${label} must wrap every refetchInterval with resolveStreamFallbackInterval so polling returns when the stream dies`,
    )
    match(
      source,
      /const \{ status: runtimeStreamStatus \} = useRuntimeEventStream\(\)/,
      `${label} must read the shared stream status instead of opening its own connection`,
    )
  }
}

function assertLegacyIntervalsSurvive() {
  // 폴백은 기존 상수/분기 함수가 살아 있을 때만 성립한다. 하나라도 지우면 킬 스위치가 무의미해진다.
  match(
    queueHeaderWidgetSource,
    /const ACTIVE_QUEUE_REFETCH_INTERVAL_MS = 3_000/,
    'the header widget must keep its active polling cadence for the fallback path',
  )
  match(
    queueHeaderWidgetSource,
    /const IDLE_QUEUE_REFETCH_INTERVAL_MS = 30_000/,
    'the header widget must keep its idle polling cadence for the fallback path',
  )
  match(
    queueHeaderWidgetSource,
    /function getGenerationQueueHeaderRefetchInterval\(activeCount: number, isOpen: boolean\) \{[\s\S]*?document\.visibilityState === 'hidden'[\s\S]*?ACTIVE_QUEUE_REFETCH_INTERVAL_MS : IDLE_QUEUE_REFETCH_INTERVAL_MS/,
    'the legacy header polling decision must stay intact behind the stream wrapper',
  )
  match(
    historyPanelHelpersSource,
    /const GENERATION_HISTORY_ACTIVE_REFRESH_MS = 3_000[\s\S]*?const GENERATION_HISTORY_POSTPROCESS_REFRESH_MS = 5_000/,
    'history fallback cadences must survive the stream conversion',
  )
  match(
    historyPanelSource,
    /const resolveLegacyHistoryInterval = \(\): number \| false => \{[\s\S]*?hasActiveGenerationHistory\(records\)[\s\S]*?hasPostprocessPendingHistory\(records\)/,
    'the history panel must keep its legacy interval decision reachable as a fallback',
  )
  match(
    reservationsPanelSource,
    /const legacyInterval = executions\.some\(\(execution\) => isActiveReservationExecution\(execution\.status\)\) \? 2_000 : false/,
    'the reservations panel must keep its 2s active polling decision as a fallback',
  )
}

function assertFallbackPolicyBehaviour() {
  equal(resolveStreamFallbackInterval('live', 3_000), false, 'a live stream must switch polling off')
  equal(resolveStreamFallbackInterval('connecting', 3_000), 3_000, 'polling must continue while connecting')
  equal(resolveStreamFallbackInterval('degraded', 3_000), 3_000, 'a degraded stream must fall back to the legacy interval')
  equal(resolveStreamFallbackInterval('unsupported', 3_000), 3_000, 'browsers without EventSource must keep polling')
  equal(resolveStreamFallbackInterval('degraded', false), false, 'a disabled legacy interval must stay disabled')

  equal(resolveStreamReconnectDelayMs(1), 1_000)
  equal(resolveStreamReconnectDelayMs(2), 2_000)
  equal(resolveStreamReconnectDelayMs(3), 4_000)
  equal(resolveStreamReconnectDelayMs(10), 30_000, 'reconnect backoff must cap so a dead server is not hammered')

  ok(RUNTIME_STREAM_WATCHDOG_MS > 20_000 * 2, 'the client watchdog must tolerate at least two missed 20s heartbeats')
  equal(RUNTIME_STREAM_DEGRADE_FAILURE_COUNT, 3)

  equal(isRuntimeEventStreamEnabled(undefined), true)
  equal(isRuntimeEventStreamEnabled('off'), false, 'VITE_CONAI_RUNTIME_EVENTS=off must be a hard kill switch')
  equal(isRuntimeEventStreamEnabled(' OFF '), false)
  equal(isRuntimeEventStreamEnabled('on'), true)
}

assertTypeMirrorHasNoDrift()
assertSingleConnectionPolicy()
assertProviderPlacement()
assertCacheBridgePolicy()
assertFallbackWrapping()
assertLegacyIntervalsSurvive()
assertFallbackPolicyBehaviour()

console.log('Runtime event stream UI contracts verified.')
