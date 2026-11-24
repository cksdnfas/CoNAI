import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { chatFormLayout, decodeChatForm, describeChatFormFields } from '@conai/shared'
import type { McpRequestContext } from '../context'
import { translateForm } from '../../services/codex-chat/chatChoices'
import { ChatProfileStore } from '../../services/codex-chat/chatProfiles'
import { ChatProposalStore } from '../../services/codex-chat/chatProposals'
import { requireActiveChatReply } from '../../services/codex-chat/chatReplyRegistry'
import { activeMediaFile } from '../../services/codex-chat/chatCardAssets'
import { errorResult as failure, textResult as result } from '../toolResults'
import { offersChatWorkTools } from './chatTaskTools'

/**
 * An input card in a 1:1 chat: several values asked at once, drawn under the reply and answered by the person's next
 * message (the pressed button and the values), like a question card. The call is the compact `fields` format (or an
 * A2UI `createSurface` subset), decoded to the stored card by shared chatFormFormats. Offered with the chat's other work
 * tools, behind the tool catalog.
 */
export function registerChatFormTools(server: McpServer, context: McpRequestContext) {
  const chat = context.chatContext
  if (!chat || chat.kind !== 'direct' || !offersChatWorkTools(context)) return

  // Loose objects: the decoder reads the aliases models write (submit_label, name, description…), which zod would drop.
  const field = z.looseObject({ key: z.string(), label: z.string(), type: z.string() }).partial()
  server.registerTool('show_form', { description: [
    'Show an input card under your reply to ask several values at once (choices, sliders, switches, text, library images).',
    'The pressed button and the values come back as the person\'s next message. Call once, last, then end your reply; do not repeat the fields in text. For one question with ready answers use offer_choices.',
    describeChatFormFields(),
    'Labels in the person\'s language. Never ask for passwords or keys.',
  ].join(' '), inputSchema: z.looseObject({
    // Optional here so a call without one gets the decoder's short message, not a schema dump.
    title: z.string().optional(),
    note: z.string().optional(),
    fields: z.array(field).optional(),
    buttons: z.array(z.unknown()).optional(),
    components: z.array(z.unknown()).optional(),
    dataModel: z.record(z.string(), z.unknown()).optional(),
  }) }, async (args) => {
    try {
      if (!chat.replyId) throw new Error('A form needs an active chat reply.')
      if (ChatProposalStore.forReply(chat.threadId, chat.replyId, 'form').length > 0) throw new Error('This reply already shows a form (one per reply). End your reply; the answer comes as the person\'s next message.')
      const form = decodeChatForm(args)
      if ('error' in form) throw new Error(form.error)
      const missing = chatFormLayout(form).rows.flatMap((row) => (row.component === 'MediaPicker' ? row.items : [])).filter((hash) => !activeMediaFile(hash))
      if (missing.length > 0) throw new Error(`Not in the library: ${missing.join(', ')}. Use composite hashes from an image search.`)
      const { signal } = requireActiveChatReply(chat)
      const profile = ChatProfileStore.find(chat.profileId)
      if (!profile) throw new Error('The chat profile is no longer available.')
      const shown = await translateForm(profile, form, signal, { threadId: chat.threadId, replyId: chat.replyId })
      requireActiveChatReply(chat)
      const proposal = ChatProposalStore.add(chat, shown)
      return result({ proposalId: proposal.id, note: 'The form is shown under your reply. End your reply now; the pressed button and the values come as the person\'s next message.' }, { structuredContent: { proposal } })
    } catch (error) { return failure(error) }
  })
}
