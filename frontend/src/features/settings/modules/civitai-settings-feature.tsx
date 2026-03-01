import { useEffect, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { apiClient } from '@/lib/api/client'

interface CivitaiSettingsState {
  enabled: boolean
  apiCallInterval: number
}

interface CivitaiStats {
  totalLookups: number
  successfulLookups: number
  failedLookups: number
  successRate: number
}

interface CivitaiModelInfo {
  id: number
  model_hash: string
  model_name: string | null
  model_type: string | null
  created_at: string
}

interface RescanProgress {
  isRunning: boolean
  total: number
  processed: number
  added: number
  percentage: number
}

export function CivitaiSettingsFeature() {
  const [settings, setSettings] = useState<CivitaiSettingsState>({
    enabled: false,
    apiCallInterval: 2,
  })
  const [stats, setStats] = useState<CivitaiStats | null>(null)
  const [models, setModels] = useState<CivitaiModelInfo[]>([])
  const [rescanProgress, setRescanProgress] = useState<RescanProgress | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
      const [settingsResponse, statsResponse, modelsResponse] = await Promise.all([
        apiClient.get<{ success: boolean; data: CivitaiSettingsState }>('/api/settings/civitai'),
        apiClient.get<{ success: boolean; data: CivitaiStats }>('/api/settings/civitai/stats'),
        apiClient.get<{ success: boolean; data: CivitaiModelInfo[] }>('/api/civitai/models', { params: { limit: 20, offset: 0 } }),
      ])
      setSettings(settingsResponse.data.data ?? { enabled: false, apiCallInterval: 2 })
      setStats(statsResponse.data.data)
      setModels(modelsResponse.data.data ?? [])
      } catch {
        setError('Failed to load Civitai settings.')
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const response = await apiClient.put<{ success: boolean; data: CivitaiSettingsState }>('/api/settings/civitai', settings)
      setSettings(response.data.data ?? settings)
      setSuccess('Civitai settings saved successfully.')
    } catch {
      setError('Failed to save Civitai settings.')
    } finally {
      setSaving(false)
    }
  }

  const handleResetFailed = async () => {
    setError(null)
    setSuccess(null)
    try {
      const response = await apiClient.post<{ success: boolean; message?: string }>('/api/civitai/reset-failed')
      setSuccess(response.data.message || 'Failed lookups reset.')
    } catch {
      setError('Failed to reset failed lookups.')
    }
  }

  const handleResetStats = async () => {
    setError(null)
    setSuccess(null)
    try {
      await apiClient.post('/api/civitai/stats/reset')
      setSuccess('Civitai statistics reset.')
    } catch {
      setError('Failed to reset Civitai statistics.')
    }
  }

  const handleClearCache = async () => {
    setError(null)
    setSuccess(null)
    try {
      const response = await apiClient.delete<{ success: boolean; message?: string }>('/api/civitai/models')
      setSuccess(response.data.message || 'Model cache cleared.')
      setModels([])
    } catch {
      setError('Failed to clear model cache.')
    }
  }

  const pollRescanProgress = async () => {
    try {
      const response = await apiClient.get<{ success: boolean; data: RescanProgress }>('/api/civitai/rescan-progress')
      const progress = response.data.data
      if (!progress) {
        return
      }

      setRescanProgress(progress)
      if (progress.isRunning) {
        window.setTimeout(() => {
          void pollRescanProgress()
        }, 1000)
      } else if (progress.total > 0) {
        setSuccess(`Rescan completed: ${progress.added} references added.`)
      }
    } catch {
      setError('Failed to read rescan progress.')
    }
  }

  const handleStartRescan = async () => {
    setError(null)
    setSuccess(null)
    try {
      const response = await apiClient.post<{ success: boolean; message?: string; total?: number }>('/api/civitai/rescan-all')
      setSuccess(response.data.message || `Rescan started (${response.data.total ?? 0} images).`)
      void pollRescanProgress()
    } catch {
      setError('Failed to start Civitai rescan.')
    }
  }

  return (
    <section className="space-y-4">
      <h3 className="text-lg font-semibold">Civitai settings</h3>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {success ? (
        <Alert>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? <p className="text-sm text-muted-foreground">Loading Civitai configuration...</p> : null}

      <div className="space-y-3 rounded-md border p-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) => setSettings((previous) => ({ ...previous, enabled: event.target.checked }))}
          />
          Enable Civitai integration
        </label>

        <label className="space-y-1 text-sm">
          <span>API call interval (seconds)</span>
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={settings.apiCallInterval}
            onChange={(event) =>
              setSettings((previous) => ({
                ...previous,
                apiCallInterval: Number(event.target.value),
              }))
            }
          />
          <p className="text-xs text-muted-foreground">{settings.apiCallInterval}s</p>
        </label>

        <Button type="button" onClick={() => void handleSave()} disabled={saving}>
          {saving ? 'Saving...' : 'Save Civitai settings'}
        </Button>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void handleResetFailed()}>
            Reset failed lookups
          </Button>
          <Button type="button" variant="outline" onClick={() => void handleResetStats()}>
            Reset stats
          </Button>
          <Button type="button" variant="outline" onClick={() => void handleStartRescan()} disabled={!settings.enabled}>
            Start rescan
          </Button>
          <Button type="button" variant="outline" onClick={() => void handleClearCache()}>
            Clear model cache
          </Button>
        </div>
      </div>

      {stats ? (
        <div className="rounded-md border p-3 text-sm">
          <h4 className="mb-2 font-medium">Civitai statistics</h4>
          <p>Total lookups: {stats.totalLookups}</p>
          <p>Successful lookups: {stats.successfulLookups}</p>
          <p>Failed lookups: {stats.failedLookups}</p>
          <p>Success rate: {stats.successRate}%</p>
        </div>
      ) : null}

      {rescanProgress ? (
        <div className="rounded-md border p-3 text-sm">
          <h4 className="mb-2 font-medium">Rescan progress</h4>
          <p>
            {rescanProgress.processed}/{rescanProgress.total} processed ({rescanProgress.percentage}%)
          </p>
          <p>Added references: {rescanProgress.added}</p>
        </div>
      ) : null}

      <div className="rounded-md border p-3 text-sm">
        <h4 className="mb-2 font-medium">Cached models ({models.length})</h4>
        {models.length === 0 ? <p className="text-muted-foreground">No cached models.</p> : null}
        {models.slice(0, 5).map((model) => (
          <div key={model.id} className="mb-2 rounded border p-2">
            <p className="font-medium">{model.model_name || 'Unknown model'}</p>
            <p className="text-xs text-muted-foreground">{model.model_type || 'unknown'} - {model.model_hash}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
