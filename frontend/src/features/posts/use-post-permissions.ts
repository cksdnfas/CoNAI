import { CONTENT_PERMISSIONS } from '@conai/shared'
import { hasAuthPermission, resolveAccountDraftOwner } from '@/features/auth/auth-permissions'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'

/**
 * What the viewer may do on the posts page: reading opens the board and its own writing (the server checks authorship),
 * reviewing knowledge needs editing. Before accounts exist the local owner may do everything.
 */
export function usePostPermissions() {
  const auth = useAuthStatusQuery().data
  const bootstrap = auth?.hasCredentials === false
  const has = (key: string) => bootstrap || hasAuthPermission(auth?.permissionKeys, key)
  const canRead = has(CONTENT_PERMISSIONS.read)
  return {
    viewerKey: resolveAccountDraftOwner(auth),
    accountId: auth?.accountId ?? null,
    isAdmin: bootstrap || auth?.isAdmin === true,
    canView: canRead,
    canWrite: canRead,
    canComment: canRead,
    canSummon: canRead,
    canEvaluate: canRead,
    canReview: bootstrap || auth?.isAdmin === true || has(CONTENT_PERMISSIONS.edit),
    canViewImages: canRead,
    canViewAudio: canRead,
    canUseFiles: canRead,
  }
}
