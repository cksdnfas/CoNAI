import fs from 'fs'
import os from 'os'
import path from 'path'
import type { GenerationQueueJobRecord, GenerationQueueJobStatus } from '../types/generationQueue'

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

async function waitFor(predicate: () => boolean, timeoutMs: number, stepMs = 10) {
  const startedAt = Date.now()
  while (Date.now() - startedAt <= timeoutMs) {
    if (predicate()) {
      return
    }
    await sleep(stepMs)
  }

  throw new Error(`Condition was not satisfied within ${timeoutMs}ms`)
}

async function removeDirectoryWithRetries(directoryPath: string, attempts = 10) {
  let lastError: unknown = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      fs.rmSync(directoryPath, { recursive: true, force: true })
      return
    } catch (error) {
      lastError = error
      await sleep(100 * (attempt + 1))
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError)
  console.warn(`⚠️ Failed to remove queue wake-up smoke temp directory ${directoryPath}: ${message}`)
}

function requireReleaseHandle(handle: (() => void) | null, label: string) {
  if (typeof handle !== 'function') {
    throw new Error(`Missing release handle for ${label}`)
  }

  return handle
}

function assertQueueJobStatus(job: GenerationQueueJobRecord | null, expectedStatus: GenerationQueueJobStatus, label: string) {
  if (!job) {
    throw new Error(`Missing ${label}`)
  }

  if (job.status !== expectedStatus) {
    throw new Error(`Expected ${label} to be ${expectedStatus}, got ${job.status}`)
  }

  return job
}

function assertRestartFailure(job: GenerationQueueJobRecord | null, label: string) {
  const failedJob = assertQueueJobStatus(job, 'failed', label)
  if (failedJob.failure_code !== 'process_restarted') {
    throw new Error(`Expected ${label} to use process_restarted failure code, got ${failedJob.failure_code}`)
  }
  if (!failedJob.completed_at) {
    throw new Error(`Expected ${label} to have a completion timestamp after recovery`)
  }
}

