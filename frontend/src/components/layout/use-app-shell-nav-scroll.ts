import { useEffect, useRef, useState } from 'react'
import type { MouseEvent, PointerEvent } from 'react'

/** Collect horizontal nav scroll hints and drag-to-scroll behavior for the app shell. */
export function useAppShellNavScroll(watchKey: string) {
  const navScrollRef = useRef<HTMLDivElement | null>(null)
  const navDragPointerIdRef = useRef<number | null>(null)
  const navDragStartXRef = useRef(0)
  const navDragStartScrollLeftRef = useRef(0)
  const suppressNavClickRef = useRef(false)
  const [canScrollNavLeft, setCanScrollNavLeft] = useState(false)
  const [canScrollNavRight, setCanScrollNavRight] = useState(false)
  const [isDraggingNav, setIsDraggingNav] = useState(false)

  useEffect(() => {
    const navScrollElement = navScrollRef.current
    if (!navScrollElement) {
      return
    }

    const updateNavScrollHints = () => {
      const maxScrollLeft = Math.max(0, navScrollElement.scrollWidth - navScrollElement.clientWidth)
      setCanScrollNavLeft(navScrollElement.scrollLeft > 4)
      setCanScrollNavRight(navScrollElement.scrollLeft < maxScrollLeft - 4)
    }

    updateNavScrollHints()

    const resizeObserver = new ResizeObserver(() => {
      updateNavScrollHints()
    })
    resizeObserver.observe(navScrollElement)

    const contentElement = navScrollElement.firstElementChild
    if (contentElement instanceof HTMLElement) {
      resizeObserver.observe(contentElement)
    }

    navScrollElement.addEventListener('scroll', updateNavScrollHints, { passive: true })
    window.addEventListener('resize', updateNavScrollHints)

    return () => {
      resizeObserver.disconnect()
      navScrollElement.removeEventListener('scroll', updateNavScrollHints)
      window.removeEventListener('resize', updateNavScrollHints)
    }
  }, [watchKey])

  /** Reset the temporary nav-drag state after horizontal scroll gestures. */
  const finishNavDrag = () => {
    navDragPointerIdRef.current = null
    navDragStartXRef.current = 0
    navDragStartScrollLeftRef.current = 0
    setIsDraggingNav(false)

    window.setTimeout(() => {
      suppressNavClickRef.current = false
    }, 0)
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }

    navDragPointerIdRef.current = event.pointerId
    navDragStartXRef.current = event.clientX
    navDragStartScrollLeftRef.current = navScrollRef.current?.scrollLeft ?? 0
    suppressNavClickRef.current = false
    setIsDraggingNav(false)
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (navDragPointerIdRef.current !== event.pointerId || !navScrollRef.current) {
      return
    }

    const deltaX = event.clientX - navDragStartXRef.current
    if (!isDraggingNav && Math.abs(deltaX) > 6) {
      suppressNavClickRef.current = true
      setIsDraggingNav(true)
    }

    if (Math.abs(deltaX) <= 1) {
      return
    }

    navScrollRef.current.scrollLeft = navDragStartScrollLeftRef.current - deltaX
    event.preventDefault()
    event.stopPropagation()
  }

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (navDragPointerIdRef.current !== event.pointerId) {
      return
    }

    finishNavDrag()
  }

  const handlePointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    if (navDragPointerIdRef.current !== event.pointerId) {
      return
    }

    finishNavDrag()
  }

  const handlePointerLeave = (event: PointerEvent<HTMLDivElement>) => {
    if (navDragPointerIdRef.current !== event.pointerId || !isDraggingNav) {
      return
    }

    finishNavDrag()
  }

  const handleNavItemClick = (event: MouseEvent<HTMLElement>) => {
    if (!suppressNavClickRef.current) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
  }

  return {
    navScrollRef,
    canScrollNavLeft,
    canScrollNavRight,
    isDraggingNav,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handlePointerLeave,
    handleNavItemClick,
  }
}
