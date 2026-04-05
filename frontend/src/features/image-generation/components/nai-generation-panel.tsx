import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { Plus, Save, Trash2 } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { ImageSaveOptionsModal } from '@/components/media/image-save-options-modal'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import { Select } from '@/components/ui/select'
import { ToggleRow } from '@/components/ui/toggle-row'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { cn } from '@/lib/utils'
import { DEFAULT_IMAGE_SAVE_SETTINGS } from '@/lib/image-save-output'
import {
  getAppSettings,
  getNaiCostEstimate,
  getNaiUserData,
} from '@/lib/api'
import {
  buildNaiModuleFieldOptions,
  canUseNaiCharacterPositions,
  clampNaiSampleCount,
  DEFAULT_NAI_FORM,
  EMPTY_NAI_CHARACTER_PROMPT,
  EMPTY_NAI_CHARACTER_REFERENCE,
  EMPTY_NAI_VIBE,
  FormField,
  getErrorMessage,
  NAI_SAMPLE_COUNT_MAX,
  NAI_SAMPLE_COUNT_MIN,
  NAI_ACTION_OPTIONS,
  NAI_MODEL_OPTIONS,
  NAI_RESOLUTION_PRESETS,
  NAI_SAMPLER_OPTIONS,
  NAI_SCHEDULER_OPTIONS,
  normalizeNaiCharacterPromptDrafts,
  parseNumberInput,
  resolveNaiResolutionPreset,
  shouldUseNaiCharacterPositions,
  supportsNaiCharacterPrompts,
  supportsNaiCharacterReferences,
  type NAICharacterPromptDraft,
  type NAICharacterReferenceDraft,
  type NAIFormDraft,
  type NAIVibeDraft,
  type SelectedImageDraft,
} from '../image-generation-shared'
import { ImageAttachmentPickerButton } from './image-attachment-picker'
import { NaiAuthModal } from './nai-auth-modal'
import { NaiReferencesSection } from './nai-references-section'
import { NaiSelectedImageCard } from './nai-selected-image-card'
import { NaiVibesSection } from './nai-vibes-section'
import { NaiAssetSaveModal } from './nai-asset-save-modal'
import { NaiCharacterPositionBoard } from './nai-character-position-board'
import { NaiModuleSaveModal } from './nai-module-save-modal'
import { PromptToggleField } from './prompt-toggle-field'
import { NaiActionSection, NaiConnectionHeader, NaiPromptSection } from './nai-generation-panel-sections'
import { useNaiAssetLibrary } from './use-nai-asset-library'
import { useNaiAuthController } from './use-nai-auth-controller'
import { useNaiGenerationActions } from './use-nai-generation-actions'
import { useNaiImageEditorBridge } from './use-nai-image-editor-bridge'

const ImageEditorModal = lazy(() => import('@/features/image-editor/image-editor-modal'))

type NaiGenerationPanelProps = {
  refreshNonce: number
  onHistoryRefresh: () => void
  splitPaneScroll?: boolean
  compactActionBar?: boolean
  headerPortalTargetId?: string
}

