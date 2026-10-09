import type { QueryClient } from '@tanstack/react-query'
import { getGraphNodeOptions, type ModuleDefinitionRecord } from '@/lib/api-module-graph'

/** The query behind every select over one option source, shared so a new node and its card read the same cache. */
export function graphNodeOptionsQuery(source: string) {
  return {
    queryKey: ['graph-node-options', source],
    queryFn: () => getGraphNodeOptions(source),
    staleTime: 30_000,
    retry: 1,
  }
}

/** Ids are stored as numbers; other fields keep the option value as text. */
export function toStoredOptionValue(raw: string, numeric: boolean): string | number {
  if (!raw || !numeric) return raw
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : raw
}

/**
 * Values a new node starts with for fields marked `initial_option` (the Codex node: the newest model the CLI lists).
 * A list that can't be fetched just leaves the field empty.
 */
export async function resolveInitialOptionValues(queryClient: QueryClient, module: ModuleDefinitionRecord) {
  const values: Record<string, string | number> = {}
  const fields = (module.ui_schema ?? []).filter((field) => field.options_source && field.initial_option)
  await Promise.all(fields.map(async (field) => {
    const options = await queryClient.fetchQuery(graphNodeOptionsQuery(field.options_source as string)).catch(() => [])
    const pickable = options.filter((option) => !option.disabled && option.value !== '')
    const picked = field.initial_option === 'default' ? (pickable.find((option) => option.is_default) ?? pickable[0]) : pickable[0]
    if (!picked) return
    const port = module.exposed_inputs.find((input) => input.key === field.key)
    values[field.key] = toStoredOptionValue(picked.value, port?.data_type === 'number' || field.data_type === 'number')
  }))
  return values
}
