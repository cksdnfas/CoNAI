import { WildcardService } from '../wildcardService'
import { stripPromptPresetComments } from '../../utils/promptComments'
import type { GeneratedImageSaveOptions } from '../../utils/fileSaver'
import type { AIMetadata } from '../metadata/types'
import type { NAIMetadataInputParams } from '../../utils/nai/metadata'
import type { GenerationQueueJobRecord } from '../../types/generationQueue'
import type { CodexGenerationPayload } from '../codexGenerationExecutor'

export function parseStoredRequestPayload(record: GenerationQueueJobRecord) {
  try {
    const parsed = JSON.parse(record.request_payload) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Stored request payload must be an object')
    }

    return parsed as Record<string, unknown>
  } catch (error) {
    throw new Error(`Queue job ${record.id} has invalid request_payload: ${error instanceof Error ? error.message : 'unknown parse error'}`)
  }
}

export function resolveFailureMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown queue execution error'
}

export function parseComfyQueuePayload(record: GenerationQueueJobRecord) {
  const payload = parseStoredRequestPayload(record)
  const promptData = payload.prompt_data
  if (!promptData || typeof promptData !== 'object' || Array.isArray(promptData)) {
    throw new Error(`Queue job ${record.id} is missing object request_payload.prompt_data for ComfyUI execution`)
  }

  const imageSaveOptions = payload.imageSaveOptions
  if (imageSaveOptions !== undefined && (!imageSaveOptions || typeof imageSaveOptions !== 'object' || Array.isArray(imageSaveOptions))) {
    throw new Error(`Queue job ${record.id} has invalid request_payload.imageSaveOptions`)
  }

  return {
    promptData: promptData as Record<string, any>,
    imageSaveOptions: imageSaveOptions as GeneratedImageSaveOptions | undefined,
  }
}

export function parseNaiQueuePayload(record: GenerationQueueJobRecord) {
  const payload = parseStoredRequestPayload(record)
  return payload as unknown as NAIMetadataInputParams & { imageSaveOptions?: GeneratedImageSaveOptions }
}

export function parseCodexWildcardText(value: unknown) {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }

  return stripPromptPresetComments(WildcardService.parseWildcards(trimmed, 'codex'))
}

export function parseCodexQueuePayload(record: GenerationQueueJobRecord) {
  const payload = parseStoredRequestPayload(record)
  const prompt = parseCodexWildcardText(payload.prompt)
  if (!prompt) {
    throw new Error(`Queue job ${record.id} is missing string request_payload.prompt for Codex execution`)
  }

  const imageSaveOptions = payload.imageSaveOptions
  if (imageSaveOptions !== undefined && (!imageSaveOptions || typeof imageSaveOptions !== 'object' || Array.isArray(imageSaveOptions))) {
    throw new Error(`Queue job ${record.id} has invalid request_payload.imageSaveOptions`)
  }

  const rawCountSource = payload.count ?? payload.n
  const rawCount = typeof rawCountSource === 'number' ? rawCountSource : Number(rawCountSource)
  const count = Number.isInteger(rawCount) ? Math.max(1, Math.min(rawCount, 4)) : 1
  const operation: CodexGenerationPayload['operation'] = payload.operation === 'edit' || payload.operation === 'infill' ? payload.operation : 'generate'
  const background: CodexGenerationPayload['background'] = payload.background === 'transparent' || payload.background === 'opaque' ? payload.background : 'auto'
  const outputFormat: CodexGenerationPayload['output_format'] = payload.output_format === 'jpeg' || payload.output_format === 'webp' ? payload.output_format : 'png'

  return {
    prompt,
    model: typeof payload.model === 'string' && payload.model.trim().length > 0 ? payload.model.trim() : undefined,
    negative_prompt: parseCodexWildcardText(payload.negative_prompt),
    size: typeof payload.size === 'string' && payload.size.trim().length > 0 ? payload.size.trim() : undefined,
    quality: typeof payload.quality === 'string' && payload.quality.trim().length > 0 ? payload.quality.trim() : undefined,
    background,
    output_format: outputFormat,
    count,
    operation,
    image: typeof payload.image === 'string' && payload.image.trim().length > 0 ? payload.image : undefined,
    mask: typeof payload.mask === 'string' && payload.mask.trim().length > 0 ? payload.mask : undefined,
    imageSaveOptions: imageSaveOptions as GeneratedImageSaveOptions | undefined,
  }
}

export function buildCodexMetadataPatch(payload: CodexGenerationPayload, outputIndex: number, totalCount: number, lastMessage: string | null): Partial<AIMetadata> {
  const sizeMatch = typeof payload.size === 'string' ? /^(\d{2,5})x(\d{2,5})$/i.exec(payload.size.trim()) : null
  const width = sizeMatch ? Number(sizeMatch[1]) : undefined
  const height = sizeMatch ? Number(sizeMatch[2]) : undefined

  return {
    ai_tool: 'codex',
    software: 'Codex CLI',
    model: payload.model || 'codex',
    prompt: payload.prompt,
    positive_prompt: payload.prompt,
    negative_prompt: payload.negative_prompt,
    width,
    height,
    batch_size: totalCount,
    batch_index: outputIndex,
    codex_operation: payload.operation ?? 'generate',
    codex_quality: payload.quality,
    codex_background: payload.background,
    codex_output_format: payload.output_format,
    codex_last_message: lastMessage ?? undefined,
  }
}
