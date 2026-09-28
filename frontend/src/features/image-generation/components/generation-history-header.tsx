import { ArrowLeft, ListX, RefreshCw, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Heading } from '@/components/ui/heading'
import { IconButton } from '@/components/ui/icon-button'
import { Spinner } from '@/components/ui/loading-state'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { STATUS_BADGE_CLASS } from './generation-status-tone'

type GenerationHistoryHeaderProps = {
  onBack?: () => void
  historyLabel: string
  isPublicView: boolean
  isAdmin: boolean
  historyTotalLabel: string
  hasHiddenHistoryItems: boolean
  isRefreshing: boolean
  isFetching: boolean
  inFlightHistoryCount: number
  historyRecordCount: number
  cleanupFailedHistoryCount: number
  isClearingHistory: boolean
  isCleaningFailed: boolean
  handleClearHistory: () => Promise<void>
  handleCleanupFailed: () => Promise<void>
  refreshHistory: (options?: { watchForNewRows?: boolean }) => Promise<void>
}

/** Title, scope/count summary and scope-level actions for the generation history panel. */
export function GenerationHistoryHeader({
  onBack,
  historyLabel,
  isPublicView,
  isAdmin,
  historyTotalLabel,
  hasHiddenHistoryItems,
  isRefreshing,
  isFetching,
  inFlightHistoryCount,
  historyRecordCount,
  cleanupFailedHistoryCount,
  isClearingHistory,
  isCleaningFailed,
  handleClearHistory,
  handleCleanupFailed,
  refreshHistory,
}: GenerationHistoryHeaderProps) {
  const { t } = useI18n()

  return (
    <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          {onBack ? (
            <IconButton
              size="icon-sm"
              variant="ghost"
              onClick={onBack}
              label={t('image-generation.components.generation.history.panel.back.to.workflow.list')}
            >
              <ArrowLeft />
            </IconButton>
          ) : null}
          <Heading level={2}>{t('image-generation.components.generation.history.panel.generation.history')}</Heading>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span>{historyLabel}</span>
          {!isPublicView ? <span>· {isAdmin ? t('image-generation.components.generation.history.panel.all.users') : t('image-generation.components.generation.history.panel.my.records')}</span> : null}
          <span>· {t({ ko: '전체 기록 {count}', en: 'Total records: {count}' }, { count: historyTotalLabel })}</span>
          {hasHiddenHistoryItems ? <span>· {t({ ko: '일부는 등급 설정으로 숨김', en: 'Some hidden by rating settings' })}</span> : null}
          {isRefreshing ? <span>· {t({ ko: '새로고침 중…', en: 'Refreshing…' })}</span> : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {inFlightHistoryCount > 0 ? <Badge variant="secondary" className={STATUS_BADGE_CLASS.info}>{t({ ko: '작업 진행 중', en: 'Jobs in progress' })}</Badge> : null}
        <IconButton
          size="icon-sm"
          variant="secondary"
          onClick={() => void handleClearHistory()}
          disabled={isClearingHistory || historyRecordCount === 0}
          label={isClearingHistory
            ? t({ ko: '히스토리 비우는 중', en: 'Clearing history' })
            : isPublicView
              ? t({ ko: '내 히스토리 비우기', en: 'Clear my history' })
              : t({ ko: '히스토리 비우기', en: 'Clear history' })}
        >
          {isClearingHistory ? <Spinner /> : <ListX />}
        </IconButton>
        <IconButton
          size="icon-sm"
          variant="secondary"
          onClick={handleCleanupFailed}
          disabled={isCleaningFailed || cleanupFailedHistoryCount === 0}
          label={isCleaningFailed ? t('image-generation.components.generation.history.panel.cleaning.failed.items') : t('image-generation.components.generation.history.panel.clean.failed.items')}
        >
          <Trash2 />
        </IconButton>
        <IconButton size="icon-sm" variant="secondary" onClick={() => void refreshHistory({ watchForNewRows: true })} label={t('image-generation.components.generation.history.panel.refresh.history')}>
          <RefreshCw className={cn(isFetching && 'animate-spin')} />
        </IconButton>
      </div>
    </div>
  )
}
