import type { NextFunction, Request, Response } from 'express'
import { getRequester } from '../routes/requester-session-helpers'
import { requirePluginInstance } from '../services/plugins/pluginHost'
import { matchPluginAppRoutes } from '../services/plugins/pluginAppRoutes'
import { publicScopeRouteKeys, type PluginPublicScope } from '../services/plugins/pluginPublicScope'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** The plugin window this request came from (host header, media query or a server module's grant). Host-set only. */
      pluginPublicScope?: PluginPublicScope
      /** Keys a shared plugin page lends to this one request (live). Never written to the session. */
      pluginLentKeys?: () => readonly string[]
    }
  }
}

/** Header the plugin host adds to a page's native requests; the media query parameter does the same for `<img src>`. */
export const PLUGIN_INSTANCE_HEADER = 'x-conai-plugin-instance'
export const PLUGIN_INSTANCE_QUERY = 'conaiPluginInstance'

/** Reads the window's query parameter and removes it, so routes that validate their query never see it. */
function takeInstanceParam(req: Request): string | undefined {
  const at = req.url.indexOf('?')
  if (at < 0) return undefined
  const params = new URLSearchParams(req.url.slice(at + 1))
  const value = params.get(PLUGIN_INSTANCE_QUERY)
  if (value === null) return undefined
  params.delete(PLUGIN_INSTANCE_QUERY)
  const rest = params.toString()
  req.url = req.url.slice(0, at) + (rest ? `?${rest}` : '')
  return value
}

/**
 * A request from a plugin window (its session must own that window) to a native route the package declared in
 * `appRoutes` borrows that route's keys while the page is shared (pluginPublicScope re-derives them on each check).
 * Every other request, and every failure to resolve the window, passes through unchanged.
 */
export function pluginRouteLending(req: Request, _res: Response, next: NextFunction) {
  const param = takeInstanceParam(req)
  const header = req.get(PLUGIN_INSTANCE_HEADER)
  const instanceId = header ?? param
  if (!req.pluginPublicScope && instanceId && req.session?.authenticated === true && req.sessionID) {
    try { req.pluginPublicScope = requirePluginInstance(instanceId, { requester: getRequester(req), sessionId: req.sessionID }).publicScope }
    catch { /* not this session's live window: no lending */ }
  }
  const scope = req.pluginPublicScope
  if (scope) {
    const pathname = `${req.baseUrl}${req.path}`
    // Read when a guard asks, so rules that look at the parsed body see it.
    if (matchPluginAppRoutes(req.method, pathname).length) req.pluginLentKeys = () => publicScopeRouteKeys(scope, matchPluginAppRoutes(req.method, pathname, { value: req.body }))
  }
  next()
}
