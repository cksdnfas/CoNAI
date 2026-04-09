import type { AppearancePresetSlot, AppearanceSettings, AppearanceThemeSettings } from '@/types/settings'
import { createDefaultAppearancePresetSlots, DEFAULT_APPEARANCE_THEME } from './appearance-presets'
import { normalizeHexPair } from './appearance-color-utils'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isEnumValue<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && options.includes(value as T)
}

export function extractAppearanceTheme(appearance: AppearanceSettings | AppearanceThemeSettings): AppearanceThemeSettings {
  const desktopPageColumnsMinWidth = appearance.desktopPageColumnsMinWidth

  return {
    themeMode: appearance.themeMode,
    accentPreset: appearance.accentPreset,
    customPrimaryColor: appearance.customPrimaryColor,
    customSecondaryColor: appearance.customSecondaryColor,
    surfacePreset: appearance.surfacePreset,
    customSurfaceBackgroundColor: appearance.customSurfaceBackgroundColor,
    customSurfaceLowestColor: appearance.customSurfaceLowestColor,
    customSurfaceLowColor: appearance.customSurfaceLowColor,
    customSurfaceContainerColor: appearance.customSurfaceContainerColor,
    customSurfaceHighColor: appearance.customSurfaceHighColor,
    radiusPreset: appearance.radiusPreset,
    glassPreset: appearance.glassPreset,
    shadowPreset: appearance.shadowPreset,
    density: appearance.density,
    fontPreset: appearance.fontPreset,
    customFontFamily: appearance.customFontFamily,
    customMonoFontFamily: appearance.customMonoFontFamily,
    customFontUrl: appearance.customFontUrl,
    customMonoFontUrl: appearance.customMonoFontUrl,
    customFontFileName: appearance.customFontFileName,
    customMonoFontFileName: appearance.customMonoFontFileName,
    fontScalePercent: appearance.fontScalePercent,
    textScalePercent: appearance.textScalePercent,
    bodyFontWeightPreset: appearance.bodyFontWeightPreset,
    emphasisFontWeightPreset: appearance.emphasisFontWeightPreset,
    desktopSearchMinWidth: desktopPageColumnsMinWidth,
    desktopNavMinWidth: desktopPageColumnsMinWidth,
    desktopPageColumnsMinWidth,
    detailRelatedImageMobileColumns: appearance.detailRelatedImageMobileColumns,
    detailRelatedImageColumns: appearance.detailRelatedImageColumns,
    detailRelatedImageAspectRatio: appearance.detailRelatedImageAspectRatio,
    groupExplorerCardStyle: appearance.groupExplorerCardStyle,
    selectionOutlineWidth: appearance.selectionOutlineWidth,
    positiveBadgeColor: appearance.positiveBadgeColor,
    negativeBadgeColor: appearance.negativeBadgeColor,
    autoBadgeColor: appearance.autoBadgeColor,
    ratingBadgeColor: appearance.ratingBadgeColor,
  }
}

