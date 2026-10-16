import { parsePagination } from './routeValidation'

export const DEFAULT_FILE_VERIFICATION_LOG_LIMIT = 50

export interface FileVerificationSettingsSnapshot {
  enabled: boolean
  interval: number
}

export interface FileVerificationSettingsUpdateResult {
  settings: FileVerificationSettingsSnapshot
  settingsChanged: boolean
}

export interface FileVerificationSettingsUpdateDependencies {
  isFileVerificationEnabled(): boolean
  getFileVerificationInterval(): number
  updateFileVerificationEnabled(enabled: boolean): void
  updateFileVerificationInterval(interval: number): void
  restartScheduler(): void
}

/** Log limit: invalid, missing, or non-positive values fall back; never above 500. */
export function parseFileVerificationLogLimit(value: unknown, fallback = DEFAULT_FILE_VERIFICATION_LOG_LIMIT): number {
  return parsePagination({ limit: value }, { defaultLimit: fallback, maxLimit: 500 }).limit
}

export function readFileVerificationSettings(
  dependencies: Pick<FileVerificationSettingsUpdateDependencies, 'isFileVerificationEnabled' | 'getFileVerificationInterval'>,
): FileVerificationSettingsSnapshot {
  return {
    enabled: dependencies.isFileVerificationEnabled(),
    interval: dependencies.getFileVerificationInterval(),
  }
}

/** Apply the existing permissive settings-update semantics and restart once only when a field changed. */
export function applyFileVerificationSettingsUpdate(
  body: { enabled?: unknown; interval?: unknown },
  dependencies: FileVerificationSettingsUpdateDependencies,
): FileVerificationSettingsUpdateResult {
  const { enabled, interval } = body
  let settingsChanged = false

  if (typeof enabled === 'boolean') {
    dependencies.updateFileVerificationEnabled(enabled)
    settingsChanged = true
  }

  if (typeof interval === 'number') {
    dependencies.updateFileVerificationInterval(interval)
    settingsChanged = true
  }

  if (settingsChanged) {
    dependencies.restartScheduler()
  }

  return {
    settings: readFileVerificationSettings(dependencies),
    settingsChanged,
  }
}
