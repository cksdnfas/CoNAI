import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle, Plus, RefreshCw, Server, X } from 'lucide-react'
import { Chip } from '@/components/ui/chip'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { EditorFooter } from '@/components/ui/editor-footer'
import { EditorGroup } from '@/components/ui/editor-group'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody } from '@/components/ui/modal'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { ResourceRow, ResourceRowStatus } from '@/components/ui/resource-row'
import { RowGroup } from '@/components/ui/row-group'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Switch } from '@/components/ui/switch'
import { SwitchLine } from '@/components/ui/switch-line'
import { Textarea } from '@/components/ui/textarea'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import {
  EXTERNAL_MCP_QUERY_KEY,
  createExternalMcpServer,
  deleteExternalMcpServer,
  listExternalMcpServers,
  patchExternalMcpServer,
  refreshExternalMcpServer,
  updateExternalMcpServer,
  type ExternalMcpScope,
  type ExternalMcpServer,
  type ExternalMcpServerInput,
  type ExternalMcpTransport,
} from '@/lib/api-external-mcp'
import { getErrorMessage } from '@/lib/error-message'
import { SettingsEmptyRow, SettingsRowsSkeleton } from './settings-rows'
import type { ExternalMcpDraftSeed } from './use-llm-connections-chat-page'

type TranslateFn = ReturnType<typeof useI18n>['t']

/** A header or environment variable in the editor; `stored`: the server has a value, so an empty field keeps it. */
type SecretDraft = { key: number; name: string; value: string; stored: boolean }

type ServerDraft = {
  id: string
  name: string
  enabled: boolean
  transport: ExternalMcpTransport
  url: string
  command: string
  args: string
  headers: SecretDraft[]
  env: SecretDraft[]
  scope: ExternalMcpScope
  timeoutSeconds: number
}

let secretKey = 0
const secretsOf = (names: string[]): SecretDraft[] => names.map((name) => ({ key: ++secretKey, name, value: '', stored: true }))

function draftOf(server: ExternalMcpServer | null): ServerDraft {
  return server
    ? { id: server.id, name: server.name, enabled: server.enabled, transport: server.transport, url: server.url ?? '', command: server.command ?? '', args: server.args.join('\n'),
      headers: secretsOf(server.headerNames), env: secretsOf(server.envNames), scope: server.scope, timeoutSeconds: server.timeoutSeconds }
    : { id: '', name: '', enabled: true, transport: 'http', url: '', command: '', args: '', headers: [], env: [], scope: 'read', timeoutSeconds: 60 }
}

function inputOf(draft: ServerDraft, server: ExternalMcpServer | null): ExternalMcpServerInput {
  const secrets = (items: SecretDraft[]) => items.filter((item) => item.name.trim()).map((item) => (item.stored && !item.value ? { name: item.name.trim() } : { name: item.name.trim(), value: item.value }))
  return {
    id: draft.id.trim(), name: draft.name.trim(), enabled: draft.enabled, transport: draft.transport,
    url: draft.transport === 'http' ? draft.url.trim() : null,
    command: draft.transport === 'stdio' ? draft.command.trim() : null,
    args: draft.transport === 'stdio' ? draft.args.split('\n').map((arg) => arg.trim()).filter(Boolean) : [],
    headers: draft.transport === 'http' ? secrets(draft.headers) : [],
    env: draft.transport === 'stdio' ? secrets(draft.env) : [],
    scope: draft.scope, timeoutSeconds: draft.timeoutSeconds, disabledTools: server?.disabledTools ?? [],
  }
}

/** A suggested id from the name: lowercase letters and digits, starting with a letter. */
function idFromName(name: string) {
  const id = name.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^[0-9]+/, '').slice(0, 16)
  return id
}

function scopeLabel(scope: ExternalMcpScope, t: TranslateFn) {
  return scope === 'read' ? t({ ko: '읽기', en: 'Read' }) : scope === 'organize' ? t({ ko: '정리', en: 'Organize' }) : t({ ko: '관리자만', en: 'Admins only' })
}

function stateStatus(server: ExternalMcpServer, t: TranslateFn) {
  if (!server.enabled) return <ResourceRowStatus>{t({ ko: '꺼짐', en: 'Off' })}</ResourceRowStatus>
  if (server.status.state === 'connecting') return <ResourceRowStatus>{t({ ko: '연결 중', en: 'Connecting' })}</ResourceRowStatus>
  if (server.status.state === 'error') {
    return <ResourceRowStatus tone="destructive" tip={server.status.error}>{t({ ko: '연결 안 됨', en: 'Not connected' })}</ResourceRowStatus>
  }
  return null
}

