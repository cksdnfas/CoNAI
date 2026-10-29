/** Shared lifecycle only: storage can cancel a fold without importing the model/context engine. */
export const summaryRuns = new Map<number, { controller: AbortController; finished: Promise<string | null> }>()

export function cancelThreadSummary(threadId: number) {
  summaryRuns.get(threadId)?.controller.abort()
}
