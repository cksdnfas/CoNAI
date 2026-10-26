import type { McpRequester } from '../../mcp/context'
import { fileOwnerKey } from '../fileStoreService'
import { CodexChatStore } from './codexChatStore'
import { CodexChatService } from './codexChatService'
import { GroupChatService } from './groupChatService'
import { OwnedLorebookStore } from './chatLorebookFiles'
import { applyMerge, assertMergeDecisions, previewMerge, type MergeResult } from './chatLorebookMerge'
import { backupChatToFiles, backupDateOf } from './chatBackup'
import { ChatAppearanceStore } from './chatAppearance'

export type ThreadLorebookOption = { action: 'delete' | 'keep' | 'merge'; targetId: number | null; decisions: unknown }

/** Shared native deletion: optional backup/book preservation, native removal, then appearance cleanup. */
export async function deleteChatThread(requester: McpRequester, threadId: number, options: {
  lorebook?: ThreadLorebookOption; backup?: boolean; backupDate?: unknown
  /** Internal guard, rechecked immediately before a direct room is removed. Never accepted from HTTP input. */
  beforeDelete?: () => void
} = {}) {
  const option: ThreadLorebookOption = options.lorebook ?? { action: 'delete', targetId: null, decisions: undefined }
  const owner = fileOwnerKey(requester.accountId)
  const thread = CodexChatStore.findThread(threadId, requester.accountId)
  const chatBook = thread ? OwnedLorebookStore.chatBookOf(threadId) : null
  if (chatBook && option.action === 'merge') assertMergeDecisions(previewMerge(chatBook.id, option.targetId as number, owner), option.decisions)
  if (options.backup === true) backupChatToFiles(requester, threadId, backupDateOf(options.backupDate))
  let lorebook: { action: ThreadLorebookOption['action']; bookId: number | null; merge?: Omit<MergeResult, 'book'> } = { action: chatBook ? option.action : 'delete', bookId: null }
  if (chatBook && option.action === 'keep') {
    lorebook = { action: 'keep', bookId: OwnedLorebookStore.keepChatBook(threadId).id }
  } else if (chatBook && option.action === 'merge') {
    const { book, ...counts } = applyMerge(chatBook.id, option.targetId as number, owner, option.decisions)
    lorebook = { action: 'merge', bookId: book.id, merge: counts }
  }
  try {
    if (thread?.kind === 'group') await GroupChatService.deleteThread(requester, threadId)
    else await CodexChatService.deleteThread(requester, threadId, options.beforeDelete)
  } catch (error) {
    if (chatBook && lorebook.action === 'merge') {
      try { OwnedLorebookStore.delete(chatBook.id, owner) } catch { /* an attached file can keep the book until the next deletion */ }
    }
    throw error
  }
  ChatAppearanceStore.threadDeleted(requester.accountId, threadId)
  return { lorebook }
}
