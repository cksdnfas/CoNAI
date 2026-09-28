import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { markHomeScrollRestorePending } from '@/features/home/use-home-scroll-restoration'

/** Navigation state that image pages use to return to the screen they were opened from. */
export interface ImageSourceLocationState {
  sourcePath: string
}

type SourceLocation = { pathname: string; search: string }

/** Build the source state for a link to an image page. */
export function buildImageSourceState(location: SourceLocation): ImageSourceLocationState {
  return { sourcePath: `${location.pathname}${location.search}` }
}

/** Build the source state right before navigating, remembering the Home scroll offset first. */
export function prepareImageSourceState(location: SourceLocation): ImageSourceLocationState {
  if (location.pathname === '/') {
    // The image viewer pins the body while open, so the real offset sits in body.style.top.
    const lockedTop = document.body.style.position === 'fixed' ? Number.parseFloat(document.body.style.top) : Number.NaN
    markHomeScrollRestorePending(Number.isFinite(lockedTop) ? -lockedTop : window.scrollY)
  }

  return buildImageSourceState(location)
}

function readSourcePath(state: unknown) {
  const sourcePath = state && typeof state === 'object' ? (state as Partial<ImageSourceLocationState>).sourcePath : undefined
  return typeof sourcePath === 'string' && sourcePath.startsWith('/') && !sourcePath.startsWith('//') ? sourcePath : null
}

/** Go back to the source screen: history Back when it is the previous entry, else its path, else the fallback. */
export function useImageSourceBack(fallbackPath: string) {
  const navigate = useNavigate()
  const location = useLocation()
  const sourcePath = readSourcePath(location.state)

  return useCallback(() => {
    const historyIndex = (window.history.state as { idx?: unknown } | null)?.idx
    if (sourcePath && location.key !== 'default' && typeof historyIndex === 'number' && historyIndex > 0) {
      navigate(-1)
      return
    }

    navigate(sourcePath ?? fallbackPath)
  }, [fallbackPath, location.key, navigate, sourcePath])
}
