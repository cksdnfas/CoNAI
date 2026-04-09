import { WildcardService } from './wildcardService'

export type WorkflowPromptFieldLike = {
  id: string
  type?: string
  default_value?: unknown
}

/** Resolve one prompt-data object with wildcard parsing applied to text-like marked fields. */
export function resolveWorkflowPromptValues<T extends Record<string, any>>(
  markedFields: WorkflowPromptFieldLike[],
  promptData: T,
  tool: 'comfyui' | 'nai' = 'comfyui',
): T {
  const resolvedPromptData: Record<string, any> = { ...promptData }

  for (const field of markedFields) {
    if (field.type === 'image') {
      continue
    }

    const rawValue = resolvedPromptData[field.id] ?? field.default_value
    if (typeof rawValue !== 'string') {
      if (rawValue !== undefined) {
        resolvedPromptData[field.id] = rawValue
      }
      continue
    }

    resolvedPromptData[field.id] = rawValue.includes('++')
      ? WildcardService.parseWildcards(rawValue, tool)
      : rawValue
  }

  return resolvedPromptData as T
}
