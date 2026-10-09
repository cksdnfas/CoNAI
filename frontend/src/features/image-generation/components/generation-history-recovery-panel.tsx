import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { RotateCcw, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/icon-button'
import { Text } from '@/components/ui/text'
import { useI18n } from '@/i18n'
import type { GenerationHistoryRecord } from '@/lib/api-image-generation-types'
import { cn } from '@/lib/utils'
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
  const { canExecuteGeneration } = useFeaturePermissions()
  const { t, formatNumber } = useI18n()

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Text variant="title">{t({ ko: '실행 복구', en: 'Run recovery' })}</Text>
          <div className="mt-1 text-xs text-muted-foreground">
            {t({ ko: '재실행 가능한 실패/취소 큐 {count}개', en: '{count} failed or canceled queue records are rerun-ready' }, { count: formatNumber(visibleRetryableHistoryRecords.length) })}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Badge variant="warning">{t({ ko: '재실행 {count}', en: 'Rerun {count}' }, { count: formatNumber(visibleRetryableHistoryRecords.length) })}</Badge>
          <IconButton
            size="icon-sm"
            variant="secondary"
            onClick={() => void handleRetryVisibleRecoveryRecords()}
            disabled={!(canExecuteGeneration) || (isRetryingRunRecovery)}
            aria-busy={isRetryingRunRecovery || undefined}
            label={isRetryingRunRecovery
              ? t({ ko: '등록 중', en: 'Queueing' })
              : t({ ko: '모두 재실행', en: 'Rerun all' })}
          >
            <RotateCcw className={cn('h-4 w-4', isRetryingRunRecovery && 'animate-spin')} />
          </IconButton>
          <IconButton size="icon-sm" variant="ghost" onClick={handleAcknowledgeRunRecovery} label={t({ ko: '확인', en: 'Dismiss' })}>
            <X />
          </IconButton>
        </div>
      </div>

      <div className="divide-y divide-line">
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
              <IconButton
                size="icon-sm"
                variant="ghost"
                className="shrink-0"
                onClick={() => void handleRetryHistoryRecord(record)}
                disabled={!(canExecuteGeneration) || (isRetryingRunRecovery)}
                data-no-select-drag="true"
                aria-busy={isRetrying || undefined}
                label={isRetrying ? t({ ko: '등록 중', en: 'Queueing' }) : t({ ko: '재실행', en: 'Rerun' })}
              >
                <RotateCcw className={cn('h-4 w-4', isRetrying && 'animate-spin')} />
              </IconButton>
            </div>
          )
        })}
      </div>
    </div>
  )
}
