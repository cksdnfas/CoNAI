export interface BackupSourceUpdateValidationInput {
  source_path?: unknown
  target_folder_name?: unknown
}

export interface BackupSourceUpdateValidationPlan {
  validateSourcePath: boolean
  ensureTargetDirectory: boolean
  checkDuplicateSourcePath: boolean
}

export function normalizeOptionalBackupSourceFlag(value: boolean | number | null | undefined, fallback: boolean): boolean {
  if (value === true || value === 1) {
    return true
  }

  if (value === false || value === 0) {
    return false
  }

  return fallback
}

export function getBackupSourceUpdateValidationPlan(updates: object): BackupSourceUpdateValidationPlan {
  const updateFields = updates as BackupSourceUpdateValidationInput
  const sourcePathChanged = updateFields.source_path !== undefined
  const targetFolderChanged = updateFields.target_folder_name !== undefined

  return {
    validateSourcePath: sourcePathChanged,
    ensureTargetDirectory: targetFolderChanged,
    checkDuplicateSourcePath: sourcePathChanged,
  }
}
