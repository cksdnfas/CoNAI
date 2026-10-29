import type { McpRequester } from '../../mcp/context'
import { fileOwnerKey } from '../fileStoreService'
import { CodexChatStore } from './codexChatStore'
import { CodexChatService } from './codexChatService'
import { GroupChatService } from './groupChatService'
import { OwnedLorebookStore } from './chatLorebookFiles'
import { applyMergePreview, assertMergeAllowed, previewMerge, requireMergeTarget, type MergeResult } from './chatLorebookMerge'
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
  const validate = () => {
    const chatBook = thread ? OwnedLorebookStore.chatBookReadOnly(threadId) : null
    if (option.action === 'keep' && chatBook) OwnedLorebookStore.previewKeepChatBook(threadId)
    if (option.action === 'merge' && thread) {
      if (chatBook) assertMergeAllowed(previewMerge(chatBook.id, option.targetId as number, owner, { readOnly: true }), option.decisions)
      else requireMergeTarget(option.targetId as number, owner, true)
    }
  }
  validate()
  let lorebook: { action: ThreadLorebookOption['action']; bookId: number | null; merge?: Omit<MergeResult, 'book'> } = { action: 'delete', bookId: null }
  const beforeDelete = () => {
    options.beforeDelete?.()
    validate()
    if (options.backup === true) backupChatToFiles(requester, threadId, backupDateOf(options.backupDate), { readOnlyLorebooks: true })
  }
  const preserve = () => {
    const chatBook = OwnedLorebookStore.chatBookReadOnly(threadId)
    if (chatBook && option.action === 'keep') {
      lorebook = { action: 'keep', bookId: OwnedLorebookStore.keepChatBook(threadId).id }
    } else if (chatBook && option.action === 'merge') {
      const preview = previewMerge(chatBook.id, option.targetId as number, owner, { readOnly: true })
      const { book, ...counts } = applyMergePreview(preview, owner, option.decisions)
      lorebook = { action: 'merge', bookId: book.id, merge: counts }
    }
  }
  if (thread?.kind === 'group') await GroupChatService.deleteThread(requester, threadId, beforeDelete, preserve)
  else await CodexChatService.deleteThread(requester, threadId, beforeDelete, preserve)
  ChatAppearanceStore.threadDeleted(requester.accountId, threadId)
  return { lorebook }
}
