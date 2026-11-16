import { randomUUID, createHash } from 'node:crypto'
import { canonical, expected, fail, newProject, projectName, sequenceOf } from './domain.mjs'

export const workflowSourceKey = (ref, fingerprint) => createHash('sha256').update(canonical({ ref, fingerprint })).digest('hex')

const encodeCanvas = project => {
  const { takes, extractions, exports, chains, lastProfileId, ...canvas } = structuredClone(project)
  for (const node of canvas.nodes) delete node.data.check
  return JSON.stringify(canvas)
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
    if (!has('vc_project', 'last_profile')) db.exec('ALTER TABLE vc_project ADD COLUMN last_profile TEXT')
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
  const insertTake = db.prepare('INSERT INTO vc_take(id,project,account,job_id,status,data,result_hash) VALUES(?,?,?,?,?,?,?)')
  const insertExtraction = db.prepare('INSERT INTO vc_extraction(id,project,account,data) VALUES(?,?,?,?)')
  const insertExport = db.prepare('INSERT INTO vc_export(id,project,account,data) VALUES(?,?,?,?)')
  const insertChain = db.prepare('INSERT INTO vc_chain(id,project,account,data) VALUES(?,?,?,?)')
  const insertProject = db.prepare('INSERT INTO vc_project(id,account,name,revision,data,created,last_profile) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP,?)')
  const load = db.prepare('SELECT data, name, last_profile FROM vc_project WHERE id = ? AND account = ?')
  const loadRow = (account, id) => {
    const row = load.get(id, account)
    if (!row) fail('프로젝트가 없거나 접근할 수 없어.', 404)
    return row
  }
  const canvasOf = (account, id) => JSON.parse(loadRow(account, id).data)
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
    create(account, name, canvas = {}, lastProfile = null) {
      const project = { ...newProject(randomUUID(), name), ...canvas }
      insertProject.run(project.id, account, project.name, project.revision, encodeCanvas(project), lastProfile)
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
    useProfile(account, id, profileId) { db.prepare('UPDATE vc_project SET last_profile=? WHERE id=? AND account=?').run(profileId, id, account) },
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
      project.lastProfileId = row.last_profile
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
