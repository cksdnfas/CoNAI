import type { ReactNode } from 'react'
import { Brush, ClipboardPaste, Crop, Eraser, FlipHorizontal, Hand, RotateCw, Square, ZoomIn, ZoomOut } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n, type TranslationDictionary } from '@/i18n'
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

/** Render one labeled toolbar section so related actions stay grouped. */
function ToolbarSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-sm border border-border/70 bg-surface-low px-3 py-2">
      <div className="mr-2 min-w-[72px] text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="flex flex-wrap items-end gap-2">{children}</div>
    </div>
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

function getImageEditorToolLabel(tool: ImageEditorTool): TranslationDictionary {
  switch (tool) {
    case 'pan':
      return { ko: '이동', en: 'Pan' }
    case 'select':
      return { ko: '선택', en: 'Select' }
    case 'brush':
      return { ko: '브러시', en: 'Brush' }
    case 'eraser':
      return { ko: '지우개', en: 'Eraser' }
    case 'mask-brush':
      return { ko: '마스크', en: 'Mask' }
    case 'mask-eraser':
      return { ko: '마스크 지우기', en: 'Mask erase' }
    case 'crop':
      return { ko: '자르기', en: 'Crop' }
    default:
      return { ko: '-', en: '-' }
  }
}

function getImageEditorToolHint(tool: ImageEditorTool): TranslationDictionary {
  switch (tool) {
    case 'pan':
      return { ko: '보기를 드래그해서 세부 영역을 확인해.', en: 'Drag the view to inspect details.' }
    case 'select':
      return { ko: '선택 영역을 만들고, 이동하거나 크기를 조절해.', en: 'Create, move, or resize a selection rectangle.' }
    case 'brush':
      return { ko: '현재 드로우 레이어에 칠해.', en: 'Paint on the active draw layer.' }
    case 'eraser':
      return { ko: '현재 드로우 레이어의 내용을 지워.', en: 'Erase content from the active draw layer.' }
    case 'mask-brush':
      return { ko: '마스크에 흰색 편집 가능 영역을 칠해.', en: 'Paint white editable infill regions into the mask.' }
    case 'mask-eraser':
      return { ko: '마스크의 흰색 영역을 지워.', en: 'Remove white regions from the mask.' }
    case 'crop':
      return { ko: '자르기 영역을 드래그한 다음 적용해.', en: 'Drag a crop area, then apply it.' }
    default:
      return { ko: '', en: '' }
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
  const { t } = useI18n()

  return (
    <div className="space-y-3">
      <ToolbarSection label={t({ ko: '도구', en: 'Tools' })}>
        <ToolButton active={tool === 'pan'} onClick={() => onToolChange('pan')} title={t(getImageEditorToolLabel('pan'))}>
          <Hand className="h-4 w-4" /> {t(getImageEditorToolLabel('pan'))}
        </ToolButton>
        <ToolButton active={tool === 'select'} onClick={() => onToolChange('select')} title={t(getImageEditorToolLabel('select'))}>
          <Square className="h-4 w-4" /> {t(getImageEditorToolLabel('select'))}
        </ToolButton>
        <ToolButton active={tool === 'brush'} onClick={() => onToolChange('brush')} title={t(getImageEditorToolLabel('brush'))}>
          <Brush className="h-4 w-4" /> {t(getImageEditorToolLabel('brush'))}
        </ToolButton>
        <ToolButton active={tool === 'eraser'} onClick={() => onToolChange('eraser')} title={t(getImageEditorToolLabel('eraser'))}>
          <Eraser className="h-4 w-4" /> {t(getImageEditorToolLabel('eraser'))}
        </ToolButton>
        {enableMaskEditing ? (
          <>
            <ToolButton active={tool === 'mask-brush'} onClick={() => onToolChange('mask-brush')} title={t({ ko: '마스크 브러시', en: 'Mask brush' })}>
              <Brush className="h-4 w-4" /> {t(getImageEditorToolLabel('mask-brush'))}
            </ToolButton>
            <ToolButton active={tool === 'mask-eraser'} onClick={() => onToolChange('mask-eraser')} title={t({ ko: '마스크 지우개', en: 'Mask eraser' })}>
              <Eraser className="h-4 w-4" /> {t(getImageEditorToolLabel('mask-eraser'))}
            </ToolButton>
          </>
        ) : null}
        <ToolButton active={tool === 'crop'} onClick={() => onToolChange('crop')} title={t(getImageEditorToolLabel('crop'))}>
          <Crop className="h-4 w-4" /> {t(getImageEditorToolLabel('crop'))}
        </ToolButton>
      </ToolbarSection>

      <div className="flex flex-wrap gap-3">
        <ToolbarSection label={t({ ko: '브러시', en: 'Brush' })}>
          <label className="space-y-1 text-xs text-muted-foreground">
            {t({ ko: '브러시 색상', en: 'Brush color' })}
            <Input type="color" value={brushColor} onChange={(event) => onBrushColorChange(event.target.value)} className="h-10 w-16 p-1" />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            {t({ ko: '브러시 크기', en: 'Brush size' })}
            <Input type="number" min={1} max={256} value={brushSize} onChange={(event) => onBrushSizeChange(Math.max(1, Number(event.target.value) || 1))} className="w-24" />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            {t({ ko: '불투명도', en: 'Opacity' })}
            <Input type="number" min={0} max={100} value={brushOpacity} onChange={(event) => onBrushOpacityChange(Math.max(0, Math.min(100, Number(event.target.value) || 0)))} className="w-24" />
          </label>
        </ToolbarSection>

        <ToolbarSection label={t({ ko: '보기', en: 'View' })}>
          <Button type="button" variant="secondary" size="sm" onClick={onUndo} disabled={historyLength <= 1 || loading}>
            {t({ ko: '실행 취소', en: 'Undo' })}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={onRedo} disabled={redoLength === 0 || loading}>
            {t({ ko: '다시 실행', en: 'Redo' })}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={onZoomOut}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={onZoomIn}>
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={onFitToScreen}>
            {t({ ko: '맞춤', en: 'Fit' })}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={onRotate}>
            <RotateCw className="h-4 w-4" /> {t({ ko: '회전', en: 'Rotate' })}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={onFlip}>
            <FlipHorizontal className="h-4 w-4" /> {t({ ko: '뒤집기', en: 'Flip' })}
          </Button>
        </ToolbarSection>

        <ToolbarSection label={t({ ko: '선택', en: 'Selection' })}>
          <Button type="button" variant="secondary" size="sm" onClick={onPasteFromClipboard}>
            <ClipboardPaste className="h-4 w-4" /> {t({ ko: '붙여넣기', en: 'Paste' })}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={onPasteStoredSelection} disabled={!hasStoredSelection || loading}>
            {t({ ko: '선택 붙여넣기', en: 'Paste selection' })}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={onSelectionCopy} disabled={!canApplySelectionOperation || loading}>
            {t({ ko: '선택 복사', en: 'Copy selection' })}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={onSelectionCut} disabled={!canApplySelectionOperation || loading}>
            {t({ ko: '선택 잘라내기', en: 'Cut selection' })}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={onSelectionDuplicate} disabled={!canApplySelectionOperation || loading}>
            {t({ ko: '선택 복제', en: 'Duplicate selection' })}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={onSelectionPromote} disabled={!canApplySelectionOperation || loading}>
            {t({ ko: '선택 올리기', en: 'Promote selection' })}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={onSelectionDelete} disabled={!canApplySelectionOperation || loading}>
            {t({ ko: '선택 삭제', en: 'Delete selection' })}
          </Button>
        </ToolbarSection>
      </div>

      {(enableMaskEditing && onClearMask) || canApplyCrop ? (
        <ToolbarSection label={t({ ko: '컨텍스트', en: 'Context' })}>
          {enableMaskEditing && onClearMask ? (
            <Button type="button" variant="secondary" size="sm" onClick={onClearMask}>
              {t({ ko: '마스크 지우기', en: 'Clear mask' })}
            </Button>
          ) : null}
          {canApplyCrop ? (
            <Button type="button" variant="secondary" size="sm" onClick={onApplyCrop} disabled={loading}>
              {t({ ko: '자르기 적용', en: 'Apply crop' })}
            </Button>
          ) : null}
        </ToolbarSection>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 rounded-sm border border-border/70 bg-surface-low px-3 py-2 text-xs text-muted-foreground">
        <Badge variant="outline">{t({ ko: '도구', en: 'Tool' })} {t(getImageEditorToolLabel(tool))}</Badge>
        <span>{t({ ko: '단축키', en: 'Shortcut' })} {getImageEditorToolShortcut(tool)}</span>
        <span>•</span>
        <span>{t(getImageEditorToolHint(tool))}</span>
        <span>•</span>
        <span>{t({ ko: '브러시', en: 'Brush' })} [ ]</span>
        <span>•</span>
        <span>{t({ ko: '불투명도', en: 'Opacity' })} {brushOpacity}%</span>
        {(tool === 'mask-brush' || tool === 'mask-eraser') ? (
          <>
            <span>•</span>
            <span>{t({ ko: '흰색은 편집 가능 영역을 추가해.', en: 'White adds editable area.' })}</span>
          </>
        ) : null}
        <span>•</span>
        <span>{t({ ko: 'Esc로 선택/자르기를 해제해.', en: 'Esc clears selection/crop.' })}</span>
      </div>
    </div>
  )
}
