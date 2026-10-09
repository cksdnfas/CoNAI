import { useEffect, useMemo, useState, type SyntheticEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquare, Pause, Play, Plus, Rocket, SquarePen, Trash2 } from 'lucide-react'
import { CHAT_ROUTINE_LIMITS } from '@conai/shared'
import { Badge } from '@/components/ui/badge'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { EditorFooter } from '@/components/ui/editor-footer'
import { EmptyState } from '@/components/ui/empty-state'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Select } from '@/components/ui/select'
import { SettingsSwitchRow } from '@/components/ui/settings-switch-row'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useI18n, type TranslationInput } from '@/i18n'
import {
  AUTOMATION_SWITCH_QUERY_KEY, CHAT_ROUTINES_QUERY_KEY, createChatRoutine, deleteChatRoutine, getAutomationSwitch, listChatRoutines,
  runChatRoutine, setAutomationSwitch, setChatRoutineActive, updateChatRoutine,
  type ChatRoutineInput, type ChatRoutineScheduleType, type ChatRoutineTarget, type ChatRoutineView,
} from '@/lib/api-chat-routines'
import { CHAT_PROFILES_QUERY_KEY, listChatProfiles, listCodexChatThreads } from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'
import { ChatProfileAvatar } from './chat-profile-avatar'
import { CODEX_CHAT_THREADS_QUERY_KEY, useCodexChat } from './codex-chat-context'

/**
 * Chat routines: wake a chat on a schedule (Settings › 채팅 › 루틴, and 채팅 메뉴 › 루틴 for the open room).
 * Administrators make them; each runs as the account that saved it.
 */

/** Text tabs in the header row of a field's own frame (the field switches in place). */
const FIELD_TAB_LIST_CLASS = 'flex h-auto w-full justify-start gap-4 rounded-none border-b border-line bg-transparent px-3 pt-2 pb-0'
const FIELD_TAB_TRIGGER_CLASS = 'relative flex-none rounded-none px-0 pb-1.5 pt-0 text-xs font-semibold text-muted-foreground hover:bg-transparent data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-primary after:opacity-0 data-[state=active]:after:opacity-100'

type Translate = (input: TranslationInput, values?: Record<string, string | number>) => string

/** Routines change on their own (runs finish in the background): the list refreshes while it is on screen. */
export function useChatRoutines(enabled = true) {
  return useQuery({ queryKey: CHAT_ROUTINES_QUERY_KEY, queryFn: listChatRoutines, enabled, refetchInterval: 10_000, staleTime: 5_000 })
}

/** Rooms that have a routine (the chat list marks them); empty for accounts that cannot manage routines. */
export function useRoutineThreadIds() {
  const isAdmin = useAuthStatusQuery().data?.isAdmin === true
  const query = useQuery({ queryKey: CHAT_ROUTINES_QUERY_KEY, queryFn: listChatRoutines, enabled: isAdmin, staleTime: 30_000 })
  return useMemo(() => new Set((query.data ?? []).filter((routine) => routine.status !== 'completed' && routine.threadId !== null).map((routine) => routine.threadId as number)), [query.data])
}

function statusBadge(routine: ChatRoutineView, t: Translate) {
  if (routine.status === 'active') return <Badge variant="success">{t({ ko: '활성', en: 'Active' })}</Badge>
  if (routine.status === 'error_stopped') return <Badge variant="destructive">{t({ ko: '오류로 중지', en: 'Stopped on errors' })}</Badge>
  if (routine.status === 'completed') return <Badge variant="secondary">{t({ ko: '완료', en: 'Done' })}</Badge>
  return <Badge variant="secondary">{t({ ko: '일시정지', en: 'Paused' })}</Badge>
}

function scheduleLabel(routine: ChatRoutineView, t: Translate, formatDateTime: (value: string) => string) {
  if (routine.scheduleType === 'once') return t({ ko: '1회 · {time}', en: 'Once · {time}' }, { time: routine.runAt ? formatDateTime(routine.runAt) : '-' })
  if (routine.scheduleType === 'interval') return t({ ko: '{count}분마다', en: 'Every {count} min' }, { count: routine.intervalMinutes ?? 0 })
  return t({ ko: '매일 {time}', en: 'Daily {time}' }, { time: routine.dailyTime ?? '' })
}