/** Render the NAI login, generation, and module-authoring workflow. */
export function NaiGenerationPanel({ refreshNonce, onHistoryRefresh, splitPaneScroll = false, compactActionBar = false, headerPortalTargetId }: NaiGenerationPanelProps) {
  const { showSnackbar } = useSnackbar()
  const [isModuleSaveModalOpen, setIsModuleSaveModalOpen] = useState(false)
  const [selectedCharacterIndex, setSelectedCharacterIndex] = useState<number | null>(null)
  const [naiForm, setNaiForm] = useState<NAIFormDraft>(DEFAULT_NAI_FORM)
  const [naiModuleName, setNaiModuleName] = useState('NAI Module')
  const [naiModuleDescription, setNaiModuleDescription] = useState('')
  const [naiExposedFieldKeys, setNaiExposedFieldKeys] = useState<string[]>(['prompt', 'negative_prompt', 'characters', 'vibes', 'character_refs', 'seed'])

  const naiUserQuery = useQuery({
    queryKey: ['image-generation-nai-user'],
    queryFn: getNaiUserData,
    retry: false,
  })

  const appSettingsQuery = useQuery({
    queryKey: ['app-settings'],
    queryFn: getAppSettings,
  })

  const connected = naiUserQuery.isSuccess

  const {
    loginMode,
    setLoginMode,
    usernameInput: naiUsernameInput,
    setUsernameInput: setNaiUsernameInput,
    passwordInput: naiPasswordInput,
    setPasswordInput: setNaiPasswordInput,
    tokenInput: naiTokenInput,
    setTokenInput: setNaiTokenInput,
    isAuthModalOpen: isNaiAuthModalOpen,
    setIsAuthModalOpen: setIsNaiAuthModalOpen,
    isLoggingIn: isNaiLoggingIn,
    connectionHint: naiConnectionHint,
    handleSubmit: handleNaiAuthSubmit,
  } = useNaiAuthController({
    refetchUserData: naiUserQuery.refetch,
    showSnackbar,
  })

  const {
    isImageEditorOpen,
    setIsImageEditorOpen,
    pendingImageEditorSave,
    pendingImageEditorSaveInfo,
    editorSaveOptions: imageEditorSaveOptions,
    setEditorSaveOptions: setImageEditorSaveOptions,
    handleOpenImageEditor,
    handleSaveImageEditor,
    handleConfirmImageEditorSave,
    handleCloseImageEditorSaveOptions,
  } = useNaiImageEditorBridge({
    naiForm,
    setNaiForm,
    imageSaveSettings: appSettingsQuery.data?.imageSave ?? DEFAULT_IMAGE_SAVE_SETTINGS,
    showSnackbar,
  })

  const {
    encodingVibeIndex,
    savedVibeSearch,
    setSavedVibeSearch,
    filteredSavedVibes,
    savedVibesLoading,
    savedCharacterReferenceSearch,
    setSavedCharacterReferenceSearch,
    filteredSavedCharacterReferences,
    savedCharacterReferencesLoading,
    isSavingAsset,
    assetSaveTarget,
    assetSaveName,
    setAssetSaveName,
    assetSaveDescription,
    setAssetSaveDescription,
    assetSaveModalTitle,
    assetSaveSubmitLabel,
    closeAssetSaveModal,
    handleOpenVibeSaveModal,
    handleOpenEditVibeFromStore,
    handleLoadVibeFromStore,
    handleDeleteVibeFromStore,
    handleOpenCharacterReferenceSaveModal,
    handleOpenEditCharacterReferenceFromStore,
    handleLoadCharacterReferenceFromStore,
    handleDeleteCharacterReferenceFromStore,
    handleConfirmAssetSave,
    ensureEncodedVibes,
  } = useNaiAssetLibrary({
    naiForm,
    setNaiForm,
    naiUserEnabled: naiUserQuery.isSuccess,
    refetchUserData: naiUserQuery.refetch,
    showSnackbar,
  })

  const naiCostInputs = useMemo(
    () => ({
      width: parseNumberInput(naiForm.width, 1024),
      height: parseNumberInput(naiForm.height, 1024),
      steps: parseNumberInput(naiForm.steps, 28),
      n_samples: clampNaiSampleCount(naiForm.samples),
    }),
    [naiForm.height, naiForm.samples, naiForm.steps, naiForm.width],
  )

  const naiCostQuery = useQuery({
    queryKey: ['image-generation-nai-cost', naiCostInputs, naiUserQuery.data?.subscription.tier, naiUserQuery.data?.anlasBalance],
    queryFn: () =>
      getNaiCostEstimate({
        ...naiCostInputs,
        subscriptionTier: naiUserQuery.data?.subscription.tier ?? 0,
        anlasBalance: naiUserQuery.data?.anlasBalance ?? 0,
      }),
    enabled:
      naiUserQuery.isSuccess &&
      naiCostInputs.width > 0 &&
      naiCostInputs.height > 0 &&
      naiCostInputs.steps > 0 &&
      naiCostInputs.n_samples > 0,
  })

  const naiModuleFieldOptions = useMemo(() => buildNaiModuleFieldOptions(naiForm), [naiForm])
  const supportsCharacterPrompts = useMemo(() => supportsNaiCharacterPrompts(naiForm.model), [naiForm.model])
  const supportsCharacterReference = useMemo(() => supportsNaiCharacterReferences(naiForm.model), [naiForm.model])

  const {
    isNaiGenerating,
    isSavingNaiModule,
    isUpscaling,
    handleNaiGenerate,
    handleUpscale,
    handleCreateNaiModule,
  } = useNaiGenerationActions({
    connected,
    naiForm,
    supportsCharacterPrompts,
    supportsCharacterReference,
    ensureEncodedVibes,
    refetchUserData: naiUserQuery.refetch,
    onHistoryRefresh,
    naiModuleName,
    naiModuleDescription,
    naiExposedFieldKeys,
    naiModuleFieldOptions,
    closeModuleSaveModal: () => setIsModuleSaveModalOpen(false),
    showSnackbar,
  })

  useEffect(() => {
    if (refreshNonce === 0) {
      return
    }

    void naiUserQuery.refetch()
  }, [naiUserQuery, refreshNonce])

  useEffect(() => {
    const allowedKeys = new Set(naiModuleFieldOptions.map((field) => field.key))
    setNaiExposedFieldKeys((current) => current.filter((key) => allowedKeys.has(key)))
  }, [naiModuleFieldOptions])

  useEffect(() => {
    if (naiForm.characterPositionAiChoice || canUseNaiCharacterPositions(naiForm.characters.length)) {
      return
    }

    setNaiForm((current) => ({
      ...current,
      characterPositionAiChoice: true,
    }))
  }, [naiForm.characterPositionAiChoice, naiForm.characters.length])

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

  const handleNaiImageChange = (field: 'sourceImage' | 'maskImage', image?: SelectedImageDraft) => {
    setNaiForm((current) => ({
      ...current,
      [field]: image,
    }))
  }

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

  const handleAddVibe = () => {
    setNaiForm((current) => ({
      ...current,
      vibes: [...current.vibes, { ...EMPTY_NAI_VIBE }],
    }))
  }

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

  const handleRemoveVibe = (index: number) => {
    setNaiForm((current) => ({
      ...current,
      vibes: current.vibes.filter((_, vibeIndex) => vibeIndex !== index),
    }))
  }

  const handleAddCharacterReference = () => {
    setNaiForm((current) => ({
      ...current,
      characterReferences: [...current.characterReferences, { ...EMPTY_NAI_CHARACTER_REFERENCE }],
    }))
  }

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

  const handleRemoveCharacterReference = (index: number) => {
    setNaiForm((current) => ({
      ...current,
      characterReferences: current.characterReferences.filter((_, referenceIndex) => referenceIndex !== index),
    }))
  }

  const naiGenerateButtonLabel = isNaiGenerating
    ? '생성 요청 중…'
    : !connected
      ? '로그인 후 생성'
      : naiCostQuery.isSuccess
        ? naiCostQuery.data.isOpusFree
          ? '생성 (무료)'
          : `생성 (${naiCostQuery.data.estimatedCost} Anlas)`
        : naiCostQuery.isPending
          ? '생성 (계산 중…)'
          : '생성'
  const canUseCharacterPositions = canUseNaiCharacterPositions(naiForm.characters.length)
  const useCharacterPositions = shouldUseNaiCharacterPositions(naiForm)
  const useInlineActionBar = splitPaneScroll || compactActionBar
  const useDrawerCompactChrome = compactActionBar && !splitPaneScroll
  const [headerPortalTarget, setHeaderPortalTarget] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (!useDrawerCompactChrome || !headerPortalTargetId || typeof document === 'undefined') {
      setHeaderPortalTarget(null)
      return
    }

    const resolveTarget = () => {
      setHeaderPortalTarget(document.getElementById(headerPortalTargetId))
    }

    resolveTarget()
    const frame = window.requestAnimationFrame(resolveTarget)
    return () => window.cancelAnimationFrame(frame)
  }, [headerPortalTargetId, useDrawerCompactChrome])

  const actionSection = (
    <NaiActionSection
      variant={useInlineActionBar ? 'inline' : 'card'}
      canUpscale={naiForm.action !== 'generate' && Boolean(naiForm.sourceImage)}
      isUpscaling={isUpscaling}
      isGenerating={isNaiGenerating}
      canGenerate={naiForm.prompt.trim().length > 0}
      generateButtonLabel={naiGenerateButtonLabel}
      costErrorMessage={naiCostQuery.isError ? getErrorMessage(naiCostQuery.error, '예상 비용 계산에 실패했어.') : null}
      onOpenModuleSave={() => setIsModuleSaveModalOpen(true)}
      onUpscale={handleUpscale}
      onReset={() => setNaiForm(DEFAULT_NAI_FORM)}
      onGenerate={handleNaiGenerate}
    />
  )

  const editorSections = (
    <>
      <NaiPromptSection
        prompt={naiForm.prompt}
        negativePrompt={naiForm.negativePrompt}
        onPromptChange={(value) => handleNaiFieldChange('prompt', value)}
        onNegativePromptChange={(value) => handleNaiFieldChange('negativePrompt', value)}
      />

      <section className="space-y-3">
        <Card>
          <CardContent className="space-y-4">
            <SectionHeading
              variant="inside"
              className="border-b border-border/70 pb-4"
              heading="Character Prompt"
              actions={(
                <>
                  <Badge variant="outline">{naiForm.characters.length}</Badge>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    onClick={handleAddCharacterPrompt}
                    disabled={!supportsCharacterPrompts}
                    aria-label="캐릭터 추가"
                    title="캐릭터 추가"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </>
              )}
            />
            <div className="space-y-4">
              {!supportsCharacterPrompts ? (
                <div className="text-xs text-[#ffb4ab]">현재 모델에서는 Character Prompt를 사용할 수 없어.</div>
              ) : (
                <>
                  <ToggleRow variant="detail" className="justify-between rounded-sm border border-border bg-surface-low px-3 py-2.5">
                    <div className="text-sm font-medium text-foreground">AI's Choice</div>
                    <input
                      type="checkbox"
                      checked={naiForm.characterPositionAiChoice}
                      disabled={!canUseCharacterPositions}
                      onChange={(event) => setNaiForm((current) => ({
                        ...current,
                        characterPositionAiChoice: event.target.checked,
                      }))}
                    />
                  </ToggleRow>

                  {useCharacterPositions ? (
                    <NaiCharacterPositionBoard
                      characters={naiForm.characters.map((character, index) => ({
                        label: `Character ${index + 1}`,
                        centerX: character.centerX,
                        centerY: character.centerY,
                      }))}
                      selectedIndex={selectedCharacterIndex}
                      onSelectIndex={setSelectedCharacterIndex}
                      onPositionChange={(index, centerX, centerY) => {
                        handleCharacterPromptChange(index, 'centerX', centerX)
                        handleCharacterPromptChange(index, 'centerY', centerY)
                      }}
                    />
                  ) : null}

                  <div className="space-y-3">
                    {naiForm.characters.map((character, index) => (
                      <div
                        key={`nai-character-${index}`}
                        className={index === selectedCharacterIndex
                          ? 'space-y-3 rounded-sm border border-accent bg-surface-low p-3 ring-1 ring-accent/50'
                          : 'space-y-3 rounded-sm border border-border bg-surface-low p-3'}
                        onClick={() => setSelectedCharacterIndex(index)}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-medium text-foreground">Character {index + 1}</div>
                            <Badge variant="outline">{useCharacterPositions ? `${character.centerX} · ${character.centerY}` : "AI's Choice"}</Badge>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={(event) => {
                              event.stopPropagation()
                              handleRemoveCharacterPrompt(index)
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                            제거
                          </Button>
                        </div>

                        <PromptToggleField
                          tool="nai"
                          positiveValue={character.prompt}
                          negativeValue={character.uc}
                          onPositiveChange={(value) => handleCharacterPromptChange(index, 'prompt', value)}
                          onNegativeChange={(value) => handleCharacterPromptChange(index, 'uc', value)}
                          positiveRows={4}
                          negativeRows={3}
                        />
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <Card>
          <CardContent className="space-y-4">
            <SectionHeading variant="inside" className="border-b border-border/70 pb-4" heading="Settings" />
            <div className="space-y-5">
              <div className="space-y-3">
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Core</div>
                <div className="grid gap-4 md:grid-cols-4">
                  <div className="md:col-span-3">
                    <FormField label="Model">
                      <Select value={naiForm.model} onChange={(event) => handleNaiFieldChange('model', event.target.value)}>
                        {NAI_MODEL_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </Select>
                    </FormField>
                  </div>

                  <FormField label="Action">
                    <Select value={naiForm.action} onChange={(event) => handleNaiFieldChange('action', event.target.value)}>
                      {NAI_ACTION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </Select>
                  </FormField>
                </div>
              </div>

              <div className="space-y-3">
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Sampling</div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <FormField label="Sampler">
                    <Select value={naiForm.sampler} onChange={(event) => handleNaiFieldChange('sampler', event.target.value)}>
                      {NAI_SAMPLER_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </Select>
                  </FormField>

                  <FormField label="Scheduler">
                    <Select value={naiForm.scheduler} onChange={(event) => handleNaiFieldChange('scheduler', event.target.value)}>
                      {NAI_SCHEDULER_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </Select>
                  </FormField>

                  <FormField label="Steps">
                    <Input type="number" min={1} max={100} value={naiForm.steps} onChange={(event) => handleNaiFieldChange('steps', event.target.value)} />
                  </FormField>

                  <FormField label="CFG Scale">
                    <Input type="number" min={1} max={20} step={0.1} value={naiForm.scale} onChange={(event) => handleNaiFieldChange('scale', event.target.value)} />
                  </FormField>
                </div>
              </div>

              <div className="space-y-3">
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Output</div>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  <FormField label="Preset">
                    <Select value={naiForm.resolutionPreset} onChange={(event) => handleResolutionPresetChange(event.target.value)}>
                      {NAI_RESOLUTION_PRESETS.map((preset) => (
                        <option key={preset.key} value={preset.key}>{preset.label}</option>
                      ))}
                      <option value="custom">Custom</option>
                    </Select>
                  </FormField>

                  <FormField label="Width">
                    <Input type="number" min={64} step={64} value={naiForm.width} onChange={(event) => handleNaiFieldChange('width', event.target.value)} />
                  </FormField>

                  <FormField label="Height">
                    <Input type="number" min={64} step={64} value={naiForm.height} onChange={(event) => handleNaiFieldChange('height', event.target.value)} />
                  </FormField>

                  <FormField label="Samples">
                    <Input type="number" min={NAI_SAMPLE_COUNT_MIN} max={NAI_SAMPLE_COUNT_MAX} step={1} value={naiForm.samples} onChange={(event) => handleNaiFieldChange('samples', event.target.value)} />
                  </FormField>

                  <FormField label="Seed">
                    <Input type="number" value={naiForm.seed} onChange={(event) => handleNaiFieldChange('seed', event.target.value)} />
                  </FormField>

                  <div className="space-y-2">
                    <div className="text-sm font-medium text-foreground">Variety+</div>
                    <ToggleRow variant="detail" className="justify-between rounded-sm border border-border bg-surface-low px-3 py-2.5">
                      <div className="text-sm text-foreground">사용</div>
                      <input type="checkbox" checked={naiForm.varietyPlus} onChange={(event) => setNaiForm((current) => ({ ...current, varietyPlus: event.target.checked }))} />
                    </ToggleRow>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {naiForm.action !== 'generate' ? (
        <section className="space-y-3">
          <Card>
            <CardContent className="space-y-4">
              <SectionHeading variant="inside" className="border-b border-border/70 pb-4" heading="Images" />
              <div className="space-y-4">
                <FormField label="Source Image">
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <ImageAttachmentPickerButton label={naiForm.sourceImage ? '소스 이미지 변경' : '소스 이미지 선택'} modalTitle="소스 이미지 선택" onSelect={(image) => handleNaiImageChange('sourceImage', image)} />
                      <Button type="button" variant="secondary" onClick={handleOpenImageEditor} disabled={!naiForm.sourceImage}>
                        {naiForm.action === 'infill' ? '소스/마스크 편집' : '소스 편집'}
                      </Button>
                      {naiForm.sourceImage ? (
                        <Button type="button" variant="ghost" onClick={() => void handleNaiImageChange('sourceImage')}>
                          제거
                        </Button>
                      ) : null}
                    </div>
                    {naiForm.sourceImage ? <NaiSelectedImageCard image={naiForm.sourceImage} alt="NAI source" /> : null}
                  </div>
                </FormField>

                {naiForm.action === 'infill' ? (
                  <FormField label="Mask Image">
                    <div className="space-y-3">
                      <div className="text-xs text-muted-foreground">소스 편집기에서 마스크를 같이 만들 수 있어. 필요하면 외부 마스크를 따로 붙여도 돼.</div>
                      <div className="flex flex-wrap gap-2">
                        <ImageAttachmentPickerButton label={naiForm.maskImage ? '마스크 이미지 변경' : '마스크 이미지 선택'} modalTitle="마스크 이미지 선택" onSelect={(image) => handleNaiImageChange('maskImage', image)} />
                        {naiForm.maskImage ? (
                          <Button type="button" variant="ghost" onClick={() => void handleNaiImageChange('maskImage')}>
                            제거
                          </Button>
                        ) : null}
                      </div>
                      {naiForm.maskImage ? <NaiSelectedImageCard image={naiForm.maskImage} alt="NAI mask" /> : null}
                    </div>
                  </FormField>
                ) : null}

                <div className="space-y-4 rounded-sm border border-border bg-surface-low p-3">
                  <div className="text-sm font-medium text-foreground">Image Options</div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <FormField label="Strength">
                      <ScrubbableNumberInput min={0} max={1} step={0.01} value={naiForm.strength} onChange={(value) => handleNaiFieldChange('strength', value)} />
                    </FormField>
                    <FormField label="Noise">
                      <Input type="number" min={0} max={1} step={0.01} value={naiForm.noise} onChange={(event) => handleNaiFieldChange('noise', event.target.value)} />
                    </FormField>
                  </div>

                  {naiForm.action === 'infill' ? (
                    <ToggleRow variant="detail" className="justify-between rounded-sm border border-border bg-surface-low px-3 py-2.5">
                      <div className="text-sm text-foreground">Original</div>
                      <input type="checkbox" checked={naiForm.addOriginalImage} onChange={(event) => setNaiForm((current) => ({ ...current, addOriginalImage: event.target.checked }))} />
                    </ToggleRow>
                  ) : null}
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
      ) : null}

      <NaiReferencesSection
        supportsCharacterReference={supportsCharacterReference}
        references={naiForm.characterReferences}
        savedReferences={filteredSavedCharacterReferences}
        savedReferenceSearch={savedCharacterReferenceSearch}
        savedReferencesLoading={savedCharacterReferencesLoading}
        onSavedReferenceSearchChange={setSavedCharacterReferenceSearch}
        onAddReference={handleAddCharacterReference}
        onRemoveReference={handleRemoveCharacterReference}
        onReferenceImageChange={handleCharacterReferenceImageChange}
        onReferenceFieldChange={handleCharacterReferenceFieldChange}
        onOpenReferenceSaveModal={handleOpenCharacterReferenceSaveModal}
        onLoadReferenceFromStore={handleLoadCharacterReferenceFromStore}
        onEditReferenceFromStore={handleOpenEditCharacterReferenceFromStore}
        onDeleteReferenceFromStore={(assetId) => void handleDeleteCharacterReferenceFromStore(assetId)}
      />

      <NaiVibesSection
        vibes={naiForm.vibes}
        encodingVibeIndex={encodingVibeIndex}
        savedVibes={filteredSavedVibes}
        savedVibeSearch={savedVibeSearch}
        savedVibesLoading={savedVibesLoading}
        onSavedVibeSearchChange={setSavedVibeSearch}
        onAddVibe={handleAddVibe}
        onRemoveVibe={handleRemoveVibe}
        onVibeImageChange={handleVibeImageChange}
        onVibeFieldChange={handleVibeFieldChange}
        onOpenVibeSaveModal={handleOpenVibeSaveModal}
        onLoadVibeFromStore={handleLoadVibeFromStore}
        onEditVibeFromStore={handleOpenEditVibeFromStore}
        onDeleteVibeFromStore={(assetId) => void handleDeleteVibeFromStore(assetId)}
      />

      {!useInlineActionBar ? actionSection : null}
    </>
  )

  const compactHeaderContent = (
    <div className="space-y-3">
      <NaiConnectionHeader
        connected={connected}
        tierName={naiUserQuery.data?.subscription.tierName}
        anlasBalance={naiUserQuery.data?.anlasBalance}
        onOpenAuth={() => setIsNaiAuthModalOpen(true)}
        compact
      />
      {actionSection}
    </div>
  )

  return (
    <>
      <div className={splitPaneScroll ? 'flex min-h-0 flex-1 flex-col gap-6' : 'space-y-6'}>
        {useInlineActionBar
          ? useDrawerCompactChrome
            ? (headerPortalTarget ? createPortal(compactHeaderContent, headerPortalTarget) : null)
            : (
              <div className="shrink-0 space-y-3 border-b border-border/70 pb-4">
                {compactHeaderContent}
              </div>
            )
          : (
            <NaiConnectionHeader
              connected={connected}
              tierName={naiUserQuery.data?.subscription.tierName}
              anlasBalance={naiUserQuery.data?.anlasBalance}
              onOpenAuth={() => setIsNaiAuthModalOpen(true)}
            />
          )}

        <div className={cn(
          'space-y-6',
          splitPaneScroll && 'min-h-0 flex-1 overflow-y-auto pr-2 pb-1',
          useDrawerCompactChrome && 'px-5 pb-5',
        )}>
          {editorSections}
        </div>
      </div>

      <NaiAuthModal
        open={isNaiAuthModalOpen}
        loginMode={loginMode}
        isSubmitting={isNaiLoggingIn}
        username={naiUsernameInput}
        password={naiPasswordInput}
        token={naiTokenInput}
        connectionHint={naiConnectionHint}
        showStatusHint={naiUserQuery.isError}
        onClose={() => setIsNaiAuthModalOpen(false)}
        onLoginModeChange={setLoginMode}
        onUsernameChange={setNaiUsernameInput}
        onPasswordChange={setNaiPasswordInput}
        onTokenChange={setNaiTokenInput}
        onSubmit={() => void handleNaiAuthSubmit()}
      />

      <NaiAssetSaveModal
        open={assetSaveTarget !== null}
        title={assetSaveModalTitle}
        submitLabel={assetSaveSubmitLabel}
        name={assetSaveName}
        description={assetSaveDescription}
        isSaving={isSavingAsset}
        onClose={closeAssetSaveModal}
        onNameChange={setAssetSaveName}
        onDescriptionChange={setAssetSaveDescription}
        onSave={() => void handleConfirmAssetSave()}
      />

      <NaiModuleSaveModal
        open={isModuleSaveModalOpen}
        moduleName={naiModuleName}
        moduleDescription={naiModuleDescription}
        fieldOptions={naiModuleFieldOptions}
        exposedFieldKeys={naiExposedFieldKeys}
        isSaving={isSavingNaiModule}
        onClose={() => setIsModuleSaveModalOpen(false)}
        onModuleNameChange={setNaiModuleName}
        onModuleDescriptionChange={setNaiModuleDescription}
        onExposedFieldKeysChange={setNaiExposedFieldKeys}
        onSave={() => void handleCreateNaiModule()}
      />

      {isImageEditorOpen ? (
        <Suspense fallback={null}>
          <ImageEditorModal
            open={isImageEditorOpen}
            title={naiForm.action === 'infill' ? 'Source and Mask Editor' : 'Source Image Editor'}
            sourceImageDataUrl={naiForm.sourceImage?.dataUrl}
            sourceFileName={naiForm.sourceImage?.fileName}
            maskImageDataUrl={naiForm.maskImage?.dataUrl}
            enableMaskEditing={naiForm.action === 'infill'}
            onClose={() => setIsImageEditorOpen(false)}
            onSave={handleSaveImageEditor}
          />
        </Suspense>
      ) : null}

      <ImageSaveOptionsModal
        open={pendingImageEditorSave !== null}
        title="이미지 저장"
        options={imageEditorSaveOptions}
        sourceInfo={pendingImageEditorSaveInfo}
        isSaving={false}
        onClose={handleCloseImageEditorSaveOptions}
        onOptionsChange={(patch) => setImageEditorSaveOptions((current) => ({ ...current, ...patch }))}
        onConfirm={() => void handleConfirmImageEditorSave()}
      />
    </>
  )
}


