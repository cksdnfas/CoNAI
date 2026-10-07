/** Shared auth permission helpers for route and navigation gating. */
export function hasAuthPermission(permissionKeys: string[] | null | undefined, permissionKey: string) {
  if (!permissionKey) {
    return false
  }

  return (permissionKeys ?? []).includes(permissionKey)
}

/** Keep browser drafts under their captured account identity, separate from bootstrap and anonymous drafts. */
export function resolveAccountDraftOwner(auth: { authenticated: boolean; hasCredentials: boolean; accountId?: number | null } | undefined) {
  if (auth?.authenticated && typeof auth.accountId === 'number') return `account:${auth.accountId}`
  return auth?.authenticated && auth.hasCredentials === false ? 'bootstrap' : 'anonymous'
}
