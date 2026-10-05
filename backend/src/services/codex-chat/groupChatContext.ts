import type { ChatProfile } from './chatProfiles'
import { chatContentWithAttachments } from './chatAttachments'
import type { CodexChatMessageRecord, CodexChatThreadRecord } from './codexChatStore'
import type { ChatCompletionMessage, ChatCompletionTool } from './llmChatCompletion'
import { DEFAULT_REPLY_RESERVE_TOKENS, estimateMessagesTokens } from './llmChatContext'
import { anchoredWindowFor, appendUserDirective, buildLeadingMessages, depthBlocks, flagDirectiveFor, insertDepthBlocks, resolveAuthorNote, selectChatLore, sendableMessages, threadBlockStateText, toCompletionMessages } from './llmChatContext'
import { usableBlockKeys } from './chatBlockState'
import { DEFAULT_USER_NAME, userPersonaForThread, type ChatUserPersona } from './chatUserProfiles'

/** @deprecated the chat's user profile names the user; see `userPersonaForThread`. */
export const USER_SPEAKER_NAME = DEFAULT_USER_NAME
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
 * Names a member answers to: its full name, and for a name of several words its first word when no other member
 * shares it (`@Ochako` for "Ochako Uraraka"). Lower case.
 */
function memberAliases(members: Member[]) {
  const aliases: Array<{ alias: string; id: number }> = members.filter((member) => member.name.trim()).map((member) => ({ alias: member.name.trim().toLowerCase(), id: member.id }))
  const firstWords = new Map<string, number[]>()
  for (const member of members) {
    const words = member.name.trim().toLowerCase().split(/\s+/)
    if (words.length > 1 && words[0].length >= 2) firstWords.set(words[0], [...(firstWords.get(words[0]) ?? []), member.id])
  }
  for (const [word, ids] of firstWords) {
    if (ids.length === 1 && !aliases.some((entry) => entry.alias === word)) aliases.push({ alias: word, id: ids[0] })
  }
  return aliases.sort((a, b) => b.alias.length - a.alias.length)
}

/** The member a name (with or without `@`) means, by the same aliases as mentions. */
export function resolveMemberName(name: string, members: Member[]) {
  const wanted = name.trim().replace(/^@/, '').toLowerCase()
  return memberAliases(members).find((entry) => entry.alias === wanted)?.id ?? null
}

/**
 * Members addressed with `@name`, in the order they appear; `@모두` (`@all`) adds every member in room order. The
 * longest matching name wins, and a name must not run into more ASCII word characters (`@카이야` still names 카이,
 * Korean particles follow names directly). `exclude` (the writer) is never returned.
 */
export function parseMentions(text: string, members: Member[], exclude?: number) {
  const source = addressableText(text)
  const aliases = memberAliases(members)
  const result: number[] = []
  const add = (id: number) => { if (id !== exclude && !result.includes(id)) result.push(id) }
  for (let index = source.indexOf('@'); index >= 0; index = source.indexOf('@', index + 1)) {
    if (index > 0 && /[A-Za-z0-9_.]/.test(source[index - 1])) continue // e-mail addresses
    const rest = source.slice(index + 1)
    const lower = rest.toLowerCase()
    const everyone = EVERYONE_WORDS.find((word) => lower.startsWith(word) && !/^[A-Za-z0-9_]/.test(rest.slice(word.length)))
    const member = aliases.find((entry) => lower.startsWith(entry.alias) && !/^[A-Za-z0-9_]/.test(rest.slice(entry.alias.length)))
    if (member) add(member.id)
    else if (everyone) members.forEach((entry) => add(entry.id))
  }
  return result
}

function speakerName(message: CodexChatMessageRecord, names: Map<number, string>, user: ChatUserPersona) {
  if (message.role === 'user') return user.name
  return (message.speaker_profile_id !== null && names.get(message.speaker_profile_id)) || '(나간 참가자)'
}

/** Someone else's message as one transcript line: their name, the text, and a note of the tools they used. */
function transcriptLine(message: CodexChatMessageRecord, names: Map<number, string>, user: ChatUserPersona) {
  const text = message.role === 'user' ? chatContentWithAttachments(message.content, message.attachments, message.mediaAttachments) : message.content
  const tools = message.tool_calls.map((call) => `(도구 ${call.tool}${call.summary ? `: ${call.summary.slice(0, OTHER_TOOL_NOTE_LENGTH)}` : ''})`)
  return [`[${speakerName(message, names, user)}] ${text}`.trim(), ...tools].join('\n')
}

