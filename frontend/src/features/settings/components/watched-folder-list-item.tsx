import { Badge } from '@/components/ui/badge'
import type { WatchedFolder } from '@/types/folder'
import { SettingsResourceListItem, getWatcherBadgeVariant } from './settings-resource-shared'

interface WatchedFolderListItemProps {
  folder: WatchedFolder
  watcherState?: string
  selected?: boolean
  onOpenOptions: (folderId: number) => void
}

export function WatchedFolderListItem({ folder, watcherState, selected = false, onOpenOptions }: WatchedFolderListItemProps) {
  return (
    <SettingsResourceListItem
      title={
        <>
          <div className="truncate font-medium text-foreground">{folder.folder_name || '이름 없는 폴더'}</div>
          {folder.is_default === 1 ? <Badge variant="secondary">default</Badge> : null}
        </>
      }
      path={folder.folder_path}
      badges={[
        { label: folder.is_active === 1 ? 'active' : 'inactive', variant: folder.is_active === 1 ? 'outline' : 'secondary' },
        { label: `watcher ${watcherState || 'stopped'}`, variant: getWatcherBadgeVariant(watcherState) },
      ]}
      selected={selected}
      onOpenOptions={() => onOpenOptions(folder.id)}
    />
  )
}
