import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { ImageEditorLayer, ImageEditorTool } from './image-editor-types'
import { createImageEditorId, loadEditorImage, renderImageEditorLayerCanvas, renderImageEditorSourceCanvas } from './image-editor-utils'

/** Own layer-panel actions and session-level merge/flatten/clear handlers for the image editor. */
export function useImageEditorLayerSessionActions({
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
  createDrawLayer,
  showSnackbar,
}: {
  baseImage: HTMLImageElement | null
  documentSize: { width: number; height: number }
  layers: ImageEditorLayer[]
  activeLayerId: string | null
  activeLayer: ImageEditorLayer | null
  queueHistoryCommit: () => void
  setLoading: Dispatch<SetStateAction<boolean>>
  setBaseImage: Dispatch<SetStateAction<HTMLImageElement | null>>
  setBaseImageDataUrl: Dispatch<SetStateAction<string | null>>
  setLayers: Dispatch<SetStateAction<ImageEditorLayer[]>>
  setActiveLayerId: Dispatch<SetStateAction<string | null>>
  setSelectionRect: Dispatch<SetStateAction<{ x: number; y: number; width: number; height: number } | null>>
  setCropRect: Dispatch<SetStateAction<{ x: number; y: number; width: number; height: number } | null>>
  setTool: Dispatch<SetStateAction<ImageEditorTool>>
  createDrawLayer: (index: number) => Extract<ImageEditorLayer, { type: 'draw' }>
  showSnackbar: (input: { message: string; tone: 'info' | 'error' }) => void
}) {
  const visibleLayerCount = layers.filter((layer) => layer.visible).length
  const activeLayerIndex = activeLayerId ? layers.findIndex((layer) => layer.id === activeLayerId) : -1
  const activeDrawLayer = activeLayer?.type === 'draw' ? activeLayer : null
  const canMergeVisible = visibleLayerCount > 1
  const canFlattenVisible = Boolean(baseImage && visibleLayerCount > 0)
  const canClearActiveDrawLayer = Boolean(activeDrawLayer && activeDrawLayer.lines.length > 0)
  const canMergeActiveLayerDown = activeLayerIndex > 0

  /** Add one empty draw layer above the current stack and activate it. */
  const handleAddLayer = useCallback(() => {
    const nextLayer = createDrawLayer(layers.filter((layer) => layer.type === 'draw').length + 1)
    setLayers((current) => [...current, nextLayer])
    setActiveLayerId(nextLayer.id)
    queueHistoryCommit()
  }, [createDrawLayer, layers, queueHistoryCommit, setActiveLayerId, setLayers])

  /** Rename one layer without immediately changing history semantics. */
  const handleRenameLayer = useCallback((layerId: string, name: string) => {
    setLayers((current) => current.map((currentLayer) => currentLayer.id === layerId ? { ...currentLayer, name } : currentLayer))
  }, [setLayers])

  /** Toggle visibility on one layer and commit that document change. */
  const handleToggleLayerVisible = useCallback((layerId: string) => {
    setLayers((current) => current.map((currentLayer) => currentLayer.id === layerId ? { ...currentLayer, visible: !currentLayer.visible } : currentLayer))
    queueHistoryCommit()
  }, [queueHistoryCommit, setLayers])

  /** Toggle lock state on one layer and commit that document change. */
  const handleToggleLayerLocked = useCallback((layerId: string) => {
    setLayers((current) => current.map((currentLayer) => currentLayer.id === layerId ? { ...currentLayer, locked: !currentLayer.locked } : currentLayer))
    queueHistoryCommit()
  }, [queueHistoryCommit, setLayers])

  /** Move one selected layer up or down inside the current stack. */
  const handleMoveLayer = useCallback((layerId: string, direction: -1 | 1) => {
    setLayers((current) => {
      const index = current.findIndex((layer) => layer.id === layerId)
      if (index < 0) {
        return current
      }

      const nextIndex = index + direction
      if (nextIndex < 0 || nextIndex >= current.length) {
        return current
      }

      const next = [...current]
      const [movedLayer] = next.splice(index, 1)
      next.splice(nextIndex, 0, movedLayer)
      return next
    })
    queueHistoryCommit()
  }, [queueHistoryCommit, setLayers])

  /** Duplicate one layer in place as a new editable layer copy. */
  const handleDuplicateLayer = useCallback((layerId: string) => {
    const sourceLayer = layers.find((layer) => layer.id === layerId)
    if (!sourceLayer) {
      return
    }

    const duplicatedLayer: ImageEditorLayer = sourceLayer.type === 'draw'
      ? {
          ...sourceLayer,
          id: createImageEditorId('draw-layer'),
          name: `${sourceLayer.name} Copy`,
          lines: sourceLayer.lines.map((line) => ({ ...line, id: createImageEditorId('stroke') })),
        }
      : {
          ...sourceLayer,
          id: createImageEditorId('paste-layer'),
          name: `${sourceLayer.name} Copy`,
          x: Math.max(0, Math.min(sourceLayer.x + 16, documentSize.width - sourceLayer.width)),
          y: Math.max(0, Math.min(sourceLayer.y + 16, documentSize.height - sourceLayer.height)),
        }

    setLayers((current) => {
      const sourceIndex = current.findIndex((layer) => layer.id === layerId)
      if (sourceIndex < 0) {
        return current
      }

      const nextLayers = [...current]
      nextLayers.splice(sourceIndex + 1, 0, duplicatedLayer)
      return nextLayers
    })
    setActiveLayerId(duplicatedLayer.id)
    queueHistoryCommit()
    showSnackbar({ message: `${sourceLayer.name} 레이어를 복제했어.`, tone: 'info' })
  }, [documentSize.height, documentSize.width, layers, queueHistoryCommit, setActiveLayerId, setLayers, showSnackbar])

  /** Delete one layer from the current stack and commit that document change. */
  const handleDeleteLayer = useCallback((layerId: string) => {
    setLayers((current) => current.filter((currentLayer) => currentLayer.id !== layerId))
    queueHistoryCommit()
  }, [queueHistoryCommit, setLayers])

  /** Merge all currently visible layers into one new paste layer while preserving hidden layers. */
  const handleMergeVisible = useCallback(async () => {
    const visibleLayers = layers.filter((layer) => layer.visible)
    if (visibleLayers.length <= 1) {
      return
    }

    if (visibleLayers.some((layer) => layer.locked)) {
      showSnackbar({ message: '잠긴 보이는 레이어는 전체 병합할 수 없어.', tone: 'error' })
      return
    }

    try {
      setLoading(true)
      const mergedCanvas = await renderImageEditorLayerCanvas({
        documentWidth: documentSize.width,
        documentHeight: documentSize.height,
        layers: visibleLayers,
      })

      const firstVisibleIndex = layers.findIndex((layer) => layer.visible)
      const mergedLayer: Extract<ImageEditorLayer, { type: 'paste' }> = {
        id: createImageEditorId('paste-layer'),
        type: 'paste',
        name: 'Merged Visible',
        visible: true,
        locked: false,
        imageDataUrl: mergedCanvas.toDataURL('image/png'),
        x: 0,
        y: 0,
        width: documentSize.width,
        height: documentSize.height,
      }

      setLayers((current) => current.flatMap((layer, index) => {
        if (index === firstVisibleIndex) {
          return [mergedLayer]
        }

        return layer.visible ? [] : [layer]
      }))
      setActiveLayerId(mergedLayer.id)
      queueHistoryCommit()
      showSnackbar({ message: '보이는 레이어를 하나로 병합했어.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : '보이는 레이어를 병합하지 못했어.', tone: 'error' })
    } finally {
      setLoading(false)
    }
  }, [documentSize.height, documentSize.width, layers, queueHistoryCommit, setActiveLayerId, setLayers, setLoading, showSnackbar])

  /** Flatten the currently visible source composition into a new base image. */
  const handleFlattenVisible = useCallback(async () => {
    if (!baseImage) {
      return
    }

    try {
      setLoading(true)
      const flattenedSourceCanvas = await renderImageEditorSourceCanvas({
        baseImage,
        documentWidth: documentSize.width,
        documentHeight: documentSize.height,
        layers,
      })
      const nextBaseImageDataUrl = flattenedSourceCanvas.toDataURL('image/png')
      const nextBaseImage = await loadEditorImage(nextBaseImageDataUrl)
      const firstLayer = createDrawLayer(1)
      setBaseImage(nextBaseImage)
      setBaseImageDataUrl(nextBaseImageDataUrl)
      setLayers([firstLayer])
      setActiveLayerId(firstLayer.id)
      setSelectionRect(null)
      setCropRect(null)
      queueHistoryCommit()
      showSnackbar({ message: '보이는 결과를 새 베이스로 평탄화했어.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : '보이는 레이어를 평탄화하지 못했어.', tone: 'error' })
    } finally {
      setLoading(false)
    }
  }, [baseImage, createDrawLayer, documentSize.height, documentSize.width, layers, queueHistoryCommit, setActiveLayerId, setBaseImage, setBaseImageDataUrl, setCropRect, setLayers, setLoading, setSelectionRect, showSnackbar])

  /** Merge the active layer into the layer immediately below it. */
  const handleMergeActiveLayerDown = useCallback(async () => {
    if (!activeLayerId) {
      return
    }

    const activeIndex = layers.findIndex((layer) => layer.id === activeLayerId)
    if (activeIndex <= 0) {
      return
    }

    const lowerLayer = layers[activeIndex - 1]
    const currentLayer = layers[activeIndex]
    if (!lowerLayer || !currentLayer) {
      return
    }

    if (lowerLayer.locked || currentLayer.locked) {
      showSnackbar({ message: '잠긴 레이어는 병합할 수 없어.', tone: 'error' })
      return
    }

    try {
      setLoading(true)
      const mergedCanvas = await renderImageEditorLayerCanvas({
        documentWidth: documentSize.width,
        documentHeight: documentSize.height,
        layers: [lowerLayer, currentLayer],
      })

      const mergedLayer: Extract<ImageEditorLayer, { type: 'paste' }> = {
        id: createImageEditorId('paste-layer'),
        type: 'paste',
        name: `${lowerLayer.name} + ${currentLayer.name}`,
        visible: lowerLayer.visible || currentLayer.visible,
        locked: false,
        imageDataUrl: mergedCanvas.toDataURL('image/png'),
        x: 0,
        y: 0,
        width: documentSize.width,
        height: documentSize.height,
      }

      setLayers((current) => {
        const nextLayers = [...current]
        nextLayers.splice(activeIndex - 1, 2, mergedLayer)
        return nextLayers
      })
      setActiveLayerId(mergedLayer.id)
      queueHistoryCommit()
      showSnackbar({ message: '활성 레이어를 아래 레이어와 병합했어.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : '레이어를 병합하지 못했어.', tone: 'error' })
    } finally {
      setLoading(false)
    }
  }, [activeLayerId, documentSize.height, documentSize.width, layers, queueHistoryCommit, setActiveLayerId, setLayers, setLoading, showSnackbar])

  /** Clear only the current active draw layer. */
  const handleClearActiveDrawLayer = useCallback(() => {
    setLayers((current) => current.map((layer) => layer.id === activeLayerId && layer.type === 'draw' ? { ...layer, lines: [] } : layer))
    queueHistoryCommit()
  }, [activeLayerId, queueHistoryCommit, setLayers])

  /** Clear every draw layer in the current session. */
  const handleClearAllDrawLayers = useCallback(() => {
    setLayers((current) => current.map((layer) => layer.type === 'draw' ? { ...layer, lines: [] } : layer))
    queueHistoryCommit()
  }, [queueHistoryCommit, setLayers])

  /** Cancel crop mode and fall back to the default brush tool. */
  const handleCancelCrop = useCallback(() => {
    setCropRect(null)
    setTool('brush')
  }, [setCropRect, setTool])

  return {
    canMergeVisible,
    canFlattenVisible,
    canClearActiveDrawLayer,
    canMergeActiveLayerDown,
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
  }
}
