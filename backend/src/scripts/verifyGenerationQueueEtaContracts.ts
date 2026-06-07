import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { computeQueueEtas, computeQueuePositions } from '../routes/generation-queue/queue-eta'
import { getGenerationQueueServerCapacity } from '../services/generationQueueRouting'
import type { ComfyUIServerRecord } from '../types/comfyuiServer'
import type { GenerationQueueJobRecord } from '../types/generationQueue'

const ISO = '2026-05-14T00:00:00.000Z'

function server(overrides: Partial<ComfyUIServerRecord> & Pick<ComfyUIServerRecord, 'id' | 'name'>): ComfyUIServerRecord {
  return {
    id: overrides.id,
    name: overrides.name,
    endpoint: overrides.endpoint ?? `http://127.0.0.1:${8000 + overrides.id}`,
    backend_type: overrides.backend_type ?? 'comfyui',
    capacity: overrides.capacity ?? 1,
    description: overrides.description,
    routing_tags_json: overrides.routing_tags_json ?? null,
    routing_tags: overrides.routing_tags ?? [],
    is_active: overrides.is_active ?? true,
    is_default: overrides.is_default ?? false,
    created_date: overrides.created_date ?? ISO,
    updated_date: overrides.updated_date ?? ISO,
  }
}

function job(overrides: Partial<GenerationQueueJobRecord> & Pick<GenerationQueueJobRecord, 'id' | 'service_type'>): GenerationQueueJobRecord {
  return {
    id: overrides.id,
    service_type: overrides.service_type,
    status: overrides.status ?? 'queued',
    priority: overrides.priority ?? 100,
    requested_by_account_id: overrides.requested_by_account_id ?? null,
    requested_by_username: overrides.requested_by_username ?? null,
    requested_by_account_type: overrides.requested_by_account_type ?? null,
    workflow_id: overrides.workflow_id ?? null,
    workflow_name: overrides.workflow_name ?? null,
    requested_group_id: overrides.requested_group_id ?? null,
    requested_server_id: overrides.requested_server_id ?? null,
    requested_server_tag: overrides.requested_server_tag ?? null,
    assigned_server_id: overrides.assigned_server_id ?? null,
    provider_job_id: overrides.provider_job_id ?? null,
    request_payload: overrides.request_payload ?? '{}',
    request_summary: overrides.request_summary ?? null,
    failure_code: overrides.failure_code ?? null,
    failure_message: overrides.failure_message ?? null,
    cancel_requested: overrides.cancel_requested ?? 0,
    queued_at: overrides.queued_at ?? ISO,
    started_at: overrides.started_at ?? null,
    completed_at: overrides.completed_at ?? null,
    created_date: overrides.created_date ?? ISO,
    updated_date: overrides.updated_date ?? ISO,
  }
}

function completedJob(overrides: Partial<GenerationQueueJobRecord> & Pick<GenerationQueueJobRecord, 'id' | 'service_type'>, durationSeconds: number) {
  return job({
    status: 'completed',
    started_at: '2026-05-14T00:00:00.000Z',
    completed_at: new Date(Date.parse('2026-05-14T00:00:00.000Z') + durationSeconds * 1000).toISOString(),
    ...overrides,
  })
}

function assertEta(
  etas: Map<number, { waitSeconds: number | null; totalSeconds: number | null; durationSeconds: number | null }>,
  id: number,
  expected: { waitSeconds: number | null; totalSeconds: number | null; durationSeconds: number | null },
) {
  assert.deepEqual(etas.get(id), expected, `unexpected ETA for queue job ${id}`)
}

