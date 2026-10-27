import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import type { ChatPageCommand, ChatPageSnapshot } from '@conai/shared'
import type { CodexChatMessage, CodexChatThreadDetail } from '../src/lib/api-codex-chat'

test('settings deep links preserve legacy destinations and search never exposes shared rows to guests', async () => {
  const { resolveSettingsLocation, parseSettingsTab } = await import('../src/features/settings/settings-tabs')
  const { SETTINGS_ROWS, searchSettingsRows, settingRowHref, pageSettingRow, PAGE_SETTINGS_SCOPES } = await import('@conai/shared')
  const redirects: Record<string, string> = {
    'section=chat&view=profiles': '/characters?view=profiles',
    'section=chat&view=resources': '/chat/resources',
    'section=chat&view=routines': '/chat/resources?tab=routines',
    'section=chat&view=mine': '/settings?section=mine',
    'section=llm&view=connections': '/settings?section=llm&group=connections',
    'section=chat&view=judge': '/settings?section=llm&group=log',
    'section=llm&view=content-evaluation': '/settings?section=posts&group=topics',
    'section=posts&view=knowledge': '/settings?section=posts&group=knowledge',
    'section=llm-connections': '/settings?section=llm&group=connections',
    'section=llm&setting=chat.diagnostics.captureRaw': '/settings?section=llm&setting=chat.diagnostics.captureRaw&group=log',
  }
  for (const [query, expected] of Object.entries(redirects)) assert.equal(resolveSettingsLocation(new URLSearchParams(query)), expected, query)
  for (const [old, section] of Object.entries({ appearance: 'general', integration: 'generation', 'integration-tools': 'generation', folders: 'library', metadata: 'library', security: 'accounts', 'image-save': 'media', 'llm-connections': 'llm' })) assert.equal(parseSettingsTab(old), section)
  assert.equal(resolveSettingsLocation(new URLSearchParams('section=generation&group=nai')), null)
  assert.equal(new Set(SETTINGS_ROWS.map(row => row.id)).size, SETTINGS_ROWS.length, 'registry IDs are unique')
  const allPermissions = [...new Set(SETTINGS_ROWS.map(row => row.permission))]
  assert.ok(searchSettingsRows('', { isAdmin: false, permissionKeys: allPermissions }).every(row => row.scope === 'mine'))
  assert.deepEqual(searchSettingsRows('NovelAI', { isAdmin: false, permissionKeys: allPermissions }), [])
  const advanced = searchSettingsRows('원문 기록', { isAdmin: true, permissionKeys: allPermissions })[0]
  assert.equal(advanced.id, 'chat.diagnostics.captureRaw')
  assert.equal(advanced.advanced, true)
  assert.equal(settingRowHref(advanced), '/settings?section=llm&group=log&setting=chat.diagnostics.captureRaw')
  assert.equal(pageSettingRow('general', PAGE_SETTINGS_SCOPES.general.fields[0]).label.ko, '갤러리 기능 사용')
})