async function main() {
  const tempBasePath = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-queue-wakeup-smoke-'))
  process.env.RUNTIME_BASE_PATH = tempBasePath

  let closeUserSettingsDb: (() => void) | null = null
  let closeMainDatabase: (() => void) | null = null
  let restoreRunClaimedJob: (() => void) | null = null

  try {
    const { ensureRuntimeDirectories } = await import('../config/runtimePaths')
    const userSettings = await import('../database/userSettingsDb')
    const mainDatabase = await import('../database/init')
    const { GenerationQueueModel } = await import('../models/GenerationQueue')
    const { GenerationQueueService } = await import('../services/generationQueueService')
    const { settingsService } = await import('../services/settingsService')

    closeUserSettingsDb = userSettings.closeUserSettingsDb
    closeMainDatabase = mainDatabase.closeDatabase

    ensureRuntimeDirectories()
    userSettings.initializeUserSettingsDb()
    settingsService.updateGenerationThrottleSettings({
      novelai: {
        maxConcurrentJobs: 1,
        cooldownAfterCompletions: 1000,
        cooldownSeconds: 0,
      },
    })

    const serviceInternals = GenerationQueueService as any
    const originalRunClaimedJob = serviceInternals.runClaimedJob

    const startedJobs: number[] = []
    const startedAtByJobId = new Map<number, number>()
    let releaseCurrentJob: (() => void) | null = null

    serviceInternals.runClaimedJob = async (job: { id: number }) => {
      startedJobs.push(job.id)
      startedAtByJobId.set(job.id, Date.now())

      await new Promise<void>((resolve) => {
        releaseCurrentJob = () => {
          GenerationQueueService.transitionJob(job.id, 'completed', {
            allowRecovery: true,
            expectedCurrentStatuses: ['dispatching', 'running'],
          })
          resolve()
        }
      })
    }

    restoreRunClaimedJob = () => {
      serviceInternals.runClaimedJob = originalRunClaimedJob
    }

    const firstJobId = GenerationQueueModel.create({
      service_type: 'novelai',
      request_payload: { prompt: 'wake-up smoke job 1' },
      request_summary: 'wake-up smoke job 1',
    })

    const secondJobId = GenerationQueueModel.create({
      service_type: 'novelai',
      request_payload: { prompt: 'wake-up smoke job 2' },
      request_summary: 'wake-up smoke job 2',
    })

    const cancelledQueuedJobId = GenerationQueueModel.create({
      service_type: 'novelai',
      status: 'queued',
      cancel_requested: true,
      request_payload: { prompt: 'cancelled before dispatch' },
      request_summary: 'cancelled before dispatch',
    })

    const interruptedDispatchingJobId = GenerationQueueModel.create({
      service_type: 'novelai',
      status: 'dispatching',
      started_at: new Date().toISOString(),
      request_payload: { prompt: 'interrupted dispatching job' },
      request_summary: 'interrupted dispatching job',
    })

    const interruptedRunningJobId = GenerationQueueModel.create({
      service_type: 'novelai',
      status: 'running',
      started_at: new Date().toISOString(),
      request_payload: { prompt: 'interrupted running job' },
      request_summary: 'interrupted running job',
    })

    GenerationQueueService.start()

    const cancelledQueuedJob = assertQueueJobStatus(
      GenerationQueueModel.findById(cancelledQueuedJobId),
      'cancelled',
      'queued cancellation recovery job',
    )
    if (!cancelledQueuedJob.completed_at) {
      throw new Error('Expected queued cancellation recovery job to have a completion timestamp')
    }
    assertRestartFailure(GenerationQueueModel.findById(interruptedDispatchingJobId), 'interrupted dispatching recovery job')
    assertRestartFailure(GenerationQueueModel.findById(interruptedRunningJobId), 'interrupted running recovery job')

    await waitFor(() => startedJobs.length === 1, 500)
    if (startedJobs[0] !== firstJobId) {
      throw new Error(`Expected first started job to be ${firstJobId}, got ${startedJobs[0]}`)
    }

    for (let index = 0; index < 12; index += 1) {
      GenerationQueueService.requestDispatch()
    }

    await sleep(50)
    if (startedJobs.length > 1) {
      throw new Error(`Expected only one active worker start during burst wake-ups, got ${startedJobs.length}`)
    }

    const releaseFirstJob = requireReleaseHandle(releaseCurrentJob, 'the first claimed job')

    const firstReleaseAt = Date.now()
    releaseFirstJob()

    await waitFor(() => startedJobs.length === 2, 500)
    if (startedJobs[1] !== secondJobId) {
      throw new Error(`Expected second started job to be ${secondJobId}, got ${startedJobs[1]}`)
    }

    const secondStartedAt = startedAtByJobId.get(secondJobId)
    if (!secondStartedAt) {
      throw new Error('Missing wake-up timestamp for second job')
    }

    const wakeDelayMs = secondStartedAt - firstReleaseAt
    if (wakeDelayMs > 500) {
      throw new Error(`Expected immediate post-release wake-up, but second job started after ${wakeDelayMs}ms`)
    }

    for (let index = 0; index < 12; index += 1) {
      GenerationQueueService.requestDispatch()
    }

    await sleep(50)
    if (startedJobs.length > 2) {
      throw new Error(`Expected no duplicate worker start while second job was active, got ${startedJobs.length}`)
    }

    const releaseSecondJob = requireReleaseHandle(releaseCurrentJob, 'the second claimed job')

    releaseSecondJob()
    await sleep(50)

    const counts = GenerationQueueModel.getStatusCounts()
    if (counts.completed !== 2 || counts.cancelled !== 1 || counts.failed !== 2 || counts.queued !== 0 || counts.dispatching !== 0 || counts.running !== 0) {
      throw new Error(`Expected smoke recovery and completion counts, got ${JSON.stringify(counts)}`)
    }

    GenerationQueueService.stop()
    console.log(`✅ Queue wake-up smoke passed (restart recovery, no duplicate worker start, post-release wake-up ${wakeDelayMs}ms)`)
  } finally {
    try {
      restoreRunClaimedJob?.()
    } catch {
      // Ignore restore issues in cleanup.
    }

    try {
      const { GenerationQueueService } = await import('../services/generationQueueService')
      GenerationQueueService.stop()
    } catch {
      // Ignore cleanup issues from partially initialized runs.
    }

    try {
      closeUserSettingsDb?.()
    } catch {
      // Ignore cleanup issues from partially initialized runs.
    }

    try {
      closeMainDatabase?.()
    } catch {
      // Ignore cleanup issues from partially initialized runs.
    }

    await removeDirectoryWithRetries(tempBasePath)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
