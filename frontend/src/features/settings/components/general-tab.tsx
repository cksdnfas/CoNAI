import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, DatabaseZap, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { getDataRematchStatus, startDataRematchJob, type DataRematchJobSnapshot, type DataRematchOptions } from '@/lib/api-settings'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { Inset } from '@/components/ui/inset'
import { StatTile } from '@/components/ui/stat-tile'
import { ToggleRow } from '@/components/ui/toggle-row'
import { Section } from '@/components/ui/section'

const DEFAULT_DATA_REMATCH_OPTIONS: DataRematchOptions = {
  thumbnail: false,
  metadata: false,
  hash: false,
}

function formatCount(value: number) {
  return Number.isFinite(value) ? value.toLocaleString() : '0'
}

function getPhaseLabel(status: DataRematchJobSnapshot | undefined, locale: 'ko' | 'en') {
  if (!status) return locale === 'ko' ? '확인 중' : 'Checking'

  const labels: Record<DataRematchJobSnapshot['phase'], { ko: string; en: string }> = {
    idle: { ko: '대기', en: 'Idle' },
    'selecting-targets': { ko: '대상 선별', en: 'Selecting' },
    'regenerating-thumbnails': { ko: '썸네일 재생성', en: 'Thumbnails' },
    'queueing-metadata': { ko: '메타데이터 큐 등록', en: 'Metadata queue' },
    'rebuilding-hashes': { ko: '해시 재생성', en: 'Hash rebuild' },
    'remapping-references': { ko: 'DB 참조 리매칭', en: 'Reference rematch' },
    completed: { ko: '완료', en: 'Completed' },
    failed: { ko: '실패', en: 'Failed' },
  }

  return labels[status.phase][locale]
}

