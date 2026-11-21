import assert from 'node:assert/strict'
import { test } from 'node:test'

test('a popup anchored inside a modal-layer host opens on the floating layer, elsewhere on the popover layer', async () => {
  const { JSDOM } = await import('jsdom')
  const { document } = new JSDOM('<div data-slot="modal"><button id="modal"></button></div><div role="dialog"><span><button id="dialog"></button></span></div><button id="page"></button>').window
  const { resolveFloatingLayer } = await import('../src/components/ui/floating-surface')
  const { floatingDropdownMenuClassName } = await import('../src/features/image-generation/components/floating-dropdown-utils')
  assert.equal(resolveFloatingLayer(document.getElementById('modal')), 'floating')
  assert.equal(resolveFloatingLayer(document.getElementById('dialog')), 'floating', 'a full-screen editor with role="dialog" counts')
  assert.equal(resolveFloatingLayer(document.getElementById('page')), 'popover')
  assert.equal(resolveFloatingLayer(null), 'popover')
  const floating = floatingDropdownMenuClassName('floating').split(' ')
  const popover = floatingDropdownMenuClassName('popover').split(' ')
  assert.ok(floating.includes('z-floating') && !floating.includes('z-popover'))
  assert.ok(popover.includes('z-popover') && !popover.includes('z-floating'))
})

test('the path tree menu opens above a dialog host and takes Esc for itself', async (t) => {
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('<div role="dialog"><div id="editor"></div></div><div id="page"></div>', { url: 'http://localhost/', pretendToBeVisual: true })
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value })
  const { act, createElement: h } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
  const { I18nProvider } = await import('../src/i18n')
  const { TooltipProvider } = await import('../src/components/ui/tooltip')
  const { PathOptionTreeSelect } = await import('../src/features/image-generation/components/path-option-tree-select')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } })
  client.setQueryData(['runtime-language-settings'], { general: { language: 'en' } })
  const roots = ['editor', 'page'].map((id) => createRoot(document.getElementById(id)!))
  // The authoring editor decides on Esc in a window listener; a Modal decides in a document listener added before the menu opens.
  const seen: string[] = []
  const onWindow = (event: KeyboardEvent) => { if (event.key === 'Escape') seen.push(`window:${event.defaultPrevented}`) }
  const onDocument = (event: KeyboardEvent) => { if (event.key === 'Escape') seen.push(`document:${event.defaultPrevented}`) }
  window.addEventListener('keydown', onWindow)
  document.addEventListener('keydown', onDocument)
  t.after(async () => {
    window.removeEventListener('keydown', onWindow)
    document.removeEventListener('keydown', onDocument)
    for (const root of roots) await act(async () => root.unmount())
    client.clear()
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })

  const select = h(PathOptionTreeSelect, { value: 'MOSS/a.safetensors', options: ['MOSS/a.safetensors', 'MOSS/b.safetensors'], onChange: () => undefined })
  for (const root of roots) await act(async () => root.render(h(QueryClientProvider, { client }, h(I18nProvider, null, h(TooltipProvider, null, select)))))
  const trigger = (id: string) => document.querySelector<HTMLButtonElement>(`#${id} [aria-haspopup="tree"]`)!
  const menu = () => document.querySelector<HTMLElement>('body > [data-surface="high"]')
  const pressEscape = (target: Element) => act(async () => { target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })

  await act(async () => trigger('editor').click())
  assert.ok(menu()?.classList.contains('z-floating'), 'above the dialog host')
  assert.equal(menu()?.classList.contains('z-popover'), false)
  await pressEscape(trigger('editor'))
  assert.equal(menu(), null, 'Esc closes the menu')
  assert.deepEqual(seen, ['document:true', 'window:true'], 'both host kinds see the key as handled and stay open')
  await pressEscape(trigger('editor'))
  assert.deepEqual(seen.slice(2), ['document:false', 'window:false'], 'with the menu closed the host gets Esc again')

  await act(async () => trigger('page').click())
  assert.ok(menu()?.classList.contains('z-popover'), 'outside a modal-layer host the menu stays on the popover layer')
  assert.equal(menu()?.classList.contains('z-floating'), false)
})
