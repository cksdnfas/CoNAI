import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addBackupSource,
  addWatchedFolder,
  deleteBackupSource,
  deleteWatchedFolder,
  getBackupSources,
  getRecentFolderScanLogs,
  getWatchedFolders,
  getWatchersHealth,
  restartBackupSourceWatcher,
  restartFolderWatcher,
  runFileVerification,
  scanAllWatchedFolders,
  scanWatchedFolder,
  startBackupSourceWatcher,
  startFolderWatcher,
  stopBackupSourceWatcher,
  stopFolderWatcher,
  updateBackupSource,
  updateWatchedFolder,
  validateBackupSourcePath,
  validateWatchedFolderPath,
} from '@/lib/api'
import type { BackupSourceUpdateInput, WatchedFolderUpdateInput } from '@/types/folder'
import { createNewBackupSourceDraft, createNewWatchedFolderDraft, normalizeBackupTargetPath, parseCommaSeparatedInput } from './settings-utils'

interface UseFolderSettingsTabOptions {
  /** Show a success/info snackbar for folder tab actions. */
  notifyInfo: (message: string) => void
  /** Show an error snackbar for folder tab actions. */
  notifyError: (message: string) => void
}

/** Collect folder-tab state, queries, and actions away from SettingsPage. */
export function useFolderSettingsTab({ notifyInfo, notifyError }: UseFolderSettingsTabOptions) {
  const queryClient = useQueryClient()
  const [newFolder, setNewFolder] = useState(createNewWatchedFolderDraft)
  const [newBackupSource, setNewBackupSource] = useState(createNewBackupSourceDraft)
  const [pathValidationMessage, setPathValidationMessage] = useState<string | null>(null)
  const [backupPathValidationMessage, setBackupPathValidationMessage] = useState<string | null>(null)

  const foldersQuery = useQuery({
    queryKey: ['watched-folders'],
    queryFn: () => getWatchedFolders(false),
  })
  const scanLogsQuery = useQuery({
    queryKey: ['folder-scan-logs'],
    queryFn: () => getRecentFolderScanLogs(20),
  })
  const backupSourcesQuery = useQuery({
    queryKey: ['backup-sources'],
    queryFn: () => getBackupSources(false),
  })
  const watchersHealthQuery = useQuery({
    queryKey: ['watchers-health'],
    queryFn: getWatchersHealth,
  })

  const folderWatcherMap = useMemo(() => {
    const map = new Map<number, string>()
    for (const watcher of watchersHealthQuery.data?.watchers ?? []) {
      map.set(watcher.folderId, watcher.state)
    }
    return map
  }, [watchersHealthQuery.data?.watchers])

  const refreshFolderQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['watched-folders'] }),
      queryClient.invalidateQueries({ queryKey: ['backup-sources'] }),
      queryClient.invalidateQueries({ queryKey: ['folder-scan-logs'] }),
      queryClient.invalidateQueries({ queryKey: ['watchers-health'] }),
    ])
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

  const addBackupSourceMutation = useMutation({
    mutationFn: addBackupSource,
    onSuccess: async () => {
      notifyInfo('백업 소스를 추가했어.')
      setNewBackupSource(createNewBackupSourceDraft())
      setBackupPathValidationMessage(null)
      await refreshFolderQueries()
    },
    onError: (error) => {
      notifyError(error instanceof Error ? error.message : '백업 소스 추가에 실패했어.')
    },
  })

  const validateBackupPathMutation = useMutation({
    mutationFn: validateBackupSourcePath,
    onSuccess: (data) => {
      setBackupPathValidationMessage(data.message)
      notifyInfo('백업 source 경로가 유효해.')
    },
    onError: (error) => {
      setBackupPathValidationMessage(null)
      notifyError(error instanceof Error ? error.message : '백업 source 경로 검증에 실패했어.')
    },
  })

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

  const verifyAllFilesMutation = useMutation({
    mutationFn: runFileVerification,
    onSuccess: async (result) => {
      notifyInfo(`파일 검증 완료: 검사 ${result.totalChecked}개, 이슈 ${result.missingFound}개, 정리 ${result.deletedRecords}개`)
      await refreshFolderQueries()
    },
    onError: (error) => {
      notifyError(error instanceof Error ? error.message : '파일 검증에 실패했어.')
    },
  })

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

  const handleAddFolder = async () => {
    try {
      await addFolderMutation.mutateAsync({
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
      return true
    } catch {
      return false
    }
  }

  const handleBackupSourceSave = async (sourceId: number, input: BackupSourceUpdateInput) => {
    await updateBackupSource(sourceId, input)
    notifyInfo('백업 소스 설정을 저장했어.')
    await refreshFolderQueries()
  }

  const handleBackupSourceDelete = async (sourceId: number) => {
    await deleteBackupSource(sourceId)
    notifyInfo('백업 소스를 제거했어.')
    await refreshFolderQueries()
  }

  const handleBackupSourceWatcherAction = async (sourceId: number, action: 'start' | 'stop' | 'restart') => {
    try {
      if (action === 'start') {
        await startBackupSourceWatcher(sourceId)
      } else if (action === 'stop') {
        await stopBackupSourceWatcher(sourceId)
      } else {
        await restartBackupSourceWatcher(sourceId)
      }

      notifyInfo(`백업 source watcher를 ${action === 'start' ? '시작' : action === 'stop' ? '중지' : '재시작'}했어.`)
      await refreshFolderQueries()
    } catch (error) {
      notifyError(error instanceof Error ? error.message : '백업 source watcher 제어에 실패했어.')
    }
  }

  const handleAddBackupSource = async () => {
    try {
      await addBackupSourceMutation.mutateAsync({
        source_path: newBackupSource.source_path,
        display_name: newBackupSource.display_name || undefined,
        target_folder_name: normalizeBackupTargetPath(newBackupSource.target_folder_name),
        recursive: newBackupSource.recursive,
        watcher_enabled: newBackupSource.watcher_enabled,
        watcher_polling_interval: newBackupSource.watcher_polling_interval,
        import_mode: newBackupSource.import_mode,
        webp_quality: newBackupSource.webp_quality,
      })
      return true
    } catch {
      return false
    }
  }

  return {
    tabProps: {
      newFolder,
      onNewFolderChange: (patch: Partial<typeof newFolder>) => setNewFolder((current) => ({ ...current, ...patch })),
      pathValidationMessage,
      isValidatingPath: validatePathMutation.isPending,
      isAddingFolder: addFolderMutation.isPending,
      onValidatePath: () => void validatePathMutation.mutateAsync(newFolder.folder_path),
      onAddFolder: handleAddFolder,
      newBackupSource,
      onNewBackupSourceChange: (patch: Partial<typeof newBackupSource>) => setNewBackupSource((current) => ({ ...current, ...patch })),
      backupPathValidationMessage,
      isValidatingBackupPath: validateBackupPathMutation.isPending,
      isAddingBackupSource: addBackupSourceMutation.isPending,
      onValidateBackupPath: () => void validateBackupPathMutation.mutateAsync(newBackupSource.source_path),
      onAddBackupSource: handleAddBackupSource,
      onRefresh: () => void refreshFolderQueries(),
      onVerifyAllFiles: () => void verifyAllFilesMutation.mutateAsync(),
      isVerifyingAllFiles: verifyAllFilesMutation.isPending,
      onScanAll: () => void handleScanAllFolders(),
      folders: foldersQuery.data ?? [],
      foldersLoading: foldersQuery.isLoading,
      foldersError:
        foldersQuery.error instanceof Error
          ? foldersQuery.error.message
          : foldersQuery.isError
            ? '알 수 없는 오류가 발생했어.'
            : null,
      folderWatcherMap,
      onFolderSave: handleFolderSave,
      onFolderScan: handleFolderScan,
      onFolderStartWatcher: (folderId: number) => handleWatcherAction(folderId, 'start'),
      onFolderStopWatcher: (folderId: number) => handleWatcherAction(folderId, 'stop'),
      onFolderRestartWatcher: (folderId: number) => handleWatcherAction(folderId, 'restart'),
      onFolderDelete: handleFolderDelete,
      backupSources: backupSourcesQuery.data ?? [],
      backupSourcesLoading: backupSourcesQuery.isLoading,
      backupSourcesError:
        backupSourcesQuery.error instanceof Error
          ? backupSourcesQuery.error.message
          : backupSourcesQuery.isError
            ? '알 수 없는 오류가 발생했어.'
            : null,
      onBackupSourceSave: handleBackupSourceSave,
      onBackupSourceStartWatcher: (sourceId: number) => handleBackupSourceWatcherAction(sourceId, 'start'),
      onBackupSourceStopWatcher: (sourceId: number) => handleBackupSourceWatcherAction(sourceId, 'stop'),
      onBackupSourceRestartWatcher: (sourceId: number) => handleBackupSourceWatcherAction(sourceId, 'restart'),
      onBackupSourceDelete: handleBackupSourceDelete,
      scanLogs: scanLogsQuery.data ?? [],
      scanLogsLoading: scanLogsQuery.isLoading,
      watchersHealth: watchersHealthQuery.data,
    },
  }
}