/** `roomProfileName`: an untitled room goes by its character, as the chat list does. */
function targetLabel(routine: ChatRoutineView, t: Translate, roomProfileName?: string) {
  if (routine.target === 'dedicated') return [routine.profileName ?? t({ ko: '없는 캐릭터', en: 'Missing character' }), t({ ko: '전용 방', en: 'Own room' })]
  const room = routine.roomTitle?.trim() || roomProfileName || t({ ko: '채팅 {id}', en: 'Chat {id}' }, { id: routine.threadId ?? '-' })
  return routine.roomKind === 'group'
    ? [room, t({ ko: '그룹방', en: 'Group' }), ...(routine.chainLimit !== null ? [t({ ko: '이어 부르기 {count}', en: 'Chain {count}' }, { count: routine.chainLimit })] : [])]
    : [room, t({ ko: '고른 방', en: 'Picked room' })]
}

function lastResultLabel(routine: ChatRoutineView, t: Translate) {
  if (routine.running) return <span className="text-primary">{t({ ko: '실행 중', en: 'Running' })}</span>
  if (routine.lastResult === 'ok') return <span className="text-success">{t({ ko: '최근 성공', en: 'Last ok' })}</span>
  if (routine.lastResult === 'skipped') return <span>{t({ ko: '최근 건너뜀', en: 'Last skipped' })}</span>
  if (routine.lastResult === 'failed') return <span className="text-destructive">{t({ ko: '최근 실패', en: 'Last failed' })}</span>
  return null
}

