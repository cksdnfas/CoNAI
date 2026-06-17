import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TranslationInput, TranslationParams } from '../i18n'
import type { GenerationHistoryRecord, GenerationQueueJobRecord } from '../lib/api-image-generation-types'
import { canRetryHistoryQueueJob, getHistoryRunRecoveryState, getRetryableHistoryQueueJobId } from '../features/image-generation/image-generation-shared'
import {
  getGenerationQueueElapsedLabel,
  getGenerationQueueHeaderQuerySnapshot,
  getGenerationQueueHeaderRefreshTargets,
  getGenerationQueueDurationLabel,
  getGenerationQueueLaneLabel,
  getGenerationQueueProgressPercent,
  getGenerationQueueRemainingLabel,
  getGenerationQueueRequesterLabel,
  getGenerationQueueStatusLabel,
  getGenerationQueueWaitLabel,
  getGenerationQueueWorkflowLabel,
  shouldEnableFilteredQueueHeaderQuery,
} from '../features/image-generation/components/generation-queue-ui'

const translationTemplates: Record<string, string> = {
  'image-generation.components.generation.queue.ui.values': '{seconds}s',
  'image-generation.components.generation.queue.ui.valuemin': '{minutes}m',
  'image-generation.components.generation.queue.ui.valuetime.valuemin': '{hours}h {minutes}m',
  'image-generation.components.generation.queue.ui.valuetime': '{hours}h',
  'image-generation.components.generation.queue.ui.codex.job.value': 'Codex job #{id}',
  'image-generation.components.generation.queue.ui.comfyui.job.value': 'ComfyUI job #{id}',
  'image-generation.components.generation.queue.ui.account.value': 'Account #{id}',
}

function translate(input: TranslationInput, params?: TranslationParams) {
  const template = typeof input === 'string'
    ? translationTemplates[input] ?? input
    : input.ko ?? input.en ?? ''

  return template.replace(/\{([^}]+)\}/g, (match, key: string) => {
    const value = params?.[key]
    return value === undefined || value === null ? match : String(value)
  })
}

function formatNumber(value: number) {
  return String(value)
}

