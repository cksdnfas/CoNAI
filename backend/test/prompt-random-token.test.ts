import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  convertLegacyPromptSyntax,
  findPromptRandomTokens,
  parsePromptRandomTokenBody,
  serializePromptRandomToken,
} from '@conai/shared'
import { resolvePromptGroupPickCount } from '../src/services/danbooruBrowser/promptGroupSyntax'

test('new token syntax parses source, name, pick count and usage bounds', () => {
  assert.deepEqual(parsePromptRandomTokenBody('tag:hair_color|1-2|1k+'), {
    source: 'tag', name: 'hair_color', pick: { min: 1, max: 2 }, usage: { min: 1000 }, unprefixed: false, legacy: false, hasOptions: true,
  })
  assert.deepEqual(parsePromptRandomTokenBody('my:의상세트|3|100-'), {
    source: 'my', name: '의상세트', pick: { min: 3, max: 3 }, usage: { max: 100 }, unprefixed: false, legacy: false, hasOptions: true,
  })
  assert.deepEqual(parsePromptRandomTokenBody('pose'), {
    source: 'wildcard', name: 'pose', pick: { min: 1, max: 1 }, usage: {}, unprefixed: true, legacy: false, hasOptions: false,
  })
})

test('legacy modifiers still parse and malformed options are rejected', () => {
  assert.deepEqual(parsePromptRandomTokenBody('hair_color [0~3] <-100>'), {
    source: 'wildcard', name: 'hair_color', pick: { min: 0, max: 3 }, usage: { max: 100 }, unprefixed: true, legacy: true, hasOptions: true,
  })
  assert.equal(parsePromptRandomTokenBody('hair_color|bad'), null)
  assert.equal(parsePromptRandomTokenBody('tag:'), null)
  assert.deepEqual(parsePromptRandomTokenBody('tag:x|99')?.pick, { min: 50, max: 50 })
})

test('serialize writes the canonical form and round-trips', () => {
  const spec = { source: 'tag' as const, name: 'hair_color', pick: { min: 1, max: 2 }, usage: { min: 1500 } }
  const text = serializePromptRandomToken(spec)
  assert.equal(text, '__tag:hair_color|1-2|1.5k+__')
  assert.deepEqual(findPromptRandomTokens(text)[0]?.usage, { min: 1500 })
  // 와일드카드는 개수만 쓰고 사용량은 버린다
  assert.equal(serializePromptRandomToken({ source: 'wildcard', name: 'pose', pick: { min: 2, max: 3 }, usage: { min: 10 } }), '__pose|2-3__')
  assert.equal(serializePromptRandomToken({ source: 'wildcard', name: 'pose', pick: { min: 1, max: 1 }, usage: {} }), '__pose__')
})

test('legacy conversion leaves a wildcard pick count (`__pose|2__`) as a wildcard', () => {
  const result = convertLegacyPromptSyntax('__pose|2__, __hair|2__', (name) => name === 'pose')
  assert.equal(result.value, '__pose|2__, __tag:hair|2__')
})

test('token scan finds new and ++legacy++ tokens in order and skips a__b text', () => {
  const tokens = findPromptRandomTokens('a__b, ++outfit++, __tag:hair__, __pose__')
  assert.deepEqual(tokens.map((token) => [token.raw, token.source]), [['++outfit++', 'wildcard'], ['__tag:hair__', 'tag'], ['__pose__', 'wildcard']])
})

test('legacy conversion keeps meaning: wildcards stay, other unprefixed groups become tag groups', () => {
  const result = convertLegacyPromptSyntax('++outfit++, __hair_color [1~2] <1k>__, __pose__, __eyes__', (name) => name === 'pose' || name === 'outfit')
  assert.equal(result.value, '__outfit__, __tag:hair_color|1-2|1k+__, __pose__, __tag:eyes__')
  assert.equal(result.count, 3)
})

test('pick count stays inside the requested range', () => {
  for (let index = 0; index < 50; index += 1) {
    const count = resolvePromptGroupPickCount({ min: 1, max: 3 })
    assert.ok(count >= 1 && count <= 3)
  }
  assert.equal(resolvePromptGroupPickCount({ min: 2, max: 2 }), 2)
})

