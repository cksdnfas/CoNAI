// Server module (plugins/README.md, "Server modules"): prompt snippets per account, the "태그 정리" button next to
// Generate, and a per-account tally of finished generation jobs from the generation.queued / generation.finished hooks.

/** Comma tags trimmed, empty ones dropped, repeats (ignoring case) kept once. */
export function tidyTags(text) {
  const seen = new Set()
  const tags = []
  for (const raw of String(text).split(',')) {
    const tag = raw.replace(/\s+/g, ' ').trim()
    const key = tag.toLowerCase()
    if (!tag || seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
  }
  return tags.join(', ')
}

export function activate(conai) {
  conai.db.exec(`CREATE TABLE IF NOT EXISTS snippets (
    id INTEGER PRIMARY KEY,
    account_id INTEGER,
    text TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS jobs (
    job_id INTEGER PRIMARY KEY,
    account_id INTEGER,
    service TEXT NOT NULL,
    status TEXT NOT NULL,
    images INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`)
  const listSnippets = conai.db.prepare('SELECT id, text FROM snippets WHERE account_id IS ? ORDER BY id')
  const addSnippet = conai.db.prepare('INSERT INTO snippets (account_id, text) VALUES (?, ?)')
  const removeSnippet = conai.db.prepare('DELETE FROM snippets WHERE id = ? AND account_id IS ?')
  const saveJob = conai.db.prepare(`INSERT INTO jobs (job_id, account_id, service, status, images) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(job_id) DO UPDATE SET status = excluded.status, images = excluded.images, updated_at = CURRENT_TIMESTAMP`)
  const pruneJobs = conai.db.prepare('DELETE FROM jobs WHERE job_id NOT IN (SELECT job_id FROM jobs ORDER BY job_id DESC LIMIT 500)')
  const recentJobs = conai.db.prepare('SELECT job_id AS jobId, service, status, images FROM jobs WHERE account_id IS ? ORDER BY job_id DESC LIMIT 20')

  conai.hooks.on('generation.action', ({ action, fields }) => {
    if (action !== 'tidy') throw new Error(`모르는 버튼이야: ${action}`)
    const fill = {}
    for (const field of fields) {
      if (field.type !== 'text' || typeof field.value !== 'string' || !/prompt/i.test(field.id)) continue
      const tidy = tidyTags(field.value)
      if (tidy !== field.value) fill[field.id] = tidy
    }
    const count = Object.keys(fill).length
    return count ? { message: `프롬프트 ${count}개를 정리했어.`, fill } : { message: '정리할 게 없어.' }
  })
  conai.hooks.on('generation.queued', ({ jobId, service, status, account }) => {
    saveJob.run(jobId, account?.id ?? null, service, status, 0)
    pruneJobs.run()
  })
  conai.hooks.on('generation.finished', ({ jobId, service, status, history, account }) => {
    saveJob.run(jobId, account?.id ?? null, service, status, history.length)
  })

  conai.onRequest(({ body, account }) => {
    const owner = account?.id ?? null
    const op = body?.op
    if (op === 'snippets') return { snippets: listSnippets.all(owner) }
    if (op === 'add') {
      const text = String(body.text ?? '').trim().slice(0, 500)
      if (!text) throw new Error('조각 내용을 써줘.')
      addSnippet.run(owner, text)
      return { snippets: listSnippets.all(owner) }
    }
    if (op === 'remove') {
      removeSnippet.run(body.id, owner)
      return { snippets: listSnippets.all(owner) }
    }
    if (op === 'jobs') return { jobs: recentJobs.all(owner) }
    throw new Error(`알 수 없는 요청: ${op}`)
  })
}
