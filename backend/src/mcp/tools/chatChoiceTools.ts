import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { CHAT_CHOICE_LIMITS } from '@conai/shared'
import type { McpRequestContext } from '../context'
import { ChatProposalStore } from '../../services/codex-chat/chatProposals'
import { ChatTaskStore } from '../../services/codex-chat/chatTasks'
import { ChatProfileStore } from '../../services/codex-chat/chatProfiles'
import { requireActiveChatReply } from '../../services/codex-chat/chatReplyRegistry'
import { translateChoice } from '../../services/codex-chat/chatChoices'
import { errorResult as failure, textResult as result } from '../toolResults'
import { isPluginProfileRun } from '../../services/plugins/pluginServerTools'
import { resolveChatAccess, resolveChatProfileToolGrant } from '../../services/codex-chat/codexChatAccess'

/**
 * A question with ready answers in a 1:1 chat: the app shows it above the composer, and the person's next message
 * answers it (a click on an option, or their own words). Offered with the chat's other work tools only.
 */
export function registerChatChoiceTools(server: McpServer, context: McpRequestContext) {
  const chat = context.chatContext
  if (!chat || chat.kind !== 'direct') return
  // Same gate as the task tools: a profile with nothing to work with keeps its tool list empty.
  const profile = isPluginProfileRun(chat.threadId) ? ChatProfileStore.find(chat.profileId) : null
  const scopes = profile && context.requester ? resolveChatProfileToolGrant(profile, resolveChatAccess(context.requester.accountId)).scopes : context.scopes
  if (scopes.length === 0 && !chat.page && !context.generationPresetIds?.length && !ChatTaskStore.live(chat.threadId)) return

  server.registerTool('offer_choices', { description: 'Ask the person to pick from ready answers, shown above the composer: they click one (several if multiple) or type their own, and it arrives as their next message. Use it when a request is ambiguous between a few concrete options, or when they must choose how to go on because you cannot do it as things stand. Call it once, last in your reply, then end the reply; keep the reply text short and do not repeat the options.', inputSchema: z.object({
    question: z.string().min(1).max(CHAT_CHOICE_LIMITS.question).describe('In the person\'s language'),
    options: z.array(z.object({
      label: z.string().min(1).max(CHAT_CHOICE_LIMITS.label).describe('As the person would say it; sent as their message'),
      detail: z.string().max(CHAT_CHOICE_LIMITS.detail).optional().describe('One short line on what it does'),
      without_page: z.boolean().optional().describe('Only with a page connected: send this answer without its page context. Ordinary page connections already preserve granted tools; do not ask to disconnect just to use them'),
    })).min(CHAT_CHOICE_LIMITS.minOptions).max(CHAT_CHOICE_LIMITS.maxOptions),
    multiple: z.boolean().optional(),
  }) }, async ({ question, options, multiple }) => {
    try {
      if (!chat.replyId) throw new Error('Choices need an active chat reply.')
      const labels = options.map((option) => option.label.trim())
      if (new Set(labels).size !== labels.length) throw new Error('Each option needs its own label.')
      if (!chat.page && options.some((option) => option.without_page)) throw new Error('without_page needs a connected page; no page is connected to this request.')
      const { signal } = requireActiveChatReply(chat)
      const profile = ChatProfileStore.find(chat.profileId)
      if (!profile) throw new Error('The chat profile is no longer available.')
      const choice = await translateChoice(profile, {
        kind: 'choice',
        question: question.trim(),
        options: options.map((option, index) => ({ label: labels[index], ...(option.detail?.trim() ? { detail: option.detail.trim() } : {}), ...(option.without_page ? { withoutPage: true } : {}) })),
        multiple: multiple === true,
      }, signal, { threadId: chat.threadId, replyId: chat.replyId })
      requireActiveChatReply(chat)
      const proposal = ChatProposalStore.add(chat, choice)
      return result({ proposalId: proposal.id, note: 'The choices are shown above the composer. End your reply now; the answer comes as the person\'s next message.' }, { structuredContent: { proposal } })
    } catch (error) { return failure(error) }
  })
}
