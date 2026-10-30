import assert from 'node:assert/strict'
import { test } from 'node:test'

test('workflow chat revisions follow edits made before and after connecting', async (t) => {
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true })
  class TestEventSource extends dom.window.EventTarget { close() {} }
  Object.defineProperty(dom.window, 'EventSource', { value: TestEventSource })
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, EventSource: TestEventSource, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value })
  const { act, createElement: h, useLayoutEffect, useState } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
  const { MemoryRouter } = await import('react-router-dom')
  const { ReactFlowProvider } = await import('@xyflow/react')
  const { I18nProvider } = await import('../src/i18n')
  const { SnackbarContext } = await import('../src/components/ui/snackbar-context')
  const { ChatPageProvider, useChatPage } = await import('../src/features/codex-chat/chat-page-context')
  const { buildGraphEditorSnapshot } = await import('../src/features/module-graph/module-graph-flow')
  const { useWorkflowChatPage } = await import('../src/features/module-graph/use-workflow-chat-page')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } })
  client.setQueryData(['auth-status'], { authenticated: true, hasCredentials: true, accountId: 1, permissionKeys: ['page.generation.view'] })
  client.setQueryData(['runtime-language-settings'], { general: { language: 'en' } })
  const root = createRoot(document.getElementById('root')!)
  t.after(async () => {
    await act(async () => root.unmount())
    client.clear()
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
  let page!: NonNullable<ReturnType<typeof useChatPage>>
  let rename!: (name: string) => void
  let changeInputs!: (inputs: Record<string, unknown>) => void
  let saves = 0
  const nodes: never[] = []
  const edges: never[] = []
  const modules: never[] = []
  const noop = () => {}
  function Editor() {
    const api = useChatPage()!
    const [name, setName] = useState('Draft')
    const [runInputs, setRunInputs] = useState<Record<string, unknown>>({})
    const currentSnapshot = buildGraphEditorSnapshot({ name, description: '', nodes, edges, workflowMetadata: { exposed_inputs: [], debug_mode: false } })
    useLayoutEffect(() => { page = api; rename = setName; changeInputs = setRunInputs }, [api])
    useWorkflowChatPage({
      enabled: true, dirty: true, currentSnapshot, editorSessionId: 'session', selectedGraphId: null,
      name, description: '', debugMode: false, nodes, edges, modules, runInputs,
      setNodes: noop, setEdges: noop, setName, setDescription: noop, setRunInputs, setExposedInputs: noop,
      setSelectedNodeId: noop, setSelectedEdgeId: noop,
      canSave: true, save: async () => { saves++; return true },
    })
    return null
  }
  await act(async () => root.render(h(QueryClientProvider, { client }, h(MemoryRouter, { initialEntries: ['/generation?tab=workflows'] },
    h(I18nProvider, null, h(SnackbarContext.Provider, { value: { showSnackbar() {}, closeSnackbar() {} } },
      h(ChatPageProvider, null, h(ReactFlowProvider, null, h(Editor)))))))))
  await act(async () => { rename('Before connect'); changeInputs({ private: 'first' }) })
  await act(async () => page.toggle())
  const connected = page.capture()?.workflow
  assert.equal(connected?.name, 'Before connect')
  assert.ok(connected?.revision)
  assert.equal(page.capture()?.dirty, true)
  await act(async () => changeInputs({ private: 'second' }))
  const inputRevision = page.capture()?.workflow?.revision
  assert.notEqual(inputRevision, connected?.revision, 'private run inputs invalidate the connected revision')
  await act(async () => rename('Before connect '))
  const whitespaceRevision = page.capture()?.workflow?.revision
  assert.notEqual(whitespaceRevision, inputRevision, 'untrimmed native name edits invalidate the revision')
  await act(async () => page.toggle())
  await act(async () => { rename('While disconnected'); changeInputs({ private: 'third' }) })
  await act(async () => page.toggle())
  assert.equal(page.capture()?.workflow?.name, 'While disconnected')
  assert.notEqual(page.capture()?.workflow?.revision, whitespaceRevision)
  await t.test('a new workflow offers no chat save; it is saved through the register dialog', async () => {
    assert.equal(page.capture()!.actions?.some((item) => item.id === 'workflow.save'), false)
    assert.equal(saves, 0)
  })
})

