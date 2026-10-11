import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { buildApiUrl } from '@/lib/api-client'
import { WALLPAPER_QUERY_ROOT } from './wallpaper-widget-data'

/** Event name → wallpaper queries it makes stale. */
const EVENT_TARGETS: Record<string, string[]> = {
  'queue.job.created': ['queue'],
  'queue.job.status': ['queue'],
  'queue.job.progress': ['queue'],
  'history.record.created': ['history', 'stats'],
  'history.record.status': ['history', 'stats'],
  'graph.execution.status': ['workflow-activity'],
  'posts.changed': ['posts'],
  'chat.message.created': ['chat-messages', 'chat-threads'],
  'chat.message.updated': ['chat-messages'],
}

/** Refetch each query at most this often; progress frames arrive several times a second. */
const THROTTLE_MS = 1_000
const RETRY_AFTER_CLOSE_MS = 60_000

/**
 * The live page's own event stream (`/api/wallpaper-runtime/events`): works for a runtime key, not only a login.
 * Each event only marks wallpaper queries stale; widgets keep polling slowly as a safety net.
 */
export function useWallpaperLiveEvents(enabled: boolean) {
  const queryClient = useQueryClient()
  const [live, setLive] = useState(false)

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || typeof window.EventSource === 'undefined') {
      return undefined
    }

    let source: EventSource | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    const lastRun = new Map<string, number>()
    const pending = new Map<string, ReturnType<typeof setTimeout>>()
    let disposed = false

    const invalidate = (target: string) => {
      const run = () => {
        lastRun.set(target, Date.now())
        pending.delete(target)
        void queryClient.invalidateQueries({ queryKey: [WALLPAPER_QUERY_ROOT, target] })
      }
      const wait = THROTTLE_MS - (Date.now() - (lastRun.get(target) ?? 0))
      if (wait <= 0) run()
      else if (!pending.has(target)) pending.set(target, setTimeout(run, wait))
    }

    const open = () => {
      if (disposed) return
      source = new EventSource(buildApiUrl('/api/wallpaper-runtime/events'), { withCredentials: true })
      source.addEventListener('hello', () => setLive(true))
      for (const [name, targets] of Object.entries(EVENT_TARGETS)) {
        source.addEventListener(name, () => targets.forEach(invalidate))
      }
      source.onerror = () => {
        // A refused stream (no key, no permission, stream disabled) closes for good; try again much later.
        if (source?.readyState === EventSource.CLOSED) {
          setLive(false)
          source.close()
          source = null
          retryTimer = setTimeout(open, RETRY_AFTER_CLOSE_MS)
        }
      }
    }

    open()
    return () => {
      disposed = true
      source?.close()
      if (retryTimer) clearTimeout(retryTimer)
      pending.forEach((timer) => clearTimeout(timer))
      setLive(false)
    }
  }, [enabled, queryClient])

  return live
}
