import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LlmRequestError, retryLlmRequest } from '../src/services/llmRequestRetry'

test('transient requests recover after at most two retries', async () => {
  let attempts = 0
  const started = Date.now()
  const result = await retryLlmRequest(async () => {
    attempts += 1
    if (attempts < 3) throw new LlmRequestError('Unavailable', 503)
    return 'reply'
  })
  assert.equal(result, 'reply')
  assert.equal(attempts, 3)
  assert.ok(Date.now() - started >= 2900)
})

test('authentication, context errors, ordinary 500s and aborts never retry', async () => {
  for (const error of [
    new LlmRequestError('InternalServerError Connection error', 400),
    new LlmRequestError('Unauthorized', 401),
    new LlmRequestError('Forbidden', 403),
    new LlmRequestError('Rate limited', 429),
    new LlmRequestError('Invalid configuration', 500),
    new DOMException('fetch failed', 'AbortError'),
    new DOMException('fetch failed', 'TimeoutError'),
  ]) {
    let attempts = 0
    await assert.rejects(retryLlmRequest(async () => { attempts += 1; throw error }), (actual) => actual === error)
    assert.equal(attempts, 1)
  }
})

test('a stream that already produced output does not retry', async () => {
  let output = ''
  let attempts = 0
  await assert.rejects(retryLlmRequest(async () => {
    attempts += 1
    output = 'partial reply'
    throw new LlmRequestError('Bad gateway', 502)
  }, { canRetry: () => output.length === 0 }))
  assert.equal(attempts, 1)
})

test('cancellation stops a pending backoff before another request', async () => {
  const controller = new AbortController()
  let attempts = 0
  const result = retryLlmRequest(async () => {
    attempts += 1
    throw new LlmRequestError('Connection failure', undefined, { cause: new TypeError('fetch failed') })
  }, { signal: controller.signal })
  setTimeout(() => controller.abort(), 20)
  await assert.rejects(result, { name: 'AbortError' })
  assert.equal(attempts, 1)
})

test('LiteLLM connection failures stop after the third failed request', async () => {
  const failure = new LlmRequestError('InternalServerError: Connection error', 500)
  let attempts = 0
  await assert.rejects(retryLlmRequest(async () => { attempts += 1; throw failure }), (actual) => actual === failure)
  assert.equal(attempts, 3)
})
