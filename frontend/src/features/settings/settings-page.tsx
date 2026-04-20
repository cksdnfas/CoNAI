import { Suspense, lazy, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate } from 'react-router-dom'
import { PageHeader } from '@/components/common/page-header'
import { useSnackbar } from '@/components/ui/snackbar-context'
import {
  getAppSettings,
  updateImageSaveSettings,
  updateMetadataSettings,
} from '@/lib/api'
import { DEFAULT_APPEARANCE_SETTINGS } from '@/lib/appearance'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { cn } from '@/lib/utils'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import type {
  ImageSaveSettings,
  MetadataExtractionSettings,
} from '@/types/settings'
import { SettingsTabNav } from './components/settings-tab-nav'
import type { SettingsTab } from './settings-tabs'
import { useFolderSettingsTab } from './use-folder-settings-tab'
import { useAppearanceSettingsTab } from './use-appearance-settings-tab'
import { useAutoSettingsTab } from './use-auto-settings-tab'

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

type AppSettingsRecord = Awaited<ReturnType<typeof getAppSettings>>

function SettingsSectionFallback() {
  return <div className="min-h-[16rem] rounded-sm border border-border/80 bg-surface-low/50 animate-pulse" />
}

/** Keep the settings page as a composition root for tab-level state and access. */
export function SettingsPage() {
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const authStatusQuery = useAuthStatusQuery()
  const [activeTab, setActiveTab] = useState<SettingsTab>('folders')
  const [metadataDraft, setMetadataDraft] = useState<MetadataExtractionSettings | null>(null)
  const [imageSaveDraft, setImageSaveDraft] = useState<ImageSaveSettings | null>(null)
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

  const metadataMutation = useMutation({
    mutationFn: updateMetadataSettings,
    onSuccess: (settings) => {
      syncSettingsCache(settings)
      setMetadataDraft(settings.metadataExtraction)
      notifyInfo('메타데이터 추출 설정을 저장했어.')
    },
    onError: (error) => {
      notifyError(error instanceof Error ? error.message : '메타데이터 설정 저장에 실패했어.')
    },
  })

  const imageSaveMutation = useMutation({
    mutationFn: updateImageSaveSettings,
    onSuccess: (settings) => {
      syncSettingsCache(settings)
      setImageSaveDraft(settings.imageSave)
      notifyInfo('이미지 저장 설정을 저장했어.')
    },
    onError: (error) => {
      notifyError(error instanceof Error ? error.message : '이미지 저장 설정 저장에 실패했어.')
    },
  })

  if (authStatusQuery.isLoading) {
    return <div className="min-h-screen bg-surface-low animate-pulse" />
  }

  if (!canOpenSettings) {
    return <Navigate to="/" replace />
  }

  const patchMetadataDraft = (patch: Partial<MetadataExtractionSettings>) => {
    if (!effectiveMetadataDraft) return
    setMetadataDraft({ ...effectiveMetadataDraft, ...patch })
  }

  const patchImageSaveDraft = (patch: Partial<ImageSaveSettings>) => {
    if (!effectiveImageSaveDraft) return
    setImageSaveDraft({ ...effectiveImageSaveDraft, ...patch })
  }

  return (
    <div className="space-y-6">
      <PageHeader title="설정" />

      <div className={cn('grid gap-6', isDesktopPageLayout ? 'grid-cols-[248px_minmax(0,1fr)]' : 'grid-cols-1')}>
        <SettingsTabNav activeTab={activeTab} onChange={setActiveTab} />

        <section className="space-y-6">
          <Suspense fallback={<SettingsSectionFallback />}>
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
              />
            ) : null}

            {activeTab === 'image-save' ? (
              <ImageSaveTabLazy
                imageSaveDraft={effectiveImageSaveDraft}
                onPatchImageSave={patchImageSaveDraft}
                onSave={() => effectiveImageSaveDraft && void imageSaveMutation.mutateAsync(effectiveImageSaveDraft)}
                isSaving={imageSaveMutation.isPending}
              />
            ) : null}
          </Suspense>
        </section>
      </div>
    </div>
  )
}
