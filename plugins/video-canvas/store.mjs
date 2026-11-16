import { randomUUID, createHash } from 'node:crypto'
import { adapterOf, canonical, expected, fail, newProject, projectName, sequenceOf } from './domain.mjs'

export const workflowSourceKey = (ref, fingerprint) => createHash('sha256').update(canonical({ ref, fingerprint })).digest('hex')

// The profile library and its defaults belong to the account (vc_profile, vc_settings); get adds them to every read.
const encodeCanvas = project => {
  const { takes, extractions, exports, chains, profiles, settings, ...canvas } = structuredClone(project)
  for (const node of canvas.nodes) delete node.data.check
  return JSON.stringify(canvas)
}
export const PROFILE_CHANGED = '409: 생성 설정이 그 사이에 바뀌었어. 목록을 다시 읽고 저장해줘.'
/**
 * A project naming a profile ID that moved (renamed: old ID -> new ID) is rewritten to name the new one: its canvas nodes and its
 * takes' profile copies, snapshots and guards. Its undo batch would bring the old ID back, so it is dropped. A migration
 * (createLibrary) keeps the project's revision; a merge (bump) raises it so open readers re-read. The update time stays.
 * Returns false, writing nothing, when neither the canvas, its takes nor its undo batch name a moved ID.
 */
function renameProfiles(db, row, canvas, renamed, bump = false) {
  const rename = (holder, key) => {
    if (!holder || typeof holder !== 'object' || !renamed.has(holder[key])) return false
    holder[key] = renamed.get(holder[key])
    return true
  }
  const nodes = list => (Array.isArray(list) ? list : []).reduce((hit, node) => rename(node?.data, 'profileId') | rename(node?.data, 'upscaleProfileId') | hit, 0)
  const takes = []
  for (const take of db.prepare('SELECT id, data FROM vc_take WHERE account=? AND project=?').all(row.account, row.id)) {
    let data
    try { data = JSON.parse(take.data) } catch { continue }
    if (nodes(data?.snapshot?.nodes) | rename(data?.guard, 'profile_id') | rename(data?.profile, 'id')) takes.push([JSON.stringify(data), take.id])
  }
  const log = db.prepare('SELECT before_data FROM vc_undo WHERE project=?').get(row.id)
  if (!(nodes(canvas.nodes) | takes.length | (log ? nodes(JSON.parse(log.before_data).nodes) : 0))) return false
  for (const profile of Array.isArray(canvas.profiles) ? canvas.profiles : []) rename(profile, 'id')
  if (bump) {
    canvas.revision += 1
    db.prepare('UPDATE vc_project SET data=?, revision=? WHERE id=?').run(JSON.stringify(canvas), canvas.revision, row.id)
  } else db.prepare('UPDATE vc_project SET data=? WHERE id=?').run(JSON.stringify(canvas), row.id)
  for (const [data, id] of takes) db.prepare('UPDATE vc_take SET data=? WHERE id=?').run(data, id)
  db.prepare('DELETE FROM vc_undo WHERE project=?').run(row.id)
  return true
}
/**
 * The account profile library. The run that creates its table copies every project's embedded profiles into it, oldest project
 * first, under their own IDs and without touching the projects; their embedded copies go with each project's next save. An ID
 * repeated with the same content is stored once; with other content, that version is stored under a new ID and only the projects
 * holding it are rewritten (renameProfiles). An account left with Director profiles gets a default cut profile: the one most
 * cuts use, else the newest.
 */
