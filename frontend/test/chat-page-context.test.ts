import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import type { ChatPageCommand, ChatPageSnapshot } from '@conai/shared'

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
