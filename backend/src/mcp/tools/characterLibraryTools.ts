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
    description: 'Browse/search character settings; returns path, direct folders and paged summaries without tags. Use get_character_setting for a selected ID. If a folder is missing, browse from the top again.',
    inputSchema: z.object({
      folder_id: id.nullable().optional().describe('null: top-level settings; omitted: all settings'), query: z.string().optional().describe('Search names, tags and Korean tag names'), favorite: z.boolean().optional(),
      filters: z.partialRecord(z.enum(CHARACTER_FACET_KEYS as [CharacterFacetKey, ...CharacterFacetKey[]]), z.array(z.string())).optional().describe('Any tag within each dimension, all supplied dimensions'),
      sort: z.enum(['name', 'updated', 'created', 'created_asc']).optional(), include_facets: z.boolean().optional().describe('Include dimensions and tag counts for filtering; needs the Danbooru dictionary'),
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
    description: 'Draft appearance without saving; returns sections, outfitTags and Danbooru name for propose_character_library or a page draft. If dictionary lookup fails, install the Danbooru dictionary or use text.',
    inputSchema: z.object({
      source: z.enum(['danbooru', 'image', 'text']).describe('danbooru/image need the Danbooru dictionary to sort appearance/outfit tags; text sorts supplied tags'),
      character: z.string().optional().describe('Required for danbooru: character tag or exact Korean name; uses frequent appearance/outfit tags'),
      image_hash: z.string().optional().describe('Required for image: library composite hash; uses auto tags and tags an untagged image now; needs images.view'),
      text: z.string().optional().describe('Required for text: tags to sort'),
    }).strict(),
  }, async ({ source, character, image_hash, text }) => {
    try {
      requireContextPermission(context, 'characters.view')
      return textResult(await fillCharacterAppearance(source === 'danbooru' ? { source, character } : source === 'image' ? { source, imageHash: image_hash } : { source, text }, canViewImages()))
    } catch (error) { return errorResult(error) }
  })
  server.registerTool('get_character_setting', {
    description: 'Read a setting\'s appearance, outfits, ordered references/categories, expressions, groups and revision. Images/references need images.view. Use the revision in propose_character_library; if missing, list_character_library again.',
    inputSchema: z.object({ setting_id: id }).strict(),
  }, async ({ setting_id }) => runToolResult(() => {
    requireContextPermission(context, 'characters.view')
    const images = canViewImages()
    const setting = getCharacterSetting(setting_id, images)
    if (!context.requester || !isRequesterAdmin(context.requester)) setting.linkedProfiles = []
    return { ...setting, expressions: images && setting.expressionGroupId ? Object.fromEntries(EmoticonService.listEntries(setting.expressionGroupId).flatMap((entry) => entry.keywords.map((emotion) => [emotion, entry.compositeHash]))) : {} }
  }))
  server.registerTool('manage_character_folders', {
    description: 'Create, rename or move a character folder immediately; returns the folder. On cycles or duplicate sibling names, browse list_character_library and choose another destination/name.',
    inputSchema: z.discriminatedUnion('action', [
      z.object({ action: z.literal('create'), parent_id: id.nullable().optional().describe('null or omitted: root'), name: z.string().trim().min(1) }).strict(),
      z.object({ action: z.literal('rename'), folder_id: id, name: z.string().trim().min(1) }).strict(),
      z.object({ action: z.literal('move'), folder_id: id, parent_id: id.nullable().describe('null: root') }).strict(),
    ]),
  }, async (value) => runToolResult(() => {
    requireContextPermission(context, 'characters.edit')
    if (value.action === 'create') return createCharacterFolder({ parentId: value.parent_id ?? null, name: value.name })
    return patchCharacterFolder(value.folder_id, value.action === 'move' ? { parentId: value.parent_id } : { name: value.name })
  }))
  server.registerTool('propose_character_library', {
    description: 'Attach a character create/update/delete review card to the active chat; returns proposalId and card. Nothing is written until a person saves it. On conflict, reread get_character_setting and propose again; missing folders: list_character_library.',
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
