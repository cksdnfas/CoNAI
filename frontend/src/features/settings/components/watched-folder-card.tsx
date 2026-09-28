import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/icon-button'
import { Play, RotateCcw, ScanSearch, Square } from 'lucide-react'
import { Input } from '@/components/ui/input'
import type { WatchedFolder, WatchedFolderUpdateInput } from '@/types/folder'
import { useI18n } from '@/i18n'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { formatDateTime, parseCommaSeparatedInput, parseJsonArray, toCommaSeparatedInput } from '../settings-utils'
import { Field } from '@/components/ui/field'
import { Section } from '@/components/ui/section'
import {
  SettingsResourceFooterActions,
  SettingsResourceMetaList,
  getScanStatusLabel,
  getWatcherBadgeVariant,
  getWatcherStateLabel,
} from './settings-resource-shared'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { SettingsSwitchRow } from './settings-switch-row'

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
  const confirm = useConfirm()
  const [draft, setDraft] = useState({
    folder_name: folder.folder_name || '',
    auto_scan: folder.auto_scan === 1,
    scan_interval: folder.scan_interval,
    recursive: folder.recursive === 1,
    watcher_enabled: folder.watcher_enabled === 1,
    // null = 자동 감지. 값을 채우면 폴링 모드가 강제되므로 저장 시 기본값을 심지 않는다.
    watcher_polling_interval: folder.watcher_polling_interval ?? null,
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
      watcher_polling_interval: folder.watcher_polling_interval ?? null,
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
    <Section
      variant="settings"
      heading={folder.folder_name || t({ ko: '이름 없는 폴더', en: 'Unnamed folder' })}
      bodyClassName="space-y-5"
      actions={
        <div className="flex flex-wrap gap-2">
          <IconButton size="icon-sm" variant="secondary" disabled={isBusy} onClick={() => void handleAction(() => onScan(folder.id))} label={t({ ko: '폴더 스캔', en: 'Scan folder' })}>
            <ScanSearch className="h-4 w-4" />
          </IconButton>
          <IconButton size="icon-sm" variant="secondary" disabled={isBusy} onClick={() => void handleAction(() => onStartWatcher(folder.id))} label={t({ ko: '실시간 감시 시작', en: 'Start watching' })}>
            <Play className="h-4 w-4" />
          </IconButton>
          <IconButton size="icon-sm" variant="secondary" disabled={isBusy} onClick={() => void handleAction(() => onStopWatcher(folder.id))} label={t({ ko: '실시간 감시 중지', en: 'Stop watching' })}>
            <Square className="h-4 w-4" />
          </IconButton>
          <IconButton size="icon-sm" variant="secondary" disabled={isBusy} onClick={() => void handleAction(() => onRestartWatcher(folder.id))} label={t({ ko: '실시간 감시 재시작', en: 'Restart watching' })}>
            <RotateCcw className="h-4 w-4" />
          </IconButton>
        </div>
      }
    >
      <div className="flex flex-wrap gap-2">
        {folder.is_default === 1 ? <Badge variant="secondary">{t({ ko: '기본', en: 'Default' })}</Badge> : null}
        <Badge variant={draft.is_active ? 'outline' : 'secondary'}>{draft.is_active ? t({ ko: '활성', en: 'Active' }) : t({ ko: '비활성', en: 'Inactive' })}</Badge>
        <Badge variant={getWatcherBadgeVariant(watcherState)}>{getWatcherStateLabel(watcherState, t)}</Badge>
      </div>

      <div className="break-all font-mono text-xs text-muted-foreground">{folder.folder_path}</div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Field label={t({ ko: '표시 이름', en: 'Display name' })}>
          <Input variant="settings" value={draft.folder_name} onChange={(event) => setDraft((current) => ({ ...current, folder_name: event.target.value }))} />
        </Field>

        <Field label={t({ ko: '스캔 주기(분)', en: 'Scan interval (minutes)' })}>
          <NumberStepperInput min={1} variant="settings" value={draft.scan_interval} onValueCommit={(nextValue) => setDraft((current) => ({ ...current, scan_interval: Number(nextValue) || 1 }))} />
        </Field>

        <Field label={t({ ko: '폴링 주기(ms)', en: 'Polling interval (ms)' })} hint={t({ ko: '비워두면 자동 (권장)', en: 'Empty = auto (recommended)' })}>
          <NumberStepperInput min={2000} allowEmpty variant="settings" value={draft.watcher_polling_interval} onValueCommit={(nextValue) => setDraft((current) => ({ ...current, watcher_polling_interval: nextValue === '' ? null : Number(nextValue) || null }))} placeholder={t({ ko: '자동 감지', en: 'Auto detect' })} disabled={!draft.watcher_enabled} />
        </Field>

        <Field label={t({ ko: '제외 확장자', en: 'Excluded extensions' })}>
          <Input variant="settings" value={draft.exclude_extensions} onChange={(event) => setDraft((current) => ({ ...current, exclude_extensions: event.target.value }))} placeholder={t({ ko: 'tmp, db, txt', en: 'tmp, db, txt' })} />
        </Field>

        <Field label={t({ ko: '제외 패턴', en: 'Excluded patterns' })}>
          <Input variant="settings" value={draft.exclude_patterns} onChange={(event) => setDraft((current) => ({ ...current, exclude_patterns: event.target.value }))} placeholder={t({ ko: '@eaDir, thumbs, cache', en: '@eaDir, thumbs, cache' })} />
        </Field>

        <SettingsSwitchRow
          checked={draft.auto_scan}
          onCheckedChange={(checked) => setDraft((current) => ({ ...current, auto_scan: checked }))}
          label={t({ ko: '자동 스캔', en: 'Auto scan' })}
        />

        <SettingsSwitchRow
          checked={draft.recursive}
          onCheckedChange={(checked) => setDraft((current) => ({ ...current, recursive: checked }))}
          label={t({ ko: '하위 폴더 포함', en: 'Include subfolders' })}
        />

        <SettingsSwitchRow
          checked={draft.watcher_enabled}
          onCheckedChange={(checked) => setDraft((current) => ({ ...current, watcher_enabled: checked }))}
          label={t({ ko: '실시간 감시 사용', en: 'Watch for changes' })}
        />

        <SettingsSwitchRow
          checked={draft.is_active}
          onCheckedChange={(checked) => setDraft((current) => ({ ...current, is_active: checked }))}
          label={t({ ko: '폴더 활성화', en: 'Folder active' })}
        />
      </div>

      <SettingsResourceMetaList
        items={[
          { label: t({ ko: '최근 스캔', en: 'Latest scan' }), value: formatDateTime(folder.last_scan_date, locale) },
          { label: t({ ko: '최근 상태', en: 'Latest status' }), value: getScanStatusLabel(folder.last_scan_status, t) },
          { label: t({ ko: '최근 신규 이미지', en: 'Latest new images' }), value: formatNumber(folder.last_scan_found) },
        ]}
      />

      <SettingsResourceFooterActions
        dangerLabel={t({ ko: '폴더 제거', en: 'Remove folder' })}
        dangerDisabled={isBusy || folder.is_default === 1}
        onDanger={async () => {
          const confirmed = await confirm({
            title: t({ ko: '폴더 제거', en: 'Remove folder' }),
            description: t({ ko: '정말 {name} 폴더를 삭제할까?', en: 'Delete the {name} folder?' }, { name: folder.folder_name || folder.folder_path }),
            confirmLabel: t({ ko: '삭제', en: 'Delete' }),
            tone: 'destructive',
          })
          if (!confirmed) {
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
    </Section>
  )
}
