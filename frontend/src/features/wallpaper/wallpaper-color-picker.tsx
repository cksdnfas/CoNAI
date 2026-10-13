import { createContext, useContext, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Pipette } from 'lucide-react'
import { AnchoredPopup } from '@/components/ui/anchored-popup'
import { IconButton } from '@/components/ui/icon-button'
import { Text } from '@/components/ui/text'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

/**
 * The editor's color picker: saturation/value area, hue and opacity bars, hex and opacity fields, an eyedropper where
 * the browser has one, and swatch rows (recent, this wallpaper, theme). Colors are `#RRGGBB`, or `#RRGGBBAA` below
 * full opacity.
 */

/** Colors the open wallpaper already uses; the editor page provides them. */
export const WallpaperColorPaletteContext = createContext<string[]>([])

const RECENT_COLORS_KEY = 'conai.wallpaper.recentColors'
const RECENT_LIMIT = 8
/** Theme tokens offered as swatches, read from the wallpaper stage (its theme can differ from the app's). */
const THEME_SWATCH_VARS = ['--background', '--card', '--surface-high', '--foreground', '--muted-foreground', '--primary']
const CHECKERBOARD = 'repeating-conic-gradient(color-mix(in srgb, var(--foreground) 22%, transparent) 0 25%, transparent 0 50%) 0 0 / 8px 8px'

interface Hsva { h: number; s: number; v: number; a: number }

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

export function parseWallpaperHex(value: string | null | undefined): Hsva | null {
  const match = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value?.trim() ?? '')
  if (!match) return null
  const r = parseInt(match[1].slice(0, 2), 16) / 255
  const g = parseInt(match[1].slice(2, 4), 16) / 255
  const b = parseInt(match[1].slice(4, 6), 16) / 255
  const a = match[2] ? parseInt(match[2], 16) / 255 : 1
  const max = Math.max(r, g, b)
  const delta = max - Math.min(r, g, b)
  let h = 0
  if (delta > 0) {
    if (max === r) h = ((g - b) / delta) % 6
    else if (max === g) h = (b - r) / delta + 2
    else h = (r - g) / delta + 4
  }
  return { h: ((h * 60) + 360) % 360, s: max === 0 ? 0 : delta / max, v: max, a }
}

function toHex({ h, s, v, a }: Hsva) {
  const channel = (n: number) => {
    const k = (n + h / 60) % 6
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
  }
  const byte = (value: number) => Math.round(clamp01(value) * 255).toString(16).padStart(2, '0')
  const rgb = `#${byte(channel(5))}${byte(channel(3))}${byte(channel(1))}`
  return a >= 0.995 ? rgb : `${rgb}${byte(a)}`
}

/** Any CSS color (oklch, color-mix…) as #RRGGBB(AA), by letting a canvas resolve it. */
function cssColorToHex(value: string): string | null {
  if (!value.trim() || typeof document === 'undefined') return null
  const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.clearRect(0, 0, 1, 1)
  context.fillStyle = value
  context.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data
  const byte = (n: number) => n.toString(16).padStart(2, '0')
  return a >= 254 ? `#${byte(r)}${byte(g)}${byte(b)}` : `#${byte(r)}${byte(g)}${byte(b)}${byte(a)}`
}

/** A theme token as the wallpaper stage draws it, or null outside the editor. */
export function resolveWallpaperThemeColor(variable: string): string | null {
  if (typeof document === 'undefined') return null
  const element = document.querySelector('[data-wallpaper-stage-layer]') ?? document.documentElement
  return cssColorToHex(getComputedStyle(element).getPropertyValue(variable))
}

function readRecentColors(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_COLORS_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((color): color is string => typeof color === 'string' && parseWallpaperHex(color) !== null).slice(0, RECENT_LIMIT) : []
  } catch {
    return []
  }
}

function rememberRecentColor(color: string) {
  try {
    const next = [color, ...readRecentColors().filter((item) => item.toLowerCase() !== color.toLowerCase())].slice(0, RECENT_LIMIT)
    window.localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(next))
  } catch {
    // Private windows keep no recents.
  }
}

