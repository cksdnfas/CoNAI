import { ProviderIcon } from '@/components/common/provider-icons'
import { Tip } from '@/components/ui/tooltip'
import type { ReactNode } from 'react'
import { ArrowLeft, ListX, RefreshCw, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Heading } from '@/components/ui/heading'
import { IconButton } from '@/components/ui/icon-button'
import { Spinner } from '@/components/ui/loading-state'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

type GenerationHistoryHeaderProps = {
  onBack?: () => void
  /** Replaces the heading and scope line; the scope actions stay on the right. */
  leading?: ReactNode
  historyLabel: string
  /** Provider key; shows its mark (with the label as tooltip) instead of the label text. */
  historyProvider?: string
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
  leading,
  historyLabel,
  historyProvider,
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

  const backButton = onBack ? (
    <IconButton
      size="icon-sm"
      variant="ghost"
      onClick={onBack}
      label={t('image-generation.components.generation.history.panel.back.to.workflow.list')}
    >
      <ArrowLeft />
    </IconButton>
  ) : null

  return (
    <div className={cn('flex shrink-0 gap-3', leading ? 'items-center justify-between' : 'flex-col sm:flex-row sm:items-start sm:justify-between')}>
      {leading ? (
        <div className="flex min-w-0 items-center gap-2">
          {backButton}
          {leading}
        </div>
      ) : (
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            {backButton}
            <Heading level={2}>{t('image-generation.components.generation.history.panel.generation.history')}</Heading>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {historyProvider ? (
              <Tip content={historyLabel}>
                <span className="inline-flex items-center" aria-label={historyLabel}><ProviderIcon provider={historyProvider} className="size-3.5" /></span>
              </Tip>
            ) : <span>{historyLabel}</span>}
            {!isPublicView ? <span>· {isAdmin ? t('image-generation.components.generation.history.panel.all.users') : t('image-generation.components.generation.history.panel.my.records')}</span> : null}
            <span>· {t({ ko: '전체 기록 {count}', en: 'Total records: {count}' }, { count: historyTotalLabel })}</span>
            {hasHiddenHistoryItems ? <span>· {t({ ko: '일부는 등급 설정으로 숨김', en: 'Some hidden by rating settings' })}</span> : null}
            {isRefreshing ? <span>· {t({ ko: '새로고침 중…', en: 'Refreshing…' })}</span> : null}
          </div>
        </div>
      )}

      <div className="flex shrink-0 flex-wrap items-center gap-1">
        {inFlightHistoryCount > 0 ? <Badge variant="info">{t({ ko: '작업 진행 중', en: 'Jobs in progress' })}</Badge> : null}
        <IconButton
          size="icon-sm"
          variant="ghost"
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
          variant="ghost"
          onClick={handleCleanupFailed}
          disabled={isCleaningFailed || cleanupFailedHistoryCount === 0}
          label={isCleaningFailed ? t('image-generation.components.generation.history.panel.cleaning.failed.items') : t('image-generation.components.generation.history.panel.clean.failed.items')}
        >
          <Trash2 />
        </IconButton>
        <IconButton size="icon-sm" variant="ghost" onClick={() => void refreshHistory({ watchForNewRows: true })} label={t('image-generation.components.generation.history.panel.refresh.history')}>
          <RefreshCw className={cn(isFetching && 'animate-spin')} />
        </IconButton>
      </div>
    </div>
  )
}
