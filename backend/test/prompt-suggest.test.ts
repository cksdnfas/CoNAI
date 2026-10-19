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

  const result = PromptSuggestService.suggest({ query: 'hair', type: 'positive', limit: 10, relatedTagLimit: 0, context: [] })
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
