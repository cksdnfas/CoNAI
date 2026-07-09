import { GenerationQueueModel } from '../../models/GenerationQueue'
import type { GenerationQueueJobRecord, GenerationQueueJobStatus } from '../../types/generationQueue'

const TERMINAL_QUEUE_STATUSES = new Set<GenerationQueueJobStatus>(['completed', 'failed', 'cancelled'])

type TerminalJobWaiter = {
  resolve: (record: GenerationQueueJobRecord | null) => void
  timeoutHandle: ReturnType<typeof setTimeout> | null
}

export function isTerminalQueueStatus(status: GenerationQueueJobStatus) {
  return TERMINAL_QUEUE_STATUSES.has(status)
}

export class QueueTerminalJobWaiters {
  private waiters = new Map<number, Set<TerminalJobWaiter>>()

  /** Wait for a queue job to reach a terminal state without per-consumer DB polling. */
  waitFor(id: number, options?: { timeoutMs?: number }) {
    const current = GenerationQueueModel.findById(id)
    if (!current || isTerminalQueueStatus(current.status)) {
      return Promise.resolve(current)
    }

    return new Promise<GenerationQueueJobRecord | null>((resolve) => {
      const waiter: TerminalJobWaiter = {
        resolve,
        timeoutHandle: null,
      }
      const waiters = this.waiters.get(id) ?? new Set<TerminalJobWaiter>()
      waiters.add(waiter)
      this.waiters.set(id, waiters)

      const timeoutMs = options?.timeoutMs
      if (timeoutMs && timeoutMs > 0) {
        waiter.timeoutHandle = setTimeout(() => {
          waiters.delete(waiter)
          if (waiters.size === 0) {
            this.waiters.delete(id)
          }

          const latest = GenerationQueueModel.findById(id)
          resolve(latest && isTerminalQueueStatus(latest.status) ? latest : null)
        }, timeoutMs)
      }
    })
  }

  resolve(record: GenerationQueueJobRecord | null) {
    if (record === null) {
      this.resolveAllAsNull()
      return
    }

    if (!isTerminalQueueStatus(record.status)) {
      return
    }

    const waiters = this.waiters.get(record.id)
    if (!waiters) {
      return
    }

    this.waiters.delete(record.id)
    this.resolveWaiters(waiters, record)
  }

  private resolveAllAsNull() {
    for (const waiters of this.waiters.values()) {
      this.resolveWaiters(waiters, null)
    }
    this.waiters.clear()
  }

  private resolveWaiters(waiters: Set<TerminalJobWaiter>, record: GenerationQueueJobRecord | null) {
    for (const waiter of waiters) {
      if (waiter.timeoutHandle) {
        clearTimeout(waiter.timeoutHandle)
      }
      waiter.resolve(record)
    }
  }
}
