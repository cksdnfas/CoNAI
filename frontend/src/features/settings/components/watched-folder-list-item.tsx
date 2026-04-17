import type { WatchedFolder } from '@/types/folder'
import { getWatcherStatusTone, SettingsResourceTableRow, SettingsStatusIcon } from './settings-resource-shared'

interface WatchedFolderListItemProps {
  folder: WatchedFolder
  watcherState?: string
  selected?: boolean
  gridClassName: string
  onOpenOptions: (folderId: number) => void
}

export function WatchedFolderListItem({
  folder,
  watcherState,
  selected = false,
  gridClassName,
  onOpenOptions,
}: WatchedFolderListItemProps) {
  const watcherLabel = watcherState || 'stopped'
  const isWatching = watcherLabel.toLowerCase() === 'watching'

  return (
    <SettingsResourceTableRow
      gridClassName={gridClassName}
      selected={selected}
      onOpenOptions={() => onOpenOptions(folder.id)}
      cells={[
        <div className="min-w-0 space-y-1">
          <div className="truncate font-medium text-foreground">{folder.folder_name || '이름 없는 폴더'}</div>
          {folder.is_default === 1 ? <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">default</div> : null}
        </div>,
        <div className="break-all font-mono text-xs text-muted-foreground">{folder.folder_path}</div>,
        <SettingsStatusIcon checked={folder.is_active === 1} title={folder.is_active === 1 ? 'active' : 'inactive'} />,
        <SettingsStatusIcon
          checked={isWatching}
          tone={getWatcherStatusTone(watcherState)}
          title={`watcher ${watcherLabel}`}
        />,
      ]}
    />
  )
}
