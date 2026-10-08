import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Check, CircleAlert, ExternalLink, Plus, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import {
  AUDIO_QUERY_KEY,
  addDefaultAudioWorkflow,
  getAudioExportSettings,
  listAudioWorkflows,
  saveAudioExportSettings,
  saveAudioWorkflowBinding,
  type AudioExportOptions,
  type AudioWorkflowCompat,
  type AudioWorkflowRole,
} from '@/lib/api-audio'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'
import {
  AUDIO_SHORTCUT_ACTIONS,
  DEFAULT_AUDIO_SHORTCUTS,
  isValidShortcutKey,
  normalizeShortcutKey,
  saveAudioShortcuts,
  shortcutLabel,
  useAudioShortcuts,
  type AudioShortcutAction,
} from './audio-shortcuts'
import { TextTabs } from './audio-dialogs'

type SettingsTab = 'workflows' | 'export' | 'shortcuts'

export function AudioSettingsDialog({ open, onClose, canManage }: { open: boolean; onClose: () => void; canManage: boolean }) {
  const { t } = useI18n()
  const [tab, setTab] = useState<SettingsTab>(canManage ? 'workflows' : 'shortcuts')
  const tabs: Array<[SettingsTab, string]> = [
    ...(canManage ? [['workflows', t({ ko: '워크플로', en: 'Workflows' })], ['export', t({ ko: '내보내기', en: 'Export' })]] as Array<[SettingsTab, string]> : []),
    ['shortcuts', t({ ko: '단축키', en: 'Shortcuts' })],
  ]
  return (
    <Modal open={open} title={t({ ko: '음향 설정', en: 'Audio settings' })} onClose={onClose} widthClassName="max-w-lg">
      <ModalBody className="space-y-4">
        <TextTabs value={tab} items={tabs} onChange={setTab} />
        {tab === 'workflows' ? <WorkflowTab /> : tab === 'export' ? <ExportTab /> : <ShortcutTab />}
      </ModalBody>
    </Modal>
  )
}

/* ------------------------------------------------------------------------------------------------ workflows */

const ROLES: Array<[AudioWorkflowRole, 'prompt_field_id' | 'seconds_field_id' | 'seed_field_id']> = [['prompt', 'prompt_field_id'], ['seconds', 'seconds_field_id'], ['seed', 'seed_field_id']]

