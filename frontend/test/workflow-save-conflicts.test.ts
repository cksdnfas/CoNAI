import assert from 'node:assert/strict'
import { test } from 'node:test'

test('graph editor saves and test runs use the loaded revision, not a refreshed record', async (t) => {
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true })
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value })
  const { act, createElement: h, useLayoutEffect } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
  const { I18nProvider } = await import('../src/i18n')
  const { useModuleGraphExecutionActions } = await import('../src/features/module-graph/use-module-graph-execution-actions')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } })
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

  const requests: Array<{ url: string; body: { expected_revision?: number; name?: string } }> = []
  let conflict = true
  let nextRevision = 3
  let pendingResponse: Promise<Response> | null = null
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)) })
    if (String(input).endsWith('/execute')) return Response.json({ success: true, data: { executionId: 42, status: 'queued' } })
    if (pendingResponse) return pendingResponse
    return conflict
      ? Response.json({ success: false, error: 'The workflow changed.' }, { status: 409 })
      : Response.json({ success: true, data: { id: 7, revision: nextRevision, message: 'saved' } })
  })
  const base = { current: { id: 7, revision: 2 } }
  const messages: string[] = []
  let snapshots = 0
  let workflowName = 'my draft'
  let actions!: ReturnType<typeof useModuleGraphExecutionActions>
  const node = { id: 'n', position: { x: 0, y: 0 }, data: { module: { id: 1, name: 'node', engine_type: 'system', exposed_inputs: [], output_ports: [] }, inputValues: {} } }
  const noop = () => {}
  function Editor() {
    const value = useModuleGraphExecutionActions({
      nodes: [node] as never, edges: [], workflowName, workflowDescription: '', workflowDebugMode: false,
      draftWorkflowFolderId: 4, selectedGraphId: 7, selectedGraphRecord: { id: 7, name: 'refreshed', revision: 9 } as never,
      editorBaseRevisionRef: base, selectedNode: null, selectedExecution: null, selectedWorkflowValidationIssues: [],
      workflowRunInputValues: {}, workflowView: 'edit', isDirty: true,
      onWorkflowNameResolved: noop, onGraphSelected: noop, onExecutionSelected: noop, onNodeSelected: noop,
      onEdgeCleared: noop, onSnapshotSaved: () => { snapshots += 1 }, onNodeImagesMoved: noop,
      refetchGraphWorkflows: async () => {}, refetchGraphExecutions: async () => {}, refetchExecutionDetail: async () => {},
      showSnackbar: ({ message }) => messages.push(message),
    })
    useLayoutEffect(() => { actions = value })
    return null
  }
  await act(async () => root.render(h(QueryClientProvider, { client }, h(I18nProvider, null, h(Editor)))))
  await act(async () => assert.equal(await actions.handleSaveGraph(), false))
  await act(async () => { await actions.handleTestRunCurrentGraph() })
  assert.deepEqual(requests.map((request) => request.body.expected_revision), [2, 2])
  assert.ok(requests.every((request) => request.url.endsWith('/api/graph-workflows/7')), 'a conflicting test run is not enqueued')
  assert.equal(snapshots, 0)
  assert.equal(base.current.revision, 2)
  assert.ok(messages.some((message) => message.includes('changed')))
  conflict = false
  await act(async () => assert.equal(await actions.handleSaveGraph(), true))
  assert.equal(base.current.revision, 3)
  assert.equal(snapshots, 1)

  let release!: (response: Response) => void
  pendingResponse = new Promise((resolve) => { release = resolve })
  const before = requests.length
  let save!: Promise<boolean>
  let run!: Promise<void>
  await act(async () => {
    save = actions.handleSaveGraph()
    await Promise.resolve()
    run = actions.handleTestRunCurrentGraph()
    await Promise.resolve()
  })
  assert.equal(requests.length - before, 1, 'save and test run share one in-flight save')
  await act(async () => {
    pendingResponse = null
    release(Response.json({ success: true, data: { id: 7, revision: 4, message: 'saved' } }))
    assert.equal(await save, true)
    await run
  })
  assert.equal(requests.filter((request) => request.url.endsWith('/execute')).length, 1)
  assert.equal(base.current.revision, 4)

  pendingResponse = new Promise((resolve) => { release = resolve })
  const beforeNewDraft = requests.length
  await act(async () => {
    save = actions.handleSaveGraph()
    await Promise.resolve()
  })
  workflowName = 'newer draft'
  await act(async () => root.render(h(QueryClientProvider, { client }, h(I18nProvider, null, h(Editor)))))
  await act(async () => {
    run = actions.handleTestRunCurrentGraph()
    await Promise.resolve()
  })
  assert.equal(requests.length - beforeNewDraft, 1, 'the newer draft waits for the first save')
  await act(async () => {
    pendingResponse = null
    nextRevision = 6
    release(Response.json({ success: true, data: { id: 7, revision: 5, message: 'saved' } }))
    assert.equal(await save, true)
    await run
  })
  const queuedWrites = requests.slice(beforeNewDraft).filter((request) => request.url.endsWith('/api/graph-workflows/7'))
  assert.deepEqual(queuedWrites.map((request) => [request.body.name, request.body.expected_revision]), [['my draft', 4], ['newer draft', 5]])
  assert.equal(base.current.revision, 6)
})

