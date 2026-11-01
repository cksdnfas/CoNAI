import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, RefreshCw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { FieldInfo } from '@/components/ui/field'
import { Progress } from '@/components/ui/progress'
import { useI18n } from '@/i18n'
import { checkDanbooruLatestRelease, getDanbooruInstallationStatus, installLatestDanbooruRelease } from '@/lib/api-danbooru-browser'
import type { DanbooruBrowserDatabaseInfo, DanbooruInstallationStatus } from '@/types/danbooru-browser'
import { useCanSeeServerDetails } from '../use-can-see-server-details'

const QUERY_KEY = ['danbooru-browser-installation'] as const
const isRunning = (phase?: DanbooruInstallationStatus['phase']) => phase === 'checking' || phase === 'downloading' || phase === 'validating'

/** The missing-DB notice. Administrators also get where the file goes, so a manual install works when the automatic one cannot. */
export function PromptDanbooruMissingNotice({ database }: { database: DanbooruBrowserDatabaseInfo }) {
  const { t } = useI18n()
  const canInstall = useCanSeeServerDetails()
  return (
    <Alert>
      <AlertTitle>{t({ ko: 'Danbooru DB 파일 없음', en: 'Danbooru DB file missing' })}</AlertTitle>
      <AlertDescription>
        {canInstall ? (
          <div className="space-y-2">
            <PromptDanbooruInstallation available={false} />
            <div className="grid gap-1 text-xs sm:grid-cols-[120px_minmax(0,1fr)]">
              <span className="font-medium text-muted-foreground">{t({ ko: '기본 경로', en: 'Default path' })}</span>
              <span className="min-w-0 break-all font-mono text-foreground">{database.expectedPath}</span>
              <span className="font-medium text-muted-foreground">{t({ ko: '허용 파일명', en: 'Accepted names' })}</span>
              <span className="min-w-0 break-all font-mono text-foreground">{database.filePatterns.join(', ')}</span>
              <span className="font-medium text-muted-foreground">{t({ ko: '다운로드', en: 'Download' })}</span>
              <a className="min-w-0 break-all text-primary underline-offset-4 hover:underline" href={database.downloadUrl} target="_blank" rel="noreferrer">{database.downloadUrl}</a>
            </div>
          </div>
        ) : t({ ko: '관리자가 Danbooru DB를 설치해야 해.', en: 'An administrator needs to install the Danbooru DB.' })}
      </AlertDescription>
    </Alert>
  )
}

/** Mounted only for administrators, beside the missing-DB notice or above the installed browser. */
export function PromptDanbooruInstallation({ available }: { available: boolean }) {
  const { t, formatNumber } = useI18n()
  const queryClient = useQueryClient()
  const revision = useRef<string | null>(null)
  const statusQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: getDanbooruInstallationStatus,
    retry: false,
    refetchInterval: (query) => isRunning(query.state.data?.phase) ? 1000 : false,
  })
  const status = statusQuery.data
  const check = useMutation({
    mutationFn: checkDanbooruLatestRelease,
    onSuccess: (data) => queryClient.setQueryData(QUERY_KEY, data),
  })
  const install = useMutation({
    mutationFn: installLatestDanbooruRelease,
    onSuccess: () => {
      queryClient.setQueryData<DanbooruInstallationStatus>(QUERY_KEY, (previous) => previous
        ? { ...previous, phase: 'checking', downloadedBytes: 0, totalBytes: 0, error: null } : previous)
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    },
  })

  useEffect(() => {
    if (!status?.installedRevision || revision.current === status.installedRevision) return
    revision.current = status.installedRevision
    void queryClient.invalidateQueries({
      predicate: (query) => typeof query.queryKey[0] === 'string'
        && query.queryKey[0].startsWith('danbooru-browser-') && query.queryKey[0] !== QUERY_KEY[0],
    })
    void queryClient.invalidateQueries({ queryKey: ['prompt-danbooru-grouping-preview'] })
  }, [queryClient, status?.installedRevision])

  if (status?.canInstall === false) {
    return available ? null : <p className="text-xs text-muted-foreground">{t({ ko: '사용자 지정 DB 경로를 쓰고 있어. 자동 설치를 사용하려면 DANBOORU_SQLITE_PATH 설정을 해제해.', en: 'A custom DB path is configured. Remove DANBOORU_SQLITE_PATH to enable automatic installation.' })}</p>
  }

  const busy = install.isPending || isRunning(status?.phase)
  const error = install.error?.message || check.error?.message || status?.error || status?.releaseError || statusQuery.error?.message
  const megabytes = (bytes: number) => formatNumber(Math.round(bytes / 1_000_000))
  const phaseLabel = status?.phase === 'downloading'
    ? t({ ko: '다운로드 중', en: 'Downloading' })
    : status?.phase === 'validating'
      ? t({ ko: 'DB 확인 중', en: 'Verifying database' })
      : t({ ko: '최신 버전 확인 중', en: 'Checking latest release' })

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {status?.installedVersion ? <span className="text-xs text-muted-foreground">{t({ ko: '설치 버전', en: 'Installed' })} {status.installedVersion}</span> : null}
        {status?.latestVersion ? <span className="text-xs text-muted-foreground">{t({ ko: '최신 버전', en: 'Latest' })} {status.latestVersion}</span> : null}
        {(!status?.installedVersion || status.updateAvailable || busy || status.phase === 'error') ? (
          <>
            <Button size="sm" variant={available ? 'secondary' : 'default'} disabled={busy || check.isPending || statusQuery.isLoading} onClick={() => install.mutate()}>
              <Download />
              {busy ? phaseLabel : available ? t({ ko: '최신 버전으로 업데이트', en: 'Update to latest' }) : t({ ko: '최신 DB 다운로드하고 설치', en: 'Download and install latest DB' })}
              {!busy && status?.latestSize ? ` · ${megabytes(status.latestSize)} MB` : ''}
            </Button>
            <FieldInfo>{t({ ko: '다른 위치를 쓰려면 DANBOORU_SQLITE_PATH 환경변수로 파일 경로를 지정해.', en: 'Set DANBOORU_SQLITE_PATH to use a file from another location.' })}</FieldInfo>
          </>
        ) : <span className="text-xs text-muted-foreground">{t({ ko: '최신 버전을 사용 중이야.', en: 'Your database is up to date.' })}</span>}
        {available ? <Button size="sm" variant="ghost" disabled={busy || check.isPending || statusQuery.isLoading} onClick={() => { install.reset(); check.mutate() }}>
          <RefreshCw className={check.isPending ? 'animate-spin' : undefined} />
          {t({ ko: '업데이트 확인', en: 'Check for updates' })}
        </Button> : null}
      </div>
      {busy ? (
        <div className="max-w-md space-y-1" role="status" aria-live="polite">
          <Progress value={status?.phase === 'downloading' && status.totalBytes > 0 ? status.downloadedBytes / status.totalBytes * 100 : undefined} aria-label={phaseLabel} />
          <p className="text-xs text-muted-foreground">{phaseLabel}{status?.phase === 'downloading' ? ` · ${megabytes(status.downloadedBytes)} / ${megabytes(status.totalBytes)} MB` : ''}</p>
        </div>
      ) : null}
      {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}    </div>
  )
}
