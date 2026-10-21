import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Eye, EyeOff, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { RowGroup } from '@/components/ui/row-group'
import { SettingRow } from '@/components/ui/setting-row'
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
import { listAuthPermissionGroups } from '@/lib/api-auth'
import { IconButton } from '@/components/ui/icon-button'
import { SettingsSwitchRow } from '@/components/ui/settings-switch-row'
import { InstantApplyHint } from './settings-section-status'
import { SettingsEmptyRow, SettingsRowsSkeleton } from './settings-rows'

const QUERY_KEY = ['mcp-http-settings'] as const

export function McpHttpSettingsCard() {
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const confirm = useConfirm()
  // Draft name and permission group for a new key; null while the dialog is closed.
  const [newKeyName, setNewKeyName] = useState<string | null>(null)
  const [newKeyGroup, setNewKeyGroup] = useState('')
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set())
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: getMcpHttpSettings })
  // A key holds the permissions of one permission group, like an account does.
  const groupsQuery = useQuery({ queryKey: ['auth-permission-groups', 'all'], queryFn: listAuthPermissionGroups, staleTime: 60_000, retry: false })
  const groups = groupsQuery.data ?? []
  const groupLabel = t({ ko: '권한 그룹', en: 'Permission group' })
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

  const endpointLabel = t({ ko: 'MCP 주소', en: 'MCP URL' })

  return (
    <div className="space-y-8">
      <RowGroup heading="MCP" actions={<InstantApplyHint />}>
        {query.isLoading ? <SettingsRowsSkeleton rows={2} /> : null}
        {query.isError ? <p className="py-3 text-sm text-destructive">{query.error instanceof Error ? query.error.message : t({ ko: 'MCP 설정을 불러오지 못했어.', en: 'Could not load MCP settings.' })}</p> : null}
        {query.data ? (
          <>
            <SettingsSwitchRow
              checked={query.data.enabled}
              disabled={busy}
              onCheckedChange={(checked) => enabled.mutate(checked)}
              label={t({ ko: 'HTTP MCP 사용', en: 'Enable HTTP MCP' })}
            />
            <SettingRow label={endpointLabel} controlWidth="wide">
              <Input variant="settings" mono readOnly value={endpoint} className="min-w-0 flex-1" aria-label={endpointLabel} />
              <IconButton size="icon-sm" variant="ghost" onClick={() => void copy(endpoint)} label={t({ ko: 'MCP 주소 복사', en: 'Copy MCP URL' })}><Copy /></IconButton>
            </SettingRow>
          </>
        ) : null}
      </RowGroup>

      {query.data ? (
        <RowGroup
          heading={t({ ko: 'API 키', en: 'API keys' })}
          actions={(
            <IconButton size="icon-sm" variant="ghost" disabled={busy} onClick={() => {
              setNewKeyGroup('')
              setNewKeyName(t({ ko: '에이전트 키', en: 'Agent key' }))
            }} label={t({ ko: '키 추가', en: 'Add key' })}><Plus /></IconButton>
          )}
        >
          {query.data.keys.length === 0 ? <SettingsEmptyRow>{t({ ko: '발급한 키가 없어', en: 'No keys yet' })}</SettingsEmptyRow> : null}
          {query.data.keys.map((key) => {
            const visible = visibleKeys.has(key.id)
            return (
              <div key={key.id} className="space-y-2 border-b border-line py-3 last:border-b-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 truncate text-sm font-medium text-foreground sm:w-40">{key.name}</span>
                  <Input variant="settings" mono type={visible ? 'text' : 'password'} readOnly value={key.apiKey} className="min-w-0 flex-1 basis-48" aria-label={t({ ko: 'API 키', en: 'API key' })} />
                  <div className="flex shrink-0 items-center gap-0.5">
                    <IconButton size="icon-sm" variant="ghost" onClick={() => setVisibleKeys((current) => {
                      const next = new Set(current)
                      if (next.has(key.id)) next.delete(key.id)
                      else next.add(key.id)
                      return next
                    })} label={visible ? t({ ko: '키 숨기기', en: 'Hide key' }) : t({ ko: '키 보기', en: 'Show key' })}>{visible ? <EyeOff /> : <Eye />}</IconButton>
                    <IconButton size="icon-sm" variant="ghost" onClick={() => void copy(key.apiKey)} label={t({ ko: '키 복사', en: 'Copy key' })}><Copy /></IconButton>
                    <IconButton size="icon-sm" variant="ghost" disabled={busy} onClick={async () => {
                      const confirmed = await confirm({
                        title: t({ ko: '키 새로 발급', en: 'Regenerate key' }),
                        description: t({ ko: '지금 키를 쓰는 에이전트는 새 키로 바꿔야 다시 연결돼. 새로 발급할까?', en: 'Agents using the current key must switch to the new one to reconnect. Regenerate?' }),
                        confirmLabel: t({ ko: '새로 발급', en: 'Regenerate' }),
                        tone: 'destructive',
                      })
                      if (confirmed) rotateKey.mutate(key.id)
                    }} label={t({ ko: '키 새로 발급', en: 'Regenerate key' })}><RefreshCw /></IconButton>
                    <IconButton size="icon-sm" variant="ghost" disabled={busy} onClick={async () => {
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
                <div className="flex sm:pl-42">
                  <Select
                    variant="settings"
                    className="w-56"
                    aria-label={groupLabel}
                    value={key.groupKey ?? ''}
                    disabled={busy || groups.length === 0}
                    onChange={(event) => { if (event.target.value) updateKey.mutate({ keyId: key.id, name: key.name, groupKey: event.target.value }) }}
                  >
                    {key.groupKey === null ? <option value="" disabled>{t({ ko: '그룹 없음 (권한 없음)', en: 'No group (no access)' })}</option> : null}
                    {groups.map((group) => <option key={group.groupKey} value={group.groupKey}>{group.name}</option>)}
                  </Select>
                </div>
              </div>
            )
          })}
        </RowGroup>
      ) : null}

      <Modal open={newKeyName !== null} onClose={() => setNewKeyName(null)} title={t({ ko: 'MCP 키 추가', en: 'Add MCP key' })} widthClassName="max-w-md">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const name = newKeyName?.trim()
            if (!name || !newKeyGroup) {
              return
            }

            createKey.mutate({ name, groupKey: newKeyGroup })
            setNewKeyName(null)
          }}
        >
          <ModalBody>
            <label className="block space-y-2">
              <span className="text-sm text-muted-foreground">{t({ ko: '키 이름', en: 'Key name' })}</span>
              <Input variant="settings" autoFocus value={newKeyName ?? ''} onChange={(event) => setNewKeyName(event.target.value)} />
            </label>
            <label className="block space-y-2">
              <span className="text-sm text-muted-foreground">{groupLabel}</span>
              <Select variant="settings" className="w-full" value={newKeyGroup} onChange={(event) => setNewKeyGroup(event.target.value)}>
                <option value="" disabled>{t({ ko: '그룹 선택', en: 'Pick a group' })}</option>
                {groups.map((group) => <option key={group.groupKey} value={group.groupKey}>{group.name}</option>)}
              </Select>
            </label>
            <ModalFooter>
              <Button type="button" variant="secondary" onClick={() => setNewKeyName(null)}>{t({ ko: '취소', en: 'Cancel' })}</Button>
              <Button type="submit" disabled={!newKeyName?.trim() || !newKeyGroup || busy}>{t({ ko: '추가', en: 'Add' })}</Button>
            </ModalFooter>
          </ModalBody>
        </form>
      </Modal>
    </div>
  )
}
