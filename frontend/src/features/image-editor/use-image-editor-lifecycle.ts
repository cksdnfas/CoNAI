import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { ImageEditorCropRect, ImageEditorLayer, ImageEditorSavePayload, ImageEditorStroke, ImageEditorTool } from './image-editor-types'
import type { ImageEditorHistorySnapshot } from './use-image-editor-history'
import {
  calculateImageEditorFitZoom,
  loadEditorImage,
  renderImageEditorMaskCanvas,
  renderImageEditorSourceCanvas,
  transformImageEditorCanvas,
} from './image-editor-utils'

type ImageEditorSelectionClipboardLike = {
  imageDataUrl: string
  width: number
  height: number
  x: number
  y: number
  pasteCount: number
}

/** Own source/mask loading, editor reset, and save payload generation for the image editor modal. */
export function useImageEditorLifecycle({
  open,
  sourceImageDataUrl,
  maskImageDataUrl,
  enableMaskEditing,
  viewportSize,
  baseImage,
  documentSize,
  layers,
  initialMaskImage,
  maskStrokes,
  rotation,
  flippedX,
  saving,
  selectionClipboardRef,
  resetHistory,
  queueHistoryCommit,
  onClose,
  onSave,
  createDrawLayer,
  setLoading,
  setSaving,
  setBaseImage,
  setBaseImageDataUrl,
  setDocumentSize,
  setLayers,
  setActiveLayerId,
  setMaskStrokes,
  setSelectionRect,
  setCropRect,
  setHasStoredSelection,
  setRotation,
  setFlippedX,
  setTool,
  setZoom,
  setPan,
  setInitialMaskImage,
  setInitialMaskImageDataUrl,
  setMaskPreviewSurface,
  showSnackbar,
}: {
  open: boolean
  sourceImageDataUrl?: string
  maskImageDataUrl?: string
  enableMaskEditing: boolean
  viewportSize: { width: number; height: number }
  baseImage: HTMLImageElement | null
  documentSize: { width: number; height: number }
  layers: ImageEditorLayer[]
  initialMaskImage: HTMLImageElement | null
  maskStrokes: ImageEditorStroke[]
  rotation: number
  flippedX: boolean
  saving: boolean
  selectionClipboardRef: MutableRefObject<ImageEditorSelectionClipboardLike | null>
  resetHistory: (snapshot: ImageEditorHistorySnapshot) => void
  queueHistoryCommit: () => void
  onClose: () => void
  onSave: (payload: ImageEditorSavePayload) => void | Promise<void>
  createDrawLayer: (index: number) => Extract<ImageEditorLayer, { type: 'draw' }>
  setLoading: Dispatch<SetStateAction<boolean>>
  setSaving: Dispatch<SetStateAction<boolean>>
  setBaseImage: Dispatch<SetStateAction<HTMLImageElement | null>>
  setBaseImageDataUrl: Dispatch<SetStateAction<string | null>>
  setDocumentSize: Dispatch<SetStateAction<{ width: number; height: number }>>
  setLayers: Dispatch<SetStateAction<ImageEditorLayer[]>>
  setActiveLayerId: Dispatch<SetStateAction<string | null>>
  setMaskStrokes: Dispatch<SetStateAction<ImageEditorStroke[]>>
  setSelectionRect: Dispatch<SetStateAction<ImageEditorCropRect | null>>
  setCropRect: Dispatch<SetStateAction<ImageEditorCropRect | null>>
  setHasStoredSelection: Dispatch<SetStateAction<boolean>>
  setRotation: Dispatch<SetStateAction<number>>
  setFlippedX: Dispatch<SetStateAction<boolean>>
  setTool: Dispatch<SetStateAction<ImageEditorTool>>
  setZoom: Dispatch<SetStateAction<number>>
  setPan: Dispatch<SetStateAction<{ x: number; y: number }>>
  setInitialMaskImage: Dispatch<SetStateAction<HTMLImageElement | null>>
  setInitialMaskImageDataUrl: Dispatch<SetStateAction<string | null>>
  setMaskPreviewSurface: Dispatch<SetStateAction<HTMLCanvasElement | null>>
  showSnackbar: (input: { message: string; tone: 'info' | 'error' }) => void
}) {
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

        const firstLayer = createDrawLayer(1)
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
        setTool('brush')

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
  }, [
    createDrawLayer,
    enableMaskEditing,
    maskImageDataUrl,
    open,
    resetHistory,
    selectionClipboardRef,
    setActiveLayerId,
    setBaseImage,
    setBaseImageDataUrl,
    setCropRect,
    setDocumentSize,
    setFlippedX,
    setHasStoredSelection,
    setInitialMaskImage,
    setInitialMaskImageDataUrl,
    setLayers,
    setLoading,
    setMaskPreviewSurface,
    setMaskStrokes,
    setPan,
    setRotation,
    setSelectionRect,
    setTool,
    setZoom,
    showSnackbar,
    sourceImageDataUrl,
    viewportSize.height,
    viewportSize.width,
  ])

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
  }, [
    baseImage,
    documentSize.height,
    documentSize.width,
    enableMaskEditing,
    flippedX,
    initialMaskImage,
    layers,
    maskStrokes,
    onClose,
    onSave,
    rotation,
    saving,
    setSaving,
    showSnackbar,
  ])

  return {
    handleSave,
  }
}
