import type { QueryClient } from '@tanstack/react-query'
import type { GenerationHistoryRecord } from '@/lib/api-image-generation-types'
import { retryGenerationQueueJob } from '@/lib/api-image-generation-queue'
import { getRetryableHistoryQueueJobIds } from './generation-history-panel-helpers'
import { runGenerationQueueMutation } from './generation-queue-actions'

type HistoryRetryRefresh = (options: { watchForNewRows?: boolean }) => Promise<unknown>
type HistoryRetrySnackbar = (input: { message: string; tone: 'info' | 'error' }) => void

type RetryGenerationHistoryRecordsOptions = {
  records: readonly GenerationHistoryRecord[]
  queryClient: QueryClient
  refreshHistory: HistoryRetryRefresh
  showSnackbar: HistoryRetrySnackbar
  successMessage: string
  failureMessage: string
}

export function getUniqueRetryableHistoryQueueJobIds(records: readonly GenerationHistoryRecord[]) {
  return [...new Set(getRetryableHistoryQueueJobIds(records))]
}

/** Queue retry jobs for generation-history rows and refresh the queue/history surfaces together. */
export async function retryGenerationHistoryRecords({
  records,
  queryClient,
  refreshHistory,
  showSnackbar,
  successMessage,
  failureMessage,
}: RetryGenerationHistoryRecordsOptions) {
  const queueJobIds = getUniqueRetryableHistoryQueueJobIds(records)
  if (queueJobIds.length === 0) {
    return false
  }

  return runGenerationQueueMutation({
    execute: async () => {
      if (queueJobIds.length === 1) {
        return retryGenerationQueueJob(queueJobIds[0])
      }

      await Promise.all(queueJobIds.map((queueJobId) => retryGenerationQueueJob(queueJobId)))
      return { message: successMessage }
    },
    refresh: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['image-generation-queue'] }),
        queryClient.invalidateQueries({ queryKey: ['image-generation-queue-stats'] }),
        refreshHistory({ watchForNewRows: true }),
      ])
    },
    showSnackbar,
    successMessage,
    failureMessage,
  })
}
