import type { RefObject, WheelEvent } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { ImageEditorCanvas } from './image-editor-canvas'
import { ImageEditorLayerPanel } from './image-editor-layer-panel'
import { ImageEditorSessionActions } from './image-editor-session-actions'
import { ImageEditorToolbar } from './image-editor-toolbar'
import type { ImageEditorCropRect, ImageEditorLayer, ImageEditorSavePayload, ImageEditorStroke, ImageEditorTool } from './image-editor-types'

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
    documentGroupRef: RefObject<any>
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
  return (
    <SettingsModal
      open={open}
      onClose={() => {
        if (!saving) {
          onClose()
        }
      }}
      title={title}
      description="Paint-style source and mask editing for img2img and infill."
      widthClassName="max-w-[96vw]"
    >
      <div className="space-y-4">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-4">
            <Card>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-4">
                  <div className="space-y-1">
                    <div className="text-base font-semibold text-foreground">{sourceFileName || 'Editor Session'}</div>
                    <div className="text-xs text-muted-foreground">{sourceSummary.width > 0 ? `${sourceSummary.width} × ${sourceSummary.height}` : 'No image loaded'}</div>
                    {sourceSummary.activeLayerName ? (
                      <div className="text-xs text-muted-foreground">Active layer: {sourceSummary.activeLayerName}{sourceSummary.activeLayerLocked ? ' · Locked' : ''}</div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">Zoom {Math.round(sourceSummary.zoom * 100)}%</Badge>
                    <Badge variant="outline">Rotate {((sourceSummary.rotation % 360) + 360) % 360}°</Badge>
                    {sourceSummary.enableMaskEditing ? <Badge variant={sourceSummary.hasVisibleMask ? 'secondary' : 'outline'}>Mask {sourceSummary.hasVisibleMask ? 'On' : 'Empty'}</Badge> : null}
                  </div>
                </div>

                <ImageEditorToolbar {...toolbar} />
                <ImageEditorCanvas {...canvas} />
              </CardContent>
            </Card>
          </div>

          <div className="min-w-0 space-y-4 xl:sticky xl:top-0 xl:self-start">
            <ImageEditorLayerPanel {...layerPanel} />
            <ImageEditorSessionActions {...sessionActions} />
          </div>
        </div>
      </div>
    </SettingsModal>
  )
}