/** Drag on an element and report the pointer as 0–1 fractions of its box. */
function usePointerFraction(onChange: (x: number, y: number) => void) {
  const ref = useRef<HTMLDivElement | null>(null)
  const report = (event: { clientX: number; clientY: number }) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return
    onChange(clamp01((event.clientX - rect.left) / rect.width), clamp01((event.clientY - rect.top) / rect.height))
  }
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    report(event)
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) report(event)
  }
  return { ref, onPointerDown, onPointerMove }
}

/** Arrow keys for a 1-D bar (hue, opacity): 1% steps, 10% with Shift. */
function barKeys(value: number, onChange: (next: number) => void) {
  return (event: ReactKeyboardEvent) => {
    const step = event.shiftKey ? 0.1 : 0.01
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') { event.preventDefault(); onChange(clamp01(value - step)) }
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') { event.preventDefault(); onChange(clamp01(value + step)) }
  }
}

function Swatches({ label, colors, current, onPick }: { label: string; colors: string[]; current: string; onPick: (color: string) => void }) {
  if (colors.length === 0) return null
  return (
    <div className="space-y-1.5">
      <Text as="div" variant="overline">{label}</Text>
      <div className="flex flex-wrap gap-1.5">
        {colors.map((color) => (
          // eslint-disable-next-line no-restricted-syntax -- color swatch: the button is the color itself
          <button
            key={color}
            type="button"
            title={color.toUpperCase()}
            aria-label={color.toUpperCase()}
            className={cn('size-5 rounded-[5px] ring-1 ring-line ring-inset focus-visible:outline-2 focus-visible:outline-primary', color.toLowerCase() === current.toLowerCase() ? 'outline-2 outline-offset-1 outline-primary' : null)}
            style={{ background: `linear-gradient(${color}, ${color}), ${CHECKERBOARD}` }}
            onClick={() => onPick(color)}
          />
        ))}
      </div>
    </div>
  )
}

interface EyeDropperResult { sRGBHex: string }
type EyeDropperConstructor = new () => { open: () => Promise<EyeDropperResult> }

