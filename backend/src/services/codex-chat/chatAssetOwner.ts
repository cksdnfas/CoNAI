import type { ChatAssetOwner } from '@conai/shared'
import { ChatProfileStore } from './chatProfiles'
import { CharacterLibraryError, characterSettingRow } from '../characterLibrary'
import { ChatAssetError } from './chatAssetAccess'

/** Numbers remain the internal profile shorthand; public batch responses always carry the tagged owner. */
export function chatAssetOwner(owner: ChatAssetOwner | number): ChatAssetOwner {
  return typeof owner === 'number' ? { kind: 'profile', id: owner } : owner
}
export function chatAssetRowOwner(row: { profile_id: number | null; setting_id: number | null }): ChatAssetOwner {
  return row.setting_id !== null ? { kind: 'setting', id: row.setting_id } : { kind: 'profile', id: row.profile_id! }
}
export function chatAssetOwnerProfile(input: ChatAssetOwner | number) {
  const owner = chatAssetOwner(input)
  if (owner.kind === 'profile') return ChatProfileStore.find(owner.id)
  try {
    const setting = characterSettingRow(owner.id)
    return { name: setting.name, appearance: setting.appearance, referenceHash: setting.reference_hash, avatarHash: setting.avatar_hash, backgroundHash: null, avatar: null, background: null }
  } catch (error) {
    if (error instanceof CharacterLibraryError && error.status === 404) throw new ChatAssetError(error.message, 404)
    throw error
  }
}
