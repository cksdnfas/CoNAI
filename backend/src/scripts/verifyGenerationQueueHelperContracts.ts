import assert from 'node:assert/strict'
import { settingsService } from '../services/settingsService'
import { QueueServiceThrottle } from '../services/generation-queue/queueServiceThrottle'
import { buildQueueTransitionUpdates } from '../services/generation-queue/queueTransitions'
import type { AppSettings } from '../types/settings'
import type { GenerationQueueJobRecord } from '../types/generationQueue'

const NOW_ISO = '2026-07-09T00:00:00.000Z'

function buildQueueRecord(overrides: Partial<GenerationQueueJobRecord> = {}): GenerationQueueJobRecord {
  return {
    id: 1,
    service_type: 'comfyui',
    status: 'queued',
    priority: 0,
    requested_by_account_id: null,
    requested_by_username: null,
    requested_by_account_type: null,
    workflow_id: null,
    workflow_name: null,
    requested_group_id: null,
    requested_server_id: null,
    requested_server_tag: null,
    assigned_server_id: null,
    provider_job_id: null,
    request_payload: '{}',
    request_summary: null,
    failure_code: null,
    failure_message: null,
    cancel_requested: 0,
    queued_at: '2026-07-08T00:00:00.000Z',
    started_at: null,
    completed_at: null,
    created_date: '2026-07-08T00:00:00.000Z',
    updated_date: '2026-07-08T00:00:00.000Z',
    ...overrides,
  }
}

function assertTransitionContracts() {
  assert.deepEqual(
    buildQueueTransitionUpdates(buildQueueRecord({ status: 'running', started_at: 'old', assigned_server_id: 7, provider_job_id: 'prompt-1', cancel_requested: 1 }), 'queued', NOW_ISO),
    {
      status: 'queued',
      started_at: null,
      completed_at: null,
      assigned_server_id: null,
      provider_job_id: null,
      cancel_requested: false,
      failure_code: null,
      failure_message: null,
    },
  )

  assert.deepEqual(
    buildQueueTransitionUpdates(buildQueueRecord({ status: 'queued' }), 'dispatching', NOW_ISO, { assignedServerId: 12 }),
    { status: 'dispatching', completed_at: null, assigned_server_id: 12 },
  )

  assert.deepEqual(
    buildQueueTransitionUpdates(buildQueueRecord({ status: 'dispatching', started_at: null }), 'running', NOW_ISO, { assignedServerId: 8, providerJobId: 'prompt-8' }),
    { status: 'running', started_at: NOW_ISO, completed_at: null, assigned_server_id: 8, provider_job_id: 'prompt-8' },
  )

  assert.deepEqual(
    buildQueueTransitionUpdates(buildQueueRecord({ status: 'running', started_at: 'existing-start' }), 'running', NOW_ISO),
    { status: 'running', started_at: 'existing-start', completed_at: null },
  )

  assert.deepEqual(
    buildQueueTransitionUpdates(buildQueueRecord({ status: 'running', cancel_requested: 1, failure_code: 'old', failure_message: 'old message' }), 'completed', NOW_ISO),
    { status: 'completed', completed_at: NOW_ISO, cancel_requested: true, failure_code: null, failure_message: null },
  )

  assert.deepEqual(
    buildQueueTransitionUpdates(buildQueueRecord({ status: 'running', failure_code: 'stored', failure_message: 'stored message' }), 'failed', NOW_ISO, { failureMessage: 'new message' }),
    { status: 'failed', completed_at: NOW_ISO, cancel_requested: false, failure_code: 'stored', failure_message: 'new message' },
  )

  assert.deepEqual(
    buildQueueTransitionUpdates(buildQueueRecord({ status: 'running' }), 'cancelled', NOW_ISO),
    { status: 'cancelled', completed_at: NOW_ISO, cancel_requested: true },
  )
}

function assertThrottleContracts() {
  const originalLoadSettings = settingsService.loadSettings.bind(settingsService)
  const originalDateNow = Date.now
  const originalRandom = Math.random
  const defaults = settingsService.getDefaultSettings()
  let scheduleJobCount = 2
  let scheduleMode: AppSettings['generationThrottle']['novelai']['scheduleMode'] = 'even'
  let minStartIntervalSeconds = 0

  settingsService.loadSettings = () => ({
    ...defaults,
    generationThrottle: {
      ...defaults.generationThrottle,
      novelai: {
        ...defaults.generationThrottle.novelai,
        maxConcurrentJobs: 0,
        scheduleWindowMinutes: 1,
        scheduleJobCount,
        scheduleMode,
        minStartIntervalSeconds,
      },
      codex: {
        ...defaults.generationThrottle.codex,
        maxConcurrentJobs: 2,
        scheduleWindowMinutes: 1,
        scheduleJobCount: 1,
        scheduleMode: 'even',
        minStartIntervalSeconds: 0,
      },
    },
  })

  try {
    const throttle = new QueueServiceThrottle()
    const now = Date.parse('2026-07-09T00:00:00.000Z')

    assert.equal(throttle.getMaxConcurrentJobs('novelai'), 1, 'max concurrent jobs should clamp to at least one')
    assert.deepEqual(throttle.getStartDelaySeconds('novelai', 0, now), [], 'zero forecast count should return no slots')
    assert.deepEqual(throttle.getStartDelaySeconds('novelai', 3, now), [0, 30, 60], 'even schedule should forecast current and next window slots')

    Date.now = () => now
    assert.equal(throttle.isStartDue('novelai'), true, 'first service slot should be due immediately')
    throttle.noteStart('novelai')
    assert.equal(throttle.isStartDue('novelai'), false, 'second slot should not be due before its offset')

    Date.now = () => now + 30_000
    assert.equal(throttle.isStartDue('novelai'), true, 'second service slot should become due at its offset')
    throttle.noteStart('novelai')
    assert.equal(throttle.isStartDue('novelai'), false, 'service should stop after all slots in the current window are used')

    Date.now = () => now + 60_000
    assert.equal(throttle.isStartDue('novelai'), true, 'expired schedule window should reset and allow a new start')
    throttle.noteStart('novelai')

    scheduleJobCount = 1
    Date.now = () => now + 60_001
    assert.equal(throttle.isStartDue('novelai'), true, 'settings-key changes should reset service throttle state')

    scheduleJobCount = 3
    scheduleMode = 'random'
    minStartIntervalSeconds = 20
    Math.random = () => Math.exp(-1)
    const randomDelays = new QueueServiceThrottle().getStartDelaySeconds('novelai', 3, now)
    assert.equal(randomDelays[0], 0, 'random schedule should keep the first slot immediate')
    assert.ok(randomDelays[1] >= 20, `random schedule should honor the minimum interval before slot 2, got ${randomDelays[1]}`)
    assert.ok(randomDelays[2] - randomDelays[1] >= 20, `random schedule should honor the minimum interval before slot 3, got ${randomDelays.join(',')}`)
    assert.ok(randomDelays[2] <= 60, `random schedule should stay inside the throttle window, got ${randomDelays[2]}`)
  } finally {
    settingsService.loadSettings = originalLoadSettings
    Date.now = originalDateNow
    Math.random = originalRandom
  }
}

assertTransitionContracts()
assertThrottleContracts()

console.log('Generation queue helper contracts verified.')
