import { useConfirm } from '@/components/ui/confirm-dialog'
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { ImageSaveOptionsModal } from '@/components/media/image-save-options-modal'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { DEFAULT_IMAGE_SAVE_SETTINGS } from '@/lib/image-save-output'
import { getNaiCostEstimate, getNaiUserData } from '@/lib/api-image-generation-nai'
import { getAppSettings } from '@/lib/api-settings-general'
import {
  NAI_SAMPLE_COUNT_MAX,
  NAI_SAMPLE_COUNT_MIN,
  clampNaiSampleCount,
  getErrorMessage,
  parseNumberInput,
} from '../image-generation-shared'
import { consumeHistorySettingsLoad, usePendingHistorySettingsLoad } from '../history-settings-load-store'
import {
  buildNaiFormFromHistoryPayload,
  confirmHistorySettingsOverwrite,
  getHistorySettingsLoadedMessage,
  hasNaiPromptContent,
  hasNaiPromptDifference,
} from '../history-settings-mapping'
import { NaiAuthModal } from './nai-auth-modal'
import { NaiAssetSaveModal } from './nai-asset-save-modal'
import { NaiGenerationEditorSections } from './nai-generation-editor-sections'
import { NaiActionSection, NaiConnectionHeader } from './nai-generation-panel-sections'
import { useNaiAssetLibrary } from './use-nai-asset-library'
import { useNaiAuthController } from './use-nai-auth-controller'
import { useNaiGenerationActions } from './use-nai-generation-actions'
import { useNaiImageEditorBridge } from './use-nai-image-editor-bridge'
import { useNaiFormController } from './use-nai-form-controller'

const ImageEditorModal = lazy(() => import('@/features/image-editor/image-editor-modal'))

type NaiGenerationPanelProps = {
  onHistoryRefresh: () => void
  splitPaneScroll?: boolean
  compactActionBar?: boolean
  headerPortalTargetId?: string
  compactActionBarContentTargetId?: string
}

