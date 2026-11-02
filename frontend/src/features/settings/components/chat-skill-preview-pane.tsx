import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { RefreshCw, TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { CodeBlock } from '@/components/ui/code-block'
import { EditorPaneHeader } from '@/components/ui/editor-split'
import { ErrorState } from '@/components/ui/error-state'
import { IconButton } from '@/components/ui/icon-button'
import { LoadingState } from '@/components/ui/loading-state'
import { Select } from '@/components/ui/select'
import { Text } from '@/components/ui/text'
import { useI18n } from '@/i18n'
import { previewChatSkill, type ChatSkillSnapshot } from '@/lib/api-codex-chat'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { useTokenLabel } from './chat-skill-editor-panes'

// A query key holding the draft itself would be hashed in full on every render; each settled draft gets a number instead.
const draftStamps = new WeakMap<ChatSkillSnapshot, number>()
let lastStamp = 0
function draftStamp(draft: ChatSkillSnapshot) {
  let stamp = draftStamps.get(draft)
  if (stamp === undefined) {
    stamp = ++lastStamp
    draftStamps.set(draft, stamp)
  }
  return stamp
}

/**
 * 모델이 보는 모습: the server renders the draft exactly as the chat model gets it — the system prompt line, use_skill's
 * first result (overview + table) and one section's result — with token counts and quality hints. It follows the
 * draft after typing pauses (`draft` keeps its identity until the draft changes).
 */
export function SkillPreviewPane({ draft, skillId }: { draft: ChatSkillSnapshot; skillId: number | null }) {
  const { t } = useI18n()
  const tokenLabel = useTokenLabel()
  const settled = useDebouncedValue(draft, 700)
  const [path, setPath] = useState<string | null>(null)
  const previewQuery = useQuery({
    queryKey: ['codex-chat-skill-preview', skillId, draftStamp(settled)],
    queryFn: ({ signal }) => previewChatSkill({ ...settled, ...(skillId === null ? {} : { skillId }) }, signal),
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    gcTime: 30_000,
    retry: false,
  })
  const preview = previewQuery.data
  const section = preview?.sections.find((entry) => entry.path === path) ?? preview?.sections[0]
  const sectionTotal = preview ? Object.values(preview.tokens.sections).reduce((sum, value) => sum + value, 0) : 0

  return (
    <div>
      <EditorPaneHeader
        title={t({ ko: '모델이 보는 모습', en: 'What the model sees' })}
        info={t({ ko: '저장하지 않은 지금 초안을 모델이 받는 그대로 보여줘. 토큰은 대략이야.', en: 'The unsaved draft exactly as the model receives it. Token counts are rough.' })}
        actions={<IconButton size="icon-sm" variant="ghost" disabled={previewQuery.isFetching} onClick={() => void previewQuery.refetch()} label={t({ ko: '다시 보기', en: 'Refresh' })}><RefreshCw /></IconButton>}
      />
      {previewQuery.isError ? <ErrorState size="compact" title={t({ ko: '미리 보지 못했어', en: 'Could not preview' })} error={previewQuery.error} onRetry={() => void previewQuery.refetch()} /> : null}
      {!preview && previewQuery.isPending ? <LoadingState /> : null}
      {preview ? (
        <div className="space-y-4" aria-busy={previewQuery.isFetching || undefined}>
          {preview.warnings.length > 0 ? (
            <Alert variant="warning">
              <TriangleAlert />
              <AlertDescription>
                <ul className="list-disc space-y-0.5 pl-4">
                  {preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
          <Text variant="caption">
            {t({ ko: '항상 {index} · 불러오면 {overview} · 섹션 전부 {sections} 토큰', en: 'Always {index} · when loaded {overview} · all sections {sections} tokens' }, { index: tokenLabel(preview.tokens.index), overview: tokenLabel(preview.tokens.overview), sections: tokenLabel(sectionTotal) })}
          </Text>
          <div className="space-y-1.5">
            <Text variant="label">{t({ ko: '시스템 프롬프트에 들어가는 줄 · {tokens}', en: 'System prompt line · {tokens}' }, { tokens: tokenLabel(preview.tokens.index) })}</Text>
            <CodeBlock>{preview.index}</CodeBlock>
          </div>
          <div className="space-y-1.5">
            <Text variant="label">{t({ ko: 'use_skill 첫 결과 (개요 + 목차) · {tokens}', en: 'use_skill first result (overview + table) · {tokens}' }, { tokens: tokenLabel(preview.tokens.overview) })}</Text>
            <CodeBlock maxHeight="lg">{preview.overview}</CodeBlock>
          </div>
          {section ? (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Text variant="label">{t({ ko: '섹션을 불렀을 때', en: 'When a section is loaded' })}</Text>
                <Select variant="settings" mono controlSize="compact" className="w-64 max-w-full" aria-label={t({ ko: '섹션', en: 'Section' })} value={section.path} onChange={(event) => setPath(event.target.value)}>
                  {preview.sections.map((entry) => <option key={entry.path} value={entry.path}>{entry.path}</option>)}
                </Select>
                <Text as="span" variant="caption">{tokenLabel(preview.tokens.sections[section.path] ?? 0)}</Text>
              </div>
              <CodeBlock maxHeight="lg">{section.text}</CodeBlock>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
