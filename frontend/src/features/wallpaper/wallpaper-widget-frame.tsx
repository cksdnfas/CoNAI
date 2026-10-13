import { useMemo, type CSSProperties } from 'react'
import { Text } from '@/components/ui/text'
import { useI18n } from '@/i18n'
import { WallpaperWidgetBody, type WallpaperWidgetPreviewImage } from './wallpaper-widget-bodies'
import type { WallpaperWidgetInstance, WallpaperWidgetStyle } from './wallpaper-types'
import { getWallpaperWidgetDisplayTitle } from './wallpaper-widget-registry'

const SHADOWS: Record<WallpaperWidgetStyle['shadow'], string> = {
  none: 'none',
  sm: '0 2px 10px rgb(0 0 0 / 0.18)',
  md: '0 10px 28px rgb(0 0 0 / 0.28)',
  lg: '0 22px 60px rgb(0 0 0 / 0.42)',
}

export const WALLPAPER_WIDGET_FONTS: Record<WallpaperWidgetStyle['fontFamily'], string | undefined> = {
  inherit: undefined,
  sans: 'var(--font-sans)',
  serif: "'Noto Serif KR', 'Nanum Myeongjo', ui-serif, Georgia, serif",
  mono: 'var(--font-mono)',
  display: "'Manrope', var(--font-sans)",
}

const WEIGHTS: Record<WallpaperWidgetStyle['fontWeight'], number> = { light: 300, regular: 400, bold: 700 }

/** Keyframes for widget entrances; rendered once by the stage. */
export const WALLPAPER_ENTRANCE_KEYFRAMES = `
@keyframes wallpaper-enter-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes wallpaper-enter-rise { from { opacity: 0; transform: translateY(24px) } to { opacity: 1; transform: none } }
@keyframes wallpaper-enter-zoom { from { opacity: 0; transform: scale(0.94) } to { opacity: 1; transform: none } }
@keyframes wallpaper-typing { 0%, 80%, 100% { opacity: 0.25 } 40% { opacity: 1 } }
`

function tint(color: string | null, fallback: string, percent: number) {
  return `color-mix(in srgb, ${color ?? fallback} ${Math.round(percent)}%, transparent)`
}

/** The frame look of one widget: fill, edge, shadow, type and opacity. */
export function getWallpaperWidgetFrameStyle(style: WallpaperWidgetStyle): CSSProperties {
  const blur = style.blur > 0 ? `blur(${style.blur}px) saturate(1.3)` : undefined
  const base: CSSProperties = {
    borderRadius: style.radius,
    padding: style.padding,
    boxShadow: SHADOWS[style.shadow],
    fontFamily: WALLPAPER_WIDGET_FONTS[style.fontFamily],
    fontWeight: WEIGHTS[style.fontWeight],
    letterSpacing: style.fontFamily === 'display' ? '-0.02em' : undefined,
    color: style.textColor ?? undefined,
    ...(style.accentColor ? { '--primary': style.accentColor } as CSSProperties : {}),
    textAlign: style.textAlign,
    opacity: style.opacity / 100,
  }
  switch (style.variant) {
    case 'card':
      return { ...base, background: tint(style.backgroundColor, 'var(--surface-container)', style.backgroundOpacity), backdropFilter: blur }
    case 'glass':
      return {
        ...base,
        background: tint(style.backgroundColor, 'var(--background)', style.backgroundOpacity * 0.55),
        border: '1px solid color-mix(in srgb, var(--foreground) 14%, transparent)',
        backdropFilter: blur ?? 'blur(14px) saturate(1.3)',
      }
    case 'outline':
      return { ...base, border: '1px solid color-mix(in srgb, var(--foreground) 32%, transparent)' }
    default:
      return { ...base, boxShadow: 'none', padding: style.padding }
  }
}

/** One widget as it looks on the wallpaper: frame, optional title and body. */
export function WallpaperWidgetFrame({
  widget,
  mode,
  onOpenImage,
  animateEntrance = false,
}: {
  widget: WallpaperWidgetInstance
  mode: 'editor' | 'runtime'
  onOpenImage?: (image: WallpaperWidgetPreviewImage) => void
  animateEntrance?: boolean
}) {
  const { t } = useI18n()
  const { style } = widget
  const clickAction = 'imageClickAction' in widget.settings ? widget.settings.imageClickAction : undefined
  const handleOpenImage = useMemo(() => {
    if (!onOpenImage || clickAction !== 'open') return onOpenImage
    return (preview: WallpaperWidgetPreviewImage) => {
      const hash = preview.image.composite_hash
      if (hash) window.open(`${window.location.origin}/#/images/${encodeURIComponent(hash)}`, '_blank', 'noopener')
      else onOpenImage(preview)
    }
  }, [clickAction, onOpenImage])
  const entrance = animateEntrance && style.entrance !== 'none'
    ? { animation: `wallpaper-enter-${style.entrance} 700ms cubic-bezier(0.22, 1, 0.36, 1) both` }
    : undefined
  const content = (
    <>
      {style.showTitle ? (
        <Text as="div" variant="overline" className="mb-2 shrink-0 truncate text-xs text-inherit opacity-70">
          {getWallpaperWidgetDisplayTitle(widget, t)}
        </Text>
      ) : null}
      <div className="relative min-h-0 flex-1" style={{ containerType: 'size' }}>
        <WallpaperWidgetBody widget={widget} mode={mode} onOpenImage={handleOpenImage} />
      </div>
    </>
  )
  const scale = style.scale / 100

  return (
    <div
      data-wallpaper-frame=""
      className="flex h-full w-full flex-col overflow-hidden text-foreground"
      style={{ ...getWallpaperWidgetFrameStyle(style), ...entrance }}
    >
      {scale === 1 ? content : (
        // Lay the content out at 1/scale of the frame's inner box, then scale it back to fit: everything inside draws smaller or larger.
        <div className="relative min-h-0 flex-1">
          <div
            className="absolute left-0 top-0 flex flex-col"
            style={{ width: `${100 / scale}%`, height: `${100 / scale}%`, transform: `scale(${scale})`, transformOrigin: '0 0' }}
          >
            {content}
          </div>
        </div>
      )}
    </div>
  )
}
