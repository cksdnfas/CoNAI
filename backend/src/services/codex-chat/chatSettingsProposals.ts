import type { ChatExecutionContext, ChatProposal } from '@conai/shared'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import { fileOwnerKey } from '../fileStoreService'
import { requireFileStoreOwner } from '../fileStoreAccess'
import type { McpRequester } from '../../mcp/context'
import { ChatProposalStore } from './chatProposals'
import { ChatGroupStore } from './chatGroupStore'
import { ChatProfileStore } from './chatProfiles'
import { normalizeLorebookIds } from './chatLorebook'
import { LorebookError, OwnedLorebookStore } from './chatLorebookFiles'
import { assertLinkedFiles, describeLinkedFiles, LinkedFileError, LinkedFileStore, normalizeLinkedFiles, threadLinkedFiles, type LinkedFileLink, type LinkedFileView } from './chatLinkedFiles'
import { ChatMinutesStore, minutesFolders } from './chatMinutes'

/**
 * A chat's own settings a chat model may read and propose changing as a card: the account lorebooks linked to the chat,
 * the record book save_lore writes to, the file store folders and files linked to the chat, and the minutes folder.
 * Saving the card runs the same store calls as the chat's context tab (PATCH /threads/:id/context), as the person.
 */

export type ChatSettingsPatch = { lorebookIds?: number[]; loreRecordBookId?: number | null; linkedFiles?: LinkedFileLink[]; minutesFolderId?: string | null }
export type ChatSettingsInput = { lorebook_ids?: unknown; record_book_id?: unknown; linked_files?: unknown; minutes_folder_id?: unknown }
type ChatSettingsProposal = Extract<ChatProposal, { kind: 'chat_settings' }>

export class ChatSettingsError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

type ThreadRow = { id: number; account_id: number | null; kind: string | null; profile_id: number | null; minutes_folder_id: string | null }

function threadRow(threadId: number) {
  const row = getUserSettingsDb().prepare('SELECT id, account_id, kind, profile_id, minutes_folder_id FROM codex_chat_threads WHERE id = ?').get(threadId) as ThreadRow | undefined
  if (!row) throw new ChatSettingsError('채팅을 찾을 수 없어.', 404)
  return row
}

function threadProfiles(thread: ThreadRow) {
  const ids = thread.kind === 'group' ? ChatGroupStore.members(thread.id).map((member) => member.profile_id) : thread.profile_id ? [thread.profile_id] : []
  return ids.flatMap((id) => ChatProfileStore.find(id) ?? [])
}

const fileView = (view: LinkedFileView) => ({ id: view.id, name: view.name, kind: view.kind, write: view.write, folder: view.path, via: view.via, ...(view.profiles.length ? { profiles: view.profiles.map((profile) => profile.name) } : {}), ...(view.missing ? { missing: true } : {}) })

/** What the chat may read about its own settings (names and ids; no file contents). */
export function chatSettingsView(threadId: number) {
  const thread = threadRow(threadId)
  const owner = fileOwnerKey(thread.account_id)
  const books = OwnedLorebookStore.list(owner)
  const linked = OwnedLorebookStore.threadLinks(threadId)
  const recordId = OwnedLorebookStore.recordBookId(threadId)
  const folders = minutesFolders(thread)
  return {
    lorebooks: {
      linked: linked.map((id) => ({ id, name: books.find((book) => book.id === id)?.name ?? `#${id}` })),
      recordBook: recordId === null ? null : { id: recordId, name: books.find((book) => book.id === recordId)?.name ?? `#${recordId}` },
      accountBooks: books.map((book) => ({ id: book.id, name: book.name })),
    },
    linkedFiles: threadLinkedFiles(thread, threadProfiles(thread)).map(fileView),
    minutes: {
      folder: thread.minutes_folder_id ? (folders.find((view) => view.id === thread.minutes_folder_id) ? { id: thread.minutes_folder_id, name: folders.find((view) => view.id === thread.minutes_folder_id)!.name } : { id: thread.minutes_folder_id, name: null, stopped: true }) : null,
      choices: folders.map((view) => ({ id: view.id, name: view.name, folder: view.path })),
    },
  }
}

function bookNames(owner: string, ids: number[]) {
  const books = OwnedLorebookStore.list(owner)
  return ids.length ? ids.map((id) => books.find((book) => book.id === id)?.name ?? `#${id}`).join(', ') : '없음'
}

function fileNames(owner: string, links: LinkedFileLink[]) {
  return links.length ? describeLinkedFiles(owner, links).map((view) => `${view.name}${view.kind === 'folder' ? '/' : ''}${view.write ? ' (쓰기)' : ''}`).join(', ') : '없음'
}

/**
 * Validates the proposed changes against the chat owner's books and file store and returns the card to store: only
 * the keys that change, their current values, and how both read on the card.
 */
