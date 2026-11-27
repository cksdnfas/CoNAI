import { CONTENT_PERMISSIONS, IMAGE_DETAIL_PAGE_PERMISSION, METADATA_EDITOR_PAGE_PERMISSION } from '@conai/shared'
import { createContext, useContext } from 'react'
import { hasAuthPermission } from './auth-permissions'

/** Media controls on every page, from the account's basic rights. Page navigation retains its own guard. */
export function resolveImagePermissions(permissionKeys?: string[], authenticated = false) {
  const has = (key: string) => hasAuthPermission(permissionKeys, key)
  const canViewImages = has(CONTENT_PERMISSIONS.read)
  const canEditImages = authenticated && has(CONTENT_PERMISSIONS.edit)
  return {
    canViewImages,
    canOpenDetailPage: canViewImages && has(IMAGE_DETAIL_PAGE_PERMISSION),
    canOpenMetadataEditor: canViewImages && has(METADATA_EDITOR_PAGE_PERMISSION),
    canExportImages: canViewImages,
    canEditImages,
    canEditMetadata: canEditImages,
    canAssignGroups: canEditImages,
    canDeleteImages: authenticated && has(CONTENT_PERMISSIONS.delete),
    /** New library items from existing ones (batch resize) are made like generations: reading is enough. */
    canCreateImageCopies: authenticated && canViewImages,
  }
}

export const ImagePermissionsContext = createContext(resolveImagePermissions())

/** Reuse the shell's auth subscription instead of starting an observer for each thumbnail. */
export function useImagePermissions() {
  return useContext(ImagePermissionsContext)
}
