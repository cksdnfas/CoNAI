import type { QueryClient } from '@tanstack/react-query'
import { getErrorMessage } from '../image-generation-shared'

type QueueActionSnackbar = (input: { message: string; tone: 'info' | 'error' }) => void

type GenerationQueueMutationResult = {
  message?: string | null
}

/** Refresh the shared queue surfaces after enqueueing one or more generation jobs. */
export async function refreshGenerationQueueViews(queryClient: QueryClient, onHistoryRefresh: () => void) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['image-generation-queue'] }),
    queryClient.invalidateQueries({ queryKey: ['image-generation-queue-stats'] }),
  ])

  onHistoryRefresh()
}

/** Run one queue mutation, refresh the relevant queue queries, and show a shared snackbar result. */
export async function runGenerationQueueMutation({
  execute,
  refresh,
  showSnackbar,
  successMessage,
  failureMessage,
}: {
  execute: () => Promise<GenerationQueueMutationResult>
  refresh: () => Promise<unknown>
  showSnackbar: QueueActionSnackbar
  successMessage: string
  failureMessage: string
}) {
  try {
    const result = await execute()
    await refresh()
    showSnackbar({ message: result.message || successMessage, tone: 'info' })
  } catch (error) {
    showSnackbar({ message: getErrorMessage(error, failureMessage), tone: 'error' })
  }
}
