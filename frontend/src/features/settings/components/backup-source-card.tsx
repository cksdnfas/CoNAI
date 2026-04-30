import { useEffect, useState } from 'react'
import { CircleHelp, Play, RotateCcw, Square } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import type { BackupSource, BackupSourceUpdateInput } from '@/types/folder'
import { useI18n } from '@/i18n'
import { buildBackupTargetPreviewPath, formatDateTime, normalizeBackupTargetPath } from '../settings-utils'
import { SettingsField, SettingsSection, SettingsToggleRow } from './settings-primitives'
import {
  SettingsResourceFooterActions,
  SettingsResourceMetaList,
  getWatcherBadgeVariant,
} from './settings-resource-shared'

interface BackupSourceCardProps {
  source: BackupSource
  onSave: (sourceId: number, input: BackupSourceUpdateInput) => Promise<void>
  onStartWatcher: (sourceId: number) => Promise<void>
  onStopWatcher: (sourceId: number) => Promise<void>
  onRestartWatcher: (sourceId: number) => Promise<void>
  onDelete: (sourceId: number) => Promise<void>
}

export function BackupSourceCard({
  source,
  onSave,
  onStartWatcher,
  onStopWatcher,
  onRestartWatcher,
  onDelete,
}: BackupSourceCardProps) {
  const { t, locale } = useI18n()
  const [draft, setDraft] = useState({
    display_name: source.display_name || '',
    source_path: source.source_path,
    target_folder_name: source.target_folder_name,
    recursive: source.recursive === 1,
    watcher_enabled: source.watcher_enabled === 1,
    watcher_polling_interval: source.watcher_polling_interval ?? 2000,
    import_mode: source.import_mode,
    webp_quality: source.webp_quality,
    is_active: source.is_active === 1,
  })
  const [isBusy, setIsBusy] = useState(false)

  useEffect(() => {
    setDraft({
      display_name: source.display_name || '',
      source_path: source.source_path,
      target_folder_name: source.target_folder_name,
      recursive: source.recursive === 1,
      watcher_enabled: source.watcher_enabled === 1,
      watcher_polling_interval: source.watcher_polling_interval ?? 2000,
      import_mode: source.import_mode,
      webp_quality: source.webp_quality,
      is_active: source.is_active === 1,
    })
  }, [source])

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
      heading={source.display_name || t({ ko: '이름 없는 백업 소스', en: 'Unnamed backup source' })}
      bodyClassName="space-y-5"
      actions={
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="icon-sm" variant="outline" disabled={isBusy} onClick={() => void handleAction(() => onStartWatcher(source.id))} title={t({ ko: 'watcher 시작', en: 'Start watcher' })} aria-label={t({ ko: 'watcher 시작', en: 'Start watcher' })}>
            <Play className="h-4 w-4" />
          </Button>
          <Button type="button" size="icon-sm" variant="outline" disabled={isBusy} onClick={() => void handleAction(() => onStopWatcher(source.id))} title={t({ ko: 'watcher 중지', en: 'Stop watcher' })} aria-label={t({ ko: 'watcher 중지', en: 'Stop watcher' })}>
            <Square className="h-4 w-4" />
          </Button>
          <Button type="button" size="icon-sm" variant="outline" disabled={isBusy} onClick={() => void handleAction(() => onRestartWatcher(source.id))} title={t({ ko: 'watcher 재시작', en: 'Restart watcher' })} aria-label={t({ ko: 'watcher 재시작', en: 'Restart watcher' })}>
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      }
    >
      <div className="flex flex-wrap gap-2">
        <Badge variant={draft.is_active ? 'outline' : 'secondary'}>{draft.is_active ? 'active' : 'inactive'}</Badge>
        <Badge variant="outline">{`mode ${source.import_mode}`}</Badge>
        <Badge variant={getWatcherBadgeVariant(source.watcher_status)}>{`watcher ${source.watcher_status || 'stopped'}`}</Badge>
      </div>

      <div className="space-y-1 font-mono text-xs text-muted-foreground">
        <div className="break-all">source {source.source_path}</div>
        <div className="break-all">target {buildBackupTargetPreviewPath(source.target_folder_name)}</div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
          <SettingsField label={t({ ko: '표시 이름', en: 'Display name' })}>
            <Input variant="settings" value={draft.display_name} onChange={(event) => setDraft((current) => ({ ...current, display_name: event.target.value }))} />
          </SettingsField>

          <SettingsField label={t({ ko: 'source 경로', en: 'Source path' })}>
            <Input variant="settings" value={draft.source_path} onChange={(event) => setDraft((current) => ({ ...current, source_path: event.target.value }))} />
          </SettingsField>

          <SettingsField
            label={(
              <span className="inline-flex items-center gap-1">
                {t({ ko: 'Upload 내부 대상 경로', en: 'Target path inside Upload' })}
                <span
                  className="inline-flex cursor-help text-muted-foreground"
                  title={[
                    t({ ko: '업로드 폴더 안의 상대 경로로 지정해.', en: 'Use a relative path inside the upload folder.' }),
                    t({ ko: '예: Backup → Upload/Backup', en: 'Example: Backup → Upload/Backup' }),
                    t({ ko: '예: Backup/001 → Upload/Backup/001', en: 'Example: Backup/001 → Upload/Backup/001' }),
                    t({ ko: '앞에 / 를 붙여도 자동으로 Upload 기준으로 정리돼.', en: 'A leading / is normalized relative to Upload automatically.' }),
                  ].join('\n')}
                  aria-label={t({ ko: '업로드 폴더 안의 상대 경로로 지정해. 예: Backup이면 Upload/Backup, Backup/001이면 Upload/Backup/001에 저장돼.', en: 'Use a relative path inside the upload folder. For example, Backup saves to Upload/Backup, and Backup/001 saves to Upload/Backup/001.' })}
                >
                  <CircleHelp className="h-3.5 w-3.5" />
                </span>
              </span>
            )}
          >
            <Input
              variant="settings"
              value={draft.target_folder_name}
              onChange={(event) => setDraft((current) => ({ ...current, target_folder_name: event.target.value }))}
              placeholder={t({ ko: 'Backup 또는 Backup/001', en: 'Backup or Backup/001' })}
            />
            <p className="mt-2 break-all font-mono text-xs text-primary">{t({ ko: '최종 경로: {path}', en: 'Final path: {path}' }, { path: buildBackupTargetPreviewPath(draft.target_folder_name) })}</p>
          </SettingsField>

          <SettingsField label={t({ ko: '가져오기 모드', en: 'Import mode' })}>
            <Select variant="settings" value={draft.import_mode} onChange={(event) => setDraft((current) => ({ ...current, import_mode: event.target.value as BackupSource['import_mode'] }))}>
              <option value="copy_original">{t({ ko: '원본 복사', en: 'Copy original' })}</option>
              <option value="convert_webp">{t({ ko: 'WebP 변환 (메타 보존)', en: 'Convert to WebP (preserve metadata)' })}</option>
            </Select>
          </SettingsField>

          <SettingsField label="watcher polling(ms)">
            <Input type="number" min={100} variant="settings" value={draft.watcher_polling_interval} onChange={(event) => setDraft((current) => ({ ...current, watcher_polling_interval: Number(event.target.value) || 100 }))} />
          </SettingsField>

          <SettingsField label={t({ ko: 'WebP 품질', en: 'WebP quality' })}>
            <Input type="number" min={1} max={100} variant="settings" value={draft.webp_quality} onChange={(event) => setDraft((current) => ({ ...current, webp_quality: Number(event.target.value) || 90 }))} disabled={draft.import_mode !== 'convert_webp'} />
          </SettingsField>

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
            {t({ ko: 'source 활성화', en: 'Source active' })}
          </SettingsToggleRow>
        </div>

        <SettingsResourceMetaList
          items={[
            { label: t({ ko: '최근 이벤트', en: 'Latest event' }), value: formatDateTime(source.watcher_last_event, locale) },
            { label: t({ ko: '최근 오류', en: 'Latest error' }), value: source.watcher_error || '—' },
          ]}
        />

      <SettingsResourceFooterActions
        dangerLabel={t({ ko: '백업 소스 제거', en: 'Remove backup source' })}
        dangerDisabled={isBusy}
        onDanger={() => {
          if (!window.confirm(t({ ko: '정말 {name} 백업 소스를 삭제할까?', en: 'Delete the {name} backup source?' }, { name: source.display_name || source.source_path }))) {
            return
          }
          void handleAction(() => onDelete(source.id))
        }}
        primaryLabel={isBusy ? t({ ko: '처리 중…', en: 'Processing…' }) : t({ ko: '백업 소스 저장', en: 'Save backup source' })}
        primaryDisabled={isBusy}
        onPrimary={() =>
          void handleAction(() =>
            onSave(source.id, {
              display_name: draft.display_name,
              source_path: draft.source_path,
              target_folder_name: normalizeBackupTargetPath(draft.target_folder_name),
              recursive: draft.recursive,
              watcher_enabled: draft.watcher_enabled,
              watcher_polling_interval: draft.watcher_enabled ? draft.watcher_polling_interval : null,
              import_mode: draft.import_mode,
              webp_quality: draft.webp_quality,
              is_active: draft.is_active,
            }),
          )
        }
      />
    </SettingsSection>
  )
}
