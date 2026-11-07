import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Eraser, LoaderCircle, ScrollText, Shrink, TriangleAlert } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { IconButton } from '@/components/ui/icon-button'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { SettingRow } from '@/components/ui/setting-row'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Textarea } from '@/components/ui/textarea'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { editChatSummarySegment, getThreadLinkedFiles, summarizeCodexChatThread, threadLinkedFilesQueryKey, thinkingMayFillCap, updateCodexChatThreadContext, updateGroupChat, updateGroupChatMember, type ChatEngine, type ChatGroupInfo, type ChatModelOverride, type ChatModelOverridePatch, type ChatProfileSummary, type ChatSummarySegment, type CodexChatThread } from '@/lib/api-codex-chat'
import { cn } from '@/lib/utils'
import { getErrorMessage } from '@/lib/error-message'
import { LorebookBlock } from './chat-lorebook-block'
import { LinkedFilesBlock } from './chat-linked-files-block'
import { ChatProfileAvatar } from './chat-profile-avatar'
import { ChatUserProfileRow } from './chat-user-profiles'
import { CODEX_CHAT_THREADS_QUERY_KEY, codexChatCompactMutationKey, codexChatThreadQueryKey, isChatSummaryEnabled } from './codex-chat-context'
import { applyChatThreadUpdate, runChatThreadDetailMutation } from './chat-query-refresh'
import { CHAT_MODEL_OPTIONS_QUERY_KEY, listChatModelOptions } from '@/lib/api-codex-chat'
import { parseServerDate } from '@/lib/server-time'
import { ChatModelOptionItems } from './chat-model-option-items'
import { ChatModelOverrideSelect } from './chat-model-override-select'

/** A direct chat's own model; the profile keeps its own. */
function ChatModelRow({ thread, engine, profileModelLabel }: { thread: CodexChatThread; engine: ChatEngine; profileModelLabel: string }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const mutation = useMutation({
    mutationFn: (patch: ChatModelOverridePatch) => updateCodexChatThreadContext(thread.id, patch),
    onSuccess: (updated) => applyChatThreadUpdate(queryClient, updated),
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' }),
  })
  const label = t({ ko: '대화 모델', en: 'Chat model' })
  return (
    <SettingRow label={label} info={t({ ko: '이 채팅에서만 쓰는 모델이야. 프로필은 그대로고, 다음 요청부터 적용돼.', en: 'The model for this chat only; the profile stays as it is. Applies from the next request.' })}>
      <ChatModelOverrideSelect
        engine={engine}
        value={{ slotId: thread.chat_model_slot_id, model: thread.chat_model }}
        profileModelLabel={profileModelLabel}
        onChange={(patch) => mutation.mutateAsync(patch)}
        disabled={mutation.isPending}
        aria-label={label}
      />
    </SettingRow>
  )
}

/** One member's model in a room; each row saves on its own, so it stays disabled only while its own save runs. */
function MemberChatModelRow({ threadId, member, value, onSaved, onError }: {
  threadId: number
  member: ChatProfileSummary
  value: Pick<ChatModelOverride, 'slotId' | 'model'>
  onSaved: () => void
  onError: (error: unknown) => void
}) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (patch: ChatModelOverridePatch) => runChatThreadDetailMutation(queryClient, threadId, () => updateGroupChatMember(threadId, member.id, patch)),
    onSuccess: onSaved,
    onError,
  })
  return (
    <SettingRow label={<MemberLabel member={member} />}>
      <ChatModelOverrideSelect
        engine={member.engine}
        value={value}
        profileModelLabel={member.modelLabel}
        onChange={(patch) => mutation.mutateAsync(patch)}
        disabled={mutation.isPending}
        aria-label={t({ ko: '{name}의 대화 모델', en: 'Chat model for {name}' }, { name: member.name })}
      />
    </SettingRow>
  )
}

/** A room member's row label: avatar and @name. */
function MemberLabel({ member }: { member: ChatProfileSummary }) {
  return (
    <span className="flex items-center gap-2">
      <ChatProfileAvatar name={member.name} avatar={member.avatar} profile={member} engine={member.engine} size="sm" />
      <span className="truncate">@{member.name}</span>
    </span>
  )
}

/**
 * The chat's own completion reactions over the profile's default: on/off and the model, each following the profile
 * while null. `profile` is the 1:1 chat's profile (its default is shown); group rooms leave it out.
 */
