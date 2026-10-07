import { useLayoutEffect, useRef } from 'react'
import type { WorkflowUndo } from './chat-page-context'

/** Reuse ordinary setters; private media stays local and undo protects subsequent edits. */
export function useChatDraftTransaction<T>(value: T, setValue: (next: T) => void) {
  const current = useRef(value)
  useLayoutEffect(() => { current.current = value })
  return (next: T): WorkflowUndo => {
    const before = current.current
    const signature = JSON.stringify(next)
    setValue(next)
    return { isCurrent: () => JSON.stringify(current.current) === signature, restore: () => setValue(before) }
  }
}
