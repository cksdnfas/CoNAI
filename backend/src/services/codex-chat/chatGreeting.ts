import { chatGreetings, type ChatProfile } from './chatProfiles'
import { fillCharacterPlaceholders } from './chatPlaceholders'
import type { ChatUserPersona } from './chatUserProfiles'
import { CodexChatStore } from './codexChatStore'
import { getUserSettingsDb } from '../../database/userSettingsDb'

/** The same filled history surrounds the greeting in the preview and the saved chat. */
export function chatOpeningHistory(profile: ChatProfile, user: ChatUserPersona) {
  const history = profile.openingHistory.map(({ role, content }) => ({ role, content: fillCharacterPlaceholders(content, profile, user) }))
  return { before: history.slice(0, profile.greetingPosition), after: history.slice(profile.greetingPosition) }
}

/** Save the opening as ordinary messages; only the greeting has variants, with the previewed index active. */
export function addChatOpening(threadId: number, profile: ChatProfile, user: ChatUserPersona, index?: number | null) {
  const { before, after } = chatOpeningHistory(profile, user)
  const greetings = chatGreetings(profile).map((text) => fillCharacterPlaceholders(text, profile, user))
  const active = typeof index === 'number' && Number.isSafeInteger(index) && index >= 0 && index < greetings.length ? index : Math.floor(Math.random() * greetings.length)
  return getUserSettingsDb().transaction(() => {
    const addHistory = (messages: typeof before) => {
      for (const message of messages) CodexChatStore.addMessage({ thread_id: threadId, ...message, tool_calls: [], status: 'completed', error: null })
    }
    addHistory(before)
    if (greetings.length) {
      const messageId = CodexChatStore.addMessage({ thread_id: threadId, role: 'assistant', content: greetings[active], tool_calls: [], status: 'completed', error: null })
      const { created_date } = getUserSettingsDb().prepare('SELECT created_date FROM codex_chat_messages WHERE id = ?').get(messageId) as { created_date: string }
      const alternatives = greetings.map((content) => ({ content, tool_calls: [], created_at: created_date, status: 'completed', error: null }))
      getUserSettingsDb().prepare('UPDATE codex_chat_messages SET alternatives = ?, active_alternative = ? WHERE id = ?').run(JSON.stringify(alternatives), active, messageId)
    }
    addHistory(after)
  })()
}
