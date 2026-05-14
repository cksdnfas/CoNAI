import { GenerationQueueModel } from '../../models/GenerationQueue'
import { type GenerationQueueJobRecord, type GenerationQueueJobStatus } from '../../types/generationQueue'
import { GenerationQueueService } from '../generationQueueService'
import { writeExecutionLog, type ExecutionContext } from './shared'

export const GRAPH_EXECUTION_CANCELLED_MESSAGE = '__GRAPH_EXECUTION_CANCELLED__'

const QUEUE_POLL_INTERVAL_MS = 1500
const QUEUE_TERMINAL_WAIT_TIMEOUT_MS = 15000
const TERMINAL_QUEUE_STATUSES = new Set<GenerationQueueJobStatus>(['completed', 'failed', 'cancelled'])

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function isGraphQueueTerminalStatus(status: GenerationQueueJobStatus) {
  return TERMINAL_QUEUE_STATUSES.has(status)
}

export function shouldRequestGraphQueueCancellation(record: Pick<GenerationQueueJobRecord, 'status'> | null | undefined) {
  return Boolean(record && !isGraphQueueTerminalStatus(record.status))
}

export function resolveGraphQueueTerminalJob(
  job: Pick<GenerationQueueJobRecord, 'status' | 'failure_message'> | null | undefined,
  jobId: number,
) {
  if (!job) {
    return null
  }

  if (job.status === 'completed') {
    return job
  }

  if (job.status === 'failed') {
    throw new Error(job.failure_message || `Queue job ${jobId} failed`)
  }

  if (job.status === 'cancelled') {
    throw new Error(GRAPH_EXECUTION_CANCELLED_MESSAGE)
  }

  return null
}

export async function requestGraphQueueCancellation(jobId: number) {
  const latest = GenerationQueueModel.findById(jobId)
  if (!shouldRequestGraphQueueCancellation(latest)) {
    return false
  }

  await GenerationQueueService.requestCancellation(jobId)
  return true
}

export async function waitForGraphQueueCompletion(params: {
  context: ExecutionContext
  nodeId: string
  jobId: number
  cancellationMessage: string
}) {
  let terminalWait: Promise<GenerationQueueJobRecord | null> | null = null

  while (true) {
    if (params.context.shouldCancel?.()) {
      await requestGraphQueueCancellation(params.jobId)
      writeExecutionLog({
        executionId: params.context.executionId,
        nodeId: params.nodeId,
        level: 'warn',
        eventType: 'node_queue_cancel_requested',
        message: params.cancellationMessage,
      })
      throw new Error(GRAPH_EXECUTION_CANCELLED_MESSAGE)
    }

    terminalWait ??= GenerationQueueService.waitForTerminalJob(params.jobId, { timeoutMs: QUEUE_TERMINAL_WAIT_TIMEOUT_MS })
    const job = await Promise.race([
      terminalWait,
      sleep(QUEUE_POLL_INTERVAL_MS).then(() => undefined),
    ])

    if (job === undefined) {
      continue
    }

    terminalWait = null
    const completedJob = resolveGraphQueueTerminalJob(job, params.jobId)
    if (completedJob) {
      return completedJob as GenerationQueueJobRecord
    }
  }
}
