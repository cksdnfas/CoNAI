import { ART_STYLE_LIMITS, type ChatArtStyleProposal, type ChatArtStyleProposalInput, type ChatExecutionContext } from '@conai/shared'
import { z } from 'zod'
import { ArtStyleError, artStyleRow, validateArtStyleChange } from '../artStyles'
import { ChatProposalStore } from './chatProposals'
import { requireActiveChatReply } from './chatReplyRegistry'

const id = z.number().int().positive().safe()
const terms = (chars: number, count: number) => z.array(z.string().max(chars)).max(count)
export const artStyleProposalSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('save_style'),
    style_id: id.nullable().optional().describe('Omit/null to create (input.title required); an ID to change that style'),
    revision: id.optional().describe('From get_art_style; required for a change'),
    input: z.object({
      title: z.string().max(ART_STYLE_LIMITS.title), description: z.string().max(ART_STYLE_LIMITS.description).describe('One line'),
      badges: terms(ART_STYLE_LIMITS.badge, ART_STYLE_LIMITS.badges), keywords: terms(ART_STYLE_LIMITS.keyword, ART_STYLE_LIMITS.keywords),
      positive: z.string().max(ART_STYLE_LIMITS.prompt), negative: z.string().max(ART_STYLE_LIMITS.prompt),
      images: z.array(z.union([z.object({ id: z.string() }).strict(), z.object({ composite_hash: z.string() }).strict()])).max(ART_STYLE_LIMITS.images)
        .describe('The whole ordered list, first = cover: { id } keeps one of the style\'s images (get_art_style), { composite_hash } copies a library image in; left out = deleted. Needs images.view'),
    }).partial().strict().describe('Only given fields change; lists replace the stored ones'),
  }).strict(),
  z.object({ action: z.literal('delete_style'), style_id: id, revision: id.describe('From get_art_style') }).strict(),
])

/** Proposals check the same input, title and optimistic revision as the REST write; only a person's card save writes it. */
export function proposeArtStyle(context: ChatExecutionContext, input: unknown, canViewImages: boolean) {
  requireActiveChatReply(context)
  const value = artStyleProposalSchema.parse(input)
  let proposal: ChatArtStyleProposal
  if (value.action === 'delete_style') {
    const row = artStyleRow(value.style_id)
    if (row.revision !== value.revision) throw new ArtStyleError('스타일이 바뀌었어. 다시 읽고 제안해줘.', 409, row.revision, 'revision_conflict')
    proposal = { kind: 'art_style', action: 'delete_style', styleId: row.id, title: row.title, revision: row.revision }
  } else {
    const styleId = value.style_id ?? null
    if (styleId !== null && value.revision === undefined) throw new ArtStyleError('스타일을 바꾸려면 get_art_style의 revision이 필요해.')
    const checked = validateArtStyleChange(styleId, styleId === null ? value.input : { ...value.input, revision: value.revision }, canViewImages)
    proposal = { kind: 'art_style', action: 'save_style', styleId, revision: checked.current?.revision ?? null, title: checked.value.title ?? checked.current!.title, input: checked.value as ChatArtStyleProposalInput }
  }
  return ChatProposalStore.add(context, proposal)
}
