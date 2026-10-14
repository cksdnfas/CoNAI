import type { McpRequester } from '../../mcp/context'

/**
 * The tools plugin server modules registered (pluginServerRuntime), as the MCP layer sees them: `p_<plugin>_<tool>`
 * under the scope the plugin gave each one. Kept free of the runtime so mcp/context can read it without a cycle.
 */
export type PluginServerToolScope = 'read' | 'organize' | 'generate' | 'configure'
export const PLUGIN_SERVER_TOOL_SCOPES: readonly PluginServerToolScope[] = ['read', 'organize', 'generate', 'configure']
export type PluginServerTool = {
  name: string; pluginId: string; localName: string; description: string
  inputSchema: Record<string, unknown>; scope: PluginServerToolScope
}
type ToolContent = { type: string; [key: string]: unknown }
export type PluginServerToolResult = { content: ToolContent[]; isError?: boolean }
type Invoker = (tool: PluginServerTool, args: Record<string, unknown>, requester: McpRequester | undefined, signal?: AbortSignal) => Promise<PluginServerToolResult>

const tools = new Map<string, PluginServerTool>()
let invoker: Invoker | null = null

export const PLUGIN_SERVER_TOOL_PREFIX = 'p_'
export function pluginServerToolName(pluginId: string, localName: string) {
  const name = `${PLUGIN_SERVER_TOOL_PREFIX}${pluginId.replace(/-/g, '_')}_${localName}`
  return /^[a-z][a-z0-9_]{1,63}$/.test(name) ? name : null
}
export function setPluginServerTool(tool: PluginServerTool) { tools.set(tool.name, tool) }
export function clearPluginServerTools(pluginId: string) {
  for (const [name, tool] of tools) if (tool.pluginId === pluginId) tools.delete(name)
}
export function pluginServerTools(): PluginServerTool[] {
  return [...tools.values()].sort((a, b) => a.name.localeCompare(b.name))
}
export function findPluginServerTool(name: string) {
  return tools.get(name) ?? null
}
/** Changes when a plugin's tools come or go, so a chat engine holding a tool list (Codex) starts a fresh one. */
export function pluginServerToolsSignature() {
  return pluginServerTools().map(tool => `${tool.name}:${tool.scope}`).join(',')
}
export function setPluginServerToolInvoker(next: Invoker) { invoker = next }
export async function callPluginServerTool(name: string, args: Record<string, unknown>, requester: McpRequester | undefined, signal?: AbortSignal): Promise<PluginServerToolResult> {
  const tool = findPluginServerTool(name)
  if (!tool || !invoker) return { isError: true, content: [{ type: 'text', text: `${name}: 플러그인 서버가 실행 중이 아니야.` }] }
  return invoker(tool, args, requester, signal)
}
