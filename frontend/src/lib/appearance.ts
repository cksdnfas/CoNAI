import type {
  AppearancePreset,
  AppearanceSettings,
  GlassPreset,
  RadiusPreset,
  ShadowPreset,
  SurfacePreset,
  ThemeMode,
} from '@/types/settings'

interface AccentPresetDefinition {
  label: string
  description: string
  primary: string
  secondary: string
}

interface SurfacePalette {
  background: string
  foreground: string
  card: string
  cardForeground: string
  muted: string
  mutedForeground: string
  accent: string
  accentForeground: string
  border: string
  input: string
  surfaceLowest: string
  surfaceLow: string
  surfaceContainer: string
  surfaceHigh: string
  surfaceHighest: string
  surfaceBright: string
}

interface SurfacePresetDefinition {
  label: string
  description: string
  modes: Record<ThemeMode, SurfacePalette>
}

interface RadiusPresetDefinition {
  label: string
  description: string
  radius: string
}

interface GlassPresetDefinition {
  label: string
  description: string
  blur: number
  headerAlpha: number
  floatingAlpha: number
}

interface ShadowPresetDefinition {
  label: string
  description: string
  cardBlur: number
  cardOpacity: number
  listBlur: number
  listOpacity: number
  floatingBlur: number
  floatingOpacity: number
}

