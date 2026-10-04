import type { ChatProfile } from './chatProfiles'
import { chatContentWithAttachments } from './chatAttachments'
import type { CodexChatMessageRecord, CodexChatThreadRecord } from './codexChatStore'
import type { ChatCompletionMessage } from './llmChatCompletion'
import { buildLeadingMessages, sendableMessages, toCompletionMessages } from './llmChatContext'

export const USER_SPEAKER_NAME = '사용자'
const EVERYONE_WORDS = ['모두', 'all', 'everyone']
const OTHER_TOOL_NOTE_LENGTH = 200

type Member = Pick<ChatProfile, 'id' | 'name'>

/** Fenced and inline code, and quoted lines, are not addressed to anyone. */
function addressableText(text: string) {
  return text
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n')
}

/**
 * Members addressed with `@name`, in the order they appear; `@모두` (`@all`) adds every member in room order. The
 * longest matching name wins, and a name must not run into more ASCII word characters (`@카이야` still names 카이,
 * Korean particles follow names directly). `exclude` (the writer) is never returned.
 */
export function parseMentions(text: string, members: Member[], exclude?: number) {
  const source = addressableText(text)
  const byLength = [...members].sort((a, b) => b.name.length - a.name.length)
  const result: number[] = []
  const add = (id: number) => { if (id !== exclude && !result.includes(id)) result.push(id) }
  for (let index = source.indexOf('@'); index >= 0; index = source.indexOf('@', index + 1)) {
    if (index > 0 && /[A-Za-z0-9_.]/.test(source[index - 1])) continue // e-mail addresses
    const rest = source.slice(index + 1)
    const lower = rest.toLowerCase()
    const everyone = EVERYONE_WORDS.find((word) => lower.startsWith(word) && !/^[A-Za-z0-9_]/.test(rest.slice(word.length)))
    const member = byLength.find((entry) => entry.name && lower.startsWith(entry.name.toLowerCase()) && !/^[A-Za-z0-9_]/.test(rest.slice(entry.name.length)))
    if (member) add(member.id)
    else if (everyone) members.forEach((entry) => add(entry.id))
  }
  return result
}

function speakerName(message: CodexChatMessageRecord, names: Map<number, string>) {
  if (message.role === 'user') return USER_SPEAKER_NAME
  return (message.speaker_profile_id !== null && names.get(message.speaker_profile_id)) || '(나간 참가자)'
}

/** Someone else's message as one transcript line: their name, the text, and a note of the tools they used. */
function transcriptLine(message: CodexChatMessageRecord, names: Map<number, string>) {
  const text = message.role === 'user' ? chatContentWithAttachments(message.content, message.attachments) : message.content
  const tools = message.tool_calls.map((call) => `(도구 ${call.tool}${call.summary ? `: ${call.summary.slice(0, OTHER_TOOL_NOTE_LENGTH)}` : ''})`)
  return [`[${speakerName(message, names)}] ${text}`.trim(), ...tools].join('\n')
}

/** Sent ahead of every woken member's turn (not in fixed instructions: Codex freezes those, and members change). */
export function buildGroupHeader(params: { thread: CodexChatThreadRecord; members: Member[]; self: Member; hiddenCount: number }) {
  const { thread, members, self, hiddenCount } = params
  const roster = members.map((member) => `${member.name}${member.id === thread.profile_id ? '(대표)' : ''}`).join(', ')
  return [
    '## 그룹 채팅방',
    `방 이름: ${thread.title || '그룹 채팅'} (room_id ${thread.id})`,
    `참가자: ${USER_SPEAKER_NAME}, ${roster}. 너는 ${self.name}야.`,
    `- 사용자와 여러 참가자가 함께 대화해. 다른 사람의 말은 \`[이름] 내용\` 형식으로 보여.`,
    `- 너는 ${self.name}로서 네 말만 해. 다른 참가자나 사용자의 대사를 대신 쓰지 말고, 답 앞에 \`[이름]\`이나 \`이름:\` 머리말을 붙이지 마.`,
    '- 다른 참가자에게 말을 걸거나 의견을 물을 때만 `@이름`을 써. 그러면 그 참가자가 이어서 답해. 필요 없으면 쓰지 마.',
    // The history tools only help when part of the room is not shown; otherwise models call them for nothing.
    hiddenCount > 0 ? `- 이 앞에 대화가 ${hiddenCount}개 더 있어. 꼭 필요할 때만 room_history_search / room_history_read 도구에 room_id ${thread.id}를 넣어 찾아봐.` : '',
  ].filter(Boolean).join('\n')
}

