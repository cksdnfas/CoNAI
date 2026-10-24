import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import fsExtra from 'fs-extra'
import { copyUserGuides } from '../../scripts/copy-user-guides'

const source = path.resolve(__dirname, '../../docs/GUIDE')

test('packaged guides preserve every Markdown file byte-for-byte and exclude other files and directories', t => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-packaged-guides-'))
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }))
  const target = path.join(workspace, 'docs', 'GUIDE')
  const entries = fs.readdirSync(source, { withFileTypes: true })
  t.mock.method(fsExtra, 'readdirSync', (directory: string) => {
    assert.equal(directory, source)
    return [...entries, { name: 'ignored.txt', isFile: () => true }, { name: 'nested.md', isFile: () => false }]
  })
  copyUserGuides(target)
  const names = entries.filter(entry => entry.isFile() && entry.name.endsWith('.md')).map(entry => entry.name).sort()
  assert.ok(names.includes('MCP_GUIDE.md'))
  assert.deepEqual(fs.readdirSync(target).sort(), names)
  for (const name of names) assert.deepEqual(fs.readFileSync(path.join(target, name)), fs.readFileSync(path.join(source, name)))
})

test('an unavailable guide source does not create an empty packaged guide directory', t => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-packaged-guides-'))
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }))
  const target = path.join(workspace, 'missing-guides')
  t.mock.method(fsExtra, 'existsSync', (directory: string) => {
    assert.equal(directory, source)
    return false
  })
  t.mock.method(console, 'warn', () => {})
  copyUserGuides(target)
  assert.equal(fs.existsSync(target), false)
})
