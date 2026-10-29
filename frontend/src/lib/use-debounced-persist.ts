import { useEffect, useRef } from 'react'

/**
 * Write `value` for `owner` once it has stayed the same for `delay` ms. An edit still waiting is written at once when
 * the owner changes (another account) or the component unmounts, so leaving the page never drops the last edits.
 * `write` must keep a stable identity (a module function).
 */
export function useDebouncedPersist<T>(owner: string, value: T, write: (owner: string, value: T) => void, delay = 250) {
  const pending = useRef<{ owner: string; value: T } | null>(null)
  useEffect(() => {
    const entry = { owner, value }
    pending.current = entry
    const timer = window.setTimeout(() => {
      if (pending.current === entry) pending.current = null
      write(owner, value)
    }, delay)
    return () => window.clearTimeout(timer)
  }, [delay, owner, value, write])
  useEffect(() => () => {
    const entry = pending.current
    if (entry?.owner !== owner) return
    pending.current = null
    write(entry.owner, entry.value)
  }, [owner, write])
}
