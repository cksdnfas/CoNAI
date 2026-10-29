import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getNaiFixedModelSettings, PROMPT_LEGACY_WILDCARD_PATTERN, PROMPT_RANDOM_TOKEN_PATTERN } from '@conai/shared'
import { useI18n } from '@/i18n'
import { triggerBlobDownload } from '@/lib/api-client'
import { createGenerationQueueJob } from '@/lib/api-image-generation-queue'
import { upscaleNaiImage } from '@/lib/api-image-generation-nai'
import { refreshGenerationQueueViews } from './generation-queue-actions'
import { IMAGE_GENERATION_TARGET_GROUP_KEY, useGenerationTargetGroupPath } from '@/features/groups/generation-target-group-store'
import { normalizeTextSegmentSpreadsheetText } from './text-segment-spreadsheet-input'
import type { GenerationImageSaveOptions } from '@/lib/api-image-generation'
import {
  buildNaiCharacterPromptPayload,
  buildNaiCharacterReferencePayload,
  buildNaiVibePayload,
  clampNaiQueueCount,
  clampNaiSampleCount,
  getErrorMessage,
  getNaiEnhanceIssueLabel,
  resolveNaiFormEnhance,
  getNaiVibesUnsupportedMessage,
  resolveNaiPromptPresets,
  resolveNaiSamplingSettings,
  shouldUseNaiCharacterPositions,
  supportsNaiTransparentBackground,
  supportsNaiVibes,
  type NAIFormDraft,
  type NaiImageSize,
  type NAIVibeDraft,
} from '../image-generation-shared'
import { decodeNaiBase64Png } from './nai-generation-panel-helpers'

// Non-global copies: the shared patterns are global, so `test` on them would carry `lastIndex` between calls.
const PROMPT_RANDOM_TOKEN_TEST = new RegExp(PROMPT_RANDOM_TOKEN_PATTERN.source)
const PROMPT_LEGACY_WILDCARD_TEST = new RegExp(PROMPT_LEGACY_WILDCARD_PATTERN.source)

/** Whether any of the sent prompts holds random/wildcard syntax, so repeated jobs differ even with a fixed seed. */
function hasNaiRandomPromptSyntax(prompts: string[]) {
  return prompts.some((value) => PROMPT_RANDOM_TOKEN_TEST.test(value) || PROMPT_LEGACY_WILDCARD_TEST.test(value))
}

