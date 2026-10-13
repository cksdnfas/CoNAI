import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'

test('extension conflict recovery preserves drafts, including edits made during the latest read', async (t) => {
  const root = new URL('../../plugins/text-editor/', import.meta.url)
  const dom = new JSDOM(readFileSync(new URL('index.html', root), 'utf8'), { runScripts: 'outside-only' })
  t.after(() => dom.window.close())
  type FileText = { id: string; name: string; text: string; revision: string }
  let stored: FileText = { id: 'a'.repeat(32), name: 'test.json', text: '{"v":1}', revision: '1'.repeat(64) }
  let read: () => Promise<FileText> = async () => ({ ...stored })
  let actions: Record<string, (args?: unknown) => Promise<void>> = {}
  const proposals: unknown[] = []
  let snapshot: { dirty: boolean; data: { selected: { latestExcerpt?: string } } }
  // Execute the shipped editor/DOM; substitute only the host SDK transport at the module boundary.
  dom.window.connectPlugin = async (handlers: typeof actions) => {
    actions = handlers
    return {
      files: [stored],
      request: async (method: string, args: unknown) => {
        if (method === 'files.readText') return read()
        assert.equal(method, 'files.proposeWrite')
        proposals.push(structuredClone(args))
        return { proposalId: 'proposal', status: 'pending' }
      },
      publish: (value: typeof snapshot) => { snapshot = value },
      onSaved: () => {},
    }
  }
  const source = readFileSync(new URL('main.js', root), 'utf8').replace(/^import .*?\r?\n/, '')
  await dom.window.eval(`(async () => { ${source}\n })()`)
  const editor = dom.window.document.querySelector<HTMLTextAreaElement>('#editor')!
  const latest = dom.window.document.querySelector<HTMLTextAreaElement>('#latest')!
  const edit = (text: string) => { editor.value = text; editor.dispatchEvent(new dom.window.Event('input')) }
  assert.equal(editor.value, stored.text)

  edit('{"v":2}')
  stored = { ...stored, text: '{"v":3}', revision: '3'.repeat(64) }
  await actions['text-editor.refresh']()
  assert.equal(editor.value, '{"v":2}', 'a conflict refresh must not overwrite the draft')
  assert.equal(latest.value, stored.text)
  assert.equal(snapshot!.dirty, true)
  assert.equal(snapshot!.data.selected.latestExcerpt, stored.text)
  await actions['text-editor.propose']()
  assert.deepEqual(proposals[0], { fileId: stored.id, revision: stored.revision, text: '{"v":2}' })

  dom.window.document.querySelector<HTMLButtonElement>('#revert')!.click()
  assert.equal(editor.value, stored.text, 'discard now uses the latest confirmed original')
  let release!: (file: FileText) => void
  read = () => new Promise<FileText>((resolve) => { release = resolve })
  const pending = actions['text-editor.refresh']()
  edit('{"v":4}')
  stored = { ...stored, text: '{"v":5}', revision: '5'.repeat(64) }
  release(stored)
  await pending
  assert.equal(editor.value, '{"v":4}', 'typing while the request is in flight must survive')
  assert.equal(latest.value, stored.text)
  await actions['text-editor.propose']()
  assert.deepEqual(proposals[1], { fileId: stored.id, revision: stored.revision, text: '{"v":4}' })
})
