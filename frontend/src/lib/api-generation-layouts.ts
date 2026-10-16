import type { GenerationLayoutPreset, GenerationLayoutSnapshot, GenerationLayoutSurface, GenerationLayoutSurfaceSnapshot } from '@conai/shared'
import { requestApiData } from './api-request'

export const GENERATION_LAYOUTS_QUERY_KEY = ['generation-layouts'] as const

export function getGenerationLayouts(signal?: AbortSignal) {
  return requestApiData<GenerationLayoutSnapshot>('/api/generation-layouts', { signal })
}

/** Admin only: replaces one surface's shared preset list the editor started from (`revision`). */
export function saveGenerationLayouts(surface: GenerationLayoutSurface, presets: GenerationLayoutPreset[], revision: string) {
  return requestApiData<GenerationLayoutSurfaceSnapshot>(`/api/generation-layouts/${surface}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'If-Match': revision },
    body: JSON.stringify({ presets }),
  })
}
