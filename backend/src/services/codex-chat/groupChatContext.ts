import type { ChatProfile } from './chatProfiles'
import { isCodexChatCreationTool, type ChatMessageRouting } from '@conai/shared'
import { buildReplyContext } from './chatReplyContext'
import { messageAddress } from './chatReplies'
import { chatContentWithAttachments } from './chatAttachments'
import { generationPromptOf } from './chatToolReferences'
import type { CodexChatMessageRecord, CodexChatThreadRecord } from './codexChatStore'
import type { ChatCompletionMessage, ChatCompletionTool } from './llmChatCompletion'
import { DEFAULT_REPLY_RESERVE_TOKENS, estimateMessagesTokens } from './llmChatContext'
import { postHistoryText, buildContextMeta, recalledSegments, type ChatContextMeta } from './llmChatContext'
import { recallText } from './chatMemory'
import { contextSource, limitContextMeta, contextPartsOf, markContextParts } from './chatContextDiagnostics'
import { anchoredSuffix, anchoredWindowFor, appendUserDirective, buildLeadingMessages, depthBlocks, flagDirectiveFor, insertDepthBlocks, offersLoreFileTool, recallFor, rejectedLoreFor, resolveAuthorNote, selectChatLore, sendableMessages, threadBlockStateText, toCompletionMessages, unsummarizedMessages } from './llmChatContext'
import { booksForRequest, type AttachedLoreBook, type ChatLore } from './chatLoreContext'
import type { ChatSummarySegment } from './chatMemory'
import type { JudgedContext } from './chatJudgeContext'
import { usableBlockKeys } from './chatBlockState'
import { DEFAULT_USER_NAME, userPersonaForThread, type ChatUserPersona } from './chatUserProfiles'

/** @deprecated the chat's user profile names the user; see `userPersonaForThread`. */
export const USER_SPEAKER_NAME = DEFAULT_USER_NAME
const OTHER_TOOL_NOTE_LENGTH = 200
type Member = Pick<ChatProfile, 'id' | 'name'>
export { parseMentions, resolveMemberName } from '@conai/shared'
import { memberAliases } from '@conai/shared'

function speakerName(message: CodexChatMessageRecord, names: Map<number, string>, user: ChatUserPersona) {
  if (message.role === 'user') return user.name
  return (message.speaker_profile_id !== null && names.get(message.speaker_profile_id)) || '(나간 참가자)'
}

/** Someone else's message as one transcript line: their name, the text, and a note of the tools they used. */
function transcriptLine(message: CodexChatMessageRecord, names: Map<number, string>, user: ChatUserPersona, inlineTexts?: ReadonlyMap<string, string>) {
  const text = message.role === 'user' ? chatContentWithAttachments(message.content, message.attachments, message.mediaAttachments, inlineTexts) : message.content
  const tools = message.tool_calls.map((call) => {
    // Another member's generation: the scene they asked for and what became of it, not the job JSON.
    const prompt = isCodexChatCreationTool(call.tool) ? generationPromptOf(call) : null
    if (prompt) return `(이미지 생성: ${prompt.slice(0, OTHER_TOOL_NOTE_LENGTH)}${call.output && !call.output.startsWith('{') ? ` — ${call.output.slice(0, OTHER_TOOL_NOTE_LENGTH)}` : ''})`
    return `(도구 ${call.tool}${call.summary ? `: ${call.summary.slice(0, OTHER_TOOL_NOTE_LENGTH)}` : ''})`
  })
  return [`[${speakerName(message, names, user)}; ${messageAddress(message)}] ${text}`.trim(), ...tools].join('\n')
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
      if (member.id === self.id) return `- ${member.name}${role} (profile_id ${member.id}): you.`
      return `- ${member.name}${role} (profile_id ${member.id}): mention as ${mentionHandles(member, members).join(' or ')}`
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
    '- Your reply is automatically addressed to the sender of the message you are answering. A character recipient answers after you finish, without another @mention. To finish the exchange, call chat_reply_to with to:["user"] to report to the human, or to:["room"] for a closing announcement. Do not bounce acknowledgements back and forth.',
    '- Use chat_reply_to(message_id, to:[profile_id]) to quote an earlier message and choose recipients. Explicit tool recipients override mentions. Never forge From/To headers in the body. Calls are subject to the room chain limit; if rejected, tell the user instead of claiming the member will answer.',
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
 * An API LLM member's request: its own persona, its lore index (the room's books and its own) and examples, the room header, then the
 * room's recent messages from its point of view — its own replies as `assistant`, everyone else's as `[name] text`
 * user turns (merged when consecutive, since chat templates expect user/assistant to alternate). The window start is
 * anchored like a direct chat's, and the member's keyword lore and the room's author's note are merged in `loreDepth`
 * user turns before the end.
 */