/** The `@handles` that wake `member` (its full name, and its first word when that is unique), exactly as parsed. */
function mentionHandles(member: Member, members: Member[]) {
  const own = memberAliases(members).filter((entry) => entry.id === member.id).map((entry) => entry.alias)
  // Aliases are lower-cased for matching; show the full name as written, then the shorter alias in the same case.
  return [member.name.trim(), ...own.filter((alias) => alias !== member.name.trim().toLowerCase()).map((alias) => member.name.trim().slice(0, alias.length))].map((handle) => `@${handle}`)
}

/**
 * Every member the model may call, with the exact handles that work, one per line. Models translate or nickname
 * names (`@스타킹` for Stocking) unless each name is spelled out next to the member it belongs to.
 */
function memberList(thread: CodexChatThreadRecord, members: Member[], self: Member, user: ChatUserPersona) {
  return [
    `- ${user.name}: the human user (shown as \`[${user.name}]\`). Never @-mention.`,
    ...members.map((member) => {
      const role = member.id === thread.profile_id ? ' (representative)' : ''
      if (member.id === self.id) return `- ${member.name}${role}: you.`
      return `- ${member.name}${role}: mention as ${mentionHandles(member, members).join(' or ')}`
    }),
  ].join('\n')
}

/** The handles of everyone but `self`, for the one-line reminder at the end of a request ('' alone in the room). */
export function mentionReminder(members: Member[], self: Member) {
  const handles = members.filter((member) => member.id !== self.id).map((member) => mentionHandles(member, members)[0])
  return handles.length > 0 ? `(Mention another member only when you need their reply. Mention handles, verbatim: ${handles.join(', ')}. Never translate or transliterate them.)` : ''
}

/**
 * Sent ahead of every woken member's turn (not in fixed instructions: Codex freezes those, and members change).
 * Stable across turns so a cached system prompt stays valid; see `hiddenHistoryNote` for the part that changes.
 * In English, like the other fixed guidance: Korean instructions pull the model toward Korean spellings of names.
 */
export function buildGroupHeader(params: { thread: CodexChatThreadRecord; members: Member[]; self: Member; user?: ChatUserPersona }) {
  const { thread, members, self } = params
  const user = params.user ?? userPersonaForThread(thread)
  const others = members.some((member) => member.id !== self.id)
  const rules = [
    `- Speak only as ${self.name}. Never write lines for the other members or the user, and never start your reply with a \`[Name]\` or \`Name:\` header.`,
    ...(others
      ? [
        '- @-mention another member only when you need them to reply. Write the mention handle exactly as listed above, character for character: no translation, transliteration, nickname or spacing change. A handle written any other way calls nobody.',
        `- Alternatively call the room_call_member tool with room_id ${thread.id} and the names as listed above. A mentioned or called member replies right after you; do not write their reply yourself.`,
        '- When you merely talk about a member, write the name without @. An @ always calls that member.',
      ]
      : []),
  ]
  return [
    [
      '## Group chat room',
      `Room: ${thread.title || '그룹 채팅'} (room_id ${thread.id})`,
      `You are ${self.name}. The user and the members below talk in one room. Other people's messages appear as \`[Name] text\`.`,
    ].join('\n'),
    `Members and mention handles:\n${memberList(thread, members, self, user)}`,
    `Rules:\n${rules.join('\n')}`,
  ].join('\n\n')
}

/** The history tools only help when part of the room is not shown; otherwise models call them for nothing. */
export function hiddenHistoryNote(thread: Pick<CodexChatThreadRecord, 'id'>, hiddenCount: number) {
  return hiddenCount > 0 ? `(${hiddenCount} earlier messages are not shown. Only when you really need them, use room_history_search / room_history_read with room_id ${thread.id}.)` : ''
}

/**
 * An API LLM member's request: its own persona (with its always-on lore) and examples, the room header, then the
 * room's recent messages from its point of view — its own replies as `assistant`, everyone else's as `[name] text`
 * user turns (merged when consecutive, since chat templates expect user/assistant to alternate). The window start is
 * anchored like a direct chat's, and the member's keyword lore and the room's author's note are merged in `loreDepth`
 * user turns before the end.
 */
type GroupLlmContext = {
  profile: ChatProfile
  thread: CodexChatThreadRecord
  members: Member[]
  messages: CodexChatMessageRecord[]
  windowLimit: number
  withTools: boolean
  tools: ChatCompletionTool[]
  maxTokens: number | null
}

