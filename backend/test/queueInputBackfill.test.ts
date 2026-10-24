import './support/testTemp'
// The runtime base must point at a scratch folder before anything reads runtimePaths: this import must stay first.
import './support/scratchRuntime'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getUserSettingsDb, initializeUserSettingsDb } from '../src/database/userSettingsDb'
import { GenerationQueueModel } from '../src/models/GenerationQueue'
import { externalizeQueueInputDataUrls, externalizeStoredQueuePayloads, hydrateQueueInputDataUrls, isQueueInputRef, resolveQueueInputFilePath, storeQueueInputBuffer } from '../src/services/generation-queue/queueInputStore'
import { parseCodexQueuePayload, parseNaiQueuePayload } from '../src/services/generation-queue/queuePayloads'

initializeUserSettingsDb()

/** A PNG-looking data URL well above the 8KB externalization floor. */
const bigDataUrl = `data:image/png;base64,${Buffer.alloc(64 * 1024, 7).toString('base64')}`

test('stored payloads with base64 beside prompt_data are rewritten to references once', () => {
  const jobId = GenerationQueueModel.create({
    service_type: 'comfyui',
    workflow_id: null,
    workflow_name: 'director',
    request_summary: 'backfill test',
    // The shape the MCP enqueue path used to store: the raw node inputs copied next to prompt_data.
    request_payload: {
      prompt_data: { '7': { mode: 'FL2VA' } },
      '7___minimax_h3_director_node__': { mode: 'FL2VA', media: [{ type: 'image', data_url: bigDataUrl }] },
    },
  } as never)

  const first = externalizeStoredQueuePayloads()
  assert.equal(first.rewritten, 1)
  assert.ok(first.savedBytes > 60 * 1024)

  const row = getUserSettingsDb().prepare('SELECT request_payload FROM generation_queue_jobs WHERE id = ?').get(jobId) as { request_payload: string }
  assert.ok(!row.request_payload.includes(';base64,'))
  const ref = JSON.parse(row.request_payload)['7___minimax_h3_director_node__'].media[0].data_url
  assert.ok(isQueueInputRef(ref))
  assert.ok(resolveQueueInputFilePath(ref), 'the blob was written to the store')
  const refs = getUserSettingsDb().prepare('SELECT sha256 FROM generation_queue_input_refs WHERE job_id = ?').all(jobId) as Array<{ sha256: string }>
  assert.deepEqual(refs.map((entry) => entry.sha256), [ref.sha256])

  const second = externalizeStoredQueuePayloads()
  assert.equal(second.rewritten, 0)
  assert.equal(second.scanned, 0)
})

test('NovelAI inputs survive externalization and hydration with references claimed by every repeat', () => {
  const payload = {
    prompt: '1.5::artist:matrix16::',
    model: 'nai-diffusion-5-full',
    action: 'img2img',
    image: bigDataUrl,
    character_refs: [{ image: bigDataUrl }],
    seed: undefined,
  }
  const { value } = externalizeQueueInputDataUrls(payload)
  assert.ok(isQueueInputRef(value.image))
  assert.deepEqual(hydrateQueueInputDataUrls(value), payload)

  const jobIds = GenerationQueueModel.createMany(Array.from({ length: 32 }, () => ({
    service_type: 'novelai' as const,
    request_payload: value,
  })))
  const storedJob = GenerationQueueModel.findById(jobIds[0])!
  const storedPayload = parseNaiQueuePayload(storedJob)
  assert.deepEqual(hydrateQueueInputDataUrls(storedPayload), JSON.parse(JSON.stringify(payload)))
  // retryJob preserves the stored payload and creates another row through the same createMany path.
  const retryId = GenerationQueueModel.create({ service_type: 'novelai', request_payload: storedPayload })
  const refRows = getUserSettingsDb().prepare(
    `SELECT job_id FROM generation_queue_input_refs WHERE job_id IN (${[...jobIds, retryId].map(() => '?').join(',')})`,
  ).all(...jobIds, retryId) as Array<{ job_id: number }>
  assert.deepEqual(refRows.map((row) => row.job_id).sort((a, b) => a - b), [...jobIds, retryId])

  assert.throws(
    () => hydrateQueueInputDataUrls({ image: { __ref: 'queue-input', sha256: '0'.repeat(64), bytes: 1, mimeType: 'image/png' } }),
    /Queue input blob is missing/,
  )
})

test('Codex edit inputs rewritten by the startup backfill still reach the executor', () => {
  const jobId = GenerationQueueModel.create({
    service_type: 'codex',
    request_payload: { prompt: 'make it blue', operation: 'infill', image: bigDataUrl, mask: bigDataUrl },
  } as never)
  externalizeStoredQueuePayloads()

  const stored = GenerationQueueModel.findById(jobId)!
  assert.ok(isQueueInputRef(JSON.parse(stored.request_payload).image))
  const parsed = parseCodexQueuePayload(stored)
  assert.equal(parsed.image, bigDataUrl)
  assert.equal(parsed.mask, bigDataUrl)
})

