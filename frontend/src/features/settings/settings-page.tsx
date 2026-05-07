import { Suspense, lazy, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate } from 'react-router-dom'
import { PageHeader } from '@/components/common/page-header'
import { useSnackbar } from '@/components/ui/snackbar-context'
import {
  getAppSettings,
  reextractAllImageMetadata,
  updateGeneralSettings,
  updateGenerationThrottleSettings,
  updateImageSaveSettings,
  updateMetadataSettings,
  updateVideoOptimizationSettings,
} from '@/lib/api-settings'
import { DEFAULT_APPEARANCE_SETTINGS } from '@/lib/appearance'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { cn } from '@/lib/utils'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useI18n } from '@/i18n'
import type {
  GenerationThrottleSettings,
  GeneralSettings,
  ImageSaveSettings,
  MetadataExtractionSettings,
  VideoOptimizationSettings,
} from '@/types/settings'
import { SettingsTabNav } from './components/settings-tab-nav'
import type { SettingsTab } from './settings-tabs'
import { useFolderSettingsTab } from './use-folder-settings-tab'
import { useAppearanceSettingsTab } from './use-appearance-settings-tab'
import { useAutoSettingsTab } from './use-auto-settings-tab'

const GeneralTabLazy = lazy(async () => {
  const module = await import('./components/general-tab')
  return { default: module.GeneralTab }
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

const LlmConnectionsTabLazy = lazy(async () => {
  const module = await import('./components/llm-connections-tab')
  return { default: module.LlmConnectionsTab }
})

type AppSettingsRecord = Awaited<ReturnType<typeof getAppSettings>>

function SettingsSectionFallback() {
  return <div className="min-h-[16rem] rounded-sm border border-border/80 bg-surface-low/50 animate-pulse" />
}

/** Keep the settings page as a composition root for tab-level state and access. */
export function SettingsPage() {
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const authStatusQuery = useAuthStatusQuery()
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [generalDraft, setGeneralDraft] = useState<GeneralSettings | null>(null)
  const [metadataDraft, setMetadataDraft] = useState<MetadataExtractionSettings | null>(null)
  const [imageSaveDraft, setImageSaveDraft] = useState<ImageSaveSettings | null>(null)
  const [generationThrottleDraft, setGenerationThrottleDraft] = useState<GenerationThrottleSettings | null>(null)
  const [videoOptimizationDraft, setVideoOptimizationDraft] = useState<VideoOptimizationSettings | null>(null)
  const isDesktopPageLayout = useDesktopPageLayout()
  const canOpenSettings = authStatusQuery.data?.isAdmin === true || authStatusQuery.data?.hasCredentials !== true

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
  }

  const refreshAutoQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['app-settings'] }),
      queryClient.invalidateQueries({ queryKey: ['tagger-models'] }),
      queryClient.invalidateQueries({ queryKey: ['tagger-status'] }),
      queryClient.invalidateQueries({ queryKey: ['kaloscope-status'] }),
    ])
  }

  const { tabProps: foldersTabProps } = useFolderSettingsTab({ notifyInfo, notifyError })

  const effectiveMetadataDraft = metadataDraft ?? settingsQuery.data?.metadataExtraction ?? null
  const effectiveImageSaveDraft = imageSaveDraft ?? settingsQuery.data?.imageSave ?? null
  const effectiveGenerationThrottleDraft = generationThrottleDraft ?? settingsQuery.data?.generationThrottle ?? null
  const effectiveVideoOptimizationDraft = videoOptimizationDraft ?? settingsQuery.data?.videoOptimization ?? null
  const savedAppearance = settingsQuery.data?.appearance ?? DEFAULT_APPEARANCE_SETTINGS

  const { tabProps: appearanceTabProps } = useAppearanceSettingsTab({
    isActive: activeTab === 'appearance',
    currentAppearance: settingsQuery.data?.appearance,
    savedAppearance,
    syncSettingsCache,
    notifyInfo,
    notifyError,
  })

  const { tabProps: autoTabProps } = useAutoSettingsTab({
    isActive: activeTab === 'auto',
    taggerSettings: settingsQuery.data?.tagger,
    kaloscopeSettings: settingsQuery.data?.kaloscope,
    syncSettingsCache,
    refreshAutoQueries,
    notifyInfo,
    notifyError,
  })

  const generalMutation = useMutation({
    mutationFn: updateGeneralSettings,
    onSuccess: (settings) => {
      syncSettingsCache(settings)
      setGeneralDraft(settings.general)
      notifyInfo(t({ ko: '일반 설정을 저장했어.', en: 'General settings saved.' }))
    },
    onError: (error) => {
      notifyError(error instanceof Error ? error.message : t({ ko: '일반 설정 저장에 실패했어.', en: 'Failed to save general settings.' }))
    },
  })

  const metadataMutation = useMutation({
    mutationFn: updateMetadataSettings,
    onSuccess: (settings) => {
      syncSettingsCache(settings)
      setMetadataDraft(settings.metadataExtraction)
      notifyInfo(t({ ko: '메타데이터 추출 설정을 저장했어.', en: 'Metadata extraction settings saved.' }))
    },
    onError: (error) => {
      notifyError(error instanceof Error ? error.message : t({ ko: '메타데이터 설정 저장에 실패했어.', en: 'Failed to save metadata settings.' }))
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
      notifyInfo(t({ ko: '이미지 저장 설정을 저장했어.', en: 'Image save settings saved.' }))
    },
    onError: (error) => {
      notifyError(error instanceof Error ? error.message : t({ ko: '이미지 저장 설정 저장에 실패했어.', en: 'Failed to save image save settings.' }))
    },
  })

  const generationThrottleMutation = useMutation({
    mutationFn: updateGenerationThrottleSettings,
    onSuccess: (settings) => {
      syncSettingsCache(settings)
      setGenerationThrottleDraft(settings.generationThrottle)
      notifyInfo(t({ ko: '생성 텀 설정을 저장했어.', en: 'Generation throttle settings saved.' }))
    },
    onError: (error) => {
      notifyError(error instanceof Error ? error.message : t({ ko: '생성 텀 설정 저장에 실패했어.', en: 'Failed to save generation throttle settings.' }))
    },
  })

  const videoOptimizationMutation = useMutation({
    mutationFn: updateVideoOptimizationSettings,
    onSuccess: (settings) => {
      syncSettingsCache(settings)
      setVideoOptimizationDraft(settings.videoOptimization)
      notifyInfo(t({ ko: '비디오 최적화 설정을 저장했어.', en: 'Video optimization settings saved.' }))
    },
    onError: (error) => {
      notifyError(error instanceof Error ? error.message : t({ ko: '비디오 최적화 설정 저장에 실패했어.', en: 'Failed to save video optimization settings.' }))
    },
  })

  if (authStatusQuery.isLoading) {
    return <div className="min-h-screen bg-surface-low animate-pulse" />
  }

  if (!canOpenSettings) {
    return <Navigate to="/" replace />
  }

  const effectiveGeneralDraft = generalDraft ?? settingsQuery.data?.general ?? null

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

  return (
    <div className="space-y-6">
      <PageHeader title={t({ ko: '설정', en: 'Settings' })} />

      <div className={cn('grid gap-6', isDesktopPageLayout ? 'grid-cols-[248px_minmax(0,1fr)]' : 'grid-cols-1')}>
        <SettingsTabNav activeTab={activeTab} onChange={setActiveTab} />

        <section className="space-y-6">
          <Suspense fallback={<SettingsSectionFallback />}>
            {activeTab === 'general' ? (
              <GeneralTabLazy
                generalDraft={effectiveGeneralDraft}
                onPatchGeneral={patchGeneralDraft}
                onPatchDeleteProtection={patchDeleteProtectionDraft}
                onSave={() => effectiveGeneralDraft && void generalMutation.mutateAsync(effectiveGeneralDraft)}
                isSaving={generalMutation.isPending}
              />
            ) : null}

            {activeTab === 'folders' ? <FoldersTabLazy {...foldersTabProps} /> : null}

            {activeTab === 'appearance' ? (
              <AppearanceTabLazy {...appearanceTabProps} />
            ) : null}

            {activeTab === 'security' ? <SecurityTabLazy /> : null}

            {activeTab === 'auto' ? (
              <AutoTabLazy {...autoTabProps} />
            ) : null}

            {activeTab === 'metadata' ? (
              <MetadataTabLazy
                metadataDraft={effectiveMetadataDraft}
                onPatchMetadata={patchMetadataDraft}
                onSave={() => effectiveMetadataDraft && void metadataMutation.mutateAsync(effectiveMetadataDraft)}
                isSaving={metadataMutation.isPending}
                onReextractAll={() => void metadataReextractMutation.mutateAsync()}
                isReextracting={metadataReextractMutation.isPending}
              />
            ) : null}

            {activeTab === 'image-save' ? (
              <ImageSaveTabLazy
                imageSaveDraft={effectiveImageSaveDraft}
                onPatchImageSave={patchImageSaveDraft}
                onSave={() => effectiveImageSaveDraft && void imageSaveMutation.mutateAsync(effectiveImageSaveDraft)}
                isSaving={imageSaveMutation.isPending}
                generationThrottleDraft={effectiveGenerationThrottleDraft}
                onPatchGenerationThrottle={patchGenerationThrottleDraft}
                onSaveGenerationThrottle={() => effectiveGenerationThrottleDraft && void generationThrottleMutation.mutateAsync(effectiveGenerationThrottleDraft)}
                isSavingGenerationThrottle={generationThrottleMutation.isPending}
                videoOptimizationDraft={effectiveVideoOptimizationDraft}
                onPatchVideoOptimization={patchVideoOptimizationDraft}
                onSaveVideoOptimization={() => effectiveVideoOptimizationDraft && void videoOptimizationMutation.mutateAsync(effectiveVideoOptimizationDraft)}
                isSavingVideoOptimization={videoOptimizationMutation.isPending}
              />
            ) : null}

            {activeTab === 'llm-connections' ? <LlmConnectionsTabLazy /> : null}
          </Suspense>
        </section>
      </div>
    </div>
  )
}
