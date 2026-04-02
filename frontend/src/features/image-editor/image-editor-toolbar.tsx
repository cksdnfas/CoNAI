import type { ReactNode } from 'react'
import { Brush, ClipboardPaste, Crop, Eraser, FlipHorizontal, Hand, RotateCw, Square, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ImageEditorTool } from './image-editor-types'

interface ImageEditorToolbarProps {
  tool: ImageEditorTool
  enableMaskEditing: boolean
  brushColor: string
  brushSize: number
  historyLength: number
  redoLength: number
  loading: boolean
  hasStoredSelection: boolean
  canApplySelectionOperation: boolean
  canApplyCrop: boolean
  onToolChange: (tool: ImageEditorTool) => void
  onBrushColorChange: (value: string) => void
  onBrushSizeChange: (value: number) => void
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

/** Render the main editor toolbar with tools, history, transform, and selection actions. */
export function ImageEditorToolbar({
  tool,
  enableMaskEditing,
  brushColor,
  brushSize,
  historyLength,
  redoLength,
  loading,
  hasStoredSelection,
  canApplySelectionOperation,
  canApplyCrop,
  onToolChange,
  onBrushColorChange,
  onBrushSizeChange,
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
    </>
  )
}
