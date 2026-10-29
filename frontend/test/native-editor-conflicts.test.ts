import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import type { PromptPresetRecord } from '../src/lib/api-prompt-presets'
import type { WildcardRecord } from '../src/lib/api-wildcards'

test('native preset and wildcard editors retain their draft and read revision across a query refresh', async (t) => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true })
  Object.defineProperty(dom.window, 'matchMedia', { value: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }) })
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement, Element: dom.window.Element,
    Node: dom.window.Node, NodeFilter: dom.window.NodeFilter, SVGElement: dom.window.SVGElement,
    MutationObserver: dom.window.MutationObserver, CustomEvent: dom.window.CustomEvent,
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true,
  }
  const previous = Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value })
  const { act, createElement: h } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
  const { MemoryRouter } = await import('react-router-dom')
  const { I18nProvider } = await import('../src/i18n')
  const { promptsCatalog } = await import('../src/i18n/resources/prompts')
  const { imageGenerationCatalog } = await import('../src/i18n/resources/image-generation')
  const { TooltipProvider } = await import('../src/components/ui/tooltip')
  const { ConfirmProvider } = await import('../src/components/ui/confirm-dialog')
  const { SnackbarContext } = await import('../src/components/ui/snackbar-context')
  const { PromptPresetPanel } = await import('../src/features/prompts/components/prompt-preset-panel')
  const { WildcardGenerationPanel } = await import('../src/features/image-generation/components/wildcard-generation-panel')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } })
  client.setQueryData(['auth-status'], { authenticated: true, hasCredentials: true, permissionKeys: ['prompts.edit', 'wildcards.edit'] })
  client.setQueryData(['runtime-language-settings'], { general: { language: 'ko' } })
  client.setQueryData(['global-appearance-settings'], {})
  client.setQueryData(['wildcards', 'lora-scan-log'], null)
  let preset: PromptPresetRecord = {
    id: 1, name: 'Fixture preset', parent_id: null, created_date: '', updated_date: '', assistant_revision: 'preset-1',
    items: [{ id: 1, preset_id: 1, description: 'Style', value: 'preset original', order_index: 0, created_date: '' }],
  }
  let wildcard: WildcardRecord = {
    id: 2, name: 'Fixture wildcard', parent_id: null, include_children: 0, only_children: 0, type: 'wildcard', chain_option: 'replace',
    created_date: '', updated_date: '', assistant_revision: 'wildcard-1',
    items: [{ id: 2, wildcard_id: 2, tool: 'general', content: 'wildcard original', weight: 1, order_index: 0, created_date: '' }],
  }
  const messages: string[] = []
  const writes: Array<{ url: string; revision: string | undefined; body: Record<string, unknown> }> = []
  const conflict = '다른 작업에서 저장한 내용이 바뀌었어. 새로 읽고 다시 제안받아줘.'
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === 'PUT') {
      const isPreset = url === '/api/prompt-presets/1'
      assert.ok(isPreset || url === '/api/wildcards/2')
      const revision = (init.headers as Record<string, string>)['If-Match']
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      writes.push({ url, revision, body })
      const current = isPreset ? preset : wildcard
      if (revision !== current.assistant_revision) return Response.json({ success: false, code: 'revision_conflict', error: conflict }, { status: 409 })
      if (isPreset) {
        const items = body.items as Array<{ description: string; value: string }>
        preset = { ...preset, name: String(body.name), assistant_revision: 'preset-saved', items: items.map((item, index) => ({ ...item, id: 10 + index, preset_id: 1, order_index: index, created_date: '' })) }
        return Response.json({ success: true, data: preset })
      }
      const items = body.items as { general: Array<{ content: string; weight: number }> }
      wildcard = { ...wildcard, name: String(body.name), assistant_revision: 'wildcard-saved', items: items.general.map((item, index) => ({ ...item, id: 20 + index, wildcard_id: 2, tool: 'general', order_index: index, created_date: '' })) }
      return Response.json({ success: true, data: wildcard })
    }
    if (url.startsWith('/api/prompt-presets')) return Response.json({ success: true, data: [preset] })
    if (url === '/api/wildcards/2') return Response.json({ success: true, data: wildcard })
    if (url.startsWith('/api/wildcards?')) return Response.json({ success: true, data: [wildcard] })
    throw new Error(`Unexpected request: ${url}`)
  })
  const root = createRoot(document.getElementById('root')!)
  const settle = () => new Promise((resolve) => setTimeout(resolve, 30))
  const render = async (view: 'preset' | 'wildcard') => {
    const panel = view === 'preset'
      ? h(PromptPresetPanel, { toolbarProps: { view: 'presets', promptType: 'positive', canViewWildcards: true, onChangeView: () => {} } })
      : h(WildcardGenerationPanel, { refreshNonce: 0 })
    await act(async () => {
      root.render(h(QueryClientProvider, { client }, h(I18nProvider, { catalog: { ...promptsCatalog, ...imageGenerationCatalog } },
        h(MemoryRouter, null, h(TooltipProvider, null, h(ConfirmProvider, null,
          h(SnackbarContext.Provider, { value: { showSnackbar: ({ message }) => messages.push(message), closeSnackbar: () => {} } }, panel)))))))
      await settle()
    })
  }
  const click = async (button: HTMLButtonElement | null | undefined) => {
    assert.ok(button)
    await act(async () => { button.click(); await settle() })
  }
  const byLabel = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  const openEditor = async (view: 'preset' | 'wildcard') => {
    if (view === 'preset') {
      await click([...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Fixture preset'))
    }
    const button = byLabel(view === 'preset' ? '프리셋 편집' : '편집')
    assert.ok(button, `${view} edit button missing: ${[...document.querySelectorAll('button[aria-label]')].map((item) => item.getAttribute('aria-label')).join(', ')}`)
    await click(button)
  }
  const fieldWithValue = (value: string) => [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('form input, form textarea')].find((field) => field.value === value)
  const edit = async (field: HTMLInputElement | HTMLTextAreaElement | undefined, value: string) => {
    assert.ok(field)
    const prototype = field instanceof dom.window.HTMLTextAreaElement ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype
    await act(async () => {
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value)
      field.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      await settle()
    })
  }
  const submit = async () => {
    const form = document.querySelector<HTMLFormElement>('[role="dialog"] form')
    assert.ok(form)
    const save = form.querySelector<HTMLButtonElement>('button[type="submit"]')
    assert.ok(save && !save.disabled)
    await act(async () => { form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await settle() })
  }
  t.after(async () => {
    try {
      await act(async () => root.unmount())
    } finally {
      client.clear()
      dom.window.close()
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else Reflect.deleteProperty(globalThis, key)
      }
    }
  })

  for (const view of ['preset', 'wildcard'] as const) {
    client.setQueryData(['prompt-presets', 'hierarchical'], [preset])
    client.setQueryData(['wildcards', 'library'], [wildcard])
    client.setQueryData(['wildcards', 'detail', 2], wildcard)
    await render(view)
    await openEditor(view)
    const original = `${view} original`
    const draft = `${view} human draft`
    await edit(fieldWithValue(original), draft)

    if (view === 'preset') {
      preset = { ...preset, assistant_revision: 'preset-2', items: [{ ...preset.items![0], value: 'preset assistant' }] }
      await act(async () => { client.setQueryData(['prompt-presets', 'hierarchical'], [preset]); await settle() })
    } else {
      wildcard = { ...wildcard, assistant_revision: 'wildcard-2', items: [{ ...wildcard.items![0], content: 'wildcard assistant' }] }
      await act(async () => { client.setQueryData(['wildcards', 'detail', 2], wildcard); await settle() })
    }
    assert.ok(fieldWithValue(draft), 'refresh must not replace the open draft')
    await submit()
    assert.equal(writes.at(-1)?.revision, `${view}-1`, 'the write uses the revision captured when the draft opened')
    assert.ok(fieldWithValue(draft), 'the rejected save leaves the draft in the editor')
    assert.equal(view === 'preset' ? preset.items![0].value : wildcard.items![0].content, `${view} assistant`)
    await submit()
    assert.equal(writes.at(-1)?.revision, `${view}-1`, 'a plain retry keeps the stale token and is refused again')

    // The conflict offers a way out: overwrite with this draft, using the stored record's current token.
    const overwrite = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent?.trim() === '내 내용으로 덮어쓰기')
    await click(overwrite)
    assert.equal(writes.at(-1)?.revision, `${view}-2`, 'overwrite reads the latest revision first')
    assert.equal(view === 'preset' ? preset.items![0].value : wildcard.items![0].content, draft, 'the draft replaces the newer version')
    assert.equal(document.querySelector('[role="dialog"] form'), null, 'a successful overwrite closes the editor')

    await act(async () => root.render(null))
    await render(view)
    await openEditor(view)
    await edit(fieldWithValue(draft), `${view} fresh edit`)
    await submit()
    assert.equal(writes.at(-1)?.revision, `${view}-saved`, 'a newly opened draft uses the latest read revision')
    assert.equal(view === 'preset' ? preset.items![0].value : wildcard.items![0].content, `${view} fresh edit`)
    assert.equal(document.querySelector('[role="dialog"] form'), null, 'a successful save closes the editor')

    await act(async () => root.render(null))
    if (view === 'preset') client.setQueryData(['prompt-presets', 'hierarchical'], [{ ...preset, assistant_revision: undefined }])
    else client.setQueryData(['wildcards', 'detail', 2], { ...wildcard, assistant_revision: undefined })
    await render(view)
    await openEditor(view)
    assert.equal(document.querySelector('[role="dialog"] form'), null, 'editing without a read revision must not fall back to an unchecked save')
    assert.equal(messages.at(-1), '편집 정보를 불러오지 못했어. 새로고침해줘.')
    await act(async () => root.render(null))
  }
})