/** The rows of a routine list, with their actions. `onEdit` opens the editor. */
export function ChatRoutineRows({ routines, onEdit }: { routines: ChatRoutineView[]; onEdit: (routine: ChatRoutineView) => void }) {
  const { t, formatDateTime } = useI18n()
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const confirm = useConfirm()
  const chat = useCodexChat()
  const profilesQuery = useQuery({ queryKey: CHAT_PROFILES_QUERY_KEY, queryFn: listChatProfiles, staleTime: 30_000 })
  const profilesById = useMemo(() => new Map((profilesQuery.data ?? []).map((profile) => [profile.id, profile])), [profilesQuery.data])
  const refresh = () => queryClient.invalidateQueries({ queryKey: CHAT_ROUTINES_QUERY_KEY })
  const onError = (error: unknown) => showSnackbar({ message: getErrorMessage(error, t({ ko: '처리하지 못했어.', en: 'Could not do that.' })), tone: 'error' })
  const action = useMutation({
    mutationFn: async ({ kind, routine }: { kind: 'pause' | 'resume' | 'run' | 'delete'; routine: ChatRoutineView }) => {
      if (kind === 'run') return runChatRoutine(routine.id)
      if (kind === 'delete') return deleteChatRoutine(routine.id)
      return setChatRoutineActive(routine.id, kind === 'resume')
    },
    onSuccess: (_data, { kind }) => {
      if (kind === 'run') showSnackbar({ message: t({ ko: '방을 깨웠어. 답이 끝나면 결과가 남아.', en: 'Woke the room. The outcome shows when it has answered.' }) })
      void refresh()
    },
    onError,
  })
  const remove = async (routine: ChatRoutineView) => {
    const confirmed = await confirm({
      title: t({ ko: '루틴 삭제', en: 'Delete routine' }),
      description: t({ ko: '「{name}」을 지울까? 이미 보낸 메시지와 전용 방은 남아.', en: 'Delete "{name}"? Messages already sent and its room stay.' }, { name: routine.name }),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (confirmed) action.mutate({ kind: 'delete', routine })
  }
  const openRoom = (threadId: number) => {
    chat?.selectThread(threadId)
    chat?.openPanel()
  }

  return (
    <div>
      {routines.map((routine) => {
        const avatarProfileId = routine.target === 'dedicated' ? routine.profileId : routine.roomProfileId
        const profile = avatarProfileId === null ? undefined : profilesById.get(avatarProfileId)
        const reason = routine.status !== 'active' ? routine.stopReason : routine.lastResult === 'failed' ? routine.lastError : null
        const busy = action.isPending && action.variables?.routine.id === routine.id
        return (
          <div key={routine.id} className="border-b border-line py-2.5 last:border-b-0">
            <div className="flex items-start gap-3">
              {profile
                ? <ChatProfileAvatar name={profile.name} profile={profile} engine={profile.engine} size="md" />
                : <span className="size-8 shrink-0 rounded-full bg-surface-highest" aria-hidden="true" />}
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="truncate text-sm font-medium text-foreground">{routine.name}</div>
                  {statusBadge(routine, t)}
                  <Badge variant="outline">{scheduleLabel(routine, t, formatDateTime)}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">{[...targetLabel(routine, t, routine.roomProfileId !== null ? profilesById.get(routine.roomProfileId)?.name : undefined), routine.accountName].filter(Boolean).join(' · ')}</div>
                <div className="flex flex-wrap items-center gap-x-2 text-2xs text-muted-foreground tabular-nums">
                  <span>{t({ ko: '{count}회 실행', en: '{count} runs' }, { count: routine.runCount })}{routine.maxRunCount !== null ? ` / ${routine.maxRunCount}` : ''}</span>
                  {routine.status === 'active' && routine.nextRunAt ? <span>{t({ ko: '· 다음 {time}', en: '· Next {time}' }, { time: formatDateTime(routine.nextRunAt) })}</span> : null}
                  {lastResultLabel(routine, t) ? <span>·</span> : null}
                  {lastResultLabel(routine, t)}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <IconButton size="icon-sm" variant="ghost" disabled={routine.threadId === null || !chat} onClick={() => routine.threadId !== null && openRoom(routine.threadId)} label={t({ ko: '방 열기', en: 'Open room' })}><MessageSquare /></IconButton>
                <IconButton size="icon-sm" variant="ghost" disabled={busy || routine.running} onClick={() => action.mutate({ kind: 'run', routine })} label={t({ ko: '지금 실행', en: 'Run now' })}><Rocket /></IconButton>
                <IconButton size="icon-sm" variant="ghost" disabled={busy || routine.running} onClick={() => onEdit(routine)} label={t({ ko: '루틴 수정', en: 'Edit routine' })}><SquarePen /></IconButton>
                {routine.status === 'active'
                  ? <IconButton size="icon-sm" variant="ghost" disabled={busy} onClick={() => action.mutate({ kind: 'pause', routine })} label={t({ ko: '일시정지', en: 'Pause' })}><Pause /></IconButton>
                  : <IconButton size="icon-sm" variant="ghost" disabled={busy} onClick={() => action.mutate({ kind: 'resume', routine })} label={t({ ko: '다시 켜기', en: 'Resume' })}><Play /></IconButton>}
                <IconButton size="icon-sm" variant="ghost" disabled={busy || routine.running} onClick={() => void remove(routine)} label={t({ ko: '루틴 삭제', en: 'Delete routine' })}><Trash2 /></IconButton>
              </div>
            </div>
            {reason ? <div role="status" className={cn('mt-2 ml-11 rounded-sm px-3 py-2 text-xs', routine.status === 'error_stopped' || routine.lastResult === 'failed' ? 'bg-destructive-soft/50 text-destructive-soft-foreground' : 'bg-warning-soft/45 text-muted-foreground')}>{reason}</div> : null}
          </div>
        )
      })}
    </div>
  )
}

type Draft = {
  name: string
  target: ChatRoutineTarget
  profileId: string
  threadId: string
  message: string
  scheduleType: ChatRoutineScheduleType
  runAt: string
  intervalMinutes: number
  dailyTime: string
  maxRunCount: number
  chainLimit: number
  active: boolean
}

function localDateTimeInput(value: string | null) {
  const date = value ? new Date(value) : new Date(Date.now() + 3600_000)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function draftOf(routine: ChatRoutineView | null, presetThreadId: number | null): Draft {
  if (!routine) {
    return {
      name: '', target: presetThreadId !== null ? 'room' : 'dedicated', profileId: '', threadId: presetThreadId !== null ? String(presetThreadId) : '',
      message: '', scheduleType: 'daily', runAt: localDateTimeInput(null), intervalMinutes: 60, dailyTime: '09:00', maxRunCount: -1, chainLimit: 3, active: true,
    }
  }
  return {
    name: routine.name, target: routine.target, profileId: routine.profileId !== null ? String(routine.profileId) : '',
    threadId: routine.target === 'room' && routine.threadId !== null ? String(routine.threadId) : '', message: routine.message,
    scheduleType: routine.scheduleType, runAt: localDateTimeInput(routine.runAt), intervalMinutes: routine.intervalMinutes ?? 60,
    dailyTime: routine.dailyTime ?? '09:00', maxRunCount: routine.maxRunCount ?? -1, chainLimit: routine.chainLimit ?? 3, active: routine.status === 'active',
  }
}

/** Add or edit one routine. `presetThreadId` starts a new routine on that room (the chat menu). */
export function ChatRoutineEditor({ open, routine, presetThreadId = null, onClose }: { open: boolean; routine: ChatRoutineView | null; presetThreadId?: number | null; onClose: () => void }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const [draft, setDraft] = useState<Draft>(() => draftOf(routine, presetThreadId))
  const [baseline, setBaseline] = useState(() => JSON.stringify(draftOf(routine, presetThreadId)))
  useEffect(() => {
    if (!open) return
    const next = draftOf(routine, presetThreadId)
    setDraft(next)
    setBaseline(JSON.stringify(next))
  }, [open, routine, presetThreadId])
  const profilesQuery = useQuery({ queryKey: CHAT_PROFILES_QUERY_KEY, queryFn: listChatProfiles, staleTime: 30_000, enabled: open })
  const threadsQuery = useQuery({ queryKey: CODEX_CHAT_THREADS_QUERY_KEY, queryFn: listCodexChatThreads, staleTime: 10_000, enabled: open })
  const profiles = useMemo(() => profilesQuery.data ?? [], [profilesQuery.data])
  const profileNames = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile.name])), [profiles])
  const threads = threadsQuery.data ?? []
  const pickedThread = threads.find((thread) => String(thread.id) === draft.threadId)
  const isGroup = draft.target === 'room' && pickedThread?.kind === 'group'
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }))

  const save = useMutation({
    mutationFn: () => {
      const input: ChatRoutineInput = {
        name: draft.name,
        target: draft.target,
        profileId: draft.target === 'dedicated' && draft.profileId ? Number(draft.profileId) : null,
        threadId: draft.target === 'room' && draft.threadId ? Number(draft.threadId) : null,
        message: draft.message,
        scheduleType: draft.scheduleType,
        runAt: draft.scheduleType === 'once' && draft.runAt ? new Date(draft.runAt).toISOString() : null,
        intervalMinutes: draft.scheduleType === 'interval' ? draft.intervalMinutes : null,
        dailyTime: draft.scheduleType === 'daily' ? draft.dailyTime : null,
        maxRunCount: draft.maxRunCount > 0 ? draft.maxRunCount : null,
        chainLimit: isGroup ? draft.chainLimit : null,
        active: draft.active,
      }
      return routine ? updateChatRoutine(routine.id, input) : createChatRoutine(input)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CHAT_ROUTINES_QUERY_KEY })
      onClose()
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '루틴을 저장하지 못했어.', en: 'Could not save the routine.' })), tone: 'error' }),
  })
  const dirty = JSON.stringify(draft) !== baseline
  const canSave = !save.isPending && Boolean(draft.name.trim() && draft.message.trim() && (draft.target === 'room' ? draft.threadId : draft.profileId)) && (dirty || !routine)
  const submit = (event?: SyntheticEvent) => {
    event?.preventDefault()
    if (canSave) save.mutate()
  }
  const roomLabel = (thread: (typeof threads)[number]) => thread.title.trim() || (thread.profile_id !== null ? profileNames.get(thread.profile_id) : undefined) || t({ ko: '채팅 {id}', en: 'Chat {id}' }, { id: thread.id })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={routine ? t({ ko: '루틴 수정', en: 'Edit routine' }) : t({ ko: '루틴 추가', en: 'Add routine' })}
      size="normal"
      dirty={dirty}
      onSave={canSave ? () => submit() : undefined}
    >
      <form className="space-y-5" onSubmit={submit}>
        <Field label={t({ ko: '이름', en: 'Name' })}>
          <Input variant="settings" value={draft.name} maxLength={CHAT_ROUTINE_LIMITS.name} onChange={(event) => set('name', event.target.value)} disabled={save.isPending} />
        </Field>
        <Field label={t({ ko: '보낼 곳', en: 'Send to' })}>
          <div className="theme-input-surface rounded-sm border">
            <Tabs value={draft.target} onValueChange={(value) => set('target', value === 'room' ? 'room' : 'dedicated')}>
              <TabsList aria-label={t({ ko: '보낼 곳', en: 'Send to' })} className={FIELD_TAB_LIST_CLASS}>
                <TabsTrigger value="dedicated" disabled={save.isPending} className={FIELD_TAB_TRIGGER_CLASS}>{t({ ko: '전용 방', en: 'Own room' })}</TabsTrigger>
                <TabsTrigger value="room" disabled={save.isPending} className={FIELD_TAB_TRIGGER_CLASS}>{t({ ko: '고른 방', en: 'Picked room' })}</TabsTrigger>
              </TabsList>
            </Tabs>
            {draft.target === 'dedicated' ? (
              <Select aria-label={t({ ko: '캐릭터', en: 'Character' })} className="border-0 bg-transparent focus:ring-0" value={draft.profileId} onChange={(event) => set('profileId', event.target.value)} disabled={save.isPending}>
                <option value="">{t({ ko: '캐릭터 고르기', en: 'Pick a character' })}</option>
                {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </Select>
            ) : (
              <Select aria-label={t({ ko: '채팅방', en: 'Room' })} className="border-0 bg-transparent focus:ring-0" value={draft.threadId} onChange={(event) => set('threadId', event.target.value)} disabled={save.isPending}>
                <option value="">{t({ ko: '채팅방 고르기', en: 'Pick a room' })}</option>
                {threads.map((thread) => <option key={thread.id} value={thread.id}>{roomLabel(thread)}</option>)}
              </Select>
            )}
          </div>
        </Field>
        <Field label={t({ ko: '지시', en: 'Instruction' })}>
          <Textarea variant="settings" rows={5} value={draft.message} maxLength={CHAT_ROUTINE_LIMITS.message} onChange={(event) => set('message', event.target.value)} disabled={save.isPending} />
        </Field>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={t({ ko: '일정 방식', en: 'Schedule' })}>
            <Select variant="settings" value={draft.scheduleType} onChange={(event) => set('scheduleType', event.target.value as ChatRoutineScheduleType)} disabled={save.isPending}>
              <option value="once">{t({ ko: '1회 실행', en: 'Once' })}</option>
              <option value="interval">{t({ ko: 'N분마다', en: 'Every N minutes' })}</option>
              <option value="daily">{t({ ko: '매일', en: 'Daily' })}</option>
            </Select>
          </Field>
          {draft.scheduleType === 'once' ? (
            <Field label={t({ ko: '실행 시각', en: 'Run at' })}>
              <Input variant="settings" type="datetime-local" value={draft.runAt} onChange={(event) => set('runAt', event.target.value)} disabled={save.isPending} />
            </Field>
          ) : draft.scheduleType === 'interval' ? (
            <Field label={t({ ko: '반복 간격(분)', en: 'Interval (min)' })}>
              <NumberStepperInput variant="settings" min={CHAT_ROUTINE_LIMITS.minIntervalMinutes} value={draft.intervalMinutes} onValueCommit={(value) => set('intervalMinutes', Number(value) || CHAT_ROUTINE_LIMITS.minIntervalMinutes)} disabled={save.isPending} />
            </Field>
          ) : (
            <Field label={t({ ko: '실행 시각', en: 'Run at' })}>
              <Input variant="settings" type="time" value={draft.dailyTime} onChange={(event) => set('dailyTime', event.target.value)} disabled={save.isPending} />
            </Field>
          )}
          <Field label={t({ ko: '최대 실행 횟수', en: 'Max runs' })}>
            <NumberStepperInput variant="settings" min={-1} value={draft.maxRunCount} onValueCommit={(value) => set('maxRunCount', Number(value) > 0 ? Number(value) : -1)} disabled={save.isPending} />
          </Field>
          <Field label={t({ ko: '이어 부르기', en: 'Chain' })}>
            <NumberStepperInput variant="settings" min={0} max={CHAT_ROUTINE_LIMITS.chain} value={draft.chainLimit} onValueCommit={(value) => set('chainLimit', Math.max(0, Number(value) || 0))} disabled={save.isPending || !isGroup} />
          </Field>
        </div>
        <div className="border-y border-line">
          <SettingsSwitchRow label={t({ ko: '활성', en: 'Active' })} checked={draft.active} disabled={save.isPending} onCheckedChange={(checked) => set('active', checked)} />
        </div>
        <EditorFooter saveSubmit canSave={canSave} saving={save.isPending} saveLabel={routine ? t({ ko: '저장', en: 'Save' }) : t({ ko: '추가', en: 'Add' })} />
      </form>
    </Modal>
  )
}

