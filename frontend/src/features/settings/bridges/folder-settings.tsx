import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert as UiAlert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { backgroundQueueApi, type BackgroundQueueStatus, type HashStats } from '@/services/background-queue-api'
import { fileVerificationApi, type FileVerificationSettings, type VerificationProgress, type VerificationStats } from '@/services/file-verification-api'
import { folderApi, type FolderScanLog, type WatchedFolder, type WatchedFolderCreate, type WatchedFolderUpdate } from '@/services/folder-api'

const FALLBACK_ERROR_MESSAGE = 'Folder request failed. Please try again.'

interface FolderFormState {
  folder_path: string
  folder_name: string
  watcher_enabled: boolean
  watcher_polling_interval: number | null
  auto_scan: boolean
  scan_interval: number
  recursive: boolean
  exclude_extensions: string[]
  exclude_patterns: string[]
}

const DEFAULT_FORM: FolderFormState = {
  folder_path: '',
  folder_name: '',
  watcher_enabled: true,
  watcher_polling_interval: null,
  auto_scan: true,
  scan_interval: 60,
  recursive: true,
  exclude_extensions: [],
  exclude_patterns: [],
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return FALLBACK_ERROR_MESSAGE
}

function parseListField(value: string | string[] | null | undefined): string[] {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === 'string' && item.trim().length > 0)
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    return []
  }

  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) {
      return parsed.filter((item) => typeof item === 'string' && item.trim().length > 0)
    }
  } catch {
    return []
  }

  return []
}

function toBoolean(value: boolean | number | undefined | null, fallback = false): boolean {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number') {
    return value === 1
  }

  return fallback
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return '-'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '-'
  }

  return date.toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getFolderDisplayName(folder: WatchedFolder): string {
  return folder.folder_name || folder.name || folder.folder_path
}

function buildFormFromFolder(folder: WatchedFolder): FolderFormState {
  return {
    folder_path: folder.folder_path,
    folder_name: folder.folder_name || folder.name || '',
    watcher_enabled: toBoolean(folder.watcher_enabled, true),
    watcher_polling_interval: folder.watcher_polling_interval ?? null,
    auto_scan: toBoolean(folder.auto_scan, true),
    scan_interval: folder.scan_interval ?? 60,
    recursive: toBoolean(folder.recursive, true),
    exclude_extensions: parseListField(folder.exclude_extensions),
    exclude_patterns: parseListField(folder.exclude_patterns),
  }
}

