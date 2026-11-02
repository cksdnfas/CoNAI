import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { McpRequestContext } from '../context'
import { errorResult, runToolResult, textResult } from '../toolResults'
import { isRequesterAdmin, keyGroupPermissionKeys, requesterPermissionKeys, requireContextPermission } from '../../middleware/featureAccess'
import type { CharacterFacetKey } from '@conai/shared'
import { characterFolderPath, characterLibraryFacets, createCharacterFolder, getCharacterSetting, listCharacterFolders, listCharacterSettings, patchCharacterFolder } from '../../services/characterLibrary'
import { CHARACTER_FACET_KEYS, fillCharacterAppearance } from '../../services/characterAppearanceTags'
import { EmoticonService } from '../../services/emoticonService'
import { characterLibraryProposalSchema, proposeCharacterLibrary } from '../../services/codex-chat/characterLibraryProposals'

export function registerCharacterLibraryTools(server: McpServer, context: McpRequestContext) {
  const id = z.number().int().positive().safe()
  const canViewImages = () => context.requester ? requesterPermissionKeys(context.requester).includes('images.view') : context.keyGroup !== undefined ? keyGroupPermissionKeys(context.keyGroup).includes('images.view') : true
  server.registerTool('list_character_library', {
    description: 'Browse character appearance settings by folder, or search names, tags and Korean tag names across the library. folder_id null means top level; omitted means all settings. favorite, filters ({dimension: [tags]}: any tag of a dimension, all dimensions) and sort narrow the list; include_facets adds the dimensions with tag counts to choose filters from (needs the Danbooru dictionary). Returns path, direct folders and a paged settings summary (no tags). Use get_character_setting for the selected id. If a folder is missing, browse from the top again.',
    inputSchema: z.object({
      folder_id: id.nullable().optional(), query: z.string().optional(), favorite: z.boolean().optional(),
      filters: z.partialRecord(z.enum(CHARACTER_FACET_KEYS as [CharacterFacetKey, ...CharacterFacetKey[]]), z.array(z.string())).optional(),
      sort: z.enum(['name', 'updated', 'created', 'created_asc']).optional(), include_facets: z.boolean().optional(),
      limit: z.number().int().min(1).max(200).optional(), offset: z.number().int().nonnegative().optional(),
    }).strict(),
  }, async ({ folder_id, include_facets, limit, offset, sort, ...scope }) => runToolResult(() => {
    requireContextPermission(context, 'characters.view')
    const listed = { ...scope, ...(folder_id !== undefined ? { folderId: folder_id } : {}) }
    return {
      path: characterFolderPath(folder_id ?? null).map(({ id, name }) => ({ id, name })),
      folders: listCharacterFolders(folder_id ?? null),
      settings: listCharacterSettings({ ...listed, ...(sort ? { sort } : {}), ...(limit !== undefined ? { limit } : {}), ...(offset !== undefined ? { offset } : {}) }, canViewImages()),
      ...(include_facets ? { facets: characterLibraryFacets(listed) } : {}),
    }
  }))
  server.registerTool('fill_character_appearance', {
    description: 'Draft a look in setting sections without saving: source danbooru takes a character tag name or exact Korean name (its frequent appearance/outfit tags), image takes a library composite hash (its auto tags; an untagged image is tagged now), text sorts given tags. Returns sections, outfitTags and the Danbooru name. Put the result into propose_character_library save_setting (sections, outfits) or the open page draft. Danbooru and image sources need the Danbooru dictionary to sort tags.',
    inputSchema: z.object({ source: z.enum(['danbooru', 'image', 'text']), character: z.string().optional(), image_hash: z.string().optional(), text: z.string().optional() }).strict(),
  }, async ({ source, character, image_hash, text }) => {
    try {
      requireContextPermission(context, 'characters.view')
      return textResult(await fillCharacterAppearance(source === 'danbooru' ? { source, character } : source === 'image' ? { source, imageHash: image_hash } : { source, text }, canViewImages()))
    } catch (error) { return errorResult(error) }
  })
  server.registerTool('get_character_setting', {
    description: 'Read one character appearance setting by setting_id: sections (identity, hair, eyes, face, body, skin, traits, other), outfits (first is the default), the composed appearance, favorite, image hashes, ordered references ([{hash, category: string|null}]), person-named referenceCategories in display order, referenceCount, expressionCount, expression emotion-to-hash map, groups and revision. Images and references are hidden without images.view. Use the revision in propose_character_library to update it. If missing, list_character_library again.',
    inputSchema: z.object({ setting_id: id }).strict(),
  }, async ({ setting_id }) => runToolResult(() => {
    requireContextPermission(context, 'characters.view')
    const images = canViewImages()
    const setting = getCharacterSetting(setting_id, images)
    if (!context.requester || !isRequesterAdmin(context.requester)) setting.linkedProfiles = []
    return { ...setting, expressions: images && setting.expressionGroupId ? Object.fromEntries(EmoticonService.listEntries(setting.expressionGroupId).flatMap((entry) => entry.keywords.map((emotion) => [emotion, entry.compositeHash]))) : {} }
  }))
  server.registerTool('manage_character_folders', {
    description: 'Create, rename or move a character-library folder immediately. Create takes name and optional parent_id (null=root); rename takes folder_id and name; move takes folder_id and parent_id. Returns the folder. Cycles and duplicate sibling names are rejected: browse current folders and choose another destination/name.',
    inputSchema: z.discriminatedUnion('action', [
      z.object({ action: z.literal('create'), parent_id: id.nullable().optional(), name: z.string().trim().min(1) }).strict(),
      z.object({ action: z.literal('rename'), folder_id: id, name: z.string().trim().min(1) }).strict(),
      z.object({ action: z.literal('move'), folder_id: id, parent_id: id.nullable() }).strict(),
    ]),
  }, async (value) => runToolResult(() => {
    requireContextPermission(context, 'characters.edit')
    if (value.action === 'create') return createCharacterFolder({ parentId: value.parent_id ?? null, name: value.name })
    return patchCharacterFolder(value.folder_id, value.action === 'move' ? { parentId: value.parent_id } : { name: value.name })
  }))
  server.registerTool('propose_character_library', {
    description: 'Attach a character-library review card to the active chat: save_setting creates/updates, delete_setting or delete_folder proposes deletion. Nothing is written before a person saves the card. Create input needs folderId (null=root) and name; updates/deletes need setting_id and its current revision. input uses REST camelCase fields: write the look as sections (given keys replace those sections) and/or outfits ([{name, tags}], the whole list, first = default), or a plain appearance text that the server sorts into them, never both. references ([{hash, category: string|null}]) replaces the ordered gallery, needs images.view and unique library image hashes; categories must be null or in the referenceCategories this write leaves. referenceCategories replaces the ordered person-named category list (names unique case-insensitively); removing a category uncategorizes its existing images, and categories alone need no images.view. Returns proposalId and the card. On conflict read get_character_setting and propose again; missing folders require list_character_library.',
    inputSchema: characterLibraryProposalSchema,
  }, async (input) => {
    try {
      requireContextPermission(context, 'characters.edit')
      if (!context.chatContext) throw new Error('This proposal needs an active chat reply.')
      const proposal = proposeCharacterLibrary(context.chatContext, input, canViewImages())
      return textResult({ proposalId: proposal.id, note: 'Review and save the card to apply this change.' }, { structuredContent: { proposal } })
    } catch (error) { return errorResult(error) }
  })
}