/** The stop-everything switch (chat routines and workflow schedules). */
function AutomationSwitchControl() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const query = useQuery({ queryKey: AUTOMATION_SWITCH_QUERY_KEY, queryFn: getAutomationSwitch, staleTime: 10_000 })
  const mutation = useMutation({
    mutationFn: setAutomationSwitch,
    onSuccess: (data) => queryClient.setQueryData(AUTOMATION_SWITCH_QUERY_KEY, data),
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '바꾸지 못했어.', en: 'Could not change it.' })), tone: 'error' }),
  })
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      {t({ ko: '전체 멈춤', en: 'Stop all' })}
      <Switch size="sm" checked={query.data?.paused === true} disabled={!query.data || mutation.isPending} onCheckedChange={(checked) => mutation.mutate(checked)} aria-label={t({ ko: '루틴과 자동 실행 전체 멈춤', en: 'Stop every routine and autorun' })} />
    </label>
  )
}

/** Settings › 채팅 › 루틴. */
export function ChatSettingsRoutines() {
  const { t } = useI18n()
  const query = useChatRoutines()
  const [editing, setEditing] = useState<ChatRoutineView | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const routines = query.data ?? []
  const open = (routine: ChatRoutineView | null) => {
    setEditing(routine)
    setEditorOpen(true)
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="text-sm font-semibold text-foreground">{t({ ko: '루틴 {count}', en: 'Routines {count}' }, { count: routines.length })}</div>
        <div className="flex-1" />
        <AutomationSwitchControl />
        <IconButton size="icon-sm" variant="secondary" onClick={() => open(null)} label={t({ ko: '루틴 추가', en: 'Add routine' })}><Plus /></IconButton>
      </div>
      {query.isLoading ? null : routines.length === 0
        ? <EmptyState title={t({ ko: '루틴 없음', en: 'No routines' })} />
        : <div className="border-t border-line"><ChatRoutineRows routines={routines} onEdit={open} /></div>}
      <ChatRoutineEditor open={editorOpen} routine={editing} onClose={() => setEditorOpen(false)} />
    </div>
  )
}

