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
// Toolbar commands scroll the selection into view; jsdom has no layout, so give it empty geometry.
const emptyRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) })
for (const proto of [dom.window.Element.prototype, dom.window.Range.prototype]) {
  Object.assign(proto, { getClientRects: () => [], getBoundingClientRect: emptyRect })
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
  let format: import('../src/features/posts/post-rich-editor-engine').RichFormatState | null = null
  const engine = createPostRichEditor({ root, value: source, label: '본문', onChange: (value) => changes.push(value), onMediaViewsChange: (value) => { media = value }, onFormatChange: (value) => { format = value }, onUnsupportedUpload: () => { uploadWarnings++ } })
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

  await t.test('the formatting bar reads the caret state and its commands write Markdown', () => {
    engine.setMarkdown('# 제목\n\n본문 글')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))
    assert.equal(format?.heading, 1)
    const paragraph = view.state.doc.child(0).nodeSize + 1
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, paragraph, paragraph + 2)))
    assert.equal(format?.heading, null)
    engine.format('bold')
    assert.equal(format?.bold, true)
    assert.match(engine.getMarkdown(), /\*\*본문\*\* 글/)
    engine.format({ heading: 2 })
    assert.match(engine.getMarkdown(), /^## \*\*본문\*\* 글$/m)
    assert.equal(format?.heading, 2)
    engine.format('quote')
    assert.match(engine.getMarkdown(), /^> ## /m)
    engine.format('undo')
    assert.doesNotMatch(engine.getMarkdown(), /^> /m)
    engine.format('redo')
    assert.match(engine.getMarkdown(), /^> ## /m)
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)))
    engine.format('divider')
    assert.match(engine.getMarkdown(), /^(\*\*\*|---)$/m)
    assert.equal(changes.at(-1), engine.getMarkdown())
  })

  await t.test('block buttons toggle off and switch list kinds instead of nesting', () => {
    const caretIn = (text: string) => {
      let at = -1
      view.state.doc.descendants((node, pos) => { if (at < 0 && node.isText && node.text?.includes(text)) at = pos + 1 })
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)))
    }
    engine.setMarkdown('항목\n')
    caretIn('항목')
    engine.format('bulletList')
    assert.equal(format?.list, 'bulletList')
    assert.match(engine.getMarkdown(), /^- 항목$/m)
    engine.format('orderedList')
    assert.equal(format?.list, 'orderedList')
    assert.match(engine.getMarkdown(), /^1\. 항목$/m)
    engine.format('taskList')
    assert.equal(format?.list, 'taskList')
    assert.match(engine.getMarkdown(), /^- \[ \] 항목$/m)
    engine.format('bulletList')
    assert.match(engine.getMarkdown(), /^- 항목$/m)
    engine.format('bulletList')
    assert.equal(format?.list, null)
    assert.equal(engine.getMarkdown().trim(), '항목', 'the same list button again removes the list, never nests it')

    engine.format('quote')
    assert.equal(format?.quote, true)
    assert.match(engine.getMarkdown(), /^> 항목$/m)
    engine.format('quote')
    assert.equal(format?.quote, false)
    assert.equal(engine.getMarkdown().trim(), '항목')

    engine.format('codeBlock')
    assert.equal(format?.codeBlock, true)
    assert.match(engine.getMarkdown(), /^```\n항목\n```$/m)
    engine.format('codeBlock')
    assert.equal(format?.codeBlock, false)
    assert.equal(engine.getMarkdown().trim(), '항목')
    assert.equal(format?.canUndo, true)
  })

  await t.test('editing a "- item" list keeps dash bullets', () => {
    engine.setMarkdown('- 하나\n- 둘\n')
    view.dispatch(view.state.tr.insertText('!', view.state.doc.content.size - 3))
    assert.match(engine.getMarkdown(), /^- 하나\n- 둘!?/m)
    assert.doesNotMatch(engine.getMarkdown(), /^\* /m)
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