function WorkflowTab() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const workflows = useQuery({ queryKey: [AUDIO_QUERY_KEY, 'workflows'], queryFn: listAudioWorkflows })
  const [workflowId, setWorkflowId] = useState<number | null>(null)
  const [roles, setRoles] = useState<Record<AudioWorkflowRole, string>>({ prompt: '', seconds: '', seed: '' })
  const [isDefault, setIsDefault] = useState(false)
  const [compat, setCompat] = useState<AudioWorkflowCompat | null>(null)
  const [busy, setBusy] = useState(false)

  const list = useMemo(() => workflows.data ?? [], [workflows.data])
  useEffect(() => {
    if (list.length === 0) return
    setWorkflowId((current) => (current !== null && list.some((entry) => entry.id === current) ? current : (list.find((entry) => entry.binding?.is_default) ?? list.find((entry) => entry.binding) ?? list[0]).id))
  }, [list])
  const workflow = list.find((entry) => entry.id === workflowId) ?? null
  useEffect(() => {
    if (!workflow) return
    setRoles({
      prompt: workflow.binding?.prompt_field_id ?? workflow.suggested.prompt ?? '',
      seconds: workflow.binding?.seconds_field_id ?? workflow.suggested.seconds ?? '',
      seed: workflow.binding?.seed_field_id ?? workflow.suggested.seed ?? '',
    })
    setIsDefault(workflow.binding?.is_default ?? !list.some((entry) => entry.binding))
    setCompat(workflow.binding?.compat ?? null)
  }, [workflow, list])

  const roleLabel: Record<AudioWorkflowRole, string> = { prompt: t({ ko: '프롬프트', en: 'Prompt' }), seconds: t({ ko: '길이', en: 'Length' }), seed: 'seed' }
  const complete = Boolean(roles.prompt && roles.seconds && roles.seed) && new Set([roles.prompt, roles.seconds, roles.seed]).size === 3
  const fail = (error: unknown) => showSnackbar({ message: getErrorMessage(error, t({ ko: '실패했어.', en: 'Failed.' })), tone: 'error' })

  const save = async () => {
    if (!workflow || !complete) return
    setBusy(true)
    try {
      const binding = await saveAudioWorkflowBinding(workflow.id, { prompt_field_id: roles.prompt, seconds_field_id: roles.seconds, seed_field_id: roles.seed, is_default: isDefault })
      setCompat(binding.compat)
      await queryClient.invalidateQueries({ queryKey: [AUDIO_QUERY_KEY, 'workflows'] })
    } catch (error) {
      fail(error)
    } finally {
      setBusy(false)
    }
  }
  const addDefault = async () => {
    setBusy(true)
    try {
      const created = await addDefaultAudioWorkflow() as { id?: number; workflow?: { id?: number } } | null
      await queryClient.invalidateQueries({ queryKey: [AUDIO_QUERY_KEY, 'workflows'] })
      const id = created?.workflow?.id ?? created?.id
      if (typeof id === 'number') setWorkflowId(id)
    } catch (error) {
      fail(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Select className="flex-1" aria-label={t({ ko: '워크플로', en: 'Workflow' })} value={workflowId ?? ''} disabled={list.length === 0} onChange={(event) => setWorkflowId(Number(event.target.value))}>
          {list.length === 0 ? <option value="">{t({ ko: '오디오 워크플로 없음', en: 'No audio workflow' })}</option> : null}
          {list.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}{entry.binding ? '' : ` · ${t({ ko: '미연결', en: 'not linked' })}`}</option>)}
        </Select>
        <IconButton variant="secondary" label={t({ ko: '생성 화면에서 편집', en: 'Edit in Generation' })} disabled={!workflow} onClick={() => workflow && navigate(`/generation?tab=comfyui&workflow=${workflow.id}`)}><ExternalLink /></IconButton>
        <IconButton variant="secondary" label={t({ ko: '기본 Stable Audio 3 추가', en: 'Add default Stable Audio 3' })} disabled={busy} onClick={() => void addDefault()}><Plus /></IconButton>
      </div>
      {workflow ? (
        <>
          <div className="space-y-2">
            {ROLES.map(([role]) => (
              <div key={role} className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-3">
                <span className="text-2xs font-semibold tracking-overline text-muted-foreground uppercase">{roleLabel[role]}</span>
                <Select aria-label={roleLabel[role]} value={roles[role]} onChange={(event) => setRoles((current) => ({ ...current, [role]: event.target.value }))}>
                  <option value="">—</option>
                  {workflow.fields.map((field) => <option key={field.id} value={field.id}>{field.label}{field.node_class_type ? ` · ${field.node_class_type}` : ''}</option>)}
                </Select>
              </div>
            ))}
          </div>
          <CompatLine compat={compat} />
          <div className="flex items-center gap-3">
            <label className="flex flex-1 items-center gap-2 text-sm">
              <Switch checked={isDefault} onCheckedChange={setIsDefault} />
              {t({ ko: '기본 워크플로', en: 'Default workflow' })}
            </label>
            <Button size="sm" disabled={busy || !complete} onClick={() => void save()}>{workflow.binding ? t({ ko: '저장 후 검사', en: 'Save and check' }) : t({ ko: '연결', en: 'Link' })}</Button>
          </div>
        </>
      ) : null}
    </div>
  )
}

