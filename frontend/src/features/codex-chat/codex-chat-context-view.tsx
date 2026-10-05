import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { TriangleAlert } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Button } from '@/components/ui/button'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { SettingRow } from '@/components/ui/setting-row'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Textarea } from '@/components/ui/textarea'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { summarizeCodexChatThread, updateCodexChatThreadContext, updateGroupChat, updateGroupChatMember, type ChatGroupInfo, type ChatProfileSummary, type CodexChatThread, type CodexChatThreadDetail } from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { ChatProfileAvatar } from './chat-profile-avatar'
import { ChatUserProfileRow } from './chat-user-profiles'
import { CODEX_CHAT_THREADS_QUERY_KEY, codexChatThreadQueryKey } from './codex-chat-context'

type SummaryMode = 'profile' | 'on' | 'off'

/** SQLite `CURRENT_TIMESTAMP` is UTC without a zone marker. */
function parseServerDate(value: string) {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`)
}

const NOTE_SAVE_DELAY_MS = 600

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

  useEffect(() => {
    setDraft(stored)
  }, [stored])

  const mutation = useMutation({
    mutationFn: (patch: { authorNote?: string | null; authorNoteDepth?: number | null }) => updateCodexChatThreadContext(thread.id, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: codexChatThreadQueryKey(thread.id) }),
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' }),
  })
  const { mutate } = mutation

  useEffect(() => {
    if (draft.trim() === stored.trim()) return
    const timer = window.setTimeout(() => mutate({ authorNote: draft.trim() || null }), NOTE_SAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [draft, stored, mutate])

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
          className="w-44"
          value={thread.author_note_depth ?? null}
          placeholder={defaults.depth !== null ? t({ ko: '{label} ({depth}턴 앞)', en: '{label} ({depth} turns back)' }, { label: profileLabel, depth: defaults.depth }) : profileLabel}
          onValueCommit={(value) => mutate({ authorNoteDepth: value.trim() === '' ? null : Number(value) })}
          aria-label={t({ ko: '작가 노트 위치 (끝에서 몇 턴 앞)', en: "Author's note depth (turns from the end)" })}
        />
      </div>
      <Textarea
        id={`author-note-${thread.id}`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={3}
        className="text-sm leading-relaxed"
        placeholder={defaults.note || t({ ko: '작가 노트', en: "Author's note" })}
      />
    </div>
  )
}

/**
 * A group room's context: the room's author's note and reply token caps — one for the room, then one per LLM member
 * that overrides it (members keep their own windows and memories). A Codex member has no hard cap, so it is not listed.
 */
export function GroupContextView({ thread, group, profilesById }: {
  thread: CodexChatThread
  group: ChatGroupInfo | null
  profilesById: Map<number, ChatProfileSummary>
}) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const applied = (detail: CodexChatThreadDetail) => {
    queryClient.setQueryData(codexChatThreadQueryKey(thread.id), detail)
    void queryClient.invalidateQueries({ queryKey: CODEX_CHAT_THREADS_QUERY_KEY })
  }
  const onError = (error: unknown) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' })
  const roomMutation = useMutation({ mutationFn: (maxTokens: number | null) => updateGroupChat(thread.id, { maxTokens }), onSuccess: applied, onError })
  const memberMutation = useMutation({
    mutationFn: ({ profileId, maxTokens }: { profileId: number; maxTokens: number | null }) => updateGroupChatMember(thread.id, profileId, { maxTokens }),
    onSuccess: applied,
    onError,
  })
  const llmMembers = (group?.memberIds ?? []).flatMap((id) => profilesById.get(id) ?? []).filter((member) => member.engine === 'llm')
  const roomLabel = t({ ko: '방', en: 'Room' })
  const profileLabel = t({ ko: '프로필', en: 'Profile' })
  const capLabel = t({ ko: '최대 출력 토큰', en: 'Max output tokens' })
  const commit = (value: string) => (value.trim() === '' ? null : Number(value))

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4">
      <ChatUserProfileRow thread={thread} />
      <AuthorNoteBlock thread={thread} defaults={{ note: '', depth: null }} />
      {group ? (
        <>
          <SettingRow label={capLabel}>
            <NumberStepperInput
              allowEmpty
              step={128}
              min={1}
              max={1000000}
              className="w-44"
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
              <SettingRow
                key={member.id}
                label={(
                  <span className="flex items-center gap-2">
                    <ChatProfileAvatar name={member.name} avatar={member.avatar} engine={member.engine} size="sm" />
                    <span className="truncate">@{member.name}</span>
                  </span>
                )}
              >
                <div className="flex items-center gap-2">
                  {effective !== null && member.reasoningBudgetTokens !== null && effective <= member.reasoningBudgetTokens ? (
                    <Tip content={t({ ko: '추론 토큰 예산({budget})보다 작아서 답변 없이 끊길 수 있어', en: 'At or under the reasoning budget ({budget}): the reply may be cut before it starts' }, { budget: member.reasoningBudgetTokens })} side="top">
                      <span className="text-warning"><TriangleAlert className="size-4" aria-hidden /></span>
                    </Tip>
                  ) : null}
                  <NumberStepperInput
                    allowEmpty
                    step={128}
                    min={1}
                    max={1000000}
                    className="w-44"
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
    </div>
  )
}

/** One LLM chat's context: its author's note, turn window, reply token cap and summary switch (all can follow the profile), and the summary itself. */
export function CodexChatContextView({ thread, profileTurns, profileMaxTokens, profileReasoningBudget, profileSummaryEnabled, noteDefaults }: {
  thread: CodexChatThread
  profileTurns: number | null
  /** The profile's reply cap (null: the server's default) and reasoning budget, shown as the fallback and for the warning. */
  profileMaxTokens: number | null
  profileReasoningBudget: number | null
  profileSummaryEnabled: boolean | null
  noteDefaults: AuthorNoteDefaults
}) {
  const { t, formatDateTime } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [summaryDraft, setSummaryDraft] = useState(thread.summary ?? '')

  useEffect(() => {
    setSummaryDraft(thread.summary ?? '')
  }, [thread.summary])

  const refresh = () => queryClient.invalidateQueries({ queryKey: codexChatThreadQueryKey(thread.id) })
  const onError = (error: unknown) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' })
  const contextMutation = useMutation({
    mutationFn: (patch: Parameters<typeof updateCodexChatThreadContext>[1]) => updateCodexChatThreadContext(thread.id, patch),
    onSuccess: refresh,
    onError,
  })
  const summarizeMutation = useMutation({
    mutationFn: () => summarizeCodexChatThread(thread.id),
    onSuccess: refresh,
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '요약하지 못했어.', en: 'Could not summarize.' })), tone: 'error' }),
  })

  const summaryMode: SummaryMode = thread.summary_enabled === null ? 'profile' : thread.summary_enabled === 1 ? 'on' : 'off'
  const profileLabel = t({ ko: '프로필', en: 'Profile' })
  const summaryDirty = summaryDraft.trim() !== (thread.summary ?? '').trim()
  const effectiveMaxTokens = thread.max_tokens ?? profileMaxTokens

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4">
      <ChatUserProfileRow thread={thread} />
      <AuthorNoteBlock thread={thread} defaults={noteDefaults} />
      <SettingRow label={t({ ko: '참고할 최근 턴 수', en: 'Recent turns sent' })}>
        <NumberStepperInput
          allowEmpty
          step={1}
          min={1}
          max={200}
          className="w-44"
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
            step={128}
            min={1}
            max={1000000}
            className="w-44"
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

      <div className="flex items-center gap-2 pb-2 pt-4">
        <span className="flex-1 text-sm">{t({ ko: '요약', en: 'Summary' })}</span>
        {thread.summary_updated_date ? <span className="text-xs text-muted-foreground">{formatDateTime(parseServerDate(thread.summary_updated_date))}</span> : null}
        <Button size="sm" variant="secondary" onClick={() => summarizeMutation.mutate()} disabled={summarizeMutation.isPending}>
          {summarizeMutation.isPending ? t({ ko: '요약 중…', en: 'Summarizing…' }) : t({ ko: '지금 요약', en: 'Summarize now' })}
        </Button>
      </div>
      <Textarea
        value={summaryDraft}
        onChange={(event) => setSummaryDraft(event.target.value)}
        rows={10}
        className="min-h-48 flex-1 text-sm leading-relaxed"
        placeholder={t({ ko: '아직 요약이 없어.', en: 'No summary yet.' })}
        aria-label={t({ ko: '요약', en: 'Summary' })}
      />
      {summaryDirty ? (
        <div className="flex justify-end gap-2 pt-2">
          <Button size="sm" variant="ghost" onClick={() => setSummaryDraft(thread.summary ?? '')}>{t({ ko: '되돌리기', en: 'Revert' })}</Button>
          <Button size="sm" onClick={() => contextMutation.mutate({ summary: summaryDraft })} disabled={contextMutation.isPending}>{t({ ko: '요약 저장', en: 'Save summary' })}</Button>
        </div>
      ) : null}
    </div>
  )
}

/** One Codex chat's context: its author's note, then its memory as Codex reports it (how full, what it used) and folding it now. */
export function CodexEngineContextView({ thread, compactTokens, noteDefaults }: { thread: CodexChatThread; compactTokens: number | null; noteDefaults: AuthorNoteDefaults }) {
  const { t, formatNumber, formatDateTime } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const compactMutation = useMutation({
    mutationFn: () => summarizeCodexChatThread(thread.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: codexChatThreadQueryKey(thread.id) }),
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '압축하지 못했어.', en: 'Could not compact.' })), tone: 'error' }),
  })
  const tokens = (value: number | null) => (value === null ? '—' : formatNumber(value))
  const cachedShare = thread.codex_input_tokens ? Math.round(((thread.codex_cached_input_tokens ?? 0) / thread.codex_input_tokens) * 100) : null

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4">
      <ChatUserProfileRow thread={thread} />
      <AuthorNoteBlock thread={thread} defaults={noteDefaults} />
      <SettingRow label={t({ ko: '현재 컨텍스트', en: 'Current context' })}>
        <span className="text-sm tabular-nums">{tokens(thread.codex_context_tokens)} / {tokens(compactTokens)}</span>
      </SettingRow>
      <SettingRow label={t({ ko: '모델 한도', en: 'Model window' })}>
        <span className="text-sm tabular-nums">{tokens(thread.codex_context_window)}</span>
      </SettingRow>
      <SettingRow label={t({ ko: '누적 입력', en: 'Total input' })}>
        <span className="text-sm tabular-nums">
          {tokens(thread.codex_input_tokens)}
          {cachedShare !== null ? <span className="text-muted-foreground"> · {t({ ko: '캐시', en: 'cached' })} {cachedShare}%</span> : null}
        </span>
      </SettingRow>
      <SettingRow label={t({ ko: '누적 출력', en: 'Total output' })}>
        <span className="text-sm tabular-nums">{tokens(thread.codex_output_tokens)}</span>
      </SettingRow>

      <div className="flex items-center gap-2 pt-4">
        <span className="flex-1 text-sm">{t({ ko: '압축', en: 'Compaction' })}</span>
        {thread.summary_updated_date ? <span className="text-xs text-muted-foreground">{formatDateTime(parseServerDate(thread.summary_updated_date))}</span> : null}
        <Button size="sm" variant="secondary" onClick={() => compactMutation.mutate()} disabled={compactMutation.isPending || !thread.codex_thread_id}>
          {compactMutation.isPending ? t({ ko: '압축 중…', en: 'Compacting…' }) : t({ ko: '지금 압축', en: 'Compact now' })}
        </Button>
      </div>
    </div>
  )
}
