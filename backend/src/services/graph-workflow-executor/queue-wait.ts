import { GenerationQueueModel } from '../../models/GenerationQueue'
import type { GenerationQueueJobRecord, GenerationQueueJobStatus } from '../../types/generationQueue'
import { GenerationQueueService } from '../generationQueueService'
import { isTerminalQueueStatus } from '../generation-queue/queueTerminalWaiters'
import { abortableDelay } from './execution-abort'
import { writeExecutionLog, type ExecutionContext } from './shared'

// 취소 문구의 원본은 leaf 인 execution-abort.ts 다. 계약 스크립트와 기존 호출부가 쓰는 import 경로는 그대로 둔다.
export { GRAPH_EXECUTION_CANCELLED_MESSAGE } from './execution-abort'
import { GRAPH_EXECUTION_CANCELLED_MESSAGE } from './execution-abort'

const QUEUE_POLL_INTERVAL_MS = 1500
const QUEUE_TERMINAL_WAIT_TIMEOUT_MS = 15000

export function isGraphQueueTerminalStatus(status: GenerationQueueJobStatus) {
  return isTerminalQueueStatus(status)
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
    if (params.context.signal.aborted || params.context.shouldCancel?.()) {
      // 버려지는 terminal waiter 가 나중에 reject 해도 unhandled 로 남지 않게 먼저 흡수한다.
      void terminalWait?.catch(() => undefined)
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
      // abort 시 폴링 간격을 기다리지 않고 즉시 깨어나 상단의 취소 분기로 돌아간다.
      abortableDelay(QUEUE_POLL_INTERVAL_MS, params.context.signal).then(() => undefined),
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
