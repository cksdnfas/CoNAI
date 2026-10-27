import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AudioLines, Check, Download, Eye, FileArchive, Link2, RefreshCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { ListRow } from '@/components/ui/list-row'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { formatFileSize } from '@/lib/format-size'
import { listRuntimeJobs } from '@/lib/api-runtime-jobs'
import { runtimeJobQueryKey, useRuntimeJob } from '@/lib/use-runtime-job'
import {
  LEGACY_AUDIO_WORKFLOWS_QUERY_KEY,
  listLegacyAudioWorkflows,
  registerLegacyAudioWorkflow,
  startLegacyAudioImport,
  uploadLegacyAudioArchive,
  type LegacyAudioImportResult,
  type LegacyAudioImportSource,
} from '@/lib/api-audio-legacy-import'
import { cn } from '@/lib/utils'
import type { RuntimeJobRecord } from '@/types/runtime-job'
import { MaintenanceJobProgress, MaintenanceRow, MaintenanceStat } from './maintenance-row'

/**
 * 유지보수 › 데이터베이스: bring the old standalone SFX manager's data folder (or a zip of it) into the audio
 * workspace. Preview (dry run) first, then import; the legacy workflows it found can be registered one by one.
 */
export function LegacyAudioImportRow() {
  const { t, formatNumber } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [folder, setFolder] = useState('')
  const [archive, setArchive] = useState<{ name: string; uploadId: string } | null>(null)
  const [startedJobId, setStartedJobId] = useState<string | null>(null)
  const reportError = (error: unknown, fallback: string) => showSnackbar({ message: error instanceof Error ? error.message : fallback, tone: 'error' })

  const latestQuery = useQuery({
    queryKey: ['runtime-jobs', 'latest', 'audio-legacy-import'],
    queryFn: async () => (await listRuntimeJobs({ kind: 'audio-legacy-import', limit: 1 }))[0] ?? null,
  })
  const workflowsQuery = useQuery({ queryKey: LEGACY_AUDIO_WORKFLOWS_QUERY_KEY, queryFn: listLegacyAudioWorkflows })
  const refreshWorkflows = () => void queryClient.invalidateQueries({ queryKey: LEGACY_AUDIO_WORKFLOWS_QUERY_KEY })
  const jobId = startedJobId ?? latestQuery.data?.jobId ?? null
  const tracked = useRuntimeJob<LegacyAudioImportResult>(jobId, { onCompleted: refreshWorkflows, onFailed: () => undefined, onCancelled: () => undefined })

  const source: LegacyAudioImportSource | null = archive ? { upload_id: archive.uploadId } : folder.trim() ? { path: folder.trim() } : null
  const start = useMutation({
    mutationFn: ({ dryRun }: { dryRun: boolean }) => startLegacyAudioImport(source!, dryRun),
    onSuccess: (job: RuntimeJobRecord<LegacyAudioImportResult>, { dryRun }) => {
      queryClient.setQueryData(runtimeJobQueryKey(job.jobId), job)
      setStartedJobId(job.jobId)
      if (!dryRun) setArchive(null)
    },
    onError: (error) => reportError(error, t({ ko: '가져오기를 시작하지 못했어.', en: 'Could not start the import.' })),
  })
  const upload = useMutation({
    mutationFn: uploadLegacyAudioArchive,
    onSuccess: (data, file) => setArchive({ name: file.name, uploadId: data.upload_id }),
    onError: (error) => reportError(error, t({ ko: 'zip을 올리지 못했어.', en: 'Could not upload the zip.' })),
  })
  const register = useMutation({
    mutationFn: registerLegacyAudioWorkflow,
    onSuccess: (workflow) => {
      refreshWorkflows()
      showSnackbar({ message: t({ ko: '{name} 등록했어.', en: 'Registered {name}.' }, { name: workflow.name }), tone: 'info' })
    },
    onError: (error) => reportError(error, t({ ko: '워크플로를 등록하지 못했어.', en: 'Could not register the workflow.' })),
  })

  const running = tracked.isRunning || start.isPending || upload.isPending
  const job = tracked.job
  const result = job?.status === 'completed' ? job.result : null
  // A finished preview of the same source turns the action into the real import.
  const previewReady = Boolean(result?.dry_run) && !running && source !== null
  const progress = job?.progress
  const workflows = workflowsQuery.data ?? []

  const meta = result
    ? result.dry_run
      ? t({ ko: '미리보기 · 후보 {count}개', en: 'Preview · {count} candidates' }, { count: formatNumber(result.candidates.imported) })
      : t({ ko: '후보 {count}개 가져옴', en: '{count} candidates imported' }, { count: formatNumber(result.candidates.imported) })
    : null

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) upload.mutate(file)
          event.target.value = ''
        }}
      />
      <MaintenanceRow
        icon={<AudioLines className="h-4 w-4" />}
        title={t({ ko: '이전 오디오 앱 가져오기', en: 'Import the old SFX app' })}
        meta={meta}
        actions={<>
          <IconButton size="icon-sm" variant="ghost" label={t({ ko: 'zip 고르기', en: 'Choose a zip' })} disabled={running} onClick={() => fileInputRef.current?.click()}>
            <FileArchive className="h-4 w-4" />
          </IconButton>
          {previewReady ? (
            <Button size="sm" onClick={() => start.mutate({ dryRun: false })}>
              <Download />{t({ ko: '가져오기', en: 'Import' })}
            </Button>
          ) : (
            // The first step counts what would be imported, so the import itself shows what it will bring in.
            <Button size="sm" variant="secondary" disabled={running || source === null} onClick={() => start.mutate({ dryRun: true })}>
              {running ? <RefreshCcw className="animate-spin" /> : <Eye />}
              {running ? t({ ko: '진행 중', en: 'Working' }) : t({ ko: '미리보기', en: 'Preview' })}
            </Button>
          )}
        </>}
      >
        <div className="space-y-3">
          {archive ? (
            <div className="flex h-9 items-center gap-2 text-sm">
              <FileArchive className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{archive.name}</span>
              <IconButton size="icon-sm" variant="ghost" label={t({ ko: '빼기', en: 'Remove' })} disabled={running} onClick={() => setArchive(null)}>
                <X className="h-4 w-4" />
              </IconButton>
            </div>
          ) : (
            <Input
              value={folder}
              onChange={(event) => setFolder(event.target.value)}
              placeholder={t({ ko: '서버의 데이터 폴더 경로', en: 'Data folder path on the server' })}
              aria-label={t({ ko: '데이터 폴더 경로', en: 'Data folder path' })}
              disabled={running}
            />
          )}

          {running && progress ? (
            <MaintenanceJobProgress
              label={job?.phase ? `${job.phase} · ${formatNumber(progress.processed)} / ${formatNumber(progress.total)}` : t({ ko: '준비 중', en: 'Preparing' })}
              percentage={formatNumber(progress.percentage)}
              value={progress.total > 0 ? progress.percentage : null}
            />
          ) : null}
          {!running && job?.status === 'failed' && job.failureMessage ? <div className="text-xs text-destructive">{job.failureMessage}</div> : null}

          {!running && result ? (
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
              <MaintenanceStat
                done={!result.dry_run}
                label={t({ ko: '프로젝트', en: 'Projects' })}
                value={formatNumber(result.projects.created)}
                extra={result.projects.existing > 0 ? t({ ko: '기존 {count}', en: '{count} existing' }, { count: formatNumber(result.projects.existing) }) : undefined}
              />
              <MaintenanceStat
                done={!result.dry_run}
                label={t({ ko: '효과음', en: 'Effects' })}
                value={formatNumber(result.groups.created)}
                extra={result.groups.failed > 0 ? t({ ko: '실패 {count}', en: '{count} failed' }, { count: formatNumber(result.groups.failed) }) : undefined}
              />
              <MaintenanceStat
                done={!result.dry_run}
                label={t({ ko: '후보', en: 'Candidates' })}
                value={formatNumber(result.candidates.imported)}
                extra={result.candidates.already_imported > 0
                  ? t({ ko: '이미 {count}', en: '{count} already' }, { count: formatNumber(result.candidates.already_imported) })
                  : formatFileSize(result.files.bytes)}
              />
              <MaintenanceStat done={!result.dry_run} label={t({ ko: '코멘트', en: 'Comments' })} value={formatNumber(result.comments.imported)} />
            </div>
          ) : null}
          {!running && result && result.candidates.missing_file + result.candidates.failed > 0 ? (
            <div className="text-xs text-destructive">
              {t({ ko: '파일 없음 {missing} · 실패 {failed}', en: '{missing} missing files · {failed} failed' }, { missing: formatNumber(result.candidates.missing_file), failed: formatNumber(result.candidates.failed) })}
            </div>
          ) : null}

          {workflows.length > 0 ? (
            <div>
              {workflows.map((workflow) => (
                <ListRow
                  key={workflow.legacy_id}
                  size="sm"
                  trailing={(
                    <>
                      <span className="text-xs tabular-nums">{t({ ko: '노드 {count}', en: '{count} nodes' }, { count: formatNumber(workflow.node_count) })}</span>
                      {workflow.registered_workflow_id ? (
                        <span className="flex size-8 items-center justify-center text-success" aria-label={t({ ko: '등록됨', en: 'Registered' })}><Check className="h-4 w-4" /></span>
                      ) : (
                        <IconButton size="icon-sm" variant="ghost" label={t({ ko: '오디오 워크플로로 등록', en: 'Register as audio workflow' })} disabled={register.isPending} onClick={() => register.mutate(workflow.legacy_id)}>
                          <Link2 className="h-4 w-4" />
                        </IconButton>
                      )}
                    </>
                  )}
                >
                  <span className={cn('min-w-0 flex-1 truncate', workflow.deleted && 'text-muted-foreground line-through')}>{workflow.name} v{workflow.version}</span>
                </ListRow>
              ))}
            </div>
          ) : null}
        </div>
      </MaintenanceRow>
    </>
  )
}
