import { RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Inset } from '@/components/ui/inset'
import { Text } from '@/components/ui/text'
import { useI18n } from '@/i18n'
import type { GenerationHistoryRecord } from '@/lib/api-image-generation-types'
import { cn } from '@/lib/utils'
import { STATUS_BADGE_CLASS } from './generation-status-tone'
import { getRetryableHistoryQueueJobId } from '../image-generation-shared'
import { getHistoryRecoveryDetail, getHistoryRecoveryLabel } from './generation-history-panel-helpers'

type GenerationHistoryRecoveryPanelProps = {
  visibleRetryableHistoryRecords: GenerationHistoryRecord[]
  retryingQueueJobIds: Set<number>
  isRetryingRunRecovery: boolean
  handleRetryVisibleRecoveryRecords: () => Promise<void>
  handleAcknowledgeRunRecovery: () => void
  handleRetryHistoryRecord: (record: GenerationHistoryRecord) => Promise<void>
}

/** Run-recovery callout listing failed/canceled queue records that can be rerun. */
export function GenerationHistoryRecoveryPanel({
  visibleRetryableHistoryRecords,
  retryingQueueJobIds,
  isRetryingRunRecovery,
  handleRetryVisibleRecoveryRecords,
  handleAcknowledgeRunRecovery,
  handleRetryHistoryRecord,
}: GenerationHistoryRecoveryPanelProps) {
  const { t, formatNumber } = useI18n()

  return (
    <Inset className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Text variant="title">{t({ ko: '실행 복구', en: 'Run recovery' })}</Text>
          <div className="mt-1 text-xs text-muted-foreground">
            {t({ ko: '재실행 가능한 실패/취소 큐 {count}개', en: '{count} failed or canceled queue records are rerun-ready' }, { count: formatNumber(visibleRetryableHistoryRecords.length) })}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Badge variant="secondary" className={STATUS_BADGE_CLASS.warning}>{t({ ko: '재실행 {count}', en: 'Rerun {count}' }, { count: formatNumber(visibleRetryableHistoryRecords.length) })}</Badge>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => void handleRetryVisibleRecoveryRecords()}
            disabled={isRetryingRunRecovery}
          >
            <RotateCcw className={cn('h-4 w-4', isRetryingRunRecovery && 'animate-spin')} />
            {isRetryingRunRecovery
              ? t({ ko: '등록 중', en: 'Queueing' })
              : t({ ko: '모두 재실행', en: 'Rerun all' })}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={handleAcknowledgeRunRecovery}>
            {t({ ko: '확인', en: 'Dismiss' })}
          </Button>
        </div>
      </div>

      <div className="divide-y divide-outline-subtle">
        {visibleRetryableHistoryRecords.map((record) => {
          const queueJobId = getRetryableHistoryQueueJobId(record)
          const isRetrying = queueJobId !== null && retryingQueueJobIds.has(queueJobId)
          const workflowLabel = record.workflow_name?.trim() || (
            record.service_type === 'comfyui'
              ? t({ ko: 'ComfyUI 실행 #{id}', en: 'ComfyUI run #{id}' }, { id: record.id })
              : record.service_type === 'codex'
                ? t({ ko: 'Codex 실행 #{id}', en: 'Codex run #{id}' }, { id: record.id })
                : t({ ko: 'NAI 실행 #{id}', en: 'NAI run #{id}' }, { id: record.id })
          )

          return (
            <div key={record.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge variant="outline">{getHistoryRecoveryLabel(record, t)}</Badge>
                  <span className="truncate text-sm font-medium text-foreground" title={workflowLabel}>{workflowLabel}</span>
                  {typeof queueJobId === 'number' ? <span className="text-xs text-muted-foreground">#{queueJobId}</span> : null}
                </div>
                <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{getHistoryRecoveryDetail(record, t)}</div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="shrink-0"
                onClick={() => void handleRetryHistoryRecord(record)}
                disabled={isRetryingRunRecovery}
                data-no-select-drag="true"
              >
                <RotateCcw className={cn('h-4 w-4', isRetrying && 'animate-spin')} />
                {isRetrying ? t({ ko: '등록 중', en: 'Queueing' }) : t({ ko: '재실행', en: 'Rerun' })}
              </Button>
            </div>
          )
        })}
      </div>
    </Inset>
  )
}
