
export const DEFAULT_CIVITAI_MODEL_LIMIT = 100
export const DEFAULT_CIVITAI_MODEL_OFFSET = 0

export interface CivitaiModelPagination {
  limit: number
  offset: number
}

export interface CivitaiRescanProgressState {
  isRunning: boolean
  total: number
  processed: number
  added: number
  startedAt: string | null
}

export interface CivitaiRescanProgressResponse extends CivitaiRescanProgressState {
  percentage: number
}

export interface CivitaiRescanModelReference {
  model_hash: string
  model_role: any
  weight?: number
}

/** Preserve the Civitai route's legacy parseInt-or-fallback query semantics. */
export function parseCivitaiRouteInteger(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''))
  return parsed || fallback
}

export function resolveCivitaiModelPagination(query: { limit?: unknown; offset?: unknown }): CivitaiModelPagination {
  return {
    limit: parseCivitaiRouteInteger(query.limit, DEFAULT_CIVITAI_MODEL_LIMIT),
    offset: parseCivitaiRouteInteger(query.offset, DEFAULT_CIVITAI_MODEL_OFFSET),
  }
}

export function buildCivitaiRescanProgressResponse(
  progress: CivitaiRescanProgressState,
): CivitaiRescanProgressResponse {
  return {
    ...progress,
    percentage: progress.total > 0
      ? Math.round((progress.processed / progress.total) * 100)
      : 0,
  }
}

/** Preserve the current rescan loop: iterate parsed values and keep raw role/weight values. */
export function collectCivitaiRescanModelReferences(modelRefs: unknown): CivitaiRescanModelReference[] {
  const references: CivitaiRescanModelReference[] = []

  for (const ref of modelRefs as Array<{ hash?: string; type?: any; weight?: number }>) {
    if (!ref.hash) continue

    references.push({
      model_hash: ref.hash,
      model_role: ref.type,
      weight: ref.weight,
    })
  }

  return references
}
