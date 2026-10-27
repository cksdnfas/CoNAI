import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useI18n } from '@/i18n'
import { checkDanbooruLatestRelease, getDanbooruInstallationStatus, installLatestDanbooruRelease } from '@/lib/api-danbooru-browser'
import type { DanbooruInstallationStatus } from '@/types/danbooru-browser'

const QUERY_KEY = ['danbooru-browser-installation'] as const
const isRunning = (phase?: DanbooruInstallationStatus['phase']) => phase === 'checking' || phase === 'downloading' || phase === 'validating'

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
          <Button size="sm" variant={available ? 'secondary' : 'default'} disabled={busy || check.isPending || statusQuery.isLoading} onClick={() => install.mutate()}>
            <Download />
            {busy ? phaseLabel : available ? t({ ko: '최신 버전으로 업데이트', en: 'Update to latest' }) : t({ ko: '최신 DB 다운로드하고 설치', en: 'Download and install latest DB' })}
            {!busy && status?.latestSize ? ` · ${megabytes(status.latestSize)} MB` : ''}
          </Button>
        ) : <span className="text-xs text-muted-foreground">{t({ ko: '최신 버전을 사용 중이야.', en: 'Your database is up to date.' })}</span>}
        <Button size="sm" variant="ghost" disabled={busy || check.isPending || statusQuery.isLoading} onClick={() => { install.reset(); check.mutate() }}>
          <RefreshCw className={check.isPending ? 'animate-spin' : undefined} />
          {t({ ko: '업데이트 확인', en: 'Check for updates' })}
        </Button>
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
