/**
 * Native REST routes a plugin page may borrow on a page an administrator shared (manifest `appRoutes`). The core
 * keeps this table: each id names exact methods and paths and the permission keys lent for them, chosen so the
 * route's own guard and handler checks pass while ownership, rating and role rules still apply to the viewer.
 * Deleting keys and administrator routes are never listed.
 */
/** `body`: the parsed request body must pass too (checked when the route's guard asks, after body parsing). */
type RouteRule = readonly [methods: readonly string[], path: RegExp, body?: (body: unknown) => boolean]
const READ = ['GET', 'HEAD'] as const
/** A library media hash, so list, search and statistics routes under the same prefix never match. */
const HASH = '(?:[0-9a-f]{48}|[0-9a-f]{32})'
/** Only ComfyUI workflow runs: NovelAI and Codex spend paid credit the plugin's owner never offered. */
const comfyuiOnly = (body: unknown) => !!body && typeof body === 'object' && (body as { service_type?: unknown }).service_type === 'comfyui'
/** `capability`: lent when the package declares that host feature, not through `appRoutes`. */
type AppRoute = { keys: readonly string[]; rules: readonly RouteRule[]; capability?: 'media.pick' }
const IMAGE_READ: RouteRule = [READ, new RegExp(`^/api/images/${HASH}(?:/(?:file|thumbnail))?$`)]

export const PLUGIN_APP_ROUTES = {
  /** Library media reads: record, original file, thumbnail. */
  'images.read': { keys: ['images.view'], rules: [IMAGE_READ] },
  /** Reads the prompt metadata of a picked file; nothing is stored. */
  'images.extract-metadata': { keys: ['images.view', 'images.upload'], rules: [[['POST'], /^\/api\/images\/extract-metadata$/]] },
  'audio.candidate-file': { keys: ['audio.view'], rules: [[READ, /^\/api\/audio\/candidates\/[^/]+\/file$/]] },
  'files.thumbnail': { keys: ['files.view', 'images.view'], rules: [[READ, /^\/api\/files\/[^/]+\/thumbnail$/]] },
  'refmods.read': { keys: ['workflows.view'], rules: [[READ, /^\/api\/refmods$/]] },
  'workflows.read': { keys: ['workflows.view'], rules: [[READ, /^\/api\/workflows(?:\/\d+(?:\/servers)?)?$/]] },
  'custom-dropdown-lists.read': { keys: ['workflows.view'], rules: [[READ, /^\/api\/custom-dropdown-lists(?:\/by-name\/[^/]+|\/\d+)?$/]] },
  /** Upload, read and release the viewer's own workflow input files. */
  'workflow-input-assets': { keys: ['generation.execute', 'images.view'], rules: [[['POST'], /^\/api\/workflow-input-assets$/], [['GET', 'HEAD', 'DELETE'], /^\/api\/workflow-input-assets\/[a-f0-9]{32}$/]] },
  /** The viewer's own generation records (the route scopes non-administrators to their account). */
  'generation-history.read': { keys: ['images.view'], rules: [[READ, /^\/api\/generation-history(?:\/\d+(?:\/[a-z]+)?)?$/]] },
  /** Queue a ComfyUI workflow run, follow it and cancel it (own jobs only; the workflow's role limits still apply). */
  'generation-queue': { keys: ['generation.execute', 'images.view'], rules: [[['POST'], /^\/api\/generation-queue$/, comfyuiOnly], [READ, /^\/api\/generation-queue\/\d+$/], [['POST'], /^\/api\/generation-queue\/\d+\/cancel$/]] },
  /**
   * The host's media picker (`api.pickMedia`) opened from the window: browse the library and its groups, search, and
   * read the picked records. The host names the window on these requests only while that picker is open.
   */
  'media.pick': { capability: 'media.pick', keys: ['images.view'], rules: [
    IMAGE_READ,
    [READ, /^\/api\/images$/],
    [READ, /^\/api\/groups\/hierarchy\/all$/],
    [READ, /^\/api\/groups\/\d+\/images$/],
    [['POST'], /^\/api\/images\/(?:batch|search\/complex)$/],
  ] },
} as const satisfies Record<string, AppRoute>
export type PluginAppRouteId = keyof typeof PLUGIN_APP_ROUTES

/** Ids a manifest may list in `appRoutes` (capability-bound entries come with their capability instead). */
export const isPluginAppRoute = (id: string): id is PluginAppRouteId =>
  Object.prototype.hasOwnProperty.call(PLUGIN_APP_ROUTES, id) && !(PLUGIN_APP_ROUTES[id as PluginAppRouteId] as AppRoute).capability

/** The ids `appRoutes` accepts, for error messages and guides. */
export const pluginAppRouteIds = () => (Object.keys(PLUGIN_APP_ROUTES) as PluginAppRouteId[]).filter(isPluginAppRoute)

/**
 * Route ids whose rules cover this request (path without its query). Without `body` only method and path are
 * compared (a candidate); pass the parsed body for the final answer.
 */
export function matchPluginAppRoutes(method: string, pathname: string, body?: { value: unknown }): PluginAppRouteId[] {
  return (Object.keys(PLUGIN_APP_ROUTES) as PluginAppRouteId[]).filter((id) =>
    (PLUGIN_APP_ROUTES[id].rules as readonly RouteRule[]).some(([methods, path, accepts]) =>
      methods.includes(method) && path.test(pathname) && (!body || !accepts || accepts(body.value))))
}
