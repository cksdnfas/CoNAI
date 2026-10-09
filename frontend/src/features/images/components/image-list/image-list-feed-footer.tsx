import { ErrorState } from '@/components/ui/error-state'
import { LoadingState } from '@/components/ui/loading-state'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

interface ImageListFeedFooterProps {
  itemCount: number
  hasMore: boolean
  isLoadingMore: boolean
  /** The failed next-page request. While set, auto-loading is paused and a retry button is the way on. */
  loadMoreError?: unknown
  isRetrying?: boolean
  onRetry: () => void
  className?: string
}

/**
 * Bottom of an infinite image feed: a spinner while the next page loads, a retry when auto-loading
 * failed (the only manual "load more"). Nothing once everything is loaded.
 */
export function ImageListFeedFooter({ isLoadingMore, loadMoreError, isRetrying = false, onRetry, className }: ImageListFeedFooterProps) {
  const { t } = useI18n()
  const hasLoadMoreError = loadMoreError !== null && loadMoreError !== undefined

  let content = null
  if (isLoadingMore) {
    content = <LoadingState variant="inline" label={t({ ko: '더 불러오는 중…', en: 'Loading more…' })} />
  } else if (hasLoadMoreError) {
    content = (
      <ErrorState
        size="compact"
        className="max-w-xl"
        title={t({ ko: '나머지를 못 불러왔어', en: "Couldn't load the rest" })}
        error={loadMoreError}
        onRetry={onRetry}
        isRetrying={isRetrying}
        retryLabel={t({ ko: '다시 불러오기', en: 'Load again' })}
      />
    )
  }

  if (!content) {
    return null
  }

  return <div className={cn('flex flex-col items-center gap-3 pb-6', className)}>{content}</div>
}
