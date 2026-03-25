import type { ThemeMode } from '@/types/settings'

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
