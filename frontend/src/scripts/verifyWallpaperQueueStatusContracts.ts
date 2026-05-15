import type { TranslationInput, TranslationParams } from '../i18n'
import type { GraphExecutionRecord } from '../lib/api-module-graph'
import { getWallpaperQueueAgeLabel } from '../features/wallpaper/wallpaper-queue-status-utils'

function translate(input: TranslationInput, params?: TranslationParams) {
  const template = typeof input === 'string'
    ? input
    : input.ko ?? input.en ?? ''

  return template.replace(/\{([^}]+)\}/g, (match, key: string) => {
    const value = params?.[key]
    return value === undefined || value === null ? match : String(value)
  })
}

function formatNumber(value: number) {
  return String(value)
}

function makeExecution(overrides: Partial<GraphExecutionRecord> = {}): GraphExecutionRecord {
  return {
    id: 101,
    graph_workflow_id: 7,
    graph_version: 1,
    status: 'queued',
    trigger_type: 'manual',
    schedule_id: null,
    execution_plan: null,
    started_at: null,
    completed_at: null,
    failed_node_id: null,
    error_message: null,
    queue_position: null,
    cancel_requested: false,
    created_date: '2026-05-14T10:00:00.000Z',
    updated_date: '2026-05-14T10:00:00.000Z',
    ...overrides,
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

function assertQueueAgeLabels() {
  const nowMs = Date.parse('2026-05-14T11:04:00.000Z')

  assertEqual(
    getWallpaperQueueAgeLabel([
      makeExecution({ status: 'queued', created_date: '2026-05-14T11:02:30.000Z' }),
      makeExecution({ status: 'queued', created_date: '2026-05-14T11:03:30.000Z' }),
    ], 'queued', translate, formatNumber, nowMs),
    '최장 대기 1m',
    'queued status should show oldest queue age from created_date',
  )

  assertEqual(
    getWallpaperQueueAgeLabel([
      makeExecution({ status: 'running', started_at: '2026-05-14T10:03:00.000Z' }),
      makeExecution({ status: 'running', started_at: '2026-05-14T10:59:00.000Z' }),
    ], 'running', translate, formatNumber, nowMs),
    '최장 실행 1h 1m',
    'running status should show oldest runtime from started_at',
  )

  assertEqual(
    getWallpaperQueueAgeLabel([
      makeExecution({ status: 'running', started_at: null }),
      makeExecution({ status: 'running', started_at: 'not-a-date' }),
    ], 'running', translate, formatNumber, nowMs),
    null,
    'missing or invalid running timestamps should hide age labels',
  )

  assertEqual(
    getWallpaperQueueAgeLabel([
      makeExecution({ status: 'queued', created_date: '2026-05-14T11:04:01.000Z' }),
    ], 'queued', translate, formatNumber, nowMs),
    null,
    'future queue timestamps should hide age labels',
  )

  assertEqual(
    getWallpaperQueueAgeLabel([
      makeExecution({ status: 'failed', updated_date: '2026-05-14T10:00:00.000Z' }),
    ], 'failed', translate, formatNumber, nowMs),
    null,
    'terminal status cards should not show active age labels',
  )
}

assertQueueAgeLabels()

console.log('Wallpaper queue status contracts verified.')
