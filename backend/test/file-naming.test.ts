import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  DEFAULT_FILE_NAMING_SETTINGS,
  FILE_NAMING_PRESETS,
  cleanRequestedFileName,
  fileNameCandidates,
  normalizeFileNamingSettings,
  previewFileNamePattern,
  renderFileNameStem,
  sanitizeFileNameStem,
  validateFileNamePattern,
  type FileNamePatternRole,
  type FileNamingSettings,
} from '@conai/shared'
import { exclusiveWrites, writeMediaFileWithUniqueName } from '../src/utils/mediaFileNames'
import { archiveCaptionName, createArchiveEntryNamer } from '../src/utils/archiveEntryNames'

const date = new Date(2026, 10, 23, 14, 30, 25)
const take = <T>(values: Iterable<T>, count: number) => {
  const out: T[] = []
  for (const value of values) {
    out.push(value)
    if (out.length >= count) break
  }
  return out
}

test('patterns validate per role', () => {
  const code = (pattern: string, role: FileNamePatternRole) => validateFileNamePattern(pattern, role)?.code ?? null
  assert.equal(code('{name}', 'upload'), null)
  assert.equal(code(DEFAULT_FILE_NAMING_SETTINGS.generated, 'generated'), null)
  assert.equal(code('{name}_{n:3}', 'collision'), null)
  assert.equal(code('', 'upload'), 'empty')
  assert.equal(code('...', 'upload'), 'empty', 'text that cleans down to nothing')
  assert.equal(code('{yyyy', 'upload'), 'unbalanced-brace')
  assert.equal(code('}{name}', 'upload'), 'unbalanced-brace')
  assert.equal(code('{foo}', 'upload'), 'unknown-token')
  assert.equal(code('{n:0}', 'upload'), 'invalid-digits')
  assert.equal(code('{n:10}', 'upload'), 'invalid-digits')
  assert.equal(code('{rand:3}', 'upload'), 'invalid-digits')
  assert.equal(code('a/b{name}', 'upload'), 'invalid-character')
  assert.equal(code('x'.repeat(101), 'upload'), 'too-long')
  assert.equal(code('{name}_{rand}', 'generated'), 'name-not-allowed', '{name} has no value in a generated pattern')
  assert.equal(code('{yyyy}_{n:3}', 'collision'), 'name-required', 'a collision name must keep the name it varies')
  for (const role of ['upload', 'generated', 'collision'] as const) {
    for (const preset of FILE_NAMING_PRESETS[role]) assert.equal(code(preset.pattern, role), null, `${role}/${preset.id}`)
  }
})

test('broken or missing saved settings fall back per field', () => {
  assert.deepEqual(normalizeFileNamingSettings(undefined), DEFAULT_FILE_NAMING_SETTINGS)
  assert.deepEqual(normalizeFileNamingSettings({ upload: '{bad}', generated: '{name}', collision: 'x' }), DEFAULT_FILE_NAMING_SETTINGS)
  assert.deepEqual(normalizeFileNamingSettings({ upload: '{yyyy}_{name}' }), { ...DEFAULT_FILE_NAMING_SETTINGS, upload: '{yyyy}_{name}' })
})

test('rendering fills every token and cleans the result', () => {
  assert.equal(renderFileNameStem('{yyyy}-{MM}-{dd} {HH}{mm}{ss} {engine} {name} {n:4} {rand}', { date, engine: 'novelai', name: 'cat', n: 7, rand: 'k3f9x2' }),
    '2026-11-23 143025 novelai cat 0007 k3f9x2')
  assert.equal(renderFileNameStem('{n:2}', { date, n: 123 }), '123', 'numbers wider than the padding are kept whole')
  assert.equal(sanitizeFileNameStem('  ..CON'), 'CON_')
  assert.equal(sanitizeFileNameStem('a/b:c*d\u0001e. . '), 'a_b_c_d_e')
  assert.equal(sanitizeFileNameStem('com1.txt'), 'com1_.txt')
  assert.equal(sanitizeFileNameStem('nul'), 'nul_')
  assert.equal(cleanRequestedFileName('hero pose.PNG'), 'hero pose', 'a typed media extension is dropped')
  assert.equal(cleanRequestedFileName('  ../x/y  '), '_x_y')
  assert.equal(cleanRequestedFileName('   '), '')
  const long = sanitizeFileNameStem('가'.repeat(150))
  assert.ok(Array.from(long).length <= 120 && Buffer.byteLength(long) <= 200)
})