function normalizeAppearanceThemeImport(raw: unknown, fallback: AppearanceThemeSettings): AppearanceThemeSettings | null {
  if (!isRecord(raw)) {
    return null
  }

  const source = isRecord(raw.appearance) ? raw.appearance : raw
  const next: AppearanceThemeSettings = { ...fallback }

  if (source.themeMode !== undefined) {
    if (!isEnumValue(source.themeMode, ['system', 'dark', 'light'])) return null
    next.themeMode = source.themeMode
  }

  if (source.accentPreset !== undefined) {
    if (!isEnumValue(source.accentPreset, ['conai', 'ocean', 'forest', 'custom'])) return null
    next.accentPreset = source.accentPreset
  }

  if (source.customPrimaryColor !== undefined) {
    if (typeof source.customPrimaryColor !== 'string' || !normalizeHexPair(source.customPrimaryColor)) return null
    next.customPrimaryColor = source.customPrimaryColor
  }

  if (source.customSecondaryColor !== undefined) {
    if (typeof source.customSecondaryColor !== 'string' || !normalizeHexPair(source.customSecondaryColor)) return null
    next.customSecondaryColor = source.customSecondaryColor
  }

  if (source.surfacePreset !== undefined) {
    if (!isEnumValue(source.surfacePreset, ['studio', 'midnight', 'paper', 'custom'])) return null
    next.surfacePreset = source.surfacePreset
  }

  const hexAppearanceFields: Array<keyof Pick<AppearanceThemeSettings,
    'customSurfaceBackgroundColor' |
    'customSurfaceLowestColor' |
    'customSurfaceLowColor' |
    'customSurfaceContainerColor' |
    'customSurfaceHighColor' |
    'positiveBadgeColor' |
    'negativeBadgeColor' |
    'autoBadgeColor' |
    'ratingBadgeColor'
  >> = [
    'customSurfaceBackgroundColor',
    'customSurfaceLowestColor',
    'customSurfaceLowColor',
    'customSurfaceContainerColor',
    'customSurfaceHighColor',
    'positiveBadgeColor',
    'negativeBadgeColor',
    'autoBadgeColor',
    'ratingBadgeColor',
  ]

  for (const field of hexAppearanceFields) {
    const value = source[field]
    if (value !== undefined) {
      if (typeof value !== 'string' || !normalizeHexPair(value)) return null
      next[field] = value
    }
  }

  if (source.radiusPreset !== undefined) {
    if (!isEnumValue(source.radiusPreset, ['sharp', 'balanced', 'soft'])) return null
    next.radiusPreset = source.radiusPreset
  }

  if (source.glassPreset !== undefined) {
    if (!isEnumValue(source.glassPreset, ['subtle', 'balanced', 'immersive'])) return null
    next.glassPreset = source.glassPreset
  }

  if (source.shadowPreset !== undefined) {
    if (!isEnumValue(source.shadowPreset, ['soft', 'balanced', 'dramatic'])) return null
    next.shadowPreset = source.shadowPreset
  }

  if (source.density !== undefined) {
    if (!isEnumValue(source.density, ['compact', 'comfortable', 'spacious'])) return null
    next.density = source.density
  }

  if (source.fontPreset !== undefined) {
    if (!isEnumValue(source.fontPreset, ['manrope', 'system', 'custom'])) return null
    next.fontPreset = source.fontPreset
  }

  if (source.bodyFontWeightPreset !== undefined) {
    if (!isEnumValue(source.bodyFontWeightPreset, ['regular', 'medium'])) return null
    next.bodyFontWeightPreset = source.bodyFontWeightPreset
  }

  if (source.emphasisFontWeightPreset !== undefined) {
    if (!isEnumValue(source.emphasisFontWeightPreset, ['standard', 'bold'])) return null
    next.emphasisFontWeightPreset = source.emphasisFontWeightPreset
  }

  if (source.detailRelatedImageAspectRatio !== undefined) {
    if (!isEnumValue(source.detailRelatedImageAspectRatio, ['original', 'square', 'portrait', 'landscape'])) return null
    next.detailRelatedImageAspectRatio = source.detailRelatedImageAspectRatio
  }

  if (source.groupExplorerCardStyle !== undefined) {
    if (!isEnumValue(source.groupExplorerCardStyle, ['compact-row', 'media-tile'])) return null
    next.groupExplorerCardStyle = source.groupExplorerCardStyle
  }

  if (source.customFontFamily !== undefined) {
    if (typeof source.customFontFamily !== 'string') return null
    next.customFontFamily = source.customFontFamily
  }

  if (source.customMonoFontFamily !== undefined) {
    if (typeof source.customMonoFontFamily !== 'string') return null
    next.customMonoFontFamily = source.customMonoFontFamily
  }

  if (source.customFontUrl !== undefined) {
    if (typeof source.customFontUrl !== 'string') return null
    next.customFontUrl = source.customFontUrl
  }

  if (source.customMonoFontUrl !== undefined) {
    if (typeof source.customMonoFontUrl !== 'string') return null
    next.customMonoFontUrl = source.customMonoFontUrl
  }

  if (source.customFontFileName !== undefined) {
    if (typeof source.customFontFileName !== 'string') return null
    next.customFontFileName = source.customFontFileName
  }

  if (source.customMonoFontFileName !== undefined) {
    if (typeof source.customMonoFontFileName !== 'string') return null
    next.customMonoFontFileName = source.customMonoFontFileName
  }

  const boundedIntegerFields: Array<{ key: keyof Pick<AppearanceThemeSettings,
    'fontScalePercent' |
    'textScalePercent' |
    'desktopSearchMinWidth' |
    'desktopNavMinWidth' |
    'desktopPageColumnsMinWidth' |
    'detailRelatedImageMobileColumns' |
    'detailRelatedImageColumns' |
    'selectionOutlineWidth'
  >; min: number; max: number }> = [
    { key: 'fontScalePercent', min: 85, max: 200 },
    { key: 'textScalePercent', min: 85, max: 200 },
    { key: 'desktopSearchMinWidth', min: 640, max: 1600 },
    { key: 'desktopNavMinWidth', min: 768, max: 1800 },
    { key: 'desktopPageColumnsMinWidth', min: 768, max: 1800 },
    { key: 'detailRelatedImageMobileColumns', min: 1, max: 6 },
    { key: 'detailRelatedImageColumns', min: 1, max: 6 },
    { key: 'selectionOutlineWidth', min: 1, max: 8 },
  ]

  for (const { key, min, max } of boundedIntegerFields) {
    const value = source[key]
    if (value !== undefined) {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) return null
      next[key] = value
    }
  }

  next.desktopSearchMinWidth = next.desktopPageColumnsMinWidth
  next.desktopNavMinWidth = next.desktopPageColumnsMinWidth

  if (next.accentPreset === 'custom') {
    if (!normalizeHexPair(next.customPrimaryColor) || !normalizeHexPair(next.customSecondaryColor)) {
      return null
    }
  }

  return next
}

