import { useSyncExternalStore } from 'react'

/**
 * A value that outlives the file browser's instances: the files page remounts its browser when the folder changes,
 * and what a person marked, opened or started must survive that. Read it with `useValue()`; `get()` is always current.
 */
export function createSessionStore<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }
  return {
    get: () => value,
    set: (next: T) => {
      if (Object.is(next, value)) return
      value = next
      for (const listener of listeners) listener()
    },
    useValue: () => useSyncExternalStore(subscribe, () => value),
  }
}
