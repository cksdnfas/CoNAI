import React, { useCallback, useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import axios from 'axios'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { API_BASE_URL } from '../../../../../services/api'

interface ScanLog {
  id: number
  folder_id: number
  folder_name?: string
  folder_path?: string
  scan_date: string
  scan_status: string
  total_scanned: number
  new_images: number
  existing_images: number
  updated_paths: number
  missing_images: number
  errors_count: number
  duration_ms: number
  error_details: Array<{ file: string; error: string }>
}

interface ScanLogModalProps {
  open: boolean
  onClose: () => void
  folderId?: number
}

const ScanLogModal: React.FC<ScanLogModalProps> = ({ open, onClose, folderId }) => {
  const { t } = useTranslation('settings')
  const [logs, setLogs] = useState<ScanLog[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadLogs = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const url = folderId
        ? `${API_BASE_URL}/api/folders/${folderId}/scan-logs`
        : `${API_BASE_URL}/api/folders/scan-logs/recent`

      const response = await axios.get(url)
      setLogs(response.data.data)
    } catch {
      setError(t('folderSettings.scanLog.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [folderId, t])

  useEffect(() => {
    if (open) {
      void loadLogs()
    }
  }, [open, loadLogs])

  const getStatusText = (status: string) => {
    switch (status) {
      case 'success':
        return t('folderSettings.scanLog.status.success')
      case 'error':
        return t('folderSettings.scanLog.status.error')
      default:
        return status
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onClose() : undefined)}>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle>
            {folderId ? t('folderSettings.scanLog.titleSpecific') : t('folderSettings.scanLog.titleAll')}
          </DialogTitle>
        </DialogHeader>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {loading ? (
          <div className="flex justify-center py-6">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
          </div>
        ) : logs.length === 0 ? (
          <Alert>
            <AlertDescription>{t('folderSettings.scanLog.noLogs')}</AlertDescription>
          </Alert>
        ) : (
          <div className="max-h-[65vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('folderSettings.scanLog.columns.scanTime')}</TableHead>
                  {!folderId ? <TableHead>{t('folderSettings.scanLog.columns.folder')}</TableHead> : null}
                  <TableHead>{t('folderSettings.scanLog.columns.status')}</TableHead>
                  <TableHead className="text-right">{t('folderSettings.scanLog.columns.scanned')}</TableHead>
                  <TableHead className="text-right">{t('folderSettings.scanLog.columns.new')}</TableHead>
                  <TableHead className="text-right">{t('folderSettings.scanLog.columns.existing')}</TableHead>
                  <TableHead className="text-right">{t('folderSettings.scanLog.columns.errors')}</TableHead>
                  <TableHead className="text-right">{t('folderSettings.scanLog.columns.duration')}</TableHead>
                  <TableHead>{t('folderSettings.scanLog.columns.details')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>{new Date(log.scan_date).toLocaleString()}</TableCell>
                    {!folderId ? <TableCell>{log.folder_name || log.folder_path}</TableCell> : null}
                    <TableCell>
                      <Badge variant={log.scan_status === 'error' ? 'destructive' : 'secondary'}>
                        {getStatusText(log.scan_status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{log.total_scanned}</TableCell>
                    <TableCell className="text-right">{log.new_images}</TableCell>
                    <TableCell className="text-right">{log.existing_images}</TableCell>
                    <TableCell className="text-right">
                      {log.errors_count > 0 ? (
                        <Badge variant="destructive">
                          <AlertTriangle className="h-3 w-3" />
                          {log.errors_count}
                        </Badge>
                      ) : (
                        <span>0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {t('folderSettings.scanLog.durationSeconds', { seconds: (log.duration_ms / 1000).toFixed(2) })}
                    </TableCell>
                    <TableCell>
                      {log.error_details && log.error_details.length > 0 ? (
                        <details>
                          <summary className="cursor-pointer text-sm">
                            {t('folderSettings.scanLog.errorDetails', { count: log.error_details.length })}
                          </summary>
                          <div className="mt-2 space-y-1">
                            {log.error_details.map((item) => (
                              <div key={`${item.file}-${item.error}`} className="rounded border p-2 text-xs">
                                <div className="font-medium">{item.file}</div>
                                <div className="text-destructive">{item.error}</div>
                              </div>
                            ))}
                          </div>
                        </details>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => void loadLogs()} disabled={loading}>
            {t('folderSettings.scanLog.refresh')}
          </Button>
          <Button onClick={onClose}>{t('folderSettings.scanLog.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ScanLogModal
