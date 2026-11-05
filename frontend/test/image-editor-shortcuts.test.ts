import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import type { EditorEngine } from '../src/features/image-editor/engine/editor-engine'

test('editor controls and save-dialog keys never navigate the underlying viewer', async (t) => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
  const globals = {
    window: dom.window, document: dom.window.document, Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, IS_REACT_ACT_ENVIRONMENT: true,
  }
  const previous = Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value })
  const { act, createElement: h, useRef } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { createPortal } = await import('react-dom')
  const { useEditorShortcuts } = await import('../src/features/image-editor/ui/use-editor-shortcuts')
  const nudges: number[][] = []
  const pans: boolean[] = []
  let undos = 0
  const buttonClick = t.mock.fn()
  let chatEscapes = 0
  const engine = {
    nudge: (x: number, y: number) => nudges.push([x, y]),
    undo: () => { undos += 1 },
    setSpacePan: (active: boolean) => pans.push(active),
    confirmPending: () => false,
    getSnapshot: () => ({ textEditing: false }),
  } as unknown as EditorEngine
  const handled: string[] = []
  let viewerKeys = 0
  const viewer = (event: KeyboardEvent) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') viewerKeys += 1
    if (event.key === 'Escape' && (event.target as HTMLElement).closest('[data-chat-dock]')) chatEscapes += 1
  }
  dom.window.addEventListener('keydown', viewer)
  function Editor() {
    const rootRef = useRef<HTMLDivElement>(null)
    useEditorShortcuts({ open: true, engine, rootRef, maskEnabled: false, onRequestClose: () => {}, onSave: () => {}, onCopy: () => {} })
    return h('div', { ref: rootRef, id: 'editor', tabIndex: -1 },
      ...['option', 'slider', 'menuitem', 'tab'].map((role) => h('div', {
        key: role, role, id: role, tabIndex: 0, onKeyDown: () => handled.push(role),
      })),
      h('button', { id: 'toolbar-button', onClick: buttonClick }, 'Tool'),
      createPortal(h('div', { role: 'dialog', id: 'save-dialog', tabIndex: 0, onKeyDown: () => handled.push('dialog') }), document.body),
      createPortal(h('aside', { 'data-chat-dock': '', id: 'chat', tabIndex: 0 }), document.body),
    )
  }
  const root = createRoot(document.getElementById('root')!)
  try {
    await act(async () => root.render(h(Editor)))
    for (const [id, key] of [['option', 'Enter'], ['slider', 'ArrowRight'], ['menuitem', 'ArrowDown'], ['tab', 'ArrowLeft'], ['save-dialog', 'ArrowRight']]) {
      document.getElementById(id!)!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    }
    assert.deepEqual(handled, ['option', 'slider', 'menuitem', 'tab', 'dialog'])
    assert.equal(viewerKeys, 0)
    assert.deepEqual(nudges, [])
    document.getElementById('editor')!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true }))
    assert.deepEqual(nudges, [[10, 0]])
    assert.equal(viewerKeys, 0)
    const button = document.getElementById('toolbar-button')!
    button.focus()
    button.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }))
    assert.equal(undos, 1, 'focused toolbar buttons must not swallow editor undo')
    const spaceDown = new dom.window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    const spaceUp = new dom.window.KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true })
    button.dispatchEvent(spaceDown)
    button.dispatchEvent(spaceUp)
    assert.equal(spaceDown.defaultPrevented, true, 'Space must not arm native button activation')
    assert.equal(spaceUp.defaultPrevented, true, 'Space release must not activate the button')
    assert.deepEqual(pans, [true, false])
    assert.equal(buttonClick.mock.callCount(), 0)
    document.getElementById('chat')!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    assert.equal(chatEscapes, 1, 'chat dock Escape must reach its window listener')
  } finally {
    await act(async () => root.unmount())
    dom.window.removeEventListener('keydown', viewer)
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
