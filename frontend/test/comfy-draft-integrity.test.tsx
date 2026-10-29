import assert from 'node:assert/strict'
import { test } from 'node:test'

test('Comfy drafts remain account- and workflow-scoped across changes and unmount', async (t) => {
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
  const { persistComfyWorkflowDraft, loadPersistedComfyWorkflowDraft } = await import('../src/features/image-generation/image-generation-drafts')
  const { useComfyWorkflowDraft } = await import('../src/features/image-generation/components/use-comfy-workflow-draft')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } })
  client.setQueryData(['runtime-language-settings'], { general: { language: 'en' } })
  let root = createRoot(document.getElementById('root')!)
  let mounted = true
  t.after(async () => {
    if (mounted) await act(async () => root.unmount())
    client.clear()
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })

  const fields = [{ id: 'prompt', type: 'text', default_value: '' }] as never
  persistComfyWorkflowDraft('one', 1, { prompt: 'one saved' })
  persistComfyWorkflowDraft('two', 1, { prompt: 'two saved' })
  persistComfyWorkflowDraft('two', 2, { prompt: 'other workflow' })
  let state!: ReturnType<typeof useComfyWorkflowDraft>
  function Editor({ owner, id, workflowFields }: { owner: string; id: number; workflowFields: typeof fields }) {
    const value = useComfyWorkflowDraft(owner, { id, name: 'Workflow' }, workflowFields)
    useLayoutEffect(() => { state = value })
    return null
  }
  const render = (owner: string, id: number, workflowFields = fields) => root.render(
    h(QueryClientProvider, { client }, h(I18nProvider, null, h(ConfirmProvider, null, h(Editor, { owner, id, workflowFields })))),
  )

  await act(async () => render('one', 1))
  assert.equal(state.workflowDraft.prompt, 'one saved')
  await act(async () => state.setWorkflowDraft({ prompt: 'one edited' }))
  const persistOldDraft = state.persistDraft
  await act(async () => render('two', 1))
  assert.equal(loadPersistedComfyWorkflowDraft('one', 1).prompt, 'one edited', 'switching accounts flushes pending edits to the original owner')
  assert.equal(state.workflowDraft.prompt, 'two saved')
  assert.equal(persistOldDraft({ prompt: 'stale history load' }), false, 'a delayed history load cannot overwrite a different account')
  await act(async () => state.setWorkflowDraft({ prompt: 'two edited' }))
  await act(async () => render('two', 2))
  assert.equal(loadPersistedComfyWorkflowDraft('two', 1).prompt, 'two edited', 'switching workflows flushes the previous draft')
  assert.equal(state.workflowDraft.prompt, 'other workflow')
  await act(async () => state.setWorkflowDraft({ prompt: 'not yet persisted' }))
  await act(async () => render('two', 2, [...fields] as never))
  assert.equal(state.workflowDraft.prompt, 'not yet persisted', 'refreshing field definitions preserves pending edits')
  await act(async () => { root.unmount(); mounted = false })
  assert.equal(loadPersistedComfyWorkflowDraft('two', 2).prompt, 'not yet persisted', 'unmount flushes the latest pending edit')
  root = createRoot(document.getElementById('root')!)
  mounted = true
  await act(async () => render('two', 2))
  await act(async () => state.setWorkflowDraft({ prompt: '' }))
  await act(async () => {
    assert.equal(await state.resetDraft(), true)
    root.unmount()
    mounted = false
  })
  assert.deepEqual(loadPersistedComfyWorkflowDraft('two', 2), {}, 'reset cannot resurrect a pending draft during unmount')
})

test('NAI and Codex drafts keep the last edit when the panel unmounts before the debounce', async (t) => {
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
  const { loadPersistedNaiFormDraft } = await import('../src/features/image-generation/image-generation-drafts')
  const { useNaiFormController } = await import('../src/features/image-generation/components/use-nai-form-controller')
  const { useDebouncedPersist } = await import('../src/lib/use-debounced-persist')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } })
  client.setQueryData(['runtime-language-settings'], { general: { language: 'en' } })
  client.setQueryData(['auth-status'], { authenticated: true, hasCredentials: true, accountId: 7 })
  const root = createRoot(document.getElementById('root')!)
  t.after(() => {
    client.clear()
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })

  let nai!: ReturnType<typeof useNaiFormController>
  function NaiPanel() {
    const value = useNaiFormController({ showSnackbar: () => {} })
    useLayoutEffect(() => { nai = value })
    return null
  }
  await act(async () => root.render(h(QueryClientProvider, { client }, h(I18nProvider, null, h(ConfirmProvider, null, h(NaiPanel))))))
  await act(async () => nai.setNaiForm((current) => ({ ...current, prompt: 'typed just before leaving' })))
  await act(async () => root.unmount())
  assert.equal(loadPersistedNaiFormDraft('account:7').form.prompt, 'typed just before leaving', 'unmount writes the pending NAI edit')

  // Codex uses the same hook: a pending edit is written for its own owner when the account changes, and on unmount.
  const writes: Array<[string, string]> = []
  const write = (owner: string, value: string) => { writes.push([owner, value]) }
  function Draft({ owner, value }: { owner: string; value: string }) {
    useDebouncedPersist(owner, value, write)
    return null
  }
  const second = createRoot(document.getElementById('root')!)
  await act(async () => second.render(h(Draft, { owner: 'one', value: 'first' })))
  await act(async () => second.render(h(Draft, { owner: 'one', value: 'first edit' })))
  await act(async () => second.render(h(Draft, { owner: 'two', value: 'other account' })))
  await act(async () => second.unmount())
  assert.deepEqual(writes, [['one', 'first edit'], ['two', 'other account']], 'pending edits go to their own owner, without waiting for the timer')
})

test('Comfy validation collects every required and numeric field issue', async () => {
  const { collectComfyFieldIssues } = await import('../src/features/image-generation/components/use-comfy-field-validation')
  const translate = (message: { en: string }) => message.en
  const fields = [
    { id: 'prompt', label: 'Prompt', type: 'text', required: true },
    { id: 'steps', label: 'Steps', type: 'number', required: false },
    { id: 'optional', label: 'Optional', type: 'number', required: false },
  ] as never
  const result = collectComfyFieldIssues(fields, { prompt: '', steps: 'not-a-number', optional: '' }, translate as never)
  assert.deepEqual(Object.keys(result.fieldIssues), ['prompt', 'steps'])
  assert.equal(result.summaries.length, 2)
})
