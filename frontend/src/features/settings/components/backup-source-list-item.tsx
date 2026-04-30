import { useI18n } from '@/i18n'
import type { BackupSource } from '@/types/folder'
import { getWatcherStatusTone, SettingsResourceTableRow, SettingsStatusIcon } from './settings-resource-shared'

interface BackupSourceListItemProps {
  source: BackupSource
  selected?: boolean
  gridClassName: string
  onOpenOptions: (sourceId: number) => void
}

export function BackupSourceListItem({ source, selected = false, gridClassName, onOpenOptions }: BackupSourceListItemProps) {
  const { t } = useI18n()
  const watcherLabel = source.watcher_status || 'stopped'
  const isWatching = watcherLabel.toLowerCase() === 'watching'

  return (
    <SettingsResourceTableRow
      gridClassName={gridClassName}
      selected={selected}
      onOpenOptions={() => onOpenOptions(source.id)}
      cells={[
        <div className="min-w-0 space-y-1">
          <div className="truncate font-medium text-foreground">{source.display_name || t('backupSourceListItem.unnamedBackupSource')}</div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{source.import_mode}</div>
        </div>,
        <div className="break-all font-mono text-xs text-muted-foreground">{source.source_path}</div>,
        <div className="break-all font-mono text-xs text-muted-foreground">Upload/{source.target_folder_name}</div>,
        <SettingsStatusIcon checked={source.is_active === 1} title={source.is_active === 1 ? t({ ko: '활성', en: 'Active' }) : t({ ko: '비활성', en: 'Inactive' })} />,
        <SettingsStatusIcon
          checked={isWatching}
          tone={getWatcherStatusTone(source.watcher_status)}
          title={t({ ko: 'watcher {status}', en: 'Watcher {status}' }, { status: watcherLabel })}
        />,
      ]}
    />
  )
}
