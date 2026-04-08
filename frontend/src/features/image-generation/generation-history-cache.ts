import type { QueryClient } from '@tanstack/react-query'
import { getGenerationHistory } from '@/lib/api-image-generation'
import type { GenerationHistoryRecord, GenerationServiceType } from '@/lib/api-image-generation'

type GenerationHistoryQueryData = Awaited<ReturnType<typeof getGenerationHistory>>

/** Merge optimistic generation-history records with an already-loaded history snapshot. */
function mergeGenerationHistoryRecords(
  current: GenerationHistoryQueryData,
  records: GenerationHistoryRecord[],
): GenerationHistoryQueryData {
  const existingRecords = current.records ?? []
  const seenIds = new Set<number>()
  const mergedRecords = [...records, ...existingRecords].filter((record) => {
    if (seenIds.has(record.id)) {
      return false
    }
    seenIds.add(record.id)
    return true
  })

  return {
    ...current,
    success: true,
    records: mergedRecords,
    total: Math.max(current.total ?? 0, existingRecords.length) + records.filter((record) => !existingRecords.some((existing) => existing.id === record.id)).length,
  }
}

/** Prepend optimistic history records without replacing unloaded history caches. */
export function prependGenerationHistoryRecords(
  queryClient: QueryClient,
  serviceType: GenerationServiceType,
  records: GenerationHistoryRecord[],
  workflowId?: number | null,
) {
  const queryKey = ['image-generation-history', serviceType, workflowId ?? null] as const
  const current = queryClient.getQueryData<GenerationHistoryQueryData>(queryKey)

  if (current) {
    queryClient.setQueryData<GenerationHistoryQueryData>(queryKey, mergeGenerationHistoryRecords(current, records))
  }

  void queryClient.invalidateQueries({ queryKey, refetchType: 'active' })
}