function createLibrary(db) {
  db.exec('CREATE TABLE IF NOT EXISTS vc_settings (account TEXT PRIMARY KEY, cut_profile TEXT, upscale_profile TEXT)')
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='vc_profile'").get()) return
  db.transaction(() => {
    db.exec('CREATE TABLE vc_profile (account TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, data TEXT NOT NULL, PRIMARY KEY(account, id))')
    // versions: account and embedded ID -> stored content -> the library ID holding it.
    const insert = db.prepare('INSERT INTO vc_profile(account,id,data) VALUES(?,?,?)'), versions = new Map(), uses = new Map()
    for (const row of db.prepare('SELECT id, account, data FROM vc_project ORDER BY created, rowid').all()) {
      let canvas
      try { canvas = JSON.parse(row.data) } catch { continue }
      const renamed = new Map(), seen = new Set()
      for (const profile of Array.isArray(canvas?.profiles) ? canvas.profiles : []) {
        // A project resolved an ID it repeats to the first profile holding it.
        if (typeof profile?.id !== 'string' || seen.has(profile.id)) continue
        seen.add(profile.id)
        const key = `${row.account}\u0000${profile.id}`, content = canonical(profile)
        if (!versions.has(key)) versions.set(key, new Map())
        const stored = versions.get(key)
        if (!stored.size) { stored.set(content, profile.id); insert.run(row.account, profile.id, JSON.stringify(profile)); continue }
        if (!stored.has(content)) {
          const id = randomUUID()
          stored.set(content, id); insert.run(row.account, id, JSON.stringify({ ...profile, id }))
        }
        if (stored.get(content) !== profile.id) renamed.set(profile.id, stored.get(content))
      }
      if (renamed.size) renameProfiles(db, row, canvas, renamed)
      if (!uses.has(row.account)) uses.set(row.account, new Map())
      const counts = uses.get(row.account)
      for (const node of Array.isArray(canvas?.nodes) ? canvas.nodes : []) if (node?.kind === 'cut' && node.data?.profileId) counts.set(node.data.profileId, (counts.get(node.data.profileId) ?? 0) + 1)
    }
    for (const [account, counts] of uses) {
      const directors = db.prepare('SELECT id, data FROM vc_profile WHERE account=? ORDER BY rowid').all(account).filter(row => adapterOf(JSON.parse(row.data)) === 'director')
      if (!directors.length) continue
      const chosen = directors.reduce((best, row) => (counts.get(row.id) ?? 0) >= (counts.get(best.id) ?? 0) ? row : best)
      db.prepare('INSERT INTO vc_settings(account,cut_profile) VALUES(?,?) ON CONFLICT(account) DO UPDATE SET cut_profile=excluded.cut_profile WHERE cut_profile IS NULL').run(account, chosen.id)
    }
  })()
}
// The result_hash column feeds project covers; a sound take's result is an audio candidate ID, not library media.
const coverHash = take => take.output === 'audio' ? null : take.resultHash ?? null
const SORTS = { updated: 'updated DESC, id', name: 'name COLLATE NOCASE, id', created: 'created DESC, id' }
// Additive columns for project lists and covers; existing rows are backfilled once when a column is added.
function addColumns(db) {
  const has = (table, column) => db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === column)
  db.transaction(() => {
    if (!has('vc_project', 'created')) db.exec('ALTER TABLE vc_project ADD COLUMN created TEXT; UPDATE vc_project SET created=updated;')
    if (!has('vc_project', 'archived')) db.exec('ALTER TABLE vc_project ADD COLUMN archived INTEGER NOT NULL DEFAULT 0')
    if (!has('vc_take', 'result_hash')) db.exec("ALTER TABLE vc_take ADD COLUMN result_hash TEXT; UPDATE vc_take SET result_hash=json_extract(data,'$.resultHash') WHERE json_valid(data);")
    db.exec('CREATE INDEX IF NOT EXISTS vc_project_list ON vc_project(account, archived, updated)')
  })()
}
export function createStore(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS vc_project (
    id TEXT PRIMARY KEY, account TEXT NOT NULL, name TEXT NOT NULL, revision INTEGER NOT NULL,
    data TEXT NOT NULL, updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS vc_project_account ON vc_project(account, updated);
  CREATE TABLE IF NOT EXISTS vc_take (
    id TEXT PRIMARY KEY, project TEXT NOT NULL, account TEXT NOT NULL, job_id INTEGER,
    status TEXT NOT NULL, data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS vc_take_job ON vc_take(job_id);
  CREATE INDEX IF NOT EXISTS vc_take_project ON vc_take(account, project);
  CREATE TABLE IF NOT EXISTS vc_extraction (id TEXT PRIMARY KEY, project TEXT NOT NULL, account TEXT NOT NULL, data TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS vc_extraction_project ON vc_extraction(account, project);
  CREATE TABLE IF NOT EXISTS vc_node_check (project TEXT NOT NULL, node TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(project,node));
  CREATE TABLE IF NOT EXISTS vc_undo (project TEXT PRIMARY KEY, account TEXT NOT NULL, revision INTEGER NOT NULL, before_data TEXT NOT NULL, operations TEXT NOT NULL, undone INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS vc_run_request (account TEXT NOT NULL, project TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, take_id TEXT NOT NULL, PRIMARY KEY(account,project,request_id));
  CREATE TABLE IF NOT EXISTS vc_upload (account TEXT NOT NULL, source_key TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(account,source_key));
  CREATE TABLE IF NOT EXISTS vc_take_upload (take_id TEXT NOT NULL, account TEXT NOT NULL, source_key TEXT NOT NULL, PRIMARY KEY(take_id,account,source_key));
  CREATE INDEX IF NOT EXISTS vc_take_upload_source ON vc_take_upload(account,source_key);
  CREATE TABLE IF NOT EXISTS vc_export (id TEXT PRIMARY KEY, project TEXT NOT NULL, account TEXT NOT NULL, data TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS vc_export_project ON vc_export(account, project);
  CREATE TABLE IF NOT EXISTS vc_chain (id TEXT PRIMARY KEY, project TEXT NOT NULL, account TEXT NOT NULL, data TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS vc_chain_project ON vc_chain(account, project);`)
  addColumns(db)
  createLibrary(db)
  const insertTake = db.prepare('INSERT INTO vc_take(id,project,account,job_id,status,data,result_hash) VALUES(?,?,?,?,?,?,?)')
  const insertExtraction = db.prepare('INSERT INTO vc_extraction(id,project,account,data) VALUES(?,?,?,?)')
  const insertExport = db.prepare('INSERT INTO vc_export(id,project,account,data) VALUES(?,?,?,?)')
  const insertChain = db.prepare('INSERT INTO vc_chain(id,project,account,data) VALUES(?,?,?,?)')
  const insertProject = db.prepare('INSERT INTO vc_project(id,account,name,revision,data,created) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP)')
  const load = db.prepare('SELECT data, name FROM vc_project WHERE id = ? AND account = ?')
  const loadRow = (account, id) => {
    const row = load.get(id, account)
    if (!row) fail('프로젝트가 없거나 접근할 수 없어.', 404)
    return row
  }
  const canvasOf = (account, id) => JSON.parse(loadRow(account, id).data)
  // Parsed library rows per account, frozen so every read shares them and none can change them. A library write drops the
  // account's entry, and a read inside a transaction does not fill it: a rollback would leave it ahead of the table.
  const libraries = new Map(), libraryRows = db.prepare('SELECT id, revision, data FROM vc_profile WHERE account=? ORDER BY rowid')
  const freeze = value => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const item of Object.values(value)) freeze(item); Object.freeze(value) }
    return value
  }
  const library = account => {
    if (libraries.has(account)) return libraries.get(account)
    const rows = freeze(libraryRows.all(account).map(row => ({ id: row.id, revision: row.revision, profile: JSON.parse(row.data) })))
    if (!db.inTransaction) libraries.set(account, rows)
    return rows
  }
  // Library entries equal apart from their ID, in groups of two or more, oldest first; kept with the parsed library they come from.
  // A key left out and the same key holding nothing ({}, [], '', null) generate alike: older saves stored `overrides: {}` where newer ones store none.
  const empty = value => value === null || value === '' || typeof value === 'object' && Object.keys(value).length === 0
  const duplicateGroups = new WeakMap()
  const duplicatesOf = account => {
    const rows = library(account)
    if (!duplicateGroups.has(rows)) {
      const groups = new Map()
      for (const row of rows) {
        const { id, ...content } = row.profile, key = canonical(Object.fromEntries(Object.entries(content).filter(([, value]) => !empty(value))))
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(row)
      }
      duplicateGroups.set(rows, [...groups.values()].filter(group => group.length > 1))
    }
    return duplicateGroups.get(rows)
  }
  const filter = ({ query, archived = false }) => {
    const where = ['account=?', 'archived=?'], values = [archived ? 1 : 0]
    if (query) { where.push("name LIKE ? ESCAPE '\\'"); values.push(`%${query.replace(/[\\%_]/g, '\\$&')}%`) }
    return { where: where.join(' AND '), values }
  }
  // Only the selected page's canvases are measured; covers prefer the latest finished take, then the first library image/video.
  const rows = (account, where, values, order, page = '') => db.prepare(`SELECT p.id,p.name,p.revision,p.updated,p.created,p.archived,
      json_array_length(p.data,'$.nodes') AS nodeCount,
      (SELECT COUNT(*) FROM json_each(p.data,'$.nodes') WHERE json_extract(value,'$.kind')='cut') AS cutCount,
      COALESCE((SELECT t.result_hash FROM vc_take t WHERE t.account=p.account AND t.project=p.id AND t.result_hash IS NOT NULL ORDER BY t.rowid DESC LIMIT 1),
        (SELECT json_extract(value,'$.data.ref.compositeHash') FROM json_each(p.data,'$.nodes') WHERE json_extract(value,'$.kind') IN ('image','video') AND json_extract(value,'$.data.ref.source')='library' LIMIT 1)) AS cover
    FROM (SELECT * FROM vc_project WHERE ${where} ORDER BY ${order} ${page}) p ORDER BY ${order}`).all(account, ...values)
    .map(row => ({ ...row, archived: row.archived === 1 }))
  const readState = (table, account, project, id) => {
    const row = db.prepare(`SELECT data FROM ${table} WHERE id=? AND account=? AND project=?`).get(id, account, project)
    if (!row) fail('작업이 없거나 접근할 수 없어.', 404)
    return JSON.parse(row.data)
  }
  return {
    list(account, { offset = 0, limit = 40, query, sort = 'updated', archived = false } = {}) {
      if (!Number.isInteger(offset) || offset < 0) fail('offset이 올바르지 않아.')
      if (!Number.isInteger(limit) || limit < 1) fail('limit은 1 이상 정수로 써줘.')
      if (!Object.hasOwn(SORTS, sort)) fail('sort: updated / name / created 중에서 골라줘.')
      const { where, values } = filter({ query, archived })
      return rows(account, where, values, SORTS[sort], `LIMIT ${limit} OFFSET ${offset}`)
    },
    count(account, options = {}) {
      const { where, values } = filter(options)
      return db.prepare(`SELECT COUNT(*) AS total FROM vc_project WHERE ${where}`).get(account, ...values).total
    },
    summary(account, id) {
      const [row] = rows(account, 'account=? AND id=?', [id], SORTS.updated)
      if (!row) fail('프로젝트가 없거나 접근할 수 없어.', 404)
      return row
    },
    create(account, name, canvas = {}) {
      const project = { ...newProject(randomUUID(), name), ...canvas }
      insertProject.run(project.id, account, project.name, project.revision, encodeCanvas(project))
      return project
    },
    rename(account, id, name) {
      loadRow(account, id)
      name = projectName(name)
      db.prepare("UPDATE vc_project SET name=?,data=json_set(data,'$.name',?),updated=CURRENT_TIMESTAMP WHERE id=? AND account=?").run(name, name, id, account)
      return this.summary(account, id)
    },
    archive(account, id, archived) {
      loadRow(account, id)
      db.prepare('UPDATE vc_project SET archived=? WHERE id=? AND account=?').run(archived ? 1 : 0, id, account)
      return this.summary(account, id)
    },
    // ---- the account profile library: rows carry their own revision; order is insertion order; read profiles are frozen ----
    profiles(account) { return library(account).map(row => row.profile) },
    revisions(account) { return Object.fromEntries(library(account).map(row => [row.id, row.revision])) },
    profileRow(account, id) {
      const row = db.prepare('SELECT data, revision FROM vc_profile WHERE account=? AND id=?').get(account, id)
      return row ? { profile: JSON.parse(row.data), revision: row.revision } : null
    },
    // A new profile (no revision) must not exist yet; a changed one must still be at the revision its save read.
    putProfile(account, profile, revision = null) {
      libraries.delete(account)
      const changed = revision === null
        ? db.prepare('INSERT OR IGNORE INTO vc_profile(account,id,data) VALUES(?,?,?)').run(account, profile.id, JSON.stringify(profile))
        : db.prepare('UPDATE vc_profile SET data=?, revision=revision+1 WHERE account=? AND id=? AND revision=?').run(JSON.stringify(profile), account, profile.id, revision)
      if (!changed.changes) fail(PROFILE_CHANGED, 409)
      return profile
    },
    // A default naming the removed profile is cleared with it. Nodes keep the ID: before a run a cut gets the default cut
    // profile, if there is one (the server's ensureProfile); a generation node asks for another setting.
    removeProfile(account, id) {
      libraries.delete(account)
      db.transaction(() => {
        if (!db.prepare('DELETE FROM vc_profile WHERE account=? AND id=?').run(account, id).changes) fail('생성 설정이 없거나 접근할 수 없어.', 404)
        db.prepare('UPDATE vc_settings SET cut_profile=NULLIF(cut_profile,?), upscale_profile=NULLIF(upscale_profile,?) WHERE account=?').run(id, id, account)
      })()
    },
    // The entries a merge would remove.
    duplicates(account) { return duplicatesOf(account).reduce((total, group) => total + group.length - 1, 0) },
    // Entries equal apart from their ID become one: the role's default if the group holds it, else the most used, else the
    // oldest. Every project naming a removed ID is rewritten to the kept one with its revision raised (renameProfiles). A default
    // is always the kept entry of its group, so the defaults stay as they are. Returns the number of entries removed.
    mergeProfiles(account) {
      libraries.delete(account)
      return db.transaction(() => {
        const settings = this.settings(account), uses = this.usage(account), renamed = new Map()
        const defaults = new Set([settings.cutProfileId, settings.upscaleProfileId])
        for (const group of duplicatesOf(account)) {
          const kept = group.find(row => defaults.has(row.id)) ?? group.reduce((best, row) => (uses[row.id] ?? 0) > (uses[best.id] ?? 0) ? row : best)
          for (const row of group) if (row !== kept) renamed.set(row.id, kept.id)
        }
        if (!renamed.size) return 0
        const remove = db.prepare('DELETE FROM vc_profile WHERE account=? AND id=?')
        for (const id of renamed.keys()) remove.run(account, id)
        // A row that does not parse cannot be opened either; like usage(), the merge passes it by instead of failing on it.
        for (const row of db.prepare('SELECT id, account, data FROM vc_project WHERE account=? AND json_valid(data)').all(account)) renameProfiles(db, row, JSON.parse(row.data), renamed, true)
        return renamed.size
      })()
    },
    settings(account) {
      const row = db.prepare('SELECT cut_profile, upscale_profile FROM vc_settings WHERE account=?').get(account)
      return { cutProfileId: row?.cut_profile ?? null, upscaleProfileId: row?.upscale_profile ?? null }
    },
    setSettings(account, { cutProfileId, upscaleProfileId }) {
      db.prepare('INSERT INTO vc_settings(account,cut_profile,upscale_profile) VALUES(?,?,?) ON CONFLICT(account) DO UPDATE SET cut_profile=excluded.cut_profile, upscale_profile=excluded.upscale_profile').run(account, cutProfileId, upscaleProfileId)
      return this.settings(account)
    },
    // Cut and generation nodes naming each profile, as their setting or a cut's upscale setting, across the account's projects.
    usage(account) {
      const nodes = "FROM vc_project p, json_each(p.data,'$.nodes') n WHERE p.account=? AND json_valid(p.data)"
      return Object.fromEntries(db.prepare(`SELECT id, COUNT(*) AS uses FROM (SELECT json_extract(n.value,'$.data.profileId') AS id ${nodes} AND json_extract(n.value,'$.kind') IN ('cut','gen')
        UNION ALL SELECT json_extract(n.value,'$.data.upscaleProfileId') ${nodes} AND json_extract(n.value,'$.kind')='cut') WHERE id IS NOT NULL GROUP BY id`).all(account, account).map(row => [row.id, row.uses]))
    },
    remove(account, id) {
      db.transaction(() => {
        loadRow(account, id)
        db.prepare('DELETE FROM vc_take_upload WHERE account=? AND take_id IN (SELECT id FROM vc_take WHERE account=? AND project=?)').run(account, account, id)
        for (const table of ['vc_take', 'vc_extraction', 'vc_export', 'vc_chain', 'vc_run_request', 'vc_undo']) db.prepare(`DELETE FROM ${table} WHERE account=? AND project=?`).run(account, id)
        db.prepare('DELETE FROM vc_node_check WHERE project=?').run(id)
        db.prepare('DELETE FROM vc_project WHERE id=? AND account=?').run(id, account)
      })()
    },
    get(account, id) {
      const row = loadRow(account, id), project = JSON.parse(row.data)
      // The name column is authoritative: a rename does not bump the canvas revision.
      project.name = row.name
      project.sequence = sequenceOf(project)
      project.profiles = this.profiles(account)
      project.settings = this.settings(account)
      project.takes = db.prepare('SELECT data FROM vc_take WHERE account=? AND project=? ORDER BY rowid').all(account, id).map(row => JSON.parse(row.data))
      project.extractions = db.prepare('SELECT data FROM vc_extraction WHERE account=? AND project=? ORDER BY rowid').all(account, id).map(row => JSON.parse(row.data))
      project.exports = db.prepare('SELECT data FROM vc_export WHERE account=? AND project=? ORDER BY rowid').all(account, id).map(row => JSON.parse(row.data))
      project.chains = db.prepare('SELECT data FROM vc_chain WHERE account=? AND project=? ORDER BY rowid').all(account, id).map(row => JSON.parse(row.data))
      const checks = new Map(db.prepare('SELECT node,data FROM vc_node_check WHERE project=?').all(id).map(row => [row.node, JSON.parse(row.data)]))
      for (const node of project.nodes) if (checks.has(node.id)) node.data.check = checks.get(node.id)
      return project
    },
    save(account, before, next, log = null) {
      return db.transaction(() => {
        expected(canvasOf(account, before.id), before.revision)
        const changed = db.prepare('UPDATE vc_project SET data=?,revision=?,updated=CURRENT_TIMESTAMP WHERE id=? AND account=? AND revision=?')
          .run(encodeCanvas(next), next.revision, next.id, account, before.revision)
        if (!changed.changes) fail('409: 캔버스가 바뀌었어. 다시 읽어줘.', 409)
        if (log?.actor === 'assistant') db.prepare('INSERT INTO vc_undo VALUES(?,?,?,?,?,0) ON CONFLICT(project) DO UPDATE SET revision=excluded.revision,before_data=excluded.before_data,operations=excluded.operations,undone=0')
          .run(next.id, account, next.revision, JSON.stringify({ nodes: before.nodes, edges: before.edges, sequence: before.sequence }), JSON.stringify(log.ops))
        return this.get(account, next.id)
      })()
    },
    lastLog(project) { return db.prepare('SELECT * FROM vc_undo WHERE project=? AND undone=0').get(project) },
    undo(account, project, log) {
      if (log.account !== account || project.revision !== log.revision) fail('409: 그 뒤에 편집이 있어. 새 편집으로 되돌려줘.', 409)
      return db.transaction(() => {
        const next = { ...project, ...JSON.parse(log.before_data), revision: project.revision + 1 }
        this.save(account, project, next)
        db.prepare('UPDATE vc_undo SET undone=1 WHERE project=?').run(project.id)
        return this.get(account, project.id)
      })()
    },
    setChecks(account, project, assets) {
      canvasOf(account, project)
      db.transaction(() => { for (const [id, value] of Object.entries(assets)) db.prepare('INSERT OR REPLACE INTO vc_node_check VALUES(?,?,?)').run(project, id, JSON.stringify(value)) })()
    },
    take(account, project, id) { canvasOf(account, project); return readState('vc_take', account, project, id) },
    addTake(account, project, take) { canvasOf(account, project); insertTake.run(take.id, project, account, take.jobId ?? null, take.status, JSON.stringify(take), coverHash(take)); return take },
    setTake(account, project, id, patch) {
      const take = { ...this.take(account, project, id), ...patch }
      db.prepare('UPDATE vc_take SET job_id=?,status=?,data=?,result_hash=? WHERE id=? AND account=? AND project=?').run(take.jobId ?? null, take.status, JSON.stringify(take), coverHash(take), id, account, project)
      return take
    },
    byJob(jobId) { return db.prepare('SELECT account,project,id FROM vc_take WHERE job_id=?').all(jobId) },
    extraction(account, project, id) { canvasOf(account, project); return readState('vc_extraction', account, project, id) },
    addExtraction(account, project, item) { canvasOf(account, project); insertExtraction.run(item.id, project, account, JSON.stringify(item)); return item },
    setExtraction(account, project, id, patch) {
      const item = { ...this.extraction(account, project, id), ...patch }
      db.prepare('UPDATE vc_extraction SET data=? WHERE id=? AND account=? AND project=?').run(JSON.stringify(item), id, account, project)
      return item
    },
    exportJob(account, project, id) { canvasOf(account, project); return readState('vc_export', account, project, id) },
    addExport(account, project, item) { canvasOf(account, project); insertExport.run(item.id, project, account, JSON.stringify(item)); return item },
    setExport(account, project, id, patch) {
      const item = { ...this.exportJob(account, project, id), ...patch }
      db.prepare('UPDATE vc_export SET data=? WHERE id=? AND account=? AND project=?').run(JSON.stringify(item), id, account, project)
      return item
    },
    chain(account, project, id) { canvasOf(account, project); return readState('vc_chain', account, project, id) },
    addChain(account, project, item) { canvasOf(account, project); insertChain.run(item.id, project, account, JSON.stringify(item)); return item },
    setChain(account, project, id, patch) {
      const item = { ...this.chain(account, project, id), ...patch }
      db.prepare('UPDATE vc_chain SET data=? WHERE id=? AND account=? AND project=?').run(JSON.stringify(item), id, account, project)
      return item
    },
    removeChain(account, project, id) { db.prepare('DELETE FROM vc_chain WHERE id=? AND account=? AND project=?').run(id, account, project) },
    request(account, project, id, fingerprint) {
      const row = db.prepare('SELECT * FROM vc_run_request WHERE account=? AND project=? AND request_id=?').get(account, project, id)
      if (row && row.fingerprint !== fingerprint) fail('같은 requestId에 다른 입력을 넣을 수 없어.', 409)
      return row ? this.take(account, project, row.take_id) : null
    },
    requestTake(account, project, id) {
      const row = db.prepare('SELECT take_id FROM vc_run_request WHERE account=? AND project=? AND request_id=?').get(account, project, id)
      return row ? this.take(account, project, row.take_id) : null
    },
    linkRequest(account, project, id, fingerprint, takeId) {
      this.request(account, project, id, fingerprint)
      db.prepare('INSERT OR IGNORE INTO vc_run_request VALUES(?,?,?,?,?)').run(account, project, id, fingerprint, takeId)
    },
    upload(account, key) {
      const row = db.prepare('SELECT data FROM vc_upload WHERE account=? AND source_key=?').get(account, key)
      return row ? JSON.parse(row.data) : null
    },
    cacheUpload(account, key, ref) { db.prepare('INSERT OR REPLACE INTO vc_upload VALUES(?,?,?)').run(account, key, JSON.stringify(ref)) },
    linkUpload(account, takeId, key) {
      // Shared takes retain the actual asset, independently of the source cache key.
      db.prepare('INSERT OR IGNORE INTO vc_take_upload VALUES(?,?,?)').run(takeId, account, this.upload(account, key).id)
    },
    // Uploaded inputs anywhere in the request: a Director value's assets or a generic workflow's image fields.
    retainUploads(account, take) {
      const refs = [], walk = value => {
        if (Array.isArray(value)) value.forEach(walk)
        else if (value && typeof value === 'object') { if (value.__ref === 'workflow-input-asset') refs.push(value); else Object.values(value).forEach(walk) }
      }
      walk(take.request?.inputs)
      for (const ref of refs) db.prepare('INSERT OR IGNORE INTO vc_take_upload VALUES(?,?,?)').run(take.id, account, ref.id)
    },
    // Without a take this lists uploads already left unreferenced, e.g. by a deleted project.
    releaseCandidates(account, takeId = null) {
      if (takeId) db.prepare('DELETE FROM vc_take_upload WHERE take_id=? AND account=?').run(takeId, account)
      const rows = db.prepare("SELECT source_key,data FROM vc_upload u WHERE account=? AND NOT EXISTS (SELECT 1 FROM vc_take_upload r WHERE r.account=u.account AND r.source_key=json_extract(u.data,'$.id'))").all(account)
      const candidates = new Map()
      for (const row of rows) {
        const ref = JSON.parse(row.data)
        if (!candidates.has(ref.id)) candidates.set(ref.id, { keys: [], ref })
        candidates.get(ref.id).keys.push(row.source_key)
      }
      return [...candidates.values()]
    },
    removeUpload(account, keys) { for (const key of keys) db.prepare('DELETE FROM vc_upload WHERE account=? AND source_key=?').run(account, key) },
  }
}
