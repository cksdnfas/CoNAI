import { useState } from 'react'
import { ChevronDown, Copy } from 'lucide-react'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { ExtractedPromptCardItem } from '@/lib/image-extracted-prompts'

function getPromptToneClassName(tone: ExtractedPromptCardItem['tone']) {
  switch (tone) {
    case 'positive':
      return 'text-secondary'
    case 'negative':
      return 'text-destructive'
    case 'character':
      return 'text-primary'
    default:
      return 'text-foreground'
  }
}

function getPromptBadgeVariant(label: string) {
  return label === '그룹' ? 'default' : 'secondary'
}

interface ExtractedPromptCardProps {
  item: ExtractedPromptCardItem
}

function ExtractedPromptCard({ item }: ExtractedPromptCardProps) {
  const { showSnackbar } = useSnackbar()
  const [expanded, setExpanded] = useState(true)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(item.text)
      showSnackbar({ message: `${item.title}를 클립보드에 복사했어.`, tone: 'info' })
    } catch {
      showSnackbar({ message: `${item.title} 복사에 실패했어.`, tone: 'error' })
    }
  }

  return (
    <section className="overflow-hidden rounded-sm border border-white/8 bg-surface-lowest">
      <div className="flex items-center gap-2 border-b border-white/8 px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground"
          aria-label={expanded ? `${item.title} 접기` : `${item.title} 펼치기`}
        >
          <ChevronDown className={cn('h-4 w-4 transition-transform', expanded ? 'rotate-0' : '-rotate-90')} />
        </button>

        <div className={cn('min-w-0 text-sm font-semibold', getPromptToneClassName(item.tone))}>{item.title}</div>

        <div className="ml-auto flex items-center gap-2">
          {(item.badges ?? []).map((badge) => (
            <Badge key={`${item.id}:${badge}`} variant={getPromptBadgeVariant(badge)} className="tracking-normal normal-case">
              {badge}
            </Badge>
          ))}
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-primary"
            onClick={handleCopy}
            aria-label={`${item.title} 복사`}
          >
            <Copy className="h-4 w-4" />
          </button>
        </div>
      </div>

      {expanded ? <div className="px-4 py-4 text-base leading-8 text-foreground/92 whitespace-pre-wrap break-words">{item.text}</div> : null}
    </section>
  )
}

/** Render reusable extracted prompt cards for image-derived prompt text. */
export function ExtractedPromptSections({ items }: { items: ExtractedPromptCardItem[] }) {
  if (items.length === 0) {
    return null
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <ExtractedPromptCard key={item.id} item={item} />
      ))}
    </div>
  )
}
