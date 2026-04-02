import type { ReactNode } from 'react'
import { Brush, ClipboardPaste, Crop, Eraser, FlipHorizontal, Hand, RotateCw, Square, ZoomIn, ZoomOut } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ImageEditorTool } from './image-editor-types'

interface ImageEditorToolbarProps {
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

/** Render one simple button row item for tool selection. */
function ToolButton({ active, children, onClick, title }: { active?: boolean; children: ReactNode; onClick: () => void; title: string }) {
  return (
    <Button type="button" variant={active ? 'default' : 'secondary'} size="sm" onClick={onClick} title={title}>
      {children}
    </Button>
  )
}

function getImageEditorToolShortcut(tool: ImageEditorTool) {
  switch (tool) {
    case 'pan':
      return 'H'
    case 'select':
      return 'S'
    case 'brush':
      return 'B'
    case 'eraser':
      return 'E'
    case 'mask-brush':
      return 'M'
    case 'mask-eraser':
      return 'Shift+M'
    case 'crop':
      return 'C'
    default:
      return '-'
  }
}

function getImageEditorToolHint(tool: ImageEditorTool) {
  switch (tool) {
    case 'pan':
      return 'Drag the view to inspect details.'
    case 'select':
      return 'Create, move, or resize a selection rectangle.'
    case 'brush':
      return 'Paint on the active draw layer.'
    case 'eraser':
      return 'Erase content from the active draw layer.'
    case 'mask-brush':
      return 'Paint white editable infill regions into the mask.'
    case 'mask-eraser':
      return 'Remove white regions from the mask.'
    case 'crop':
      return 'Drag a crop area, then apply it.'
    default:
      return ''
  }
}

/** Render the main editor toolbar with tools, history, transform, and selection actions. */
export function ImageEditorToolbar({
  tool,
  enableMaskEditing,
  brushColor,
  brushSize,
  brushOpacity,
  historyLength,
  redoLength,
  loading,
  hasStoredSelection,
  canApplySelectionOperation,
  canApplyCrop,
  onToolChange,
  onBrushColorChange,
  onBrushSizeChange,
  onBrushOpacityChange,
  onUndo,
  onRedo,
  onZoomOut,
  onZoomIn,
  onFitToScreen,
  onRotate,
  onFlip,
  onPasteFromClipboard,
  onPasteStoredSelection,
  onSelectionCopy,
  onSelectionPromote,
  onSelectionDuplicate,
  onSelectionDelete,
  onSelectionCut,
  onClearMask,
  onApplyCrop,
}: ImageEditorToolbarProps) {
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <ToolButton active={tool === 'pan'} onClick={() => onToolChange('pan')} title="Pan">
          <Hand className="h-4 w-4" /> Pan
        </ToolButton>
        <ToolButton active={tool === 'select'} onClick={() => onToolChange('select')} title="Select">
          <Square className="h-4 w-4" /> Select
        </ToolButton>
        <ToolButton active={tool === 'brush'} onClick={() => onToolChange('brush')} title="Brush">
          <Brush className="h-4 w-4" /> Brush
        </ToolButton>
        <ToolButton active={tool === 'eraser'} onClick={() => onToolChange('eraser')} title="Eraser">
          <Eraser className="h-4 w-4" /> Eraser
        </ToolButton>
        {enableMaskEditing ? (
          <>
            <ToolButton active={tool === 'mask-brush'} onClick={() => onToolChange('mask-brush')} title="Mask Brush">
              <Brush className="h-4 w-4" /> Mask
            </ToolButton>
            <ToolButton active={tool === 'mask-eraser'} onClick={() => onToolChange('mask-eraser')} title="Mask Eraser">
              <Eraser className="h-4 w-4" /> Mask Erase
            </ToolButton>
          </>
        ) : null}
        <ToolButton active={tool === 'crop'} onClick={() => onToolChange('crop')} title="Crop">
          <Crop className="h-4 w-4" /> Crop
        </ToolButton>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1 text-xs text-muted-foreground">
          Brush color
          <Input type="color" value={brushColor} onChange={(event) => onBrushColorChange(event.target.value)} className="h-10 w-16 p-1" />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Brush size
          <Input type="number" min={1} max={256} value={brushSize} onChange={(event) => onBrushSizeChange(Math.max(1, Number(event.target.value) || 1))} className="w-24" />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Opacity
          <Input type="number" min={0} max={100} value={brushOpacity} onChange={(event) => onBrushOpacityChange(Math.max(0, Math.min(100, Number(event.target.value) || 0)))} className="w-24" />
        </label>
        <Button type="button" variant="secondary" size="sm" onClick={onUndo} disabled={historyLength <= 1 || loading}>
          Undo
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onRedo} disabled={redoLength === 0 || loading}>
          Redo
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onZoomOut}>
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onZoomIn}>
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onFitToScreen}>
          Fit
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onRotate}>
          <RotateCw className="h-4 w-4" /> Rotate
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onFlip}>
          <FlipHorizontal className="h-4 w-4" /> Flip
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onPasteFromClipboard}>
          <ClipboardPaste className="h-4 w-4" /> Paste
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onPasteStoredSelection} disabled={!hasStoredSelection || loading}>
          Paste Sel
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onSelectionCopy} disabled={!canApplySelectionOperation || loading}>
          Copy Sel
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onSelectionPromote} disabled={!canApplySelectionOperation || loading}>
          Promote Sel
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onSelectionDuplicate} disabled={!canApplySelectionOperation || loading}>
          Duplicate Sel
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onSelectionDelete} disabled={!canApplySelectionOperation || loading}>
          Delete Sel
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onSelectionCut} disabled={!canApplySelectionOperation || loading}>
          Cut Sel
        </Button>
        {enableMaskEditing && onClearMask ? (
          <Button type="button" variant="secondary" size="sm" onClick={onClearMask}>
            Clear Mask
          </Button>
        ) : null}
        <Button type="button" variant="secondary" size="sm" onClick={onApplyCrop} disabled={!canApplyCrop || loading}>
          Apply Crop
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-sm border border-border/70 bg-surface-low px-3 py-2 text-xs text-muted-foreground">
        <Badge variant="outline">Tool {tool}</Badge>
        <span>Shortcut {getImageEditorToolShortcut(tool)}</span>
        <span>•</span>
        <span>{getImageEditorToolHint(tool)}</span>
        <span>•</span>
        <span>Brush [ ]</span>
        <span>•</span>
        <span>Opacity {brushOpacity}%</span>
        {(tool === 'mask-brush' || tool === 'mask-eraser') ? (
          <>
            <span>•</span>
            <span>White adds editable area</span>
          </>
        ) : null}
        <span>•</span>
        <span>Esc clears selection/crop</span>
      </div>
    </>
  )
}
