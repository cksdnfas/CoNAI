import { useCallback, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { ImageEditorCropRect, ImageEditorLayer, ImageEditorStroke, ImageEditorTool } from './image-editor-types'
import { clampImageEditorRect, createImageEditorId, normalizeImageEditorRect } from './image-editor-utils'

type ImageEditorSelectionHandle = 'nw' | 'ne' | 'sw' | 'se'

/** Own pointer-driven pan/select/crop/draw interactions for the image editor canvas. */
export function useImageEditorPointerInteractions({
  documentGroupRef,
  documentSize,
  tool,
  zoom,
  brushColor,
  brushSize,
  brushOpacity,
  activeLayerId,
  layers,
  selectionRect,
  setPan,
  setBrushPreviewPoint,
  setSelectionRect,
  setCropRect,
  setMaskStrokes,
  setLayers,
  setActiveLayerId,
  queueHistoryCommit,
  createDrawLayer,
  showSnackbar,
}: {
  documentGroupRef: RefObject<any>
  documentSize: { width: number; height: number }
  tool: ImageEditorTool
  zoom: number
  brushColor: string
  brushSize: number
  brushOpacity: number
  activeLayerId: string | null
  layers: ImageEditorLayer[]
  selectionRect: ImageEditorCropRect | null
  setPan: Dispatch<SetStateAction<{ x: number; y: number }>>
  setBrushPreviewPoint: Dispatch<SetStateAction<{ x: number; y: number } | null>>
  setSelectionRect: Dispatch<SetStateAction<ImageEditorCropRect | null>>
  setCropRect: Dispatch<SetStateAction<ImageEditorCropRect | null>>
  setMaskStrokes: Dispatch<SetStateAction<ImageEditorStroke[]>>
  setLayers: Dispatch<SetStateAction<ImageEditorLayer[]>>
  setActiveLayerId: Dispatch<SetStateAction<string | null>>
  queueHistoryCommit: () => void
  createDrawLayer: (index: number) => Extract<ImageEditorLayer, { type: 'draw' }>
  showSnackbar: (input: { message: string; tone: 'info' | 'error' }) => void
}) {
  const isPanningRef = useRef(false)
  const isDrawingRef = useRef(false)
  const isCroppingRef = useRef(false)
  const isSelectingRef = useRef(false)
  const isMovingSelectionRef = useRef(false)
  const selectionResizeHandleRef = useRef<ImageEditorSelectionHandle | null>(null)
  const selectionResizeOriginRectRef = useRef<ImageEditorCropRect | null>(null)
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null)
  const cropStartRef = useRef<{ x: number; y: number } | null>(null)
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null)
  const selectionMoveOffsetRef = useRef<{ x: number; y: number } | null>(null)

  /** Resolve the current pointer in document space using the transformed Konva group. */
  const getDocumentPointerPosition = useCallback(() => {
    const position = documentGroupRef.current?.getRelativePointerPosition?.()
    if (!position || typeof position.x !== 'number' || typeof position.y !== 'number') {
      return null
    }

    return {
      x: Math.max(0, Math.min(position.x, documentSize.width)),
      y: Math.max(0, Math.min(position.y, documentSize.height)),
    }
  }, [documentGroupRef, documentSize.height, documentSize.width])

  /** Ensure brush-like tools always have one editable draw layer to target. */
  const ensureActiveDrawLayer = useCallback(() => {
    const existingLayer = layers.find((layer) => layer.id === activeLayerId && layer.type === 'draw')
    if (existingLayer) {
      return existingLayer.locked ? null : existingLayer.id
    }

    const nextLayer = createDrawLayer(layers.filter((layer) => layer.type === 'draw').length + 1)
    setLayers((current) => [...current, nextLayer])
    setActiveLayerId(nextLayer.id)
    return nextLayer.id
  }, [activeLayerId, createDrawLayer, layers, setActiveLayerId, setLayers])

  /** Start one source or mask stroke at the current document pointer. */
  const startStroke = useCallback((point: { x: number; y: number }) => {
    const isMaskTool = tool === 'mask-brush' || tool === 'mask-eraser'
    const nextStroke: ImageEditorStroke = {
      id: createImageEditorId('stroke'),
      mode: tool === 'eraser' || tool === 'mask-eraser' ? 'erase' : 'draw',
      points: [point.x, point.y],
      strokeWidth: brushSize,
      color: isMaskTool ? '#ffffff' : brushColor,
      opacity: brushOpacity / 100,
    }

    if (isMaskTool) {
      setMaskStrokes((current) => [...current, nextStroke])
      return
    }

    const drawLayerId = ensureActiveDrawLayer()
    if (!drawLayerId) {
      showSnackbar({ message: '잠긴 레이어에는 그릴 수 없어.', tone: 'error' })
      return
    }

    setLayers((current) => current.map((layer) => {
      if (layer.id !== drawLayerId || layer.type !== 'draw') {
        return layer
      }

      return {
        ...layer,
        lines: [...layer.lines, nextStroke],
      }
    }))
  }, [brushColor, brushOpacity, brushSize, ensureActiveDrawLayer, setLayers, setMaskStrokes, showSnackbar, tool])

  /** Append one point to the currently active source or mask stroke. */
  const extendStroke = useCallback((point: { x: number; y: number }) => {
    const isMaskTool = tool === 'mask-brush' || tool === 'mask-eraser'
    if (isMaskTool) {
      setMaskStrokes((current) => {
        const lastStroke = current[current.length - 1]
        if (!lastStroke) {
          return current
        }

        return [
          ...current.slice(0, -1),
          { ...lastStroke, points: [...lastStroke.points, point.x, point.y] },
        ]
      })
      return
    }

    setLayers((current) => current.map((layer) => {
      if (layer.id !== activeLayerId || layer.type !== 'draw') {
        return layer
      }

      const lastStroke = layer.lines[layer.lines.length - 1]
      if (!lastStroke) {
        return layer
      }

      return {
        ...layer,
        lines: [
          ...layer.lines.slice(0, -1),
          { ...lastStroke, points: [...lastStroke.points, point.x, point.y] },
        ],
      }
    }))
  }, [activeLayerId, setLayers, setMaskStrokes, tool])

  /** Start pan, selection move, stroke, or crop interactions from the current tool state. */
  const handleStagePointerDown = useCallback(() => {
    if (tool === 'pan') {
      const stage = documentGroupRef.current?.getStage?.()
      const pointer = stage?.getPointerPosition?.()
      if (!pointer) {
        return
      }

      isPanningRef.current = true
      lastPointerRef.current = pointer
      return
    }

    const point = getDocumentPointerPosition()
    if (!point) {
      return
    }

    if (tool === 'brush' || tool === 'eraser' || tool === 'mask-brush' || tool === 'mask-eraser') {
      setBrushPreviewPoint(point)
    }

    if (tool === 'select') {
      const currentSelectionRect = selectionRect ? normalizeImageEditorRect(selectionRect) : null
      const selectionHandle = currentSelectionRect ? getSelectionHandleAtPoint(point, currentSelectionRect, zoom) : null

      if (currentSelectionRect && selectionHandle) {
        selectionResizeHandleRef.current = selectionHandle
        selectionResizeOriginRectRef.current = currentSelectionRect
        return
      }

      if (
        currentSelectionRect
        && point.x >= currentSelectionRect.x
        && point.x <= currentSelectionRect.x + currentSelectionRect.width
        && point.y >= currentSelectionRect.y
        && point.y <= currentSelectionRect.y + currentSelectionRect.height
      ) {
        isMovingSelectionRef.current = true
        selectionMoveOffsetRef.current = {
          x: point.x - currentSelectionRect.x,
          y: point.y - currentSelectionRect.y,
        }
        return
      }

      isSelectingRef.current = true
      selectionStartRef.current = point
      setSelectionRect({ x: point.x, y: point.y, width: 0, height: 0 })
      return
    }

    if (tool === 'crop') {
      isCroppingRef.current = true
      cropStartRef.current = point
      setCropRect({ x: point.x, y: point.y, width: 0, height: 0 })
      return
    }

    isDrawingRef.current = true
    startStroke(point)
  }, [documentGroupRef, getDocumentPointerPosition, selectionRect, setBrushPreviewPoint, setCropRect, setSelectionRect, startStroke, tool, zoom])

  /** Continue the active pan, selection move, stroke, or crop interaction as the pointer moves. */
  const handleStagePointerMove = useCallback(() => {
    if (isPanningRef.current) {
      const stage = documentGroupRef.current?.getStage?.()
      const pointer = stage?.getPointerPosition?.()
      if (!pointer || !lastPointerRef.current) {
        return
      }

      setPan((current) => ({ x: current.x + (pointer.x - lastPointerRef.current!.x), y: current.y + (pointer.y - lastPointerRef.current!.y) }))
      lastPointerRef.current = pointer
      return
    }

    const point = getDocumentPointerPosition()
    if (!point) {
      setBrushPreviewPoint(null)
      return
    }

    if (tool === 'brush' || tool === 'eraser' || tool === 'mask-brush' || tool === 'mask-eraser') {
      setBrushPreviewPoint(point)
    }

    const currentSelectionRect = selectionRect ? normalizeImageEditorRect(selectionRect) : null

    if (selectionResizeHandleRef.current && selectionResizeOriginRectRef.current) {
      const originRect = selectionResizeOriginRectRef.current
      const resizedRectByHandle = selectionResizeHandleRef.current === 'nw'
        ? {
            x: point.x,
            y: point.y,
            width: originRect.x + originRect.width - point.x,
            height: originRect.y + originRect.height - point.y,
          }
        : selectionResizeHandleRef.current === 'ne'
          ? {
              x: originRect.x,
              y: point.y,
              width: point.x - originRect.x,
              height: originRect.y + originRect.height - point.y,
            }
          : selectionResizeHandleRef.current === 'sw'
            ? {
                x: point.x,
                y: originRect.y,
                width: originRect.x + originRect.width - point.x,
                height: point.y - originRect.y,
              }
            : {
                x: originRect.x,
                y: originRect.y,
                width: point.x - originRect.x,
                height: point.y - originRect.y,
              }

      setSelectionRect(clampImageEditorRect(resizedRectByHandle, documentSize.width, documentSize.height))
      return
    }

    if (isMovingSelectionRef.current && selectionMoveOffsetRef.current && currentSelectionRect) {
      const nextX = Math.max(0, Math.min(point.x - selectionMoveOffsetRef.current.x, documentSize.width - currentSelectionRect.width))
      const nextY = Math.max(0, Math.min(point.y - selectionMoveOffsetRef.current.y, documentSize.height - currentSelectionRect.height))
      setSelectionRect({
        x: nextX,
        y: nextY,
        width: currentSelectionRect.width,
        height: currentSelectionRect.height,
      })
      return
    }

    if (isSelectingRef.current && selectionStartRef.current) {
      setSelectionRect({
        x: selectionStartRef.current.x,
        y: selectionStartRef.current.y,
        width: point.x - selectionStartRef.current.x,
        height: point.y - selectionStartRef.current.y,
      })
      return
    }

    if (isCroppingRef.current && cropStartRef.current) {
      setCropRect({
        x: cropStartRef.current.x,
        y: cropStartRef.current.y,
        width: point.x - cropStartRef.current.x,
        height: point.y - cropStartRef.current.y,
      })
      return
    }

    if (isDrawingRef.current) {
      extendStroke(point)
    }
  }, [documentGroupRef, documentSize.height, documentSize.width, extendStroke, getDocumentPointerPosition, selectionRect, setBrushPreviewPoint, setCropRect, setPan, setSelectionRect, tool])

  /** Finish the current pointer interaction and commit history only for real document edits. */
  const handleStagePointerUp = useCallback(() => {
    const shouldCommitHistory = isDrawingRef.current
    isPanningRef.current = false
    isDrawingRef.current = false
    isCroppingRef.current = false
    isSelectingRef.current = false
    isMovingSelectionRef.current = false
    selectionResizeHandleRef.current = null
    selectionResizeOriginRectRef.current = null
    setBrushPreviewPoint(null)
    lastPointerRef.current = null
    cropStartRef.current = null
    selectionStartRef.current = null
    selectionMoveOffsetRef.current = null

    if (shouldCommitHistory) {
      queueHistoryCommit()
    }
  }, [queueHistoryCommit, setBrushPreviewPoint])

  return {
    handleStagePointerDown,
    handleStagePointerMove,
    handleStagePointerUp,
  }
}

/** Find the active selection resize handle under the current document pointer. */
function getSelectionHandleAtPoint(point: { x: number; y: number }, rect: ImageEditorCropRect, zoom: number): ImageEditorSelectionHandle | null {
  const handleRadius = Math.max(6, 10 / zoom)
  const corners: Array<{ handle: ImageEditorSelectionHandle; x: number; y: number }> = [
    { handle: 'nw', x: rect.x, y: rect.y },
    { handle: 'ne', x: rect.x + rect.width, y: rect.y },
    { handle: 'sw', x: rect.x, y: rect.y + rect.height },
    { handle: 'se', x: rect.x + rect.width, y: rect.y + rect.height },
  ]

  const matchedCorner = corners.find((corner) => Math.abs(point.x - corner.x) <= handleRadius && Math.abs(point.y - corner.y) <= handleRadius)
  return matchedCorner?.handle ?? null
}