/**
 * Outside MCP servers whose tools the chat profiles can use (administrators). `seed`: a connected chat opened the add
 * editor with these non-secret fields; the person types the address or command and secrets, then saves.
 */
export function ExternalMcpSettings({ seed = null, onSeedClose }: { seed?: ExternalMcpDraftSeed | null; onSeedClose?: () => void } = {}) {
  const { t } = useI18n()
  const [editing, setEditing] = useState<{ server: ExternalMcpServer | null } | null>(null)
  const serversQuery = useQuery({
    queryKey: EXTERNAL_MCP_QUERY_KEY,
    queryFn: listExternalMcpServers,
    // A server still connecting is checked again shortly.
    refetchInterval: (query) => (query.state.data?.some((server) => server.enabled && server.status.state === 'connecting') ? 2000 : false),
  })
  const servers = serversQuery.data ?? []
  const current = editing?.server ? servers.find((server) => server.id === editing.server!.id) ?? editing.server : null

  return (
    <>
      <RowGroup
        heading={t({ ko: '외부 MCP', en: 'External MCP' })}
        count={serversQuery.isSuccess ? servers.length : undefined}
        actions={<IconButton size="icon-sm" variant="ghost" label={t({ ko: '외부 MCP 서버 추가', en: 'Add external MCP server' })} onClick={() => setEditing({ server: null })}><Plus className="h-4 w-4" /></IconButton>}
      >
        {serversQuery.isLoading ? <SettingsRowsSkeleton rows={2} /> : serversQuery.isError ? (
          <p className="py-3 text-sm text-destructive">{getErrorMessage(serversQuery.error, t({ ko: '외부 MCP 서버를 불러오지 못했어.', en: 'Could not load external MCP servers.' }))}</p>
        ) : servers.length === 0 ? (
          <SettingsEmptyRow>{t({ ko: '연결한 외부 MCP 서버가 아직 없어', en: 'No external MCP servers yet' })}</SettingsEmptyRow>
        ) : servers.map((server) => (
          <ResourceRow
            key={server.id}
            leading={<Server />}
            name={server.name}
            extra={<>
              <Tip content={server.transport === 'http' ? server.url : [server.command, ...server.args].join(' ')}><span><Chip size="sm" tone="muted">{server.transport === 'http' ? 'HTTP' : 'stdio'}</Chip></span></Tip>
              <Chip size="sm" tone="muted">{scopeLabel(server.scope, t)}</Chip>
              {stateStatus(server, t)}
            </>}
            aside={server.enabled && server.status.state === 'ready' ? t({ ko: '도구 {count}개', en: '{count} tools' }, { count: server.status.tools.filter((tool) => tool.enabled).length }) : undefined}
            onOpen={() => setEditing({ server })}
          />
        ))}
      </RowGroup>
      <ExternalMcpEditorModal open={editing !== null || seed !== null} server={editing ? current : null} seed={editing ? null : seed}
        onClose={() => { setEditing(null); onSeedClose?.() }} />
    </>
  )
}

function SecretRows({ items, placeholder, onChange }: { items: SecretDraft[]; placeholder: string; onChange: (items: SecretDraft[]) => void }) {
  const { t } = useI18n()
  const patch = (key: number, change: Partial<SecretDraft>) => onChange(items.map((item) => (item.key === key ? { ...item, ...change } : item)))
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.key} className="flex items-center gap-2">
          <Input variant="settings" className="w-2/5" value={item.name} placeholder={placeholder} aria-label={t({ ko: '이름', en: 'Name' })}
            onChange={(event) => patch(item.key, { name: event.target.value, stored: false })} />
          <Input variant="settings" type="password" autoComplete="off" className="flex-1" value={item.value} aria-label={t({ ko: '값', en: 'Value' })}
            placeholder={item.stored ? t({ ko: '저장됨', en: 'Saved' }) : t({ ko: '값', en: 'Value' })} onChange={(event) => patch(item.key, { value: event.target.value })} />
          <IconButton size="icon-sm" variant="ghost" label={t({ ko: '빼기', en: 'Remove' })} onClick={() => onChange(items.filter((other) => other.key !== item.key))}><X className="h-4 w-4" /></IconButton>
        </div>
      ))}
      <IconButton size="icon-sm" variant="ghost" label={t({ ko: '추가', en: 'Add' })} onClick={() => onChange([...items, { key: ++secretKey, name: '', value: '', stored: false }])}><Plus className="h-4 w-4" /></IconButton>
    </div>
  )
}

