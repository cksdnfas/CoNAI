import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'

function databaseBytes(tagName: string): Buffer {
  const db = new Database(':memory:')
  try {
    db.exec(`
      CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT, normalized_name TEXT, display_name TEXT,
        post_count INTEGER, category_code INTEGER, category_name TEXT, is_deprecated INTEGER);
      CREATE INDEX idx_tags_name ON tags(name);
      CREATE INDEX idx_tags_normalized_name ON tags(normalized_name);
      CREATE TABLE artists (tag_id INTEGER, name TEXT, normalized_name TEXT, post_count INTEGER);
      CREATE TABLE characters (tag_id INTEGER, name TEXT, normalized_name TEXT, post_count INTEGER);
      CREATE TABLE copyrights (tag_id INTEGER, name TEXT, normalized_name TEXT, post_count INTEGER);
      CREATE TABLE tag_translations (tag_id INTEGER, locale TEXT, translated_name TEXT);
      CREATE TABLE taxonomy_nodes (id INTEGER, node_key TEXT, node_type TEXT, title TEXT,
        description TEXT, direct_member_tag_count INTEGER, member_tag_count INTEGER);
      CREATE TABLE taxonomy_node_translations (node_key TEXT, locale TEXT, translated_title TEXT);
      CREATE TABLE character_copyright_links (character_tag_id INTEGER, copyright_tag_id INTEGER, confidence REAL, is_primary INTEGER);
      CREATE TABLE character_related_tags (character_tag_id INTEGER, related_tag_id INTEGER, score REAL);
      CREATE TABLE taxonomy_tag_memberships (taxonomy_node_id INTEGER, tag_id INTEGER);
      CREATE INDEX idx_taxonomy_tag_memberships_tag ON taxonomy_tag_memberships(tag_id);
    `)
    db.prepare('INSERT INTO tags VALUES (1, ?, ?, ?, 10, 0, ?, 0)').run(tagName, tagName, tagName, 'general')
    return db.serialize()
  } finally {
    db.close()
  }
}

