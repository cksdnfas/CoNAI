import { createContext, createElement, useCallback, useContext, useEffect, useId, useState, type PropsWithChildren } from 'react'
import { useBeforeUnload, useBlocker, type BlockerFunction } from 'react-router-dom'
import { useBlockerConfirm } from '@/components/ui/use-blocker-confirm'
import { shouldBypassOverlayHistoryBackNavigation } from '@/components/ui/use-overlay-back-close'

type Register = (id: string, message: string, includeSearch: boolean) => () => void
const GuardContext = createContext<Register>(() => () => {})

/** React Router supports one blocker. Combine a page's draft and any settings overlay's draft. */
export function UnsavedSettingsGuardProvider({ children }: PropsWithChildren) {
  const [guards, setGuards] = useState<Record<string, { message: string; includeSearch: boolean }>>({})
  const register = useCallback<Register>((id, message, includeSearch) => {
    setGuards((current) => ({ ...current, [id]: { message, includeSearch } }))
    return () => setGuards((current) => { const next = { ...current }; delete next[id]; return next })
  }, [])
  const hasUnsavedChanges = Object.keys(guards).length > 0
  const includeSearch = Object.values(guards).some((guard) => guard.includeSearch)
  useBeforeUnload(useCallback((event: BeforeUnloadEvent) => {
    if (hasUnsavedChanges) { event.preventDefault(); event.returnValue = '' }
  }, [hasUnsavedChanges]))
  const shouldBlock = useCallback<BlockerFunction>(({ currentLocation, nextLocation }) => (
    hasUnsavedChanges && (currentLocation.pathname !== nextLocation.pathname || (includeSearch && currentLocation.search !== nextLocation.search)) && !shouldBypassOverlayHistoryBackNavigation()
  ), [hasUnsavedChanges, includeSearch])
  useBlockerConfirm(useBlocker(shouldBlock), [...new Set(Object.values(guards).map((guard) => guard.message))].join('\n'))
  return createElement(GuardContext.Provider, { value: register }, children)
}

/** Shared by native editors and settings dialogs; same-path tab changes preserve native drafts. */
export function useUnsavedSettingsGuard(hasUnsavedChanges: boolean, confirmMessage: string, includeSearch = false) {
  const register = useContext(GuardContext)
  const id = useId()
  useEffect(() => hasUnsavedChanges ? register(id, confirmMessage, includeSearch) : undefined, [hasUnsavedChanges, confirmMessage, includeSearch, register, id])
}
