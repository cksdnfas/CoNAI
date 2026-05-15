import type { TranslationInput, TranslationParams } from '../i18n'
import type { GenerationQueueJobRecord } from '../lib/api-image-generation-types'
import {
  getGenerationQueueElapsedLabel,
  getGenerationQueueHeaderQuerySnapshot,
  getGenerationQueueProgressPercent,
  getGenerationQueueRemainingLabel,
  getGenerationQueueRequesterLabel,
  getGenerationQueueStatusLabel,
  getGenerationQueueWorkflowLabel,
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
    request_payload: '{}',
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

assertStatusLabels()
assertWorkflowLabels()
assertRequesterLabels()
assertRemainingLabels()
assertElapsedLabels()
assertProgressPercent()
assertHeaderQuerySnapshotSelection()

console.log('Generation queue UI contracts verified.')