type GroupLlmContext = {
  onMeta?: (meta: ChatContextMeta) => void
  routing?: ChatMessageRouting
  profile: ChatProfile
  thread: CodexChatThreadRecord
  members: Member[]
  messages: CodexChatMessageRecord[]
  windowLimit: number
  withTools: boolean
  tools: ChatCompletionTool[]
  maxTokens: number | null
  /** Space for a caller's final message, such as generation outcomes. */
  extraTokens?: number
  /** The room's summary segments (for recall), when its summary is on. */
  segments?: ChatSummarySegment[]
  /** A member that cannot read files itself: text attachments' contents, by file id (see inlineTextsForChat). */
  attachmentTexts?: ReadonlyMap<string, string>
  /** The member's lore books, already resolved (default: booksForRequest for the room and the member). */
  books?: AttachedLoreBook[]
  /** Lore entries and past episodes the judge chose for this reply (see chatJudgeContext). */
  judged?: JudgedContext | null
}

/** A room's summary is its own switch on the thread: off unless set (members' profiles do not decide for the room). */
export function groupSummaryOn(thread: Pick<CodexChatThreadRecord, 'summary_enabled'>) {
  return thread.summary_enabled === 1
}

/** Where each member's token-budgeted window of a room starts, by `room:member` (see buildGroupLlmMessages). */
const budgetAnchors = new Map<string, number>()

export function buildGroupLlmMessages(params: GroupLlmContext): ChatCompletionMessage[] {
  // With the room's summary on, the messages it covers stay out: the summary stands in for them.
  const sendable = sendableMessages(unsummarizedMessages(params.messages, params.thread, { summaryEnabled: groupSummaryOn(params.thread) }))
  let window = anchoredWindowFor(params.thread.id, sendable, params.windowLimit, (message) => message.id)
  params = { ...params, books: params.books ?? booksForRequest({ thread: params.thread, profile: params.profile }) }
  const lore = selectChatLore(params.profile, window, userPersonaForThread(params.thread), { books: params.books, toolOffered: offersLoreFileTool(params.tools), history: params.messages, speakerProfileId: params.profile.id, judged: params.judged?.loreKeys })
  let context = buildGroupWindowMessages(params, window, sendable.length, lore)
  const budget = params.profile.contextTokens
  const reserve = (params.maxTokens ?? DEFAULT_REPLY_RESERVE_TOKENS) + (params.extraTokens ?? 0)
  const fits = (messages: CodexChatMessageRecord[]) => budget === null || estimateMessagesTokens(params.profile.id, buildGroupWindowMessages(params, messages, sendable.length, lore).messages, params.tools) + reserve <= budget
  if (budget !== null && window.length > 1 && !fits(window)) {
    // How many of the latest messages fit, found by halving (each try rebuilds the request), then a start that holds
    // for several turns like the direct chat's (anchoredSuffix): a start moved by one message every turn would make a
    // local server or a provider cache read the whole conversation again each time.
    let low = 1
    let high = window.length - 1
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (fits(window.slice(-middle))) low = middle
      else high = middle - 1
    }
    const key = `${params.thread.id}:${params.profile.id}`
    const fitted = anchoredSuffix(window, low, (message) => message.id, budgetAnchors.get(key))
    if (fitted.anchorId === undefined) budgetAnchors.delete(key)
    else budgetAnchors.set(key, fitted.anchorId)
    window = fitted.window
    context = buildGroupWindowMessages(params, window, sendable.length, lore)
  }
  if (params.onMeta) {
    const meta = buildContextMeta(params.profile, params.thread, params.messages, window, groupSummaryOn(params.thread), context.lore, context.recalled, params.tools, context.messages)
    if (meta.version === 2) meta.sources?.push(...contextSource('group-header', context.header))
    params.onMeta(limitContextMeta(meta))
  }
  return context.messages
}

