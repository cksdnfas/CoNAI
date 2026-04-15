import { WildcardService } from './wildcardService'

export type WorkflowPromptFieldLike = {
  id: string
  type?: string
  default_value?: unknown
}

/** Resolve one prompt-data object with preprocess chains first, then wildcard parsing on text-like fields. */
export function resolveWorkflowPromptValues<T extends Record<string, any>>(
  markedFields: WorkflowPromptFieldLike[],
  promptData: T,
  tool: 'comfyui' | 'nai' = 'comfyui',
): T {
  const resolvedPromptData: Record<string, any> = { ...promptData }

  for (const field of markedFields) {
    if (field.type === 'image' || field.type === 'number' || field.type === 'select') {
      continue
    }

    const rawValue = resolvedPromptData[field.id] ?? field.default_value
    if (typeof rawValue !== 'string') {
      if (rawValue !== undefined) {
        resolvedPromptData[field.id] = rawValue
      }
      continue
    }

    const trimmedValue = rawValue.trim()
    resolvedPromptData[field.id] = trimmedValue.length > 0
      ? WildcardService.parseWildcards(rawValue, tool)
      : rawValue
  }

  return resolvedPromptData as T
}
