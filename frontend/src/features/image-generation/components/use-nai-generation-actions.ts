import { useState } from 'react'
import { triggerBlobDownload } from '@/lib/api-client'
import { createGenerationQueueJob } from '@/lib/api-image-generation-queue'
import { createNaiModuleFromSnapshot, upscaleNaiImage } from '@/lib/api'
import type { GenerationImageSaveOptions } from '@/lib/api-image-generation'
import {
  buildNaiCharacterPromptPayload,
  buildNaiCharacterReferencePayload,
  buildNaiModuleSnapshot,
  buildNaiModuleUiSchema,
  buildNaiVibePayload,
  clampNaiSampleCount,
  getErrorMessage,
  shouldUseNaiCharacterPositions,
  type ModuleFieldOption,
  type NAIFormDraft,
  type NAIVibeDraft,
} from '../image-generation-shared'
import { decodeNaiBase64Png } from './nai-generation-panel-helpers'

/** Manage generation, upscale, and module-save actions for the NAI generation panel. */
export function useNaiGenerationActions({
  connected,
  naiForm,
  supportsCharacterPrompts,
  supportsCharacterReference,
  ensureEncodedVibes,
  refetchUserData,
  onHistoryRefresh,
  naiModuleName,
  naiModuleDescription,
  naiExposedFieldKeys,
  naiModuleFieldOptions,
  imageSaveOptions,
  closeModuleSaveModal,
  showSnackbar,
}: {
  connected: boolean
  naiForm: NAIFormDraft
  supportsCharacterPrompts: boolean
  supportsCharacterReference: boolean
  ensureEncodedVibes: () => Promise<NAIVibeDraft[] | null>
  refetchUserData: () => Promise<unknown>
  onHistoryRefresh: () => void
  naiModuleName: string
  naiModuleDescription: string
  naiExposedFieldKeys: string[]
  naiModuleFieldOptions: ModuleFieldOption[]
  imageSaveOptions?: GenerationImageSaveOptions
  closeModuleSaveModal: () => void
  showSnackbar: (input: { message: string; tone: 'info' | 'error' }) => void
}) {
  const [isNaiGenerating, setIsNaiGenerating] = useState(false)
  const [isSavingNaiModule, setIsSavingNaiModule] = useState(false)
  const [isUpscaling, setIsUpscaling] = useState(false)

  /** Submit one NAI image-generation request from the current form state. */
  const handleNaiGenerate = async () => {
    if (isNaiGenerating) {
      return
    }

    if (!connected) {
      showSnackbar({ message: 'NAI 생성 전에 먼저 로그인해줘. 상단 로그인 버튼을 눌러줘.', tone: 'error' })
      return
    }

    if (naiForm.prompt.trim().length === 0) {
      showSnackbar({ message: 'NAI 프롬프트를 먼저 넣어줘.', tone: 'error' })
      return
    }

    if ((naiForm.action === 'img2img' || naiForm.action === 'infill') && !naiForm.sourceImage) {
      showSnackbar({ message: 'img2img / infill에는 소스 이미지가 필요해.', tone: 'error' })
      return
    }

    if (naiForm.action === 'infill' && !naiForm.maskImage) {
      showSnackbar({ message: 'infill에는 마스크 이미지도 필요해.', tone: 'error' })
      return
    }

    if (!supportsCharacterReference && naiForm.characterReferences.length > 0) {
      showSnackbar({ message: 'Character Reference는 NAI Diffusion 4.5 모델에서만 쓸 수 있어.', tone: 'error' })
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
        request_summary: `NAI queue job · ${naiForm.prompt.trim().slice(0, 48)}`,
        request_payload: {
          prompt: naiForm.prompt.trim(),
          negative_prompt: naiForm.negativePrompt.trim() || undefined,
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

      onHistoryRefresh()
      showSnackbar({ message: response.message || 'NAI 큐에 생성 작업을 넣었어.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, 'NAI 이미지 생성에 실패했어.'), tone: 'error' })
    } finally {
      setIsNaiGenerating(false)
    }
  }

  /** Run one NAI upscale request for the current source image and download the result. */
  const handleUpscale = async () => {
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
      showSnackbar({ message: 'NovelAI 업스케일 완료. PNG 다운로드를 시작할게.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, 'NovelAI 업스케일에 실패했어.'), tone: 'error' })
    } finally {
      setIsUpscaling(false)
    }
  }

  /** Save the current NAI setup as one reusable module snapshot. */
  const handleCreateNaiModule = async () => {
    const moduleName = naiModuleName.trim()

    if (moduleName.length === 0 || isSavingNaiModule) {
      return
    }

    if (naiExposedFieldKeys.length === 0) {
      showSnackbar({ message: '최소 1개는 입력 가능 필드로 열어줘.', tone: 'error' })
      return
    }

    try {
      const encodedVibes = await ensureEncodedVibes()
      if (!encodedVibes) {
        return
      }

      setIsSavingNaiModule(true)
      const snapshot = buildNaiModuleSnapshot({
        ...naiForm,
        vibes: encodedVibes,
      })
      const exposedFields = naiModuleFieldOptions
        .filter((field) => naiExposedFieldKeys.includes(field.key))
        .map((field) => ({
          key: field.key,
          label: field.label,
          data_type: field.dataType,
        }))
      const uiSchema = buildNaiModuleUiSchema(naiModuleFieldOptions, snapshot, naiExposedFieldKeys)

      await createNaiModuleFromSnapshot({
        name: moduleName,
        description: naiModuleDescription.trim() || undefined,
        snapshot,
        exposed_fields: exposedFields,
        ui_schema: uiSchema,
      })

      closeModuleSaveModal()
      showSnackbar({ message: '현재 NAI 설정을 모듈로 저장했어.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, 'NAI 모듈 저장에 실패했어.'), tone: 'error' })
    } finally {
      setIsSavingNaiModule(false)
    }
  }

  return {
    isNaiGenerating,
    isSavingNaiModule,
    isUpscaling,
    handleNaiGenerate,
    handleUpscale,
    handleCreateNaiModule,
  }
}
