import { createContext, createElement, useCallback, useContext, useEffect, useId, useState, type PropsWithChildren } from 'react'
import { useBeforeUnload, useBlocker, type BlockerFunction } from 'react-router-dom'
import { useBlockerConfirm } from '@/components/ui/use-blocker-confirm'
import { shouldBypassOverlayHistoryBackNavigation } from '@/components/ui/use-overlay-back-close'

type Register = (id: string, message: string) => () => void
const GuardContext = createContext<Register>(() => () => {})

/** React Router supports one blocker. Combine a page's draft and any settings overlay's draft. */
export function UnsavedSettingsGuardProvider({ children }: PropsWithChildren) {
  const [guards, setGuards] = useState<Record<string, string>>({})
  const register = useCallback<Register>((id, message) => {
    setGuards((current) => ({ ...current, [id]: message }))
    return () => setGuards((current) => { const next = { ...current }; delete next[id]; return next })
  }, [])
  const hasUnsavedChanges = Object.keys(guards).length > 0
  useBeforeUnload(useCallback((event: BeforeUnloadEvent) => {
    if (hasUnsavedChanges) { event.preventDefault(); event.returnValue = '' }
  }, [hasUnsavedChanges]))
  const shouldBlock = useCallback<BlockerFunction>(({ currentLocation, nextLocation }) => (
    hasUnsavedChanges && currentLocation.pathname !== nextLocation.pathname && !shouldBypassOverlayHistoryBackNavigation()
  ), [hasUnsavedChanges])
  useBlockerConfirm(useBlocker(shouldBlock), [...new Set(Object.values(guards))].join('\n'))
  return createElement(GuardContext.Provider, { value: register }, children)
}

/** Shared by native editors and settings dialogs; same-path tab changes preserve native drafts. */
export function useUnsavedSettingsGuard(hasUnsavedChanges: boolean, confirmMessage: string) {
  const register = useContext(GuardContext)
  const id = useId()
  useEffect(() => hasUnsavedChanges ? register(id, confirmMessage) : undefined, [hasUnsavedChanges, confirmMessage, register, id])
}
