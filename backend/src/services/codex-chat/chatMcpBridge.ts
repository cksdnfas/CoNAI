import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { McpRequester } from '../../mcp/context'
import { createMcpServer } from '../../mcp/server'
import type { ChatScope } from './chatSettings'
import type { ChatCompletionTool } from './llmChatCompletion'

export type ChatMcpToolResult = { content?: unknown[]; structuredContent?: unknown; isError?: boolean }

/**
 * The CoNAI MCP server, connected in-process for an API LLM chat: the same tools, scope filter and requester
 * ownership as the HTTP endpoint, without a network hop or token. One bridge per reply; close it afterwards.
 */
export async function openChatMcpBridge(requester: McpRequester, scopes: ChatScope[], toolAllowlist: string[] | null = null) {
  const server = createMcpServer({ scopes: [...scopes], requester, source: 'llm-chat', toolAllowlist })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'conai-llm-chat', version: '1.0.0' })
  await client.connect(clientTransport)

  const { tools } = await client.listTools()
  const chatTools: ChatCompletionTool[] = tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
  }))
  const toolNames = new Set(tools.map((tool) => tool.name))

  return {
    tools: chatTools,
    async call(name: string, args: Record<string, unknown>): Promise<ChatMcpToolResult> {
      if (!toolNames.has(name)) {
        return { isError: true, content: [{ type: 'text', text: `Unknown or not permitted tool: ${name}` }] }
      }
      return await client.callTool({ name, arguments: args }) as ChatMcpToolResult
    },
    async close() {
      await client.close().catch(() => undefined)
      await server.close().catch(() => undefined)
    },
  }
}

export type ChatMcpBridge = Awaited<ReturnType<typeof openChatMcpBridge>>
