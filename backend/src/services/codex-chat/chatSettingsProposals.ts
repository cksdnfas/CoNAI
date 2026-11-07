import type { ChatExecutionContext, ChatProposal } from '@conai/shared'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import { fileOwnerKey } from '../fileStoreService'
import { requireFileStoreOwner } from '../fileStoreAccess'
import type { McpRequester } from '../../mcp/context'
import { ChatProposalStore } from './chatProposals'
import { ChatGroupStore } from './chatGroupStore'
import { ChatProfileStore, type ChatProfile } from './chatProfiles'
import { applyChatModelOverride, chatModelOptions, hasChatModelOverride, validateChatModelPatch, warmClaudeChatModel, type ChatModelPatch } from './chatModelOverride'
import { modelLabelOf } from './chatModelRoles'
import { ChatProfileError } from './chatProfileError'
import { CodexChatStore } from './codexChatStore'
import { normalizeLorebookIds } from './chatLorebook'
import { LorebookError, OwnedLorebookStore } from './chatLorebookFiles'
import { assertLinkedFiles, describeLinkedFiles, LinkedFileError, LinkedFileStore, normalizeLinkedFiles, threadLinkedFiles, type LinkedFileLink, type LinkedFileView } from './chatLinkedFiles'
import { ChatMinutesStore, minutesFolders } from './chatMinutes'

/**
 * A chat's own settings a chat model may read and propose changing as a card: the account lorebooks linked to the chat,
 * the record book save_lore writes to, linked files, the minutes folder, and direct/member chat models.
 * Saving the card runs the same store calls as the chat's context tab (PATCH /threads/:id/context), as the person.
 */

type ChatSettingsProposal = Extract<ChatProposal, { kind: 'chat_settings' }>
export type ChatSettingsPatch = ChatSettingsProposal['patch']
export type ChatSettingsInput = { lorebook_ids?: unknown; record_book_id?: unknown; linked_files?: unknown; minutes_folder_id?: unknown; chatModelSlotId?: unknown; chatModel?: unknown; memberChatModels?: unknown }

export class ChatSettingsError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

type ThreadRow = { id: number; account_id: number | null; kind: string; profile_id: number | null; minutes_folder_id: string | null; chat_model_slot_id: number | null; chat_model: string | null }