/** 채팅 메뉴 › 루틴: the open room's routines, and a new one on this room. */
export function ChatRoomRoutinesModal({ threadId, open, onClose }: { threadId: number | null; open: boolean; onClose: () => void }) {
  const { t } = useI18n()
  const query = useChatRoutines(open)
  const [editing, setEditing] = useState<ChatRoutineView | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const routines = (query.data ?? []).filter((routine) => threadId !== null && routine.threadId === threadId)
  const edit = (routine: ChatRoutineView | null) => {
    setEditing(routine)
    setEditorOpen(true)
  }
  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={t({ ko: '루틴', en: 'Routines' })}
        size="normal"
        headerActions={<IconButton size="icon-sm" variant="secondary" disabled={threadId === null} onClick={() => edit(null)} label={t({ ko: '이 방에 루틴 추가', en: 'Add a routine for this room' })}><Plus /></IconButton>}
      >
        {query.isLoading ? null : routines.length === 0
          ? <EmptyState title={t({ ko: '이 방에 걸린 루틴 없음', en: 'No routines on this room' })} />
          : <ChatRoutineRows routines={routines} onEdit={edit} />}
      </Modal>
      <ChatRoutineEditor open={editorOpen} routine={editing} presetThreadId={threadId} onClose={() => setEditorOpen(false)} />
    </>
  )
}