function GenerationReactionSettings({ thread, profile }: { thread: CodexChatThread; profile?: Pick<ChatProfileSummary, 'reactionEnabled' | 'reactionSlotId'> | null }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const models = useQuery({ queryKey: CHAT_MODEL_OPTIONS_QUERY_KEY, queryFn: listChatModelOptions, staleTime: 60_000 })
  const mutation = useMutation({
    mutationFn: (patch: { reactionEnabled?: boolean | null; reactionModelSlotId?: number | null }) => updateCodexChatThreadContext(thread.id, patch),
    onSuccess: (updated) => applyChatThreadUpdate(queryClient, updated),
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' }),
  })
  const label = t({ ko: '완료 반응', en: 'Completion reaction' })
  const profileLabel = t({ ko: '프로필', en: 'Profile' })
  const mode: SummaryMode = thread.reaction_enabled === null ? 'profile' : thread.reaction_enabled === 1 ? 'on' : 'off'
  const profileEnabled = profile?.reactionEnabled
  const profileSlotId = profile?.reactionSlotId
  const profileModel = profileSlotId === undefined ? null
    : profileSlotId === null ? t({ ko: '대화 모델', en: 'chat model' })
      : models.data?.find((model) => model.id === profileSlotId)?.label ?? t({ ko: '모델 #{id}', en: 'Model #{id}' }, { id: profileSlotId })
  return (
    <SettingRow label={label}>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <SegmentedControl
          size="xs"
          value={mode}
          onChange={(next) => mutation.mutate({ reactionEnabled: next === 'profile' ? null : next === 'on' })}
          items={[
            { value: 'profile', label: profileEnabled === undefined ? profileLabel : `${profileLabel} (${profileEnabled ? t({ ko: '켬', en: 'on' }) : t({ ko: '끔', en: 'off' })})` },
            { value: 'on', label: t({ ko: '켬', en: 'On' }) },
            { value: 'off', label: t({ ko: '끔', en: 'Off' }) },
          ]}
          ariaLabel={label}
        />
        <Select
          className="w-48"
          value={thread.reaction_model_slot_id === null ? '' : String(thread.reaction_model_slot_id)}
          onChange={(event) => mutation.mutate({ reactionModelSlotId: event.target.value ? Number(event.target.value) : null })}
          disabled={mutation.isPending}
          aria-label={t({ ko: '완료 반응 모델', en: 'Completion reaction model' })}
        >
          <option value="">{profileModel ? t({ ko: '프로필 설정 따름 · {model}', en: 'Profile setting · {model}' }, { model: profileModel }) : t({ ko: '프로필 설정 따름', en: 'Follow profile setting' })}</option>
          <ChatModelOptionItems models={models.data ?? []} part="chat" />
        </Select>
      </div>
    </SettingRow>
  )
}

type SummaryMode = 'profile' | 'on' | 'off'

const NOTE_SAVE_DELAY_MS = 600

/** A newer stored note replaces the draft only while the draft still is the text it agreed with (and differs in content). */
function adoptStoredNote(draft: string, agreed: string, stored: string) {
  return draft === agreed && draft.trim() !== stored.trim() ? stored : draft
}

/** What a chat's note falls back to: the profile's default note and depth. Group rooms have none (each member has its own). */
export type AuthorNoteDefaults = { note: string; depth: number | null }

/**
 * The chat's author's note: scene direction the model gets on every request, merged into the conversation `depth`
 * turns before the end. Empty text falls back to the profile's default note, an empty depth to the profile's lore
 * depth. The text saves by itself shortly after typing stops.
 */
