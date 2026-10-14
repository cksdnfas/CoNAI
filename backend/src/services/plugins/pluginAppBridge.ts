import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { ALL_MCP_HTTP_SCOPES, type McpRequestContext, type McpRequester } from '../../mcp/context'
import { requireMcpToolAccess } from '../../mcp/toolAccess'
import { validateMcpToolArguments } from '../../mcp/requestSecurity'
import { requireRequesterImagePermission } from '../../middleware/imageAccess'
import { pluginAppToolScope, pluginAppTools } from './pluginAppPolicy'
import { PluginError } from './pluginStore'

export async function withPluginAppClient<T>(context: McpRequestContext, names: string[], use: (client: Client) => Promise<T>): Promise<T> {
  const { createMcpServer } = await import('../../mcp/server')
  const server = createMcpServer({ ...context, source: 'plugin', chatContext: undefined, generationPresetIds: [], generationPresetSnapshot: undefined, omitPluginTools: true, toolCatalog: false, toolAllowlist: names })
  const client = new Client({ name: 'conai-plugin-host', version: '1' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  try { await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]); return await use(client) }
  finally { await client.close().catch(() => undefined); await server.close().catch(() => undefined) }
}
export async function pluginAppDefinitions(context: McpRequestContext, names: string[]) {
  return withPluginAppClient(context, names, async client => {
    const tools: Awaited<ReturnType<Client['listTools']>>['tools'] = []
    let cursor: string | undefined
    do {
      const page = await client.listTools(cursor ? { cursor } : {})
      tools.push(...page.tools); cursor = page.nextCursor
      if (tools.length > 1000) throw new PluginError('도구 목록이 너무 커.')
    } while (cursor)
    return tools
  })
}
export async function callPluginAppTool(context: McpRequestContext, name: string, args: Record<string, unknown>, signal?: AbortSignal) {
  signal?.throwIfAborted()
  if (!pluginAppToolScope(name)) throw new PluginError(`플러그인 실행 문맥에서 지원하지 않는 앱 도구야: ${name}`, 400)
  const native = { ...context, source: 'plugin' as const, chatContext: undefined, generationPresetIds: [], toolAllowlist: [name] }
  requireMcpToolAccess(native, name, args)
  validateMcpToolArguments(args, () => requireRequesterImagePermission(native.requester))
  return withPluginAppClient(native, [name], async client => {
    const result = await client.callTool({ name, arguments: args }, { timeout: 10 * 60_000, signal })
    // Preserve native small image/audio previews as well as text; cap the complete response.
    const safe = { ...result }
    const text = JSON.stringify(safe)
    if (Buffer.byteLength(text) > 512 * 1024) return { isError: Boolean(result.isError), content: [{ type: 'text', text: '결과가 512KB를 넘었어. 조회 범위를 줄이거나 앱에서 생성 이력·작업 결과를 확인해줘.' }], omitted: true }
    return safe
  })
}

/** A server module's calls: every scope, bounded by the requester's own permissions (requireMcpToolAccess). */
function trustedContext(requester: McpRequester, baseUrl?: string, workspace?: McpRequestContext['workspace']): McpRequestContext {
  return { requester, scopes: [...ALL_MCP_HTTP_SCOPES, 'configure'], baseUrl, workspace, source: 'plugin' }
}
export async function callTrustedAppTool(requester: McpRequester | undefined, name: string, args: Record<string, unknown>, baseUrl?: string, workspace?: McpRequestContext['workspace'], signal?: AbortSignal) {
  // Without an account nothing would bound the call; the module's own work runs as the administrator who enabled it.
  if (!requester) throw new PluginError('계정이 연결된 호출에서만 앱 도구를 쓸 수 있어.', 403)
  return callPluginAppTool(trustedContext(requester, baseUrl ?? '/', workspace), name, args, signal)
}
export async function trustedAppToolDefinitions(requester: McpRequester | undefined, baseUrl?: string, workspace?: McpRequestContext['workspace']) {
  if (!requester) throw new PluginError('계정이 연결된 호출에서만 앱 도구를 쓸 수 있어.', 403)
  return pluginAppDefinitions(trustedContext(requester, baseUrl, workspace), pluginAppTools())
}
