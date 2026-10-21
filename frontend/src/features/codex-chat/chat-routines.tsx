import { useEffect, useMemo, useState, type SyntheticEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquare, Pause, Play, Plus, Rocket, SquarePen, Trash2 } from 'lucide-react'
import { CHAT_ROUTINE_LIMITS, type ChatPageData } from '@conai/shared'
import { FieldTabs, FramedField } from '@/components/common/field-tabs'
import { ScheduleField, shortRunLabel, toDateTimeLocal, type ScheduleValue } from '@/components/common/schedule-field'
import { ScheduleRow } from '@/components/common/schedule-row'
import { Chip } from '@/components/ui/chip'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { EditorFooter } from '@/components/ui/editor-footer'
import { EmptyState } from '@/components/ui/empty-state'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { SettingsSwitchRow } from '@/components/ui/settings-switch-row'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { resolveStreamFallbackInterval } from '@/features/runtime-events/runtime-event-fallback'
import { useRuntimeEventStream } from '@/features/runtime-events/use-runtime-event-stream'
import { useI18n, type TranslationInput } from '@/i18n'
import {
  AUTOMATION_SWITCH_QUERY_KEY, CHAT_ROUTINES_QUERY_KEY, createChatRoutine, deleteChatRoutine, getAutomationSwitch, listChatRoutines,
  runChatRoutine, setAutomationSwitch, setChatRoutineActive, updateChatRoutine,
  type ChatRoutineInput, type ChatRoutineTarget, type ChatRoutineView,
} from '@/lib/api-chat-routines'
import { CHAT_PROFILES_QUERY_KEY, listChatProfiles } from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { ChatProfileAvatar } from './chat-profile-avatar'
import { ChatProfilePicker, ChatRoomFace, ChatRoomPicker } from './chat-room-picker'
import { useCodexChat } from './codex-chat-context'
import { useChatPageRegistration } from './chat-page-context'
import { pageAction, pageChoice, pageNumber, pageObject, pageText } from './page-action-helpers'
import { useChatRoomPages, useChatRoomSummaries } from './use-chat-room-directory'

/**
 * Chat routines: wake a chat on a schedule (Settings › 채팅 › 루틴, and 채팅 메뉴 › 루틴 for the open room).
 * Administrators make them; each runs as the account that saved it.
 */

type Translate = (input: TranslationInput, values?: Record<string, string | number>) => string

/** Active routines change on their own (runs finish in the background): `chat.routine.changed` refreshes the list; polling is the stream fallback. */
export function useChatRoutines(enabled = true) {
  const { status: streamStatus } = useRuntimeEventStream()
  return useQuery({ queryKey: CHAT_ROUTINES_QUERY_KEY, queryFn: listChatRoutines, enabled, refetchInterval: (query) => resolveStreamFallbackInterval(streamStatus, query.state.data?.some((routine) => routine.status === 'active') ? 10_000 : false), staleTime: 5_000 })
}

/** Rooms that have a routine (the chat list marks them); empty for accounts that cannot manage routines. */
export function useRoutineThreadIds() {
  const isAdmin = useAuthStatusQuery().data?.isAdmin === true
  const query = useQuery({ queryKey: CHAT_ROUTINES_QUERY_KEY, queryFn: listChatRoutines, enabled: isAdmin, staleTime: 30_000 })
  return useMemo(() => new Set((query.data ?? []).filter((routine) => routine.status !== 'completed' && routine.threadId !== null).map((routine) => routine.threadId as number)), [query.data])
}

function statusLabel(routine: ChatRoutineView, t: Translate) {
  if (routine.status === 'active') return t({ ko: '활성', en: 'Active' })
  if (routine.status === 'error_stopped') return t({ ko: '오류로 중지', en: 'Stopped on errors' })
  if (routine.status === 'completed') return t({ ko: '완료', en: 'Done' })
  return t({ ko: '일시정지', en: 'Paused' })
}