function normalizeAppearancePresetSlot(raw: unknown, fallback: AppearancePresetSlot): AppearancePresetSlot | null {
  if (!isRecord(raw)) {
    return null
  }

  const label = typeof raw.label === 'string' && raw.label.trim().length > 0
    ? raw.label.trim().slice(0, 32)
    : fallback.label
  const updatedAt = typeof raw.updatedAt === 'string' || raw.updatedAt === null ? raw.updatedAt : fallback.updatedAt
  const appearance = raw.appearance === null
    ? null
    : normalizeAppearanceThemeImport(raw.appearance, fallback.appearance ?? DEFAULT_APPEARANCE_THEME)

  if (raw.appearance !== null && appearance === null) {
    return null
  }

  return {
    id: fallback.id,
    label,
    appearance,
    updatedAt,
  }
}

export function normalizeAppearanceSettings(raw: unknown, fallback: AppearanceSettings): AppearanceSettings | null {
  const appearance = normalizeAppearanceThemeImport(raw, extractAppearanceTheme(fallback))
  if (!appearance) {
    return null
  }

  const source = isRecord(raw) && isRecord(raw.appearance) ? raw.appearance : raw
  const fallbackSlots = fallback.presetSlots.length > 0 ? fallback.presetSlots : createDefaultAppearancePresetSlots()

  let presetSlots = fallbackSlots
  if (isRecord(source) && source.presetSlots !== undefined) {
    if (!Array.isArray(source.presetSlots) || source.presetSlots.length !== fallbackSlots.length) {
      return null
    }

    const normalizedSlots = source.presetSlots.map((slot, index) =>
      normalizeAppearancePresetSlot(slot, fallbackSlots[index] ?? createDefaultAppearancePresetSlots()[index]),
    )

    if (normalizedSlots.some((slot) => slot === null)) {
      return null
    }

    presetSlots = normalizedSlots as AppearancePresetSlot[]
  }

  return {
    ...appearance,
    presetSlots,
    wallpaperLayoutPresets: fallback.wallpaperLayoutPresets,
    wallpaperActivePresetId: fallback.wallpaperActivePresetId,
  }
}

export function normalizeAppearanceImport(raw: unknown, fallback: AppearanceSettings): AppearanceSettings | null {
  const appearance = normalizeAppearanceThemeImport(raw, extractAppearanceTheme(fallback))
  if (!appearance) {
    return null
  }

  return {
    ...appearance,
    presetSlots: fallback.presetSlots,
    wallpaperLayoutPresets: fallback.wallpaperLayoutPresets,
    wallpaperActivePresetId: fallback.wallpaperActivePresetId,
  }
}