export function AuthorNoteBlock({ thread, defaults }: { thread: CodexChatThread; defaults: AuthorNoteDefaults }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const stored = thread.author_note ?? ''
  const [draft, setDraft] = useState(stored)
  const latest = useRef({ draft: stored, stored })
  latest.current = { draft, stored }
  // The text the draft last agreed with: the stored note, or the text sent while its save is on the way. Only a draft
  // still equal to it takes a newer stored value; anything typed since stays.
  const agreed = useRef(stored)
  const saving = useRef(0)

  useEffect(() => {
    if (saving.current > 0) return
    setDraft((current) => adoptStoredNote(current, agreed.current, stored))
    agreed.current = stored
  }, [stored])

  const mutation = useMutation({
    mutationFn: (patch: { authorNote?: string | null; authorNoteDepth?: number | null }) => updateCodexChatThreadContext(thread.id, patch),
    onSuccess: (updated) => applyChatThreadUpdate(queryClient, updated),
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' }),
  })
  const { mutate, mutateAsync } = mutation
  const saveNote = useCallback((text: string) => {
    agreed.current = text
    saving.current += 1
    void mutateAsync({ authorNote: text.trim() || null }).then((updated) => {
      const saved = updated.author_note ?? ''
      setDraft((current) => adoptStoredNote(current, text, saved))
      if (agreed.current === text) agreed.current = saved
    }, () => {
      // Not saved: the text stays the user's own edit, never something a later stored value may replace.
      if (agreed.current === text) agreed.current = latest.current.stored
    }).finally(() => { saving.current -= 1 })
  }, [mutateAsync])

  useEffect(() => {
    if (draft.trim() === stored.trim()) return
    const timer = window.setTimeout(() => saveNote(draft), NOTE_SAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [draft, stored, saveNote])

  // Leaving the view before the delay still saves what was typed.
  useEffect(() => () => {
    const { draft: text, stored: saved } = latest.current
    if (text.trim() !== saved.trim()) mutate({ authorNote: text.trim() || null })
  }, [mutate])

  const profileLabel = t({ ko: '프로필', en: 'Profile' })
  return (
    <div className="flex flex-col gap-2 border-b border-line py-2.5">
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <label htmlFor={`author-note-${thread.id}`} className="text-sm">{t({ ko: '작가 노트', en: "Author's note" })}</label>
        <NumberStepperInput
          allowEmpty
          step={1}
          min={0}
          max={20}
          className="w-48"
          value={thread.author_note_depth ?? null}
          placeholder={defaults.depth !== null ? `${profileLabel} (${defaults.depth})` : profileLabel}
          onValueCommit={(value) => mutate({ authorNoteDepth: value.trim() === '' ? null : Number(value) })}
          aria-label={t({ ko: '작가 노트 위치 (끝에서 몇 턴 앞)', en: "Author's note depth (turns from the end)" })}
        />
      </div>
      <Textarea
        id={`author-note-${thread.id}`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={3}
        // Grows with the note (or with the profile's note shown as the hint) instead of scrolling inside three rows.
        autoGrow
        className="max-h-80 min-h-20"
        placeholder={defaults.note || t({ ko: '작가 노트', en: "Author's note" })}
      />
    </div>
  )
}

/**
 * A group room's context: the room's author's note, each member's model in this room (its profile keeps its own) and
 * reply token caps — one for the room, then one per LLM member that overrides it (members keep their own windows and
 * memories). A Codex member has no hard cap, so it gets no cap row.
 */
export function GroupContextView({ thread, group, profilesById, segments }: {
  thread: CodexChatThread
  group: ChatGroupInfo | null
  profilesById: Map<number, ChatProfileSummary>
  /** The room's summary by stretch, the plot first (see ChatSummarySegment). */
  segments: ChatSummarySegment[]
}) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const applied = () => {
    void queryClient.invalidateQueries({ queryKey: CODEX_CHAT_THREADS_QUERY_KEY })
  }
  const onError = (error: unknown) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' })
  const roomMutation = useMutation({ mutationFn: (maxTokens: number | null) => runChatThreadDetailMutation(queryClient, thread.id, () => updateGroupChat(thread.id, { maxTokens })), onSuccess: applied, onError })
  const summaryMutation = useMutation({
    mutationFn: (summaryEnabled: boolean) => updateCodexChatThreadContext(thread.id, { summaryEnabled }),
    onSuccess: (updated) => applyChatThreadUpdate(queryClient, updated),
    onError,
  })
  const memberMutation = useMutation({
    mutationFn: ({ profileId, maxTokens }: { profileId: number; maxTokens: number | null }) => runChatThreadDetailMutation(queryClient, thread.id, () => updateGroupChatMember(thread.id, profileId, { maxTokens })),
    onSuccess: applied,
    onError,
  })
  const members = (group?.memberIds ?? []).flatMap((id) => profilesById.get(id) ?? [])
  const llmMembers = members.filter((member) => member.engine !== 'codex')
  const roomLabel = t({ ko: '방', en: 'Room' })
  const profileLabel = t({ ko: '프로필', en: 'Profile' })
  const capLabel = t({ ko: '최대 출력 토큰', en: 'Max output tokens' })
  const commit = (value: string) => (value.trim() === '' ? null : Number(value))

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4 *:shrink-0">
      <ChatUserProfileRow thread={thread} />
      <AuthorNoteBlock key={thread.id} thread={thread} defaults={{ note: '', depth: null }} />
      {llmMembers.length > 0 ? <GenerationReactionSettings thread={thread} /> : null}
      <LorebookBlock threadId={thread.id} loreAutoSave={thread.lore_auto_save} profiles={(group?.memberIds ?? thread.member_profile_ids ?? []).flatMap((id) => profilesById.get(id) ?? []).map(({ id, name }) => ({ id, name }))} />
      <LinkedFilesBlock threadId={thread.id} group={thread.kind === 'group'} />
      {group ? (
        <>
          {members.length > 0 ? (
            <SettingRow
              label={t({ ko: '대화 모델', en: 'Chat model' })}
              info={t({ ko: '이 방에서 참가자마다 쓰는 모델이야. 프로필은 그대로고, 다음 요청부터 적용돼.', en: "Each member's model in this room; their profiles stay as they are. Applies from the next request." })}
            />
          ) : null}
          {members.map((member) => (
            <MemberChatModelRow
              key={member.id}
              threadId={thread.id}
              member={member}
              value={group.memberChatModels[String(member.id)] ?? { slotId: null, model: null }}
              onSaved={applied}
              onError={onError}
            />
          ))}
          <SettingRow label={capLabel}>
            <NumberStepperInput
              allowEmpty
              shorthand
              step={128}
              min={1}
              max={Number.MAX_SAFE_INTEGER}
              className="w-48"
              value={group.maxTokens}
              placeholder={profileLabel}
              onValueCommit={(value) => roomMutation.mutate(commit(value))}
              aria-label={t({ ko: '방 전체 최대 출력 토큰', en: 'Max output tokens for the room' })}
            />
          </SettingRow>
          {llmMembers.map((member) => {
            // What this member gets when its own box is empty: the room's cap, else its profile's.
            const fallback = group.maxTokens ?? member.maxTokens
            const fallbackLabel = group.maxTokens !== null ? roomLabel : profileLabel
            const own = group.memberMaxTokens[String(member.id)] ?? null
            const effective = own ?? fallback
            return (
              <SettingRow key={member.id} label={<MemberLabel member={member} />}>
                <div className="flex items-center gap-2">
                  {effective !== null && member.reasoningBudgetTokens !== null && effective <= member.reasoningBudgetTokens ? (
                    <Tip content={t({ ko: '추론 토큰 예산({budget})보다 작아서 답변 없이 끊길 수 있어', en: 'At or under the reasoning budget ({budget}): the reply may be cut before it starts' }, { budget: member.reasoningBudgetTokens })} side="top">
                      <span className="text-warning"><TriangleAlert className="size-4" aria-hidden /></span>
                    </Tip>
                  ) : thinkingMayFillCap(member.reasoningEffort, effective) ? (
                    <Tip content={t({ ko: '추론이 켜진 채 최대 출력 토큰이 {n}이면 생각만 하다 끝날 수 있어', en: 'With reasoning on, a cap of {n} tokens may run out while still thinking' }, { n: effective ?? 0 })} side="top">
                      <span className="text-warning"><TriangleAlert className="size-4" aria-hidden /></span>
                    </Tip>
                  ) : null}
                  <NumberStepperInput
                    allowEmpty
                    shorthand
                    step={128}
                    min={1}
                    max={Number.MAX_SAFE_INTEGER}
                    className="w-48"
                    value={own}
                    placeholder={fallback !== null ? `${fallbackLabel} (${fallback})` : fallbackLabel}
                    onValueCommit={(value) => memberMutation.mutate({ profileId: member.id, maxTokens: commit(value) })}
                    aria-label={t({ ko: '{name}의 최대 출력 토큰', en: 'Max output tokens for {name}' }, { name: member.name })}
                  />
                </div>
              </SettingRow>
            )
          })}
        </>
      ) : null}
      {/* The room's own summary (off unless turned on here): the representative's summary model writes it for everyone. */}
      <SettingRow label={t({ ko: '대화 요약', en: 'Conversation summary' })}>
        <SegmentedControl
          size="xs"
          value={thread.summary_enabled === 1 ? 'on' : 'off'}
          onChange={(mode) => summaryMutation.mutate(mode === 'on')}
          items={[
            { value: 'on', label: t({ ko: '켬', en: 'On' }) },
            { value: 'off', label: t({ ko: '끔', en: 'Off' }) },
          ]}
          ariaLabel={t({ ko: '대화 요약', en: 'Conversation summary' })}
        />
      </SettingRow>
      {thread.summary_enabled === 1 || thread.minutes_paused ? <MinutesRow thread={thread} /> : null}
      <SummaryBlock thread={thread} segments={segments} summaryOn={thread.summary_enabled === 1} />
    </div>
  )
}

/**
 * Where each new summary stretch is also kept as minutes: a linked folder the chat may write (회의록/<date>.md in it).
 * Shown once a folder is linked/chosen, or while private attachment context pauses minutes.
 */
function MinutesRow({ thread }: { thread: CodexChatThread }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const linked = useQuery({ queryKey: threadLinkedFilesQueryKey(thread.id), queryFn: () => getThreadLinkedFiles(thread.id) })
  const folders = (linked.data ?? []).filter((view) => view.kind === 'folder' && view.write && !view.missing)
  const chosen = thread.minutes_folder_id ?? null
  const paused = thread.minutes_paused === true
  const mutation = useMutation({
    mutationFn: (minutesFolderId: string | null) => updateCodexChatThreadContext(thread.id, { minutesFolderId }),
    onSuccess: (updated) => applyChatThreadUpdate(queryClient, updated),
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' }),
  })
  if (!paused && folders.length === 0 && chosen === null) return null
  const lost = chosen !== null && !folders.some((view) => view.id === chosen)
  return (
    <SettingRow
      label={paused ? t({ ko: '회의록 · 일시 중지', en: 'Minutes · Paused' }) : t({ ko: '회의록', en: 'Minutes' })}
      info={paused ? t({ ko: '개인 첨부를 사용한 채팅에서는 공용 회의록을 저장할 수 없어. 선택한 폴더 연결은 끌 수 있어.', en: 'Shared minutes are paused because this chat has used private attachments. You can turn off the selected folder.' }) : undefined}
    >
      <Select
        className="w-48"
        value={chosen ?? ''}
        onChange={(event) => mutation.mutate(event.target.value || null)}
        disabled={mutation.isPending || (paused && chosen === null)}
        aria-invalid={lost || undefined}
        aria-label={t({ ko: '회의록 폴더', en: 'Minutes folder' })}
      >
        <option value="">{t({ ko: '남기지 않음', en: 'Off' })}</option>
        {lost ? <option value={chosen} disabled={paused}>{t({ ko: '연결이 끊긴 폴더', en: 'Unlinked folder' })}</option> : null}
        {folders.map((view) => <option key={view.id} value={view.id} disabled={paused}>{`[${view.name}]/회의록`}</option>)}
      </Select>
    </SettingRow>
  )
}

/** One stretch of the summary (or the plot), edited in place; save and revert show once it differs. */
function SummarySegmentEditor({ threadId, segment, label, muted }: { threadId: number; segment: ChatSummarySegment; label: string; muted?: boolean }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState(segment.content)
  const synced = useRef(segment.content)

  // A newer text from the server (a fold, another tab) replaces the draft only while it holds no edit of its own.
  useEffect(() => {
    setDraft((current) => (current.trim() === synced.current.trim() ? segment.content : current))
    synced.current = segment.content
  }, [segment.content])

  const mutation = useMutation({
    mutationFn: () => runChatThreadDetailMutation(queryClient, threadId, () => editChatSummarySegment(threadId, segment.id, draft)),
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' }),
  })
  const dirty = draft.trim() !== segment.content.trim()

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={3}
        autoGrow
        muted={muted}
        className="min-h-0 resize-y"
        aria-label={label}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDraft(segment.content) }
          if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (!mutation.isPending && draft.trim()) mutation.mutate() }
        }}
      />
      {dirty ? (
        <div className="flex justify-end gap-2">
          <Button type="button" size="xs" variant="ghost" onClick={() => setDraft(segment.content)}>{t({ ko: '되돌리기', en: 'Revert' })}</Button>
          <Button type="button" size="xs" variant="default" onClick={() => mutation.mutate()} disabled={mutation.isPending || !draft.trim()}>{t({ ko: '저장', en: 'Save' })}</Button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * The summary itself, for a direct LLM chat or a room: the plot, the stretches after it, and (folded away) the
 * stretches the plot took in, each edited in place; summarize now, clear, and the last failure when the summary is on.
 */
function SummaryBlock({ thread, segments, summaryOn }: { thread: CodexChatThread; segments: ChatSummarySegment[]; summaryOn: boolean }) {
  const { t, formatDateTime } = useI18n()
  const { showSnackbar } = useSnackbar()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [showFolded, setShowFolded] = useState(false)

  const refresh = () => queryClient.invalidateQueries({ queryKey: codexChatThreadQueryKey(thread.id) })
  const clearMutation = useMutation({
    mutationFn: () => updateCodexChatThreadContext(thread.id, { summary: null }),
    onSuccess: refresh,
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' }),
  })
  const summarizeMutation = useMutation({
    mutationKey: codexChatCompactMutationKey(thread.id),
    mutationFn: () => summarizeCodexChatThread(thread.id),
    onSuccess: refresh,
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '요약하지 못했어.', en: 'Could not summarize.' })), tone: 'error' }),
  })

  const plot = segments.find((segment) => segment.level === 1) ?? null
  const stretches = segments.filter((segment) => segment.level === 0)
  const stretchLabel = (segment: ChatSummarySegment) => t({ ko: '구간 {n}', en: 'Part {n}' }, { n: stretches.indexOf(segment) + 1 })
  const active = stretches.filter((segment) => !plot || segment.until_message_id > plot.until_message_id)
  const folded = stretches.filter((segment) => plot && segment.until_message_id <= plot.until_message_id)
  const clearSummary = async () => {
    const confirmed = await confirm({ title: t({ ko: '요약을 모두 지울까?', en: 'Clear the whole summary?' }), confirmLabel: t({ ko: '지우기', en: 'Clear' }), tone: 'destructive' })
    if (confirmed) clearMutation.mutate()
  }

  return (
    <>
      <div className="flex items-center gap-2 pb-2 pt-4">
        <span className="flex-1 text-sm">{t({ ko: '요약', en: 'Summary' })}</span>
        {thread.summary_updated_date ? <span className="text-xs text-muted-foreground">{formatDateTime(parseServerDate(thread.summary_updated_date))}</span> : null}
        <IconButton variant="ghost" size="icon-sm" onClick={() => void clearSummary()} disabled={segments.length === 0 || clearMutation.isPending} label={t({ ko: '요약 지우기', en: 'Clear summary' })}><Eraser /></IconButton>
        <IconButton variant="secondary" size="icon-sm" onClick={() => summarizeMutation.mutate()} disabled={summarizeMutation.isPending} label={summarizeMutation.isPending ? t({ ko: '요약 중…', en: 'Summarizing…' }) : t({ ko: '지금 요약', en: 'Summarize now' })}>
          {summarizeMutation.isPending ? <LoaderCircle className="animate-spin" /> : <ScrollText />}
        </IconButton>
      </div>
      {summaryOn && thread.summary_error ? (
        <p className="flex items-start gap-1.5 pb-2 text-xs text-warning" role="status">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">{t({ ko: '요약하지 못했어: {error}', en: 'Could not summarize: {error}' }, { error: thread.summary_error })}</span>
        </p>
      ) : null}
      <div className="flex flex-col gap-4">
        {plot ? <SummarySegmentEditor threadId={thread.id} segment={plot} label={t({ ko: '줄거리', en: 'Plot' })} /> : null}
        {active.map((segment) => <SummarySegmentEditor key={segment.id} threadId={thread.id} segment={segment} label={stretchLabel(segment)} />)}
      </div>
      {folded.length > 0 ? (
        <div className="flex flex-col gap-4 pt-4">
          <Button variant="ghost" size="sm" className="w-fit" onClick={() => setShowFolded((value) => !value)} aria-expanded={showFolded}>
            <ChevronDown className={cn('size-4 transition-transform', !showFolded && '-rotate-90')} />
            {t({ ko: '줄거리에 접힌 구간 {count}개', en: '{count} parts folded into the plot' }, { count: folded.length })}
          </Button>
          {showFolded ? folded.map((segment) => <SummarySegmentEditor key={segment.id} threadId={thread.id} segment={segment} label={stretchLabel(segment)} muted />) : null}
        </div>
      ) : null}
    </>
  )
}

