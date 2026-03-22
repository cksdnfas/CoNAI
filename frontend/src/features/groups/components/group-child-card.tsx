import { ChevronRight } from 'lucide-react'
import { getGroupThumbnailUrl } from '@/lib/api'
import type { GroupWithHierarchy } from '@/types/group'

interface GroupChildCardProps {
  group: GroupWithHierarchy
  onOpen: (groupId: number) => void
}

export function GroupChildCard({ group, onOpen }: GroupChildCardProps) {
  return (
    <button
      type="button"
      onClick={() => onOpen(group.id)}
      className="group flex w-full items-center gap-4 rounded-sm bg-surface-low p-4 text-left transition-colors hover:bg-surface-high"
    >
      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-surface-lowest">
        <img
          src={getGroupThumbnailUrl(group.id)}
          alt={group.name}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={(event) => {
            event.currentTarget.style.display = 'none'
          }}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{group.name}</p>
        <p className="mt-1 text-xs text-muted-foreground">{group.image_count.toLocaleString('ko-KR')} images</p>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </button>
  )
}
