import { useEffect, useLayoutEffect, useState } from 'react'

function getMatch(minWidth: number) {
  if (typeof window === 'undefined') {
    return false
  }

  return window.matchMedia(`(min-width: ${minWidth}px)`).matches
}

export function useMinWidth(minWidth: number) {
  const [matches, setMatches] = useState(() => getMatch(minWidth))

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined
    }

    const mediaQuery = window.matchMedia(`(min-width: ${minWidth}px)`)
    const handleChange = () => setMatches(mediaQuery.matches)

    handleChange()
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [minWidth])

  return matches
}

/**
 * Whether `element` is at least `minWidth` wide, for layouts that share the screen (a viewer beside the docked chat);
 * null until the element is mounted and measured.
 */
export function useElementMinWidth(element: HTMLElement | null, minWidth: number) {
  const [matches, setMatches] = useState<boolean | null>(null)

  useLayoutEffect(() => {
    if (!element) {
      setMatches(null)
      return undefined
    }

    const update = () => setMatches(element.getBoundingClientRect().width >= minWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element, minWidth])

  return matches
}
