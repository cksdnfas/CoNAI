import { InMemoryTransport } from '@modelcontextprotocol/client'
import type { ChatExecutionContext } from '@conai/shared'
import { chatPageToolSignature, type McpRequester } from '../../mcp/context'
import type { ChatResearchExecution } from './chatResearch'
import { createMcpServer } from '../../mcp/server'
import { CATALOG_RUN_TOOL, catalogToolNames } from '../../mcp/toolCatalog'
import { inProcessMcpClient, NO_TOOL_DEADLINE } from '../../mcp/inProcessClient'
import type { ChatScope } from './chatSettings'
import type { ChatCompletionTool } from './llmChatCompletion'
import { currentChatPage } from './chatPageBridge'
import { ChatProfileStore } from './chatProfiles'

export type ChatMcpToolResult = { content?: unknown[]; structuredContent?: unknown; isError?: boolean }

/**
 * The CoNAI MCP server, connected in-process for an API LLM chat: the same tools, scope filter and requester
 * ownership as the HTTP endpoint, without a network hop or token. One bridge per reply; close it afterwards.
 */
export async function openChatMcpBridge(requester: McpRequester, scopes: ChatScope[], toolAllowlist: string[] | null = null, options: { generationPresetIds?: number[]; chatContext?: ChatExecutionContext; allowEmpty?: boolean; contentRatingLimit?: number | null; toolCatalog?: boolean; toolCatalogBudget?: () => number; research?: ChatResearchExecution } = {}) {
  const chatTools: ChatCompletionTool[] = []
  const catalogTools = new Set<string>()
  const chatContext = options.chatContext ? { ...options.chatContext } : undefined
  const livePage = () => chatContext?.page ? currentChatPage(requester, chatContext.page) : undefined
  const signature = () => `${chatPageToolSignature(livePage())}|assist:${chatContext ? ChatProfileStore.find(chatContext.profileId)?.pageAssist : false}`
  const connect = async () => {
    const server = createMcpServer({ scopes: [...scopes], requester, source: 'llm-chat', toolAllowlist, generationPresetIds: options.generationPresetIds ?? [], chatContext, contentRatingLimit: options.contentRatingLimit, toolCatalog: options.toolCatalog, toolCatalogBudget: options.toolCatalogBudget, research: options.research })
    const client = inProcessMcpClient({ name: 'conai-llm-chat', version: '1.0.0' })
    try {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      await server.connect(serverTransport)
      await client.connect(clientTransport)
      const { tools } = client.getServerCapabilities()?.tools
        ? await client.listTools().catch((error: unknown) => {
          if (options.allowEmpty && (error as { code?: number }).code === -32601) return { tools: [] }
          throw error
        }) : { tools: [] }
      return { server, client, tools, names: new Set(tools.map(tool => tool.name)), active: 0, retired: false }
    } catch (error) {
      await client.close().catch(() => undefined)
      await server.close().catch(() => undefined)
      throw error
    }
  }
  type Binding = Awaited<ReturnType<typeof connect>>
  const closeBinding = async (binding: Binding) => {
    await binding.client.close().catch(() => undefined)
    await binding.server.close().catch(() => undefined)
  }
  let boundSignature = signature()
  let binding = await connect()
  const publish = () => {
    chatTools.splice(0, chatTools.length, ...binding.tools.map((tool): ChatCompletionTool => ({
      type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
    })))
    catalogTools.clear()
    for (const name of catalogToolNames(binding.server)) catalogTools.add(name)
  }
  publish()
  let refreshing: Promise<boolean> | null = null
  const refresh = (): Promise<boolean> => refreshing ??= (async () => {
    const nextSignature = signature()
    if (nextSignature === boundSignature) return false
    const next = await connect()
    const previous = binding
    binding = next
    boundSignature = nextSignature
    publish()
    previous.retired = true
    if (!previous.active) await closeBinding(previous)
    return true
  })().finally(() => { refreshing = null })

  return {
    tools: chatTools,
    catalogTools,
    refresh,
    async call(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ChatMcpToolResult> {
      signal?.throwIfAborted()
      await refresh()
      const current = binding
      if (catalogTools.has(name) && current.names.has(CATALOG_RUN_TOOL)) {
        args = { tool: name, arguments: args }
        name = CATALOG_RUN_TOOL
      } else if (!current.names.has(name)) {
        return { isError: true, content: [{ type: 'text', text: `Unknown or not permitted tool: ${name}` }] }
      }
      current.active += 1
      try { return await current.client.callTool({ name, arguments: args }, { signal, timeout: NO_TOOL_DEADLINE }) as ChatMcpToolResult }
      finally {
        current.active -= 1
        if (current.retired && !current.active) await closeBinding(current)
        await refresh()
      }
    },
    async close() {
      if (refreshing) await refreshing
      await closeBinding(binding)
    },
  }
}

export type ChatMcpBridge = Awaited<ReturnType<typeof openChatMcpBridge>>
