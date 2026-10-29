import { getUserSettingsDb } from '../../database/userSettingsDb'
import { EMBEDDING_MODEL_KEY, embedQuery, embeddingFailure, embeddingFeatureOn, embeddingRuntime } from '../aiWorker/textEmbeddingService'
import { requireKey, type PostActor } from '../posts/postActor'
import { loadPostsSettings } from '../posts/postsSettings'
import { vectorStore } from '../vectors/vectorStore'
import { SEMANTIC_SPACES, standouts } from './rankFusion'

type AccessiblePost = { id: number; content_hash: string }
export type PostSemanticMemo = { vector?: Float32Array | null }

let trackedDb: ReturnType<typeof getUserSettingsDb> | null = null
let accessRevision = 0
let rankingRevision = 0

/** Track only local writes to data used by post search; data_version covers other connections. */
export function postSnapshotVersion(accessOnly = false) {
  const db = getUserSettingsDb()
  if (trackedDb !== db) {
    accessRevision = 0
    rankingRevision = 0
    db.function('conai_post_snapshot_changed', (access: number) => {
      rankingRevision++
      if (access) accessRevision++
      return 0
    })
    const tables = ['posts', 'post_knowledge', 'post_categories', 'post_comments', 'post_tags', 'post_tag_links', 'post_aliases', 'post_assessment_events', 'post_assessment_heads']
    for (const table of tables) for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
      const access = table === 'posts' || table === 'post_knowledge' ? 1 : 0
      db.exec(`CREATE TEMP TRIGGER conai_snapshot_${table}_${operation.toLowerCase()} AFTER ${operation} ON main.${table}
        BEGIN SELECT conai_post_snapshot_changed(${access}); END`)
    }
    for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
      const condition = operation === 'INSERT' ? "NEW.source IN ('post','post_comment')"
        : operation === 'DELETE' ? "OLD.source IN ('post','post_comment')"
          : "OLD.source IN ('post','post_comment') OR NEW.source IN ('post','post_comment')"
      db.exec(`CREATE TEMP TRIGGER conai_snapshot_documents_${operation.toLowerCase()} AFTER ${operation} ON search_db.search_documents
        WHEN ${condition} BEGIN SELECT conai_post_snapshot_changed(0); END`)
    }
    trackedDb = db
  }
  return `${accessOnly ? accessRevision : rankingRevision}:${db.pragma('data_version', { simple: true })}${accessOnly ? '' : `:${db.pragma('search_db.data_version', { simple: true })}`}`
}

const accessibleWhere = `FROM posts p JOIN post_knowledge k ON k.post_id = p.id
  WHERE k.enabled = 1 AND k.deleted_at IS NULL
    AND (? = 1 OR p.status = 'published' OR (? IS NOT NULL AND p.owner_account_id = ?))`

/** Restrict the candidate set before vector ranking, including drafts and shared published posts. */
function accessiblePosts(actor: PostActor): AccessiblePost[] {
  requireKey(actor, 'posts.view')
  return getUserSettingsDb().prepare(`SELECT p.id, k.content_hash ${accessibleWhere}`)
    .all(Number(actor.isAdmin), actor.accountId, actor.accountId) as AccessiblePost[]
}

/** Derived candidates only: callers apply the same filters, relevance bands and assessment policy as keywords. */
export function semanticPostCandidatesSync(actor: PostActor, vector: Float32Array | null | undefined) {
  if (!vector || !loadPostsSettings().knowledge.enabled || !embeddingFeatureOn('postSearch')) return []
  const current = new Map(accessiblePosts(actor).map(row => [String(row.id), row.content_hash]))
  if (!current.size) return []
  const best = new Map<string, number>()
  for (const hit of vectorStore.search(SEMANTIC_SPACES.post, EMBEDDING_MODEL_KEY, vector, { sourceKeys: [...current.keys()] })) {
    if (hit.contentHash === current.get(hit.sourceKey)) best.set(hit.sourceKey, Math.max(best.get(hit.sourceKey) ?? -Infinity, hit.score))
  }
  return standouts(best, 0.6, 0.035)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([id, score]) => ({ postId: Number(id), score, contentHash: current.get(id)! }))
}

export async function semanticPostCandidates(actor: PostActor, query: string, signal?: AbortSignal, memo: PostSemanticMemo = {}, synchronous = false): Promise<Array<{ postId: number; score: number; contentHash: string }>> {
  if (!loadPostsSettings().knowledge.enabled || !embeddingFeatureOn('postSearch') || !query.trim() || embeddingFailure()) return []
  requireKey(actor, 'posts.view')
  if (!getUserSettingsDb().prepare(`SELECT 1 ${accessibleWhere} LIMIT 1`).get(Number(actor.isAdmin), actor.accountId, actor.accountId)) return []
  try {
    const vector = memo.vector === undefined ? await embedQuery(query.slice(0, 500), { waitMs: 1200, signal }) : memo.vector
    memo.vector = vector
    signal?.throwIfAborted()
    if (!vector || !loadPostsSettings().knowledge.enabled || !embeddingFeatureOn('postSearch')) return []
    const db = getUserSettingsDb()
    for (let attempt = 0; !synchronous && attempt < 2; attempt++) {
      signal?.throwIfAborted()
      const before = postSnapshotVersion(true)
      // Recheck visibility and content versions after embedding and whenever a yielding scan races a write.
      const current = new Map(accessiblePosts(actor).map(row => [String(row.id), row.content_hash]))
      if (!current.size) return []
      const hits = await vectorStore.searchBestCurrent(SEMANTIC_SPACES.post, EMBEDDING_MODEL_KEY, vector, current, signal)
      signal?.throwIfAborted()
      if (hits === null || postSnapshotVersion(true) !== before) continue
      if (!loadPostsSettings().knowledge.enabled || !embeddingFeatureOn('postSearch')) return []
      const best = new Map(hits.map(hit => [hit.sourceKey, hit.score]))
      return standouts(best, 0.6, 0.035)
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([id, score]) => ({ postId: Number(id), score, contentHash: current.get(id)! }))
    }
    signal?.throwIfAborted()
    return db.transaction(() => {
      db.prepare('SELECT EXISTS(SELECT 1 FROM main.posts), EXISTS(SELECT 1 FROM vector_db.vectors)').get()
      return semanticPostCandidatesSync(actor, vector)
    })()
  } catch (error) {
    signal?.throwIfAborted()
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
