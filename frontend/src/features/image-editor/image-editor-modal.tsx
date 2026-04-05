import { useCallback, useEffect, useMemo, useRef, useState, type WheelEvent } from 'react'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { ImageEditorModalLayout } from './image-editor-modal-layout'
import { useImageEditorLayerSessionActions } from './use-image-editor-layer-session-actions'
import { useImageEditorPointerInteractions } from './use-image-editor-pointer-interactions'
import { useImageEditorSelectionActions } from './use-image-editor-selection-actions'
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
  const selectionClipboardRef = useRef<ImageEditorSelectionClipboard | null>(null)

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

  const {
    addPasteLayerFromDataUrl,
    handleSelectionTransfer,
    handlePasteStoredSelection,
    handleDeleteSelection,
    handleApplyCrop,
    handlePasteFromClipboardButton,
  } = useImageEditorSelectionActions({
    baseImage,
    documentSize,
    viewportSize,
    layers,
    selectionRect,
    cropRect,
    enableMaskEditing,
    initialMaskImage,
    maskStrokes,
    selectionClipboardRef,
    queueHistoryCommit,
    createDrawLayer: createDefaultDrawLayer,
    setLoading,
    setBaseImage,
    setBaseImageDataUrl,
    setDocumentSize,
    setLayers,
    setActiveLayerId,
    setSelectionRect,
    setCropRect,
    setTool,
    setInitialMaskImage,
    setInitialMaskImageDataUrl,
    setMaskStrokes,
    setRotation,
    setFlippedX,
    setPan,
    setZoom,
    setHasStoredSelection,
    showSnackbar,
  })

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

  const {
    handleStagePointerDown,
    handleStagePointerMove,
    handleStagePointerUp,
  } = useImageEditorPointerInteractions({
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
    createDrawLayer: createDefaultDrawLayer,
    showSnackbar,
  })

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
