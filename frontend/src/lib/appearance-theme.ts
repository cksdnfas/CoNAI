import type { AppearanceThemeSettings } from '@/types/settings'
import {
  APPEARANCE_PRESETS,
  DENSITY_PRESETS,
  FONT_PRESETS,
  GLASS_PRESETS,
  RADIUS_PRESETS,
  SHADOW_PRESETS,
  SURFACE_PRESETS,
  type SurfacePalette,
} from './appearance-presets'
import {
  getContrastTextColor,
  getRelativeLuminance,
  mixColors,
  normalizeHexPair,
  resolveThemeMode,
  toAlphaColor,
} from './appearance-color-utils'

const CUSTOM_SANS_FONT_ALIAS = 'CoNAI Uploaded Sans'
const CUSTOM_MONO_FONT_ALIAS = 'CoNAI Uploaded Mono'

const BODY_FONT_WEIGHT_VALUES = {
  regular: '400',
  medium: '500',
} as const

const EMPHASIS_FONT_WEIGHT_VALUES = {
  standard: {
    medium: '500',
    semibold: '600',
    bold: '700',
    extrabold: '800',
  },
  bold: {
    medium: '600',
    semibold: '700',
    bold: '800',
    extrabold: '900',
  },
} as const

export interface AppearanceContrastIssue {
  id: 'primary-text' | 'secondary-text' | 'primary-surface' | 'secondary-surface'
  label: string
  ratio: number
  recommendedRatio: number
  severity: 'warning'
}

