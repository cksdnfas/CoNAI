/** Shared auth permission helpers for route and navigation gating. */
export function hasAuthPermission(permissionKeys: string[] | null | undefined, permissionKey: string) {
  if (!permissionKey) {
    return false
  }

  return (permissionKeys ?? []).includes(permissionKey)
}
