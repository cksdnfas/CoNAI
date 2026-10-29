import { createContext, createElement, useCallback, useContext, useEffect, useId, useRef, useState, type PropsWithChildren } from 'react'
import { useBeforeUnload, useBlocker, type BlockerFunction, type Location } from 'react-router-dom'
import { useBlockerConfirm } from '@/components/ui/use-blocker-confirm'

/** Which navigations leave a guarded draft: false = another path, true = another path or query, or a custom test. */
export type GuardedLeave = boolean | ((current: Location, next: Location) => boolean)

type Guard = { message: string; leaves: GuardedLeave }
type Register = (id: string, guard: Guard) => () => void
const GuardContext = createContext<Register>(() => () => {})

function leavesDraft(leaves: GuardedLeave, current: Location, next: Location) {
  if (typeof leaves === 'function') return leaves(current, next)
  return current.pathname !== next.pathname || (leaves && current.search !== next.search)
}

/**
 * React Router consults only the last registered blocker, so this provider owns the app's single one and combines
 * every page editor's, native draft's and settings overlay's guard. Never call useBlocker elsewhere.
 */
export function UnsavedSettingsGuardProvider({ children }: PropsWithChildren) {
  const [guards, setGuards] = useState<Record<string, Guard>>({})
  const register = useCallback<Register>((id, guard) => {
    setGuards((current) => ({ ...current, [id]: guard }))
    return () => setGuards((current) => { const next = { ...current }; delete next[id]; return next })
  }, [])
  const hasUnsavedChanges = Object.keys(guards).length > 0
  useBeforeUnload(useCallback((event: BeforeUnloadEvent) => {
    if (hasUnsavedChanges) { event.preventDefault(); event.returnValue = '' }
  }, [hasUnsavedChanges]))
  const shouldBlock = useCallback<BlockerFunction>(({ currentLocation, nextLocation }) => (
    Object.values(guards).some((guard) => leavesDraft(guard.leaves, currentLocation, nextLocation))
  ), [guards])
  useBlockerConfirm(useBlocker(shouldBlock), [...new Set(Object.values(guards).map((guard) => guard.message))].join('\n'))
  return createElement(GuardContext.Provider, { value: register }, children)
}

/** Shared by page editors, native drafts and settings dialogs; a custom `leaves` test must keep a stable identity. */
export function useUnsavedSettingsGuard(hasUnsavedChanges: boolean, confirmMessage: string, leaves: GuardedLeave = false) {
  const register = useContext(GuardContext)
  const id = useId()
  useEffect(() => hasUnsavedChanges ? register(id, { message: confirmMessage, leaves }) : undefined, [hasUnsavedChanges, confirmMessage, leaves, register, id])
}

/** A page editor's guarded leave and its own successful save/delete navigation. */
export function useEditorPageGuard(hasUnsavedChanges: boolean, confirmMessage: string, leaves: GuardedLeave, allowLeave?: (current: Location, next: Location) => boolean) {
  const mounted = useRef(true)
  const allowedNavigation = useRef<string | null>(null)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const guardedLeave = useCallback((current: Location, next: Location) => {
    if (allowedNavigation.current === `${next.pathname}${next.search}`) {
      allowedNavigation.current = null
      return false
    }
    return !allowLeave?.(current, next) && leavesDraft(leaves, current, next)
  }, [allowLeave, leaves])
  useUnsavedSettingsGuard(hasUnsavedChanges, confirmMessage, guardedLeave)
  const allowNavigation = useCallback((path: string, navigate: () => void) => {
    allowedNavigation.current = path
    try { navigate() } finally { allowedNavigation.current = null }
  }, [])
  return { mounted, allowNavigation }
}
