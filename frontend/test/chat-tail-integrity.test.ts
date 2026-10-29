import assert from 'node:assert/strict'
import { test } from 'node:test'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { applyChatThreadDetail, runChatThreadDetailMutation } from '../src/features/codex-chat/chat-query-refresh'
import { codexChatThreadQueryKey } from '../src/features/codex-chat/codex-chat-context'
import type { CodexChatMessage, CodexChatThreadDetail } from '../src/lib/api-codex-chat'

const message = (id: number, content = `message ${id}`) => ({ id, thread_id: 5, content }) as CodexChatMessage
const detail = (first: number, last: number, revision: number, total = last) => ({
  thread: { id: 5, context_revision: revision },
  messages: Array.from({ length: last - first + 1 }, (_, index) => message(first + index)),
  media: {}, pendingJobs: 0, running: null,
  ...(first > 1 ? { messagesFrom: first, messageCount: total, hasMoreBefore: true } : {}),
}) as CodexChatThreadDetail
const key = codexChatThreadQueryKey(5)
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } })

test('old reply edits and variant switches patch the loaded history; group changes preserve it and clear resets it', async () => {
  const queryClient = client()
  try {
    queryClient.setQueryData(key, { ...detail(1, 200, 10), historyLoaded: true })
    const edit = { ...detail(121, 200, 11), previousContextRevision: 10, changedMessage: message(5, 'edited') }
    await applyChatThreadDetail(queryClient, edit)
    let cached = queryClient.getQueryData<CodexChatThreadDetail>(key)!
    assert.deepEqual(cached.messages.map(entry => entry.id), Array.from({ length: 200 }, (_, i) => i + 1))
    assert.equal(cached.messages[4].content, 'edited')

    const variant = { ...detail(121, 200, 13), previousContextRevision: 11, changedMessage: { ...message(5, 'variant'), active_alternative: 1 } }
    await applyChatThreadDetail(queryClient, variant)
    cached = queryClient.getQueryData<CodexChatThreadDetail>(key)!
    assert.equal(cached.messages[4].content, 'variant')
    assert.equal(cached.messages[4].active_alternative, 1)
    assert.equal(cached.messages.length, 200)

    const group = { ...detail(121, 200, 13), group: { memberIds: [7, 9] } } as CodexChatThreadDetail
    await applyChatThreadDetail(queryClient, group)
    cached = queryClient.getQueryData<CodexChatThreadDetail>(key)!
    assert.deepEqual(cached.group?.memberIds, [7, 9])
    assert.equal(cached.messages[4].content, 'variant')
    assert.equal(cached.messages.length, 200)

    const cleared = { ...detail(1, 0, 14), hasMoreBefore: false }
    await applyChatThreadDetail(queryClient, cleared)
    assert.deepEqual(queryClient.getQueryData<CodexChatThreadDetail>(key)!.messages, [])
  } finally {
    queryClient.clear()
  }
})

test('an intervening rewrite refreshes the loaded range before showing an old edited reply', async t => {
  const queryClient = client()
  try {
    queryClient.setQueryData(key, { ...detail(41, 200, 5), historyLoaded: true })
    const serverPage = detail(41, 120, 8, 200)
    serverPage.messages[14] = message(55, 'edited after another rewrite')
    serverPage.messages[19] = message(60, 'other rewrite')
    let reads = 0
    t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
      assert.match(String(url), /threads\/5\?tail=80&before=121/)
      reads += 1
      return Response.json({ success: true, data: serverPage })
    })
    await applyChatThreadDetail(queryClient, {
      ...detail(121, 200, 8), previousContextRevision: 7, changedMessage: message(55, 'edited after another rewrite'),
    })
    const cached = queryClient.getQueryData<CodexChatThreadDetail>(key)!
    assert.equal(reads, 1)
    assert.deepEqual(cached.messages.map(entry => entry.id), Array.from({ length: 160 }, (_, i) => i + 41))
    assert.equal(cached.messages[14].content, 'edited after another rewrite')
    assert.equal(cached.messages[19].content, 'other rewrite')
  } finally {
    queryClient.clear()
  }
})

