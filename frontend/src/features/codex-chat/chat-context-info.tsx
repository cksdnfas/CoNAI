import { useState } from 'react'
import { ScanText } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { useI18n } from '@/i18n'

/** What the request for one LLM reply carried (stored on the reply by the server). */
type ChatContextMeta = {
  model: string | null
  windowFromMessageId: number | null
  sentMessages: number
  summaryUntilMessageId: number | null
  recalledSegments: number
  lore: string[]
  memories: number
  estimatedTokens: number
  promptTokens?: number | null
}

export function parseContextMeta(value: string | null | undefined): ChatContextMeta | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as ChatContextMeta
    return parsed && typeof parsed.sentMessages === 'number' ? parsed : null
  } catch {
    return null
  }
}

/** An icon on a reply that opens what its request carried: why it remembered (or forgot) what it did. */
export function ChatContextInfo({ meta }: { meta: ChatContextMeta }) {
  const { t, formatNumber } = useI18n()
  const [open, setOpen] = useState(false)
  const rows: Array<[string, string]> = [
    [t({ ko: '모델', en: 'Model' }), meta.model ?? '—'],
    [t({ ko: '원문으로 보낸 메시지', en: 'Messages sent verbatim' }), formatNumber(meta.sentMessages)],
    [t({ ko: '요약', en: 'Summary' }), meta.summaryUntilMessageId !== null ? t({ ko: '있음', en: 'yes' }) : t({ ko: '없음', en: 'none' })],
    [t({ ko: '회상한 지난 일', en: 'Recalled' }), formatNumber(meta.recalledSegments)],
    [t({ ko: '상시 항목', en: 'Always-on entries' }), formatNumber(meta.memories)],
    [t({ ko: '로어', en: 'Lore' }), meta.lore.length ? meta.lore.join(', ') : t({ ko: '없음', en: 'none' })],
    [t({ ko: '토큰', en: 'Tokens' }), meta.promptTokens ? `${formatNumber(meta.promptTokens)} (${t({ ko: '추정', en: 'est.' })} ${formatNumber(meta.estimatedTokens)})` : `${t({ ko: '추정', en: 'est.' })} ${formatNumber(meta.estimatedTokens)}`],
  ]
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span className="inline-flex">
          <IconButton size="icon-xs" variant="ghost" aria-expanded={open} label={t({ ko: '이 답변에 들어간 문맥', en: 'What this reply was given' })} onClick={() => setOpen((value) => !value)}><ScanText /></IconButton>
        </span>
      </PopoverAnchor>
      <PopoverContent align="start" side="top" className="w-72 p-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-words tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  )
}
