import { CONTENT_PERMISSIONS } from '@conai/shared'
import { createContext, useContext } from 'react'

/**
 * The three basic rights of the current account; every other feature is open once signed in. Page grants only decide
 * which screens open (route guards), never what an action may do.
 */
export function resolveFeaturePermissions(permissionKeys: string[] = [], authenticated = false, isAdmin = false) {
  const has = (key: string) => authenticated && permissionKeys.includes(key)
  return {
    isAdmin: authenticated && isAdmin,
    canRead: has(CONTENT_PERMISSIONS.read),
    canEdit: has(CONTENT_PERMISSIONS.edit),
    canDelete: has(CONTENT_PERMISSIONS.delete),
  }
}

export const FeaturePermissionsContext = createContext(resolveFeaturePermissions())
export const useFeaturePermissions = () => useContext(FeaturePermissionsContext)
