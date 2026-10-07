import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useI18n } from '@/i18n'
import { resolveAccountDraftOwner } from '@/features/auth/auth-permissions'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import {
  canUseNaiCharacterPositions,
  clampNaiSampleCount,
  DEFAULT_NAI_FORM,
  EMPTY_NAI_CHARACTER_PROMPT,
  EMPTY_NAI_CHARACTER_REFERENCE,
  EMPTY_NAI_VIBE,
  NAI_SAMPLE_COUNT_MAX,
  NAI_SAMPLE_COUNT_MIN,
  NAI_RESOLUTION_PRESETS,
  normalizeNaiCharacterPromptDrafts,
  resolveNaiResolutionPreset,
  shouldUseNaiCharacterPositions,
  supportsNaiCharacterPrompts,
  supportsNaiCharacterReferences,
  type NAICharacterPromptDraft,
  type NAIFormDraft,
  type SelectedImageDraft,
} from '../image-generation-shared'
import { loadPersistedNaiFormDraft, persistNaiFormDraft } from '../image-generation-drafts'

/** Shared local form update path for user input and reviewed chat input; never submits a request. */
export function applyNaiFormPatch(current: NAIFormDraft, patch: Partial<NAIFormDraft>): NAIFormDraft {
  const nextForm = { ...current, ...patch }
  if (patch.model !== undefined && patch.model !== current.model) {
    nextForm.vibes = current.vibes.map((vibe) => (vibe.image ? { ...vibe, encoded: '' } : vibe))
  }
  if (patch.width !== undefined || patch.height !== undefined) {
    nextForm.resolutionPreset = resolveNaiResolutionPreset(nextForm.width, nextForm.height)
  }
  return nextForm
}