function ExternalMcpEditorModal({ open, server, seed = null, onClose }: { open: boolean; server: ExternalMcpServer | null; seed?: ExternalMcpDraftSeed | null; onClose: () => void }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const saved = useMemo(() => draftOf(server), [server?.id, open]) // eslint-disable-line react-hooks/exhaustive-deps
  const [draft, setDraft] = useState<ServerDraft>(saved)
  const [draftFor, setDraftFor] = useState<string | null | undefined>(undefined)
  const openedFor = open ? server?.id ?? (seed ? `seed:${JSON.stringify(seed)}` : null) : undefined
  if (draftFor !== openedFor) {
    setDraftFor(openedFor)
    setDraft(seed && !server ? { ...saved, ...seed } : saved)
  }
  const change = (patch: Partial<ServerDraft>) => setDraft((value) => ({ ...value, ...patch }))
  const refreshList = () => queryClient.invalidateQueries({ queryKey: EXTERNAL_MCP_QUERY_KEY })
  const fail = (error: unknown) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' })

  const saveMutation = useMutation({
    mutationFn: () => (server ? updateExternalMcpServer(server.id, inputOf(draft, server)) : createExternalMcpServer(inputOf(draft, null))),
    onSuccess: async () => { await refreshList(); onClose() },
    onError: fail,
  })
  const deleteMutation = useMutation({
    mutationFn: () => deleteExternalMcpServer(server!.id),
    onSuccess: async () => { await refreshList(); onClose() },
    onError: fail,
  })
  const refreshMutation = useMutation({
    mutationFn: () => refreshExternalMcpServer(server!.id),
    onSuccess: async (result) => {
      await refreshList()
      if (result.status.state === 'error') showSnackbar({ message: result.status.error ?? t({ ko: '연결하지 못했어.', en: 'Could not connect.' }), tone: 'error' })
    },
    onError: fail,
  })
  const toolMutation = useMutation({
    mutationFn: (tool: { remoteName: string; enabled: boolean }) => patchExternalMcpServer(server!.id, { tool }),
    onSuccess: refreshList,
    onError: fail,
  })

  const dirty = open && JSON.stringify(draft) !== JSON.stringify(saved)
  const ready = draft.name.trim() && /^[a-z][a-z0-9]{0,15}$/.test(draft.id.trim()) && (draft.transport === 'http' ? draft.url.trim() : draft.command.trim())
  const canSave = Boolean(ready) && (dirty || !server) && !saveMutation.isPending
  const save = () => saveMutation.mutate()
  const tools = server?.status.tools ?? []

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={server ? server.name : t({ ko: '외부 MCP 서버 추가', en: 'Add external MCP server' })}
      size="lg"
      height="tall"
      dirty={dirty}
      onSave={canSave ? save : undefined}
    >
      <ModalBody>
        <div className="space-y-4">
          <SwitchLine label={t({ ko: '이 서버 사용', en: 'Use this server' })} checked={draft.enabled} onCheckedChange={(enabled) => change({ enabled })} />
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t({ ko: '이름', en: 'Name' })}>
              <Input variant="settings" value={draft.name} maxLength={60} onChange={(event) => change({ name: event.target.value, ...(!server && (!draft.id || draft.id === idFromName(draft.name)) ? { id: idFromName(event.target.value) } : {}) })} />
            </Field>
            <Field label="ID" info={t({ ko: '도구 이름 앞에 붙어 (x_<ID>_<도구>).', en: 'Prefixes the tool names (x_<id>_<tool>).' })}>
              <Input variant="settings" value={draft.id} maxLength={16} disabled={Boolean(server)} onChange={(event) => change({ id: event.target.value.toLowerCase() })} />
            </Field>
            <Field label={t({ ko: '연결 방식', en: 'Transport' })}>
              <Select variant="settings" value={draft.transport} onChange={(event) => change({ transport: event.target.value as ExternalMcpTransport })}>
                <option value="http">HTTP</option>
                <option value="stdio">{t({ ko: '명령 실행 (stdio)', en: 'Command (stdio)' })}</option>
              </Select>
            </Field>
            <Field label={t({ ko: '도구 범위', en: 'Tool scope' })} info={t({ ko: '프로필 도구 범위에 이 범위가 있어야 써. 관리자만은 관리자 계정에서만 써.', en: 'Profiles need this scope to use them; admins only means administrator accounts only.' })}>
              <Select variant="settings" value={draft.scope} onChange={(event) => change({ scope: event.target.value as ExternalMcpScope })}>
                {(['read', 'organize', 'configure'] as const).map((scope) => <option key={scope} value={scope}>{scopeLabel(scope, t)}</option>)}
              </Select>
            </Field>
          </div>
          {draft.transport === 'http' ? (
            <>
              <Field label={t({ ko: '주소', en: 'URL' })}>
                <Input variant="settings" value={draft.url} placeholder="https://example.com/mcp" onChange={(event) => change({ url: event.target.value })} />
              </Field>
              <EditorGroup label={t({ ko: '헤더', en: 'Headers' })}>
                <SecretRows items={draft.headers} placeholder="Authorization" onChange={(headers) => change({ headers })} />
              </EditorGroup>
            </>
          ) : (
            <>
              <Field label={t({ ko: '명령', en: 'Command' })}>
                <Input variant="settings" value={draft.command} placeholder="npx" onChange={(event) => change({ command: event.target.value })} />
              </Field>
              <Field label={t({ ko: '인자 (한 줄에 하나)', en: 'Arguments (one per line)' })}>
                <Textarea variant="settings" rows={3} value={draft.args} onChange={(event) => change({ args: event.target.value })} />
              </Field>
              <EditorGroup label={t({ ko: '환경 변수', en: 'Environment' })}>
                <SecretRows items={draft.env} placeholder="API_KEY" onChange={(env) => change({ env })} />
              </EditorGroup>
            </>
          )}
          <Field label={t({ ko: '호출 제한 시간 (초)', en: 'Call timeout (seconds)' })}>
            <NumberStepperInput variant="settings" className="w-28" min={5} max={600} precision={0} value={draft.timeoutSeconds}
              onValueCommit={(value) => change({ timeoutSeconds: Number(value) })} />
          </Field>
          {server ? (
            <EditorGroup
              label={t({ ko: '도구', en: 'Tools' })}
              actions={<IconButton size="icon-sm" variant="ghost" label={t({ ko: '다시 연결', en: 'Reconnect' })} disabled={refreshMutation.isPending || !server.enabled} onClick={() => refreshMutation.mutate()}>
                {refreshMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </IconButton>}
            >
              {server.status.state === 'error' ? <p className="text-sm text-destructive">{server.status.error}</p> : null}
              {tools.length === 0 ? null : (
                <ul className="divide-y divide-line">
                  {tools.map((tool) => (
                    <li key={tool.remoteName} className="flex items-center gap-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-xs text-foreground">{tool.remoteName}</p>
                        {tool.description ? <p className="line-clamp-2 text-xs text-muted-foreground">{tool.description}</p> : null}
                      </div>
                      <Switch checked={tool.enabled} disabled={toolMutation.isPending} aria-label={tool.remoteName} onCheckedChange={(enabled) => toolMutation.mutate({ remoteName: tool.remoteName, enabled })} />
                    </li>
                  ))}
                </ul>
              )}
            </EditorGroup>
          ) : null}
        </div>
      </ModalBody>
      <EditorFooter
        onDelete={server ? () => void (async () => {
          const confirmed = await confirm({
            title: t({ ko: '외부 MCP 서버 삭제', en: 'Delete external MCP server' }),
            description: t({ ko: "'{name}' 서버를 삭제할까? 프로필에서 고른 이 서버의 도구도 사라져.", en: "Delete '{name}'? Its tools leave the profiles too." }, { name: server.name }),
            confirmLabel: t({ ko: '삭제', en: 'Delete' }),
            tone: 'destructive',
          })
          if (confirmed) deleteMutation.mutate()
        })() : undefined}
        deleting={deleteMutation.isPending}
        onSave={save}
        canSave={canSave}
        saving={saveMutation.isPending}
      />
    </Modal>
  )
}
