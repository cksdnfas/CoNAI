import type { ChatProfile } from './chatProfiles'
import { PLAIN_USER, type ChatUserPersona } from './chatUserProfiles'
import type { ChatCompletionMessage } from './llmChatCompletion'
import {
  appendUserDirective, buildLeadingMessages, depthBlocks, insertDepthBlocks, parseExampleDialogue,
  postHistoryText, referenceBlock, resolveAuthorNote, selectChatLore,
} from './llmChatContext'

/** A stateless character turn shared by workflow nodes and plugins; never reads a private chat's history. */
export function buildChatProfileReplyMessages(params: {
  profile: ChatProfile; message: string; history: string | null; userName: string | null; useLorebooks: boolean
}): ChatCompletionMessage[] {
  const { profile, message, history } = params
  const user: ChatUserPersona = { ...PLAIN_USER, name: params.userName ?? PLAIN_USER.name }
  const scanned = [...(history ? [{ role: 'user', content: history }] : []), { role: 'user', content: message }]
  const lore = selectChatLore(profile, scanned, user, params.useLorebooks ? {} : { books: [] })
  // Return the reply as written, without native chat translation or automatic memory updates.
  const leading = buildLeadingMessages({ ...profile, translationSlotId: null }, null, { summaryEnabled: false }, false, lore, user)
  const turns = history ? parseExampleDialogue(history, profile, user) : null
  const latest = history && !turns ? `${referenceBlock([`## 앞 대화\n${history}`])}\n\n${message}` : message
  const conversation = insertDepthBlocks([...(turns ?? []), { role: 'user', content: latest }], depthBlocks(lore, profile.loreDepth, resolveAuthorNote(null, profile, user)))
  return appendUserDirective([...leading, ...conversation], postHistoryText(profile, user))
}
