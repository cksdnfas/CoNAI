import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { RuntimeJobRecord } from '@/types/runtime-job'

interface RuntimeJobProgressProps {
  job: RuntimeJobRecord | undefined
  /** 취소 핸들러. 주지 않으면 취소 버튼을 렌더하지 않는다. */
  cancel?: () => void | Promise<void>
  isCancelling?: boolean
  className?: string
}

/**
 * 장기 실행 잡 진행률 표시.
 *
 * `general-tab.tsx` 의 인라인 진행률 바를 재사용 가능한 형태로 추출한 것이다.
 * 취소된 잡은 "N개 처리 후 중단됨" 으로 표기한다 — 이미 처리된 항목은 되돌리지 않기 때문이다.
 */
export function RuntimeJobProgress({ job, cancel, isCancelling = false, className }: RuntimeJobProgressProps) {
  const { t } = useI18n()

  if (!job) {
    return null
  }

  const isRunning = job.status === 'queued' || job.status === 'running'
  const currentLabel = job.progress.currentLabel

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>
          {job.progress.processed} / {job.progress.total} ({job.progress.percentage}%)
        </span>

        {isRunning && cancel ? (
          <Button type="button" size="sm" variant="ghost" disabled={isCancelling} onClick={() => void cancel()}>
            {isCancelling
              ? t({ ko: '취소하는 중...', en: 'Cancelling...' })
              : t({ ko: '취소', en: 'Cancel' })}
          </Button>
        ) : null}
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-surface-low">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            job.status === 'failed' ? 'bg-destructive' : job.status === 'cancelled' ? 'bg-muted-foreground' : 'bg-primary',
          )}
          style={{ width: `${Math.min(100, Math.max(0, job.progress.percentage))}%` }}
        />
      </div>

      {currentLabel ? (
        <div className="truncate text-xs text-muted-foreground" title={currentLabel}>{currentLabel}</div>
      ) : null}

      {job.status === 'cancelled' ? (
        <div className="text-xs text-muted-foreground">
          {t(
            { ko: '{processed}개 처리 후 중단됨 (이미 처리된 항목은 되돌리지 않아).', en: 'Stopped after {processed} items (already processed items are not reverted).' },
            { processed: String(job.progress.processed) },
          )}
        </div>
      ) : null}

      {job.status === 'failed' && job.failureMessage ? (
        <div className="text-xs text-destructive">{job.failureMessage}</div>
      ) : null}
    </div>
  )
}
