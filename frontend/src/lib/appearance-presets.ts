import type { SettingsResourceKey } from '@/i18n/resources/settings'
import type {
  AppearancePreset,
  AppearancePresetSlot,
  AppearanceSettings,
  AppearanceThemeSettings,
  DensityPreset,
  FontPreset,
  GlassPreset,
  RadiusPreset,
  ShadowPreset,
  SurfacePreset,
  ThemeMode,
} from '@/types/settings'

interface AccentPresetDefinition {
  label: string
  description: SettingsResourceKey
  primary: string
  secondary: string
}

export interface SurfacePalette {
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
  description: SettingsResourceKey
  modes: Record<Exclude<ThemeMode, 'system'>, SurfacePalette>
}

interface RadiusPresetDefinition {
  label: string
  description: SettingsResourceKey
  radius: string
}

interface GlassPresetDefinition {
  label: string
  description: SettingsResourceKey
  blur: number
  headerAlpha: number
  floatingAlpha: number
}

interface ShadowPresetDefinition {
  label: string
  description: SettingsResourceKey
  cardBlur: number
  cardOpacity: number
  listBlur: number
  listOpacity: number
  floatingBlur: number
  floatingOpacity: number
}

interface DensityPresetDefinition {
  label: string
  description: SettingsResourceKey
  shellHeaderHeight: string
  shellInlinePadding: string
  shellMainPaddingBottom: string
  cardPaddingX: string
  cardPaddingY: string
  cardGap: string
  fieldGap: string
  controlHeight: string
  controlPaddingX: string
  panelPaddingX: string
  panelPaddingY: string
  drawerHeaderPaddingX: string
  drawerHeaderPaddingY: string
  drawerBodyPaddingX: string
  drawerBodyPaddingY: string
  selectionBarPaddingX: string
  selectionBarPaddingY: string
}

interface FontPresetDefinition {
  label: string
  description: SettingsResourceKey
  fontFamily: string
  monoFamily: string
}

export const APPEARANCE_PRESETS: Record<Exclude<AppearancePreset, 'custom'>, AccentPresetDefinition> = {
  conai: {
    label: 'CoNAI',
    description: 'appearancePresets.accent.conai.description',
    primary: '#f95e14',
    secondary: '#ffb59a',
  },
  ocean: {
    label: 'Ocean',
    description: 'appearancePresets.accent.ocean.description',
    primary: '#2f7cf6',
    secondary: '#8de3df',
  },
  forest: {
    label: 'Forest',
    description: 'appearancePresets.accent.forest.description',
    primary: '#2f8f5b',
    secondary: '#b7e3c5',
  },
}

export const SURFACE_PRESETS: Record<Exclude<SurfacePreset, 'custom'>, SurfacePresetDefinition> = {
  studio: {
    label: 'Studio',
    description: 'appearancePresets.surface.studio.description',
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
    description: 'appearancePresets.surface.midnight.description',
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
    description: 'appearancePresets.surface.paper.description',
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
    description: 'appearancePresets.radius.sharp.description',
    radius: '0.22rem',
  },
  balanced: {
    label: 'Balanced',
    description: 'appearancePresets.radius.balanced.description',
    radius: '0.5rem',
  },
  soft: {
    label: 'Soft',
    description: 'appearancePresets.radius.soft.description',
    radius: '0.95rem',
  },
}

export const GLASS_PRESETS: Record<GlassPreset, GlassPresetDefinition> = {
  subtle: {
    label: 'Subtle',
    description: 'appearancePresets.glass.subtle.description',
    blur: 10,
    headerAlpha: 0.84,
    floatingAlpha: 0.9,
  },
  balanced: {
    label: 'Balanced',
    description: 'appearancePresets.glass.balanced.description',
    blur: 18,
    headerAlpha: 0.72,
    floatingAlpha: 0.88,
  },
  immersive: {
    label: 'Immersive',
    description: 'appearancePresets.glass.immersive.description',
    blur: 28,
    headerAlpha: 0.62,
    floatingAlpha: 0.82,
  },
}

export const SHADOW_PRESETS: Record<ShadowPreset, ShadowPresetDefinition> = {
  soft: {
    label: 'Soft',
    description: 'appearancePresets.shadow.soft.description',
    cardBlur: 28,
    cardOpacity: 0.14,
    listBlur: 32,
    listOpacity: 0.16,
    floatingBlur: 34,
    floatingOpacity: 0.2,
  },
  balanced: {
    label: 'Balanced',
    description: 'appearancePresets.shadow.balanced.description',
    cardBlur: 40,
    cardOpacity: 0.18,
    listBlur: 40,
    listOpacity: 0.18,
    floatingBlur: 40,
    floatingOpacity: 0.28,
  },
  dramatic: {
    label: 'Dramatic',
    description: 'appearancePresets.shadow.dramatic.description',
    cardBlur: 56,
    cardOpacity: 0.24,
    listBlur: 52,
    listOpacity: 0.24,
    floatingBlur: 56,
    floatingOpacity: 0.34,
  },
}

