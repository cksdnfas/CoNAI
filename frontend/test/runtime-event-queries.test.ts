import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query'
import { act, createElement, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { useRuntimeEventQueryBridge } from '../src/features/runtime-events/use-runtime-event-query-bridge'
import type { RuntimeEventEnvelope } from '../src/lib/runtime-events-types'

test('hello plus reset resyncs once per connection while reset still clears the cursor', async () => {
  const { createRuntimeEventStream } = await import('../src/lib/runtime-event-stream')
  class Source {
    static instances: Source[] = []
    listeners = new Map<string, (event: { data: string }) => void>()
    onerror: (() => void) | null = null
    constructor(public url: string) { Source.instances.push(this) }
    addEventListener(name: string, listener: (event: { data: string }) => void) { this.listeners.set(name, listener) }
    close() {}
    emit(name: string, payload: unknown = {}) { this.listeners.get(name)?.({ data: JSON.stringify(payload) }) }
  }
  const previous = ['window', 'EventSource'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { EventSource: Source } })
  Object.defineProperty(globalThis, 'EventSource', { configurable: true, value: Source })
  const reasons: string[] = []
  const dispose = createRuntimeEventStream({
    onEnvelope: () => {}, onStatusChange: () => {}, onSessionExpired: () => {},
    onResync: reason => reasons.push(reason),
  })
  try {
    const first = Source.instances[0]
    first.emit('hello', { server_boot_id: 'a' })
    assert.deepEqual(reasons, [])
    first.emit('reset')
    first.emit('reset')
    assert.deepEqual(reasons, ['reset'])
    first.emit('chat.task.updated', { id: 42 })
    first.onerror!()
    await new Promise(resolve => setTimeout(resolve, 1600))
    const second = Source.instances[1]
    assert.ok(second.url.includes('cursor=42'))
    second.emit('hello', { server_boot_id: 'b' })
    second.emit('reset')
    assert.deepEqual(reasons, ['reset', 'reconnected'])
    second.onerror!()
    await new Promise(resolve => setTimeout(resolve, 1600))
    const third = Source.instances[2]
    assert.ok(!third.url.includes('cursor='))
    third.emit('hello', { server_boot_id: 'b' })
    assert.deepEqual(reasons, ['reset', 'reconnected', 'reconnected'])
  } finally {
    dispose()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})

test('task events replace pre-update requests, reconnect refreshes tasks, and paired history events coalesce', async (t) => {
  const dom = new JSDOM('<div id="root"></div>')
  const globals = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  const root = createRoot(document.getElementById('root')!)
  let bridge!: ReturnType<typeof useRuntimeEventQueryBridge>
  const setBridge = (value: typeof bridge) => { bridge = value }
  // Hand the bridge out from an effect: assigning an outer variable during render is a side effect.
  function Bridge() { const value = useRuntimeEventQueryBridge(); useEffect(() => setBridge(value), [value]); return null }
  const unsubscribes: Array<() => void> = []
  const event = (name: string, payload: unknown) => bridge.applyEnvelope({ name, payload } as RuntimeEventEnvelope)
  const settle = () => new Promise(resolve => setTimeout(resolve, 20))
  try {
    await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(Bridge))))
    for (const initial of [undefined, { status: 'running' }, null]) {
      client.removeQueries({ queryKey: ['codex-chat-task'] })
      let calls = 0
      let release!: (value: unknown) => void
      const observer = new QueryObserver(client, {
        queryKey: ['codex-chat-task', 1], initialData: initial,
        queryFn: () => ++calls === 1 ? new Promise(resolve => { release = resolve }) : Promise.resolve({ status: 'done' }),
      })
      const unsubscribe = observer.subscribe(() => {})
      if (initial !== undefined) void observer.refetch()
      await settle()
      event('chat.task.updated', { threadId: 1 })
      await settle()
      release({ status: 'running' })
      await settle()
      assert.equal(calls, 2)
      assert.deepEqual(client.getQueryData(['codex-chat-task', 1]), { status: 'done' })
      bridge.resyncAll()
      await settle()
      assert.equal(calls, 3)
      unsubscribe()
    }
    // Reconnect replaces an observed initial read, but does not reject an imperative inactive read.
    let activeCalls = 0
    let releaseActive!: (value: unknown) => void
    const active = new QueryObserver(client, {
      queryKey: ['codex-chat-task', 90],
      queryFn: () => ++activeCalls === 1 ? new Promise(resolve => { releaseActive = resolve }) : Promise.resolve('current'),
    })
    unsubscribes.push(active.subscribe(() => {}))
    let inactiveCalls = 0
    let releaseInactive!: (value: string) => void
    const inactive = client.fetchQuery({
      queryKey: ['codex-chat-thread', 91],
      queryFn: () => { inactiveCalls++; return new Promise<string>(resolve => { releaseInactive = resolve }) },
    })
    // Attach a rejection handler before resync so any regression is an assertion, not an unhandled rejection.
    const inactiveResult = inactive.then(value => ({ value }), error => ({ error }))
    const overlapCounts = new Map<string, number>()
    const overlapKeys = Array.from({ length: 12 }, (_, i) => ['codex-chat-thread', 100 + Math.floor(i / 2), ...(i % 2 ? ['attachments'] : [])])
    for (const queryKey of overlapKeys) {
      client.setQueryData(queryKey, 'cached')
      unsubscribes.push(new QueryObserver(client, { queryKey, queryFn: async () => {
        const key = JSON.stringify(queryKey)
        overlapCounts.set(key, (overlapCounts.get(key) ?? 0) + 1)
        return 'updated'
      } }).subscribe(() => {}))
    }
    client.setQueryData(['unrelated', 1], 'unchanged')
    const scans = t.mock.method(client.getQueryCache(), 'findAll')
    await bridge.resyncAll()
    assert.ok(scans.mock.callCount() <= 3, 'bulk cancellation, invalidation and refetch need at most three cache scans regardless of matched key count')
    scans.mock.restore()
    assert.equal(activeCalls, 2)
    releaseActive('old')
    await settle()
    assert.equal(client.getQueryData(['codex-chat-task', 90]), 'current')
    assert.equal(inactiveCalls, 1)
    assert.equal(client.getQueryState(['codex-chat-thread', 91])?.fetchStatus, 'fetching')
    assert.equal(client.getQueryState(['codex-chat-thread', 91])?.isInvalidated, true)
    releaseInactive('quote attachment')
    assert.deepEqual(await inactiveResult, { value: 'quote attachment' })
    assert.deepEqual(overlapKeys.map(key => overlapCounts.get(JSON.stringify(key))), Array(12).fill(1))
    assert.equal(client.getQueryState(['unrelated', 1])?.isInvalidated, false)

    const counts = new Map<string, number>()
    const keys = [
      ['codex-chat-thread', 2], ['codex-chat-media', 2],
      ['image-generation-history', 'codex-chat-job', 3], ['codex-chat-history', 4],
      ['codex-chat-history', 5],
      ['image-detail', 'hash'],
    ]
    for (const queryKey of keys) {
      client.setQueryData(queryKey, {})
      const observer = new QueryObserver(client, { queryKey, queryFn: async () => {
        const key = JSON.stringify(queryKey)
        counts.set(key, (counts.get(key) ?? 0) + 1)
        return {}
      } })
      unsubscribes.push(observer.subscribe(() => {}))
    }
    for (let i = 0; i < 10; i++) {
      event('history.record.created', { history_id: 4, queue_job_id: 3, composite_hash: 'hash' })
      event('history.record.status', { history_id: 4, queue_job_id: 3, composite_hash: 'hash' })
      event('chat.generation.updated', { threadId: 2, jobId: 3, historyId: 4, compositeHash: 'hash' })
      event('chat.generation.finished', { chat: { threadId: 2 }, jobId: 3, thumbnailHistoryId: 4 })
    }
    event('history.record.status', { history_id: 5, queue_job_id: null })
    assert.equal(counts.size, 0)
    await new Promise(resolve => setTimeout(resolve, 260))
    assert.deepEqual(keys.map(key => counts.get(JSON.stringify(key))), [1, 1, 1, 1, 1, 1])
    event('chat.generation.updated', { threadId: 2, jobId: 3, historyId: 4 })
    await act(async () => root.unmount())
    await new Promise(resolve => setTimeout(resolve, 260))
    assert.deepEqual(keys.map(key => counts.get(JSON.stringify(key))), [1, 1, 1, 1, 1, 1])
  } finally {
    unsubscribes.forEach(unsubscribe => unsubscribe())
    client.clear()
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
