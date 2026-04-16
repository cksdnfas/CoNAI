import { useCallback, useEffect, useRef } from 'react'

/** Detect whether a selection start should be allowed for touch input only when two or more fingers are active. */
export function useMultiTouchSelectionStartGuard(containerElement: HTMLElement | null, enabled: boolean) {
  const activeTouchPointerIdsRef = useRef(new Set<number>())
  const activeTouchCountRef = useRef(0)

  useEffect(() => {
    activeTouchPointerIdsRef.current.clear()
    activeTouchCountRef.current = 0

    if (!enabled || !containerElement) {
      return
    }

    const ownerDocument = containerElement.ownerDocument

    /** Track touch pointer ids so pointer-based browsers can distinguish one-finger scroll from two-finger drag selection. */
    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') {
        return
      }

      activeTouchPointerIdsRef.current.add(event.pointerId)
      activeTouchCountRef.current = Math.max(activeTouchCountRef.current, activeTouchPointerIdsRef.current.size)
    }

    /** Remove touch pointer ids when a touch ends or gets cancelled. */
    const handlePointerFinish = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') {
        return
      }

      activeTouchPointerIdsRef.current.delete(event.pointerId)
      if (activeTouchPointerIdsRef.current.size === 0) {
        activeTouchCountRef.current = 0
      }
    }

    /** Mirror native touch counts when the browser emits TouchEvents. */
    const handleTouchUpdate = (event: TouchEvent) => {
      activeTouchCountRef.current = event.touches.length
      if (event.touches.length === 0) {
        activeTouchPointerIdsRef.current.clear()
      }
    }

    ownerDocument.addEventListener('pointerdown', handlePointerDown, true)
    ownerDocument.addEventListener('pointerup', handlePointerFinish, true)
    ownerDocument.addEventListener('pointercancel', handlePointerFinish, true)
    ownerDocument.addEventListener('touchstart', handleTouchUpdate, true)
    ownerDocument.addEventListener('touchend', handleTouchUpdate, true)
    ownerDocument.addEventListener('touchcancel', handleTouchUpdate, true)

    return () => {
      ownerDocument.removeEventListener('pointerdown', handlePointerDown, true)
      ownerDocument.removeEventListener('pointerup', handlePointerFinish, true)
      ownerDocument.removeEventListener('pointercancel', handlePointerFinish, true)
      ownerDocument.removeEventListener('touchstart', handleTouchUpdate, true)
      ownerDocument.removeEventListener('touchend', handleTouchUpdate, true)
      ownerDocument.removeEventListener('touchcancel', handleTouchUpdate, true)
      activeTouchPointerIdsRef.current.clear()
      activeTouchCountRef.current = 0
    }
  }, [containerElement, enabled])

  /** Allow mouse and pen starts immediately, but require two active touches before touch selection can begin. */
  return useCallback((event: Event | null | undefined) => {
    if (!event) {
      return false
    }

    if (typeof TouchEvent !== 'undefined' && event instanceof TouchEvent) {
      return event.touches.length >= 2
    }

    const pointerType = 'pointerType' in event && typeof event.pointerType === 'string' ? event.pointerType : null
    if (pointerType === 'touch') {
      return activeTouchCountRef.current >= 2 || activeTouchPointerIdsRef.current.size >= 2
    }

    return true
  }, [])
}
