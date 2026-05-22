import { useEffect, useMemo, useState } from 'react'
import { Plus, RefreshCcw, ScanSearch, ShieldCheck } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { BackupSource, BackupSourceUpdateInput, FolderScanLog, WatchedFolder, WatchedFolderUpdateInput, WatchersHealthSummary } from '@/types/folder'
import { formatDateTime, type NewBackupSourceDraft, type NewWatchedFolderDraft } from '../settings-utils'
import { SettingsSection, SettingsValueTile } from './settings-primitives'
import { SettingsResourceTable } from './settings-resource-shared'
import { WatchedFolderCard } from './watched-folder-card'
import { WatchedFolderListItem } from './watched-folder-list-item'
import { WatchedFolderCreateForm } from './watched-folder-create-form'
import { BackupSourceCard } from './backup-source-card'
import { BackupSourceListItem } from './backup-source-list-item'
import { BackupSourceCreateForm } from './backup-source-create-form'
import { SettingsModal } from './settings-modal'
import { useI18n } from '@/i18n'

const WATCHED_FOLDER_TABLE_GRID = 'grid-cols-[minmax(180px,1.05fr)_minmax(420px,2.4fr)_72px_72px_56px] gap-3'
const BACKUP_SOURCE_TABLE_GRID = 'grid-cols-[minmax(180px,0.95fr)_minmax(280px,1.55fr)_minmax(240px,1.25fr)_72px_72px_56px] gap-3'
const SCAN_LOG_TABLE_GRID = 'grid-cols-[minmax(180px,1fr)_120px_88px_88px_88px_88px_120px] gap-3'

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
  onVerifyAllFiles: () => void
  isVerifyingAllFiles: boolean
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
  onVerifyAllFiles,
  isVerifyingAllFiles,
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
  const { t, locale, formatNumber } = useI18n()
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null)
  const [selectedBackupSourceId, setSelectedBackupSourceId] = useState<number | null>(null)
  const [isAddFolderModalOpen, setIsAddFolderModalOpen] = useState(false)
  const [isAddBackupSourceModalOpen, setIsAddBackupSourceModalOpen] = useState(false)

  const foldersById = useMemo(() => new Map(folders.map((folder) => [folder.id, folder] as const)), [folders])
  const backupSourcesById = useMemo(() => new Map(backupSources.map((source) => [source.id, source] as const)), [backupSources])
  const selectedFolder = useMemo(
    () => (selectedFolderId !== null ? foldersById.get(selectedFolderId) ?? null : null),
    [foldersById, selectedFolderId],
  )
  const selectedBackupSource = useMemo(
    () => (selectedBackupSourceId !== null ? backupSourcesById.get(selectedBackupSourceId) ?? null : null),
    [backupSourcesById, selectedBackupSourceId],
  )

  useEffect(() => {
    if (selectedFolderId !== null && !foldersById.has(selectedFolderId)) {
      setSelectedFolderId(null)
    }
  }, [foldersById, selectedFolderId])

  useEffect(() => {
    if (selectedBackupSourceId !== null && !backupSourcesById.has(selectedBackupSourceId)) {
      setSelectedBackupSourceId(null)
    }
  }, [backupSourcesById, selectedBackupSourceId])

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
      <div className="space-y-6">
        <SettingsSection
          heading={t({ ko: '감시 폴더 운영', en: 'Watched folder operations' })}
          actions={
            <>
              <Button size="icon-sm" variant="outline" onClick={onRefresh} aria-label={t({ ko: '새로고침', en: 'Refresh' })} title={t({ ko: '새로고침', en: 'Refresh' })}>
                <RefreshCcw className="h-4 w-4" />
              </Button>
              <Button
                size="icon-sm"
                variant="outline"
                onClick={onVerifyAllFiles}
                disabled={isVerifyingAllFiles}
                aria-label={t({ ko: '전체 파일 검증', en: 'Verify all files' })}
                title={t({ ko: '전체 파일 검증', en: 'Verify all files' })}
              >
                <ShieldCheck className="h-4 w-4" />
              </Button>
              <Button size="icon-sm" onClick={onScanAll} aria-label={t({ ko: '전체 스캔', en: 'Full scan' })} title={t({ ko: '전체 스캔', en: 'Full scan' })}>
                <ScanSearch className="h-4 w-4" />
              </Button>
            </>
          }
        >
          <div className="grid gap-3 text-sm md:grid-cols-6">
            <SettingsValueTile label={t({ ko: '폴더', en: 'Folders' })} value={formatNumber(folders.length)} valueClassName="text-xl" />
            <SettingsValueTile label={t({ ko: '백업 소스', en: 'Backup sources' })} value={formatNumber(backupSources.length)} valueClassName="text-xl" />
            <SettingsValueTile label={t({ ko: '감시 중', en: 'Watching' })} value={formatNumber(watchersHealth?.watching ?? 0)} valueClassName="text-xl" />
            <SettingsValueTile label={t({ ko: '오류', en: 'Errors' })} value={formatNumber(watchersHealth?.error ?? 0)} valueClassName="text-xl" />
            <SettingsValueTile label={t({ ko: '24시간 이벤트', en: 'Events 24h' })} value={formatNumber(watchersHealth?.totalEvents24h ?? 0)} valueClassName="text-xl" />
            <SettingsValueTile label={t({ ko: '최근 스캔 로그', en: 'Latest scan log' })} value={scanLogs[0]?.folder_name ?? '—'} />
          </div>
        </SettingsSection>

        <section className="space-y-4">
          {foldersLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-20 w-full rounded-sm" />
              ))}
            </div>
          ) : null}

          {foldersError ? (
            <Alert variant="destructive">
              <AlertTitle>{t({ ko: '감시 폴더를 불러오지 못했어', en: 'Could not load watched folders' })}</AlertTitle>
              <AlertDescription>{foldersError}</AlertDescription>
            </Alert>
          ) : null}

          {!foldersLoading && !foldersError ? (
            <SettingsSection
              heading={t({ ko: '등록된 감시 폴더', en: 'Registered watched folders' })}
              actions={
                <Button
                  type="button"
                  size="icon-sm"
                  onClick={() => setIsAddFolderModalOpen(true)}
                  aria-label={t({ ko: '감시 폴더 추가', en: 'Add watched folder' })}
                  title={t({ ko: '감시 폴더 추가', en: 'Add watched folder' })}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              }
              bodyClassName="px-0 py-0"
            >
              {folders.length > 0 ? (
                <SettingsResourceTable
                  gridClassName={WATCHED_FOLDER_TABLE_GRID}
                  minWidthClassName="min-w-[860px]"
                  headers={[t({ ko: '이름', en: 'Name' }), t({ ko: '경로', en: 'Path' }), t({ ko: '활성', en: 'Active' }), t({ ko: '감시', en: 'Watcher' }), '']}
                >
                  {folders.map((folder) => (
                    <WatchedFolderListItem
                      key={folder.id}
                      folder={folder}
                      watcherState={folderWatcherMap.get(folder.id)}
                      selected={selectedFolderId === folder.id}
                      gridClassName={WATCHED_FOLDER_TABLE_GRID}
                      onOpenOptions={setSelectedFolderId}
                    />
                  ))}
                </SettingsResourceTable>
              ) : (
                <div className="px-4 py-6 text-sm text-muted-foreground">{t({ ko: '등록된 감시 폴더가 없어.', en: 'No registered watched folders yet.' })}</div>
              )}
            </SettingsSection>
          ) : null}
        </section>

        <section className="space-y-4">
          {backupSourcesLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, index) => (
                <Skeleton key={index} className="h-20 w-full rounded-sm" />
              ))}
            </div>
          ) : null}

          {backupSourcesError ? (
            <Alert variant="destructive">
              <AlertTitle>{t({ ko: '백업 소스를 불러오지 못했어', en: 'Could not load backup sources' })}</AlertTitle>
              <AlertDescription>{backupSourcesError}</AlertDescription>
            </Alert>
          ) : null}

          {!backupSourcesLoading && !backupSourcesError ? (
            <SettingsSection
              heading={t({ ko: '등록된 백업 소스', en: 'Registered backup sources' })}
              actions={
                <Button
                  type="button"
                  size="icon-sm"
                  onClick={() => setIsAddBackupSourceModalOpen(true)}
                  aria-label={t({ ko: '백업 소스 추가', en: 'Add backup source' })}
                  title={t({ ko: '백업 소스 추가', en: 'Add backup source' })}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              }
              bodyClassName="px-0 py-0"
            >
              {backupSources.length > 0 ? (
                <SettingsResourceTable
                  gridClassName={BACKUP_SOURCE_TABLE_GRID}
                  minWidthClassName="min-w-[1120px]"
                  headers={[t({ ko: '이름', en: 'Name' }), t({ ko: '원본 경로', en: 'Source path' }), t({ ko: '대상', en: 'Target' }), t({ ko: '활성', en: 'Active' }), t({ ko: '감시', en: 'Watcher' }), '']}
                >
                  {backupSources.map((source) => (
                    <BackupSourceListItem
                      key={source.id}
                      source={source}
                      selected={selectedBackupSourceId === source.id}
                      gridClassName={BACKUP_SOURCE_TABLE_GRID}
                      onOpenOptions={setSelectedBackupSourceId}
                    />
                  ))}
                </SettingsResourceTable>
              ) : (
                <div className="px-4 py-6 text-sm text-muted-foreground">{t({ ko: '등록된 백업 소스가 없어.', en: 'No registered backup sources yet.' })}</div>
              )}
            </SettingsSection>
          ) : null}
        </section>

        <section className="space-y-4">
          <SettingsSection heading={t({ ko: '최근 스캔 로그', en: 'Recent scan logs' })} bodyClassName="px-0 py-0">
            {scanLogsLoading ? (
              <div className="space-y-2 px-4 py-4">
                {Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className="h-14 w-full rounded-sm" />
                ))}
              </div>
            ) : null}

            {!scanLogsLoading && scanLogs.length === 0 ? <p className="px-4 py-6 text-sm text-muted-foreground">{t({ ko: '최근 스캔 로그가 없어.', en: 'No recent scan logs.' })}</p> : null}

            {!scanLogsLoading && scanLogs.length > 0 ? (
              <SettingsResourceTable
                gridClassName={SCAN_LOG_TABLE_GRID}
                minWidthClassName="min-w-[980px]"
                headers={[t({ ko: '폴더', en: 'Folder' }), t({ ko: '상태', en: 'Status' }), t({ ko: '스캔', en: 'Scanned' }), t({ ko: '신규', en: 'New' }), t({ ko: '기존', en: 'Existing' }), t({ ko: '오류', en: 'Errors' }), t({ ko: '시각', en: 'Time' })]}
              >
                {scanLogs.map((log) => (
                  <div key={log.id} className={`grid items-center px-4 py-3 text-sm transition-colors hover:bg-surface-high/60 ${SCAN_LOG_TABLE_GRID}`}>
                    <div className="min-w-0">
                      <div className="truncate font-medium text-foreground">{log.folder_name || `Folder #${log.folder_id}`}</div>
                      {log.folder_path ? <div className="truncate font-mono text-[11px] text-muted-foreground">{log.folder_path}</div> : null}
                    </div>
                    <div className="text-center text-xs uppercase tracking-[0.14em] text-muted-foreground">{log.status}</div>
                    <div className="text-center font-medium text-foreground">{formatNumber(log.total_scanned ?? 0)}</div>
                    <div className="text-center font-medium text-foreground">{formatNumber(log.new_images ?? 0)}</div>
                    <div className="text-center font-medium text-foreground">{formatNumber(log.existing_images ?? 0)}</div>
                    <div className="text-center font-medium text-foreground">{formatNumber(log.error_count ?? 0)}</div>
                    <div className="text-center text-xs text-muted-foreground">{formatDateTime(log.scan_date, locale)}</div>
                  </div>
                ))}
              </SettingsResourceTable>
            ) : null}
          </SettingsSection>
        </section>
      </div>

      <SettingsModal
        open={isAddFolderModalOpen}
        onClose={() => setIsAddFolderModalOpen(false)}
        title={t({ ko: '감시 폴더 추가', en: 'Add watched folder' })}
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
        title={selectedFolder ? selectedFolder.folder_name || t({ ko: '감시 폴더 상세', en: 'Watched folder details' }) : t({ ko: '감시 폴더 상세', en: 'Watched folder details' })}
        description={selectedFolder ? selectedFolder.folder_path : t({ ko: '감시 폴더 상세 정보와 수정', en: 'Watched folder details and editing' })}
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
        title={t({ ko: '백업 소스 추가', en: 'Add backup source' })}
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
        title={selectedBackupSource ? selectedBackupSource.display_name || t({ ko: '백업 소스 상세', en: 'Backup source details' }) : t({ ko: '백업 소스 상세', en: 'Backup source details' })}
        description={selectedBackupSource ? selectedBackupSource.source_path : t({ ko: '백업 소스 상세 정보와 수정', en: 'Backup source details and editing' })}
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
