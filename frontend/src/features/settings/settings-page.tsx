import { useSettingsRevision } from './use-settings-revision'
import { useSettingsDraftSlot } from './use-settings-draft-slot'
import { Suspense, lazy, useEffect, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldAlert } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { PageToolbar } from '@/components/common/page-toolbar'
import { PageWithSidebar } from '@/components/common/page-with-sidebar'
import { HEADER_NAVIGATION_QUERY_KEY } from '@/components/layout/app-navigation'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { reextractAllImageMetadata, updateGenerationThrottleSettings, updateImageSaveSettings, updateMetadataSettings, updateThumbnailSettings, updateVideoOptimizationSettings, type MetadataReextractAllResult } from '@/lib/api-settings'
import { useRuntimeJobAction } from '@/lib/use-runtime-job'
import { getAppSettings, updateGeneralSettings } from '@/lib/api-settings-general'
import { getPostsSettings, updatePostsSettings } from '@/lib/api-posts'
import { getMcpHttpSettings, updateMcpHttpEnabled } from '@/lib/api-settings-mcp'
import { DEFAULT_APPEARANCE_SETTINGS } from '@/lib/appearance'
import { GLOBAL_APPEARANCE_QUERY_KEY } from '@/lib/use-global-appearance-settings'
import { APP_BRAND_TOOLTIP, APP_VERSION_LABEL } from '@/lib/app-metadata'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { usePluginPages } from '@/features/plugins/use-plugin-pages'
import { useI18n } from '@/i18n'
import type {
  ChatPageData,
  GenerationThrottleSettings,
  GeneralSettings,
  ImageSaveSettings,
  MetadataExtractionSettings,
  PostsSafetySettings,
  PostsSettings,
  ThumbnailSettings,
  VideoOptimizationSettings,
} from '@conai/shared'
import type { GeneralPreferenceSection } from './components/general-preferences-sections'
import { SettingsSaveBar } from './components/settings-save-bar'
import { SettingsTabNav } from './components/settings-tab-nav'
import { RegistrySettingsGroup, SettingsContents, SettingsGroup, SettingsJumpTarget, SettingsSearch } from './components/settings-navigation'
import { ChatSettingsMine } from './components/chat-settings-mine'
import { GenerationConnections } from './components/generation-connections'
import { PageSettingsSection } from './page-settings-dialog'
import { areSettingsDraftsEqual, saveSettingsDraftSections, type SettingsDraftSection } from './settings-draft-sections'
import { parseSettingsTab, resolveSettingsLocation, SETTINGS_TAB_LABELS, type SettingsTab } from './settings-tabs'
import { useFolderSettingsTab } from './use-folder-settings-tab'
import { useAppearanceSettingsTab } from './use-appearance-settings-tab'
import { useAutoSettingsTab } from './use-auto-settings-tab'
import { useContentEvaluationSettings } from './use-content-evaluation-settings'
import { useUnsavedSettingsGuard } from './use-unsaved-settings-guard'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageChoice, pageNumber, pageObject, pageText } from '@/features/codex-chat/page-action-helpers'
import { applySettingsChatPatch, settingsChatFields, type SettingsChatSources } from './settings-chat-fields'
import { applySettingsChatAction, settingsChatActions, settingsChatData, type SettingsChatActionContext } from './settings-chat-actions'

const MaintenanceTabLazy = lazy(async () => {
  const module = await import('./components/maintenance-tab')
  return { default: module.MaintenanceTab }
})

const GeneralPreferencesSectionsLazy = lazy(async () => {
  const module = await import('./components/general-preferences-sections')
  return { default: module.GeneralPreferencesSections }
})

const FoldersTabLazy = lazy(async () => {
  const module = await import('./components/folders-tab')
  return { default: module.FoldersTab }
})

const AppearanceTabLazy = lazy(async () => {
  const module = await import('./components/appearance-tab')
  return { default: module.AppearanceTab }
})

const SecurityTabLazy = lazy(async () => {
  const module = await import('./components/security-tab')
  return { default: module.SecurityTab }
})

const McpHttpSettingsCardLazy = lazy(async () => {
  const module = await import('./components/mcp-http-settings-card')
  return { default: module.McpHttpSettingsCard }
})

const AutoTabLazy = lazy(async () => {
  const module = await import('./components/auto-tab')
  return { default: module.AutoTab }
})

const MetadataTabLazy = lazy(async () => {
  const module = await import('./components/metadata-tab')
  return { default: module.MetadataTab }
})

const ImageSaveTabLazy = lazy(async () => {
  const module = await import('./components/image-save-tab')
  return { default: module.ImageSaveTab }
})

const IntegrationToolsTabLazy = lazy(async () => {
  const module = await import('./components/integration-tools-tab')
  return { default: module.IntegrationToolsTab }
})

const LlmSettingsTabLazy = lazy(async () => {
  const module = await import('./components/llm-settings-tab')
  return { default: module.LlmSettingsTab }
})

const PostsSettingsTabLazy = lazy(async () => {
  const module = await import('./components/posts-settings-tab')
  return { default: module.PostsSettingsTab }
})

const ChatSettingsTabLazy = lazy(async () => {
  const module = await import('./components/chat-settings-tab')
  return { default: module.ChatSettingsTab }
})

type AppSettingsRecord = Awaited<ReturnType<typeof getAppSettings>>

