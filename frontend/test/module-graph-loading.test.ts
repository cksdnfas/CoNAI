import assert from 'node:assert/strict'
import { test } from 'node:test'

test('workflow loads preserve newer navigation and edits made while loading', async (t) => {
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true })
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value })

  const { act, createElement: h, useLayoutEffect } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
  const { I18nProvider } = await import('../src/i18n')
  const { ConfirmProvider } = await import('../src/components/ui/confirm-dialog')
  const { useModuleGraphBrowseActions } = await import('../src/features/module-graph/use-module-graph-browse-actions')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } })
  client.setQueryData(['auth-status'], { authenticated: true, hasCredentials: true, accountId: 1 })
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

  type Graph = { id: number; name: string; description: string; folder_id: null; graph: { nodes: never[]; edges: never[] } }
  const pending = new Map<number, { promise: Promise<Graph>; resolve: (graph: Graph) => void }>()
  const requested: number[] = []
  const prepare = (id: number) => {
    let resolve!: (graph: Graph) => void
    const promise = new Promise<Graph>((done) => { resolve = done })
    pending.set(id, { promise, resolve })
  }
  t.mock.method(client, 'fetchQuery', async (options) => {
    const id = Number(options.queryKey[1])
    requested.push(id)
    return pending.get(id)!.promise
  })
  const graph = (id: number): Graph => ({ id, name: `Graph ${id}`, description: '', folder_id: null, graph: { nodes: [], edges: [] } })
  const editorRevisionRef = { current: {
    snapshot: 'original', sessionId: 'session', graphId: null as number | null, view: 'edit' as 'browse' | 'edit',
    draftFolderId: null as number | null, name: 'Draft', description: '', runInputs: {} as Record<string, unknown>,
  } }
  const graphLoadRequestRef = { current: 0 }
  let selected: number | null = null
  let allowDiscard = true
  let guardCalls = 0
  let editorEntries = 0
  let draftResets = 0
  const messages: string[] = []
  const noop = () => {}
  let actions!: ReturnType<typeof useModuleGraphBrowseActions>
  function Editor() {
    const current = useModuleGraphBrowseActions({
      isDirty: true, selectedFolderId: null, selectedFolderRecord: null, selectedGraphRecord: null, folderDeleteTarget: null,
      workflowView: 'edit', modules: [], graphWorkflows: [], graphWorkflowFolders: [],
      setNodes: noop, setEdges: noop, setSelectedFolderId: noop, setDraftWorkflowFolderId: noop,
      setSelectedGraphId: (value) => {
        selected = typeof value === 'function' ? value(selected) : value
        editorRevisionRef.current = { ...editorRevisionRef.current, graphId: selected }
      },
      setSelectedExecutionId: noop, setSelectedNodeId: noop, setSelectedEdgeId: noop,
      setWorkflowName: noop, setWorkflowDescription: noop, setWorkflowDebugMode: noop,
      setWorkflowExposedInputs: noop, setWorkflowRunInputValues: noop, setLastSavedSnapshot: noop,
      onEditorGraphReplaced: noop, setWorkflowView: noop, setIsBrowseManageModalOpen: noop, setFolderDeleteTarget: noop,
      refetchGraphWorkflowFolders: async () => {}, refetchGraphWorkflows: async () => {}, refetchModules: async () => {},
      confirmDiscardUnsavedChanges: async () => { guardCalls += 1; return allowDiscard },
      editorRevisionRef, graphLoadRequestRef, onDirectGraphNavigation: noop,
      resetWorkflowDraft: () => { draftResets += 1 }, enterWorkflowEditor: () => { editorEntries += 1 },
      showSnackbar: ({ message }) => messages.push(message),
    })
    useLayoutEffect(() => { actions = current })
    return null
  }
  await act(async () => root.render(h(QueryClientProvider, { client }, h(I18nProvider, null, h(ConfirmProvider, null, h(Editor))))))

  prepare(1)
  prepare(2)
  let older!: Promise<boolean>
  let newer!: Promise<boolean>
  await act(async () => { older = actions.handleLoadGraph({ id: 1 } as never, { silent: true }); await Promise.resolve() })
  await act(async () => { newer = actions.handleLoadGraph({ id: 2 } as never, { silent: true, openEditor: true }); await Promise.resolve() })
  assert.deepEqual(requested, [1, 2])
  await act(async () => { pending.get(2)!.resolve(graph(2)); assert.equal(await newer, true) })
  await act(async () => { pending.get(1)!.resolve(graph(1)); assert.equal(await older, false) })
  assert.equal(selected, 2, 'the older response cannot replace the latest selection')
  assert.equal(editorEntries, 1, 'only the current workflow load enters the editor')

  prepare(3)
  let edited!: Promise<boolean>
  await act(async () => { edited = actions.handleLoadGraph({ id: 3 } as never, { silent: true }); await Promise.resolve() })
  editorRevisionRef.current = { ...editorRevisionRef.current, snapshot: 'edited while loading' }
  await act(async () => { pending.get(3)!.resolve(graph(3)); assert.equal(await edited, false) })
  assert.equal(selected, 2)
  assert.ok(messages.some((message) => message.includes('changed while loading')))

  allowDiscard = false
  await act(async () => assert.equal(await actions.handleLoadGraph({ id: 4 } as never, { silent: true }), false))
  assert.ok(!requested.includes(4), 'a dirty editor still uses the discard guard before loading')
  assert.equal(selected, 2)
  assert.equal(guardCalls, 4)

  allowDiscard = true
  prepare(5)
  let superseded!: Promise<boolean>
  await act(async () => { superseded = actions.handleLoadGraph({ id: 5 } as never, { silent: true }); await Promise.resolve() })
  graphLoadRequestRef.current += 1
  await act(async () => { pending.get(5)!.resolve(graph(5)); assert.equal(await superseded, false) })
  assert.equal(selected, 2, 'a later URL selecting the current graph cancels an earlier load')

  editorRevisionRef.current = { ...editorRevisionRef.current, view: 'browse', draftFolderId: 1 }
  prepare(6)
  let browsing!: Promise<boolean>
  await act(async () => { browsing = actions.handleLoadGraph({ id: 6 } as never, { silent: true }); await Promise.resolve() })
  editorRevisionRef.current = { ...editorRevisionRef.current, draftFolderId: 2 }
  await act(async () => { pending.get(6)!.resolve(graph(6)); assert.equal(await browsing, true) })
  assert.equal(selected, 6, 'browsing another folder does not cancel a workflow load')

  editorRevisionRef.current = { ...editorRevisionRef.current, view: 'edit' }
  prepare(7)
  let folderEdited!: Promise<boolean>
  await act(async () => { folderEdited = actions.handleLoadGraph({ id: 7 } as never, { silent: true }); await Promise.resolve() })
  editorRevisionRef.current = { ...editorRevisionRef.current, draftFolderId: 3 }
  await act(async () => { pending.get(7)!.resolve(graph(7)); assert.equal(await folderEdited, false) })
  assert.equal(selected, 6, 'a changed draft save folder is preserved')

  await act(async () => assert.equal(await actions.handleCreateWorkflow(), true))
  assert.equal(draftResets, 1, 'a fresh workflow resets the draft')
  assert.equal(editorEntries, 2, 'a fresh workflow enters the editor')
})
