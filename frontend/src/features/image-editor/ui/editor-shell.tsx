import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Brush,
  BrushCleaning,
  Check,
  Contrast,
  Copy,
  Crop,
  Eraser,
  FlipHorizontal2,
  Hand,
  Highlighter,
  Italic,
  Lasso,
  Layers,
  LoaderCircle,
  Minus,
  MoreHorizontal,
  PaintBucket,
  PenLine,
  Pipette,
  Plus,
  Redo2,
  RotateCw,
  Scan,
  Scissors,
  SquareDashed,
  SquareX,
  Trash2,
  Type,
  Undo2,
  WandSparkles,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { SliderRow } from '@/components/ui/slider-row'
import { Tip } from '@/components/ui/tooltip'
import { useOverlayBackClose } from '@/components/ui/use-overlay-back-close'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { CropRatio, EditorEngine, EditorSnapshot, EditorTool } from '../engine/editor-engine'
import { ensureFont, TEXT_FONTS, type TextStyle } from '../engine/text'
import { SidePanel } from './side-panel'

type Translate = ReturnType<typeof useI18n>['t']

type ToolDef = { tool: EditorTool; icon: ReactNode; label: (t: Translate) => string; key: string; mask?: boolean; ai?: boolean }

const TOOL_GROUPS: ToolDef[][] = [
  [
    { tool: 'hand', icon: <Hand />, label: (t) => t({ ko: '손', en: 'Hand' }), key: 'H' },
    { tool: 'select', icon: <SquareDashed />, label: (t) => t({ ko: '사각 선택', en: 'Rectangle select' }), key: 'S' },
    { tool: 'lasso', icon: <Lasso />, label: (t) => t({ ko: '올가미', en: 'Lasso' }), key: 'L' },
  ],
  [
    { tool: 'brush', icon: <Brush />, label: (t) => t({ ko: '브러시', en: 'Brush' }), key: 'B' },
    { tool: 'eraser', icon: <Eraser />, label: (t) => t({ ko: '지우개', en: 'Eraser' }), key: 'E' },
    { tool: 'ai-erase', icon: <WandSparkles />, label: (t) => t({ ko: 'AI 지우기', en: 'AI erase' }), key: 'R', ai: true },
    { tool: 'eyedropper', icon: <Pipette />, label: (t) => t({ ko: '스포이드', en: 'Eyedropper' }), key: 'I' },
  ],
  [{ tool: 'text', icon: <Type />, label: (t) => t({ ko: '텍스트', en: 'Text' }), key: 'T' }],
  [
    { tool: 'mask', icon: <Highlighter />, label: (t) => t({ ko: '마스크', en: 'Mask' }), key: 'M', mask: true },
    { tool: 'mask-eraser', icon: <BrushCleaning />, label: (t) => t({ ko: '마스크 지우개', en: 'Mask eraser' }), key: 'Shift+M', mask: true },
  ],
  [{ tool: 'crop', icon: <Crop />, label: (t) => t({ ko: '자르기', en: 'Crop' }), key: 'C' }],
]

const CROP_RATIOS: CropRatio[] = ['free', 'original', '1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9']

/** Brush size slider runs on a square-root scale so small sizes stay easy to pick. */
const MAX_BRUSH = 500
const sizeToSlider = (size: number, max = MAX_BRUSH) => Math.round(Math.sqrt(size / max) * 1000)
const sliderToSize = (value: number, max = MAX_BRUSH) => Math.max(1, Math.round((value / 1000) ** 2 * max))
const MAX_FONT = 400

function visibleGroups(maskEnabled: boolean, aiEnabled: boolean) {
  return TOOL_GROUPS.map((group) => group.filter((item) => (maskEnabled || !item.mask) && (aiEnabled || !item.ai))).filter((group) => group.length > 0)
}

function ToolButton({ engine, snapshot, item, size }: { engine: EditorEngine; snapshot: EditorSnapshot; item: ToolDef; size: 'icon' | 'icon-lg' }) {
  const { t } = useI18n()
  return (
    <IconButton
      size={size}
      variant="ghost"
      active={snapshot.tool === item.tool}
      label={`${item.label(t)} (${item.key})`}
      tooltipSide="right"
      className="shrink-0 [&_svg]:size-[18px]"
      onClick={() => engine.setTool(item.tool)}
    >
      {item.icon}
    </IconButton>
  )
}

