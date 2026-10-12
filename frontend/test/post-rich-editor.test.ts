import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { JSDOM } from 'jsdom'
import { POST_MEDIA_EMBED_PATTERN } from '@conai/shared'

// Exercise the real parser, serializer and editor transactions without a server
// or any access to the user's posts, media or databases.
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
const globals = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'MutationObserver', 'DOMParser', 'CustomEvent', 'Event', 'EventTarget', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'addEventListener', 'removeEventListener', 'dispatchEvent'] as const
const descriptors = globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
for (const key of globals) {
  const value = key === 'window' ? dom.window : dom.window[key]
  Object.defineProperty(globalThis, key, { configurable: true, value: ['addEventListener', 'removeEventListener', 'dispatchEvent'].includes(key) ? (value as (...args: unknown[]) => unknown).bind(dom.window) : value })
}
after(() => {
  dom.window.close()
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
})

const { createPostRichEditor } = await import('../src/features/posts/post-rich-editor-engine')
const { editorViewCtx, parserCtx, serializerCtx } = await import('@milkdown/kit/core')
const { TextSelection } = await import('@milkdown/kit/prose/state')
const { undo, redo } = await import('@milkdown/kit/prose/history')
const { uploadConfig } = await import('@milkdown/kit/plugin/upload')

const hash = 'a'.repeat(48)
const videoHash = 'b'.repeat(32)
const fileId = 'c'.repeat(32)
const refs = (markdown: string) => [...markdown.matchAll(POST_MEDIA_EMBED_PATTERN)].map((match) => `${match[1]}:${match[2]}`)

test('post editor preserves Markdown and internal attachment contracts', async (t) => {
  const source = `# 제목\n\n한글 본문 **굵게**\n\n![사진](media:${hash})\n![](media:${videoHash}.mp4)\n\n![음악](audio:take_123)\n\n![모음](group:42)\n\n![파일](file:${fileId})\n\n- [x] 완료\n\n| 제목 | 값 |\n| --- | --- |\n| 하나 | 둘 |\n\n\`\`\`ts\nconst n = 1\n\`\`\`\n`
  const root = document.createElement('div')
  document.body.append(root)
  const changes: string[] = []
  let media: import('../src/features/posts/post-rich-editor-engine').PostEditorMediaView[] = []
  let uploadWarnings = 0
  const engine = createPostRichEditor({ root, value: source, label: '본문', onChange: (value) => changes.push(value), onMediaViewsChange: (value) => { media = value }, onUnsupportedUpload: () => { uploadWarnings++ } })
  await engine.create()
  t.after(async () => { await engine.destroy(); root.remove() })
  const view = engine.crepe.editor.action((ctx) => ctx.get(editorViewCtx))

  await t.test('opening and selection changes leave the saved source byte-for-byte intact', () => {
    assert.equal(engine.getMarkdown(), source)
    assert.equal(changes.length, 0)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))
    assert.equal(engine.getMarkdown(), source)
    assert.equal(changes.length, 0)
    assert.equal(media.length, 5)
    assert.deepEqual(media.map((item) => item.src), refs(source))
    assert.equal(root.querySelectorAll('img[src^="media:"]').length, 0)
  })

  await t.test('editing publishes immediately and round-trips every internal reference and GFM block', () => {
    view.dispatch(view.state.tr.insertText('수정 ', 1))
    assert.equal(changes.length, 1, 'no debounce before save or source-mode switch')
    assert.deepEqual(refs(changes[0]), refs(source))
    assert.match(changes[0], /[-*] \[x\] 완료/)
    assert.match(changes[0], /\| 제목\s*\| 값/)
    assert.match(changes[0], /```ts\nconst n = 1\n```/)
    assert.equal(engine.getMarkdown(), changes[0])
    const saved = changes[0]
    engine.setMarkdown(saved)
    assert.equal(changes.length, 1, 'React echo must not replace the document')
    assert.equal(undo(view.state, view.dispatch), true)
    assert.ok(!engine.getMarkdown().includes('수정 '))
    assert.equal(redo(view.state, view.dispatch), true)
    assert.equal(engine.getMarkdown(), saved)
    const reopened = engine.crepe.editor.action((ctx) => ctx.get(serializerCtx)(ctx.get(parserCtx)(saved)))
    assert.deepEqual(refs(reopened), refs(source), 'saving and reopening must preserve all attachments')
  })

  await t.test('AI/source replacements update the view without echoing or rewriting the supplied source', () => {
    const external = `AI가 고친 글\n\n![](media:${hash})`
    const count = changes.length
    engine.setMarkdown(external)
    assert.equal(engine.getMarkdown(), external)
    assert.match(view.state.doc.textContent, /AI가 고친 글/)
    assert.equal(changes.length, count)
    view.dispatch(view.state.tr.insertText('추가 ', 1))
    assert.match(changes.at(-1)!, /추가 AI가 고친 글/)
    assert.deepEqual(refs(changes.at(-1)!), [`media:${hash}`])
  })

  await t.test('picker attachments replace the selection and are immediately available to save', () => {
    engine.setMarkdown('앞 선택 뒤')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3, 5)))
    assert.equal(engine.insertMarkdown(`![](media:${hash})\n\n![오디오](audio:take_123)\n`), true)
    assert.deepEqual(refs(engine.getMarkdown()), [`media:${hash}`, 'audio:take_123'])
    assert.match(engine.getMarkdown(), /앞/)
    assert.match(engine.getMarkdown(), /뒤/)
    assert.ok(!engine.getMarkdown().includes('선택'))
    assert.equal(changes.at(-1), engine.getMarkdown())
  })

  await t.test('raw HTML stays inert and direct uploads cannot persist temporary blob URLs', async () => {
    engine.setMarkdown('<script>alert(1)</script>\n\n[위험](javascript:alert%281%29)')
    assert.equal(root.querySelector('script'), null)
    assert.equal(root.querySelector('a')?.getAttribute('href'), '')
    const serialized = engine.crepe.editor.action((ctx) => ctx.get(serializerCtx)(view.state.doc))
    assert.match(serialized, /<script>alert\(1\)<\/script>/)
    const uploaded = await engine.crepe.editor.action((ctx) => ctx.get(uploadConfig.key).uploader({ length: 1 } as FileList, view.state.schema, ctx, 1))
    assert.deepEqual(uploaded, [])
    assert.equal(uploadWarnings, 1)
  })
})
