import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { parseRequestedJson } from '../services/llmProviderService'

const backendRoot = path.resolve(__dirname, '..')

function source(relativePath: string) {
  return fs.readFileSync(path.join(backendRoot, relativePath), 'utf8')
}

function verifyJsonResponseParsing() {
  assert.deepEqual(
    parseRequestedJson('{"ok":true}', 'json'),
    { value: { ok: true }, strategy: 'strict' },
    'strict JSON responses should parse directly',
  )

  assert.deepEqual(
    parseRequestedJson('```json\n{"ok":true}\n```', 'json'),
    { value: { ok: true }, strategy: 'markdown_fence' },
    'markdown fenced JSON responses should be accepted',
  )

  assert.deepEqual(
    parseRequestedJson('Here is the JSON:\n{"ok":true,"items":[1,2]}', 'json'),
    { value: { ok: true, items: [1, 2] }, strategy: 'embedded_json' },
    'JSON embedded in model prose should be recovered',
  )

  assert.deepEqual(
    parseRequestedJson('Candidate [not json], final:\n{"ok":true}', 'json'),
    { value: { ok: true }, strategy: 'embedded_json' },
    'embedded JSON recovery should skip non-JSON bracketed prose',
  )

  assert.deepEqual(
    parseRequestedJson('{"tag":"character \\(series\\)","escaped":"quote: \\" ok"}', 'json'),
    { value: { tag: 'character \\(series\\)', escaped: 'quote: " ok' }, strategy: 'invalid_escape_repaired' },
    'JSON responses with model-style invalid string escapes should be repaired',
  )

  assert.deepEqual(
    parseRequestedJson('Result:\n{"tag":"name \\[variant\\]"}', 'json'),
    { value: { tag: 'name \\[variant\\]' }, strategy: 'invalid_escape_repaired' },
    'embedded JSON recovery should repair invalid string escapes',
  )

  assert.deepEqual(
    parseRequestedJson('plain text', 'text'),
    { value: null, strategy: 'none' },
    'text response mode should not force JSON parsing',
  )

  assert.throws(
    () => parseRequestedJson('not-json', 'json'),
    /LLM 응답이 JSON 형식이 아니야/,
    'invalid JSON responses should still fail clearly',
  )
}

function verifyDebugLoggingContracts() {
  const llmNodeSource = source('services/graph-workflow-executor/system-llm-operations.ts')
  assert(
    llmNodeSource.includes('onDebugEvent')
      && llmNodeSource.includes('llm_provider_response')
      && llmNodeSource.includes('llm_json_parse_failed'),
    'LLM graph node should persist provider responses and JSON parse failures in debug logs',
  )

  const providerSource = source('services/llmProviderService.ts')
  assert(
    providerSource.includes('json_parse_strategy')
      && providerSource.includes('markdown_fence')
      && providerSource.includes('embedded_json')
      && providerSource.includes('invalid_escape_repaired'),
    'LLM provider metadata should record JSON parse strategy',
  )

  const graphExecutorSource = source('services/graphWorkflowExecutor.ts')
  assert(
    graphExecutorSource.includes('GraphExecutionNoRunnableNodesError')
      && graphExecutorSource.includes('blockedDependencies')
      && graphExecutorSource.includes('always: error instanceof GraphExecutionNoRunnableNodesError'),
    'graph executor should persist no-runnable dependency diagnostics even outside debug mode',
  )
}

verifyJsonResponseParsing()
verifyDebugLoggingContracts()

console.log('LLM JSON response contracts verified.')
