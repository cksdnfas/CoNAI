import { getUserSettingsDb } from '../../database/userSettingsDb'
import { EMBEDDING_MODEL_KEY, embedQuery, embeddingSettings } from '../aiWorker/textEmbeddingService'
import { indexSkillsNow } from '../embeddings/semanticIndex'
import { fuseRanks, SEMANTIC_SPACES, standouts } from '../embeddings/rankFusion'
import { currentSkillHashes, skillDocumentHash, skillDocumentsByKeys, skillSnapshotVersion, SKILL_DOCUMENTS_SQL, type SkillDocumentRow } from '../embeddings/skillIndex'
import { vectorStore } from '../vectors/vectorStore'

export type SkillSearchHit = {
  skillId: number
  skillName: string
  /** null: the skill's overview. */
  path: string | null
  title: string
  summary: string
  excerpt: string
}

const EXCERPT_RADIUS = 90
// Match history-search latency and backfill policy: indexing never holds the keyword fallback open.
const INDEX_BEFORE_SEARCH = 32
const SEARCH_QUERY_WAIT_MS = 20_000

function excerptAround(content: string, words: string[], semanticStart?: number) {
  const lower = content.toLowerCase()
  const at = words.map(word => lower.indexOf(word)).filter(index => index >= 0).sort((a, b) => a - b)[0]
  if (at === undefined && semanticStart === undefined) return ''
  const start = Math.max(0, at === undefined ? semanticStart! : at - EXCERPT_RADIUS)
  const end = Math.min(content.length, start + 2 * EXCERPT_RADIUS)
  return `${start > 0 ? '…' : ''}${content.slice(start, end).replace(/\s+/g, ' ').trim()}${end < content.length ? '…' : ''}`
}

function hitOf(row: SkillDocumentRow, words: string[], semanticStart?: number): SkillSearchHit {
  return {
    skillId: row.skill_id, skillName: row.skill_name, path: row.position < 0 ? null : row.path,
    title: row.title, summary: row.summary, excerpt: excerptAround(row.content, words, semanticStart),
  }
}

/** Linked, enabled units only; no limit returns every match. Semantic failures preserve the lexical ranking. */
export async function searchSkills(skillIds: number[], query: string, limit?: number): Promise<SkillSearchHit[]> {
  const words = [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))].slice(0, 8)
  if (skillIds.length === 0 || words.length === 0) return []
  const db = getUserSettingsDb()
  const ids = JSON.stringify(skillIds)
  let semantic: Array<SkillDocumentRow & { spanStart: number }> = []
  if (embeddingSettings().enabled) {
    try {
      const pending = embedQuery(query, { waitMs: SEARCH_QUERY_WAIT_MS })
      void indexSkillsNow(skillIds, INDEX_BEFORE_SEARCH).catch(error => {
        console.warn('[SkillSearch] indexing unavailable:', error instanceof Error ? error.message : error)
      })
      const vector = await pending
      if (vector) {
        let hits: Awaited<ReturnType<typeof vectorStore.searchBestCurrent>> = null
        for (let attempt = 0; attempt < 2; attempt++) {
          const before = skillSnapshotVersion(skillIds)
          const hashes = currentSkillHashes(skillIds)
          hits = await vectorStore.searchBestCurrent(SEMANTIC_SPACES.skill, EMBEDDING_MODEL_KEY, vector, hashes)
          if (hits !== null && before === skillSnapshotVersion(skillIds)) break
          hits = null
        }
        if (hits === null) {
          hits = db.transaction(() => {
            // Pin source and vector data with a read-only snapshot after conflicting cooperative scans.
            db.prepare('SELECT EXISTS(SELECT 1 FROM main.chat_skills), EXISTS(SELECT 1 FROM vector_db.vectors)').get()
            const hashes = currentSkillHashes(skillIds)
            const best = new Map<string, ReturnType<typeof vectorStore.search>[number]>()
            for (const hit of vectorStore.search(SEMANTIC_SPACES.skill, EMBEDDING_MODEL_KEY, vector, { sourceKeys: [...hashes.keys()] })) {
              if (hit.contentHash === hashes.get(hit.sourceKey) && !best.has(hit.sourceKey)) best.set(hit.sourceKey, hit)
            }
            return [...best.values()]
          })()
        }
        const best = new Map(hits.map(hit => [hit.sourceKey, hit]))
        const close = standouts(new Map([...best].map(([key, hit]) => [key, hit.score])), 0.6, 0.04).slice(0, limit)
        if (close.length) {
          const rows = skillDocumentsByKeys(close.map(([key]) => key))
          const current = new Map(rows.map(row => [row.source_key, row]))
          semantic = close.flatMap(([key]) => {
            const row = current.get(key)
            const hit = best.get(key)!
            // Spans address summary + newline + content, while excerpts contain only the content.
            return row && skillDocumentHash(row) === hit.contentHash ? [{ ...row, spanStart: Math.max(0, (hit.spanStart ?? 0) - row.summary.length - 1) }] : []
          })
        }
      }
    } catch (error) {
      console.warn('[SkillSearch] semantic search unavailable:', error instanceof Error ? error.message : error)
    }
  }
  // Read after awaited work too: a removed section or switched-off plugin must not survive as a lexical hit.
  const score = words.map(() => '(instr(lower(title), ?) > 0) * 4 + (instr(lower(path), ?) > 0) * 3 + (instr(lower(summary), ?) > 0) * 2 + (instr(lower(content), ?) > 0)').join(' + ')
  const lexical = db.prepare(`WITH scored AS MATERIALIZED (
    SELECT *, (${score}) AS score FROM (${SKILL_DOCUMENTS_SQL})
      WHERE skill_id IN (SELECT value FROM json_each(?))
    ) SELECT * FROM scored WHERE score > 0 ORDER BY score DESC, skill_id, position LIMIT ?`)
    .all(...words.flatMap(word => [word, word, word, word]), ids, limit ?? -1) as SkillDocumentRow[]
  const scores = fuseRanks([lexical.map(row => row.source_key), semantic.map(row => row.source_key)])
  const known = new Map(semantic.map(row => [row.source_key, hitOf(row, words, row.spanStart)]))
  for (const row of lexical) if (!known.has(row.source_key)) known.set(row.source_key, hitOf(row, words))
  return [...scores].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key]) => known.get(key)!)
}