test('ComfyUI human and assistant saves keep the opened token and draft after a conflict', async (t) => {
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true })
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value })
  const { act, createElement: h, useLayoutEffect } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MemoryRouter } = await import('react-router-dom')
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
  const { I18nProvider } = await import('../src/i18n')
  const { SnackbarContext } = await import('../src/components/ui/snackbar-context')
  const { useComfyWorkflowAuthoringController } = await import('../src/features/image-generation/components/use-comfy-workflow-authoring-controller')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } })
  client.setQueryData(['runtime-language-settings'], { general: { language: 'en' } })
  client.setQueryData(['global-appearance-settings'], {})
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
  const headers: string[] = []
  let stored = { name: 'newer server value', token: 'newer-token' }
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    if (!init?.method || init.method === 'GET') {
      assert.ok(String(input).endsWith('/api/workflows/7'))
      return Response.json({ success: true, data: { ...workflow, name: stored.name, assistant_revision: stored.token, color: '#ff0000' } })
    }
    const token = new Headers(init.headers).get('If-Match') ?? ''
    headers.push(token)
    if (token !== stored.token) return Response.json({ success: false, code: 'revision_conflict', error: 'Different server wording' }, { status: 409 })
    stored = { name: JSON.parse(String(init.body)).name, token: 'saved-token' }
    return Response.json({ success: true, data: { id: 7 } })
  })
  const messages: string[] = []
  let closes = 0
  let controller!: ReturnType<typeof useComfyWorkflowAuthoringController>
  const workflow = {
    id: 7, name: 'opened', description: '', workflow_json: '{"1":{"class_type":"Test","inputs":{}}}',
    marked_fields: [], assistant_revision: 'opened-token', color: '#2196f3', is_active: true,
    result_view_mode: 'history', artifact_directory_mode: 'shared', api_endpoint: '',
  }
  let initialData = { workflow }
  const snackbar = { showSnackbar: ({ message }: { message: string }) => messages.push(message), closeSnackbar: () => {} }
  function Editor() {
    const value = useComfyWorkflowAuthoringController({ open: true, mode: 'edit', initialData: initialData as never, dropdownLists: [], onClose: () => { closes += 1 } })
    useLayoutEffect(() => { controller = value })
    return null
  }
  const render = () => root.render(h(QueryClientProvider, { client }, h(MemoryRouter, null, h(I18nProvider, null, h(SnackbarContext.Provider, { value: snackbar }, h(Editor))))))
  await act(async () => render())
  await act(async () => controller.patchDraft({ name: 'my draft' }))
  initialData = { workflow: { ...workflow, name: 'newer server value', assistant_revision: 'newer-token' } }
  await act(async () => render())
  assert.equal(controller.draft.name, 'my draft')
  await act(async () => { await controller.handleSave() })
  await act(async () => assert.rejects(controller.handleSave('opened-token', true)))
  assert.deepEqual(headers, ['opened-token', 'opened-token'])
  assert.equal(controller.draft.name, 'my draft')
  assert.equal(controller.isDirty, true)
  assert.equal(closes, 0)
  assert.ok(messages.every((message) => message.includes('changed')))
  assert.equal(controller.conflict, true, 'the refused save offers the overwrite')
  await act(async () => controller.patchDraft({ name: '' }))
  await act(async () => { await controller.overwriteConflict() })
  assert.equal(headers.length, 2, 'an invalid draft is not sent')
  assert.equal(controller.isSaving, false, 'an invalid overwrite never locks the editor')
  assert.ok(messages.at(-1)?.includes('name is required'))
  assert.equal(controller.conflict, true, 'the overwrite is still offered')
  await act(async () => controller.patchDraft({ name: 'my draft' }))
  await act(async () => { await controller.overwriteConflict() })
  assert.equal(controller.isSaving, false)
  assert.deepEqual(headers.slice(2), ['newer-token'], 'overwrite saves with the latest token')
  assert.equal(stored.name, 'my draft', 'the draft replaces the newer version')
  assert.equal(controller.conflict, false)
  assert.equal(closes, 1)
})

