import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { JSDOM } from 'jsdom'

/**
 * A jsdom window as the global one for this test. The teardown unmounts the app, drops the query client (mutation GC
 * timers included, so the process can exit) and only then restores the globals.
 */
async function useDom(t: TestContext) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true })
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value })
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { QueryClient } = await import('@tanstack/react-query')
  const root = createRoot(dom.window.document.getElementById('root')!)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity }, mutations: { retry: false } } })
  client.setQueryData(['runtime-language-settings'], { general: { language: 'en' } })
  t.after(async () => {
    await act(async () => root.unmount())
    for (const mutation of client.getMutationCache().getAll()) mutation.destroy()
    client.clear()
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
  return { dom, root, client }
}

const json = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
const tick = () => new Promise<void>(resolve => setImmediate(resolve))

test('a new chat sends the references and images picked while it was prepared, without showing the picker between', { timeout: 10000 }, async t => {
  const { root, client } = await useDom(t)
  const { act, createElement: h, useLayoutEffect } = await import('react')
  const { QueryClientProvider } = await import('@tanstack/react-query')
  const { I18nProvider } = await import('../src/i18n')
  const { SnackbarContext } = await import('../src/components/ui/snackbar-context')
  const { CodexChatProvider } = await import('../src/features/codex-chat/codex-chat-provider')
  const { useCodexChat } = await import('../src/features/codex-chat/codex-chat-context')
  const { CHAT_STATUS_QUERY_KEY } = await import('../src/lib/api-codex-chat')
  client.setQueryData(['auth-status'], { authenticated: true, hasCredentials: true, accountId: 1, permissionKeys: ['chat.use'] })
  client.setQueryData(CHAT_STATUS_QUERY_KEY, { canUse: true })
  const hash = 'a'.repeat(48)
  let sent: { text: string; mediaHashes: string[] } | null = null
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url)
    if (path.endsWith('/profiles/7/greeting')) return json({ index: 0, text: 'Hi', greetings: ['Hi'], userProfileId: null, before: [], after: [] })
    if (path.endsWith('/api/codex-chat/threads') && init?.method === 'POST') return json({ id: 5, kind: 'direct', profile_id: 7, title: '', flag_ids: null })
    if (path.includes('/threads/5?tail=80')) return json({ thread: { id: 5, kind: 'direct', profile_id: 7, flag_ids: null }, messages: [], media: {}, running: null })
    if (path.endsWith('/threads/5/messages')) {
      sent = JSON.parse(String(init?.body))
      return new Response(new ReadableStream({ start(controller) { controller.close() } }), { status: 200 })
    }
    return json([])
  })
  let api!: NonNullable<ReturnType<typeof useCodexChat>>
  const screens: Array<{ selected: number | null | undefined; pending: boolean }> = []
  function Reader() {
    const chat = useCodexChat()!
    useLayoutEffect(() => { api = chat; screens.push({ selected: chat.selectedThreadId, pending: chat.pendingChat !== null }) }, [chat])
    return null
  }
  await act(async () => root.render(h(QueryClientProvider, { client }, h(I18nProvider, null,
    h(SnackbarContext.Provider, { value: { showSnackbar() {}, closeSnackbar() {} } }, h(CodexChatProvider, null, h(Reader)))))))

  await act(async () => { api.prepareChat(7); await tick() })
  assert.ok(api.pendingChat?.greeting, 'the prepared chat shows its greeting')
  await act(async () => {
    api.togglePostReference({ postId: 12, commentId: null, label: 'Plan' })
    api.setMediaAttachments([{ compositeHash: hash, name: 'image', mimeType: 'image/png' }])
  })
  const prepared = screens.length
  // Only references and an image, no text: the first send must still carry them.
  await act(async () => { await api.sendPending('') })

  assert.ok(sent, 'the first message was sent')
  assert.match(sent!.text, /\[Plan\]\(post:12\)/)
  assert.deepEqual(sent!.mediaHashes, [hash])
  assert.equal(api.selectedThreadId, 5)
  assert.equal(api.pendingChat, null)
  assert.ok(screens.slice(prepared).every(screen => screen.pending || screen.selected !== null), 'no frame between the prepared and the saved chat shows the new-chat picker')
})

