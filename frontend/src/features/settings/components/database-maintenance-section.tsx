import { useEffect, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Database, Download, Shrink, Trash2, Eraser, RefreshCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Progress } from '@/components/ui/progress'
import { RowGroup } from '@/components/ui/row-group'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { formatFileSize } from '@/lib/api-files'
import { listRuntimeJobs } from '@/lib/api-runtime-jobs'
import { runtimeJobQueryKey, useRuntimeJob } from '@/lib/use-runtime-job'
import {
  DATABASE_BACKUPS_QUERY_KEY,
  DATABASE_STATS_QUERY_KEY,
  databaseBackupDownloadUrl,
  deleteDatabaseBackup,
  getDatabaseStats,
  listDatabaseBackups,
  startDatabaseBackup,
  startDatabaseCompaction,
  startOrphanCleanup,
  type DatabaseBackupEntry,
  type DatabaseBackupResult,
  type DatabaseCompactionResult,
  type MediaOrphanCleanupResult,
} from '@/lib/api-database-maintenance'
import { cn } from '@/lib/utils'
import type { RuntimeJobKind, RuntimeJobRecord } from '@/types/runtime-job'

/** One row of the section, laid out like the 유지보수 tab's action rows: icon + title + meta, actions, body. */
function DatabaseRow({ icon, title, meta, actions, children }: { icon: ReactNode; title: string; meta?: ReactNode; actions: ReactNode; children?: ReactNode }) {
  return (
    <div className="border-b border-line py-2.5 last:border-b-0">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 text-muted-foreground">{icon}</span>
          <div className="shrink-0 text-sm text-foreground">{title}</div>
          {meta ? <div className="hidden min-w-0 truncate text-xs text-muted-foreground sm:block">{meta}</div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      </div>
      {children ? <div className="pt-2 pl-7">{children}</div> : null}
    </div>
  )
}

/**
 * The latest job of one kind (so a reload shows the last result and resumes a running job), switched to a job this
 * screen just started. Polling follows the shared runtime-job contract and keeps going through failed requests —
 * the server stops answering while it compacts and comes back afterwards.
 */
function useLatestRuntimeJob<TResult>(kind: RuntimeJobKind, onSettled: () => void) {
  const queryClient = useQueryClient()
  const [startedJobId, setStartedJobId] = useState<string | null>(null)
  const latestQuery = useQuery({
    queryKey: ['runtime-jobs', 'latest', kind],
    queryFn: async () => (await listRuntimeJobs({ kind, limit: 1 }))[0] ?? null,
  })
  const jobId = startedJobId ?? latestQuery.data?.jobId ?? null
  const tracked = useRuntimeJob<TResult>(jobId, { onCompleted: onSettled, onFailed: onSettled, onCancelled: onSettled })
  const track = (job: RuntimeJobRecord<TResult>) => {
    queryClient.setQueryData(runtimeJobQueryKey(job.jobId), job)
    setStartedJobId(job.jobId)
  }
  return { ...tracked, track }
}

function useElapsedSeconds(since: string | null | undefined, running: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])
  if (!since) return 0
  // Job timestamps are SQLite UTC without a zone.
  const started = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(since) ? since : `${since.replace(' ', 'T')}Z`)
  return Number.isFinite(started) ? Math.max(0, Math.round((now - started) / 1000)) : 0
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return minutes > 0 ? `${minutes}:${String(rest).padStart(2, '0')}` : `0:${String(rest).padStart(2, '0')}`
}

