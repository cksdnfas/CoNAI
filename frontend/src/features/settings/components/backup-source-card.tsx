import { useEffect, useState } from 'react'
import { CircleHelp, Play, RotateCcw, Square } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import type { BackupSource, BackupSourceUpdateInput } from '@/types/folder'
import { buildBackupTargetPreviewPath, formatDateTime, normalizeBackupTargetPath } from '../settings-utils'
import { SettingsField, SettingsToggleRow } from './settings-primitives'
import {
  SettingsResourceCardHeader,
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
    <Card>
      <CardHeader>
        <SettingsResourceCardHeader
          title={source.display_name || '이름 없는 백업 소스'}
          badges={[
            { label: draft.is_active ? 'active' : 'inactive', variant: draft.is_active ? 'outline' : 'secondary' },
            { label: `mode ${source.import_mode}`, variant: 'outline' },
            { label: `watcher ${source.watcher_status || 'stopped'}`, variant: getWatcherBadgeVariant(source.watcher_status) },
          ]}
          details={[`source ${source.source_path}`, `target ${buildBackupTargetPreviewPath(source.target_folder_name)}`]}
          actions={[
            {
              label: 'watcher 시작',
              title: 'watcher 시작',
              icon: <Play className="h-4 w-4" />,
              disabled: isBusy,
              onClick: () => void handleAction(() => onStartWatcher(source.id)),
            },
            {
              label: 'watcher 중지',
              title: 'watcher 중지',
              icon: <Square className="h-4 w-4" />,
              disabled: isBusy,
              onClick: () => void handleAction(() => onStopWatcher(source.id)),
            },
            {
              label: 'watcher 재시작',
              title: 'watcher 재시작',
              icon: <RotateCcw className="h-4 w-4" />,
              disabled: isBusy,
              onClick: () => void handleAction(() => onRestartWatcher(source.id)),
            },
          ]}
        />
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid gap-4 lg:grid-cols-2">
          <SettingsField label="표시 이름">
            <Input variant="settings" value={draft.display_name} onChange={(event) => setDraft((current) => ({ ...current, display_name: event.target.value }))} />
          </SettingsField>

          <SettingsField label="source 경로">
            <Input variant="settings" value={draft.source_path} onChange={(event) => setDraft((current) => ({ ...current, source_path: event.target.value }))} />
          </SettingsField>

          <SettingsField
            label={(
              <span className="inline-flex items-center gap-1">
                Upload 내부 대상 경로
                <span
                  className="inline-flex cursor-help text-muted-foreground"
                  title={[
                    '업로드 폴더 안의 상대 경로로 지정해.',
                    '예: Backup → Upload/Backup',
                    '예: Backup/001 → Upload/Backup/001',
                    '앞에 / 를 붙여도 자동으로 Upload 기준으로 정리돼.',
                  ].join('\n')}
                  aria-label="업로드 폴더 안의 상대 경로로 지정해. 예: Backup이면 Upload/Backup, Backup/001이면 Upload/Backup/001에 저장돼."
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
              placeholder="Backup 또는 Backup/001"
            />
            <p className="mt-2 break-all font-mono text-xs text-primary">최종 경로: {buildBackupTargetPreviewPath(draft.target_folder_name)}</p>
          </SettingsField>

          <SettingsField label="가져오기 모드">
            <Select variant="settings" value={draft.import_mode} onChange={(event) => setDraft((current) => ({ ...current, import_mode: event.target.value as BackupSource['import_mode'] }))}>
              <option value="copy_original">원본 복사</option>
              <option value="convert_webp">WebP 변환 (메타 보존)</option>
            </Select>
          </SettingsField>

          <SettingsField label="watcher polling(ms)">
            <Input type="number" min={100} variant="settings" value={draft.watcher_polling_interval} onChange={(event) => setDraft((current) => ({ ...current, watcher_polling_interval: Number(event.target.value) || 100 }))} />
          </SettingsField>

          <SettingsField label="WebP 품질">
            <Input type="number" min={1} max={100} variant="settings" value={draft.webp_quality} onChange={(event) => setDraft((current) => ({ ...current, webp_quality: Number(event.target.value) || 90 }))} disabled={draft.import_mode !== 'convert_webp'} />
          </SettingsField>

          <SettingsToggleRow>
            <input type="checkbox" checked={draft.recursive} onChange={(event) => setDraft((current) => ({ ...current, recursive: event.target.checked }))} />
            하위 폴더 포함
          </SettingsToggleRow>

          <SettingsToggleRow>
            <input
              type="checkbox"
              checked={draft.watcher_enabled}
              onChange={(event) => setDraft((current) => ({ ...current, watcher_enabled: event.target.checked }))}
            />
            watcher 사용
          </SettingsToggleRow>

          <SettingsToggleRow>
            <input type="checkbox" checked={draft.is_active} onChange={(event) => setDraft((current) => ({ ...current, is_active: event.target.checked }))} />
            source 활성화
          </SettingsToggleRow>
        </div>

        <SettingsResourceMetaList
          items={[
            { label: '최근 이벤트', value: formatDateTime(source.watcher_last_event) },
            { label: '최근 오류', value: source.watcher_error || '—' },
          ]}
        />

        <SettingsResourceFooterActions
          dangerLabel="백업 소스 제거"
          dangerDisabled={isBusy}
          onDanger={() => {
            if (!window.confirm(`정말 ${source.display_name || source.source_path} 백업 소스를 삭제할까?`)) {
              return
            }
            void handleAction(() => onDelete(source.id))
          }}
          primaryLabel={isBusy ? '처리 중…' : '백업 소스 저장'}
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
      </CardContent>
    </Card>
  )
}
