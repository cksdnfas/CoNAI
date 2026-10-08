import { IMAGE_VIEW_PERMISSION } from '@conai/shared'
import { createContext, useContext } from 'react'
import { hasAuthPermission } from './auth-permissions'

/** Feature grants shared by media controls on every page. Page navigation retains its own guard. */
export function resolveImagePermissions(permissionKeys?: string[], authenticated = false) {
  const has = (key: string) => hasAuthPermission(permissionKeys, key)
  const canViewImages = has(IMAGE_VIEW_PERMISSION)
  return {
    canViewImages,
    canOpenDetailPage: canViewImages && has('page.image-detail.view'),
    canOpenMetadataEditor: canViewImages && has('page.metadata-editor.view'),
    canExportImages: canViewImages,
    canEditImages: authenticated && canViewImages && has('images.edit'),
    canEditMetadata: authenticated && canViewImages && has('images.edit'),
    canAssignGroups: authenticated && canViewImages && has('images.edit'),
    canDeleteImages: authenticated && canViewImages && has('images.delete'),
    /** New library items from existing ones (batch resize): editing plus uploading. */
    canCreateImageCopies: authenticated && canViewImages && has('images.edit') && has('images.upload'),
  }
}

export const ImagePermissionsContext = createContext(resolveImagePermissions())

/** Reuse the shell's auth subscription instead of starting an observer for each thumbnail. */
export function useImagePermissions() {
  return useContext(ImagePermissionsContext)
}