test('restoring an edited old reply continues when an older page lands at the same time', async t => {
  const queryClient = client()
  try {
    queryClient.setQueryData(key, { ...detail(41, 200, 5), historyLoaded: true })
    let reads = 0
    t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
      reads += 1
      if (reads === 1) {
        assert.match(String(url), /before=121/)
        queryClient.setQueryData(key, { ...detail(81, 200, 8), historyLoaded: true })
        return Response.json({ success: true, data: detail(41, 120, 8, 200) })
      }
      assert.match(String(url), /before=81/)
      const page = detail(1, 80, 8, 200)
      page.messages[54] = message(55, 'edited')
      return Response.json({ success: true, data: page })
    })
    await applyChatThreadDetail(queryClient, {
      ...detail(121, 200, 8), previousContextRevision: 7, changedMessage: message(55, 'edited'),
    })
    const cached = queryClient.getQueryData<CodexChatThreadDetail>(key)!
    assert.equal(reads, 2)
    assert.equal(cached.messages[54].content, 'edited')
    assert.deepEqual(cached.messages.map(entry => entry.id), Array.from({ length: 200 }, (_, i) => i + 1))
  } finally {
    queryClient.clear()
  }
})

test('a group change survives an in-flight older thread read without losing its messages', async () => {
  const queryClient = client()
  const reads: Array<{ answer: (value: CodexChatThreadDetail) => void }> = []
  const observer = new QueryObserver<CodexChatThreadDetail>(queryClient, {
    queryKey: key, queryFn: () => new Promise(resolve => reads.push({ answer: resolve })),
  })
  queryClient.setQueryData(key, { ...detail(1, 100, 2), historyLoaded: true })
  const unsubscribe = observer.subscribe(() => {})
  try {
    void queryClient.refetchQueries({ queryKey: key, exact: true })
    const changed = { ...detail(21, 100, 2), group: { memberIds: [7, 9] } } as CodexChatThreadDetail
    await applyChatThreadDetail(queryClient, changed)
    reads[0].answer(detail(1, 100, 2))
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(reads.length, 2)
    assert.deepEqual(queryClient.getQueryData<CodexChatThreadDetail>(key)?.group?.memberIds, [7, 9])
    reads[1].answer({ ...detail(1, 100, 2), group: changed.group })
    await new Promise<void>(resolve => setImmediate(resolve))
    const cached = queryClient.getQueryData<CodexChatThreadDetail>(key)!
    assert.deepEqual(cached.group?.memberIds, [7, 9])
    assert.equal(cached.messages.length, 100)
  } finally {
    unsubscribe()
    queryClient.clear()
  }
})

test('a late reply edit refreshes the changed old message and tail without overwriting newer cache data', async t => {
  const queryClient = client()
  try {
    queryClient.setQueryData(key, { ...detail(1, 200, 10), historyLoaded: true })
    let answer!: (value: CodexChatThreadDetail) => void
    const pending = runChatThreadDetailMutation(queryClient, 5, () => new Promise(resolve => { answer = resolve }))
    const newer = detail(1, 200, 10)
    newer.messages[49] = message(50, 'newer event')
    queryClient.setQueryData(key, { ...newer, historyLoaded: true })
    let reads = 0
    t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
      reads += 1
      if (String(url).includes('before=6')) {
        const page = detail(5, 5, 11, 200)
        page.messages[0] = message(5, 'edited with latest results')
        return Response.json({ success: true, data: page })
      }
      assert.match(String(url), /threads\/5\?tail=80$/)
      return Response.json({ success: true, data: detail(121, 200, 11) })
    })
    answer({ ...detail(121, 200, 11), previousContextRevision: 10, changedMessage: message(5, 'edited with stale results') })
    await pending
    const cached = queryClient.getQueryData<CodexChatThreadDetail>(key)!
    assert.equal(reads, 2)
    assert.equal(cached.messages[4].content, 'edited with latest results')
    assert.equal(cached.messages[49].content, 'newer event')
    assert.equal(cached.messages.length, 200)
  } finally {
    queryClient.clear()
  }
})
