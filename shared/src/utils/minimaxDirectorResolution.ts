export const MINIMAX_H3_DIRECTOR_RESOLUTION_PRESETS = {
  '144p': 0.0352,
  '240p': 0.0977,
  '360p': 0.22,
  '480p': 0.391,
  '540p': 0.494,
  '576p': 0.396,
  '720p': 0.879,
  '900p': 1.373,
  '1024p': 1,
  '1080p': 1.978,
  '1152p': 2.25,
  '1440p': 3.516,
  '2160p': 7.91,
  '2K': 3.906,
  '4K': 7.91,
  '0.26 MP - Preview': 0.26,
  '0.36 MP - Small': 0.36,
  '0.52 MP - SD': 0.52,
  '0.65 MP - Balanced': 0.65,
  '0.83 MP - HD': 0.83,
  '1.00 MP - 1024p': 1,
  '1.05 MP - HD+': 1.05,
  '1.20 MP - HD++': 1.2,
  '1.35 MP - 2K lite': 1.35,
  '1.55 MP - 2K': 1.55,
  '1.65 MP - 2K+': 1.65,
  '1.75 MP - QHD': 1.75,
  '2.10 MP - FHD': 2.1,
  '3.30 MP - QHD+': 3.3,
  '4.75 MP - 2K Pro': 4.75,
  '6.50 MP - Production': 6.5,
  '8.30 MP - UHD': 8.3,
} as const

type NumericBounds = Record<string, { min?: number; max?: number }>
type Resolution = Record<string, unknown>

/** Read a finite resolution number without accepting invalid metadata. */
function finite(value: unknown, fallback: number) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

/** Snap canvas dimensions to the Director's 32-pixel grid. */
function snap(value: number) {
  return Math.max(32, Math.round(value / 32) * 32)
}

/** Resolve both Make and graph canvas dimensions using the same pixel budget. */
export function resolveMiniMaxDirectorCanvas(items: Resolution[], resolution: Resolution): [number, number] {
  if (resolution.resolution === 'custom' && resolution.custom_mode === 'fixed') {
    return [snap(finite(resolution.custom_width, 1344)), snap(finite(resolution.custom_height, 768))]
  }
  const source = items.filter((item) => item.enabled !== false
    && (item.type === 'image' || item.type === 'video')
    && finite(item.source_width, 0) > 0 && finite(item.source_height, 0) > 0)
    .sort((a, b) => finite(a.slot, 0) - finite(b.slot, 0) || finite(a.order, 0) - finite(b.order, 0))[0]
  const [ratioWidth, ratioHeight] = String(resolution.aspect ?? 'auto').split(':').map(Number)
  const aspect = resolution.aspect === 'custom'
    ? Math.max(1, finite(resolution.custom_aspect_w, 16)) / Math.max(1, finite(resolution.custom_aspect_h, 9))
    : ratioWidth > 0 && ratioHeight > 0
      ? ratioWidth / ratioHeight
      : source ? Number(source.source_width) / Number(source.source_height) : 4 / 3
  if (!resolution.resolution || resolution.resolution === 'auto') {
    return aspect >= 1 ? [snap(768 * aspect), 768] : [768, snap(768 / aspect)]
  }
  const preset = resolution.resolution as keyof typeof MINIMAX_H3_DIRECTOR_RESOLUTION_PRESETS
  const megapixels = resolution.resolution === 'custom'
    ? Math.max(0.01, finite(resolution.custom_mp, 1))
    : MINIMAX_H3_DIRECTOR_RESOLUTION_PRESETS[preset] ?? 1
  const height = Math.sqrt(megapixels * 1024 * 1024 / aspect)
  return [snap(height * aspect), snap(height)]
}

