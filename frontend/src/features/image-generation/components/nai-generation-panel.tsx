import { useConfirm } from '@/components/ui/confirm-dialog'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { Fragment, Suspense, lazy, useCallback, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { ImageSaveOptionsModal } from '@/components/media/image-save-options-modal'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { getNaiCostEstimate, getNaiUserData } from '@/lib/api-image-generation-nai'
import {
  NAI_QUEUE_COUNT_MAX,
  NAI_QUEUE_COUNT_MIN,
  NAI_SAMPLE_COUNT_MAX,
  NAI_SAMPLE_COUNT_MIN,
  clampNaiQueueCount,
  clampNaiSampleCount,
  getErrorMessage,
  parseNumberInput,
  resolveNaiFormEnhance,
  NAI_RESOLUTION_PRESETS,
  buildNaiCharacterPromptPayload,
  buildNaiCharacterReferencePayload,
  buildNaiVibePayload,
  getNaiVibesUnsupportedMessage,
  resolveNaiPromptPresets,
  resolveNaiSamplingSettings,
  supportsNaiTransparentBackground,
  supportsNaiVibes,
} from '../image-generation-shared'
import { getNaiFixedModelSettings, getNaiQualityTags, prependNaiUcPreset } from '@conai/shared'
import {
  buildNaiFormFromHistoryPayload,
  confirmHistorySettingsOverwrite,
  getHistorySettingsLoadedMessage,
  hasNaiPromptContent,
  hasNaiPromptDifference,
} from '../history-settings-mapping'
import { NaiAuthModal } from './nai-auth-modal'
import { NaiAssetSaveModal } from './nai-asset-save-modal'
import { NaiGenerationEditorSections, type NaiEditorBlockNodes } from './nai-generation-editor-sections'
import { GenerationBlockLayout, StackedPluginBlocks } from '../layout/generation-block-layout'
import { useGenerationLayoutSurface } from '../layout/generation-layout-context'
import { stackedLayoutBlocks } from '../layout/generation-layout-ops'
import { NaiActionSection, NaiConnectionHeader, NaiToolbarStatus } from './nai-generation-panel-sections'
import { usePortalTargetById } from './generation-toolbar-status'
import { useGenerationImageSaveOptions } from './use-generation-image-save-options'
import { useHistorySettingsLoad } from './use-history-settings-load'
import { GenerateActionDock } from './generate-action-bar'
import { useNaiAssetLibrary } from './use-nai-asset-library'
import { useNaiAuthController } from './use-nai-auth-controller'
import { useNaiGenerationActions } from './use-nai-generation-actions'
import { useNaiImageEditorBridge } from './use-nai-image-editor-bridge'
import { useNaiFormController } from './use-nai-form-controller'
import { useNaiImageSize } from './nai-generation-panel-helpers'
import { ChatGenerationPresetSaveModal } from '@/features/settings/components/chat-generation-preset-save-modal'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { normalizeTextSegmentSpreadsheetText } from './text-segment-spreadsheet-input'
import { useNaiChatPage } from './use-generation-chat-page'

const ImageEditor = lazy(() => import('@/features/image-editor/image-editor'))

type NaiGenerationPanelProps = {
  onHistoryRefresh: () => void
  splitPaneScroll?: boolean
  compactActionBar?: boolean
  compactActionBarContentTargetId?: string
  /** Page toolbar slot for the connection status; replaces the inline NovelAI header row. */
  statusPortalTargetId?: string
  /** Wide block layout: the panel arranges its sections and the page's result block in the preset's columns. */
  blockLayout?: { result: ReactNode }
}

/** Render the NAI login, generation, and image-editing workflow. */
export function NaiGenerationPanel({
  onHistoryRefresh,
  splitPaneScroll = false,
  compactActionBar = false,
  compactActionBarContentTargetId,
  statusPortalTargetId,
  blockLayout,
}: NaiGenerationPanelProps) {
  const { t, formatNumber } = useI18n()
  const { showSnackbar } = useSnackbar()

  const {
    selectedCharacterIndex,
    setSelectedCharacterIndex,
    naiForm,
    setNaiForm,
    supportsCharacterPrompts,
    supportsCharacterReference,
    canUseCharacterPositions,
    useCharacterPositions,
    resetNaiForm,
    handleNaiFieldChange,
    handleNaiOptionChange,
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
    handleLoadCharacterReference,
    handleRemoveCharacterReference,
  } = useNaiFormController({ showSnackbar })

  // Enhance plans from the source's natural size; read it for any source so one assistant patch can switch to img2img and enhance.
  const sourceImageSize = useNaiImageSize(naiForm.sourceImage?.dataUrl)
  const naiEnhance = resolveNaiFormEnhance(naiForm, sourceImageSize)
  const naiEnhancePlan = naiEnhance?.plan ?? null

  useNaiChatPage(naiForm, setNaiForm, sourceImageSize)

  const confirm = useConfirm()
  useHistorySettingsLoad('novelai', (request) => {
    const { form: nextForm, hasImageInputs } = buildNaiFormFromHistoryPayload(request.payload, naiForm)
    void (async () => {
      if (hasNaiPromptContent(naiForm) && hasNaiPromptDifference(naiForm, nextForm) && !(await confirmHistorySettingsOverwrite(confirm, t))) {
        return
      }

      setNaiForm(nextForm)
      setSelectedCharacterIndex(null)
      showSnackbar({ message: getHistorySettingsLoadedMessage(t, request.historyId, hasImageInputs), tone: 'info' })
    })()
  })

  const naiUserQuery = useQuery({
    queryKey: ['image-generation-nai-user'],
    queryFn: getNaiUserData,
    retry: false,
    refetchInterval: (query) => query.state.data?.connected ? 60_000 : false,
  })

  const connected = naiUserQuery.data?.connected === true
  const { settings: generationSaveSettings, options: generationImageSaveOptions } = useGenerationImageSaveOptions()

  const {
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
    imageSaveSettings: generationSaveSettings,
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
    naiUserEnabled: connected,
    refetchUserData: naiUserQuery.refetch,
    showSnackbar,
  })

  // Enhance runs at the plan's size, so the estimate uses it too.
  const naiCostWidth = naiEnhancePlan?.width ?? parseNumberInput(naiForm.width, 1024)
  const naiCostHeight = naiEnhancePlan?.height ?? parseNumberInput(naiForm.height, 1024)
  // A model with fixed settings runs its own steps, whatever the form stores.
  const naiSampling = resolveNaiSamplingSettings(naiForm)
  const naiCostInputs = useMemo(
    () => {
      // 계산기가 모델링하는 img2img strength 만 넘긴다(인페인트/바이브 비용은 검증된 규칙이 없다).
      const strength = parseNumberInput(naiForm.strength, 1)
      return {
        width: naiCostWidth,
        height: naiCostHeight,
        steps: parseNumberInput(naiSampling.steps, 28),
        n_samples: clampNaiSampleCount(naiForm.samples),
        model: naiForm.model,
        action: naiForm.action,
        ...(naiForm.action === 'img2img' && strength > 0 && strength <= 1 ? { strength } : {}),
      }
    },
    [naiCostHeight, naiCostWidth, naiForm.action, naiForm.model, naiForm.samples, naiSampling.steps, naiForm.strength],
  )

  const naiCostQuery = useQuery({
    queryKey: ['image-generation-nai-cost', naiCostInputs, naiUserQuery.data?.subscription.tier, naiUserQuery.data?.anlasBalance, naiUserQuery.data?.opusRemainingPercent],
    queryFn: () =>
      getNaiCostEstimate({
        ...naiCostInputs,
        subscriptionTier: naiUserQuery.data?.subscription.tier ?? 0,
        anlasBalance: naiUserQuery.data?.anlasBalance ?? 0,
        opusRemainingPercent: naiUserQuery.data?.opusRemainingPercent ?? null,
      }),
    enabled:
      connected &&
      naiEnhance?.issue !== 'size_pending' &&
      naiCostInputs.width > 0 &&
      naiCostInputs.height > 0 &&
      naiCostInputs.steps > 0 &&
      naiCostInputs.n_samples > 0,
  })

  const naiCostEstimate = naiCostQuery.isSuccess ? naiCostQuery.data : null
  // The estimate is per job; one click queues `queueCount` jobs. Opus-free is decided per job, so free stays free,
  // except Max: its server upscale costs extra, so it is never shown as free.
  const naiQueueCount = clampNaiQueueCount(naiForm.queueCount)
  const naiServerUpscale = naiEnhancePlan?.serverUpscale === true
  const naiFreePerJob = naiCostEstimate?.isOpusFree === true && !naiServerUpscale
  const naiClickCost = naiCostEstimate && !naiFreePerJob ? naiCostEstimate.estimatedCost * naiQueueCount : 0
  // 잔액/해상도 기준 최대 장수로 입력 상한만 좁힌다(0 이어도 입력은 1 까지 허용).
  const naiMaxSampleCount = naiCostEstimate
    ? Math.min(NAI_SAMPLE_COUNT_MAX, Math.max(NAI_SAMPLE_COUNT_MIN, naiCostEstimate.maxSamples))
    : NAI_SAMPLE_COUNT_MAX
  // 예상치라 생성은 막지 않고 버튼 근처에 경고만 보여 준다.
  const naiCostWarningMessage = naiCostEstimate
    ? [
        naiClickCost > (naiUserQuery.data?.anlasBalance ?? 0)
          ? t(
              { ko: 'Anlas 가 부족할 수 있어 (예상 {cost} / 보유 {balance}). 예상치라 생성은 막지 않아.', en: 'You may not have enough Anlas (est. {cost} / balance {balance}). This is an estimate, so generation is not blocked.' },
              { cost: formatNumber(naiClickCost), balance: formatNumber(naiUserQuery.data?.anlasBalance ?? 0) },
            )
          : null,
        naiCostInputs.n_samples > naiMaxSampleCount
          ? t(
              { ko: '현재 크기/잔액으로는 최대 {max}장까지 권장돼.', en: 'Up to {max} images are recommended at this size and balance.' },
              { max: formatNumber(naiMaxSampleCount) },
            )
          : null,
      ].filter(Boolean).join(' ') || null
    : null
  const naiCostErrorMessage = naiCostQuery.isError
    ? getErrorMessage(naiCostQuery.error, t('image-generation.components.nai.generation.panel.failed.to.estimate.the.cost'))
    : naiCostWarningMessage
  const {
    isNaiGenerating,
    isUpscaling,
    handleNaiGenerate,
    handleUpscale,
  } = useNaiGenerationActions({
    connected,
    naiForm,
    sourceImageSize,
    supportsCharacterPrompts,
    supportsCharacterReference,
    ensureEncodedVibes,
    refetchUserData: naiUserQuery.refetch,
    onHistoryRefresh,
    imageSaveOptions: generationImageSaveOptions,
    showSnackbar,
  })

  const handleOpenNaiAuthModal = useCallback(() => setIsNaiAuthModalOpen(true), [setIsNaiAuthModalOpen])
  const handleCloseNaiAuthModal = useCallback(() => setIsNaiAuthModalOpen(false), [setIsNaiAuthModalOpen])
  const handleSubmitNaiAuthModal = useCallback(() => void handleNaiAuthSubmit(), [handleNaiAuthSubmit])
  const handleCloseImageEditor = useCallback(() => setIsImageEditorOpen(false), [setIsImageEditorOpen])
  const { canEditImages } = useImagePermissions()
  const handleImageEditorSaveOptionsChange = useCallback((patch: Partial<typeof imageEditorSaveOptions>) => {
    setImageEditorSaveOptions((current) => ({ ...current, ...patch }))
  }, [setImageEditorSaveOptions])
  const handleConfirmImageEditorSaveModal = useCallback(() => void handleConfirmImageEditorSave(), [handleConfirmImageEditorSave])

  const naiGenerateButtonLabel = isNaiGenerating
    ? t('image-generation.components.nai.generation.panel.submitting.generation')
    : !connected
      ? t('image-generation.components.nai.generation.panel.log.in.to.generate')
      : t('image-generation.components.nai.generation.panel.generate')
  const naiGenerateButtonSuffix = !connected || isNaiGenerating
    ? undefined
    : naiCostQuery.isSuccess
      ? naiFreePerJob
        ? t({ ko: '무료', en: 'free' })
        : naiServerUpscale
          ? t({ ko: '{cost}+ Anlas', en: '{cost}+ Anlas' }, { cost: formatNumber(naiClickCost) })
          : t({ ko: '{cost} Anlas', en: '{cost} Anlas' }, { cost: formatNumber(naiClickCost) })
      : naiCostQuery.isPending
        ? t({ ko: '계산 중…', en: 'calculating…' })
        : undefined
  const naiGenerateButtonSuffixHint = naiGenerateButtonSuffix && naiCostQuery.isSuccess && naiServerUpscale
    ? t({ ko: 'Max의 서버 업스케일 비용은 예상에 들어 있지 않아.', en: 'The Max server upscale adds a cost that is not in this estimate.' })
    : undefined
  const naiRepeat = {
    value: naiForm.queueCount,
    min: NAI_QUEUE_COUNT_MIN,
    max: NAI_QUEUE_COUNT_MAX,
    onChange: (value: string) => handleNaiOptionChange({ queueCount: value }),
  }
  const useInlineActionBar = splitPaneScroll || compactActionBar
  const useDrawerCompactChrome = compactActionBar && !splitPaneScroll
  const compactActionBarPortalTarget = usePortalTargetById(useDrawerCompactChrome ? compactActionBarContentTargetId : undefined)
  const statusPortalTarget = usePortalTargetById(statusPortalTargetId)

  const [isChatPresetModalOpen, setIsChatPresetModalOpen] = useState(false)
  const canSaveChatPreset = useAuthStatusQuery().data?.isAdmin === true
  const chatPresetSizeLabel = NAI_RESOLUTION_PRESETS.find((preset) => preset.key === naiForm.resolutionPreset)?.label ?? `${naiForm.width}×${naiForm.height}`
  /** The form as a chat generation preset: the prompt becomes the fixed prefix and the model writes only the scene. */
  const buildChatPreset = async () => {
    // Checked before encoding: a V5 preset with vibes would fail on every run.
    if (!supportsNaiVibes(naiForm.model) && naiForm.vibes.length > 0) {
      showSnackbar({ message: getNaiVibesUnsupportedMessage(t), tone: 'error' })
      return null
    }
    const encodedVibes = await ensureEncodedVibes()
    if (!encodedVibes) return null
    // Chat presets have no preset fields, so the quality tags and UC text go into the fixed prompt text.
    const promptPresets = resolveNaiPromptPresets(naiForm)
    // A model with fixed settings drops the typed negative: only its UC preset text remains.
    const negativePrompt = getNaiFixedModelSettings(naiForm.model) ? '' : normalizeTextSegmentSpreadsheetText(naiForm.negativePrompt).trim()
    return {
      kind: 'nai' as const,
      comfyui: null,
      nai: {
        model: naiForm.model,
        sampler: naiSampling.sampler,
        noiseSchedule: naiForm.scheduler,
        steps: Number(naiSampling.steps) || 28,
        scale: Number(naiForm.scale) || 5,
        varietyPlus: naiForm.varietyPlus,
        transparentBackground: naiForm.transparentBackground && supportsNaiTransparentBackground(naiForm.model),
        promptPrefix: normalizeTextSegmentSpreadsheetText(naiForm.prompt).trim(),
        promptSuffix: promptPresets.qualityToggle ? (getNaiQualityTags(naiForm.model) ?? '').replace(/^,\s*/, '') : '',
        negativePrompt: prependNaiUcPreset(naiForm.model, negativePrompt, promptPresets.ucPreset) ?? negativePrompt,
        sizes: [{ label: chatPresetSizeLabel, width: Number(naiForm.width), height: Number(naiForm.height) }],
        characters: supportsCharacterPrompts ? buildNaiCharacterPromptPayload(naiForm.characters) : [],
        useCoords: useCharacterPositions,
        vibes: buildNaiVibePayload(encodedVibes),
        characterRefs: buildNaiCharacterReferencePayload(naiForm.characterReferences),
      },
    }
  }

  const sharedActionSectionProps = {
    canUpscale: naiForm.action !== 'generate' && Boolean(naiForm.sourceImage),
    isUpscaling,
    isGenerating: isNaiGenerating,
    canGenerate: connected && naiForm.prompt.trim().length > 0,
    generateButtonLabel: naiGenerateButtonLabel,
    generateButtonSuffix: naiGenerateButtonSuffix,
    generateButtonSuffixHint: naiGenerateButtonSuffixHint,
    costErrorMessage: naiCostErrorMessage,
    repeat: naiRepeat,
    onUpscale: handleUpscale,
    onReset: () => void resetNaiForm(),
    onGenerate: handleNaiGenerate,
    onSaveChatPreset: canSaveChatPreset ? () => setIsChatPresetModalOpen(true) : undefined,
  } satisfies Omit<Parameters<typeof NaiActionSection>[0], 'variant'>

  const actionSection = (
    <NaiActionSection
      variant="inline"
      {...sharedActionSectionProps}
    />
  )

  const compactActionSection = (
    <NaiActionSection
      variant="sticky"
      {...sharedActionSectionProps}
    />
  )

  // Narrow screens stack the preset's visible sections in column order; the generate bar keeps its own sticky slot.
  const { preset: layoutPreset } = useGenerationLayoutSurface('nai')
  const renderEditorBlocks = (blocks: NaiEditorBlockNodes) => blockLayout
    ? <GenerationBlockLayout surface="nai" blocks={{ ...blocks, action: actionSection, result: blockLayout.result }} />
    : (
      <>
        {stackedLayoutBlocks(layoutPreset).map((block) => (
          <Fragment key={block}>
            {block in blocks ? blocks[block as keyof NaiEditorBlockNodes] : <StackedPluginBlocks surface="nai" block={block} />}
          </Fragment>
        ))}
      </>
    )

  const editorSections = (
    <NaiGenerationEditorSections
      naiForm={naiForm}
      setNaiForm={setNaiForm}
      sourceImageSize={sourceImageSize}
      handleNaiOptionChange={handleNaiOptionChange}
      selectedCharacterIndex={selectedCharacterIndex}
      setSelectedCharacterIndex={setSelectedCharacterIndex}
      supportsCharacterPrompts={supportsCharacterPrompts}
      supportsCharacterReference={supportsCharacterReference}
      canUseCharacterPositions={canUseCharacterPositions}
      maxSampleCount={naiMaxSampleCount}
      useCharacterPositions={useCharacterPositions}
      savedCharacterReferenceSearch={savedCharacterReferenceSearch}
      setSavedCharacterReferenceSearch={setSavedCharacterReferenceSearch}
      filteredSavedCharacterReferences={filteredSavedCharacterReferences}
      savedCharacterReferencesLoading={savedCharacterReferencesLoading}
      savedVibeSearch={savedVibeSearch}
      setSavedVibeSearch={setSavedVibeSearch}
      filteredSavedVibes={filteredSavedVibes}
      savedVibesLoading={savedVibesLoading}
      naiConnected={connected}
      encodingVibeIndex={encodingVibeIndex}
      handleNaiFieldChange={handleNaiFieldChange}
      handleResolutionPresetChange={handleResolutionPresetChange}
      handleOpenImageEditor={handleOpenImageEditor}
      handleNaiImageChange={handleNaiImageChange}
      handleAddCharacterPrompt={handleAddCharacterPrompt}
      handleCharacterPromptChange={handleCharacterPromptChange}
      handleRemoveCharacterPrompt={handleRemoveCharacterPrompt}
      handleAddCharacterReference={handleAddCharacterReference}
      handleCharacterReferenceFieldChange={handleCharacterReferenceFieldChange}
      handleCharacterReferenceImageChange={handleCharacterReferenceImageChange}
      handleLoadCharacterReference={handleLoadCharacterReference}
      handleRemoveCharacterReference={handleRemoveCharacterReference}
      handleOpenCharacterReferenceSaveModal={handleOpenCharacterReferenceSaveModal}
      handleLoadCharacterReferenceFromStore={handleLoadCharacterReferenceFromStore}
      handleOpenEditCharacterReferenceFromStore={handleOpenEditCharacterReferenceFromStore}
      handleDeleteCharacterReferenceFromStore={handleDeleteCharacterReferenceFromStore}
      handleAddVibe={handleAddVibe}
      handleVibeFieldChange={handleVibeFieldChange}
      handleVibeImageChange={handleVibeImageChange}
      handleRemoveVibe={handleRemoveVibe}
      handleOpenVibeSaveModal={handleOpenVibeSaveModal}
      handleLoadVibeFromStore={handleLoadVibeFromStore}
      handleOpenEditVibeFromStore={handleOpenEditVibeFromStore}
      handleDeleteVibeFromStore={handleDeleteVibeFromStore}
      actionSection={actionSection}
      showActionSection={!useInlineActionBar}
      renderBlocks={renderEditorBlocks}
    />
  )

  const compactHeaderContent = (
    <div className="space-y-3">
      <NaiConnectionHeader
        connected={connected}
        tierName={naiUserQuery.data?.subscription.tierName}
        anlasBalance={naiUserQuery.data?.anlasBalance}
        opusRemainingPercent={naiUserQuery.data?.opusRemainingPercent}
        onOpenAuth={handleOpenNaiAuthModal}
        compact
      />
    </div>
  )

  return (
    <>
      {blockLayout ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {statusPortalTarget ? createPortal(
            <NaiToolbarStatus
              connected={connected}
              tierName={naiUserQuery.data?.subscription.tierName}
              anlasBalance={naiUserQuery.data?.anlasBalance}
              opusRemainingPercent={naiUserQuery.data?.opusRemainingPercent}
              onOpenAuth={handleOpenNaiAuthModal}
            />,
            statusPortalTarget,
          ) : null}
          {editorSections}
        </div>
      ) : (
      <div className={splitPaneScroll ? 'flex min-h-0 flex-1 flex-col gap-6' : 'space-y-6'}>
        {statusPortalTargetId
          ? (statusPortalTarget ? createPortal(
            <NaiToolbarStatus
              connected={connected}
              tierName={naiUserQuery.data?.subscription.tierName}
              anlasBalance={naiUserQuery.data?.anlasBalance}
              opusRemainingPercent={naiUserQuery.data?.opusRemainingPercent}
              onOpenAuth={handleOpenNaiAuthModal}
            />,
            statusPortalTarget,
          ) : null)
          : useInlineActionBar
          ? (
              <div className="shrink-0 space-y-3">
                {compactHeaderContent}
              </div>
            )
          : (
            <NaiConnectionHeader
              connected={connected}
              tierName={naiUserQuery.data?.subscription.tierName}
              anlasBalance={naiUserQuery.data?.anlasBalance}
              opusRemainingPercent={naiUserQuery.data?.opusRemainingPercent}
              onOpenAuth={handleOpenNaiAuthModal}
            />
          )}

        <div className={cn(
          'space-y-6',
          splitPaneScroll && 'min-h-0 flex-1 overflow-y-auto pr-2 pb-1',
        )}>
          {useDrawerCompactChrome && compactActionBarPortalTarget ? createPortal(compactActionSection, compactActionBarPortalTarget) : null}
          {editorSections}
        </div>

        {/* 생성 버튼·결과 그룹은 편집 영역 아래에 고정해 스크롤 위치와 상관없이 바로 누를 수 있게 한다. */}
        {useInlineActionBar && !useDrawerCompactChrome ? <GenerateActionDock>{actionSection}</GenerateActionDock> : null}
      </div>
      )}

      <ChatGenerationPresetSaveModal
        open={isChatPresetModalOpen}
        build={buildChatPreset}
        summary={t({ ko: '{model} · {size} · 스텝 {steps} · CFG {scale}', en: '{model} · {size} · {steps} steps · CFG {scale}' }, { model: naiForm.model, size: chatPresetSizeLabel, steps: naiSampling.steps, scale: naiForm.scale })}
        onClose={() => setIsChatPresetModalOpen(false)}
      />

      <NaiAuthModal
        open={isNaiAuthModalOpen}
        isSubmitting={isNaiLoggingIn}
        token={naiTokenInput}
        connectionHint={naiConnectionHint}
        showStatusHint={naiUserQuery.isError}
        onClose={handleCloseNaiAuthModal}
        onTokenChange={setNaiTokenInput}
        onSubmit={handleSubmitNaiAuthModal}
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

      {isImageEditorOpen ? (
        <Suspense fallback={null}>
          <ImageEditor
            open={isImageEditorOpen}
            sourceUrl={naiForm.sourceImage?.dataUrl}
            sourceFileName={naiForm.sourceImage?.fileName}
            maskUrl={naiForm.maskImage?.dataUrl}
            enableMaskEditing={naiForm.action === 'infill'}
            enableAiErase={canEditImages}
            onClose={handleCloseImageEditor}
            onSave={handleSaveImageEditor}
          />
        </Suspense>
      ) : null}

      <ImageSaveOptionsModal
        open={pendingImageEditorSave !== null}
        title={t('image-generation.components.nai.generation.panel.save.image')}
        options={imageEditorSaveOptions}
        sourceInfo={pendingImageEditorSaveInfo}
        isSaving={false}
        onClose={handleCloseImageEditorSaveOptions}
        onOptionsChange={handleImageEditorSaveOptionsChange}
        onConfirm={handleConfirmImageEditorSaveModal}
      />
    </>
  )
}


