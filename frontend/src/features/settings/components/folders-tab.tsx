import { FolderPlus, LoaderCircle, RefreshCcw, ScanSearch } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { BackupSource, BackupSourceUpdateInput, FolderScanLog, WatchedFolder, WatchedFolderUpdateInput, WatchersHealthSummary } from '@/types/folder'
import { formatDateTime, type NewBackupSourceDraft, type NewWatchedFolderDraft } from '../settings-utils'
import { settingsControlClassName } from './settings-control-classes'
import { SettingsField, SettingsToggleRow, SettingsValueTile } from './settings-primitives'
import { WatchedFolderCard } from './watched-folder-card'
import { BackupSourceCard } from './backup-source-card'

interface FoldersTabProps {
  newFolder: NewWatchedFolderDraft
  onNewFolderChange: (patch: Partial<NewWatchedFolderDraft>) => void
  pathValidationMessage: string | null
  isValidatingPath: boolean
  isAddingFolder: boolean
  onValidatePath: () => void
  onAddFolder: () => void
  newBackupSource: NewBackupSourceDraft
  onNewBackupSourceChange: (patch: Partial<NewBackupSourceDraft>) => void
  backupPathValidationMessage: string | null
  isValidatingBackupPath: boolean
  isAddingBackupSource: boolean
  onValidateBackupPath: () => void
  onAddBackupSource: () => void
  onRefresh: () => void
  onScanAll: () => void
  folders: WatchedFolder[]
  foldersLoading: boolean
  foldersError: string | null
  folderWatcherMap: Map<number, string>
  onFolderSave: (folderId: number, input: WatchedFolderUpdateInput) => Promise<void>
  onFolderScan: (folderId: number, full?: boolean) => Promise<void>
  onFolderStartWatcher: (folderId: number) => Promise<void>
  onFolderStopWatcher: (folderId: number) => Promise<void>
  onFolderRestartWatcher: (folderId: number) => Promise<void>
  onFolderDelete: (folderId: number) => Promise<void>
  backupSources: BackupSource[]
  backupSourcesLoading: boolean
  backupSourcesError: string | null
  onBackupSourceSave: (sourceId: number, input: BackupSourceUpdateInput) => Promise<void>
  onBackupSourceStartWatcher: (sourceId: number) => Promise<void>
  onBackupSourceStopWatcher: (sourceId: number) => Promise<void>
  onBackupSourceRestartWatcher: (sourceId: number) => Promise<void>
  onBackupSourceDelete: (sourceId: number) => Promise<void>
  scanLogs: FolderScanLog[]
  scanLogsLoading: boolean
  watchersHealth: WatchersHealthSummary | undefined
}

