import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { InfiniteQueryObserver, QueryClient, QueryObserver } from '@tanstack/react-query'

test('a delete keeps failed selections and an older gallery request cannot bring a removed image back', async t => {
  const { removeBulkDeletedImagesFromListCaches } = await import('../src/features/images/image-list-cache')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } })
  t.after(() => client.clear())
  const old = { images: [{ composite_hash: 'gone' }, { composite_hash: 'keep' }], total: 2 }
  const fresh = { images: [{ composite_hash: 'keep' }], total: 1 }
  const loaded = ['home-images', 'browse']
  client.setQueryData(loaded, { pages: [old], pageParams: [{}] })
  const delayed = (queryKey: string[]) => {
    let finish!: (value: typeof old) => void
    let count = 0
    const observer = new InfiniteQueryObserver(client, {
      queryKey, queryFn: () => ++count === 1 ? new Promise<typeof old>(resolve => { finish = resolve }) : Promise.resolve(fresh),
      initialPageParam: {}, getNextPageParam: () => undefined,
    })
    const stop = observer.subscribe(() => {})
    t.after(stop)
    const beforeDelete = observer.refetch()
    return async () => { finish(old); await beforeDelete; return observer.getCurrentResult().data?.pages }
  }
  const cached = delayed(loaded)
  const initial = delayed(['group-images', 'custom', '10', 'all'])
  const detail = ['image-detail', 'gone', 'chat']
  client.setQueryData(detail, { composite_hash: 'gone' })
  client.setQueryData(['image-detail', 'keep', 'gallery'], { composite_hash: 'keep' })
  const openDetail = new QueryObserver(client, { queryKey: detail, queryFn: async () => { throw new Error('not found') } })
  t.after(openDetail.subscribe(() => {}))
  let oldPromptCount!: (value: number) => void, promptReads = 0
  const prompts = new QueryObserver(client, { queryKey: ['prompt-groups', 'positive'],
    queryFn: () => ++promptReads === 1 ? new Promise<number>(resolve => { oldPromptCount = resolve }) : Promise.resolve(1),
  })
  t.after(prompts.subscribe(() => {}))
  const deleted = await removeBulkDeletedImagesFromListCaches(client, ['gone', 'keep'], { failed: 1, failedHashes: ['keep'], recycleBinEntries: ['copy'] })
  assert.deepEqual([...deleted], ['gone'])
  assert.deepEqual(await cached(), [fresh])
  assert.deepEqual(await initial(), [fresh])
  oldPromptCount(2)
  assert.equal(prompts.getCurrentResult().data, 1)
  assert.equal(openDetail.getCurrentResult().data, undefined, 'not even a failed refetch may retain a deleted attachment preview')
  assert.deepEqual(client.getQueryData(['image-detail', 'keep', 'gallery']), { composite_hash: 'keep' })
})

test('media picker continues browse and search from a deleted boundary without skipping its successor', async t => {
  const { mediaLibraryPages } = await import('../src/components/media/media-library-pages')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  t.after(() => client.clear())
  let shifted = false
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init: RequestInit) => {
    const url = new URL(String(input), 'http://localhost/')
    const params = init.body ? JSON.parse(String(init.body)) : Object.fromEntries(url.searchParams)
    const cursor = params.cursor_hash ?? params.cursorHash
    const values = shifted ? (cursor === 'b' ? ['c', 'd'] : ['d']) : ['a', 'b']
    return Response.json({ success: true, data: {
      images: values.map(composite_hash => ({ composite_hash })), hasMore: !shifted,
      nextCursorValue: '2026-01-01', nextCursorDate: '2026-01-01', nextCursorHash: values.at(-1),
    } })
  })
  for (const search of ['', 'matches']) {
    shifted = false
    const observer = new InfiniteQueryObserver(client, mediaLibraryPages(null, search, '', 'ASC'))
    await observer.refetch()
    shifted = true
    const result = await observer.fetchNextPage()
    assert.deepEqual(result.data?.pages[1].images.map(image => image.composite_hash), ['c', 'd'])
    assert.equal(result.hasNextPage, false)
  }
})

test('container masonry resumes pagination when a filtered page adds no visible items', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true })
  class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement,
    ResizeObserver: ResizeObserverStub, requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  const previous = Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value })
  const { act, createElement } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { ImageListMasonry } = await import('../src/features/images/components/image-list/image-list-masonry')
  const root = createRoot(document.getElementById('root')!)
  t.after(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
  let requested = 0
  const render = async (loading: boolean, hasMore = true) => act(async () => root.render(createElement(ImageListMasonry, {
    items: [], selectedIdSet: new Set<string>(), selectionMode: false, columnCount: 4, columnGap: 6, rowGap: 6,
    onActivate() {}, scrollMode: 'container', viewportHeight: 600, hasMore, isLoadingMore: loading,
    onEndReached: () => { if (hasMore && !loading) requested++ },
  })))
  await render(true)
  const scroller = document.querySelector('[data-testid="virtuoso-scroller"]')!
  assert.ok(scroller)
  Object.defineProperties(scroller, { scrollHeight: { configurable: true, value: 1600 }, clientHeight: { configurable: true, value: 600 }, scrollTop: { configurable: true, writable: true, value: 950 } })
  const scroll = () => act(async () => { scroller.dispatchEvent(new dom.window.Event('scroll', { bubbles: false })) })
  await scroll()
  assert.equal(requested, 0, 'scroll events never start overlapping page requests')
  await render(false)
  await scroll()
  await scroll()
  assert.equal(requested, 1, 'a scroll observed while loading must not lock this item count')
  await render(true)
  await scroll()
  assert.equal(requested, 1)
  await render(false)
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)) })
  assert.equal(requested, 2, 'after a filtered-out page, an already near-bottom viewport continues without another scroll')
  await render(false, false)
  await scroll()
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)) })
  assert.equal(requested, 2, 'pagination ends when the server reports no more pages')
})
