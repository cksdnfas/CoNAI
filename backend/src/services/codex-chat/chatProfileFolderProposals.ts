import { createHash } from 'crypto'
import { folderPath, type ChatExecutionContext, type ChatProposal } from '@conai/shared'
import { z } from 'zod'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import { isRequesterAdmin } from '../../middleware/featureAccess'
import type { McpRequester } from '../../mcp/context'
import { characterLibraryId, characterLibraryName } from '../characterLibraryInput'
import { assertFolderDestination } from '../libraryFolderStore'
import { checkedProfileFolder, createChatProfileFolder, deleteChatProfileFolder, listChatProfileFolders, updateChatProfileFolder } from './chatProfileFolders'
import { ChatProfileError } from './chatProfileError'
import { ChatProposalStore } from './chatProposals'
import { requireActiveChatReply } from './chatReplyRegistry'
import { CodexChatStore } from './codexChatStore'

type FolderProposal = Extract<ChatProposal, { kind: 'profile_folder' }>
export const profileFolderMutationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), name: characterLibraryName, parent_id: characterLibraryId.nullable().optional() }).strict(),
  z.object({ action: z.literal('rename'), folder_id: characterLibraryId, name: characterLibraryName }).strict(),
  z.object({ action: z.literal('move'), folder_id: characterLibraryId, parent_id: characterLibraryId.nullable() }).strict(),
  z.object({ action: z.literal('delete'), folder_id: characterLibraryId }).strict(),
])

export class ProfileFolderProposalError extends ChatProfileError {
  constructor(message: string, readonly status = 409) { super(message) }
}

function snapshot(action: FolderProposal['action'], id: number | null, parentId: number | null, folders = listChatProfileFolders()) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const target = id === null ? null : byId.get(id)
  if (id !== null && !target) throw new ProfileFolderProposalError('폴더를 찾을 수 없어. 다시 제안해줘.')
  checkedProfileFolder(parentId)
  const beforePath = folderPath(byId, id).map((folder) => folder.name)
  const destination = folderPath(byId, parentId).map(({ id, name, parentId }) => ({ id, name, parentId }))
  const children = action === 'delete' ? folders.filter((folder) => folder.parentId === id).map(({ id, name }) => ({ id, name })).sort((a, b) => a.id - b.id) : []
  const profiles = action === 'delete' ? getUserSettingsDb().prepare('SELECT id, revision, sort_order FROM llm_chat_profiles WHERE folder_id = ? ORDER BY id').all(id) : []
  const revision = createHash('sha256').update(JSON.stringify({ target: target ? { id: target.id, name: target.name, parentId: target.parentId } : null, destination, children, profiles })).digest('hex')
  return { revision, beforePath, parentPath: destination.map((folder) => folder.name) }
}

export function proposeProfileFolder(context: ChatExecutionContext, input: unknown) {
  requireActiveChatReply(context)
  const value = profileFolderMutationSchema.parse(input)
  const folderId = value.action === 'create' ? null : value.folder_id
  checkedProfileFolder(folderId)
  const folders = listChatProfileFolders()
  const folder = folderId === null ? null : folders.find((entry) => entry.id === folderId)!
  const name = 'name' in value ? value.name : folder!.name
  const parentId = 'parent_id' in value ? value.parent_id ?? null : folder?.parentId ?? null
  if (folderId !== null && value.action === 'move') assertFolderDestination('chat_profile_folders', folderId, parentId, () => new ChatProfileError('폴더를 자신이나 하위 폴더로 옮길 수 없어.'))
  const { revision, beforePath, parentPath } = snapshot(value.action, folderId, parentId, folders)
  return ChatProposalStore.add(context, { kind: 'profile_folder', action: value.action, folderId, name, parentId, beforePath,
    afterPath: value.action === 'delete' ? parentPath : [...parentPath, name], revision })
}

/** Owned administrator approval: mutation, conflict check and receipt commit together. */
export function applyProfileFolderProposal(requester: McpRequester, id: number): FolderProposal {
  if (!isRequesterAdmin(requester)) throw new ProfileFolderProposalError('관리자 권한이 필요해.', 403)
  const proposal = getUserSettingsDb().transaction(() => {
    const stored = ChatProposalStore.find(id)
    const threadId = ChatProposalStore.threadIdOf(id)
    if (stored?.kind !== 'profile_folder' || threadId === null || !CodexChatStore.findThread(threadId, requester.accountId)) throw new ProfileFolderProposalError('제안을 찾을 수 없어.', 404)
    if (stored.saved || stored.dismissed) throw new ProfileFolderProposalError('이미 처리한 제안이야.')
    if (snapshot(stored.action, stored.folderId, stored.parentId).revision !== stored.revision) throw new ProfileFolderProposalError('폴더나 내용이 바뀌었어. 다시 제안해줘.')
    if (stored.action === 'create') createChatProfileFolder({ name: stored.name, parentId: stored.parentId })
    else if (stored.action === 'delete') deleteChatProfileFolder(stored.folderId!)
    else updateChatProfileFolder(stored.folderId!, stored.action === 'move' ? { parentId: stored.parentId } : { name: stored.name })
    return ChatProposalStore.markSaved(id, null, { notify: false }) as FolderProposal
  }).immediate()
  ChatProposalStore.notifySaved(proposal)
  return proposal
}