test('workflow cancellation waits for all outcomes and refreshes after partial failure', async (t) => {
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true })
  class TestEventSource extends dom.window.EventTarget {
    static latest: TestEventSource
    constructor() { super(); TestEventSource.latest = this }
    close() {}
  }
  Object.defineProperty(dom.window, 'EventSource', { value: TestEventSource })
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, EventSource: TestEventSource, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value })
  const { act, createElement: h, useLayoutEffect } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
  const { MemoryRouter } = await import('react-router-dom')
  const { I18nProvider } = await import('../src/i18n')
  const { SnackbarContext } = await import('../src/components/ui/snackbar-context')
  const { ChatPageProvider, useChatPage } = await import('../src/features/codex-chat/chat-page-context')
  const { useWorkflowRunnerChatPage } = await import('../src/features/module-graph/use-workflow-runner-chat-page')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } })
  client.setQueryData(['auth-status'], { authenticated: true, hasCredentials: true, accountId: 1, permissionKeys: ['page.generation.view', 'generation.execute'] })
  client.setQueryData(['runtime-language-settings'], { general: { language: 'en' } })
  const root = createRoot(document.getElementById('root')!)
  t.after(async () => {
    await act(async () => root.unmount())
    client.clear()
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
  let page!: NonNullable<ReturnType<typeof useChatPage>>
  let refreshes = 0
  const attempts: number[] = []
  let release!: (response: Response) => void
  const delayed = new Promise<Response>((resolve) => { release = resolve })
  let allStarted!: () => void
  const started = new Promise<void>((resolve) => { allStarted = resolve })
  let answer!: (value: { ok: boolean; error?: string }) => void
  const answered = new Promise<{ ok: boolean; error?: string }>((resolve) => { answer = resolve })
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/page-commands/')) { answer(JSON.parse(String(init?.body))); return Response.json({ success: true, data: null }) }
    const id = Number(url.match(/executions\/(\d+)\/cancel/)?.[1])
    assert.ok(id, `unexpected request: ${url}`)
    attempts.push(id)
    if (attempts.length === 3) allStarted()
    if (id === 11) return Response.json({ success: false, error: 'request rejected' }, { status: 500 })
    if (id === 12) return Response.json({ success: true, data: { success: false, message: 'already finished' } })
    return delayed
  })
  function Runner() {
    const api = useChatPage()!
    useLayoutEffect(() => { page = api }, [api])
    useWorkflowRunnerChatPage({
      graph: { id: 7, name: 'Workflow', graph: { nodes: [], edges: [] } } as never,
      definitions: [], values: {}, change: () => {}, clear: () => {}, enabled: true, canRun: true,
      run: async () => true, running: false, refresh: async () => { refreshes++ },
      recentRuns: [{ id: 11, status: 'queued' }, { id: 12, status: 'running' }, { id: 13, status: 'queued' }] as never,
    })
    return null
  }
  await act(async () => root.render(h(QueryClientProvider, { client }, h(MemoryRouter, { initialEntries: ['/generation?tab=workflows'] },
    h(I18nProvider, null, h(SnackbarContext.Provider, { value: { showSnackbar() {}, closeSnackbar() {} } }, h(ChatPageProvider, null, h(Runner))))))))
  await act(async () => page.toggle())
  const snapshot = page.capture()!
  try {
    await act(async () => {
      TestEventSource.latest.dispatchEvent(new dom.window.MessageEvent('chat.page.command', { data: JSON.stringify({
        name: 'chat.page.command',
        payload: { type: 'action', actionId: 'workflow.run_cancel', tier: 'direct', arguments: { executionIds: [11, 12, 13] }, revision: snapshot.revision, commandId: 'cancel-runs', connectionId: snapshot.connectionId, instanceId: snapshot.instanceId, threadId: 1, expiresAt: Date.now() + 10_000 },
      }) }))
      await started
    })
    assert.equal(refreshes, 0, 'refresh waits for every cancellation')
    let result!: Awaited<typeof answered>
    await act(async () => {
      release(Response.json({ success: true, data: { success: true, message: 'cancelled' } }))
      result = await answered
    })
    assert.deepEqual(attempts, [11, 12, 13])
    assert.equal(refreshes, 1)
    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /11/)
    assert.match(result.error ?? '', /12/)
  } finally {
    release(Response.json({ success: true, data: { success: true, message: 'cancelled' } }))
  }
})