function makeQueueRecord(overrides: Partial<GenerationQueueJobRecord> = {}): GenerationQueueJobRecord {
  return {
    id: 101,
    service_type: 'comfyui',
    status: 'queued',
    priority: 0,
    cancel_requested: 0,
    queued_at: '2026-05-14T00:00:00.000Z',
    created_date: '2026-05-14T00:00:00.000Z',
    updated_date: '2026-05-14T00:00:00.000Z',
    ...overrides,
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

function assertStatusLabels() {
  const expectedStatusKeys: Array<[GenerationQueueJobRecord['status'], string]> = [
    ['queued', 'image-generation.components.generation.queue.ui.queued'],
    ['dispatching', 'image-generation.components.generation.queue.ui.submitting'],
    ['running', 'image-generation.components.generation.queue.ui.running'],
    ['completed', 'image-generation.components.generation.queue.ui.completed'],
    ['failed', 'image-generation.components.generation.queue.ui.failed'],
    ['cancelled', 'image-generation.components.generation.queue.ui.canceled'],
  ]

  for (const [status, expectedKey] of expectedStatusKeys) {
    assertEqual(
      getGenerationQueueStatusLabel(makeQueueRecord({ status }), translate),
      expectedKey,
      `${status} queue status label should resolve through the shared translation key`,
    )
  }

  assertEqual(
    getGenerationQueueStatusLabel(makeQueueRecord({ status: 'completed', cancel_requested: 1 }), translate),
    'image-generation.components.generation.queue.ui.completed.after.cancel.request',
    'completed jobs with a cancel request should use the cancel-request terminal label',
  )
  assertEqual(
    getGenerationQueueStatusLabel(makeQueueRecord({ status: 'failed', cancel_requested: 1 }), translate),
    'image-generation.components.generation.queue.ui.failed.after.cancel.request',
    'failed jobs with a cancel request should use the cancel-request terminal label',
  )
  assertEqual(
    getGenerationQueueStatusLabel(makeQueueRecord({ status: 'queued', cancel_requested: 1 }), translate),
    'image-generation.components.generation.queue.ui.queued',
    'cancel-request override should not replace non-terminal queued labels',
  )
  assertEqual(
    getGenerationQueueStatusLabel(makeQueueRecord({ status: 'future-status' as GenerationQueueJobRecord['status'] }), translate),
    'future-status',
    'unknown future statuses should be shown without throwing',
  )
}

function assertWorkflowLabels() {
  assertEqual(
    getGenerationQueueWorkflowLabel(makeQueueRecord({ workflow_name: '  Portrait XL  ', service_type: 'comfyui' }), translate),
    'Portrait XL',
    'workflow labels should prefer trimmed workflow names',
  )
  assertEqual(
    getGenerationQueueWorkflowLabel(makeQueueRecord({ service_type: 'novelai' }), translate),
    'image-generation.components.generation.queue.ui.nai.generation.job',
    'NovelAI fallback workflow labels should use the NAI generation key',
  )
  assertEqual(
    getGenerationQueueWorkflowLabel(makeQueueRecord({ id: 42, service_type: 'codex' }), translate),
    'Codex job #42',
    'Codex fallback workflow labels should include the queue job id',
  )
  assertEqual(
    getGenerationQueueWorkflowLabel(makeQueueRecord({ id: 43, service_type: 'comfyui' }), translate),
    'ComfyUI job #43',
    'ComfyUI fallback workflow labels should include the queue job id',
  )
}

function assertRequesterLabels() {
  assertEqual(
    getGenerationQueueRequesterLabel(makeQueueRecord({ requested_by_username: '  Alice  ', requested_by_account_type: 'admin' }), translate),
    'Alice',
    'requester labels should prefer trimmed usernames',
  )
  assertEqual(
    getGenerationQueueRequesterLabel(makeQueueRecord({ requested_by_account_type: 'admin' }), translate),
    'image-generation.components.generation.queue.ui.admin',
    'admin requester fallback should use the admin translation key',
  )
  assertEqual(
    getGenerationQueueRequesterLabel(makeQueueRecord({ requested_by_account_id: 77 }), translate),
    'Account #77',
    'account requester fallback should include the account id',
  )
  assertEqual(
    getGenerationQueueRequesterLabel(makeQueueRecord(), translate),
    'image-generation.components.generation.queue.ui.unknown',
    'missing requester metadata should use the unknown translation key',
  )
}

function assertRemainingLabels() {
  assertEqual(getGenerationQueueRemainingLabel(makeQueueRecord(), translate, formatNumber), null, 'missing ETA should stay hidden')
  assertEqual(getGenerationQueueRemainingLabel(makeQueueRecord({ estimated_total_seconds: null }), translate, formatNumber), null, 'null ETA should stay hidden')
  assertEqual(getGenerationQueueRemainingLabel(makeQueueRecord({ estimated_total_seconds: -1 }), translate, formatNumber), null, 'negative ETA should stay hidden')
  assertEqual(getGenerationQueueRemainingLabel(makeQueueRecord({ estimated_total_seconds: 0 }), translate, formatNumber), '1s', 'sub-minute ETA should show at least one second')
  assertEqual(getGenerationQueueRemainingLabel(makeQueueRecord({ estimated_total_seconds: 44.6 }), translate, formatNumber), '45s', 'sub-minute ETA should round seconds')
  assertEqual(getGenerationQueueRemainingLabel(makeQueueRecord({ estimated_total_seconds: 120 }), translate, formatNumber), '2m', 'minute ETA should round to minutes')
  assertEqual(getGenerationQueueRemainingLabel(makeQueueRecord({ estimated_total_seconds: 3600 }), translate, formatNumber), '1h', 'whole-hour ETA should omit minutes')
  assertEqual(getGenerationQueueRemainingLabel(makeQueueRecord({ estimated_total_seconds: 3660 }), translate, formatNumber), '1h 1m', 'hour ETA should include remaining minutes when present')
}

function makeHistoryRecord(overrides: Partial<GenerationHistoryRecord> = {}): GenerationHistoryRecord {
  return {
    id: 201,
    service_type: 'comfyui',
    generation_status: 'completed',
    queue_job_id: 101,
    queue_status: 'completed',
    queue_cancel_requested: 0,
    actual_composite_hash: 'hash',
    created_at: '2026-05-14T00:00:00.000Z',
    ...overrides,
  }
}

function assertOperationalMetaLabels() {
  assertEqual(
    getGenerationQueueLaneLabel(makeQueueRecord({ queue_position: 2, queue_position_scope: 'auto' }), translate, formatNumber),
    '자동 · 큐 2',
    'auto-routed jobs should expose queue position and lane scope',
  )
  assertEqual(
    getGenerationQueueLaneLabel(makeQueueRecord({ queue_position: 3, queue_position_scope: 'server', queue_position_server_id: 7 }), translate, formatNumber),
    '서버 7 · 큐 3',
    'server-routed jobs should expose server id and queue position',
  )
  assertEqual(
    getGenerationQueueLaneLabel(makeQueueRecord({ queue_position: 4, queue_position_scope: 'tag', queue_position_server_tag: 'fast' }), translate, formatNumber),
    '#fast · 큐 4',
    'tag-routed jobs should expose the normalized tag and queue position',
  )
  assertEqual(getGenerationQueueLaneLabel(makeQueueRecord({ queue_position: null }), translate, formatNumber), null, 'missing queue position should stay hidden')
  assertEqual(getGenerationQueueWaitLabel(makeQueueRecord({ estimated_wait_seconds: 0 }), translate, formatNumber), '곧 시작', 'zero wait should be shown as starts-soon')
  assertEqual(getGenerationQueueWaitLabel(makeQueueRecord({ estimated_wait_seconds: 90 }), translate, formatNumber), '대기 2m', 'queued wait should be separate from total remaining time')
  assertEqual(getGenerationQueueWaitLabel(makeQueueRecord({ status: 'running', estimated_wait_seconds: 90 }), translate, formatNumber), null, 'running jobs should not show queued wait')
  assertEqual(getGenerationQueueDurationLabel(makeQueueRecord({ estimated_duration_seconds: 75 }), translate, formatNumber), '예상 1m', 'median duration should be available as operational metadata')
}

function assertElapsedLabels() {
  const nowMs = Date.parse('2026-05-14T11:04:00.000Z')
  const queuedNinetySecondsAgo = new Date(nowMs - 90_000).toISOString()
  const dispatchingThirtySecondsAgo = new Date(nowMs - 30_000).toISOString()
  const runningSixtyOneMinutesAgo = new Date(nowMs - 3_660_000).toISOString()

  assertEqual(
    getGenerationQueueElapsedLabel(makeQueueRecord({ status: 'queued', queued_at: queuedNinetySecondsAgo }), translate, formatNumber, nowMs),
    '대기 1m',
    'queued jobs should expose compact elapsed queue age',
  )
  assertEqual(
    getGenerationQueueElapsedLabel(makeQueueRecord({ status: 'dispatching', queued_at: dispatchingThirtySecondsAgo }), translate, formatNumber, nowMs),
    '전송 30s',
    'dispatching jobs should expose compact dispatch age from queue time',
  )
  assertEqual(
    getGenerationQueueElapsedLabel(makeQueueRecord({ status: 'running', started_at: runningSixtyOneMinutesAgo }), translate, formatNumber, nowMs),
    '실행 1h 1m',
    'running jobs should expose compact elapsed runtime from start time',
  )
  assertEqual(
    getGenerationQueueElapsedLabel(makeQueueRecord({ status: 'running', started_at: null }), translate, formatNumber, nowMs),
    null,
    'running jobs without a valid start timestamp should hide elapsed runtime',
  )
  assertEqual(
    getGenerationQueueElapsedLabel(makeQueueRecord({ status: 'queued', queued_at: new Date(nowMs + 1000).toISOString() }), translate, formatNumber, nowMs),
    null,
    'future queue timestamps should hide elapsed age',
  )
}

function assertProgressPercent() {
  const nowMs = Date.parse('2026-05-14T11:04:00.000Z')
  const startedThirtySecondsAgo = new Date(nowMs - 30_000).toISOString()
  const startedLongAgo = new Date(nowMs - 300_000).toISOString()

  assertEqual(getGenerationQueueProgressPercent(makeQueueRecord({ status: 'queued' }), nowMs), null, 'non-running jobs should not expose progress')
  assertEqual(getGenerationQueueProgressPercent(makeQueueRecord({ status: 'running' }), nowMs), null, 'running jobs without a duration estimate should not expose progress')
  assertEqual(
    getGenerationQueueProgressPercent(makeQueueRecord({ status: 'running', estimated_duration_seconds: 0, estimated_total_seconds: 0 }), nowMs),
    100,
    'running jobs with zero remaining total should be complete',
  )
  assertEqual(
    getGenerationQueueProgressPercent(makeQueueRecord({ status: 'running', started_at: startedThirtySecondsAgo, estimated_duration_seconds: 120, estimated_total_seconds: 90 }), nowMs),
    25,
    'running progress should be derived from elapsed time and estimated duration',
  )
  assertEqual(
    getGenerationQueueProgressPercent(makeQueueRecord({ status: 'running', started_at: startedLongAgo, estimated_duration_seconds: 120, estimated_total_seconds: 1 }), nowMs),
    99,
    'running progress should stay below 100 while positive estimated total time remains',
  )
  assertEqual(
    getGenerationQueueProgressPercent(makeQueueRecord({ status: 'running', started_at: 'not-a-date', estimated_duration_seconds: 120, estimated_total_seconds: 60 }), nowMs),
    0,
    'invalid start timestamps should be treated as zero elapsed time',
  )
}

function assertHeaderQuerySnapshotSelection() {
  const globalSnapshot = {
    records: [makeQueueRecord({ id: 1 })],
    isPending: false,
    isError: false,
    error: null,
  }
  const disabledFilteredSnapshot = {
    records: undefined,
    isPending: true,
    isError: false,
    error: null,
  }

  assertEqual(
    getGenerationQueueHeaderQuerySnapshot({
      isFilteredQueueView: false,
      globalQueue: globalSnapshot,
      filteredQueue: disabledFilteredSnapshot,
    }),
    globalSnapshot,
    'all queue scope should use the global query state instead of disabled filtered query state',
  )

  assertEqual(
    getGenerationQueueHeaderQuerySnapshot({
      isFilteredQueueView: true,
      globalQueue: globalSnapshot,
      filteredQueue: disabledFilteredSnapshot,
    }),
    disabledFilteredSnapshot,
    'filtered queue scope should use filtered query state',
  )
}

function assertFilteredQueueHeaderQueryEnablement() {
  assertEqual(
    shouldEnableFilteredQueueHeaderQuery({ hasGenerationPermission: true, isFilteredQueueView: true, isOpen: true }),
    true,
    'filtered queue query should run while the filtered popup view is open',
  )
  assertEqual(
    shouldEnableFilteredQueueHeaderQuery({ hasGenerationPermission: true, isFilteredQueueView: true, isOpen: false }),
    false,
    'filtered queue query should not keep polling after the popup closes',
  )
  assertEqual(
    shouldEnableFilteredQueueHeaderQuery({ hasGenerationPermission: true, isFilteredQueueView: false, isOpen: true }),
    false,
    'all-queue scope should not enable the filtered queue query',
  )
  assertEqual(
    shouldEnableFilteredQueueHeaderQuery({ hasGenerationPermission: false, isFilteredQueueView: true, isOpen: true }),
    false,
    'missing generation permission should keep the filtered queue query disabled',
  )
}

function assertHeaderRefreshTargets() {
  assertEqual(
    JSON.stringify(getGenerationQueueHeaderRefreshTargets({ activeTab: 'jobs', isFilteredQueueQueryEnabled: false })),
    JSON.stringify(['globalQueue']),
    'jobs refresh without filtered query should only refresh the global queue',
  )
  assertEqual(
    JSON.stringify(getGenerationQueueHeaderRefreshTargets({ activeTab: 'jobs', isFilteredQueueQueryEnabled: true })),
    JSON.stringify(['globalQueue', 'filteredQueue']),
    'jobs refresh with filtered query should include the filtered queue',
  )
  assertEqual(
    JSON.stringify(getGenerationQueueHeaderRefreshTargets({ activeTab: 'reservations', isFilteredQueueQueryEnabled: false })),
    JSON.stringify(['globalQueue', 'reservationSchedules', 'reservationWorkflows']),
    'reservations refresh should include reservation schedule and workflow queries',
  )
}

function assertHeaderWidgetStorageGuards() {
  const headerWidgetSource = readFileSync(join(process.cwd(), 'src', 'features', 'image-generation', 'components', 'generation-queue-header-widget.tsx'), 'utf8')
    .replace(/\r\n/g, '\n')

  assertEqual(
    headerWidgetSource.includes('try {\n    rawValue = window.sessionStorage.getItem(LAST_SEEN_QUEUE_JOB_ID_STORAGE_KEY)\n  } catch {\n    return null\n  }'),
    true,
    'queue header should ignore blocked sessionStorage reads',
  )
  assertEqual(
    headerWidgetSource.includes('try {\n    window.sessionStorage.setItem(LAST_SEEN_QUEUE_JOB_ID_STORAGE_KEY, String(Math.max(0, Math.trunc(value))))\n  } catch {'),
    true,
    'queue header should ignore blocked sessionStorage writes',
  )
  assertEqual(
    headerWidgetSource.includes('const initialLastSeenQueueJobId = useMemo(() => readLastSeenQueueJobId(), [])'),
    true,
    'queue header should read the notification baseline once per mount',
  )
  assertEqual(
    headerWidgetSource.includes('const IDLE_QUEUE_REFETCH_INTERVAL_MS = 30_000'),
    true,
    'queue header should use a slow idle poll when no active job is visible',
  )
  assertEqual(
    headerWidgetSource.includes("document.visibilityState === 'hidden'"),
    true,
    'queue header should pause interval polling while the browser tab is hidden',
  )
  assertEqual(
    headerWidgetSource.includes('getGenerationQueueHeaderRefetchInterval(activeCount, isOpen)'),
    true,
    'queue header refetch intervals should share one visibility-aware policy',
  )
}

function assertHistoryRecoveryState() {
  const failedRetryable = makeHistoryRecord({
    generation_status: 'failed',
    queue_status: 'failed',
    queue_job_id: 44,
    actual_composite_hash: null,
  })
  assertEqual(canRetryHistoryQueueJob(failedRetryable), true, 'failed queue-linked history should be retryable')
  assertEqual(getRetryableHistoryQueueJobId(failedRetryable), 44, 'failed queue-linked history should expose the retryable queue job id')
  assertEqual(getHistoryRunRecoveryState(failedRetryable), 'retryable-failed', 'failed queue-linked history should use failed retry state')

  const cancelledRetryable = makeHistoryRecord({
    generation_status: 'pending',
    queue_status: 'cancelled',
    queue_job_id: 45,
    actual_composite_hash: null,
  })
  assertEqual(canRetryHistoryQueueJob(cancelledRetryable), true, 'cancelled queue-linked history should be retryable')
  assertEqual(getRetryableHistoryQueueJobId(cancelledRetryable), 45, 'cancelled queue-linked history should expose the retryable queue job id')
  assertEqual(getHistoryRunRecoveryState(cancelledRetryable), 'retryable-cancelled', 'cancelled queue-linked history should use cancelled retry state')

  assertEqual(getHistoryRunRecoveryState(makeHistoryRecord()), 'completed', 'completed history should route to result inspection')
  assertEqual(getRetryableHistoryQueueJobId(makeHistoryRecord()), null, 'completed queue-linked history should not expose retry')
  assertEqual(
    getHistoryRunRecoveryState(makeHistoryRecord({ generation_status: 'failed', queue_job_id: null, queue_status: null, actual_composite_hash: null })),
    'failed-no-retry',
    'failed history without a failed/cancelled queue job should not expose replay',
  )
}

assertStatusLabels()
assertWorkflowLabels()
assertRequesterLabels()
assertRemainingLabels()
assertOperationalMetaLabels()
assertElapsedLabels()
assertProgressPercent()
assertHistoryRecoveryState()
assertHeaderQuerySnapshotSelection()
assertFilteredQueueHeaderQueryEnablement()
assertHeaderRefreshTargets()
assertHeaderWidgetStorageGuards()

console.log('Generation queue UI contracts verified.')