function main() {
  const queueEtaSource = readFileSync(resolve(process.cwd(), 'src/routes/generation-queue/queue-eta.ts'), 'utf8')
  assert.match(
    queueEtaSource,
    /const eligibleServerIdSet = new Set\(queuePosition\.eligibleServerIds\)/,
    'tag/auto ETA lanes should build one eligible-server Set before scanning running jobs',
  )
  assert.doesNotMatch(
    queueEtaSource,
    /eligibleServerIds\.includes\(candidateServerId\)/,
    'running-lane ETA scans must not linearly check eligible servers for every active job',
  )

  const dualSlotServer = server({ id: 1, name: 'Dual Slot', capacity: 2, routing_tags: ['fast'] })
  const singleSlotServer = server({ id: 2, name: 'Single Slot', capacity: 1 })
  const activeServers = [dualSlotServer, singleSlotServer]

  assert.equal(getGenerationQueueServerCapacity(dualSlotServer), 2)
  assert.equal(getGenerationQueueServerCapacity(server({ id: 3, name: 'Zero Capacity Guard', capacity: 0 })), 1)

  const durationSamples = [
    completedJob({ id: 1001, service_type: 'comfyui', assigned_server_id: 1 }, 40),
    completedJob({ id: 1002, service_type: 'comfyui', assigned_server_id: 1 }, 40),
    completedJob({ id: 1003, service_type: 'comfyui', assigned_server_id: 2 }, 40),
  ]

  const queuedBehindRunning = [
    job({
      id: 10,
      service_type: 'comfyui',
      status: 'running',
      assigned_server_id: 1,
      started_at: new Date(Date.now() - 10_000).toISOString(),
    }),
    job({ id: 11, service_type: 'comfyui', requested_server_id: 1 }),
  ]
  const queuedBehindRunningPositions = computeQueuePositions(queuedBehindRunning, activeServers)
  const queuedBehindRunningEtas = computeQueueEtas(queuedBehindRunning, queuedBehindRunningPositions, durationSamples, activeServers)

  assert.equal(queuedBehindRunningPositions.get(11)?.scope, 'server')
  assertEta(queuedBehindRunningEtas, 11, { waitSeconds: 0, totalSeconds: 40, durationSeconds: 40 })

  const serverLaneQueue = [
    job({ id: 20, service_type: 'comfyui', requested_server_id: 1 }),
    job({ id: 21, service_type: 'comfyui', requested_server_id: 1 }),
    job({ id: 22, service_type: 'comfyui', requested_server_id: 1 }),
  ]
  const serverLanePositions = computeQueuePositions(serverLaneQueue, activeServers)
  const serverLaneEtas = computeQueueEtas(serverLaneQueue, serverLanePositions, durationSamples, activeServers)

  assert.equal(serverLanePositions.get(22)?.position, 3)
  assertEta(serverLaneEtas, 20, { waitSeconds: 0, totalSeconds: 40, durationSeconds: 40 })
  assertEta(serverLaneEtas, 21, { waitSeconds: 0, totalSeconds: 40, durationSeconds: 40 })
  assertEta(serverLaneEtas, 22, { waitSeconds: 40, totalSeconds: 80, durationSeconds: 40 })

  const autoLaneQueue = [
    job({ id: 30, service_type: 'comfyui' }),
    job({ id: 31, service_type: 'comfyui' }),
    job({ id: 32, service_type: 'comfyui' }),
  ]
  const autoLanePositions = computeQueuePositions(autoLaneQueue, activeServers)
  const autoLaneEtas = computeQueueEtas(autoLaneQueue, autoLanePositions, durationSamples, activeServers)

  assert.equal(autoLanePositions.get(32)?.position, 3)
  assertEta(autoLaneEtas, 32, { waitSeconds: 0, totalSeconds: 40, durationSeconds: 40 })

  const noSampleQueue = [job({ id: 40, service_type: 'comfyui', requested_server_id: 1 })]
  const noSamplePositions = computeQueuePositions(noSampleQueue, activeServers)
  const noSampleEtas = computeQueueEtas(noSampleQueue, noSamplePositions, [], activeServers)
  assertEta(noSampleEtas, 40, { waitSeconds: null, totalSeconds: null, durationSeconds: null })

  const unavailableServerQueue = [job({ id: 50, service_type: 'comfyui', requested_server_id: 999 })]
  const unavailableServerPositions = computeQueuePositions(unavailableServerQueue, activeServers)
  assert.deepEqual(unavailableServerPositions.get(50)?.eligibleServerIds, [], 'inactive explicit server lanes should stay visibly unrunnable')
  const unavailableServerEtas = computeQueueEtas(unavailableServerQueue, unavailableServerPositions, durationSamples, activeServers)
  assertEta(unavailableServerEtas, 50, { waitSeconds: null, totalSeconds: null, durationSeconds: 40 })

  const unavailableTagQueue = [job({ id: 51, service_type: 'comfyui', requested_server_tag: 'missing-tag' })]
  const unavailableTagPositions = computeQueuePositions(unavailableTagQueue, activeServers)
  assert.deepEqual(unavailableTagPositions.get(51)?.eligibleServerIds, [], 'tag lanes without active servers should stay visibly unrunnable')
  const unavailableTagEtas = computeQueueEtas(unavailableTagQueue, unavailableTagPositions, durationSamples, activeServers)
  assertEta(unavailableTagEtas, 51, { waitSeconds: null, totalSeconds: null, durationSeconds: 40 })

  console.log('✅ Generation queue ETA contracts passed (capacity-aware ComfyUI lanes, queued-ahead distribution, missing samples)')
}

main()
