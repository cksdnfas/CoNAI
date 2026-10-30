import { randomUUID } from 'node:crypto'
import { LANGUAGES, translationOf, healLanguageLabels } from './bilingual.mjs'
import { clipProse } from '../../shared/speech.mjs'

// Same basic fields as native lorebooks. World book = resident 0; personal books keep the existing account boundary.
export const BOOK_LIMIT = 500
const PAGE = 30
const fold = text => text.normalize('NFKC').toLocaleLowerCase().trim()
/** Title, keys and translated keys folded like the haystack, for keyword matching inside SQLite. */
const matchKeys = entry => JSON.stringify([...new Set([entry.title, ...entry.keys, ...(entry.translation?.keys ?? [])].map(fold).filter(Boolean))])
const read = row => row ? { ...row, keys: JSON.parse(row.keys), translation: row.translation ? JSON.parse(row.translation) : null, sources: JSON.parse(row.sources), constant: !!row.constant, enabled: !!row.enabled } : null

export function parseEntry(value) {
  if (!value || typeof value !== 'object') throw new Error('로어 항목을 확인해줘.')
  const { title, content } = value
  if (typeof title !== 'string' || !title.trim()) throw new Error('제목은 비어 있지 않은 문자열로 써줘.')
  if (typeof content !== 'string' || !content.trim()) throw new Error('내용은 비어 있지 않은 문자열로 써줘.')
  if (!Array.isArray(value.keys) || value.keys.length > 20 || value.keys.some(k => typeof k !== 'string' || !k.trim())) throw new Error('검색 키워드는 비어 있지 않은 문자열로 최대 20개까지 써줘.')
  if (value.constant !== undefined && typeof value.constant !== 'boolean' || value.enabled !== undefined && typeof value.enabled !== 'boolean') throw new Error('항상 적용·활성 설정을 확인해줘.')
  const state = value.state ?? 'active'
  if (!['active', 'completed', 'superseded'].includes(state)) throw new Error('기억 상태를 확인해줘.')
  const keys = [...new Set(value.keys.map(k => k.trim()))]
  const constant = value.constant ?? false
  if (!constant && !keys.length) throw new Error('키워드를 넣거나 항상 적용을 켜줘.')
  const entry = { title: title.trim(), content: content.trim(), keys, constant, enabled: value.enabled ?? true, state }
  return { ...entry, language: LANGUAGES.includes(value.language) ? value.language : null, translation: translationOf(entry, value.translation) }
}