test('candidates follow the first pattern, then the collision pattern', () => {
  const settings = DEFAULT_FILE_NAMING_SETTINGS
  assert.deepEqual(take(fileNameCandidates({ settings, kind: 'upload', originalName: 'C:\\x\\cat.png', extension: 'png', date }), 3), ['cat.png', 'cat_001.png', 'cat_002.png'])
  assert.deepEqual(take(fileNameCandidates({ settings, kind: 'generated', extension: '.WEBP', date, rand: 'abc123', engine: 'novelai' }), 2),
    ['2026_11_23_143025_abc123.webp', '2026_11_23_143025_abc123_001.webp'])
  assert.deepEqual(take(fileNameCandidates({ settings, kind: 'generated', requestedName: 'hero pose.PNG', extension: 'webp', date }), 2), ['hero pose.webp', 'hero pose_001.webp'],
    'a typed name replaces the generated pattern; the saved format sets the extension')
  assert.deepEqual(take(fileNameCandidates({ settings: { ...settings, generated: '{yyyy}{MM}{dd}_{n:3}' }, kind: 'generated', extension: 'png', date }), 2),
    ['20261123_001.png', '20261123_002.png'], 'a numbered first pattern counts up itself')
  assert.deepEqual(take(fileNameCandidates({ settings: { ...settings, collision: '{name}_{yyyy}{MM}{dd}_{HH}{mm}{ss}' }, kind: 'upload', originalName: 'cat.png', extension: 'png', date }), 3),
    ['cat.png', 'cat_20261123_143025.png', 'cat_20261123_143025_001.png'], 'a collision pattern without {n} gets _{n:3} once it collides too')
  assert.deepEqual(take(fileNameCandidates({ settings, kind: 'keep', keepName: 'D:\\a\\Old Name.PNG', extension: 'png', date }), 2), ['Old Name.PNG', 'Old Name_001.PNG'])
  const named = take(fileNameCandidates({ settings, kind: 'upload', originalName: '가'.repeat(150) + '.png', extension: 'png', date }), 2)
  assert.ok(named[1].endsWith('_001.png') && Buffer.byteLength(named[1]) <= 204, 'shortening a long name keeps the number')
})

test('previews show what a pattern saves', () => {
  assert.deepEqual(previewFileNamePattern('{name}', 'upload', { date }), ['cat.png'])
  assert.deepEqual(previewFileNamePattern('{name}_{n:3}', 'collision', { date }), ['cat_001.png', 'cat_002.png'])
  assert.deepEqual(previewFileNamePattern('{engine}_{n:3}', 'generated', { date }), ['novelai_001.png'])
  assert.deepEqual(previewFileNamePattern('{bad}', 'upload', { date }), [])
})