test('schedule editor keeps its reviewed revisions and draft when the schedule changes', async (t) => {
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true })
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
    Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter,
    MutationObserver: dom.window.MutationObserver, CustomEvent: dom.window.CustomEvent,
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true,
  }
  const previous = Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value })
  const { act, createElement: h } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
  const { I18nProvider } = await import('../src/i18n')
  const { SnackbarContext } = await import('../src/components/ui/snackbar-context')
  const { TooltipProvider } = await import('../src/components/ui/tooltip')
  const { FeaturePermissionsContext, resolveFeaturePermissions } = await import('../src/features/auth/use-feature-permissions')
  const { ModuleWorkflowSchedulesPanel } = await import('../src/features/module-graph/components/module-workflow-schedules-panel')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } })
  client.setQueryData(['runtime-language-settings'], { general: { language: 'en' } })
  client.setQueryData(['auth-status'], { authenticated: true, hasCredentials: true, accountId: 1 })
  client.setQueryData(['module-graph-workflow-detail', 7], { id: 7, version: 2, graph: { nodes: [], edges: [], metadata: {} } })
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
  const bodies: Array<Record<string, unknown>> = []
  let workflowVersion = 3
  let workflowLoads = 0
  let rejectSave = true
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    if (String(input).endsWith('/api/graph-workflows/7')) {
      workflowLoads += 1
      return Response.json({ success: true, data: { id: 7, version: workflowVersion, graph: { nodes: [], edges: [], metadata: {} } } })
    }
    bodies.push(JSON.parse(String(init?.body)))
    return rejectSave
      ? Response.json({ success: false, error: 'The autorun changed.' }, { status: 409 })
      : Response.json({ success: true, data: { id: 5, message: 'saved' } })
  })
  const messages: string[] = []
  const snackbar = { showSnackbar: ({ message }: { message: string }) => messages.push(message), closeSnackbar: () => {} }
  const schedule = { id: 5, revision: 4, graph_workflow_id: 7, workflow_version: 2, name: 'hourly', schedule_type: 'interval', interval_minutes: 60, status: 'active', created_date: '', updated_date: '' }
  let listedSchedules = [schedule]
  let resumeTarget: unknown
  const noop = () => {}
  const savingStates: boolean[] = []
  const renderPanel = () => root.render(h(QueryClientProvider, { client }, h(I18nProvider, null,
    h(SnackbarContext.Provider, { value: snackbar }, h(FeaturePermissionsContext.Provider, {
      value: resolveFeaturePermissions(['generation.execute', 'workflows.edit'], true),
    }, h(TooltipProvider, null, h(ModuleWorkflowSchedulesPanel, {
    schedules: listedSchedules as never, workflows: [{ id: 7, name: 'workflow' }], workflowNameById: new Map([[7, 'workflow']]),
    covers: {}, isMutating: false, onSavingChange: (saving) => savingStates.push(saving),
    onPauseSchedule: noop, onResumeSchedule: (target) => { resumeTarget = target }, onDeleteSchedule: noop, onRunNow: noop,
  })))))))
  await act(async () => renderPanel())
  const edit = document.querySelector<HTMLButtonElement>('button[aria-label="Edit autorun"]')
  assert.ok(edit)
  await act(async () => edit.click())
  await act(async () => { await new Promise<void>((resolve) => setImmediate(resolve)) })
  const dialog = document.querySelector('[role="dialog"]')
  assert.ok(dialog)
  const input = dialog.querySelector<HTMLInputElement>('input')
  assert.ok(input)
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, 'my draft')
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  })
  await act(async () => {
    dialog.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
  })
  assert.equal(bodies.length, 1)
  assert.equal(bodies[0].expected_revision, 4)
  assert.equal(bodies[0].expected_graph_version, 3, 'the shared cached version is not reviewed')
  assert.equal(bodies[0].status, undefined, 'an unchanged active switch is not a resume request')
  assert.equal(document.querySelector<HTMLInputElement>('[role="dialog"] input')?.value, 'my draft')
  assert.ok(messages.some((message) => message.includes('changed')))
  assert.deepEqual(savingStates, [true, false])

  await act(async () => document.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Close"]')!.click())
  workflowVersion = 4
  await act(async () => edit.click())
  await act(async () => { await new Promise<void>((resolve) => setImmediate(resolve)) })
  const reopenedInput = document.querySelector<HTMLInputElement>('[role="dialog"] input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(reopenedInput, 'second draft')
    reopenedInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  await act(async () => document.querySelector('[role="dialog"] form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })))
  assert.equal(workflowLoads, 2)
  assert.equal(bodies[1].expected_graph_version, 4, 'reopening starts a fresh review')

  const { saveWorkflowReservationSchedule } = await import('../src/features/image-generation/components/use-workflow-reservations-chat-page')
  const paused = { ...schedule, status: 'paused', revision: 9, workflow_version: 4 }
  await act(async () => document.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Close"]')!.click())
  listedSchedules = [paused]
  await act(async () => renderPanel())
  await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Resume autorun"]')!.click())
  assert.deepEqual(resumeTarget, paused, 'the resume action uses the displayed schedule and workflow version')
  rejectSave = false
  await saveWorkflowReservationSchedule({ scheduleId: 5, active: true, name: 'resume and edit' }, [paused] as never)
  assert.equal(bodies[2].status, 'active')
  assert.equal(bodies[2].expected_revision, 9)
  assert.equal(bodies[2].expected_graph_version, 4)
  await saveWorkflowReservationSchedule({ scheduleId: 5, name: 'edit only' }, [paused] as never)
  assert.equal(bodies[3].status, undefined)
  const { resumeGraphWorkflowSchedule } = await import('../src/lib/api-module-graph')
  rejectSave = true
  await assert.rejects(resumeGraphWorkflowSchedule(5, { expected_revision: 9, expected_graph_version: 4 }))
  assert.deepEqual(bodies[4], { expected_revision: 9, expected_graph_version: 4 })
})