/** The popover body; `value` null starts from `initial` (the theme color) and commits on the first change. */
function ColorPickerPanel({ value, initial, onChange }: { value: string | null; initial: string; onChange: (value: string) => void }) {
  const { t } = useI18n()
  const palette = useContext(WallpaperColorPaletteContext)
  const [hsva, setHsva] = useState<Hsva>(() => parseWallpaperHex(value ?? initial) ?? { h: 0, s: 0, v: 0.5, a: 1 })
  // Pointer moves can outrun renders; edits build on the latest color, not the last rendered one.
  const hsvaRef = useRef(hsva)
  hsvaRef.current = hsva
  const hex = toHex(hsva)
  const [hexDraft, setHexDraft] = useState(hex.toUpperCase())
  const [alphaDraft, setAlphaDraft] = useState(String(Math.round(hsva.a * 100)))
  const [recent] = useState(readRecentColors)
  const [themeColors] = useState(() => THEME_SWATCH_VARS.map(resolveWallpaperThemeColor).filter((color): color is string => color !== null))
  const EyeDropper = typeof window !== 'undefined' ? (window as unknown as { EyeDropper?: EyeDropperConstructor }).EyeDropper : undefined

  // Outside edits (undo, the hex field next to the well) move the picker too.
  useEffect(() => {
    const parsed = parseWallpaperHex(value)
    if (!parsed || toHex(parsed) === toHex(hsvaRef.current)) return
    hsvaRef.current = parsed
    setHsva(parsed)
    // Only an outside value change should resync; the local state follows its own edits.
  }, [value])
  useEffect(() => {
    setHexDraft(hex.toUpperCase())
    setAlphaDraft(String(Math.round(hsva.a * 100)))
  }, [hex, hsva.a])

  const update = (patch: Partial<Hsva>) => {
    const next = { ...hsvaRef.current, ...patch }
    hsvaRef.current = next
    setHsva(next)
    onChange(toHex(next))
  }
  const pick = (color: string) => {
    const parsed = parseWallpaperHex(color)
    if (!parsed) return
    hsvaRef.current = parsed
    setHsva(parsed)
    onChange(toHex(parsed))
  }

  const area = usePointerFraction((x, y) => update({ s: x, v: 1 - y }))
  const hue = usePointerFraction((x) => update({ h: x * 360 }))
  const alpha = usePointerFraction((x) => update({ a: x }))
  const opaque = hex.slice(0, 7)

  return (
    <div className="w-64 space-y-3">
      <div
        ref={area.ref}
        role="slider"
        tabIndex={0}
        aria-label={t({ ko: '채도와 밝기', en: 'Saturation and brightness' })}
        aria-valuetext={opaque.toUpperCase()}
        className="relative h-32 cursor-crosshair touch-none rounded-md focus-visible:outline-2 focus-visible:outline-primary"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsva.h} 100% 50%))` }}
        onPointerDown={area.onPointerDown}
        onPointerMove={area.onPointerMove}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 0.1 : 0.01
          const moves: Record<string, Partial<Hsva>> = {
            ArrowLeft: { s: clamp01(hsva.s - step) },
            ArrowRight: { s: clamp01(hsva.s + step) },
            ArrowUp: { v: clamp01(hsva.v + step) },
            ArrowDown: { v: clamp01(hsva.v - step) },
          }
          if (moves[event.key]) { event.preventDefault(); update(moves[event.key]) }
        }}
      >
        <span className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[0_0_0_2px_rgb(255_255_255),0_0_0_3px_rgb(0_0_0/0.4)]" style={{ left: `${hsva.s * 100}%`, top: `${(1 - hsva.v) * 100}%`, background: opaque }} />
      </div>

      <div className="flex items-center gap-2">
        {EyeDropper ? (
          <IconButton
            variant="ghost"
            size="icon-sm"
            label={t({ ko: '화면에서 색 뽑기', en: 'Pick a color from the screen' })}
            onClick={() => {
              new EyeDropper().open().then((result) => pick(result.sRGBHex)).catch(() => undefined)
            }}
          >
            <Pipette />
          </IconButton>
        ) : null}
        <div className="min-w-0 flex-1 space-y-2.5">
          <div
            ref={hue.ref}
            role="slider"
            tabIndex={0}
            aria-label={t({ ko: '색상', en: 'Hue' })}
            aria-valuemin={0}
            aria-valuemax={360}
            aria-valuenow={Math.round(hsva.h)}
            className="relative h-2.5 cursor-pointer touch-none rounded-full focus-visible:outline-2 focus-visible:outline-primary"
            style={{ background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}
            onPointerDown={hue.onPointerDown}
            onPointerMove={hue.onPointerMove}
            onKeyDown={barKeys(hsva.h / 360, (next) => update({ h: next * 360 }))}
          >
            <span className="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[0_0_0_2px_rgb(255_255_255),0_0_0_3px_rgb(0_0_0/0.4)]" style={{ left: `${(hsva.h / 360) * 100}%`, background: `hsl(${hsva.h} 100% 50%)` }} />
          </div>
          <div
            ref={alpha.ref}
            role="slider"
            tabIndex={0}
            aria-label={t({ ko: '불투명도', en: 'Opacity' })}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(hsva.a * 100)}
            className="relative h-2.5 cursor-pointer touch-none rounded-full focus-visible:outline-2 focus-visible:outline-primary"
            style={{ background: `linear-gradient(to right, transparent, ${opaque}), ${CHECKERBOARD}` }}
            onPointerDown={alpha.onPointerDown}
            onPointerMove={alpha.onPointerMove}
            onKeyDown={barKeys(hsva.a, (next) => update({ a: next }))}
          >
            <span className="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[0_0_0_2px_rgb(255_255_255),0_0_0_3px_rgb(0_0_0/0.4)]" style={{ left: `${hsva.a * 100}%`, background: hex }} />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          aria-label="HEX"
          spellCheck={false}
          className="h-8 min-w-0 flex-1 rounded-md bg-field px-2 font-mono text-xs uppercase outline-none focus:ring-1 focus:ring-primary"
          value={hexDraft}
          onChange={(event) => setHexDraft(event.target.value)}
          onBlur={() => { if (!parseWallpaperHex(hexDraft)) setHexDraft(hex.toUpperCase()); else pick(hexDraft.startsWith('#') ? hexDraft : `#${hexDraft}`) }}
          onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
        />
        <label className="flex h-8 w-16 shrink-0 items-center rounded-md bg-field px-2 font-mono text-xs focus-within:ring-1 focus-within:ring-primary">
          <input
            inputMode="numeric"
            aria-label={t({ ko: '불투명도 %', en: 'Opacity %' })}
            className="w-full min-w-0 bg-transparent text-right outline-none"
            value={alphaDraft}
            onChange={(event) => setAlphaDraft(event.target.value)}
            onBlur={() => {
              const parsed = Number(alphaDraft)
              if (!alphaDraft.trim() || !Number.isFinite(parsed)) setAlphaDraft(String(Math.round(hsva.a * 100)))
              else update({ a: clamp01(parsed / 100) })
            }}
            onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
          />
          <span className="text-muted-foreground">%</span>
        </label>
      </div>

      <Swatches label={t({ ko: '최근', en: 'Recent' })} colors={recent} current={hex} onPick={pick} />
      <Swatches label={t({ ko: '이 월페이퍼', en: 'This wallpaper' })} colors={palette.slice(0, 12)} current={hex} onPick={pick} />
      <Swatches label={t({ ko: '테마', en: 'Theme' })} colors={themeColors} current={hex} onPick={pick} />
    </div>
  )
}

