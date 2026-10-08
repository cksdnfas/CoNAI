import { createContext, useContext } from 'react'

/** Reuse the shell's current auth state; page grants never imply an action grant. */
export function resolveFeaturePermissions(permissionKeys: string[] = [], authenticated = false, isAdmin = false) {
  const has = (key: string) => authenticated && permissionKeys.includes(key)
  return {
    has,
    isAdmin: authenticated && isAdmin,
    canExecuteGeneration: has('generation.execute'),
    canViewWorkflows: has('workflows.view'),
    canUpdateWorkflows: has('workflows.edit'),
    canViewPrompts: has('prompts.view'),
    canCreatePrompts: has('prompts.edit'),
    canUpdatePrompts: has('prompts.edit'),
    canDeletePrompts: has('prompts.edit'),
    canViewWildcards: has('wildcards.view'),
    canEditWildcards: has('wildcards.edit'),
    canDeleteWildcards: has('wildcards.edit'),
    canScanLora: has('wildcards.edit'),
  }
}

export const FeaturePermissionsContext = createContext(resolveFeaturePermissions())
export const useFeaturePermissions = () => useContext(FeaturePermissionsContext)
