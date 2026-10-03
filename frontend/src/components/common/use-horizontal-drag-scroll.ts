import { useEffect, useRef, useState } from 'react'
import type { MouseEvent, PointerEvent } from 'react'

/**
 * Edge hints (can scroll left/right) and mouse drag-to-scroll for a horizontal strip with a hidden scrollbar.
 * Used by the app-shell nav and the generation result filmstrip. `watchKey` re-binds when the strip's content changes.
 */
export function useHorizontalDragScroll(watchKey: unknown) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const dragPointerIdRef = useRef<number | null>(null)
  const dragStartXRef = useRef(0)
  const dragStartScrollLeftRef = useRef(0)
  const suppressClickRef = useRef(false)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    const scrollElement = scrollRef.current
    if (!scrollElement) {
      return
    }

    const updateScrollHints = () => {
      const maxScrollLeft = Math.max(0, scrollElement.scrollWidth - scrollElement.clientWidth)
      setCanScrollLeft(scrollElement.scrollLeft > 4)
      setCanScrollRight(scrollElement.scrollLeft < maxScrollLeft - 4)
    }

    updateScrollHints()

    const resizeObserver = new ResizeObserver(() => {
      updateScrollHints()
    })
    resizeObserver.observe(scrollElement)

    const contentElement = scrollElement.firstElementChild
    if (contentElement instanceof HTMLElement) {
      resizeObserver.observe(contentElement)
    }

    scrollElement.addEventListener('scroll', updateScrollHints, { passive: true })
    window.addEventListener('resize', updateScrollHints)

    return () => {
      resizeObserver.disconnect()
      scrollElement.removeEventListener('scroll', updateScrollHints)
      window.removeEventListener('resize', updateScrollHints)
    }
  }, [watchKey])

  /** Reset the temporary drag state after horizontal scroll gestures. */
  const finishDrag = () => {
    dragPointerIdRef.current = null
    dragStartXRef.current = 0
    dragStartScrollLeftRef.current = 0
    setIsDragging(false)

    window.setTimeout(() => {
      suppressClickRef.current = false
    }, 0)
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }

    dragPointerIdRef.current = event.pointerId
    dragStartXRef.current = event.clientX
    dragStartScrollLeftRef.current = scrollRef.current?.scrollLeft ?? 0
    suppressClickRef.current = false
    setIsDragging(false)
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragPointerIdRef.current !== event.pointerId || !scrollRef.current) {
      return
    }

    const deltaX = event.clientX - dragStartXRef.current
    if (!isDragging && Math.abs(deltaX) > 6) {
      suppressClickRef.current = true
      setIsDragging(true)
    }

    if (Math.abs(deltaX) <= 1) {
      return
    }

    scrollRef.current.scrollLeft = dragStartScrollLeftRef.current - deltaX
    event.preventDefault()
    event.stopPropagation()
  }

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (dragPointerIdRef.current !== event.pointerId) {
      return
    }

    finishDrag()
  }

  const handlePointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    if (dragPointerIdRef.current !== event.pointerId) {
      return
    }

    finishDrag()
  }

  const handlePointerLeave = (event: PointerEvent<HTMLDivElement>) => {
    if (dragPointerIdRef.current !== event.pointerId || !isDragging) {
      return
    }

    finishDrag()
  }

  const handleItemClick = (event: MouseEvent<HTMLElement>) => {
    if (!suppressClickRef.current) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
  }

  return {
    scrollRef,
    canScrollLeft,
    canScrollRight,
    isDragging,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handlePointerLeave,
    handleItemClick,
  }
}
