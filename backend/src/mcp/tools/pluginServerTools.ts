import { fromJsonSchema, type McpServer } from '@modelcontextprotocol/server';
import { callPluginServerTool, pluginServerTools } from '../../services/plugins/pluginServerTools';
import type { McpRequestContext } from '../context';

// The plugin's module checks its own arguments; here they only have to be an object.
const PASS_THROUGH = {
  getValidator: () => (data: unknown) => data && typeof data === 'object' && !Array.isArray(data)
    ? { valid: true as const, data, errorMessage: undefined }
    : { valid: false as const, data: undefined, errorMessage: 'Arguments must be an object.' },
};

/**
 * Tools plugin server modules registered (`p_<plugin>_<tool>`), under the scope each module gave its tool, so each
 * profile's scopes and tool list decide as for any app tool. They run as the requester of the call.
 */
export function registerPluginServerTools(server: McpServer, context: McpRequestContext): void {
  for (const tool of pluginServerTools()) {
    server.registerTool(tool.name, {
      description: `${tool.description || tool.localName} (Plugin tool from ${tool.pluginId}.)`,
      inputSchema: fromJsonSchema(tool.inputSchema as never, PASS_THROUGH as never),
    }, async (args: unknown, extra: unknown) => {
      const signal = (extra as { mcpReq?: { signal?: AbortSignal } } | undefined)?.mcpReq?.signal;
      return await callPluginServerTool(tool.name, (args ?? {}) as Record<string, unknown>, context.requester, signal) as never;
    });
  }
}
