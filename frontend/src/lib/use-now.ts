import { useEffect, useState } from 'react'

/** Tick only while enabled and the tab is visible; sync immediately on enable or tab resume. */
export function useNow(intervalMs: number, enabled: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    setNow(Date.now())
    let timer: number | null = null
    const start = () => {
      if (timer !== null) return
      timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    }
    const stop = () => {
      if (timer === null) return
      window.clearInterval(timer)
      timer = null
    }
    const syncVisibility = () => {
      if (document.visibilityState === 'hidden') {
        stop()
      } else {
        setNow(Date.now())
        start()
      }
    }
    syncVisibility()
    document.addEventListener('visibilitychange', syncVisibility)
    return () => {
      document.removeEventListener('visibilitychange', syncVisibility)
      stop()
    }
  }, [enabled, intervalMs])
  return now
}
