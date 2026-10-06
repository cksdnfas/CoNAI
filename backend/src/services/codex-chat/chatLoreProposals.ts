import fs from 'fs'
import path from 'path'
import type { ChatExecutionContext, ChatProposal } from '@conai/shared'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import { FileStoreService, TEXT_EXTENSIONS, fileOwnerKey } from '../fileStoreService'
import { storedFilePath } from '../fileStorePaths'
import { loreEntryTitle } from './chatLorebook'
import { LORE_FILES_FOLDER, OwnedLorebookStore, foldLoreTitle, freeChildName, type OwnedLorebook } from './chatLorebookFiles'
import { ChatProposalStore } from './chatProposals'

/**
 * save_lore: the model proposes an entry for the chat's own lorebook; the entry goes in only when a person saves the
 * card (applyLoreProposal). One proposal per reply, and never a title the person already set aside or that still
 * waits: small models otherwise repeat themselves.
 */

export type LoreProposal = Extract<ChatProposal, { kind: 'lore' }>

export const SAVE_LORE_TOOL = 'save_lore'
export const LORE_PROPOSAL_LIMITS = { title: 80, keys: 20, key: 100, content: 4000, fileName: 120, fileBytes: 32 * 1024 } as const
/** Set-aside titles the next request names (newest ones). */
const REJECTED_LORE_TITLES = 10

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
  const content = typeof input.content === 'string' ? input.content.trim() : ''
  if (!content) throw new LoreProposalError('content is empty.')
  if (content.length > LORE_PROPOSAL_LIMITS.content) throw new LoreProposalError(`content is over ${LORE_PROPOSAL_LIMITS.content} characters.`)
  const file = proposedFile(input.file)

  // One per reply: a second call in the same reply is refused (the first card stays as it is).
  if (ChatProposalStore.forReply(context.threadId, context.replyId, 'lore').length > 0) {
    throw new LoreProposalError('This reply already has a lore proposal (one per reply). Propose another one in a later reply if it still matters.')
  }
  const folded = foldLoreTitle(title)
  const earlier = loreProposals(context.threadId).filter((proposal) => foldLoreTitle(proposal.title) === folded)
  if (earlier.some((proposal) => proposal.dismissed)) throw new LoreProposalError(`The user dismissed a lore proposal titled "${title}". Do not propose it again.`)
  if (earlier.some((proposal) => !isSaved(proposal))) throw new LoreProposalError(`A lore proposal titled "${title}" is still waiting for the user. Do not propose it again.`)

  const existing = OwnedLorebookStore.chatBookOf(context.threadId)?.entries.find((entry) => foldLoreTitle(loreEntryTitle(entry)) === folded)
  return ChatProposalStore.add(context, {
    kind: 'lore',
    title,
    keys,
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
