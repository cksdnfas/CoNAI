import { useCallback, useEffect, useMemo, useRef, useState, type WheelEvent } from 'react'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { ImageEditorModalLayout } from './image-editor-modal-layout'
import { useImageEditorLayerSessionActions } from './use-image-editor-layer-session-actions'
import { useImageEditorHistory } from './use-image-editor-history'
import type { ImageEditorCropRect, ImageEditorLayer, ImageEditorSavePayload, ImageEditorStroke, ImageEditorTool } from './image-editor-types'
import {
  calculateImageEditorFitZoom,
  clampImageEditorRect,
  createImageEditorId,
  loadEditorImage,
  normalizeImageEditorRect,
  renderImageEditorMaskCanvas,
  renderImageEditorSourceCanvas,
  transformImageEditorCanvas,
} from './image-editor-utils'

type ImageEditorModalProps = {
  open: boolean
  title?: string
  sourceImageDataUrl?: string
  sourceFileName?: string
  maskImageDataUrl?: string
  enableMaskEditing?: boolean
  onClose: () => void
  onSave: (payload: ImageEditorSavePayload) => void | Promise<void>
}

type ImageEditorSelectionHandle = 'nw' | 'ne' | 'sw' | 'se'

type ImageEditorSelectionClipboard = {
  imageDataUrl: string
  width: number
  height: number
  x: number
  y: number
  pasteCount: number
}

/** Create one default editable draw layer for the current editor session. */
function createDefaultDrawLayer(index: number): Extract<ImageEditorLayer, { type: 'draw' }> {
  return {
    id: createImageEditorId('draw-layer'),
    type: 'draw',
    name: `Layer ${index}`,
    visible: true,
    locked: false,
    lines: [],
  }
}

/** Read one clipboard image file into a data URL. */
function readClipboardFileAsDataUrl(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read clipboard image'))
    reader.readAsDataURL(file)
  })
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

