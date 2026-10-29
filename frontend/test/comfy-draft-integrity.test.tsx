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