test('room directory pages keep cursor order, off-page drafts and independent cached summaries', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true })
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value })
  const { act, createElement: h, useCallback, useEffect, useState } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
  const { patchChatRoomLists, useChatRoomPages, usePagedChatDraftRetention } = await import('../src/features/codex-chat/use-chat-room-directory')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const requests: URL[] = []
  let changed = false
  const room = (id: number, title: string) => ({ id, title, kind: 'direct', updated_date: '2026-10-20 00:00:00' })
  const fetchMock = t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = new URL(String(input), 'http://localhost')
    requests.push(url)
    const targeted = url.searchParams.has('ids')
    const cursor = url.searchParams.get('cursor')
    const data = targeted ? [room(90, 'Off-page draft')]
      : url.searchParams.get('query') === 'rare' ? [room(7, 'Rare match')]
        : url.searchParams.get('archive') === 'archived' ? [room(8, 'Archived room')]
          : cursor === 'last-page' ? [room(4, 'Fourth room'), room(5, 'Fifth room')]
            : cursor === 'next-page' ? [room(2, 'Stale duplicate'), room(3, changed ? 'Updated room' : 'Next room')]
              : changed ? [room(6, 'New room'), room(1, 'First room')]
                : [room(1, 'First room'), room(2, 'Latest duplicate')]
    const browsing = !targeted && !url.searchParams.has('query') && url.searchParams.get('archive') === 'active'
    const more = browsing && cursor !== 'last-page'
    return new Response(JSON.stringify({ success: true, data, pagination: { total: browsing ? changed ? 6 : 5 : data.length, has_more: more, next_cursor: more ? cursor === 'next-page' ? 'last-page' : 'next-page' : null }, has_automation: false, has_archived_chats: true, has_archived_automation: false }), { headers: { 'Content-Type': 'application/json' } })
  })
  const root = createRoot(document.getElementById('root')!)
  t.after(async () => {
    await act(async () => root.unmount())
    client.clear()
    fetchMock.mock.restore()
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
  let directory!: ReturnType<typeof useChatRoomPages>
  let search!: (value: string) => void
  let archive!: () => void
  let retained: number[] = []
  function Directory() {
    const [query, setQuery] = useState('')
    const [view, setView] = useState<'active' | 'archived'>('active')
    const page = useChatRoomPages({ archive: view, pinnedFirst: true, query, limit: 2 })
    const keep = useCallback((ids: number[]) => { retained = ids }, [])
    const retainDrafts = usePagedChatDraftRetention({ 90: 'keep me', 91: 'deleted room' }, keep)
    useEffect(() => {
      search = setQuery
      archive = () => { setQuery(''); setView('archived') }
      directory = page
      if (page.data) retainDrafts(page.rooms.map((room) => room.id))
    }, [retainDrafts, page])
    return null
  }
  await act(async () => { root.render(h(QueryClientProvider, { client }, h(Directory))); await new Promise(resolve => setTimeout(resolve, 30)) })
  await act(async () => { await directory.refetch(); await new Promise(resolve => setTimeout(resolve, 30)) })
  assert.deepEqual(directory.rooms.map((room) => room.id), [1, 2])
  assert.equal(directory.hasNextPage, true)
  assert.ok(retained.includes(90), 'a draft outside the page is retained when its targeted lookup succeeds')
  assert.ok(!retained.includes(91), 'only a confirmed missing room loses its draft')
  await act(async () => { await directory.fetchNextPage(); await new Promise(resolve => setTimeout(resolve, 20)) })
  assert.deepEqual(directory.rooms.map((room) => room.id), [1, 2, 3])
  assert.equal(directory.rooms[1].title, 'Latest duplicate')
  assert.equal(directory.hasNextPage, true)
  assert.ok(requests.some((url) => url.searchParams.get('cursor') === 'next-page'))
  client.setQueryData(['codex-chat-threads', 'unread'], 17)
  await act(async () => {
    patchChatRoomLists(client, 2, { pinned: 1 })
    await new Promise(resolve => setTimeout(resolve, 20))
  })
  assert.equal(directory.rooms[1].pinned, 1)
  assert.equal(client.getQueryData(['codex-chat-threads', 'unread']), 17, 'summary updates do not treat the aggregate badge as a room array')
  await act(async () => { await directory.fetchNextPage(); await new Promise(resolve => setTimeout(resolve, 30)) })
  await act(async () => { await directory.refetch(); await new Promise(resolve => setTimeout(resolve, 20)) })
  assert.equal(directory.data?.pages.length, 2, 'the refetched cursor window is bounded')
  assert.deepEqual(directory.rooms.map((room) => room.id), [1, 2, 3, 4, 5], 'the current first page survives cursor-window eviction')
  const beforeRefresh = requests.length
  changed = true
  await act(async () => { await client.invalidateQueries({ queryKey: ['codex-chat-threads'] }); await new Promise(resolve => setTimeout(resolve, 20)) })
  assert.equal(requests.slice(beforeRefresh).filter((url) => url.searchParams.has('limit')).length, 3, 'an event refreshes two cursor pages plus the independent head, not all browsed pages')
  assert.equal(directory.rooms[0].id, 6, 'new rooms outside the retained cursor window still appear')
  assert.equal(directory.rooms.find((room) => room.id === 3)?.title, 'Updated room')
  client.setQueryData(['codex-chat-threads', 'ids', [3, 90]], [room(3, 'Updated room'), room(90, 'Off-page draft')])
  await act(async () => { patchChatRoomLists(client, 3, null); await new Promise(resolve => setTimeout(resolve, 20)) })
  assert.ok(!directory.rooms.some((room) => room.id === 3), 'deletion removes a room from every cursor page')
  assert.deepEqual(client.getQueryData<Array<{ id: number }>>(['codex-chat-threads', 'ids', [3, 90]])?.map((room) => room.id), [90])
  await act(async () => { patchChatRoomLists(client, 6, null); await new Promise(resolve => setTimeout(resolve, 20)) })
  assert.ok(!directory.rooms.some((room) => room.id === 6), 'deletion also updates the independent head')
  await act(async () => { search('rare'); await new Promise(resolve => setTimeout(resolve, 20)) })
  await act(async () => { await directory.refetch(); await new Promise(resolve => setTimeout(resolve, 20)) })
  assert.deepEqual(directory.rooms.map((room) => room.id), [7], 'search has its own SQL cursor chain')
  await act(async () => { archive(); await new Promise(resolve => setTimeout(resolve, 20)) })
  await act(async () => { await directory.refetch(); await new Promise(resolve => setTimeout(resolve, 20)) })
  assert.deepEqual(directory.rooms.map((room) => room.id), [8])
  assert.ok(requests.every((url) => url.searchParams.has('ids') || url.searchParams.get('limit') === '2'), 'no interaction fetches the complete directory')
})