/** The color well of an inspector row: shows the color (over a checkerboard for opacity) and opens the picker. */
export function WallpaperColorWell({ value, themeVariable, fallback, mixed = false, label, onChange }: {
  value: string | null
  /** Token the theme color (value null) comes from, so the well shows what the wallpaper draws. */
  themeVariable?: string
  fallback: string
  mixed?: boolean
  label?: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement | null>(null)
  const changedRef = useRef<string | null>(null)
  const [themeColor, setThemeColor] = useState<string | null>(null)
  useEffect(() => {
    if (value !== null || !themeVariable) return
    // Read after paint, when the stage has its theme.
    const frame = window.requestAnimationFrame(() => setThemeColor(resolveWallpaperThemeColor(themeVariable)))
    return () => window.cancelAnimationFrame(frame)
  }, [themeVariable, value])
  const shown = value ?? themeColor ?? fallback

  const close = () => {
    setOpen(false)
    if (changedRef.current) rememberRecentColor(changedRef.current)
    changedRef.current = null
  }

  return (
    <>
      {/* eslint-disable-next-line no-restricted-syntax -- color well: the button face is the chosen color */}
      <button
        ref={anchorRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        className="h-8 w-10 shrink-0 cursor-pointer rounded-md bg-field p-[3px] focus-visible:outline-2 focus-visible:outline-primary aria-expanded:ring-2 aria-expanded:ring-primary"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span
          className="block size-full rounded-[4px]"
          style={{
            background: mixed
              ? 'conic-gradient(#e86a5a 0 25%, #4fb4e8 0 50%, #e8c35a 0 75%, #7fd39f 0)'
              : `linear-gradient(${shown}, ${shown}), ${CHECKERBOARD}`,
          }}
        />
      </button>
      <AnchoredPopup open={open} anchorRef={anchorRef} onClose={close} align="start" className="p-3">
        <ColorPickerPanel
          value={mixed ? null : value}
          initial={shown}
          onChange={(next) => {
            changedRef.current = next
            onChange(next)
          }}
        />
      </AnchoredPopup>
    </>
  )
}
