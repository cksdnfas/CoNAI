import type { RefObject, WheelEvent } from 'react'
import type Konva from 'konva'
import { Button } from '@/components/ui/button'
import { Heading } from '@/components/ui/heading'
import { Panel } from '@/components/ui/panel'
import { useI18n } from '@/i18n'
import { Modal } from '@/components/ui/modal'
import { ImageEditorCanvas } from './image-editor-canvas'
import { ImageEditorLayerPanel } from './image-editor-layer-panel'
import { ImageEditorSessionActions } from './image-editor-session-actions'
import { ImageEditorToolbar } from './image-editor-toolbar'
import type { ImageEditorCropRect, ImageEditorLayer, ImageEditorStroke, ImageEditorTool } from './image-editor-types'

type ImageEditorModalLayoutProps = {
  open: boolean
  saving: boolean
  title: string
  sourceFileName?: string
  onClose: () => void
  onSave: () => void
  sourceSummary: {
    width: number
    height: number
    activeLayerName: string | null
    activeLayerLocked: boolean
    zoom: number
    rotation: number
    enableMaskEditing: boolean
    hasVisibleMask: boolean
  }
  toolbar: {
    tool: ImageEditorTool
    enableMaskEditing: boolean
    brushColor: string
    brushSize: number
    brushOpacity: number
    historyLength: number
    redoLength: number
    loading: boolean
    hasStoredSelection: boolean
    canApplySelectionOperation: boolean
    canApplyCrop: boolean
    onToolChange: (tool: ImageEditorTool) => void
    onBrushColorChange: (value: string) => void
    onBrushSizeChange: (value: number) => void
    onBrushOpacityChange: (value: number) => void
    onUndo: () => void
    onRedo: () => void
    onZoomOut: () => void
    onZoomIn: () => void
    onFitToScreen: () => void
    onRotate: () => void
    onFlip: () => void
    onPasteFromClipboard: () => void
    onPasteStoredSelection: () => void
    onSelectionCopy: () => void
    onSelectionPromote: () => void
    onSelectionDuplicate: () => void
    onSelectionDelete: () => void
    onSelectionCut: () => void
    onClearMask?: () => void
    onApplyCrop: () => void
  }
  canvas: {
    viewportRef: RefObject<HTMLDivElement | null>
    documentGroupRef: RefObject<Konva.Group | null>
    baseImage: HTMLImageElement | null
    loading: boolean
    viewportSize: { width: number; height: number }
    documentSize: { width: number; height: number }
    pan: { x: number; y: number }
    zoom: number
    rotation: number
    flippedX: boolean
    layers: ImageEditorLayer[]
    activeLayerId: string | null
    tool: ImageEditorTool
    brushPreviewPoint: { x: number; y: number } | null
    brushSize: number
    brushOpacity: number
    enableMaskEditing: boolean
    maskPreviewSurface: HTMLCanvasElement | null
    maskStrokes: ImageEditorStroke[]
    normalizedSelectionRect: ImageEditorCropRect | null
    normalizedCropRect: ImageEditorCropRect | null
    selectionHandleSize: number
    onWheel: (event: WheelEvent<HTMLDivElement>) => void
    onStagePointerDown: () => void
    onStagePointerMove: () => void
    onStagePointerUp: () => void
    onMovePasteLayer: (layerId: string, nextX: number, nextY: number) => void
  }
  layerPanel: {
    layers: ImageEditorLayer[]
    activeLayerId: string | null
    loading: boolean
    enableMaskEditing: boolean
    hasVisibleMask: boolean
    onAddLayer: () => void
    onSetActiveLayerId: (layerId: string) => void
    onRenameLayer: (layerId: string, name: string) => void
    onCommitRename: () => void
    onToggleLayerVisible: (layerId: string) => void
    onToggleLayerLocked: (layerId: string) => void
    onMoveLayer: (layerId: string, direction: -1 | 1) => void
    onDuplicateLayer: (layerId: string) => void
    onMergeLayerDown: () => void
    onDeleteLayer: (layerId: string) => void
  }
  sessionActions: {
    canMergeVisible: boolean
    canFlattenVisible: boolean
    canClearActiveDrawLayer: boolean
    hasSelectionRect: boolean
    selectionRect: ImageEditorCropRect | null
    cropRect: ImageEditorCropRect | null
    saving: boolean
    loading: boolean
    canSave: boolean
    onMergeVisible: () => void
    onFlattenVisible: () => void
    onClearActiveDrawLayer: () => void
    onClearAllDrawLayers: () => void
    onClearSelection: () => void
    onSelectionRectFieldChange: (field: 'x' | 'y' | 'width' | 'height', value: number) => void
    onCropRectFieldChange: (field: 'x' | 'y' | 'width' | 'height', value: number) => void
    onCancelCrop: () => void
    onClose: () => void
    onSave: () => void
  }
}

/** Render the modal shell, editor layout, and panel composition for the image editor. */
export function ImageEditorModalLayout({
  open,
  saving,
  title,
  sourceFileName,
  onClose,
  sourceSummary,
  toolbar,
  canvas,
  layerPanel,
  sessionActions,
}: ImageEditorModalLayoutProps) {
  const { t } = useI18n()

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!saving) {
          onClose()
        }
      }}
      title={title}
      widthClassName="max-w-[96vw]"
    >
      <div className="space-y-4">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-4">
            <Panel tone="low" className="space-y-4">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                  <Heading level={3} className="min-w-0 truncate">{sourceFileName || t({ ko: '편집 세션', en: 'Editor Session' })}</Heading>
                  <div className="text-xs text-muted-foreground">
                    {sourceSummary.width > 0 ? `${sourceSummary.width} × ${sourceSummary.height}` : t({ ko: '불러온 이미지가 없어.', en: 'No image loaded' })}
                    {((sourceSummary.rotation % 360) + 360) % 360 !== 0 ? <>{' · '}{t({ ko: '회전 {value}°', en: 'Rotate {value}°' }, { value: ((sourceSummary.rotation % 360) + 360) % 360 })}</> : null}
                  </div>
                </div>

                <ImageEditorToolbar {...toolbar} />
                <ImageEditorCanvas {...canvas} />
            </Panel>
          </div>

          <div className="min-w-0 space-y-4 xl:sticky xl:top-0 xl:self-start">
            <ImageEditorLayerPanel {...layerPanel} />
            <ImageEditorSessionActions {...sessionActions} />
          </div>
        </div>

        {/* Below xl the side panel stacks under the tall canvas, so keep the primary actions pinned to the modal bottom. */}
        <div className="sticky bottom-0 z-10 flex gap-2 bg-background/96 py-3 backdrop-blur xl:hidden">
          <Button type="button" variant="secondary" className="flex-1" onClick={sessionActions.onClose} disabled={sessionActions.saving}>
            {t({ ko: '취소', en: 'Cancel' })}
          </Button>
          <Button type="button" className="flex-1" onClick={sessionActions.onSave} disabled={!sessionActions.canSave || sessionActions.saving || sessionActions.loading}>
            {sessionActions.saving ? t({ ko: '저장 중…', en: 'Saving…' }) : t({ ko: '저장', en: 'Save' })}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
