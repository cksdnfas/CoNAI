import { useEffect, useState } from 'react'
import { CircleHelp, Play, RotateCcw, Square } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import type { BackupSource, BackupSourceUpdateInput } from '@/types/folder'
import { useI18n } from '@/i18n'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { buildBackupTargetPreviewPath, formatDateTime, normalizeBackupTargetPath } from '../settings-utils'
import { Field } from '@/components/ui/field'
import { Section } from '@/components/ui/section'
import {
  SettingsResourceFooterActions,
  SettingsResourceMetaList,
  getWatcherBadgeVariant,
  getWatcherStateLabel,
} from './settings-resource-shared'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { SettingsSwitchRow } from './settings-switch-row'

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
  const confirm = useConfirm()
  const [draft, setDraft] = useState({
    display_name: source.display_name || '',
    source_path: source.source_path,
    target_folder_name: source.target_folder_name,
    recursive: source.recursive === 1,
    watcher_enabled: source.watcher_enabled === 1,
    watcher_polling_interval: source.watcher_polling_interval ?? null,
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
      watcher_polling_interval: source.watcher_polling_interval ?? null,
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
    <Section
      variant="settings"
      heading={source.display_name || t({ ko: '이름 없는 백업 소스', en: 'Unnamed backup source' })}
      bodyClassName="space-y-5"
      actions={
        <div className="flex flex-wrap gap-2">
          <IconButton size="icon-sm" variant="outline" disabled={isBusy} onClick={() => void handleAction(() => onStartWatcher(source.id))} label={t({ ko: '실시간 감시 시작', en: 'Start watching' })}>
            <Play className="h-4 w-4" />
          </IconButton>
          <IconButton size="icon-sm" variant="outline" disabled={isBusy} onClick={() => void handleAction(() => onStopWatcher(source.id))} label={t({ ko: '실시간 감시 중지', en: 'Stop watching' })}>
            <Square className="h-4 w-4" />
          </IconButton>
          <IconButton size="icon-sm" variant="outline" disabled={isBusy} onClick={() => void handleAction(() => onRestartWatcher(source.id))} label={t({ ko: '실시간 감시 재시작', en: 'Restart watching' })}>
            <RotateCcw className="h-4 w-4" />
          </IconButton>
        </div>
      }
    >
      <div className="flex flex-wrap gap-2">
        <Badge variant={draft.is_active ? 'outline' : 'secondary'}>{draft.is_active ? t({ ko: '활성', en: 'Active' }) : t({ ko: '비활성', en: 'Inactive' })}</Badge>
        <Badge variant="outline">{t({ ko: '모드 {mode}', en: 'Mode {mode}' }, { mode: source.import_mode })}</Badge>
        <Badge variant={getWatcherBadgeVariant(source.watcher_status)}>{getWatcherStateLabel(source.watcher_status, t)}</Badge>
      </div>

      <div className="space-y-1 font-mono text-xs text-muted-foreground">
        <div className="break-all">{t({ ko: 'source {path}', en: 'Source {path}' }, { path: source.source_path })}</div>
        <div className="break-all">{t({ ko: 'target {path}', en: 'Target {path}' }, { path: buildBackupTargetPreviewPath(source.target_folder_name) })}</div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
          <Field label={t({ ko: '표시 이름', en: 'Display name' })}>
            <Input variant="settings" value={draft.display_name} onChange={(event) => setDraft((current) => ({ ...current, display_name: event.target.value }))} />
          </Field>

          <Field label={t({ ko: 'source 경로', en: 'Source path' })}>
            <Input variant="settings" value={draft.source_path} onChange={(event) => setDraft((current) => ({ ...current, source_path: event.target.value }))} />
          </Field>

          <Field
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
          </Field>

          <Field label={t({ ko: '가져오기 모드', en: 'Import mode' })}>
            <Select variant="settings" value={draft.import_mode} onChange={(event) => setDraft((current) => ({ ...current, import_mode: event.target.value as BackupSource['import_mode'] }))}>
              <option value="copy_original">{t({ ko: '원본 복사', en: 'Copy original' })}</option>
              <option value="convert_webp">{t({ ko: 'WebP 변환 (메타 보존)', en: 'Convert to WebP (preserve metadata)' })}</option>
            </Select>
          </Field>

          <Field label={t({ ko: '폴링 주기(ms)', en: 'Polling interval (ms)' })} hint={t({ ko: '비워두면 자동 (권장)', en: 'Empty = auto (recommended)' })}>
            <NumberStepperInput min={2000} allowEmpty variant="settings" value={draft.watcher_polling_interval} onValueCommit={(nextValue) => setDraft((current) => ({ ...current, watcher_polling_interval: nextValue === '' ? null : Number(nextValue) || null }))} placeholder={t({ ko: '자동 감지', en: 'Auto detect' })} disabled={!draft.watcher_enabled} />
          </Field>

          <Field label={t({ ko: 'WebP 품질', en: 'WebP quality' })}>
            <NumberStepperInput min={1} max={100} variant="settings" value={draft.webp_quality} onValueCommit={(nextValue) => setDraft((current) => ({ ...current, webp_quality: Number(nextValue) || 90 }))} disabled={draft.import_mode !== 'convert_webp'} />
          </Field>

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
            label={t({ ko: '백업 소스 활성화', en: 'Backup source active' })}
          />
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
        onDanger={async () => {
          const confirmed = await confirm({
            title: t({ ko: '백업 소스 제거', en: 'Remove backup source' }),
            description: t({ ko: '정말 {name} 백업 소스를 삭제할까?', en: 'Delete the {name} backup source?' }, { name: source.display_name || source.source_path }),
            confirmLabel: t({ ko: '삭제', en: 'Delete' }),
            tone: 'destructive',
          })
          if (!confirmed) {
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
    </Section>
  )
}
