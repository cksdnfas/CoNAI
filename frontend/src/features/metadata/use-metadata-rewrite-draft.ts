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

/** Infer the most natural rewrite output format from one source file. */
export function inferRewriteFormat(file: File | null): RewriteFormat {
  if (!file) {
    return 'webp'
  }

  const lowerName = file.name.toLowerCase()
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

/** Create an empty rewrite draft for one source file. */
export function createEmptyRewriteDraft(file: File | null): RewriteMetadataDraft {
  return {
    format: inferRewriteFormat(file),
    prompt: '',
    negativePrompt: '',
    steps: '',
    sampler: '',
    model: '',
  }
}

/** Build a metadata patch payload from a draft, validating numeric fields. */
export function buildMetadataRewritePatch(draft: RewriteMetadataDraft): Record<string, string | number> {
  const metadataPatch: Record<string, string | number> = {}

  if (draft.prompt.trim()) {
    metadataPatch.prompt = draft.prompt.trim()
  }

  if (draft.negativePrompt.trim()) {
    metadataPatch.negative_prompt = draft.negativePrompt.trim()
  }

  if (draft.steps.trim()) {
    const numericSteps = Number(draft.steps)
    if (!Number.isFinite(numericSteps) || numericSteps <= 0) {
      throw new Error('steps는 1 이상의 숫자여야 해.')
    }

    metadataPatch.steps = Math.round(numericSteps)
  }

  if (draft.sampler.trim()) {
    metadataPatch.sampler = draft.sampler.trim()
  }

  if (draft.model.trim()) {
    metadataPatch.model = draft.model.trim()
  }

  return metadataPatch
}

/** Keep a rewrite draft synced with the current file and extracted metadata preview. */
export function useMetadataRewriteDraft(file: File | null, extractResult: ImageRecord | null) {
  const [draft, setDraft] = useState<RewriteMetadataDraft>(() => createEmptyRewriteDraft(file))

  useEffect(() => {
    setDraft(createEmptyRewriteDraft(file))
  }, [file])

  useEffect(() => {
    if (!extractResult) {
      return
    }

    setDraft((current) => ({
      ...current,
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
    buildMetadataPatch: () => buildMetadataRewritePatch(draft),
  }
}
