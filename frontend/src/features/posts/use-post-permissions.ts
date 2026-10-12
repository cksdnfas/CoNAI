import { hasAuthPermission, resolveAccountDraftOwner } from '@/features/auth/auth-permissions'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'

/** What the viewer may do on the posts page. Before accounts exist the local owner may do everything. */
export function usePostPermissions() {
  const auth = useAuthStatusQuery().data
  const bootstrap = auth?.hasCredentials === false
  const has = (key: string) => bootstrap || hasAuthPermission(auth?.permissionKeys, key)
  return {
    viewerKey: resolveAccountDraftOwner(auth),
    accountId: auth?.accountId ?? null,
    isAdmin: bootstrap || auth?.isAdmin === true,
    canView: has('posts.view'),
    canWrite: has('posts.write'),
    canComment: has('posts.comment'),
    canSummon: has('posts.summon'),
    canEvaluate: has('posts.evaluate'),
    canReview: bootstrap || auth?.isAdmin === true || has('posts.knowledge.review'),
    canViewImages: has('images.view'),
    canViewAudio: has('audio.view'),
    canUseFiles: has('files.view'),
  }
}
