import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GroupBreadcrumbItem } from '@/types/group'

interface GroupBreadcrumbsProps {
  items: GroupBreadcrumbItem[]
  selectedGroupId: number
  onOpenGroup: (groupId: number) => void
  onOpenRoot: () => void
}

export function GroupBreadcrumbs({ items, selectedGroupId, onOpenGroup, onOpenRoot }: GroupBreadcrumbsProps) {
  if (items.length === 0) {
    return null
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <button type="button" onClick={onOpenRoot} className="hover:text-foreground">
        Groups
      </button>
      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-2">
          <ChevronRight className="h-4 w-4" />
          <button
            type="button"
            onClick={() => onOpenGroup(item.id)}
            className={cn('hover:text-foreground', item.id === selectedGroupId && 'text-primary')}
          >
            {item.name}
          </button>
        </div>
      ))}
    </div>
  )
}
