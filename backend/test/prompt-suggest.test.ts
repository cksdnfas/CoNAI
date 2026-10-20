import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

/** Prompt editor suggestions: tiered matching of my prompts, "used together" terms, and per-account editor settings. */

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-prompt-suggest-'))
process.env.RUNTIME_BASE_PATH = root
for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
  process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
}

async function boot() {
  const authModule = await import('../src/database/authDb')
  authModule.initializeAuthDb()
  const main = await import('../src/database/init')
  await main.initializeDatabase()
  const user = await import('../src/database/userSettingsDb')
  user.initializeUserSettingsDb()
  return { db: main.db }
}

const hash = (n: number) => n.toString(16).padStart(48, '0')

test('my prompts rank exact, then prefix, then contains, each by usage', async () => {
  const { db } = await boot()
  const { PromptSuggestService } = await import('../src/services/promptSuggestService')
  const insert = db.prepare('INSERT INTO prompt_collection (prompt, usage_count) VALUES (?, ?)')
  insert.run('long hair', 50)
  insert.run('hair ornament', 5)
  insert.run('hair', 1)
  insert.run('hairband', 9)
  insert.run('unused hair', 0)

  const result = await PromptSuggestService.suggest({ query: 'hair', type: 'positive', limit: 10, relatedTagLimit: 0, context: [] })
  assert.deepEqual(result.prompts.map((item) => item.prompt), ['hair', 'hairband', 'hair ornament', 'long hair'])
  assert.deepEqual(result.tags, [], 'no Danbooru database installed in the test runtime')
})

test('used-together terms come from recent images that really carry the context term', async () => {
  const { db } = await boot()
  const { PromptSuggestService } = await import('../src/services/promptSuggestService')
  const insert = db.prepare('INSERT INTO media_metadata (composite_hash, prompt) VALUES (?, ?)')
  insert.run(hash(1), '1girl, blue hair, smile, school uniform')
  insert.run(hash(2), '1girl, blue_hair, school uniform, __tag:pose__')
  insert.run(hash(3), '1girl, blue hair, smile')
  // "blue hairband" contains the substring but not the term: must not count.
  insert.run(hash(4), 'blue hairband, maid, maid, maid')
  insert.run(hash(5), 'blue hairband, maid')

  const related = PromptSuggestService.relatedTerms(['blue hair'])
  assert.deepEqual(related, [
    { term: '1girl', count: 3 },
    { term: 'school uniform', count: 2 },
    { term: 'smile', count: 2 },
  ])
})

test('editor settings are stored per account and reject non-objects', async () => {
  await boot()
  const { PromptEditorSettingsService, PromptEditorSettingsError } = await import('../src/services/promptEditorSettingsService')
  assert.equal(PromptEditorSettingsService.read(7), null)
  PromptEditorSettingsService.write(7, { tagUnderscores: true })
  PromptEditorSettingsService.write(null, { tagUnderscores: false })
  assert.deepEqual(PromptEditorSettingsService.read(7), { tagUnderscores: true })
  assert.deepEqual(PromptEditorSettingsService.read(null), { tagUnderscores: false })
  assert.throws(() => PromptEditorSettingsService.write(7, ['x']), PromptEditorSettingsError)
})

