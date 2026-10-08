import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { AlertTriangle, Crop, Download, Expand, LayoutGrid, Loader2, Pause, Play, Save, Scan } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select } from '@/components/ui/select'
import { SegmentedControl } from '@/components/common/segmented-control'
import { useI18n } from '@/i18n'
import { triggerBrowserDownload } from '@/lib/api-client'
import { spriteFrameUrl, spriteFramesZipUrl, spriteSheetUrl, type SpriteExtractResult, type SpriteRect, type SpriteRender } from '@/lib/api-sprite'
import { cn } from '@/lib/utils'
import { MAX_SHEET_DIMENSION, sheetLayout, type OutputForm } from './sprite-options'
import { MiniField, SliderLine, TEXT_TAB_LIST_CLASS, TEXT_TAB_TRIGGER_CLASS } from './sprite-ui'

const FPS_OPTIONS = [4, 8, 12, 16, 24, 30, 60]
const FRAME_ZOOMS = [25, 50, 100, 200, 300, 400, 600, 800]
const SHEET_ZOOMS = [10, 25, 50, 75, 100, 150, 200, 300, 400]

type View = 'frames' | 'sheet'

export function SpriteResultPanel({ build, output, onOutputChange, crop, onCropChange, stale, saving, canSave, onSave }: {
  build: SpriteExtractResult
  output: OutputForm
  onOutputChange: (next: OutputForm) => void
  crop: SpriteRect | null
  onCropChange: (next: SpriteRect | null) => void
  stale: boolean
  saving: boolean
  canSave: boolean
  onSave: () => void
}) {
  const { t } = useI18n()
  const [view, setView] = useState<View>('frames')
  const [editingCrop, setEditingCrop] = useState(false)
  const frameWidth = crop?.width ?? build.frameWidth
  const frameHeight = crop?.height ?? build.frameHeight
  const layout = sheetLayout(build.frameCount, frameWidth, frameHeight, output.columns, output.spacing)
  const render: SpriteRender = { columns: output.columns, spacing: output.spacing, crop, format: output.format, quality: output.quality }
  const tooLarge = !layout || layout.width > MAX_SHEET_DIMENSION || layout.height > MAX_SHEET_DIMENSION

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={view} onValueChange={(next) => setView(next as View)} className="shrink-0 grow gap-0">
          <TabsList className={cn(TEXT_TAB_LIST_CLASS, 'border-b-0')}>
            <TabsTrigger value="frames" className={TEXT_TAB_TRIGGER_CLASS}>{t({ ko: '프레임 재생', en: 'Frames' })}</TabsTrigger>
            <TabsTrigger value="sheet" className={TEXT_TAB_TRIGGER_CLASS}>{t({ ko: '시트', en: 'Sheet' })}</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="ml-auto flex items-center gap-2">
          <IconButton variant="ghost" size="icon-sm" active={editingCrop} label={t({ ko: '생성 후 크롭', en: 'Crop frames' })} onClick={() => {
            if (!editingCrop) { setView('frames'); if (!crop) onCropChange({ x: 0, y: 0, width: build.frameWidth, height: build.frameHeight }) }
            setEditingCrop(!editingCrop)
          }}><Crop /></IconButton>
          <LayoutPopover output={output} onOutputChange={onOutputChange} layout={layout} />
          <DownloadPopover buildId={build.buildId} output={output} onOutputChange={onOutputChange} render={render} crop={crop} disabled={tooLarge} />
          <Button size="sm" variant="secondary" disabled={!canSave || saving || tooLarge} onClick={onSave}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            {t({ ko: '라이브러리에 저장', en: 'Save to library' })}
          </Button>
        </div>
      </div>

      {view === 'frames'
        ? <FramePlayer build={build} crop={crop} editingCrop={editingCrop} onCropChange={onCropChange} />
        : <SheetView buildId={build.buildId} render={render} />}

      <div className="font-mono text-xs text-muted-foreground">
        {t({ ko: '{count}프레임', en: '{count} frames' }, { count: build.frameCount })}
        {build.removedFrameCount ? t({ ko: ' (중복 {count} 제외)', en: ' ({count} duplicates removed)' }, { count: build.removedFrameCount }) : ''}
        {` · ${t({ ko: '셀', en: 'cell' })} ${frameWidth}×${frameHeight}`}
        {layout ? ` · ${t({ ko: '시트', en: 'sheet' })} ${layout.columns}×${layout.rows} = ${layout.width}×${layout.height}` : ''}
        {` · ${output.format.toUpperCase()}`}
      </div>
      {tooLarge ? <div role="alert" className="flex items-center gap-1.5 text-xs text-destructive"><AlertTriangle className="size-3.5" />{t({ ko: '시트가 {max}px을 넘어. 열이나 간격을 줄여.', en: 'The sheet exceeds {max}px. Reduce columns or spacing.' }, { max: MAX_SHEET_DIMENSION })}</div> : null}
      {stale ? <div className="flex items-center gap-1.5 text-xs text-warning"><AlertTriangle className="size-3.5" />{t({ ko: '설정이 바뀌었어. 다시 생성해야 반영돼.', en: 'Settings changed. Generate again to apply them.' })}</div> : null}
    </div>
  )
}

