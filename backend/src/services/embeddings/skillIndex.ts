import { getUserSettingsDb, semanticTextHash } from '../../database/userSettingsDb'
import { EMBEDDING_MODEL_KEY } from '../aiWorker/textEmbeddingService'
import { vectorStore } from '../vectors/vectorStore'
import { SEMANTIC_SPACES } from './rankFusion'

const SECTION_COLUMNS = `s.skill_id, k.name AS skill_name, s.path, s.title, s.summary, s.content, s.position,
  CAST(s.skill_id AS TEXT) || ':' || s.path_key AS source_key, s.path_key, k.revision,
  k.name || char(10) || s.path || char(10) || s.title AS document_title`
const OVERVIEW_COLUMNS = `k.id, k.name, '', k.name, k.description, k.instructions, -1,
  CAST(k.id AS TEXT) || ':', '', k.revision, k.name`

/** Overview key `<skill id>:`; section key `<skill id>:<lowercase path>`. Positions and load counts are not content. */
export const SKILL_DOCUMENTS_SQL = `SELECT ${SECTION_COLUMNS}
  FROM chat_skill_sections s JOIN chat_skills k ON k.id = s.skill_id WHERE k.enabled = 1
  UNION ALL
  SELECT ${OVERVIEW_COLUMNS} FROM chat_skills k WHERE k.enabled = 1`

export type SkillDocumentRow = {
  source_key: string; skill_id: number; skill_name: string; path: string; title: string
  summary: string; content: string; position: number; path_key: string; revision: number; document_title: string
}

type SkillIdentity = Pick<SkillDocumentRow, 'source_key' | 'skill_id' | 'path_key' | 'revision'>
let fingerprintDb: ReturnType<typeof getUserSettingsDb> | null = null
const fingerprints = new Map<number, { revision: number; hashes: Map<string, string> }>()

function fingerprintCache() {
  const db = getUserSettingsDb()
  if (fingerprintDb !== db) { fingerprints.clear(); fingerprintDb = db }
  return fingerprints
}

function cachedHash(row: SkillIdentity) {
  const skill = fingerprintCache().get(row.skill_id)
  return skill?.revision === row.revision ? skill.hashes.get(row.path_key) : undefined
}

/** Store writes advance the skill revision, including section edits; keep only that revision's fingerprints, not text. */
export function skillDocumentHash(row: SkillDocumentRow) {
  const known = cachedHash(row)
  if (known !== undefined) return known
  let skill = fingerprints.get(row.skill_id)
  if (skill?.revision !== row.revision) {
    skill = { revision: row.revision, hashes: new Map() }
    fingerprints.set(row.skill_id, skill)
  }
  const hash = semanticTextHash(`${row.document_title}\u0000${row.summary}\n${row.content}`)
  skill.hashes.set(row.path_key, hash)
  return hash
}

/** Decode requested identities before joining, so both single-document reads and hydration use the existing indexes. */
export function skillDocumentsByKeys(keys: string[]): SkillDocumentRow[] {
  if (!keys.length) return []
  return getUserSettingsDb().prepare(`WITH requested AS (
      SELECT CAST(substr(value, 1, instr(value, ':') - 1) AS INTEGER) AS skill_id,
        substr(value, instr(value, ':') + 1) AS path_key FROM json_each(?)
    )
    SELECT ${SECTION_COLUMNS}
      FROM requested r JOIN chat_skills k ON k.id = r.skill_id
      JOIN chat_skill_sections s ON s.skill_id = k.id AND s.path_key = r.path_key WHERE k.enabled = 1
    UNION ALL
    SELECT ${OVERVIEW_COLUMNS}
      FROM requested r JOIN chat_skills k ON k.id = r.skill_id WHERE k.enabled = 1 AND r.path_key = ''`)
    .all(JSON.stringify(keys)) as SkillDocumentRow[]
}

/** Metadata only: an unchanged library never has its document bodies fetched or hashed by a background scan. */
function skillIdentities(skillIds?: number[]) {
  return getUserSettingsDb().prepare(`SELECT d.*, v.content_hash FROM (
      SELECT k.id AS skill_id, s.path_key, k.revision, s.position, CAST(k.id AS TEXT) || ':' || s.path_key AS source_key
        FROM chat_skills k JOIN chat_skill_sections s ON s.skill_id = k.id WHERE k.enabled = 1
      UNION ALL
      SELECT id, '', revision, -1, CAST(id AS TEXT) || ':' FROM chat_skills WHERE enabled = 1
    ) d LEFT JOIN vector_db.vectors v ON v.space = @space AND v.model_key = @model AND v.chunk = 0 AND v.source_key = d.source_key
    ${skillIds ? 'WHERE d.skill_id IN (SELECT value FROM json_each(@ids))' : ''}
    ORDER BY d.skill_id, d.position`)
    .all({ space: SEMANTIC_SPACES.skill, model: EMBEDDING_MODEL_KEY, ...(skillIds ? { ids: JSON.stringify(skillIds) } : {}) }) as Array<SkillIdentity & { content_hash: string | null }>
}

