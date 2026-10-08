import { chatPagePermission } from '@conai/shared'

/** Resolve the page key for one app pathname from the shared route map; pages open to every signed-in account have none. */
export function resolveRoutePermissionKey(pathname: string) {
  if (pathname === '/graph') return 'page.generation.view'
  return chatPagePermission(pathname) || null
}
