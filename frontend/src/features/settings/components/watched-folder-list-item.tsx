import { useI18n } from '@/i18n'
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
  const { t } = useI18n()
  const watcherLabel = watcherState || 'stopped'
  const isWatching = watcherLabel.toLowerCase() === 'watching'

  return (
    <SettingsResourceTableRow
      gridClassName={gridClassName}
      selected={selected}
      onOpenOptions={() => onOpenOptions(folder.id)}
      cells={[
        <div className="min-w-0 space-y-1">
          <div className="truncate font-medium text-foreground">{folder.folder_name || t('watchedFolderListItem.unnamedFolder')}</div>
          {folder.is_default === 1 ? <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{t({ ko: '기본', en: 'Default' })}</div> : null}
        </div>,
        <div className="break-all font-mono text-xs text-muted-foreground">{folder.folder_path}</div>,
        <SettingsStatusIcon checked={folder.is_active === 1} title={folder.is_active === 1 ? t({ ko: '활성', en: 'Active' }) : t({ ko: '비활성', en: 'Inactive' })} />,
        <SettingsStatusIcon
          checked={isWatching}
          tone={getWatcherStatusTone(watcherState)}
          title={t({ ko: 'watcher {status}', en: 'Watcher {status}' }, { status: watcherLabel })}
        />,
      ]}
    />
  )
}
