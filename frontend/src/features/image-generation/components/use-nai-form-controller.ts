import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import {
  buildNaiModuleFieldOptions,
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

/** Own the editable NAI form state and all local form-manipulation handlers for the panel. */
export function useNaiFormController({
  showSnackbar,
}: {
  showSnackbar: (input: { message: string; tone: 'info' | 'error' }) => void
}) {
  const [selectedCharacterIndex, setSelectedCharacterIndex] = useState<number | null>(null)
  const [naiForm, setNaiForm] = useState<NAIFormDraft>(DEFAULT_NAI_FORM)
  const [naiModuleName, setNaiModuleName] = useState('NAI Module')
  const [naiModuleDescription, setNaiModuleDescription] = useState('')
  const [naiExposedFieldKeys, setNaiExposedFieldKeys] = useState<string[]>(['prompt', 'negative_prompt', 'characters', 'vibes', 'character_refs', 'seed'])

  const naiModuleFieldOptions = useMemo(() => buildNaiModuleFieldOptions(naiForm), [naiForm])
  const supportsCharacterPrompts = useMemo(() => supportsNaiCharacterPrompts(naiForm.model), [naiForm.model])
  const supportsCharacterReference = useMemo(() => supportsNaiCharacterReferences(naiForm.model), [naiForm.model])
  const canUseCharacterPositions = useMemo(() => canUseNaiCharacterPositions(naiForm.characters.length), [naiForm.characters.length])
  const useCharacterPositions = useMemo(() => shouldUseNaiCharacterPositions(naiForm), [naiForm])

  useEffect(() => {
    const allowedKeys = new Set(naiModuleFieldOptions.map((field) => field.key))
    setNaiExposedFieldKeys((current) => current.filter((key) => allowedKeys.has(key)))
  }, [naiModuleFieldOptions])

  useEffect(() => {
    if (naiForm.characterPositionAiChoice || canUseCharacterPositions) {
      return
    }

    setNaiForm((current) => ({
      ...current,
      characterPositionAiChoice: true,
    }))
  }, [canUseCharacterPositions, naiForm.characterPositionAiChoice])

  /** Reset the full editable NAI form back to defaults. */
  const resetNaiForm = () => {
    setNaiForm(DEFAULT_NAI_FORM)
    setSelectedCharacterIndex(null)
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
        showSnackbar({ message: `Samples는 최대 ${NAI_SAMPLE_COUNT_MAX}개까지 가능해. ${NAI_SAMPLE_COUNT_MAX}로 맞출게.`, tone: 'info' })
      } else if (parsedValue < NAI_SAMPLE_COUNT_MIN) {
        showSnackbar({ message: `Samples는 ${NAI_SAMPLE_COUNT_MIN}~${NAI_SAMPLE_COUNT_MAX}만 가능해.`, tone: 'info' })
      }

      value = String(clampedValue)
    }

    setNaiForm((current) => {
      const nextForm = {
        ...current,
        [field]: value,
      }

      if (field === 'width' || field === 'height') {
        nextForm.resolutionPreset = resolveNaiResolutionPreset(
          field === 'width' ? value : nextForm.width,
          field === 'height' ? value : nextForm.height,
        )
      }

      return nextForm
    })
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

  /** Add one empty vibe row. */
  const handleAddVibe = () => {
    setNaiForm((current) => ({
      ...current,
      vibes: [...current.vibes, { ...EMPTY_NAI_VIBE }],
    }))
  }

  /** Update one editable vibe field. */
  const handleVibeFieldChange = (index: number, field: 'strength' | 'informationExtracted', value: string) => {
    setNaiForm((current) => ({
      ...current,
      vibes: current.vibes.map((vibe, vibeIndex) => (
        vibeIndex === index
          ? {
            ...vibe,
            [field]: value,
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

  /** Add one empty character-reference row. */
  const handleAddCharacterReference = () => {
    setNaiForm((current) => ({
      ...current,
      characterReferences: [...current.characterReferences, { ...EMPTY_NAI_CHARACTER_REFERENCE }],
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
    naiModuleName,
    setNaiModuleName,
    naiModuleDescription,
    setNaiModuleDescription,
    naiExposedFieldKeys,
    setNaiExposedFieldKeys,
    naiModuleFieldOptions,
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
