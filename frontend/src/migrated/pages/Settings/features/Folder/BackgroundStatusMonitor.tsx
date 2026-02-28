import React, { useCallback, useEffect, useState } from 'react'
import { CheckCircle, Eraser, Info, Play, RefreshCw, Tags } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { backgroundQueueApi } from '../../../../services/backgroundQueueApi'
import { fileVerificationApi } from '../../../../services/fileVerificationApi'
import type { BackgroundQueueStatus } from '../../../../types/folder'
import FileVerificationLogModal from './components/FileVerificationLogModal'

const BackgroundStatusMonitor: React.FC = () => {
  const { t } = useTranslation('settings')
  const [status, setStatus] = useState<BackgroundQueueStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [autoRefresh] = useState(true)
  const [hashStats, setHashStats] = useState<{
    totalImages: number
    imagesWithoutHash: number
    imagesWithHash: number
    completionPercentage: number
  } | null>(null)
  const [rebuildingHashes, setRebuildingHashes] = useState(false)

  const [verificationStats, setVerificationStats] = useState<{
    totalFiles: number
    missingFiles: number
    lastVerificationDate: string | null
  } | null>(null)
  const [verificationProgress, setVerificationProgress] = useState<{
    isRunning: boolean
    checkedFiles: number
    totalFiles: number
    missingFiles: number
  } | null>(null)
  const [verificationSettings, setVerificationSettings] = useState<{
    enabled: boolean
    interval: number
  } | null>(null)
  const [verificationLogOpen, setVerificationLogOpen] = useState(false)
  const [verifying, setVerifying] = useState(false)

  const [tempInterval, setTempInterval] = useState('3600')
  const [tempEnabled, setTempEnabled] = useState(false)

  const fetchStatus = useCallback(async () => {
    try {
      setError(null)
      const [queueData, hashData, verifyStats, verifyProgress, verifySettings] = await Promise.all([
        backgroundQueueApi.getQueueStatus(),
        backgroundQueueApi.getHashStats(),
        fileVerificationApi.getStats(),
        fileVerificationApi.getProgress(),
        fileVerificationApi.getSettings(),
      ])
      setStatus(queueData)
      setHashStats(hashData)
      setVerificationStats(verifyStats)
      setVerificationProgress(verifyProgress)
      setVerificationSettings(verifySettings)
      if (verifySettings) {
        setTempEnabled(verifySettings.enabled ?? false)
        setTempInterval(verifySettings.interval?.toString() ?? '3600')
      }
    } catch {
      setError(t('background.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  const handleClearQueue = async () => {
    if (!window.confirm(t('background.confirmReset'))) return
    try {
      await backgroundQueueApi.clearQueue()
      await fetchStatus()
    } catch {
      setError(t('background.resetFailed'))
    }
  }

  const handleTriggerAutoTag = async () => {
    try {
      await backgroundQueueApi.triggerAutoTag()
      await fetchStatus()
    } catch {
      setError(t('background.autoTagFailed'))
    }
  }

  const handleRebuildHashes = async () => {
    if (!hashStats || hashStats.imagesWithoutHash === 0) return
    if (!window.confirm(t('background.confirmHashGen', { count: hashStats.imagesWithoutHash }))) return

    try {
      setRebuildingHashes(true)
      setError(null)
      const result = await backgroundQueueApi.rebuildHashes()
      await fetchStatus()
      if (result.failed > 0) {
        setError(t('background.hashGenComplete', { processed: result.processed, failed: result.failed }))
      }
    } catch {
      setError(t('background.hashGenFailed'))
    } finally {
      setRebuildingHashes(false)
    }
  }

  const handleTriggerVerification = async () => {
    if (!verificationStats) return
    if (!window.confirm(t('background.confirmVerify', { count: verificationStats.totalFiles }))) return

    try {
      setVerifying(true)
      setError(null)
      await fileVerificationApi.triggerVerification()
      await fetchStatus()
    } catch {
      setError(t('background.verifyFailed'))
    } finally {
      setVerifying(false)
    }
  }

  const handleSaveVerificationSettings = async () => {
    const interval = Number.parseInt(tempInterval, 10)
    if (Number.isNaN(interval) || interval < 300 || interval > 86400) {
      setError(t('background.verifyIntervalError'))
      return
    }

    try {
      setError(null)
      await fileVerificationApi.updateSettings({
        enabled: tempEnabled,
        interval,
      })
      await fetchStatus()
    } catch {
      setError(t('background.verifySaveFailed'))
    }
  }

  useEffect(() => {
    void fetchStatus()
  }, [fetchStatus])

  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(() => {
      void fetchStatus()
    }, 5000)
    return () => clearInterval(interval)
  }, [autoRefresh, fetchStatus])

  const formatDate = (dateString: string | null) => {
    if (!dateString) return t('common.none')
    const date = new Date(dateString)
    return date.toLocaleString('ko-KR', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  if (loading) {
    return (
      <div className="flex justify-center py-6">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
      </div>
    )
  }

  if (!status) return null

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>{t('background.title')}</CardTitle>
          <div className="flex gap-1">
            <Button size="icon-sm" variant="ghost" onClick={() => void fetchStatus()} aria-label={t('common.refresh')} title={t('common.refresh')}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-destructive"
              onClick={() => void handleClearQueue()}
              disabled={status.queue.queueLength === 0}
              aria-label={t('background.confirmReset')}
            >
              <Eraser className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2">
            <div className="text-sm font-semibold">{t('background.queue.title')}</div>
            <div className="flex flex-wrap gap-2">
              <Badge>{t('background.queue.pending', { count: status.queue.queueLength })}</Badge>
              <Badge variant="secondary">
                {status.queue.processing ? t('background.queue.processing') : t('background.queue.waiting')}
              </Badge>
              <Badge variant="outline">{t('background.tasks.metadata')} {status.queue.tasksByType.metadata_extraction}</Badge>
              <Badge variant="outline">{t('background.tasks.promptCollection')} {status.queue.tasksByType.prompt_collection}</Badge>
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1 text-sm font-semibold">
                <Tags className="h-4 w-4" />
                {t('background.autoTag.title')}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleTriggerAutoTag()}
                disabled={!status.autoTag.isRunning || status.autoTag.untaggedCount === 0}
                aria-label={t('background.autoTag.manualTrigger')}
              >
                <Play className="h-4 w-4" />
                {t('background.autoTag.manualTrigger')}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant={status.autoTag.isRunning ? 'default' : 'secondary'}>
                {status.autoTag.isRunning ? t('background.autoTag.running') : t('background.autoTag.stopped')}
              </Badge>
              <Badge variant="outline">{t('background.autoTag.untaggedCount', { count: status.autoTag.untaggedCount })}</Badge>
              <Badge variant="outline">{t('background.autoTag.pollingInterval', { seconds: status.autoTag.pollingIntervalSeconds })}</Badge>
              <Badge variant="outline">{t('background.autoTag.batchSize', { size: status.autoTag.batchSize })}</Badge>
            </div>
          </div>

          <Separator />

          {hashStats ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">{t('background.hash.title')}</div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleRebuildHashes()}
                  disabled={rebuildingHashes || hashStats.imagesWithoutHash === 0}
                  aria-label={t('background.hash.generate')}
                >
                  <Play className="h-4 w-4" />
                  {t('background.hash.generate')}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{t('background.hash.total', { count: hashStats.totalImages })}</Badge>
                <Badge>{t('background.hash.completed', { count: hashStats.imagesWithHash })}</Badge>
                <Badge variant="secondary">{t('background.hash.pending', { count: hashStats.imagesWithoutHash })}</Badge>
                <Badge variant="outline">{t('background.hash.completion', { percent: hashStats.completionPercentage })}</Badge>
              </div>
            </div>
          ) : null}

          <Separator />

          {verificationStats && verificationSettings ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1 text-sm font-semibold">
                  <CheckCircle className="h-4 w-4" />
                  {t('background.verify.title')}
                </div>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" onClick={() => setVerificationLogOpen(true)}>
                    {t('background.verify.viewLogs')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleTriggerVerification()}
                    disabled={verifying || verificationProgress?.isRunning}
                    aria-label={t('background.verify.run')}
                  >
                    <Play className="h-4 w-4" />
                    {t('background.verify.run')}
                  </Button>
                </div>
              </div>

              {verificationProgress?.isRunning ? (
                <Alert>
                  <AlertDescription>
                    {t('background.verify.progress', {
                      checked: verificationProgress.checkedFiles,
                      total: verificationProgress.totalFiles,
                    })}
                    {verificationProgress.missingFiles > 0
                      ? ` - ${t('background.verify.missing', { count: verificationProgress.missingFiles })}`
                      : ''}
                  </AlertDescription>
                </Alert>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{t('background.verify.totalFiles', { count: verificationStats.totalFiles })}</Badge>
                <Badge variant="secondary">{t('background.verify.missingFiles', { count: verificationStats.missingFiles })}</Badge>
                <Badge variant="outline">{t('background.verify.lastVerification', { date: formatDate(verificationStats.lastVerificationDate) })}</Badge>
              </div>

              <div className="space-y-2 rounded border p-3">
                <div className="text-sm font-semibold">{t('background.verify.schedulerTitle')}</div>
                <div className="grid gap-2 md:grid-cols-[auto_1fr_auto] md:items-center">
                  <div className="flex items-center gap-2">
                    <Switch checked={tempEnabled} onCheckedChange={setTempEnabled} />
                    <span className="text-sm">{tempEnabled ? t('common.enabled') : t('common.disabled')}</span>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="verify-interval" className="text-sm font-medium">{t('background.verify.intervalLabel')}</label>
                    <div className="flex items-center gap-1">
                      <Input
                        id="verify-interval"
                        type="number"
                        value={tempInterval}
                        onChange={(event) => setTempInterval(event.target.value)}
                        disabled={!tempEnabled}
                        min={300}
                        max={86400}
                      />
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="text-muted-foreground"
                            aria-label={t('background.verify.intervalTooltip')}
                            title={t('background.verify.intervalTooltip')}
                          >
                            <Info className="h-4 w-4" />
                          </button>
                          </TooltipTrigger>
                          <TooltipContent>{t('background.verify.intervalTooltip')}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <p className="text-muted-foreground text-xs">{t('background.verify.intervalHelper')}</p>
                  </div>

                  <Button
                    onClick={() => void handleSaveVerificationSettings()}
                    disabled={
                      !verificationSettings ||
                      (tempEnabled === verificationSettings.enabled &&
                        tempInterval === verificationSettings.interval.toString())
                    }
                  >
                    {t('common.save')}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          <div className="text-muted-foreground text-xs">
            {autoRefresh ? t('background.autoUpdate') : t('background.autoUpdateDisabled')}
          </div>
        </CardContent>
      </Card>

      <FileVerificationLogModal open={verificationLogOpen} onClose={() => setVerificationLogOpen(false)} />
    </>
  )
}

export default BackgroundStatusMonitor
