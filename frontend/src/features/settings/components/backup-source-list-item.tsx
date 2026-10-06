import { Archive } from 'lucide-react'
import { Chip } from '@/components/ui/chip'
import { ResourceRow } from '@/components/ui/resource-row'
import { useI18n } from '@/i18n'
import type { BackupSource } from '@/types/folder'
import { WatchProblem } from './settings-resource-shared'

interface BackupSourceListItemProps {
  source: BackupSource
  onOpenOptions: (sourceId: number) => void
}

export function BackupSourceListItem({ source, onOpenOptions }: BackupSourceListItemProps) {
  const { t } = useI18n()
  const route = `${source.source_path} → Upload/${source.target_folder_name}`

  return (
    <ResourceRow
      leading={<Archive />}
      name={source.display_name || t('backupSourceListItem.unnamedBackupSource')}
      extra={(
        <Chip size="sm" tone="muted">
          {source.import_mode === 'convert_webp' ? t({ ko: 'WebP 변환', en: 'WebP' }) : t({ ko: '원본 복사', en: 'Original' })}
        </Chip>
      )}
      meta={(
        <>
          <WatchProblem isActive={source.is_active === 1} watcherEnabled={source.watcher_enabled === 1} watcherState={source.watcher_status} />
          <span className="font-mono" title={route}>{route}</span>
        </>
      )}
      onOpen={() => onOpenOptions(source.id)}
    />
  )
}