test('wildcard previews preserve weighted nested expansion with bounded request-local queries', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-wildcard-resolution-'))
  process.env.RUNTIME_BASE_PATH = root
  for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
    process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
  }
  const user = await import('../src/database/userSettingsDb')
  user.initializeUserSettingsDb()
  t.after(() => user.closeUserSettingsDb())
  const db = user.getUserSettingsDb()
  const { WildcardService } = await import('../src/services/wildcardService')
  const { WildcardModel } = await import('../src/models/Wildcard')
  const insert = db.prepare('INSERT INTO wildcards (id, name, parent_id, include_children, only_children, type, chain_option) VALUES (?, ?, ?, ?, ?, ?, ?)')
  const item = db.prepare('INSERT INTO wildcard_items (wildcard_id, tool, content, weight, order_index) VALUES (?, ?, ?, ?, ?)')
  insert.run(1, 'zoo', null, 0, 1, 'wildcard', 'replace')
  insert.run(2, 'A-child', 1, 1, 0, 'wildcard', 'replace')
  insert.run(3, 'a-grand', 2, 0, 0, 'wildcard', 'replace')
  insert.run(4, 'B-child', 1, 0, 0, 'wildcard', 'replace')
  insert.run(5, 'hidden', 4, 0, 0, 'wildcard', 'replace')
  insert.run(6, 'leaf', null, 0, 0, 'wildcard', 'replace')
  insert.run(7, 'appendchain', null, 0, 0, 'chain', 'append')
  insert.run(8, 'replacechain', null, 0, 0, 'chain', 'replace')
  insert.run(9, 'direct', null, 0, 0, 'wildcard', 'replace')
  item.run(1, 'general', 'excluded', 100, 0)
  item.run(2, 'general', 'alpha', 1, 0)
  item.run(3, 'general', '++leaf++', 3, 0)
  item.run(4, 'general', 'beta', 1, 0)
  item.run(5, 'general', 'hidden', 100, 0)
  item.run(6, 'general', '(tone, 0.5~1.0, 0.5), (focus, 0.1, 0.9)', 1, 0)
  item.run(7, 'general', '++leaf++', 1, 0)
  item.run(8, 'general', '++leaf++', 1, 0)
  item.run(9, 'general', 'one', 1, 0)
  item.run(9, 'general', 'two', 3, 1)
  item.run(9, 'general', 'zero', 0, 2)
  item.run(9, 'nai', 'nai-only', 1, 3)
  item.run(9, 'comfyui', 'comfy-only', 1, 4)
  for (let index = 10; index < 210; index += 1) {
    insert.run(index, `unrelated-${index}`, null, 0, 0, 'wildcard', 'replace')
    item.run(index, 'general', 'not referenced', 1, 0)
  }

  const queries: string[] = []
  const loadedIds: number[] = []
  const prepare = db.prepare.bind(db)
  t.mock.method(db, 'prepare', (sql: string) => { queries.push(sql); return prepare(sql) })
  const withItems = WildcardModel.withItems.bind(WildcardModel)
  t.mock.method(WildcardModel, 'withItems', (records, itemIds) => {
    loadedIds.push(...records.map(record => record.id))
    return withItems(records, itemIds)
  })
  const random = t.mock.method(Math, 'random', () => 0.75)
  const text = 'appendchain, replacechain, __zoo__, __direct|2__, ++leaf++'
  const pair = '(tone:1), (focus:0.9)'
  const expected = `appendchain, ${pair}, ${pair}, ${pair}, two, zero, ${pair}`
  const results = WildcardService.parseMultiple(text, 'general', 5)
  assert.deepEqual(results, Array(5).fill(expected))
  assert.equal(random.mock.callCount(), 85, 'loading must not consume or reorder random draws')
  assert.deepEqual(loadedIds.toSorted((a, b) => a - b), [1, 2, 3, 4, 6, 7, 8, 9],
    'load each reachable wildcard once, excluding unrelated rows and descendants behind disabled include_children')
  t.diagnostic(`209 wildcards, five expansions: ${queries.length} queries`)
  assert.ok(queries.length <= 5, `expected at most five queries, got ${queries.length}`)

  queries.length = 0
  const resolver = WildcardService.createResolver()
  assert.equal(WildcardService.parseWildcards(text, 'general', 'positive', resolver), expected)
  assert.equal(WildcardService.parseWildcards(text, 'nai', 'positive', resolver), expected.replace('two, zero', 'nai-only'))
  assert.equal(WildcardService.parseWildcards(text, 'comfyui', 'positive', resolver), expected.replace('two, zero', 'comfy-only'))
  t.diagnostic(`209 wildcards, three tool expansions: ${queries.length} queries`)
  assert.ok(queries.length <= 7, `shared tool expansions must stay bounded, got ${queries.length}`)
  assert.equal(random.mock.callCount(), 134, 'tool expansions retain their independent random selections')

  queries.length = 0
  assert.deepEqual(WildcardService.parseMultiple('__zoo__', 'codex', 5), Array(5).fill(pair))
  t.diagnostic(`209 wildcards, five expansions with a lazily discovered nested reference: ${queries.length} queries`)
  assert.ok(queries.length <= 5, `nested references must be cached for the request, got ${queries.length}`)
  assert.equal(random.mock.callCount(), 154)
})
