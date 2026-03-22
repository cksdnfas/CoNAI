import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { PageHeader } from '@/components/common/page-header'
import {
  addWatchedFolder,
  checkTaggerDependencies,
  deleteWatchedFolder,
  getAppSettings,
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
  updateKaloscopeSettings,
  updateMetadataSettings,
  updateTaggerSettings,
  updateWatchedFolder,
  validateWatchedFolderPath,
} from '@/lib/api'
import type { AutoTestKaloscopeResult, AutoTestMediaRecord, AutoTestTaggerResult } from '@/lib/api'
import type { WatchedFolderUpdateInput } from '@/types/folder'
import type {
  KaloscopeSettings,
  MetadataExtractionSettings,
  TaggerDependencyCheckResult,
  TaggerSettings,
} from '@/types/settings'
import { AutoTab } from './components/auto-tab'
import { FoldersTab } from './components/folders-tab'
import { MetadataTab } from './components/metadata-tab'
import { SettingsTabNav } from './components/settings-tab-nav'
import type { SettingsTab } from './settings-tabs'
import { createNewWatchedFolderDraft, parseCommaSeparatedInput } from './settings-utils'

export function SettingsPage() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<SettingsTab>('folders')
  const [notice, setNotice] = useState<string | null>(null)
  const [noticeTone, setNoticeTone] = useState<'info' | 'error'>('info')
  const [newFolder, setNewFolder] = useState(createNewWatchedFolderDraft)
  const [pathValidationMessage, setPathValidationMessage] = useState<string | null>(null)
  const [metadataDraft, setMetadataDraft] = useState<MetadataExtractionSettings | null>(null)
  const [taggerDraft, setTaggerDraft] = useState<TaggerSettings | null>(null)
  const [kaloscopeDraft, setKaloscopeDraft] = useState<KaloscopeSettings | null>(null)
  const [taggerDependencyResult, setTaggerDependencyResult] = useState<TaggerDependencyCheckResult | null>(null)
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

  const effectiveMetadataDraft = metadataDraft ?? settingsQuery.data?.metadataExtraction ?? null
  const effectiveTaggerDraft = taggerDraft ?? settingsQuery.data?.tagger ?? null
  const effectiveKaloscopeDraft = kaloscopeDraft ?? settingsQuery.data?.kaloscope ?? null

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
      setNoticeTone('info')
      setNotice('감시 폴더를 추가했어.')
      setNewFolder(createNewWatchedFolderDraft())
      setPathValidationMessage(null)
      await refreshFolderQueries()
    },
    onError: (error) => {
      setNoticeTone('error')
      setNotice(error instanceof Error ? error.message : '감시 폴더 추가에 실패했어.')
    },
  })

  const validatePathMutation = useMutation({
    mutationFn: validateWatchedFolderPath,
    onSuccess: (data) => {
      setPathValidationMessage(data.message)
      setNoticeTone('info')
      setNotice('폴더 경로가 유효해.')
    },
    onError: (error) => {
      setPathValidationMessage(null)
      setNoticeTone('error')
      setNotice(error instanceof Error ? error.message : '폴더 경로 검증에 실패했어.')
    },
  })

  const metadataMutation = useMutation({
    mutationFn: updateMetadataSettings,
    onSuccess: (settings) => {
      syncSettingsCache(settings)
      setMetadataDraft(settings.metadataExtraction)
      setNoticeTone('info')
      setNotice('메타데이터 추출 설정을 저장했어.')
    },
    onError: (error) => {
      setNoticeTone('error')
      setNotice(error instanceof Error ? error.message : '메타데이터 설정 저장에 실패했어.')
    },
  })

  const taggerMutation = useMutation({
    mutationFn: updateTaggerSettings,
    onSuccess: async (settings) => {
      syncSettingsCache(settings)
      setTaggerDraft(settings.tagger)
      await queryClient.invalidateQueries({ queryKey: ['tagger-status'] })
      setNoticeTone('info')
      setNotice('프롬프트 추출 태거 설정을 저장했어.')
    },
    onError: (error) => {
      setNoticeTone('error')
      setNotice(error instanceof Error ? error.message : '태거 설정 저장에 실패했어.')
    },
  })

  const kaloscopeMutation = useMutation({
    mutationFn: updateKaloscopeSettings,
    onSuccess: async (settings) => {
      syncSettingsCache(settings)
      setKaloscopeDraft(settings.kaloscope)
      await refreshAutoQueries()
      setNoticeTone('info')
      setNotice('자동 프롬프트 추출 설정을 저장했어.')
    },
    onError: (error) => {
      setNoticeTone('error')
      setNotice(error instanceof Error ? error.message : 'Kaloscope 설정 저장에 실패했어.')
    },
  })

  const taggerDependencyMutation = useMutation({
    mutationFn: checkTaggerDependencies,
    onSuccess: (result) => {
      setTaggerDependencyResult(result)
      setNoticeTone(result.available ? 'info' : 'error')
      setNotice(result.message)
    },
    onError: (error) => {
      setNoticeTone('error')
      setNotice(error instanceof Error ? error.message : '태거 의존성 확인에 실패했어.')
    },
  })

  const autoTestResolveMutation = useMutation({
    mutationFn: resolveAutoTestMedia,
    onSuccess: (media) => {
      applyAutoTestMedia(media)
      setNoticeTone(media.existsOnDisk ? 'info' : 'error')
      setNotice(media.existsOnDisk ? '테스트 대상을 확인했어.' : '대상은 찾았지만 디스크에서 파일을 확인하지 못했어.')
    },
    onError: (error) => {
      setAutoTestMedia(null)
      setTaggerTestResult(null)
      setKaloscopeTestResult(null)
      setNoticeTone('error')
      setNotice(error instanceof Error ? error.message : '테스트 대상을 찾지 못했어.')
    },
  })

  const autoTestRandomMutation = useMutation({
    mutationFn: getRandomAutoTestMedia,
    onSuccess: (media) => {
      applyAutoTestMedia(media)
      setNoticeTone(media.existsOnDisk ? 'info' : 'error')
      setNotice(media.existsOnDisk ? '랜덤 테스트 대상을 골랐어.' : '랜덤 대상은 찾았지만 디스크에서 파일을 확인하지 못했어.')
    },
    onError: (error) => {
      setNoticeTone('error')
      setNotice(error instanceof Error ? error.message : '랜덤 테스트 대상을 고르지 못했어.')
    },
  })

  const taggerAutoTestMutation = useMutation({
    mutationFn: runTaggerAutoTest,
    onSuccess: (result) => {
      setTaggerTestResult(result)
      setNoticeTone('info')
      setNotice('태거 테스트가 끝났어.')
    },
    onError: (error) => {
      setTaggerTestResult(null)
      setNoticeTone('error')
      setNotice(error instanceof Error ? error.message : '태거 테스트에 실패했어.')
    },
  })

  const kaloscopeAutoTestMutation = useMutation({
    mutationFn: runKaloscopeAutoTest,
    onSuccess: (result) => {
      setKaloscopeTestResult(result)
      setNoticeTone('info')
      setNotice('Kaloscope 테스트가 끝났어.')
    },
    onError: (error) => {
      setKaloscopeTestResult(null)
      setNoticeTone('error')
      setNotice(error instanceof Error ? error.message : 'Kaloscope 테스트에 실패했어.')
    },
  })

  const patchMetadataDraft = (patch: Partial<MetadataExtractionSettings>) => {
    if (!effectiveMetadataDraft) return
    setMetadataDraft({ ...effectiveMetadataDraft, ...patch })
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
    setNoticeTone('info')
    setNotice('감시 폴더 설정을 저장했어.')
    await refreshFolderQueries()
  }

  const handleFolderDelete = async (folderId: number) => {
    await deleteWatchedFolder(folderId)
    setNoticeTone('info')
    setNotice('감시 폴더를 제거했어.')
    await refreshFolderQueries()
  }

  const handleFolderScan = async (folderId: number, full = false) => {
    await scanWatchedFolder(folderId, full)
    setNoticeTone('info')
    setNotice(full ? '전체 재스캔을 시작했어.' : '폴더 스캔을 시작했어.')
    await refreshFolderQueries()
  }

  const handleScanAllFolders = async () => {
    try {
      const summary = await scanAllWatchedFolders()
      setNoticeTone('info')
      setNotice(`전체 스캔 완료: 폴더 ${summary.totalFolders}개, 신규 ${summary.totalNew}개, 기존 ${summary.totalExisting}개`)
      await refreshFolderQueries()
    } catch (error) {
      setNoticeTone('error')
      setNotice(error instanceof Error ? error.message : '전체 스캔에 실패했어.')
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

      setNoticeTone('info')
      setNotice(`watcher를 ${action === 'start' ? '시작' : action === 'stop' ? '중지' : '재시작'}했어.`)
      await refreshFolderQueries()
    } catch (error) {
      setNoticeTone('error')
      setNotice(error instanceof Error ? error.message : 'watcher 제어에 실패했어.')
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
          {notice ? (
            <Alert variant={noticeTone === 'error' ? 'destructive' : 'default'}>
              <AlertTitle>{noticeTone === 'error' ? '문제가 생겼어' : '상태 업데이트'}</AlertTitle>
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          ) : null}

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
              onCheckTaggerDependencies={() => void taggerDependencyMutation.mutateAsync()}
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