function buildGroupWindowMessages(params: GroupLlmContext, window: CodexChatMessageRecord[], total: number, lore: ChatLore) {
  const { profile, thread, members, withTools } = params
  const user = userPersonaForThread(thread)
  const names = new Map(members.map((member) => [member.id, member.name]))
  // The room's own book and the account books linked to the room, then this member's profile books.
  const summaryOn = groupSummaryOn(thread)
  const leading = buildLeadingMessages(profile, { summary: thread.summary }, { summaryEnabled: summaryOn }, withTools, lore, user)
  // The header joins the persona's system message: a second system message in the middle is dropped or rejected by
  // many chat templates, and this one is what keeps the model from writing other members' names its own way.
  const header = buildGroupHeader({ thread, members, self: profile, user })
  // The leading system message already carries the lore index and summary behind the persona.
  const system: ChatCompletionMessage[] = [
    markContextParts({ role: 'system', content: [...leading.filter((message) => message.role === 'system').map((message) => message.content), header].join('\n\n') }, [...leading.flatMap(contextPartsOf), { kind: 'group-header', text: header }]),
    ...leading.filter((message) => message.role !== 'system'),
  ]

  const conversation: ChatCompletionMessage[] = []
  const blockKeys = usableBlockKeys(profile.style.blocks)
  for (const message of window) {
    if (message.role === 'assistant' && message.speaker_profile_id === profile.id) {
      conversation.push(...toCompletionMessages(message, blockKeys))
      continue
    }
    const line = transcriptLine(message, names, user, params.attachmentTexts)
    const previous = conversation[conversation.length - 1]
    if (previous?.role === 'user' && typeof previous.content === 'string') previous.content = `${previous.content}\n\n${line}`
    else conversation.push({ role: 'user', content: line })
  }
  // The flags the user had on for the message this run answers reach every member answering it; the request ends
  // with the exact handles, where small models actually look before writing a mention.
  // Summaries the room's plot already took in come back when the latest exchange touches them, like in a direct chat.
  const recalled = summaryOn && params.segments ? recalledSegments(profile, params.segments, params.messages, { contextTokens: profile.contextTokens }, params.judged?.recallKeep) : []
  const recall = recallText(recalled)
  const blocks = depthBlocks(lore, profile.loreDepth, resolveAuthorNote(thread, profile, user), threadBlockStateText(profile, thread, params.messages, profile.id), recall, rejectedLoreFor(thread.id, params.tools))
  const reference = buildReplyContext(params.messages, params.routing, { group: true, maxChars: Math.max(256, Math.min(6000, Math.floor((profile.contextTokens ?? 24000) / 4))), visibleIds: new Set(window.map((message) => message.id)), nameOf: (message) => speakerName(message, names, user) })
  const directive = [reference, hiddenHistoryNote(thread, total - window.length), flagDirectiveFor(params.messages, profile, user), postHistoryText(profile, user), mentionReminder(members, profile)].filter(Boolean).join('\n\n')
  const result = appendUserDirective([...system, ...insertDepthBlocks(conversation, blocks)], directive)
  return { messages: result, lore, recalled, header }
}

/**
 * A Codex member's turn input: the room header, then what it missed since its last reply (Codex keeps the rest in
 * its own memory), at most `windowLimit` messages; older parts are reachable with the room history tools.
 */
export function buildGroupCodexInput(params: {
  routing?: ChatMessageRouting
  thread: CodexChatThreadRecord
  members: Member[]
  self: Member
  messages: CodexChatMessageRecord[]
  lastSeenMessageId: number | null
  windowLimit: number
  lore: string
  /** The user's chat flags for the message this run answers (already filled for this member). */
  directive: string
  /** A member that cannot read files itself: text attachments' contents, by file id. */
  attachmentTexts?: ReadonlyMap<string, string>
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
    buildReplyContext(params.messages, params.routing, { group: true, visibleIds: new Set(shown.map((message) => message.id)), nameOf: (message) => speakerName(message, names, user) }),
    lore ? `[참고 설정]\n${lore}\n[/참고 설정]` : '',
    `[${lastSeenMessageId === null ? '지금까지의 대화' : '네가 마지막으로 말한 뒤의 대화'}]\n${shown.map((message) => transcriptLine(message, names, user, params.attachmentTexts)).join('\n\n')}`,
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
