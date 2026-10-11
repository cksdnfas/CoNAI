import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import { LlmRequestError } from '../src/services/llmRequestRetry'
import {
  classifyRequestFailure,
  getConnectionHealth,
  healthBlocksModel,
  recordProbeResult,
  recordRequestOutcome,
  resetConnectionHealth,
} from '../src/services/codex-chat/connectionHealthState'

test('request failures map to a down reason only when they say something about the connection', () => {
  assert.equal(classifyRequestFailure(new LlmRequestError('no', 401)), 'auth')
  assert.equal(classifyRequestFailure(new LlmRequestError('no', 403)), 'auth')
  assert.equal(classifyRequestFailure(new LlmRequestError('pay', 402)), 'quota')
  assert.equal(classifyRequestFailure(new LlmRequestError('slow down', 429)), 'quota')
  assert.equal(classifyRequestFailure(new LlmRequestError('model', 404)), 'model_missing')
  assert.equal(classifyRequestFailure(new LlmRequestError('gateway', 502)), 'unreachable')
  assert.equal(classifyRequestFailure(Object.assign(new Error('connect'), { code: 'ECONNREFUSED' })), 'unreachable')
  assert.equal(classifyRequestFailure(new TypeError('fetch failed')), 'unreachable')
  assert.equal(classifyRequestFailure(Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' })), 'not_installed')
  // Not about the connection: bad request, server hiccup, cancel, timeout, a stalled stream.
  assert.equal(classifyRequestFailure(new LlmRequestError('bad', 400)), null)
  assert.equal(classifyRequestFailure(new LlmRequestError('oops', 500)), null)
  assert.equal(classifyRequestFailure(Object.assign(new Error('stop'), { name: 'AbortError' })), null)
  assert.equal(classifyRequestFailure(new DOMException('late', 'TimeoutError')), null)
  assert.equal(classifyRequestFailure(new Error('LLM 응답이 너무 오래 멈춰 있어.')), null)
})

test('a failed request holds over a passing probe until a forced recheck or a success', () => {
  resetConnectionHealth()
  const now = 1_000_000
  recordRequestOutcome('strata', 'strata-auto', new LlmRequestError('no', 401), now)
  assert.equal(getConnectionHealth('strata')?.reason, 'auth')

  recordProbeResult('strata', null, { now: now + 1_000 })
  assert.equal(getConnectionHealth('strata')?.down, true, 'a background probe does not hide a recent failure')

  recordProbeResult('strata', null, { now: now + 6 * 60_000 })
  assert.equal(getConnectionHealth('strata')?.down, false, 'the hold ends after a while')

  recordRequestOutcome('strata', 'strata-auto', new LlmRequestError('no', 429), now + 7 * 60_000)
  recordProbeResult('strata', null, { force: true, now: now + 7 * 60_000 + 1 })
  assert.equal(getConnectionHealth('strata')?.down, false, 'a recheck the person asked for wins')

  recordProbeResult('strata', 'unreachable', { now: now + 8 * 60_000 })
  recordRequestOutcome('strata', 'strata-auto', null, now + 8 * 60_000 + 1)
  assert.equal(getConnectionHealth('strata')?.down, false, 'a working request clears it')

  // An unclassified failure leaves the state as it was.
  recordRequestOutcome('strata', 'strata-auto', new LlmRequestError('oops', 500), now + 9 * 60_000)
  assert.equal(getConnectionHealth('strata')?.down, false)
})

test('the free probe reads the model list status without generating anything', async (t) => {
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  const { probeConnection } = await import('../src/services/codex-chat/chatConnectionHealth')
  const hits: string[] = []
  let status = 200
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url} ${req.headers.authorization ?? ''}`)
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end('{"data":[]}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const port = (server.address() as AddressInfo).port
  const providers: Record<string, { provider_type: string; base_url: string | null; is_enabled: boolean }> = {
    openai: { provider_type: 'llm_openai_compatible', base_url: `http://127.0.0.1:${port}/v1/`, is_enabled: true },
    ollama: { provider_type: 'llm_ollama', base_url: `http://127.0.0.1:${port}/v1`, is_enabled: true },
    off: { provider_type: 'llm_openai_compatible', base_url: `http://127.0.0.1:${port}/v1`, is_enabled: false },
    gone: { provider_type: 'llm_openai_compatible', base_url: 'http://127.0.0.1:1/v1', is_enabled: true },
  }
  t.mock.method(ExternalApiProvider, 'findByName', (name: string) => providers[name] ? { provider_name: name, display_name: name, ...providers[name] } : null)
  t.mock.method(ExternalApiProvider, 'getDecryptedKey', (name: string) => name === 'openai' ? 'sk-test' : null)

  assert.equal(await probeConnection('openai'), null)
  assert.deepEqual(hits, ['GET /v1/models Bearer sk-test'])
  assert.equal(await probeConnection('ollama'), null)
  assert.equal(hits[1], 'GET /api/tags ')
  status = 401
  assert.equal(await probeConnection('openai'), 'auth')
  status = 503
  assert.equal(await probeConnection('openai'), 'unreachable')
  status = 404
  assert.equal(await probeConnection('openai'), null, 'a server without a model list still answers')
  assert.equal(await probeConnection('off'), 'disabled')
  assert.equal(await probeConnection('missing'), 'disabled')
  assert.equal(await probeConnection('gone'), 'unreachable')
  assert.equal(hits.every((hit) => hit.startsWith('GET ')), true, 'only GETs, never a completion')
})

test('a missing model only blocks that model', () => {
  resetConnectionHealth()
  recordRequestOutcome('lmstudio', 'qwen-a', new LlmRequestError('model not found', 404))
  const entry = getConnectionHealth('lmstudio')
  assert.equal(healthBlocksModel(entry, 'qwen-a'), true)
  assert.equal(healthBlocksModel(entry, 'qwen-b'), false)
  recordProbeResult('lmstudio', 'unreachable', { force: true })
  assert.equal(healthBlocksModel(getConnectionHealth('lmstudio'), 'qwen-b'), true)
  assert.equal(healthBlocksModel(null, 'qwen-b'), false)
})