export default function FolderSettings() {
  const { t } = useTranslation('settings')
  const [folders, setFolders] = useState<WatchedFolder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scanAllBusy, setScanAllBusy] = useState(false)
  const [actionFolderId, setActionFolderId] = useState<number | null>(null)
  const [watcherActioningId, setWatcherActioningId] = useState<number | null>(null)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingFolder, setEditingFolder] = useState<WatchedFolder | null>(null)
  const [formState, setFormState] = useState<FolderFormState>(DEFAULT_FORM)
  const [savingFolder, setSavingFolder] = useState(false)
  const [newExtension, setNewExtension] = useState('')
  const [newPattern, setNewPattern] = useState('')

  const [scanLogOpen, setScanLogOpen] = useState(false)
  const [scanLogFolderId, setScanLogFolderId] = useState<number | undefined>(undefined)
  const [scanLogs, setScanLogs] = useState<FolderScanLog[]>([])
  const [scanLogsLoading, setScanLogsLoading] = useState(false)

  const [backgroundStatus, setBackgroundStatus] = useState<BackgroundQueueStatus | null>(null)
  const [hashStats, setHashStats] = useState<HashStats | null>(null)
  const [verificationStats, setVerificationStats] = useState<VerificationStats | null>(null)
  const [verificationProgress, setVerificationProgress] = useState<VerificationProgress | null>(null)
  const [verificationSettings, setVerificationSettings] = useState<FileVerificationSettings | null>(null)
  const [tempEnabled, setTempEnabled] = useState(false)
  const [tempInterval, setTempInterval] = useState('3600')
  const [verifying, setVerifying] = useState(false)
  const [rebuildingHashes, setRebuildingHashes] = useState(false)
  const [savingVerifySettings, setSavingVerifySettings] = useState(false)

  const loadFolders = useCallback(async () => {
    setError(null)
    setLoading(true)

    try {
      const loadedFolders = await folderApi.getFolders()
      setFolders(loadedFolders)
    } catch (loadError) {
      setError(getErrorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }, [])

  const loadBackgroundStatus = useCallback(async () => {
    try {
      const [queueStatus, loadedHashStats, loadedVerifyStats, loadedVerifyProgress, loadedVerifySettings] = await Promise.all([
        backgroundQueueApi.getQueueStatus(),
        backgroundQueueApi.getHashStats(),
        fileVerificationApi.getStats(),
        fileVerificationApi.getProgress(),
        fileVerificationApi.getSettings(),
      ])

      setBackgroundStatus(queueStatus)
      setHashStats(loadedHashStats)
      setVerificationStats(loadedVerifyStats)
      setVerificationProgress(loadedVerifyProgress)
      setVerificationSettings(loadedVerifySettings)
      setTempEnabled(loadedVerifySettings.enabled)
      setTempInterval(String(loadedVerifySettings.interval))
    } catch (loadError) {
      setError(getErrorMessage(loadError))
    }
  }, [])

  useEffect(() => {
    void loadFolders()
    void loadBackgroundStatus()
  }, [loadBackgroundStatus, loadFolders])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void loadFolders()
      void loadBackgroundStatus()
    }, 10000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [loadBackgroundStatus, loadFolders])

  const openAddDialog = () => {
    setEditingFolder(null)
    setFormState(DEFAULT_FORM)
    setNewExtension('')
    setNewPattern('')
    setDialogOpen(true)
  }

  const openEditDialog = (folder: WatchedFolder) => {
    setEditingFolder(folder)
    setFormState(buildFormFromFolder(folder))
    setNewExtension('')
    setNewPattern('')
    setDialogOpen(true)
  }

  const closeDialog = () => {
    setDialogOpen(false)
    setEditingFolder(null)
    setFormState(DEFAULT_FORM)
    setNewExtension('')
    setNewPattern('')
  }

  const handleAddExtension = () => {
    const normalized = newExtension.trim()
    if (!normalized) {
      return
    }

    const finalValue = normalized.startsWith('.') ? normalized : `.${normalized}`
    if (formState.exclude_extensions.includes(finalValue)) {
      setNewExtension('')
      return
    }

    setFormState((prev) => ({
      ...prev,
      exclude_extensions: [...prev.exclude_extensions, finalValue],
    }))
    setNewExtension('')
  }

  const handleAddPattern = () => {
    const normalized = newPattern.trim()
    if (!normalized || formState.exclude_patterns.includes(normalized)) {
      setNewPattern('')
      return
    }

    setFormState((prev) => ({
      ...prev,
      exclude_patterns: [...prev.exclude_patterns, normalized],
    }))
    setNewPattern('')
  }

  const handleSaveFolder = async () => {
    if (!formState.folder_path.trim()) {
      setError(t('folderSettings.dialog.errorPath'))
      return
    }

    setSavingFolder(true)
    setError(null)

    try {
      const commonPayload = {
        folder_path: formState.folder_path.trim(),
        folder_name: formState.folder_name.trim(),
        watcher_enabled: formState.watcher_enabled,
        watcher_polling_interval: formState.watcher_polling_interval,
        auto_scan: formState.auto_scan,
        scan_interval: formState.scan_interval,
        recursive: formState.recursive,
        exclude_extensions: formState.exclude_extensions,
        exclude_patterns: formState.exclude_patterns,
      }

      if (editingFolder) {
        const payload: WatchedFolderUpdate = commonPayload
        await folderApi.updateFolder(editingFolder.id, payload)
      } else {
        const payload: WatchedFolderCreate = commonPayload
        await folderApi.addFolder(payload)
      }

      closeDialog()
      await loadFolders()
    } catch (saveError) {
      setError(getErrorMessage(saveError))
    } finally {
      setSavingFolder(false)
    }
  }

  const handleScanAll = async () => {
    setError(null)
    setScanAllBusy(true)

    try {
      const summary = await folderApi.scanAllFolders()
      const errorsText = summary.totalErrors > 0
        ? t('folderSettings.watchedFolders.messages.scanAllErrors', { totalErrors: summary.totalErrors })
        : ''

      window.alert(
        t('folderSettings.watchedFolders.messages.scanAllComplete', {
          totalFolders: summary.totalFolders,
          totalNew: summary.totalNew,
          totalExisting: summary.totalExisting,
          errors: errorsText,
        })
      )

      await loadFolders()
    } catch (scanError) {
      setError(getErrorMessage(scanError))
    } finally {
      setScanAllBusy(false)
    }
  }

  const handleScanFolder = async (folderId: number) => {
    setError(null)
    setActionFolderId(folderId)

    try {
      await folderApi.scanFolder(folderId)
      await loadFolders()
    } catch (scanError) {
      setError(getErrorMessage(scanError))
    } finally {
      setActionFolderId(null)
    }
  }

  const handleDeleteFolder = async (folder: WatchedFolder) => {
    if (!window.confirm(t('folderSettings.watchedFolders.messages.deleteConfirm', { name: getFolderDisplayName(folder) }))) {
      return
    }

    setError(null)
    setActionFolderId(folder.id)

    try {
      await folderApi.deleteFolder(folder.id, false)
      await loadFolders()
    } catch (deleteError) {
      setError(getErrorMessage(deleteError))
    } finally {
      setActionFolderId(null)
    }
  }

  const handleWatcherToggle = async (folder: WatchedFolder, shouldEnable: boolean) => {
    setError(null)
    setWatcherActioningId(folder.id)

    try {
      if (shouldEnable) {
        await folderApi.startWatcher(folder.id)
      } else {
        await folderApi.stopWatcher(folder.id)
      }
      await loadFolders()
    } catch (watcherError) {
      setError(getErrorMessage(watcherError))
    } finally {
      setWatcherActioningId(null)
    }
  }

  const loadScanLogs = useCallback(async (folderId?: number) => {
    setScanLogsLoading(true)
    try {
      const logs = typeof folderId === 'number'
        ? await folderApi.getScanLogs(folderId, 50)
        : await folderApi.getRecentScanLogs(100)
      setScanLogs(logs)
    } catch (scanLogError) {
      setError(getErrorMessage(scanLogError))
    } finally {
      setScanLogsLoading(false)
    }
  }, [])

  const openScanLogs = async (folderId?: number) => {
    setScanLogFolderId(folderId)
    setScanLogOpen(true)
    await loadScanLogs(folderId)
  }

  const handleTriggerVerification = async () => {
    if (!verificationStats) {
      return
    }

    if (!window.confirm(t('background.confirmVerify', { count: verificationStats.totalFiles }))) {
      return
    }

    setVerifying(true)
    setError(null)
    try {
      await fileVerificationApi.triggerVerification()
      await loadBackgroundStatus()
    } catch (verifyError) {
      setError(getErrorMessage(verifyError))
    } finally {
      setVerifying(false)
    }
  }

  const handleSaveVerificationSettings = async () => {
    const intervalValue = Number.parseInt(tempInterval, 10)
    if (Number.isNaN(intervalValue) || intervalValue < 300 || intervalValue > 86400) {
      setError(t('background.verifyIntervalError'))
      return
    }

    setSavingVerifySettings(true)
    setError(null)
    try {
      await fileVerificationApi.updateSettings({
        enabled: tempEnabled,
        interval: intervalValue,
      })
      await loadBackgroundStatus()
    } catch (settingsError) {
      setError(getErrorMessage(settingsError))
    } finally {
      setSavingVerifySettings(false)
    }
  }

  const handleRebuildHashes = async () => {
    if (!hashStats || hashStats.imagesWithoutHash === 0) {
      return
    }

    if (!window.confirm(t('background.confirmHashGen', { count: hashStats.imagesWithoutHash }))) {
      return
    }

    setRebuildingHashes(true)
    setError(null)
    try {
      await backgroundQueueApi.rebuildHashes()
      await loadBackgroundStatus()
    } catch (hashError) {
      setError(getErrorMessage(hashError))
    } finally {
      setRebuildingHashes(false)
    }
  }

  const hasVerificationChanges = useMemo(() => {
    if (!verificationSettings) {
      return false
    }
    return verificationSettings.enabled !== tempEnabled || String(verificationSettings.interval) !== tempInterval
  }, [tempEnabled, tempInterval, verificationSettings])

  return (
    <div className="space-y-4">
      {error ? (
        <UiAlert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </UiAlert>
      ) : null}

      <div className="space-y-3 rounded-md border p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">{t('background.title')}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => void loadBackgroundStatus()}>
            {t('common.refresh')}
          </Button>
        </div>

        {backgroundStatus ? (
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{t('background.queue.pending', { count: backgroundStatus.queue.queueLength })}</Badge>
            <Badge variant={backgroundStatus.queue.processing ? 'default' : 'outline'}>
              {backgroundStatus.queue.processing ? t('background.queue.processing') : t('background.queue.waiting')}
            </Badge>
            <Badge variant="outline">{t('background.autoTag.pollingInterval', { seconds: backgroundStatus.autoTag.pollingIntervalSeconds })}</Badge>
            <Badge variant="outline">{t('background.autoTag.batchSize', { size: backgroundStatus.autoTag.batchSize })}</Badge>
            <Badge variant={backgroundStatus.autoTag.isRunning ? 'default' : 'outline'}>
              {backgroundStatus.autoTag.isRunning ? t('background.autoTag.running') : t('background.autoTag.stopped')}
            </Badge>
          </div>
        ) : null}

        {hashStats ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border p-2">
            <span className="text-xs text-muted-foreground">{t('background.hash.title')}</span>
            <Badge variant="outline">{t('background.hash.total', { count: hashStats.totalImages })}</Badge>
            <Badge variant="outline">{t('background.hash.pending', { count: hashStats.imagesWithoutHash })}</Badge>
            <Badge variant="outline">{t('background.hash.completion', { percent: hashStats.completionPercentage })}</Badge>
            <Button type="button" size="sm" variant="outline" onClick={() => void handleRebuildHashes()} disabled={rebuildingHashes || hashStats.imagesWithoutHash === 0}>
              {t('background.hash.generate')}
            </Button>
          </div>
        ) : null}

        {verificationStats && verificationSettings ? (
          <div className="space-y-2 rounded-md border p-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">{t('background.verify.title')}</span>
              <Badge variant="outline">{t('background.verify.totalFiles', { count: verificationStats.totalFiles })}</Badge>
              <Badge variant="outline">{t('background.verify.missingFiles', { count: verificationStats.missingFiles })}</Badge>
              <Badge variant="outline">{t('background.verify.lastVerification', { date: formatDate(verificationStats.lastVerificationDate) })}</Badge>
            </div>

            {verificationProgress?.isRunning ? (
              <p className="text-xs text-muted-foreground">
                {t('background.verify.progress', { checked: verificationProgress.checkedFiles, total: verificationProgress.totalFiles })}
              </p>
            ) : null}

            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{t('background.verify.schedulerTitle')}</p>
                <div className="flex items-center gap-2">
                  <Switch checked={tempEnabled} onCheckedChange={(checked) => setTempEnabled(Boolean(checked))} />
                  <span className="text-xs text-muted-foreground">{tempEnabled ? t('common.enabled') : t('common.disabled')}</span>
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{t('background.verify.intervalLabel')}</p>
                <Input
                  type="number"
                  min={300}
                  max={86400}
                  value={tempInterval}
                  onChange={(event) => setTempInterval(event.target.value)}
                  disabled={!tempEnabled}
                />
              </div>

              <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => void handleTriggerVerification()} disabled={verifying || verificationProgress?.isRunning}>
                  {t('background.verify.run')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleSaveVerificationSettings()}
                  disabled={!hasVerificationChanges || savingVerifySettings}
                >
                  {t('common.save')}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <Separator />

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">{t('folderSettings.watchedFolders.title')}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => void openScanLogs()}>
              {t('folderSettings.watchedFolders.viewAllLogs')}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => void handleScanAll()} disabled={scanAllBusy || loading || folders.length === 0}>
              {t('folderSettings.watchedFolders.scanAll')}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => void loadFolders()} disabled={loading}>
              {t('folderSettings.watchedFolders.refresh')}
            </Button>
            <Button type="button" size="sm" onClick={openAddDialog}>
              {t('folderSettings.watchedFolders.addFolder')}
            </Button>
          </div>
        </div>

        {loading ? <p className="text-sm text-muted-foreground">Loading folders...</p> : null}
        {!loading && folders.length === 0 ? <p className="text-sm text-muted-foreground">No folders found.</p> : null}

        {!loading ? (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {folders.map((folder) => {
              const isBusy = actionFolderId === folder.id
              const isWatcherBusy = watcherActioningId === folder.id
              const isWatching = folder.watcher_status === 'watching'
              const watcherEnabled = toBoolean(folder.watcher_enabled, true)
              const folderActive = toBoolean(folder.is_active, toBoolean(folder.active, true))
              const isDefaultFolder = toBoolean(folder.is_default, false)

              return (
                <div key={folder.id} className="space-y-2 rounded-md border p-3">
                  <div className="space-y-1">
                    <p className="truncate text-sm font-medium" title={folder.folder_path}>{getFolderDisplayName(folder)}</p>
                    <p className="truncate text-xs text-muted-foreground" title={folder.folder_path}>{folder.folder_path}</p>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    <Badge variant={folderActive ? 'default' : 'outline'}>
                      {folderActive ? t('folderSettings.watchedFolders.active') : t('folderSettings.watchedFolders.inactive')}
                    </Badge>
                    {toBoolean(folder.auto_scan, false) ? (
                      <Badge variant="outline">{t('folderSettings.watchedFolders.autoScanInterval', { interval: folder.scan_interval ?? 60 })}</Badge>
                    ) : null}
                    {isDefaultFolder ? <Badge variant="outline">Default</Badge> : null}
                    {folder.last_scan_status ? <Badge variant="outline">{t('folderSettings.watchedFolders.scanStatus')}</Badge> : null}
                    {watcherEnabled ? (
                      <Badge variant={isWatching ? 'default' : 'outline'}>{folder.watcher_status || t('folderSettings.watchedFolders.watcherStatus.inactive')}</Badge>
                    ) : null}
                  </div>

                  <p className="text-xs text-muted-foreground">
                    {folder.last_scan_date
                      ? t('folderSettings.watchedFolders.lastScan', { date: formatDate(folder.last_scan_date) })
                      : t('folderSettings.watchedFolders.noScanHistory')}
                  </p>

                  {folder.watcher_error ? <p className="text-xs text-destructive">{folder.watcher_error}</p> : null}

                  <div className="flex items-center justify-between">
                    {watcherEnabled ? (
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={isWatching}
                          onCheckedChange={(checked) => void handleWatcherToggle(folder, Boolean(checked))}
                          disabled={isWatcherBusy}
                        />
                        <span className="text-xs text-muted-foreground">
                          {isWatcherBusy ? t('folderSettings.watchedFolders.tooltips.processing') : (isWatching ? t('folderSettings.watchedFolders.tooltips.watcherStop') : t('folderSettings.watchedFolders.tooltips.watcherStart'))}
                        </span>
                      </div>
                    ) : <div />}

                    <div className="flex gap-1">
                      <Button type="button" size="sm" variant="outline" onClick={() => void handleScanFolder(folder.id)} disabled={isBusy}>
                        {t('folderSettings.watchedFolders.tooltips.scan')}
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => void openScanLogs(folder.id)}>
                        {t('folderSettings.watchedFolders.tooltips.log')}
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => openEditDialog(folder)}>
                        {t('folderSettings.watchedFolders.tooltips.edit')}
                      </Button>
                      <Button type="button" size="sm" variant="destructive" onClick={() => void handleDeleteFolder(folder)} disabled={isBusy || isDefaultFolder}>
                        {t('folderSettings.watchedFolders.tooltips.delete')}
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog() }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingFolder ? t('folderSettings.dialog.editTitle') : t('folderSettings.dialog.addTitle')}</DialogTitle>
            <DialogDescription>{t('folderSettings.subtitle')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('folderSettings.dialog.folderPath')}</p>
              <Input
                value={formState.folder_path}
                onChange={(event) => setFormState((prev) => ({ ...prev, folder_path: event.target.value }))}
                disabled={Boolean(editingFolder)}
              />
              <p className="text-xs text-muted-foreground">
                {editingFolder ? t('folderSettings.dialog.folderPathDisabled') : t('folderSettings.dialog.folderPathHelper')}
              </p>
            </div>

            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('folderSettings.dialog.folderName')}</p>
              <Input value={formState.folder_name} onChange={(event) => setFormState((prev) => ({ ...prev, folder_name: event.target.value }))} />
            </div>

            <div className="rounded-md border p-2">
              <div className="flex items-center justify-between">
                <p className="text-sm">{t('folderSettings.dialog.watcherEnabled')}</p>
                <Switch
                  checked={formState.watcher_enabled}
                  onCheckedChange={(checked) => setFormState((prev) => ({ ...prev, watcher_enabled: Boolean(checked) }))}
                />
              </div>

              {formState.watcher_enabled ? (
                <div className="mt-2 space-y-1">
                  <p className="text-xs text-muted-foreground">{t('folderSettings.dialog.pollingIntervalLabel')}</p>
                  <Input
                    type="number"
                    min={100}
                    step={100}
                    value={formState.watcher_polling_interval ?? ''}
                    onChange={(event) => {
                      const value = event.target.value.trim()
                      setFormState((prev) => ({
                        ...prev,
                        watcher_polling_interval: value.length === 0 ? null : Number.parseInt(value, 10) || null,
                      }))
                    }}
                  />
                  <p className="text-xs text-muted-foreground">{t('folderSettings.dialog.pollingIntervalHelper')}</p>
                </div>
              ) : null}
            </div>

            <div className="rounded-md border p-2">
              <div className="flex items-center justify-between">
                <p className="text-sm">{t('folderSettings.dialog.autoScan')}</p>
                <Switch
                  checked={formState.auto_scan}
                  onCheckedChange={(checked) => setFormState((prev) => ({ ...prev, auto_scan: Boolean(checked) }))}
                />
              </div>

              {formState.auto_scan ? (
                <div className="mt-2 space-y-1">
                  <p className="text-xs text-muted-foreground">{t('folderSettings.dialog.scanInterval')}</p>
                  <Input
                    type="number"
                    min={1}
                    value={formState.scan_interval}
                    onChange={(event) => {
                      const value = Number.parseInt(event.target.value, 10)
                      if (!Number.isNaN(value)) {
                        setFormState((prev) => ({ ...prev, scan_interval: value }))
                      }
                    }}
                  />
                </div>
              ) : null}
            </div>

            <div className="space-y-2 rounded-md border p-2">
              <p className="text-sm font-medium">{t('folderSettings.dialog.advancedOptions')}</p>

              <div className="flex items-center justify-between">
                <p className="text-sm">{t('folderSettings.dialog.recursive')}</p>
                <Switch
                  checked={formState.recursive}
                  onCheckedChange={(checked) => setFormState((prev) => ({ ...prev, recursive: Boolean(checked) }))}
                />
              </div>

              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{t('folderSettings.dialog.excludeExtensions')}</p>
                <div className="flex gap-2">
                  <Input
                    value={newExtension}
                    placeholder={t('folderSettings.dialog.excludeExtensionsPlaceholder')}
                    onChange={(event) => setNewExtension(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        handleAddExtension()
                      }
                    }}
                  />
                  <Button type="button" variant="outline" onClick={handleAddExtension}>{t('folderSettings.dialog.addButton')}</Button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {formState.exclude_extensions.map((ext) => (
                    <Badge key={ext} variant="outline" className="cursor-pointer" onClick={() => setFormState((prev) => ({ ...prev, exclude_extensions: prev.exclude_extensions.filter((item) => item !== ext) }))}>
                      {ext}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{t('folderSettings.dialog.excludePatterns')}</p>
                <div className="flex gap-2">
                  <Input
                    value={newPattern}
                    placeholder={t('folderSettings.dialog.excludePatternsPlaceholder')}
                    onChange={(event) => setNewPattern(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        handleAddPattern()
                      }
                    }}
                  />
                  <Button type="button" variant="outline" onClick={handleAddPattern}>{t('folderSettings.dialog.addButton')}</Button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {formState.exclude_patterns.map((pattern) => (
                    <Badge key={pattern} variant="outline" className="cursor-pointer" onClick={() => setFormState((prev) => ({ ...prev, exclude_patterns: prev.exclude_patterns.filter((item) => item !== pattern) }))}>
                      {pattern}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeDialog}>{t('folderSettings.dialog.cancelButton')}</Button>
            <Button type="button" onClick={() => void handleSaveFolder()} disabled={savingFolder}>
              {savingFolder ? t('folderSettings.dialog.savingButton') : t('folderSettings.dialog.saveButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={scanLogOpen} onOpenChange={setScanLogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{scanLogFolderId ? t('folderSettings.scanLog.titleSpecific') : t('folderSettings.scanLog.titleAll')}</DialogTitle>
            <DialogDescription>{t('folderSettings.scanLog.title')}</DialogDescription>
          </DialogHeader>

          <div className="flex justify-end">
            <Button type="button" size="sm" variant="outline" onClick={() => void loadScanLogs(scanLogFolderId)}>
              {t('folderSettings.scanLog.refresh')}
            </Button>
          </div>

          {scanLogsLoading ? <p className="text-sm text-muted-foreground">Loading...</p> : null}
          {!scanLogsLoading && scanLogs.length === 0 ? <p className="text-sm text-muted-foreground">{t('folderSettings.scanLog.noLogs')}</p> : null}

          {!scanLogsLoading && scanLogs.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('folderSettings.scanLog.columns.scanTime')}</TableHead>
                  <TableHead>{t('folderSettings.scanLog.columns.folder')}</TableHead>
                  <TableHead>{t('folderSettings.scanLog.columns.status')}</TableHead>
                  <TableHead>{t('folderSettings.scanLog.columns.scanned')}</TableHead>
                  <TableHead>{t('folderSettings.scanLog.columns.new')}</TableHead>
                  <TableHead>{t('folderSettings.scanLog.columns.existing')}</TableHead>
                  <TableHead>{t('folderSettings.scanLog.columns.errors')}</TableHead>
                  <TableHead>{t('folderSettings.scanLog.columns.duration')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scanLogs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>{formatDate(log.scan_date)}</TableCell>
                    <TableCell title={log.folder_path}>{log.folder_name || log.folder_path}</TableCell>
                    <TableCell>{log.scan_status}</TableCell>
                    <TableCell>{log.total_scanned}</TableCell>
                    <TableCell>{log.new_images}</TableCell>
                    <TableCell>{log.existing_images}</TableCell>
                    <TableCell>{log.errors_count}</TableCell>
                    <TableCell>{t('folderSettings.scanLog.durationSeconds', { seconds: Math.round(log.duration_ms / 1000) })}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setScanLogOpen(false)}>{t('folderSettings.scanLog.close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
