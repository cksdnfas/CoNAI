import { useEffect, useState } from 'react'
import { Play, RotateCcw, Square } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { BackupSource, BackupSourceUpdateInput } from '@/types/folder'
import { settingsControlClassName } from './settings-control-classes'
import { SettingsField, SettingsToggleRow } from './settings-primitives'

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
    <Card className="bg-surface-container">
      <CardHeader>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{source.display_name || '이름 없는 백업 소스'}</CardTitle>
              <Badge variant={draft.is_active ? 'outline' : 'secondary'}>{draft.is_active ? 'active' : 'inactive'}</Badge>
              <Badge variant="outline">mode {source.import_mode}</Badge>
              <Badge variant="outline">watcher {source.watcher_status || 'stopped'}</Badge>
            </div>
            <div className="break-all font-mono text-xs text-muted-foreground">source {source.source_path}</div>
            <div className="break-all font-mono text-xs text-muted-foreground">target uploads/{source.target_folder_name}</div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="icon-sm"
              variant="outline"
              disabled={isBusy}
              onClick={() => handleAction(() => onStartWatcher(source.id))}
              aria-label="watcher 시작"
              title="watcher 시작"
            >
              <Play className="h-4 w-4" />
            </Button>
            <Button
              size="icon-sm"
              variant="outline"
              disabled={isBusy}
              onClick={() => handleAction(() => onStopWatcher(source.id))}
              aria-label="watcher 중지"
              title="watcher 중지"
            >
              <Square className="h-4 w-4" />
            </Button>
            <Button
              size="icon-sm"
              variant="outline"
              disabled={isBusy}
              onClick={() => handleAction(() => onRestartWatcher(source.id))}
              aria-label="watcher 재시작"
              title="watcher 재시작"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid gap-4 lg:grid-cols-2">
          <SettingsField label="표시 이름">
            <input
              value={draft.display_name}
              onChange={(event) => setDraft((current) => ({ ...current, display_name: event.target.value }))}
              className={settingsControlClassName}
            />
          </SettingsField>

          <SettingsField label="source 경로">
            <input
              value={draft.source_path}
              onChange={(event) => setDraft((current) => ({ ...current, source_path: event.target.value }))}
              className={settingsControlClassName}
            />
          </SettingsField>

          <SettingsField label="uploads 대상 폴더명">
            <input
              value={draft.target_folder_name}
              onChange={(event) => setDraft((current) => ({ ...current, target_folder_name: event.target.value }))}
              placeholder="backup-a"
              className={settingsControlClassName}
            />
          </SettingsField>

          <SettingsField label="가져오기 모드">
            <select
              value={draft.import_mode}
              onChange={(event) => setDraft((current) => ({ ...current, import_mode: event.target.value as BackupSource['import_mode'] }))}
              className={settingsControlClassName}
            >
              <option value="copy_original">원본 복사</option>
              <option value="convert_webp">WebP 변환 (메타 보존)</option>
            </select>
          </SettingsField>

          <SettingsField label="watcher polling(ms)">
            <input
              type="number"
              min={100}
              value={draft.watcher_polling_interval}
              onChange={(event) => setDraft((current) => ({ ...current, watcher_polling_interval: Number(event.target.value) || 100 }))}
              className={settingsControlClassName}
            />
          </SettingsField>

          <SettingsField label="WebP 품질">
            <input
              type="number"
              min={1}
              max={100}
              value={draft.webp_quality}
              onChange={(event) => setDraft((current) => ({ ...current, webp_quality: Number(event.target.value) || 90 }))}
              className={settingsControlClassName}
              disabled={draft.import_mode !== 'convert_webp'}
            />
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

        <div className="flex flex-col gap-2 text-xs text-muted-foreground">
          <span>최근 이벤트: {source.watcher_last_event ? new Date(source.watcher_last_event).toLocaleString('ko-KR') : '—'}</span>
          <span>최근 오류: {source.watcher_error || '—'}</span>
        </div>

        <div className="flex flex-wrap justify-between gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={isBusy}
            onClick={() => {
              if (!window.confirm(`정말 ${source.display_name || source.source_path} 백업 소스를 삭제할까?`)) {
                return
              }
              void handleAction(() => onDelete(source.id))
            }}
          >
            백업 소스 제거
          </Button>

          <Button
            size="sm"
            disabled={isBusy}
            onClick={() =>
              void handleAction(() =>
                onSave(source.id, {
                  display_name: draft.display_name,
                  source_path: draft.source_path,
                  target_folder_name: draft.target_folder_name,
                  recursive: draft.recursive,
                  watcher_enabled: draft.watcher_enabled,
                  watcher_polling_interval: draft.watcher_enabled ? draft.watcher_polling_interval : null,
                  import_mode: draft.import_mode,
                  webp_quality: draft.webp_quality,
                  is_active: draft.is_active,
                }),
              )
            }
          >
            {isBusy ? '처리 중…' : '백업 소스 저장'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
