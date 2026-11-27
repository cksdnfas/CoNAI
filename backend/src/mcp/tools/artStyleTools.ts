import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { ART_STYLE_LIMITS } from '@conai/shared'
import type { McpRequestContext } from '../context'
import { errorResult, runToolResult, textResult } from '../toolResults'
import { requireContextRight } from '../../middleware/featureAccess'
import { getArtStyle, listArtStyles, resolveArtStyleFile } from '../../services/artStyles'
import { artStyleProposalSchema, proposeArtStyle } from '../../services/codex-chat/artStyleProposals'
import { contextContentLimit } from '../../services/codex-chat/chatContentRating'
import { ChatProfileStore, profileSeesImages } from '../../services/codex-chat/chatProfiles'
import { CONTENT_RATING_BLOCKED, storedFileAllowed } from '../../services/contentRating'
import { previewImage } from '../../services/imagePreview'
import { mcpCanViewImages } from './characterLibraryTools'

const VIEW_MAX_IMAGES = 6

/** Art styles (그림 스타일) through the same service as /api/art-styles; changes only as a chat review card. */
export function registerArtStyleTools(server: McpServer, context: McpRequestContext) {
  server.registerTool('list_art_styles', {
    description: 'Find art styles (그림 스타일: reusable prompts with reference images); returns id, title, description, badges and imageCount per row. Read prompts and images with get_art_style.',
    inputSchema: z.object({
      query: z.string().max(200).optional().describe('Every word must match the title, description, a badge or a keyword'),
      badges: z.array(z.string().max(ART_STYLE_LIMITS.badge)).max(ART_STYLE_LIMITS.badges).optional().describe('Every badge must be on the style'),
      favorite: z.boolean().optional(),
      limit: z.number().int().min(1).max(200).optional(), offset: z.number().int().nonnegative().optional(),
    }).strict(),
  }, async (input) => runToolResult(() => {
    requireContextRight(context, 'read')
    const page = listArtStyles(input, false)
    return { items: page.items.map(({ id, title, description, badges, imageCount }) => ({ id, title, description, badges, imageCount })), total: page.total, hasMore: page.hasMore }
  }))
  server.registerTool('get_art_style', {
    description: 'Read one art style: positive and negative prompt, badges, keywords, its own images in order (id, name, size; first = cover; need content.read) and the revision propose_art_style needs. view_ids also returns those images as small previews (vision models). If missing, list_art_styles again.',
    inputSchema: z.object({
      style_id: z.number().int().positive().safe(),
      view_ids: z.array(z.string().regex(/^[a-f0-9]{32}$/)).max(VIEW_MAX_IMAGES).optional().describe(`Image ids from images[] to look at, at most ${VIEW_MAX_IMAGES}`),
    }).strict(),
  }, async ({ style_id, view_ids }) => {
    if (!view_ids?.length) {
      return runToolResult(() => {
        requireContextRight(context, 'read')
        return getArtStyle(style_id, mcpCanViewImages(context))
      })
    }
    try {
      requireContextRight(context, 'read')
      if (!mcpCanViewImages(context)) throw new Error('Permission required: content.read')
      if (context.chatContext) {
        const profile = ChatProfileStore.find(context.chatContext.profileId, context.chatContext.threadId)
        if (!profile || !profileSeesImages(profile)) throw new Error('Image viewing is off for this chat profile.')
      }
      const style = getArtStyle(style_id, true)
      // The style's own copies: what viewing them on the screen needs (content.read), not file-store access.
      const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [{ type: 'text', text: JSON.stringify(style) }]
      const limit = contextContentLimit(context)
      for (const id of new Set(view_ids)) {
        try {
          const file = resolveArtStyleFile(style_id, id)
          if (!file) throw new Error('not an image of this style')
          if (!await storedFileAllowed(id, limit)) throw new Error(CONTENT_RATING_BLOCKED)
          content.push({ type: 'text', text: `image ${id}:` })
          content.push({ type: 'image', data: await previewImage(file.filePath), mimeType: 'image/jpeg' })
        } catch (error) {
          content.push({ type: 'text', text: `image ${id}: ${error instanceof Error ? error.message : 'unavailable'}` })
        }
      }
      return { content }
    } catch (error) { return errorResult(error) }
  })
  server.registerTool('propose_art_style', {
    description: 'Attach an art style create/update/delete review card to the active chat; returns proposalId. Nothing is written until a person saves it. On a revision or title conflict, reread get_art_style and propose again.',
    inputSchema: artStyleProposalSchema,
  }, async (input) => {
    try {
      requireContextRight(context, 'edit')
      if (!context.chatContext) throw new Error('This proposal needs an active chat reply.')
      const proposal = proposeArtStyle(context.chatContext, input, mcpCanViewImages(context))
      return textResult({ proposalId: proposal.id, note: 'Review and save the card to apply this change.' }, { structuredContent: { proposal } })
    } catch (error) { return errorResult(error) }
  })
}
