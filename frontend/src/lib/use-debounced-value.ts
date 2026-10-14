import { useEffect, useState } from 'react'

/** `value` once it has stayed the same for `delay` ms: search requests wait for typing to pause. */
export function useDebouncedValue<T>(value: T, delay = 300) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return settled
}
