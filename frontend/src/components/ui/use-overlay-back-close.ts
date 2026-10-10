import { useCallback, useEffect, useId, useRef, useState } from 'react'

interface UseOverlayBackCloseOptions {
  open: boolean
  onClose: () => void
  enabled?: boolean
}

const OVERLAY_HISTORY_BACK_BYPASS_WINDOW_MS = 1000
let overlayHistoryBackBypassUntil = 0

/** Temporarily suppress unsaved-change guards while one overlay closes via its own history entry rewind. */
export function shouldBypassOverlayHistoryBackNavigation() {
  return overlayHistoryBackBypassUntil > Date.now()
}

function markOverlayHistoryBackBypassWindow() {
  overlayHistoryBackBypassUntil = Date.now() + OVERLAY_HISTORY_BACK_BYPASS_WINDOW_MS
}

// The entry of an overlay that closed to make way for another one opened in the same update (see `handOff`).
let pendingOverlayHandoff: string | null = null

/**
 * Close one open overlay before browser back navigates away from the current page.
 * `handOff()` before closing lets an overlay opened in the same update take over this one's history entry,
 * so the switch neither rewinds nor stacks one: back then closes the new overlay straight to the page.
 */
export function useOverlayBackClose({ open, onClose, enabled = true }: UseOverlayBackCloseOptions) {
  const overlayId = useId()
  const pushedRef = useRef(false)
  const handOffRef = useRef(false)
  const programmaticBackRef = useRef(false)
  const openRef = useRef(open)
  const onCloseRef = useRef(onClose)
  // Bumped after a browser-back close attempt so a declined close (e.g. discard confirm cancelled) re-pushes the entry.
  const [backCloseAttempt, setBackCloseAttempt] = useState(0)

  useEffect(() => {
    openRef.current = open
  }, [open])

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (typeof window === 'undefined' || !enabled) {
      return
    }

    if (open && !pushedRef.current) {
      const baseState = window.history.state && typeof window.history.state === 'object'
        ? window.history.state
        : {}
      const takeOver = pendingOverlayHandoff !== null && baseState.__conaiOverlayBackClose === pendingOverlayHandoff
      pendingOverlayHandoff = null

      window.history[takeOver ? 'replaceState' : 'pushState']({
        ...baseState,
        __conaiOverlayBackClose: overlayId,
      }, '', window.location.href)
      pushedRef.current = true
      programmaticBackRef.current = false
      return
    }

    if (!open && pushedRef.current) {
      const currentOverlayId = window.history.state?.__conaiOverlayBackClose
      const handingOff = handOffRef.current
      handOffRef.current = false
      if (currentOverlayId !== overlayId) {
        pushedRef.current = false
        programmaticBackRef.current = false
        return
      }

      if (handingOff) {
        // The overlay opened in this update runs its effect right after (a parent's runs after its children's):
        // it takes the entry over. Nobody did by the next task → rewind it as a plain close would.
        pushedRef.current = false
        programmaticBackRef.current = false
        pendingOverlayHandoff = overlayId
        window.setTimeout(() => {
          if (pendingOverlayHandoff !== overlayId) return
          pendingOverlayHandoff = null
          if (window.history.state?.__conaiOverlayBackClose !== overlayId) return
          markOverlayHistoryBackBypassWindow()
          window.history.back()
        }, 0)
        return
      }

      programmaticBackRef.current = true
      markOverlayHistoryBackBypassWindow()
      window.history.back()
    }
  }, [backCloseAttempt, enabled, open, overlayId])

  useEffect(() => {
    if (typeof window === 'undefined' || !enabled) {
      return
    }

    const handlePopState = () => {
      if (!pushedRef.current) {
        return
      }

      const currentOverlayId = window.history.state?.__conaiOverlayBackClose
      if (currentOverlayId === overlayId) {
        return
      }

      if (shouldBypassOverlayHistoryBackNavigation() && openRef.current) {
        return
      }

      const wasProgrammaticBack = programmaticBackRef.current
      pushedRef.current = false
      programmaticBackRef.current = false

      if (!wasProgrammaticBack && openRef.current) {
        onCloseRef.current()
        setBackCloseAttempt((current) => current + 1)
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
      if (!pushedRef.current) {
        return
      }

      const currentOverlayId = window.history.state?.__conaiOverlayBackClose
      pushedRef.current = false
      programmaticBackRef.current = false
      if (currentOverlayId === overlayId) {
        markOverlayHistoryBackBypassWindow()
        window.history.back()
      }
    }
  }, [enabled, overlayId])

  const handOff = useCallback(() => {
    handOffRef.current = true
  }, [])

  return { handOff }
}
