import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { resolveStreamFallbackInterval } from '@/features/runtime-events/runtime-event-fallback'
import { useRuntimeEventStream } from '@/features/runtime-events/use-runtime-event-stream'
import {
  getGenerationHistory,
  getGenerationWorkflowHistory,
} from '@/lib/api-image-generation-history'
import { getPublicGenerationWorkflowHistory } from '@/lib/api-public-workflows'
import type { GenerationServiceType } from '@/lib/api-image-generation-types'
import {
  GENERATION_HISTORY_ACTIVE_REFRESH_MS,
  GENERATION_HISTORY_PAGE_SIZE,
  GENERATION_HISTORY_POSTPROCESS_REFRESH_MS,
  GENERATION_HISTORY_REFRESH_WATCH_MS,
  GENERATION_HISTORY_STREAM_WATCHDOG_REFRESH_MS,
  dedupeHistoryRecords,
  hasActiveGenerationHistory,
  hasPostprocessPendingHistory,
  hasStableHistoryPageBoundary,
  readCachedHistoryPage,
} from './generation-history-panel-helpers'

export type GenerationHistoryFeedOptions = {
  refreshNonce: number
  serviceType: GenerationServiceType
  workflowId?: number | null
  publicWorkflowSlug?: string | null
}

/**
 * The generation history query shared by the history list and the result stage: paging, the SSE-aware
 * refresh cadence (with the watchdog poll for rows stuck in progress) and the parent refresh nonce.
 * Mount it once per surface so only one observer drives the refetch interval.
 */