/**
 * An API LLM member's request: its own persona, lore and examples, the room header, then the room's recent messages
 * from its point of view — its own replies as `assistant`, everyone else's as `[name] text` user turns (merged when
 * consecutive, since chat templates expect user/assistant to alternate).
 */
export function buildGroupLlmMessages(params: {
  profile: ChatProfile
  thread: CodexChatThreadRecord
  members: Member[]
  messages: CodexChatMessageRecord[]
  windowLimit: number
  withTools: boolean
}): ChatCompletionMessage[] {
  const { profile, thread, members, windowLimit, withTools } = params
  const sendable = sendableMessages(params.messages)
  const window = sendable.slice(-windowLimit)
  const names = new Map(members.map((member) => [member.id, member.name]))
  const leading = buildLeadingMessages(profile, null, { summaryEnabled: false }, withTools, window)
  const header: ChatCompletionMessage = { role: 'system', content: buildGroupHeader({ thread, members, self: profile, hiddenCount: sendable.length - window.length }) }
  const system = leading[0]?.role === 'system' ? [leading[0], header, ...leading.slice(1)] : [header, ...leading]

  const conversation: ChatCompletionMessage[] = []
  for (const message of window) {
    if (message.role === 'assistant' && message.speaker_profile_id === profile.id) {
      conversation.push(...toCompletionMessages(message))
      continue
    }
    const line = transcriptLine(message, names)
    const previous = conversation[conversation.length - 1]
    if (previous?.role === 'user' && typeof previous.content === 'string') previous.content = `${previous.content}\n\n${line}`
    else conversation.push({ role: 'user', content: line })
  }
  return [...system, ...conversation]
}

/**
 * A Codex member's turn input: the room header, then what it missed since its last reply (Codex keeps the rest in
 * its own memory), at most `windowLimit` messages; older parts are reachable with the room history tools.
 */
export function buildGroupCodexInput(params: {
  thread: CodexChatThreadRecord
  members: Member[]
  self: Member
  messages: CodexChatMessageRecord[]
  lastSeenMessageId: number | null
  windowLimit: number
  lore: string
}) {
  const { thread, members, self, lastSeenMessageId, windowLimit, lore } = params
  const names = new Map(members.map((member) => [member.id, member.name]))
  const missed = sendableMessages(params.messages).filter((message) => message.id > (lastSeenMessageId ?? 0)
    && !(lastSeenMessageId !== null && message.role === 'assistant' && message.speaker_profile_id === self.id))
  const shown = missed.slice(-windowLimit)
  return [
    buildGroupHeader({ thread, members, self, hiddenCount: missed.length - shown.length }),
    lore ? `[참고 설정]\n${lore}\n[/참고 설정]` : '',
    `[${lastSeenMessageId === null ? '지금까지의 대화' : '네가 마지막으로 말한 뒤의 대화'}]\n${shown.map((message) => transcriptLine(message, names)).join('\n\n')}`,
    `이제 ${self.name}로서 답해.`,
  ].filter(Boolean).join('\n\n')
}

/**
 * Small models sometimes carry on as other speakers. Cut the reply where a line starts with another speaker's
 * header (`[이름]`, `이름:`), and drop a leading header with the member's own name.
 */
export function trimForeignSpeakerLines(text: string, self: string, others: string[]) {
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const names = [USER_SPEAKER_NAME, ...others].filter(Boolean).map(escape).join('|')
  const foreign = new RegExp(`^\\s*(?:\\*\\*)?(?:\\[(?:${names})\\]|(?:${names})\\s*[:：])`)
  const lines = text.replace(new RegExp(`^\\s*(?:\\*\\*)?(?:\\[${escape(self)}\\]|${escape(self)}\\s*[:：])(?:\\*\\*)?\\s*`), '').split('\n')
  const cut = lines.findIndex((line) => foreign.test(line))
  return (cut < 0 ? lines : lines.slice(0, cut)).join('\n').trim()
}
