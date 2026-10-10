import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import type { ChatExecutionContext } from '@conai/shared'
import type { McpRequester } from '../../mcp/context'
import { createMcpServer } from '../../mcp/server'
import { CATALOG_RUN_TOOL, catalogToolNames } from '../../mcp/toolCatalog'
import type { ChatScope } from './chatSettings'
import type { ChatCompletionTool } from './llmChatCompletion'

export type ChatMcpToolResult = { content?: unknown[]; structuredContent?: unknown; isError?: boolean }

/**
 * The CoNAI MCP server, connected in-process for an API LLM chat: the same tools, scope filter and requester
 * ownership as the HTTP endpoint, without a network hop or token. One bridge per reply; close it afterwards.
 */
export async function openChatMcpBridge(requester: McpRequester, scopes: ChatScope[], toolAllowlist: string[] | null = null, options: { generationPresetIds?: number[]; chatContext?: ChatExecutionContext; allowEmpty?: boolean; contentRatingLimit?: number | null } = {}) {
  const server = createMcpServer({ scopes: [...scopes], requester, source: 'llm-chat', toolAllowlist, generationPresetIds: options.generationPresetIds ?? [], chatContext: options.chatContext, contentRatingLimit: options.contentRatingLimit })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'conai-llm-chat', version: '1.0.0' })
  await client.connect(clientTransport)

  // A profile with no general tools and no connected page advertises no tools capability.
  const { tools } = client.getServerCapabilities()?.tools
    ? await client.listTools().catch((error: unknown) => {
      if (options.allowEmpty && (error as { code?: number }).code === -32601) return { tools: [] }
      throw error
    })
    : { tools: [] }
  const chatTools: ChatCompletionTool[] = tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
  }))
  const toolNames = new Set(tools.map((tool) => tool.name))
  // The tools behind the catalog (open_tools / run_tool); a model calling one by name directly is routed through it.
  const catalogTools = new Set(catalogToolNames(server))

  return {
    tools: chatTools,
    catalogTools,
    async call(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ChatMcpToolResult> {
      signal?.throwIfAborted()
      if (catalogTools.has(name) && toolNames.has(CATALOG_RUN_TOOL)) {
        return await client.callTool({ name: CATALOG_RUN_TOOL, arguments: { tool: name, arguments: args } }, { signal, timeout: 30 * 60_000 }) as ChatMcpToolResult
      }
      if (!toolNames.has(name)) {
        return { isError: true, content: [{ type: 'text', text: `Unknown or not permitted tool: ${name}` }] }
      }
      return await client.callTool({ name, arguments: args }, { signal }) as ChatMcpToolResult
    },
    async close() {
      await client.close().catch(() => undefined)
      await server.close().catch(() => undefined)
    },
  }
}

export type ChatMcpBridge = Awaited<ReturnType<typeof openChatMcpBridge>>
