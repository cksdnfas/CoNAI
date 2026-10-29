import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

test('metadata re-extraction starts once, backpressures, cancels and reports final outcomes', { timeout: 60_000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-metadata-job-'))
  process.env.RUNTIME_BASE_PATH = root
  for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
    process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
  }
  const main = await import('../src/database/init')
  await main.initializeDatabase()
  const user = await import('../src/database/userSettingsDb')
  user.initializeUserSettingsDb()
  const { registerMetadataReextractJobHandler } = await import('../src/services/runtimeJobs/handlers/metadataReextractHandler')
  registerMetadataReextractJobHandler()
  const { BackgroundQueueService } = await import('../src/services/backgroundQueue')
  const { mediaSettingsRoutes } = await import('../src/routes/settings/media-settings.routes')
  const { runtimeJobRoutes } = await import('../src/routes/runtime-jobs.routes')
  const express = (await import('express')).default
  const app = express()
  app.use('/api/settings', mediaSettingsRoutes)
  app.use('/api/jobs', runtimeJobRoutes)
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  let release!: () => void
  let gate = new Promise<void>((resolve) => { release = resolve })
  t.after(async () => {
    release()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    user.closeUserSettingsDb()
    main.closeDatabase()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
  })

  const folder = (main.db.prepare('SELECT id FROM watched_folders LIMIT 1').get() as { id: number }).id
  const insertMetadata = main.db.prepare('INSERT INTO media_metadata (composite_hash) VALUES (?)')
  const insertFile = main.db.prepare(`INSERT INTO image_files
    (composite_hash, file_type, original_file_path, folder_id, file_status, file_size, mime_type, scan_date, last_verified_date)
    VALUES (?, 'image', ?, ?, 'active', 1, 'image/png', ?, ?)`)
  const hash = (n: number) => n.toString(16).padStart(48, '0')
  const candidatePath = (name: string) => path.join(root, 'candidates', `${name}.png`)
  main.db.transaction(() => {
    for (let index = 0; index < 10_000; index++) {
      insertMetadata.run(hash(index))
      insertFile.run(hash(index), candidatePath(String(index)), folder, '2026-01-01', '2026-01-01')
    }
  })()

  const originalAccess = fs.promises.access.bind(fs.promises)
  t.mock.method(fs.promises, 'access', async (filePath, mode) => {
    if (String(filePath).startsWith(path.join(root, 'candidates'))) {
      if (String(filePath).endsWith(`${path.sep}missing.png`)) throw new Error('missing')
      return
    }
    await originalAccess(filePath, mode)
  })
  let firstStarted!: () => void
  let started = new Promise<void>((resolve) => { firstStarted = resolve })
  let blocked = true
  let producePrompts = false
  const attempts = new Map<string, number>()
  const processedOrder: string[] = []
  t.mock.method(BackgroundQueueService, 'extractAndPersistMetadata', async (filePath, compositeHash) => {
    if (blocked) {
      firstStarted()
      await gate
      return true
    }
    const name = path.basename(filePath)
    processedOrder.push(name)
    const count = (attempts.get(name) ?? 0) + 1
    attempts.set(name, count)
    if (name === 'retry.png' && count === 1) throw new Error('retryable test failure')
    if (producePrompts) BackgroundQueueService.addPromptCollectionTask(filePath, compositeHash)
    return name !== 'failed.png'
  })
  const waitFor = async (predicate: () => boolean) => {
    const deadline = Date.now() + 15_000
    while (!predicate()) {
      assert.ok(Date.now() < deadline, 'job did not settle')
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
  const start = async () => {
    const response = await fetch(`${origin}/api/settings/metadata/reextract-all`, { method: 'POST' })
    assert.equal(response.status, 202)
    return (await response.json() as { data: { jobId: string } }).data
  }
  const getJob = async (id: string) => (await (await fetch(`${origin}/api/jobs/${id}`)).json() as {
    data: { status: string; progress: { total: number; processed: number; succeeded: number; failed: number; skipped: number }; result: any }
  }).data

  const { SystemMaintenanceLockService } = await import('../src/services/systemMaintenanceLockService')
  const maintenanceLock = SystemMaintenanceLockService.acquireExclusive({ owner: 'metadata-test', reason: 'test', message: 'test' })
  t.after(() => maintenanceLock.release())
  const first = await start()
  assert.equal((await start()).jobId, first.jobId, 'simultaneous starts return the live singleton')
  await waitFor(() => BackgroundQueueService.getQueueStatus().queueLength > 0)
  const waitingStatus = BackgroundQueueService.getQueueStatus()
  const waitingJob = await getJob(first.jobId)
  assert.equal(waitingJob.progress.total, waitingStatus.queueLength, 'queued counts are flushed while the maintenance lock blocks processing')
  assert.equal(waitingJob.progress.processed, 0)
  maintenanceLock.release()
  await started
  const status = BackgroundQueueService.getQueueStatus()
  assert.ok(status.queueLength + status.activeCount <= 100, '10,000 candidates do not become 10,000 queued tasks')
  assert.ok(status.queueLength + status.activeCount > 0)
  const cancel = await fetch(`${origin}/api/jobs/${first.jobId}/cancel`, { method: 'POST' })
  assert.equal(cancel.status, 202)
  let cancelled = await getJob(first.jobId)
  while (cancelled.status === 'queued' || cancelled.status === 'running') {
    await new Promise((resolve) => setTimeout(resolve, 20))
    cancelled = await getJob(first.jobId)
  }
  assert.equal(cancelled.status, 'cancelled')
  release()
  await waitFor(() => BackgroundQueueService.getQueueStatus().queueLength === 0 && !BackgroundQueueService.getQueueStatus().processing)

  gate = new Promise<void>((resolve) => { release = resolve })
  started = new Promise<void>((resolve) => { firstStarted = resolve })
  const remote = await start()
  await started
  const { RuntimeJobStore } = await import('../src/services/runtimeJobs/runtimeJobStore')
  RuntimeJobStore.requestCancel(remote.jobId)
  let remotelyCancelled = await getJob(remote.jobId)
  while (remotelyCancelled.status === 'queued' || remotelyCancelled.status === 'running') {
    await new Promise((resolve) => setTimeout(resolve, 20))
    remotelyCancelled = await getJob(remote.jobId)
  }
  assert.equal(remotelyCancelled.status, 'cancelled', 'a cancel request from another process is observed while work is blocked')
  release()
  await waitFor(() => BackgroundQueueService.getQueueStatus().queueLength === 0 && !BackgroundQueueService.getQueueStatus().processing)
  blocked = false

  main.db.exec('DELETE FROM image_files; DELETE FROM media_metadata')
  const names = ['ok', 'retry', 'missing', 'failed']
  names.forEach((name, index) => {
    insertMetadata.run(hash(index + 20_000))
    insertFile.run(hash(index + 20_000), candidatePath(name), folder, index === 3 ? null : `2026-01-0${4 - index}`, '2026-01-02')
  })
  insertFile.run(hash(20_000), candidatePath('old-duplicate'), folder, '2026-01-05', '2026-01-01')
  const next = await start()
  let completed = await getJob(next.jobId)
  while (completed.status === 'queued' || completed.status === 'running') {
    await new Promise((resolve) => setTimeout(resolve, 20))
    completed = await getJob(next.jobId)
  }
  assert.equal(completed.status, 'completed')
  assert.deepEqual(completed.result, {
    queuedCount: 3, skippedMissingCount: 1, totalCandidates: 4, processedCount: 3, failedCount: 1,
  })
  assert.deepEqual(completed.progress, { ...completed.progress, total: 4, processed: 4, succeeded: 2, failed: 1, skipped: 1 })
  assert.equal(attempts.get('retry.png'), 2, 'retryable queue failures retain their retry policy')
  assert.equal(attempts.has('old-duplicate.png'), false, 'the best active file is selected once per hash')
  assert.deepEqual(processedOrder, ['ok.png', 'retry.png', 'retry.png', 'failed.png'], 'newest-first candidates run before the undated page')

  await waitFor(() => BackgroundQueueService.getQueueStatus().queueLength === 0 && !BackgroundQueueService.getQueueStatus().processing)
  main.db.exec('DELETE FROM image_files; DELETE FROM media_metadata')
  main.db.transaction(() => {
    for (let index = 0; index < 120; index++) {
      insertMetadata.run(hash(index + 30_000))
      insertFile.run(hash(index + 30_000), candidatePath(`stress-${index}`), folder, '2026-01-01', '2026-01-01')
    }
  })()
  producePrompts = true
  let peakQueue = 0
  const observeQueue = () => { peakQueue = Math.max(peakQueue, BackgroundQueueService.getQueueStatus().queueLength) }
  const originalTrack = BackgroundQueueService.trackMetadataExtractionTask.bind(BackgroundQueueService)
  const originalPrompt = BackgroundQueueService.addPromptCollectionTask.bind(BackgroundQueueService)
  t.mock.method(BackgroundQueueService, 'trackMetadataExtractionTask', (filePath, compositeHash) => {
    const task = originalTrack(filePath, compositeHash)
    observeQueue()
    return task
  })
  t.mock.method(BackgroundQueueService, 'addPromptCollectionTask', (filePath, compositeHash) => {
    originalPrompt(filePath, compositeHash)
    observeQueue()
  })
  const stress = await start()
  let stressJob = await getJob(stress.jobId)
  while (stressJob.status === 'queued' || stressJob.status === 'running') {
    await new Promise((resolve) => setTimeout(resolve, 20))
    stressJob = await getJob(stress.jobId)
  }
  assert.equal(stressJob.status, 'completed')
  assert.equal(stressJob.result.processedCount, 120)
  assert.ok(peakQueue <= 100, `metadata plus generated prompt tasks stayed bounded: ${peakQueue}`)
  await waitFor(() => BackgroundQueueService.getQueueStatus().queueLength === 0 && !BackgroundQueueService.getQueueStatus().processing)
})
