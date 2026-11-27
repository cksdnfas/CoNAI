import { CONTENT_PERMISSIONS } from '@conai/shared'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'

/** Native endpoints remain authoritative; this only narrows the page's offered operations. */
export function useChatPagePermissions() {
  const { canRead, canEdit, canDelete } = useFeaturePermissions()
  return { canRead, canEdit, canDelete }
}

/** Reading images and files is the one read right. */
export function useChatPageDataPermissions() {
  const auth = useAuthStatusQuery().data
  const canRead = !!auth?.authenticated && (auth.permissionKeys.includes(CONTENT_PERMISSIONS.read) || auth.hasCredentials === false)
  return { canReadImages: canRead, canReadFiles: canRead }
}