/** Render the NAI login, generation, and image-editing workflow. */
export function NaiGenerationPanel({
  onHistoryRefresh,
  splitPaneScroll = false,
  compactActionBar = false,
  headerPortalTargetId,
  compactActionBarContentTargetId,
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
  } = useNaiFormController({ showSnackbar })

  const confirm = useConfirm()
  const pendingHistorySettingsLoad = usePendingHistorySettingsLoad()
  const handledHistorySettingsLoadNonceRef = useRef(0)
  useEffect(() => {
    const request = pendingHistorySettingsLoad
    if (!request || request.serviceType !== 'novelai' || handledHistorySettingsLoadNonceRef.current === request.nonce) {
      return
    }

    handledHistorySettingsLoadNonceRef.current = request.nonce
    consumeHistorySettingsLoad(request.nonce)
    const { form: nextForm, hasImageInputs } = buildNaiFormFromHistoryPayload(request.payload, naiForm)
    void (async () => {
      if (hasNaiPromptContent(naiForm) && hasNaiPromptDifference(naiForm, nextForm) && !(await confirmHistorySettingsOverwrite(confirm, t))) {
        return
      }

      setNaiForm(nextForm)
      setSelectedCharacterIndex(null)
      showSnackbar({ message: getHistorySettingsLoadedMessage(t, request.historyId, hasImageInputs), tone: 'info' })
    })()
  }, [confirm, naiForm, pendingHistorySettingsLoad, setNaiForm, setSelectedCharacterIndex, showSnackbar, t])

  const naiUserQuery = useQuery({
    queryKey: ['image-generation-nai-user'],
    queryFn: getNaiUserData,
    retry: false,
  })

  const appSettingsQuery = useQuery({
    queryKey: ['app-settings'],
    queryFn: getAppSettings,
  })

  const connected = naiUserQuery.data?.connected === true
  const generationSaveSettings = appSettingsQuery.data?.imageSave ?? DEFAULT_IMAGE_SAVE_SETTINGS

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

  const naiCostInputs = useMemo(
    () => {
      // 계산기가 모델링하는 img2img strength 만 넘긴다(인페인트/바이브 비용은 검증된 규칙이 없다).
      const strength = parseNumberInput(naiForm.strength, 1)
      return {
        width: parseNumberInput(naiForm.width, 1024),
        height: parseNumberInput(naiForm.height, 1024),
        steps: parseNumberInput(naiForm.steps, 28),
        n_samples: clampNaiSampleCount(naiForm.samples),
        ...(naiForm.action === 'img2img' && strength > 0 && strength <= 1 ? { strength } : {}),
      }
    },
    [naiForm.action, naiForm.height, naiForm.samples, naiForm.steps, naiForm.strength, naiForm.width],
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
      connected &&
      naiCostInputs.width > 0 &&
      naiCostInputs.height > 0 &&
      naiCostInputs.steps > 0 &&
      naiCostInputs.n_samples > 0,
  })

  const naiCostEstimate = naiCostQuery.isSuccess ? naiCostQuery.data : null
  // 잔액/해상도 기준 최대 장수로 입력 상한만 좁힌다(0 이어도 입력은 1 까지 허용).
  const naiMaxSampleCount = naiCostEstimate
    ? Math.min(NAI_SAMPLE_COUNT_MAX, Math.max(NAI_SAMPLE_COUNT_MIN, naiCostEstimate.maxSamples))
    : NAI_SAMPLE_COUNT_MAX
  // 예상치라 생성은 막지 않고 버튼 근처에 경고만 보여 준다.
  const naiCostWarningMessage = naiCostEstimate
    ? [
        !naiCostEstimate.canAfford
          ? t(
              { ko: 'Anlas 가 부족할 수 있어 (예상 {cost} / 보유 {balance}). 예상치라 생성은 막지 않아.', en: 'You may not have enough Anlas (est. {cost} / balance {balance}). This is an estimate, so generation is not blocked.' },
              { cost: formatNumber(naiCostEstimate.estimatedCost), balance: formatNumber(naiUserQuery.data?.anlasBalance ?? 0) },
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
  const generationImageSaveOptions = useMemo(() => ({
    format: generationSaveSettings.defaultFormat,
    quality: generationSaveSettings.quality,
    resizeEnabled: generationSaveSettings.resizeEnabled,
    maxWidth: generationSaveSettings.maxWidth,
    maxHeight: generationSaveSettings.maxHeight,
  }), [
    generationSaveSettings.defaultFormat,
    generationSaveSettings.maxHeight,
    generationSaveSettings.maxWidth,
    generationSaveSettings.quality,
    generationSaveSettings.resizeEnabled,
  ])

  const {
    isNaiGenerating,
    isUpscaling,
    handleNaiGenerate,
    handleUpscale,
  } = useNaiGenerationActions({
    connected,
    naiForm,
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
      ? naiCostQuery.data.isOpusFree
        ? t({ ko: '(무료)', en: '(free)' })
        : t({ ko: '({cost} Anlas)', en: '({cost} Anlas)' }, { cost: formatNumber(naiCostQuery.data.estimatedCost) })
      : naiCostQuery.isPending
        ? t({ ko: '(계산 중…)', en: '(calculating…)' })
        : undefined
  const useInlineActionBar = splitPaneScroll || compactActionBar
  const useDrawerCompactChrome = compactActionBar && !splitPaneScroll
  const [headerPortalTarget, setHeaderPortalTarget] = useState<HTMLElement | null>(null)
  const [compactActionBarPortalTarget, setCompactActionBarPortalTarget] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (!useDrawerCompactChrome || typeof document === 'undefined') {
      setHeaderPortalTarget(null)
      setCompactActionBarPortalTarget(null)
      return
    }

    const resolveTargets = () => {
      setHeaderPortalTarget(headerPortalTargetId ? document.getElementById(headerPortalTargetId) : null)
      setCompactActionBarPortalTarget(compactActionBarContentTargetId ? document.getElementById(compactActionBarContentTargetId) : null)
    }

    resolveTargets()
    const frame = window.requestAnimationFrame(resolveTargets)
    return () => window.cancelAnimationFrame(frame)
  }, [compactActionBarContentTargetId, headerPortalTargetId, useDrawerCompactChrome])

  const sharedActionSectionProps = {
    canUpscale: naiForm.action !== 'generate' && Boolean(naiForm.sourceImage),
    isUpscaling,
    isGenerating: isNaiGenerating,
    canGenerate: naiForm.prompt.trim().length > 0,
    generateButtonLabel: naiGenerateButtonLabel,
    generateButtonSuffix: naiGenerateButtonSuffix,
    costErrorMessage: naiCostErrorMessage,
    onUpscale: handleUpscale,
    onReset: () => void resetNaiForm(),
    onGenerate: handleNaiGenerate,
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

  const editorSections = (
    <NaiGenerationEditorSections
      naiForm={naiForm}
      setNaiForm={setNaiForm}
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
    />
  )

  const compactHeaderContent = (
    <div className="space-y-3">
      <NaiConnectionHeader
        connected={connected}
        tierName={naiUserQuery.data?.subscription.tierName}
        anlasBalance={naiUserQuery.data?.anlasBalance}
        onOpenAuth={handleOpenNaiAuthModal}
        compact
      />
      {useDrawerCompactChrome ? null : actionSection}
    </div>
  )

  return (
    <>
      <div className={splitPaneScroll ? 'flex min-h-0 flex-1 flex-col gap-6' : 'space-y-6'}>
        {useInlineActionBar
          ? useDrawerCompactChrome
            ? (headerPortalTarget ? createPortal(compactHeaderContent, headerPortalTarget) : null)
            : (
              <div className="shrink-0 space-y-3">
                {compactHeaderContent}
              </div>
            )
          : (
            <NaiConnectionHeader
              connected={connected}
              tierName={naiUserQuery.data?.subscription.tierName}
              anlasBalance={naiUserQuery.data?.anlasBalance}
              onOpenAuth={handleOpenNaiAuthModal}
            />
          )}

        <div className={cn(
          'space-y-6',
          splitPaneScroll && 'min-h-0 flex-1 overflow-y-auto pr-2 pb-1',
          useDrawerCompactChrome && 'px-5 pb-5',
        )}>
          {useDrawerCompactChrome && compactActionBarPortalTarget ? createPortal(compactActionSection, compactActionBarPortalTarget) : null}
          {editorSections}
        </div>
      </div>

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
          <ImageEditorModal
            open={isImageEditorOpen}
            title={naiForm.action === 'infill' ? t({ ko: '원본·마스크 편집기', en: 'Source and Mask Editor' }) : t({ ko: '원본 이미지 편집기', en: 'Source Image Editor' })}
            sourceImageDataUrl={naiForm.sourceImage?.dataUrl}
            sourceFileName={naiForm.sourceImage?.fileName}
            maskImageDataUrl={naiForm.maskImage?.dataUrl}
            enableMaskEditing={naiForm.action === 'infill'}
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


