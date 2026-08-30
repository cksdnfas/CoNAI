import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Eye, EyeOff, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { copyTextToClipboard } from '@/lib/clipboard'
import {
  getMcpHttpSettings,
  rotateMcpHttpApiKey,
  updateMcpHttpEnabled,
} from '@/lib/api-settings-mcp'
import { SettingsInsetBlock, SettingsSection, SettingsToggleRow } from './settings-primitives'

const MCP_HTTP_SETTINGS_QUERY_KEY = ['mcp-http-settings'] as const

interface McpValueFieldProps {
  label: ReactNode
  value: string
  secret?: boolean
  visible?: boolean
  actions: ReactNode
}

function McpValueField({ label, value, secret = false, visible = false, actions }: McpValueFieldProps) {
  return (
    <div className="min-w-0 space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="flex min-w-0 items-center gap-2">
        <Input
          variant="settings"
          type={secret && !visible ? 'password' : 'text'}
          readOnly
          value={value}
          className="min-w-0 font-mono"
        />
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      </div>
    </div>
  )
}

/** Manage the authenticated stateless HTTP MCP endpoint. */
export function McpHttpSettingsCard() {
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const [showApiKey, setShowApiKey] = useState(false)

  const settingsQuery = useQuery({
    queryKey: MCP_HTTP_SETTINGS_QUERY_KEY,
    queryFn: getMcpHttpSettings,
  })

  const enabledMutation = useMutation({
    mutationFn: updateMcpHttpEnabled,
    onSuccess: (settings) => {
      queryClient.setQueryData(MCP_HTTP_SETTINGS_QUERY_KEY, settings)
      showSnackbar({
        message: settings.enabled
          ? t({ ko: 'MCP를 활성화했어.', en: 'MCP enabled.' })
          : t({ ko: 'MCP를 비활성화했어.', en: 'MCP disabled.' }),
        tone: 'info',
      })
    },
    onError: (error) => {
      showSnackbar({
        message: error instanceof Error ? error.message : t({ ko: 'MCP 설정을 저장하지 못했어.', en: 'Failed to save MCP settings.' }),
        tone: 'error',
      })
    },
  })

  const rotateKeyMutation = useMutation({
    mutationFn: rotateMcpHttpApiKey,
    onSuccess: (settings) => {
      queryClient.setQueryData(MCP_HTTP_SETTINGS_QUERY_KEY, settings)
      setShowApiKey(true)
      showSnackbar({ message: t({ ko: 'MCP 키를 교체했어.', en: 'MCP key rotated.' }), tone: 'info' })
    },
    onError: (error) => {
      showSnackbar({
        message: error instanceof Error ? error.message : t({ ko: 'MCP 키를 교체하지 못했어.', en: 'Failed to rotate the MCP key.' }),
        tone: 'error',
      })
    },
  })

  const copyValue = async (value: string, label: string) => {
    try {
      await copyTextToClipboard(value)
      showSnackbar({ message: t({ ko: '{label} 복사 완료', en: '{label} copied' }, { label }), tone: 'info' })
    } catch (error) {
      showSnackbar({
        message: error instanceof Error ? error.message : t({ ko: '복사하지 못했어.', en: 'Failed to copy.' }),
        tone: 'error',
      })
    }
  }

  const settings = settingsQuery.data
  const endpointUrl = typeof window === 'undefined' ? '/mcp' : `${window.location.origin}/mcp`
  const isMutating = enabledMutation.isPending || rotateKeyMutation.isPending

  return (
    <SettingsSection
      heading="MCP"
      actions={settings?.enabled
        ? <Badge>{t({ ko: '활성', en: 'Active' })}</Badge>
        : <Badge variant="outline">{t({ ko: '비활성', en: 'Inactive' })}</Badge>}
    >
      {settingsQuery.isLoading ? <Skeleton className="h-40 w-full rounded-sm" /> : null}

      {settingsQuery.isError ? (
        <SettingsInsetBlock className="text-sm text-destructive">
          {settingsQuery.error instanceof Error
            ? settingsQuery.error.message
            : t({ ko: 'MCP 설정을 불러오지 못했어.', en: 'Failed to load MCP settings.' })}
        </SettingsInsetBlock>
      ) : null}

      {settings ? (
        <div className="space-y-4">
          <SettingsToggleRow>
            <input
              type="checkbox"
              checked={settings.enabled}
              disabled={isMutating}
              onChange={(event) => enabledMutation.mutate(event.target.checked)}
            />
            {t({ ko: 'HTTP MCP', en: 'HTTP MCP' })}
          </SettingsToggleRow>

          <div className="grid gap-4 xl:grid-cols-2">
            <McpValueField
              label={t({ ko: 'MCP URL', en: 'MCP URL' })}
              value={endpointUrl}
              actions={(
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  onClick={() => void copyValue(endpointUrl, 'MCP URL')}
                  aria-label={t({ ko: 'MCP URL 복사', en: 'Copy MCP URL' })}
                  title={t({ ko: 'MCP URL 복사', en: 'Copy MCP URL' })}
                >
                  <Copy />
                </Button>
              )}
            />

            <McpValueField
              label={t({ ko: 'API 키', en: 'API key' })}
              value={settings.apiKey}
              secret
              visible={showApiKey}
              actions={(
                <>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    onClick={() => setShowApiKey((visible) => !visible)}
                    aria-label={showApiKey ? t({ ko: 'API 키 숨기기', en: 'Hide API key' }) : t({ ko: 'API 키 보기', en: 'Show API key' })}
                    title={showApiKey ? t({ ko: 'API 키 숨기기', en: 'Hide API key' }) : t({ ko: 'API 키 보기', en: 'Show API key' })}
                  >
                    {showApiKey ? <EyeOff /> : <Eye />}
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    onClick={() => void copyValue(settings.apiKey, t({ ko: 'API 키', en: 'API key' }))}
                    aria-label={t({ ko: 'API 키 복사', en: 'Copy API key' })}
                    title={t({ ko: 'API 키 복사', en: 'Copy API key' })}
                  >
                    <Copy />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    disabled={isMutating}
                    onClick={() => {
                      if (window.confirm(t({ ko: 'MCP API 키를 교체할까?', en: 'Rotate the MCP API key?' }))) {
                        rotateKeyMutation.mutate()
                      }
                    }}
                    aria-label={t({ ko: 'API 키 교체', en: 'Rotate API key' })}
                    title={t({ ko: 'API 키 교체', en: 'Rotate API key' })}
                  >
                    <RefreshCw className={rotateKeyMutation.isPending ? 'animate-spin' : undefined} />
                  </Button>
                </>
              )}
            />
          </div>
        </div>
      ) : null}
    </SettingsSection>
  )
}
