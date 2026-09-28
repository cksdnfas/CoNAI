import type { ReactNode } from 'react'
import { ArrowUpFromLine, Brush, BrushCleaning, ClipboardList, ClipboardPaste, Copy, CopyPlus, Crop, Eraser, FlipHorizontal, Hand, Highlighter, Redo2, RotateCw, Scan, Scissors, Square, SquareX, Trash2, Undo2, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Tip } from '@/components/ui/tooltip'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { getImageEditorToolLabel, getImageEditorToolShortcut } from './image-editor-tool-metadata'
import type { ImageEditorTool } from './image-editor-types'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'

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

/** Render one icon toggle for tool selection; the label and shortcut live in the tooltip. */
function ToolButton({ active, children, onClick, label }: { active: boolean; children: ReactNode; onClick: () => void; label: string }) {
  return (
    <IconButton variant="ghost" size="icon-sm" active={active} onClick={onClick} label={label}>
      {children}
    </IconButton>
  )
}

/** Group related toolbar controls on one quiet strip. */
function ToolbarGroup({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-1 border-r border-line pr-2 last:border-r-0">{children}</div>
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
  const { t } = useI18n()
  const toolLabel = (value: ImageEditorTool) => `${t(getImageEditorToolLabel(value))} (${getImageEditorToolShortcut(value)})`
  const selectionDisabled = !canApplySelectionOperation || loading

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ToolbarGroup>
        <ToolButton active={tool === 'pan'} onClick={() => onToolChange('pan')} label={toolLabel('pan')}><Hand className="h-4 w-4" /></ToolButton>
        <ToolButton active={tool === 'select'} onClick={() => onToolChange('select')} label={toolLabel('select')}><Square className="h-4 w-4" /></ToolButton>
        <ToolButton active={tool === 'brush'} onClick={() => onToolChange('brush')} label={toolLabel('brush')}><Brush className="h-4 w-4" /></ToolButton>
        <ToolButton active={tool === 'eraser'} onClick={() => onToolChange('eraser')} label={toolLabel('eraser')}><Eraser className="h-4 w-4" /></ToolButton>
        {enableMaskEditing ? (
          <>
            <ToolButton active={tool === 'mask-brush'} onClick={() => onToolChange('mask-brush')} label={toolLabel('mask-brush')}><Highlighter className="h-4 w-4" /></ToolButton>
            <ToolButton active={tool === 'mask-eraser'} onClick={() => onToolChange('mask-eraser')} label={toolLabel('mask-eraser')}><BrushCleaning className="h-4 w-4" /></ToolButton>
          </>
        ) : null}
        <ToolButton active={tool === 'crop'} onClick={() => onToolChange('crop')} label={toolLabel('crop')}><Crop className="h-4 w-4" /></ToolButton>
      </ToolbarGroup>

      <ToolbarGroup>
        <Tip content={t({ ko: '브러시 색상', en: 'Brush color' })}>
          <Input type="color" aria-label={t({ ko: '브러시 색상', en: 'Brush color' })} value={brushColor} onChange={(event) => onBrushColorChange(event.target.value)} className="h-8 w-10 p-1" />
        </Tip>
        <label className="flex items-center gap-1.5 pl-1 text-xs text-muted-foreground">
          {t({ ko: '브러시 크기', en: 'Brush size' })}
          <NumberStepperInput min={1} max={256} value={brushSize} onValueCommit={(nextValue) => onBrushSizeChange(Math.max(1, Number(nextValue) || 1))} className="h-8 w-20" />
        </label>
        <label className="flex items-center gap-1.5 pl-1 text-xs text-muted-foreground">
          {t({ ko: '불투명도', en: 'Opacity' })}
          <NumberStepperInput min={0} max={100} value={brushOpacity} onValueCommit={(nextValue) => onBrushOpacityChange(Math.max(0, Math.min(100, Number(nextValue) || 0)))} className="h-8 w-20" />
        </label>
      </ToolbarGroup>

      <ToolbarGroup>
        <IconButton variant="ghost" size="icon-sm" onClick={onUndo} disabled={historyLength <= 1 || loading} label={t({ ko: '실행 취소', en: 'Undo' })}><Undo2 className="h-4 w-4" /></IconButton>
        <IconButton variant="ghost" size="icon-sm" onClick={onRedo} disabled={redoLength === 0 || loading} label={t({ ko: '다시 실행', en: 'Redo' })}><Redo2 className="h-4 w-4" /></IconButton>
        <IconButton variant="ghost" size="icon-sm" onClick={onZoomOut} label={t({ ko: '축소', en: 'Zoom out' })}><ZoomOut className="h-4 w-4" /></IconButton>
        <IconButton variant="ghost" size="icon-sm" onClick={onZoomIn} label={t({ ko: '확대', en: 'Zoom in' })}><ZoomIn className="h-4 w-4" /></IconButton>
        <IconButton variant="ghost" size="icon-sm" onClick={onFitToScreen} label={t({ ko: '맞춤', en: 'Fit' })}><Scan className="h-4 w-4" /></IconButton>
        <IconButton variant="ghost" size="icon-sm" onClick={onRotate} label={t({ ko: '회전', en: 'Rotate' })}><RotateCw className="h-4 w-4" /></IconButton>
        <IconButton variant="ghost" size="icon-sm" onClick={onFlip} label={t({ ko: '뒤집기', en: 'Flip' })}><FlipHorizontal className="h-4 w-4" /></IconButton>
      </ToolbarGroup>

      <ToolbarGroup>
        <IconButton variant="ghost" size="icon-sm" onClick={onPasteFromClipboard} label={t({ ko: '붙여넣기', en: 'Paste' })}><ClipboardPaste className="h-4 w-4" /></IconButton>
        <IconButton variant="ghost" size="icon-sm" onClick={onPasteStoredSelection} disabled={!hasStoredSelection || loading} label={t({ ko: '선택 붙여넣기', en: 'Paste selection' })}><ClipboardList className="h-4 w-4" /></IconButton>
        <IconButton variant="ghost" size="icon-sm" onClick={onSelectionCopy} disabled={selectionDisabled} label={t({ ko: '선택 복사', en: 'Copy selection' })}><Copy className="h-4 w-4" /></IconButton>
        <IconButton variant="ghost" size="icon-sm" onClick={onSelectionCut} disabled={selectionDisabled} label={t({ ko: '선택 잘라내기', en: 'Cut selection' })}><Scissors className="h-4 w-4" /></IconButton>
        <IconButton variant="ghost" size="icon-sm" onClick={onSelectionDuplicate} disabled={selectionDisabled} label={t({ ko: '선택 복제', en: 'Duplicate selection' })}><CopyPlus className="h-4 w-4" /></IconButton>
        <IconButton variant="ghost" size="icon-sm" onClick={onSelectionPromote} disabled={selectionDisabled} label={t({ ko: '선택 올리기', en: 'Promote selection' })}><ArrowUpFromLine className="h-4 w-4" /></IconButton>
        <IconButton variant="ghost" size="icon-sm" onClick={onSelectionDelete} disabled={selectionDisabled} label={t({ ko: '선택 삭제', en: 'Delete selection' })}><Trash2 className="h-4 w-4" /></IconButton>
      </ToolbarGroup>

      {enableMaskEditing && onClearMask ? (
        <IconButton variant="ghost" size="icon-sm" onClick={onClearMask} label={t({ ko: '마스크 지우기', en: 'Clear mask' })}><SquareX className="h-4 w-4" /></IconButton>
      ) : null}
      {canApplyCrop ? (
        <Button type="button" size="sm" onClick={onApplyCrop} disabled={loading}>
          <Crop className="h-4 w-4" /> {t({ ko: '자르기 적용', en: 'Apply crop' })}
        </Button>
      ) : null}
    </div>
  )
}
