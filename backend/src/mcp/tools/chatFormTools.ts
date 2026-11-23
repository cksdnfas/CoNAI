import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { CHAT_FORM_LIMITS, chatFormLayout, normalizeChatForm } from '@conai/shared'
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
 * message (the pressed button and the values), like a question card. The call is an A2UI `createSurface` subset over
 * the app's own catalog (see shared chatForm). Offered with the chat's other work tools, behind the tool catalog.
 */
export function registerChatFormTools(server: McpServer, context: McpRequestContext) {
  const chat = context.chatContext
  if (!chat || chat.kind !== 'direct' || !offersChatWorkTools(context)) return

  server.registerTool('show_form', { description: [
    'Show an input card under your reply to ask several values at once (choices, sliders, switches, text, library images).',
    'The pressed button and the values come back as the person\'s next message. Call once, last, then end your reply; do not repeat the fields in text. For one question with ready answers use offer_choices.',
    'Format: an A2UI v1.0 createSurface subset. components is a flat list; the one with id "root" is a Column whose children order the rows.',
    'Catalog: Column{children:[id]}; Text{text,variant?:"caption"}; TextField{label,value,placeholder?,variant?:"shortText"|"longText"|"number"}; CheckBox{label,value}; ChoicePicker{label,options:[{label,value}],value,variant?:"mutuallyExclusive"|"multipleSelection"}; Slider{label,min?,max,steps?,value}; MediaPicker{label,items:[composite hash],value,variant?} to pick library images; Button{child:<id of a Text>,variant?:"primary",action:{event:{name}}}.',
    'Every input\'s value is {"@path":"/key"}; its starting value sits at that path in dataModel (ChoicePicker and MediaPicker hold lists of option values or hashes). Labels are literal strings in the person\'s language and name their rows; add a Text only for a note the labels cannot carry. At least one Button.',
  ].join(' '), inputSchema: z.object({
    title: z.string().min(1).max(CHAT_FORM_LIMITS.title).describe('Card title, in the person\'s language'),
    components: z.array(z.record(z.string(), z.unknown())).min(1).max(CHAT_FORM_LIMITS.components).describe('Each {id, component, …} from the catalog'),
    dataModel: z.record(z.string(), z.unknown()).optional().describe('Starting values at the inputs\' paths'),
  }) }, async ({ title, components, dataModel }) => {
    try {
      if (!chat.replyId) throw new Error('A form needs an active chat reply.')
      if (ChatProposalStore.forReply(chat.threadId, chat.replyId, 'form').length > 0) throw new Error('This reply already shows a form (one per reply). End your reply; the answer comes as the person\'s next message.')
      const form = normalizeChatForm({ title, components, dataModel })
      if ('error' in form) throw new Error(form.error)
      const missing = chatFormLayout(form).rows.flatMap((row) => (row.component === 'MediaPicker' ? row.items : [])).filter((hash) => !activeMediaFile(hash))
      if (missing.length > 0) throw new Error(`MediaPicker: not in the library: ${missing.join(', ')}. Use composite hashes from an image search.`)
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