export const APPEARANCE_PRESETS: Record<Exclude<AppearancePreset, 'custom'>, AccentPresetDefinition> = {
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

export const SURFACE_PRESETS: Record<SurfacePreset, SurfacePresetDefinition> = {
  studio: {
    label: 'Studio',
    description: '기본 CoNAI 무드에 가장 가까운 중립 다크/라이트 밸런스',
    modes: {
      dark: {
        background: '#131313',
        foreground: '#e5e2e1',
        card: '#1c1b1b',
        cardForeground: '#e5e2e1',
        muted: '#201f1f',
        mutedForeground: '#e3bfb2',
        accent: '#2a2a2a',
        accentForeground: '#e5e2e1',
        border: 'rgb(90 65 56 / 0.15)',
        input: '#0e0e0e',
        surfaceLowest: '#0e0e0e',
        surfaceLow: '#1c1b1b',
        surfaceContainer: '#201f1f',
        surfaceHigh: '#2a2a2a',
        surfaceHighest: '#353534',
        surfaceBright: '#393939',
      },
      light: {
        background: '#f5f2f1',
        foreground: '#241814',
        card: '#ffffff',
        cardForeground: '#241814',
        muted: '#efe6e2',
        mutedForeground: '#7b5f55',
        accent: '#f7ece8',
        accentForeground: '#241814',
        border: 'rgb(90 65 56 / 0.12)',
        input: '#ede3df',
        surfaceLowest: '#ffffff',
        surfaceLow: '#f8f3f1',
        surfaceContainer: '#f2ebe8',
        surfaceHigh: '#e9dfdb',
        surfaceHighest: '#e1d3ce',
        surfaceBright: '#faf6f4',
      },
    },
  },
  midnight: {
    label: 'Midnight',
    description: '차갑고 또렷한 블루 슬레이트 계열',
    modes: {
      dark: {
        background: '#0b1220',
        foreground: '#e8eef8',
        card: '#111b2b',
        cardForeground: '#e8eef8',
        muted: '#132033',
        mutedForeground: '#9fb3d1',
        accent: '#18283d',
        accentForeground: '#e8eef8',
        border: 'rgb(102 130 168 / 0.18)',
        input: '#0b1628',
        surfaceLowest: '#09111d',
        surfaceLow: '#101a29',
        surfaceContainer: '#142033',
        surfaceHigh: '#1b2b42',
        surfaceHighest: '#243752',
        surfaceBright: '#2c4260',
      },
      light: {
        background: '#edf3fb',
        foreground: '#17202c',
        card: '#ffffff',
        cardForeground: '#17202c',
        muted: '#dfe8f4',
        mutedForeground: '#5d7088',
        accent: '#e6eef8',
        accentForeground: '#17202c',
        border: 'rgb(99 128 165 / 0.16)',
        input: '#dde7f4',
        surfaceLowest: '#ffffff',
        surfaceLow: '#f6f9fd',
        surfaceContainer: '#e9f0f8',
        surfaceHigh: '#dde7f3',
        surfaceHighest: '#d0dceb',
        surfaceBright: '#fbfdff',
      },
    },
  },
  paper: {
    label: 'Paper',
    description: '조금 더 에디토리얼한 웜 톤 페이퍼 무드',
    modes: {
      dark: {
        background: '#17120f',
        foreground: '#f1e7dd',
        card: '#211915',
        cardForeground: '#f1e7dd',
        muted: '#261e19',
        mutedForeground: '#d2b8aa',
        accent: '#2c231d',
        accentForeground: '#f1e7dd',
        border: 'rgb(124 94 78 / 0.18)',
        input: '#120e0c',
        surfaceLowest: '#110d0b',
        surfaceLow: '#1d1713',
        surfaceContainer: '#241c17',
        surfaceHigh: '#31261f',
        surfaceHighest: '#3b2f27',
        surfaceBright: '#45372e',
      },
      light: {
        background: '#f8f2ea',
        foreground: '#2d211b',
        card: '#fffdf9',
        cardForeground: '#2d211b',
        muted: '#f0e5d8',
        mutedForeground: '#826657',
        accent: '#f5eadf',
        accentForeground: '#2d211b',
        border: 'rgb(136 101 80 / 0.14)',
        input: '#ebdfd2',
        surfaceLowest: '#fffdf9',
        surfaceLow: '#fbf5ee',
        surfaceContainer: '#f4ece2',
        surfaceHigh: '#ede1d5',
        surfaceHighest: '#e4d4c5',
        surfaceBright: '#fdf9f4',
      },
    },
  },
}

export const RADIUS_PRESETS: Record<RadiusPreset, RadiusPresetDefinition> = {
  sharp: {
    label: 'Sharp',
    description: '도구형 UI에 가까운 각진 모서리',
    radius: '0.22rem',
  },
  balanced: {
    label: 'Balanced',
    description: '현재 CoNAI와 가장 비슷한 균형형',
    radius: '0.5rem',
  },
  soft: {
    label: 'Soft',
    description: '조금 더 둥글고 부드러운 느낌',
    radius: '0.95rem',
  },
}

export const GLASS_PRESETS: Record<GlassPreset, GlassPresetDefinition> = {
  subtle: {
    label: 'Subtle',
    description: '블러를 줄이고 또렷하게',
    blur: 10,
    headerAlpha: 0.84,
    floatingAlpha: 0.9,
  },
  balanced: {
    label: 'Balanced',
    description: '지금 CoNAI 톤과 가장 잘 맞는 기본값',
    blur: 18,
    headerAlpha: 0.72,
    floatingAlpha: 0.88,
  },
  immersive: {
    label: 'Immersive',
    description: '더 유리 같은 오버레이와 강한 블러',
    blur: 28,
    headerAlpha: 0.62,
    floatingAlpha: 0.82,
  },
}

export const SHADOW_PRESETS: Record<ShadowPreset, ShadowPresetDefinition> = {
  soft: {
    label: 'Soft',
    description: '깊이감이 얕고 조용한 그림자',
    cardBlur: 28,
    cardOpacity: 0.14,
    listBlur: 32,
    listOpacity: 0.16,
    floatingBlur: 34,
    floatingOpacity: 0.2,
  },
  balanced: {
    label: 'Balanced',
    description: '기본 CoNAI 무드에 가까운 깊이감',
    cardBlur: 40,
    cardOpacity: 0.18,
    listBlur: 40,
    listOpacity: 0.18,
    floatingBlur: 40,
    floatingOpacity: 0.28,
  },
  dramatic: {
    label: 'Dramatic',
    description: '오버레이와 카드의 존재감을 더 강하게',
    cardBlur: 56,
    cardOpacity: 0.24,
    listBlur: 52,
    listOpacity: 0.24,
    floatingBlur: 56,
    floatingOpacity: 0.34,
  },
}

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  themeMode: 'dark',
  accentPreset: 'conai',
  customPrimaryColor: APPEARANCE_PRESETS.conai.primary,
  customSecondaryColor: APPEARANCE_PRESETS.conai.secondary,
  surfacePreset: 'studio',
  radiusPreset: 'balanced',
  glassPreset: 'balanced',
  shadowPreset: 'balanced',
}

/** Clamp a numeric value into a safe range for theme math. */
function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

/** Parse a hex color into RGB channels for derived theme variables. */
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

/** Convert a number channel into a two-digit hex component. */
function toHex(value: number) {
  return value.toString(16).padStart(2, '0')
}

/** Mix two hex colors to derive softer theme helper tokens. */
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

