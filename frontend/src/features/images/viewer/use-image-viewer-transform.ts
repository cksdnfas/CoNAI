import { useCallback, useEffect, useMemo, useState } from 'react'

interface ViewerPosition {
  x: number
  y: number
}

interface UseImageViewerTransformResult {
  scale: number
  rotation: number
  flipX: boolean
  flipY: boolean
  position: ViewerPosition
  isDragging: boolean
  transformStyle: {
    transform: string
    transformOrigin: string
    transition: string
    cursor: string
  }
  zoomIn: () => void
  zoomOut: () => void
  rotateLeft: () => void
  rotateRight: () => void
  flipHorizontal: () => void
  flipVertical: () => void
  reset: () => void
  startDrag: (event: React.MouseEvent) => void
}

const MIN_SCALE = 0.1
const MAX_SCALE = 5
const ZOOM_FACTOR = 1.2

export function useImageViewerTransform(imageKey: string | null): UseImageViewerTransformResult {
  const [scale, setScale] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [flipX, setFlipX] = useState(false)
  const [flipY, setFlipY] = useState(false)
  const [position, setPosition] = useState<ViewerPosition>({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState<ViewerPosition>({ x: 0, y: 0 })

  const reset = useCallback(() => {
    setScale(1)
    setRotation(0)
    setFlipX(false)
    setFlipY(false)
    setPosition({ x: 0, y: 0 })
    setIsDragging(false)
  }, [])

  useEffect(() => {
    if (imageKey === null) {
      return
    }
    reset()
  }, [imageKey, reset])

  const zoomIn = useCallback(() => {
    setScale((current) => Math.min(current * ZOOM_FACTOR, MAX_SCALE))
  }, [])

  const zoomOut = useCallback(() => {
    setScale((current) => {
      const next = Math.max(current / ZOOM_FACTOR, MIN_SCALE)
      if (next <= 1) {
        setPosition({ x: 0, y: 0 })
      }
      return next
    })
  }, [])

  const rotateLeft = useCallback(() => {
    setRotation((current) => (current - 90) % 360)
  }, [])

  const rotateRight = useCallback(() => {
    setRotation((current) => (current + 90) % 360)
  }, [])

  const flipHorizontal = useCallback(() => {
    setFlipX((current) => !current)
  }, [])

  const flipVertical = useCallback(() => {
    setFlipY((current) => !current)
  }, [])

  const startDrag = useCallback((event: React.MouseEvent) => {
    if (scale <= 1) {
      return
    }
    event.preventDefault()
    setIsDragging(true)
    setDragStart({
      x: event.clientX - position.x,
      y: event.clientY - position.y,
    })
  }, [position.x, position.y, scale])

  useEffect(() => {
    if (!isDragging) {
      return
    }

    const handleMouseMove = (event: MouseEvent) => {
      if (scale <= 1) {
        return
      }
      setPosition({
        x: event.clientX - dragStart.x,
        y: event.clientY - dragStart.y,
      })
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragStart.x, dragStart.y, isDragging, scale])

  const transformStyle = useMemo(() => {
    const flipScaleX = flipX ? -scale : scale
    const flipScaleY = flipY ? -scale : scale

    return {
      transform: `translate(${position.x}px, ${position.y}px) rotate(${rotation}deg) scale(${flipScaleX}, ${flipScaleY})`,
      transformOrigin: 'center center',
      transition: isDragging ? 'none' : 'transform 120ms ease-out',
      cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default',
    }
  }, [flipX, flipY, isDragging, position.x, position.y, rotation, scale])

  return {
    scale,
    rotation,
    flipX,
    flipY,
    position,
    isDragging,
    transformStyle,
    zoomIn,
    zoomOut,
    rotateLeft,
    rotateRight,
    flipHorizontal,
    flipVertical,
    reset,
    startDrag,
  }
}