function FramePlayer({ build, crop, editingCrop, onCropChange }: { build: SpriteExtractResult; crop: SpriteRect | null; editingCrop: boolean; onCropChange: (next: SpriteRect | null) => void }) {
  const { t } = useI18n()
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [fps, setFps] = useState(12)
  const [zoom, setZoom] = useState(200)
  const count = build.frameCount
  const native = Math.min(1024, Math.max(build.frameWidth, build.frameHeight))
  const urls = useMemo(() => Array.from({ length: count }, (_, frame) => spriteFrameUrl(build.buildId, frame, native)), [build.buildId, count, native])

  useEffect(() => { setIndex(0) }, [build.buildId])
  useEffect(() => {
    // Warm the cache so playback does not stutter on the first loop.
    for (const url of urls) { const image = new Image(); image.src = url }
  }, [urls])
  useEffect(() => {
    if (!playing || count < 2) return
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % count), 1000 / fps)
    return () => window.clearInterval(timer)
  }, [playing, fps, count])

  const scale = zoom / 100
  const shownWidth = build.frameWidth * scale
  const shownHeight = build.frameHeight * scale
  const showCrop = editingCrop ? crop ?? { x: 0, y: 0, width: build.frameWidth, height: build.frameHeight } : null
  // Outside crop editing the stage shows what will be saved: the cropped frame.
  const viewRect = !editingCrop && crop ? crop : null

  return (
    <div className="flex flex-col gap-3">
      <div className="bg-checker relative flex h-[min(56vh,420px)] items-center justify-center overflow-auto rounded-sm">
        <div className="relative shrink-0" style={{ width: (viewRect?.width ?? build.frameWidth) * scale, height: (viewRect?.height ?? build.frameHeight) * scale, overflow: 'hidden' }}>
          {urls[index] ? (
            <img
              src={urls[index]}
              alt={t({ ko: '프레임 {index}', en: 'Frame {index}' }, { index: index + 1 })}
              draggable={false}
              className="absolute max-w-none select-none"
              style={{ width: shownWidth, height: shownHeight, left: -(viewRect?.x ?? 0) * scale, top: -(viewRect?.y ?? 0) * scale, imageRendering: scale > 1 ? 'pixelated' : 'auto' }}
            />
          ) : null}
          {showCrop ? <CropBox rect={showCrop} scale={scale} frameWidth={build.frameWidth} frameHeight={build.frameHeight} onChange={onCropChange} /> : null}
        </div>
      </div>
      {editingCrop && showCrop ? (
        <div className="flex flex-wrap items-end gap-2">
          {(['x', 'y', 'width', 'height'] as const).map((key) => (
            <MiniField key={key} label={key === 'x' ? 'X' : key === 'y' ? 'Y' : key === 'width' ? 'W' : 'H'} className="w-32">
              <NumberStepperInput
                value={showCrop[key]}
                min={key === 'x' || key === 'y' ? 0 : 1}
                max={key === 'x' || key === 'width' ? build.frameWidth : build.frameHeight}
                step={1}
                onValueCommit={(value) => onCropChange(clampRect({ ...showCrop, ...resizeAroundCentre(showCrop, key, Number(value)) }, build.frameWidth, build.frameHeight))}
                aria-label={key}
              />
            </MiniField>
          ))}
          <IconButton variant="ghost" size="icon-sm" label={t({ ko: '중앙 맞춤', en: 'Centre' })} onClick={() => onCropChange({ ...showCrop, x: Math.round((build.frameWidth - showCrop.width) / 2), y: Math.round((build.frameHeight - showCrop.height) / 2) })}><Scan /></IconButton>
          <IconButton variant="ghost" size="icon-sm" label={t({ ko: '전체 크기', en: 'Full size' })} onClick={() => onCropChange(null)}><Expand /></IconButton>
        </div>
      ) : null}
      <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
        <IconButton size="icon-xs" variant="ghost" label={playing ? t({ ko: '일시정지', en: 'Pause' }) : t({ ko: '재생', en: 'Play' })} onClick={() => setPlaying(!playing)}>
          {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
        </IconButton>
        <input
          type="range"
          min={0}
          max={Math.max(0, count - 1)}
          value={index}
          onChange={(event) => { setPlaying(false); setIndex(Number(event.target.value)) }}
          aria-label={t({ ko: '프레임 위치', en: 'Frame position' })}
          className="h-1 min-w-0 flex-1 cursor-pointer accent-[var(--primary)]"
        />
        <span className="tabular-nums">{index + 1} / {count}</span>
        <Select className="h-7 w-20 px-2 font-mono text-xs" value={fps} onChange={(event) => setFps(Number(event.target.value))} aria-label={t({ ko: '재생 속도', en: 'Playback speed' })}>
          {FPS_OPTIONS.map((value) => <option key={value} value={value}>{value}fps</option>)}
        </Select>
        <Select className="h-7 w-20 px-2 font-mono text-xs" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} aria-label={t({ ko: '확대', en: 'Zoom' })}>
          {FRAME_ZOOMS.map((value) => <option key={value} value={value}>{value}%</option>)}
        </Select>
      </div>
      <div className="flex gap-1 overflow-x-auto pb-1">
        {urls.map((url, frame) => (
          <Button
            key={url}
            variant="ghost"
            onClick={() => { setPlaying(false); setIndex(frame) }}
            aria-label={t({ ko: '프레임 {index}', en: 'Frame {index}' }, { index: frame + 1 })}
            className={cn('bg-checker size-12 shrink-0 p-0', frame === index && 'ring-2 ring-primary')}
          >
            <img src={spriteFrameUrl(build.buildId, frame, 96)} alt="" loading="lazy" className="max-h-11 max-w-11 object-contain" />
          </Button>
        ))}
      </div>
    </div>
  )
}