/** Manage generation and upscale actions for the NAI generation panel. */
export function useNaiGenerationActions({
  connected,
  naiForm,
  sourceImageSize,
  supportsCharacterPrompts,
  supportsCharacterReference,
  ensureEncodedVibes,
  refetchUserData,
  onHistoryRefresh,
  imageSaveOptions,
  showSnackbar,
}: {
  connected: boolean
  naiForm: NAIFormDraft
  /** Natural size of the img2img source, for the enhance plan. */
  sourceImageSize: NaiImageSize | null
  supportsCharacterPrompts: boolean
  supportsCharacterReference: boolean
  ensureEncodedVibes: () => Promise<NAIVibeDraft[] | null>
  refetchUserData: () => Promise<unknown>
  onHistoryRefresh: () => void
  imageSaveOptions?: GenerationImageSaveOptions
  showSnackbar: (input: { message: string; tone: 'info' | 'error' }) => void
}) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [isNaiGenerating, setIsNaiGenerating] = useState(false)
  const generatingRef = useRef(false)
  const [isUpscaling, setIsUpscaling] = useState(false)
  const { requestPath: targetGroupPath } = useGenerationTargetGroupPath(IMAGE_GENERATION_TARGET_GROUP_KEY)

  /** Submit one NAI image-generation request from the current form state. */
  const handleNaiGenerate = useCallback(async () => {
    if (isNaiGenerating || generatingRef.current) {
      return
    }

    if (!connected) {
      showSnackbar({ message: t('image-generation.components.use.nai.generation.actions.log.in.before.nai.generation.use.the'), tone: 'error' })
      return
    }

    const prompt = normalizeTextSegmentSpreadsheetText(naiForm.prompt).trim()
    const negativePrompt = normalizeTextSegmentSpreadsheetText(naiForm.negativePrompt).trim()

    if (prompt.length === 0) {
      showSnackbar({ message: t('image-generation.components.use.nai.generation.actions.enter.an.nai.prompt.first'), tone: 'error' })
      return
    }

    if ((naiForm.action === 'img2img' || naiForm.action === 'infill') && !naiForm.sourceImage) {
      showSnackbar({ message: t('image-generation.components.use.nai.generation.actions.img2img.infill.requires.a.source.image'), tone: 'error' })
      return
    }

    if (naiForm.action === 'infill' && !naiForm.maskImage) {
      showSnackbar({ message: t('image-generation.components.use.nai.generation.actions.infill.also.requires.a.mask.image'), tone: 'error' })
      return
    }

    if (!supportsCharacterReference && naiForm.characterReferences.length > 0) {
      showSnackbar({ message: t('image-generation.components.use.nai.generation.actions.character.reference.is.only.available.with.nai'), tone: 'error' })
      return
    }

    if (!supportsNaiVibes(naiForm.model) && naiForm.vibes.length > 0) {
      showSnackbar({ message: getNaiVibesUnsupportedMessage(t), tone: 'error' })
      return
    }

    const enhance = resolveNaiFormEnhance(naiForm, sourceImageSize)
    if (enhance?.issue) {
      showSnackbar({
        message: t({ ko: 'Enhance를 쓸 수 없어: {reason}', en: 'Enhance is unavailable: {reason}' }, { reason: getNaiEnhanceIssueLabel(t, enhance.issue) }),
        tone: 'error',
      })
      return
    }

    const queueCount = clampNaiQueueCount(naiForm.queueCount)
    // Only prompts the request uses count: character prompts need model support, and a model with fixed settings drops the negatives.
    const usesNegatives = getNaiFixedModelSettings(naiForm.model) === null
    const sentPrompts = [
      naiForm.prompt,
      ...(usesNegatives ? [naiForm.negativePrompt] : []),
      ...(supportsCharacterPrompts ? naiForm.characters.flatMap((character) => usesNegatives ? [character.prompt, character.uc] : [character.prompt]) : []),
    ]
    if (queueCount > 1 && naiForm.seed.trim().length > 0 && !hasNaiRandomPromptSyntax(sentPrompts)) {
      showSnackbar({
        message: t({
          ko: '시드가 고정돼 있어서 반복해도 같은 이미지가 나와. 시드를 랜덤으로 바꾸거나 프롬프트에 랜덤 문법을 넣어줘.',
          en: 'The seed is fixed, so every repeat makes the same image. Switch the seed to random or add random syntax to the prompt.',
        }),
        tone: 'error',
      })
      return
    }

    // The payload builders drop image-less rows, so the row would look applied while being ignored.
    const emptyVibeCount = naiForm.vibes.filter((vibe) => !vibe.image && vibe.encoded.trim().length === 0).length
    const emptyReferenceCount = naiForm.characterReferences.filter((reference) => !reference.image).length
    if (emptyVibeCount > 0 || emptyReferenceCount > 0) {
      showSnackbar({
        message: t({
          ko: '이미지가 없는 바이브·레퍼런스 행이 있어. 이미지를 넣거나 행을 지워줘.',
          en: 'Some vibe or reference rows have no image. Add an image or remove the row.',
        }),
        tone: 'error',
      })
      return
    }

    generatingRef.current = true
    setIsNaiGenerating(true)
    try {
      const sampleCount = clampNaiSampleCount(naiForm.samples)
      const useCharacterPositions = shouldUseNaiCharacterPositions(naiForm)
      const encodedVibes = await ensureEncodedVibes()
      if (!encodedVibes) {
        return
      }

      const promptPresets = resolveNaiPromptPresets(naiForm)
      const sampling = resolveNaiSamplingSettings(naiForm)
      const response = await createGenerationQueueJob({
        service_type: 'novelai',
        requested_group_path: targetGroupPath,
        request_summary: `NAI queue job · ${prompt.slice(0, 48)}`,
        enqueue_count: queueCount,
        request_payload: {
          prompt,
          negative_prompt: negativePrompt || undefined,
          quality_toggle: promptPresets.qualityToggle,
          uc_preset: promptPresets.ucPreset,
          model: naiForm.model,
          action: naiForm.action,
          sampler: sampling.sampler,
          noise_schedule: naiForm.scheduler,
          // With enhance the server derives the size from the source; send the same plan size.
          width: enhance?.plan.width ?? Number(naiForm.width),
          height: enhance?.plan.height ?? Number(naiForm.height),
          enhance: enhance?.plan.amount,
          steps: Number(sampling.steps),
          scale: Number(naiForm.scale),
          n_samples: sampleCount,
          seed: naiForm.seed.trim().length > 0 ? Number(naiForm.seed) : undefined,
          use_coords: useCharacterPositions,
          characters: supportsCharacterPrompts ? buildNaiCharacterPromptPayload(naiForm.characters) : undefined,
          vibes: buildNaiVibePayload(encodedVibes),
          character_refs: buildNaiCharacterReferencePayload(naiForm.characterReferences),
          variety_plus: naiForm.varietyPlus,
          transparent_background: naiForm.transparentBackground && supportsNaiTransparentBackground(naiForm.model),
          image: naiForm.action !== 'generate' ? naiForm.sourceImage?.dataUrl : undefined,
          mask: naiForm.action === 'infill' ? naiForm.maskImage?.dataUrl : undefined,
          strength: naiForm.action !== 'generate' ? Number(naiForm.strength) : undefined,
          noise: naiForm.action !== 'generate' ? Number(naiForm.noise) : undefined,
          add_original_image: naiForm.action === 'infill' ? naiForm.addOriginalImage : undefined,
          imageSaveOptions,
        },
      })

      void refreshGenerationQueueViews(queryClient, onHistoryRefresh)
      showSnackbar({ message: response.message || t('image-generation.components.use.nai.generation.actions.added.a.generation.job.to.the.nai'), tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t('image-generation.components.use.nai.generation.actions.nai.image.generation.failed')), tone: 'error' })
    } finally {
      generatingRef.current = false
      setIsNaiGenerating(false)
    }
  }, [
    connected,
    ensureEncodedVibes,
    imageSaveOptions,
    isNaiGenerating,
    naiForm,
    onHistoryRefresh,
    queryClient,
    showSnackbar,
    sourceImageSize,
    supportsCharacterPrompts,
    targetGroupPath,
    supportsCharacterReference,
    t,
  ])

  /** Run one NAI upscale request for the current source image and download the result. */
  const handleUpscale = useCallback(async () => {
    if (!naiForm.sourceImage || isUpscaling) {
      return
    }

    try {
      setIsUpscaling(true)
      const response = await upscaleNaiImage({
        image: naiForm.sourceImage.dataUrl,
        scale: 2,
      })
      triggerBlobDownload(decodeNaiBase64Png(response.image), response.filename)
      await refetchUserData()
      showSnackbar({ message: t('image-generation.components.use.nai.generation.actions.novelai.upscale.complete.starting.png.download'), tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t('image-generation.components.use.nai.generation.actions.novelai.upscale.failed')), tone: 'error' })
    } finally {
      setIsUpscaling(false)
    }
  }, [isUpscaling, naiForm.sourceImage, refetchUserData, showSnackbar, t])

  return {
    isNaiGenerating,
    isUpscaling,
    handleNaiGenerate,
    handleUpscale,
  }
}
