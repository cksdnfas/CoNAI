import type { McpRequester } from '../../mcp/context'
import { FileStoreService, fileOwnerKey } from '../fileStoreService'
import { ChatFlagStore } from './chatFlags'
import { ChatGroupStore } from './chatGroupStore'
import { OwnedLorebookStore } from './chatLorebookFiles'
import { ChatSummaryStore } from './chatMemory'
import { ChatProfileStore } from './chatProfiles'
import { ChatUserProfileStore } from './chatUserProfiles'
import { CodexChatService } from './codexChatService'

/** The file store folder chat backups go to, one subfolder per day. */
export const CHAT_BACKUP_FOLDER = '채팅 백업'

/**
 * A chat as a CoNAI chat file (`conai-chat` v1): what "export JSON" downloads and what import reads back. The chat's
 * own lorebook goes along as plain entries (the files an entry points at stay in the file store and are not copied).
 * `links` names what the chat was tied to in the account (flags on, user profile, linked account lorebooks) by id and
 * name, so an import can tie it again to the same ones, or to ones of the same name in another account.
 */
export function exportChatJson(requester: McpRequester, threadId: number) {
  const detail = CodexChatService.getThread(requester, threadId)
  const profile = detail.thread.profile_id ? ChatProfileStore.find(detail.thread.profile_id) : null
  const book = OwnedLorebookStore.chatBookOf(threadId)
  const owner = fileOwnerKey(requester.accountId)
  const flagIds = readIdList(detail.thread.flag_ids)
  const userProfile = ChatUserProfileStore.forThread(detail.thread)
  return {
    format: 'conai-chat',
    version: 1,
    exportedAt: new Date().toISOString(),
    profileName: profile?.name ?? null,
    thread: detail.thread,
    messages: detail.messages,
    media: detail.media,
    summarySegments: ChatSummaryStore.list(threadId),
    // A room's members, so an import can find them by id and name.
    members: detail.thread.kind === 'group' ? ChatGroupStore.members(threadId).map((member) => ({ id: member.profile_id, name: ChatProfileStore.find(member.profile_id)?.name ?? null })) : undefined,
    lorebook: book && book.entries.length > 0 ? { entries: book.entries.map((entry) => ({ ...entry, file: null, fileId: null })) } : undefined,
    links: {
      flags: ChatFlagStore.resolve(requester.accountId, flagIds).map(({ id, name }) => ({ id, name })),
      userProfile: userProfile ? { id: userProfile.id, name: userProfile.name } : null,
      lorebooks: OwnedLorebookStore.threadLinks(threadId).flatMap((id) => {
        const linked = OwnedLorebookStore.find(id, owner)
        return linked ? [{ id: linked.id, name: linked.name }] : []
      }),
    },
  }
}

/** A JSON id list column (`[1, 2]`), or none. */
function readIdList(value: string | null | undefined): number[] {
  try {
    const parsed = JSON.parse(value ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((id): id is number => Number.isSafeInteger(id)) : []
  } catch {
    return []
  }
}

/** `YYYY-MM-DD` as the browser gives it (the reader's day), else today on the server. */
export function backupDateOf(value: unknown) {
  if (typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) return value
  return new Date().toISOString().slice(0, 10)
}

/** A file name from a chat title: no path characters, no trailing dot or space, and the chat id so two never collide. */
export function backupFileName(title: string, threadId: number) {
  const base = (title || '새 채팅').normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80).replace(/[. ]+$/, '') || '새 채팅'
  return `${base} (#${threadId}).json`
}

/** Save a chat file into the requester's file store: `채팅 백업/<date>/<title> (#id).json`. */
export function backupChatToFiles(requester: McpRequester, threadId: number, date: string) {
  const file = exportChatJson(requester, threadId)
  const owner = fileOwnerKey(requester.accountId)
  const root = FileStoreService.ensureFolder(owner, null, CHAT_BACKUP_FOLDER)
  const day = FileStoreService.ensureFolder(owner, root.id, date)
  return FileStoreService.writeText(owner, day.id, backupFileName(file.thread.title, threadId), JSON.stringify(file, null, 2))
}
