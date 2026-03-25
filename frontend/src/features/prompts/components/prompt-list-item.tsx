import { Copy } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { getThemeToneStyle } from '@/lib/theme-tones'
import type { PromptCollectionItem } from '@/types/prompt'

interface PromptListItemProps {
  item: PromptCollectionItem
  onCopy: (text: string) => void
}

export function PromptListItem({ item, onCopy }: PromptListItemProps) {
  const synonyms = Array.isArray(item.synonyms) ? item.synonyms : []

  return (
    <div className="group grid grid-cols-[minmax(0,1fr)_120px_52px] items-center rounded-sm bg-surface-lowest px-3 py-2 transition-colors hover:bg-surface-high">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-foreground">{item.prompt}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <Badge variant="ghost" style={getThemeToneStyle(item.type === 'positive' ? 'positive' : item.type === 'negative' ? 'negative' : 'auto')}>
            {item.type}
          </Badge>
          {synonyms.length > 0 ? <span>synonyms {synonyms.length}</span> : null}
        </div>
      </div>
      <div className="text-right text-[11px] font-mono text-muted-foreground">{item.usage_count.toLocaleString('ko-KR')}</div>
      <div className="flex justify-end">
        <button
          type="button"
          className="rounded-sm p-2 text-muted-foreground transition-colors hover:text-primary"
          onClick={() => onCopy(item.prompt)}
          aria-label="copy prompt"
        >
          <Copy className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
