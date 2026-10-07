import { Suspense, lazy, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldAlert } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { PageToolbar } from '@/components/common/page-toolbar'
import { PageWithSidebar } from '@/components/common/page-with-sidebar'
import { Button } from '@/components/ui/button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { reextractAllImageMetadata, updateGenerationThrottleSettings, updateImageSaveSettings, updateMetadataSettings, updateThumbnailSettings, updateVideoOptimizationSettings } from '@/lib/api-settings'
import { getAppSettings, updateGeneralSettings } from '@/lib/api-settings-general'
import { DEFAULT_APPEARANCE_SETTINGS } from '@/lib/appearance'
import { APP_BRAND_TOOLTIP, APP_VERSION_LABEL } from '@/lib/app-metadata'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useI18n } from '@/i18n'
import type {
  GenerationThrottleSettings,
  GeneralSettings,
  ImageSaveSettings,
  MetadataExtractionSettings,
  ThumbnailSettings,
  VideoOptimizationSettings,
} from '@conai/shared'
import type { GeneralPreferenceSection } from './components/general-preferences-sections'
import { SettingsSaveBar } from './components/settings-save-bar'
import { SettingsTabNav } from './components/settings-tab-nav'
import { areSettingsDraftsEqual, saveSettingsDraftSections, type SettingsDraftSection } from './settings-draft-sections'
import { parseSettingsTab, SETTINGS_TAB_LABELS, type SettingsTab } from './settings-tabs'
import { useFolderSettingsTab } from './use-folder-settings-tab'
import { useAppearanceSettingsTab } from './use-appearance-settings-tab'
import { useAutoSettingsTab } from './use-auto-settings-tab'
import { useUnsavedSettingsGuard } from './use-unsaved-settings-guard'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'

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
  const module = await import('./components/llm-connections-tab')
  return { default: module.LlmConnectionsTab }
})

const ChatSettingsTabLazy = lazy(async () => {
  const module = await import('./components/chat-settings-tab')
  return { default: module.ChatSettingsTab }
})

type AppSettingsRecord = Awaited<ReturnType<typeof getAppSettings>>

