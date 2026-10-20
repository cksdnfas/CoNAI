import { db } from '../../database/init'
import type { McpRequestContext } from '../../mcp/context'
import { HistoryQueryRepository } from '../../repositories/history/HistoryQueryRepository'
import { placeholdersFor, sortedUniqueChunks } from '../../utils/sqlInChunks'
import { libraryMediaAllowed, scoreWithinLimit, type ContentRatingLimit } from '../contentRating'
import { resolveProfileModel } from './chatModelRoles'
import { ChatProfileStore, type ChatProfile } from './chatProfiles'
import { ModelSlotStore, type ModelRole } from './modelSlots'

export type ContentRatingProfile = Pick<ChatProfile, 'engine' | 'model' | 'modelSlotId' | 'summarySlotId' | 'translationSlotId' | 'suggestSlotId' | 'contentRatingMode' | 'contentRatingTierId'>

/** A model row's ceiling (see contentRating.ts); no row: none. */
export function slotContentLimit(slotId: number | null | undefined): ContentRatingLimit {
  return ModelSlotStore.contentRatingTierId(slotId)
}

/**
 * The ceiling of what `profile`'s model for `role` is shown: the profile's own when it sets one (Codex / Claude Code
 * always do, having no model row), else the ceiling of the row that role resolves to. A reaction run on another row
 * passes the profile with that row as its `modelSlotId`.
 */
export function profileContentLimit(profile: ContentRatingProfile, role: ModelRole = 'chat'): ContentRatingLimit {
  if (profile.contentRatingMode === 'custom' || profile.engine === 'codex' || profile.engine === 'claude') return profile.contentRatingTierId
  const resolved = resolveProfileModel(profile, role)
  return slotContentLimit(resolved?.routeId ?? resolved?.slotId)
}

/**
 * The ceiling for an MCP call: the one the caller fixed (an API LLM reply knows its model row), else the chat
 * profile's (a Codex session); a request outside any chat (an HTTP key) has none.
 */
export function contextContentLimit(context: McpRequestContext): ContentRatingLimit {
  if (context.contentRatingLimit !== undefined) return context.contentRatingLimit
  const profile = context.chatContext ? ChatProfileStore.find(context.chatContext.profileId) : null
  return profile ? profileContentLimit(profile) : null
}

/**
 * Whether the model behind `context` may be handed a download link to library media: a model that fetches the link
 * could look at the file, so the ceiling applies as to viewing it.
 */
export function mediaWithinContextRating(context: McpRequestContext, compositeHash: string) {
  return libraryMediaAllowed(compositeHash, contextContentLimit(context))
}

/** The same for a generation result (its library file); a result with no file yet has nothing to fetch. */
export async function historyWithinContextRating(context: McpRequestContext, historyId: number) {
  const limit = contextContentLimit(context)
  if (limit === null) return true
  const record = HistoryQueryRepository.findAllWithMetadata({ ids: [historyId], limit: 1 })[0] as { actual_composite_hash?: string | null; composite_hash?: string | null } | undefined
  const hash = record?.actual_composite_hash ?? record?.composite_hash
  return hash ? libraryMediaAllowed(hash, limit) : false
}

/** What a tool shows in place of the descriptive text (prompts, tags, metadata) of media above the ceiling. */
export const RATING_RESTRICTED_TEXT = 'hidden: above the content rating this model may be shown'

/**
 * The library hashes among `hashes` whose descriptive text the model behind `context` must not read: above its
 * ceiling, or not rated yet while it has one (as for showing the media). Stored scores only, one query per call; the
 * tagger is never run for text. No ceiling: none.
 */
export function ratingRestrictedHashes(context: McpRequestContext, hashes: Iterable<string | null | undefined>): Set<string> {
  return ratingRestrictedHashesUnder(contextContentLimit(context), hashes)
}

/** The same for a known ceiling (a chat request building its page reference). */
export function ratingRestrictedHashesUnder(limit: ContentRatingLimit, hashes: Iterable<string | null | undefined>): Set<string> {
  const restricted = new Set<string>()
  if (limit === null) return restricted
  const wanted = [...hashes].filter((hash): hash is string => typeof hash === 'string' && hash.length > 0)
  const scores = new Map<string, number | null>()
  for (const chunk of sortedUniqueChunks(wanted)) {
    const rows = db.prepare(`SELECT composite_hash, rating_score FROM media_metadata WHERE composite_hash IN (${placeholdersFor(chunk)})`).all(...chunk) as Array<{ composite_hash: string; rating_score: number | null }>
    for (const row of rows) scores.set(row.composite_hash, row.rating_score)
  }
  for (const hash of wanted) if (scoreWithinLimit(scores.get(hash), limit) !== true) restricted.add(hash)
  return restricted
}

/** `item` with its present `fields` replaced by the marker and `rating_restricted: true`; everything else kept. */
export function hideRatingRestrictedText<T extends object>(item: T, fields: readonly string[]): T & { rating_restricted: true } {
  const hidden: Record<string, unknown> = { ...item, rating_restricted: true }
  for (const field of fields) if (hidden[field] !== null && hidden[field] !== undefined) hidden[field] = RATING_RESTRICTED_TEXT
  return hidden as T & { rating_restricted: true }
}

/** Result rows (by their `composite_hash`) with the `fields` of those `ratingRestrictedHashes` holds back hidden. */
export function hideRatingRestrictedRows<T extends { composite_hash?: string | null }>(context: McpRequestContext, rows: T[], fields: readonly string[]): Array<T | (T & { rating_restricted: true })> {
  const restricted = ratingRestrictedHashes(context, rows.map((row) => row.composite_hash))
  return restricted.size === 0 ? rows : rows.map((row) => row.composite_hash && restricted.has(row.composite_hash) ? hideRatingRestrictedText(row, fields) : row)
}