export function resolveAppearanceColors(appearance: AppearanceThemeSettings) {
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

export function resolveCustomSurfaceToneColors(appearance: Pick<AppearanceThemeSettings,
  'themeMode' |
  'customSurfaceBackgroundColor' |
  'customSurfaceLowestColor' |
  'customSurfaceLowColor' |
  'customSurfaceContainerColor'
>) {
  const mode = resolveThemeMode(appearance.themeMode)
  const tintBase = mode === 'light' ? '#ffffff' : '#050505'

  return {
    surfaceLowest: appearance.customSurfaceLowestColor ?? mixColors(appearance.customSurfaceBackgroundColor, tintBase, mode === 'light' ? 0.04 : 0.08),
    surfaceLow: appearance.customSurfaceLowColor ?? mixColors(appearance.customSurfaceBackgroundColor, appearance.customSurfaceContainerColor, 0.62),
  }
}

function buildCustomSurfacePalette(appearance: AppearanceThemeSettings, mode: 'dark' | 'light'): SurfacePalette {
  const background = appearance.customSurfaceBackgroundColor
  const { surfaceLowest, surfaceLow } = resolveCustomSurfaceToneColors(appearance)
  const surfaceContainer = appearance.customSurfaceContainerColor
  const surfaceHigh = appearance.customSurfaceHighColor
  const tintBase = mode === 'light' ? '#ffffff' : '#050505'
  const foreground = getContrastTextColor(background)
  const cardForeground = getContrastTextColor(surfaceContainer)
  const accentForeground = getContrastTextColor(surfaceHigh)

  return {
    background,
    foreground,
    card: surfaceContainer,
    cardForeground,
    muted: mixColors(surfaceContainer, background, mode === 'light' ? 0.22 : 0.18),
    mutedForeground: mixColors(foreground, background, mode === 'light' ? 0.46 : 0.34),
    accent: mixColors(surfaceHigh, tintBase, mode === 'light' ? 0.26 : 0.1),
    accentForeground,
    border: toAlphaColor(mixColors(surfaceHigh, foreground, 0.35), mode === 'light' ? 0.18 : 0.22),
    input: mixColors(background, surfaceContainer, 0.48),
    surfaceLowest,
    surfaceLow,
    surfaceContainer,
    surfaceHigh,
    surfaceHighest: mixColors(surfaceHigh, tintBase, mode === 'light' ? 0.16 : 0.22),
    surfaceBright: mixColors(surfaceHigh, '#ffffff', mode === 'light' ? 0.28 : 0.16),
  }
}

export function resolveSurfacePalette(appearance: AppearanceThemeSettings) {
  const mode = resolveThemeMode(appearance.themeMode)
  if (appearance.surfacePreset === 'custom') {
    return buildCustomSurfacePalette(appearance, mode)
  }

  return SURFACE_PRESETS[appearance.surfacePreset].modes[mode]
}

export function buildAppearanceVariables(appearance: AppearanceThemeSettings) {
  const mode = resolveThemeMode(appearance.themeMode)
  const { primary, secondary } = resolveAppearanceColors(appearance)
  const surfacePalette = resolveSurfacePalette(appearance)
  const primaryForeground = getContrastTextColor(primary)
  const secondaryForeground = getContrastTextColor(secondary)
  const ring = mode === 'light' ? primary : secondary
  const tintBase = mode === 'light' ? '#ffffff' : '#0e0e0e'
  const secondaryTintRatio = mode === 'light' ? 0.38 : 0.18
  const glassPreset = GLASS_PRESETS[appearance.glassPreset]
  const shadowPreset = SHADOW_PRESETS[appearance.shadowPreset]
  const densityPreset = DENSITY_PRESETS[appearance.density]
  const fontPreset = FONT_PRESETS[appearance.fontPreset]
  const bodyFontWeight = BODY_FONT_WEIGHT_VALUES[appearance.bodyFontWeightPreset]
  const emphasisFontWeight = EMPHASIS_FONT_WEIGHT_VALUES[appearance.emphasisFontWeightPreset]
  const baseFontFamily = appearance.fontPreset === 'custom' ? appearance.customFontFamily.trim() || fontPreset.fontFamily : fontPreset.fontFamily
  const baseMonoFamily = appearance.fontPreset === 'custom' ? appearance.customMonoFontFamily.trim() || fontPreset.monoFamily : fontPreset.monoFamily
  const fontFamily = appearance.fontPreset === 'custom' && appearance.customFontUrl
    ? `'${CUSTOM_SANS_FONT_ALIAS}', ${baseFontFamily}`
    : baseFontFamily
  const monoFamily = appearance.fontPreset === 'custom' && appearance.customMonoFontUrl
    ? `'${CUSTOM_MONO_FONT_ALIAS}', ${baseMonoFamily}`
    : baseMonoFamily
  const shadowBase = mode === 'light' ? '#6b5146' : '#050505'

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
    '--theme-shell-border': toAlphaColor(secondary, mode === 'light' ? 0.18 : 0.12),
    '--theme-floating-border': toAlphaColor(secondary, mode === 'light' ? 0.22 : 0.16),
    '--theme-header-blur': `${glassPreset.blur + 6}px`,
    '--theme-floating-blur': `${glassPreset.blur}px`,
    '--theme-card-shadow': `0 0 ${shadowPreset.cardBlur}px ${toAlphaColor(shadowBase, shadowPreset.cardOpacity)}`,
    '--theme-list-shadow': `0 0 ${shadowPreset.listBlur}px ${toAlphaColor(shadowBase, shadowPreset.listOpacity)}`,
    '--theme-floating-shadow': `0 0 ${shadowPreset.floatingBlur}px ${toAlphaColor(shadowBase, shadowPreset.floatingOpacity)}`,
    '--theme-shell-header-height': densityPreset.shellHeaderHeight,
    '--theme-shell-inline-padding': densityPreset.shellInlinePadding,
    '--theme-shell-main-padding-bottom': densityPreset.shellMainPaddingBottom,
    '--theme-card-padding-x': densityPreset.cardPaddingX,
    '--theme-card-padding-y': densityPreset.cardPaddingY,
    '--theme-card-gap': densityPreset.cardGap,
    '--theme-field-gap': densityPreset.fieldGap,
    '--theme-control-height': densityPreset.controlHeight,
    '--theme-control-padding-x': densityPreset.controlPaddingX,
    '--theme-panel-padding-x': densityPreset.panelPaddingX,
    '--theme-panel-padding-y': densityPreset.panelPaddingY,
    '--theme-drawer-header-padding-x': densityPreset.drawerHeaderPaddingX,
    '--theme-drawer-header-padding-y': densityPreset.drawerHeaderPaddingY,
    '--theme-drawer-body-padding-x': densityPreset.drawerBodyPaddingX,
    '--theme-drawer-body-padding-y': densityPreset.drawerBodyPaddingY,
    '--theme-selection-bar-padding-x': densityPreset.selectionBarPaddingX,
    '--theme-selection-bar-padding-y': densityPreset.selectionBarPaddingY,
    '--font-sans': fontFamily,
    '--font-mono': monoFamily,
    '--theme-body-font-weight': bodyFontWeight,
    '--font-weight-medium': emphasisFontWeight.medium,
    '--font-weight-semibold': emphasisFontWeight.semibold,
    '--font-weight-bold': emphasisFontWeight.bold,
    '--font-weight-extrabold': emphasisFontWeight.extrabold,
    '--theme-ui-scale': `${appearance.fontScalePercent / 100}`,
    '--theme-text-scale': `${appearance.textScalePercent / 100}`,
    '--theme-selection-outline-width': `${appearance.selectionOutlineWidth}px`,
    '--theme-selection-outline-width-strong': `calc(${appearance.selectionOutlineWidth}px + 1px)`,
    '--theme-badge-positive': appearance.positiveBadgeColor,
    '--theme-badge-positive-soft': toAlphaColor(appearance.positiveBadgeColor, 0.14),
    '--theme-badge-negative': appearance.negativeBadgeColor,
    '--theme-badge-negative-soft': toAlphaColor(appearance.negativeBadgeColor, 0.14),
    '--theme-badge-auto': appearance.autoBadgeColor,
    '--theme-badge-auto-soft': toAlphaColor(appearance.autoBadgeColor, 0.14),
    '--theme-badge-rating': appearance.ratingBadgeColor,
    '--theme-badge-rating-soft': toAlphaColor(appearance.ratingBadgeColor, 0.14),
  }
}

