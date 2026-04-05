import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { ImageEditorCropRect, ImageEditorLayer, ImageEditorStroke, ImageEditorTool } from './image-editor-types'
import {
  calculateImageEditorFitZoom,
  clampImageEditorRect,
  createImageEditorId,
  loadEditorImage,
  renderImageEditorMaskCanvas,
  renderImageEditorSourceCanvas,
} from './image-editor-utils'

type ImageEditorSelectionClipboard = {
  imageDataUrl: string
  width: number
  height: number
  x: number
  y: number
  pasteCount: number
}

/** Own selection, clipboard, paste, delete, and crop actions for the image editor. */
export function useImageEditorSelectionActions({
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
  createDrawLayer,
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
}: {
  baseImage: HTMLImageElement | null
  documentSize: { width: number; height: number }
  viewportSize: { width: number; height: number }
  layers: ImageEditorLayer[]
  selectionRect: ImageEditorCropRect | null
  cropRect: ImageEditorCropRect | null
  enableMaskEditing: boolean
  initialMaskImage: HTMLImageElement | null
  maskStrokes: ImageEditorStroke[]
  selectionClipboardRef: MutableRefObject<ImageEditorSelectionClipboard | null>
  queueHistoryCommit: () => void
  createDrawLayer: (index: number) => Extract<ImageEditorLayer, { type: 'draw' }>
  setLoading: Dispatch<SetStateAction<boolean>>
  setBaseImage: Dispatch<SetStateAction<HTMLImageElement | null>>
  setBaseImageDataUrl: Dispatch<SetStateAction<string | null>>
  setDocumentSize: Dispatch<SetStateAction<{ width: number; height: number }>>
  setLayers: Dispatch<SetStateAction<ImageEditorLayer[]>>
  setActiveLayerId: Dispatch<SetStateAction<string | null>>
  setSelectionRect: Dispatch<SetStateAction<ImageEditorCropRect | null>>
  setCropRect: Dispatch<SetStateAction<ImageEditorCropRect | null>>
  setTool: Dispatch<SetStateAction<ImageEditorTool>>
  setInitialMaskImage: Dispatch<SetStateAction<HTMLImageElement | null>>
  setInitialMaskImageDataUrl: Dispatch<SetStateAction<string | null>>
  setMaskStrokes: Dispatch<SetStateAction<ImageEditorStroke[]>>
  setRotation: Dispatch<SetStateAction<number>>
  setFlippedX: Dispatch<SetStateAction<boolean>>
  setPan: Dispatch<SetStateAction<{ x: number; y: number }>>
  setZoom: Dispatch<SetStateAction<number>>
  setHasStoredSelection: Dispatch<SetStateAction<boolean>>
  showSnackbar: (input: { message: string; tone: 'info' | 'error' }) => void
}) {
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
  }, [documentSize.height, documentSize.width, layers, queueHistoryCommit, setActiveLayerId, setLayers, showSnackbar])

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
        const firstLayer = createDrawLayer(1)
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
  }, [baseImage, createDrawLayer, documentSize.height, documentSize.width, layers, queueHistoryCommit, selectionRect, selectionClipboardRef, setActiveLayerId, setBaseImage, setBaseImageDataUrl, setHasStoredSelection, setLayers, setLoading, setSelectionRect, setTool, showSnackbar])

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
  }, [documentSize.height, documentSize.width, layers, queueHistoryCommit, selectionClipboardRef, setActiveLayerId, setLayers, showSnackbar])

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
      const firstLayer = createDrawLayer(1)
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
  }, [baseImage, createDrawLayer, documentSize.height, documentSize.width, layers, queueHistoryCommit, selectionRect, setActiveLayerId, setBaseImage, setBaseImageDataUrl, setLayers, setLoading, setSelectionRect, setTool, showSnackbar])

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
      const firstLayer = createDrawLayer(1)
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
  }, [baseImage, cropRect, createDrawLayer, documentSize.height, documentSize.width, enableMaskEditing, initialMaskImage, layers, maskStrokes, queueHistoryCommit, selectionClipboardRef, setActiveLayerId, setBaseImage, setBaseImageDataUrl, setCropRect, setDocumentSize, setFlippedX, setHasStoredSelection, setInitialMaskImage, setInitialMaskImageDataUrl, setLayers, setLoading, setMaskStrokes, setPan, setRotation, setSelectionRect, setZoom, showSnackbar, viewportSize.height, viewportSize.width])

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

      await addPasteLayerFromDataUrl(await readClipboardBlobAsDataUrl(await imageItem.getType(imageType)))
    } catch {
      showSnackbar({ message: '브라우저가 직접 클립보드 읽기를 막았어. Ctrl+V를 써봐.', tone: 'error' })
    }
  }, [addPasteLayerFromDataUrl, showSnackbar])

  return {
    addPasteLayerFromDataUrl,
    handleSelectionTransfer,
    handlePasteStoredSelection,
    handleDeleteSelection,
    handleApplyCrop,
    handlePasteFromClipboardButton,
  }
}

function readClipboardBlobAsDataUrl(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read clipboard image'))
    reader.readAsDataURL(file)
  })
}
