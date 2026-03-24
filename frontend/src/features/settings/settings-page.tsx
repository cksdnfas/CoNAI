import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/common/page-header'
import { useSnackbar } from '@/components/ui/snackbar-context'
import {
  addWatchedFolder,
  checkTaggerDependencies,
  deleteWatchedFolder,
  getAppSettings,
  getImage,
  getKaloscopeStatus,
  getRandomAutoTestMedia,
  getRecentFolderScanLogs,
  getTaggerModels,
  getTaggerStatus,
  getWatchedFolders,
  getWatchersHealth,
  resolveAutoTestMedia,
  restartFolderWatcher,
  runKaloscopeAutoTest,
  runTaggerAutoTest,
  scanAllWatchedFolders,
  scanWatchedFolder,
  startFolderWatcher,
  stopFolderWatcher,
  updateAppearanceSettings,
  updateKaloscopeSettings,
  updateMetadataSettings,
  updateTaggerSettings,
  updateWatchedFolder,
  validateWatchedFolderPath,
} from '@/lib/api'
import type { AutoTestKaloscopeResult, AutoTestMediaRecord, AutoTestTaggerResult } from '@/lib/api'
import type { ImageRecord } from '@/types/image'
import type { WatchedFolderUpdateInput } from '@/types/folder'
import type {
  AppearanceSettings,
  KaloscopeSettings,
  MetadataExtractionSettings,
  TaggerDependencyCheckResult,
  TaggerSettings,
} from '@/types/settings'
import { AutoTab } from './components/auto-tab'
import { AppearanceTab } from './components/appearance-tab'
import { FoldersTab } from './components/folders-tab'
import { MetadataTab } from './components/metadata-tab'
import { SettingsTabNav } from './components/settings-tab-nav'
import type { SettingsTab } from './settings-tabs'
import { DEFAULT_APPEARANCE_SETTINGS } from '@/lib/appearance'
import { createNewWatchedFolderDraft, parseCommaSeparatedInput } from './settings-utils'

