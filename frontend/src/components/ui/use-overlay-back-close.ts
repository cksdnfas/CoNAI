import { useEffect, useId, useRef } from 'react'

interface UseOverlayBackCloseOptions {
  open: boolean
  onClose: () => void
  enabled?: boolean
}

/** Close one open overlay before browser back navigates away from the current page. */
export function useOverlayBackClose({ open, onClose, enabled = true }: UseOverlayBackCloseOptions) {
  const overlayId = useId()
  const pushedRef = useRef(false)
  const programmaticBackRef = useRef(false)
  const openRef = useRef(open)
  const onCloseRef = useRef(onClose)

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

      window.history.pushState({
        ...baseState,
        __conaiOverlayBackClose: overlayId,
      }, '', window.location.href)
      pushedRef.current = true
      programmaticBackRef.current = false
      return
    }

    if (!open && pushedRef.current) {
      const currentOverlayId = window.history.state?.__conaiOverlayBackClose
      if (currentOverlayId !== overlayId) {
        pushedRef.current = false
        programmaticBackRef.current = false
        return
      }

      programmaticBackRef.current = true
      window.history.back()
    }
  }, [enabled, open, overlayId])

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

      const wasProgrammaticBack = programmaticBackRef.current
      pushedRef.current = false
      programmaticBackRef.current = false

      if (!wasProgrammaticBack && openRef.current) {
        onCloseRef.current()
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
    }
  }, [enabled])
}