test('cursor pages merge without gaps, duplicates or stale-revision resurrection', async () => {
  const { mergeThreadTail, mergeThreadBefore } = await import('../src/lib/api-codex-chat')
  const detail = (ids: number[], count: number, revision = 0, more = true): CodexChatThreadDetail => ({
    thread: { id: 1, context_revision: revision } as CodexChatThreadDetail['thread'],
    messages: ids.map(id => ({ id } as CodexChatMessage)), media: {}, pendingJobs: 0, running: null,
    messagesFrom: more ? ids[0] : undefined, messageCount: count, hasMoreBefore: more,
  })
  const loaded = detail([81, 82, 83, 84], 84)
  const refreshed = mergeThreadTail(loaded, detail([83, 84, 85], 85))!
  assert.deepEqual(refreshed.messages.map(message => message.id), [81, 82, 83, 84, 85])
  assert.equal(refreshed.hasMoreBefore, true)
  assert.equal(mergeThreadTail(loaded, detail([87, 88], 88)), null)
  assert.equal(mergeThreadTail(loaded, detail([83, 84], 84, 1)), null)
  const earlier = detail([79, 80], 85)
  const merged = mergeThreadBefore(refreshed, earlier, 81)!
  assert.deepEqual(merged.messages.map(message => message.id), [79, 80, 81, 82, 83, 84, 85])
  assert.equal(mergeThreadBefore(merged, earlier, 81), null)
  assert.equal(mergeThreadBefore(refreshed, detail([79, 80], 85, 1), 81), null)
  const all = mergeThreadBefore(detail([3, 4], 4), detail([1, 2], 4, 0, false), 3)!
  assert.equal(all.hasMoreBefore, false)
  assert.equal(all.messagesFrom, undefined)
  const recent = detail(Array.from({ length: 80 }, (_, index) => 921 + index), 1000)
  const next = detail(Array.from({ length: 40 }, (_, index) => 963 + index), 1002)
  const routine = mergeThreadTail(recent, next)!
  assert.equal(routine.messages.length, 80, 'new replies must not grow the undemanded cached history')
  assert.equal(routine.messages[0].id, 923)
  const expanded = mergeThreadBefore(recent, detail([919, 920], 1000), 921)!
  assert.equal(mergeThreadTail(expanded, next)!.messages.length, 84, 'explicitly loaded history remains restorable')
})

