import type { BackupSource } from '@/types/folder'
import { getWatcherStatusTone, SettingsResourceTableRow, SettingsStatusIcon } from './settings-resource-shared'

interface BackupSourceListItemProps {
  source: BackupSource
  selected?: boolean
  gridClassName: string
  onOpenOptions: (sourceId: number) => void
}

export function BackupSourceListItem({ source, selected = false, gridClassName, onOpenOptions }: BackupSourceListItemProps) {
  const watcherLabel = source.watcher_status || 'stopped'
  const isWatching = watcherLabel.toLowerCase() === 'watching'

  return (
    <SettingsResourceTableRow
      gridClassName={gridClassName}
      selected={selected}
      onOpenOptions={() => onOpenOptions(source.id)}
      cells={[
        <div className="min-w-0 space-y-1">
          <div className="truncate font-medium text-foreground">{source.display_name || '이름 없는 백업 소스'}</div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{source.import_mode}</div>
        </div>,
        <div className="break-all font-mono text-xs text-muted-foreground">{source.source_path}</div>,
        <div className="break-all font-mono text-xs text-muted-foreground">Upload/{source.target_folder_name}</div>,
        <SettingsStatusIcon checked={source.is_active === 1} title={source.is_active === 1 ? 'active' : 'inactive'} />,
        <SettingsStatusIcon
          checked={isWatching}
          tone={getWatcherStatusTone(source.watcher_status)}
          title={`watcher ${watcherLabel}`}
        />,
      ]}
    />
  )
}