test('prompt collection search has global pages, bounded inputs and one typed group lookup', async (t) => {
  const { db } = await boot()
  const { PAGINATION } = await import('@conai/shared')
  const { PromptCollectionModel } = await import('../src/models/PromptCollection')
  const { PromptCollectionQueryService } = await import('../src/services/promptCollectionQueryService')
  const fixtures: Array<{ id: number; prompt: string; usage_count: number; created_at: string; type: 'positive' | 'negative' }> = []
  const names = ['paging-Z', 'paging-ä', 'paging-a', 'paging-z', 'paging-Á', 'paging-A']
  for (const type of ['positive', 'negative'] as const) {
    const table = type === 'positive' ? 'prompt_collection' : 'negative_prompt_collection'
    const groupTable = type === 'positive' ? 'prompt_groups' : 'negative_prompt_groups'
    db.prepare(`INSERT INTO ${groupTable} (id, group_name) VALUES (?, ?)`).run(90001, `${type} paging group`)
    const insert = db.prepare(`INSERT INTO ${table} (prompt, usage_count, created_at, group_id, synonyms) VALUES (?, ?, ?, ?, ?)`)
    names.forEach((prompt, index) => {
      // Four rows share each usage/date key, spanning the three-row page boundaries.
      const usage_count = Math.floor(index / 2) + 1
      const created_at = `2026-01-${String(13 - usage_count).padStart(2, '0')} 00:00:00`
      const id = Number(insert.run(prompt, usage_count, created_at, [90001, 90001, null, 0, 90002, 90001][index], '["paging synonym"]').lastInsertRowid)
      fixtures.push({ id, prompt, usage_count, created_at, type })
    })
  }
  // Auto prompts must not leak into "both".
  db.prepare('INSERT INTO auto_prompt_collection (prompt, usage_count) VALUES (?, ?)').run('paging-auto', 999)

  for (const sortBy of ['usage_count', 'created_at', 'prompt'] as const) {
    for (const sortOrder of ['ASC', 'DESC'] as const) {
      const direction = sortOrder === 'ASC' ? 1 : -1
      const expected = [...fixtures].sort((a, b) => {
        const primaryOrder = direction * (sortBy === 'usage_count'
          ? a.usage_count - b.usage_count
          : sortBy === 'prompt' ? a.prompt.localeCompare(b.prompt)
            : a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0)
        return primaryOrder || (sortBy === 'prompt' ? 0 : a.type.localeCompare(b.type) || a.id - b.id)
      })
      const actual = []
      for (let page = 1; page <= 5; page++) {
        const result = await PromptCollectionQueryService.searchPrompts('paging', 'both', page, 3, sortBy, sortOrder)
        assert.equal(result.total, fixtures.length)
        assert.deepEqual(result.prompts.map(({ id, prompt, type }) => ({ id, prompt, type })),
          expected.slice((page - 1) * 3, page * 3).map(({ id, prompt, type }) => ({ id, prompt, type })))
        actual.push(...result.prompts)
      }
      assert.equal(actual.length, fixtures.length, 'no missing or repeated rows across pages, including page 3+')
    }
  }
  const single = PromptCollectionModel.searchPrompts('paging', 1, 20, 'prompt', 'ASC')
  assert.deepEqual(single.prompts.map(({ prompt }) => prompt), [...names].sort(),
    'single-type searches retain SQLite BINARY collation, not localeCompare')

  const queries: string[] = []
  const prepare = db.prepare.bind(db)
  const mock = t.mock.method(db, 'prepare', (sql: string) => { queries.push(sql); return prepare(sql) })
  let enriched
  try {
    enriched = await PromptCollectionQueryService.searchPromptsWithGroups('paging', 'both', 1, 20)
    assert.equal(queries.length, 3, 'one count, one page and one batched group query')
    assert.equal(queries.filter(sql => sql.includes('prompt_groups')).length, 1)
  } finally {
    mock.mock.restore()
  }
  for (const prompt of enriched.prompts) {
    const table = prompt.type === 'positive' ? 'prompt_groups' : 'negative_prompt_groups'
    const expectedGroup = prompt.group_id === null || prompt.group_id === 0
      ? { id: 0, group_name: 'Unclassified' }
      : db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(prompt.group_id) ?? null
    assert.deepEqual(prompt.group_info, expectedGroup)
    assert.deepEqual(prompt.synonyms, ['paging synonym'])
  }

  for (const type of ['positive', 'negative', 'auto'] as const) {
    const table = type === 'positive' ? 'prompt_collection' : type === 'negative' ? 'negative_prompt_collection' : 'auto_prompt_collection'
    const insert = db.prepare(`INSERT INTO ${table} (prompt) VALUES (?)`)
    db.transaction(() => {
      for (let index = 0; index < PAGINATION.MAX_LIMIT + 1; index++) insert.run(`bounded-${index}`)
    })()
    const search = type === 'positive' ? PromptCollectionModel.searchPrompts.bind(PromptCollectionModel)
      : type === 'negative' ? PromptCollectionModel.searchNegativePrompts.bind(PromptCollectionModel)
        : PromptCollectionModel.searchAutoPrompts.bind(PromptCollectionModel)
    const result = search('bounded', 1, PAGINATION.MAX_LIMIT + 1)
    assert.equal(result.prompts.length, PAGINATION.MAX_LIMIT)
    assert.equal(result.total, PAGINATION.MAX_LIMIT + 1)
    for (const invalid of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => search('bounded', invalid, 20), RangeError)
      assert.throws(() => search('bounded', 1, invalid), RangeError)
    }
  }

  const { default: express } = await import('express')
  const app = express()
  app.use('/prompts', (await import('../src/routes/promptCollection')).default)
  app.use('/prompt-groups', (await import('../src/routes/promptGroups')).default)
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
  const port = (server.address() as { port: number }).port
  for (const query of ['page=0', 'page=-1', 'page=1.5', 'page=2abc', 'page=', 'page=1&page=2',
    'page=9007199254740991', 'limit=0', 'limit=-1', 'limit=1.5', 'limit=2abc', 'limit=Infinity',
    'limit=1&limit=2', `limit=${PAGINATION.MAX_LIMIT + 1}`]) {
    const response = await fetch(`http://127.0.0.1:${port}/prompts/search?${query}`)
    assert.equal(response.status, 400, query)
    assert.equal((await response.json()).success, false, query)
  }
  const response = await fetch(`http://127.0.0.1:${port}/prompts/search?q=paging&page=3&limit=3&sortBy=usage_count&sortOrder=DESC`)
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.deepEqual(payload.pagination, { page: 3, limit: 3, total: fixtures.length, totalPages: 4 })
  assert.deepEqual(payload.data.map((prompt: { usage_count: number }) => prompt.usage_count), [2, 2, 1])

  const groupPages = []
  for (const page of [1, 2]) {
    const response = await fetch(`http://127.0.0.1:${port}/prompt-groups/0/prompts?q=bounded&type=legacy-unknown&limit=1000&page=${page}`)
    assert.equal(response.status, 200, 'legacy plugins retain oversized-limit and unknown-type compatibility')
    const { data } = await response.json()
    assert.equal(data.pagination.limit, 100)
    assert.equal(data.pagination.total, PAGINATION.MAX_LIMIT + 1)
    assert.equal(data.pagination.totalPages, 2)
    groupPages.push(...data.prompts)
  }
  const expectedGroupIds = (db.prepare("SELECT id FROM prompt_collection WHERE group_id IS NULL AND prompt LIKE 'bounded%'").all() as Array<{ id: number }>).map(row => row.id).sort((a, b) => a - b)
  assert.deepEqual(groupPages.map(prompt => prompt.id).sort((a, b) => a - b), expectedGroupIds,
    'clamped offsets cover the positive collection without duplicates or skipped rows')
})