export const DENSITY_PRESETS: Record<DensityPreset, DensityPresetDefinition> = {
  'ultra-compact': {
    label: 'Ultra Compact',
    description: 'appearancePresets.density.ultraCompact.description',
    shellHeaderHeight: '3rem',
    shellInlinePadding: '0.9rem',
    shellMainPaddingBottom: '2.25rem',
    cardPaddingX: '0.8rem',
    cardPaddingY: '0.8rem',
    cardGap: '0.7rem',
    fieldGap: '0.3rem',
    controlHeight: '2.1rem',
    controlPaddingX: '0.6rem',
    panelPaddingX: '0.65rem',
    panelPaddingY: '0.55rem',
    drawerHeaderPaddingX: '0.75rem',
    drawerHeaderPaddingY: '0.55rem',
    drawerBodyPaddingX: '0.75rem',
    drawerBodyPaddingY: '0.75rem',
    selectionBarPaddingX: '0.75rem',
    selectionBarPaddingY: '0.55rem',
  },
  compact: {
    label: 'Compact',
    description: 'appearancePresets.density.compact.description',
    shellHeaderHeight: '3.5rem',
    shellInlinePadding: '1.25rem',
    shellMainPaddingBottom: '3rem',
    cardPaddingX: '1.1rem',
    cardPaddingY: '1.1rem',
    cardGap: '1rem',
    fieldGap: '0.4rem',
    controlHeight: '2.4rem',
    controlPaddingX: '0.75rem',
    panelPaddingX: '0.9rem',
    panelPaddingY: '0.75rem',
    drawerHeaderPaddingX: '1rem',
    drawerHeaderPaddingY: '0.8rem',
    drawerBodyPaddingX: '1rem',
    drawerBodyPaddingY: '1rem',
    selectionBarPaddingX: '1rem',
    selectionBarPaddingY: '0.7rem',
  },
  comfortable: {
    label: 'Comfortable',
    description: 'appearancePresets.density.comfortable.description',
    shellHeaderHeight: '4rem',
    shellInlinePadding: '1.5rem',
    shellMainPaddingBottom: '4rem',
    cardPaddingX: '1.5rem',
    cardPaddingY: '1.5rem',
    cardGap: '1.5rem',
    fieldGap: '0.5rem',
    controlHeight: '2.5rem',
    controlPaddingX: '0.75rem',
    panelPaddingX: '1rem',
    panelPaddingY: '0.75rem',
    drawerHeaderPaddingX: '1.25rem',
    drawerHeaderPaddingY: '1rem',
    drawerBodyPaddingX: '1.25rem',
    drawerBodyPaddingY: '1.25rem',
    selectionBarPaddingX: '1.25rem',
    selectionBarPaddingY: '0.75rem',
  },
  spacious: {
    label: 'Spacious',
    description: 'appearancePresets.density.spacious.description',
    shellHeaderHeight: '4.5rem',
    shellInlinePadding: '1.9rem',
    shellMainPaddingBottom: '5rem',
    cardPaddingX: '1.85rem',
    cardPaddingY: '1.85rem',
    cardGap: '1.85rem',
    fieldGap: '0.65rem',
    controlHeight: '2.9rem',
    controlPaddingX: '0.95rem',
    panelPaddingX: '1.15rem',
    panelPaddingY: '0.95rem',
    drawerHeaderPaddingX: '1.4rem',
    drawerHeaderPaddingY: '1.1rem',
    drawerBodyPaddingX: '1.4rem',
    drawerBodyPaddingY: '1.4rem',
    selectionBarPaddingX: '1.4rem',
    selectionBarPaddingY: '0.95rem',
  },
}

export const FONT_PRESETS: Record<FontPreset, FontPresetDefinition> = {
  manrope: {
    label: 'Manrope',
    description: 'appearancePresets.font.manrope.description',
    fontFamily: "'Manrope', ui-sans-serif, system-ui, sans-serif",
    monoFamily: "'JetBrains Mono', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
  },
  system: {
    label: 'System',
    description: 'appearancePresets.font.system.description',
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    monoFamily: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
  },
  custom: {
    label: 'Custom',
    description: 'appearancePresets.font.custom.description',
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    monoFamily: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
  },
}

export const DEFAULT_APPEARANCE_THEME: AppearanceThemeSettings = {
  themeMode: 'system',
  accentPreset: 'conai',
  customPrimaryColor: APPEARANCE_PRESETS.conai.primary,
  customSecondaryColor: APPEARANCE_PRESETS.conai.secondary,
  surfacePreset: 'studio',
  customSurfaceBackgroundColor: '#131313',
  customSurfaceContainerColor: '#201f1f',
  customSurfaceHighColor: '#2a2a2a',
  radiusPreset: 'balanced',
  glassPreset: 'balanced',
  shadowPreset: 'balanced',
  density: 'comfortable',
  fontPreset: 'manrope',
  customFontFamily: 'Pretendard Variable, Pretendard, Manrope, ui-sans-serif, system-ui, sans-serif',
  customMonoFontFamily: 'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  customFontUrl: '',
  customMonoFontUrl: '',
  customFontFileName: '',
  customMonoFontFileName: '',
  fontScalePercent: 100,
  textScalePercent: 100,
  bodyFontWeightPreset: 'regular',
  emphasisFontWeightPreset: 'standard',
  desktopSearchMinWidth: 1280,
  desktopNavMinWidth: 1280,
  desktopPageColumnsMinWidth: 1280,
  detailRelatedImageMobileColumns: 1,
  detailRelatedImageColumns: 3,
  detailRelatedImageAspectRatio: 'square',
  groupExplorerCardStyle: 'compact-row',
  selectionOutlineWidth: 3,
  positiveBadgeColor: '#34d399',
  negativeBadgeColor: '#fb7185',
  autoBadgeColor: '#38bdf8',
  ratingBadgeColor: '#a78bfa',
}

export const APPEARANCE_PRESET_SLOT_IDS = ['slot-1', 'slot-2', 'slot-3'] as const

export function createDefaultAppearancePresetSlots(): AppearancePresetSlot[] {
  return APPEARANCE_PRESET_SLOT_IDS.map((id, index) => ({
    id,
    label: `Slot ${index + 1}`,
    appearance: null,
    updatedAt: null,
  }))
}

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  ...DEFAULT_APPEARANCE_THEME,
  presetSlots: createDefaultAppearancePresetSlots(),
  wallpaperLayoutPresets: [],
  wallpaperActivePresetId: null,
}
