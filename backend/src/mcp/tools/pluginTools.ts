import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'
import { listPlugins, getPlugin } from '../../services/plugins/pluginRegistry'
import type { McpRequestContext } from '../context'
import { runPluginServerAction, getPluginAppRequest, cancelPluginAppRequest, pluginActionRunSchema } from '../../services/plugins/pluginAppActions'
import { errorResult, runToolResult as output, textResult } from '../toolResults'

/** Discovery stays small. Action schemas are requested only for one installed page. */
export function registerPluginTools(server: McpServer, context: McpRequestContext) {
  server.registerTool('list_plugin_pages', {
    description: 'Discover enabled extensions and action schemas. Browser actions use page_act; headless server actions use run_plugin_action, whose mutations need approval. If a target is missing, list extensions without filters.',
    inputSchema: z.object({
      pluginId: z.string().max(60).optional().describe('Omit to list extensions; provide for one definition.'),
      pageId: z.string().max(60).optional().describe('With pluginId, include browser actions for this page.'),
      action: z.string().max(100).optional().describe('With pluginId, include this server action\'s schema.'),
      offset: z.number().int().min(0).max(100).default(0),
    }),
  }, async ({ pluginId, pageId, action, offset }) => {
    try {
      const result = pluginId ? (() => {
        const plugin = getPlugin(pluginId).definition
        const pages = plugin.pages.filter(page => !pageId || page.id === pageId)
        return { id: plugin.id, version: plugin.version, serverActions: (plugin.serverActions ?? []).filter(item => !action || action === item.id).map(item => ({ id: item.id, label: item.label, description: item.description, ...(action ? { schema: item.schema, tool: item.tool } : {}) })), pages: pages.map(page => ({ id: page.id, title: page.title, url: `/#/ext/${plugin.id}/${page.id}`, ...(pageId ? { actions: page.actions } : {}) })) }
      })() : (() => {
        const plugins = listPlugins(false)
        return { plugins: plugins.slice(offset, offset + 20).map(({ manifest }) => ({ id: manifest.id, name: manifest.name, version: manifest.version, serverActions: (manifest.serverActions ?? []).map(action => ({ id: action.id, label: action.label })), pages: manifest.pages.map(page => ({ id: page.id, title: page.title, url: `/#/ext/${manifest.id}/${page.id}` })) })), nextOffset: offset + 20 < plugins.length ? offset + 20 : null }
      })()
      return textResult(result)
    } catch (error) { return errorResult(error) }
  })
  server.registerTool('run_plugin_action', { description: 'Run a discovered server action without a page. Reads return results; mutations return pending requests for human Apply in /#/extensions, never saved writes. Check get_plugin_action before retrying interrupted work.', inputSchema: pluginActionRunSchema.extend({
    requestId: pluginActionRunSchema.shape.requestId.describe('Required for mutations; stable key, reused only for identical retries.'),
  }) }, input => output(() => runPluginServerAction(input, { ...context, autoApply: false })))
  server.registerTool('get_plugin_action', { description: 'Read your extension request status and native app result. Pending requires human approval; interrupted/failed writes are never automatically replayed.', inputSchema: z.object({ requestId: z.string().regex(/^[a-f0-9]{48}$/) }) }, ({ requestId }) => output(() => getPluginAppRequest(requestId, context)))
  server.registerTool('cancel_plugin_action', { description: 'Dismiss your pending extension request or request cancellation of its running job. An already dispatched native operation may finish; check the final result. Native generation jobs have their own cancel tools.', inputSchema: z.object({ requestId: z.string().regex(/^[a-f0-9]{48}$/) }) }, ({ requestId }) => output(() => cancelPluginAppRequest(requestId, context)))
}