export function buildGroupLlmMessages(params: GroupLlmContext): ChatCompletionMessage[] {
  const sendable = sendableMessages(params.messages)
  let window = anchoredWindowFor(params.thread.id, sendable, params.windowLimit, (message) => message.id)
  let result = buildGroupWindowMessages(params, window, sendable.length)
  const budget = params.profile.contextTokens
  const reserve = params.maxTokens ?? DEFAULT_REPLY_RESERVE_TOKENS
  while (budget !== null && window.length > 1 && estimateMessagesTokens(params.profile.id, result, params.tools) + reserve > budget) {
    window = window.slice(1)
    result = buildGroupWindowMessages(params, window, sendable.length)
  }
  return result
}

function buildGroupWindowMessages(params: GroupLlmContext, window: CodexChatMessageRecord[], total: number): ChatCompletionMessage[] {
  const { profile, thread, members, withTools } = params
  const user = userPersonaForThread(thread)
  const names = new Map(members.map((member) => [member.id, member.name]))
  const lore = selectChatLore(profile, window, user)
  const leading = buildLeadingMessages(profile, null, { summaryEnabled: false }, withTools, lore, user)
  // The header joins the persona's system message: a second system message in the middle is dropped or rejected by
  // many chat templates, and this one is what keeps the model from writing other members' names its own way.
  const header = buildGroupHeader({ thread, members, self: profile, user })
  const system: ChatCompletionMessage[] = leading[0]?.role === 'system'
    ? [{ role: 'system', content: `${leading[0].content}\n\n${header}` }, ...leading.slice(1)]
    : [{ role: 'system', content: header }, ...leading]

  const conversation: ChatCompletionMessage[] = []
  const blockKeys = usableBlockKeys(profile.style.blocks)
  for (const message of window) {
    if (message.role === 'assistant' && message.speaker_profile_id === profile.id) {
      conversation.push(...toCompletionMessages(message, blockKeys))
      continue
    }
    const line = transcriptLine(message, names, user)
    const previous = conversation[conversation.length - 1]
    if (previous?.role === 'user' && typeof previous.content === 'string') previous.content = `${previous.content}\n\n${line}`
    else conversation.push({ role: 'user', content: line })
  }
  // The flags the user had on for the message this run answers reach every member answering it; the request ends
  // with the exact handles, where small models actually look before writing a mention.
  const blocks = depthBlocks(lore, profile.loreDepth, resolveAuthorNote(thread, profile, user), threadBlockStateText(profile, thread, params.messages, profile.id))
  const directive = [hiddenHistoryNote(thread, total - window.length), flagDirectiveFor(params.messages, profile, user), mentionReminder(members, profile)].filter(Boolean).join('\n\n')
  return appendUserDirective([...system, ...insertDepthBlocks(conversation, blocks)], directive)
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
  /** The user's chat flags for the message this run answers (already filled for this member). */
  directive: string
}) {
  const { thread, members, self, lastSeenMessageId, windowLimit, lore, directive } = params
  const user = userPersonaForThread(thread)
  const names = new Map(members.map((member) => [member.id, member.name]))
  const missed = sendableMessages(params.messages).filter((message) => message.id > (lastSeenMessageId ?? 0)
    && !(lastSeenMessageId !== null && message.role === 'assistant' && message.speaker_profile_id === self.id))
  const shown = missed.slice(-windowLimit)
  return [
    buildGroupHeader({ thread, members, self, user }),
    hiddenHistoryNote(thread, missed.length - shown.length),
    lore ? `[참고 설정]\n${lore}\n[/참고 설정]` : '',
    `[${lastSeenMessageId === null ? '지금까지의 대화' : '네가 마지막으로 말한 뒤의 대화'}]\n${shown.map((message) => transcriptLine(message, names, user)).join('\n\n')}`,
    directive,
    [`이제 ${self.name}로서 답해.`, mentionReminder(members, self)].filter(Boolean).join(' '),
  ].filter(Boolean).join('\n\n')
}

/**
 * Small models sometimes carry on as other speakers. Cut the reply where a line starts with another speaker's
 * header (`[이름]`, `이름:`), and drop a leading header with the member's own name. `others` includes the user's name.
 */
export function trimForeignSpeakerLines(text: string, self: string, others: string[]) {
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const names = [DEFAULT_USER_NAME, ...others].filter(Boolean).map(escape).join('|')
  const foreign = new RegExp(`^\\s*(?:\\*\\*)?(?:\\[(?:${names})\\]|(?:${names})\\s*[:：])`)
  const lines = text.replace(new RegExp(`^\\s*(?:\\*\\*)?(?:\\[${escape(self)}\\]|${escape(self)}\\s*[:：])(?:\\*\\*)?\\s*`), '').split('\n')
  const cut = lines.findIndex((line) => foreign.test(line))
  return (cut < 0 ? lines : lines.slice(0, cut)).join('\n').trim()
}
