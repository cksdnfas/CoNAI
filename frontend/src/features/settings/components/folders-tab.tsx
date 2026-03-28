import { useEffect, useMemo, useState } from 'react'
import { Plus, RefreshCcw, ScanSearch } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { BackupSource, BackupSourceUpdateInput, FolderScanLog, WatchedFolder, WatchedFolderUpdateInput, WatchersHealthSummary } from '@/types/folder'
import { formatDateTime, type NewBackupSourceDraft, type NewWatchedFolderDraft } from '../settings-utils'
import { SettingsSectionHeading, SettingsValueTile } from './settings-primitives'
import { WatchedFolderCard } from './watched-folder-card'
import { WatchedFolderListItem } from './watched-folder-list-item'
import { WatchedFolderCreateForm } from './watched-folder-create-form'
import { BackupSourceCard } from './backup-source-card'
import { BackupSourceListItem } from './backup-source-list-item'
import { BackupSourceCreateForm } from './backup-source-create-form'
import { SettingsModal } from './settings-modal'

interface FoldersTabProps {
  newFolder: NewWatchedFolderDraft
  onNewFolderChange: (patch: Partial<NewWatchedFolderDraft>) => void
  pathValidationMessage: string | null
  isValidatingPath: boolean
  isAddingFolder: boolean
  onValidatePath: () => void
  onAddFolder: () => Promise<boolean>
  newBackupSource: NewBackupSourceDraft
  onNewBackupSourceChange: (patch: Partial<NewBackupSourceDraft>) => void
  backupPathValidationMessage: string | null
  isValidatingBackupPath: boolean
  isAddingBackupSource: boolean
  onValidateBackupPath: () => void
  onAddBackupSource: () => Promise<boolean>
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
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null)
  const [selectedBackupSourceId, setSelectedBackupSourceId] = useState<number | null>(null)
  const [isAddFolderModalOpen, setIsAddFolderModalOpen] = useState(false)
  const [isAddBackupSourceModalOpen, setIsAddBackupSourceModalOpen] = useState(false)

  const selectedFolder = useMemo(
    () => folders.find((folder) => folder.id === selectedFolderId) ?? null,
    [folders, selectedFolderId],
  )
  const selectedBackupSource = useMemo(
    () => backupSources.find((source) => source.id === selectedBackupSourceId) ?? null,
    [backupSources, selectedBackupSourceId],
  )

  useEffect(() => {
    if (selectedFolderId !== null && !folders.some((folder) => folder.id === selectedFolderId)) {
      setSelectedFolderId(null)
    }
  }, [folders, selectedFolderId])

  useEffect(() => {
    if (selectedBackupSourceId !== null && !backupSources.some((source) => source.id === selectedBackupSourceId)) {
      setSelectedBackupSourceId(null)
    }
  }, [backupSources, selectedBackupSourceId])

  const handleAddFolderFromModal = async () => {
    const success = await onAddFolder()
    if (success) {
      setIsAddFolderModalOpen(false)
    }
    return success
  }

  const handleAddBackupSourceFromModal = async () => {
    const success = await onAddBackupSource()
    if (success) {
      setIsAddBackupSourceModalOpen(false)
    }
    return success
  }

  return (
    <>
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

        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-semibold tracking-tight text-foreground">등록된 감시 폴더</h2>
              <Badge variant="outline">{folders.length}</Badge>
            </div>
            <Button
              type="button"
              size="icon-sm"
              onClick={() => setIsAddFolderModalOpen(true)}
              aria-label="감시 폴더 추가"
              title="감시 폴더 추가"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {foldersLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-20 w-full rounded-sm" />
              ))}
            </div>
          ) : null}

          {foldersError ? (
            <Alert variant="destructive">
              <AlertTitle>감시 폴더를 불러오지 못했어</AlertTitle>
              <AlertDescription>{foldersError}</AlertDescription>
            </Alert>
          ) : null}

          {!foldersLoading && !foldersError ? (
            <Card className="overflow-hidden bg-surface-container">
              <CardContent className="p-0">
                {folders.length > 0 ? (
                  <>
                    <div className="hidden border-b border-border/70 bg-surface-low/80 px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground md:grid md:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)_minmax(220px,0.9fr)_auto] md:items-center md:gap-3">
                      <span>표시 이름</span>
                      <span>경로</span>
                      <span>상태</span>
                      <span className="text-right">옵션</span>
                    </div>

                    <div className="divide-y divide-border/70">
                      {folders.map((folder) => (
                        <WatchedFolderListItem
                          key={folder.id}
                          folder={folder}
                          watcherState={folderWatcherMap.get(folder.id)}
                          selected={selectedFolderId === folder.id}
                          onOpenOptions={setSelectedFolderId}
                        />
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="px-4 py-6 text-sm text-muted-foreground">아직 등록된 감시 폴더가 없어. 오른쪽 `+` 버튼으로 추가하면 돼.</div>
                )}
              </CardContent>
            </Card>
          ) : null}
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-semibold tracking-tight text-foreground">등록된 백업 소스</h2>
              <Badge variant="outline">{backupSources.length}</Badge>
            </div>
            <Button
              type="button"
              size="icon-sm"
              onClick={() => setIsAddBackupSourceModalOpen(true)}
              aria-label="백업 소스 추가"
              title="백업 소스 추가"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {backupSourcesLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, index) => (
                <Skeleton key={index} className="h-20 w-full rounded-sm" />
              ))}
            </div>
          ) : null}

          {backupSourcesError ? (
            <Alert variant="destructive">
              <AlertTitle>백업 소스를 불러오지 못했어</AlertTitle>
              <AlertDescription>{backupSourcesError}</AlertDescription>
            </Alert>
          ) : null}

          {!backupSourcesLoading && !backupSourcesError ? (
            <Card className="overflow-hidden bg-surface-container">
              <CardContent className="p-0">
                {backupSources.length > 0 ? (
                  <>
                    <div className="hidden border-b border-border/70 bg-surface-low/80 px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground md:grid md:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)_minmax(220px,0.9fr)_auto] md:items-center md:gap-3">
                      <span>표시 이름</span>
                      <span>경로</span>
                      <span>상태</span>
                      <span className="text-right">옵션</span>
                    </div>

                    <div className="divide-y divide-border/70">
                      {backupSources.map((source) => (
                        <BackupSourceListItem
                          key={source.id}
                          source={source}
                          selected={selectedBackupSourceId === source.id}
                          onOpenOptions={setSelectedBackupSourceId}
                        />
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="px-4 py-6 text-sm text-muted-foreground">아직 등록된 백업 소스가 없어. 오른쪽 `+` 버튼으로 추가하면 돼.</div>
                )}
              </CardContent>
            </Card>
          ) : null}
        </section>

        <section className="space-y-4">
          <SettingsSectionHeading heading="최근 스캔 로그" />
          <Card className="bg-surface-container">
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
        </section>
      </div>

      <SettingsModal
        open={isAddFolderModalOpen}
        onClose={() => setIsAddFolderModalOpen(false)}
        title="감시 폴더 추가"
        description="새 감시 폴더를 등록하고 기본 스캔/워처 옵션을 설정해."
      >
        <WatchedFolderCreateForm
          newFolder={newFolder}
          onNewFolderChange={onNewFolderChange}
          pathValidationMessage={pathValidationMessage}
          isValidatingPath={isValidatingPath}
          isAddingFolder={isAddingFolder}
          onValidatePath={onValidatePath}
          onAddFolder={handleAddFolderFromModal}
        />
      </SettingsModal>

      <SettingsModal
        open={selectedFolder != null}
        onClose={() => setSelectedFolderId(null)}
        title={selectedFolder ? selectedFolder.folder_name || '감시 폴더 상세' : '감시 폴더 상세'}
        description={selectedFolder ? selectedFolder.folder_path : '감시 폴더 상세 정보와 수정'}
      >
        {selectedFolder ? (
          <WatchedFolderCard
            folder={selectedFolder}
            watcherState={folderWatcherMap.get(selectedFolder.id)}
            onSave={onFolderSave}
            onScan={onFolderScan}
            onStartWatcher={onFolderStartWatcher}
            onStopWatcher={onFolderStopWatcher}
            onRestartWatcher={onFolderRestartWatcher}
            onDelete={async (folderId) => {
              await onFolderDelete(folderId)
              setSelectedFolderId(null)
            }}
          />
        ) : null}
      </SettingsModal>

      <SettingsModal
        open={isAddBackupSourceModalOpen}
        onClose={() => setIsAddBackupSourceModalOpen(false)}
        title="백업 소스 추가"
        description="백업 소스를 등록하고 가져오기 모드와 워처 옵션을 설정해."
      >
        <BackupSourceCreateForm
          newBackupSource={newBackupSource}
          onNewBackupSourceChange={onNewBackupSourceChange}
          backupPathValidationMessage={backupPathValidationMessage}
          isValidatingBackupPath={isValidatingBackupPath}
          isAddingBackupSource={isAddingBackupSource}
          onValidateBackupPath={onValidateBackupPath}
          onAddBackupSource={handleAddBackupSourceFromModal}
        />
      </SettingsModal>

      <SettingsModal
        open={selectedBackupSource != null}
        onClose={() => setSelectedBackupSourceId(null)}
        title={selectedBackupSource ? selectedBackupSource.display_name || '백업 소스 상세' : '백업 소스 상세'}
        description={selectedBackupSource ? selectedBackupSource.source_path : '백업 소스 상세 정보와 수정'}
      >
        {selectedBackupSource ? (
          <BackupSourceCard
            source={selectedBackupSource}
            onSave={onBackupSourceSave}
            onStartWatcher={onBackupSourceStartWatcher}
            onStopWatcher={onBackupSourceStopWatcher}
            onRestartWatcher={onBackupSourceRestartWatcher}
            onDelete={async (sourceId) => {
              await onBackupSourceDelete(sourceId)
              setSelectedBackupSourceId(null)
            }}
          />
        ) : null}
      </SettingsModal>
    </>
  )
}