test('transcript prepending preserves scroll and an unloaded message focus restores through older pages', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true })
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value })
  const { act, createElement: h, useCallback, useLayoutEffect, useState } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useChatTranscriptWindow } = await import('../src/features/codex-chat/use-chat-transcript-window')
  const root = createRoot(document.getElementById('root')!)
  t.after(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
  const messages = Array.from({ length: 240 }, (_, index) => ({ id: index + 1 } as CodexChatMessage))
  let transcript!: ReturnType<typeof useChatTranscriptWindow>
  let focus!: (value: { messageId: number; nonce: number } | null) => void
  let requests = 0
  let scrolledTo: string | null = null
  dom.window.HTMLElement.prototype.scrollIntoView = function () { scrolledTo = this.getAttribute('data-message-id') }
  function Transcript() {
    const [first, setFirst] = useState(160)
    const [messageFocus, setFocus] = useState<{ messageId: number; nonce: number } | null>(null)
    const loadEarlier = useCallback(async () => { requests++; setFirst(current => Math.max(0, current - 80)); return Math.max(1, first - 79) }, [first])
    const clearMessageFocus = useCallback(() => setFocus(null), [])
    const result = useChatTranscriptWindow({
      activeThreadId: 1001, messages: messages.slice(first), isTranscript: true, messageFocus, clearMessageFocus,
      liveTurn: null, serverReplyLength: 0, hasMoreBefore: first > 0, loadEarlier, loadingEarlier: false, earlierError: null,
    })
    useLayoutEffect(() => { transcript = result; focus = setFocus })
    const ref = useCallback((node: HTMLDivElement | null) => {
      result.scrollRef.current = node
      if (node) {
        Object.defineProperty(node, 'scrollHeight', { configurable: true, get: () => node.children.length * 10 })
        Object.defineProperty(node, 'clientHeight', { configurable: true, value: 100 })
      }
    }, [result.scrollRef])
    return h('div', { ref }, ...result.visibleMessages.map(message => h('div', { key: message.id, 'data-message-id': message.id }, String(message.id))))
  }
  await act(async () => root.render(h(Transcript)))
  const node = transcript.scrollRef.current!
  node.scrollTop = 250
  await act(async () => { await transcript.showEarlierMessages() })
  assert.equal(requests, 1)
  assert.equal(transcript.visibleMessages[0].id, 81)
  assert.equal(node.scrollTop, 1050)
  await act(async () => focus({ messageId: 20, nonce: 1 }))
  assert.equal(requests, 2)
  assert.equal(scrolledTo, '20')
  assert.equal(transcript.flashMessageId, 20)
})