/** Own the editable NAI form state and all local form-manipulation handlers for the panel. */
export function useNaiFormController({
  showSnackbar,
}: {
  showSnackbar: (input: { message: string; tone: 'info' | 'error' }) => void
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const draftStorageOwner = resolveAccountDraftOwner(useAuthStatusQuery().data)
  const [persistedDraft] = useState(() => loadPersistedNaiFormDraft(draftStorageOwner))
  const [selectedCharacterIndex, setSelectedCharacterIndex] = useState<number | null>(persistedDraft.selectedCharacterIndex)
  const [naiForm, setNaiForm] = useState<NAIFormDraft>(persistedDraft.form)
  const supportsCharacterPrompts = useMemo(() => supportsNaiCharacterPrompts(naiForm.model), [naiForm.model])
  const supportsCharacterReference = useMemo(() => supportsNaiCharacterReferences(naiForm.model), [naiForm.model])
  const canUseCharacterPositions = useMemo(() => canUseNaiCharacterPositions(naiForm.characters.length), [naiForm.characters.length])
  const useCharacterPositions = useMemo(() => shouldUseNaiCharacterPositions(naiForm), [naiForm])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      persistNaiFormDraft(draftStorageOwner, naiForm, selectedCharacterIndex)
    }, 250)

    return () => window.clearTimeout(timeout)
  }, [draftStorageOwner, naiForm, selectedCharacterIndex])

  useEffect(() => {
    if (naiForm.characterPositionAiChoice || canUseCharacterPositions) {
      return
    }

    setNaiForm((current) => ({
      ...current,
      characterPositionAiChoice: true,
    }))
  }, [canUseCharacterPositions, naiForm.characterPositionAiChoice])

  useEffect(() => {
    setSelectedCharacterIndex((current) => {
      if (current === null) {
        return null
      }

      if (naiForm.characters.length === 0) {
        return null
      }

      return Math.min(current, naiForm.characters.length - 1)
    })
  }, [naiForm.characters.length])

  /** Reset the full editable NAI form back to defaults after confirming; the saved draft follows via persistence. */
  const resetNaiForm = async () => {
    const hasLosableContent = naiForm.prompt.trim().length > 0
      || naiForm.negativePrompt.trim() !== DEFAULT_NAI_FORM.negativePrompt.trim()
      || naiForm.characters.length > 0
      || naiForm.vibes.length > 0
      || naiForm.characterReferences.length > 0
      || Boolean(naiForm.sourceImage)
      || Boolean(naiForm.maskImage)
    if (hasLosableContent) {
      const confirmed = await confirm({
        title: t({ ko: 'NAI 설정을 초기화할까?', en: 'Reset the NAI settings?' }),
        description: t({
          ko: '프롬프트, 캐릭터, 바이브, 캐릭터 레퍼런스, 원본·마스크 이미지와 저장된 초안이 모두 지워져. 되돌릴 수 없어.',
          en: 'Prompts, characters, vibes, character references, source/mask images and the saved draft will all be cleared. This cannot be undone.',
        }),
        confirmLabel: t({ ko: '초기화', en: 'Reset' }),
        tone: 'destructive',
      })
      if (!confirmed) {
        return
      }
    }

    setNaiForm(DEFAULT_NAI_FORM)
    setSelectedCharacterIndex(null)
    showSnackbar({ message: t({ ko: 'NAI 설정을 초기화했어.', en: 'Reset the NAI settings.' }), tone: 'info' })
  }

  /** Update one top-level NAI field while applying inline normalization rules. */
  const handleNaiFieldChange = (field: 'prompt' | 'negativePrompt' | 'model' | 'action' | 'sampler' | 'scheduler' | 'width' | 'height' | 'steps' | 'scale' | 'samples' | 'seed' | 'strength' | 'noise', value: string) => {
    if (field === 'samples') {
      const trimmedValue = value.trim()

      if (trimmedValue.length === 0) {
        setNaiForm((current) => ({
          ...current,
          samples: '',
        }))
        return
      }

      const parsedValue = Number(trimmedValue)
      if (!Number.isFinite(parsedValue)) {
        return
      }

      const clampedValue = clampNaiSampleCount(parsedValue)
      if (parsedValue > NAI_SAMPLE_COUNT_MAX) {
        showSnackbar({
          message: t('image-generation.components.use.nai.form.controller.samples.max.clamped', { max: NAI_SAMPLE_COUNT_MAX }),
          tone: 'info',
        })
      } else if (parsedValue < NAI_SAMPLE_COUNT_MIN) {
        showSnackbar({
          message: t('image-generation.components.use.nai.form.controller.samples.range', {
            min: NAI_SAMPLE_COUNT_MIN,
            max: NAI_SAMPLE_COUNT_MAX,
          }),
          tone: 'info',
        })
      }

      value = String(clampedValue)
    }

    setNaiForm((current) => applyNaiFormPatch(current, { [field]: value }))
  }

  /** Apply one resolution preset to width/height, or fall back to custom when unknown. */
  const handleResolutionPresetChange = (presetKey: string) => {
    setNaiForm((current) => {
      const preset = NAI_RESOLUTION_PRESETS.find((entry) => entry.key === presetKey)
      if (!preset) {
        return {
          ...current,
          resolutionPreset: 'custom',
        }
      }

      return {
        ...current,
        resolutionPreset: preset.key,
        width: String(preset.width),
        height: String(preset.height),
      }
    })
  }

  /** Replace one source or mask image in the current form. */
  const handleNaiImageChange = (field: 'sourceImage' | 'maskImage', image?: SelectedImageDraft) => {
    setNaiForm((current) => ({
      ...current,
      [field]: image,
    }))
  }

  /** Add one new character-prompt row and select it immediately. */
  const handleAddCharacterPrompt = () => {
    setNaiForm((current) => {
      const nextCharacters = normalizeNaiCharacterPromptDrafts([...current.characters, { ...EMPTY_NAI_CHARACTER_PROMPT }])
      setSelectedCharacterIndex(nextCharacters.length - 1)
      return {
        ...current,
        characters: nextCharacters,
      }
    })
  }

  /** Update one character-prompt row while keeping grid positions normalized. */
  const handleCharacterPromptChange = (index: number, field: keyof NAICharacterPromptDraft, value: string) => {
    setNaiForm((current) => ({
      ...current,
      characters: normalizeNaiCharacterPromptDrafts(current.characters.map((character, characterIndex) => (
        characterIndex === index
          ? {
            ...character,
            [field]: value,
          }
          : character
      ))),
    }))
  }

  /** Remove one character-prompt row and repair the current selection index. */
  const handleRemoveCharacterPrompt = (index: number) => {
    setNaiForm((current) => ({
      ...current,
      characters: normalizeNaiCharacterPromptDrafts(current.characters.filter((_, characterIndex) => characterIndex !== index)),
    }))
    setSelectedCharacterIndex((current) => {
      if (current === null) {
        return null
      }
      if (current === index) {
        return null
      }
      return current > index ? current - 1 : current
    })
  }

  /** Add one vibe row for a picked image; it is encoded on submit. */
  const handleAddVibe = (image: SelectedImageDraft) => {
    setNaiForm((current) => ({
      ...current,
      vibes: [...current.vibes, { ...EMPTY_NAI_VIBE, image }],
    }))
  }

  /**
   * Update one editable vibe field.
   * The encoding bakes in information-extracted, so changing it drops the cached payload and the
   * vibe is re-encoded on submit. Image-less vibes (pasted/stored encodings) keep theirs: there is
   * nothing to re-encode from.
   */
  const handleVibeFieldChange = (index: number, field: 'strength' | 'informationExtracted', value: string) => {
    setNaiForm((current) => ({
      ...current,
      vibes: current.vibes.map((vibe, vibeIndex) => (
        vibeIndex === index
          ? {
            ...vibe,
            [field]: value,
            ...(field === 'informationExtracted' && vibe.image && value !== vibe.informationExtracted ? { encoded: '' } : {}),
          }
          : vibe
      )),
    }))
  }

  /** Replace one vibe image and clear its cached encoded payload. */
  const handleVibeImageChange = (index: number, image?: SelectedImageDraft) => {
    setNaiForm((current) => ({
      ...current,
      vibes: current.vibes.map((vibe, vibeIndex) => (
        vibeIndex === index
          ? {
            ...vibe,
            image,
            encoded: '',
          }
          : vibe
      )),
    }))
  }

  /** Remove one vibe row. */
  const handleRemoveVibe = (index: number) => {
    setNaiForm((current) => ({
      ...current,
      vibes: current.vibes.filter((_, vibeIndex) => vibeIndex !== index),
    }))
  }

  /** Add one character-reference row for a picked image. */
  const handleAddCharacterReference = (image: SelectedImageDraft) => {
    setNaiForm((current) => ({
      ...current,
      characterReferences: [...current.characterReferences, { ...EMPTY_NAI_CHARACTER_REFERENCE, image }],
    }))
  }

  /** Update one editable character-reference field. */
  const handleCharacterReferenceFieldChange = (index: number, field: 'type' | 'strength' | 'fidelity', value: string) => {
    setNaiForm((current) => ({
      ...current,
      characterReferences: current.characterReferences.map((reference, referenceIndex) => (
        referenceIndex === index
          ? {
            ...reference,
            [field]: value,
          }
          : reference
      )),
    }))
  }

  /** Replace one character-reference image. */
  const handleCharacterReferenceImageChange = (index: number, image?: SelectedImageDraft) => {
    setNaiForm((current) => ({
      ...current,
      characterReferences: current.characterReferences.map((reference, referenceIndex) => (
        referenceIndex === index
          ? {
            ...reference,
            image,
          }
          : reference
      )),
    }))
  }

  /** Remove one character-reference row. */
  const handleRemoveCharacterReference = (index: number) => {
    setNaiForm((current) => ({
      ...current,
      characterReferences: current.characterReferences.filter((_, referenceIndex) => referenceIndex !== index),
    }))
  }

  return {
    selectedCharacterIndex,
    setSelectedCharacterIndex,
    naiForm,
    setNaiForm: setNaiForm as Dispatch<SetStateAction<NAIFormDraft>>,
    supportsCharacterPrompts,
    supportsCharacterReference,
    canUseCharacterPositions,
    useCharacterPositions,
    resetNaiForm,
    handleNaiFieldChange,
    handleResolutionPresetChange,
    handleNaiImageChange,
    handleAddCharacterPrompt,
    handleCharacterPromptChange,
    handleRemoveCharacterPrompt,
    handleAddVibe,
    handleVibeFieldChange,
    handleVibeImageChange,
    handleRemoveVibe,
    handleAddCharacterReference,
    handleCharacterReferenceFieldChange,
    handleCharacterReferenceImageChange,
    handleRemoveCharacterReference,
  }
}
