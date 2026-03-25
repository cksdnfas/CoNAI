import { DEFAULT_APPEARANCE_SETTINGS, extractAppearanceTheme } from '@/lib/appearance'
import type { AppearancePresetSlot, AppearanceSettings } from '@/types/settings'
import type { AppearanceTabColorValues } from './appearance-tab.types'

export function isHexColor(value: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value)
}

export function areThemesEqual(left: AppearanceSettings | null, right: AppearanceSettings | null) {
  if (!left || !right) {
    return false
  }

  return JSON.stringify(extractAppearanceTheme(left)) === JSON.stringify(extractAppearanceTheme(right))
}

export function areThemeSettingsEqual(left: AppearanceSettings | null, right: AppearancePresetSlot['appearance']) {
  if (!left || !right) {
    return false
  }

  return JSON.stringify(extractAppearanceTheme(left)) === JSON.stringify(right)
}

export function formatSlotTimestamp(value: string | null) {
  if (!value) {
    return '저장 이력 없음'
  }

  return new Date(value).toLocaleString()
}

export function getAppearanceTabColorValues(appearanceDraft: AppearanceSettings | null): AppearanceTabColorValues {
  return {
    customPrimaryColorValue: appearanceDraft && isHexColor(appearanceDraft.customPrimaryColor)
      ? appearanceDraft.customPrimaryColor
      : DEFAULT_APPEARANCE_SETTINGS.customPrimaryColor,
    customSecondaryColorValue: appearanceDraft && isHexColor(appearanceDraft.customSecondaryColor)
      ? appearanceDraft.customSecondaryColor
      : DEFAULT_APPEARANCE_SETTINGS.customSecondaryColor,
    customSurfaceBackgroundColorValue: appearanceDraft && isHexColor(appearanceDraft.customSurfaceBackgroundColor)
      ? appearanceDraft.customSurfaceBackgroundColor
      : DEFAULT_APPEARANCE_SETTINGS.customSurfaceBackgroundColor,
    customSurfaceContainerColorValue: appearanceDraft && isHexColor(appearanceDraft.customSurfaceContainerColor)
      ? appearanceDraft.customSurfaceContainerColor
      : DEFAULT_APPEARANCE_SETTINGS.customSurfaceContainerColor,
    customSurfaceHighColorValue: appearanceDraft && isHexColor(appearanceDraft.customSurfaceHighColor)
      ? appearanceDraft.customSurfaceHighColor
      : DEFAULT_APPEARANCE_SETTINGS.customSurfaceHighColor,
    positiveBadgeColorValue: appearanceDraft && isHexColor(appearanceDraft.positiveBadgeColor)
      ? appearanceDraft.positiveBadgeColor
      : DEFAULT_APPEARANCE_SETTINGS.positiveBadgeColor,
    negativeBadgeColorValue: appearanceDraft && isHexColor(appearanceDraft.negativeBadgeColor)
      ? appearanceDraft.negativeBadgeColor
      : DEFAULT_APPEARANCE_SETTINGS.negativeBadgeColor,
    autoBadgeColorValue: appearanceDraft && isHexColor(appearanceDraft.autoBadgeColor)
      ? appearanceDraft.autoBadgeColor
      : DEFAULT_APPEARANCE_SETTINGS.autoBadgeColor,
    ratingBadgeColorValue: appearanceDraft && isHexColor(appearanceDraft.ratingBadgeColor)
      ? appearanceDraft.ratingBadgeColor
      : DEFAULT_APPEARANCE_SETTINGS.ratingBadgeColor,
  }
}
