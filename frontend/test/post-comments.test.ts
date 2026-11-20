import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import type { PostComment, PostCommentPage } from '@conai/shared'

test('comment paging retains an old linked thread and removes stale or other-post rows on refresh', async (t) => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value })
  const { act, createElement, useEffect } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
  const { usePostComments } = await import('../src/features/posts/use-post-comments')
  const { usePostCommentDraft } = await import('../src/features/posts/post-comment-draft')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } })
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
  const comment = (id: number, parentId: number | null, postId = 1): PostComment => ({
    id, parentId, postId, quoteCommentId: null, body: `comment ${id}`, mentions: [], status: 'visible', botRunId: null,
    author: { type: 'account', accountId: 1, profileId: null, name: 'writer', avatarUrl: null, avatarCrop: null },
    sourceChat: null, revision: 1, createdAt: '2026-10-15T00:00:00Z', updatedAt: '2026-10-15T00:00:00Z', canEdit: true,
  })
  const page = (comments: PostComment[], replies: PostCommentPage['replies'] = []): PostCommentPage => ({ comments, replies, nextCursor: null, context: [], runs: [] })
  let hidden = false
  const requests: URL[] = []
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    const url = new URL(input, 'http://conai.test')
    requests.push(url)
    if (hidden && url.searchParams.has('parentId')) return Response.json({ success: false, error: 'Thread is no longer visible' }, { status: 404 })
    const data = url.pathname.includes('/posts/2/') ? page([comment(200, null, 2)])
      : url.searchParams.has('parentId') ? page([comment(2, 1), comment(3, 1)])
        : url.searchParams.has('focusIds') ? page(hidden ? [] : [comment(1, null), comment(2, 1), comment(50, 1)], hidden ? [] : [{ parentId: 1, nextCursor: { createdAt: '2026-10-15 00:00:00', id: 50 } }])
          : page([comment(100, null)])
    return Response.json({ success: true, data })
  })
  let state!: ReturnType<typeof usePostComments>
  let box!: ReturnType<typeof usePostCommentDraft>
  function Reader({ postId, focusIds }: { postId: number; focusIds: number[] }) {
    const value = usePostComments(postId, focusIds)
    const draft = usePostCommentDraft(postId)
    useEffect(() => { state = value; box = draft }, [value, draft])
    return null
  }
  const render = async (postId: number, focusIds: number[]) => {
    await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(Reader, { postId, focusIds }))))
  }
  const until = async (ready: () => boolean) => {
    for (let index = 0; index < 100 && !ready(); index += 1) await act(async () => new Promise((resolve) => setTimeout(resolve, 5)))
    assert.ok(ready(), 'the query transition completed')
  }
  await render(1, [2])
  await until(() => state.comments.some((item) => item.id === 1))
  await act(async () => state.loadMoreReplies(1))
  await until(() => state.comments.some((item) => item.id === 3))
  assert.deepEqual(state.comments.map((item) => item.id), [1, 2, 3, 50, 100], 'the root stays when the linked reply enters an older reply page')
  assert.equal(state.moreReplies.get(1), null)
  assert.equal(requests.filter((url) => url.searchParams.has('parentId')).length, 1, 'click and observer share one request')
  hidden = true
  await act(async () => state.retry())
  await until(() => state.comments.length === 1)
    assert.deepEqual(state.comments.map((item) => item.id), [100], 'a refreshed visibility change removes all stale focused rows')
    assert.equal(state.moreReplies.has(1), false)
  const finishOldPost = box[1]
  await render(2, [])
  await until(() => state.comments.some((item) => item.id === 200))
  assert.deepEqual(state.comments.map((item) => item.id), [200], 'opened reply pages never cross the post boundary')
  await render(1, [])
  await act(async () => box[1](draft => ({ ...draft, top: 'new session' })))
  await act(async () => finishOldPost(draft => ({ ...draft, top: '' })))
  assert.equal(box[0].top, 'new session', 'a late completion from the first visit cannot clear a reopened post')
})

test('comment writes preserve a newer reply and keep the edit revision the writer actually saw', async (t) => {
  const { QueryClient } = await import('@tanstack/react-query')
  const { openCommentEdit, publishCommentDraft, saveCommentDraft } = await import('../src/features/posts/post-comment-draft')
  type Draft = import('../src/features/posts/post-comment-draft').PostCommentDraft
  const client = new QueryClient()
  t.after(() => client.clear())
  const original = { id: 8, postId: 1, revision: 2, body: 'opened' } as PostComment
  let draft: Draft = { top: '', edit: null, reply: { to: 8, text: 'sending' } }
  const set = (update: (draft: Draft) => Draft) => { draft = update(draft) }
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const requests: Record<string, unknown>[] = []
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)))
    await gate
    return Response.json({ success: true, data: { ...original, revision: 3 } })
  })
  const reply = publishCommentDraft(client, 1, 8, 'sending', set)
  draft = { ...draft, reply: { to: 9, text: 'next reply' } }
  draft = openCommentEdit(draft, original)
  draft = openCommentEdit(draft, { ...original, revision: 4, body: 'remote edit' })
  const edit = saveCommentDraft(client, 1, draft.edit!, set)
  draft = { ...draft, edit: { ...draft.edit!, text: 'typed during save' } }
  release()
  await Promise.all([reply, edit])
  assert.equal(requests[1].expectedRevision, 2)
  assert.deepEqual(draft.reply, { to: 9, text: 'next reply' })
  assert.deepEqual(draft.edit, { id: 8, revision: 3, text: 'typed during save' })
})
