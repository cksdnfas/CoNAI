import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/i18n'
import { triggerBlobDownload } from '@/lib/api-client'
import { createGenerationQueueJob } from '@/lib/api-image-generation-queue'
import { upscaleNaiImage } from '@/lib/api-image-generation-nai'
import { refreshGenerationQueueViews } from './generation-queue-actions'
import { normalizeTextSegmentSpreadsheetText } from './text-segment-spreadsheet-input'
import type { GenerationImageSaveOptions } from '@/lib/api-image-generation'
import {
  buildNaiCharacterPromptPayload,
  buildNaiCharacterReferencePayload,
  buildNaiVibePayload,
  clampNaiSampleCount,
  getErrorMessage,
  shouldUseNaiCharacterPositions,
  type NAIFormDraft,
  type NAIVibeDraft,
} from '../image-generation-shared'
import { decodeNaiBase64Png } from './nai-generation-panel-helpers'

/** Manage generation and upscale actions for the NAI generation panel. */
export function useNaiGenerationActions({
  connected,
  naiForm,
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
  const [isUpscaling, setIsUpscaling] = useState(false)

  /** Submit one NAI image-generation request from the current form state. */
  const handleNaiGenerate = useCallback(async () => {
    if (isNaiGenerating) {
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

    try {
      const sampleCount = clampNaiSampleCount(naiForm.samples)
      const useCharacterPositions = shouldUseNaiCharacterPositions(naiForm)
      const encodedVibes = await ensureEncodedVibes()
      if (!encodedVibes) {
        return
      }

      setIsNaiGenerating(true)
      const response = await createGenerationQueueJob({
        service_type: 'novelai',
        request_summary: `NAI queue job · ${prompt.slice(0, 48)}`,
        request_payload: {
          prompt,
          negative_prompt: negativePrompt || undefined,
          model: naiForm.model,
          action: naiForm.action,
          sampler: naiForm.sampler,
          noise_schedule: naiForm.scheduler,
          width: Number(naiForm.width),
          height: Number(naiForm.height),
          steps: Number(naiForm.steps),
          scale: Number(naiForm.scale),
          n_samples: sampleCount,
          seed: naiForm.seed.trim().length > 0 ? Number(naiForm.seed) : undefined,
          use_coords: useCharacterPositions,
          characters: supportsCharacterPrompts ? buildNaiCharacterPromptPayload(naiForm.characters) : undefined,
          vibes: buildNaiVibePayload(encodedVibes),
          character_refs: buildNaiCharacterReferencePayload(naiForm.characterReferences),
          variety_plus: naiForm.varietyPlus,
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
    supportsCharacterPrompts,
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
