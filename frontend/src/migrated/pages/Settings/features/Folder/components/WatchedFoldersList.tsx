import React, { useCallback, useEffect, useState } from 'react'
import { Eye, EyeOff, History, Pencil, Play, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { folderApi } from '../../../../../services/folderApi'
import FolderFormDialog from './FolderFormDialog'
import ScanLogModal from './ScanLogModal'
import type { WatchedFolder } from '../../../../../types/folder'

const WatchedFoldersList: React.FC = () => {
  const { t } = useTranslation('settings')
  const [folders, setFolders] = useState<WatchedFolder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedFolder, setSelectedFolder] = useState<WatchedFolder | null>(null)
  const [scanningFolderId, setScanningFolderId] = useState<number | null>(null)
  const [scanningAll, setScanningAll] = useState(false)
  const [logModalOpen, setLogModalOpen] = useState(false)
  const [logFolderId, setLogFolderId] = useState<number | undefined>(undefined)
  const [watcherActioningId, setWatcherActioningId] = useState<number | null>(null)

  const loadFolders = useCallback(async () => {
    try {
      setError(null)
      const data = await folderApi.getFolders()
      setFolders(data.filter((folder) => !folder.is_default))
    } catch {
      setError(t('folderSettings.watchedFolders.messages.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void loadFolders()
    const interval = setInterval(() => {
      void loadFolders()
    }, 10000)
    return () => clearInterval(interval)
  }, [loadFolders])

  const handleOpenDialog = (folder?: WatchedFolder) => {
    setSelectedFolder(folder || null)
    setDialogOpen(true)
  }

  const handleCloseDialog = () => {
    setDialogOpen(false)
    setSelectedFolder(null)
  }

  const handleDialogSuccess = () => {
    void loadFolders()
  }

  const handleDelete = async (folder: WatchedFolder) => {
    if (!window.confirm(t('folderSettings.watchedFolders.messages.deleteConfirm', { name: folder.folder_name || folder.folder_path }))) {
      return
    }
    try {
      await folderApi.deleteFolder(folder.id)
      await loadFolders()
    } catch {
      setError(t('folderSettings.watchedFolders.messages.deleteFailed'))
    }
  }

  const handleScan = async (folderId: number) => {
    setScanningFolderId(folderId)
    try {
      await folderApi.scanFolder(folderId)
      await loadFolders()
    } catch {
      setError(t('folderSettings.watchedFolders.messages.scanFailed'))
    } finally {
      setScanningFolderId(null)
    }
  }

  const handleScanAll = async () => {
    setScanningAll(true)
    try {
      setError(null)
      const summary = await folderApi.scanAllFolders()
      const errorsPart =
        summary.totalErrors > 0
          ? t('folderSettings.watchedFolders.messages.scanAllErrors', { totalErrors: summary.totalErrors })
          : ''

      alert(
        t('folderSettings.watchedFolders.messages.scanAllComplete', {
          totalFolders: summary.totalFolders,
          totalNew: summary.totalNew,
          totalExisting: summary.totalExisting,
          errors: errorsPart,
        })
      )
      await loadFolders()
    } catch {
      setError(t('folderSettings.watchedFolders.messages.scanAllFailed'))
    } finally {
      setScanningAll(false)
    }
  }

  const handleStartWatcher = async (folderId: number) => {
    setWatcherActioningId(folderId)
    try {
      await folderApi.startWatcher(folderId)
      await loadFolders()
    } catch {
      setError(t('folderSettings.watchedFolders.messages.watcherStartFailed'))
    } finally {
      setWatcherActioningId(null)
    }
  }

  const handleStopWatcher = async (folderId: number) => {
    setWatcherActioningId(folderId)
    try {
      await folderApi.stopWatcher(folderId)
      await loadFolders()
    } catch {
      setError(t('folderSettings.watchedFolders.messages.watcherStopFailed'))
    } finally {
      setWatcherActioningId(null)
    }
  }

  const getWatcherStatusText = (folder: WatchedFolder) => {
    const { watcher_status, watcher_enabled } = folder
    if (watcher_enabled === 1 && !watcher_status) {
      return t('folderSettings.watchedFolders.watcherStatus.starting')
    }
    switch (watcher_status) {
      case 'watching':
        return t('folderSettings.watchedFolders.watcherStatus.watching')
      case 'error':
        return t('folderSettings.watchedFolders.watcherStatus.error')
      case 'stopped':
        return t('folderSettings.watchedFolders.watcherStatus.stopped')
      default:
        return t('folderSettings.watchedFolders.watcherStatus.inactive')
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-6">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
      </div>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>{t('folderSettings.watchedFolders.title')}</CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setLogFolderId(undefined)
              setLogModalOpen(true)
            }}
          >
            <History className="h-4 w-4" />
            {t('folderSettings.watchedFolders.viewAllLogs')}
          </Button>

          <Button variant="outline" size="sm" onClick={() => void handleScanAll()} disabled={scanningAll || folders.length === 0}>
            <Play className="h-4 w-4" />
            {t('folderSettings.watchedFolders.scanAll')}
          </Button>

          <Button variant="outline" size="sm" onClick={() => void loadFolders()}>
            <RefreshCw className="h-4 w-4" />
            {t('folderSettings.watchedFolders.refresh')}
          </Button>

          <Button size="sm" onClick={() => handleOpenDialog()}>
            <Plus className="h-4 w-4" />
            {t('folderSettings.watchedFolders.addFolder')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="max-h-[60vh] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('folderSettings.dialog.folderName')}</TableHead>
                <TableHead>{t('folderSettings.dialog.folderPath')}</TableHead>
                <TableHead>{t('folderSettings.watchedFolders.scanStatus')}</TableHead>
                <TableHead>{t('folderSettings.watchedFolders.watcherStatus.watching')}</TableHead>
                <TableHead className="text-right">{t('folderSettings.watchedFolders.tooltips.scan')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {folders.map((folder) => (
                <TableRow key={folder.id}>
                  <TableCell>{folder.folder_name || t('folderSettings.watchedFolders.noName')}</TableCell>
                  <TableCell>{folder.folder_path}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Badge variant={folder.is_active ? 'default' : 'secondary'}>
                        {folder.is_active ? t('folderSettings.watchedFolders.active') : t('folderSettings.watchedFolders.inactive')}
                      </Badge>
                      {folder.auto_scan === 1 ? (
                        <Badge variant="outline">
                          {t('folderSettings.watchedFolders.autoScanInterval', { interval: folder.scan_interval })}
                        </Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    {folder.watcher_enabled === 1 ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={folder.watcher_status === 'watching'}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    void handleStartWatcher(folder.id)
                                  } else {
                                    void handleStopWatcher(folder.id)
                                  }
                                }}
                                disabled={watcherActioningId === folder.id}
                              />
                              {folder.watcher_status === 'watching' ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>{getWatcherStatusText(folder)}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      '-'
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon-sm" variant="ghost" onClick={() => void handleScan(folder.id)} disabled={scanningFolderId === folder.id}>
                        <Play className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => {
                          setLogFolderId(folder.id)
                          setLogModalOpen(true)
                        }}
                      >
                        <History className="h-4 w-4" />
                      </Button>
                      <Button size="icon-sm" variant="ghost" onClick={() => handleOpenDialog(folder)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon-sm" variant="ghost" className="text-destructive" onClick={() => void handleDelete(folder)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <FolderFormDialog open={dialogOpen} onClose={handleCloseDialog} onSuccess={handleDialogSuccess} folder={selectedFolder} />
        <ScanLogModal open={logModalOpen} onClose={() => setLogModalOpen(false)} folderId={logFolderId} />
      </CardContent>
    </Card>
  )
}

export default WatchedFoldersList
