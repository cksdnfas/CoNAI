import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { CHAT_CHOICE_LIMITS } from '@conai/shared'
import type { McpRequestContext } from '../context'
import { ChatProposalStore } from '../../services/codex-chat/chatProposals'
import { ChatTaskStore } from '../../services/codex-chat/chatTasks'

const result = (value: unknown, extra: Record<string, unknown> = {}) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], ...extra })
const failure = (error: unknown) => ({ isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] })

/**
 * A question with ready answers in a 1:1 chat: the app shows it above the composer, and the person's next message
 * answers it (a click on an option, or their own words). Offered with the chat's other work tools only.
 */
export function registerChatChoiceTools(server: McpServer, context: McpRequestContext) {
  const chat = context.chatContext
  if (!chat || chat.kind !== 'direct') return
  // Same gate as the task tools: a profile with nothing to work with keeps its tool list empty.
  if (context.scopes.length === 0 && !chat.page && !context.generationPresetIds?.length && !ChatTaskStore.live(chat.threadId)) return

  server.tool('offer_choices', 'Ask the person to pick from ready answers. The app shows the question and options above the composer; the person clicks one (several when multiple is true) or types their own answer instead, and that answer arrives as their next message. Use it when a request is ambiguous between a few concrete options, or when you cannot do what was asked as things stand and the person must choose how to go on. Call it once, as the last thing in your reply, then end the reply. Keep the reply text short and do not repeat the options in it.', {
    question: z.string().min(1).max(CHAT_CHOICE_LIMITS.question).describe('The question, in the person\'s language.'),
    options: z.array(z.object({
      label: z.string().min(1).max(CHAT_CHOICE_LIMITS.label).describe('The answer as the person would say it; sent as their message.'),
      detail: z.string().max(CHAT_CHOICE_LIMITS.detail).optional().describe('One short line on what happens with this answer.'),
      without_page: z.boolean().optional().describe('Only while a page is connected: choosing this answer sends that one message without the page, so the tools a page connection withholds are offered for it.'),
    })).min(CHAT_CHOICE_LIMITS.minOptions).max(CHAT_CHOICE_LIMITS.maxOptions),
    multiple: z.boolean().optional().describe('The person may pick several options together.'),
  }, async ({ question, options, multiple }) => {
    try {
      if (!chat.replyId) throw new Error('Choices need an active chat reply.')
      const labels = options.map((option) => option.label.trim())
      if (new Set(labels).size !== labels.length) throw new Error('Each option needs its own label.')
      if (!chat.page && options.some((option) => option.without_page)) throw new Error('without_page needs a connected page; no page is connected to this request.')
      const proposal = ChatProposalStore.add(chat, {
        kind: 'choice',
        question: question.trim(),
        options: options.map((option, index) => ({ label: labels[index], ...(option.detail?.trim() ? { detail: option.detail.trim() } : {}), ...(option.without_page ? { withoutPage: true } : {}) })),
        multiple: multiple === true,
      })
      return result({ proposalId: proposal.id, note: 'The choices are shown above the composer. End your reply now; the answer comes as the person\'s next message.' }, { structuredContent: { proposal } })
    } catch (error) { return failure(error) }
  })
}
