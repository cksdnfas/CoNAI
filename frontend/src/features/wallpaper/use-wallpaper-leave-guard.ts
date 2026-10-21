import { useUnsavedSettingsGuard } from '@/features/settings/use-unsaved-settings-guard'

/** Ask before a reload/close or an in-app route change leaves the editor with unsaved preset edits. */
export function useWallpaperLeaveGuard(hasUnsavedChanges: boolean, confirmMessage: string) {
  useUnsavedSettingsGuard(hasUnsavedChanges, confirmMessage)
}