/** General-settings fields rendered (and therefore saved) by each preference section. */
const GENERAL_SECTION_FIELDS = {
  basic: ['language', 'promptForDownloadLocation'],
  appearance: ['enableGallery', 'showRatingBadges', 'headerNavigation', 'headerNavigationOrder'],
  library: ['imageSimilarityCheckMode'],
  safety: ['deleteProtection', 'generationHistoryMaxItems', 'autoCleanupCanvasOnShutdown', 'applyRatingSafetyToGenerationHistory'],
} as const satisfies Record<GeneralPreferenceSection, ReadonlyArray<keyof GeneralSettings>>

/** Tab that renders each general preference section. */
const GENERAL_SECTION_TABS: Record<GeneralPreferenceSection, SettingsTab> = {
  basic: 'general',
  appearance: 'general',
  library: 'library',
  safety: 'system',
}

const GENERAL_SECTIONS = Object.keys(GENERAL_SECTION_FIELDS) as GeneralPreferenceSection[]

function pickGeneralFields(settings: GeneralSettings, fields: ReadonlyArray<keyof GeneralSettings>): Partial<GeneralSettings> {
  return Object.fromEntries(fields.map((field) => [field, settings[field]])) as Partial<GeneralSettings>
}

const PluginsTabLazy = lazy(async () => {
  const module = await import('@/features/plugins/plugin-management')
  return { default: module.PluginManagement }
})

function SettingsSectionFallback() {
  return <div className="min-h-[16rem] animate-pulse rounded-sm bg-fill" />
}

