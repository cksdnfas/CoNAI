import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
// The runtime base must point at a scratch folder before anything reads runtimePaths.
process.env.RUNTIME_BASE_PATH = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-test-queue-'))
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getUserSettingsDb, initializeUserSettingsDb } from '../src/database/userSettingsDb'
import { GenerationQueueModel } from '../src/models/GenerationQueue'
import { externalizeStoredQueuePayloads, isQueueInputRef, resolveQueueInputFilePath } from '../src/services/generation-queue/queueInputStore'

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
