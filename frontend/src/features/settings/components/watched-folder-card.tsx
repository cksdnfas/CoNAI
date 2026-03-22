import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { WatchedFolder, WatchedFolderUpdateInput } from '@/types/folder'
import { parseCommaSeparatedInput, parseJsonArray, toCommaSeparatedInput } from '../settings-utils'
import { settingsControlClassName } from './settings-control-classes'
import { SettingsField, SettingsToggleRow } from './settings-primitives'

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
    <Card className="bg-surface-container">
      <CardHeader>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{folder.folder_name || '이름 없는 폴더'}</CardTitle>
              {folder.is_default === 1 ? <Badge variant="secondary">default</Badge> : null}
              <Badge variant={draft.is_active ? 'outline' : 'secondary'}>{draft.is_active ? 'active' : 'inactive'}</Badge>
              <Badge variant="outline">watcher {watcherState || 'stopped'}</Badge>
            </div>
            <div className="break-all font-mono text-xs text-muted-foreground">{folder.folder_path}</div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={isBusy} onClick={() => handleAction(() => onScan(folder.id))}>
              스캔
            </Button>
            <Button size="sm" variant="outline" disabled={isBusy} onClick={() => handleAction(() => onStartWatcher(folder.id))}>
              watcher 시작
            </Button>
            <Button size="sm" variant="outline" disabled={isBusy} onClick={() => handleAction(() => onStopWatcher(folder.id))}>
              watcher 중지
            </Button>
            <Button size="sm" variant="outline" disabled={isBusy} onClick={() => handleAction(() => onRestartWatcher(folder.id))}>
              watcher 재시작
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid gap-4 lg:grid-cols-2">
          <SettingsField label="표시 이름">
            <input
              value={draft.folder_name}
              onChange={(event) => setDraft((current) => ({ ...current, folder_name: event.target.value }))}
              className={settingsControlClassName}
            />
          </SettingsField>

          <SettingsField label="스캔 주기(분)">
            <input
              type="number"
              min={1}
              value={draft.scan_interval}
              onChange={(event) => setDraft((current) => ({ ...current, scan_interval: Number(event.target.value) || 1 }))}
              className={settingsControlClassName}
            />
          </SettingsField>

          <SettingsField label="제외 확장자">
            <input
              value={draft.exclude_extensions}
              onChange={(event) => setDraft((current) => ({ ...current, exclude_extensions: event.target.value }))}
              placeholder="tmp, db, txt"
              className={settingsControlClassName}
            />
          </SettingsField>

          <SettingsField label="제외 패턴">
            <input
              value={draft.exclude_patterns}
              onChange={(event) => setDraft((current) => ({ ...current, exclude_patterns: event.target.value }))}
              placeholder="@eaDir, thumbs, cache"
              className={settingsControlClassName}
            />
          </SettingsField>

          <SettingsToggleRow>
            <input type="checkbox" checked={draft.auto_scan} onChange={(event) => setDraft((current) => ({ ...current, auto_scan: event.target.checked }))} />
            자동 스캔
          </SettingsToggleRow>

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
            폴더 활성화
          </SettingsToggleRow>
        </div>

        <div className="flex flex-col gap-2 text-xs text-muted-foreground">
          <span>최근 스캔: {folder.last_scan_date ? new Date(folder.last_scan_date).toLocaleString('ko-KR') : '—'}</span>
          <span>최근 상태: {folder.last_scan_status || '—'}</span>
          <span>최근 신규 이미지: {folder.last_scan_found.toLocaleString('ko-KR')}</span>
        </div>

        <div className="flex flex-wrap justify-between gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={isBusy || folder.is_default === 1}
            onClick={() => {
              if (!window.confirm(`정말 ${folder.folder_name || folder.folder_path} 폴더를 삭제할까?`)) {
                return
              }
              void handleAction(() => onDelete(folder.id))
            }}
          >
            폴더 제거
          </Button>

          <Button
            size="sm"
            disabled={isBusy}
            onClick={() =>
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
          >
            {isBusy ? '처리 중…' : '폴더 설정 저장'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
