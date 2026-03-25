import { Settings2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { BackupSource } from '@/types/folder'

interface BackupSourceListItemProps {
  source: BackupSource
  selected?: boolean
  onOpenOptions: (sourceId: number) => void
}

function getWatcherBadgeVariant(watcherStatus?: string | null) {
  if (!watcherStatus) {
    return 'secondary' as const
  }

  const normalized = watcherStatus.toLowerCase()
  if (normalized === 'watching') {
    return 'default' as const
  }
  if (normalized === 'error') {
    return 'destructive' as const
  }
  return 'outline' as const
}

export function BackupSourceListItem({ source, selected = false, onOpenOptions }: BackupSourceListItemProps) {
  return (
    <div
      className={[
        'grid gap-3 px-4 py-4 transition-colors md:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)_minmax(220px,0.9fr)_auto] md:items-center',
        selected ? 'bg-surface-high' : 'bg-transparent hover:bg-surface-low/80',
      ].join(' ')}
    >
      <div className="min-w-0 space-y-1">
        <div className="truncate font-medium text-foreground">{source.display_name || '이름 없는 백업 소스'}</div>
      </div>

      <div className="min-w-0 font-mono text-xs text-muted-foreground md:pr-4">
        <div className="break-all">{source.source_path}</div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={source.is_active === 1 ? 'outline' : 'secondary'}>{source.is_active === 1 ? 'active' : 'inactive'}</Badge>
        <Badge variant="outline">mode {source.import_mode}</Badge>
        <Badge variant={getWatcherBadgeVariant(source.watcher_status)}>watcher {source.watcher_status || 'stopped'}</Badge>
      </div>

      <div className="flex justify-end">
        <Button
          type="button"
          size="icon-sm"
          variant={selected ? 'default' : 'outline'}
          title="상세 정보와 수정 열기"
          aria-label="상세 정보와 수정 열기"
          onClick={() => onOpenOptions(source.id)}
        >
          <Settings2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
