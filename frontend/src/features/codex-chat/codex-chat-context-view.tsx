import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Button } from '@/components/ui/button'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { SettingRow } from '@/components/ui/setting-row'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { summarizeCodexChatThread, updateCodexChatThreadContext, type CodexChatThread } from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { codexChatThreadQueryKey } from './codex-chat-context'

type SummaryMode = 'profile' | 'on' | 'off'

/** SQLite `CURRENT_TIMESTAMP` is UTC without a zone marker. */
function parseServerDate(value: string) {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`)
}

/** One LLM chat's context: its turn window and summary switch (both can follow the profile), and the summary itself. */
export function CodexChatContextView({ thread, profileTurns, profileSummaryEnabled }: {
  thread: CodexChatThread
  profileTurns: number | null
  profileSummaryEnabled: boolean | null
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

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4">
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

/** One Codex chat's memory as Codex reports it: how full it is, what it has used, and folding it now. */
export function CodexEngineContextView({ thread, compactTokens }: { thread: CodexChatThread; compactTokens: number | null }) {
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