test('a saved chat setting is never reverted by a read sent before the save, and that read is sent again', { timeout: 10000 }, async () => {
  const { QueryClient, QueryObserver } = await import('@tanstack/react-query')
  const { applyChatThreadUpdate } = await import('../src/features/codex-chat/chat-query-refresh')
  const { codexChatThreadQueryKey } = await import('../src/features/codex-chat/codex-chat-context')
  type Detail = import('../src/lib/api-codex-chat').CodexChatThreadDetail
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } })
  const key = codexChatThreadQueryKey(5)
  const detail = (note: string | null, messages: number[]) => ({ thread: { id: 5, author_note: note, context_revision: 1 }, messages: messages.map(id => ({ id })), media: {} }) as unknown as Detail
  const reads: Array<{ answer: (value: Detail) => void }> = []
  const observer = new QueryObserver<Detail>(client, { queryKey: key, queryFn: () => new Promise<Detail>(resolve => { reads.push({ answer: resolve }) }) })
  client.setQueryData(key, detail(null, [1]))
  const unsubscribe = observer.subscribe(() => {})
  try {
    void client.refetchQueries({ queryKey: key, exact: true })
    assert.equal(reads.length, 1, 'a read is on the way')
    await applyChatThreadUpdate(client, { id: 5, author_note: 'saved', context_revision: 1 } as unknown as Detail['thread'])
    // The read sent before the save lands late with the old note.
    reads[0].answer(detail(null, [1, 2]))
    await tick()
    assert.equal(client.getQueryData<Detail>(key)?.thread.author_note, 'saved')
    assert.equal(reads.length, 2, 'the interrupted read is sent again')
    reads[1].answer(detail('saved', [1, 2]))
    await tick()
    const latest = client.getQueryData<Detail>(key)!
    assert.equal(latest.thread.author_note, 'saved')
    assert.deepEqual(latest.messages.map(message => message.id), [1, 2], 'the messages it would have brought still arrive')
  } finally {
    unsubscribe()
    client.clear()
  }
})

test("the author's note keeps what is typed while an earlier save is on the way", { timeout: 10000 }, async t => {
  const { dom, root, client } = await useDom(t)
  const { act, createElement: h } = await import('react')
  const { QueryClientProvider, useQuery } = await import('@tanstack/react-query')
  const { I18nProvider } = await import('../src/i18n')
  const { SnackbarContext } = await import('../src/components/ui/snackbar-context')
  const { AuthorNoteBlock } = await import('../src/features/codex-chat/codex-chat-context-view')
  const { codexChatThreadQueryKey } = await import('../src/features/codex-chat/codex-chat-context')
  type Detail = import('../src/lib/api-codex-chat').CodexChatThreadDetail
  const thread = { id: 5, kind: 'direct', author_note: null, author_note_depth: null } as unknown as Detail['thread']
  client.setQueryData<Detail>(codexChatThreadQueryKey(5), { thread, messages: [], media: {} } as unknown as Detail)
  const saves: Array<{ note: string | null; answer: () => void }> = []
  t.mock.method(globalThis, 'fetch', (url: string | URL | Request, init?: RequestInit) => {
    assert.match(String(url), /\/threads\/5\/context$/)
    const note = (JSON.parse(String(init?.body)) as { authorNote: string | null }).authorNote
    return new Promise<Response>(resolve => { saves.push({ note, answer: () => resolve(json({ ...thread, author_note: note })) }) })
  })
  function Note() {
    const detail = useQuery<Detail>({ queryKey: codexChatThreadQueryKey(5), queryFn: () => { throw new Error('seeded') }, enabled: false }).data
    return detail ? h(AuthorNoteBlock, { thread: detail.thread, defaults: { note: '', depth: null } }) : null
  }
  await act(async () => root.render(h(QueryClientProvider, { client }, h(I18nProvider, null,
    h(SnackbarContext.Provider, { value: { showSnackbar() {}, closeSnackbar() {} } }, h(Note))))))
  const textarea = document.querySelector('textarea')!
  const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!
  const type = (value: string) => act(async () => {
    setValue.call(textarea, value)
    textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  const waitForSave = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 700)) })

  await type('abc')
  await waitForSave()
  assert.deepEqual(saves.map(save => save.note), ['abc'])
  await type('abcd')
  await act(async () => { saves[0].answer(); await tick(); await tick() })
  assert.equal(textarea.value, 'abcd', 'the save of an earlier text does not erase what was typed since')
  await waitForSave()
  assert.deepEqual(saves.map(save => save.note), ['abc', 'abcd'])
  await act(async () => { saves[1].answer(); await tick(); await tick() })
  assert.equal(textarea.value, 'abcd')
  assert.equal(client.getQueryData<Detail>(codexChatThreadQueryKey(5))?.thread.author_note, 'abcd', 'the saved thread is patched into the open chat')
})
