import type { ComfyUIService } from './comfyuiService'

export type ComfyModelSelectionFieldLike = {
  id: string
  type?: string
  jsonPath?: string
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

const COMFY_MODEL_FILE_EXTENSIONS = ['.safetensors', '.ckpt', '.pt', '.pth', '.bin', '.gguf', '.onnx']

/** Normalize one ComfyUI model option for loose matching across slash and extension variants. */
function normalizeComparableModelOption(value: string) {
  let normalized = value.trim().replace(/\//g, '\\').toLowerCase()

  for (const extension of COMFY_MODEL_FILE_EXTENSIONS) {
    if (normalized.endsWith(extension)) {
      normalized = normalized.slice(0, -extension.length)
      break
    }
  }

  return normalized
}

function parseComfyInputPath(jsonPath?: string | null) {
  if (typeof jsonPath !== 'string') {
    return null
  }

  const match = jsonPath.match(/^([^.[\]]+)\.inputs\.([^.[\]]+)$/)
  if (!match) {
    return null
  }

  return {
    nodeId: match[1],
    inputKey: match[2],
  }
}

/** Resolve select-field model values to the exact canonical option exposed by the target ComfyUI server. */
export async function reconcileComfyModelSelectionValues<T extends Record<string, any>>(
  workflowJson: string,
  markedFields: ComfyModelSelectionFieldLike[],
  promptData: T,
  comfyService: ComfyUIService,
): Promise<T> {
  const workflow = JSON.parse(workflowJson) as Record<string, { class_type?: string }>
  const nextPromptData: Record<string, any> = { ...promptData }
  const optionCache = new Map<string, string[] | null>()

  for (const field of markedFields) {
    if (field.type !== 'select') {
      continue
    }

    const rawValue = nextPromptData[field.id]
    if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
      continue
    }

    const parsedPath = parseComfyInputPath(field.jsonPath)
    if (!parsedPath || !COMFY_MODEL_PATH_INPUT_KEYS.has(parsedPath.inputKey)) {
      continue
    }

    const classType = workflow[parsedPath.nodeId]?.class_type
    if (typeof classType !== 'string' || classType.trim().length === 0) {
      continue
    }

    const cacheKey = `${classType}:${parsedPath.inputKey}`
    let options = optionCache.get(cacheKey)
    if (options === undefined) {
      options = await comfyService.getNodeInputOptions(classType, parsedPath.inputKey)
      optionCache.set(cacheKey, options)
    }

    if (!options || options.length === 0) {
      continue
    }

    const normalizedRawValue = normalizeComparableModelOption(rawValue)
    const matches = options.filter((option) => normalizeComparableModelOption(option) === normalizedRawValue)
    if (matches.length === 1) {
      nextPromptData[field.id] = matches[0]
    }
  }

  return nextPromptData as T
}
