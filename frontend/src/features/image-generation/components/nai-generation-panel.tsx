import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { ImageSaveOptionsModal } from '@/components/media/image-save-options-modal'
import { useSnackbar } from '@/components/ui/snackbar-context'
import type { ImageSaveSettings } from '@/types/settings'
import { cn } from '@/lib/utils'
import { DEFAULT_IMAGE_SAVE_SETTINGS } from '@/lib/image-save-output'
import {
  getAppSettings,
  getNaiCostEstimate,
  getNaiUserData,
} from '@/lib/api'
import {
  clampNaiSampleCount,
  getErrorMessage,
  parseNumberInput,
} from '../image-generation-shared'
import { NaiAuthModal } from './nai-auth-modal'
import { NaiAssetSaveModal } from './nai-asset-save-modal'
import { NaiGenerationEditorSections } from './nai-generation-editor-sections'
import { NaiModuleSaveModal } from './nai-module-save-modal'
import { NaiActionSection, NaiConnectionHeader } from './nai-generation-panel-sections'
import { useNaiAssetLibrary } from './use-nai-asset-library'
import { useNaiAuthController } from './use-nai-auth-controller'
import { useNaiGenerationActions } from './use-nai-generation-actions'
import { useNaiImageEditorBridge } from './use-nai-image-editor-bridge'
import { useNaiFormController } from './use-nai-form-controller'

const ImageEditorModal = lazy(() => import('@/features/image-editor/image-editor-modal'))

type NaiGenerationPanelProps = {
  refreshNonce: number
  onHistoryRefresh: () => void
  splitPaneScroll?: boolean
  compactActionBar?: boolean
  headerPortalTargetId?: string
  compactActionBarContentTargetId?: string
}

/** Render the NAI login, generation, and module-authoring workflow. */
export function NaiGenerationPanel({
  refreshNonce,
  onHistoryRefresh,
  splitPaneScroll = false,
  compactActionBar = false,
  headerPortalTargetId,
  compactActionBarContentTargetId,
}: NaiGenerationPanelProps) {
  const { showSnackbar } = useSnackbar()
  const [isModuleSaveModalOpen, setIsModuleSaveModalOpen] = useState(false)
  const [isGenerationSaveOptionsOpen, setIsGenerationSaveOptionsOpen] = useState(false)
  const [generationSaveOptions, setGenerationSaveOptions] = useState<ImageSaveSettings>(DEFAULT_IMAGE_SAVE_SETTINGS)

  const {
    selectedCharacterIndex,
    setSelectedCharacterIndex,
    naiForm,
    setNaiForm,
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
  } = useNaiFormController({ showSnackbar })

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

  useEffect(() => {
    if (!appSettingsQuery.data?.imageSave) {
      return
    }

    setGenerationSaveOptions((current) => current === DEFAULT_IMAGE_SAVE_SETTINGS ? appSettingsQuery.data.imageSave : current)
  }, [appSettingsQuery.data?.imageSave])

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
    imageSaveOptions: {
      format: generationSaveOptions.defaultFormat,
      quality: generationSaveOptions.quality,
      resizeEnabled: generationSaveOptions.resizeEnabled,
      maxWidth: generationSaveOptions.maxWidth,
      maxHeight: generationSaveOptions.maxHeight,
    },
    closeModuleSaveModal: () => setIsModuleSaveModalOpen(false),
    showSnackbar,
  })

  const refetchNaiUserData = naiUserQuery.refetch

  useEffect(() => {
    if (refreshNonce === 0) {
      return
    }

    void refetchNaiUserData()
  }, [refreshNonce, refetchNaiUserData])

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

  const generationSaveSourceInfo = useMemo(() => {
    const width = parseNumberInput(naiForm.width, 1024)
    const height = parseNumberInput(naiForm.height, 1024)

    if (width <= 0 || height <= 0) {
      return null
    }

    return {
      width,
      height,
      mimeType: 'image/png',
      fileSize: null,
    }
  }, [naiForm.height, naiForm.width])

  const sharedActionSectionProps = {
    canUpscale: naiForm.action !== 'generate' && Boolean(naiForm.sourceImage),
    isUpscaling,
    isGenerating: isNaiGenerating,
    canGenerate: naiForm.prompt.trim().length > 0,
    generateButtonLabel: naiGenerateButtonLabel,
    costErrorMessage: naiCostQuery.isError ? getErrorMessage(naiCostQuery.error, '예상 비용 계산에 실패했어.') : null,
    onOpenModuleSave: () => setIsModuleSaveModalOpen(true),
    onOpenSaveOptions: () => setIsGenerationSaveOptionsOpen(true),
    onUpscale: handleUpscale,
    onReset: resetNaiForm,
    onGenerate: handleNaiGenerate,
  } satisfies Omit<Parameters<typeof NaiActionSection>[0], 'variant'>

  const actionSection = (
    <NaiActionSection
      variant={useInlineActionBar ? 'inline' : 'card'}
      {...sharedActionSectionProps}
    />
  )

  const compactActionSection = (
    <NaiActionSection
      variant="compact"
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
        onOpenAuth={() => setIsNaiAuthModalOpen(true)}
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
          {useDrawerCompactChrome && compactActionBarPortalTarget ? createPortal(compactActionSection, compactActionBarPortalTarget) : null}
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
        open={isGenerationSaveOptionsOpen}
        title="생성 결과 저장 옵션"
        options={generationSaveOptions}
        sourceInfo={generationSaveSourceInfo}
        isSaving={false}
        onClose={() => setIsGenerationSaveOptionsOpen(false)}
        onOptionsChange={(patch) => setGenerationSaveOptions((current) => ({ ...current, ...patch }))}
        onConfirm={() => setIsGenerationSaveOptionsOpen(false)}
      />

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


