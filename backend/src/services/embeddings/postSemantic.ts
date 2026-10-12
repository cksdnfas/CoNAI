import { getUserSettingsDb } from '../../database/userSettingsDb'
import { EMBEDDING_MODEL_KEY, embedQuery, embeddingFailure, embeddingFeatureOn, embeddingRuntime } from '../aiWorker/textEmbeddingService'
import { requireKey, type PostActor } from '../posts/postActor'
import { loadPostsSettings } from '../posts/postsSettings'
import { vectorStore } from '../vectors/vectorStore'
import { SEMANTIC_SPACES, standouts } from './rankFusion'

type AccessiblePost = { id: number; content_hash: string }

/** Restrict the candidate set before vector ranking, including drafts and shared published posts. */
function accessiblePosts(actor: PostActor): AccessiblePost[] {
  requireKey(actor, 'posts.view')
  return getUserSettingsDb().prepare(`SELECT p.id, k.content_hash FROM posts p
    JOIN post_knowledge k ON k.post_id = p.id
    WHERE k.enabled = 1 AND k.deleted_at IS NULL
      AND (? = 1 OR p.status = 'published' OR (? IS NOT NULL AND p.owner_account_id = ?))`)
    .all(Number(actor.isAdmin), actor.accountId, actor.accountId) as AccessiblePost[]
}

/** Derived candidates only: callers apply the same filters, relevance bands and assessment policy as keywords. */
export async function semanticPostCandidates(actor: PostActor, query: string): Promise<Array<{ postId: number; score: number; contentHash: string }>> {
  if (!loadPostsSettings().knowledge.enabled || !embeddingFeatureOn('postSearch') || !query.trim() || embeddingFailure()) return []
  const initial = accessiblePosts(actor)
  if (!initial.length) return []
  try {
    const vector = await embedQuery(query.slice(0, 500), { waitMs: 1200 })
    if (!vector || !loadPostsSettings().knowledge.enabled || !embeddingFeatureOn('postSearch')) return []
    // Permissions and versions may change while the CPU worker answers.
    const current = new Map(accessiblePosts(actor).map(row => [String(row.id), row.content_hash]))
    if (!current.size) return []
    const best = new Map<string, number>()
    for (const hit of vectorStore.search(SEMANTIC_SPACES.post, EMBEDDING_MODEL_KEY, vector, { sourceKeys: [...current.keys()] })) {
      if (hit.contentHash !== current.get(hit.sourceKey)) continue
      best.set(hit.sourceKey, Math.max(best.get(hit.sourceKey) ?? -Infinity, hit.score))
    }
    return standouts(best, 0.6, 0.035).map(([id, score]) => ({ postId: Number(id), score, contentHash: current.get(id)! }))
  } catch (error) {
    console.warn('[PostSemantic] keyword fallback:', error instanceof Error ? error.message : error)
    return []
  }
}

/** Counts include only documents the caller can see; stale vectors never count as indexed. */
export function postSemanticStatus(actor: PostActor) {
  const rows = accessiblePosts(actor)
  const hashes = vectorStore.contentHashes(SEMANTIC_SPACES.post, EMBEDDING_MODEL_KEY)
  const indexed = rows.filter(row => hashes.get(String(row.id)) === row.content_hash).length
  const enabled = loadPostsSettings().knowledge.enabled && embeddingFeatureOn('postSearch')
  const message = enabled ? embeddingFailure() : null
  const state: 'disabled' | 'unavailable' | 'indexing' | 'ready' | 'partial' = !enabled ? 'disabled'
    : message || !embeddingRuntime.isModelCached() ? 'unavailable'
      : indexed === rows.length ? 'ready' : indexed === 0 ? 'indexing' : 'partial'
  return { enabled, state, indexed, total: rows.length, message }
}
