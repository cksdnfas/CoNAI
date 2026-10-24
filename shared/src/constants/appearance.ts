import type { AppearancePresetSlot, AppearanceThemeSettings } from '../types/index';

export const DEFAULT_APPEARANCE_THEME: AppearanceThemeSettings = {
  themeMode: 'system',
  accentPreset: 'conai',
  customPrimaryColor: '#f95e14',
  customSecondaryColor: '#ffb59a',
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
};

export const APPEARANCE_PRESET_SLOT_IDS = ['slot-1', 'slot-2', 'slot-3'] as const;

export function createDefaultAppearancePresetSlots(): AppearancePresetSlot[] {
  return APPEARANCE_PRESET_SLOT_IDS.map((id, index) => ({
    id,
    label: `Slot ${index + 1}`,
    appearance: null,
    updatedAt: null,
  }));
}
