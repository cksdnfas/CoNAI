import { useCallback } from 'react'
import { useBeforeUnload, useBlocker, type BlockerFunction } from 'react-router-dom'
import { useBlockerConfirm } from '@/components/ui/use-blocker-confirm'
import { shouldBypassOverlayHistoryBackNavigation } from '@/components/ui/use-overlay-back-close'

/** Ask before a reload/close or an in-app route change leaves the editor with unsaved preset edits. */
export function useWallpaperLeaveGuard(hasUnsavedChanges: boolean, confirmMessage: string) {
  useBeforeUnload(
    useCallback((event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) {
        return
      }

      event.preventDefault()
      event.returnValue = ''
    }, [hasUnsavedChanges]),
  )

  const shouldBlock = useCallback<BlockerFunction>(({ currentLocation, nextLocation }) => (
    hasUnsavedChanges
    && currentLocation.pathname !== nextLocation.pathname
    && !shouldBypassOverlayHistoryBackNavigation()
  ), [hasUnsavedChanges])
  const blocker = useBlocker(shouldBlock)
  useBlockerConfirm(blocker, confirmMessage)
}