export function getContrastRatio(foreground: string, background: string) {
  const fg = normalizeHexPair(foreground)
  const bg = normalizeHexPair(background)
  if (!fg || !bg) {
    return null
  }

  const luminance = (color: { r: number; g: number; b: number }) =>
    0.2126 * getRelativeLuminance(color.r) +
    0.7152 * getRelativeLuminance(color.g) +
    0.0722 * getRelativeLuminance(color.b)

  const lighter = Math.max(luminance(fg), luminance(bg))
  const darker = Math.min(luminance(fg), luminance(bg))
  return (lighter + 0.05) / (darker + 0.05)
}

export function getAppearanceContrastIssues(appearance: AppearanceThemeSettings): AppearanceContrastIssue[] {
  const { primary, secondary } = resolveAppearanceColors(appearance)
  const surface = resolveSurfacePalette(appearance)
  const checks = [
    {
      id: 'primary-text' as const,
      label: 'Primary text on primary accent',
      ratio: getContrastRatio(getContrastTextColor(primary), primary),
      recommendedRatio: 4.5,
    },
    {
      id: 'secondary-text' as const,
      label: 'Text on secondary accent',
      ratio: getContrastRatio(getContrastTextColor(secondary), secondary),
      recommendedRatio: 4.5,
    },
    {
      id: 'primary-surface' as const,
      label: 'Primary accent against current surface',
      ratio: getContrastRatio(primary, surface.surfaceContainer),
      recommendedRatio: 2.4,
    },
    {
      id: 'secondary-surface' as const,
      label: 'Secondary accent against current surface',
      ratio: getContrastRatio(secondary, surface.surfaceContainer),
      recommendedRatio: 1.8,
    },
  ]

  return checks.flatMap((check) => {
    if (check.ratio === null || check.ratio >= check.recommendedRatio) {
      return []
    }

    return [{
      ...check,
      ratio: Number(check.ratio.toFixed(2)),
      severity: 'warning' as const,
    }]
  })
}

const activeUploadedFontFaces = new Map<string, { url: string; face: FontFace }>()

function ensureUploadedFontFaceLoaded(alias: string, url: string | null | undefined) {
  if (!url || typeof window === 'undefined' || typeof FontFace === 'undefined' || typeof document === 'undefined') {
    return
  }

  const current = activeUploadedFontFaces.get(alias)
  if (current?.url === url) {
    return
  }

  if (current) {
    document.fonts.delete(current.face)
    activeUploadedFontFaces.delete(alias)
  }

  const nextFace = new FontFace(alias, `url("${url}")`)
  void nextFace.load()
    .then((loadedFace) => {
      document.fonts.add(loadedFace)
      activeUploadedFontFaces.set(alias, { url, face: loadedFace })
    })
    .catch(() => {
      // Ignore preview font load failures; the fallback stack still renders.
    })
}

export function applyAppearanceTheme(appearance: AppearanceThemeSettings) {
  if (typeof document === 'undefined') {
    return
  }

  const root = document.documentElement
  const mode = resolveThemeMode(appearance.themeMode)
  root.classList.toggle('light', mode === 'light')
  root.classList.toggle('dark', mode === 'dark')

  if (appearance.fontPreset === 'custom') {
    ensureUploadedFontFaceLoaded(CUSTOM_SANS_FONT_ALIAS, appearance.customFontUrl)
    ensureUploadedFontFaceLoaded(CUSTOM_MONO_FONT_ALIAS, appearance.customMonoFontUrl)
  }

  const variables = buildAppearanceVariables(appearance)
  for (const [key, value] of Object.entries(variables)) {
    root.style.setProperty(key, value)
  }
}