function scheduleLabel(routine: ChatRoutineView, t: Translate, formatDate: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string) {
  if (routine.scheduleType === 'once') return t({ ko: '1회 · {time}', en: 'Once · {time}' }, { time: routine.runAt ? shortRunLabel(routine.runAt, t, formatDate) : '-' })
  if (routine.scheduleType === 'interval') return t({ ko: '{count}분마다', en: 'Every {count} min' }, { count: routine.intervalMinutes ?? 0 })
  return t({ ko: '매일 {time}', en: 'Daily {time}' }, { time: routine.dailyTime ?? '' })
}

function lastResultLabel(routine: ChatRoutineView, t: Translate) {
  if (routine.running) return <span className="text-primary">{t({ ko: '실행 중', en: 'Running' })}</span>
  if (routine.lastResult === 'ok') return <span>{t({ ko: '최근 성공', en: 'Last ok' })}</span>
  if (routine.lastResult === 'skipped') return <span>{t({ ko: '최근 건너뜀', en: 'Last skipped' })}</span>
  if (routine.lastResult === 'failed') return <span className="text-destructive">{t({ ko: '최근 실패', en: 'Last failed' })}</span>
  return null
}

/** The rows of a routine list, with their actions. `onEdit` opens the editor. */
export function ChatRoutineRows({ routines, onEdit }: { routines: ChatRoutineView[]; onEdit: (routine: ChatRoutineView) => void }) {
  const { t, formatDate } = useI18n()
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const confirm = useConfirm()
  const chat = useCodexChat()
  const myAccountId = useAuthStatusQuery().data?.accountId ?? null
  const profilesQuery = useQuery({ queryKey: CHAT_PROFILES_QUERY_KEY, queryFn: listChatProfiles, staleTime: 30_000 })
  const threadsQuery = useChatRoomSummaries(routines.flatMap((routine) => routine.threadId === null ? [] : [routine.threadId]))
  const profilesById = useMemo(() => new Map((profilesQuery.data ?? []).map((profile) => [profile.id, profile])), [profilesQuery.data])
  const threadsById = useMemo(() => new Map((threadsQuery.data ?? []).map((thread) => [thread.id, thread])), [threadsQuery.data])
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
        const thread = routine.threadId !== null ? threadsById.get(routine.threadId) : undefined
        const dedicatedProfile = routine.target === 'dedicated' && routine.profileId !== null ? profilesById.get(routine.profileId) : undefined
        const roomProfile = routine.roomProfileId !== null ? profilesById.get(routine.roomProfileId) : undefined
        const reason = routine.status !== 'active' ? routine.stopReason : routine.lastResult === 'failed' ? routine.lastError : null
        const busy = action.isPending && action.variables?.routine.id === routine.id
        const isGroup = routine.roomKind === 'group'
        const roomName = routine.target === 'dedicated'
          ? t({ ko: '전용 방', en: 'Own room' })
          : routine.roomTitle?.trim() || roomProfile?.name || t({ ko: '채팅 {id}', en: 'Chat {id}' }, { id: routine.threadId ?? '-' })
        const who = routine.target === 'dedicated'
          ? routine.profileName ?? t({ ko: '없는 캐릭터', en: 'Missing character' })
          : isGroup ? null : roomProfile?.name ?? null
        // A dedicated room shows before its first run made it: the character's face stands in.
        const faceProfile = dedicatedProfile ?? roomProfile
        const face = thread
          ? <ChatRoomFace thread={thread} profilesById={profilesById} ringClassName="ring-background" />
          : faceProfile
            ? <ChatProfileAvatar name={faceProfile.name} profile={faceProfile} engine={faceProfile.engine} size="md" />
            : <span className="size-8 shrink-0 rounded-full bg-surface-highest" aria-hidden="true" />
        const runs = routine.maxRunCount !== null
          ? t({ ko: '{count} / {max}회', en: '{count} / {max} runs' }, { count: routine.runCount, max: routine.maxRunCount })
          : t({ ko: '{count}회', en: '{count} runs' }, { count: routine.runCount })
        return (
          <ScheduleRow
            key={routine.id}
            leading={<span className="flex shrink-0 pt-0.5">{face}</span>}
            status={routine.status === 'active' ? 'active' : routine.status === 'error_stopped' ? 'stopped' : 'idle'}
            statusLabel={statusLabel(routine, t)}
            name={routine.name}
            cadence={scheduleLabel(routine, t, formatDate)}
            nextRunAt={routine.nextRunAt}
            notice={reason}
            noticeTone={routine.status === 'error_stopped' || routine.lastResult === 'failed' ? 'destructive' : 'warning'}
            details={<>
              <span className="truncate">{roomName}</span>
              {isGroup ? <Chip size="sm" tone="muted">{t({ ko: '그룹 {count}', en: 'Group {count}' }, { count: thread?.member_profile_ids?.length ?? 0 })}</Chip> : null}
              {who ? <><span aria-hidden="true">·</span><span className="truncate">{who}</span></> : null}
              {isGroup && routine.chainLimit !== null ? <><span aria-hidden="true">·</span><span>{t({ ko: '이어 부르기 {count}', en: 'Chain {count}' }, { count: routine.chainLimit })}</span></> : null}
              {routine.accountName && routine.accountId !== myAccountId ? <><span aria-hidden="true">·</span><span>{routine.accountName}</span></> : null}
            </>}
            stats={<>
              <span>{runs}</span>
              {lastResultLabel(routine, t) ? <><span aria-hidden="true">·</span>{lastResultLabel(routine, t)}</> : null}
            </>}
            actions={<>
              <IconButton size="icon-sm" variant="ghost" disabled={routine.threadId === null || !chat} onClick={() => routine.threadId !== null && openRoom(routine.threadId)} label={t({ ko: '방 열기', en: 'Open room' })}><MessageSquare /></IconButton>
              <IconButton size="icon-sm" variant="ghost" disabled={busy || routine.running} onClick={() => action.mutate({ kind: 'run', routine })} label={t({ ko: '지금 실행', en: 'Run now' })}><Rocket /></IconButton>
              <IconButton size="icon-sm" variant="ghost" disabled={busy || routine.running} onClick={() => onEdit(routine)} label={t({ ko: '루틴 수정', en: 'Edit routine' })}><SquarePen /></IconButton>
              {routine.status === 'active'
                ? <IconButton size="icon-sm" variant="ghost" disabled={busy} onClick={() => action.mutate({ kind: 'pause', routine })} label={t({ ko: '일시정지', en: 'Pause' })}><Pause /></IconButton>
                : <IconButton size="icon-sm" variant="ghost" disabled={busy} onClick={() => action.mutate({ kind: 'resume', routine })} label={t({ ko: '다시 켜기', en: 'Resume' })}><Play /></IconButton>}
              <IconButton size="icon-sm" variant="ghost" disabled={busy || routine.running} onClick={() => void remove(routine)} label={t({ ko: '루틴 삭제', en: 'Delete routine' })}><Trash2 /></IconButton>
            </>}
          />
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
  schedule: ScheduleValue
  chainLimit: number
  active: boolean
}

function draftOf(routine: ChatRoutineView | null, presetThreadId: number | null): Draft {
  if (!routine) {
    return {
      name: '', target: presetThreadId !== null ? 'room' : 'dedicated', profileId: '', threadId: presetThreadId !== null ? String(presetThreadId) : '', message: '',
      schedule: { type: 'daily', runAt: toDateTimeLocal(null), intervalMinutes: 60, dailyTime: '09:00', maxRuns: null },
      chainLimit: 3, active: true,
    }
  }
  return {
    name: routine.name, target: routine.target, profileId: routine.profileId !== null ? String(routine.profileId) : '',
    threadId: routine.target === 'room' && routine.threadId !== null ? String(routine.threadId) : '', message: routine.message,
    schedule: {
      type: routine.scheduleType, runAt: toDateTimeLocal(routine.runAt), intervalMinutes: routine.intervalMinutes ?? 60,
      dailyTime: routine.dailyTime ?? '09:00', maxRuns: routine.maxRunCount,
    },
    chainLimit: routine.chainLimit ?? 3, active: routine.status === 'active',
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
  const threadsQuery = useChatRoomSummaries(draft.threadId ? [Number(draft.threadId)] : [], open)
  const profiles = useMemo(() => profilesQuery.data ?? [], [profilesQuery.data])
  const profilesById = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile])), [profiles])
  const threads = useMemo(() => threadsQuery.data ?? [], [threadsQuery.data])
  const pickedThread = threads.find((thread) => String(thread.id) === draft.threadId)
  const isGroup = draft.target === 'room' && pickedThread?.kind === 'group'
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }))

  const save = useMutation({
    mutationFn: () => {
      const { schedule } = draft
      const input: ChatRoutineInput = {
        name: draft.name,
        target: draft.target,
        profileId: draft.target === 'dedicated' && draft.profileId ? Number(draft.profileId) : null,
        threadId: draft.target === 'room' && draft.threadId ? Number(draft.threadId) : null,
        message: draft.message,
        scheduleType: schedule.type,
        runAt: schedule.type === 'once' && schedule.runAt ? new Date(schedule.runAt).toISOString() : null,
        intervalMinutes: schedule.type === 'interval' ? schedule.intervalMinutes : null,
        dailyTime: schedule.type === 'daily' ? schedule.dailyTime : null,
        maxRunCount: schedule.type !== 'once' ? schedule.maxRuns : null,
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
  const scheduleReady = draft.schedule.type === 'once' ? Boolean(draft.schedule.runAt) : draft.schedule.type === 'daily' ? /^\d{2}:\d{2}$/.test(draft.schedule.dailyTime) : draft.schedule.intervalMinutes > 0
  const canSave = !save.isPending && Boolean(draft.name.trim() && draft.message.trim() && (draft.target === 'room' ? draft.threadId : draft.profileId)) && scheduleReady && (dirty || !routine)
  const submit = (event?: SyntheticEvent) => {
    event?.preventDefault()
    if (canSave) save.mutate()
  }

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
        <FramedField label={t({ ko: '보낼 곳', en: 'Send to' })}>
          <FieldTabs
            value={draft.target}
            onChange={(value) => set('target', value)}
            disabled={save.isPending}
            ariaLabel={t({ ko: '보낼 곳', en: 'Send to' })}
            items={[
              { value: 'dedicated', label: t({ ko: '전용 방', en: 'Own room' }) },
              { value: 'room', label: t({ ko: '고른 방', en: 'Picked room' }) },
            ]}
          />
          {draft.target === 'dedicated'
            ? <ChatProfilePicker profiles={profiles} value={draft.profileId} onChange={(value) => set('profileId', value)} disabled={save.isPending} />
            : <ChatRoomPicker profilesById={profilesById} value={draft.threadId} onChange={(value) => set('threadId', value)} disabled={save.isPending} />}
        </FramedField>
        <Field label={t({ ko: '지시', en: 'Instruction' })}>
          <Textarea variant="settings" rows={5} value={draft.message} maxLength={CHAT_ROUTINE_LIMITS.message} onChange={(event) => set('message', event.target.value)} disabled={save.isPending} />
        </Field>
        <ScheduleField
          value={draft.schedule}
          minIntervalMinutes={CHAT_ROUTINE_LIMITS.minIntervalMinutes}
          disabled={save.isPending}
          onChange={(patch) => setDraft((current) => ({ ...current, schedule: { ...current.schedule, ...patch } }))}
        />
        {isGroup ? (
          <Field label={t({ ko: '이어 부르기', en: 'Chain' })} className="md:w-1/2">
            <NumberStepperInput variant="settings" min={0} max={CHAT_ROUTINE_LIMITS.chain} value={draft.chainLimit} onValueCommit={(value) => set('chainLimit', Math.max(0, Number(value) || 0))} disabled={save.isPending} />
          </Field>
        ) : null}
        <div className="border-t border-line">
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
  useRoutinesChatPage(routines)
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

/** The routine fields a chat may pass; omitted ones keep the routine's (or a new routine's) value. */
function routineInput(args: Record<string, ChatPageData>, base: ChatRoutineView | null): ChatRoutineInput {
  const pick = <T,>(key: string, fallback: T): T => (args[key] === undefined ? fallback : args[key] as T)
  const target = pick<ChatRoutineTarget>('target', base?.target ?? 'dedicated')
  const scheduleType = pick('scheduleType', base?.scheduleType ?? 'daily')
  const rawRunAt = pick<string | null>('runAt', base?.runAt ?? null)
  const runAt = scheduleType === 'once' && rawRunAt ? new Date(rawRunAt) : null
  if (runAt && Number.isNaN(runAt.getTime())) throw new Error('runAt 날짜를 읽지 못했어.')
  if (scheduleType === 'once' && !runAt) throw new Error('1회 루틴은 runAt이 필요해.')
  const dailyTime = pick<string | null>('dailyTime', base?.dailyTime ?? '09:00')
  if (scheduleType === 'daily' && !/^\d{2}:\d{2}$/.test(dailyTime ?? '')) throw new Error('dailyTime은 HH:MM이어야 해.')
  const input: ChatRoutineInput = {
    name: pick('name', base?.name ?? '').trim(),
    target,
    profileId: target === 'dedicated' ? pick<number | null>('profileId', base?.profileId ?? null) : null,
    threadId: target === 'room' ? pick<number | null>('threadId', base?.target === 'room' ? base.threadId : null) : null,
    message: pick('message', base?.message ?? ''),
    scheduleType,
    runAt: runAt ? runAt.toISOString() : null,
    intervalMinutes: scheduleType === 'interval' ? pick<number>('intervalMinutes', base?.intervalMinutes ?? 60) : null,
    dailyTime: scheduleType === 'daily' ? dailyTime : null,
    maxRunCount: scheduleType !== 'once' ? (pick<number>('maxRunCount', base?.maxRunCount ?? 0) || null) : null,
    chainLimit: target === 'room' ? pick<number | null>('chainLimit', base?.chainLimit ?? null) : null,
    active: pick('active', base ? base.status === 'active' : true),
  }
  if (!input.name || !input.message.trim()) throw new Error('루틴 이름과 보낼 메시지가 필요해.')
  if (target === 'dedicated' ? !input.profileId : !input.threadId) throw new Error(target === 'dedicated' ? '전용 방 루틴은 캐릭터(profileId)가 필요해.' : '고른 방 루틴은 방(threadId)이 필요해.')
  return input
}

/** Settings › 채팅 › 루틴 for a connected chat: the routines, the rooms and characters they can wake, and review cards for every change. */
function useRoutinesChatPage(routines: ChatRoutineView[]) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const profiles = useQuery({ queryKey: CHAT_PROFILES_QUERY_KEY, queryFn: listChatProfiles, staleTime: 30_000 }).data ?? []
  const { rooms, data: roomPages, hasNextPage, isFetching, isError, fetchNextPage } = useChatRoomPages({ archive: 'active', limit: 100 })
  const loadedPages = roomPages?.pages.length ?? 0
  useEffect(() => {
    if (loadedPages < 2 && hasNextPage && !isFetching && !isError) void fetchNextPage()
  }, [loadedPages, hasNextPage, isFetching, isError, fetchNextPage])
  const threads = rooms.slice(0, 200)
  const paused = useQuery({ queryKey: AUTOMATION_SWITCH_QUERY_KEY, queryFn: getAutomationSwitch, staleTime: 10_000 }).data?.paused ?? null
  const clip = (text: string | null, max = 120) => (text && text.length > max ? `${text.slice(0, max)}…` : text)
  // Lists sit at the top of data: a long one shows as a count until read_page_data reads it.
  const data: Record<string, ChatPageData> = {
    automationPaused: paused,
    routines: routines.map((routine) => ({
      id: routine.id, name: routine.name, status: routine.status, ...(routine.running ? { running: true } : {}), target: routine.target,
      ...(routine.target === 'dedicated' ? { profileId: routine.profileId, profile: routine.profileName } : { threadId: routine.threadId, room: routine.roomTitle }),
      message: clip(routine.message), scheduleType: routine.scheduleType,
      ...(routine.scheduleType === 'once' ? { runAt: routine.runAt } : routine.scheduleType === 'interval' ? { intervalMinutes: routine.intervalMinutes } : { dailyTime: routine.dailyTime }),
      runs: routine.maxRunCount ? `${routine.runCount}/${routine.maxRunCount}` : routine.runCount, ...(routine.chainLimit !== null ? { chainLimit: routine.chainLimit } : {}),
      nextRunAt: routine.nextRunAt, lastResult: routine.lastResult, ...(routine.stopReason || routine.lastError ? { problem: clip(routine.stopReason ?? routine.lastError) } : {}),
    })),
    characters: profiles.map((profile) => ({ id: profile.id, name: profile.name })),
    rooms: threads.map((thread) => ({ id: thread.id, title: thread.title, ...(thread.kind === 'group' ? { group: true } : {}) })),
  }
  useChatPageRegistration({
    kind: 'settings', title: t({ ko: '설정 · 채팅 루틴', en: 'Settings · Chat routines' }), resourceId: 'chat', priority: 5, fields: [], data,
    actions: [
      pageAction('settings.routine', t({ ko: '루틴 만들기·바꾸기', en: 'Make or change a routine' }), t({
        ko: '정해진 때 방을 깨워 message를 보내(저장한 계정으로). save: id 있으면 넘긴 것만 수정, 없으면 추가. target dedicated=캐릭터(profileId) 전용 방, room=고른 방(threadId). once는 runAt(ISO), interval은 intervalMinutes, daily는 dailyTime(HH:MM). maxRunCount 0=무제한. pause/resume/run(지금 한 번)/delete는 id만.',
        en: 'Wakes a room at set times with message (as the saving account). save: with id edits what is passed, without adds. target dedicated = own room of a character (profileId), room = a picked room (threadId). once: runAt (ISO), interval: intervalMinutes, daily: dailyTime (HH:MM). maxRunCount 0 = no limit. pause/resume/run (once now)/delete need only id.',
      }), pageObject({
        operation: pageChoice(['save', 'pause', 'resume', 'run', 'delete']), id: pageNumber(0, undefined, true),
        name: pageText(CHAT_ROUTINE_LIMITS.name), target: pageChoice(['dedicated', 'room']), profileId: pageNumber(0, undefined, true),
        threadId: pageNumber(0, undefined, true), message: pageText(CHAT_ROUTINE_LIMITS.message),
        scheduleType: pageChoice(['once', 'interval', 'daily']), runAt: pageText(40), intervalMinutes: pageNumber(CHAT_ROUTINE_LIMITS.minIntervalMinutes, 100_000, true),
        dailyTime: pageText(5), maxRunCount: pageNumber(0, 1_000_000, true), chainLimit: pageNumber(0, CHAT_ROUTINE_LIMITS.chain, true), active: { type: 'boolean' },
      }, ['operation']), 'save'),
      pageAction('settings.automation_switch', t({ ko: '자동화 전체 멈춤', en: 'Stop all automation' }), t({ ko: '모든 채팅 루틴과 워크플로 예약을 멈추거나(paused true) 다시 돌려.', en: 'Pause (paused true) or resume every chat routine and workflow schedule.' }), pageObject({ paused: { type: 'boolean' } }, ['paused']), 'save'),
    ],
    apply: () => {},
    applyAction: async (id, args, assertCurrent) => {
      assertCurrent()
      if (id === 'settings.automation_switch') {
        queryClient.setQueryData(AUTOMATION_SWITCH_QUERY_KEY, await setAutomationSwitch(args.paused === true))
        return
      }
      if (id !== 'settings.routine') throw new Error('이 화면에 없는 작업이야.')
      const routine = typeof args.id === 'number' && args.id > 0 ? routines.find((entry) => entry.id === args.id) ?? null : null
      if (typeof args.id === 'number' && args.id > 0 && !routine) throw new Error('목록에 없는 루틴이야.')
      if (args.operation === 'save') {
        // 0 stands for "none" in the id choices (an empty list cannot be a choice).
        const values = Object.fromEntries(Object.entries(args).filter(([key, value]) => key !== 'operation' && key !== 'id' && !((key === 'profileId' || key === 'threadId') && value === 0)))
        await (routine ? updateChatRoutine(routine.id, routineInput(values, routine)) : createChatRoutine(routineInput(values, null)))
      } else {
        if (!routine) throw new Error('루틴 id가 필요해.')
        if (args.operation === 'run') await runChatRoutine(routine.id)
        else if (args.operation === 'delete') await deleteChatRoutine(routine.id)
        else await setChatRoutineActive(routine.id, args.operation === 'resume')
      }
      await queryClient.invalidateQueries({ queryKey: CHAT_ROUTINES_QUERY_KEY })
    },
  }, { preserveOnSearchChange: true })
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
