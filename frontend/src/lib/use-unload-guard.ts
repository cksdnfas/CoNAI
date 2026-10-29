import { useEffect } from 'react'

/** While `active`, reloading or closing the tab asks first (the browser's own prompt). For unsaved edits anywhere. */
export function useUnloadGuard(active: boolean) {
  useEffect(() => {
    if (!active) return
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [active])
}
