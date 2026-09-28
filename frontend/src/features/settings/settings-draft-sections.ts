import type { SettingsTab } from './settings-tabs'

/** One independently saved settings draft that feeds the page-wide save bar. */
export interface SettingsDraftSection {
  id: string
  /** Already translated section name, shown in the bar and in failure reports. */
  label: string
  /** Tab that renders this section, so the bar can jump back to it. */
  tab: SettingsTab
  isDirty: boolean
  /** Persist the draft; reject with a readable Error so the bar can report it. */
  save: () => Promise<void>
  /** Drop the draft back to the last saved value. */
  discard: () => void
}

export interface SettingsSaveFailure {
  section: SettingsDraftSection
  message: string
}

/**
 * Save every dirty section one after another (they mostly share one settings file on the server),
 * keep going past failures, and return what failed.
 */
export async function saveSettingsDraftSections(sections: SettingsDraftSection[], fallbackMessage: string): Promise<SettingsSaveFailure[]> {
  const failures: SettingsSaveFailure[] = []

  for (const section of sections) {
    try {
      await section.save()
    } catch (error) {
      failures.push({ section, message: error instanceof Error && error.message ? error.message : fallbackMessage })
    }
  }

  return failures
}

export function areSettingsDraftsEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}
