import './support/testTemp'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { streamChatCompletion, type ChatCompletionTarget } from '../src/services/codex-chat/llmChatCompletion'

test('quiet requests follow the connection deadline and remain cancellable without one', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const target: ChatCompletionTarget = {
    providerName: 'quiet-model', displayName: 'quiet-model', endpoint: 'http://unused.invalid/v1/chat/completions',
    apiKey: null, model: 'm', generation: {}, promptCacheMarks: false,
  }
  for (const timeoutMs of [null, 20 * 60_000]) {
    let entered!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    let requestSignal!: AbortSignal
    t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
      requestSignal = init.signal as AbortSignal
      return new Promise<Response>((_resolve, reject) => {
        requestSignal.addEventListener('abort', () => reject(requestSignal.reason), { once: true })
        entered()
      })
    })
    const controller = new AbortController()
    const result = streamChatCompletion({ target: { ...target, timeoutMs }, messages: [], signal: controller.signal, retry: false })
    const rejected = assert.rejects(result, { name: timeoutMs === null ? 'AbortError' : 'TimeoutError' })
    await started
    t.mock.timers.tick(10 * 60_000)
    try {
      assert.equal(requestSignal.aborted, false)
      if (timeoutMs === null) controller.abort()
      else t.mock.timers.tick(10 * 60_000)
      await rejected
    } finally {
      controller.abort()
      await rejected.catch(() => {})
    }
  }
})
