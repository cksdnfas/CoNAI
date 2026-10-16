import './support/testTemp'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LlmJsonTruncatedError, parseRequestedJson } from '../src/services/llmProviderService'

test('a JSON answer cut off mid-list is refused instead of returning its first inner object', () => {
  // The shape of a memory extraction that hit the token cap: the outer object never closes.
  const cut = '{"summary":"흐름","entries":[{"title":"첫 기억","content":"완결된 항목","keys":["a"],"state":"active","sourceIds":[1]},{"title":"둘째","content":"중간에 끊'
  assert.throws(() => parseRequestedJson(cut, 'json'), LlmJsonTruncatedError)
  assert.throws(() => parseRequestedJson('```json\n[{"a":1},{"b":', 'json'), LlmJsonTruncatedError)
})

test('complete JSON, fenced JSON and JSON inside prose still parse', () => {
  assert.deepEqual(parseRequestedJson('{"summary":"ok","entries":[]}', 'json').value, { summary: 'ok', entries: [] })
  assert.deepEqual(parseRequestedJson('```json\n{"a":1}\n```', 'json').value, { a: 1 })
  assert.deepEqual(parseRequestedJson('답이야: {"a":1} 끝', 'json').value, { a: 1 })
  assert.equal(parseRequestedJson('plain text', 'text').value, null)
})
