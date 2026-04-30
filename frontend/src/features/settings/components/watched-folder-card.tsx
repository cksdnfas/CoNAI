import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Play, RotateCcw, ScanSearch, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { WatchedFolder, WatchedFolderUpdateInput } from '@/types/folder'
import { useI18n } from '@/i18n'
import { formatDateTime, parseCommaSeparatedInput, parseJsonArray, toCommaSeparatedInput } from '../settings-utils'
import { SettingsField, SettingsSection, SettingsToggleRow } from './settings-primitives'
import {
  SettingsResourceFooterActions,
  SettingsResourceMetaList,
  getWatcherBadgeVariant,
} from './settings-resource-shared'

interface WatchedFolderCardProps {
  folder: WatchedFolder
  watcherState?: string
  onSave: (folderId: number, input: WatchedFolderUpdateInput) => Promise<void>
  onScan: (folderId: number, full?: boolean) => Promise<void>
  onStartWatcher: (folderId: number) => Promise<void>
  onStopWatcher: (folderId: number) => Promise<void>
  onRestartWatcher: (folderId: number) => Promise<void>
  onDelete: (folderId: number) => Promise<void>
}

export function WatchedFolderCard({
  folder,
  watcherState,
  onSave,
  onScan,
  onStartWatcher,
  onStopWatcher,
  onRestartWatcher,
  onDelete,
}: WatchedFolderCardProps) {
  const { t, locale, formatNumber } = useI18n()
  const [draft, setDraft] = useState({
    folder_name: folder.folder_name || '',
    auto_scan: folder.auto_scan === 1,
    scan_interval: folder.scan_interval,
    recursive: folder.recursive === 1,
    watcher_enabled: folder.watcher_enabled === 1,
    watcher_polling_interval: folder.watcher_polling_interval ?? 2000,
    is_active: folder.is_active === 1,
    exclude_extensions: toCommaSeparatedInput(parseJsonArray(folder.exclude_extensions)),
    exclude_patterns: toCommaSeparatedInput(parseJsonArray(folder.exclude_patterns)),
  })
  const [isBusy, setIsBusy] = useState(false)

  useEffect(() => {
    setDraft({
      folder_name: folder.folder_name || '',
      auto_scan: folder.auto_scan === 1,
      scan_interval: folder.scan_interval,
      recursive: folder.recursive === 1,
      watcher_enabled: folder.watcher_enabled === 1,
      watcher_polling_interval: folder.watcher_polling_interval ?? 2000,
      is_active: folder.is_active === 1,
      exclude_extensions: toCommaSeparatedInput(parseJsonArray(folder.exclude_extensions)),
      exclude_patterns: toCommaSeparatedInput(parseJsonArray(folder.exclude_patterns)),
    })
  }, [folder])

  const handleAction = async (action: () => Promise<void>) => {
    try {
      setIsBusy(true)
      await action()
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <SettingsSection
      heading={folder.folder_name || t({ ko: '이름 없는 폴더', en: 'Unnamed folder' })}
      bodyClassName="space-y-5"
      actions={
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="icon-sm" variant="outline" disabled={isBusy} onClick={() => void handleAction(() => onScan(folder.id))} title={t({ ko: '폴더 스캔', en: 'Scan folder' })} aria-label={t({ ko: '폴더 스캔', en: 'Scan folder' })}>
            <ScanSearch className="h-4 w-4" />
          </Button>
          <Button type="button" size="icon-sm" variant="outline" disabled={isBusy} onClick={() => void handleAction(() => onStartWatcher(folder.id))} title={t({ ko: 'watcher 시작', en: 'Start watcher' })} aria-label={t({ ko: 'watcher 시작', en: 'Start watcher' })}>
            <Play className="h-4 w-4" />
          </Button>
          <Button type="button" size="icon-sm" variant="outline" disabled={isBusy} onClick={() => void handleAction(() => onStopWatcher(folder.id))} title={t({ ko: 'watcher 중지', en: 'Stop watcher' })} aria-label={t({ ko: 'watcher 중지', en: 'Stop watcher' })}>
            <Square className="h-4 w-4" />
          </Button>
          <Button type="button" size="icon-sm" variant="outline" disabled={isBusy} onClick={() => void handleAction(() => onRestartWatcher(folder.id))} title={t({ ko: 'watcher 재시작', en: 'Restart watcher' })} aria-label={t({ ko: 'watcher 재시작', en: 'Restart watcher' })}>
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      }
    >
      <div className="flex flex-wrap gap-2">
        {folder.is_default === 1 ? <Badge variant="secondary">default</Badge> : null}
        <Badge variant={draft.is_active ? 'outline' : 'secondary'}>{draft.is_active ? 'active' : 'inactive'}</Badge>
        <Badge variant={getWatcherBadgeVariant(watcherState)}>{`watcher ${watcherState || 'stopped'}`}</Badge>
      </div>

      <div className="break-all font-mono text-xs text-muted-foreground">{folder.folder_path}</div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SettingsField label={t({ ko: '표시 이름', en: 'Display name' })}>
          <Input variant="settings" value={draft.folder_name} onChange={(event) => setDraft((current) => ({ ...current, folder_name: event.target.value }))} />
        </SettingsField>

        <SettingsField label={t({ ko: '스캔 주기(분)', en: 'Scan interval (minutes)' })}>
          <Input type="number" min={1} variant="settings" value={draft.scan_interval} onChange={(event) => setDraft((current) => ({ ...current, scan_interval: Number(event.target.value) || 1 }))} />
        </SettingsField>

        <SettingsField label={t({ ko: '제외 확장자', en: 'Excluded extensions' })}>
          <Input variant="settings" value={draft.exclude_extensions} onChange={(event) => setDraft((current) => ({ ...current, exclude_extensions: event.target.value }))} placeholder="tmp, db, txt" />
        </SettingsField>

        <SettingsField label={t({ ko: '제외 패턴', en: 'Excluded patterns' })}>
          <Input variant="settings" value={draft.exclude_patterns} onChange={(event) => setDraft((current) => ({ ...current, exclude_patterns: event.target.value }))} placeholder="@eaDir, thumbs, cache" />
        </SettingsField>

        <SettingsToggleRow>
          <input type="checkbox" checked={draft.auto_scan} onChange={(event) => setDraft((current) => ({ ...current, auto_scan: event.target.checked }))} />
          {t({ ko: '자동 스캔', en: 'Auto scan' })}
        </SettingsToggleRow>

        <SettingsToggleRow>
          <input type="checkbox" checked={draft.recursive} onChange={(event) => setDraft((current) => ({ ...current, recursive: event.target.checked }))} />
          {t({ ko: '하위 폴더 포함', en: 'Include subfolders' })}
        </SettingsToggleRow>

        <SettingsToggleRow>
          <input
            type="checkbox"
            checked={draft.watcher_enabled}
            onChange={(event) => setDraft((current) => ({ ...current, watcher_enabled: event.target.checked }))}
          />
          {t({ ko: 'watcher 사용', en: 'Use watcher' })}
        </SettingsToggleRow>

        <SettingsToggleRow>
          <input type="checkbox" checked={draft.is_active} onChange={(event) => setDraft((current) => ({ ...current, is_active: event.target.checked }))} />
          {t({ ko: '폴더 활성화', en: 'Folder active' })}
        </SettingsToggleRow>
      </div>

      <SettingsResourceMetaList
        items={[
          { label: t({ ko: '최근 스캔', en: 'Latest scan' }), value: formatDateTime(folder.last_scan_date, locale) },
          { label: t({ ko: '최근 상태', en: 'Latest status' }), value: folder.last_scan_status || '—' },
          { label: t({ ko: '최근 신규 이미지', en: 'Latest new images' }), value: formatNumber(folder.last_scan_found) },
        ]}
      />

      <SettingsResourceFooterActions
        dangerLabel={t({ ko: '폴더 제거', en: 'Remove folder' })}
        dangerDisabled={isBusy || folder.is_default === 1}
        onDanger={() => {
          if (!window.confirm(t({ ko: '정말 {name} 폴더를 삭제할까?', en: 'Delete the {name} folder?' }, { name: folder.folder_name || folder.folder_path }))) {
            return
          }
          void handleAction(() => onDelete(folder.id))
        }}
        primaryLabel={isBusy ? t({ ko: '처리 중…', en: 'Processing…' }) : t({ ko: '폴더 설정 저장', en: 'Save folder settings' })}
        primaryDisabled={isBusy}
        onPrimary={() =>
          void handleAction(() =>
            onSave(folder.id, {
              folder_name: draft.folder_name,
              auto_scan: draft.auto_scan,
              scan_interval: draft.scan_interval,
              recursive: draft.recursive,
              watcher_enabled: draft.watcher_enabled,
              watcher_polling_interval: draft.watcher_enabled ? draft.watcher_polling_interval : null,
              exclude_extensions: parseCommaSeparatedInput(draft.exclude_extensions),
              exclude_patterns: parseCommaSeparatedInput(draft.exclude_patterns),
              is_active: draft.is_active,
            }),
          )
        }
      />
    </SettingsSection>
  )
}