/** Render long-running and destructive library maintenance operations. */
export function GeneralTab() {
  const { t, language } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [dataRematchOptions, setDataRematchOptions] = useState<DataRematchOptions>(DEFAULT_DATA_REMATCH_OPTIONS)
  const [hashConfirmed, setHashConfirmed] = useState(false)

  const dataRematchStatusQuery = useQuery({
    queryKey: ['data-rematch-status'],
    queryFn: getDataRematchStatus,
    refetchInterval: (query) => query.state.data?.status === 'running' ? 2000 : false,
  })

  const dataRematchMutation = useMutation({
    mutationFn: () => startDataRematchJob({
      ...dataRematchOptions,
      confirmHashRegeneration: dataRematchOptions.hash && hashConfirmed,
    }),
    onSuccess: (status) => {
      queryClient.setQueryData(['data-rematch-status'], status)
      showSnackbar({ message: t({ ko: '데이터 재매칭 작업을 시작했어.', en: 'Data rematch job started.' }), tone: 'info' })
    },
    onError: (error) => {
      showSnackbar({
        message: error instanceof Error ? error.message : t({ ko: '데이터 재매칭을 시작하지 못했어.', en: 'Failed to start data rematch.' }),
        tone: 'error',
      })
    },
  })

  const status = dataRematchStatusQuery.data
  const isDataRematchRunning = status?.status === 'running'
  const isDataRematchBusy = dataRematchMutation.isPending || isDataRematchRunning
  const hasSelectedDataRematchOption = dataRematchOptions.thumbnail || dataRematchOptions.metadata || dataRematchOptions.hash
  const dataRematchProgress = status && status.total > 0 ? Math.round((status.processed / status.total) * 100) : 0
  const latestErrors = status?.errors.slice(-3) ?? []

  const updateDataRematchOption = (key: keyof DataRematchOptions, checked: boolean) => {
    if (key === 'hash') {
      setDataRematchOptions(checked ? { thumbnail: false, metadata: false, hash: true } : { ...dataRematchOptions, hash: false })
      setHashConfirmed(false)
      return
    }

    setDataRematchOptions((previous) => ({
      ...previous,
      [key]: checked,
      hash: checked ? false : previous.hash,
    }))

    if (checked) {
      setHashConfirmed(false)
    }
  }

  const startDataRematch = () => {
    if (!hasSelectedDataRematchOption) {
      showSnackbar({ message: t({ ko: '재생성 범위를 먼저 선택해.', en: 'Select a rematch scope first.' }), tone: 'error' })
      return
    }

    dataRematchMutation.mutate()
  }

  return (
    <div className="space-y-6">
      <Section
        variant="settings"
        heading={t({ ko: '데이터 재매칭', en: 'Data rematch' })}
        actions={(
          <Button
            size="sm"
            variant={dataRematchOptions.hash ? 'destructive' : 'secondary'}
            onClick={startDataRematch}
            disabled={isDataRematchBusy || !hasSelectedDataRematchOption || (dataRematchOptions.hash && !hashConfirmed)}
          >
            {isDataRematchBusy ? <RotateCw className="h-4 w-4 animate-spin" /> : <DatabaseZap className="h-4 w-4" />}
            {isDataRematchBusy ? t({ ko: '진행 중', en: 'Running' }) : t({ ko: '실행', en: 'Run' })}
          </Button>
        )}
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.82fr)]">
          <div className="space-y-3">
            <ToggleRow>
              <input
                type="checkbox"
                checked={dataRematchOptions.thumbnail}
                disabled={isDataRematchBusy || dataRematchOptions.hash}
                onChange={(event) => updateDataRematchOption('thumbnail', event.target.checked)}
              />
              {t({ ko: '썸네일 재생성', en: 'Regenerate thumbnails' })}
            </ToggleRow>

            <ToggleRow>
              <input
                type="checkbox"
                checked={dataRematchOptions.metadata}
                disabled={isDataRematchBusy || dataRematchOptions.hash}
                onChange={(event) => updateDataRematchOption('metadata', event.target.checked)}
              />
              {t({ ko: '메타데이터 재추출', en: 'Re-extract metadata' })}
            </ToggleRow>

            <ToggleRow>
              <input
                type="checkbox"
                checked={dataRematchOptions.hash}
                disabled={isDataRematchBusy}
                onChange={(event) => updateDataRematchOption('hash', event.target.checked)}
              />
              {t({ ko: '해시 재생성', en: 'Regenerate hashes' })}
            </ToggleRow>

            {dataRematchOptions.hash ? (
              <Inset className="border-[#BA1A1A]/50 bg-[#410002]/25 text-sm text-[#FFDAD6]">
                <div className="flex gap-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="space-y-2">
                    <p>{t({ ko: '해시 재생성은 모든 이미지의 식별값을 새로 계산하고, 라이브러리의 기록을 새 값에 다시 연결해.', en: 'Regenerating hashes recalculates every image’s identifier and reconnects library records to the new values.' })}</p>
                    <p>{t({ ko: '그룹·자동 폴더 그룹·모델 정보·임시 링크·생성 기록과의 연결은 옮겨지지 않고 끊어져. 필요하면 다시 지정해야 해.', en: 'Links to groups, auto-folder groups, model info, temporary links and generation history are not carried over — they are removed and must be set again if needed.' })}</p>
                    <p>{t({ ko: '이미지와 GIF만 처리하고 동영상은 건너뛰어. 작업 중에는 자동 스캔과 자동 태그·작가 추출이 잠시 멈춰.', en: 'Only images and GIFs are processed; videos are skipped. Auto scan and automatic tag/artist extraction pause while the job runs.' })}</p>
                    <p>{t({ ko: '자동 태그·작가 추출은 작업이 끝난 뒤 순서대로 다시 진행돼.', en: 'Automatic tag/artist extraction resumes on its own after the job finishes.' })}</p>
                    <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em]">
                      <input
                        type="checkbox"
                        checked={hashConfirmed}
                        disabled={isDataRematchBusy}
                        onChange={(event) => setHashConfirmed(event.target.checked)}
                      />
                      {t({ ko: '위험 작업 확인', en: 'Confirm risky job' })}
                    </label>
                  </div>
                </div>
              </Inset>
            ) : null}
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <StatTile label={t({ ko: '상태', en: 'Status' })} value={getPhaseLabel(status, language)} />
              <StatTile
                label={t({ ko: '진행', en: 'Progress' })}
                value={status ? `${formatCount(status.processed)} / ${formatCount(status.total)}` : '-'}
              />
              <StatTile label={t({ ko: '큐', en: 'Queued' })} value={formatCount(status?.queued ?? 0)} />
              <StatTile
                label={t({ ko: '오류/제외', en: 'Errors/skipped' })}
                value={`${formatCount(status?.failed ?? 0)} / ${formatCount(status?.skipped ?? 0)}`}
              />
            </div>

            <div className="h-2 overflow-hidden rounded-full bg-surface-low">
              <div
                className={cn('h-full rounded-full transition-all', status?.status === 'failed' ? 'bg-destructive' : 'bg-primary')}
                style={{ width: `${Math.min(100, Math.max(0, dataRematchProgress))}%` }}
              />
            </div>

            {status?.currentFile ? (
              <div className="truncate text-xs text-muted-foreground" title={status.currentFile}>{status.currentFile}</div>
            ) : null}

            {status?.maintenanceLock.active ? (
              <Inset className="text-xs text-muted-foreground">
                {status.maintenanceLock.message ?? t({ ko: '시스템 유지보수 잠금 활성', en: 'System maintenance lock active' })}
              </Inset>
            ) : null}

            {latestErrors.length > 0 ? (
              <Inset className="space-y-1 text-xs text-[#FFDAD6] border-[#BA1A1A]/40 bg-[#410002]/20">
                {latestErrors.map((error) => (
                  <div key={`${error.target}-${error.error}`} className="truncate" title={`${error.target}: ${error.error}`}>
                    {error.target}: {error.error}
                  </div>
                ))}
              </Inset>
            ) : null}
          </div>
        </div>
      </Section>
    </div>
  )
}
