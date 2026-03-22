import { FolderPlus, LoaderCircle, RefreshCcw, ScanSearch } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { FolderScanLog, WatchedFolder, WatchedFolderUpdateInput, WatchersHealthSummary } from '@/types/folder'
import { formatDateTime, type NewWatchedFolderDraft } from '../settings-utils'
import { WatchedFolderCard } from './watched-folder-card'

interface FoldersTabProps {
  newFolder: NewWatchedFolderDraft
  onNewFolderChange: (patch: Partial<NewWatchedFolderDraft>) => void
  pathValidationMessage: string | null
  isValidatingPath: boolean
  isAddingFolder: boolean
  onValidatePath: () => void
  onAddFolder: () => void
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
        <CardContent className="grid gap-3 text-sm md:grid-cols-5">
          <div className="rounded-sm bg-surface-low px-4 py-3">
            <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">folders</div>
            <div className="mt-2 text-xl font-semibold text-foreground">{folders.length}</div>
          </div>
          <div className="rounded-sm bg-surface-low px-4 py-3">
            <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">watching</div>
            <div className="mt-2 text-xl font-semibold text-foreground">{watchersHealth?.watching ?? 0}</div>
          </div>
          <div className="rounded-sm bg-surface-low px-4 py-3">
            <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">errors</div>
            <div className="mt-2 text-xl font-semibold text-foreground">{watchersHealth?.error ?? 0}</div>
          </div>
          <div className="rounded-sm bg-surface-low px-4 py-3">
            <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">events 24h</div>
            <div className="mt-2 text-xl font-semibold text-foreground">{watchersHealth?.totalEvents24h ?? 0}</div>
          </div>
          <div className="rounded-sm bg-surface-low px-4 py-3">
            <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">latest scan log</div>
            <div className="mt-2 text-sm font-semibold text-foreground">{scanLogs[0]?.folder_name ?? '—'}</div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-surface-container">
        <CardHeader>
          <CardTitle>새 감시 폴더 추가</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-2">
            <label className="space-y-2 text-sm">
              <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">폴더 경로</span>
              <input
                value={newFolder.folder_path}
                onChange={(event) => onNewFolderChange({ folder_path: event.target.value })}
                placeholder="D:\\Images\\Incoming"
                className="h-10 w-full rounded-sm bg-surface-lowest px-3 text-foreground outline-none focus:ring-1 focus:ring-primary"
              />
            </label>

            <label className="space-y-2 text-sm">
              <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">표시 이름</span>
              <input
                value={newFolder.folder_name}
                onChange={(event) => onNewFolderChange({ folder_name: event.target.value })}
                placeholder="Incoming"
                className="h-10 w-full rounded-sm bg-surface-lowest px-3 text-foreground outline-none focus:ring-1 focus:ring-primary"
              />
            </label>

            <label className="space-y-2 text-sm">
              <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">스캔 주기(분)</span>
              <input
                type="number"
                min={1}
                value={newFolder.scan_interval}
                onChange={(event) => onNewFolderChange({ scan_interval: Number(event.target.value) || 1 })}
                className="h-10 w-full rounded-sm bg-surface-lowest px-3 text-foreground outline-none focus:ring-1 focus:ring-primary"
              />
            </label>

            <label className="space-y-2 text-sm">
              <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">watcher polling(ms)</span>
              <input
                type="number"
                min={100}
                value={newFolder.watcher_polling_interval}
                onChange={(event) => onNewFolderChange({ watcher_polling_interval: Number(event.target.value) || 100 })}
                className="h-10 w-full rounded-sm bg-surface-lowest px-3 text-foreground outline-none focus:ring-1 focus:ring-primary"
              />
            </label>

            <label className="space-y-2 text-sm">
              <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">제외 확장자</span>
              <input
                value={newFolder.exclude_extensions}
                onChange={(event) => onNewFolderChange({ exclude_extensions: event.target.value })}
                placeholder="tmp, db"
                className="h-10 w-full rounded-sm bg-surface-lowest px-3 text-foreground outline-none focus:ring-1 focus:ring-primary"
              />
            </label>

            <label className="space-y-2 text-sm">
              <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">제외 패턴</span>
              <input
                value={newFolder.exclude_patterns}
                onChange={(event) => onNewFolderChange({ exclude_patterns: event.target.value })}
                placeholder="@eaDir, cache"
                className="h-10 w-full rounded-sm bg-surface-lowest px-3 text-foreground outline-none focus:ring-1 focus:ring-primary"
              />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="flex items-center gap-3 rounded-sm bg-surface-low px-4 py-3 text-sm text-foreground">
              <input
                type="checkbox"
                checked={newFolder.auto_scan}
                onChange={(event) => onNewFolderChange({ auto_scan: event.target.checked })}
              />
              자동 스캔
            </label>
            <label className="flex items-center gap-3 rounded-sm bg-surface-low px-4 py-3 text-sm text-foreground">
              <input
                type="checkbox"
                checked={newFolder.recursive}
                onChange={(event) => onNewFolderChange({ recursive: event.target.checked })}
              />
              하위 폴더 포함
            </label>
            <label className="flex items-center gap-3 rounded-sm bg-surface-low px-4 py-3 text-sm text-foreground">
              <input
                type="checkbox"
                checked={newFolder.watcher_enabled}
                onChange={(event) => onNewFolderChange({ watcher_enabled: event.target.checked })}
              />
              watcher 시작
            </label>
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

          {!scanLogsLoading && scanLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground">아직 최근 스캔 로그가 없어.</p>
          ) : null}

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