/** Keep the settings page as a composition root for tab-level state, the page-wide save bar and access. */
export function SettingsPage() {
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const { t, formatNumber } = useI18n()
  const pluginPages = usePluginPages()
  const authStatusQuery = useAuthStatusQuery()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const rawSection = searchParams.get('section')
  const activeTab = parseSettingsTab(rawSection)
  const [generalDraft, setGeneralDraft] = useState<GeneralSettings | null>(null)
  const [isSavingAll, setIsSavingAll] = useState(false)
  const savingAllRef = useRef(false)
  const canOpenSettings = authStatusQuery.data?.isAdmin === true || authStatusQuery.data?.hasCredentials !== true

  const setActiveTab = (tab: SettingsTab) => {
    const nextSearchParams = new URLSearchParams(searchParams)
    // `?view=` is the inner tab of one section; carried over, LLM's `view=judge` trips Chat's old-link redirect back to LLM.
    if (tab !== activeTab) { nextSearchParams.delete('view'); nextSearchParams.delete('group'); nextSearchParams.delete('setting') }
    nextSearchParams.set('section', tab)
    setSearchParams(nextSearchParams, { replace: true })
  }

  // Rewrite legacy or unknown `?section=` ids to the canonical tab so the address bar matches what is shown.
  useEffect(() => {
    const destination = resolveSettingsLocation(searchParams)
    if (destination) navigate(destination, { replace: true })
  }, [searchParams, navigate])

  const settingsQuery = useQuery({
    queryKey: ['app-settings'],
    queryFn: getAppSettings,
    enabled: canOpenSettings,
  })

  // Posts keep their own settings file (config/posts.json) behind /api/posts/settings.
  const postsSettingsQuery = useQuery({ queryKey: ['post-settings'], queryFn: getPostsSettings, enabled: canOpenSettings })
  // The system tab's MCP card reads the same query; the chat sees its switch and key names (never key values).
  const mcpHttpQuery = useQuery({ queryKey: ['mcp-http-settings'], queryFn: getMcpHttpSettings, enabled: canOpenSettings && activeTab === 'system' })

  const notifyInfo = (message: string) => {
    showSnackbar({ message, tone: 'info' })
  }

  const notifyError = (message: string) => {
    showSnackbar({ message, tone: 'error' })
  }

  const syncSettingsCache = (nextSettings: AppSettingsRecord) => {
    queryClient.setQueryData(['app-settings'], nextSettings)
    queryClient.setQueryData(GLOBAL_APPEARANCE_QUERY_KEY, nextSettings.appearance)
    queryClient.setQueryData(['runtime-appearance-settings'], nextSettings.appearance)
    queryClient.setQueryData(['runtime-appearance'], nextSettings.appearance)
    queryClient.setQueryData(HEADER_NAVIGATION_QUERY_KEY, { items: nextSettings.general.headerNavigation, order: nextSettings.general.headerNavigationOrder })
    queryClient.setQueryData(['runtime-generation-history-settings'], {
      applyRatingSafetyToGenerationHistory: nextSettings.general.applyRatingSafetyToGenerationHistory,
    })
  }

  const refreshAutoQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['app-settings'] }),
      queryClient.invalidateQueries({ queryKey: ['tagger-models'] }),
      queryClient.invalidateQueries({ queryKey: ['tagger-status'] }),
      queryClient.invalidateQueries({ queryKey: ['kaloscope-status'] }),
    ])
  }

  const { tabProps: foldersTabProps, chatActions: folderChatActions } = useFolderSettingsTab({ isActive: activeTab === 'library' || activeTab === 'maintenance', notifyInfo, notifyError })

  const effectiveGeneralDraft = generalDraft ?? settingsQuery.data?.general ?? null
  const contentEvaluation = useContentEvaluationSettings(canOpenSettings && activeTab === 'posts')
  const savedAppearance = settingsQuery.data?.appearance ?? DEFAULT_APPEARANCE_SETTINGS
  const savedGeneral = settingsQuery.data?.general
  const isGeneralSectionDirty = (section: GeneralPreferenceSection) => Boolean(
    effectiveGeneralDraft
    && savedGeneral
    && !areSettingsDraftsEqual(
      pickGeneralFields(effectiveGeneralDraft, GENERAL_SECTION_FIELDS[section]),
      pickGeneralFields(savedGeneral, GENERAL_SECTION_FIELDS[section]),
    ),
  )
  const generalRevision = useSettingsRevision(settingsQuery.data?.pageSettingsRevisions?.general, GENERAL_SECTIONS.some(isGeneralSectionDirty))
  const { draft: effectiveMetadataDraft, setDraft: setMetadataDraft, section: metadataSection } = useSettingsDraftSlot<MetadataExtractionSettings>({
    id: 'metadata', label: t({ ko: '메타데이터', en: 'Metadata' }), tab: 'library',
    saved: settingsQuery.data?.metadataExtraction, revision: settingsQuery.data?.pageSettingsRevisions?.metadata,
    update: async (draft, revision) => {
      const settings = await updateMetadataSettings(draft, revision)
      return { draft: settings.metadataExtraction, sync: () => syncSettingsCache(settings) }
    },
  })
  const { draft: effectiveImageSaveDraft, setDraft: setImageSaveDraft, section: imageSaveSection } = useSettingsDraftSlot<ImageSaveSettings>({
    id: 'image-save', label: t({ ko: '이미지 저장', en: 'Image saving' }), tab: 'media',
    saved: settingsQuery.data?.imageSave, revision: settingsQuery.data?.pageSettingsRevisions?.['image-save'],
    update: async (draft, revision) => {
      const settings = await updateImageSaveSettings(draft, revision)
      return { draft: settings.imageSave, sync: () => syncSettingsCache(settings) }
    },
  })
  const { draft: effectiveThumbnailDraft, setDraft: setThumbnailDraft, section: thumbnailSection } = useSettingsDraftSlot<ThumbnailSettings>({
    id: 'thumbnail', label: t({ ko: '썸네일', en: 'Thumbnail' }), tab: 'media',
    saved: settingsQuery.data?.thumbnail, revision: settingsQuery.data?.pageSettingsRevisions?.thumbnail,
    update: async (draft, revision) => {
      const settings = await updateThumbnailSettings(draft, revision)
      return { draft: settings.thumbnail, sync: () => syncSettingsCache(settings) }
    },
  })
  const { draft: effectiveGenerationThrottleDraft, setDraft: setGenerationThrottleDraft, section: generationThrottleSection } = useSettingsDraftSlot<GenerationThrottleSettings>({
    id: 'generation-throttle', label: t({ ko: '생성 텀', en: 'Generation pacing' }), tab: 'generation',
    saved: settingsQuery.data?.generationThrottle, revision: settingsQuery.data?.pageSettingsRevisions?.['generation-throttle'],
    update: async (draft, revision) => {
      const settings = await updateGenerationThrottleSettings(draft, revision)
      return { draft: settings.generationThrottle, sync: () => syncSettingsCache(settings) }
    },
  })
  const { draft: effectiveVideoOptimizationDraft, setDraft: setVideoOptimizationDraft, section: videoOptimizationSection } = useSettingsDraftSlot<VideoOptimizationSettings>({
    id: 'video-optimization', label: t({ ko: '영상 저장', en: 'Video saving' }), tab: 'media',
    saved: settingsQuery.data?.videoOptimization, revision: settingsQuery.data?.pageSettingsRevisions?.['video-optimization'],
    update: async (draft, revision) => {
      const settings = await updateVideoOptimizationSettings(draft, revision)
      return { draft: settings.videoOptimization, sync: () => syncSettingsCache(settings) }
    },
  })
  const { draft: effectivePostsDraft, setDraft: setPostsDraft, section: postsSection } = useSettingsDraftSlot<PostsSettings>({
    id: 'posts', label: t({ ko: '게시판', en: 'Posts' }), tab: 'posts',
    saved: postsSettingsQuery.data, revision: postsSettingsQuery.data?.pageSettingsRevisions?.posts,
    update: async (draft, revision) => {
      const settings = await updatePostsSettings(draft, revision)
      return { draft: settings, sync: () => queryClient.setQueryData(['post-settings'], settings) }
    },
  })
  const isMetadataDraftDirty = metadataSection.isDirty
  const isImageSaveDraftDirty = imageSaveSection.isDirty
  const isThumbnailDraftDirty = thumbnailSection.isDirty
  const isGenerationThrottleDraftDirty = generationThrottleSection.isDirty
  const isVideoOptimizationDraftDirty = videoOptimizationSection.isDirty
  const isPostsDraftDirty = postsSection.isDirty

  const { tabProps: appearanceTabProps, draftSection: appearanceDraftSection } = useAppearanceSettingsTab({
    isActive: activeTab === 'general',
    revision: settingsQuery.data?.pageSettingsRevisions?.appearance,
    currentAppearance: settingsQuery.data?.appearance,
    savedAppearance,
    syncSettingsCache,
    notifyInfo,
    notifyError,
  })

  const { tabProps: autoTabProps, draftSections: autoDraftSections, chatActions: autoChatActions } = useAutoSettingsTab({
    isActive: activeTab === 'auto',
    revisions: settingsQuery.data?.pageSettingsRevisions,
    taggerSettings: settingsQuery.data?.tagger,
    kaloscopeSettings: settingsQuery.data?.kaloscope,
    aiRuntimeSettings: settingsQuery.data?.aiRuntime,
    embeddingSettings: settingsQuery.data?.embedding,
    syncSettingsCache,
    refreshAutoQueries,
    notifyInfo,
    notifyError,
  })

  // Save mutations only sync caches and drafts; the save bar reports success and failures for all of them at once.
  const generalMutation = useMutation({
    mutationFn: (patch: Parameters<typeof updateGeneralSettings>[0]) => updateGeneralSettings(patch, generalRevision()),
    onSuccess: (settings, savedFields) => {
      generalRevision(settings.pageSettingsRevisions?.general)
      syncSettingsCache(settings)
      // Only refresh the saved section's fields so unsaved edits in other sections stay in the draft.
      const savedKeys = Object.keys(savedFields) as Array<keyof GeneralSettings>
      setGeneralDraft((currentDraft) => currentDraft ? { ...currentDraft, ...pickGeneralFields(settings.general, savedKeys) } : null)
    },
  })

  const metadataReextractJob = useRuntimeJobAction<MetadataReextractAllResult>(reextractAllImageMetadata, {
    resumeKind: 'metadata-reextract-all',
    onCompleted: (job) => {
      const result = job.result
      notifyInfo(t(
        { ko: '메타데이터 재추출 완료: 등록 {queued}/{total}개, 누락 {skipped}개, 실패 {failed}개', en: 'Metadata re-extraction complete: queued {queued}/{total}, missing {skipped}, failed {failed}' },
        { queued: formatNumber(result?.queuedCount ?? 0), total: formatNumber(result?.totalCandidates ?? 0), skipped: formatNumber(result?.skippedMissingCount ?? 0), failed: formatNumber(result?.failedCount ?? 0) },
      ))
    },
    onCancelled: () => {
      notifyInfo(t({ ko: '메타데이터 재추출을 중단했어. 이미 등록한 항목은 마저 처리해.', en: 'Metadata re-extraction stopped. Already queued items will finish.' }))
    },
    onFailed: (job) => {
      notifyError(job.failureMessage ?? t({ ko: '메타데이터 재추출에 실패했어.', en: 'Metadata re-extraction failed.' }))
    },
    onStartError: (error) => {
      notifyError(error instanceof Error ? error.message : t({ ko: '전체 메타데이터 재추출을 시작하지 못했어.', en: 'Failed to start metadata re-extraction.' }))
    },
  })

  const generalSectionLabels: Record<GeneralPreferenceSection, string> = {
    basic: t({ ko: '기본', en: 'Basics' }),
    appearance: t({ ko: '탐색 및 표시', en: 'Navigation and display' }),
    library: t({ ko: '라이브러리 동작', en: 'Library behavior' }),
    safety: t({ ko: '안전 및 정리', en: 'Safety and cleanup' }),
  }

  // Every draft on the page, in the order the tabs show them; the save bar works on the dirty subset.
  const draftSections: SettingsDraftSection[] = [
    contentEvaluation.draftSection,
    ...GENERAL_SECTIONS.map((section): SettingsDraftSection => ({
      id: `general-${section}`,
      label: generalSectionLabels[section],
      tab: GENERAL_SECTION_TABS[section],
      isDirty: isGeneralSectionDirty(section),
      save: async () => {
        if (effectiveGeneralDraft) await generalMutation.mutateAsync(pickGeneralFields(effectiveGeneralDraft, GENERAL_SECTION_FIELDS[section]))
      },
      discard: () => setGeneralDraft((currentDraft) => (
        currentDraft && savedGeneral ? { ...currentDraft, ...pickGeneralFields(savedGeneral, GENERAL_SECTION_FIELDS[section]) } : currentDraft
      )),
    })),
    appearanceDraftSection,
    metadataSection,
    imageSaveSection,
    thumbnailSection,
    videoOptimizationSection,
    ...autoDraftSections,
    generationThrottleSection,
    postsSection,
  ]
  const dirtySections = draftSections.filter((section) => section.isDirty)
  const chatSources: SettingsChatSources = {
    pluginPages,
    general: effectiveGeneralDraft,
    appearance: appearanceTabProps.appearanceDraft,
    metadata: effectiveMetadataDraft,
    imageSave: effectiveImageSaveDraft,
    thumbnail: effectiveThumbnailDraft,
    videoOptimization: effectiveVideoOptimizationDraft,
    generationThrottle: effectiveGenerationThrottleDraft,
    aiRuntime: autoTabProps.aiRuntimeDraft,
    tagger: autoTabProps.taggerDraft,
    kaloscope: autoTabProps.kaloscopeDraft,
    embedding: autoTabProps.embeddingDraft,
    ratingWeights: autoTabProps.ratingWeightsDraft,
    posts: effectivePostsDraft,
    ratingTiers: autoTabProps.ratingTiersDraft,
    taggerModels: autoTabProps.taggerModels.filter((model) => model.available !== false).map((model) => model.name),
  }
  // Folder paths stay on the server; chat sees folder IDs and watcher state and uses the native scan/save handlers.
  const chatFolderData: Record<string, ChatPageData> = activeTab === 'library' ? {
    watchedFolders: foldersTabProps.folders.slice(0, 100).map((folder) => ({
      id: folder.id,
      name: folder.folder_name || folder.folder_path.split(/[\\/]/).filter(Boolean).pop() || `#${folder.id}`,
      active: folder.is_active === 1,
      autoScan: folder.auto_scan === 1,
      watcher: foldersTabProps.folderWatcherMap.get(folder.id) ?? 'stopped',
      lastScan: folder.last_scan_status,
    })),
    backupSources: (foldersTabProps.backupSources ?? []).map((source) => ({
      name: source.display_name || source.target_folder_name,
      active: source.is_active === 1,
      watcher: source.watcher_status,
    })),
  } : {}

  const handleSaveAll = async () => {
    if (savingAllRef.current || dirtySections.length === 0) {
      return false
    }

    savingAllRef.current = true
    setIsSavingAll(true)
    const failures = await saveSettingsDraftSections(dirtySections, t({ ko: '저장에 실패했어.', en: 'Save failed.' }))
    savingAllRef.current = false
    setIsSavingAll(false)

    if (failures.length === 0) {
      notifyInfo(t({ ko: '변경 {count}건을 저장했어.', en: 'Saved {count} changes.' }, { count: formatNumber(dirtySections.length) }))
      return true
    }

    const savedCount = dirtySections.length - failures.length
    const details = failures.map((failure) => `${failure.section.label}: ${failure.message}`).join(' · ')
    notifyError(savedCount > 0
      ? t({ ko: '{saved}건은 저장했지만 {failed}건은 실패했어. {details}', en: 'Saved {saved}, but {failed} failed. {details}' }, { saved: formatNumber(savedCount), failed: formatNumber(failures.length), details })
      : t({ ko: '{failed}건을 저장하지 못했어. {details}', en: 'Could not save {failed} changes. {details}' }, { failed: formatNumber(failures.length), details }))
    return false
  }

  const handleDiscardAll = () => {
    dirtySections.forEach((section) => section.discard())
    notifyInfo(t({ ko: '저장하지 않은 변경을 되돌렸어.', en: 'Reverted unsaved changes.' }))
  }

  const chatActionContext: SettingsChatActionContext = {
    tab: activeTab,
    auto: autoTabProps,
    autoActions: autoChatActions,
    dirtyCount: dirtySections.length,
    saveAll: async () => { if (!await handleSaveAll()) throw new Error('설정 저장에 실패했어.') },
    mcpHttp: mcpHttpQuery.data,
    setMcpHttpEnabled: async (enabled) => queryClient.setQueryData(['mcp-http-settings'], await updateMcpHttpEnabled(enabled)),
    maintenance: {
      scanAll: folderChatActions.scanAll,
      cancelScanAll: folderChatActions.cancelScanAll,
      scanAllJob: foldersTabProps.scanAllJob,
      isScanningAll: foldersTabProps.isScanningAll,
      verifyAllFiles: folderChatActions.verifyAllFiles,
      cancelVerifyAllFiles: folderChatActions.cancelVerifyAllFiles,
      verifyAllFilesJob: foldersTabProps.verifyAllFilesJob,
      isVerifyingAllFiles: foldersTabProps.isVerifyingAllFiles,
      reextractAll: () => metadataReextractJob.run(),
      cancelReextractAll: () => metadataReextractJob.cancel(),
      reextractJob: metadataReextractJob.job,
      isReextracting: metadataReextractJob.isStarting || metadataReextractJob.isRunning,
    },
  }
  useChatPageRegistration(canOpenSettings && activeTab !== 'mine' ? {
    kind: 'settings', title: t({ ko: '설정 · {section}', en: 'Settings · {section}' }, { section: t(SETTINGS_TAB_LABELS[activeTab]) }), resourceId: activeTab,
    fields: settingsChatFields(activeTab, chatSources, t),
    data: { section: activeTab, ...chatFolderData, ...settingsChatData(chatActionContext), ...(activeTab === 'general' ? { appMark: { configured: Boolean(savedAppearance.appIconDataUrl), outputSize: 128, saving: appearanceTabProps.isSavingAppIcon } } : {}) },
    actions: [
      ...settingsChatActions(chatActionContext, t),
      ...(activeTab === 'library' && foldersTabProps.folders.length ? [pageAction('settings.folder', t({ ko: '감시 폴더 작업', en: 'Watched folder operation' }), t({ ko: '폴더 스캔 또는 활성 상태 변경.', en: 'Scan a folder or change its active state.' }), pageObject({ folderId: pageNumber(1, undefined, true), operation: pageChoice(['scan', 'activate', 'deactivate']) }, ['folderId', 'operation']), 'save')] : []),
      ...(activeTab === 'general' ? [
        pageAction('resource.open', t({ ko: '앱 마크 편집기 열기', en: 'Open app mark editor' }), t({ ko: 'kind=app_mark. compositeHash를 주면 내부 이미지로 열고, 비우면 현재 마크를 편집해. 등록 전 위치·확대·회전·반전을 조절할 수 있어.', en: 'Use kind=app_mark. Supply compositeHash to use an app library image, or omit it to edit the current mark. Adjust position, zoom, rotation, and flip before registering.' }), pageObject({ kind: pageChoice(['app_mark']), compositeHash: pageText(80) }, ['kind'])),
        pageAction('resource.save', t({ ko: '기본 앱 마크 복원', en: 'Restore default app mark' }), t({ ko: '등록한 공용 앱 마크를 기본 마크로 되돌려.', en: 'Restore the default shared app mark.' }), pageObject({ kind: pageChoice(['app_mark']), operation: pageChoice(['reset']) }, ['kind', 'operation']), 'save'),
      ] : []),
    ],
    // Unsaved sections keep a connected chat from navigating away and losing them.
    dirty: dirtySections.length > 0,
    apply: (patch) => {
      if (savingAllRef.current) throw new Error(t({ ko: '설정 저장이 끝날 때까지 기다려줘.', en: 'Wait for settings to finish saving.' }))
      applySettingsChatPatch(patch, chatSources, {
        general: setGeneralDraft,
        appearance: appearanceTabProps.onPatchAppearance,
        metadata: setMetadataDraft,
        imageSave: setImageSaveDraft,
        thumbnail: setThumbnailDraft,
        videoOptimization: setVideoOptimizationDraft,
        generationThrottle: setGenerationThrottleDraft,
        aiRuntime: autoTabProps.onPatchAiRuntime,
        tagger: autoTabProps.onPatchTagger,
        kaloscope: autoTabProps.onPatchKaloscope,
        embedding: autoTabProps.onPatchEmbedding,
        posts: setPostsDraft,
        ratingWeights: ({ general_weight, sensitive_weight, questionable_weight, explicit_weight }) => autoTabProps.onPatchRatingWeights({ general_weight, sensitive_weight, questionable_weight, explicit_weight }),
        ratingTier: autoTabProps.onPatchRatingTier,
      })
    },
    applyAction: async (id, args, assertCurrent) => {
      assertCurrent()
      if (id === 'settings.folder' && activeTab === 'library') {
        const folder = foldersTabProps.folders.find((item) => item.id === args.folderId)
        if (!folder) throw new Error('감시 폴더를 찾을 수 없어.')
        if (args.operation === 'scan') await foldersTabProps.onFolderScan(folder.id)
        else if (args.operation === 'activate' || args.operation === 'deactivate') await foldersTabProps.onFolderSave(folder.id, { is_active: args.operation === 'activate' })
        else throw new Error('알 수 없는 폴더 작업이야.')
        return
      }
      if (savingAllRef.current && (id === 'settings.save' || id === 'settings.rating_tier_add' || (id === 'resource.save' && args.kind === 'app_mark'))) {
        throw new Error(t({ ko: '설정 저장이 끝날 때까지 기다려줘.', en: 'Wait for settings to finish saving.' }))
      }
      if (activeTab === 'general' && args.kind === 'app_mark' && (id === 'resource.open' || id === 'resource.save')) {
        if (appearanceTabProps.isSavingAppIcon) throw new Error(t({ ko: '앱 마크 등록이 끝날 때까지 기다려줘.', en: 'Wait until the app mark finishes registering.' }))
        if (id === 'resource.save') {
          if (args.operation !== 'reset') throw new Error('앱 마크에 없는 작업이야.')
          await appearanceTabProps.onResetAppIcon()
        } else if (typeof args.compositeHash === 'string' && args.compositeHash) {
          await appearanceTabProps.onSelectLibraryAppIcon(args.compositeHash)
        } else {
          appearanceTabProps.onEditAppIcon()
        }
        return
      }
      if (!await applySettingsChatAction(id, args, chatActionContext)) throw new Error('설정 화면에 없는 작업이야.')
    },
  } : null, { preserveOnSearchChange: true })

  useUnsavedSettingsGuard(
    dirtySections.length > 0 || isSavingAll,
    t({ ko: '저장하지 않은 설정 변경이 있어. 이 페이지를 떠나면 사라져. 계속할까?', en: 'You have unsaved settings changes. They will be lost if you leave this page. Continue?' }),
  )

  if (authStatusQuery.isLoading) {
    return <div className="min-h-screen bg-surface-low animate-pulse" />
  }

  if (!canOpenSettings && activeTab !== 'mine') {
    // An account whose admin role was removed while the page was open gets an explanation instead of a silent bounce.
    return (
      <div className="space-y-4">
        <PageToolbar title={t('pageAccessCatalog.settings')} />
        <div role="status" className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1 space-y-3">
            <div className="text-sm font-semibold text-foreground">
              {t({ ko: '설정은 관리자만 변경할 수 있어.', en: 'Only administrators can change settings.' })}
            </div>
            <Button asChild size="sm" variant="secondary">
              <Link to="/access">{t('appShell.availablePages')}</Link>
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const patchGeneralDraft = (patch: Partial<GeneralSettings>) => {
    if (!effectiveGeneralDraft) return
    setGeneralDraft({ ...effectiveGeneralDraft, ...patch })
  }

  const patchDeleteProtectionDraft = (patch: Partial<GeneralSettings['deleteProtection']>) => {
    if (!effectiveGeneralDraft) return
    setGeneralDraft({
      ...effectiveGeneralDraft,
      deleteProtection: {
        ...effectiveGeneralDraft.deleteProtection,
        ...patch,
      },
    })
  }

  const patchMetadataDraft = (patch: Partial<MetadataExtractionSettings>) => {
    if (!effectiveMetadataDraft) return
    setMetadataDraft({ ...effectiveMetadataDraft, ...patch })
  }

  const patchImageSaveDraft = (patch: Partial<ImageSaveSettings>) => {
    if (!effectiveImageSaveDraft) return
    setImageSaveDraft({ ...effectiveImageSaveDraft, ...patch })
  }

  const patchThumbnailDraft = (patch: Partial<ThumbnailSettings>) => {
    if (!effectiveThumbnailDraft) return
    setThumbnailDraft({ ...effectiveThumbnailDraft, ...patch })
  }

  const patchGenerationThrottleDraft = (patch: {
    novelai?: Partial<GenerationThrottleSettings['novelai']>
    codex?: Partial<GenerationThrottleSettings['codex']>
    reservations?: Partial<GenerationThrottleSettings['reservations']>
  }) => {
    if (!effectiveGenerationThrottleDraft) return
    setGenerationThrottleDraft({
      novelai: {
        ...effectiveGenerationThrottleDraft.novelai,
        ...patch.novelai,
      },
      codex: {
        ...effectiveGenerationThrottleDraft.codex,
        ...patch.codex,
      },
      reservations: {
        ...effectiveGenerationThrottleDraft.reservations,
        ...patch.reservations,
      },
    })
  }

  const patchPostsDraft = (patch: Omit<Partial<PostsSettings>, 'safety'> & { safety?: Partial<PostsSafetySettings> }) => {
    if (!effectivePostsDraft) return
    setPostsDraft({ ...effectivePostsDraft, ...patch, safety: { ...effectivePostsDraft.safety, ...patch.safety } })
  }

  const patchVideoOptimizationDraft = (patch: Partial<VideoOptimizationSettings>) => {
    if (!effectiveVideoOptimizationDraft) return
    setVideoOptimizationDraft({ ...effectiveVideoOptimizationDraft, ...patch })
  }

  const imageSaveTabProps = {
    imageSaveDraft: effectiveImageSaveDraft,
    onPatchImageSave: patchImageSaveDraft,
    hasImageSaveChanges: isImageSaveDraftDirty,
    thumbnailDraft: effectiveThumbnailDraft,
    onPatchThumbnail: patchThumbnailDraft,
    hasThumbnailChanges: isThumbnailDraftDirty,
    generationThrottleDraft: effectiveGenerationThrottleDraft,
    onPatchGenerationThrottle: patchGenerationThrottleDraft,
    hasGenerationThrottleChanges: isGenerationThrottleDraftDirty,
    videoOptimizationDraft: effectiveVideoOptimizationDraft,
    onPatchVideoOptimization: patchVideoOptimizationDraft,
    hasVideoOptimizationChanges: isVideoOptimizationDraftDirty,
  }

  const generalSectionsProps = {
    generalDraft: effectiveGeneralDraft,
    onPatchGeneral: patchGeneralDraft,
    onPatchDeleteProtection: patchDeleteProtectionDraft,
    isSectionDirty: isGeneralSectionDirty,
  }

  /** Sections drawn from a settings file that could not be read say so, with a retry, instead of loading forever. */
  const whenLoaded = (query: typeof settingsQuery | typeof postsSettingsQuery, sections: ReactNode) => (query.isError && !query.data ? (
    <ErrorState title={t({ ko: '설정을 불러오지 못했어.', en: 'Could not load the settings.' })} error={query.error} onRetry={() => void query.refetch()} isRetrying={query.isFetching} />
  ) : sections)

  return (
    <PageWithSidebar
      storageKey="settings"
      sidebarLabel={t({ ko: '설정 항목', en: 'Settings sections' })}
      sidebar={<SettingsTabNav activeTab={activeTab} onChange={setActiveTab} />}
      sidebarFooter={<span className="tabular-nums" title={APP_BRAND_TOOLTIP}>{APP_VERSION_LABEL}</span>}
      toolbar={<PageToolbar title={t(SETTINGS_TAB_LABELS[activeTab])}><SettingsSearch /></PageToolbar>}
    >
      <SettingsJumpTarget>
        <div aria-busy={isSavingAll || undefined}>
        <Suspense fallback={<SettingsSectionFallback />}>
          {activeTab === 'mine' ? <ChatSettingsMine /> : null}
          {activeTab === 'general' ? (
            <div className="space-y-8">
              <SettingsContents groups={[{ id: 'display', label: t({ ko: '언어·공용 표시', en: 'Language and shared display' }) }, { id: 'appearance', label: t({ ko: '테마', en: 'Theme' }) }]} />
              <SettingsGroup id="display" title={t({ ko: '언어·공용 표시', en: 'Language and shared display' })}>{whenLoaded(settingsQuery, <fieldset disabled={isSavingAll} className="contents"><GeneralPreferencesSectionsLazy sections={['basic', 'appearance']} {...generalSectionsProps} /></fieldset>)}</SettingsGroup>
              <SettingsGroup id="appearance" title={t({ ko: '테마', en: 'Theme' })}>{whenLoaded(settingsQuery, <AppearanceTabLazy {...appearanceTabProps} draftLocked={isSavingAll} />)}</SettingsGroup>
            </div>
          ) : null}

          {activeTab === 'library' ? (
            <div className="space-y-8">
              <SettingsContents groups={[{ id: 'similarity', label: t({ ko: '유사도', en: 'Similarity' }) }, { id: 'folders', label: t({ ko: '폴더', en: 'Folders' }) }, { id: 'metadata', label: t({ ko: '메타데이터', en: 'Metadata' }) }]} />
              <SettingsGroup id="similarity" title={t({ ko: '유사도', en: 'Similarity' })}>{whenLoaded(settingsQuery, <fieldset disabled={isSavingAll} className="contents"><GeneralPreferencesSectionsLazy sections={['library']} {...generalSectionsProps} /></fieldset>)}<PageSettingsSection scope="similarity" /></SettingsGroup>
              <RegistrySettingsGroup id="library.folders"><FoldersTabLazy {...foldersTabProps} /></RegistrySettingsGroup>
              <SettingsGroup id="metadata" title={t({ ko: '메타데이터', en: 'Metadata' })}>
              {whenLoaded(settingsQuery, <fieldset disabled={isSavingAll} className="contents"><MetadataTabLazy
                metadataDraft={effectiveMetadataDraft}
                onPatchMetadata={patchMetadataDraft}
                hasChanges={isMetadataDraftDirty}
              /></fieldset>)}
              </SettingsGroup>
            </div>
          ) : null}

          {activeTab === 'media' ? whenLoaded(settingsQuery, (
            <fieldset disabled={isSavingAll} className="contents"><ImageSaveTabLazy
              {...imageSaveTabProps}
              throttle="none"
            /></fieldset>
          )) : null}

          {activeTab === 'posts' ? whenLoaded(postsSettingsQuery, (
            <fieldset disabled={isSavingAll} className="contents"><PostsSettingsTabLazy draft={effectivePostsDraft} onPatch={patchPostsDraft} dirty={isPostsDraftDirty} contentEvaluation={contentEvaluation.tabProps} /></fieldset>
          )) : null}

          {activeTab === 'auto' ? whenLoaded(settingsQuery, (
            <AutoTabLazy {...autoTabProps} draftLocked={isSavingAll} />
          )) : null}

          {activeTab === 'generation' ? (
            <div className="space-y-8">
              <SettingsContents groups={[{ id: 'nai', label: 'NovelAI' }, { id: 'comfyui', label: 'ComfyUI' }, { id: 'pacing', label: t({ ko: '실행 간격', en: 'Pacing' }) }, { id: 'schedules', label: t({ ko: '예약 작업', en: 'Schedules' }) }]} />
              <GenerationConnections comfyExtra={<IntegrationToolsTabLazy />} />
              <SettingsGroup id="pacing" title={t({ ko: '실행 간격', en: 'Pacing' })}>
              {whenLoaded(settingsQuery, <fieldset disabled={isSavingAll} className="contents"><ImageSaveTabLazy
                {...imageSaveTabProps}
                throttle="pacing"
                showMediaSettings={false}
              /></fieldset>)}
              </SettingsGroup>
              <SettingsGroup id="schedules" title={t({ ko: '예약 작업', en: 'Schedules' })}>
              {whenLoaded(settingsQuery, <fieldset disabled={isSavingAll} className="contents"><ImageSaveTabLazy
                {...imageSaveTabProps}
                throttle="reservations"
                showMediaSettings={false}
              /></fieldset>)}
              </SettingsGroup>
            </div>
          ) : null}

          {activeTab === 'chat' ? <ChatSettingsTabLazy /> : null}
          {activeTab === 'llm' ? <LlmSettingsTabLazy /> : null}

          {activeTab === 'accounts' ? <RegistrySettingsGroup id="accounts.access" contents><SecurityTabLazy /></RegistrySettingsGroup> : null}
          {activeTab === 'plugins' ? <RegistrySettingsGroup id="plugins.management" contents><PluginsTabLazy /></RegistrySettingsGroup> : null}

          {activeTab === 'system' ? (
            <div className="space-y-8">
              <SettingsContents groups={[{ id: 'mcp', label: 'MCP' }, { id: 'safety', label: t({ ko: '안전·정리', en: 'Safety and cleanup' }) }]} />
              <RegistrySettingsGroup id="system.mcp"><McpHttpSettingsCardLazy /></RegistrySettingsGroup>
              <SettingsGroup id="safety" title={t({ ko: '안전·정리', en: 'Safety and cleanup' })}>{whenLoaded(settingsQuery, <fieldset disabled={isSavingAll} className="contents"><GeneralPreferencesSectionsLazy sections={['safety']} {...generalSectionsProps} /></fieldset>)}</SettingsGroup>
            </div>
          ) : null}

          {activeTab === 'maintenance' ? (
            <RegistrySettingsGroup id="maintenance.operations" contents>
            <MaintenanceTabLazy
              onScanAll={foldersTabProps.onScanAll}
              isScanningAll={foldersTabProps.isScanningAll}
              scanAllJob={foldersTabProps.scanAllJob}
              onCancelScanAll={foldersTabProps.onCancelScanAll}
              isCancellingScanAll={foldersTabProps.isCancellingScanAll}
              onVerifyAllFiles={foldersTabProps.onVerifyAllFiles}
              isVerifyingAllFiles={foldersTabProps.isVerifyingAllFiles}
              verifyAllFilesJob={foldersTabProps.verifyAllFilesJob}
              onCancelVerifyAllFiles={foldersTabProps.onCancelVerifyAllFiles}
              isCancellingVerifyAllFiles={foldersTabProps.isCancellingVerifyAllFiles}
              onReextractAll={() => void metadataReextractJob.run()}
              isReextracting={metadataReextractJob.isStarting || metadataReextractJob.isRunning}
              reextractJob={metadataReextractJob.job}
              onCancelReextractAll={() => void metadataReextractJob.cancel().catch((error) => notifyError(error instanceof Error ? error.message : t({ ko: '재추출을 중단하지 못했어.', en: 'Could not stop metadata re-extraction.' })))}
              isCancellingReextractAll={metadataReextractJob.isCancelling}
              autoTabProps={autoTabProps}
            />
            </RegistrySettingsGroup>
          ) : null}
        </Suspense>
        </div>
        <SettingsSaveBar
          dirtySections={dirtySections}
          isSaving={isSavingAll}
          onSave={() => void handleSaveAll()}
          onDiscard={handleDiscardAll}
          onOpenTab={setActiveTab}
        />
      </SettingsJumpTarget>
    </PageWithSidebar>
  )
}
