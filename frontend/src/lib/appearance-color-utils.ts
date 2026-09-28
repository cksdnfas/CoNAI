import type { ThemeMode } from '@conai/shared'

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function normalizeHexPair(value: string) {
  const sanitized = value.trim().replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(sanitized)) {
    return null
  }

  return {
    r: Number.parseInt(sanitized.slice(0, 2), 16),
    g: Number.parseInt(sanitized.slice(2, 4), 16),
    b: Number.parseInt(sanitized.slice(4, 6), 16),
  }
}

export function toHex(value: number) {
  return value.toString(16).padStart(2, '0')
}

export function mixColors(colorA: string, colorB: string, ratio: number) {
  const a = normalizeHexPair(colorA)
  const b = normalizeHexPair(colorB)
  if (!a || !b) return colorA

  const weight = clamp(ratio, 0, 1)
  const r = Math.round(a.r + (b.r - a.r) * weight)
  const g = Math.round(a.g + (b.g - a.g) * weight)
  const bChannel = Math.round(a.b + (b.b - a.b) * weight)
  return `#${toHex(r)}${toHex(g)}${toHex(bChannel)}`
}

export function resolveThemeMode(mode: ThemeMode): Exclude<ThemeMode, 'system'> {
  if (mode !== 'system') {
    return mode
  }

  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light'
  }

  return 'dark'
}

export function toAlphaColor(color: string, alpha: number) {
  const value = normalizeHexPair(color)
  if (!value) return color
  return `rgb(${value.r} ${value.g} ${value.b} / ${clamp(alpha, 0, 1)})`
}

export function getRelativeLuminance(channel: number) {
  const normalized = channel / 255
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4
}

export function getContrastTextColor(background: string) {
  const color = normalizeHexPair(background)
  if (!color) return '#ffffff'

  const luminance =
    0.2126 * getRelativeLuminance(color.r) +
    0.7152 * getRelativeLuminance(color.g) +
    0.0722 * getRelativeLuminance(color.b)

  return luminance > 0.45 ? '#241814' : '#ffffff'
}

/** CIE L* (0 = black, 100 = white) of a #rrggbb colour; null for anything else. */
export function getPerceivedLightness(color: string) {
  const value = normalizeHexPair(color)
  if (!value) return null

  const luminance =
    0.2126 * getRelativeLuminance(value.r) +
    0.7152 * getRelativeLuminance(value.g) +
    0.0722 * getRelativeLuminance(value.b)

  return luminance > 216 / 24389 ? 116 * Math.cbrt(luminance) - 16 : (24389 / 27) * luminance
}

/**
 * Keep `color` at least `minStep` L* darker than `base`. If it is not, return `base` mixed toward `toward` just far
 * enough to reach the step, so light-theme plinths never blend into the page background.
 */
export function ensureDarkerTone(base: string, color: string, minStep: number, toward = '#000000') {
  const baseLightness = getPerceivedLightness(base)
  const colorLightness = getPerceivedLightness(color)
  if (baseLightness === null || colorLightness === null || baseLightness - colorLightness >= minStep) {
    return color
  }

  let low = 0
  let high = 1
  for (let step = 0; step < 24; step += 1) {
    const middle = (low + high) / 2
    const lightness = getPerceivedLightness(mixColors(base, toward, middle)) ?? 0
    if (baseLightness - lightness >= minStep) {
      high = middle
    } else {
      low = middle
    }
  }

  return mixColors(base, toward, high)
}

function getColorLuminance(color: string) {
  const value = normalizeHexPair(color)
  if (!value) return null
  return 0.2126 * getRelativeLuminance(value.r) + 0.7152 * getRelativeLuminance(value.g) + 0.0722 * getRelativeLuminance(value.b)
}

/** WCAG contrast ratio between two #rrggbb colours; null when either is not a hex colour. */
export function getContrastRatio(colorA: string, colorB: string) {
  const a = getColorLuminance(colorA)
  const b = getColorLuminance(colorB)
  if (a === null || b === null) return null
  const [lighter, darker] = a > b ? [a, b] : [b, a]
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Mix `color` toward `toward` just far enough to reach `minRatio` contrast on every given background.
 * Custom themes can pick any accent/muted colour, so text tokens get a readability floor here.
 */
export function ensureTextContrast(color: string, backgrounds: string[], minRatio: number, toward: string) {
  const meets = (candidate: string) => backgrounds.every((background) => (getContrastRatio(candidate, background) ?? minRatio) >= minRatio)
  if (meets(color)) return color

  for (let step = 1; step <= 20; step += 1) {
    const candidate = mixColors(color, toward, step / 20)
    if (meets(candidate)) return candidate
  }
  return toward
}