/** Apply saved output bounds to timeline metadata and scalar dimensions together. */
export function applyMiniMaxDirectorResolutionBounds<T extends Record<string, unknown>>(
  value: T,
  configuredBounds: Record<string, unknown> = {},
): T {
  const bounds: NumericBounds = {}
  for (const key of ['width', 'height', 'resolution_mp']) {
    const raw = configuredBounds[key]
    if (raw === undefined || raw === null) continue
    if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Invalid Director ${key} bounds`)
    const bound = raw as { min?: number; max?: number }
    for (const limit of [bound.min, bound.max]) {
      if (limit !== undefined && (typeof limit !== 'number' || !Number.isFinite(limit) || (key === 'resolution_mp' && limit < 0.01))) {
        throw new Error(`Invalid Director ${key} bounds`)
      }
    }
    if ((bound.min ?? 0) > (bound.max ?? Infinity)) throw new Error(`Invalid Director ${key} range`)
    bounds[key] = bound
  }
  const hasBound = (key: string) => bounds[key]?.min !== undefined || bounds[key]?.max !== undefined
  if (!['width', 'height', 'resolution_mp'].some(hasBound)) return value
  // Connected timeline inputs are resolved by ComfyUI, not editable local metadata.
  if (Array.isArray(value.timeline_data)) return value
  const parsed = typeof value.timeline_data === 'string' && value.timeline_data.trim()
    ? JSON.parse(value.timeline_data) : {}
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid Director timeline')
  const timeline = { ...parsed }
  const hasResolution = timeline.resolution && typeof timeline.resolution === 'object' && !Array.isArray(timeline.resolution)
  if (!hasResolution && !hasBound('resolution_mp')) return value
  let resolution: Resolution = hasResolution ? { ...timeline.resolution } : {
    resolution: 'custom', custom_mode: 'fixed', custom_width: value.width, custom_height: value.height,
  }
  const items = Array.isArray(timeline.items) ? timeline.items.filter((item: unknown) => item && typeof item === 'object') : []
  let canvas = resolveMiniMaxDirectorCanvas(items, resolution)
  const mpBounds = bounds.resolution_mp
  if (hasBound('resolution_mp')) {
    const preset = resolution.resolution as keyof typeof MINIMAX_H3_DIRECTOR_RESOLUTION_PRESETS
    const fixedOrAuto = resolution.resolution === 'auto' || !resolution.resolution
      || (resolution.resolution === 'custom' && resolution.custom_mode === 'fixed')
    const mp = fixedOrAuto ? canvas[0] * canvas[1] / (1024 * 1024)
      : resolution.resolution === 'custom' ? finite(resolution.custom_mp, 1)
        : MINIMAX_H3_DIRECTOR_RESOLUTION_PRESETS[preset] ?? 1
    const boundedMp = Math.min(mpBounds?.max ?? Infinity, Math.max(mpBounds?.min ?? 0.01, mp))
    if (boundedMp !== mp) {
      resolution = {
        ...resolution, resolution: 'custom', custom_mode: 'mp', custom_mp: boundedMp,
        ...(fixedOrAuto ? { aspect: 'custom', custom_aspect_w: canvas[0], custom_aspect_h: canvas[1] } : {}),
      }
      canvas = resolveMiniMaxDirectorCanvas(items, resolution)
    }
  }
  const boundedCanvas = canvas.map((size, index) => {
    const bound = bounds[index === 0 ? 'width' : 'height']
    const min = Math.max(32, Math.ceil((bound?.min ?? 32) / 32) * 32)
    const max = Math.floor((bound?.max ?? Infinity) / 32) * 32
    if (min > max) throw new Error('Director dimension bounds must contain a multiple of 32')
    return Math.min(max, Math.max(min, size))
  })
  if (boundedCanvas.some((size, index) => size !== canvas[index])) {
    const mp = boundedCanvas[0] * boundedCanvas[1] / (1024 * 1024)
    if (mp < (mpBounds?.min ?? 0) || mp > (mpBounds?.max ?? Infinity)) {
      throw new Error('Director width/height bounds conflict with the resolution MP range')
    }
    resolution = { ...resolution, resolution: 'custom', custom_mode: 'fixed', custom_width: boundedCanvas[0], custom_height: boundedCanvas[1] }
  }
  return {
    ...value,
    ...(Array.isArray(value.width) ? {} : { width: boundedCanvas[0] }),
    ...(Array.isArray(value.height) ? {} : { height: boundedCanvas[1] }),
    timeline_data: JSON.stringify({ ...timeline, resolution }),
  }
}
