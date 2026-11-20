import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'

test('document saves finish independently of list refresh and preserve edits made during the write', async (t) => {
  // New documents briefly open the visual Markdown tab. Its Vite stylesheet and layout are outside this save test.
  const visualEditor = registerHooks({
    load: (url, context, next) => url.includes('/features/posts/post-rich-editor.tsx')
      ? { format: 'module', source: 'export function PostRichEditor() { return null }', shortCircuit: true }
      : next(url, context),
  })
  t.after(() => visualEditor.deregister())
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true })
  const globals = {
    window: dom.window, Window: dom.window.Window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement, Element: dom.window.Element,
    Node: dom.window.Node, NodeFilter: dom.window.NodeFilter, SVGElement: dom.window.SVGElement,
    MutationObserver: dom.window.MutationObserver, CustomEvent: dom.window.CustomEvent,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true,
  }
  dom.window.Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  dom.window.Range.prototype.getBoundingClientRect = () => new dom.window.DOMRect()
  const previous = Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value })
  const { act, createElement: h } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { QueryClient, QueryClientProvider, notifyManager } = await import('@tanstack/react-query')
  const { MemoryRouter } = await import('react-router-dom')
  const { EditorView } = await import('@codemirror/view')
  const { I18nProvider } = await import('../src/i18n')
  const { TooltipProvider } = await import('../src/components/ui/tooltip')
  const { ConfirmProvider } = await import('../src/components/ui/confirm-dialog')
  const { SnackbarContext } = await import('../src/components/ui/snackbar-context')
  const { TextDocumentEditor } = await import('../src/features/files/text-document-editor')
  const { ApiRequestError } = await import('../src/lib/api-request')
  await import('../src/components/common/plain-text-editor')
  notifyManager.setScheduler(queueMicrotask)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } })
  client.setQueryData(['runtime-language-settings'], { general: { language: 'ko' } })
  const entry = { id: 'document', name: 'document.txt' }
  client.setQueryData(['text-document-editor', 'test', entry.id], { text: 'original', revision: 'revision-1' })
  const messages: Array<{ message: string; tone?: string }> = []
  const writes: Array<{ text: string; revision: string | null }> = []
  let finishWrite!: (result: { document: typeof entry; revision: string }) => void
  let failWrite!: (error: Error) => void
  let finishLoad!: (result: { text: string; revision: string }) => void
  let failLoad!: (error: Error) => void
  let readId: string | undefined
  let failRefresh!: (error: Error) => void
  const refresh = new Promise<void>((_resolve, reject) => { failRefresh = reject })
  const store = {
    key: 'test',
    load: (document: typeof entry) => new Promise<{ text: string; revision: string }>((resolve, reject) => {
      readId = document.id; finishLoad = resolve; failLoad = reject
    }),
    save: (_document: typeof entry | null, text: string, revision: string | null) => {
      writes.push({ text, revision })
      return new Promise<{ document: typeof entry; revision: string }>((resolve, reject) => { finishWrite = resolve; failWrite = reject })
    },
    refresh: () => refresh,
  }
  const root = createRoot(document.getElementById('root')!)
  t.after(async () => {
    // Radix restores focus after unmount. Keep this window's CustomEvent until each open dialog has finished.
    const restored = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].map(dialog =>
      new Promise<void>(resolve => dialog.addEventListener('focusScope.autoFocusOnUnmount', () => resolve(), { once: true })))
    await act(async () => root.unmount())
    await Promise.all(restored)
    client.clear()
    notifyManager.setScheduler((callback) => setTimeout(callback, 0))
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
  const open = (opened: typeof entry | null) => act(async () => {
    root.render(h(QueryClientProvider, { client }, h(I18nProvider, null, h(MemoryRouter, null,
      h(TooltipProvider, null, h(ConfirmProvider, null, h(SnackbarContext.Provider, { value: { showSnackbar: (message) => messages.push(message), closeSnackbar: () => {} } },
        h(TextDocumentEditor, { key: opened?.id ?? 'new', entry: opened, store, onClose: () => {} }))))))))
  })
  await open(entry)
  const editor = () => EditorView.findFromDOM(document.querySelector('.cm-editor')!)!
  const edit = async (text: string) => act(async () => editor().dispatch({ changes: { from: 0, to: editor().state.doc.length, insert: text } }))
  const saveButton = () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.trim() === '저장')
  await edit('first draft')
  await act(async () => saveButton()!.click())
  await edit('later draft')
  await act(async () => finishWrite({ document: entry, revision: 'revision-2' }))

  assert.equal(editor().state.doc.toString(), 'later draft')
  assert.equal(saveButton()?.disabled, false, 'a completed write must not wait for the file list before allowing the next save')
  await act(async () => failRefresh(new Error('list unavailable')))
  assert.ok(messages.some(({ message }) => message.includes('저장했')), 'list refresh failure must not turn a committed write into a save failure')
  await act(async () => saveButton()!.click())
  assert.deepEqual(writes, [
    { text: 'first draft', revision: 'revision-1' },
    { text: 'later draft', revision: 'revision-2' },
  ])
  await act(async () => finishWrite({ document: entry, revision: 'revision-3' }))

  await edit('conflicting draft')
  await act(async () => saveButton()!.click())
  await act(async () => failWrite(new ApiRequestError('conflict', 409)))
  const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label)!
  const reload = async () => {
    await act(async () => button('최신본 불러오기').click())
    await act(async () => button('불러오기').click())
  }
  await reload()
  await act(async () => failLoad(new Error('read interrupted')))
  assert.equal(editor().state.doc.toString(), 'conflicting draft', 'a failed reload does not discard unsaved work')
  await reload()
  await act(async () => finishLoad({ text: 'another editor saved this', revision: 'revision-4' }))
  assert.equal(editor().state.doc.toString(), 'another editor saved this')
  assert.equal(saveButton()?.disabled, true)

  await open(null)
  await act(async () => saveButton()!.click())
  const created = { id: 'created-id', name: 'created.txt' }
  await act(async () => finishWrite({ document: created, revision: 'new-1' }))
  await edit('edited since creating')
  await act(async () => saveButton()!.click())
  await act(async () => failWrite(new ApiRequestError('conflict', 409)))
  await reload()
  assert.equal(readId, created.id, 'reload uses the saved document, not the original empty editor')
  await act(async () => finishLoad({ text: 'new document remote version', revision: 'new-2' }))
  assert.equal(editor().state.doc.toString(), 'new document remote version')
  assert.equal(saveButton()?.disabled, true)
})