export function ImageEditorModal({
  open,
  title = 'Image Editor',
  sourceImageDataUrl,
  sourceFileName,
  maskImageDataUrl,
  enableMaskEditing = false,
  onClose,
  onSave,
}: ImageEditorModalProps) {
  const { showSnackbar } = useSnackbar()
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const documentGroupRef = useRef<any>(null)
  const isPanningRef = useRef(false)
  const isDrawingRef = useRef(false)
  const isCroppingRef = useRef(false)
  const isSelectingRef = useRef(false)
  const isMovingSelectionRef = useRef(false)
  const selectionResizeHandleRef = useRef<ImageEditorSelectionHandle | null>(null)
  const selectionResizeOriginRectRef = useRef<ImageEditorCropRect | null>(null)
  const selectionClipboardRef = useRef<ImageEditorSelectionClipboard | null>(null)
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null)
  const cropStartRef = useRef<{ x: number; y: number } | null>(null)
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null)
  const selectionMoveOffsetRef = useRef<{ x: number; y: number } | null>(null)

  const [viewportSize, setViewportSize] = useState({ width: 960, height: 640 })
  const [baseImage, setBaseImage] = useState<HTMLImageElement | null>(null)
  const [baseImageDataUrl, setBaseImageDataUrl] = useState<string | null>(null)
  const [documentSize, setDocumentSize] = useState({ width: 0, height: 0 })
  const [tool, setTool] = useState<ImageEditorTool>('brush')
  const [brushColor, setBrushColor] = useState('#ffffff')
  const [brushSize, setBrushSize] = useState(16)
  const [brushOpacity, setBrushOpacity] = useState(100)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [brushPreviewPoint, setBrushPreviewPoint] = useState<{ x: number; y: number } | null>(null)
  const [rotation, setRotation] = useState(0)
  const [flippedX, setFlippedX] = useState(false)
  const [layers, setLayers] = useState<ImageEditorLayer[]>([])
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null)
  const [maskStrokes, setMaskStrokes] = useState<ImageEditorStroke[]>([])
  const [initialMaskImage, setInitialMaskImage] = useState<HTMLImageElement | null>(null)
  const [initialMaskImageDataUrl, setInitialMaskImageDataUrl] = useState<string | null>(null)
  const [maskPreviewSurface, setMaskPreviewSurface] = useState<HTMLCanvasElement | null>(null)
  const [selectionRect, setSelectionRect] = useState<ImageEditorCropRect | null>(null)
  const [cropRect, setCropRect] = useState<ImageEditorCropRect | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [hasStoredSelection, setHasStoredSelection] = useState(false)

  const activeLayer = useMemo(() => {
    if (!activeLayerId) {
      return null
    }

    return layers.find((layer) => layer.id === activeLayerId) ?? null
  }, [activeLayerId, layers])

  const { historyStack, redoStack, queueHistoryCommit, resetHistory, handleUndo, handleRedo } = useImageEditorHistory({
    open,
    baseImageDataUrl,
    documentSize,
    layers,
    activeLayerId,
    initialMaskImageDataUrl,
    maskStrokes,
    selectionRect,
    cropRect,
    rotation,
    flippedX,
    loadImage: loadEditorImage,
    setBaseImage,
    setBaseImageDataUrl,
    setDocumentSize,
    setLayers,
    setActiveLayerId,
    setInitialMaskImage,
    setInitialMaskImageDataUrl,
    setMaskStrokes,
    setSelectionRect,
    setCropRect,
    setRotation,
    setFlippedX,
  })

  /** Update the measured viewport rectangle used by the stage and fit calculation. */
  const syncViewportSize = useCallback(() => {
    const nextWidth = viewportRef.current?.clientWidth ?? 960
    const nextHeight = viewportRef.current?.clientHeight ?? 640
    setViewportSize({ width: nextWidth, height: nextHeight })
  }, [])

  useEffect(() => {
    if (!open) {
      return
    }

    syncViewportSize()
    const observer = new ResizeObserver(() => syncViewportSize())
    if (viewportRef.current) {
      observer.observe(viewportRef.current)
    }

    return () => observer.disconnect()
  }, [open, syncViewportSize])

  /** Reset the editor session from the provided source and optional mask inputs. */
  useEffect(() => {
    if (!open || !sourceImageDataUrl) {
      return
    }

    let cancelled = false

    const load = async () => {
      try {
        setLoading(true)
        const loadedBaseImage = await loadEditorImage(sourceImageDataUrl)
        if (cancelled) {
          return
        }

        const firstLayer = createDefaultDrawLayer(1)
        setBaseImage(loadedBaseImage)
        setBaseImageDataUrl(sourceImageDataUrl)
        setDocumentSize({ width: loadedBaseImage.width, height: loadedBaseImage.height })
        setLayers([firstLayer])
        setActiveLayerId(firstLayer.id)
        setMaskStrokes([])
        setSelectionRect(null)
        setCropRect(null)
        selectionClipboardRef.current = null
        setHasStoredSelection(false)
        setRotation(0)
        setFlippedX(false)
        setTool(enableMaskEditing ? 'brush' : 'brush')

        const fitZoom = calculateImageEditorFitZoom(loadedBaseImage.width, loadedBaseImage.height, viewportSize.width, viewportSize.height)
        setZoom(fitZoom)
        setPan({ x: 0, y: 0 })

        if (enableMaskEditing && maskImageDataUrl) {
          const loadedMaskImage = await loadEditorImage(maskImageDataUrl)
          if (cancelled) {
            return
          }

          setInitialMaskImage(loadedMaskImage)
          setInitialMaskImageDataUrl(maskImageDataUrl)
        } else {
          setInitialMaskImage(null)
          setInitialMaskImageDataUrl(null)
          setMaskPreviewSurface(null)
        }

        resetHistory({
          baseImageDataUrl: sourceImageDataUrl,
          documentSize: { width: loadedBaseImage.width, height: loadedBaseImage.height },
          layers: [firstLayer],
          activeLayerId: firstLayer.id,
          initialMaskImageDataUrl: enableMaskEditing && maskImageDataUrl ? maskImageDataUrl : null,
          maskStrokes: [],
          selectionRect: null,
          cropRect: null,
          rotation: 0,
          flippedX: false,
        })
      } catch (error) {
        if (!cancelled) {
          showSnackbar({ message: error instanceof Error ? error.message : '에디터 이미지를 불러오지 못했어.', tone: 'error' })
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [enableMaskEditing, maskImageDataUrl, open, resetHistory, showSnackbar, sourceImageDataUrl, viewportSize.height, viewportSize.width])

  /** Rebuild the live red mask preview whenever the effective mask changes. */
  useEffect(() => {
    if (!enableMaskEditing || documentSize.width <= 0 || documentSize.height <= 0) {
      setMaskPreviewSurface(null)
      return
    }

    let cancelled = false

    const rebuildPreview = async () => {
      const maskCanvas = await renderImageEditorMaskCanvas({
        initialMaskImage,
        documentWidth: documentSize.width,
        documentHeight: documentSize.height,
        maskStrokes,
      })

      const previewCanvas = document.createElement('canvas')
      previewCanvas.width = maskCanvas.width
      previewCanvas.height = maskCanvas.height
      const previewContext = previewCanvas.getContext('2d')
      if (!previewContext) {
        return
      }

      previewContext.drawImage(maskCanvas, 0, 0)
      const previewImageData = previewContext.getImageData(0, 0, previewCanvas.width, previewCanvas.height)

      for (let index = 0; index < previewImageData.data.length; index += 4) {
        const strength = previewImageData.data[index] ?? 0
        previewImageData.data[index] = 255
        previewImageData.data[index + 1] = 68
        previewImageData.data[index + 2] = 68
        previewImageData.data[index + 3] = Math.round((strength / 255) * 150)
      }

      previewContext.putImageData(previewImageData, 0, 0)
      if (!cancelled) {
        setMaskPreviewSurface(previewCanvas)
      }
    }

    void rebuildPreview()
    return () => {
      cancelled = true
    }
  }, [documentSize.height, documentSize.width, enableMaskEditing, initialMaskImage, maskStrokes])

  useEffect(() => {
    if (tool !== 'brush' && tool !== 'eraser' && tool !== 'mask-brush' && tool !== 'mask-eraser') {
      setBrushPreviewPoint(null)
    }
  }, [tool])

  useEffect(() => {
    if (tool !== 'brush' && tool !== 'eraser' && tool !== 'mask-brush' && tool !== 'mask-eraser') {
      setBrushPreviewPoint(null)
    }
  }, [tool])

  /** Keep one fit-to-screen action available after crop or image reset. */
  const handleFitToScreen = useCallback(() => {
    if (documentSize.width <= 0 || documentSize.height <= 0) {
      return
    }

    setZoom(calculateImageEditorFitZoom(documentSize.width, documentSize.height, viewportSize.width, viewportSize.height))
    setPan({ x: 0, y: 0 })
  }, [documentSize.height, documentSize.width, viewportSize.height, viewportSize.width])

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
  }, [documentSize.height, documentSize.width])

  /** Ensure the editor always has one active draw layer for brush-based tools. */
  const ensureActiveDrawLayer = useCallback(() => {
    const existingLayer = layers.find((layer) => layer.id === activeLayerId && layer.type === 'draw')
    if (existingLayer) {
      return existingLayer.locked ? null : existingLayer.id
    }

    const nextLayer = createDefaultDrawLayer(layers.filter((layer) => layer.type === 'draw').length + 1)
    setLayers((current) => [...current, nextLayer])
    setActiveLayerId(nextLayer.id)
    return nextLayer.id
  }, [activeLayerId, layers])

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
  }, [brushColor, brushSize, ensureActiveDrawLayer, tool])

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
  }, [activeLayerId, tool])

  /** Insert one pasted image layer at the center of the current document. */
  const addPasteLayerFromDataUrl = useCallback(async (imageDataUrl: string) => {
    if (documentSize.width <= 0 || documentSize.height <= 0) {
      return
    }

    try {
      const image = await loadEditorImage(imageDataUrl)
      const maxPasteWidth = documentSize.width * 0.7
      const maxPasteHeight = documentSize.height * 0.7
      const scale = Math.min(1, maxPasteWidth / image.width, maxPasteHeight / image.height)
      const width = Math.max(1, Math.round(image.width * scale))
      const height = Math.max(1, Math.round(image.height * scale))
      const nextLayer: Extract<ImageEditorLayer, { type: 'paste' }> = {
        id: createImageEditorId('paste-layer'),
        type: 'paste',
        name: `Paste ${layers.filter((layer) => layer.type === 'paste').length + 1}`,
        visible: true,
        locked: false,
        imageDataUrl,
        x: Math.round((documentSize.width - width) / 2),
        y: Math.round((documentSize.height - height) / 2),
        width,
        height,
      }

      setLayers((current) => [...current, nextLayer])
      setActiveLayerId(nextLayer.id)
      queueHistoryCommit()
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : '붙여넣기 이미지를 불러오지 못했어.', tone: 'error' })
    }
  }, [documentSize.height, documentSize.width, layers, queueHistoryCommit, showSnackbar])

  /** Listen for system paste images while the editor is open. */
  useEffect(() => {
    if (!open) {
      return
    }

    const handlePaste = async (event: ClipboardEvent) => {
      const imageItem = Array.from(event.clipboardData?.items ?? []).find((item) => item.type.startsWith('image/'))
      const blob = imageItem?.getAsFile()
      if (!blob) {
        return
      }

      event.preventDefault()
      await addPasteLayerFromDataUrl(await readClipboardFileAsDataUrl(blob))
    }

    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [addPasteLayerFromDataUrl, open])

  /** Copy, cut, duplicate, or promote the selected rectangle into a movable paste layer. */
  const handleSelectionTransfer = useCallback(async (mode: 'copy' | 'cut' | 'duplicate' | 'promote') => {
    if (!baseImage || !selectionRect) {
      return
    }

    const normalizedSelectionRect = clampImageEditorRect(selectionRect, documentSize.width, documentSize.height)
    if (normalizedSelectionRect.width < 2 || normalizedSelectionRect.height < 2) {
      showSnackbar({ message: '선택 영역이 너무 작아.', tone: 'error' })
      return
    }

    try {
      setLoading(true)
      const sourceCanvas = await renderImageEditorSourceCanvas({
        baseImage,
        documentWidth: documentSize.width,
        documentHeight: documentSize.height,
        layers,
      })

      const selectionCanvas = document.createElement('canvas')
      selectionCanvas.width = normalizedSelectionRect.width
      selectionCanvas.height = normalizedSelectionRect.height
      const selectionContext = selectionCanvas.getContext('2d')
      if (!selectionContext) {
        throw new Error('Failed to extract selected pixels')
      }

      selectionContext.drawImage(
        sourceCanvas,
        normalizedSelectionRect.x,
        normalizedSelectionRect.y,
        normalizedSelectionRect.width,
        normalizedSelectionRect.height,
        0,
        0,
        normalizedSelectionRect.width,
        normalizedSelectionRect.height,
      )

      const selectionDataUrl = selectionCanvas.toDataURL('image/png')
      selectionClipboardRef.current = {
        imageDataUrl: selectionDataUrl,
        width: normalizedSelectionRect.width,
        height: normalizedSelectionRect.height,
        x: normalizedSelectionRect.x,
        y: normalizedSelectionRect.y,
        pasteCount: 0,
      }
      setHasStoredSelection(true)
      const duplicateOffset = mode === 'duplicate' ? 16 : 0
      const nextPasteLayer: Extract<ImageEditorLayer, { type: 'paste' }> = {
        id: createImageEditorId('paste-layer'),
        type: 'paste',
        name: `${mode === 'cut' ? 'Cut' : mode === 'duplicate' ? 'Duplicate' : mode === 'promote' ? 'Selection' : 'Copy'} ${layers.filter((layer) => layer.type === 'paste').length + 1}`,
        visible: true,
        locked: false,
        imageDataUrl: selectionDataUrl,
        x: Math.max(0, Math.min(normalizedSelectionRect.x + duplicateOffset, documentSize.width - normalizedSelectionRect.width)),
        y: Math.max(0, Math.min(normalizedSelectionRect.y + duplicateOffset, documentSize.height - normalizedSelectionRect.height)),
        width: normalizedSelectionRect.width,
        height: normalizedSelectionRect.height,
      }

      if (mode === 'cut') {
        const sourceContext = sourceCanvas.getContext('2d')
        if (!sourceContext) {
          throw new Error('Failed to update source pixels after cut')
        }

        sourceContext.clearRect(
          normalizedSelectionRect.x,
          normalizedSelectionRect.y,
          normalizedSelectionRect.width,
          normalizedSelectionRect.height,
        )

        const nextBaseImageDataUrl = sourceCanvas.toDataURL('image/png')
        const nextBaseImage = await loadEditorImage(nextBaseImageDataUrl)
        const firstLayer = createDefaultDrawLayer(1)
        setBaseImage(nextBaseImage)
        setBaseImageDataUrl(nextBaseImageDataUrl)
        setLayers([firstLayer, nextPasteLayer])
        setActiveLayerId(nextPasteLayer.id)
      } else {
        setLayers((current) => [...current, nextPasteLayer])
        setActiveLayerId(nextPasteLayer.id)
      }

      if (mode === 'copy' || mode === 'cut') {
        setSelectionRect(null)
        setTool('pan')
      }
      queueHistoryCommit()
      showSnackbar({
        message: mode === 'cut'
          ? '선택을 잘라서 새 레이어로 옮겼어.'
          : mode === 'duplicate'
            ? '선택 복제 레이어를 만들었어.'
            : mode === 'promote'
              ? '선택을 새 레이어로 승격했어.'
              : '선택을 새 레이어로 복사했어.',
        tone: 'info',
      })
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : '선택 영역을 처리하지 못했어.', tone: 'error' })
    } finally {
      setLoading(false)
    }
  }, [baseImage, documentSize.height, documentSize.width, layers, queueHistoryCommit, selectionRect, showSnackbar])

  /** Paste the most recently stored selection clipboard as a new paste layer. */
  const handlePasteStoredSelection = useCallback(() => {
    const storedSelection = selectionClipboardRef.current
    if (!storedSelection || documentSize.width <= 0 || documentSize.height <= 0) {
      return
    }

    const nextPasteCount = storedSelection.pasteCount + 1
    storedSelection.pasteCount = nextPasteCount
    const offset = 16 * nextPasteCount
    const nextLayer: Extract<ImageEditorLayer, { type: 'paste' }> = {
      id: createImageEditorId('paste-layer'),
      type: 'paste',
      name: `Paste Sel ${layers.filter((layer) => layer.type === 'paste').length + 1}`,
      visible: true,
      locked: false,
      imageDataUrl: storedSelection.imageDataUrl,
      x: Math.max(0, Math.min(storedSelection.x + offset, documentSize.width - storedSelection.width)),
      y: Math.max(0, Math.min(storedSelection.y + offset, documentSize.height - storedSelection.height)),
      width: storedSelection.width,
      height: storedSelection.height,
    }

    setLayers((current) => [...current, nextLayer])
    setActiveLayerId(nextLayer.id)
    queueHistoryCommit()
    showSnackbar({ message: '저장된 선택을 붙여넣었어.', tone: 'info' })
  }, [documentSize.height, documentSize.width, layers, queueHistoryCommit, showSnackbar])

  /** Delete the current selected rectangle from the flattened source composition. */
  const handleDeleteSelection = useCallback(async () => {
    if (!baseImage || !selectionRect) {
      return
    }

    const normalizedSelectionRect = clampImageEditorRect(selectionRect, documentSize.width, documentSize.height)
    if (normalizedSelectionRect.width < 2 || normalizedSelectionRect.height < 2) {
      showSnackbar({ message: '선택 영역이 너무 작아.', tone: 'error' })
      return
    }

    try {
      setLoading(true)
      const sourceCanvas = await renderImageEditorSourceCanvas({
        baseImage,
        documentWidth: documentSize.width,
        documentHeight: documentSize.height,
        layers,
      })
      const sourceContext = sourceCanvas.getContext('2d')
      if (!sourceContext) {
        throw new Error('Failed to update source pixels after delete')
      }

      sourceContext.clearRect(
        normalizedSelectionRect.x,
        normalizedSelectionRect.y,
        normalizedSelectionRect.width,
        normalizedSelectionRect.height,
      )

      const nextBaseImageDataUrl = sourceCanvas.toDataURL('image/png')
      const nextBaseImage = await loadEditorImage(nextBaseImageDataUrl)
      const firstLayer = createDefaultDrawLayer(1)
      setBaseImage(nextBaseImage)
      setBaseImageDataUrl(nextBaseImageDataUrl)
      setLayers([firstLayer])
      setActiveLayerId(firstLayer.id)
      setSelectionRect(null)
      setTool('pan')
      queueHistoryCommit()
      showSnackbar({ message: '선택 영역을 삭제했어.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : '선택 영역을 삭제하지 못했어.', tone: 'error' })
    } finally {
      setLoading(false)
    }
  }, [baseImage, documentSize.height, documentSize.width, layers, queueHistoryCommit, selectionRect, showSnackbar])

  /** Handle editor keyboard shortcuts while avoiding text-input conflicts. */
  useEffect(() => {
    if (!open) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isTypingTarget = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
      if (isTypingTarget) {
        return
      }

      const lowerKey = event.key.toLowerCase()
      const isShortcutModifier = event.ctrlKey || event.metaKey
      if (isShortcutModifier && lowerKey === 'z' && !event.shiftKey) {
        event.preventDefault()
        void handleUndo()
        return
      }

      if (isShortcutModifier && (lowerKey === 'y' || (event.shiftKey && lowerKey === 'z'))) {
        event.preventDefault()
        void handleRedo()
        return
      }

      if (event.key === 'Escape') {
        if (cropRect) {
          event.preventDefault()
          setCropRect(null)
          setTool('brush')
          return
        }

        if (selectionRect) {
          event.preventDefault()
          setSelectionRect(null)
          return
        }
      }

      if (event.key === '[') {
        event.preventDefault()
        setBrushSize((current) => Math.max(1, current - 2))
        return
      }

      if (event.key === ']') {
        event.preventDefault()
        setBrushSize((current) => Math.min(256, current + 2))
        return
      }

      if (!isShortcutModifier) {
        if (lowerKey === 'h') {
          event.preventDefault()
          setTool('pan')
          return
        }

        if (lowerKey === 's') {
          event.preventDefault()
          setTool('select')
          return
        }

        if (lowerKey === 'b') {
          event.preventDefault()
          setTool('brush')
          return
        }

        if (lowerKey === 'e') {
          event.preventDefault()
          setTool('eraser')
          return
        }

        if (lowerKey === 'c') {
          event.preventDefault()
          setTool('crop')
          return
        }

        if (enableMaskEditing && lowerKey === 'm') {
          event.preventDefault()
          setTool(event.shiftKey ? 'mask-eraser' : 'mask-brush')
          return
        }
      }

      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const step = event.shiftKey ? 10 : 1
        const deltaX = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
        const deltaY = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0

        if (event.altKey) {
          if (cropRect) {
            event.preventDefault()
            setCropRect((current) => resizeRect(current, deltaX, deltaY))
            queueHistoryCommit()
            return
          }

          if (selectionRect) {
            event.preventDefault()
            setSelectionRect((current) => resizeRect(current, deltaX, deltaY))
            queueHistoryCommit()
            return
          }
        }

        if (cropRect) {
          event.preventDefault()
          setCropRect((current) => nudgeRect(current, deltaX, deltaY))
          queueHistoryCommit()
          return
        }

        if (selectionRect) {
          event.preventDefault()
          setSelectionRect((current) => nudgeRect(current, deltaX, deltaY))
          queueHistoryCommit()
          return
        }
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') && selectionRect) {
        event.preventDefault()
        void handleDeleteSelection()
        return
      }

      if (isShortcutModifier && lowerKey === 'c' && selectionRect) {
        event.preventDefault()
        void handleSelectionTransfer('copy')
        return
      }

      if (isShortcutModifier && lowerKey === 'x' && selectionRect) {
        event.preventDefault()
        void handleSelectionTransfer('cut')
        return
      }

      if (isShortcutModifier && lowerKey === 'd' && selectionRect) {
        event.preventDefault()
        void handleSelectionTransfer('duplicate')
        return
      }

      if (isShortcutModifier && event.shiftKey && lowerKey === 'v' && selectionClipboardRef.current) {
        event.preventDefault()
        handlePasteStoredSelection()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [cropRect, enableMaskEditing, handleDeleteSelection, handlePasteStoredSelection, handleRedo, handleSelectionTransfer, handleUndo, open, queueHistoryCommit, selectionRect])

  /** Apply one crop rectangle by flattening current source and mask compositions into new bases. */
  const handleApplyCrop = useCallback(async () => {
    if (!baseImage || !cropRect) {
      return
    }

    const clampedRect = clampImageEditorRect(cropRect, documentSize.width, documentSize.height)
    if (clampedRect.width < 2 || clampedRect.height < 2) {
      showSnackbar({ message: '잘라낼 영역이 너무 작아.', tone: 'error' })
      return
    }

    try {
      setLoading(true)
      const [sourceCanvas, maskCanvas] = await Promise.all([
        renderImageEditorSourceCanvas({
          baseImage,
          documentWidth: documentSize.width,
          documentHeight: documentSize.height,
          layers,
        }),
        enableMaskEditing
          ? renderImageEditorMaskCanvas({
              initialMaskImage,
              documentWidth: documentSize.width,
              documentHeight: documentSize.height,
              maskStrokes,
            })
          : Promise.resolve(null),
      ])

      const croppedSourceCanvas = document.createElement('canvas')
      croppedSourceCanvas.width = clampedRect.width
      croppedSourceCanvas.height = clampedRect.height
      const sourceContext = croppedSourceCanvas.getContext('2d')
      if (!sourceContext) {
        throw new Error('Failed to crop source image')
      }

      sourceContext.drawImage(
        sourceCanvas,
        clampedRect.x,
        clampedRect.y,
        clampedRect.width,
        clampedRect.height,
        0,
        0,
        clampedRect.width,
        clampedRect.height,
      )

      const nextSourceDataUrl = croppedSourceCanvas.toDataURL('image/png')
      const nextBaseImage = await loadEditorImage(nextSourceDataUrl)
      const firstLayer = createDefaultDrawLayer(1)
      setBaseImage(nextBaseImage)
      setBaseImageDataUrl(nextSourceDataUrl)
      setDocumentSize({ width: clampedRect.width, height: clampedRect.height })
      setLayers([firstLayer])
      setActiveLayerId(firstLayer.id)
      setSelectionRect(null)
      setCropRect(null)
      setMaskStrokes([])
      selectionClipboardRef.current = null
      setHasStoredSelection(false)

      if (enableMaskEditing && maskCanvas) {
        const croppedMaskCanvas = document.createElement('canvas')
        croppedMaskCanvas.width = clampedRect.width
        croppedMaskCanvas.height = clampedRect.height
        const maskContext = croppedMaskCanvas.getContext('2d')
        if (!maskContext) {
          throw new Error('Failed to crop mask image')
        }

        maskContext.drawImage(
          maskCanvas,
          clampedRect.x,
          clampedRect.y,
          clampedRect.width,
          clampedRect.height,
          0,
          0,
          clampedRect.width,
          clampedRect.height,
        )

        const nextMaskDataUrl = croppedMaskCanvas.toDataURL('image/png')
        setInitialMaskImage(await loadEditorImage(nextMaskDataUrl))
        setInitialMaskImageDataUrl(nextMaskDataUrl)
      } else {
        setInitialMaskImage(null)
        setInitialMaskImageDataUrl(null)
      }

      setRotation(0)
      setFlippedX(false)
      setPan({ x: 0, y: 0 })
      setZoom(calculateImageEditorFitZoom(clampedRect.width, clampedRect.height, viewportSize.width, viewportSize.height))
      queueHistoryCommit()
      showSnackbar({ message: '크롭을 적용했어.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : '크롭을 적용하지 못했어.', tone: 'error' })
    } finally {
      setLoading(false)
    }
  }, [baseImage, cropRect, documentSize.height, documentSize.width, enableMaskEditing, initialMaskImage, layers, maskStrokes, queueHistoryCommit, showSnackbar, viewportSize.height, viewportSize.width])

  const handleClearMask = useCallback(() => {
    setInitialMaskImage(null)
    setInitialMaskImageDataUrl(null)
    setMaskPreviewSurface(null)
    setMaskStrokes([])
    queueHistoryCommit()
    showSnackbar({ message: '마스크를 비웠어.', tone: 'info' })
  }, [queueHistoryCommit, showSnackbar])

  /** Save the current source and optional mask back into the caller draft state. */
  const handleSave = useCallback(async () => {
    if (!baseImage || saving) {
      return
    }

    try {
      setSaving(true)
      const sourceCanvas = await renderImageEditorSourceCanvas({
        baseImage,
        documentWidth: documentSize.width,
        documentHeight: documentSize.height,
        layers,
      })
      const transformedSourceCanvas = transformImageEditorCanvas(sourceCanvas, rotation, flippedX)

      let maskImageDataUrl: string | undefined
      if (enableMaskEditing) {
        const maskCanvas = await renderImageEditorMaskCanvas({
          initialMaskImage,
          documentWidth: documentSize.width,
          documentHeight: documentSize.height,
          maskStrokes,
        })
        const transformedMaskCanvas = transformImageEditorCanvas(maskCanvas, rotation, flippedX)
        maskImageDataUrl = transformedMaskCanvas.toDataURL('image/png')
      }

      await onSave({
        sourceImageDataUrl: transformedSourceCanvas.toDataURL('image/png'),
        maskImageDataUrl,
      })
      onClose()
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : '편집 결과를 저장하지 못했어.', tone: 'error' })
    } finally {
      setSaving(false)
    }
  }, [baseImage, documentSize.height, documentSize.width, enableMaskEditing, flippedX, initialMaskImage, layers, maskStrokes, onClose, onSave, rotation, saving, showSnackbar])

  /** Update the position of one pasted layer after drag movement. */
  const handleMovePasteLayer = useCallback((layerId: string, nextX: number, nextY: number) => {
    setLayers((current) => current.map((layer) => {
      if (layer.id !== layerId || layer.type !== 'paste') {
        return layer
      }

      return {
        ...layer,
        x: Math.max(0, Math.min(nextX, documentSize.width - layer.width)),
        y: Math.max(0, Math.min(nextY, documentSize.height - layer.height)),
      }
    }))
    queueHistoryCommit()
  }, [documentSize.height, documentSize.width, queueHistoryCommit])

  /** Update viewport zoom from wheel input while staying inside a small stable range. */
  const handleWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setZoom((current) => Math.max(0.1, Math.min(8, current * (event.deltaY > 0 ? 0.92 : 1.08))))
  }, [])

  /** Read one image directly from the async browser clipboard API when available. */
  const handlePasteFromClipboardButton = useCallback(async () => {
    try {
      if (!navigator.clipboard.read) {
        throw new Error('Clipboard read is not supported in this browser')
      }

      const items = await navigator.clipboard.read()
      const imageItem = items.find((item) => item.types.some((type) => type.startsWith('image/')))
      const imageType = imageItem?.types.find((type) => type.startsWith('image/'))

      if (!imageItem || !imageType) {
        throw new Error('No image data found in clipboard')
      }

      await addPasteLayerFromDataUrl(await readClipboardFileAsDataUrl(await imageItem.getType(imageType)))
    } catch {
      showSnackbar({ message: '브라우저가 직접 클립보드 읽기를 막았어. Ctrl+V를 써봐.', tone: 'error' })
    }
  }, [addPasteLayerFromDataUrl, showSnackbar])

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
  }, [getDocumentPointerPosition, selectionRect, startStroke, tool, zoom])

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
  }, [documentSize.height, documentSize.width, extendStroke, getDocumentPointerPosition, selectionRect, tool])

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
  }, [queueHistoryCommit])

  const normalizedSelectionRect = selectionRect ? normalizeImageEditorRect(selectionRect) : null
  const normalizedCropRect = cropRect ? normalizeImageEditorRect(cropRect) : null

  const updateRectField = useCallback((rect: ImageEditorCropRect | null, field: 'x' | 'y' | 'width' | 'height', value: number) => {
    if (!rect) {
      return null
    }

    const nextRect = { ...normalizeImageEditorRect(rect), [field]: field === 'width' || field === 'height' ? Math.max(1, value) : Math.max(0, value) }
    return clampImageEditorRect(nextRect, documentSize.width, documentSize.height)
  }, [documentSize.height, documentSize.width])

  function nudgeRect(rect: ImageEditorCropRect | null, deltaX: number, deltaY: number) {
    if (!rect) {
      return null
    }

    const normalizedRect = normalizeImageEditorRect(rect)
    return clampImageEditorRect({
      x: normalizedRect.x + deltaX,
      y: normalizedRect.y + deltaY,
      width: normalizedRect.width,
      height: normalizedRect.height,
    }, documentSize.width, documentSize.height)
  }

  function resizeRect(rect: ImageEditorCropRect | null, deltaWidth: number, deltaHeight: number) {
    if (!rect) {
      return null
    }

    const normalizedRect = normalizeImageEditorRect(rect)
    return clampImageEditorRect({
      x: normalizedRect.x,
      y: normalizedRect.y,
      width: Math.max(1, normalizedRect.width + deltaWidth),
      height: Math.max(1, normalizedRect.height + deltaHeight),
    }, documentSize.width, documentSize.height)
  }

  const canApplySelectionOperation = Boolean(normalizedSelectionRect && normalizedSelectionRect.width >= 2 && normalizedSelectionRect.height >= 2)
  const canApplyCrop = Boolean(normalizedCropRect && normalizedCropRect.width >= 2 && normalizedCropRect.height >= 2)
  const hasVisibleMask = enableMaskEditing && (Boolean(initialMaskImage) || maskStrokes.length > 0)
  const {
    canMergeVisible,
    canFlattenVisible,
    canClearActiveDrawLayer,
    handleAddLayer,
    handleRenameLayer,
    handleToggleLayerVisible,
    handleToggleLayerLocked,
    handleMoveLayer,
    handleDuplicateLayer,
    handleDeleteLayer,
    handleMergeVisible,
    handleFlattenVisible,
    handleMergeActiveLayerDown,
    handleClearActiveDrawLayer,
    handleClearAllDrawLayers,
    handleCancelCrop,
  } = useImageEditorLayerSessionActions({
    baseImage,
    documentSize,
    layers,
    activeLayerId,
    activeLayer,
    queueHistoryCommit,
    setLoading,
    setBaseImage,
    setBaseImageDataUrl,
    setLayers,
    setActiveLayerId,
    setSelectionRect,
    setCropRect,
    setTool,
    createDrawLayer: createDefaultDrawLayer,
    showSnackbar,
  })
  const selectionHandleSize = Math.max(6, 10 / zoom)

  return (
    <ImageEditorModalLayout
      open={open}
      saving={saving}
      title={title}
      sourceFileName={sourceFileName}
      onClose={onClose}
      onSave={() => void handleSave()}
      sourceSummary={{
        width: documentSize.width,
        height: documentSize.height,
        activeLayerName: activeLayer?.name ?? null,
        activeLayerLocked: activeLayer?.locked ?? false,
        zoom,
        rotation,
        enableMaskEditing,
        hasVisibleMask,
      }}
      toolbar={{
        tool,
        enableMaskEditing,
        brushColor,
        brushSize,
        brushOpacity,
        historyLength: historyStack.length,
        redoLength: redoStack.length,
        loading,
        hasStoredSelection,
        canApplySelectionOperation,
        canApplyCrop,
        onToolChange: setTool,
        onBrushColorChange: setBrushColor,
        onBrushSizeChange: setBrushSize,
        onBrushOpacityChange: setBrushOpacity,
        onUndo: () => void handleUndo(),
        onRedo: () => void handleRedo(),
        onZoomOut: () => setZoom((current) => Math.max(0.1, current * 0.9)),
        onZoomIn: () => setZoom((current) => Math.min(8, current * 1.1)),
        onFitToScreen: handleFitToScreen,
        onRotate: () => { setRotation((current) => (current + 90) % 360); queueHistoryCommit() },
        onFlip: () => { setFlippedX((current) => !current); queueHistoryCommit() },
        onPasteFromClipboard: () => void handlePasteFromClipboardButton(),
        onPasteStoredSelection: handlePasteStoredSelection,
        onSelectionCopy: () => void handleSelectionTransfer('copy'),
        onSelectionPromote: () => void handleSelectionTransfer('promote'),
        onSelectionDuplicate: () => void handleSelectionTransfer('duplicate'),
        onSelectionDelete: () => void handleDeleteSelection(),
        onSelectionCut: () => void handleSelectionTransfer('cut'),
        onClearMask: enableMaskEditing ? handleClearMask : undefined,
        onApplyCrop: handleApplyCrop,
      }}
      canvas={{
        viewportRef,
        documentGroupRef,
        baseImage,
        loading,
        viewportSize,
        documentSize,
        pan,
        zoom,
        rotation,
        flippedX,
        layers,
        activeLayerId,
        tool,
        brushPreviewPoint,
        brushSize,
        brushOpacity,
        enableMaskEditing,
        maskPreviewSurface,
        maskStrokes,
        normalizedSelectionRect,
        normalizedCropRect,
        selectionHandleSize,
        onWheel: handleWheel,
        onStagePointerDown: handleStagePointerDown,
        onStagePointerMove: handleStagePointerMove,
        onStagePointerUp: handleStagePointerUp,
        onMovePasteLayer: handleMovePasteLayer,
      }}
      layerPanel={{
        layers,
        activeLayerId,
        loading,
        enableMaskEditing,
        hasVisibleMask,
        onAddLayer: handleAddLayer,
        onSetActiveLayerId: setActiveLayerId,
        onRenameLayer: handleRenameLayer,
        onCommitRename: queueHistoryCommit,
        onToggleLayerVisible: handleToggleLayerVisible,
        onToggleLayerLocked: handleToggleLayerLocked,
        onMoveLayer: handleMoveLayer,
        onDuplicateLayer: handleDuplicateLayer,
        onMergeLayerDown: () => void handleMergeActiveLayerDown(),
        onDeleteLayer: handleDeleteLayer,
      }}
      sessionActions={{
        canMergeVisible,
        canFlattenVisible,
        canClearActiveDrawLayer,
        hasSelectionRect: Boolean(selectionRect),
        selectionRect: normalizedSelectionRect,
        cropRect: normalizedCropRect,
        saving,
        loading,
        canSave: Boolean(baseImage),
        onMergeVisible: () => void handleMergeVisible(),
        onFlattenVisible: () => void handleFlattenVisible(),
        onClearActiveDrawLayer: handleClearActiveDrawLayer,
        onClearAllDrawLayers: handleClearAllDrawLayers,
        onClearSelection: () => setSelectionRect(null),
        onSelectionRectFieldChange: (field, value) => {
          setSelectionRect((current) => updateRectField(current, field, value))
        },
        onCropRectFieldChange: (field, value) => {
          setCropRect((current) => updateRectField(current, field, value))
        },
        onCancelCrop: handleCancelCrop,
        onClose,
        onSave: () => void handleSave(),
      }}
    />
  )
}

export default ImageEditorModal
