import type { QueryClient } from '@tanstack/react-query'
import { getGenerationHistory } from '@/lib/api-image-generation'
import type { GenerationHistoryRecord, GenerationServiceType } from '@/lib/api-image-generation'

type GenerationHistoryQueryData = Awaited<ReturnType<typeof getGenerationHistory>>

/** Prepend optimistic history records into one visible generation-history query cache. */
export function prependGenerationHistoryRecords(
  queryClient: QueryClient,
  serviceType: GenerationServiceType,
  records: GenerationHistoryRecord[],
  workflowId?: number | null,
) {
  const queryKey = ['image-generation-history', serviceType, workflowId ?? null] as const

  queryClient.setQueryData<GenerationHistoryQueryData | undefined>(queryKey, (current) => {
    const existingRecords = current?.records ?? []
    const seenIds = new Set<number>()
    const mergedRecords = [...records, ...existingRecords].filter((record) => {
      if (seenIds.has(record.id)) {
        return false
      }
      seenIds.add(record.id)
      return true
    })

    return {
      success: true,
      records: mergedRecords,
      total: Math.max(current?.total ?? 0, existingRecords.length) + records.filter((record) => !existingRecords.some((existing) => existing.id === record.id)).length,
    }
  })
}