export function createLore(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS aquarium_lore (
    owner TEXT NOT NULL, resident INTEGER NOT NULL, id TEXT NOT NULL, title TEXT NOT NULL, title_key TEXT NOT NULL,
    keys TEXT NOT NULL, content TEXT NOT NULL, constant INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1,
    state TEXT NOT NULL DEFAULT 'active', revision INTEGER NOT NULL DEFAULT 1, origin TEXT NOT NULL,
    sources TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY(owner,resident,id), UNIQUE(owner,resident,title_key));
    CREATE INDEX IF NOT EXISTS aquarium_lore_book ON aquarium_lore(owner,resident,enabled,updated_at);
    CREATE TABLE IF NOT EXISTS aquarium_lore_migrations (owner TEXT NOT NULL, resident INTEGER NOT NULL, PRIMARY KEY(owner,resident));`)
  const columns = db.prepare('PRAGMA table_info(aquarium_lore)').all().map(c => c.name)
  for (const field of ['language', 'translation', 'match_keys']) if (!columns.includes(field)) db.exec(`ALTER TABLE aquarium_lore ADD COLUMN ${field} TEXT`)
  for (const row of db.prepare('SELECT rowid AS rid,title,keys,translation FROM aquarium_lore WHERE match_keys IS NULL').all()) {
    db.prepare('UPDATE aquarium_lore SET match_keys=? WHERE rowid=?').run(matchKeys({ title: row.title, keys: JSON.parse(row.keys), translation: row.translation ? JSON.parse(row.translation) : null }), row.rid)
  }
  const loreTranslation = row => row.translation ? JSON.parse(row.translation) : null
  healLanguageLabels(db, 'aquarium_lore', { source: row => `${row.title}\n${row.content}`, display: loreTranslation, displayLanguage: row => loreTranslation(row)?.language, clear: 'translation=NULL' })
  const get = (owner, resident, id) => read(db.prepare('SELECT * FROM aquarium_lore WHERE owner=? AND resident=? AND id=?').get(owner, resident, id))
  const count = (owner, resident) => db.prepare('SELECT COUNT(*) AS n FROM aquarium_lore WHERE owner=? AND resident=?').get(owner, resident).n

  const put = db.transaction((owner, resident, input, now, origin = 'manual', sources = []) => {
    const entry = parseEntry(input), current = input.id ? get(owner, resident, input.id) : null
    if (input.id && !current) throw new Error('로어 항목이 없어. 다시 불러와줘.')
    if (current && input.revision !== current.revision) throw new Error('로어 항목이 바뀌었어. 다시 불러와서 수정해줘.')
    if (!current && count(owner, resident) >= BOOK_LIMIT) throw new Error(`로어북은 ${BOOK_LIMIT}개까지야. 불필요한 항목을 정리해줘.`)
    const id = current?.id ?? randomUUID(), titleKey = fold(entry.title)
    if (db.prepare('SELECT 1 FROM aquarium_lore WHERE owner=? AND resident=? AND title_key=? AND id<>?').get(owner, resident, titleKey, id)) throw new Error('같은 제목의 항목이 있어. 기존 항목을 수정해줘.')
    const evidence = [...(current?.sources ?? []), ...sources].slice(-8)
    db.prepare(`INSERT INTO aquarium_lore(owner,resident,id,title,title_key,keys,content,constant,enabled,state,revision,origin,sources,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner,resident,id) DO UPDATE SET title=excluded.title,title_key=excluded.title_key,
      keys=excluded.keys,content=excluded.content,constant=excluded.constant,enabled=excluded.enabled,state=excluded.state,
      revision=excluded.revision,origin=excluded.origin,sources=excluded.sources,updated_at=excluded.updated_at`)
      .run(owner, resident, id, entry.title, titleKey, JSON.stringify(entry.keys), entry.content, Number(entry.constant), Number(entry.enabled), entry.state,
        (current?.revision ?? 0) + 1, origin, JSON.stringify(evidence), current?.created_at ?? now, now)
    db.prepare('UPDATE aquarium_lore SET language=?,translation=?,match_keys=? WHERE owner=? AND resident=? AND id=?').run(entry.language, entry.translation ? JSON.stringify(entry.translation) : null, matchKeys(entry), owner, resident, id)
    return get(owner, resident, id)
  })

  function list(owner, resident, { query = '', offset = 0 } = {}) {
    if (typeof query !== 'string' || query.length > 200 || !Number.isSafeInteger(offset) || offset < 0 || offset > BOOK_LIMIT) throw new Error('검색 범위를 확인해줘.')
    // A book is at most BOOK_LIMIT rows, so the search folds them here like the keyword matcher does.
    const term = fold(query), text = e => fold([e.title, e.content, ...e.keys, e.translation?.title ?? '', e.translation?.content ?? '', ...(e.translation?.keys ?? [])].join('\n'))
    const found = db.prepare('SELECT * FROM aquarium_lore WHERE owner=? AND resident=? ORDER BY constant DESC,updated_at DESC,id').all(owner, resident).map(read).filter(e => !term || text(e).includes(term))
    const total = found.length, entries = found.slice(offset, offset + PAGE)
    return { entries, total, offset, next: offset + entries.length < total ? offset + entries.length : null, limit: BOOK_LIMIT }
  }

  // A book is capped at 500 rows; the caller fits relevant complete records to its real context.
  function select(owner, resident, query, budget = Infinity, cost = text => text.length) {
    const haystack = fold(String(query))
    const rows = db.prepare(`SELECT * FROM aquarium_lore WHERE owner=? AND resident=? AND enabled=1 AND state<>'superseded'
      AND (constant=1 OR EXISTS(SELECT 1 FROM json_each(COALESCE(match_keys,'[]')) WHERE instr(?,value)>0))
      ORDER BY constant DESC, CASE state WHEN 'active' THEN 0 ELSE 1 END,updated_at DESC,id LIMIT 500`).all(owner, resident, haystack)
    const chosen = []
    for (const row of rows) {
      const text = `[${row.title}${row.state === 'completed' ? ' · 완료' : ''}] ${row.content}`
      if (cost(text) > budget) continue
      budget -= cost(text) + 1; chosen.push({ ...read(row), text })
    }
    return chosen
  }

  /**
   * The lore a situation calls up from these books: always-on entries, then at most `limit` keyword entries, best
   * matches first (Settings › 채팅 › 자원 › 기억 › 선택 로어 상위 개수). A matched key counts by how specific it is in its
   * book: a key most entries share (a place everyone visits) says little, a key one entry has says much. Ties keep
   * active and recently updated entries first.
   */
  function relevant(owner, residents, query, limit = Infinity) {
    if (!residents.length) return []
    const haystack = fold(String(query))
    const rows = db.prepare(`SELECT * FROM aquarium_lore WHERE owner=? AND resident IN (${residents.map(() => '?').join(',')}) AND enabled=1 AND state<>'superseded'
      ORDER BY constant DESC, CASE state WHEN 'active' THEN 0 ELSE 1 END,updated_at DESC,id`).all(owner, ...residents)
    const keysOf = row => new Set(JSON.parse(row.match_keys || '[]'))
    const shared = new Map()
    for (const row of rows) for (const key of keysOf(row)) shared.set(`${row.resident}\n${key}`, (shared.get(`${row.resident}\n${key}`) ?? 0) + 1)
    const always = [], matched = []
    for (const row of rows) {
      if (row.constant) { always.push(row); continue }
      let score = 0
      for (const key of keysOf(row)) if (haystack.includes(key)) score += 1 / shared.get(`${row.resident}\n${key}`)
      if (score > 0) matched.push({ row, score })
    }
    matched.sort((a, b) => b.score - a.score)
    return [...always, ...matched.slice(0, limit).map(m => m.row)]
      .map(row => ({ ...read(row), text: `[${row.title}${row.state === 'completed' ? ' · 완료' : ''}] ${row.content}` }))
  }

  // Existing summaries are evidence of the old system, never silently discarded or repeatedly re-imported.
  const migrate = db.transaction((owner, resident, summary, now) => {
    if (db.prepare('SELECT 1 FROM aquarium_lore_migrations WHERE owner=? AND resident=?').get(owner, resident)) return
    if (summary.text) put(owner, resident, { title: '이전 기억 요약', content: summary.text, keys: ['지난 기억'], constant: true }, now, 'legacy', [{ type: 'legacy-summary', at: summary.at, through: summary.through }])
    db.prepare('INSERT INTO aquarium_lore_migrations(owner,resident) VALUES(?,?)').run(owner, resident)
  })

  // Each batch is atomic with its memory cursor. A stale automatic answer must not overwrite a human edit.
  function applyExtracted(owner, resident, entries, batch, now) {
    if (!Array.isArray(entries)) throw new Error('기억 추출 결과는 항목 목록이어야 해.')
    const evidence = new Map(batch.events.map(e => [e.id, e])), known = new Map(batch.known.map(e => [e.id, e]))
    for (const input of entries) {
      if (!input || typeof input !== 'object') continue
      const sourceIds = [...new Set(Array.isArray(input.sourceIds) ? input.sourceIds : [])].filter(id => evidence.has(id)).slice(0, 8)
      if (!sourceIds.length) continue
      // An id outside the candidates is the model guessing; the title decides whether this is new or an update.
      let expected = input.id ? known.get(input.id) ?? null : null
      const duplicate = read(db.prepare('SELECT * FROM aquarium_lore WHERE owner=? AND resident=? AND title_key=?').get(owner, resident, fold(String(input.title ?? ''))))
      if (!expected && duplicate) {
        if (!duplicate.enabled || duplicate.origin !== 'extracted') continue // do not resurrect dismissed or rewrite curated memories
        // An automatic memory of this title that the candidate list left out: update it rather than fail the batch.
        expected = { id: duplicate.id, revision: duplicate.revision }
      }
      const current = expected && get(owner, resident, expected.id)
      if (expected && (!current || current.revision !== expected.revision)) throw new Error('추출 중 기억이 바뀌었어. 새 내용으로 다시 정리할게.')
      if (current && (!current.enabled || current.origin === 'manual' || current.origin === 'legacy')) continue
      const sources = sourceIds.map(id => { const e = evidence.get(id); return { type: 'event', id, at: e.at, text: clipProse(e.text, 500) } })
      put(owner, resident, { ...input, id: expected?.id, revision: expected?.revision, constant: current?.constant ?? false, enabled: true }, now, 'extracted', sources)
    }
  }

  const remove = db.transaction((owner, resident, id, revision) => {
    const current = get(owner, resident, id)
    if (!current || current.revision !== revision) throw new Error('항목이 바뀌었거나 없어. 다시 불러와줘.')
    db.prepare('DELETE FROM aquarium_lore WHERE owner=? AND resident=? AND id=?').run(owner, resident, id)
  })
  const byTitle = (owner, resident, title) => read(db.prepare('SELECT * FROM aquarium_lore WHERE owner=? AND resident=? AND title_key=?').get(owner, resident, fold(title)))
  const all = (owner, resident) => db.prepare('SELECT * FROM aquarium_lore WHERE owner=? AND resident=? ORDER BY updated_at DESC,id').all(owner, resident).map(read)
  return { get, byTitle, put, list, all, select, relevant, count, migrate, applyExtracted, remove }
}
