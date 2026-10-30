import { createLore } from './lore.mjs'
import { healLanguageLabels, translationOf } from './bilingual.mjs'
import { budgetInput, estimateTokens, PURPOSES } from '../llm-budget.mjs'
import { clipProse } from '../../shared/speech.mjs'
import { clockOf } from '../../shared/clock.mjs'
/**
 * Resident memory: each resident remembers only what it said, was told, or overheard nearby, so residents in
 * different places never share a conversation. Old lines fold into a per-resident summary written by that
 * resident's own profile. The village feed (`dialogue`) is what the viewer sees; this is what residents know.
 */
export const RECENT = 16
const SUMMARIZE_AFTER = 24 // Unsummarized lines beyond RECENT before the oldest ones are folded in.
const KEEP = 200
const SUMMARY_MAX = 1200
const BACKLOG_LIMIT = 2000

const stamp = now => { const d = new Date(now); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
/** Lines start with "[" so the profile's dialogue parser keeps them as one reference block instead of turns. */
/**
 * The village DM keeps its own memory under the negative of its profile id: the same profile invited as a resident
 * remembers the village as that resident, and as the DM separately.
 */
export const dmKey = profileId => -profileId
export const line = (now, place, text) => `[${stamp(now)} ${place}] ${text}`

/** `loreLimit`: keyword lore entries one selection keeps (the host's app-wide setting; Infinity before it is known). */
export function createMemory(conai, { clock = () => null, loreLimit = () => Infinity } = {}) {
  const db = conai.db
  const lore = createLore(db)
  db.exec(`CREATE TABLE IF NOT EXISTS memory (id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, resident INTEGER NOT NULL, at INTEGER NOT NULL, text TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS memory_resident ON memory(owner, resident, id);
    CREATE TABLE IF NOT EXISTS memory_summary (owner TEXT NOT NULL, resident INTEGER NOT NULL, text TEXT NOT NULL, through INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(owner, resident));
    CREATE TABLE IF NOT EXISTS memory_segments (id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL,resident INTEGER NOT NULL,through INTEGER NOT NULL,events TEXT NOT NULL,at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS memory_segments_resident ON memory_segments(owner,resident,id);
    CREATE TABLE IF NOT EXISTS memory_context (owner TEXT NOT NULL,resident INTEGER NOT NULL,selected TEXT NOT NULL,PRIMARY KEY(owner,resident));`)
  for (const table of ['memory', 'memory_summary']) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name)
    for (const field of ['display_text', 'language', 'display_language']) if (!columns.includes(field)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${field} TEXT`)
  }
  if (!db.prepare('PRAGMA table_info(memory)').all().some(c => c.name === 'profile_known')) db.exec('ALTER TABLE memory ADD COLUMN profile_known INTEGER NOT NULL DEFAULT 0')
  if (!db.prepare('PRAGMA table_info(memory)').all().some(c => c.name === 'day')) db.exec('ALTER TABLE memory ADD COLUMN day INTEGER')
  const segmentColumns = db.prepare('PRAGMA table_info(memory_segments)').all().map(c => c.name)
  for (const [field, type] of [['day', 'INTEGER'], ['summary', 'TEXT'], ['display_summary', 'TEXT']])
    if (!segmentColumns.includes(field)) db.exec(`ALTER TABLE memory_segments ADD COLUMN ${field} ${type}`)
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS memory_segments_day ON memory_segments(owner,resident,day) WHERE day IS NOT NULL')
  for (const table of ['memory', 'memory_summary']) healLanguageLabels(db, table, { source: row => row.text, display: row => row.display_text, displayLanguage: row => row.display_language, clear: 'display_text=NULL,display_language=NULL' })
  const summaryOf = (owner, resident) => db.prepare('SELECT text,display_text,language,display_language,through,at FROM memory_summary WHERE owner=? AND resident=?').get(owner, resident) ?? { text: '', through: 0, at: 0 }
  const linesOf = (owner, resident, after, limit) => db.prepare('SELECT id,at,text,display_text,language,display_language FROM (SELECT * FROM memory WHERE owner=? AND resident=? AND id>? ORDER BY id DESC LIMIT ?) ORDER BY id').all(owner, resident, after, limit)

  /** One line into several residents' memories (speaker, listener and whoever stood within earshot). */
  const remember = (owner, residents, text, now, translated = {}) => db.transaction(() => {
    const minute = clock(owner), day = Number.isFinite(minute) ? clockOf(minute).day : null
    for (const resident of new Set(residents)) {
      db.prepare('INSERT INTO memory(owner,resident,at,text,display_text,language,display_language,profile_known,day) VALUES(?,?,?,?,?,?,?,?,?)').run(owner, resident, now, text, translated.text ?? null, translated.language ?? null, translated.displayLanguage ?? null, translated.knownFor?.includes(resident) ? 1 : 0, day)
      // Never prune unprocessed events. The village stops admitting activity while extraction is backlogged.
      db.prepare('DELETE FROM memory WHERE owner=? AND resident=? AND id<=? AND id NOT IN (SELECT id FROM memory WHERE owner=? AND resident=? ORDER BY id DESC LIMIT ?)').run(owner, resident, summaryOf(owner, resident).through, owner, resident, KEEP)
    }
  })()

  /** The summary text a turn reads, unless a legacy lore entry already carries this very summary. */
  function summaryText(owner, resident, summary) {
    const legacy = db.prepare("SELECT sources FROM aquarium_lore WHERE owner=? AND resident=? AND origin='legacy' AND enabled=1 AND state<>'superseded'").get(owner, resident)
    const imported = legacy && JSON.parse(legacy.sources).some(s => s.type === 'legacy-summary' && s.through === summary.through)
    return imported ? '' : summary.text
  }
  /** What a resident brings into its next turn: its summary, then its latest lines. */
  function recallRecords(owner, resident) {
    const summary = summaryOf(owner, resident)
    const lines = db.prepare('SELECT text FROM memory WHERE owner=? AND resident=? AND id>? ORDER BY id').all(owner, resident, summary.through).map(l => l.text)
    const text = summaryText(owner, resident, summary)
    return [text && `[지난 기억] ${text}`, ...lines].filter(Boolean)
  }
  /** World lore and a memory's own lore for one selection, ranked together under the shared limit. */
  function loreFor(owner, personal, query, world = true) {
    const chosen = lore.relevant(owner, [...(world ? [0] : []), ...(personal ? [personal] : [])], query, loreLimit())
    return { world: chosen.filter(e => e.resident === 0), own: chosen.filter(e => e.resident !== 0) }
  }
  /**
   * What a judge reads of a resident's memory: its summary, its latest `window` lines and the lore this situation
   * calls up. Never the whole unsummarized backlog or every keyword-matched entry.
   */
  function judgeContext(owner, resident, situation, window = RECENT) {
    lore.migrate(owner, resident, summaryOf(owner, resident), Date.now())
    const summary = summaryOf(owner, resident)
    const recent = window > 0 ? linesOf(owner, resident, summary.through, window).map(l => l.text) : []
    const { world, own } = loreFor(owner, resident, `${recent.join('\n')}\n${situation}`)
    return { summary: summaryText(owner, resident, summary), recent, lore: [...world, ...own].map(e => e.text) }
  }
  const recall = (owner, resident) => recallRecords(owner, resident).join('\n')

  /**
   * Native rooms retain their own replies. Send only unseen outside events and changed aquarium lore; the room's
   * standing instructions go through the `chat.instructions` hook, never into the stored history.
   */
  function profileContext(owner, resident, message, { roomKey, threadId, kind = 'talk' } = {}) {
    const first = resident.profileMemory?.roomKey !== roomKey || resident.profileMemory?.threadId !== threadId
    resident.profileRoom = { roomKey, threadId }
    const previous = !first && resident.profileMemory || { through: 0, lore: {} }
    const summary = summaryOf(owner, resident.profileId)
    const rows = first
      ? db.prepare('SELECT id,text,profile_known FROM (SELECT id,text,profile_known FROM memory WHERE owner=? AND resident=? AND id>? ORDER BY id DESC LIMIT ?) ORDER BY id').all(owner, resident.profileId, summary.through, RECENT)
      : db.prepare('SELECT id,text,profile_known FROM memory WHERE owner=? AND resident=? AND id>? ORDER BY id').all(owner, resident.profileId, previous.through)
    lore.migrate(owner, resident.profileId, summaryOf(owner, resident.profileId), Date.now())
    const selected = loreFor(owner, resident.profileId, message), entries = [...selected.world, ...selected.own]
    const keyOf = entry => `${entry.resident}:${entry.id}`
    const seen = previous.lore
    const changed = entries.filter(e => seen[keyOf(e)] !== e.revision && !(first && summary.text && e.sources?.some(s => s.type === 'legacy-summary' && s.through === summary.through)))
    return {
      message: [message, first && summary.text && `[이전 기억 요약] ${summary.text}`,
        ...rows.filter(r => first || !r.profile_known).map(r => `[새로 겪거나 들은 일] ${r.text}`), ...changed.map(e => `[어항 기억/세계관 갱신] ${e.text}`)].filter(Boolean).join('\n'),
      checkpoint: { owner, roomKey, threadId, kind, through: rows.at(-1)?.id ?? (first ? summary.through : previous.through),
        lore: { ...seen, ...Object.fromEntries(entries.map(e => [keyOf(e), e.revision])) } },
    }
  }
  function acceptProfileContext(resident, pending, job) {
    if (!resident || !pending?.checkpoint || pending.contextDelivered || !job?.delivery ||
        job.requestId !== pending.input.requestId || job.profileId !== resident.profileId) return
    const checkpoint = pending.checkpoint
    if (resident.profileRoom?.roomKey !== checkpoint.roomKey || resident.profileRoom?.threadId !== job.delivery.threadId ||
        checkpoint.threadId !== job.delivery.threadId) return
    const previous = resident.profileMemory?.threadId === job.delivery.threadId && resident.profileMemory?.roomKey === checkpoint.roomKey
      ? resident.profileMemory : { through: 0, lore: {}, kinds: {} }
    const lore = { ...previous.lore }
    for (const [id, revision] of Object.entries(checkpoint.lore)) lore[id] = Math.max(lore[id] ?? 0, revision)
    const live = new Set(db.prepare('SELECT resident,id FROM aquarium_lore WHERE owner=? AND resident IN (0,?)')
      .all(checkpoint.owner, resident.profileId).map(e => `${e.resident}:${e.id}`))
    resident.profileMemory = { roomKey: checkpoint.roomKey, threadId: job.delivery.threadId,
      through: Math.max(previous.through, checkpoint.through),
      kinds: { ...previous.kinds, [checkpoint.kind]: Math.max(previous.kinds?.[checkpoint.kind] ?? 0, checkpoint.through) },
      lore: Object.fromEntries(Object.entries(lore).filter(([id]) => live.has(id))) }
    pending.contextDelivered = true
    pending.threadId = job.delivery.threadId
  }

  function decorate(owner, input, personal = input.profileId, { purpose = 'talk' } = {}) {
    if (personal) lore.migrate(owner, personal, summaryOf(owner, personal), Date.now())
    const recent = input.history !== undefined ? (Array.isArray(input.history) ? input.history : [input.history])
      : [...(personal ? recallRecords(owner, personal) : []), ...(input._recent ?? [])]
    const query = `${recent}\n${input.message}`
    const ratios = PURPOSES[purpose] ?? PURPOSES.talk
    const { world, own } = loreFor(owner, personal, query, !!ratios[3])
    if (personal) {
      const refs = rows => rows.slice(0, 40).map(e => ({ id: e.id, title: e.title, revision: e.revision }))
      db.prepare('INSERT INTO memory_context(owner,resident,selected) VALUES(?,?,?) ON CONFLICT(owner,resident) DO UPDATE SET selected=excluded.selected')
        .run(owner, personal, JSON.stringify({ at: Date.now(), requestId: input.requestId, world: refs(world), personal: refs(own), worldCount: world.length, personalCount: own.length }))
    }
    const decorated = budgetInput({ ...input, translation: input.translation ?? { fields: ['say', 'title', 'summary', 'job', 'skills.*.name', 'skills.*.effect', 'entries.*.title', 'entries.*.keys.*', 'entries.*.content'] } },
      { purpose, recent, personal: own.map(e => `${personal < 0 ? '[GM으로서의 장기 기억 · 주민들은 모르는 일일 수 있어]' : '[이 주민의 장기 기억 · 다른 주민이 안다고 가정하지 마]'} ${e.text}`), world: world.map(e => `[공통 세계관] ${e.text}`) })
    // Compatibility projection is lazy and never serialized alongside sources.
    // startBudgeted reconstructs history from these complete records.
    const context = decorated._budget
    Object.defineProperty(decorated, 'history', { configurable: true, enumerable: false,
      get: () => [...recent, ...context.personal, ...context.world].filter(Boolean).join('\n') })
    return decorated
  }

  /** Live worlds close one game date at a time; undated standalone imports use the legacy window. */
  function due(owner, resident) {
    const summary = summaryOf(owner, resident)
    const minute = clock(owner)
    if (Number.isFinite(minute)) {
      const first = db.prepare('SELECT day FROM memory WHERE owner=? AND resident=? AND id>? ORDER BY id LIMIT 1').get(owner, resident, summary.through)
      if (!first || first.day !== null && first.day >= clockOf(minute).day) return null
      const lines = db.prepare('SELECT id,text FROM memory WHERE owner=? AND resident=? AND id>? AND day IS ? ORDER BY id').all(owner, resident, summary.through, first.day)
      return { previous: summary.text, lines: lines.map(l => l.text), through: lines.at(-1).id, day: first.day }
    }
    // Undated imports retain the legacy batching contract; live worlds supply their game clock.
    const count = db.prepare('SELECT COUNT(*) AS n FROM memory WHERE owner=? AND resident=? AND id>?').get(owner, resident, summary.through).n
    if (count < RECENT + SUMMARIZE_AFTER) return null
    const lines = db.prepare('SELECT id, text FROM memory WHERE owner=? AND resident=? AND id>? ORDER BY id LIMIT ?').all(owner, resident, summary.through, count - RECENT)
    return { previous: summary.text, lines: lines.map(l => l.text), through: lines.at(-1).id }
  }
  function batch(owner, resident, { tokens = Infinity, maxEvents = Infinity, force = false } = {}) {
    const dueBatch = due(owner, resident)
    if (!dueBatch && !force) return null
    const summary = summaryOf(owner, resident)
    lore.migrate(owner, resident, summary, Date.now())
    const rows = db.prepare('SELECT id,at,text,display_text,language,display_language,day FROM memory WHERE owner=? AND resident=? AND id>? AND id<=? ORDER BY id LIMIT ?')
      .all(owner, resident, summary.through, dueBatch?.through ?? Number.MAX_SAFE_INTEGER, Number.isFinite(maxEvents) ? maxEvents : -1)
    const events = []; let size = 1
    for (const raw of rows) {
      if (events.length && raw.day !== rows[0].day) break
      const row = { id: raw.id, at: raw.at, text: raw.text, day: raw.day, display_text: raw.display_text }
      const length = estimateTokens(row) + 1
      if (events.length && size + length > tokens) break
      events.push(row); size += length
    }
    if (!events.length) return null
    // Relevant existing entries are optional budgeted data, not a fixed-count selection.
    const known = []
    for (const e of lore.select(owner, resident, events.map(e => e.text).join('\n'), Infinity).filter(e => e.origin === 'extracted')) {
      const item = { id: e.id, revision: e.revision, title: e.title, content: e.content, keys: e.keys, state: e.state }
      known.push(item)
    }
    const day = events[0].day
    const daily = day == null ? null : db.prepare('SELECT summary FROM memory_segments WHERE owner=? AND resident=? AND day=?').get(owner, resident, day)
    return { previous: summary.text, through: events.at(-1).id, from: summary.through, events, known, day, dailySummary: daily?.summary ?? '' }
  }
  const complete = db.transaction((owner, resident, expected, result, now, translated = null) => {
    if (summaryOf(owner, resident).through !== expected.from) return false
    if (!result || typeof result.summary !== 'string') throw new Error('기억 요약 형식이 올바르지 않아.')
    if (expected.day != null && (typeof result.dailySummary !== 'string' || !result.dailySummary.trim()))
      throw new Error('일자별 핵심 요약이 없어. 사건은 미정리 상태로 보존했어.')
    const display = translated?.status === 'completed' ? translated.json : null
    const entries = Array.isArray(result.entries) ? result.entries.map((e, i) => {
      const entry = { ...e, title: clipProse(e?.title, 80), content: clipProse(e?.content, 2000),
        keys: Array.isArray(e?.keys) ? e.keys.slice(0, 20).map(k => clipProse(k, 100)) : e?.keys, language: translated?.sourceLanguage }
      entry.translation = display?.entries?.[i] ? translationOf(entry, { ...display.entries[i], language: translated.language }) : null
      return entry
    }) : result.entries
    lore.applyExtracted(owner, resident, entries, expected, now)
    const daily = expected.day == null ? null : db.prepare('SELECT id,events FROM memory_segments WHERE owner=? AND resident=? AND day=?').get(owner, resident, expected.day)
    const displaySummary = typeof display?.dailySummary === 'string' ? display.dailySummary : null
    if (daily) db.prepare('UPDATE memory_segments SET through=?,events=?,at=?,summary=?,display_summary=? WHERE id=?')
      .run(expected.through, JSON.stringify([...JSON.parse(daily.events), ...expected.events]), now, result.dailySummary, displaySummary, daily.id)
    else db.prepare('INSERT INTO memory_segments(owner,resident,through,events,at,day,summary,display_summary) VALUES(?,?,?,?,?,?,?,?)')
      .run(owner, resident, expected.through, JSON.stringify(expected.events), now, expected.day ?? null, result.dailySummary ?? result.summary, displaySummary)
    db.prepare(`DELETE FROM memory_segments WHERE owner=? AND resident=? AND events NOT LIKE '%"skipped":true%' AND id NOT IN (SELECT id FROM memory_segments WHERE owner=? AND resident=? ORDER BY id DESC LIMIT 200)`).run(owner, resident, owner, resident)
    summarize(owner, resident, expected.through, clipProse(result.summary, SUMMARY_MAX), now)
    db.prepare('UPDATE memory_summary SET display_text=?,language=?,display_language=? WHERE owner=? AND resident=?').run(typeof display?.summary === 'string' ? clipProse(display.summary, 2400) : null, translated?.sourceLanguage ?? null, display ? translated.language : null, owner, resident)
    return true
  })
  const backlogged = (owner, residents = null) => {
    if (residents && !residents.length) return false
    return !!db.prepare(`SELECT 1 FROM memory m LEFT JOIN memory_summary s ON s.owner=m.owner AND s.resident=m.resident
      WHERE m.owner=? ${residents ? `AND m.resident IN (${residents.map(() => '?').join(',')})` : ''}
      AND m.id>COALESCE(s.through,0) GROUP BY m.resident HAVING COUNT(*)>=? LIMIT 1`).get(owner, ...(residents ?? []), BACKLOG_LIMIT)
  }
  const skip = db.transaction((owner, resident, expected, reason, now) => {
    const summary = summaryOf(owner, resident)
    if (summary.through !== expected.from) return false
    const raw = db.prepare('SELECT id,at,text FROM memory WHERE owner=? AND resident=? AND id=?').get(owner, resident, expected.events[0].id)
    if (!raw) return false
    // A skipped event stays in the evidence table even after the recent raw window
    // is pruned; its reason is visible through the existing event-search UI.
    db.prepare('INSERT INTO memory_segments(owner,resident,through,events,at) VALUES(?,?,?,?,?)').run(owner, resident, raw.id, JSON.stringify([{ ...raw, skipped: true, reason }]), now)
    summarize(owner, resident, raw.id, summary.text, now)
    return true
  })
  function events(owner, resident, { query = '', before = Number.MAX_SAFE_INTEGER } = {}) {
    if (typeof query !== 'string' || query.length > 200 || !Number.isSafeInteger(before) || before < 0) throw new Error('사건 검색 범위를 확인해줘.')
    const rows = db.prepare(`SELECT s.id,s.through,s.events,s.at,s.day,s.summary,s.display_summary,
      EXISTS(SELECT 1 FROM memory m WHERE m.owner=s.owner AND m.resident=s.resident AND m.day=s.day AND m.id>s.through) AS pending
      FROM memory_segments s WHERE s.owner=? AND s.resident=? AND s.id<? AND (?='' OR instr(lower(s.events || COALESCE(s.summary,'') || COALESCE(s.display_summary,'')),lower(?))>0) ORDER BY s.id DESC LIMIT 10`).all(owner, resident, before, query, query)
    return { segments: rows.map(r => ({ ...r, events: JSON.parse(r.events), pending: !!r.pending })), next: rows.length === 10 ? rows.at(-1).id : null }
  }
  /** A summary only moves forward; a late answer for lines already folded in is ignored. */
  function summarize(owner, resident, through, text, now) {
    const current = summaryOf(owner, resident)
    if (through <= current.through) return
    db.prepare('INSERT INTO memory_summary(owner,resident,text,through,at) VALUES(?,?,?,?,?) ON CONFLICT(owner,resident) DO UPDATE SET text=excluded.text, through=excluded.through, at=excluded.at')
      .run(owner, resident, clipProse(text, SUMMARY_MAX), through, now)
  }

  const view = (owner, resident) => {
    const summary = summaryOf(owner, resident)
    lore.migrate(owner, resident, summary, Date.now())
    const selected = db.prepare('SELECT selected FROM memory_context WHERE owner=? AND resident=?').get(owner, resident)
    return {
      summary: summary.text, displaySummary: summary.display_text ?? null, language: summary.language ?? null, summarizedAt: summary.at || null,
      lines: linesOf(owner, resident, summary.through, 60).map(l => ({ at: l.at, text: l.text, displayText: l.display_text, language: l.language, displayLanguage: l.display_language })),
      loreCount: lore.count(owner, resident), backlogged: backlogged(owner, [resident]), selected: selected ? JSON.parse(selected.selected) : null,
    }
  }
  const forget = (owner, resident) => db.transaction(() => {
    db.prepare('DELETE FROM memory WHERE owner=? AND resident=?').run(owner, resident)
    db.prepare('DELETE FROM memory_summary WHERE owner=? AND resident=?').run(owner, resident)
    db.prepare('DELETE FROM memory_segments WHERE owner=? AND resident=?').run(owner, resident)
    db.prepare('DELETE FROM memory_context WHERE owner=? AND resident=?').run(owner, resident)
    db.prepare('DELETE FROM aquarium_lore WHERE owner=? AND resident=?').run(owner, resident)
    db.prepare('DELETE FROM aquarium_lore_migrations WHERE owner=? AND resident=?').run(owner, resident)
  })()

  return { remember, recall, recallRecords, judgeContext, profileContext, acceptProfileContext, due, summarize, view, forget, lore, decorate, batch, complete, skip, backlogged, events }
}
