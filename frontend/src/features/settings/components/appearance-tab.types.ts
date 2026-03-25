import type { AppearancePresetSlot, AppearanceSettings } from '@/types/settings'

export interface AppearanceTabProps {
  appearanceDraft: AppearanceSettings | null
  savedAppearance: AppearanceSettings
  isDirty: boolean
  onPatchAppearance: (patch: Partial<AppearanceSettings>) => void
  onReset: () => void
  onCancel: () => void
  onSave: () => void
  onExport: () => void
  onImport: (file: File) => void | Promise<void>
  onSavePresetSlots: (presetSlots: AppearancePresetSlot[]) => void
  onUploadCustomFont: (target: 'sans' | 'mono', file: File) => void | Promise<void>
  isSaving: boolean
  isUploadingFont: boolean
}

export interface AppearanceTabColorValues {
  customPrimaryColorValue: string
  customSecondaryColorValue: string
  customSurfaceBackgroundColorValue: string
  customSurfaceContainerColorValue: string
  customSurfaceHighColorValue: string
  positiveBadgeColorValue: string
  negativeBadgeColorValue: string
  autoBadgeColorValue: string
  ratingBadgeColorValue: string
}
