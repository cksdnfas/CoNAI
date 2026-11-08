/**
 * MOSS-Image layout prompts: the prompt is a JSON document (`summary` + `items[{label, caption, text, bbox}]`)
 * instead of tags. Boxes default to `yxyx` order in pixels measured from the canvas center (`abs_centralized`).
 */
export interface LayoutPromptRegion {
  index: number
  label: string
  caption: string
  text: string | null
  bbox: [number, number, number, number] | null
}

export interface LayoutPrompt {
  summaryCaption: string | null
  meta: string[]
  canvas: string | null
  regions: LayoutPromptRegion[]
  bboxFormat: string
  bboxCoordSpace: string
  /** Pretty-printed original document. */
  formatted: string
}

export interface LayoutRegionRect {
  left: number
  top: number
  width: number
  height: number
}

/** Same hues for the prompt cards, the thumbnail map and the image overlay so a region keeps its color everywhere. */
const LAYOUT_REGION_COLORS = ['#f95e14', '#4cc9f0', '#ffd166', '#9be564', '#f78fb3', '#b8a1ff']

export function getLayoutRegionColor(index: number) {
  return LAYOUT_REGION_COLORS[index % LAYOUT_REGION_COLORS.length]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function toText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function toBbox(value: unknown): LayoutPromptRegion['bbox'] {
  if (!Array.isArray(value) || value.length !== 4 || !value.every((item) => typeof item === 'number' && Number.isFinite(item))) {
    return null
  }
  return value as [number, number, number, number]
}

/** Returns the parsed layout document, or null when the prompt is an ordinary tag/text prompt. */
export function parseLayoutPrompt(prompt?: string | null): LayoutPrompt | null {
  const trimmed = prompt?.trim()
  if (!trimmed || !trimmed.startsWith('{')) {
    return null
  }

  let data: unknown
  try {
    data = JSON.parse(trimmed)
  } catch {
    return null
  }

  if (!isRecord(data) || (!Array.isArray(data.items) && !isRecord(data.summary))) {
    return null
  }

  const summary = isRecord(data.summary) ? data.summary : {}
  const items = Array.isArray(data.items) ? data.items : []

  return {
    summaryCaption: toText(summary.caption),
    meta: Array.isArray(summary.meta) ? summary.meta.map(toText).filter((item): item is string => item !== null) : [],
    canvas: toText(summary.canvas),
    regions: items.filter(isRecord).map((item, index) => ({
      index,
      label: toText(item.label) ?? 'object',
      caption: toText(item.caption) ?? '',
      text: toText(item.text),
      bbox: toBbox(item.bbox),
    })),
    bboxFormat: toText(data.bbox_format) ?? 'yxyx',
    bboxCoordSpace: toText(data.bbox_coord_space) ?? 'abs_centralized',
    formatted: JSON.stringify(data, null, 2),
  }
}

/** Convert a region box to percentages of the image; null when the box or its coordinate system is unsupported. */
export function getLayoutRegionRect(layout: LayoutPrompt, region: LayoutPromptRegion, width?: number | null, height?: number | null): LayoutRegionRect | null {
  if (!region.bbox || !width || !height || width <= 0 || height <= 0) {
    return null
  }

  const [a, b, c, d] = region.bbox
  let x0: number, y0: number, x1: number, y1: number
  if (layout.bboxFormat === 'yxyx') {
    ;[y0, x0, y1, x1] = [a, b, c, d]
  } else if (layout.bboxFormat === 'xyxy') {
    ;[x0, y0, x1, y1] = [a, b, c, d]
  } else {
    return null
  }

  let originX = 0
  let originY = 0
  if (layout.bboxCoordSpace === 'abs_centralized') {
    originX = width / 2
    originY = height / 2
  } else if (layout.bboxCoordSpace !== 'abs') {
    return null
  }

  const clamp = (value: number) => Math.min(100, Math.max(0, value))
  const left = clamp(((Math.min(x0, x1) + originX) / width) * 100)
  const top = clamp(((Math.min(y0, y1) + originY) / height) * 100)
  const right = clamp(((Math.max(x0, x1) + originX) / width) * 100)
  const bottom = clamp(((Math.max(y0, y1) + originY) / height) * 100)
  return { left, top, width: right - left, height: bottom - top }
}