export function buildChatSettingsProposal(threadId: number, input: ChatSettingsInput) {
  const thread = threadRow(threadId)
  const owner = fileOwnerKey(thread.account_id)
  const patch: ChatSettingsPatch = {}
  const before: ChatSettingsPatch = {}
  const display: Record<string, { before: string; after: string }> = {}

  const currentBooks = OwnedLorebookStore.threadLinks(threadId)
  let books = currentBooks
  if (input.lorebook_ids !== undefined) {
    if (!Array.isArray(input.lorebook_ids)) throw new ChatSettingsError('lorebook_ids must be a list of account lorebook ids.')
    books = normalizeLorebookIds(input.lorebook_ids)
    const known = new Set(OwnedLorebookStore.list(owner).map((book) => book.id))
    const unknown = books.filter((id) => !known.has(id))
    if (unknown.length) throw new ChatSettingsError(`Not an account lorebook of this chat's owner: ${unknown.join(', ')}. get_chat_settings lists lorebooks.accountBooks.`)
    if (JSON.stringify(books) !== JSON.stringify(currentBooks)) {
      patch.lorebookIds = books
      before.lorebookIds = currentBooks
      display.lorebookIds = { before: bookNames(owner, currentBooks), after: bookNames(owner, books) }
    }
  }

  const currentRecord = OwnedLorebookStore.recordBookId(threadId)
  if (input.record_book_id !== undefined) {
    const record = input.record_book_id === null || input.record_book_id === 0 ? null : Number(input.record_book_id)
    if (record !== null && !books.includes(record)) throw new ChatSettingsError('record_book_id must be one of the account lorebooks linked to this chat (link it in lorebook_ids first), or null for this chat\'s own book.')
    if (record !== currentRecord) {
      patch.loreRecordBookId = record
      before.loreRecordBookId = currentRecord
      display.loreRecordBookId = { before: currentRecord === null ? '이 채팅 로어북' : bookNames(owner, [currentRecord]), after: record === null ? '이 채팅 로어북' : bookNames(owner, [record]) }
    }
  }

  const currentFiles = LinkedFileStore.threadLinks(threadId)
  let files = currentFiles
  if (input.linked_files !== undefined) {
    if (!Array.isArray(input.linked_files)) throw new ChatSettingsError('linked_files must be a list of { id, write }.')
    files = normalizeLinkedFiles(input.linked_files)
    if (files.length !== input.linked_files.length) throw new ChatSettingsError('linked_files: each item needs the 32-character id of a file store folder or text file (list_files / search_files show ids), at most 20, no repeats.')
    assertLinkedFiles(owner, files, currentFiles)
    if (JSON.stringify(files) !== JSON.stringify(currentFiles)) {
      patch.linkedFiles = files
      before.linkedFiles = currentFiles
      display.linkedFiles = { before: fileNames(owner, currentFiles), after: fileNames(owner, files) }
    }
  }

  if (input.minutes_folder_id !== undefined) {
    const folder = input.minutes_folder_id === null || input.minutes_folder_id === '' ? null : String(input.minutes_folder_id)
    // The folders minutes may go to once the proposed links apply: the chat's writable folders plus its profiles'.
    const fromProfiles = minutesFolders(thread).filter((view) => view.via === 'profile')
    const choices = [...describeLinkedFiles(owner, files).filter((view) => view.kind === 'folder' && view.write && !view.missing), ...fromProfiles]
    if (folder !== null && !choices.some((view) => view.id === folder)) throw new ChatSettingsError('minutes_folder_id must be a folder linked to this chat (or its profile) with writing allowed; link one in linked_files with write: true first.')
    if (folder !== thread.minutes_folder_id) {
      const name = (id: string | null) => id === null ? '끔' : (choices.find((view) => view.id === id)?.name ?? minutesFolders(thread).find((view) => view.id === id)?.name ?? '연결이 끊긴 폴더')
      patch.minutesFolderId = folder
      before.minutesFolderId = thread.minutes_folder_id
      display.minutesFolderId = { before: name(thread.minutes_folder_id), after: name(folder) }
    }
  }

  if (Object.keys(patch).length === 0) throw new ChatSettingsError('Nothing would change: every proposed value equals the current one.')
  return { kind: 'chat_settings' as const, patch, before, display }
}

export function proposeChatSettings(context: ChatExecutionContext, input: ChatSettingsInput): ChatProposal {
  return ChatProposalStore.add(context, buildChatSettingsProposal(context.threadId, input))
}

/** Saves a chat settings card for the chat's owner (the person pressing 저장), with the context tab's own rules. */
export function applyChatSettingsProposal(requester: McpRequester, proposalId: number): ChatProposal {
  const proposal = ChatProposalStore.find(proposalId)
  const threadId = ChatProposalStore.threadIdOf(proposalId)
  if (proposal?.kind !== 'chat_settings' || threadId === null) throw new ChatSettingsError('채팅 설정 제안이 아니야.')
  if (proposal.saved || proposal.dismissed) throw new ChatSettingsError('이미 저장하거나 넘긴 제안이야.', 409)
  const { patch } = proposal as ChatSettingsProposal
  try {
    getUserSettingsDb().transaction(() => {
      if (patch.lorebookIds !== undefined) OwnedLorebookStore.setThreadLinks(threadId, patch.lorebookIds)
      if (patch.loreRecordBookId !== undefined) OwnedLorebookStore.setRecordBook(threadId, patch.loreRecordBookId)
      if (patch.linkedFiles !== undefined) {
        requireFileStoreOwner(requester)
        LinkedFileStore.setThreadLinks(threadId, patch.linkedFiles)
      }
      if (patch.minutesFolderId !== undefined) {
        requireFileStoreOwner(requester)
        ChatMinutesStore.set(threadId, patch.minutesFolderId)
      }
    }).immediate()
  } catch (error) {
    if (error instanceof LorebookError || error instanceof LinkedFileError) throw new ChatSettingsError(error.message, error.status)
    throw error
  }
  return ChatProposalStore.markSaved(proposalId, null) as ChatProposal
}
