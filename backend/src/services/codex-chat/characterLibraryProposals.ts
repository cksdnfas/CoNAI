import type { ChatCharacterLibraryProposal, ChatExecutionContext } from '@conai/shared'
import { z } from 'zod'
import { characterId, CharacterLibraryError, getCharacterFolder, getCharacterSetting, validateCharacterSetting } from '../characterLibrary'
import { characterSettingCreateSchema } from '../characterLibraryInput'
import { ChatProposalStore } from './chatProposals'
import { requireActiveChatReply } from './chatReplyRegistry'

export const characterLibraryProposalSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save_setting'), setting_id: z.number().int().positive().nullable().optional(), revision: z.number().int().positive().optional(), input: characterSettingCreateSchema.partial() }).strict(),
  z.object({ action: z.literal('delete_setting'), setting_id: z.number().int().positive(), revision: z.number().int().positive() }).strict(),
  z.object({ action: z.literal('delete_folder'), folder_id: z.number().int().positive() }).strict(),
])
/** Proposals validate the same input and optimistic revision as REST; only a human card save writes it. */
export function proposeCharacterLibrary(context: ChatExecutionContext, input: unknown, canViewImages: boolean) {
  requireActiveChatReply(context)
  const value = characterLibraryProposalSchema.parse(input)
  let proposal: ChatCharacterLibraryProposal
  if (value.action === 'delete_folder') {
    const folder = getCharacterFolder(characterId(value.folder_id))
    proposal = { kind: 'character_library', action: value.action, folderId: folder.id, folderName: folder.name }
  } else if (value.action === 'delete_setting') {
    const setting = getCharacterSetting(value.setting_id)
    if (setting.revision !== value.revision) throw new CharacterLibraryError('설정이 바뀌었어. 다시 읽고 제안해줘.', 409, setting.revision, 'revision_conflict')
    proposal = { kind: 'character_library', action: value.action, settingId: setting.id, settingName: setting.name, revision: setting.revision }
  } else {
    const setting = value.setting_id ? getCharacterSetting(value.setting_id) : null
    const validated = validateCharacterSetting(setting ? { ...value.input, revision: value.revision } : value.input, setting?.id, canViewImages)
    const { revision: _revision, ...clean } = validated as typeof validated & { revision?: number }
    proposal = { kind: 'character_library', action: value.action, settingId: setting?.id ?? null, settingName: validated.name ?? setting!.name, revision: setting?.revision ?? null, input: clean }
  }
  return ChatProposalStore.add(context, proposal)
}
