import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'

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
