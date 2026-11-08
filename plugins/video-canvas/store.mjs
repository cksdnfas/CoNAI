import { randomUUID, createHash } from 'node:crypto'
import { canonical, expected, fail, newProject } from './domain.mjs'

export const workflowSourceKey = (ref, fingerprint) => createHash('sha256').update(canonical({ ref, fingerprint })).digest('hex')

const encodeCanvas = project => {
  const { takes, extractions, ...canvas } = structuredClone(project)
  for (const node of canvas.nodes) delete node.data.check
  return JSON.stringify(canvas)
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
  CREATE INDEX IF NOT EXISTS vc_take_upload_source ON vc_take_upload(account,source_key);`)
  const insertTake = db.prepare('INSERT INTO vc_take(id,project,account,job_id,status,data) VALUES(?,?,?,?,?,?)')
  const insertExtraction = db.prepare('INSERT INTO vc_extraction(id,project,account,data) VALUES(?,?,?,?)')
  const load = db.prepare('SELECT data FROM vc_project WHERE id = ? AND account = ?')
  const canvasOf = (account, id) => {
    const row = load.get(id, account)
    if (!row) fail('프로젝트가 없거나 접근할 수 없어.', 404)
    return JSON.parse(row.data)
  }
  const readState = (table, account, project, id) => {
    const row = db.prepare(`SELECT data FROM ${table} WHERE id=? AND account=? AND project=?`).get(id, account, project)
    if (!row) fail('작업이 없거나 접근할 수 없어.', 404)
    return JSON.parse(row.data)
  }
  return {
    list(account, offset = 0) {
      if (!Number.isInteger(offset) || offset < 0) fail('offset이 올바르지 않아.')
      return db.prepare("SELECT id,name,revision,updated,json_array_length(data,'$.nodes') AS nodeCount FROM vc_project WHERE account=? ORDER BY updated DESC,id LIMIT 40 OFFSET ?").all(account, offset)
    },
    create(account, name) {
      const project = newProject(randomUUID(), name)
      db.prepare('INSERT INTO vc_project(id,account,name,revision,data) VALUES(?,?,?,?,?)').run(project.id, account, project.name, project.revision, encodeCanvas(project))
      return project
    },
    get(account, id) {
      const project = canvasOf(account, id)
      project.takes = db.prepare('SELECT data FROM vc_take WHERE account=? AND project=? ORDER BY rowid').all(account, id).map(row => JSON.parse(row.data))
      project.extractions = db.prepare('SELECT data FROM vc_extraction WHERE account=? AND project=? ORDER BY rowid').all(account, id).map(row => JSON.parse(row.data))
      const checks = new Map(db.prepare('SELECT node,data FROM vc_node_check WHERE project=?').all(id).map(row => [row.node, JSON.parse(row.data)]))
      for (const node of project.nodes) if (checks.has(node.id)) node.data.check = checks.get(node.id)
      return project
    },
    save(account, before, next, log = null) {
      return db.transaction(() => {
        expected(canvasOf(account, before.id), before.revision)
        const changed = db.prepare('UPDATE vc_project SET data=?,revision=?,name=?,updated=CURRENT_TIMESTAMP WHERE id=? AND account=? AND revision=?')
          .run(encodeCanvas(next), next.revision, next.name, next.id, account, before.revision)
        if (!changed.changes) fail('409: 캔버스가 바뀌었어. 다시 읽어줘.', 409)
        if (log?.actor === 'assistant') db.prepare('INSERT INTO vc_undo VALUES(?,?,?,?,?,0) ON CONFLICT(project) DO UPDATE SET revision=excluded.revision,before_data=excluded.before_data,operations=excluded.operations,undone=0')
          .run(next.id, account, next.revision, JSON.stringify({ nodes: before.nodes, edges: before.edges }), JSON.stringify(log.ops))
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
    addTake(account, project, take) { canvasOf(account, project); insertTake.run(take.id, project, account, take.jobId ?? null, take.status, JSON.stringify(take)); return take },
    setTake(account, project, id, patch) {
      const take = { ...this.take(account, project, id), ...patch }
      db.prepare('UPDATE vc_take SET job_id=?,status=?,data=? WHERE id=? AND account=? AND project=?').run(take.jobId ?? null, take.status, JSON.stringify(take), id, account, project)
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
    request(account, project, id, fingerprint) {
      const row = db.prepare('SELECT * FROM vc_run_request WHERE account=? AND project=? AND request_id=?').get(account, project, id)
      if (row && row.fingerprint !== fingerprint) fail('같은 requestId에 다른 입력을 넣을 수 없어.', 409)
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
    retainUploads(account, take) {
      const assets = Object.values(take.request?.inputs?.[take.profile.directorFieldId]?.assets ?? {})
      for (const ref of assets) if (ref?.__ref === 'workflow-input-asset') {
        db.prepare('INSERT OR IGNORE INTO vc_take_upload VALUES(?,?,?)').run(take.id, account, ref.id)
      }
    },
    releaseCandidates(account, takeId) {
      db.prepare('DELETE FROM vc_take_upload WHERE take_id=? AND account=?').run(takeId, account)
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
