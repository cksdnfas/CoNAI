import { useEffect, useState } from 'react'

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
