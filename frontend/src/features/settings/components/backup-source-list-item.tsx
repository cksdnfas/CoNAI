import type { BackupSource } from '@/types/folder'
import { SettingsResourceListItem, getWatcherBadgeVariant } from './settings-resource-shared'

interface BackupSourceListItemProps {
  source: BackupSource
  selected?: boolean
  onOpenOptions: (sourceId: number) => void
}

export function BackupSourceListItem({ source, selected = false, onOpenOptions }: BackupSourceListItemProps) {
  return (
    <SettingsResourceListItem
      title={<div className="truncate font-medium text-foreground">{source.display_name || '이름 없는 백업 소스'}</div>}
      path={source.source_path}
      badges={[
        { label: source.is_active === 1 ? 'active' : 'inactive', variant: source.is_active === 1 ? 'outline' : 'secondary' },
        { label: `mode ${source.import_mode}`, variant: 'outline' },
        { label: `watcher ${source.watcher_status || 'stopped'}`, variant: getWatcherBadgeVariant(source.watcher_status) },
      ]}
      selected={selected}
      onOpenOptions={() => onOpenOptions(source.id)}
    />
  )
}