export function SettingsPage() {
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const [activeTab, setActiveTab] = useState<SettingsTab>('folders')
  const [newFolder, setNewFolder] = useState(createNewWatchedFolderDraft)
  const [pathValidationMessage, setPathValidationMessage] = useState<string | null>(null)
  const [appearanceDraft, setAppearanceDraft] = useState<AppearanceSettings | null>(null)
  const [metadataDraft, setMetadataDraft] = useState<MetadataExtractionSettings | null>(null)
  const [taggerDraft, setTaggerDraft] = useState<TaggerSettings | null>(null)
  const [kaloscopeDraft, setKaloscopeDraft] = useState<KaloscopeSettings | null>(null)
  const [taggerDependencyResult, setTaggerDependencyResult] = useState<TaggerDependencyCheckResult | null>(null)
  const hasAutoCheckedTaggerDependenciesRef = useRef(false)
  const [autoTestHashInput, setAutoTestHashInput] = useState('')
  const [autoTestMedia, setAutoTestMedia] = useState<AutoTestMediaRecord | null>(null)
  const [taggerTestResult, setTaggerTestResult] = useState<AutoTestTaggerResult | null>(null)
  const [kaloscopeTestResult, setKaloscopeTestResult] = useState<AutoTestKaloscopeResult | null>(null)

  const settingsQuery = useQuery({
    queryKey: ['app-settings'],
    queryFn: getAppSettings,
  })
  const foldersQuery = useQuery({
    queryKey: ['watched-folders'],
    queryFn: () => getWatchedFolders(false),
  })
  const scanLogsQuery = useQuery({
    queryKey: ['folder-scan-logs'],
    queryFn: () => getRecentFolderScanLogs(20),
  })
  const watchersHealthQuery = useQuery({
    queryKey: ['watchers-health'],
    queryFn: getWatchersHealth,
  })
  const taggerModelsQuery = useQuery({
    queryKey: ['tagger-models'],
    queryFn: getTaggerModels,
  })
  const taggerStatusQuery = useQuery({
    queryKey: ['tagger-status'],
    queryFn: getTaggerStatus,
  })
  const kaloscopeStatusQuery = useQuery({
    queryKey: ['kaloscope-status'],
    queryFn: getKaloscopeStatus,
  })
  const autoTestImageQuery = useQuery({
    queryKey: ['auto-test-image-detail', autoTestMedia?.compositeHash],
    queryFn: () => getImage(autoTestMedia!.compositeHash),
    enabled: Boolean(autoTestMedia?.compositeHash),
  })

  const effectiveAppearanceDraft = appearanceDraft ?? settingsQuery.data?.appearance ?? null
  const effectiveMetadataDraft = metadataDraft ?? settingsQuery.data?.metadataExtraction ?? null
  const effectiveTaggerDraft = taggerDraft ?? settingsQuery.data?.tagger ?? null
  const effectiveKaloscopeDraft = kaloscopeDraft ?? settingsQuery.data?.kaloscope ?? null

  const notifyInfo = (message: string) => {
    showSnackbar({ message, tone: 'info' })
  }

  const notifyError = (message: string) => {
    showSnackbar({ message, tone: 'error' })
  }

  const folderWatcherMap = useMemo(() => {
    const map = new Map<number, string>()
    for (const watcher of watchersHealthQuery.data?.watchers ?? []) {
      map.set(watcher.folderId, watcher.state)
    }
    return map
  }, [watchersHealthQuery.data?.watchers])

  const syncSettingsCache = (nextSettings: Awaited<ReturnType<typeof getAppSettings>>) => {
    queryClient.setQueryData(['app-settings'], nextSettings)
  }

  const refreshFolderQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['watched-folders'] }),
      queryClient.invalidateQueries({ queryKey: ['folder-scan-logs'] }),
      queryClient.invalidateQueries({ queryKey: ['watchers-health'] }),
    ])
  }

  const refreshAutoQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['app-settings'] }),
      queryClient.invalidateQueries({ queryKey: ['tagger-models'] }),
      queryClient.invalidateQueries({ queryKey: ['tagger-status'] }),
      queryClient.invalidateQueries({ queryKey: ['kaloscope-status'] }),
    ])
  }

  const applyAutoTestMedia = (media: AutoTestMediaRecord) => {
    setAutoTestHashInput(media.compositeHash)
    setAutoTestMedia(media)
    setTaggerTestResult(null)
    setKaloscopeTestResult(null)
  }

  const addFolderMutation = useMutation({
    mutationFn: addWatchedFolder,
    onSuccess: async () => {
      notifyInfo('감시 폴더를 추가했어.')
      setNewFolder(createNewWatchedFolderDraft())
      setPathValidationMessage(null)
      await refreshFolderQueries()
    },
    onError: (error) => {
      notifyError(error instanceof Error ? error.message : '감시 폴더 추가에 실패했어.')
    },
  })

  const validatePathMutation = useMutation({
    mutationFn: validateWatchedFolderPath,
    onSuccess: (data) => {
      setPathValidationMessage(data.message)
      notifyInfo('폴더 경로가 유효해.')
    },
    onError: (error) => {
      setPathValidationMessage(null)
      notifyError(error instanceof Error ? error.message : '폴더 경로 검증에 실패했어.')
    },
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

  const appearanceMutation = useMutation({
    mutationFn: updateAppearanceSettings,
    onSuccess: (settings) => {
      syncSettingsCache(settings)
      setAppearanceDraft(settings.appearance)
      notifyInfo('화면 설정을 저장했어.')
    },
    onError: (error) => {
      notifyError(error instanceof Error ? error.message : '화면 설정 저장에 실패했어.')
    },
  })

  const taggerMutation = useMutation({
    mutationFn: updateTaggerSettings,
    onSuccess: async (settings) => {
      syncSettingsCache(settings)
      setTaggerDraft(settings.tagger)
      setTaggerDependencyResult(null)
      hasAutoCheckedTaggerDependenciesRef.current = false
      await queryClient.invalidateQueries({ queryKey: ['tagger-status'] })
      notifyInfo('프롬프트 추출 태거 설정을 저장했어.')
    },
    onError: (error) => {
      notifyError(error instanceof Error ? error.message : '태거 설정 저장에 실패했어.')
    },
  })

  const kaloscopeMutation = useMutation({
    mutationFn: updateKaloscopeSettings,
    onSuccess: async (settings) => {
      syncSettingsCache(settings)
      setKaloscopeDraft(settings.kaloscope)
      await refreshAutoQueries()
      notifyInfo('자동 프롬프트 추출 설정을 저장했어.')
    },
    onError: (error) => {
      notifyError(error instanceof Error ? error.message : 'Kaloscope 설정 저장에 실패했어.')
    },
  })

  const taggerDependencyMutation = useMutation({
    mutationFn: checkTaggerDependencies,
    onSuccess: (result) => {
      setTaggerDependencyResult(result)
    },
    onError: (error) => {
      notifyError(error instanceof Error ? error.message : '태거 의존성 확인에 실패했어.')
    },
  })

  useEffect(() => {
    if (activeTab !== 'auto') return
    if (hasAutoCheckedTaggerDependenciesRef.current || taggerDependencyMutation.isPending) return

    hasAutoCheckedTaggerDependenciesRef.current = true
    void taggerDependencyMutation.mutateAsync()
  }, [activeTab, taggerDependencyMutation])

  const autoTestResolveMutation = useMutation({
    mutationFn: resolveAutoTestMedia,
    onSuccess: (media) => {
      applyAutoTestMedia(media)
      if (media.existsOnDisk) {
        notifyInfo('테스트 대상을 확인했어.')
      } else {
        notifyError('대상은 찾았지만 디스크에서 파일을 확인하지 못했어.')
      }
    },
    onError: (error) => {
      setAutoTestMedia(null)
      setTaggerTestResult(null)
      setKaloscopeTestResult(null)
      notifyError(error instanceof Error ? error.message : '테스트 대상을 찾지 못했어.')
    },
  })

  const autoTestRandomMutation = useMutation({
    mutationFn: getRandomAutoTestMedia,
    onSuccess: (media) => {
      applyAutoTestMedia(media)
      if (media.existsOnDisk) {
        notifyInfo('랜덤 테스트 대상을 골랐어.')
      } else {
        notifyError('랜덤 대상은 찾았지만 디스크에서 파일을 확인하지 못했어.')
      }
    },
    onError: (error) => {
      notifyError(error instanceof Error ? error.message : '랜덤 테스트 대상을 고르지 못했어.')
    },
  })

  const taggerAutoTestMutation = useMutation({
    mutationFn: runTaggerAutoTest,
    onSuccess: (result) => {
      setTaggerTestResult(result)
      notifyInfo('태거 테스트가 끝났어.')
    },
    onError: (error) => {
      setTaggerTestResult(null)
      notifyError(error instanceof Error ? error.message : '태거 테스트에 실패했어.')
    },
  })

  const kaloscopeAutoTestMutation = useMutation({
    mutationFn: runKaloscopeAutoTest,
    onSuccess: (result) => {
      setKaloscopeTestResult(result)
      notifyInfo('Kaloscope 테스트가 끝났어.')
    },
    onError: (error) => {
      setKaloscopeTestResult(null)
      notifyError(error instanceof Error ? error.message : 'Kaloscope 테스트에 실패했어.')
    },
  })

  const patchMetadataDraft = (patch: Partial<MetadataExtractionSettings>) => {
    if (!effectiveMetadataDraft) return
    setMetadataDraft({ ...effectiveMetadataDraft, ...patch })
  }

  const patchAppearanceDraft = (patch: Partial<AppearanceSettings>) => {
    if (!effectiveAppearanceDraft) return
    setAppearanceDraft({ ...effectiveAppearanceDraft, ...patch })
  }

  const patchTaggerDraft = (patch: Partial<TaggerSettings>) => {
    if (!effectiveTaggerDraft) return
    setTaggerDraft({ ...effectiveTaggerDraft, ...patch })
  }

  const patchKaloscopeDraft = (patch: Partial<KaloscopeSettings>) => {
    if (!effectiveKaloscopeDraft) return
    setKaloscopeDraft({ ...effectiveKaloscopeDraft, ...patch })
  }

  const handleFolderSave = async (folderId: number, input: WatchedFolderUpdateInput) => {
    await updateWatchedFolder(folderId, input)
    notifyInfo('감시 폴더 설정을 저장했어.')
    await refreshFolderQueries()
  }

  const handleFolderDelete = async (folderId: number) => {
    await deleteWatchedFolder(folderId)
    notifyInfo('감시 폴더를 제거했어.')
    await refreshFolderQueries()
  }

  const handleFolderScan = async (folderId: number, full = false) => {
    await scanWatchedFolder(folderId, full)
    notifyInfo(full ? '전체 재스캔을 시작했어.' : '폴더 스캔을 시작했어.')
    await refreshFolderQueries()
  }

  const handleScanAllFolders = async () => {
    try {
      const summary = await scanAllWatchedFolders()
      notifyInfo(`전체 스캔 완료: 폴더 ${summary.totalFolders}개, 신규 ${summary.totalNew}개, 기존 ${summary.totalExisting}개`)
      await refreshFolderQueries()
    } catch (error) {
      notifyError(error instanceof Error ? error.message : '전체 스캔에 실패했어.')
    }
  }

  const handleWatcherAction = async (folderId: number, action: 'start' | 'stop' | 'restart') => {
    try {
      if (action === 'start') {
        await startFolderWatcher(folderId)
      } else if (action === 'stop') {
        await stopFolderWatcher(folderId)
      } else {
        await restartFolderWatcher(folderId)
      }

      notifyInfo(`watcher를 ${action === 'start' ? '시작' : action === 'stop' ? '중지' : '재시작'}했어.`)
      await refreshFolderQueries()
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'watcher 제어에 실패했어.')
    }
  }

  const handleAddFolder = () => {
    void addFolderMutation.mutateAsync({
      folder_path: newFolder.folder_path,
      folder_name: newFolder.folder_name || undefined,
      auto_scan: newFolder.auto_scan,
      scan_interval: newFolder.scan_interval,
      recursive: newFolder.recursive,
      watcher_enabled: newFolder.watcher_enabled,
      watcher_polling_interval: newFolder.watcher_polling_interval,
      exclude_extensions: parseCommaSeparatedInput(newFolder.exclude_extensions),
      exclude_patterns: parseCommaSeparatedInput(newFolder.exclude_patterns),
    })
  }

  const handleResolveAutoTestMedia = () => {
    const nextHash = autoTestHashInput.trim()
    if (!nextHash) return
    void autoTestResolveMutation.mutateAsync(nextHash)
  }

  const handleRunTaggerAutoTest = () => {
    if (!autoTestMedia?.existsOnDisk) return
    setTaggerTestResult(null)
    void taggerAutoTestMutation.mutateAsync(autoTestMedia.compositeHash)
  }

  const handleRunKaloscopeAutoTest = () => {
    if (!autoTestMedia?.existsOnDisk) return
    setKaloscopeTestResult(null)
    void kaloscopeAutoTestMutation.mutateAsync(autoTestMedia.compositeHash)
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" />

      <div className="grid gap-8 min-[800px]:grid-cols-[260px_minmax(0,1fr)]">
        <SettingsTabNav activeTab={activeTab} onChange={setActiveTab} />

        <section className="space-y-8">
          {activeTab === 'folders' ? (
            <FoldersTab
              newFolder={newFolder}
              onNewFolderChange={(patch) => setNewFolder((current) => ({ ...current, ...patch }))}
              pathValidationMessage={pathValidationMessage}
              isValidatingPath={validatePathMutation.isPending}
              isAddingFolder={addFolderMutation.isPending}
              onValidatePath={() => void validatePathMutation.mutateAsync(newFolder.folder_path)}
              onAddFolder={handleAddFolder}
              onRefresh={() => void refreshFolderQueries()}
              onScanAll={() => void handleScanAllFolders()}
              folders={foldersQuery.data ?? []}
              foldersLoading={foldersQuery.isLoading}
              foldersError={
                foldersQuery.error instanceof Error
                  ? foldersQuery.error.message
                  : foldersQuery.isError
                    ? '알 수 없는 오류가 발생했어.'
                    : null
              }
              folderWatcherMap={folderWatcherMap}
              onFolderSave={handleFolderSave}
              onFolderScan={handleFolderScan}
              onFolderStartWatcher={(folderId) => handleWatcherAction(folderId, 'start')}
              onFolderStopWatcher={(folderId) => handleWatcherAction(folderId, 'stop')}
              onFolderRestartWatcher={(folderId) => handleWatcherAction(folderId, 'restart')}
              onFolderDelete={handleFolderDelete}
              scanLogs={scanLogsQuery.data ?? []}
              scanLogsLoading={scanLogsQuery.isLoading}
              watchersHealth={watchersHealthQuery.data}
            />
          ) : null}

          {activeTab === 'appearance' ? (
            <AppearanceTab
              appearanceDraft={effectiveAppearanceDraft}
              onPatchAppearance={patchAppearanceDraft}
              onReset={() => setAppearanceDraft(DEFAULT_APPEARANCE_SETTINGS)}
              onSave={() => effectiveAppearanceDraft && void appearanceMutation.mutateAsync(effectiveAppearanceDraft)}
              isSaving={appearanceMutation.isPending}
            />
          ) : null}

          {activeTab === 'auto' ? (
            <AutoTab
              taggerDraft={effectiveTaggerDraft}
              kaloscopeDraft={effectiveKaloscopeDraft}
              taggerModels={taggerModelsQuery.data ?? []}
              taggerStatus={taggerStatusQuery.data}
              kaloscopeStatus={kaloscopeStatusQuery.data}
              taggerDependencyResult={taggerDependencyResult}
              onPatchTagger={patchTaggerDraft}
              onPatchKaloscope={patchKaloscopeDraft}
              onSaveTagger={() => effectiveTaggerDraft && void taggerMutation.mutateAsync(effectiveTaggerDraft)}
              onSaveKaloscope={() => effectiveKaloscopeDraft && void kaloscopeMutation.mutateAsync(effectiveKaloscopeDraft)}
              isSavingTagger={taggerMutation.isPending}
              isSavingKaloscope={kaloscopeMutation.isPending}
              isCheckingTaggerDependencies={taggerDependencyMutation.isPending}
              autoTestHashInput={autoTestHashInput}
              onAutoTestHashInputChange={(value) => {
                setAutoTestHashInput(value)
                setAutoTestMedia(null)
                setTaggerTestResult(null)
                setKaloscopeTestResult(null)
              }}
              autoTestMedia={autoTestMedia}
              autoTestImage={(autoTestImageQuery.data as ImageRecord | undefined) ?? null}
              isLoadingAutoTestImage={autoTestImageQuery.isLoading}
              taggerTestResult={taggerTestResult}
              kaloscopeTestResult={kaloscopeTestResult}
              onResolveAutoTestMedia={handleResolveAutoTestMedia}
              onRandomAutoTestMedia={() => void autoTestRandomMutation.mutateAsync()}
              onRunTaggerAutoTest={handleRunTaggerAutoTest}
              onRunKaloscopeAutoTest={handleRunKaloscopeAutoTest}
              isResolvingAutoTestMedia={autoTestResolveMutation.isPending}
              isPickingRandomAutoTestMedia={autoTestRandomMutation.isPending}
              isRunningTaggerAutoTest={taggerAutoTestMutation.isPending}
              isRunningKaloscopeAutoTest={kaloscopeAutoTestMutation.isPending}
            />
          ) : null}

          {activeTab === 'metadata' ? (
            <MetadataTab
              metadataDraft={effectiveMetadataDraft}
              onPatchMetadata={patchMetadataDraft}
              onSave={() => effectiveMetadataDraft && void metadataMutation.mutateAsync(effectiveMetadataDraft)}
              isSaving={metadataMutation.isPending}
            />
          ) : null}
        </section>
      </div>
    </div>
  )
}