/** General-settings fields rendered (and therefore saved) by each preference section. */
const GENERAL_SECTION_FIELDS = {
  basic: ['language', 'promptForDownloadLocation'],
  appearance: ['enableGallery', 'showRatingBadges', 'headerNavigation'],
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

function SettingsSectionFallback() {
  return <div className="min-h-[16rem] animate-pulse rounded-sm bg-fill" />
}

/** Keep the settings page as a composition root for tab-level state, the page-wide save bar and access. */
export function SettingsPage() {
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const { t, formatNumber } = useI18n()
  const authStatusQuery = useAuthStatusQuery()
  const [searchParams, setSearchParams] = useSearchParams()
  const rawSection = searchParams.get('section')
  const activeTab = parseSettingsTab(rawSection)
  const [generalDraft, setGeneralDraft] = useState<GeneralSettings | null>(null)
  const [metadataDraft, setMetadataDraft] = useState<MetadataExtractionSettings | null>(null)
  const [imageSaveDraft, setImageSaveDraft] = useState<ImageSaveSettings | null>(null)
  const [thumbnailDraft, setThumbnailDraft] = useState<ThumbnailSettings | null>(null)
  const [generationThrottleDraft, setGenerationThrottleDraft] = useState<GenerationThrottleSettings | null>(null)
  const [videoOptimizationDraft, setVideoOptimizationDraft] = useState<VideoOptimizationSettings | null>(null)
  const [isSavingAll, setIsSavingAll] = useState(false)
  const canOpenSettings = authStatusQuery.data?.isAdmin === true || authStatusQuery.data?.hasCredentials !== true

  const setActiveTab = (tab: SettingsTab) => {
    const nextSearchParams = new URLSearchParams(searchParams)
    if (tab === 'general') {
      nextSearchParams.delete('section')
    } else {
      nextSearchParams.set('section', tab)
    }
    setSearchParams(nextSearchParams, { replace: true })
  }

  // Rewrite legacy or unknown `?section=` ids to the canonical tab so the address bar matches what is shown.
  useEffect(() => {
    const canonicalSection = activeTab === 'general' ? null : activeTab
    if (rawSection === canonicalSection) {
      return
    }

    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (canonicalSection) {
        next.set('section', canonicalSection)
      } else {
        next.delete('section')
      }
      return next
    }, { replace: true })
  }, [activeTab, rawSection, setSearchParams])

  const settingsQuery = useQuery({
    queryKey: ['app-settings'],
    queryFn: getAppSettings,
    enabled: canOpenSettings,
  })

  const notifyInfo = (message: string) => {
    showSnackbar({ message, tone: 'info' })
  }

  const notifyError = (message: string) => {
    showSnackbar({ message, tone: 'error' })
  }

  const syncSettingsCache = (nextSettings: AppSettingsRecord) => {
    queryClient.setQueryData(['app-settings'], nextSettings)
    queryClient.setQueryData(['runtime-appearance-settings'], nextSettings.appearance)
    queryClient.setQueryData(['runtime-appearance'], nextSettings.appearance)
    queryClient.setQueryData(['public-header-navigation-settings'], nextSettings.general.headerNavigation)
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

  const { tabProps: foldersTabProps } = useFolderSettingsTab({ isActive: activeTab === 'library' || activeTab === 'maintenance', notifyInfo, notifyError })

  const effectiveGeneralDraft = generalDraft ?? settingsQuery.data?.general ?? null
  const effectiveMetadataDraft = metadataDraft ?? settingsQuery.data?.metadataExtraction ?? null
  const effectiveImageSaveDraft = imageSaveDraft ?? settingsQuery.data?.imageSave ?? null
  const effectiveThumbnailDraft = thumbnailDraft ?? settingsQuery.data?.thumbnail ?? null
  const effectiveGenerationThrottleDraft = generationThrottleDraft ?? settingsQuery.data?.generationThrottle ?? null
  const effectiveVideoOptimizationDraft = videoOptimizationDraft ?? settingsQuery.data?.videoOptimization ?? null
  useChatPageRegistration(canOpenSettings ? {
    kind: 'settings', title: t({ ko: '설정 · {section}', en: 'Settings · {section}' }, { section: t(SETTINGS_TAB_LABELS[activeTab]) }), resourceId: activeTab,
    fields: effectiveGeneralDraft && activeTab === 'general' ? [
      { id: 'language', label: t({ ko: '언어', en: 'Language' }), type: 'select', value: effectiveGeneralDraft.language, options: ['ko', 'en'] },
      { id: 'promptForDownloadLocation', label: t({ ko: '다운로드 위치 묻기', en: 'Ask for download location' }), type: 'boolean', value: effectiveGeneralDraft.promptForDownloadLocation },
      { id: 'enableGallery', label: t({ ko: '갤러리 표시', en: 'Show gallery' }), type: 'boolean', value: effectiveGeneralDraft.enableGallery ?? false },
      { id: 'showRatingBadges', label: t({ ko: '등급 배지 표시', en: 'Show rating badges' }), type: 'boolean', value: effectiveGeneralDraft.showRatingBadges ?? false },
    ] : effectiveGeneralDraft && activeTab === 'library' ? [{ id: 'imageSimilarityCheckMode', label: t({ ko: '유사도 검사 방식', en: 'Similarity inspection mode' }), type: 'select', value: effectiveGeneralDraft.imageSimilarityCheckMode ?? 'always', options: ['manual', 'always'] }] : [],
    data: { section: activeTab },
    apply: (patch) => { if (effectiveGeneralDraft) setGeneralDraft({ ...effectiveGeneralDraft, ...patch } as GeneralSettings) },
  } : null, { preserveOnSearchChange: true })
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
  const isMetadataDraftDirty = Boolean(effectiveMetadataDraft && settingsQuery.data?.metadataExtraction && !areSettingsDraftsEqual(effectiveMetadataDraft, settingsQuery.data.metadataExtraction))
  const isImageSaveDraftDirty = Boolean(effectiveImageSaveDraft && settingsQuery.data?.imageSave && !areSettingsDraftsEqual(effectiveImageSaveDraft, settingsQuery.data.imageSave))
  const isThumbnailDraftDirty = Boolean(effectiveThumbnailDraft && settingsQuery.data?.thumbnail && !areSettingsDraftsEqual(effectiveThumbnailDraft, settingsQuery.data.thumbnail))
  const isGenerationThrottleDraftDirty = Boolean(effectiveGenerationThrottleDraft && settingsQuery.data?.generationThrottle && !areSettingsDraftsEqual(effectiveGenerationThrottleDraft, settingsQuery.data.generationThrottle))
  const isVideoOptimizationDraftDirty = Boolean(effectiveVideoOptimizationDraft && settingsQuery.data?.videoOptimization && !areSettingsDraftsEqual(effectiveVideoOptimizationDraft, settingsQuery.data.videoOptimization))

  const { tabProps: appearanceTabProps, draftSection: appearanceDraftSection } = useAppearanceSettingsTab({
    isActive: activeTab === 'general',
    currentAppearance: settingsQuery.data?.appearance,
    savedAppearance,
    syncSettingsCache,
    notifyInfo,
    notifyError,
  })

  const { tabProps: autoTabProps, draftSections: autoDraftSections } = useAutoSettingsTab({
    isActive: activeTab === 'auto',
    taggerSettings: settingsQuery.data?.tagger,
    kaloscopeSettings: settingsQuery.data?.kaloscope,
    syncSettingsCache,
    refreshAutoQueries,
    notifyInfo,
    notifyError,
  })

  // Save mutations only sync caches and drafts; the save bar reports success and failures for all of them at once.
  const generalMutation = useMutation({
    mutationFn: updateGeneralSettings,
    onSuccess: (settings, savedFields) => {
      syncSettingsCache(settings)
      // Only refresh the saved section's fields so unsaved edits in other sections stay in the draft.
      const savedKeys = Object.keys(savedFields) as Array<keyof GeneralSettings>
      setGeneralDraft((currentDraft) => currentDraft ? { ...currentDraft, ...pickGeneralFields(settings.general, savedKeys) } : null)
    },
  })

  const metadataMutation = useMutation({
    mutationFn: updateMetadataSettings,
    onSuccess: (settings) => {
      syncSettingsCache(settings)
      setMetadataDraft(settings.metadataExtraction)
    },
  })

  const metadataReextractMutation = useMutation({
    mutationFn: reextractAllImageMetadata,
    onSuccess: (result) => {
      const skippedText = result.skippedMissingCount > 0
        ? t({ ko: ', 원본 누락 {count}개 제외', en: ', skipped {count} missing originals' }, { count: result.skippedMissingCount })
        : ''
      notifyInfo(t(
        { ko: '전체 메타데이터 재추출을 큐에 등록했어: {queued}/{total}개{skipped}', en: 'Queued metadata re-extraction: {queued}/{total}{skipped}' },
        { queued: result.queuedCount, total: result.totalCandidates, skipped: skippedText },
      ))
    },
    onError: (error) => {
      notifyError(error instanceof Error ? error.message : t({ ko: '전체 메타데이터 재추출을 시작하지 못했어.', en: 'Failed to start metadata re-extraction.' }))
    },
  })

  const imageSaveMutation = useMutation({
    mutationFn: updateImageSaveSettings,
    onSuccess: (settings) => {
      syncSettingsCache(settings)
      setImageSaveDraft(settings.imageSave)
    },
  })

  const thumbnailMutation = useMutation({
    mutationFn: updateThumbnailSettings,
    onSuccess: (settings) => {
      syncSettingsCache(settings)
      setThumbnailDraft(settings.thumbnail)
    },
  })

  const generationThrottleMutation = useMutation({
    mutationFn: updateGenerationThrottleSettings,
    onSuccess: (settings) => {
      syncSettingsCache(settings)
      setGenerationThrottleDraft(settings.generationThrottle)
    },
  })

  const videoOptimizationMutation = useMutation({
    mutationFn: updateVideoOptimizationSettings,
    onSuccess: (settings) => {
      syncSettingsCache(settings)
      setVideoOptimizationDraft(settings.videoOptimization)
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
    {
      id: 'metadata',
      label: t({ ko: '메타데이터', en: 'Metadata' }),
      tab: 'library',
      isDirty: isMetadataDraftDirty,
      save: async () => {
        if (effectiveMetadataDraft) await metadataMutation.mutateAsync(effectiveMetadataDraft)
      },
      discard: () => setMetadataDraft(null),
    },
    {
      id: 'image-save',
      label: t({ ko: '이미지 저장', en: 'Image saving' }),
      tab: 'media',
      isDirty: isImageSaveDraftDirty,
      save: async () => {
        if (effectiveImageSaveDraft) await imageSaveMutation.mutateAsync(effectiveImageSaveDraft)
      },
      discard: () => setImageSaveDraft(null),
    },
    {
      id: 'thumbnail',
      label: t({ ko: '썸네일', en: 'Thumbnail' }),
      tab: 'media',
      isDirty: isThumbnailDraftDirty,
      save: async () => {
        if (effectiveThumbnailDraft) await thumbnailMutation.mutateAsync(effectiveThumbnailDraft)
      },
      discard: () => setThumbnailDraft(null),
    },
    {
      id: 'video-optimization',
      label: t({ ko: '비디오 최적화', en: 'Video optimization' }),
      tab: 'media',
      isDirty: isVideoOptimizationDraftDirty,
      save: async () => {
        if (effectiveVideoOptimizationDraft) await videoOptimizationMutation.mutateAsync(effectiveVideoOptimizationDraft)
      },
      discard: () => setVideoOptimizationDraft(null),
    },
    ...autoDraftSections,
    {
      id: 'generation-throttle',
      label: t({ ko: '생성 텀', en: 'Generation pacing' }),
      tab: 'generation',
      isDirty: isGenerationThrottleDraftDirty,
      save: async () => {
        if (effectiveGenerationThrottleDraft) await generationThrottleMutation.mutateAsync(effectiveGenerationThrottleDraft)
      },
      discard: () => setGenerationThrottleDraft(null),
    },
  ]
  const dirtySections = draftSections.filter((section) => section.isDirty)

  const handleSaveAll = async () => {
    if (isSavingAll || dirtySections.length === 0) {
      return
    }

    setIsSavingAll(true)
    const failures = await saveSettingsDraftSections(dirtySections, t({ ko: '저장에 실패했어.', en: 'Save failed.' }))
    setIsSavingAll(false)

    if (failures.length === 0) {
      notifyInfo(t({ ko: '변경 {count}건을 저장했어.', en: 'Saved {count} changes.' }, { count: formatNumber(dirtySections.length) }))
      return
    }

    const savedCount = dirtySections.length - failures.length
    const details = failures.map((failure) => `${failure.section.label}: ${failure.message}`).join(' · ')
    notifyError(savedCount > 0
      ? t({ ko: '{saved}건은 저장했지만 {failed}건은 실패했어. {details}', en: 'Saved {saved}, but {failed} failed. {details}' }, { saved: formatNumber(savedCount), failed: formatNumber(failures.length), details })
      : t({ ko: '{failed}건을 저장하지 못했어. {details}', en: 'Could not save {failed} changes. {details}' }, { failed: formatNumber(failures.length), details }))
  }

  const handleDiscardAll = () => {
    dirtySections.forEach((section) => section.discard())
    notifyInfo(t({ ko: '저장하지 않은 변경을 되돌렸어.', en: 'Reverted unsaved changes.' }))
  }

  useUnsavedSettingsGuard(
    dirtySections.length > 0,
    t({ ko: '저장하지 않은 설정 변경이 있어. 이 페이지를 떠나면 사라져. 계속할까?', en: 'You have unsaved settings changes. They will be lost if you leave this page. Continue?' }),
  )

  if (authStatusQuery.isLoading) {
    return <div className="min-h-screen bg-surface-low animate-pulse" />
  }

  if (!canOpenSettings) {
    // Accounts with page.settings.view but without admin rights get an explanation instead of a silent bounce.
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

  return (
    <PageWithSidebar
      storageKey="settings"
      sidebarLabel={t({ ko: '설정 항목', en: 'Settings sections' })}
      sidebar={<SettingsTabNav activeTab={activeTab} onChange={setActiveTab} />}
      sidebarFooter={<span className="tabular-nums" title={APP_BRAND_TOOLTIP}>{APP_VERSION_LABEL}</span>}
      toolbar={<PageToolbar title={t(SETTINGS_TAB_LABELS[activeTab])} />}
    >
      <div>
        <Suspense fallback={<SettingsSectionFallback />}>
          {activeTab === 'general' ? (
            <div className="space-y-8">
              <GeneralPreferencesSectionsLazy sections={['basic', 'appearance']} {...generalSectionsProps} />
              <AppearanceTabLazy {...appearanceTabProps} />
            </div>
          ) : null}

          {activeTab === 'library' ? (
            <div className="space-y-8">
              <GeneralPreferencesSectionsLazy sections={['library']} {...generalSectionsProps} />
              <FoldersTabLazy {...foldersTabProps} />
              <MetadataTabLazy
                metadataDraft={effectiveMetadataDraft}
                onPatchMetadata={patchMetadataDraft}
                hasChanges={isMetadataDraftDirty}
              />
            </div>
          ) : null}

          {activeTab === 'media' ? (
            <ImageSaveTabLazy
              {...imageSaveTabProps}
              showGenerationThrottle={false}
            />
          ) : null}

          {activeTab === 'auto' ? (
            <AutoTabLazy {...autoTabProps} />
          ) : null}

          {activeTab === 'generation' ? (
            <div className="space-y-8">
              <ImageSaveTabLazy
                {...imageSaveTabProps}
                showMediaSettings={false}
              />
              <IntegrationToolsTabLazy />
            </div>
          ) : null}

          {activeTab === 'chat' ? <ChatSettingsTabLazy /> : null}
          {activeTab === 'llm' ? <LlmSettingsTabLazy /> : null}

          {activeTab === 'accounts' ? <SecurityTabLazy /> : null}

          {activeTab === 'system' ? (
            <div className="space-y-8">
              <McpHttpSettingsCardLazy />
              <GeneralPreferencesSectionsLazy sections={['safety']} {...generalSectionsProps} />
            </div>
          ) : null}

          {activeTab === 'maintenance' ? (
            <MaintenanceTabLazy
              onScanAll={foldersTabProps.onScanAll}
              isScanningAll={foldersTabProps.isScanningAll}
              scanAllJob={foldersTabProps.scanAllJob}
              onCancelScanAll={foldersTabProps.onCancelScanAll}
              isCancellingScanAll={foldersTabProps.isCancellingScanAll}
              onVerifyAllFiles={foldersTabProps.onVerifyAllFiles}
              isVerifyingAllFiles={foldersTabProps.isVerifyingAllFiles}
              onReextractAll={() => void metadataReextractMutation.mutateAsync()}
              isReextracting={metadataReextractMutation.isPending}
              autoTabProps={autoTabProps}
            />
          ) : null}
        </Suspense>
        <SettingsSaveBar
          dirtySections={dirtySections}
          isSaving={isSavingAll}
          onSave={() => void handleSaveAll()}
          onDiscard={handleDiscardAll}
          onOpenTab={setActiveTab}
        />
      </div>
    </PageWithSidebar>
  )
}