/** Build an alpha-enabled rgb() string from a hex color. */
function toAlphaColor(color: string, alpha: number) {
  const value = normalizeHexPair(color)
  if (!value) return color
  return `rgb(${value.r} ${value.g} ${value.b} / ${clamp(alpha, 0, 1)})`
}

/** Measure luminance so primary buttons keep readable foreground text. */
function getRelativeLuminance(channel: number) {
  const normalized = channel / 255
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4
}

/** Choose light or dark text based on a background color. */
function getContrastTextColor(background: string) {
  const color = normalizeHexPair(background)
  if (!color) return '#ffffff'

  const luminance =
    0.2126 * getRelativeLuminance(color.r) +
    0.7152 * getRelativeLuminance(color.g) +
    0.0722 * getRelativeLuminance(color.b)

  return luminance > 0.45 ? '#241814' : '#ffffff'
}

/** Resolve the active accent pair from preset or custom inputs. */
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

/** Resolve the active surface palette for the selected mode and mood preset. */
export function resolveSurfacePalette(appearance: AppearanceSettings) {
  return SURFACE_PRESETS[appearance.surfacePreset].modes[appearance.themeMode]
}

/** Build all CSS custom properties consumed by the app theme layer. */
export function buildAppearanceVariables(appearance: AppearanceSettings) {
  const { primary, secondary } = resolveAppearanceColors(appearance)
  const surfacePalette = resolveSurfacePalette(appearance)
  const primaryForeground = getContrastTextColor(primary)
  const secondaryForeground = getContrastTextColor(secondary)
  const ring = appearance.themeMode === 'light' ? primary : secondary
  const tintBase = appearance.themeMode === 'light' ? '#ffffff' : '#0e0e0e'
  const secondaryTintRatio = appearance.themeMode === 'light' ? 0.38 : 0.18
  const glassPreset = GLASS_PRESETS[appearance.glassPreset]
  const shadowPreset = SHADOW_PRESETS[appearance.shadowPreset]
  const shadowBase = appearance.themeMode === 'light' ? '#6b5146' : '#050505'

  return {
    '--radius': RADIUS_PRESETS[appearance.radiusPreset].radius,
    '--background': surfacePalette.background,
    '--foreground': surfacePalette.foreground,
    '--card': surfacePalette.card,
    '--card-foreground': surfacePalette.cardForeground,
    '--muted': surfacePalette.muted,
    '--muted-foreground': surfacePalette.mutedForeground,
    '--accent': surfacePalette.accent,
    '--accent-foreground': surfacePalette.accentForeground,
    '--border': surfacePalette.border,
    '--input': surfacePalette.input,
    '--surface-lowest': surfacePalette.surfaceLowest,
    '--surface-low': surfacePalette.surfaceLow,
    '--surface-container': surfacePalette.surfaceContainer,
    '--surface-high': surfacePalette.surfaceHigh,
    '--surface-highest': surfacePalette.surfaceHighest,
    '--surface-bright': surfacePalette.surfaceBright,
    '--primary': primary,
    '--primary-foreground': primaryForeground,
    '--secondary': secondary,
    '--secondary-foreground': secondaryForeground,
    '--ring': ring,
    '--theme-primary-soft': mixColors(primary, tintBase, 0.82),
    '--theme-secondary-soft': mixColors(secondary, tintBase, secondaryTintRatio),
    '--theme-shell-surface': toAlphaColor(surfacePalette.background, glassPreset.headerAlpha),
    '--theme-floating-surface': toAlphaColor(surfacePalette.surfaceContainer, glassPreset.floatingAlpha),
    '--theme-shell-border': toAlphaColor(secondary, appearance.themeMode === 'light' ? 0.18 : 0.12),
    '--theme-floating-border': toAlphaColor(secondary, appearance.themeMode === 'light' ? 0.22 : 0.16),
    '--theme-header-blur': `${glassPreset.blur + 6}px`,
    '--theme-floating-blur': `${glassPreset.blur}px`,
    '--theme-card-shadow': `0 0 ${shadowPreset.cardBlur}px ${toAlphaColor(shadowBase, shadowPreset.cardOpacity)}`,
    '--theme-list-shadow': `0 0 ${shadowPreset.listBlur}px ${toAlphaColor(shadowBase, shadowPreset.listOpacity)}`,
    '--theme-floating-shadow': `0 0 ${shadowPreset.floatingBlur}px ${toAlphaColor(shadowBase, shadowPreset.floatingOpacity)}`,
  }
}

/** Apply the saved appearance values to document-level CSS variables. */
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
