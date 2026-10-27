/**
 * Character library (`/characters`, REST `/api/character-library`). Folders nest freely (a work, a character, …) and
 * hold appearance settings. A setting is one look of a character: image-prompt tags, the reference image, the avatar
 * cut from it, and its expression and candidate image groups. Images stay in the media library (composite hashes).
 * Chat profiles link to one setting; image generation pages copy a setting's values into their inputs.
 */

export type CharacterAvatarCrop = { x: number; y: number; scale: number }

export type CharacterFolder = {
  id: number
  parentId: number | null
  name: string
  /** Settings directly in this folder, not in its subfolders. */
  settingCount: number
  createdAt: string
  updatedAt: string
}

/** Names are unique among siblings (case-insensitive). */
export type CharacterFolderCreateInput = { parentId: number | null; name: string }

/** Rename and/or move; `parentId: null` moves to the top level. A folder never moves under itself or a descendant. */
export type CharacterFolderPatch = { name?: string; parentId?: number | null }

export type CharacterSettingSummary = {
  id: number
  folderId: number | null
  name: string
  /** Library composite hashes; null when unset or when the viewer lacks `images.view`. */
  referenceHash: string | null
  avatarHash: string | null
  avatarCrop: CharacterAvatarCrop | null
  /** Bumped by every change of the setting, its images and expressions included; saves send it back. */
  revision: number
  updatedAt: string
  /** Chat profiles synced to this setting: editing the setting changes all of them. */
  linkedProfileCount: number
}

export type CharacterSetting = CharacterSettingSummary & {
  /** Folder names from the top level down to the setting's folder; empty at the top level. */
  path: string[]
  /** Image-prompt tags of the look (hair, eyes, outfit…), up to `CHAT_PROFILE_TEXT_LIMITS.text` characters. */
  appearance: string
  /** Emoticon group with one keyworded image per emotion; null until the first expression. */
  expressionGroupId: number | null
  /** Group holding this setting's generated asset candidates; null until the first generation. */
  candidateGroupId: number | null
  createdAt: string
  /** Chat profiles synced to this setting, named for administrators only (others get an empty list and the count). */
  linkedProfiles: Array<{ id: number; name: string }>
}

/** One page of a folder's settings, or of a search across the whole library. */
export type CharacterSettingPage = { items: CharacterSettingSummary[]; total: number; hasMore: boolean }

/** Names are unique within a folder (case-insensitive). Image fields take library composite hashes. */
export type CharacterSettingCreateInput = {
  folderId: number | null
  name: string
  appearance?: string
  referenceHash?: string | null
  avatarHash?: string | null
  avatarCrop?: CharacterAvatarCrop | null
}

/** Only the given fields change. `revision` must equal the stored one, otherwise the save is refused with 409. */
export type CharacterSettingPatch = Partial<CharacterSettingCreateInput> & { revision: number }

/** What a folder or setting deletion removes; synced profiles keep a copy of a deleted setting's values. */
export type CharacterLibraryDeletePreview = {
  folders: number
  settings: number
  /** Synced profiles that keep a copy of the deleted values. */
  linkedProfileCount: number
  /** Their names, for administrators only; empty for others. */
  linkedProfiles: Array<{ id: number; name: string }>
}

export type CharacterLibraryDeleteResult = { deletedFolders: number; deletedSettings: number }

/**
 * A chat profile's link to a library setting. Synced: the profile shows the setting's appearance tags, reference,
 * avatar and expressions, and editing them from the profile edits the setting (every synced profile changes).
 * Detached: the profile keeps its own copy and remembers the setting it came from.
 */
export type ChatProfileCharacterLink = {
  settingId: number
  synced: boolean
  settingName: string
  /** Folder names from the top level down to the setting's folder. */
  path: string[]
  /** The setting's current revision; saving the setting from the profile editor sends it back. */
  revision: number
  /** Profiles synced to the setting, this one included when synced. */
  linkedProfileCount: number
}

/** The link a profile save sets: a setting, synced or detached; null removes the link; omitted leaves it as is. */
export type ChatProfileCharacterLinkInput = { settingId: number; synced: boolean } | null

/**
 * Save a profile's own appearance (the editor's current values) into the library and leave the profile synced to it:
 * as a new setting, or over the setting it is detached from. The profile's expressions are copied into the setting.
 * `POST /api/character-library/settings/from-profile` → `CharacterSetting`.
 */
export type CharacterSettingFromProfileInput = {
  profileId: number
  appearance: string
  referenceHash: string | null
  avatarHash: string | null
  avatarCrop: CharacterAvatarCrop | null
} & (
  | { mode: 'create'; folderId: number | null; name: string }
  | { mode: 'overwrite'; settingId: number; revision: number }
)

/** Unsaved appearance-tag draft for a setting from its name and reference image; the response is `{ appearance }`. */
export type CharacterAppearanceDraftInput = { settingId?: number | null; name: string; appearance?: string; referenceHash?: string | null }

/**
 * A library change proposed from a chat (`propose_character_library`). The server validates it before attaching; a
 * person applies it from the card through the REST API, and `savedId` / `saved` are written back like other proposals.
 */
export type ChatCharacterLibraryProposal = { kind: 'character_library'; savedId?: number | null; saved?: boolean } & (
  /** `settingId` null creates the setting (`input` then carries `folderId` and `name`); otherwise an update against `revision`. */
  | { action: 'save_setting'; settingId: number | null; revision: number | null; settingName: string; input: Partial<CharacterSettingCreateInput> }
  | { action: 'delete_setting'; settingId: number; settingName: string; revision: number }
  | { action: 'delete_folder'; folderId: number; folderName: string }
)