function toDate(value: string) {
  return /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`
}

function Stat({ label, value, extra, done }: { label: string; value: string; extra?: string; done: boolean }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div className={cn('text-base font-semibold tabular-nums', done && 'text-success')}>
        {value}
        {extra ? <span className="ml-1 text-xs font-normal text-muted-foreground">{extra}</span> : null}
      </div>
    </div>
  )
}

/** Admin database maintenance in the 유지보수 tab: online backups, orphan cleanup and compaction. */
export function DatabaseMaintenanceSection() {
  const { t, formatNumber, formatDateTime } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()

  const statsQuery = useQuery({ queryKey: DATABASE_STATS_QUERY_KEY, queryFn: getDatabaseStats })
  const backupsQuery = useQuery({ queryKey: DATABASE_BACKUPS_QUERY_KEY, queryFn: listDatabaseBackups })
  const refreshSizes = () => {
    void queryClient.invalidateQueries({ queryKey: DATABASE_STATS_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: DATABASE_BACKUPS_QUERY_KEY })
  }
  const reportError = (error: unknown, fallback: string) => showSnackbar({ message: error instanceof Error ? error.message : fallback, tone: 'error' })

  const backupJob = useLatestRuntimeJob<DatabaseBackupResult>('database-backup', refreshSizes)
  const orphanJob = useLatestRuntimeJob<MediaOrphanCleanupResult>('media-orphan-cleanup', () => undefined)
  const compactJob = useLatestRuntimeJob<DatabaseCompactionResult>('database-compaction', refreshSizes)

  const startBackup = useMutation({ mutationFn: startDatabaseBackup, onSuccess: backupJob.track, onError: (error) => reportError(error, t({ ko: '백업을 시작하지 못했어.', en: 'Could not start the backup.' })) })
  const startOrphan = useMutation({ mutationFn: startOrphanCleanup, onSuccess: orphanJob.track, onError: (error) => reportError(error, t({ ko: '고아 정리를 시작하지 못했어.', en: 'Could not start the cleanup.' })) })
  const startCompact = useMutation({ mutationFn: startDatabaseCompaction, onSuccess: compactJob.track, onError: (error) => reportError(error, t({ ko: '압축을 시작하지 못했어.', en: 'Could not start the compaction.' })) })
  const removeBackup = useMutation({
    mutationFn: deleteDatabaseBackup,
    onSuccess: refreshSizes,
    onError: (error) => reportError(error, t({ ko: '백업을 지우지 못했어.', en: 'Could not delete the backup.' })),
  })

  const backups = backupsQuery.data?.backups ?? []
  const images = statsQuery.data?.databases.find((entry) => entry.fileName === 'images.db')
  const formatStamp = (value: string) => formatDateTime(toDate(value), { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

  // ---- backup ----
  const backupRunning = backupJob.isRunning || startBackup.isPending
  const backupProgress = backupJob.job?.progress
  const backupMeta = backups.length > 0
    ? t({ ko: '{count}개 보관 · {size}', en: '{count} kept · {size}' }, { count: formatNumber(backups.length), size: formatFileSize(backups.reduce((sum, entry) => sum + entry.totalBytes, 0)) })
    : null

  const confirmDeleteBackup = async (entry: DatabaseBackupEntry) => {
    if (await confirm({
      title: t({ ko: 'DB 백업 지우기', en: 'Delete database backup' }),
      description: t({ ko: '{time} 백업을 지울까? 되돌릴 수 없어.', en: 'Delete the backup from {time}? This cannot be undone.' }, { time: formatStamp(entry.createdAt) }),
      confirmLabel: t({ ko: '지우기', en: 'Delete' }),
      tone: 'destructive',
    })) {
      removeBackup.mutate(entry.name)
    }
  }

  const downloadBackup = (entry: DatabaseBackupEntry) => {
    const link = document.createElement('a')
    link.href = databaseBackupDownloadUrl(entry.name)
    link.download = `conai-db-backup-${entry.name}.zip`
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  // ---- orphan cleanup ----
  const orphanRunning = orphanJob.isRunning || startOrphan.isPending
  const orphanResult = orphanJob.job?.status === 'completed' ? orphanJob.job.result : null
  // A preview counts what would go; a real run counts what went.
  const orphanCounts = orphanResult ? {
    missing: orphanResult.dryRun ? orphanResult.missingFiles.matched : orphanResult.missingFiles.deleted,
    orphans: orphanResult.dryRun
      ? Math.max(0, orphanResult.orphanMetadata.candidates - orphanResult.orphanMetadata.keptReferenced)
      : orphanResult.orphanMetadata.deleted,
    kept: orphanResult.orphanMetadata.keptReferenced,
    thumbnails: orphanResult.dryRun ? orphanResult.orphanThumbnails.orphaned : orphanResult.orphanThumbnails.deleted,
    thumbnailBytes: orphanResult.orphanThumbnails.bytes,
    temp: orphanResult.tempLeftovers.graphExecutionDirs + orphanResult.tempLeftovers.incomingEntries + orphanResult.tempLeftovers.videoFrames,
    tempBytes: orphanResult.tempLeftovers.bytes,
  } : null
  const previewReady = Boolean(orphanResult?.dryRun) && !orphanRunning
  const orphanMeta = orphanResult && orphanJob.job?.completedAt
    ? `${formatStamp(orphanJob.job.completedAt)} ${orphanResult.dryRun ? t({ ko: '미리보기', en: 'preview' }) : t({ ko: '정리함', en: 'cleaned' })}`
    : null

  const confirmCleanup = async () => {
    if (!orphanCounts) return
    if (await confirm({
      title: t({ ko: '고아 정리', en: 'Orphan cleanup' }),
      description: t(
        { ko: '사라진 파일 기록 {missing}개, 파일 없는 이미지 {orphans}개, 썸네일 {thumbnails}개({thumbnailSize}), 임시 찌꺼기 {temp}개를 지울까? 되돌릴 수 없어.', en: 'Delete {missing} missing file records, {orphans} images without files, {thumbnails} thumbnails ({thumbnailSize}) and {temp} temp leftovers? This cannot be undone.' },
        { missing: formatNumber(orphanCounts.missing), orphans: formatNumber(orphanCounts.orphans), thumbnails: formatNumber(orphanCounts.thumbnails), thumbnailSize: formatFileSize(orphanCounts.thumbnailBytes), temp: formatNumber(orphanCounts.temp) },
      ),
      confirmLabel: t({ ko: '정리하기', en: 'Clean up' }),
      tone: 'destructive',
    })) {
      startOrphan.mutate(false)
    }
  }

  // ---- compaction ----
  const compactRunning = compactJob.isRunning || startCompact.isPending
  const compactElapsed = useElapsedSeconds(compactJob.job?.startedAt ?? compactJob.job?.queuedAt, compactRunning)
  const compactResult = compactJob.job?.status === 'completed' ? compactJob.job.result : null
  const compactMeta = images
    ? images.reclaimableBytes > 0
      ? t({ ko: '{size} · {free} 비울 수 있어', en: '{size} · {free} reclaimable' }, { size: formatFileSize(images.fileBytes), free: formatFileSize(images.reclaimableBytes) })
      : formatFileSize(images.fileBytes)
    : null

  const confirmCompaction = async () => {
    if (await confirm({
      title: t({ ko: 'DB 압축', en: 'Compact database' }),
      description: t(
        { ko: '압축하는 동안 서버가 멈춰서 아무 요청도 받지 못해. 디스크에 DB 크기({size})만큼 여유 공간이 더 있어야 해. 지금 압축할까?', en: 'The server stops answering while it compacts. The disk needs free space equal to the database size ({size}). Compact now?' },
        { size: images ? formatFileSize(images.fileBytes) : '?' },
      ),
      confirmLabel: t({ ko: '압축', en: 'Compact' }),
      tone: 'destructive',
    })) {
      startCompact.mutate()
    }
  }

  const busyIcon = <RefreshCcw className="h-4 w-4 animate-spin" />

  return (
    <RowGroup heading={t({ ko: '데이터베이스', en: 'Database' })}>
      <DatabaseRow
        icon={<Database className="h-4 w-4" />}
        title={t({ ko: 'DB 백업', en: 'Database backup' })}
        meta={backupMeta}
        actions={(
          <Button type="button" size="sm" variant="secondary" disabled={backupRunning} onClick={() => startBackup.mutate()}>
            {backupRunning ? busyIcon : null}
            {backupRunning ? t({ ko: '백업 중', en: 'Backing up' }) : t({ ko: '지금 백업', en: 'Back up now' })}
          </Button>
        )}
      >
        {backupRunning && backupProgress ? (
          <div className="mb-2 space-y-2">
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span className="truncate">
                {backupJob.job?.phase
                  ? `${backupJob.job.phase} · ${formatFileSize(backupProgress.processed)} / ${formatFileSize(backupProgress.total)}`
                  : t({ ko: '준비 중', en: 'Preparing' })}
              </span>
              <span className="tabular-nums">{formatNumber(backupProgress.percentage)}%</span>
            </div>
            <Progress size="lg" value={backupJob.job?.phase ? backupProgress.percentage : null} />
          </div>
        ) : null}
        {backupJob.job?.status === 'failed' && backupJob.job.failureMessage ? (
          <div className="mb-2 text-xs text-destructive">{backupJob.job.failureMessage}</div>
        ) : null}
        {backups.length > 0 ? (
          <div>
            {backups.map((entry) => (
              <div key={entry.name} className="flex h-8 items-center gap-3 border-t border-line text-sm first:border-t-0">
                <span className="min-w-0 flex-1 truncate">{formatStamp(entry.createdAt)}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatFileSize(entry.totalBytes)}</span>
                <IconButton size="icon-sm" variant="ghost" label={t({ ko: '받기', en: 'Download' })} onClick={() => downloadBackup(entry)}>
                  <Download className="h-4 w-4" />
                </IconButton>
                <IconButton size="icon-sm" variant="ghost" label={t({ ko: '지우기', en: 'Delete' })} disabled={backupRunning || removeBackup.isPending} onClick={() => void confirmDeleteBackup(entry)}>
                  <Trash2 className="h-4 w-4" />
                </IconButton>
              </div>
            ))}
          </div>
        ) : null}
      </DatabaseRow>

      <DatabaseRow
        icon={<Eraser className="h-4 w-4" />}
        title={t({ ko: '고아 정리', en: 'Orphan cleanup' })}
        meta={orphanMeta}
        actions={previewReady ? (
          <Button type="button" size="sm" variant="destructive" onClick={() => void confirmCleanup()}>
            {t({ ko: '정리하기', en: 'Clean up' })}
          </Button>
        ) : (
          <Button type="button" size="sm" variant="secondary" disabled={orphanRunning} onClick={() => startOrphan.mutate(true)}>
            {orphanRunning ? busyIcon : null}
            {orphanRunning
              ? startOrphan.variables === false ? t({ ko: '정리 중', en: 'Cleaning' }) : t({ ko: '확인 중', en: 'Checking' })
              : t({ ko: '미리보기', en: 'Preview' })}
          </Button>
        )}
      >
        {orphanRunning ? <Progress size="lg" value={null} /> : null}
        {!orphanRunning && orphanCounts ? (
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            <Stat done={!orphanResult?.dryRun} label={t({ ko: '사라진 파일 기록', en: 'Missing file records' })} value={formatNumber(orphanCounts.missing)} />
            <Stat
              done={!orphanResult?.dryRun}
              label={t({ ko: '파일 없는 이미지', en: 'Images without files' })}
              value={formatNumber(orphanCounts.orphans)}
              extra={orphanCounts.kept > 0 ? t({ ko: '참조 중 {count}개 남김', en: '{count} kept (in use)' }, { count: formatNumber(orphanCounts.kept) }) : undefined}
            />
            <Stat done={!orphanResult?.dryRun} label={t({ ko: '남은 썸네일', en: 'Stray thumbnails' })} value={formatNumber(orphanCounts.thumbnails)} extra={formatFileSize(orphanCounts.thumbnailBytes)} />
            <Stat done={!orphanResult?.dryRun} label={t({ ko: '임시 찌꺼기', en: 'Temp leftovers' })} value={formatNumber(orphanCounts.temp)} extra={formatFileSize(orphanCounts.tempBytes)} />
          </div>
        ) : null}
        {!orphanRunning && orphanJob.job?.status === 'failed' && orphanJob.job.failureMessage ? (
          <div className="text-xs text-destructive">{orphanJob.job.failureMessage}</div>
        ) : null}
      </DatabaseRow>

      <DatabaseRow
        icon={<Shrink className="h-4 w-4" />}
        title={t({ ko: 'DB 압축', en: 'Compact database' })}
        meta={compactMeta}
        actions={(
          <Button type="button" size="sm" variant="secondary" disabled={compactRunning} onClick={() => void confirmCompaction()}>
            {compactRunning ? busyIcon : null}
            {compactRunning ? t({ ko: '압축 중', en: 'Compacting' }) : t({ ko: '압축', en: 'Compact' })}
          </Button>
        )}
      >
        {compactRunning ? (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground tabular-nums">
              {t({ ko: '압축 중 · {elapsed}', en: 'Compacting · {elapsed}' }, { elapsed: formatDuration(compactElapsed) })}
            </div>
            <Progress size="lg" value={null} />
          </div>
        ) : null}
        {!compactRunning && compactResult ? (
          <div className="flex h-8 items-center gap-3 text-sm">
            <span className="min-w-0 flex-1 truncate">
              {formatFileSize(compactResult.bytesBefore)} → <span className="font-semibold">{formatFileSize(compactResult.bytesAfter)}</span>
            </span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {t({ ko: '{seconds}초', en: '{seconds}s' }, { seconds: formatNumber(Math.max(1, Math.round(compactResult.durationMs / 1000))) })}
            </span>
          </div>
        ) : null}
        {!compactRunning && compactJob.job?.status === 'failed' && compactJob.job.failureMessage ? (
          <div className="text-xs text-destructive">{compactJob.job.failureMessage}</div>
        ) : null}
      </DatabaseRow>
    </RowGroup>
  )
}
