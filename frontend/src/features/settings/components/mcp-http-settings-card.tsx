import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { McpHttpScope } from '@conai/shared'
import { Copy, Eye, EyeOff, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { copyTextToClipboard } from '@/lib/clipboard'
import {
  createMcpHttpApiKey,
  getMcpHttpSettings,
  revokeMcpHttpApiKey,
  rotateMcpHttpApiKey,
  updateMcpHttpApiKey,
  updateMcpHttpEnabled,
} from '@/lib/api-settings-mcp'
import { SettingsInsetBlock, SettingsSection, SettingsToggleRow } from './settings-primitives'

const QUERY_KEY = ['mcp-http-settings'] as const
const SCOPES: McpHttpScope[] = ['read', 'generate', 'organize', 'backup', 'restore']

export function McpHttpSettingsCard() {
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set())
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: getMcpHttpSettings })
  const commit = (settings: NonNullable<typeof query.data>) => queryClient.setQueryData(QUERY_KEY, settings)
  const enabled = useMutation({ mutationFn: updateMcpHttpEnabled, onSuccess: commit })
  const createKey = useMutation({ mutationFn: createMcpHttpApiKey, onSuccess: commit })
  const updateKey = useMutation({ mutationFn: updateMcpHttpApiKey, onSuccess: commit })
  const rotateKey = useMutation({ mutationFn: rotateMcpHttpApiKey, onSuccess: (settings, keyId) => {
    commit(settings)
    setVisibleKeys((current) => new Set(current).add(keyId))
  } })
  const revokeKey = useMutation({ mutationFn: revokeMcpHttpApiKey, onSuccess: commit })
  const busy = enabled.isPending || createKey.isPending || updateKey.isPending || rotateKey.isPending || revokeKey.isPending
  const endpoint = typeof window === 'undefined' ? '/mcp' : `${window.location.origin}/mcp`

  const copy = async (value: string) => {
    try {
      await copyTextToClipboard(value)
      showSnackbar({ message: t({ ko: '복사 완료', en: 'Copied' }), tone: 'info' })
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : 'Copy failed', tone: 'error' })
    }
  }

  return (
    <SettingsSection heading="MCP" actions={query.data?.enabled ? <Badge>활성</Badge> : <Badge variant="outline">비활성</Badge>}>
      {query.isLoading ? <Skeleton className="h-40 w-full rounded-sm" /> : null}
      {query.isError ? <SettingsInsetBlock className="text-sm text-destructive">{query.error instanceof Error ? query.error.message : 'MCP 오류'}</SettingsInsetBlock> : null}
      {query.data ? (
        <div className="space-y-4">
          <SettingsToggleRow>
            <input type="checkbox" checked={query.data.enabled} disabled={busy} onChange={(event) => enabled.mutate(event.target.checked)} />
            HTTP MCP
          </SettingsToggleRow>
          <div className="flex gap-2">
            <Input variant="settings" readOnly value={endpoint} className="font-mono" />
            <Button type="button" size="icon-sm" variant="outline" onClick={() => void copy(endpoint)} aria-label="MCP URL 복사"><Copy /></Button>
            <Button type="button" size="icon-sm" variant="outline" disabled={busy} onClick={() => {
              const name = window.prompt(t({ ko: '키 이름', en: 'Key name' }), '에이전트 키')?.trim()
              if (name) createKey.mutate({ name, scopes: ['read'] })
            }} aria-label="키 추가"><Plus /></Button>
          </div>
          <div className="space-y-3">
            {query.data.keys.map((key) => {
              const visible = visibleKeys.has(key.id)
              return (
                <SettingsInsetBlock key={key.id} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Input variant="settings" readOnly value={key.name} className="max-w-44" />
                    <Input variant="settings" type={visible ? 'text' : 'password'} readOnly value={key.apiKey} className="min-w-0 flex-1 font-mono" />
                    <Button type="button" size="icon-sm" variant="outline" onClick={() => setVisibleKeys((current) => {
                      const next = new Set(current); if (next.has(key.id)) next.delete(key.id); else next.add(key.id); return next
                    })} aria-label="키 보기">{visible ? <EyeOff /> : <Eye />}</Button>
                    <Button type="button" size="icon-sm" variant="outline" onClick={() => void copy(key.apiKey)} aria-label="키 복사"><Copy /></Button>
                    <Button type="button" size="icon-sm" variant="outline" disabled={busy} onClick={() => rotateKey.mutate(key.id)} aria-label="키 교체"><RefreshCw /></Button>
                    <Button type="button" size="icon-sm" variant="outline" disabled={busy} onClick={() => {
                      if (window.confirm(t({ ko: '이 키를 폐기할까?', en: 'Revoke this key?' }))) revokeKey.mutate(key.id)
                    }} aria-label="키 폐기"><Trash2 /></Button>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {SCOPES.map((scope) => (
                      <label key={scope} className="flex items-center gap-1.5 text-xs">
                        <input type="checkbox" checked={key.scopes.includes(scope)} disabled={busy || (key.scopes.length === 1 && key.scopes[0] === scope)} onChange={(event) => {
                          const scopes = event.target.checked ? [...key.scopes, scope] : key.scopes.filter((item) => item !== scope)
                          updateKey.mutate({ keyId: key.id, name: key.name, scopes })
                        }} />
                        {scope}
                      </label>
                    ))}
                  </div>
                </SettingsInsetBlock>
              )
            })}
          </div>
        </div>
      ) : null}
    </SettingsSection>
  )
}
