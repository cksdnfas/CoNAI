import { ArrowLeft, ChevronRight, Folder } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { GroupBreadcrumbItem } from '@/types/group'
import { useI18n } from '@/i18n'

interface GroupBreadcrumbsProps {
  items: GroupBreadcrumbItem[]
  selectedGroupId: number
  rootLabel: string
  compact?: boolean
  onOpenGroup: (groupId: number) => void
  onOpenRoot: () => void
}

/** Render one compact, consistent path control for group navigation. */
export function GroupBreadcrumbs({ items, selectedGroupId, rootLabel, compact = false, onOpenGroup, onOpenRoot }: GroupBreadcrumbsProps) {
  const { t } = useI18n()

  if (items.length === 0) {
    return null
  }

  const currentItem = items.at(-1)!
  const parentItem = items.at(-2)

  if (compact) {
    return (
      <div className="flex min-h-10 items-center gap-2 rounded-sm bg-surface-lowest px-2 py-1.5">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={() => parentItem ? onOpenGroup(parentItem.id) : onOpenRoot()}
          aria-label={t({ ko: '상위 폴더로 이동', en: 'Go to parent folder' })}
          title={t({ ko: '상위 폴더로 이동', en: 'Go to parent folder' })}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Folder className="h-4 w-4 shrink-0 text-secondary" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{currentItem.name}</span>
      </div>
    )
  }

  return (
    <nav className="flex min-h-10 items-center gap-1 overflow-x-auto rounded-sm bg-surface-lowest px-3 py-1.5 text-sm text-muted-foreground" aria-label={t({ ko: '그룹 경로', en: 'Group path' })}>
      <button type="button" onClick={onOpenRoot} className="inline-flex shrink-0 items-center gap-2 rounded-sm px-1.5 py-1 hover:bg-surface-low hover:text-foreground">
        <Folder className="h-4 w-4 text-secondary" />
        <span>{rootLabel}</span>
      </button>
      {items.map((item) => (
        <div key={item.id} className="flex shrink-0 items-center gap-1">
          <ChevronRight className="h-3.5 w-3.5" />
          <button
            type="button"
            onClick={() => onOpenGroup(item.id)}
            className={cn(
              'max-w-48 truncate rounded-sm px-1.5 py-1 hover:bg-surface-low hover:text-foreground',
              item.id === selectedGroupId && 'font-medium text-foreground',
            )}
          >
            {item.name}
          </button>
        </div>
      ))}
    </nav>
  )
}