function CompatLine({ compat }: { compat: AudioWorkflowCompat | null }) {
  const { t } = useI18n()
  if (!compat) return null
  const ok = compat.servers.filter((server) => server.status === 'ok').map((server) => server.server_name)
  const bad = compat.servers.filter((server) => server.status !== 'ok')
  return (
    <div className="space-y-1 text-sm">
      {ok.length > 0 ? (
        <p className="flex items-center gap-1.5 text-success">
          <Check className="size-4 shrink-0" />
          {t({ ko: '{servers} 호환', en: '{servers} compatible' }, { servers: ok.join(', ') })}
          {compat.seconds_max !== null ? ` · ${t({ ko: '최대 길이 {max}초', en: 'max {max} s' }, { max: compat.seconds_max })}` : ''}
        </p>
      ) : null}
      {[...bad.map((server) => `${server.server_name}: ${server.status === 'unreachable' ? t({ ko: '연결 안 됨', en: 'unreachable' }) : server.issues.join(', ')}`), ...compat.issues].map((line) => (
        <p key={line} className="flex items-center gap-1.5 text-destructive"><CircleAlert className="size-4 shrink-0" />{line}</p>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------------------------------------ export */

function ExportTab() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const settings = useQuery({ queryKey: [AUDIO_QUERY_KEY, 'export-settings'], queryFn: getAudioExportSettings })
  const [draft, setDraft] = useState<AudioExportOptions | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (settings.data) setDraft(settings.data) }, [settings.data])
  if (!draft) return null
  const set = <K extends keyof AudioExportOptions>(key: K, value: AudioExportOptions[K]) => setDraft({ ...draft, [key]: value })
  const num = (key: 'quality' | 'target_lufs' | 'peak_db' | 'loudness_range' | 'sample_rate' | 'channels', label: string, step: string) => (
    <Field label={label}><Input className="font-mono" type="number" step={step} value={String(draft[key])} onChange={(event) => set(key, Number(event.target.value))} /></Field>
  )
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings.data)

  const save = async () => {
    setBusy(true)
    try {
      const saved = await saveAudioExportSettings(draft)
      queryClient.setQueryData([AUDIO_QUERY_KEY, 'export-settings'], saved)
      showSnackbar({ message: t({ ko: '저장했어.', en: 'Saved.' }) })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '실패했어.', en: 'Failed.' })), tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label={t({ ko: '형식', en: 'Format' })}>
          <Select value={draft.format} onChange={(event) => set('format', event.target.value as AudioExportOptions['format'])}>
            <option value="wav">WAV</option>
            <option value="ogg">OGG Vorbis</option>
          </Select>
        </Field>
        {draft.format === 'ogg' ? num('quality', t({ ko: 'OGG 품질', en: 'OGG quality' }), '1') : <span />}
        {num('sample_rate', t({ ko: '샘플레이트', en: 'Sample rate' }), '1')}
        {num('channels', t({ ko: '채널', en: 'Channels' }), '1')}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={draft.normalize} onCheckedChange={(checked) => set('normalize', checked)} />
        {t({ ko: '음량 맞추기', en: 'Normalize loudness' })}
      </label>
      {draft.normalize ? (
        <div className="grid grid-cols-3 gap-3">
          {num('target_lufs', 'LUFS', '0.5')}
          {num('peak_db', t({ ko: '피크(dB)', en: 'Peak (dB)' }), '0.1')}
          {num('loudness_range', 'LRA', '0.5')}
        </div>
      ) : null}
      <div className="flex justify-end">
        <Button size="sm" disabled={busy || !dirty} onClick={() => void save()}>{t({ ko: '저장', en: 'Save' })}</Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------------------------------------ shortcuts */

function ShortcutTab() {
  const { t } = useI18n()
  const shortcuts = useAudioShortcuts()
  const [capturing, setCapturing] = useState<AudioShortcutAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const labels: Record<AudioShortcutAction, string> = {
    next: t({ ko: '다음 후보', en: 'Next take' }),
    previous: t({ ko: '이전 후보', en: 'Previous take' }),
    play: t({ ko: '재생 / 정지', en: 'Play / stop' }),
    select: t({ ko: '채택', en: 'Adopt' }),
    reject: t({ ko: '보류', en: 'Reject' }),
    pending: t({ ko: '미검수', en: 'Unreviewed' }),
  }

  const capture = (action: AudioShortcutAction, event: KeyboardEvent) => {
    if (event.key === 'Tab') return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') {
      setCapturing(null)
      return
    }
    const key = normalizeShortcutKey(event.key)
    if (!isValidShortcutKey(key)) {
      setError(t({ ko: '글자, 숫자, 방향키, Space만 쓸 수 있어.', en: 'Use a letter, digit, arrow or Space.' }))
      return
    }
    const clash = AUDIO_SHORTCUT_ACTIONS.find((other) => other !== action && shortcuts[other] === key)
    if (clash) {
      setError(t({ ko: '{key}는 이미 "{action}"에 쓰고 있어.', en: '{key} is already used for "{action}".' }, { key: shortcutLabel(key), action: labels[clash] }))
      return
    }
    setError(null)
    setCapturing(null)
    saveAudioShortcuts({ ...shortcuts, [action]: key })
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-line">
        {AUDIO_SHORTCUT_ACTIONS.map((action) => (
          <li key={action} className="flex items-center gap-3 py-2">
            <span className="flex-1 text-sm">{labels[action]}</span>
            <button
              type="button"
              aria-label={t({ ko: '{action} 키 바꾸기', en: 'Change key for {action}' }, { action: labels[action] })}
              onClick={() => { setError(null); setCapturing(action) }}
              onBlur={() => setCapturing((current) => (current === action ? null : current))}
              onKeyDown={(event) => { if (capturing === action) capture(action, event) }}
              className={cn(
                'min-w-16 cursor-pointer rounded-sm border border-line px-2 py-1 text-center font-mono text-xs transition-colors hover:border-foreground/40',
                capturing === action && 'border-primary text-primary',
              )}
            >
              {capturing === action ? '…' : shortcutLabel(shortcuts[action])}
            </button>
          </li>
        ))}
      </ul>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div className="flex justify-end">
        <IconButton variant="ghost" label={t({ ko: '기본값으로', en: 'Reset to defaults' })} onClick={() => { setError(null); saveAudioShortcuts(DEFAULT_AUDIO_SHORTCUTS) }}><RotateCcw /></IconButton>
      </div>
    </div>
  )
}

