import { useCallback, useState } from 'react'

interface UndoableHistory<T> {
  past: T[]
  present: T
  future: T[]
  /** Key and time of the last recorded edit, so bursts (typing, dragging a slider) collapse into one step. */
  lastKey: string | null
  lastAt: number
}

export interface UndoableSetOptions {
  /** Edits with the same key within `coalesceMs` of each other share one undo step. */
  coalesceKey?: string
}

interface UseUndoableStateOptions {
  /** Maximum number of undo steps kept. */
  limit?: number
  coalesceMs?: number
}

/** State with bounded undo/redo history. `reset` replaces the value and forgets the history. */
export function useUndoableState<T>(initial: T | (() => T), { limit = 50, coalesceMs = 800 }: UseUndoableStateOptions = {}) {
  const [history, setHistory] = useState<UndoableHistory<T>>(() => ({
    past: [],
    present: typeof initial === 'function' ? (initial as () => T)() : initial,
    future: [],
    lastKey: null,
    lastAt: 0,
  }))

  const set = useCallback((update: T | ((current: T) => T), options?: UndoableSetOptions) => {
    const now = Date.now()
    const key = options?.coalesceKey ?? null
    setHistory((current) => {
      const next = typeof update === 'function' ? (update as (value: T) => T)(current.present) : update
      if (Object.is(next, current.present)) {
        return current
      }

      const coalesce = key !== null && key === current.lastKey && now - current.lastAt < coalesceMs
      return {
        past: coalesce ? current.past : [...current.past, current.present].slice(-limit),
        present: next,
        future: [],
        lastKey: key,
        lastAt: now,
      }
    })
  }, [coalesceMs, limit])

  const reset = useCallback((next: T) => {
    setHistory({ past: [], present: next, future: [], lastKey: null, lastAt: 0 })
  }, [])

  const undo = useCallback(() => {
    setHistory((current) => {
      const previous = current.past[current.past.length - 1]
      if (current.past.length === 0) {
        return current
      }

      return {
        past: current.past.slice(0, -1),
        present: previous,
        future: [current.present, ...current.future].slice(0, limit),
        lastKey: null,
        lastAt: 0,
      }
    })
  }, [limit])

  const redo = useCallback(() => {
    setHistory((current) => {
      if (current.future.length === 0) {
        return current
      }

      const [next, ...rest] = current.future
      return {
        past: [...current.past, current.present].slice(-limit),
        present: next,
        future: rest,
        lastKey: null,
        lastAt: 0,
      }
    })
  }, [limit])

  return {
    value: history.present,
    set,
    reset,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  }
}
