import { useEffect, useState } from 'react'
import type { ImageRecord } from '@/types/image'

export type RewriteFormat = 'png' | 'jpeg' | 'webp'

export interface RewriteMetadataDraft {
  format: RewriteFormat
  prompt: string
  negativePrompt: string
  steps: string
  sampler: string
  model: string
}

interface MetadataRewritePatchOptions {
  clearEmptyFields?: boolean
}

/** Infer the most natural rewrite output format from one file path. */
export function inferRewriteFormatFromPath(filePath?: string | null): RewriteFormat {
  if (!filePath) {
    return 'webp'
  }

  const lowerName = filePath.toLowerCase()
  if (lowerName.endsWith('.png')) {
    return 'png'
  }

  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) {
    return 'jpeg'
  }

  if (lowerName.endsWith('.webp')) {
    return 'webp'
  }

  return 'webp'
}

/** Infer the most natural rewrite output format from one source file. */
export function inferRewriteFormat(file: File | null): RewriteFormat {
  if (!file) {
    return 'webp'
  }

  return inferRewriteFormatFromPath(file.name)
}

/** Create an empty rewrite draft for one source file. */
export function createEmptyRewriteDraft(file: File | null, sourcePath?: string | null): RewriteMetadataDraft {
  return {
    format: file ? inferRewriteFormat(file) : inferRewriteFormatFromPath(sourcePath),
    prompt: '',
    negativePrompt: '',
    steps: '',
    sampler: '',
    model: '',
  }
}

/** Create a rewrite draft from one persisted image record. */
export function createRewriteDraftFromImage(image: ImageRecord): RewriteMetadataDraft {
  return {
    format: inferRewriteFormatFromPath(image.original_file_path),
    prompt: image.ai_metadata?.prompts?.prompt ?? '',
    negativePrompt: image.ai_metadata?.prompts?.negative_prompt ?? '',
    steps:
      image.ai_metadata?.generation_params?.steps != null
        ? String(image.ai_metadata.generation_params.steps)
        : '',
    sampler: image.ai_metadata?.generation_params?.sampler ?? '',
    model: image.ai_metadata?.model_name ?? '',
  }
}

/** Build a metadata patch payload from a draft, validating numeric fields. */
export function buildMetadataRewritePatch(
  draft: RewriteMetadataDraft,
  options: MetadataRewritePatchOptions = {},
): Record<string, string | number | null> {
  const metadataPatch: Record<string, string | number | null> = {}
  const clearEmptyFields = options.clearEmptyFields ?? false

  const prompt = draft.prompt.trim()
  if (prompt) {
    metadataPatch.prompt = prompt
  } else if (clearEmptyFields) {
    metadataPatch.prompt = null
  }

  const negativePrompt = draft.negativePrompt.trim()
  if (negativePrompt) {
    metadataPatch.negative_prompt = negativePrompt
  } else if (clearEmptyFields) {
    metadataPatch.negative_prompt = null
  }

  const steps = draft.steps.trim()
  if (steps) {
    const numericSteps = Number(steps)
    if (!Number.isFinite(numericSteps) || numericSteps <= 0) {
      throw new Error('steps는 1 이상의 숫자여야 해.')
    }

    metadataPatch.steps = Math.round(numericSteps)
  } else if (clearEmptyFields) {
    metadataPatch.steps = null
  }

  const sampler = draft.sampler.trim()
  if (sampler) {
    metadataPatch.sampler = sampler
  } else if (clearEmptyFields) {
    metadataPatch.sampler = null
  }

  const model = draft.model.trim()
  if (model) {
    metadataPatch.model = model
  } else if (clearEmptyFields) {
    metadataPatch.model = null
  }

  return metadataPatch
}

/** Keep a rewrite draft synced with the current file and extracted metadata preview. */
export function useMetadataRewriteDraft(file: File | null, extractResult: ImageRecord | null) {
  const [draft, setDraft] = useState<RewriteMetadataDraft>(() => createEmptyRewriteDraft(file, extractResult?.original_file_path))

  useEffect(() => {
    setDraft(createEmptyRewriteDraft(file, extractResult?.original_file_path))
  }, [file, extractResult?.original_file_path])

  useEffect(() => {
    if (!extractResult) {
      return
    }

    setDraft((current) => ({
      ...current,
      format: current.format ?? inferRewriteFormatFromPath(extractResult.original_file_path),
      prompt: extractResult.ai_metadata?.prompts?.prompt ?? current.prompt,
      negativePrompt: extractResult.ai_metadata?.prompts?.negative_prompt ?? current.negativePrompt,
      steps:
        extractResult.ai_metadata?.generation_params?.steps != null
          ? String(extractResult.ai_metadata.generation_params.steps)
          : current.steps,
      sampler: extractResult.ai_metadata?.generation_params?.sampler ?? current.sampler,
      model: extractResult.ai_metadata?.model_name ?? current.model,
    }))
  }, [extractResult])

  const patchDraft = (patch: Partial<RewriteMetadataDraft>) => {
    setDraft((current) => ({ ...current, ...patch }))
  }

  return {
    draft,
    setDraft,
    patchDraft,
    buildMetadataPatch: (options?: MetadataRewritePatchOptions) => buildMetadataRewritePatch(draft, options),
  }
}
