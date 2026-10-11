import { cache, IText } from 'fabric'
import { context2d, type Rect } from './raster'

/** Everything needed to draw one text layer again: kept so the text stays editable. */
export type TextSpec = {
  content: string
  fontFamily: string
  fontSize: number
  fill: string
  bold: boolean
  italic: boolean
  align: 'left' | 'center' | 'right'
  strokeWidth: number
  stroke: string
  left: number
  top: number
  angle: number
  scaleX: number
  scaleY: number
}

export type TextStyle = Pick<TextSpec, 'fontFamily' | 'fontSize' | 'bold' | 'italic' | 'align' | 'strokeWidth' | 'stroke'>

/** Google Fonts with Hangul (loaded on first use, like the app's own UI font), then the system faces. */
export const TEXT_FONTS: Array<{ family: string; google: boolean }> = [
  { family: 'Noto Sans KR', google: true },
  { family: 'Noto Serif KR', google: true },
  { family: 'Black Han Sans', google: true },
  { family: 'Do Hyeon', google: true },
  { family: 'Jua', google: true },
  { family: 'Gowun Dodum', google: true },
  { family: 'Nanum Myeongjo', google: true },
  { family: 'Nanum Pen Script', google: true },
  { family: 'Gaegu', google: true },
  { family: 'sans-serif', google: false },
  { family: 'serif', google: false },
]

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: 'Noto Sans KR',
  fontSize: 64,
  bold: true,
  italic: false,
  align: 'left',
  strokeWidth: 0,
  stroke: '#141414',
}

const stylesheets = new Map<string, Promise<void>>()
const stylesheetsReady = new Set<string>()

const isWebFont = (family: string) => Boolean(TEXT_FONTS.find((font) => font.family === family)?.google)

function loadStylesheet(family: string) {
  let pending = stylesheets.get(family)
  if (!pending) {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@400;700&display=swap`
    document.head.appendChild(link)
    pending = new Promise<void>((resolve) => {
      link.onload = () => resolve()
      link.onerror = () => resolve()
    }).then(() => {
      stylesheetsReady.add(family)
    })
    stylesheets.set(family, pending)
  }
  return pending
}

/**
 * Load a Google font (regular and bold) for `sample`; resolves when the browser can draw it (or gave up).
 * Korean faces come in unicode-range slices, so each new run of syllables may need its own load.
 * Fabric keeps glyph widths per family, measured with whatever face was there; they are dropped once the real one is in.
 */
export function ensureFont(family: string, sample = '가A'): Promise<void> {
  if (!isWebFont(family)) return Promise.resolve()
  const text = sample || '가A'
  return loadStylesheet(family)
    .then(() => Promise.all([document.fonts.load(`400 32px "${family}"`, text), document.fonts.load(`700 32px "${family}"`, text)]))
    .then(
      () => {
        cache.clearFontCache(cssFamily(family))
      },
      () => undefined,
    )
}

/** Whether every glyph of `text` is already loaded in this face (system fonts always are). */
export function fontCovers(family: string, text: string) {
  if (!isWebFont(family)) return true
  if (!stylesheetsReady.has(family)) return false
  try {
    return document.fonts.check(`400 32px "${family}"`, text) && document.fonts.check(`700 32px "${family}"`, text)
  } catch {
    return true
  }
}

/** CSS family list for Fabric, quoting named faces so multi-word names work. */
function cssFamily(family: string) {
  return family === 'sans-serif' || family === 'serif' ? family : `"${family}", sans-serif`
}

export function textObjectOptions(spec: TextSpec) {
  return {
    left: spec.left,
    top: spec.top,
    originX: 'left' as const,
    originY: 'top' as const,
    angle: spec.angle,
    scaleX: spec.scaleX,
    scaleY: spec.scaleY,
    fontFamily: cssFamily(spec.fontFamily),
    fontSize: spec.fontSize,
    fill: spec.fill,
    fontWeight: spec.bold ? 'bold' : 'normal',
    fontStyle: spec.italic ? ('italic' as const) : ('normal' as const),
    textAlign: spec.align,
    stroke: spec.strokeWidth > 0 ? spec.stroke : undefined,
    strokeWidth: spec.strokeWidth,
    strokeLineJoin: 'round' as const,
    paintFirst: 'stroke' as const,
    objectCaching: false,
    lockScalingFlip: true,
  }
}

export function createTextObject(spec: TextSpec) {
  return new IText(spec.content, textObjectOptions(spec))
}

/** Read the spec back from an object the user edited (text, moved, scaled, rotated). */
export function specFromObject(object: IText, base: TextSpec): TextSpec {
  return {
    ...base,
    content: object.text ?? '',
    left: object.left,
    top: object.top,
    angle: object.angle,
    scaleX: object.scaleX,
    scaleY: object.scaleY,
  }
}

/** Document-pixel box a spec draws into, padded for the outline and antialiasing. */
export function textBounds(spec: TextSpec): Rect {
  const object = createTextObject(spec)
  const box = object.getBoundingRect()
  const pad = Math.ceil(spec.strokeWidth * Math.max(spec.scaleX, spec.scaleY)) + 4
  return { x: Math.floor(box.left) - pad, y: Math.floor(box.top) - pad, width: Math.ceil(box.width) + pad * 2, height: Math.ceil(box.height) + pad * 2 }
}

/** Draw a spec into a document-sized canvas (cleared first). */
export function renderTextSpec(spec: TextSpec, canvas: HTMLCanvasElement) {
  const context = context2d(canvas)
  context.clearRect(0, 0, canvas.width, canvas.height)
  if (!spec.content) return
  const object = createTextObject(spec)
  context.save()
  object.render(context)
  context.restore()
}

/** Short layer name from the text (first line, trimmed). */
export function textLayerName(content: string) {
  const line = content.split('\n').find((part) => part.trim())?.trim() ?? ''
  return line.length > 24 ? `${line.slice(0, 24)}…` : line
}