export function FoldersTab({
  newFolder,
  onNewFolderChange,
  pathValidationMessage,
  isValidatingPath,
  isAddingFolder,
  onValidatePath,
  onAddFolder,
  newBackupSource,
  onNewBackupSourceChange,
  backupPathValidationMessage,
  isValidatingBackupPath,
  isAddingBackupSource,
  onValidateBackupPath,
  onAddBackupSource,
  onRefresh,
  onScanAll,
  folders,
  foldersLoading,
  foldersError,
  folderWatcherMap,
  onFolderSave,
  onFolderScan,
  onFolderStartWatcher,
  onFolderStopWatcher,
  onFolderRestartWatcher,
  onFolderDelete,
  backupSources,
  backupSourcesLoading,
  backupSourcesError,
  onBackupSourceSave,
  onBackupSourceStartWatcher,
  onBackupSourceStopWatcher,
  onBackupSourceRestartWatcher,
  onBackupSourceDelete,
  scanLogs,
  scanLogsLoading,
  watchersHealth,
}: FoldersTabProps) {
  return (
    <div className="space-y-8">
      <Card className="bg-surface-container">
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <CardTitle>감시 폴더 운영</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={onRefresh}>
                <RefreshCcw className="h-4 w-4" />
                새로고침
              </Button>
              <Button size="sm" onClick={onScanAll}>
                <ScanSearch className="h-4 w-4" />
                전체 스캔
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-6">
          <SettingsValueTile label="folders" value={folders.length} valueClassName="text-xl" />
          <SettingsValueTile label="backup sources" value={backupSources.length} valueClassName="text-xl" />
          <SettingsValueTile label="watching" value={watchersHealth?.watching ?? 0} valueClassName="text-xl" />
          <SettingsValueTile label="errors" value={watchersHealth?.error ?? 0} valueClassName="text-xl" />
          <SettingsValueTile label="events 24h" value={watchersHealth?.totalEvents24h ?? 0} valueClassName="text-xl" />
          <SettingsValueTile label="latest scan log" value={scanLogs[0]?.folder_name ?? '—'} />
        </CardContent>
      </Card>

      <Card className="bg-surface-container">
        <CardHeader>
          <CardTitle>새 감시 폴더 추가</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-2">
            <SettingsField label="폴더 경로">
              <input
                value={newFolder.folder_path}
                onChange={(event) => onNewFolderChange({ folder_path: event.target.value })}
                placeholder="D:\\Images\\Incoming"
                className={settingsControlClassName}
              />
            </SettingsField>

            <SettingsField label="표시 이름">
              <input
                value={newFolder.folder_name}
                onChange={(event) => onNewFolderChange({ folder_name: event.target.value })}
                placeholder="Incoming"
                className={settingsControlClassName}
              />
            </SettingsField>

            <SettingsField label="스캔 주기(분)">
              <input
                type="number"
                min={1}
                value={newFolder.scan_interval}
                onChange={(event) => onNewFolderChange({ scan_interval: Number(event.target.value) || 1 })}
                className={settingsControlClassName}
              />
            </SettingsField>

            <SettingsField label="watcher polling(ms)">
              <input
                type="number"
                min={100}
                value={newFolder.watcher_polling_interval}
                onChange={(event) => onNewFolderChange({ watcher_polling_interval: Number(event.target.value) || 100 })}
                className={settingsControlClassName}
              />
            </SettingsField>

            <SettingsField label="제외 확장자">
              <input
                value={newFolder.exclude_extensions}
                onChange={(event) => onNewFolderChange({ exclude_extensions: event.target.value })}
                placeholder="tmp, db"
                className={settingsControlClassName}
              />
            </SettingsField>

            <SettingsField label="제외 패턴">
              <input
                value={newFolder.exclude_patterns}
                onChange={(event) => onNewFolderChange({ exclude_patterns: event.target.value })}
                placeholder="@eaDir, cache"
                className={settingsControlClassName}
              />
            </SettingsField>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <SettingsToggleRow>
              <input type="checkbox" checked={newFolder.auto_scan} onChange={(event) => onNewFolderChange({ auto_scan: event.target.checked })} />
              자동 스캔
            </SettingsToggleRow>
            <SettingsToggleRow>
              <input type="checkbox" checked={newFolder.recursive} onChange={(event) => onNewFolderChange({ recursive: event.target.checked })} />
              하위 폴더 포함
            </SettingsToggleRow>
            <SettingsToggleRow>
              <input
                type="checkbox"
                checked={newFolder.watcher_enabled}
                onChange={(event) => onNewFolderChange({ watcher_enabled: event.target.checked })}
              />
              watcher 시작
            </SettingsToggleRow>
          </div>

          {pathValidationMessage ? <p className="text-sm text-primary">{pathValidationMessage}</p> : null}

          <div className="flex flex-wrap justify-between gap-2">
            <Button size="sm" variant="outline" disabled={isValidatingPath || !newFolder.folder_path.trim()} onClick={onValidatePath}>
              {isValidatingPath ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
              경로 검증
            </Button>

            <Button size="sm" disabled={isAddingFolder || !newFolder.folder_path.trim()} onClick={onAddFolder}>
              <FolderPlus className="h-4 w-4" />
              감시 폴더 추가
            </Button>
          </div>
        </CardContent>
      </Card>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">등록된 감시 폴더</h2>
          <Badge variant="outline">{folders.length}</Badge>
        </div>

        {foldersLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-48 w-full rounded-sm" />
            ))}
          </div>
        ) : null}

        {foldersError ? (
          <Alert variant="destructive">
            <AlertTitle>감시 폴더를 불러오지 못했어</AlertTitle>
            <AlertDescription>{foldersError}</AlertDescription>
          </Alert>
        ) : null}

        {!foldersLoading && !foldersError
          ? folders.map((folder) => (
              <WatchedFolderCard
                key={folder.id}
                folder={folder}
                watcherState={folderWatcherMap.get(folder.id)}
                onSave={onFolderSave}
                onScan={onFolderScan}
                onStartWatcher={onFolderStartWatcher}
                onStopWatcher={onFolderStopWatcher}
                onRestartWatcher={onFolderRestartWatcher}
                onDelete={onFolderDelete}
              />
            ))
          : null}
      </section>

      <Card className="bg-surface-container">
        <CardHeader>
          <CardTitle>새 백업 소스 추가</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-2">
            <SettingsField label="source 폴더 경로">
              <input
                value={newBackupSource.source_path}
                onChange={(event) => onNewBackupSourceChange({ source_path: event.target.value })}
                placeholder="D:\\Images\\Incoming"
                className={settingsControlClassName}
              />
            </SettingsField>

            <SettingsField label="표시 이름">
              <input
                value={newBackupSource.display_name}
                onChange={(event) => onNewBackupSourceChange({ display_name: event.target.value })}
                placeholder="Backup source A"
                className={settingsControlClassName}
              />
            </SettingsField>

            <SettingsField label="uploads 대상 폴더명">
              <input
                value={newBackupSource.target_folder_name}
                onChange={(event) => onNewBackupSourceChange({ target_folder_name: event.target.value })}
                placeholder="backup-a"
                className={settingsControlClassName}
              />
            </SettingsField>

            <SettingsField label="가져오기 모드">
              <select
                value={newBackupSource.import_mode}
                onChange={(event) => onNewBackupSourceChange({ import_mode: event.target.value as NewBackupSourceDraft['import_mode'] })}
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
                value={newBackupSource.watcher_polling_interval}
                onChange={(event) => onNewBackupSourceChange({ watcher_polling_interval: Number(event.target.value) || 100 })}
                className={settingsControlClassName}
              />
            </SettingsField>

            <SettingsField label="WebP 품질">
              <input
                type="number"
                min={1}
                max={100}
                value={newBackupSource.webp_quality}
                onChange={(event) => onNewBackupSourceChange({ webp_quality: Number(event.target.value) || 90 })}
                className={settingsControlClassName}
                disabled={newBackupSource.import_mode !== 'convert_webp'}
              />
            </SettingsField>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <SettingsToggleRow>
              <input type="checkbox" checked={newBackupSource.recursive} onChange={(event) => onNewBackupSourceChange({ recursive: event.target.checked })} />
              하위 폴더 포함
            </SettingsToggleRow>
            <SettingsToggleRow>
              <input type="checkbox" checked={newBackupSource.watcher_enabled} onChange={(event) => onNewBackupSourceChange({ watcher_enabled: event.target.checked })} />
              watcher 시작
            </SettingsToggleRow>
          </div>

          {backupPathValidationMessage ? <p className="text-sm text-primary">{backupPathValidationMessage}</p> : null}

          <div className="flex flex-wrap justify-between gap-2">
            <Button size="sm" variant="outline" disabled={isValidatingBackupPath || !newBackupSource.source_path.trim()} onClick={onValidateBackupPath}>
              {isValidatingBackupPath ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
              source 경로 검증
            </Button>

            <Button size="sm" disabled={isAddingBackupSource || !newBackupSource.source_path.trim() || !newBackupSource.target_folder_name.trim()} onClick={onAddBackupSource}>
              <FolderPlus className="h-4 w-4" />
              백업 소스 추가
            </Button>
          </div>
        </CardContent>
      </Card>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">등록된 백업 소스</h2>
          <Badge variant="outline">{backupSources.length}</Badge>
        </div>

        {backupSourcesLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 2 }).map((_, index) => (
              <Skeleton key={index} className="h-48 w-full rounded-sm" />
            ))}
          </div>
        ) : null}

        {backupSourcesError ? (
          <Alert variant="destructive">
            <AlertTitle>백업 소스를 불러오지 못했어</AlertTitle>
            <AlertDescription>{backupSourcesError}</AlertDescription>
          </Alert>
        ) : null}

        {!backupSourcesLoading && !backupSourcesError
          ? backupSources.map((source) => (
              <BackupSourceCard
                key={source.id}
                source={source}
                onSave={onBackupSourceSave}
                onStartWatcher={onBackupSourceStartWatcher}
                onStopWatcher={onBackupSourceStopWatcher}
                onRestartWatcher={onBackupSourceRestartWatcher}
                onDelete={onBackupSourceDelete}
              />
            ))
          : null}
      </section>

      <Card className="bg-surface-container">
        <CardHeader>
          <CardTitle>최근 스캔 로그</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {scanLogsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-14 w-full rounded-sm" />
              ))}
            </div>
          ) : null}

          {!scanLogsLoading && scanLogs.length === 0 ? <p className="text-sm text-muted-foreground">아직 최근 스캔 로그가 없어.</p> : null}

          {scanLogs.map((log) => (
            <div key={log.id} className="rounded-sm bg-surface-low px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium text-foreground">{log.folder_name || `Folder #${log.folder_id}`}</div>
                <div className="text-xs text-muted-foreground">{formatDateTime(log.scan_date)}</div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span>status {log.status}</span>
                <span>scanned {log.total_scanned}</span>
                <span>new {log.new_images}</span>
                <span>existing {log.existing_images}</span>
                <span>errors {log.error_count}</span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
