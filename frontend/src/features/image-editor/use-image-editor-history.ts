import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { ImageEditorCropRect, ImageEditorLayer, ImageEditorStroke } from './image-editor-types'

type ImageEditorDocumentSize = { width: number; height: number }

export type ImageEditorHistorySnapshot = {
  baseImageDataUrl: string
  documentSize: ImageEditorDocumentSize
  layers: ImageEditorLayer[]
  activeLayerId: string | null
  initialMaskImageDataUrl: string | null
  maskStrokes: ImageEditorStroke[]
  selectionRect: ImageEditorCropRect | null
  cropRect: ImageEditorCropRect | null
  rotation: number
  flippedX: boolean
}

interface UseImageEditorHistoryOptions {
  open: boolean
  baseImageDataUrl: string | null
  documentSize: ImageEditorDocumentSize
  layers: ImageEditorLayer[]
  activeLayerId: string | null
  initialMaskImageDataUrl: string | null
  maskStrokes: ImageEditorStroke[]
  selectionRect: ImageEditorCropRect | null
  cropRect: ImageEditorCropRect | null
  rotation: number
  flippedX: boolean
  loadImage: (source: string) => Promise<HTMLImageElement>
  setBaseImage: Dispatch<SetStateAction<HTMLImageElement | null>>
  setBaseImageDataUrl: Dispatch<SetStateAction<string | null>>
  setDocumentSize: Dispatch<SetStateAction<ImageEditorDocumentSize>>
  setLayers: Dispatch<SetStateAction<ImageEditorLayer[]>>
  setActiveLayerId: Dispatch<SetStateAction<string | null>>
  setInitialMaskImage: Dispatch<SetStateAction<HTMLImageElement | null>>
  setInitialMaskImageDataUrl: Dispatch<SetStateAction<string | null>>
  setMaskStrokes: Dispatch<SetStateAction<ImageEditorStroke[]>>
  setSelectionRect: Dispatch<SetStateAction<ImageEditorCropRect | null>>
  setCropRect: Dispatch<SetStateAction<ImageEditorCropRect | null>>
  setRotation: Dispatch<SetStateAction<number>>
  setFlippedX: Dispatch<SetStateAction<boolean>>
}

/** Manage one snapshot-based undo and redo stack for the image editor document. */
export function useImageEditorHistory(options: UseImageEditorHistoryOptions) {
  const {
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
    loadImage,
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
  } = options

  const isApplyingHistoryRef = useRef(false)
  const [historyStack, setHistoryStack] = useState<ImageEditorHistorySnapshot[]>([])
  const [redoStack, setRedoStack] = useState<ImageEditorHistorySnapshot[]>([])
  const [historyCommitToken, setHistoryCommitToken] = useState(0)

  /** Capture one serializable editor-document snapshot for undo and redo. */
  const captureHistorySnapshot = useCallback((): ImageEditorHistorySnapshot | null => {
    if (!baseImageDataUrl) {
      return null
    }

    return {
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
    }
  }, [activeLayerId, baseImageDataUrl, cropRect, documentSize, flippedX, initialMaskImageDataUrl, layers, maskStrokes, rotation, selectionRect])

  /** Apply one stored editor-document snapshot back into live state. */
  const applyHistorySnapshot = useCallback(async (snapshot: ImageEditorHistorySnapshot) => {
    isApplyingHistoryRef.current = true
    try {
      const nextBaseImage = await loadImage(snapshot.baseImageDataUrl)
      const nextMaskImage = snapshot.initialMaskImageDataUrl ? await loadImage(snapshot.initialMaskImageDataUrl) : null
      setBaseImage(nextBaseImage)
      setBaseImageDataUrl(snapshot.baseImageDataUrl)
      setDocumentSize(snapshot.documentSize)
      setLayers(snapshot.layers)
      setActiveLayerId(snapshot.activeLayerId)
      setInitialMaskImage(nextMaskImage)
      setInitialMaskImageDataUrl(snapshot.initialMaskImageDataUrl)
      setMaskStrokes(snapshot.maskStrokes)
      setSelectionRect(snapshot.selectionRect)
      setCropRect(snapshot.cropRect)
      setRotation(snapshot.rotation)
      setFlippedX(snapshot.flippedX)
    } finally {
      isApplyingHistoryRef.current = false
    }
  }, [loadImage, setActiveLayerId, setBaseImage, setBaseImageDataUrl, setCropRect, setDocumentSize, setFlippedX, setInitialMaskImage, setInitialMaskImageDataUrl, setLayers, setMaskStrokes, setRotation, setSelectionRect])

  /** Queue one history commit after the current render settles. */
  const queueHistoryCommit = useCallback(() => {
    setHistoryCommitToken((current) => current + 1)
  }, [])

  /** Reset the full history state to one initial snapshot after a document reload. */
  const resetHistory = useCallback((snapshot: ImageEditorHistorySnapshot) => {
    setHistoryStack([snapshot])
    setRedoStack([])
  }, [])

  /** Commit a new snapshot into history after one document-changing action completes. */
  useEffect(() => {
    if (!open || isApplyingHistoryRef.current) {
      return
    }

    const snapshot = captureHistorySnapshot()
    if (!snapshot) {
      return
    }

    setHistoryStack((current) => {
      const currentSignature = JSON.stringify(snapshot)
      const previousSignature = current.length > 0 ? JSON.stringify(current[current.length - 1]) : null
      if (currentSignature === previousSignature) {
        return current
      }

      const nextHistory = [...current, snapshot]
      return nextHistory.slice(-30)
    })
    setRedoStack([])
  }, [captureHistorySnapshot, historyCommitToken, open])

  /** Restore the previous committed document snapshot. */
  const handleUndo = useCallback(async () => {
    if (historyStack.length <= 1) {
      return
    }

    const currentSnapshot = historyStack[historyStack.length - 1]
    const previousSnapshot = historyStack[historyStack.length - 2]
    if (!currentSnapshot || !previousSnapshot) {
      return
    }

    setRedoStack((current) => [...current, currentSnapshot])
    setHistoryStack((current) => current.slice(0, -1))
    await applyHistorySnapshot(previousSnapshot)
  }, [applyHistorySnapshot, historyStack])

  /** Restore one snapshot from the redo stack when available. */
  const handleRedo = useCallback(async () => {
    const nextSnapshot = redoStack[redoStack.length - 1]
    if (!nextSnapshot) {
      return
    }

    setRedoStack((current) => current.slice(0, -1))
    setHistoryStack((current) => [...current, nextSnapshot])
    await applyHistorySnapshot(nextSnapshot)
  }, [applyHistorySnapshot, redoStack])

  return {
    historyStack,
    redoStack,
    queueHistoryCommit,
    resetHistory,
    handleUndo,
    handleRedo,
  }
}

