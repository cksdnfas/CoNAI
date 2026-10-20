import { useEffect, useRef, useState } from 'react'

/**
 * True once the element has come near the viewport, and whether it is in view right now.
 * `once` stops observing after the first sighting (no re-render on later scrolls; `visible` then stays true).
 */
export function useInView<T extends Element>(rootMargin = '200px', { once = false }: { once?: boolean } = {}) {
  const ref = useRef<T | null>(null)
  const [state, setState] = useState({ seen: false, visible: false })
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.some((entry) => entry.isIntersecting)
      if (once && visible) observer.disconnect()
      setState((current) => (current.visible === visible && (current.seen || !visible) ? current : { seen: current.seen || visible, visible }))
    }, { rootMargin })
    observer.observe(node)
    return () => observer.disconnect()
  }, [rootMargin, once])
  return [ref, state] as const
}
