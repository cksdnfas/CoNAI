import assert from 'node:assert/strict'
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