function ColorChip({ engine, snapshot }: { engine: EditorEngine; snapshot: EditorSnapshot }) {
  const { t } = useI18n()
  const label = snapshot.tool === 'text' ? t({ ko: '글자 색', en: 'Text color' }) : t({ ko: '브러시 색', en: 'Brush color' })
  return <ColorSwatch label={label} color={snapshot.brushColor} onChange={(color) => engine.setBrushColor(color)} />
}

function ColorSwatch({ label, color, onChange, small = false }: { label: string; color: string; onChange: (color: string) => void; small?: boolean }) {
  return (
    <Tip content={label} side="right">
      <label className={cn('relative flex shrink-0 cursor-pointer items-center justify-center', small ? 'size-8' : 'size-10')}>
        <span
          className={cn('block rounded-full ring-1 ring-foreground/35 ring-offset-2 ring-offset-background', small ? 'size-4.5' : 'size-5.5')}
          style={{ background: color }}
        />
        <input type="color" value={color} aria-label={label} className="absolute inset-0 cursor-pointer opacity-0" onChange={(event) => onChange(event.target.value)} />
      </label>
    </Tip>
  )
}

/** Font menu; each family shows in its own face (the menu loads them when it opens). */
function FontPicker({ engine, style }: { engine: EditorEngine; style: TextStyle }) {
  const { t } = useI18n()
  const fontLabel = (family: string) => (family === 'sans-serif' ? t({ ko: '고딕 (시스템)', en: 'Sans (system)' }) : family === 'serif' ? t({ ko: '명조 (시스템)', en: 'Serif (system)' }) : family)
  return (
    <DropdownMenu onOpenChange={(open) => open && TEXT_FONTS.forEach((font) => void ensureFont(font.family))}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="w-40 shrink-0 justify-between truncate max-md:w-28" style={{ fontFamily: `"${style.fontFamily}", sans-serif` }}>
          {fontLabel(style.fontFamily)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={style.fontFamily} onValueChange={(value) => engine.setTextStyle({ fontFamily: value })}>
          {TEXT_FONTS.map((font) => (
            <DropdownMenuRadioItem key={font.family} value={font.family} style={{ fontFamily: font.google ? `"${font.family}", sans-serif` : font.family }}>
              {fontLabel(font.family)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function TextOptions({ engine, snapshot }: { engine: EditorEngine; snapshot: EditorSnapshot }) {
  const { t } = useI18n()
  const style = snapshot.textStyle
  const aligns = [
    { value: 'left' as const, icon: <AlignLeft className="size-4" />, label: t({ ko: '왼쪽 정렬', en: 'Align left' }) },
    { value: 'center' as const, icon: <AlignCenter className="size-4" />, label: t({ ko: '가운데 정렬', en: 'Align center' }) },
    { value: 'right' as const, icon: <AlignRight className="size-4" />, label: t({ ko: '오른쪽 정렬', en: 'Align right' }) },
  ]
  return (
    <div className="flex items-center gap-4 max-md:gap-2">
      <FontPicker engine={engine} style={style} />
      <SliderRow
        layout="inline"
        label={t({ ko: '크기', en: 'Size' })}
        value={sizeToSlider(style.fontSize, MAX_FONT)}
        min={1}
        max={1000}
        readout={String(style.fontSize)}
        onChange={(value) => engine.setTextStyle({ fontSize: Math.max(6, sliderToSize(value, MAX_FONT)) })}
      />
      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton size="icon-sm" variant="ghost" active={style.bold} label={t({ ko: '굵게', en: 'Bold' })} onClick={() => engine.setTextStyle({ bold: !style.bold })}>
          <Bold className="size-4" />
        </IconButton>
        <IconButton size="icon-sm" variant="ghost" active={style.italic} label={t({ ko: '기울임', en: 'Italic' })} onClick={() => engine.setTextStyle({ italic: !style.italic })}>
          <Italic className="size-4" />
        </IconButton>
        {aligns.map((align) => (
          <IconButton key={align.value} size="icon-sm" variant="ghost" active={style.align === align.value} label={align.label} onClick={() => engine.setTextStyle({ align: align.value })} className="max-md:hidden">
            {align.icon}
          </IconButton>
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-1 max-md:hidden">
        <SliderRow
          layout="inline"
          label={t({ ko: '외곽선', en: 'Outline' })}
          value={style.strokeWidth}
          min={0}
          max={40}
          readout={String(style.strokeWidth)}
          onChange={(value) => engine.setTextStyle({ strokeWidth: value })}
        />
        <ColorSwatch small label={t({ ko: '외곽선 색', en: 'Outline color' })} color={style.stroke} onChange={(color) => engine.setTextStyle({ stroke: color })} />
      </div>
    </div>
  )
}

/** Options for the current tool; shown in the top bar on desktop and above the tool row on phones. */
function ToolOptions({ engine, snapshot, onCopy }: { engine: EditorEngine; snapshot: EditorSnapshot; onCopy: (piece: HTMLCanvasElement | null) => void }) {
  const { t } = useI18n()
  const tool = snapshot.tool
  const brushLike = tool === 'brush' || tool === 'eraser' || tool === 'ai-erase' || tool === 'mask' || tool === 'mask-eraser'
  const maskTool = tool === 'mask' || tool === 'mask-eraser'
  const noSelection = !snapshot.hasSelection

  if (tool === 'text') {
    return <TextOptions engine={engine} snapshot={snapshot} />
  }

  if (brushLike) {
    return (
      <div className="flex items-center gap-5">
        <SliderRow
          layout="inline"
          label={t({ ko: '크기', en: 'Size' })}
          value={sizeToSlider(snapshot.brushSize)}
          min={1}
          max={1000}
          readout={String(snapshot.brushSize)}
          onChange={(value) => engine.setBrushSize(sliderToSize(value))}
        />
        {tool !== 'ai-erase' ? (
          <IconButton
            size="icon-sm"
            variant="ghost"
            active={snapshot.pressure}
            label={t({ ko: '필압으로 굵기 조절', en: 'Pen pressure sets width' })}
            onClick={() => engine.setPressure(!snapshot.pressure)}
            className="-ml-3 shrink-0"
          >
            <PenLine className="size-4" />
          </IconButton>
        ) : null}
        {tool === 'ai-erase' ? null : !maskTool ? (
          <SliderRow
          layout="inline"
            label={t({ ko: '불투명도', en: 'Opacity' })}
            value={Math.round(snapshot.brushOpacity * 100)}
            min={1}
            max={100}
            readout={`${Math.round(snapshot.brushOpacity * 100)}%`}
            onChange={(value) => engine.setBrushOpacity(value / 100)}
            className="max-md:hidden"
          />
        ) : (
          <div className="flex items-center gap-0.5">
            <IconButton size="icon-sm" variant="ghost" label={t({ ko: '마스크 반전', en: 'Invert mask' })} onClick={() => engine.invertMask()}>
              <Contrast className="size-4" />
            </IconButton>
            <IconButton size="icon-sm" variant="ghost" label={t({ ko: '마스크 비우기', en: 'Clear mask' })} onClick={() => engine.clearMask()}>
              <SquareX className="size-4" />
            </IconButton>
          </div>
        )}
      </div>
    )
  }

  if (tool === 'select' || tool === 'lasso') {
    return (
      <div className="flex items-center gap-0.5">
        <IconButton size="icon-sm" variant="ghost" disabled={noSelection} label={t({ ko: '복사 (Ctrl+C)', en: 'Copy (Ctrl+C)' })} onClick={() => onCopy(engine.copySelection())}>
          <Copy className="size-4" />
        </IconButton>
        <IconButton size="icon-sm" variant="ghost" disabled={noSelection} label={t({ ko: '잘라내기 (Ctrl+X)', en: 'Cut (Ctrl+X)' })} onClick={() => onCopy(engine.cutSelection())}>
          <Scissors className="size-4" />
        </IconButton>
        <IconButton size="icon-sm" variant="ghost" disabled={noSelection} label={t({ ko: '지우기 (Delete)', en: 'Erase (Delete)' })} onClick={() => engine.deleteSelection()}>
          <Trash2 className="size-4" />
        </IconButton>
        {snapshot.mask ? (
          <>
            <IconButton size="icon-sm" variant="ghost" disabled={noSelection} label={t({ ko: '선택 영역을 마스크로', en: 'Selection to mask' })} onClick={() => engine.fillMaskFromSelection()}>
              <PaintBucket className="size-4" />
            </IconButton>
            <IconButton size="icon-sm" variant="ghost" disabled={noSelection} label={t({ ko: '선택 영역 마스크 빼기', en: 'Remove selection from mask' })} onClick={() => engine.fillMaskFromSelection(true)}>
              <BrushCleaning className="size-4" />
            </IconButton>
          </>
        ) : null}
        <IconButton size="icon-sm" variant="ghost" disabled={noSelection} label={t({ ko: '선택 해제 (Ctrl+D)', en: 'Deselect (Ctrl+D)' })} onClick={() => engine.clearSelection()}>
          <X className="size-4" />
        </IconButton>
      </div>
    )
  }

  if (tool === 'crop') {
    const ratioLabel = (ratio: CropRatio) => (ratio === 'free' ? t({ ko: '자유 비율', en: 'Free' }) : ratio === 'original' ? t({ ko: '원본 비율', en: 'Original' }) : ratio)
    return (
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="min-w-24 justify-between">
              {ratioLabel(snapshot.cropRatio)}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup value={snapshot.cropRatio} onValueChange={(value) => engine.setCropRatio(value as CropRatio)}>
              {CROP_RATIOS.map((ratio) => (
                <DropdownMenuRadioItem key={ratio} value={ratio}>{ratioLabel(ratio)}</DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <IconButton size="icon-sm" variant="ghost" label={t({ ko: '자르기 적용 (Enter)', en: 'Apply crop (Enter)' })} onClick={() => engine.applyCrop()}>
          <Check className="size-4" />
        </IconButton>
        <IconButton size="icon-sm" variant="ghost" label={t({ ko: '취소 (Esc)', en: 'Cancel (Esc)' })} onClick={() => engine.cancelCrop()}>
          <X className="size-4" />
        </IconButton>
      </div>
    )
  }

  return null
}

type ScreenBox = { left: number; top: number; right: number; bottom: number }

/** Keep a small bar just under a stage object's box, inside the stage, without React renders. */
function usePinnedBelow(engine: EditorEngine, visible: boolean, box: () => ScreenBox | null) {
  const ref = useRef<HTMLDivElement | null>(null)
  const boxRef = useRef(box)
  useEffect(() => {
    boxRef.current = box
  })
  useEffect(() => {
    if (!visible) return
    const place = () => {
      const element = ref.current
      const current = boxRef.current()
      if (!element || !current) return
      const parent = element.parentElement
      const maxLeft = (parent?.clientWidth ?? 0) - element.offsetWidth - 8
      const maxTop = (parent?.clientHeight ?? 0) - element.offsetHeight - 8
      element.style.transform = `translate(${Math.max(8, Math.min(current.left, maxLeft))}px, ${Math.max(8, Math.min(current.bottom + 10, maxTop))}px)`
    }
    place()
    return engine.subscribeFrame(place)
  }, [engine, visible])
  return ref
}

/** ✓ / ✕ pinned under the floating piece or the text being edited. */
function FloatingActions({ engine, snapshot }: { engine: EditorEngine; snapshot: EditorSnapshot }) {
  const { t } = useI18n()
  const visible = snapshot.floating || snapshot.textEditing
  const ref = usePinnedBelow(engine, visible, () => engine.floatingScreenBox())

  if (!visible) return null
  const text = snapshot.textEditing
  return (
    <div ref={ref} className="absolute top-0 left-0 z-10 flex gap-0.5 rounded-md bg-surface-container p-0.5 shadow-elevation-2">
      <IconButton
        size="icon-sm"
        variant="ghost"
        label={text ? t({ ko: '확정 (Ctrl+Enter)', en: 'Apply (Ctrl+Enter)' }) : t({ ko: '확정 (Enter)', en: 'Apply (Enter)' })}
        onClick={() => engine.confirmPending()}
      >
        <Check className="size-4" />
      </IconButton>
      <IconButton
        size="icon-sm"
        variant="ghost"
        label={text ? t({ ko: '취소', en: 'Cancel' }) : t({ ko: '취소 (Esc)', en: 'Cancel (Esc)' })}
        onClick={() => (text ? engine.cancelTextEdit() : engine.discardFloating())}
      >
        <X className="size-4" />
      </IconButton>
    </div>
  )
}

/** "지우는 중" under the area an AI erase is working on, with a cancel button. */
function AiErasePill({ engine, visible }: { engine: EditorEngine; visible: boolean }) {
  const { t } = useI18n()
  const ref = usePinnedBelow(engine, visible, () => engine.aiEraseScreenBox())
  if (!visible) return null
  return (
    <div ref={ref} role="status" className="absolute top-0 left-0 z-10 flex h-8 items-center gap-2 rounded-md bg-surface-container pr-0.5 pl-2.5 text-xs shadow-elevation-2">
      <LoaderCircle className="size-3.5 animate-spin" />
      <span>{t({ ko: '지우는 중', en: 'Erasing' })}</span>
      <IconButton size="icon-xs" variant="ghost" label={t({ ko: '취소 (Esc)', en: 'Cancel (Esc)' })} onClick={() => engine.cancelAiErase()}>
        <X className="size-3.5" />
      </IconButton>
    </div>
  )
}

function CursorReadout({ engine }: { engine: EditorEngine }) {
  const ref = useRef<HTMLSpanElement | null>(null)
  useEffect(
    () =>
      engine.subscribeCursor((point) => {
        if (ref.current) ref.current.textContent = point ? `${Math.round(point.x)}, ${Math.round(point.y)}` : ''
      }),
    [engine],
  )
  return <span ref={ref} className="tabular-nums" />
}

export type EditorShellProps = {
  engine: EditorEngine | null
  snapshot: EditorSnapshot
  stageRef: RefObject<HTMLDivElement | null>
  rootRef: RefObject<HTMLDivElement | null>
  fileName: string
  maskEnabled: boolean
  saving: boolean
  onRequestClose: () => void
  onSave: () => void
  onCopy: (piece: HTMLCanvasElement | null) => void
  onImportImage: () => void
  onDropFile: (file: File) => void
}

/** Full-screen workspace (mockup A): top bar, tool rail, stage, status bar, layer panel. Phones get bottom bars. */
export function EditorShell({ engine, snapshot, stageRef, rootRef, fileName, maskEnabled, saving, onRequestClose, onSave, onCopy, onImportImage, onDropFile }: EditorShellProps) {
  const { t } = useI18n()
  const [layersOpen, setLayersOpen] = useState(false)
  const groups = visibleGroups(maskEnabled, snapshot.aiEraseAvailable)

  // The layer sheet closes first on Esc and on back, before the editor itself.
  useOverlayBackClose({ open: layersOpen, onClose: () => setLayersOpen(false) })
  useEffect(() => {
    if (!layersOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setLayersOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [layersOpen])
  const ready = snapshot.status === 'ready'

  const saveButton = (
    <Button size="sm" className="shrink-0" disabled={!ready || saving} onClick={onSave}>
      {saving ? t({ ko: '저장 중…', en: 'Saving…' }) : t({ ko: '저장', en: 'Save' })}
    </Button>
  )

  const historyButtons = engine ? (
    <div className="flex shrink-0 items-center">
      <IconButton variant="ghost" disabled={!snapshot.canUndo} label={t({ ko: '실행 취소 (Ctrl+Z)', en: 'Undo (Ctrl+Z)' })} onClick={() => engine.undo()}>
        <Undo2 className="size-[18px]" />
      </IconButton>
      <IconButton variant="ghost" disabled={!snapshot.canRedo} label={t({ ko: '다시 실행 (Ctrl+Shift+Z)', en: 'Redo (Ctrl+Shift+Z)' })} onClick={() => engine.redo()}>
        <Redo2 className="size-[18px]" />
      </IconButton>
    </div>
  ) : null

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={t({ ko: '이미지 편집기', en: 'Image editor' })}
      tabIndex={-1}
      // eslint-disable-next-line no-restricted-syntax -- a full-screen workspace, not a dialog box: Modal's frame and padding do not apply
      className="nokey fixed inset-0 z-modal flex flex-col bg-surface-lowest text-foreground outline-none"
    >
      <header className="flex h-13 shrink-0 items-center gap-3 border-b border-line bg-background pr-3 pl-1.5">
        <IconButton variant="ghost" label={t({ ko: '닫기 (Esc)', en: 'Close (Esc)' })} onClick={onRequestClose}>
          <X className="size-[18px]" />
        </IconButton>
        <div className="flex min-w-0 items-baseline gap-2.5 max-md:flex-1">
          <span className="truncate text-sm font-semibold">{fileName}</span>
          {snapshot.width > 0 ? <span className="shrink-0 text-xs text-muted-foreground max-md:hidden">{snapshot.width} × {snapshot.height}</span> : null}
        </div>
        {engine ? (
          <div className="flex min-w-0 items-center gap-3 max-md:hidden">
            <span className="h-6 w-px bg-line" />
            <ToolOptions engine={engine} snapshot={snapshot} onCopy={onCopy} />
          </div>
        ) : null}
        <div className="flex-1 max-md:hidden" />
        {historyButtons}
        {saveButton}
      </header>

      <div className="flex min-h-0 flex-1">
        {engine ? (
          <nav aria-label={t({ ko: '도구', en: 'Tools' })} className="flex w-13 shrink-0 flex-col items-center gap-0.5 border-r border-line bg-background py-2 max-md:hidden">
            {groups.map((group, index) => (
              <div key={index} className="flex flex-col items-center gap-0.5">
                {index > 0 ? <span className="my-1.5 h-px w-6 bg-line" /> : null}
                {group.map((item) => <ToolButton key={item.tool} engine={engine} snapshot={snapshot} item={item} size="icon" />)}
              </div>
            ))}
            <div className="flex-1" />
            <ColorChip engine={engine} snapshot={snapshot} />
          </nav>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <div
            className="relative min-h-0 flex-1 overflow-hidden"
            onDragOver={(event) => {
              if (Array.from(event.dataTransfer.items).some((item) => item.kind === 'file')) event.preventDefault()
            }}
            onDrop={(event) => {
              const file = Array.from(event.dataTransfer.files).find((item) => item.type.startsWith('image/'))
              if (!file) return
              event.preventDefault()
              onDropFile(file)
            }}
          >
            <div ref={stageRef} className="absolute inset-0" />
            {snapshot.status === 'loading' || snapshot.status === 'idle' ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">{t({ ko: '불러오는 중…', en: 'Loading…' })}</div>
            ) : null}
            {snapshot.status === 'error' ? (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-destructive">{t({ ko: '이미지를 불러오지 못했어', en: 'Could not load the image' })}</div>
            ) : null}
            {engine ? <FloatingActions engine={engine} snapshot={snapshot} /> : null}
            {engine ? <AiErasePill engine={engine} visible={snapshot.aiErasing} /> : null}
          </div>

          {engine ? (
            <footer className="flex h-8 shrink-0 items-center gap-0.5 border-t border-line bg-background px-2 text-xs text-muted-foreground max-md:hidden">
              <IconButton size="icon-xs" variant="ghost" label={t({ ko: '축소 (Ctrl+-)', en: 'Zoom out (Ctrl+-)' })} onClick={() => engine.zoomBy(0.8)}>
                <Minus className="size-3.5" />
              </IconButton>
              <Tip content={t({ ko: '100% (Ctrl+1)', en: '100% (Ctrl+1)' })}>
                <Button variant="ghost" size="xs" className="min-w-11 tabular-nums" onClick={() => engine.zoomTo(1)}>
                  {Math.round(snapshot.zoom * 100)}%
                </Button>
              </Tip>
              <IconButton size="icon-xs" variant="ghost" label={t({ ko: '확대 (Ctrl+=)', en: 'Zoom in (Ctrl+=)' })} onClick={() => engine.zoomBy(1.25)}>
                <Plus className="size-3.5" />
              </IconButton>
              <IconButton size="icon-xs" variant="ghost" label={t({ ko: '화면 맞춤 (Ctrl+0)', en: 'Fit (Ctrl+0)' })} onClick={() => engine.fitToView()}>
                <Scan className="size-3.5" />
              </IconButton>
              <IconButton size="icon-xs" variant="ghost" label={t({ ko: '90° 회전', en: 'Rotate 90°' })} onClick={() => engine.rotate(true)}>
                <RotateCw className="size-3.5" />
              </IconButton>
              <IconButton size="icon-xs" variant="ghost" label={t({ ko: '좌우 뒤집기', en: 'Flip horizontally' })} onClick={() => engine.flip('x')}>
                <FlipHorizontal2 className="size-3.5" />
              </IconButton>
              <div className="flex-1" />
              <CursorReadout engine={engine} />
            </footer>
          ) : null}
        </div>

        {engine ? (
          <aside aria-label={t({ ko: '레이어와 보정', en: 'Layers and adjustments' })} className="flex w-70 shrink-0 flex-col border-l border-line bg-background max-lg:hidden">
            <SidePanel engine={engine} snapshot={snapshot} onImportImage={onImportImage} />
          </aside>
        ) : null}
      </div>

      {/* Below lg the layer list opens over the stage: a side sheet on tablets, a bottom sheet on phones. */}
      {engine && layersOpen ? (
        <div className="absolute inset-0 z-20 lg:hidden" onClick={() => setLayersOpen(false)}>
          <aside
            aria-label={t({ ko: '레이어와 보정', en: 'Layers and adjustments' })}
            className="absolute flex flex-col bg-background shadow-elevation-3 max-md:inset-x-0 max-md:bottom-0 max-md:h-[60%] max-md:rounded-t-lg md:top-13 md:right-0 md:bottom-8 md:w-80 md:border-l md:border-line"
            onClick={(event) => event.stopPropagation()}
          >
            <SidePanel engine={engine} snapshot={snapshot} onImportImage={onImportImage} />
          </aside>
        </div>
      ) : null}

      {engine ? (
        <div className="shrink-0 border-t border-line bg-background md:hidden">
          <div className="scroll-x flex h-13 items-center gap-1 pr-1 pl-4">
            <div className="scroll-x theme-nav-scroll flex min-w-0 flex-1 items-center">
              <ToolOptions engine={engine} snapshot={snapshot} onCopy={onCopy} />
            </div>
            {snapshot.tool === 'brush' || snapshot.tool === 'text' ? <ColorChip engine={engine} snapshot={snapshot} /> : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton size="icon-lg" variant="ghost" label={t({ ko: '보기와 변형', en: 'View and transform' })}>
                  <MoreHorizontal className="size-5" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => engine.fitToView()}>{t({ ko: '화면 맞춤', en: 'Fit' })}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => engine.zoomTo(1)}>100%</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => engine.rotate(true)}>{t({ ko: '90° 회전', en: 'Rotate 90°' })}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => engine.flip('x')}>{t({ ko: '좌우 뒤집기', en: 'Flip horizontally' })}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <IconButton size="icon-lg" variant="ghost" active={layersOpen} label={t({ ko: '레이어', en: 'Layers' })} onClick={() => setLayersOpen((value) => !value)}>
              <Layers className="size-5" />
            </IconButton>
          </div>
          <nav aria-label={t({ ko: '도구', en: 'Tools' })} className="scroll-x flex h-16 items-center gap-0.5 border-t border-line px-2">
            {groups.flat().map((item) => <ToolButton key={item.tool} engine={engine} snapshot={snapshot} item={item} size="icon-lg" />)}
          </nav>
        </div>
      ) : null}

      {/* Tablets (md–lg): the layer button lives at the top right of the stage. */}
      {engine ? (
        <div className="absolute top-15 right-2 z-10 hidden md:block lg:hidden">
          <IconButton variant="secondary" active={layersOpen} label={t({ ko: '레이어', en: 'Layers' })} onClick={() => setLayersOpen((value) => !value)}>
            <Layers className="size-[18px]" />
          </IconButton>
        </div>
      ) : null}
    </div>
  )
}
