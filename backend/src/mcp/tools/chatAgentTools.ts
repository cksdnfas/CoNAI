import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { McpRequestContext } from '../context'
import { isChatMcpSource } from '../context'
import { callChatAgent, usableChatAgents } from '../../services/codex-chat/chatAgentCalls'
import { errorResult, textResult } from '../toolResults'

export function registerChatAgentTools(server: McpServer, context: McpRequestContext) {
  const chat = context.chatContext, requester = context.requester
  if (!chat || !requester || !isChatMcpSource(context.source)) return
  if (!context.scopes.length || (context.toolAllowlist && !context.toolAllowlist.includes('call_agent'))) return
  const agents = usableChatAgents(requester, chat).slice(0, 20)
  if (!agents.length) return
  server.registerTool('call_agent', {
    description: `Delegate an instruction to a profile agent in a fresh hidden room. Returns immediately; its result will be posted here. notify only posts; react also wakes this room after generated media finishes. Agents cannot delegate again or create review cards. Available agents (id, name, agentDescription): ${JSON.stringify(agents)}`,
    inputSchema: z.object({
      agent_profile_id: z.number().int().positive(),
      instruction: z.string().trim().min(1).max(20_000),
      media_composite_hashes: z.array(z.string().min(1)).optional().describe('Optional media references to attach; normal chat media access checks apply.'),
      on_done: z.enum(['notify', 'react']).optional().default('notify'),
    }),
  }, async input => {
    try {
      return textResult(callChatAgent(requester, chat, { agentProfileId: input.agent_profile_id, instruction: input.instruction,
        mediaHashes: input.media_composite_hashes, onDone: input.on_done }))
    } catch (error) { return errorResult(error) }
  })
}
