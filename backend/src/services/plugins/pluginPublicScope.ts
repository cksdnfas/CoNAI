import { z } from 'zod'
import { CONTENT_PERMISSIONS, type PluginCapability, type PluginManifest } from '@conai/shared'
import { getMcpToolScope, type McpRequester } from '../../mcp/context'
import { isAdminOnlyTool, setPublicPluginToolKeys, toolRequirement } from '../../mcp/toolAccess'
import { withRequesterPermissionGrant } from '../../middleware/featureAccess'
import { getPlugin, isPublicPluginPage, pluginLendDigest, publicPageLendDigest } from './pluginRegistry'
import { setPluginPublicImageLending } from '../generation-queue/queueMcpImageGrant'
import { PLUGIN_APP_ROUTES, type PluginAppRouteId } from './pluginAppRoutes'

/**
 * A plugin window's page, set by the host from a live instance (never from a browser or model argument). `action`:
 * the manifest server action the call runs, whose tool is lent only through that action's fixed argument template.
 * Only this marker crosses stored contexts and worker boundaries; the keys it lends are re-derived at every check.
 */
export type PluginPublicScope = { pluginId: string; pageId: string; action?: string }
const idSchema = z.string().regex(/^[a-z][a-z0-9-]{1,47}$/)
export const pluginPublicScopeSchema = z.object({ pluginId: idSchema, pageId: idSchema, action: z.string().max(110).optional() }).strict()

const READ = [CONTENT_PERMISSIONS.read]
const READ_EDIT = [CONTENT_PERMISSIONS.read, CONTENT_PERMISSIONS.edit]
/** Declared tools whose handlers also read library media (their inputs, their results). */
const READS_MEDIA = new Set(['submit_generation_job', 'get_generation_job', 'wait_generation_job', 'get_media_edit_job', 'join_videos', 'save_video_frame'])
type LendableFeature = Exclude<PluginCapability, 'server'>
/** Rights each declared host feature lends on a shared page (generation jobs need only sign-in). */
const FEATURE_KEYS: Record<LendableFeature, readonly string[]> = {
  'files.read': READ, 'files.media': READ, 'files.write': READ_EDIT,
  'workspace.read': READ, 'workspace.media': READ, 'workspace.write': READ_EDIT,
  'media.process': READ_EDIT, 'media.read': READ, 'media.save': READ_EDIT,
  'jobs': [],
  // Lent per request to the host's picker routes instead (pluginAppRoutes 'media.pick').
  'media.pick': [],
}
/** Deleting is never lent, whatever a package declares. */
const lendable = (keys: readonly string[]) => [...new Set(keys)].filter((key) => key !== CONTENT_PERMISSIONS.delete)

/** The package's manifest while the page is shared now, the plugin is on, and the share covers its current declarations. */
function lendingManifest(scope: PluginPublicScope): PluginManifest | null {
  try {
    if (!isPublicPluginPage(scope.pluginId, scope.pageId)) return null
    const manifest = getPlugin(scope.pluginId).definition
    return publicPageLendDigest(scope.pluginId, scope.pageId) === pluginLendDigest(manifest) ? manifest : null
  } catch { return null }
}

/** Keys a shared page lends for one tool: declared in `appTools` (or the running server action's tool), never a role check. */
export function publicScopeToolKeys(scope: PluginPublicScope | undefined, tool: string): string[] {
  if (!scope) return []
  const manifest = lendingManifest(scope)
  if (!manifest) return []
  const declared = manifest.appTools?.includes(tool)
    || (scope.action !== undefined && manifest.serverActions?.some((action) => action.id === scope.action && action.tool === tool))
  // Configure, backup and restore tools are administration, not page features: never lent.
  const toolScope = getMcpToolScope(tool)
  if (!declared || toolScope === 'configure' || toolScope === 'backup' || toolScope === 'restore' || isAdminOnlyTool(tool)) return []
  const requirement = toolRequirement(tool)
  const right = requirement === 'read' ? READ : requirement === 'edit' ? READ_EDIT : []
  return lendable([...right, ...(READS_MEDIA.has(tool) ? READ : [])])
}

/** Keys a shared page lends for host features the package declared (any of `features`). */
export function publicScopeFeatureKeys(scope: PluginPublicScope | undefined, features: LendableFeature | LendableFeature[]): string[] {
  if (!scope) return []
  const manifest = lendingManifest(scope)
  if (!manifest) return []
  const wanted = Array.isArray(features) ? features : [features]
  return lendable(wanted.filter((feature) => manifest.capabilities.includes(feature)).flatMap((feature) => FEATURE_KEYS[feature]))
}

/** Keys a shared page lends for native REST routes the package declared in `appRoutes` (pluginAppRoutes). */
export function publicScopeRouteKeys(scope: PluginPublicScope | undefined, routes: readonly PluginAppRouteId[]): string[] {
  if (!scope || !routes.length) return []
  const manifest = lendingManifest(scope)
  if (!manifest) return []
  const declared = (route: PluginAppRouteId) => {
    const capability = (PLUGIN_APP_ROUTES[route] as { capability?: PluginCapability }).capability
    return capability ? manifest.capabilities.includes(capability) : !!manifest.appRoutes?.includes(route)
  }
  return lendable(routes.filter(declared).flatMap((route) => PLUGIN_APP_ROUTES[route].keys))
}

/** The viewer with a shared page's feature keys added; live, so stopping the share revokes them on the next check. */
export function publicScopeRequester(requester: McpRequester, scope: PluginPublicScope | undefined, features: LendableFeature | LendableFeature[]): McpRequester {
  if (!scope) return requester
  return withRequesterPermissionGrant(requester, () => publicScopeFeatureKeys(scope, features))
}

/** A plugin window's marker, or none when the window belongs to another plugin. */
export function scopeForPlugin(scope: PluginPublicScope | undefined, pluginId: string): PluginPublicScope | undefined {
  return scope && scope.pluginId === pluginId ? pluginPublicScopeSchema.parse(scope) : undefined
}

setPublicPluginToolKeys(publicScopeToolKeys)
// A queued library input submitted through the lent tool or the lent queue route.
setPluginPublicImageLending((scope) => publicScopeToolKeys(scope, 'submit_generation_job').includes(CONTENT_PERMISSIONS.read)
  || publicScopeRouteKeys(scope, ['generation-queue']).includes(CONTENT_PERMISSIONS.read))
