import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import type { PostDetail } from '@conai/shared'

// The draft under test is the title and fields; the lazily loaded visual body editor (Milkdown, a Vite stylesheet,
// layout measurements jsdom lacks) is replaced by an empty component.
registerHooks({
  load: (url, context, next) => url.includes('/features/posts/post-rich-editor.tsx')
    ? { format: 'module', source: 'export function PostRichEditor() { return null }', shortCircuit: true }
    : next(url, context),
})

test('post editor keeps the draft through a save conflict and asks before discarding it', async (t) => {
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true })
  Object.defineProperty(dom.window, 'matchMedia', { value: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }) })
  const globals = {
    window: dom.window, Window: dom.window.Window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, Element: dom.window.Element,
    Node: dom.window.Node, NodeFilter: dom.window.NodeFilter, MutationObserver: dom.window.MutationObserver,
    CustomEvent: dom.window.CustomEvent, ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true,
  }
  const previous = Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value })
  const { act, createElement: h } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
  const { MemoryRouter } = await import('react-router-dom')
  const { I18nProvider } = await import('../src/i18n')
  const { TooltipProvider } = await import('../src/components/ui/tooltip')
  const { ConfirmProvider } = await import('../src/components/ui/confirm-dialog')
  const { SnackbarContext } = await import('../src/components/ui/snackbar-context')
  const { PostEditor } = await import('../src/features/posts/post-editor')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } })
  client.setQueryData(['auth-status'], { authenticated: true, hasCredentials: true, accountId: 1, isAdmin: false, permissionKeys: ['posts.write'] })
  client.setQueryData(['runtime-language-settings'], { general: { language: 'ko' } })
  client.setQueryData(['post-settings'], { topicEvaluation: { autoEnabled: false }, knowledge: { enabled: true }, layout: 'feed' })
  const opened = {
    id: 5, revision: 2, title: 'Opened title', body: 'Opened body', categoryId: null, tags: [], status: 'published', commentMode: 'open', pinned: false,
    canEdit: true, knowledge: null,
  } as unknown as PostDetail
  let stored = { ...opened, title: 'Someone else', revision: 3 }
  const patches: Array<{ expectedRevision: number; title: string }> = []
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/api/posts/5') && init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as { expectedRevision: number; title: string }
      patches.push(body)
      if (body.expectedRevision !== stored.revision) return Response.json({ success: false, error: '다른 곳에서 먼저 고쳤어.' }, { status: 409 })
      stored = { ...stored, title: body.title, revision: stored.revision + 1 }
      return Response.json({ success: true, data: stored })
    }
    if (url.endsWith('/api/posts/5')) return Response.json({ success: true, data: stored })
    return Response.json({ success: true, data: [] })
  })
  const root = createRoot(document.getElementById('root')!)
  const settle = () => new Promise((resolve) => setTimeout(resolve, 30))
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
  const saved: PostDetail[] = []
  let cancels = 0
  const render = async () => {
    await act(async () => {
      root.render(h(QueryClientProvider, { client }, h(I18nProvider, null, h(MemoryRouter, { initialEntries: ['/posts?edit=5'] }, h(TooltipProvider, null, h(ConfirmProvider, null,
        h(SnackbarContext.Provider, { value: { showSnackbar: () => {}, closeSnackbar: () => {} } },
          h(PostEditor, { key: Math.random(), post: opened, categories: [], defaultCategoryId: null, onSaved: (post: PostDetail) => saved.push(post), onCancel: () => { cancels += 1 } }))))))))
      await settle()
    })
  }
  const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.trim() === text)
  const click = async (target: HTMLButtonElement | undefined) => {
    assert.ok(target)
    await act(async () => { target.click(); await settle() })
  }
  const title = () => document.querySelector<HTMLInputElement>('input[aria-label="제목"]')!
  const typeTitle = async (value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(title(), value)
      title().dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      await settle()
    })
  }

  await render()
  await typeTitle('My title')
  await click(button('저장'))
  assert.equal(patches.at(-1)?.expectedRevision, 2, 'the save uses the revision the draft was opened from')
  assert.equal(title().value, 'My title', 'the refused save keeps the draft')
  await click(button('저장'))
  assert.equal(patches.at(-1)?.expectedRevision, 2, 'a plain retry is refused again')
  assert.equal(saved.length, 0)

  await click(button('최신본 불러오고 내 글 유지'))
  assert.equal(title().value, 'My title', 'loading the latest version keeps the typed text')
  await click(button('저장'))
  assert.deepEqual(patches.at(-1), { ...patches.at(-1), expectedRevision: 3, title: 'My title' })
  assert.equal(saved.length, 1, 'the rebased draft saves over the newer version')

  await render()
  await typeTitle('Unsaved')
  await click(button('취소'))
  assert.equal(cancels, 0, 'cancel asks before discarding a dirty draft')
  await click([...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button, [role="dialog"] button')].find((item) => item.textContent?.trim() === '버리기'))
  assert.equal(cancels, 1, 'confirming discards and leaves')
})