test('conditional queue updates preserve payload and cancellation when the expected status is stale', () => {
  const jobId = GenerationQueueModel.create({ service_type: 'novelai', request_payload: { prompt: 'before' } })
  getUserSettingsDb().prepare('UPDATE generation_queue_jobs SET updated_date = ? WHERE id = ?').run('2000-01-01 00:00:00', jobId)
  const queued = GenerationQueueModel.findById(jobId)!

  assert.equal(GenerationQueueModel.updateIfCurrentStatus(jobId, [], { status: 'failed' }), false)
  assert.equal(GenerationQueueModel.updateIfCurrentStatus(jobId, ['running'], { status: 'failed' }), false)
  assert.deepEqual(GenerationQueueModel.findById(jobId), queued)

  assert.equal(GenerationQueueModel.updateIfCurrentStatus(jobId, ['queued', 'dispatching'], {
    status: 'running',
    request_payload: { prompt: 'after' },
    cancel_requested: true,
    provider_job_id: undefined,
  }), true)
  const running = GenerationQueueModel.findById(jobId)!
  assert.equal(running.status, 'running')
  assert.equal(running.cancel_requested, 1)
  assert.equal(running.provider_job_id, null)
  assert.deepEqual(JSON.parse(running.request_payload), { prompt: 'after' })
  assert.notEqual(running.updated_date, queued.updated_date)

  assert.equal(GenerationQueueModel.updateIfCurrentStatus(jobId, ['queued'], {
    status: 'completed',
    request_payload: { prompt: 'stale' },
    cancel_requested: false,
  }), false)
  assert.deepEqual(GenerationQueueModel.findById(jobId), running)
})

test('large terminal payload pruning preserves shared inputs until their last job is pruned', () => {
  const sharedBuffer = Buffer.alloc(9 * 1024, 23)
  const exclusiveBuffer = Buffer.alloc(12 * 1024, 24)
  const sharedRef = storeQueueInputBuffer(sharedBuffer, { mimeType: 'image/png' })
  const exclusiveRef = storeQueueInputBuffer(exclusiveBuffer, { mimeType: 'image/png' })
  const keeperId = GenerationQueueModel.create({ service_type: 'novelai', request_payload: { image: sharedRef } })
  const jobIds = GenerationQueueModel.createMany(Array.from({ length: 1001 }, () => ({
    service_type: 'novelai' as const,
    request_payload: { image: sharedRef },
  })))
  const exclusiveId = GenerationQueueModel.create({ service_type: 'novelai', request_payload: { image: exclusiveRef } })
  assert.equal(jobIds.length, 1001)

  const db = getUserSettingsDb()
  db.prepare("UPDATE generation_queue_jobs SET status = 'completed' WHERE id BETWEEN ? AND ?").run(jobIds[0], exclusiveId)
  const first = GenerationQueueModel.pruneTerminalRequestPayloads({ retainRecentTerminalJobs: 0 })
  assert.equal(first.pruned, 1002)
  assert.equal(first.releasedInputFiles, 1)
  assert.equal(first.releasedInputBytes, exclusiveBuffer.byteLength)
  assert.equal(resolveQueueInputFilePath(exclusiveRef), null)
  assert.equal(hydrateQueueInputDataUrls({ image: sharedRef }).image, `data:image/png;base64,${sharedBuffer.toString('base64')}`)
  assert.equal(GenerationQueueModel.findById(keeperId)!.status, 'queued')

  assert.equal(GenerationQueueModel.updateIfCurrentStatus(keeperId, ['queued'], { status: 'completed' }), true)
  const last = GenerationQueueModel.pruneTerminalRequestPayloads({ retainRecentTerminalJobs: 0 })
  assert.equal(last.pruned, 1)
  assert.equal(last.releasedInputFiles, 1)
  assert.equal(last.releasedInputBytes, sharedBuffer.byteLength)
  assert.equal(resolveQueueInputFilePath(sharedRef), null)
  const remaining = db.prepare('SELECT COUNT(*) AS count FROM generation_queue_input_refs WHERE sha256 IN (?, ?)').get(sharedRef.sha256, exclusiveRef.sha256) as { count: number }
  assert.equal(remaining.count, 0)

  const repeated = GenerationQueueModel.pruneTerminalRequestPayloads({ retainRecentTerminalJobs: 0 })
  assert.equal(repeated.pruned, 0)
  assert.equal(repeated.releasedInputFiles, 0)
})
