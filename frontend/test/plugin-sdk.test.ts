import assert from 'node:assert/strict'
import { test } from 'node:test'
import { once } from 'node:events'
import { MessageChannel } from 'node:worker_threads'
import { connectPlugin } from '../../plugins/sdk/conai-plugin.js'

test('plugin SDK preserves cancellation, structured errors, binary uploads and response backpressure', { timeout: 15000 }, async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const window = Object.assign(new EventTarget(), { parent: null as unknown })
  window.parent = window
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window })
  const channel = new MessageChannel()
  t.after(() => {
    channel.port1.close(); channel.port2.close()
    if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window')
  })
  const connected = connectPlugin()
  window.dispatchEvent(Object.assign(new Event('message'), { source: window, data: { type: 'conai-plugin-connect', version: 1, features: ['app.fetch', 'request.abort'], nativeApiRoots: ['/api/files'], files: [] }, ports: [channel.port2] }))
  const api = await connected
  assert.equal(api.supports('app.fetch'), true)
  assert.equal(api.supports('unknown'), false)

  await t.test('errors keep HTTP status/code and cancellation releases the request slot', async () => {
    let incoming = once(channel.port1, 'message')
    const denied = api.request('files.readText', { fileId: 'test' })
    const [message] = await incoming
    channel.port1.postMessage({ type: 'response', id: message.id, error: 'denied', errorInfo: { status: 403, code: 'FORBIDDEN' } })
    await assert.rejects(denied, { message: 'denied', status: 403, code: 'FORBIDDEN' })
    incoming = once(channel.port1, 'message')
    const controller = new AbortController()
    const task = api.server({}, { signal: controller.signal })
    const [call] = await incoming
    const rejection = assert.rejects(task, { name: 'AbortError' })
    incoming = once(channel.port1, 'message')
    controller.abort()
    assert.deepEqual((await incoming)[0], { type: 'cancel', id: call.id })
    await rejection
  })

  await t.test('multipart bytes bypass JSON encoding and native response is a real streamed Response', async () => {
    const form = new FormData()
    form.append('files', new Blob([new Uint8Array(300_000)]), 'sound.wav')
    const incoming = once(channel.port1, 'message')
    const fetch = api.app.fetch('/api/files/upload', { method: 'POST', body: form })
    const [call] = await incoming
    assert.equal(call.method, 'app.fetch')
    assert.equal(call.args.form[0].value.size, 300_000)
    assert.equal(call.args.form[0].filename, 'sound.wav')
    const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"success":')); controller.enqueue(new TextEncoder().encode('true}')); controller.close() } })
    channel.port1.postMessage({ type: 'response', id: call.id, result: { status: 201, statusText: 'Created', headers: [['content-type', 'application/json']], body } }, [body])
    const response = await fetch
    assert.equal(response.status, 201)
    assert.deepEqual(await response.json(), { success: true })
  })

  await t.test('aborting a response body cancels the transferred upstream stream', async () => {
    const incoming = once(channel.port1, 'message')
    const controller = new AbortController()
    let markCancelled!: () => void
    const cancelled = new Promise<void>(resolve => { markCancelled = resolve })
    const fetch = api.app.fetch('/api/codex-chat/threads/1/messages', { signal: controller.signal })
    const [call] = await incoming
    const body = new ReadableStream({ cancel() { markCancelled() } })
    channel.port1.postMessage({ type: 'response', id: call.id, result: { status: 200, statusText: 'OK', headers: [], body } }, [body])
    const response = await fetch
    const read = response.text()
    const rejection = assert.rejects(read, { name: 'AbortError' })
    controller.abort()
    await rejection
    await cancelled
  })

  await t.test('a page outside a layout has no context; form reads and fills go to the host', async () => {
    assert.equal(api.context, null)
    let incoming = once(channel.port1, 'message')
    const form = api.page.form()
    const [read] = await incoming
    assert.equal(read.method, 'page.form.get')
    channel.port1.postMessage({ type: 'response', id: read.id, result: { title: 'NovelAI', fields: [] } })
    assert.deepEqual(await form, { title: 'NovelAI', fields: [] })
    incoming = once(channel.port1, 'message')
    const fill = api.page.fill({ prompt: '1girl' })
    const [write] = await incoming
    assert.deepEqual([write.method, write.args], ['page.form.fill', { values: { prompt: '1girl' } }])
    channel.port1.postMessage({ type: 'response', id: write.id, result: { filled: ['prompt'] } })
    assert.deepEqual(await fill, { filled: ['prompt'] })
  })

  await t.test('discard forwards only the job identity through the page LLM bridge', async () => {
    const incoming = once(channel.port1, 'message')
    const result = api.llm.discard({ jobId: 'discard-job' })
    const [request] = await incoming
    assert.deepEqual([request.method, request.args], ['llm.discard', { jobId: 'discard-job' }])
    channel.port1.postMessage({ type: 'response', id: request.id, result: { jobId: 'discard-job', deleted: 2 } })
    assert.deepEqual(await result, { jobId: 'discard-job', deleted: 2 })
  })

  await t.test('closing the host rejects pending calls immediately', async () => {
    const incoming = once(channel.port1, 'message')
    const task = api.request('workspace.read', {})
    await incoming
    const rejection = assert.rejects(task, /closed/)
    channel.port1.postMessage({ type: 'closed' })
    await rejection
    await assert.rejects(api.request('workspace.read', {}), /closed/)
  })
})
