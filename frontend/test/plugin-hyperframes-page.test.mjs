import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { test } from 'node:test'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import { fileURLToPath } from 'node:url'
import { starter } from '../../plugins/hyperframes/project.mjs'

const plugin = file => fileURLToPath(new URL(`../../plugins/hyperframes/${file}`, import.meta.url))

test('editor keeps later edits and their recovery revision during save, and cancels project switching without losing the draft', async t => {
  const dom = new JSDOM(await fs.readFile(plugin('index.html'), 'utf8'), { runScripts: 'outside-only', url: 'https://plugin.invalid/' })
  t.after(() => dom.window.close())
  const { window } = dom, doc = window.document
  window.TextEncoder = TextEncoder
  window.matchMedia = () => ({ matches: true, addEventListener: () => {} })
  window.HTMLMediaElement.prototype.pause = () => {}
  window.HTMLMediaElement.prototype.load = () => {}
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  window.HTMLDialogElement.prototype.close = function () { this.open = false }
  window.ResizeObserver = class { observe() {} }
  let handlers, snapshot, stored = null, storageRevision = null, sequence = 0, finishSave, savingArgs
  const previews = [], wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const fileId = '1'.repeat(32), revision = 'a'.repeat(64)
  window.connectForTest = registered => {
    handlers = registered
    return {
      files: [], publish: value => { snapshot = value }, onSaved: () => {},
      supports: feature => feature === 'preview',
      preview: {
        open: async content => { previews.push({ method: 'open', ...content }); return { url: 'https://preview.invalid/p/' } },
        update: async (url, content) => { previews.push({ method: 'update', url, ...content }); return { url } },
      },
      server: async args => {
        if (args.op === 'status') return { ready: true }
        if (args.op === 'history') return { items: [] }
        if (args.op === 'list') return { items: [{ fileId, revision, title: '저장한 프로젝트', stage: 'draft', updatedAt: Date.now() }], total: 1, nextOffset: null }
        if (args.op === 'read') return { fileId, revision, project: starter('저장한 프로젝트') }
        throw new Error(`Unexpected server op: ${args.op}`)
      },
      llm: { profiles: async () => [] },
      storage: {
        get: async () => ({ value: stored, revision: storageRevision }),
        set: async (_key, value, expected) => { assert.equal(expected, storageRevision); stored = value; storageRevision = String(++sequence); return { revision: storageRevision } },
        delete: async (_key, expected) => { assert.equal(expected, storageRevision); stored = null; storageRevision = null },
      },
      app: { call: async (tool, args) => {
        if (tool === 'search_images') return { status: 'completed', result: { content: [{ type: 'text', text: JSON.stringify({ images: [], total: 0 }) }] } }
        savingArgs = args; return new Promise(resolve => { finishSave = resolve })
      } },
    }
  }
  const bundle = await build({ entryPoints: [plugin('main.js')], bundle: true, write: false, format: 'esm', plugins: [{
    name: 'host-boundary', setup(builder) {
      builder.onResolve({ filter: /conai-plugin\.js$/ }, () => ({ path: 'host', namespace: 'test-host' }))
      builder.onLoad({ filter: /.*/, namespace: 'test-host' }, () => ({ contents: 'export const connectPlugin = handlers => window.connectForTest(handlers)' }))
    },
  }] })
  await window.eval(`(async () => {${bundle.outputFiles[0].text}\n})()`)
  const input = (id, value) => { doc.getElementById(id).value = value; doc.getElementById(id).dispatchEvent(new window.Event('input')) }
  // The live preview opens once with the runtime appended and package scripts mapped, then redraws in place only when the html changes.
  await wait(50)
  assert.equal(previews.map(item => item.method).join(), 'open')
  assert.ok(previews[0].html.endsWith('<script src="vendor/hyperframe.runtime.iife.js"></script></body></html>'))
  assert.equal(JSON.stringify(previews[0].files['vendor/gsap.min.js']), JSON.stringify({ source: 'package', path: 'vendor/gsap.min.js' }))
  input('duration', '5')
  await wait(400)
  assert.equal(previews.length, 1)
  input('html', doc.getElementById('html').value.replace('</body>', '<p>edited</p></body>'))
  await wait(400)
  assert.equal(previews.at(-1).method, 'update')
  assert.equal(previews.at(-1).url, 'https://preview.invalid/p/')
  assert.match(previews.at(-1).html, /<p>edited<\/p><script src="vendor\/hyperframe\.runtime\.iife\.js"><\/script><\/body>/)
  input('title', '저장 요청 시점')
  const saving = handlers['hyperframes.save']({})
  await Promise.resolve()
  input('title', '저장 중 추가 편집')
  finishSave({ id: 'request-1', status: 'completed', result: { fileId, revision, project: JSON.parse(savingArgs.document) } })
  await saving
  assert.equal(doc.getElementById('title').value, '저장 중 추가 편집')
  assert.equal(snapshot.dirty, true)
  assert.equal(stored.saved.revision, revision)
  assert.equal(stored.project.title, '저장 중 추가 편집')
  assert.equal(JSON.parse(savingArgs.document).title, '저장 요청 시점')

  await doc.getElementById('projects').onclick()
  const opening = doc.querySelector('#project-list button').onclick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(doc.getElementById('leave-dialog').open, true)
  doc.getElementById('leave-cancel').click()
  await opening
  assert.equal(doc.getElementById('title').value, '저장 중 추가 편집')
  assert.equal(snapshot.dirty, true)
  await assert.rejects(handlers['hyperframes.open']({ fileId }), /미저장 초안/)
  assert.equal(stored.project.title, '저장 중 추가 편집')
})
