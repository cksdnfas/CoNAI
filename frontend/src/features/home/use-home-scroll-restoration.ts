import { useEffect, useRef } from 'react'

const HOME_SCROLL_STORAGE_KEY = 'conai.home.scrollY'
const HOME_SCROLL_PENDING_KEY = 'conai.home.restorePending'
const HOME_SCROLL_MAX_RESTORE_ATTEMPTS = 240

interface UseHomeScrollRestorationParams {
  enabled: boolean
  itemCount: number
  canLoadMore: boolean
  isLoadingMore: boolean
  onLoadMore?: () => Promise<unknown> | void
}

/** Persist and restore the Home feed scroll position across detail-page navigation. */
export function useHomeScrollRestoration({
  enabled,
  itemCount,
  canLoadMore,
  isLoadingMore,
  onLoadMore,
}: UseHomeScrollRestorationParams) {
  const restoreAttemptRef = useRef(0)
  const restoreFrameRef = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) return

    const saveScrollPosition = () => {
      if (sessionStorage.getItem(HOME_SCROLL_PENDING_KEY) === 'true') {
        return
      }

      sessionStorage.setItem(HOME_SCROLL_STORAGE_KEY, String(window.scrollY))
    }

    if (sessionStorage.getItem(HOME_SCROLL_PENDING_KEY) !== 'true') {
      saveScrollPosition()
    }

    window.addEventListener('scroll', saveScrollPosition, { passive: true })
    return () => window.removeEventListener('scroll', saveScrollPosition)
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    if (sessionStorage.getItem(HOME_SCROLL_PENDING_KEY) !== 'true') return
    if (itemCount <= 0) return

    const savedScrollY = Number(sessionStorage.getItem(HOME_SCROLL_STORAGE_KEY) ?? '0')
    if (!Number.isFinite(savedScrollY) || savedScrollY <= 0) {
      sessionStorage.removeItem(HOME_SCROLL_PENDING_KEY)
      return
    }

    const tryRestore = () => {
      restoreAttemptRef.current += 1

      const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
      const canReachTarget = maxScrollY >= savedScrollY - 8

      if (!canReachTarget && canLoadMore && !isLoadingMore && onLoadMore) {
        void onLoadMore()
      }

      const nextScrollY = Math.min(savedScrollY, maxScrollY)
      window.scrollTo({ top: nextScrollY, left: 0, behavior: 'instant' as ScrollBehavior })

      if (canReachTarget || restoreAttemptRef.current >= HOME_SCROLL_MAX_RESTORE_ATTEMPTS) {
        sessionStorage.removeItem(HOME_SCROLL_PENDING_KEY)
        restoreAttemptRef.current = 0
        restoreFrameRef.current = null
        return
      }

      restoreFrameRef.current = window.requestAnimationFrame(tryRestore)
    }

    restoreFrameRef.current = window.requestAnimationFrame(tryRestore)

    return () => {
      if (restoreFrameRef.current !== null) {
        window.cancelAnimationFrame(restoreFrameRef.current)
        restoreFrameRef.current = null
      }
    }
  }, [canLoadMore, enabled, isLoadingMore, itemCount, onLoadMore])
}

export function markHomeScrollRestorePending() {
  sessionStorage.setItem(HOME_SCROLL_PENDING_KEY, 'true')
  sessionStorage.setItem(HOME_SCROLL_STORAGE_KEY, String(window.scrollY))
}
