import { useEffect, useState } from 'react'

/** Tick only while a visible time-derived label needs updates. */
export function useNow(intervalMs: number, enabled: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [enabled, intervalMs])
  return now
}
