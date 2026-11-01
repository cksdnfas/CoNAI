/**
 * Character library (`/characters`, REST `/api/character-library`). Folders nest freely (a work, a character, …) and
 * hold appearance settings. A setting is one look of a character: image-prompt tags, the reference image, the avatar
 * cut from it, and its expression and candidate image groups. Images stay in the media library (composite hashes).
 * Chat profiles link to one setting; image generation pages copy a setting's values into their inputs.
 */

export type CharacterAvatarCrop = { x: number; y: number; scale: number }

/**
 * The look as image-prompt tags in fixed sections (comma-separated text each, emphasis syntax kept): who it is
 * (character/work tags, 1girl…), hair, eyes, face, body, skin and markings, species and type traits, and the rest.
 */
export type CharacterAppearanceSectionKey = 'identity' | 'hair' | 'eyes' | 'face' | 'body' | 'skin' | 'traits' | 'other'
export type CharacterAppearanceSections = Record<CharacterAppearanceSectionKey, string>
/** One outfit of the look (its clothing and accessory tags); the first is the default one. */
export type CharacterOutfit = { name: string; tags: string }

/**
 * Filter dimensions of the library and the catalog, classified by the installed Danbooru dictionary: work, character,
 * subject (1girl…), hair colour/length/style, eye colour, skin colour, species and outfit.
 */
export type CharacterFacetKey = 'copyright' | 'character' | 'subject' | 'hairColor' | 'hairLength' | 'hairStyle' | 'eyeColor' | 'skinColor' | 'species' | 'outfit'
/** Selected tags per dimension: tags of one dimension match any of them, dimensions all apply. */
export type CharacterSettingFilters = Partial<Record<CharacterFacetKey, string[]>>
export type CharacterSettingSort = 'name' | 'updated' | 'created' | 'created_asc'
/** One dimension's tags present in the listed settings (or the catalog's choices, with `count` null). */
export type CharacterFacetDimension = { key: CharacterFacetKey; values: Array<{ tag: string; label: string; translated: string | null; count: number | null }> }
/** `available` false: no Danbooru dictionary is installed, so there are no dimensions. */
export type CharacterLibraryFacets = { available: boolean; dimensions: CharacterFacetDimension[] }

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
  favorite: boolean
  /** The work among its tags (a Danbooru copyright's tag name); null without one or a dictionary. */
  copyright: string | null
  /** The work's Korean name when the dictionary has one. */
  copyrightTranslated: string | null
  /** Its outfits; the first is the default one. */
  outfitCount: number
}

export type CharacterSetting = CharacterSettingSummary & {
  /** Folder names from the top level down to the setting's folder; empty at the top level. */
  path: string[]
  /**
   * What profiles, generation and expressions read: the sections then the default (first) outfit, joined
   * (`composeCharacterAppearance`), up to `CHAT_PROFILE_TEXT_LIMITS.text` characters.
   */
  appearance: string
  /** A setting saved before sections existed reads its whole text as `other`. */
  sections: CharacterAppearanceSections
  outfits: CharacterOutfit[]
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

/**
 * Names are unique within a folder (case-insensitive). Image fields take library composite hashes. The look is
 * written as `sections` (omitted keys stay) and/or `outfits`; a plain `appearance` text instead (older writers, a
 * profile's own text) is split into sections and the default outfit by the Danbooru dictionary, everything under
 * `other` without one. Both at once are refused.
 */
export type CharacterSettingCreateInput = {
  folderId: number | null
  name: string
  appearance?: string
  sections?: Partial<CharacterAppearanceSections>
  outfits?: CharacterOutfit[]
  referenceHash?: string | null
  avatarHash?: string | null
  avatarCrop?: CharacterAvatarCrop | null
}

/** Only the given fields change. `revision` must equal the stored one, otherwise the save is refused with 409. */
export type CharacterSettingPatch = Partial<CharacterSettingCreateInput> & { revision: number }

/** `GET /settings`: a folder (`root`) or the whole library, a search over names and tags (Korean tag names too). */
export type CharacterSettingListQuery = {
  folderId?: number | null
  query?: string
  favorite?: boolean
  filters?: CharacterSettingFilters
  sort?: CharacterSettingSort
  limit?: number
  offset?: number
}

/**
 * An unsaved look from a source, already in sections: a Danbooru character's frequent tags, the reference image's
 * auto tags (tagged now when it has none), or a text to sort into sections. Expressions, poses and scene tags are
 * left out for the first two. `POST /settings/appearance-fill`.
 */
export type CharacterAppearanceFillInput =
  | { source: 'danbooru'; character: string }
  | { source: 'image'; imageHash: string }
  | { source: 'text'; text: string }
/** `outfitTags` belong in an outfit; `name` is the Danbooru character's Korean or display name. */
export type CharacterAppearanceFill = { sections: CharacterAppearanceSections; outfitTags: string; name: string | null }

/** Several listed settings at once; a move is refused whole when a name is taken in the destination. */
export type CharacterSettingBulkInput = { ids: number[] } & (
  | { action: 'favorite'; favorite: boolean }
  | { action: 'move'; folderId: number | null }
  | { action: 'delete' }
)
export type CharacterSettingBulkResult = { changed: number }

/**
 * One setting of a portable bundle (`POST /settings/export` answers a ZIP: `character-library.json` holding
 * `CharacterLibraryExport`, and `images/<hash>.<ext>` for every image named here). Folder path from the export's top.
 */
export type CharacterLibraryExportEntry = {
  path: string[]
  name: string
  sections: CharacterAppearanceSections
  outfits: CharacterOutfit[]
  favorite: boolean
  /** Composite hashes of the bundled images; null/empty for viewers without `images.view`. */
  referenceHash: string | null
  avatarHash: string | null
  avatarCrop: CharacterAvatarCrop | null
  /** The expression images with their emotion keywords. */
  expressions: Array<{ hash: string; keywords: string[] }>
  /** The generated asset candidates. */
  candidates: string[]
}
export type CharacterLibraryExport = { format: 'conai.character-library'; version: 1; settings: CharacterLibraryExportEntry[] }
/** `ids`, or a folder with everything under it (`null`: the whole library). */
export type CharacterLibraryExportInput = { ids: number[] } | { folderId: number | null }
/**
 * `POST /settings/import` (multipart `file`: an exported ZIP, `folderId`: target, empty for the top level): folders
 * are created (or reused by name) under it, taken names get ` (2)`, ` (3)`…, bundled images join the library (needs
 * `images.view` and `images.upload`), and an image neither bundled nor already in the library is dropped and counted.
 */
export type CharacterLibraryImportResult = { createdSettings: number; createdFolders: number; renamed: number; importedImages: number; droppedImages: number }

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
  /**
   * The setting's outfit (by name) the profile wears while synced, and copies when detaching; null, or a name the
   * setting no longer has, is the default (first) outfit.
   */
  outfit: string | null
}

/**
 * The link a profile save sets: a setting, synced or detached; null removes the link; omitted leaves it as is.
 * `outfit` omitted keeps the stored choice while the setting stays the same (else the default).
 */
export type ChatProfileCharacterLinkInput = { settingId: number; synced: boolean; outfit?: string | null } | null

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