export function currentSkillHashes(skillIds: number[]) {
  if (!skillIds.length) return new Map<string, string>()
  const identities = skillIdentities(skillIds)
  for (const row of skillDocumentsByKeys(identities.filter(row => cachedHash(row) === undefined).map(row => row.source_key))) skillDocumentHash(row)
  return new Map(identities.flatMap(row => {
    const hash = cachedHash(row)
    return hash === undefined ? [] : [[row.source_key, hash] as const]
  }))
}

export function skillSnapshotVersion(skillIds: number[]) {
  return JSON.stringify(getUserSettingsDb().prepare('SELECT id, revision, enabled FROM chat_skills WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id')
    .all(JSON.stringify(skillIds)))
}

export function skillDocumentCurrent(sourceKey: string, ownerKey: string, hash: string) {
  const skillId = Number(ownerKey.slice('skill:'.length))
  const pathKey = sourceKey.slice(sourceKey.indexOf(':') + 1)
  const current = getUserSettingsDb().prepare(`SELECT k.revision FROM chat_skills k WHERE k.id = ? AND k.enabled = 1
    AND (? = '' OR EXISTS (SELECT 1 FROM chat_skill_sections s WHERE s.skill_id = k.id AND s.path_key = ?))`)
    .get(skillId, pathKey, pathKey) as { revision: number } | undefined
  if (!current || sourceKey !== `${skillId}:${pathKey}`) return false
  const known = cachedHash({ skill_id: skillId, path_key: pathKey, source_key: sourceKey, revision: current.revision })
  if (known !== undefined) return known === hash
  const row = skillDocumentsByKeys([sourceKey])[0]
  return !!row && skillDocumentHash(row) === hash
}

export function pendingSkills(limit: number, skillIds?: number[]) {
  if (skillIds?.length === 0) return []
  const identities = skillIdentities(skillIds)
  const items = []
  for (let start = 0; start < identities.length && items.length < limit; start += limit) {
    const batch = identities.slice(start, start + limit)
    const needed = batch.filter(row => cachedHash(row) !== row.content_hash)
    const documents = new Map(skillDocumentsByKeys(needed.map(row => row.source_key)).map(row => [row.source_key, row]))
    for (const identity of needed) {
      const row = documents.get(identity.source_key)
      if (!row) continue
      const hash = skillDocumentHash(row)
      if (hash === identity.content_hash) continue
      const text = `${row.summary}\n${row.content}`
      items.push({
        space: SEMANTIC_SPACES.skill, sourceKey: row.source_key, ownerKey: `skill:${row.skill_id}`,
        hash, title: row.document_title, text, maxChunks: Math.max(1, text.length),
      })
      if (items.length === limit) break
    }
  }
  return items
}

/** Plugin-off is temporary: retain its fingerprints/vectors, and remove only identities that no longer exist. */
export function pruneSkillVectors() {
  const db = getUserSettingsDb()
  const stale = db.prepare(`WITH sources AS MATERIALIZED (
      SELECT DISTINCT source_key, owner_key FROM vector_db.vectors WHERE space = ?
    ) SELECT source_key FROM sources v WHERE NOT EXISTS (
      SELECT 1 FROM chat_skills k WHERE k.id = CAST(substr(v.owner_key, 7) AS INTEGER)
    ) OR (substr(v.source_key, instr(v.source_key, ':') + 1) != '' AND NOT EXISTS (
      SELECT 1 FROM chat_skill_sections s WHERE s.skill_id = CAST(substr(v.owner_key, 7) AS INTEGER)
        AND s.path_key = substr(v.source_key, instr(v.source_key, ':') + 1)
    ))`).all(SEMANTIC_SPACES.skill) as Array<{ source_key: string }>
  let removed = 0
  for (const row of stale) removed += vectorStore.remove(SEMANTIC_SPACES.skill, row.source_key)
  const live = new Set((db.prepare('SELECT id FROM chat_skills').all() as Array<{ id: number }>).map(row => row.id))
  for (const id of fingerprintCache().keys()) if (!live.has(id)) fingerprints.delete(id)
  return removed
}
