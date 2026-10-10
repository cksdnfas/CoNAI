import type { McpRequestContext } from '../../mcp/context'
import { HistoryQueryRepository } from '../../repositories/history/HistoryQueryRepository'
import { libraryMediaAllowed, type ContentRatingLimit } from '../contentRating'
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
  return slotContentLimit(resolveProfileModel(profile, role)?.slotId)
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
