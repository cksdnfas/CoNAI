// A bounded discovery index only. Project documents remain in the native shared file store.
export function projectCatalog(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS projects (
    file_id TEXT PRIMARY KEY, title TEXT NOT NULL, stage TEXT NOT NULL,
    revision TEXT NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS projects_updated ON projects(updated_at DESC, file_id);
  CREATE INDEX IF NOT EXISTS projects_stage ON projects(stage, updated_at DESC, file_id);
  CREATE TABLE IF NOT EXISTS outputs (
    job_id TEXT PRIMARY KEY, file_id TEXT NOT NULL, account_key TEXT NOT NULL,
    revision TEXT NOT NULL, preview INTEGER NOT NULL, status TEXT NOT NULL,
    hash TEXT, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS outputs_project ON outputs(file_id, account_key, created_at DESC);`)
  // 1.2.0: the first visual source, shown as the project's thumbnail in the list.
  if (!db.prepare('PRAGMA table_info(projects)').all().some(column => column.name === 'cover')) db.exec('ALTER TABLE projects ADD COLUMN cover TEXT')
  return {
    forgetMissing(fileId) {
      db.transaction(() => {
        db.prepare('DELETE FROM projects WHERE file_id=?').run(fileId)
        db.prepare('DELETE FROM outputs WHERE file_id=?').run(fileId)
      })()
    },
    remember({ fileId, revision, project }, updatedAt = Date.now()) {
      db.prepare(`INSERT INTO projects(file_id,title,stage,revision,updated_at,cover) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(file_id) DO UPDATE SET title=excluded.title,stage=excluded.stage,revision=excluded.revision,cover=excluded.cover,
          updated_at=CASE WHEN projects.revision != excluded.revision THEN excluded.updated_at ELSE projects.updated_at END
        WHERE projects.revision != excluded.revision OR projects.cover IS NOT excluded.cover`).run(fileId, project.title, project.stage ?? 'draft', revision, updatedAt, cover(project))
    },
    list({ query = '', stage = 'active', offset = 0 } = {}) {
      if (typeof query !== 'string' || query.length > 100 || !['active', 'all', 'draft', 'completed', 'archived'].includes(stage)
        || !Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) throw new Error('프로젝트 검색 조건을 확인해줘.')
      const filter = `title LIKE ? ESCAPE '\\' AND (? = 'all' OR (? = 'active' AND stage != 'archived') OR stage = ?)`
      const args = [`%${query.trim().replace(/[\\%_]/g, c => `\\${c}`)}%`, stage, stage, stage]
      const total = db.prepare(`SELECT count(*) AS n FROM projects WHERE ${filter}`).get(...args).n
      const items = db.prepare(`SELECT file_id AS fileId,title,stage,revision,updated_at AS updatedAt,cover FROM projects WHERE ${filter}
        ORDER BY updated_at DESC,file_id LIMIT 20 OFFSET ?`).all(...args, offset)
      return { items, total, offset, nextOffset: offset + items.length < total ? offset + 20 : null }
    },
    started(input, jobId, account, status = 'queued') {
      db.prepare('INSERT INTO outputs VALUES (?, ?, ?, ?, ?, ?, NULL, ?) ON CONFLICT(job_id) DO NOTHING')
        .run(jobId, input.fileId, accountKey(account), input.revision, input.preview ? 1 : 0, status, Date.now())
      db.prepare(`DELETE FROM outputs WHERE file_id=? AND account_key=? AND job_id NOT IN
        (SELECT job_id FROM outputs WHERE file_id=? AND account_key=? ORDER BY created_at DESC,job_id DESC LIMIT 20)`)
        .run(input.fileId, accountKey(account), input.fileId, accountKey(account))
    },
    finished(jobId, status, hash = null) {
      db.prepare('UPDATE outputs SET status=?,hash=COALESCE(?,hash) WHERE job_id=?').run(status, hash, jobId)
    },
    history(fileId, account) {
      return db.prepare(`SELECT job_id AS jobId,revision,preview,status,hash AS compositeHash,created_at AS createdAt
        FROM outputs WHERE file_id=? AND account_key=? ORDER BY created_at DESC,job_id DESC LIMIT 20`).all(fileId, accountKey(account))
    },
  }
}
function cover(project) {
  const reference = project.assets?.find(asset => /^(image|video)\//.test(asset.mimeType ?? ''))?.reference
  return reference?.source === 'library' ? `library:${reference.compositeHash}` : reference?.source === 'files' ? `files:${reference.fileId}` : null
}
function accountKey(account) {
  if (!account) throw new Error('로그인이 필요해.')
  return account.id === null ? 'bootstrap' : `account:${account.id}`
}