/** Width/height edits keep the centre, like the corner drag. */
function resizeAroundCentre(rect: SpriteRect, key: keyof SpriteRect, value: number): Partial<SpriteRect> {
  if (!Number.isFinite(value)) return {}
  if (key === 'width') return { width: value, x: Math.round(rect.x + (rect.width - value) / 2) }
  if (key === 'height') return { height: value, y: Math.round(rect.y + (rect.height - value) / 2) }
  return { [key]: value }
}

function clampRect(rect: SpriteRect, width: number, height: number): SpriteRect {
  const w = Math.max(1, Math.min(width, Math.round(rect.width)))
  const h = Math.max(1, Math.min(height, Math.round(rect.height)))
  return { width: w, height: h, x: Math.max(0, Math.min(width - w, Math.round(rect.x))), y: Math.max(0, Math.min(height - h, Math.round(rect.y))) }
}

/** Corner handles resize symmetrically around the box centre (the original's post-crop). */
function CropBox({ rect, scale, frameWidth, frameHeight, onChange }: { rect: SpriteRect; scale: number; frameWidth: number; frameHeight: number; onChange: (next: SpriteRect) => void }) {
  const dragRef = useRef<{ x: number; y: number; rect: SpriteRect; sx: number; sy: number } | null>(null)
  const start = (sx: number, sy: number) => (event: ReactPointerEvent) => {
    event.preventDefault()
    dragRef.current = { x: event.clientX, y: event.clientY, rect, sx, sy }
    const move = (moveEvent: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const dw = Math.round(((moveEvent.clientX - drag.x) / scale) * drag.sx * 2)
      const dh = Math.round(((moveEvent.clientY - drag.y) / scale) * drag.sy * 2)
      const cx = drag.rect.x + drag.rect.width / 2
      const cy = drag.rect.y + drag.rect.height / 2
      const width = Math.max(1, Math.min(frameWidth, drag.rect.width + dw, 2 * Math.min(cx, frameWidth - cx)))
      const height = Math.max(1, Math.min(frameHeight, drag.rect.height + dh, 2 * Math.min(cy, frameHeight - cy)))
      onChange(clampRect({ x: cx - width / 2, y: cy - height / 2, width, height }, frameWidth, frameHeight))
    }
    const up = () => { dragRef.current = null; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <div className="pointer-events-none absolute border-[1.5px] border-primary shadow-[0_0_0_9999px_rgb(0_0_0/0.35)]" style={{ left: rect.x * scale, top: rect.y * scale, width: rect.width * scale, height: rect.height * scale }}>
      {([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).map(([sx, sy]) => (
        <span
          key={`${sx}${sy}`}
          onPointerDown={start(sx, sy)}
          className={cn('pointer-events-auto absolute size-2.5 bg-primary', sy < 0 ? '-top-1.5' : '-bottom-1.5', sx < 0 ? '-left-1.5' : '-right-1.5', sx === sy ? 'cursor-nwse-resize' : 'cursor-nesw-resize')}
        />
      ))}
    </div>
  )
}

function SheetView({ buildId, render }: { buildId: string; render: SpriteRender }) {
  const { t } = useI18n()
  const [zoom, setZoom] = useState(100)
  const url = spriteSheetUrl(buildId, render)
  return (
    <div className="flex flex-col gap-2">
      <div className="bg-checker h-[min(56vh,420px)] overflow-auto rounded-sm">
        <img src={url} alt={t({ ko: '스프라이트 시트', en: 'Sprite sheet' })} className="max-w-none" style={{ zoom: zoom / 100, imageRendering: zoom > 100 ? 'pixelated' : 'auto' }} />
      </div>
      <div className="flex justify-end">
        <Select className="h-7 w-20 px-2 font-mono text-xs" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} aria-label={t({ ko: '확대', en: 'Zoom' })}>
          {SHEET_ZOOMS.map((value) => <option key={value} value={value}>{value}%</option>)}
        </Select>
      </div>
    </div>
  )
}

function LayoutPopover({ output, onOutputChange, layout }: { output: OutputForm; onOutputChange: (next: OutputForm) => void; layout: { columns: number; rows: number; width: number; height: number } | null }) {
  const { t } = useI18n()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton variant="ghost" size="icon-sm" label={t({ ko: '시트 배치', en: 'Sheet layout' })}><LayoutGrid /></IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <MiniField label={t({ ko: '열 (0 = 자동)', en: 'Columns (0 = auto)' })}>
            <NumberStepperInput value={output.columns} min={0} max={64} step={1} onValueCommit={(value) => onOutputChange({ ...output, columns: Number(value) || 0 })} />
          </MiniField>
          <MiniField label={t({ ko: '간격', en: 'Spacing' })}>
            <NumberStepperInput value={output.spacing} min={0} max={64} step={1} onValueCommit={(value) => onOutputChange({ ...output, spacing: Number(value) || 0 })} />
          </MiniField>
        </div>
        {layout ? <div className="font-mono text-xs text-muted-foreground">{layout.columns}×{layout.rows} = {layout.width}×{layout.height}</div> : null}
      </PopoverContent>
    </Popover>
  )
}

