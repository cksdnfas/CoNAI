import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { McpHttpScope } from '@conai/shared'
import { Copy, Eye, EyeOff, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { Skeleton } from '@/components/ui/skeleton'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { copyTextToClipboard } from '@/lib/clipboard'
import {
  createMcpHttpApiKey,
  getMcpHttpSettings,
  revokeMcpHttpApiKey,
  rotateMcpHttpApiKey,
  updateMcpHttpApiKey,
  updateMcpHttpEnabled,
} from '@/lib/api-settings-mcp'
import { Inset } from '@/components/ui/inset'
import { Checkbox } from '@/components/ui/checkbox'
import { IconButton } from '@/components/ui/icon-button'
import { SettingsSwitchRow } from './settings-switch-row'
import { Section } from '@/components/ui/section'
import { InstantApplyHint } from './settings-section-status'

const QUERY_KEY = ['mcp-http-settings'] as const
const SCOPES: McpHttpScope[] = ['read', 'generate', 'organize', 'backup', 'restore']

type TranslateFn = ReturnType<typeof useI18n>['t']

/** User-facing name and one-line explanation for each MCP key permission. */
function getScopeCopy(scope: McpHttpScope, t: TranslateFn): { label: string; description: string } {
  switch (scope) {
    case 'read':
      return { label: t({ ko: '조회', en: 'Read' }), description: t({ ko: '이미지·프롬프트·워크플로·생성 기록을 검색하고 읽어.', en: 'Search and read images, prompts, workflows and generation history.' }) }
    case 'generate':
      return { label: t({ ko: '생성', en: 'Generate' }), description: t({ ko: 'NAI·ComfyUI 생성과 워크플로 실행을 시작하거나 취소해.', en: 'Start or cancel NAI/ComfyUI generations and workflow runs.' }) }
    case 'organize':
      return { label: t({ ko: '정리', en: 'Organize' }), description: t({ ko: '그룹을 만들고 이미지·프롬프트를 그룹에 넣거나 옮겨.', en: 'Create groups and add or move images and prompts into them.' }) }
    case 'backup':
      return { label: t({ ko: '백업', en: 'Back up' }), description: t({ ko: '프롬프트 데이터와 워크플로 정의를 내보내.', en: 'Export prompt data and workflow definitions.' }) }
    case 'restore':
      return { label: t({ ko: '복원', en: 'Restore' }), description: t({ ko: '백업을 가져와 기존 데이터를 덮어쓸 수 있어.', en: 'Import backups, which can overwrite existing data.' }) }
  }
}

export function McpHttpSettingsCard() {
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const confirm = useConfirm()
  // Draft name for a new key; null while the name dialog is closed.
  const [newKeyName, setNewKeyName] = useState<string | null>(null)
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
      showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '복사하지 못했어.', en: 'Copy failed.' }), tone: 'error' })
    }
  }

  return (
    <Section
      variant="settings"
      heading="MCP"
      description={t({ ko: '외부 AI 에이전트가 API 키로 이 서버의 기능을 쓸 수 있게 해. 키마다 허용할 권한을 고를 수 있어.', en: 'Let external AI agents use this server with an API key. Choose what each key is allowed to do.' })}
      actions={(
        <>
          <InstantApplyHint />
          {query.data?.enabled ? <Badge>{t({ ko: '활성', en: 'On' })}</Badge> : <Badge variant="outline">{t({ ko: '비활성', en: 'Off' })}</Badge>}
        </>
      )}
    >
      {query.isLoading ? <Skeleton className="h-40 w-full rounded-sm" /> : null}
      {query.isError ? <Inset className="text-sm text-destructive">{query.error instanceof Error ? query.error.message : t({ ko: 'MCP 설정을 불러오지 못했어.', en: 'Could not load MCP settings.' })}</Inset> : null}
      {query.data ? (
        <div className="space-y-4">
          <SettingsSwitchRow
            checked={query.data.enabled}
            disabled={busy}
            onCheckedChange={(checked) => enabled.mutate(checked)}
            label={t({ ko: 'HTTP MCP 사용', en: 'Enable HTTP MCP' })}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Input variant="settings" readOnly value={endpoint} className="min-w-0 flex-1 basis-56 font-mono" aria-label={t({ ko: 'MCP 주소', en: 'MCP URL' })} />
            <IconButton size="icon-sm" variant="outline" onClick={() => void copy(endpoint)} label={t({ ko: 'MCP 주소 복사', en: 'Copy MCP URL' })}><Copy /></IconButton>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setNewKeyName(t({ ko: '에이전트 키', en: 'Agent key' }))}>
              <Plus />
              {t({ ko: '키 추가', en: 'Add key' })}
            </Button>
          </div>
          <div className="space-y-3">
            {query.data.keys.map((key) => {
              const visible = visibleKeys.has(key.id)
              return (
                <Inset key={key.id} className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input variant="settings" readOnly value={key.name} className="w-full sm:w-44" aria-label={t({ ko: '키 이름', en: 'Key name' })} />
                    <Input variant="settings" type={visible ? 'text' : 'password'} readOnly value={key.apiKey} className="min-w-0 flex-1 basis-48 font-mono" aria-label={t({ ko: 'API 키', en: 'API key' })} />
                    <div className="flex shrink-0 items-center gap-1">
                      <IconButton size="icon-sm" variant="outline" onClick={() => setVisibleKeys((current) => {
                        const next = new Set(current)
                        if (next.has(key.id)) next.delete(key.id)
                        else next.add(key.id)
                        return next
                      })} label={visible ? t({ ko: '키 숨기기', en: 'Hide key' }) : t({ ko: '키 보기', en: 'Show key' })}>{visible ? <EyeOff /> : <Eye />}</IconButton>
                      <IconButton size="icon-sm" variant="outline" onClick={() => void copy(key.apiKey)} label={t({ ko: '키 복사', en: 'Copy key' })}><Copy /></IconButton>
                      <IconButton size="icon-sm" variant="outline" disabled={busy} onClick={async () => {
                        const confirmed = await confirm({
                          title: t({ ko: '키 새로 발급', en: 'Regenerate key' }),
                          description: t({ ko: '지금 키를 쓰는 에이전트는 새 키로 바꿔야 다시 연결돼. 새로 발급할까?', en: 'Agents using the current key must switch to the new one to reconnect. Regenerate?' }),
                          confirmLabel: t({ ko: '새로 발급', en: 'Regenerate' }),
                          tone: 'destructive',
                        })
                        if (confirmed) rotateKey.mutate(key.id)
                      }} label={t({ ko: '키 새로 발급', en: 'Regenerate key' })}><RefreshCw /></IconButton>
                      <IconButton size="icon-sm" variant="outline" disabled={busy} onClick={async () => {
                        const confirmed = await confirm({
                          title: t({ ko: '키 폐기', en: 'Revoke key' }),
                          description: t({ ko: '이 키를 폐기할까?', en: 'Revoke this key?' }),
                          confirmLabel: t({ ko: '폐기', en: 'Revoke' }),
                          tone: 'destructive',
                        })
                        if (confirmed) revokeKey.mutate(key.id)
                      }} label={t({ ko: '키 폐기', en: 'Revoke key' })}><Trash2 /></IconButton>
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {SCOPES.map((scope) => {
                      const scopeCopy = getScopeCopy(scope, t)
                      return (
                      <label key={scope} className="flex cursor-pointer items-start gap-2 text-xs has-[:disabled]:cursor-not-allowed">
                        <Checkbox checked={key.scopes.includes(scope)} disabled={busy || (key.scopes.length === 1 && key.scopes[0] === scope)} onCheckedChange={(checked) => {
                          const scopes = checked === true ? [...key.scopes, scope] : key.scopes.filter((item) => item !== scope)
                          updateKey.mutate({ keyId: key.id, name: key.name, scopes })
                        }} className="mt-0.5" />
                        <span className="min-w-0">
                          <span className="font-medium text-foreground">{scopeCopy.label}</span>
                          <span className="block text-muted-foreground">{scopeCopy.description}</span>
                        </span>
                      </label>
                      )
                    })}
                  </div>
                </Inset>
              )
            })}
          </div>
        </div>
      ) : null}

      <Modal open={newKeyName !== null} onClose={() => setNewKeyName(null)} title={t({ ko: 'MCP 키 추가', en: 'Add MCP key' })} widthClassName="max-w-md">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const name = newKeyName?.trim()
            if (!name) {
              return
            }

            createKey.mutate({ name, scopes: ['read'] })
            setNewKeyName(null)
          }}
        >
          <ModalBody>
            <label className="block space-y-2">
              <span className="text-sm text-muted-foreground">{t({ ko: '키 이름', en: 'Key name' })}</span>
              <Input variant="settings" autoFocus value={newKeyName ?? ''} onChange={(event) => setNewKeyName(event.target.value)} />
            </label>
            <ModalFooter>
              <Button type="button" variant="secondary" onClick={() => setNewKeyName(null)}>{t({ ko: '취소', en: 'Cancel' })}</Button>
              <Button type="submit" disabled={!newKeyName?.trim() || busy}>{t({ ko: '추가', en: 'Add' })}</Button>
            </ModalFooter>
          </ModalBody>
        </form>
      </Modal>
    </Section>
  )
}
