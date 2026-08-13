import type { QueryClient } from '@tanstack/react-query'
import type { GenerationHistoryRecord } from '@/lib/api-image-generation-types'
import { retryGenerationQueueJob } from '@/lib/api-image-generation-queue'
import { getErrorMessage } from '../image-generation-shared'
import { getRetryableHistoryQueueJobIds } from './generation-history-panel-helpers'

const GENERATION_HISTORY_MUTATION_CONCURRENCY = 4

type HistoryRetryRefresh = (options: { watchForNewRows?: boolean }) => Promise<unknown>
type HistoryRetrySnackbar = (input: { message: string; tone: 'info' | 'error' }) => void

type RetryGenerationHistoryRecordsOptions = {
  records: readonly GenerationHistoryRecord[]
  queryClient: QueryClient
  refreshHistory: HistoryRetryRefresh
  showSnackbar: HistoryRetrySnackbar
  successMessage: string
  failureMessage: string
  partialFailureMessage: (successCount: number, failureCount: number) => string
}

export type GenerationHistoryMutationBatchResult<T> = {
  successfulItems: T[]
  failedItems: Array<{ item: T; error: unknown }>
}

/** Run independent history mutations with a small concurrency ceiling and retain every outcome. */
export async function runGenerationHistoryMutationBatch<T>(
  items: readonly T[],
  mutate: (item: T) => Promise<unknown>,
): Promise<GenerationHistoryMutationBatchResult<T>> {
  const successfulItems: T[] = []
  const failedItems: Array<{ item: T; error: unknown }> = []
  let nextIndex = 0

  const worker = async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex]
      nextIndex += 1
      try {
        await mutate(item)
        successfulItems.push(item)
      } catch (error) {
        failedItems.push({ item, error })
      }
    }
  }

  const workerCount = Math.min(items.length, GENERATION_HISTORY_MUTATION_CONCURRENCY)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return { successfulItems, failedItems }
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
  partialFailureMessage,
}: RetryGenerationHistoryRecordsOptions) {
  const queueJobIds = getUniqueRetryableHistoryQueueJobIds(records)
  if (queueJobIds.length === 0) {
    return { successfulItems: [], failedItems: [] } satisfies GenerationHistoryMutationBatchResult<number>
  }

  const result = await runGenerationHistoryMutationBatch(queueJobIds, retryGenerationQueueJob)

  try {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['image-generation-queue'] }),
      queryClient.invalidateQueries({ queryKey: ['image-generation-queue-stats'] }),
      refreshHistory({ watchForNewRows: true }),
    ])
  } catch (error) {
    showSnackbar({ message: getErrorMessage(error, failureMessage), tone: 'error' })
    return result
  }

  if (result.failedItems.length === 0) {
    showSnackbar({ message: successMessage, tone: 'info' })
  } else if (result.successfulItems.length > 0) {
    showSnackbar({
      message: partialFailureMessage(result.successfulItems.length, result.failedItems.length),
      tone: 'error',
    })
  } else {
    showSnackbar({ message: getErrorMessage(result.failedItems[0]?.error, failureMessage), tone: 'error' })
  }

  return result
}
