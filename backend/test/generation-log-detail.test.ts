import './support/testTemp'
import './support/scratchRuntime'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { initializeAuthDb } from '../src/database/authDb'
import { initializeDatabase } from '../src/database/init'
import { initializeUserSettingsDb } from '../src/database/userSettingsDb'
import { initializeApiGenerationDb } from '../src/database/apiGenerationDb'
import { GenerationQueueModel } from '../src/models/GenerationQueue'
import { GenerationQueueService } from '../src/services/generationQueueService'
import { HistoryCommandService } from '../src/services/historyCommandService'
import { HistoryQueryRepository } from '../src/repositories/history/HistoryQueryRepository'
import { resolveQueueFailureStage, resolveSubmitFailureStage, stampQueueFailureStage } from '../src/services/generation-queue/queueJobExecutors'

test('generation log detail: failure stage and retry attempt reach the history list', async () => {
  initializeAuthDb()
  await initializeDatabase()
  initializeUserSettingsDb()
  initializeApiGenerationDb()

  const error = new Error('node 12 (KSampler) OutOfMemoryError: CUDA out of memory')
  stampQueueFailureStage(error, { source: 'comfyui_ws', phase: 'sampling', node_id: '12', node_label: 'KSampler', value: 3, max: 30, percent: 10, updated_at: '' })
  assert.deepEqual(JSON.parse(resolveQueueFailureStage(error)!), { phase: 'sampling', node_id: '12', node_label: 'KSampler' })
  assert.deepEqual(JSON.parse(resolveSubmitFailureStage('none', 'comfyui')!), { phase: 'preparing' })
  assert.equal(resolveSubmitFailureStage('none', 'codex'), null)
  assert.deepEqual(JSON.parse(resolveSubmitFailureStage('in_flight')!), { phase: 'submitting' })

  const jobId = GenerationQueueModel.create({ service_type: 'novelai', request_payload: { prompt: 'x' } })
  GenerationQueueService.transitionJob(jobId, 'dispatching')
  GenerationQueueService.transitionJob(jobId, 'running')
  GenerationQueueService.transitionJob(jobId, 'failed', { failureMessage: error.message, failureStage: resolveQueueFailureStage(error) })
  const historyId = HistoryCommandService.create({ service_type: 'novelai', generation_status: 'failed', queue_job_id: jobId, error_message: error.message } as never)

  const retried = GenerationQueueService.retryJob(jobId)!
  assert.equal(retried.attempt_number, 2)
  assert.equal(retried.failure_stage, null)

  const row = HistoryQueryRepository.findAllWithMetadata({ limit: 10 }).find((record) => record.id === historyId)!
  assert.equal(row.queue_attempt_number, 1)
  assert.deepEqual(JSON.parse(row.queue_failure_stage!), { phase: 'sampling', node_id: '12', node_label: 'KSampler' })
  assert.ok(row.queue_started_at)
  assert.ok(row.queue_completed_at)

  // A job that failed before its executor wrote history still gets exactly one failed row.
  const earlyJobId = GenerationQueueModel.create({ service_type: 'novelai', request_payload: { prompt: 'y' } })
  GenerationQueueService.transitionJob(earlyJobId, 'failed', { failureMessage: 'no token' })
  const early = GenerationQueueModel.findListRecordById(earlyJobId)!
  const earlyHistoryId = HistoryCommandService.recordFailedQueueJobWithoutHistory(early, 'no token')
  assert.ok(earlyHistoryId)
  assert.equal(HistoryCommandService.recordFailedQueueJobWithoutHistory(early, 'no token'), null)
  const earlyRow = HistoryQueryRepository.findAllWithMetadata({ limit: 10 }).find((record) => record.id === earlyHistoryId)!
  assert.equal(earlyRow.generation_status, 'failed')
  assert.equal(earlyRow.error_message, 'no token')
  assert.equal(HistoryCommandService.recordFailedQueueJobWithoutHistory(GenerationQueueModel.findListRecordById(jobId)!, 'x'), null)
})