/**
 * One LLM chat's context: its author's note, lorebooks, turn window, reply token cap and summary switch (all can
 * follow the profile), and the summary itself — the plot, the stretches after it, and the stretches the plot took in.
 */
export function CodexChatContextView({ thread, profiles, profileEngine, profileModelLabel, segments, profileTurns, profileMaxTokens, profileReasoningBudget, profileSummaryEnabled, profileReaction, noteDefaults }: {
  thread: CodexChatThread
  /** The chat's profile (for the lorebook block's merge and promote). */
  profiles: Array<{ id: number; name: string }>
  /** The profile's engine and model, which the chat's own model picks against. */
  profileEngine: ChatEngine
  profileModelLabel: string
  /** The summary by stretch, the plot first (see ChatSummarySegment). */
  segments: ChatSummarySegment[]
  profileTurns: number | null
  /** The profile's reply cap (null: the server's default) and reasoning budget, shown as the fallback and for the warning. */
  profileMaxTokens: number | null
  profileReasoningBudget: number | null
  profileSummaryEnabled: boolean | null
  /** The profile's completion reaction default, shown beside the chat's own. */
  profileReaction?: Pick<ChatProfileSummary, 'reactionEnabled' | 'reactionSlotId'> | null
  noteDefaults: AuthorNoteDefaults
}) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()

  const onError = (error: unknown) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' })
  const contextMutation = useMutation({
    mutationFn: (patch: Parameters<typeof updateCodexChatThreadContext>[1]) => updateCodexChatThreadContext(thread.id, patch),
    onSuccess: (updated) => applyChatThreadUpdate(queryClient, updated),
    onError,
  })

  const summaryMode: SummaryMode = thread.summary_enabled === null ? 'profile' : thread.summary_enabled === 1 ? 'on' : 'off'
  const profileLabel = t({ ko: '프로필', en: 'Profile' })
  const effectiveMaxTokens = thread.max_tokens ?? profileMaxTokens
  const summaryOn = isChatSummaryEnabled(thread.summary_enabled, profileSummaryEnabled)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4 *:shrink-0">
      <ChatUserProfileRow thread={thread} />
      <ChatModelRow thread={thread} engine={profileEngine} profileModelLabel={profileModelLabel} />
      <AuthorNoteBlock key={thread.id} thread={thread} defaults={noteDefaults} />
      <GenerationReactionSettings thread={thread} profile={profileReaction} />
      <LorebookBlock threadId={thread.id} loreAutoSave={thread.lore_auto_save} profiles={profiles} />
      <LinkedFilesBlock threadId={thread.id} group={thread.kind === 'group'} />
      <SettingRow label={t({ ko: '참고할 최근 턴 수', en: 'Recent turns sent' })}>
        <NumberStepperInput
          allowEmpty
          step={1}
          min={1}
          max={Number.MAX_SAFE_INTEGER}
          className="w-48"
          value={thread.context_turns}
          placeholder={profileTurns !== null ? `${profileLabel} (${profileTurns})` : profileLabel}
          onValueCommit={(value) => contextMutation.mutate({ contextTurns: value.trim() === '' ? null : Number(value) })}
          aria-label={t({ ko: '참고할 최근 턴 수', en: 'Recent turns sent' })}
        />
      </SettingRow>
      <SettingRow label={t({ ko: '최대 출력 토큰', en: 'Max output tokens' })}>
        <div className="flex items-center gap-2">
          {/* The cap covers reasoning too: at or under the reasoning budget, the model may run out before it answers. */}
          {effectiveMaxTokens !== null && profileReasoningBudget !== null && effectiveMaxTokens <= profileReasoningBudget ? (
            <Tip content={t({ ko: '추론 토큰 예산({budget})보다 작아서 답변 없이 끊길 수 있어', en: 'At or under the reasoning budget ({budget}): the reply may be cut before it starts' }, { budget: profileReasoningBudget })} side="top">
              <span className="text-warning"><TriangleAlert className="size-4" aria-hidden /></span>
            </Tip>
          ) : null}
          <NumberStepperInput
            allowEmpty
            shorthand
            step={128}
            min={1}
            max={Number.MAX_SAFE_INTEGER}
            className="w-48"
            value={thread.max_tokens}
            placeholder={profileMaxTokens !== null ? `${profileLabel} (${profileMaxTokens})` : profileLabel}
            onValueCommit={(value) => contextMutation.mutate({ maxTokens: value.trim() === '' ? null : Number(value) })}
            aria-label={t({ ko: '최대 출력 토큰', en: 'Max output tokens' })}
          />
        </div>
      </SettingRow>
      <SettingRow label={t({ ko: '대화 요약', en: 'Conversation summary' })}>
        <SegmentedControl
          size="xs"
          value={summaryMode}
          onChange={(mode) => contextMutation.mutate({ summaryEnabled: mode === 'profile' ? null : mode === 'on' })}
          items={[
            { value: 'profile', label: profileSummaryEnabled === null ? profileLabel : `${profileLabel} (${profileSummaryEnabled ? t({ ko: '켬', en: 'on' }) : t({ ko: '끔', en: 'off' })})` },
            { value: 'on', label: t({ ko: '켬', en: 'On' }) },
            { value: 'off', label: t({ ko: '끔', en: 'Off' }) },
          ]}
          ariaLabel={t({ ko: '대화 요약', en: 'Conversation summary' })}
        />
      </SettingRow>
      {summaryOn || thread.minutes_paused ? <MinutesRow thread={thread} /> : null}

      <SummaryBlock thread={thread} segments={segments} summaryOn={summaryOn} />
    </div>
  )
}

