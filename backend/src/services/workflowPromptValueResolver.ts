import { WildcardService } from './wildcardService'

export type WorkflowPromptFieldLike = {
  id: string
  type?: string
  jsonPath?: string
  default_value?: unknown
}

const COMFY_MODEL_PATH_INPUT_KEYS = new Set([
  'ckpt_name',
  'lora_name',
  'unet_name',
  'vae_name',
  'clip_name',
  'control_net_name',
  'style_model_name',
])

/** Normalize ComfyUI model-path separators to the same form exposed by the server object-info API. */
function normalizeComfyModelPathValue(field: WorkflowPromptFieldLike, value: string, tool: 'comfyui' | 'nai') {
  if (tool !== 'comfyui' || !value.includes('/')) {
    return value
  }

  const inputKey = typeof field.jsonPath === 'string'
    ? field.jsonPath.match(/\.inputs\.([^.[\]]+)$/)?.[1] ?? null
    : null

  if (!inputKey || !COMFY_MODEL_PATH_INPUT_KEYS.has(inputKey)) {
    return value
  }

  return value.replace(/\//g, '\\')
}

/** Resolve one prompt-data object with preprocess chains first, then wildcard parsing on text-like fields. */
export function resolveWorkflowPromptValues<T extends Record<string, any>>(
  markedFields: WorkflowPromptFieldLike[],
  promptData: T,
  tool: 'comfyui' | 'nai' = 'comfyui',
): T {
  const resolvedPromptData: Record<string, any> = { ...promptData }

  for (const field of markedFields) {
    if (field.type === 'image' || field.type === 'number') {
      continue
    }

    const rawValue = resolvedPromptData[field.id] ?? field.default_value
    if (typeof rawValue !== 'string') {
      if (rawValue !== undefined) {
        resolvedPromptData[field.id] = rawValue
      }
      continue
    }

    const normalizedValue = normalizeComfyModelPathValue(field, rawValue, tool)

    if (field.type === 'select') {
      resolvedPromptData[field.id] = normalizedValue
      continue
    }

    const trimmedValue = normalizedValue.trim()
    resolvedPromptData[field.id] = trimmedValue.length > 0
      ? WildcardService.parseWildcards(normalizedValue, tool)
      : normalizedValue
  }

  return resolvedPromptData as T
}
