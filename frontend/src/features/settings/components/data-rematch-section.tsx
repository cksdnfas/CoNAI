import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, DatabaseZap, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { getDataRematchStatus, startDataRematchJob, type DataRematchJobSnapshot, type DataRematchOptions } from '@/lib/api-settings'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { Inset } from '@/components/ui/inset'
import { StatTile } from '@/components/ui/stat-tile'
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

/** Render the data rematch job (thumbnails, metadata, hashes) with its live status. */
export function DataRematchSection() {
  const { t, language } = useI18n()
  const confirm = useConfirm()
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

  const startDataRematch = async () => {
    if (!hasSelectedDataRematchOption) {
      showSnackbar({ message: t({ ko: '재생성 범위를 먼저 선택해.', en: 'Select a rematch scope first.' }), tone: 'error' })
      return
    }

    const confirmed = await confirm(dataRematchOptions.hash
      ? {
          title: t({ ko: '해시 재생성', en: 'Regenerate hashes' }),
          description: t({ ko: '모든 이미지의 해시를 다시 계산하고, 옮겨지지 않는 연결은 끊어져. 되돌릴 수 없어. 시작할까?', en: 'Every image hash is recalculated and links that cannot be carried over are removed. This cannot be undone. Start?' }),
          confirmLabel: t({ ko: '해시 재생성', en: 'Regenerate hashes' }),
          tone: 'destructive',
        }
      : {
          title: t({ ko: '데이터 재매칭', en: 'Data rematch' }),
          description: t({ ko: '선택한 항목을 전체 라이브러리에 대해 다시 만들어. 항목이 많으면 한동안 걸려. 시작할까?', en: 'The selected items are rebuilt for the whole library. With many items this takes a while. Start?' }),
          confirmLabel: t({ ko: '시작', en: 'Start' }),
        })
    if (!confirmed) {
      return
    }

    dataRematchMutation.mutate()
  }

  const renderOption = (key: keyof DataRematchOptions, label: string, disabled: boolean) => (
    <label className="flex cursor-pointer items-center gap-3 rounded-sm bg-surface-low/60 px-3 py-2.5 text-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
      <Checkbox
        checked={dataRematchOptions[key]}
        disabled={disabled}
        onCheckedChange={(checked) => updateDataRematchOption(key, checked === true)}
      />
      <span className="min-w-0 font-medium text-foreground">{label}</span>
    </label>
  )

  return (
    <Section
      variant="settings"
      heading={t({ ko: '데이터 재매칭', en: 'Data rematch' })}
      actions={(
        <Button
          size="sm"
          variant={dataRematchOptions.hash ? 'destructive' : 'secondary'}
          onClick={() => void startDataRematch()}
          disabled={isDataRematchBusy || !hasSelectedDataRematchOption || (dataRematchOptions.hash && !hashConfirmed)}
        >
          {isDataRematchBusy ? <RotateCw className="h-4 w-4 animate-spin" /> : <DatabaseZap className="h-4 w-4" />}
          {isDataRematchBusy ? t({ ko: '진행 중', en: 'Running' }) : t({ ko: '실행', en: 'Run' })}
        </Button>
      )}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.82fr)]">
        <div className="space-y-2">
          {renderOption('thumbnail', t({ ko: '썸네일 재생성', en: 'Regenerate thumbnails' }), isDataRematchBusy || dataRematchOptions.hash)}
          {renderOption('metadata', t({ ko: '메타데이터 재추출', en: 'Re-extract metadata' }), isDataRematchBusy || dataRematchOptions.hash)}
          {renderOption('hash', t({ ko: '해시 재생성', en: 'Regenerate hashes' }), isDataRematchBusy)}

          {dataRematchOptions.hash ? (
            <div className="rounded-sm bg-destructive-soft px-4 py-3 text-sm text-destructive-soft-foreground">
              <div className="flex gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="space-y-2">
                  <p>{t({ ko: '그룹·자동 폴더 그룹·모델 정보·임시 링크·생성 기록과의 연결은 옮겨지지 않고 끊어져. 필요하면 다시 지정해야 해.', en: 'Links to groups, auto-folder groups, model info, temporary links and generation history are not carried over — they are removed and must be set again if needed.' })}</p>
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold">
                    <Checkbox
                      checked={hashConfirmed}
                      disabled={isDataRematchBusy}
                      onCheckedChange={(checked) => setHashConfirmed(checked === true)}
                    />
                    {t({ ko: '위 내용을 확인했어', en: 'I understand the above' })}
                  </label>
                </div>
              </div>
            </div>
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
            <div className="space-y-1 rounded-sm bg-destructive-soft px-4 py-3 text-xs text-destructive-soft-foreground">
              {latestErrors.map((error) => (
                <div key={`${error.target}-${error.error}`} className="truncate" title={`${error.target}: ${error.error}`}>
                  {error.target}: {error.error}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </Section>
  )
}