function threadRow(threadId: number) {
  const row = getUserSettingsDb().prepare('SELECT id, account_id, kind, profile_id, minutes_folder_id, chat_model_slot_id, chat_model FROM codex_chat_threads WHERE id = ?').get(threadId) as ThreadRow | undefined
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
  const profiles = threadProfiles(thread)
  const slots = profiles.some(profile => profile.engine === 'llm') ? chatModelOptions().map(({ id, label }) => ({ id, label })) : []
  const modelView = (profileId: number | null, setting: Pick<ThreadRow, 'chat_model_slot_id' | 'chat_model'>) => {
    const profile = profiles.find(profile => profile.id === profileId)
    const effective = profile ? applyChatModelOverride(thread, profile) : null
    return {
      profileId, name: profile?.name ?? '삭제된 프로필', engine: profile?.engine ?? null,
      chatModelSlotId: setting.chat_model_slot_id, chatModel: setting.chat_model,
      followingProfile: !effective || !hasChatModelOverride(effective),
      label: effective ? modelLabelOf(effective) : null, profileLabel: profile ? modelLabelOf(profile) : null,
    }
  }
  return {
    slots,
    ...(thread.kind === 'group'
      ? { memberChatModels: Object.fromEntries(ChatGroupStore.members(threadId).map(member => [member.profile_id, modelView(member.profile_id, member)])) }
      : { chatModel: modelView(thread.profile_id, thread) }),
    lorebooks: {
      linked: linked.map((id) => ({ id, name: books.find((book) => book.id === id)?.name ?? `#${id}` })),
      recordBook: recordId === null ? null : { id: recordId, name: books.find((book) => book.id === recordId)?.name ?? `#${recordId}` },
      accountBooks: books.map((book) => ({ id: book.id, name: book.name })),
    },
    linkedFiles: threadLinkedFiles(thread, profiles).map(fileView),
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

const MODEL_KEYS = ['chatModelSlotId', 'chatModel'] as const
const modelValues = (setting: Pick<ThreadRow, 'chat_model_slot_id' | 'chat_model'>): Required<ChatModelPatch> => ({
  chatModelSlotId: setting.chat_model_slot_id, chatModel: setting.chat_model,
})

function validatedModels(thread: ThreadRow, input: ChatSettingsInput): Pick<ChatSettingsPatch, 'chatModelSlotId' | 'chatModel' | 'memberChatModels'> {
  const result: Pick<ChatSettingsPatch, 'chatModelSlotId' | 'chatModel' | 'memberChatModels'> = {}
  try {
    if (MODEL_KEYS.some(key => input[key] !== undefined)) {
      if (thread.kind === 'group') throw new ChatSettingsError('그룹 방의 대화 모델은 참가자별로 설정해줘.')
      Object.assign(result, validateChatModelPatch(thread.profile_id === null ? null : ChatProfileStore.find(thread.profile_id), input))
    }
    if (input.memberChatModels !== undefined) {
      if (thread.kind !== 'group') throw new ChatSettingsError('참가자별 대화 모델은 그룹 방에서 설정해줘.')
      if (!input.memberChatModels || typeof input.memberChatModels !== 'object' || Array.isArray(input.memberChatModels)) throw new ChatSettingsError('참가자별 대화 모델 설정을 다시 확인해줘.')
      const members = new Set(ChatGroupStore.members(thread.id).map(member => member.profile_id))
      result.memberChatModels = {}
      for (const [id, value] of Object.entries(input.memberChatModels)) {
        const profileId = Number(id)
        if (!Number.isSafeInteger(profileId) || String(profileId) !== id || !members.has(profileId)) throw new ChatSettingsError('이 방의 참가자가 아니야.', 404)
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ChatSettingsError('참가자의 대화 모델 설정을 다시 확인해줘.')
        result.memberChatModels[id] = validateChatModelPatch(ChatProfileStore.find(profileId), value)
      }
    }
  } catch (error) {
    if (error instanceof ChatProfileError) throw new ChatSettingsError(error.message)
    throw error
  }
  return result
}

function modelDescription(thread: ThreadRow, profile: ChatProfile | null, setting: Required<ChatModelPatch>) {
  if (!profile) return '삭제된 프로필 · 프로필 따름'
  const effective = applyChatModelOverride({
    id: thread.id, kind: 'direct', profile_id: profile.id,
    chat_model_slot_id: setting.chatModelSlotId, chat_model: setting.chatModel,
  }, profile)
  const label = modelLabelOf(effective) || '모델 없음'
  return `${profile.name} · ${hasChatModelOverride(effective) ? label : `프로필 따름 (${label})`}`
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
  const models = validatedModels(thread, input)
  const currentModel = modelValues(thread)
  const profile = thread.profile_id === null ? null : ChatProfileStore.find(thread.profile_id)
  for (const key of MODEL_KEYS) {
    if (models[key] === undefined || models[key] === currentModel[key]) continue
    Object.assign(patch, { [key]: models[key] })
    Object.assign(before, { [key]: currentModel[key] })
    display[key] = { before: modelDescription(thread, profile, currentModel), after: modelDescription(thread, profile, { ...currentModel, ...models }) }
  }
  if (models.memberChatModels) {
    const members = ChatGroupStore.members(threadId)
    const memberPatch: NonNullable<ChatSettingsPatch['memberChatModels']> = {}
    const memberBefore: NonNullable<ChatSettingsPatch['memberChatModels']> = {}
    const descriptions: Array<{ before: string; after: string }> = []
    for (const [id, values] of Object.entries(models.memberChatModels)) {
      const current = modelValues(members.find(member => member.profile_id === Number(id))!)
      const changed = MODEL_KEYS.filter(key => values[key] !== undefined && values[key] !== current[key])
      if (!changed.length) continue
      memberPatch[id] = Object.fromEntries(changed.map(key => [key, values[key]]))
      memberBefore[id] = Object.fromEntries(changed.map(key => [key, current[key]]))
      const memberProfile = ChatProfileStore.find(Number(id))
      descriptions.push({ before: modelDescription(thread, memberProfile, current), after: modelDescription(thread, memberProfile, { ...current, ...values }) })
    }
    if (descriptions.length) {
      patch.memberChatModels = memberPatch
      before.memberChatModels = memberBefore
      display.memberChatModels = { before: descriptions.map(item => item.before).join('\n'), after: descriptions.map(item => item.after).join('\n') }
    }
  }

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
  try {
    const saved = getUserSettingsDb().transaction(() => {
      const proposal = ChatProposalStore.find(proposalId)
      const threadId = ChatProposalStore.threadIdOf(proposalId)
      if (proposal?.kind !== 'chat_settings' || threadId === null) throw new ChatSettingsError('채팅 설정 제안이 아니야.')
      if (proposal.saved || proposal.dismissed) throw new ChatSettingsError('이미 저장하거나 넘긴 제안이야.', 409)
      const { patch, before } = proposal as ChatSettingsProposal
      const thread = threadRow(threadId)
      const models = validatedModels(thread, patch)
      const memberCurrent = Object.fromEntries(Object.entries(patch.memberChatModels ?? {}).map(([id, values]) => {
        const member = modelValues(ChatGroupStore.member(threadId, Number(id))!)
        return [id, Object.fromEntries(Object.keys(values).sort().map(key => [key, member[key as keyof ChatModelPatch]]))]
      }))
      const current: ChatSettingsPatch = {
        ...modelValues(thread), memberChatModels: memberCurrent,
        lorebookIds: normalizeLorebookIds(OwnedLorebookStore.threadLinks(threadId)),
        loreRecordBookId: OwnedLorebookStore.recordBookId(threadId),
        linkedFiles: normalizeLinkedFiles(LinkedFileStore.threadLinks(threadId)),
        minutesFolderId: thread.minutes_folder_id ?? null,
      }
      const normalized = (key: keyof ChatSettingsPatch, value: unknown) => key === 'lorebookIds'
        ? normalizeLorebookIds(value) : key === 'linkedFiles' ? normalizeLinkedFiles(value)
          : key === 'memberChatModels' && value && typeof value === 'object'
            ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([id, fields]) => [id,
              Object.fromEntries(Object.entries(fields as ChatModelPatch).sort(([a], [b]) => a.localeCompare(b)).map(([field, entry]) => [field, entry === '' ? null : entry ?? null]))]))
            : value === '' ? null : value ?? null
      for (const key of Object.keys(patch) as Array<keyof ChatSettingsPatch>) {
        if (!Object.prototype.hasOwnProperty.call(before, key) || JSON.stringify(normalized(key, current[key])) !== JSON.stringify(normalized(key, before[key]))) {
          throw new ChatSettingsError('제안 이후 채팅 설정이 바뀌었어. 새 제안을 만들어줘.', 409)
        }
      }
      CodexChatStore.updateThreadContext(threadId, models)
      for (const [id, values] of Object.entries(models.memberChatModels ?? {})) ChatGroupStore.setMemberChatModel(threadId, Number(id), values)
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
      return ChatProposalStore.markSaved(proposalId, null, { notify: false }) as ChatProposal
    }).immediate()
    if (saved.kind === 'chat_settings') {
      if (saved.patch.chatModel) warmClaudeChatModel(threadRow(ChatProposalStore.threadIdOf(proposalId)!).profile_id, saved.patch)
      for (const [id, values] of Object.entries(saved.patch.memberChatModels ?? {})) warmClaudeChatModel(Number(id), values)
    }
    ChatProposalStore.notifySaved(saved)
    return saved
  } catch (error) {
    if (error instanceof LorebookError || error instanceof LinkedFileError) throw new ChatSettingsError(error.message, error.status)
    throw error
  }
}
