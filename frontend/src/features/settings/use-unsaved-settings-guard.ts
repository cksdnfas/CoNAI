import { useCallback, useEffect } from 'react'
import { useBeforeUnload, useBlocker, type BlockerFunction } from 'react-router-dom'
import { shouldBypassOverlayHistoryBackNavigation } from '@/components/ui/use-overlay-back-close'

/** Warn before a reload/close or an in-app route change drops unsaved settings drafts. */
export function useUnsavedSettingsGuard(hasUnsavedChanges: boolean, confirmMessage: string) {
  useBeforeUnload(
    useCallback((event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) {
        return
      }

      event.preventDefault()
      event.returnValue = ''
    }, [hasUnsavedChanges]),
  )

  // Settings tabs only change the search string and keep drafts, so only pathname changes leave the page.
  const shouldBlock = useCallback<BlockerFunction>(({ currentLocation, nextLocation }) => (
    hasUnsavedChanges
    && currentLocation.pathname !== nextLocation.pathname
    && !shouldBypassOverlayHistoryBackNavigation()
  ), [hasUnsavedChanges])
  const blocker = useBlocker(shouldBlock)

  useEffect(() => {
    if (blocker.state !== 'blocked') {
      return
    }

    if (window.confirm(confirmMessage)) {
      blocker.proceed()
      return
    }

    blocker.reset()
  }, [blocker, confirmMessage])
}
