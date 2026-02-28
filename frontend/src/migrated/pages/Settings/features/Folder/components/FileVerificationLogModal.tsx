import React, { useCallback, useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
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
import { fileVerificationApi, type VerificationLog } from '../../../../../services/fileVerificationApi'

interface FileVerificationLogModalProps {
  open: boolean
  onClose: () => void
}

const FileVerificationLogModal: React.FC<FileVerificationLogModalProps> = ({ open, onClose }) => {
  const { t } = useTranslation('settings')
  const [logs, setLogs] = useState<VerificationLog[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadLogs = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const data = await fileVerificationApi.getLogs(50)
      setLogs(data)
    } catch {
      setError(t('folderSettings.verificationLog.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (open) {
      void loadLogs()
    }
  }, [open, loadLogs])

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  const formatDuration = (ms: number) => {
    if (ms < 1000) {
      return t('folderSettings.verificationLog.durationMs', { ms })
    }
    return t('folderSettings.verificationLog.durationSeconds', { seconds: (ms / 1000).toFixed(2) })
  }

  const getVerificationTypeText = (type: string) => {
    switch (type) {
      case 'auto':
        return t('folderSettings.verificationLog.verificationType.auto')
      case 'manual':
        return t('folderSettings.verificationLog.verificationType.manual')
      default:
        return type
    }
  }

  const parseErrorDetails = (errorDetails: string | null) => {
    if (!errorDetails) return [] as Array<{ fileId: number; filePath: string; error: string }>
    try {
      return JSON.parse(errorDetails) as Array<{ fileId: number; filePath: string; error: string }>
    } catch {
      return [] as Array<{ fileId: number; filePath: string; error: string }>
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onClose() : undefined)}>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle>{t('folderSettings.verificationLog.title')}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-6">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
          </div>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {!loading && !error && logs.length === 0 ? (
          <Alert>
            <AlertDescription>{t('folderSettings.verificationLog.noLogs')}</AlertDescription>
          </Alert>
        ) : null}

        {!loading && !error && logs.length > 0 ? (
          <div className="max-h-[65vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('folderSettings.verificationLog.columns.verificationTime')}</TableHead>
                  <TableHead>{t('folderSettings.verificationLog.columns.verificationType')}</TableHead>
                  <TableHead className="text-right">{t('folderSettings.verificationLog.columns.checked')}</TableHead>
                  <TableHead className="text-right">{t('folderSettings.verificationLog.columns.missingFound')}</TableHead>
                  <TableHead className="text-right">{t('folderSettings.verificationLog.columns.deletedRecords')}</TableHead>
                  <TableHead className="text-right">{t('folderSettings.verificationLog.columns.errors')}</TableHead>
                  <TableHead className="text-right">{t('folderSettings.verificationLog.columns.duration')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => {
                  const errors = parseErrorDetails(log.error_details)
                  const hasErrors = log.error_count > 0 || errors.length > 0

                  return (
                    <React.Fragment key={log.id}>
                      <TableRow>
                        <TableCell>{formatDate(log.verification_date)}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{getVerificationTypeText(log.verification_type)}</Badge>
                        </TableCell>
                        <TableCell className="text-right">{log.total_checked.toLocaleString()}</TableCell>
                        <TableCell className="text-right">{log.missing_found.toLocaleString()}</TableCell>
                        <TableCell className="text-right">{log.deleted_records.toLocaleString()}</TableCell>
                        <TableCell className="text-right">
                          {hasErrors ? (
                            <Badge variant="destructive">
                              <AlertTriangle className="h-3 w-3" />
                              {t('folderSettings.verificationLog.countFormat', { count: log.error_count })}
                            </Badge>
                          ) : (
                            t('folderSettings.verificationLog.noErrors')
                          )}
                        </TableCell>
                        <TableCell className="text-right">{formatDuration(log.duration_ms)}</TableCell>
                      </TableRow>

                      {hasErrors && errors.length > 0 ? (
                        <TableRow>
                          <TableCell colSpan={7}>
                            <details>
                              <summary className="cursor-pointer text-sm text-destructive">
                                {t('folderSettings.verificationLog.errorDetails', { count: errors.length })}
                              </summary>
                              <div className="mt-2 space-y-1">
                                {errors.map((item) => (
                                  <div key={`${item.fileId}-${item.filePath}`} className="rounded border p-2 text-xs">
                                    <div className="font-medium">{t('folderSettings.verificationLog.errorItem.fileId', { id: item.fileId })}</div>
                                    <div>{t('folderSettings.verificationLog.errorItem.path', { path: item.filePath })}</div>
                                    <div className="text-destructive">{t('folderSettings.verificationLog.errorItem.error', { error: item.error })}</div>
                                  </div>
                                ))}
                              </div>
                            </details>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </React.Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => void loadLogs()} disabled={loading}>
            {t('folderSettings.verificationLog.refresh')}
          </Button>
          <Button onClick={onClose}>{t('folderSettings.verificationLog.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default FileVerificationLogModal