test('stored names are unique per folder, case-insensitively, and never replace a file', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-file-naming-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const settings: FileNamingSettings = { ...DEFAULT_FILE_NAMING_SETTINGS }
  const deps = (registered: string[] = []) => ({ settings, date, registeredNames: () => registered })
  const upload = (directory: string, bytes: string, originalName = 'Cat.png', registered: string[] = []) => writeMediaFileWithUniqueName(
    { directory, extension: path.extname(originalName), kind: 'upload', originalName }, exclusiveWrites.bytes(Buffer.from(bytes)), deps(registered))

  await t.test('the same upload twice gets _001; another case of the name counts as taken', async () => {
    const directory = path.join(root, 'twice')
    assert.equal(path.basename(await upload(directory, 'one')), 'Cat.png')
    assert.equal(path.basename(await upload(directory, 'two', 'cat.PNG')), 'cat_001.png')
    assert.equal(fs.readFileSync(path.join(directory, 'Cat.png'), 'utf8'), 'one')
  })

  await t.test('a library row whose file is gone still holds its name', async () => {
    const directory = path.join(root, 'registered')
    assert.equal(path.basename(await upload(directory, 'x', 'cat.png', ['cat.png', 'cat_001.png'])), 'cat_002.png')
  })

  await t.test('concurrent saves of one name all get their own file', async () => {
    const directory = path.join(root, 'concurrent')
    const saved = await Promise.all(Array.from({ length: 25 }, (_, index) => upload(directory, `v${index}`)))
    assert.equal(new Set(saved.map((file) => file.toLowerCase())).size, 25)
    const contents = saved.map((file) => fs.readFileSync(file, 'utf8')).sort()
    assert.deepEqual(contents, Array.from({ length: 25 }, (_, index) => `v${index}`).sort(), 'no save replaced another')
  })

  await t.test('a file created after the listing makes the write move on instead of replacing it', async () => {
    const directory = path.join(root, 'race')
    fs.mkdirSync(directory, { recursive: true })
    let first = true
    const saved = await writeMediaFileWithUniqueName({ directory, extension: 'png', kind: 'upload', originalName: 'cat.png' }, async (target) => {
      if (first) {
        first = false
        fs.writeFileSync(target, 'someone else') // another process wins the name between the listing and the write
      }
      await fs.promises.writeFile(target, 'mine', { flag: 'wx' })
    }, deps())
    assert.equal(path.basename(saved), 'cat_001.png')
    assert.equal(fs.readFileSync(path.join(directory, 'cat.png'), 'utf8'), 'someone else')
    assert.equal(fs.readFileSync(saved, 'utf8'), 'mine')
  })

  await t.test('a failed write leaves nothing behind and is reported', async () => {
    const directory = path.join(root, 'failed')
    await assert.rejects(writeMediaFileWithUniqueName({ directory, extension: 'png', kind: 'generated' }, async (target) => {
      await fs.promises.writeFile(target, 'partial', { flag: 'wx' })
      throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
    }, deps()), /disk full/)
    assert.deepEqual(fs.readdirSync(directory), [])
  })

  await t.test('a typed generation name and the generated pattern', async () => {
    const directory = path.join(root, 'generated')
    const generate = (requestedName?: string) => writeMediaFileWithUniqueName(
      { directory, extension: 'webp', kind: 'generated', requestedName, engine: 'novelai' }, exclusiveWrites.bytes(Buffer.from('x')), deps())
    const named = await Promise.all([generate('이름'), generate('이름'), generate('이름')])
    assert.deepEqual(named.map((file) => path.basename(file)).sort(), ['이름.webp', '이름_001.webp', '이름_002.webp'])
    assert.match(path.basename(await generate()), /^2026_11_23_143025_[a-z0-9]{6}\.webp$/)
  })

  await t.test('restoring keeps the old name when free and takes the collision name when not', async () => {
    const directory = path.join(root, 'restore')
    fs.mkdirSync(directory, { recursive: true })
    const restore = (registered: string[] = []) => writeMediaFileWithUniqueName(
      { directory, extension: '.png', kind: 'keep', keepName: path.join(directory, 'Old.png') }, exclusiveWrites.bytes(Buffer.from('r')), deps(registered))
    assert.equal(path.basename(await restore()), 'Old.png')
    assert.equal(path.basename(await restore()), 'Old_001.png')
    assert.equal(path.basename(await restore(['old_002.png'])), 'Old_003.png')
  })
})

test('archive entry names add (n) case-insensitively and keep captions apart', () => {
  const plain = createArchiveEntryNamer()
  assert.deepEqual([plain('cat', '.png'), plain('Cat', '.png'), plain('cat (1)', '.png'), plain('cat', '.png'), plain('cat', '.jpg')],
    ['cat.png', 'Cat (1).png', 'cat (1) (1).png', 'cat (2).png', 'cat.jpg'])
  const captioned = createArchiveEntryNamer({ captions: true })
  const names = [captioned('a', '.png'), captioned('a', '.jpg'), captioned('A', '.png')]
  assert.deepEqual(names, ['a.png', 'a (1).jpg', 'A (2).png'], 'a.png and a.jpg never share a.txt')
  assert.equal(new Set(names.map((name) => archiveCaptionName(name).toLowerCase())).size, 3)
  assert.equal(archiveCaptionName('a (1).jpg'), 'a (1).txt')
})
