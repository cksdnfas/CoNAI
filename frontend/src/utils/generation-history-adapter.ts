import type { GenerationHistoryRecord } from '@conai/shared'
import type { ImageRecord } from '@/types/image'
import { buildUploadsUrl } from '@/utils/backend'

export interface GenerationHistoryRecordWithMetadata extends GenerationHistoryRecord {
  actual_composite_hash?: string | null
  actual_width?: number | null
  actual_height?: number | null
  actual_auto_tags?: string | null
}

export const convertHistoryToImageRecord = (history: GenerationHistoryRecordWithMetadata): ImageRecord => {
  const isComfyUI = history.service_type === 'comfyui'

  let parsedMetadata: Record<string, unknown> = {}
  try {
    if (history.metadata && typeof history.metadata === 'string') {
      parsedMetadata = JSON.parse(history.metadata) as Record<string, unknown>
    }
  } catch (parseError) {
    console.warn('Failed to parse history metadata:', parseError)
  }

  const steps = isComfyUI ? (parsedMetadata.steps as number | null | undefined) : history.nai_steps
  const cfgScale = isComfyUI ? (parsedMetadata.cfg_scale as number | null | undefined) : history.nai_scale
  const sampler = isComfyUI ? (parsedMetadata.sampler as string | null | undefined) : history.nai_sampler
  const seed = isComfyUI ? (parsedMetadata.seed as number | null | undefined) : history.nai_seed ? Number(history.nai_seed) : null
  const scheduler = isComfyUI ? (parsedMetadata.scheduler as string | null | undefined) : null
  const modelName = isComfyUI ? (parsedMetadata.model as string | null | undefined) : history.nai_model
  const compositeHash = history.actual_composite_hash ?? null
  const hasMetadata = Boolean(compositeHash)

  const detectFileTypeAndMimeType = (
    filePath: string | null | undefined,
  ): { file_type: 'image' | 'video' | 'animated'; mime_type: string } => {
    if (!filePath) return { file_type: 'image', mime_type: 'image/png' }

    const ext = filePath.toLowerCase().split('.').pop() || ''

    if (ext === 'gif') return { file_type: 'animated', mime_type: 'image/gif' }
    if (ext === 'apng') return { file_type: 'animated', mime_type: 'image/apng' }

    if (['mp4', 'webm', 'mov', 'avi'].includes(ext)) {
      const mimeTypes: Record<string, string> = {
        mp4: 'video/mp4',
        webm: 'video/webm',
        mov: 'video/quicktime',
        avi: 'video/x-msvideo',
      }
      return { file_type: 'video', mime_type: mimeTypes[ext] || 'video/mp4' }
    }

    const imageMimeTypes: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      bmp: 'image/bmp',
      tiff: 'image/tiff',
      tif: 'image/tiff',
    }

    return { file_type: 'image', mime_type: imageMimeTypes[ext] || 'image/png' }
  }

  const { file_type, mime_type } = detectFileTypeAndMimeType(history.original_path)

  let parsedAutoTags: unknown = null
  if (history.actual_auto_tags) {
    try {
      parsedAutoTags =
        typeof history.actual_auto_tags === 'string' ? JSON.parse(history.actual_auto_tags) : history.actual_auto_tags
    } catch (parseError) {
      console.warn('Failed to parse auto_tags:', parseError)
    }
  }

  return {
    composite_hash: compositeHash,
    first_seen_date: history.created_at ?? null,

    file_id: null,
    file_type,
    original_file_path: history.original_path ?? null,
    file_size: history.file_size ?? null,
    mime_type,
    file_status: 'active',

    width: hasMetadata ? (history.actual_width ?? history.width ?? 0) : (history.width ?? 0),
    height: hasMetadata ? (history.actual_height ?? history.height ?? 0) : (history.height ?? 0),
    thumbnail_path: '',

    ai_tool: isComfyUI ? 'ComfyUI' : 'NovelAI',
    model_name: modelName || null,
    lora_models: null,
    steps: steps || null,
    cfg_scale: cfgScale || null,
    sampler: sampler || null,
    seed: seed ?? null,
    scheduler: scheduler || null,
    prompt: history.positive_prompt || null,
    negative_prompt: history.negative_prompt || null,
    denoise_strength: null,
    generation_time: null,
    batch_size: null,
    batch_index: null,
    auto_tags: parsedAutoTags as ImageRecord['auto_tags'],
    rating_score: null,

    perceptual_hash: null,
    dhash: null,
    ahash: null,
    color_histogram: null,

    duration: null,
    fps: null,
    video_codec: null,
    audio_codec: null,
    bitrate: null,

    thumbnail_url: hasMetadata && compositeHash ? `/api/images/${compositeHash}/thumbnail` : buildUploadsUrl(history.original_path),
    image_url: hasMetadata && compositeHash ? `/api/images/${compositeHash}/file` : buildUploadsUrl(history.original_path),

    groups: [],

    ai_metadata: {
      ai_tool: isComfyUI ? 'ComfyUI' : 'NovelAI',
      model_name: modelName || null,
      lora_models: null,
      generation_params: {
        steps: steps || null,
        cfg_scale: cfgScale || null,
        sampler: sampler || null,
        seed: seed ?? null,
        scheduler: scheduler || null,
        denoise_strength: null,
        generation_time: null,
        batch_size: null,
        batch_index: null,
      },
      prompts: {
        prompt: history.positive_prompt || null,
        negative_prompt: history.negative_prompt || null,
      },
      raw_nai_parameters: null,
    },
  }
}

export const convertHistoriesToImageRecords = (
  histories: (GenerationHistoryRecord | GenerationHistoryRecordWithMetadata)[],
): ImageRecord[] => {
  return histories.map((history) => convertHistoryToImageRecord(history))
}