test('streamed deltas publish once per frame, final text wins, and unmount cancels pending frames', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true })
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value })
  const frames = new Map<number, FrameRequestCallback>()
  let frameId = 0
  dom.window.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId }
  dom.window.cancelAnimationFrame = id => { frames.delete(id) }
  const { act, createElement: h, useLayoutEffect } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
  const { I18nProvider } = await import('../src/i18n')
  const { SnackbarContext } = await import('../src/components/ui/snackbar-context')
  const { CodexChatProvider } = await import('../src/features/codex-chat/codex-chat-provider')
  const { useCodexChat, useCodexChatLiveTurn, codexChatThreadQueryKey } = await import('../src/features/codex-chat/codex-chat-context')
  const { CHAT_STATUS_QUERY_KEY } = await import('../src/lib/api-codex-chat')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } })
  client.setQueryData(['auth-status'], { authenticated: true, hasCredentials: true, accountId: 1, permissionKeys: ['chat.use'] })
  client.setQueryData(['runtime-language-settings'], { general: { language: 'en' } })
  client.setQueryData(CHAT_STATUS_QUERY_KEY, { canUse: true })
  client.setQueryData(codexChatThreadQueryKey(1), { thread: { id: 1, kind: 'direct', flag_ids: '[]' }, messages: [], media: {}, running: null })
  const root = createRoot(document.getElementById('root')!)
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
  let api!: NonNullable<ReturnType<typeof useCodexChat>>
  const texts: Array<string | null> = []
  function Reader() {
    const chat = useCodexChat()!
    const live = useCodexChatLiveTurn()
    useLayoutEffect(() => { api = chat; texts.push(live?.text ?? null) }, [chat, live])
    return null
  }
  let output!: ReadableStreamDefaultController<Uint8Array>
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    assert.match(String(url), /\/threads\/1\/messages$/)
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        output = controller
        init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), { once: true })
      },
    }), { status: 200 })
  })
  await act(async () => root.render(h(QueryClientProvider, { client }, h(I18nProvider, null,
    h(SnackbarContext.Provider, { value: { showSnackbar() {}, closeSnackbar() {} } }, h(CodexChatProvider, null, h(Reader)))))))
  const tick = () => new Promise<void>(resolve => setImmediate(resolve))
  const sendEvents = (events: unknown[]) => output.enqueue(new TextEncoder().encode(events.map(event => JSON.stringify(event)).join('\n') + '\n'))
  let sending!: Promise<void>
  await act(async () => { sending = api.send(1, 'hello'); await tick() })
  const before = texts.length
  await act(async () => { sendEvents(Array.from({ length: 100 }, () => ({ type: 'delta', text: 'a' }))); await tick() })
  assert.equal(texts.length, before)
  assert.equal(frames.size, 1)
  await act(async () => { for (const [id, callback] of [...frames]) { frames.delete(id); callback(0) } })
  assert.equal(texts.length, before + 1)
  assert.equal(texts.at(-1), 'a'.repeat(100))
  await act(async () => {
    sendEvents([{ type: 'delta', text: 'discarded by final' }, { type: 'done', message: { id: 2, content: 'final', display_content: 'translated final', tool_calls: [] } }])
    await tick()
  })
  assert.equal(texts.at(-1), 'translated final')
  assert.equal(frames.size, 0)
  await act(async () => { output.close(); await sending })
  assert.equal(texts.at(-1), null)
  client.setQueryData<CodexChatThreadDetail>(codexChatThreadQueryKey(1), current => current ? { ...current, thread: { ...current.thread, kind: 'group' } } : current)
  await act(async () => { sending = api.send(1, 'group hello'); await tick() })
  assert.equal(api.currentLiveTurn()?.userText, 'group hello')
  await act(async () => {
    sendEvents([{ type: 'user', message: { id: 3, role: 'user', content: 'group hello', tool_calls: [] } }])
    await tick()
  })
  assert.equal(client.getQueryData<CodexChatThreadDetail>(codexChatThreadQueryKey(1))?.messages.at(-1)?.content, 'group hello')
  assert.equal(api.currentLiveTurn()?.userText, '', 'the stored group message replaces the live bubble without waiting for a frame')
  assert.equal(frames.size, 0)
  await act(async () => { output.close(); await sending })
  await act(async () => { sending = api.send(1, 'again'); await tick(); sendEvents([{ type: 'delta', text: 'pending' }]); await tick() })
  assert.equal(frames.size, 1)
  await act(async () => { root.unmount(); mounted = false; await sending })
  assert.equal(frames.size, 0)
})

