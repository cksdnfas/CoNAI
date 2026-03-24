import type { AppearancePreset, AppearanceSettings, ThemeMode } from '@/types/settings'

interface AppearancePresetDefinition {
  label: string
  description: string
  primary: string
  secondary: string
}

export const APPEARANCE_PRESETS: Record<Exclude<AppearancePreset, 'custom'>, AppearancePresetDefinition> = {
  conai: {
    label: 'CoNAI',
    description: '기본 오렌지 아이덴티티',
    primary: '#f95e14',
    secondary: '#ffb59a',
  },
  ocean: {
    label: 'Ocean',
    description: '시원한 블루-민트 조합',
    primary: '#2f7cf6',
    secondary: '#8de3df',
  },
  forest: {
    label: 'Forest',
    description: '차분한 그린-세이지 조합',
    primary: '#2f8f5b',
    secondary: '#b7e3c5',
  },
}

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  themeMode: 'dark',
  accentPreset: 'conai',
  customPrimaryColor: APPEARANCE_PRESETS.conai.primary,
  customSecondaryColor: APPEARANCE_PRESETS.conai.secondary,
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function normalizeHexPair(value: string) {
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

function toHex(value: number) {
  return value.toString(16).padStart(2, '0')
}

function mixColors(colorA: string, colorB: string, ratio: number) {
  const a = normalizeHexPair(colorA)
  const b = normalizeHexPair(colorB)
  if (!a || !b) return colorA

  const weight = clamp(ratio, 0, 1)
  const r = Math.round(a.r + (b.r - a.r) * weight)
  const g = Math.round(a.g + (b.g - a.g) * weight)
  const bChannel = Math.round(a.b + (b.b - a.b) * weight)
  return `#${toHex(r)}${toHex(g)}${toHex(bChannel)}`
}

function getRelativeLuminance(channel: number) {
  const normalized = channel / 255
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4
}

function getContrastTextColor(background: string) {
  const color = normalizeHexPair(background)
  if (!color) return '#ffffff'

  const luminance =
    0.2126 * getRelativeLuminance(color.r) +
    0.7152 * getRelativeLuminance(color.g) +
    0.0722 * getRelativeLuminance(color.b)

  return luminance > 0.45 ? '#241814' : '#ffffff'
}

export function resolveAppearanceColors(appearance: AppearanceSettings) {
  if (appearance.accentPreset === 'custom') {
    return {
      primary: appearance.customPrimaryColor,
      secondary: appearance.customSecondaryColor,
    }
  }

  const preset = APPEARANCE_PRESETS[appearance.accentPreset]
  return {
    primary: preset.primary,
    secondary: preset.secondary,
  }
}

export function buildAppearanceVariables(appearance: AppearanceSettings) {
  const { primary, secondary } = resolveAppearanceColors(appearance)
  const primaryForeground = getContrastTextColor(primary)
  const secondaryForeground = getContrastTextColor(secondary)
  const ring = appearance.themeMode === 'light' ? primary : secondary
  const tintBase = appearance.themeMode === 'light' ? '#ffffff' : '#0e0e0e'
  const secondaryTintRatio = appearance.themeMode === 'light' ? 0.38 : 0.18

  return {
    '--primary': primary,
    '--primary-foreground': primaryForeground,
    '--secondary': secondary,
    '--secondary-foreground': secondaryForeground,
    '--ring': ring,
    '--theme-primary-soft': mixColors(primary, tintBase, 0.82),
    '--theme-secondary-soft': mixColors(secondary, tintBase, secondaryTintRatio),
  }
}

export function applyAppearanceTheme(appearance: AppearanceSettings) {
  if (typeof document === 'undefined') {
    return
  }

  const root = document.documentElement
  const mode: ThemeMode = appearance.themeMode
  root.classList.toggle('light', mode === 'light')
  root.classList.toggle('dark', mode === 'dark')

  const variables = buildAppearanceVariables(appearance)
  for (const [key, value] of Object.entries(variables)) {
    root.style.setProperty(key, value)
  }
}
