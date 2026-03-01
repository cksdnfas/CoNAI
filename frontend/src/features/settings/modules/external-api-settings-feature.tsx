import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiClient } from '@/lib/api/client'

interface ExternalProvider {
  provider_name: string
  display_name: string
  is_enabled: boolean
  api_key_masked: string
  base_url: string | null
}

interface ConnectionTestResult {
  success: boolean
  message: string
}

export function ExternalApiSettingsFeature() {
  const [providers, setProviders] = useState<ExternalProvider[]>([])
  const [loading, setLoading] = useState(false)
  const [savingProvider, setSavingProvider] = useState<string | null>(null)
  const [testingProvider, setTestingProvider] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [apiKeyDrafts, setApiKeyDrafts] = useState<Record<string, string>>({})
  const [baseUrlDrafts, setBaseUrlDrafts] = useState<Record<string, string>>({})
  const [newProviderName, setNewProviderName] = useState('')
  const [newProviderDisplayName, setNewProviderDisplayName] = useState('')

  const providerNames = useMemo(() => providers.map((provider) => provider.provider_name), [providers])

  const loadProviders = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await apiClient.get<{ success: boolean; data: ExternalProvider[] }>('/api/settings/external-api/providers')
      const loaded = response.data.data ?? []
      setProviders(loaded)
      setApiKeyDrafts(
        loaded.reduce<Record<string, string>>((acc, provider) => {
          acc[provider.provider_name] = ''
          return acc
        }, {}),
      )
      setBaseUrlDrafts(
        loaded.reduce<Record<string, string>>((acc, provider) => {
          acc[provider.provider_name] = provider.base_url ?? ''
          return acc
        }, {}),
      )
    } catch {
      setError('Failed to load external API providers.')
      setProviders([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadProviders()
  }, [loadProviders])

  const handleSaveProvider = async (providerName: string) => {
    setError(null)
    setSuccess(null)
    setSavingProvider(providerName)

    try {
      await apiClient.put('/api/settings/external-api/providers/' + providerName, {
        api_key: apiKeyDrafts[providerName]?.trim() || undefined,
        base_url: baseUrlDrafts[providerName]?.trim() || null,
      })
      setSuccess(`Saved ${providerName} provider settings.`)
      setApiKeyDrafts((previous) => ({ ...previous, [providerName]: '' }))
    } catch {
      setError(`Failed to save ${providerName} provider settings.`)
    } finally {
      setSavingProvider(null)
    }
  }

  const handleToggleProvider = async (provider: ExternalProvider) => {
    setError(null)
    setSuccess(null)

    try {
      await apiClient.patch('/api/external-api/providers/' + provider.provider_name + '/toggle', {
        is_enabled: !provider.is_enabled,
      })
      await loadProviders()
      setSuccess(`${provider.display_name} is now ${provider.is_enabled ? 'disabled' : 'enabled'}.`)
    } catch {
      setError(`Failed to toggle ${provider.display_name}.`)
    }
  }

  const handleTestConnection = async (providerName: string) => {
    setError(null)
    setSuccess(null)
    setTestingProvider(providerName)

    try {
      const response = await apiClient.post<ConnectionTestResult>('/api/external-api/providers/' + providerName + '/test', {})
      if (response.data.success) {
        setSuccess(response.data.message || `Connection test for ${providerName} passed.`)
      } else {
        setError(response.data.message || `Connection test for ${providerName} failed.`)
      }
    } catch {
      setError(`Connection test for ${providerName} failed.`)
    } finally {
      setTestingProvider(null)
    }
  }

  const handleCreateProvider = async () => {
    setError(null)
    setSuccess(null)

    if (!newProviderName.trim() || !newProviderDisplayName.trim()) {
      setError('Provider name and display name are required.')
      return
    }

    try {
      await apiClient.post('/api/external-api/providers', {
        provider_name: newProviderName.trim().toLowerCase().replace(/\s+/g, '_'),
        display_name: newProviderDisplayName.trim(),
        provider_type: 'general',
      })
      setNewProviderName('')
      setNewProviderDisplayName('')
      await loadProviders()
      setSuccess('Provider created successfully.')
    } catch {
      setError('Failed to create provider.')
    }
  }

  const handleDeleteProvider = async (providerName: string) => {
    setError(null)
    setSuccess(null)

    try {
      await apiClient.delete('/api/external-api/providers/' + providerName)
      await loadProviders()
      setSuccess(`${providerName} provider deleted.`)
    } catch {
      setError(`Failed to delete ${providerName}.`)
    }
  }

  return (
    <section className="space-y-4">
      <h3 className="text-lg font-semibold">External API settings</h3>

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

      {loading ? <p className="text-sm text-muted-foreground">Loading providers...</p> : null}

      <Button type="button" variant="outline" onClick={() => void loadProviders()} disabled={loading}>
        Reload providers
      </Button>

      {!loading && providerNames.length === 0 ? <p className="text-sm text-muted-foreground">No providers configured.</p> : null}

      <div className="space-y-2 rounded-md border p-3">
        <h4 className="font-medium">Create provider</h4>
        <Input placeholder="Provider name" value={newProviderName} onChange={(event) => setNewProviderName(event.target.value)} />
        <Input
          placeholder="Display name"
          value={newProviderDisplayName}
          onChange={(event) => setNewProviderDisplayName(event.target.value)}
        />
        <Button type="button" onClick={() => void handleCreateProvider()}>
          Create provider
        </Button>
      </div>

      {providers.map((provider) => (
        <div key={provider.provider_name} className="space-y-2 rounded-md border p-3">
          <div className="flex items-center justify-between gap-3">
            <h4 className="font-medium">{provider.display_name}</h4>
            <span className="text-xs text-muted-foreground">{provider.is_enabled ? 'Enabled' : 'Disabled'}</span>
          </div>
          <p className="text-xs text-muted-foreground">Current key: {provider.api_key_masked || 'Not set'}</p>
          <Input
            placeholder="New API key"
            value={apiKeyDrafts[provider.provider_name] ?? ''}
            onChange={(event) =>
              setApiKeyDrafts((previous) => ({
                ...previous,
                [provider.provider_name]: event.target.value,
              }))
            }
          />
          <Input
            placeholder="Base URL (optional)"
            value={baseUrlDrafts[provider.provider_name] ?? ''}
            onChange={(event) =>
              setBaseUrlDrafts((previous) => ({
                ...previous,
                [provider.provider_name]: event.target.value,
              }))
            }
          />
          <Button
            type="button"
            onClick={() => void handleSaveProvider(provider.provider_name)}
            disabled={savingProvider === provider.provider_name}
          >
            {savingProvider === provider.provider_name ? 'Saving...' : 'Save provider'}
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => void handleToggleProvider(provider)}>
              {provider.is_enabled ? 'Disable provider' : 'Enable provider'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleTestConnection(provider.provider_name)}
              disabled={testingProvider === provider.provider_name}
            >
              {testingProvider === provider.provider_name ? 'Testing...' : 'Test connection'}
            </Button>
            {provider.provider_name !== 'civitai' ? (
              <Button type="button" variant="destructive" onClick={() => void handleDeleteProvider(provider.provider_name)}>
                Delete provider
              </Button>
            ) : null}
          </div>
        </div>
      ))}
    </section>
  )
}
