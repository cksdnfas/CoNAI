import type { AppearancePresetSlot, AppearanceSettings } from '@conai/shared'

export interface AppearanceTabProps {
  appearanceDraft: AppearanceSettings | null
  savedAppearance: AppearanceSettings
  isDirty: boolean
  onPatchAppearance: (patch: Partial<AppearanceSettings>) => void
  onReset: () => void
  onExport: () => void
  onImport: (file: File) => void | Promise<void>
  /** File name of an imported package currently previewed on the live theme, or null. */
  importPreviewFileName: string | null
  onApplyImportPreview: () => void
  onRevertImportPreview: () => void
  onSavePresetSlots: (presetSlots: AppearancePresetSlot[]) => void
  onUploadCustomFont: (target: 'sans' | 'mono', file: File) => void | Promise<void>
  onClearCustomFont: (target: 'sans' | 'mono') => void
  isSaving: boolean
  isUploadingFont: boolean
}

export interface AppearanceTabColorValues {
  customPrimaryColorValue: string
  customSecondaryColorValue: string
  customSurfaceBackgroundColorValue: string
  customSurfaceLowestColorValue: string
  customSurfaceLowColorValue: string
  customSurfaceContainerColorValue: string
  customSurfaceHighColorValue: string
  positiveBadgeColorValue: string
  negativeBadgeColorValue: string
  autoBadgeColorValue: string
  ratingBadgeColorValue: string
}