function DownloadPopover({ buildId, output, onOutputChange, render, crop, disabled }: { buildId: string; output: OutputForm; onOutputChange: (next: OutputForm) => void; render: SpriteRender; crop: SpriteRect | null; disabled: boolean }) {
  const { t } = useI18n()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton variant="ghost" size="icon-sm" label={t({ ko: '다운로드', en: 'Download' })}><Download /></IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-72 flex-col gap-3">
        <SegmentedControl
          size="sm"
          fullWidth
          value={output.format}
          items={[{ value: 'png', label: 'PNG' }, { value: 'webp', label: 'WebP' }]}
          onChange={(format) => onOutputChange({ ...output, format: format as OutputForm['format'] })}
          ariaLabel={t({ ko: '형식', en: 'Format' })}
        />
        {output.format === 'webp' ? <SliderLine label={t({ ko: '품질', en: 'Quality' })} value={output.quality} min={1} max={100} onChange={(quality) => onOutputChange({ ...output, quality })} /> : null}
        <div className="flex flex-col gap-1">
          <Button variant="ghost" className="justify-start" disabled={disabled} onClick={() => triggerBrowserDownload(spriteSheetUrl(buildId, render, true))}>
            <LayoutGrid />{t({ ko: '시트 받기', en: 'Download sheet' })}
          </Button>
          <Button variant="ghost" className="justify-start" onClick={() => triggerBrowserDownload(spriteFramesZipUrl(buildId, { crop, format: output.format, quality: output.quality }))}>
            <Download />{t({ ko: '프레임 ZIP 받기', en: 'Download frames ZIP' })}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Hex text input used by the key colour list. */
export function HexInput({ value, onCommit, label }: { value: string; onCommit: (value: string) => void; label: string }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return <Input className="h-8 w-24 font-mono text-xs" value={draft} aria-label={label} onChange={(event) => setDraft(event.target.value)} onBlur={() => onCommit(draft)} onKeyDown={(event) => { if (event.key === 'Enter') onCommit(draft) }} />
}
