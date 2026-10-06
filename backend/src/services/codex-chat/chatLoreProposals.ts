import fs from 'fs'
import path from 'path'
import type { ChatExecutionContext, ChatProposal } from '@conai/shared'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import { FileStoreService, TEXT_EXTENSIONS, fileOwnerKey } from '../fileStoreService'
import { storedFilePath } from '../fileStorePaths'
import { loreEntryTitle } from './chatLorebook'
import { LORE_FILES_FOLDER, OwnedLorebookStore, foldLoreTitle, freeChildName, type OwnedLorebook } from './chatLorebookFiles'
import { ChatGroupStore } from './chatGroupStore'
import { ChatProfileStore } from './chatProfiles'
import { ChatProposalStore } from './chatProposals'
import { userPersonaForThread } from './chatUserProfiles'
import { CodexChatStore, type CodexChatMessageRecord } from './codexChatStore'

/**
 * save_lore: the model proposes an entry for the chat's own lorebook; the entry goes in only when a person saves the
 * card (applyLoreProposal). One proposal per reply, none within a few replies of the last one unless the user asks
 * for something to be kept, and never a title the person already set aside or that still waits: small models
 * otherwise propose every other turn. Names, dates and times are dropped from the keywords.
 */

export type LoreProposal = Extract<ChatProposal, { kind: 'lore' }>

export const SAVE_LORE_TOOL = 'save_lore'
export const LORE_PROPOSAL_LIMITS = { title: 80, keys: 20, key: 100, content: 4000, fileName: 120, fileBytes: 32 * 1024 } as const
/** Set-aside titles the next request names (newest ones). */
const REJECTED_LORE_TITLES = 10
/** A chat proposes lore at most once in this many assistant replies, unless the user asks for something to be kept. */
const LORE_PROPOSAL_SPACING = 3
/** Words in the latest user message that ask for something to be kept; they lift that spacing. */
const LORE_REQUEST_WORDS = /기억|저장|남겨|remember|save/i
/** Keywords a proposal keeps, at most. */
export const LORE_PROPOSAL_MAX_KEYS = 6
/**
 * Keywords that come up in nearly every exchange, so an entry keyed on them would come back all the time: dates,
 * weekdays, times of day, and the word "promise" itself.
 */
const LORE_STOP_KEYS = new Set([
  '약속', '오늘', '내일', '모레', '어제', '그제', '주말', '평일', '이번 주', '다음 주', '지난주', '아침', '점심', '저녁', '밤', '새벽', '오전', '오후',
  '월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일',
  'promise', 'today', 'tomorrow', 'yesterday', 'tonight', 'weekend', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
])
/**
 * A keyword found in more than this share of the chat's recent messages is part of the chat itself (the user's in-chat
 * name, the place every scene happens), measured over the last CHAT_COMMON_WINDOW user and assistant messages once
 * there are at least CHAT_COMMON_MIN_MESSAGES of them (fewer would drop the fact the user just brought up).
 */
const CHAT_COMMON_SHARE = 0.4
const CHAT_COMMON_WINDOW = 20
const CHAT_COMMON_MIN_MESSAGES = 10
/** A bare time: `7시`, `오후 3시 반`, `19:30`, `7pm`. */
const TIME_KEY = /^(?:(?:오전|오후|아침|저녁|밤|새벽)\s*)?\d{1,2}\s*시(?:\s*(?:\d{1,2}\s*분|반))?$|^\d{1,2}:\d{2}$|^\d{1,2}\s*(?:am|pm)$/i

export class LoreProposalError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

export type SaveLoreInput = { title?: unknown; keys?: unknown; content?: unknown; constant?: unknown; file?: unknown }

function loreProposals(threadId: number): LoreProposal[] {
  return ChatProposalStore.listForThread(threadId).map((row) => row.proposal).filter((proposal): proposal is LoreProposal => proposal.kind === 'lore')
}

function isSaved(proposal: LoreProposal) {
  return proposal.savedId !== undefined
}

