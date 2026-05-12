import assert from 'node:assert/strict'
import { computeQueuePositions } from '../routes/generation-queue/queue-eta'
import {
  getGenerationQueueEligibleServerIds,
  hasGenerationQueueServerRoutingTag,
  normalizeGenerationQueueRoutingTag,
  resolveGenerationQueueLaneMeta,
} from '../services/generationQueueRouting'
import type { ComfyUIServerRecord } from '../types/comfyuiServer'
import type { GenerationQueueJobRecord } from '../types/generationQueue'

const ISO = '2026-05-12T00:00:00.000Z'

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

function main() {
  const fastServer = server({ id: 1, name: 'Fast', routing_tags: ['FAST.LANE', '  Burst '] })
  const slowServer = server({ id: 2, name: 'Slow', routing_tags: ['slow'] })
  const modalServer = server({ id: 3, name: 'Modal', backend_type: 'modal', routing_tags: ['cloud'] })
  const activeServers = [fastServer, slowServer, modalServer]

  assert.equal(normalizeGenerationQueueRoutingTag(' FAST.Lane '), 'fast.lane')
  assert.equal(hasGenerationQueueServerRoutingTag(fastServer, ' fast.lane '), true)
  assert.equal(hasGenerationQueueServerRoutingTag(fastServer, 'FAST.LANE'), true)
  assert.equal(hasGenerationQueueServerRoutingTag(fastServer, 'missing'), false)

  assert.deepEqual(
    getGenerationQueueEligibleServerIds(job({ id: 10, service_type: 'comfyui' }), activeServers),
    [1, 2],
    'auto-routed ComfyUI jobs should exclude Modal backends until a server or tag explicitly requests them',
  )

  assert.deepEqual(
    getGenerationQueueEligibleServerIds(job({ id: 11, service_type: 'comfyui', requested_server_tag: 'fast.lane' }), activeServers),
    [1],
    'tag-routed ComfyUI jobs should resolve normalized routing tags',
  )

  assert.deepEqual(
    getGenerationQueueEligibleServerIds(job({ id: 12, service_type: 'comfyui', requested_server_id: 3 }), activeServers),
    [3],
    'explicit server routing should allow a Modal backend when that server was requested directly',
  )

  assert.deepEqual(
    getGenerationQueueEligibleServerIds(job({ id: 13, service_type: 'comfyui', requested_server_tag: 'cloud' }), activeServers),
    [3],
    'tag routing should allow a Modal backend when its tag was requested explicitly',
  )

  const tagLane = resolveGenerationQueueLaneMeta(job({ id: 14, service_type: 'comfyui', requested_server_tag: 'fast.lane' }), activeServers)
  assert.equal(tagLane.scope, 'tag')
  assert.equal(tagLane.serverTag, 'fast.lane')
  assert.deepEqual(tagLane.eligibleServerIds, [1])

  const positions = computeQueuePositions([
    job({ id: 20, service_type: 'comfyui', requested_server_tag: 'fast.lane', priority: 1 }),
    job({ id: 21, service_type: 'comfyui', requested_server_tag: 'fast.lane', priority: 2 }),
    job({ id: 22, service_type: 'comfyui', requested_server_id: 2 }),
    job({ id: 23, service_type: 'novelai' }),
    job({ id: 24, service_type: 'novelai' }),
    job({ id: 25, service_type: 'comfyui', status: 'running', assigned_server_id: 1 }),
  ], activeServers)

  assert.equal(positions.get(20)?.position, 1)
  assert.equal(positions.get(21)?.position, 2)
  assert.equal(positions.get(22)?.position, 1)
  assert.equal(positions.get(23)?.position, 1)
  assert.equal(positions.get(24)?.position, 2)
  assert.equal(positions.has(25), false, 'running jobs should not receive a queued position')

  console.log('✅ Generation queue routing smoke passed (tag normalization, eligibility, lane positions)')
}

main()
