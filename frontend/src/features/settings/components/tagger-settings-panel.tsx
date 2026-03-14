import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, CloudDownload, CloudOff, CloudUpload, Loader2, RefreshCw, TestTube2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { taggerBatchApi } from '@/services/tagger-batch-api'
import { settingsApi, type DependencyCheckResult, type KaloscopeServerStatus, type KaloscopeSettings, type TaggerModel, type TaggerServerStatus, type TaggerSettings } from '@/services/settings-api'
import { Alert as UiAlert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'

interface TaggerSettingsPanelProps {
  settings: TaggerSettings
  kaloscopeSettings: KaloscopeSettings
  onUpdate: (settings: Partial<TaggerSettings>) => Promise<void>
  onUpdateKaloscope: (settings: Partial<KaloscopeSettings>) => Promise<void>
}

export function TaggerSettingsPanel({ settings, kaloscopeSettings, onUpdate, onUpdateKaloscope }: TaggerSettingsPanelProps) {
  const { t } = useTranslation('settings')
  const [local, setLocal] = useState(settings)
  const [localKaloscope, setLocalKaloscope] = useState(kaloscopeSettings)
  const [models, setModels] = useState<TaggerModel[]>([])
  const [modelStatus, setModelStatus] = useState<TaggerServerStatus | null>(null)
  const [kaloscopeStatus, setKaloscopeStatus] = useState<KaloscopeServerStatus | null>(null)
  const [dependencyStatus, setDependencyStatus] = useState<DependencyCheckResult | null>(null)
  const [testImageId, setTestImageId] = useState('')
  const [testResult, setTestResult] = useState<unknown>(null)
  const [kaloscopeTestImageId, setKaloscopeTestImageId] = useState('')
  const [kaloscopeTestResult, setKaloscopeTestResult] = useState<unknown>(null)
  const [saving, setSaving] = useState(false)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [statusLoading, setStatusLoading] = useState(false)
  const [downloadLoading, setDownloadLoading] = useState(false)
  const [checkDepsLoading, setCheckDepsLoading] = useState(false)
  const [testLoading, setTestLoading] = useState(false)
  const [kaloscopeTestLoading, setKaloscopeTestLoading] = useState(false)
  const [batchLoading, setBatchLoading] = useState(false)
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => {
    setLocal(settings)
  }, [settings])

  useEffect(() => {
    setLocalKaloscope(kaloscopeSettings)
  }, [kaloscopeSettings])

  const hasChanges = useMemo(
    () => JSON.stringify(local) !== JSON.stringify(settings) || JSON.stringify(localKaloscope) !== JSON.stringify(kaloscopeSettings),
    [local, settings, localKaloscope, kaloscopeSettings]
  )

  const setSuccessBanner = useCallback((message: string) => {
    setBanner({ type: 'success', message })
  }, [])

  const setErrorBanner = useCallback((message: string) => {
    setBanner({ type: 'error', message })
  }, [])

  const extractErrorMessage = useCallback((error: unknown, fallback: string): string => {
    if (
      error &&
      typeof error === 'object' &&
      'response' in error &&
      error.response &&
      typeof error.response === 'object' &&
      'data' in error.response &&
      error.response.data &&
      typeof error.response.data === 'object' &&
      'error' in error.response.data &&
      typeof error.response.data.error === 'string'
    ) {
      return error.response.data.error
    }

    return fallback
  }, [])

  const loadModels = useCallback(async () => {
    try {
      setModelsLoading(true)
      const loadedModels = await settingsApi.getModelsList()
      setModels(loadedModels)
    } catch (error) {
      console.error('Failed to load tagger models:', error)
      setErrorBanner(t('messages.loadFailed'))
    } finally {
      setModelsLoading(false)
    }
  }, [setErrorBanner, t])

  const loadModelStatus = useCallback(async () => {
    try {
      setStatusLoading(true)
      const status = await settingsApi.getTaggerStatus()
      setModelStatus(status)
    } catch (error) {
      console.error('Failed to load tagger status:', error)
    } finally {
      setStatusLoading(false)
    }
  }, [])

  const loadKaloscopeStatus = useCallback(async () => {
    try {
      const status = await settingsApi.getKaloscopeStatus()
      setKaloscopeStatus(status)
    } catch (error) {
      console.error('Failed to load kaloscope status:', error)
    }
  }, [])

  useEffect(() => {
    void loadModels()
    void loadModelStatus()
    void loadKaloscopeStatus()
  }, [loadKaloscopeStatus, loadModelStatus, loadModels])

  useEffect(() => {
    if (!local.enabled && !localKaloscope.enabled) {
      return
    }

    const interval = window.setInterval(() => {
      void loadModelStatus()
      void loadKaloscopeStatus()
    }, 5000)

    return () => {
      window.clearInterval(interval)
    }
  }, [local.enabled, localKaloscope.enabled, loadKaloscopeStatus, loadModelStatus])

  const selectedModel = useMemo(() => models.find((model) => model.name === local.model), [local.model, models])

  const kaloscopeDependencyProblem = useMemo(() => {
    if (!kaloscopeStatus || kaloscopeStatus.dependenciesAvailable) {
      return null
    }

    return {
      message: kaloscopeStatus.statusMessage,
      installCommand: kaloscopeStatus.installCommand,
      missingPackages: kaloscopeStatus.missingPackages ?? [],
    }
  }, [kaloscopeStatus])

  const handleSave = async () => {
    setSaving(true)
    setBanner(null)
    try {
      await onUpdate(local)
      await onUpdateKaloscope(localKaloscope)
      setSuccessBanner(t('messages.saveSuccess'))
    } catch (error) {
      console.error('Failed to save tagger settings:', error)
      setErrorBanner(t('messages.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    setLocal(settings)
    setLocalKaloscope(kaloscopeSettings)
  }

  const handleLoadModel = async () => {
    try {
      setStatusLoading(true)
      await settingsApi.loadModel(local.model, local.device)
      await loadModelStatus()
      setSuccessBanner(t('tagger.alerts.modelLoaded'))
    } catch (error) {
      console.error('Failed to load tagger model:', error)
      setErrorBanner(t('tagger.alerts.loadFailed'))
    } finally {
      setStatusLoading(false)
    }
  }

  const handleUnloadModel = async () => {
    try {
      setStatusLoading(true)
      await settingsApi.unloadModel()
      await loadModelStatus()
      setSuccessBanner(t('tagger.alerts.modelUnloaded'))
    } catch (error) {
      console.error('Failed to unload tagger model:', error)
      setErrorBanner(t('tagger.alerts.unloadFailed'))
    } finally {
      setStatusLoading(false)
    }
  }

  const handleDownloadModel = async () => {
    try {
      setDownloadLoading(true)
      const result = await settingsApi.downloadModel(local.model)
      setSuccessBanner(result.message)
      await loadModels()
    } catch (error) {
      console.error('Failed to download tagger model:', error)
      setErrorBanner(t('tagger.alerts.downloadFailed', { defaultValue: 'Failed to download model' }))
    } finally {
      setDownloadLoading(false)
    }
  }

  const handleCheckDependencies = async () => {
    try {
      setCheckDepsLoading(true)
      const status = await settingsApi.checkDependencies()
      setDependencyStatus(status)
      if (status.available) {
        setSuccessBanner(status.message)
      } else {
        setErrorBanner(status.message)
      }
    } catch (error) {
      console.error('Failed to check dependencies:', error)
      setErrorBanner(t('tagger.alerts.dependencyCheckFailed', { defaultValue: 'Failed to check dependencies' }))
    } finally {
      setCheckDepsLoading(false)
    }
  }

  const handleResetAutoTags = async () => {
    const confirmed = window.confirm(
      t('tagger.batch.confirmDialog.resetMessage', {
        defaultValue: 'Are you sure you want to reset all auto tags?',
      })
    )
    if (!confirmed) {
      return
    }

    try {
      setBatchLoading(true)
      const result = await taggerBatchApi.resetAutoTags()
      setSuccessBanner(
        t('tagger.batch.alerts.resetComplete', {
          defaultValue: 'Reset complete. Queued for background processing.',
          changes: result.changes,
        })
      )
    } catch (error) {
      console.error('Failed to reset auto tags:', error)
      setErrorBanner(t('tagger.batch.alerts.resetFailed', { defaultValue: 'Failed to reset tags' }))
    } finally {
      setBatchLoading(false)
    }
  }

  const handleTestImage = async () => {
    const imageId = testImageId.trim()
    if (!imageId) {
      setErrorBanner(t('tagger.test.invalidId'))
      return
    }

    try {
      setTestLoading(true)
      setTestResult(null)
      const result = await taggerBatchApi.testImage(imageId)
      setTestResult(result)
      setSuccessBanner(t('tagger.test.success', { defaultValue: 'Tagger test completed' }))
    } catch (error) {
      console.error('Failed to test image tagging:', error)
      setErrorBanner(t('tagger.test.failed'))
    } finally {
      setTestLoading(false)
    }
  }

  const handleKaloscopeTestImage = async () => {
    const imageId = kaloscopeTestImageId.trim()
    if (!imageId) {
      setErrorBanner(t('tagger.test.invalidId'))
      return
    }

    try {
      setKaloscopeTestLoading(true)
      setKaloscopeTestResult(null)
      const result = await settingsApi.testKaloscope(imageId)
      setKaloscopeTestResult(result)
      await loadKaloscopeStatus()
      setSuccessBanner(t('tagger.kaloscope.test.success', { defaultValue: 'Kaloscope test completed' }))
    } catch (error) {
      console.error('Failed to test Kaloscope tagging:', error)
      setErrorBanner(extractErrorMessage(error, t('tagger.kaloscope.test.failed', { defaultValue: 'Kaloscope test failed' })))
    } finally {
      setKaloscopeTestLoading(false)
    }
  }

  const formatRelativeTime = (isoString: string | null): string => {
    if (!isoString) return t('tagger.modelStatus.none')

    const date = new Date(isoString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)

    if (diffMins < 1) return t('tagger.modelStatus.justNow')
    if (diffMins < 60) return t('tagger.modelStatus.minutesAgo', { minutes: diffMins })

    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return t('tagger.modelStatus.hoursAgo', { hours: diffHours })

    const diffDays = Math.floor(diffHours / 24)
    return t('tagger.modelStatus.daysAgo', { days: diffDays })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('tabs.tagger')}</CardTitle>
        <CardDescription>{t('tagger.autoTagsDescription', { defaultValue: 'Configure WD Tagger and Kaloscope auto-tagging in one place.' })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {banner ? (
          <UiAlert variant={banner.type === 'error' ? 'destructive' : 'default'} className={banner.type === 'success' ? 'border-green-500/30 text-green-700' : undefined}>
            <AlertDescription>{banner.message}</AlertDescription>
          </UiAlert>
        ) : null}

        <div className="space-y-3 rounded-md border p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{t('tagger.enabled')}</p>
            <Switch checked={local.enabled} onCheckedChange={(checked) => setLocal((prev) => ({ ...prev, enabled: Boolean(checked) }))} />
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm">{t('tagger.autoTagOnUpload')}</p>
            <Switch checked={local.autoTagOnUpload} onCheckedChange={(checked) => setLocal((prev) => ({ ...prev, autoTagOnUpload: Boolean(checked) }))} />
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('tagger.model.label')}</p>
              <Select value={local.model} onValueChange={(value: TaggerSettings['model']) => setLocal((prev) => ({ ...prev, model: value }))}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vit">ViT</SelectItem>
                  <SelectItem value="swinv2">SwinV2</SelectItem>
                  <SelectItem value="convnext">ConvNext</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('tagger.device.label')}</p>
              <Select value={local.device} onValueChange={(value: TaggerSettings['device']) => setLocal((prev) => ({ ...prev, device: value }))}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="cpu">CPU</SelectItem>
                  <SelectItem value="cuda">CUDA</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('tagger.threshold.general.label', { value: local.generalThreshold.toFixed(2) })}</p>
              <Input type="number" min={0} max={1} step={0.01} value={local.generalThreshold} onChange={(event) => {
                const value = Number.parseFloat(event.target.value)
                if (!Number.isNaN(value)) setLocal((prev) => ({ ...prev, generalThreshold: value }))
              }} />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('tagger.threshold.character.label', { value: local.characterThreshold.toFixed(2) })}</p>
              <Input type="number" min={0} max={1} step={0.01} value={local.characterThreshold} onChange={(event) => {
                const value = Number.parseFloat(event.target.value)
                if (!Number.isNaN(value)) setLocal((prev) => ({ ...prev, characterThreshold: value }))
              }} />
            </div>
          </div>
        </div>

        <div className="space-y-3 rounded-md border p-3">
          <p className="text-sm font-medium">{t('tagger.kaloscope.title', { defaultValue: 'Kaloscope Artist Tags' })}</p>
          <div className="flex items-center justify-between">
            <p className="text-sm">{t('tagger.kaloscope.enabled', { defaultValue: 'Enable Kaloscope' })}</p>
            <Switch checked={localKaloscope.enabled} onCheckedChange={(checked) => setLocalKaloscope((prev) => ({ ...prev, enabled: Boolean(checked) }))} />
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm">{t('tagger.kaloscope.autoTagOnUpload', { defaultValue: 'Auto process in scheduler/upload' })}</p>
            <Switch
              checked={localKaloscope.autoTagOnUpload}
              onCheckedChange={(checked) => setLocalKaloscope((prev) => ({ ...prev, autoTagOnUpload: Boolean(checked) }))}
              disabled={!localKaloscope.enabled}
            />
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('tagger.kaloscope.device.label', { defaultValue: 'Device' })}</p>
              <Select
                value={localKaloscope.device}
                onValueChange={(value: TaggerSettings['device']) => setLocalKaloscope((prev) => ({ ...prev, device: value }))}
                disabled={!localKaloscope.enabled}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="cpu">CPU</SelectItem>
                  <SelectItem value="cuda">CUDA</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('tagger.kaloscope.topK.label', { defaultValue: 'Top-K artist tags' })}</p>
              <Input
                type="number"
                min={1}
                max={200}
                step={1}
                value={localKaloscope.topK}
                onChange={(event) => {
                  const value = Number.parseInt(event.target.value, 10)
                  if (!Number.isNaN(value)) setLocalKaloscope((prev) => ({ ...prev, topK: value }))
                }}
                disabled={!localKaloscope.enabled}
              />
            </div>
          </div>
        </div>

        <div className="space-y-3 rounded-md border p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{t('tagger.modelStatus.title')}</p>
            {statusLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={modelStatus?.modelLoaded ? 'default' : 'outline'}>
              {modelStatus?.modelLoaded ? t('tagger.modelStatus.loaded') : t('tagger.modelStatus.unloaded')}
            </Badge>
            {modelStatus?.currentModel ? <Badge variant="outline">{modelStatus.currentModel}</Badge> : null}
            {modelStatus?.currentDevice ? <Badge variant="outline">{modelStatus.currentDevice}</Badge> : null}
            {selectedModel?.downloaded ? (
              <Badge variant="outline" className="gap-1 text-green-700">
                <CheckCircle2 className="h-3 w-3" />
                {t('tagger.model.downloaded')}
              </Badge>
            ) : null}
          </div>

          <p className="text-xs text-muted-foreground">
            {t('tagger.modelStatus.lastUsed')}: {formatRelativeTime(modelStatus?.lastUsedAt ?? null)}
          </p>

          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => void handleLoadModel()} disabled={statusLoading || !local.enabled}>
              <CloudUpload className="mr-1 h-4 w-4" />
              {t('tagger.buttons.load')}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => void handleUnloadModel()} disabled={statusLoading || !local.enabled}>
              <CloudOff className="mr-1 h-4 w-4" />
              {t('tagger.buttons.unload')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                void loadModelStatus()
                void loadKaloscopeStatus()
              }}
              disabled={statusLoading}
            >
              <RefreshCw className="mr-1 h-4 w-4" />
              {t('tagger.buttons.refresh')}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => void handleDownloadModel()} disabled={downloadLoading || !local.enabled || modelsLoading}>
              {downloadLoading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CloudDownload className="mr-1 h-4 w-4" />}
              {t('tagger.buttons.downloadModel', { defaultValue: 'Download Model' })}
            </Button>
          </div>

          {selectedModel ? (
            <p className="text-xs text-muted-foreground">
              {selectedModel.label}: {selectedModel.description}
            </p>
          ) : null}

          <Separator className="my-2" />

          <div className="space-y-2">
            <p className="text-sm font-medium">Kaloscope</p>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={kaloscopeStatus?.enabled ? 'default' : 'outline'}>
                {kaloscopeStatus?.enabled ? 'Enabled' : 'Disabled'}
              </Badge>
              <Badge variant={kaloscopeStatus?.scriptExists ? 'default' : 'destructive'}>
                {kaloscopeStatus?.scriptExists ? 'Script Ready' : 'Script Missing'}
              </Badge>
              <Badge variant={kaloscopeStatus?.modelCached ? 'default' : 'outline'}>
                {kaloscopeStatus?.modelCached ? 'Model Cached' : 'Model Not Cached'}
              </Badge>
              {kaloscopeStatus?.currentDevice ? <Badge variant="outline">{kaloscopeStatus.currentDevice}</Badge> : null}
              {kaloscopeStatus?.topK ? <Badge variant="outline">TopK {kaloscopeStatus.topK}</Badge> : null}
            </div>
            {kaloscopeStatus ? (
              <div className="space-y-1 text-xs text-muted-foreground">
                <p>{kaloscopeStatus.modelRepo} / {kaloscopeStatus.modelFile}</p>
                <p>{kaloscopeStatus.statusMessage}</p>
              </div>
            ) : null}
          </div>
        </div>

        <div className="space-y-3 rounded-md border p-3">
          <p className="text-sm font-medium">{t('tagger.memoryManagement.title')}</p>
          <div className="flex items-center justify-between">
            <p className="text-sm">{t('tagger.memoryManagement.keepModelLoaded')}</p>
            <Switch checked={local.keepModelLoaded} onCheckedChange={(checked) => setLocal((prev) => ({ ...prev, keepModelLoaded: Boolean(checked) }))} />
          </div>
          {local.keepModelLoaded ? (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('tagger.memoryManagement.autoUnloadMinutes', { minutes: local.autoUnloadMinutes })}</p>
              <Input type="number" min={1} max={60} step={1} value={local.autoUnloadMinutes} onChange={(event) => {
                const value = Number.parseInt(event.target.value, 10)
                if (!Number.isNaN(value)) setLocal((prev) => ({ ...prev, autoUnloadMinutes: value }))
              }} />
            </div>
          ) : null}
        </div>

        <div className="space-y-3 rounded-md border p-3">
          <p className="text-sm font-medium">{t('tagger.pythonPath.label')}</p>
          <Input value={local.pythonPath} onChange={(event) => setLocal((prev) => ({ ...prev, pythonPath: event.target.value }))} placeholder="python" />
          <Button type="button" variant="outline" onClick={() => void handleCheckDependencies()} disabled={checkDepsLoading || !local.enabled}>
            {checkDepsLoading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            {checkDepsLoading ? t('tagger.buttons.checking') : t('tagger.buttons.checkDependencies')}
          </Button>
          {dependencyStatus ? (
            <UiAlert variant={dependencyStatus.available ? 'default' : 'destructive'} className={dependencyStatus.available ? 'border-green-500/30 text-green-700' : undefined}>
              <AlertDescription>{dependencyStatus.message}</AlertDescription>
            </UiAlert>
          ) : null}
        </div>

        <div className="space-y-3 rounded-md border p-3">
          <p className="text-sm font-medium">{t('tagger.batch.title')}</p>
          <p className="text-xs text-muted-foreground">{t('tagger.batch.description')}</p>
          <Button type="button" variant="outline" onClick={() => void handleResetAutoTags()} disabled={batchLoading || !local.enabled}>
            {batchLoading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            {t('tagger.batch.buttons.resetTags', { defaultValue: 'Reset All Auto Tags' })}
          </Button>
        </div>

        <div className="space-y-3 rounded-md border p-3">
          <p className="text-sm font-medium">{t('tagger.test.title')}</p>
          <p className="text-xs text-muted-foreground">{t('tagger.test.description')}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input value={testImageId} onChange={(event) => setTestImageId(event.target.value)} placeholder={t('tagger.test.placeholderHash')} />
            <Button type="button" onClick={() => void handleTestImage()} disabled={testLoading || !testImageId.trim() || !local.enabled}>
              {testLoading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <TestTube2 className="mr-1 h-4 w-4" />}
              {testLoading ? t('tagger.test.processing') : t('tagger.test.button')}
            </Button>
          </div>
          {testResult ? (
            <pre className="max-h-56 overflow-auto rounded-md border bg-muted p-2 text-xs">{JSON.stringify(testResult, null, 2)}</pre>
          ) : null}
        </div>

        <div className="space-y-3 rounded-md border p-3">
          <p className="text-sm font-medium">{t('tagger.kaloscope.test.title', { defaultValue: 'Kaloscope Test' })}</p>
          <p className="text-xs text-muted-foreground">{t('tagger.kaloscope.test.description', { defaultValue: 'Run Kaloscope artist-tag test for a specific image hash.' })}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input value={kaloscopeTestImageId} onChange={(event) => setKaloscopeTestImageId(event.target.value)} placeholder={t('tagger.test.placeholderHash')} />
            <Button
              type="button"
              onClick={() => void handleKaloscopeTestImage()}
              disabled={kaloscopeTestLoading || !kaloscopeTestImageId.trim() || !localKaloscope.enabled}
            >
              {kaloscopeTestLoading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <TestTube2 className="mr-1 h-4 w-4" />}
              {kaloscopeTestLoading ? t('tagger.test.processing') : t('tagger.kaloscope.test.button', { defaultValue: 'Run Kaloscope Test' })}
            </Button>
          </div>
          {kaloscopeTestResult ? (
            <pre className="max-h-56 overflow-auto rounded-md border bg-muted p-2 text-xs">{JSON.stringify(kaloscopeTestResult, null, 2)}</pre>
          ) : null}
        </div>

        <Separator />

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={handleReset} disabled={!hasChanges || saving}>
            {t('tagger.buttons.cancel')}
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={!hasChanges || saving}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            {t('tagger.buttons.save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
