/**
 * The village album: pictures residents draw go to one library image group.
 * Nothing is copied: images stay in the library and the page lists that group.
 * Generation can finish after the reply, so queue jobs and histories are followed up until they yield an image.
 */
export const ALBUM_PATH = 'AI 어항'
const STEP_MS = 3_000
const BATCH = 6
const GIVE_UP_MS = 60 * 60_000

const parse = result => {
  const text = result?.content?.find?.(c => c.type === 'text')?.text ?? ''
  if (result?.isError) throw new Error(text.slice(0, 300) || '앱 도구가 실패했어.')
  return JSON.parse(text)
}
const HASH = /^(?:[0-9a-f]{48}|[0-9a-f]{32})$/

/** `albumOf(owner)` names the library group of that save slot. */
export function createGallery(conai, { albumOf = () => ALBUM_PATH } = {}) {
  const db = conai.db
  db.exec(`CREATE TABLE IF NOT EXISTS gallery_queue (owner TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL, profile_id INTEGER NOT NULL, name TEXT NOT NULL,
      added_at INTEGER NOT NULL, next_at INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(owner, kind, ref));
    CREATE TABLE IF NOT EXISTS gallery_album (owner TEXT PRIMARY KEY, group_id INTEGER, count INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS gallery_added (owner TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY(owner, hash));`)
  const nextStep = new Map()
  const enqueue = (owner, kind, ref, resident, now) => db.prepare('INSERT OR IGNORE INTO gallery_queue(owner,kind,ref,profile_id,name,added_at,next_at) VALUES(?,?,?,?,?,?,?)')
    .run(owner, kind, String(ref), resident.profileId, resident.name, now, now)
  const done = row => db.prepare('DELETE FROM gallery_queue WHERE owner=? AND kind=? AND ref=?').run(row.owner, row.kind, row.ref)
  const later = (row, now, ms) => {
    if (now - row.added_at > GIVE_UP_MS) return done(row)
    db.prepare('UPDATE gallery_queue SET next_at=?, tries=tries+1 WHERE owner=? AND kind=? AND ref=?').run(now + ms, row.owner, row.kind, row.ref)
  }
  const backoff = row => Math.min(5 * 60_000, 10_000 * 2 ** row.tries)

  /**
   * Everything image-like one profile run produced: finished images, generation histories and still-running queue jobs.
   * A picture the profile writes after its reply (`deferred: writing`) appears later, so the reply job is re-read.
   */
  function collect(owner, run, resident, now, llmJobId = null) {
    if (llmJobId && run?.tools?.some(tool => tool.deferred?.state === 'writing')) enqueue(owner, 'run', llmJobId, resident, now)
    for (const tool of run?.tools ?? []) {
      for (const hash of tool.compositeHashes ?? []) if (HASH.test(hash)) enqueue(owner, 'hash', hash, resident, now)
      for (const id of tool.historyIds ?? []) if (Number.isSafeInteger(id)) enqueue(owner, 'history', id, resident, now)
      for (const id of tool.pendingJobIds ?? []) if (Number.isSafeInteger(id)) enqueue(owner, 'job', id, resident, now)
    }
  }

  /**
   * Follows up a few due items. `added(resident, count)` is told about images that were new to the album,
   * `failed(resident)` about a followed generation job that ended without a picture.
   */
  async function step(owner, now, added, failed = () => {}) {
    if ((nextStep.get(owner) ?? 0) > now) return
    nextStep.set(owner, now + STEP_MS)
    const rows = db.prepare('SELECT * FROM gallery_queue WHERE owner=? AND next_at<=? ORDER BY next_at LIMIT ?').all(owner, now, BATCH)
    for (const row of rows.filter(r => r.kind === 'run')) {
      try {
        const run = (await conai.llm.get(row.ref)).result?.profileRun
        collect(owner, run, { profileId: row.profile_id, name: row.name }, now)
        if (run?.tools?.some(tool => tool.deferred?.state === 'writing')) later(row, now, 5_000); else done(row)
      } catch { later(row, now, backoff(row)) }
    }
    for (const row of rows.filter(r => r.kind === 'job')) {
      try {
        const job = parse(await conai.tools.call('get_generation_job', { job_id: Number(row.ref) }))
        if (!['completed', 'failed', 'cancelled'].includes(job.status)) { later(row, now, 5_000); continue }
        if (job.status !== 'completed' || !job.history_ids?.length) failed({ profileId: row.profile_id, name: row.name })
        for (const id of job.history_ids ?? []) enqueue(owner, 'history', id, { profileId: row.profile_id, name: row.name }, now)
        done(row)
      } catch { later(row, now, backoff(row)) }
    }
    for (const row of rows.filter(r => r.kind === 'history')) {
      try {
        const record = parse(await conai.tools.call('get_generation_history', { history_id: Number(row.ref), limit: 1 })).records?.[0]
        if (!record || record.generation_status === 'failed') { done(row); continue }
        if (record.generation_status !== 'completed' || !HASH.test(record.composite_hash ?? '')) { later(row, now, 5_000); continue }
        enqueue(owner, 'hash', record.composite_hash, { profileId: row.profile_id, name: row.name }, now)
        done(row)
      } catch { later(row, now, backoff(row)) }
    }
    const hashes = rows.filter(r => r.kind === 'hash')
    if (!hashes.length) return
    try {
      const result = parse(await conai.tools.call('add_images_to_group', { composite_hashes: hashes.map(r => r.ref), group_path: albumOf(owner) }))
      const fresh = new Map()
      db.transaction(() => {
        for (const row of hashes) {
          if (db.prepare('INSERT OR IGNORE INTO gallery_added(owner,hash) VALUES(?,?)').run(owner, row.ref).changes) {
            const entry = fresh.get(row.profile_id) ?? { profileId: row.profile_id, name: row.name, count: 0 }
            entry.count++; fresh.set(row.profile_id, entry)
          }
          done(row)
        }
        const count = [...fresh.values()].reduce((sum, e) => sum + e.count, 0)
        db.prepare('INSERT INTO gallery_album(owner,group_id,count) VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET group_id=excluded.group_id, count=count+excluded.count')
          .run(owner, Number.isSafeInteger(result.group_id) ? result.group_id : null, count)
      })()
      for (const entry of fresh.values()) added(entry, entry.count)
    } catch { for (const row of hashes) later(row, now, backoff(row)) }
  }

  const info = owner => {
    const album = db.prepare('SELECT group_id AS groupId, count FROM gallery_album WHERE owner=?').get(owner)
    const waiting = db.prepare('SELECT COUNT(*) AS n FROM gallery_queue WHERE owner=?').get(owner).n
    return { path: albumOf(owner), groupId: album?.groupId ?? null, added: album?.count ?? 0, waiting }
  }
  return { collect, step, info }
}
