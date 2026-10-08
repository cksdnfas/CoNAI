import { useQuery } from '@tanstack/react-query'
import { FieldInfo } from '@/components/ui/field'
import { LoadingState } from '@/components/ui/loading-state'
import { Modal, ModalBody } from '@/components/ui/modal'
import { useI18n } from '@/i18n'
import { previewChatProfile, type ChatProfileInput } from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'

const ROLE_LABELS: Record<string, { ko: string; en: string }> = {
  system: { ko: '시스템', en: 'System' },
  developer: { ko: 'Codex 지시문', en: 'Codex instructions' },
  user: { ko: '사용자 (예시)', en: 'User (example)' },
  assistant: { ko: '캐릭터 (예시)', en: 'Character (example)' },
}

/** Everything a profile sends before the conversation, as the model receives it, with token estimates. */
export function ChatProfilePreviewModal({ open, draft, onClose }: { open: boolean; draft: ChatProfileInput & { id?: number }; onClose: () => void }) {
  const { t, formatNumber } = useI18n()
  const previewQuery = useQuery({
    queryKey: ['codex-chat-profile-preview', JSON.stringify(draft)],
    queryFn: () => previewChatProfile(draft),
    enabled: open,
    staleTime: 0,
    retry: false,
  })
  const preview = previewQuery.data
  const budget = preview?.contextTokens ?? null
  const overBudget = budget !== null && preview !== undefined && preview.tokens.total > budget

  return (
    <Modal open={open} onClose={onClose} title={t({ ko: '프롬프트 미리보기', en: 'Prompt preview' })} widthClassName="max-w-3xl">
      <ModalBody className="space-y-4">
        {previewQuery.isPending ? <LoadingState variant="inline" /> : null}
        {previewQuery.isError ? <p className="text-sm text-destructive">{getErrorMessage(previewQuery.error, t({ ko: '미리보기를 만들지 못했어.', en: 'Could not build the preview.' }))}</p> : null}
        {preview ? (
          <>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
              <div><dt className="text-xs text-muted-foreground">{t({ ko: '프롬프트', en: 'Prompt' })}</dt><dd className="tabular-nums">≈ {formatNumber(preview.tokens.prompt)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t({ ko: '도구 설명 ({count}개)', en: 'Tool schemas ({count})' }, { count: preview.tools.length })}</dt><dd className="tabular-nums">≈ {formatNumber(preview.tokens.tools)}</dd></div>
              <div>
                <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                  {t({ ko: '합계', en: 'Total' })}
                  <FieldInfo>
                    {preview.engine === 'codex'
                      ? t({ ko: 'Codex에는 이 지시문이 넘어가고, 대화 기억은 Codex가 직접 관리해. 토큰 수는 추정치야.', en: 'Codex receives these instructions and manages the conversation itself. Token counts are estimates.' })
                      : t({ ko: '실제 요청에서는 이 뒤에 요약(켜져 있으면)과 최근 대화가 붙고, 키워드로 걸린 로어는 끝에서 {depth}턴 앞의 메시지에 들어가. 토큰 수는 추정치이고, 대화를 하면 서버가 알려준 사용량으로 보정돼.', en: 'Real requests add the summary (when on) and recent turns after this; keyword lore goes into the message {depth} turns before the end. Counts are estimates, calibrated from real usage once you chat.' }, { depth: draft.loreDepth ?? 4 })}
                  </FieldInfo>
                </dt><dd className={cn('tabular-nums font-semibold', overBudget && 'text-destructive')}>≈ {formatNumber(preview.tokens.total)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t({ ko: '컨텍스트 길이', en: 'Context length' })}</dt><dd className="tabular-nums">{budget !== null ? formatNumber(budget) : t({ ko: '제한 없음', en: 'No limit' })}</dd></div>
            </dl>
            {overBudget ? <p className="text-xs text-destructive">{t({ ko: '대화 전에 이미 컨텍스트 길이를 넘어. 섹션을 줄이거나 도구를 덜 고르거나 길이를 늘려줘.', en: 'This already exceeds the context length before any conversation.' })}</p> : null}
            <div className="space-y-3">
              {preview.messages.map((message, index) => (
                <section key={index} className="space-y-1">
                  <h4 className="text-xs font-semibold text-muted-foreground">{t(ROLE_LABELS[message.role] ?? { ko: message.role, en: message.role })}</h4>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-surface-low p-3 font-mono text-xs leading-relaxed">{message.content}</pre>
                </section>
              ))}
              {preview.tools.length > 0 ? (
                <section className="space-y-1">
                  <h4 className="text-xs font-semibold text-muted-foreground">{t({ ko: '도구', en: 'Tools' })}</h4>
                  <p className="break-words font-mono text-xs leading-relaxed">{preview.tools.join(', ')}</p>
                </section>
              ) : null}
            </div>
          </>
        ) : null}
      </ModalBody>
    </Modal>
  )
}