/** One Codex chat's context: its model and author's note, then its memory as Codex reports it (how full, what it used) and folding it now. */
export function CodexEngineContextView({ thread, profiles, profileEngine, profileModelLabel, noteDefaults }: {
  thread: CodexChatThread
  profiles: Array<{ id: number; name: string }>
  profileEngine: ChatEngine
  profileModelLabel: string
  noteDefaults: AuthorNoteDefaults
}) {
  const { t, formatNumber, formatDateTime } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const compactMutation = useMutation({
    mutationKey: codexChatCompactMutationKey(thread.id),
    mutationFn: () => summarizeCodexChatThread(thread.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: codexChatThreadQueryKey(thread.id) }),
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '압축하지 못했어.', en: 'Could not compact.' })), tone: 'error' }),
  })
  const tokens = (value: number | null) => (value === null ? '—' : formatNumber(value))
  const cachedShare = thread.codex_input_tokens ? Math.round(((thread.codex_cached_input_tokens ?? 0) / thread.codex_input_tokens) * 100) : null

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4 *:shrink-0">
      <ChatUserProfileRow thread={thread} />
      <ChatModelRow thread={thread} engine={profileEngine} profileModelLabel={profileModelLabel} />
      <AuthorNoteBlock key={thread.id} thread={thread} defaults={noteDefaults} />
      <LorebookBlock threadId={thread.id} loreAutoSave={thread.lore_auto_save} profiles={profiles} />
      <LinkedFilesBlock threadId={thread.id} group={thread.kind === 'group'} />
      {/* One line: context / model window. Running totals live in its tooltip. */}
      <SettingRow label={t({ ko: '현재 컨텍스트', en: 'Current context' })}>
        <Tip
          className="whitespace-pre-line"
          content={[
            t({ ko: '현재 컨텍스트 / 모델 한도 토큰', en: 'Current context / model window tokens' }),
            `${t({ ko: '누적 입력', en: 'Total input' })}: ${tokens(thread.codex_input_tokens)}${cachedShare !== null ? ` · ${t({ ko: '캐시', en: 'cached' })} ${cachedShare}%` : ''}`,
            `${t({ ko: '누적 출력', en: 'Total output' })}: ${tokens(thread.codex_output_tokens)}`,
          ].join('\n')}
        >
          <span tabIndex={0} className="cursor-help rounded-sm text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/40">{tokens(thread.codex_context_tokens)} / {tokens(thread.codex_context_window)}</span>
        </Tip>
      </SettingRow>

      <div className="flex items-center gap-2 pt-4">
        <span className="flex-1 text-sm">{t({ ko: '압축', en: 'Compaction' })}</span>
        {thread.summary_updated_date ? <span className="text-xs text-muted-foreground">{formatDateTime(parseServerDate(thread.summary_updated_date))}</span> : null}
        <IconButton variant="secondary" size="icon-sm" onClick={() => compactMutation.mutate()} disabled={compactMutation.isPending || !thread.codex_thread_id} label={compactMutation.isPending ? t({ ko: '압축 중…', en: 'Compacting…' }) : t({ ko: '지금 압축', en: 'Compact now' })}>
          {compactMutation.isPending ? <LoaderCircle className="animate-spin" /> : <Shrink />}
        </IconButton>
      </div>
    </div>
  )
}