export function useGenerationHistoryFeed({ refreshNonce, serviceType, workflowId, publicWorkflowSlug }: GenerationHistoryFeedOptions) {
  const queryClient = useQueryClient()
  const authStatusQuery = useAuthStatusQuery()
  // SSE 가 살아 있으면 폴링을 끄고, 끊기면 아래 기존 refresh cadence 가 그대로 되살아난다.
  const { status: runtimeStreamStatus } = useRuntimeEventStream()
  const [historyRefreshWatchUntil, setHistoryRefreshWatchUntil] = useState(0)
  const isAdmin = authStatusQuery.data?.isAdmin === true
  const requesterAccountId = authStatusQuery.data?.accountId ?? null
  const requesterAccountType = authStatusQuery.data?.accountType ?? null
  const isPublicView = Boolean(publicWorkflowSlug)
  const historyScope = isPublicView
    ? (isAdmin ? 'public-workflow-all-users' : 'public-workflow-mine-only')
    : (isAdmin ? 'all-users' : 'mine-only')
  const historyQueryKey = useMemo(() => [
    'image-generation-history',
    serviceType,
    workflowId ?? null,
    publicWorkflowSlug ?? null,
    historyScope,
    requesterAccountId,
    requesterAccountType,
  ] as const, [historyScope, publicWorkflowSlug, requesterAccountId, requesterAccountType, serviceType, workflowId])
  // QLIST-4: 사용자가 명시적으로 요청한 새로고침만 로드된 전 페이지를 다시 읽는다.
  const isFullHistoryRefreshRef = useRef(false)
  // 첫 페이지 경계가 밀린 리프레시는(신규 행 유입) 뒤 페이지 캐시를 재사용할 수 없다.
  const hasHistoryPageBoundaryShiftRef = useRef(false)
  const fetchHistoryPage = useCallback((offset: number) => (
    isPublicView && publicWorkflowSlug
      ? getPublicGenerationWorkflowHistory(publicWorkflowSlug, {
          limit: GENERATION_HISTORY_PAGE_SIZE,
          offset,
        })
      : serviceType === 'comfyui' && workflowId
        ? getGenerationWorkflowHistory(workflowId, {
            limit: GENERATION_HISTORY_PAGE_SIZE,
            offset,
            ...(isAdmin ? {} : { mine: true }),
          })
        : getGenerationHistory(serviceType, {
            limit: GENERATION_HISTORY_PAGE_SIZE,
            offset,
            ...(isAdmin ? {} : { mine: true }),
          })
  ), [isAdmin, isPublicView, publicWorkflowSlug, serviceType, workflowId])
  const historyQuery = useInfiniteQuery({
    queryKey: historyQueryKey,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      // 활성 리프레시(폴링/SSE 무효화)는 첫 페이지만 서버에서 다시 읽고, 뒤 페이지는 캐시 사본을 그대로 쓴다.
      // 종전에는 로드된 페이지 수만큼 무거운 히스토리 쿼리가 매 리프레시마다 반복됐다.
      if (pageParam > 0 && !isFullHistoryRefreshRef.current && !hasHistoryPageBoundaryShiftRef.current) {
        const cachedPage = readCachedHistoryPage(queryClient, historyQueryKey, pageParam)
        if (cachedPage) {
          return cachedPage
        }
      }

      const previousFirstPage = pageParam === 0 ? readCachedHistoryPage(queryClient, historyQueryKey, 0) : undefined
      const page = await fetchHistoryPage(pageParam)
      if (pageParam === 0) {
        hasHistoryPageBoundaryShiftRef.current = !hasStableHistoryPageBoundary(previousFirstPage, page)
      }

      return page
    },
    enabled: !authStatusQuery.isPending,
    // Keep every loaded page: the active-generation refetch has to restart at offset 0 so newly
    // completed generations appear, and selection/visible-count state is derived from all pages.
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      const nextOffset = lastPageParam + lastPage.records.length
      return nextOffset < lastPage.total ? nextOffset : undefined
    },
    refetchInterval: (query) => {
      const pages = query.state.data?.pages ?? []
      const records = pages.flatMap((page) => page.records)
      // 기존 cadence 로직은 그대로 두고 스트림 상태로만 감싼다(폴백 보존).
      const resolveLegacyHistoryInterval = (): number | false => {
        if (hasActiveGenerationHistory(records)) {
          return GENERATION_HISTORY_ACTIVE_REFRESH_MS
        }

        if (historyRefreshWatchUntil > Date.now()) {
          return GENERATION_HISTORY_ACTIVE_REFRESH_MS
        }

        return hasPostprocessPendingHistory(records) ? GENERATION_HISTORY_POSTPROCESS_REFRESH_MS : false
      }

      const legacyInterval = resolveLegacyHistoryInterval()
      const streamInterval = resolveStreamFallbackInterval(runtimeStreamStatus, legacyInterval)
      // 스트림이 live 라도 진행 중/후처리 대기 행이 남아 있으면 느린 워치독 폴링을 유지한다.
      // 완료/ready 이벤트가 유실되면 live 상태에서는 다른 복구 경로가 없어
      // 행이 '생성 중' 에 영구 고정된다. 유휴 목록(대기 행 없음)은 종전대로 폴링 0 이다.
      if (streamInterval === false && legacyInterval !== false) {
        return GENERATION_HISTORY_STREAM_WATCHDOG_REFRESH_MS
      }

      return streamInterval
    },
  })
  const refetchHistory = historyQuery.refetch
  const refreshHistory = useCallback(async (options: { watchForNewRows?: boolean } = {}) => {
    if (options.watchForNewRows) {
      setHistoryRefreshWatchUntil(Date.now() + GENERATION_HISTORY_REFRESH_WATCH_MS)
    }

    // 명시적 새로고침(버튼/삭제/재실행/부모 nonce)만 전 페이지를 다시 읽는다.
    isFullHistoryRefreshRef.current = true
    try {
      await refetchHistory()
    } finally {
      isFullHistoryRefreshRef.current = false
    }
  }, [refetchHistory])
  const isFetchingHistory = historyQuery.isFetching
  useEffect(() => {
    if (!isFetchingHistory) {
      // 경계 밀림으로 강제된 전 페이지 재조회가 끝났으면 다음 리프레시는 다시 첫 페이지만 읽는다.
      hasHistoryPageBoundaryShiftRef.current = false
    }
  }, [isFetchingHistory])

  useEffect(() => {
    if (refreshNonce === 0) {
      return
    }

    void refreshHistory({ watchForNewRows: true })
  }, [refreshNonce, refreshHistory])

  const historyRecords = useMemo(
    () => dedupeHistoryRecords((historyQuery.data?.pages ?? []).flatMap((page) => page.records)),
    [historyQuery.data?.pages],
  )

  return {
    authStatusQuery,
    historyQuery,
    historyQueryKey,
    historyRecords,
    refreshHistory,
    isAdmin,
    isPublicView,
    isHistoryLoading: authStatusQuery.isPending || historyQuery.isPending,
  }
}

export type GenerationHistoryFeed = ReturnType<typeof useGenerationHistoryFeed>
