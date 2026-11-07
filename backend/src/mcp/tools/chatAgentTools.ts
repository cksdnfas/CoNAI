import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { McpRequestContext } from '../context'
import { isChatMcpSource } from '../context'
import { callChatAgent, usableChatAgents } from '../../services/codex-chat/chatAgentCalls'
import { errorResult, textResult } from '../toolResults'
import { MAX_CHAT_ATTACHMENTS } from '../../services/fileStoreService'

export function registerChatAgentTools(server: McpServer, context: McpRequestContext) {
  const chat = context.chatContext, requester = context.requester
  if (!chat || !requester || !isChatMcpSource(context.source)) return
  if (!context.scopes.length || (context.toolAllowlist && !context.toolAllowlist.includes('call_agent'))) return
  const agents = usableChatAgents(requester, chat).slice(0, 20)
  if (!agents.length) return
  server.registerTool('call_agent', {
    description: 'Delegate to a profile agent in a fresh hidden room. Returns immediately; results post here, do not poll. Agents cannot delegate or create review cards. If a target is refused, choose an available agent.',
    inputSchema: z.object({
      agent_profile_id: z.number().int().positive().describe(`Available agents (id, name, agentDescription): ${JSON.stringify(agents)}`),
      instruction: z.string().trim().min(1).max(20_000),
      media_composite_hashes: z.array(z.string().min(1)).optional().describe('Optional media references to attach; normal chat media access checks apply.'),
      file_ids: z.array(z.string().regex(/^[a-f0-9]{32}$/)).max(MAX_CHAT_ATTACHMENTS).optional().describe('Private files actually attached to this chat to hand to the same-account agent; no other files become readable.'),
      on_done: z.enum(['notify', 'react']).optional().default('notify').describe('notify: post results only; react: also wake this room after generated media finishes.'),
    }),
  }, async input => {
    try {
      return textResult(callChatAgent(requester, chat, { agentProfileId: input.agent_profile_id, instruction: input.instruction,
        mediaHashes: input.media_composite_hashes, fileIds: input.file_ids, onDone: input.on_done }))
    } catch (error) { return errorResult(error) }
  })
}
