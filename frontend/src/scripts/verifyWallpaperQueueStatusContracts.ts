import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TranslationInput, TranslationParams } from '../i18n'
import type { GraphExecutionRecord } from '../lib/api-module-graph'
import { getWallpaperQueueAgeLabel, getWallpaperQueueAgeLabelFromAnchor, getWallpaperQueueExecutionSummary } from '../features/wallpaper/wallpaper-queue-status-utils'

const __dirname = dirname(fileURLToPath(import.meta.url))

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

function assertQueueExecutionSummary() {
  const executions = [
    makeExecution({ status: 'queued', created_date: '2026-05-14T11:02:30.000Z', updated_date: '2026-05-14T11:02:40.000Z' }),
    makeExecution({ status: 'queued', created_date: '2026-05-14T11:01:30.000Z', updated_date: '2026-05-14T11:01:40.000Z' }),
    makeExecution({ status: 'running', started_at: '2026-05-14T10:59:00.000Z', updated_date: '2026-05-14T11:03:40.000Z' }),
    makeExecution({ status: 'failed', updated_date: '2026-05-14T11:00:40.000Z' }),
    makeExecution({ status: 'completed', updated_date: '2026-05-14T11:04:40.000Z' }),
    makeExecution({ status: 'cancelled', updated_date: '2026-05-14T10:58:40.000Z' }),
  ]
  const summary = getWallpaperQueueExecutionSummary(executions)

  assertEqual(summary.queued, 2, 'summary should count queued executions')
  assertEqual(summary.running, 1, 'summary should count running executions')
  assertEqual(summary.failed, 1, 'summary should count failed executions')
  assertEqual(summary.completed, 1, 'summary should count completed executions')
  assertEqual(summary.oldestQueuedAnchorMs, Date.parse('2026-05-14T11:01:30.000Z'), 'summary should retain the oldest queued anchor')
  assertEqual(summary.oldestRunningAnchorMs, Date.parse('2026-05-14T10:59:00.000Z'), 'summary should retain the oldest running anchor')
  assertEqual(summary.latestUpdatedAt, '2026-05-14T11:04:40.000Z', 'summary should retain the latest update timestamp')
  assertEqual(
    getWallpaperQueueAgeLabelFromAnchor('queued', summary.oldestQueuedAnchorMs, translate, formatNumber, Date.parse('2026-05-14T11:04:00.000Z')),
    '최장 대기 2m',
    'precomputed queue anchors should render age labels',
  )
}

function assertQueueSummarySourcePolicy() {
  const widgetBodiesSource = readFileSync(resolve(__dirname, '../features/wallpaper/wallpaper-widget-bodies.tsx'), 'utf8')
  const queueStatusUtilsSource = readFileSync(resolve(__dirname, '../features/wallpaper/wallpaper-queue-status-utils.ts'), 'utf8')

  assertEqual(widgetBodiesSource.includes('getWallpaperQueueExecutionSummary'), true, 'wallpaper widgets should use the shared execution summary helper')
  assertEqual(widgetBodiesSource.includes('executions.filter((item) => item.status'), false, 'wallpaper widgets must not rescan executions for each status count')
  assertEqual(widgetBodiesSource.includes('[...executions].sort'), false, 'wallpaper widgets must not clone and sort executions to find the latest update')
  assertEqual(queueStatusUtilsSource.includes('for (const execution of executions)'), true, 'queue summary helper should keep execution aggregation single-pass')
}

assertQueueAgeLabels()
assertQueueExecutionSummary()
assertQueueSummarySourcePolicy()

console.log('Wallpaper queue status contracts verified.')
