import { Fragment, type ReactNode } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Check, ImageOff, Wrench, X } from 'lucide-react'
import { Spinner } from '@/components/ui/loading-state'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import type { CodexChatMessage, CodexChatToolCall } from '@/lib/api-codex-chat'
import { requestJson } from '@/lib/api-request'
import { buildApiUrl } from '@/lib/api-url'
import type { GenerationHistoryRecord } from '@/lib/api-image-generation-types'

const HISTORY_POLL_MS = 3000
const CODE_FENCE_PATTERN = /```[^\n]*\n?([\s\S]*?)```/g
const INLINE_PATTERN = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(INLINE_PATTERN).map((part, index) => {
    const key = `${keyPrefix}-${index}`
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={key} className="font-semibold">{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={key} className="rounded-sm bg-surface-high px-1 py-0.5 font-mono text-[0.85em]">{part.slice(1, -1)}</code>
    }
    return <Fragment key={key}>{part}</Fragment>
  })
}

/** Just enough Markdown for chat replies: fenced code blocks, **bold** and `inline code`; the rest stays plain text. */
function ChatText({ text }: { text: string }) {
  const nodes: ReactNode[] = []
  let cursor = 0
  for (const match of text.matchAll(CODE_FENCE_PATTERN)) {
    const start = match.index ?? 0
    nodes.push(...renderInline(text.slice(cursor, start), `t${start}`))
    nodes.push(
      <pre key={`c${start}`} className="my-2 overflow-x-auto rounded-sm bg-surface-high p-3 font-mono text-xs leading-relaxed">{match[1]}</pre>,
    )
    cursor = start + match[0].length
  }
  nodes.push(...renderInline(text.slice(cursor), 'end'))
  return <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{nodes}</div>
}
const THUMB_CLASS = 'h-28 w-auto max-w-[14rem] rounded-sm object-cover'

function LibraryThumb({ compositeHash }: { compositeHash: string }) {
  return (
    <Link to={`/images/${compositeHash}`} className="shrink-0">
      <img src={buildApiUrl(`/api/images/${compositeHash}/thumbnail`)} alt="" loading="lazy" className={THUMB_CLASS} />
    </Link>
  )
}

function historyQueryOptions(historyId: number) {
  return {
    queryKey: ['codex-chat-history', historyId] as const,
    queryFn: () => requestJson<{ success: boolean; record: GenerationHistoryRecord }>(`/api/generation-history/${historyId}`, { cache: 'no-store' }),
    refetchInterval: (query: { state: { data?: { record: GenerationHistoryRecord } } }) => {
      const status = query.state.data?.record.generation_status
      return status === 'completed' || status === 'failed' ? false : HISTORY_POLL_MS
    },
    retry: false,
  }
}

function resolveHistoryHash(record: GenerationHistoryRecord | undefined) {
  return record?.actual_composite_hash ?? record?.composite_hash ?? null
}

/** A generation result: polls the history row until its image lands, then links to the library image. */
function HistoryThumb({ historyId }: { historyId: number }) {
  const historyQuery = useQuery(historyQueryOptions(historyId))
  const record = historyQuery.data?.record
  const compositeHash = resolveHistoryHash(record)

  if (record?.generation_status === 'completed' && compositeHash) {
    return <LibraryThumb compositeHash={compositeHash} />
  }

  return (
    <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-sm bg-surface-high text-muted-foreground">
      {historyQuery.isError || record?.generation_status === 'failed' ? <ImageOff className="size-5" /> : <Spinner size="md" />}
    </div>
  )
}

type ToolCallGroup = { tool: string; count: number; status: CodexChatToolCall['status']; summary: string | null }

/** Agents poll (`get_generation_job` ×N); one row per tool keeps the reply readable. The last call speaks for the group. */
function groupToolCalls(calls: CodexChatToolCall[]): ToolCallGroup[] {
  const groups = new Map<string, ToolCallGroup>()
  for (const call of calls) {
    const group = groups.get(call.tool)
    groups.set(call.tool, {
      tool: call.tool,
      count: (group?.count ?? 0) + 1,
      status: group?.status === 'running' || call.status === 'running' ? 'running' : call.status,
      summary: call.summary ?? group?.summary ?? null,
    })
  }
  return [...groups.values()]
}

function ToolCallRow({ group }: { group: ToolCallGroup }) {
  const icon = group.status === 'running'
    ? <Spinner size="sm" />
    : group.status === 'failed'
      ? <X className="size-3.5 text-destructive" />
      : <Check className="size-3.5" />

  const row = (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Wrench className="size-3.5 shrink-0" />
      <span className="truncate font-mono">{group.tool}</span>
      {group.count > 1 ? <span className="tabular-nums">×{group.count}</span> : null}
      {icon}
    </div>
  )

  return group.summary
    ? <Tip content={<span className="whitespace-pre-wrap break-words font-mono text-xs">{group.summary}</span>} side="bottom" align="start">{row}</Tip>
    : row
}

export function CodexChatToolCalls({ calls }: { calls: CodexChatToolCall[] }) {
  const historyIds = [...new Set(calls.flatMap((call) => call.historyIds))]
  // History rows resolve to library images too; skip hashes a history thumbnail already shows.
  const historyQueries = useQueries({ queries: historyIds.map((historyId) => historyQueryOptions(historyId)) })
  const historyHashes = new Set(historyQueries.map((query) => resolveHistoryHash(query.data?.record)).filter(Boolean))
  const compositeHashes = [...new Set(calls.flatMap((call) => call.compositeHashes))].filter((hash) => !historyHashes.has(hash))

  if (calls.length === 0) {
    return null
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {groupToolCalls(calls).map((group) => <ToolCallRow key={group.tool} group={group} />)}
      </div>
      {historyIds.length > 0 || compositeHashes.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {historyIds.map((historyId) => <HistoryThumb key={`h${historyId}`} historyId={historyId} />)}
          {compositeHashes.map((hash) => <LibraryThumb key={hash} compositeHash={hash} />)}
        </div>
      ) : null}
    </div>
  )
}

export function CodexChatUserMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-surface-high px-3.5 py-2 text-sm text-foreground">{content}</div>
    </div>
  )
}

export function CodexChatAssistantMessage({ content, toolCalls, status, error, streaming = false }: {
  content: string
  toolCalls: CodexChatToolCall[]
  status?: CodexChatMessage['status']
  error?: string | null
  streaming?: boolean
}) {
  const { t } = useI18n()

  return (
    <div className="space-y-2">
      <CodexChatToolCalls calls={toolCalls} />
      {content ? <ChatText text={content} /> : null}
      {streaming && !content ? <Spinner size="sm" className="text-muted-foreground" /> : null}
      {status === 'interrupted' ? <p className="text-xs text-muted-foreground">{t({ ko: '중단됨', en: 'Stopped' })}</p> : null}
      {status === 'failed' ? <p className="whitespace-pre-wrap break-words text-xs text-destructive">{error || t({ ko: '응답 실패', en: 'Reply failed' })}</p> : null}
    </div>
  )
}
