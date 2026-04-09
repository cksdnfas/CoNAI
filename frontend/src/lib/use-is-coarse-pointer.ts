import { useEffect, useState } from 'react'

function readIsCoarsePointer() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }

  return window.matchMedia('(pointer: coarse)').matches
}

/** Detect coarse-pointer environments so touch-first UI behavior can avoid drag/scroll conflicts. */
export function useIsCoarsePointer() {
  const [isCoarsePointer, setIsCoarsePointer] = useState(readIsCoarsePointer)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }

    const mediaQuery = window.matchMedia('(pointer: coarse)')
    const handleChange = () => {
      setIsCoarsePointer(mediaQuery.matches)
    }

    handleChange()

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange)
      return () => mediaQuery.removeEventListener('change', handleChange)
    }

    mediaQuery.addListener(handleChange)
    return () => mediaQuery.removeListener(handleChange)
  }, [])

  return isCoarsePointer
}