function foldKey(value: string) {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * The keywords worth keeping, at most LORE_PROPOSAL_MAX_KEYS: not the user's or a speaker's name (they appear in
 * every turn), not a date, weekday or bare time (see LORE_STOP_KEYS, TIME_KEY), and not a word most of the `recent`
 * messages already hold (see CHAT_COMMON_SHARE).
 */
export function usefulLoreKeys(keys: string[], names: Array<string | null | undefined>, recent: string[] = []) {
  const skipped = new Set(names.filter((name): name is string => Boolean(name?.trim())).map(foldKey))
  const texts = recent.length >= CHAT_COMMON_MIN_MESSAGES ? recent.slice(-CHAT_COMMON_WINDOW).map(foldKey) : []
  const common = (folded: string) => texts.length > 0 && texts.filter((text) => text.includes(folded)).length > texts.length * CHAT_COMMON_SHARE
  return keys.filter((key) => {
    const folded = foldKey(key)
    return folded && !skipped.has(folded) && !LORE_STOP_KEYS.has(folded) && !TIME_KEY.test(folded) && !common(folded)
  }).slice(0, LORE_PROPOSAL_MAX_KEYS)
}

/** Names that come up in every turn of the chat: the user's in this chat, then every profile that speaks in it. */
function chatNames(threadId: number, profileId: number, messages: CodexChatMessageRecord[]) {
  const thread = CodexChatStore.findThreadById(threadId)
  const speakers = new Set<number>([profileId])
  if (thread?.profile_id) speakers.add(thread.profile_id)
  for (const member of ChatGroupStore.members(threadId)) speakers.add(member.profile_id)
  for (const message of messages) if (message.speaker_profile_id) speakers.add(message.speaker_profile_id)
  return [thread ? userPersonaForThread(thread).name : null, ...[...speakers].map((id) => ChatProfileStore.find(id)?.name)]
}

/**
 * Whether the chat proposed lore in one of its last LORE_PROPOSAL_SPACING assistant replies, while the latest user
 * message asks for nothing to be kept. A direct chat's replies after the latest user message are the one being
 * regenerated or continued, so they do not count.
 */
export function loreProposedRecently(context: Pick<ChatExecutionContext, 'threadId' | 'kind'>) {
  const messages = CodexChatStore.listMessages(context.threadId)
  const latestUser = messages.map((message) => message.role).lastIndexOf('user')
  const user = latestUser >= 0 ? messages[latestUser] : null
  if (user && LORE_REQUEST_WORDS.test(`${user.content}\n${user.display_content ?? ''}`)) return false
  const answered = context.kind === 'direct' && latestUser >= 0 ? messages.slice(0, latestUser) : messages
  const recent = new Set(answered.filter((message) => message.role === 'assistant').slice(-LORE_PROPOSAL_SPACING).flatMap((message) => message.routing?.replyId ?? []))
  return recent.size > 0 && ChatProposalStore.listForThread(context.threadId).some((row) => row.proposal.kind === 'lore' && recent.has(row.replyId))
}

/** The file a proposal carries: a plain text file name (no folders) and UTF-8 text up to the limit. */
function proposedFile(value: unknown): LoreProposal['file'] {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) throw new LoreProposalError('file must be { name, text }.')
  const { name: rawName, text } = value as Record<string, unknown>
  const name = typeof rawName === 'string' ? rawName.normalize('NFC').trim() : ''
  if (!name || name.length > LORE_PROPOSAL_LIMITS.fileName || /[\\/:*?"<>|\u0000-\u001f]/.test(name) || /^\.+$/.test(name)) {
    throw new LoreProposalError(`file.name must be a plain file name (no folders), at most ${LORE_PROPOSAL_LIMITS.fileName} characters.`)
  }
  if (!TEXT_EXTENSIONS.has(path.extname(name).toLowerCase())) throw new LoreProposalError('file.name must be a text file (.md, .txt, .json, …).')
  if (typeof text !== 'string' || !text.trim()) throw new LoreProposalError('file.text is empty.')
  if (Buffer.byteLength(text, 'utf8') > LORE_PROPOSAL_LIMITS.fileBytes) throw new LoreProposalError(`file.text is over ${LORE_PROPOSAL_LIMITS.fileBytes / 1024} KB.`)
  return { name, text }
}

/** A validated save_lore call as the proposal it stores (an update when the chat book has an entry of that title). */
export function proposeLore(context: ChatExecutionContext, input: SaveLoreInput): LoreProposal {
  if (!context.replyId) throw new LoreProposalError('Proposals need an active chat reply.')
  const title = typeof input.title === 'string' ? input.title.normalize('NFC').replace(/\s+/g, ' ').trim() : ''
  if (!title) throw new LoreProposalError('title is required.')
  if (title.length > LORE_PROPOSAL_LIMITS.title) throw new LoreProposalError(`title is over ${LORE_PROPOSAL_LIMITS.title} characters.`)
  if (input.keys !== undefined && !Array.isArray(input.keys)) throw new LoreProposalError('keys must be a list of keywords.')
  const keys = [...new Set(((input.keys ?? []) as unknown[]).map((key) => (typeof key === 'string' ? key.trim() : '')).filter(Boolean))]
  if (keys.length > LORE_PROPOSAL_LIMITS.keys) throw new LoreProposalError(`At most ${LORE_PROPOSAL_LIMITS.keys} keys.`)
  if (keys.some((key) => key.length > LORE_PROPOSAL_LIMITS.key)) throw new LoreProposalError(`A key is over ${LORE_PROPOSAL_LIMITS.key} characters.`)
  const messages = CodexChatStore.listMessages(context.threadId)
  const recent = messages.filter((message) => (message.role === 'user' || message.role === 'assistant') && message.content.trim()).map((message) => message.content)
  const useful = usefulLoreKeys(keys, chatNames(context.threadId, context.profileId, messages), recent)
  const content = typeof input.content === 'string' ? input.content.trim() : ''
  if (!content) throw new LoreProposalError('content is empty.')
  if (content.length > LORE_PROPOSAL_LIMITS.content) throw new LoreProposalError(`content is over ${LORE_PROPOSAL_LIMITS.content} characters.`)
  const file = proposedFile(input.file)

  // One per reply: a second call in the same reply is refused (the first card stays as it is).
  if (ChatProposalStore.forReply(context.threadId, context.replyId, 'lore').length > 0) {
    throw new LoreProposalError('This reply already has a lore proposal (one per reply). Propose another one in a later reply if it still matters.')
  }
  if (loreProposedRecently(context)) {
    throw new LoreProposalError(`A lore proposal was made within the last ${LORE_PROPOSAL_SPACING} replies. Propose again only when the user asks you to remember something or a lasting fact (a promise, a preference, who someone is) comes up. Just reply now.`)
  }
  const folded = foldLoreTitle(title)
  const earlier = loreProposals(context.threadId).filter((proposal) => foldLoreTitle(proposal.title) === folded)
  if (earlier.some((proposal) => proposal.dismissed)) throw new LoreProposalError(`The user dismissed a lore proposal titled "${title}". Do not propose it again.`)
  if (earlier.some((proposal) => !isSaved(proposal))) throw new LoreProposalError(`A lore proposal titled "${title}" is still waiting for the user. Do not propose it again.`)

  const existing = OwnedLorebookStore.chatBookOf(context.threadId)?.entries.find((entry) => foldLoreTitle(loreEntryTitle(entry)) === folded)
  return ChatProposalStore.add(context, {
    kind: 'lore',
    title,
    keys: useful,
    content,
    constant: input.constant === true,
    ...(file ? { file } : {}),
    ...(existing ? {
      replaces: existing.id,
      before: { title: loreEntryTitle(existing), keys: existing.keys, content: existing.content, constant: existing.constant, file: existing.file },
    } : {}),
  }) as LoreProposal
}

/**
 * A person saved a lore proposal: the entry goes into the chat's book (made with its first entry), in place of the
 * entry it replaces when that one is still there; the file, if any, into the book's 자료/ (a taken name gets a
 * suffix, unless it is the replaced entry's own file, which is rewritten). One transaction.
 */
export function applyLoreProposal(proposalId: number): { proposal: ChatProposal; book: OwnedLorebook } {
  const proposal = ChatProposalStore.find(proposalId)
  if (!proposal || proposal.kind !== 'lore') throw new LoreProposalError('로어 제안이 아니야.')
  if (isSaved(proposal)) throw new LoreProposalError('이미 저장한 제안이야.', 409)
  const threadId = ChatProposalStore.threadIdOf(proposalId) as number
  const db = getUserSettingsDb()
  const thread = db.prepare('SELECT account_id FROM codex_chat_threads WHERE id = ?').get(threadId) as { account_id: number | null } | undefined
  if (!thread) throw new LoreProposalError('채팅을 찾을 수 없어.', 404)
  const owner = fileOwnerKey(thread.account_id)
  let created: string | null = null
  try {
    return db.transaction(() => {
      const current = OwnedLorebookStore.chatBookOf(threadId)
      const entries = current?.entries ?? []
      const replaced = proposal.replaces ? entries.find((entry) => entry.id === proposal.replaces) : undefined
      const fields = { title: proposal.title, keys: proposal.keys, content: proposal.content, constant: proposal.constant }
      let entryId = replaced?.id ?? `lore-p${proposal.id}`
      while (!replaced && entries.some((entry) => entry.id === entryId)) entryId += '-'
      const next = replaced
        ? entries.map((entry) => (entry.id === replaced.id ? { ...entry, ...fields } : entry))
        : [...entries, { id: entryId, ...fields, enabled: true, order: entries.reduce((max, entry) => Math.max(max, entry.order), -1) + 1 }]
      let book = OwnedLorebookStore.saveChatBook(threadId, next) as OwnedLorebook
      if (proposal.file) {
        const materials = FileStoreService.ensureFolder(owner, book.folderId, LORE_FILES_FOLDER)
        const own = replaced?.file?.toLowerCase() === `${LORE_FILES_FOLDER}/${proposal.file.name}`.toLowerCase()
        const name = own ? proposal.file.name : freeChildName(owner, materials.id, proposal.file.name)
        const existed = FileStoreService.findChild(owner, materials.id, name)
        const written = FileStoreService.writeText(owner, materials.id, name, proposal.file.text, { silent: true })
        if (!existed) created = written.id
        book = OwnedLorebookStore.update(book.id, owner, {
          entries: book.entries.map((entry) => (entry.id === entryId ? { ...entry, file: `${LORE_FILES_FOLDER}/${written.name}`, fileId: written.id } : entry)),
        }) as OwnedLorebook
      }
      const saved = ChatProposalStore.markSaved(proposalId, book.id) as ChatProposal
      return { proposal: saved, book }
    }).immediate()
  } catch (error) {
    if (created) fs.rmSync(storedFilePath(owner, created), { force: true })
    throw error
  }
}

/**
 * For the next request of a chat that can propose lore: the titles a person set aside (newest REJECTED_LORE_TITLES,
 * oldest first), so a small model does not offer them again. '' when there are none.
 */
export function rejectedLoreLine(threadId: number | null | undefined) {
  if (!threadId) return ''
  const titles = [...new Set(ChatProposalStore.dismissedOfKind(threadId, 'lore', REJECTED_LORE_TITLES)
    .map((proposal) => (proposal.kind === 'lore' ? proposal.title.replace(/\s+/g, ' ').trim() : ''))
    .filter(Boolean))].reverse()
  return titles.length ? `(거절된 로어 제안: ${titles.join(', ')} — 다시 제안하지 마)` : ''
}
