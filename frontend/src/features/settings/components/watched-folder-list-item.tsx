import { Folder } from 'lucide-react'
import { Chip } from '@/components/ui/chip'
import { ResourceRow } from '@/components/ui/resource-row'
import { useI18n } from '@/i18n'
import type { WatchedFolder } from '@/types/folder'
import { WatchProblem } from './settings-resource-shared'

interface WatchedFolderListItemProps {
  folder: WatchedFolder
  watcherState?: string
  onOpenOptions: (folderId: number) => void
}

export function WatchedFolderListItem({ folder, watcherState, onOpenOptions }: WatchedFolderListItemProps) {
  const { t } = useI18n()

  return (
    <ResourceRow
      leading={<Folder />}
      name={folder.folder_name || t('watchedFolderListItem.unnamedFolder')}
      extra={folder.is_default === 1 ? <Chip size="sm" tone="muted">{t({ ko: '기본', en: 'Default' })}</Chip> : null}
      meta={(
        <>
          <WatchProblem isActive={folder.is_active === 1} watcherEnabled={folder.watcher_enabled === 1} watcherState={watcherState} />
          <span className="font-mono" title={folder.folder_path}>{folder.folder_path}</span>
        </>
      )}
      onOpen={() => onOpenOptions(folder.id)}
    />
  )
}