test('page commands preserve draft undo, screen identity and reviewed saves', { timeout: 15000 }, async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true })
  class TestEventSource extends dom.window.EventTarget {
    static latest: TestEventSource
    constructor() { super(); TestEventSource.latest = this }
    close() {}
  }
  Object.defineProperty(dom.window, 'EventSource', { value: TestEventSource })
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, EventSource: TestEventSource, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value })
  const { act, createElement: h, useLayoutEffect, useState } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
  const { MemoryRouter } = await import('react-router-dom')
  const { I18nProvider } = await import('../src/i18n')
  const { SnackbarContext } = await import('../src/components/ui/snackbar-context')
  const { ChatPageProvider, useChatPage, useChatPageRegistration } = await import('../src/features/codex-chat/chat-page-context')
  const { pageAction, pageObject, pageText } = await import('../src/features/codex-chat/page-action-helpers')
  const { useChatDraftTransaction } = await import('../src/features/codex-chat/use-chat-draft-transaction')
  const { buildChatPageChanges } = await import('@conai/shared')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } })
  client.setQueryData(['auth-status'], { authenticated: true, hasCredentials: true, accountId: 1, permissionKeys: ['page.settings.view'] })
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
  let edit!: (value: string) => void
  let select!: (value: string) => void
  let currentValue = ''
  let saves = 0
  let pendingDraft: Promise<void> | undefined
  function Editor() {
    const api = useChatPage()!
    const [value, setValue] = useState('original')
    const [resource, setResource] = useState('one')
    const commit = useChatDraftTransaction(value, setValue)
    useLayoutEffect(() => { page = api; edit = setValue; select = setResource; currentValue = value }, [api, value])
    useChatPageRegistration({
      kind: 'settings', title: 'Editor', resourceId: resource, fields: [{ id: 'name', label: 'Name', type: 'text', value }],
      actions: [pageAction('profile.draft', 'Draft', '', pageObject({ value: pageText() }, ['value'])), pageAction('profile.save', 'Save', '', undefined, 'save')],
      apply: patch => setValue(String(patch.name)),
      applyAction: async (id, args, assertCurrent) => {
        if (id === 'profile.save') { saves++; return }
        if (pendingDraft) await pendingDraft
        assertCurrent()
        return commit(String(args.value))
      },
    })
    return null
  }
  await act(async () => root.render(h(QueryClientProvider, { client }, h(MemoryRouter, { initialEntries: ['/settings'] },
    h(I18nProvider, null, h(SnackbarContext.Provider, { value: { showSnackbar() {}, closeSnackbar() {} } }, h(ChatPageProvider, null, h(Editor))))))))
  await act(async () => page.toggle())
  let sequence = 0
  const replies = new Map<string, (answer: { ok: boolean; error?: string; page?: ChatPageSnapshot }) => void>()
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    const id = String(url).split('/page-commands/')[1]
    assert.ok(id && replies.has(id), `unexpected request: ${String(url)}`)
    replies.get(id)!(JSON.parse(String(init?.body)))
    return Response.json({ success: true, data: null })
  })
  async function send(command: ChatPageCommand) {
    const snapshot = page.capture()!
    const commandId = `command-${++sequence}`
    const answer = new Promise<{ ok: boolean; error?: string; page?: ChatPageSnapshot }>(resolve => replies.set(commandId, resolve))
    await act(async () => TestEventSource.latest.dispatchEvent(new dom.window.MessageEvent('chat.page.command', { data: JSON.stringify({
      name: 'chat.page.command', payload: { ...command, commandId, connectionId: snapshot.connectionId, instanceId: snapshot.instanceId, threadId: 1, expiresAt: Date.now() + 10000 },
    }) })))
    return { commandId, answer }
  }
  await t.test('field edits can be undone after their normal re-registration, but manual edits cannot be overwritten', async () => {
    const changes = buildChatPageChanges(page.capture()!, [{ fieldId: 'name', value: 'filled' }])
    const command = await send({ type: 'fields', changes })
    await act(async () => assert.equal((await command.answer).ok, true))
    assert.equal(currentValue, 'filled')
    await act(async () => page.undoActivity(command.commandId))
    assert.equal(currentValue, 'original')
    const second = await send({ type: 'fields', changes })
    await act(async () => assert.equal((await second.answer).ok, true))
    await act(async () => edit('manual'))
    assert.throws(() => page.undoActivity(second.commandId), /입력값/)
    assert.equal(currentValue, 'manual')
  })
  await t.test('a draft undo is bound to its editor even if another resource has the same values', async () => {
    const command = await send({ type: 'action', actionId: 'profile.draft', tier: 'draft', arguments: { value: 'filled' } })
    await act(async () => assert.equal((await command.answer).ok, true))
    await act(async () => select('two'))
    assert.throws(() => page.undoActivity(command.commandId), /페이지|화면/)
    assert.equal(currentValue, 'filled')
  })
  await t.test('draft transactions protect subsequent manual edits on the same screen', async () => {
    const command = await send({ type: 'action', actionId: 'profile.draft', tier: 'draft', arguments: { value: 'draft action' } })
    await act(async () => assert.equal((await command.answer).ok, true))
    await act(async () => edit('manual after action'))
    assert.throws(() => page.undoActivity(command.commandId), /입력이 바뀌어서/)
    assert.equal(currentValue, 'manual after action')
  })
  await t.test('an asynchronous draft cannot overwrite input changed while it was waiting', async () => {
    let release!: () => void
    pendingDraft = new Promise<void>(resolve => { release = resolve })
    const command = await send({ type: 'action', actionId: 'profile.draft', tier: 'draft', arguments: { value: 'stale' } })
    await act(async () => edit('newer manual edit'))
    let answer!: Awaited<typeof command.answer>
    await act(async () => { release(); answer = await command.answer })
    pendingDraft = undefined
    assert.equal(answer.ok, false)
    assert.equal(currentValue, 'newer manual edit')
  })
  await t.test('a model command cannot execute a save without the review flow', async () => {
    const command = await send({ type: 'action', actionId: 'profile.save', tier: 'draft', arguments: {} })
    await act(async () => assert.equal((await command.answer).ok, false))
    assert.equal(saves, 0)
  })
})