test('Danbooru installs track latest releases and publish only verified databases', { timeout: 30_000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-danbooru-install-'))
  process.env.RUNTIME_BASE_PATH = root
  process.env.RUNTIME_DATABASE_DIR = path.join(root, 'database')
  const customPath = process.env.DANBOORU_SQLITE_PATH
  delete process.env.DANBOORU_SQLITE_PATH
  const { danbooruReleaseInstaller: installer } = await import('../src/services/danbooruBrowser/releaseInstaller')
  const resolver = await import('../src/services/danbooruBrowser/dbResolver')
  const { danbooruBrowserService: browser } = await import('../src/services/danbooruBrowserService')
  t.after(() => {
    browser.close()
    if (customPath === undefined) delete process.env.DANBOORU_SQLITE_PATH
    else process.env.DANBOORU_SQLITE_PATH = customPath
    assert.equal(path.dirname(root), os.tmpdir())
    assert.ok(path.basename(root).startsWith('conai-danbooru-install-'))
    fs.rmSync(root, { recursive: true, force: true })
  })

  let version = 'test-1'
  let bytes = databaseBytes('first_tag')
  let publishedDigest: string | undefined
  let truncate = false
  let lookupStatus = 200
  let downloads = 0
  let lookups = 0
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = String(input)
    if (url === 'https://api.github.com/repos/cksdnfas/danbooru-db-viewer/releases/latest') {
      lookups++
      if (lookupStatus !== 200) return new Response('', { status: lookupStatus })
      return Response.json({ tag_name: version, assets: [{
        name: 'danbooru-taxonomy.release.sqlite', size: bytes.length,
        digest: publishedDigest ?? `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        browser_download_url: `https://github.com/cksdnfas/danbooru-db-viewer/releases/download/${version}/danbooru-taxonomy.release.sqlite`,
      }] })
    }
    assert.ok(url.includes(`/releases/download/${version}/`), 'download URL must come from the latest release')
    downloads++
    return new Response(new Uint8Array(truncate ? bytes.subarray(0, 128) : bytes))
  })
  const finish = async () => {
    for (let i = 0; i < 300; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      const status = await installer.status()
      if (status.phase === 'completed' || status.phase === 'error') return status
    }
    throw new Error('Installation did not finish')
  }

  await t.test('first install, duplicate clicks, cached checks and restart persistence', async () => {
    assert.equal(resolver.resolveDanbooruDbInfo().available, false)
    installer.start()
    installer.start()
    const status = await finish()
    assert.equal(status.phase, 'completed', status.error ?? '')
    assert.equal(downloads, 1)
    assert.equal(status.installedVersion, 'test-1')
    assert.equal(status.updateAvailable, false)
    assert.equal(resolver.resolveDanbooruDbInfo().matchedBy, 'managed')
    assert.equal(browser.listTags({}).items[0].name, 'first_tag')
    browser.close()
    assert.equal(browser.listTags({}).items[0].name, 'first_tag', 'installed file survives reopening the reader')
    const previousLookups = lookups
    await installer.status()
    assert.equal(lookups, previousLookups, 'polling does not repeatedly call GitHub')
  })

  await t.test('a later release replaces the active reader without removing the old database', async () => {
    const oldPath = resolver.resolveDanbooruDbInfo().path
    const oldReader = new Database(oldPath, { readonly: true })
    try {
      version = 'test-2'
      bytes = databaseBytes('second_tag')
      assert.equal((await installer.status(true)).updateAvailable, true)
      installer.start()
      const status = await finish()
      assert.equal(status.phase, 'completed', status.error ?? '')
      assert.equal(status.installedVersion, 'test-2')
      assert.equal(browser.listTags({}).items[0].name, 'second_tag')
      assert.equal(oldReader.prepare('SELECT name FROM tags').pluck().get(), 'first_tag')
      assert.notEqual(resolver.resolveDanbooruDbInfo().path, oldPath)
      const downloadCount = downloads
      installer.start()
      assert.equal((await finish()).phase, 'completed')
      assert.equal(downloads, downloadCount, 'already-current databases are not downloaded again')
    } finally {
      oldReader.close()
    }
  })

  await t.test('checksum mismatch, truncation, unsupported schema and GitHub failures keep the installed DB', async () => {
    const installedPath = resolver.resolveDanbooruDbInfo().path
    version = 'test-3'
    for (const failure of ['checksum', 'truncated', 'schema', 'network'] as const) {
      bytes = failure === 'schema' ? Buffer.from('not a SQLite database') : databaseBytes('third_tag')
      publishedDigest = failure === 'checksum' ? `sha256:${'0'.repeat(64)}` : undefined
      truncate = failure === 'truncated'
      lookupStatus = failure === 'network' ? 403 : 200
      installer.start()
      assert.equal((await finish()).phase, 'error', failure)
      assert.equal(resolver.resolveDanbooruDbInfo().path, installedPath)
      assert.equal(browser.listTags({}).items[0].name, 'second_tag')
      assert.ok(!fs.readdirSync(resolver.danbooruReleaseDirectory).some((name) => name.endsWith('.part') || name === 'install.lock'))
    }
    lookupStatus = 200
    bytes = databaseBytes('third_tag')
    installer.start()
    assert.equal((await finish()).installedVersion, 'test-3', 'retry succeeds after an external failure')
  })

  await t.test('external database paths and another process installation are protected', async () => {
    process.env.DANBOORU_SQLITE_PATH = path.join(root, 'external.sqlite')
    assert.equal((await installer.status()).canInstall, false)
    assert.throws(() => installer.start(), /custom Danbooru database path/)
    assert.equal(resolver.resolveDanbooruDbInfo().path, process.env.DANBOORU_SQLITE_PATH)
    delete process.env.DANBOORU_SQLITE_PATH
    const lock = path.join(resolver.danbooruReleaseDirectory, 'install.lock')
    fs.writeFileSync(lock, '')
    installer.start()
    assert.match((await finish()).error ?? '', /Another database installation/)
    assert.ok(fs.existsSync(lock), 'an installer must not delete another process lock')
    fs.unlinkSync(lock)
  })
})
