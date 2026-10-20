import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

test('Danbooru character images: bounded shared reads, ordering and cache refresh', { timeout: 30_000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-character-images-'))
  process.env.RUNTIME_BASE_PATH = root
  process.env.RUNTIME_DATABASE_DIR = path.join(root, 'database')
  const { DanbooruCharacterImageStore } = await import('../src/services/danbooruBrowser/characterImages')
  const imageRoot = path.join(root, 'database', 'character-images')
  t.after(async () => {
    assert.ok(path.basename(root).startsWith('conai-character-images-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const rows = Array.from({ length: 12 }, (_, index) => ({ tag_id: index + 1, name: `tag_${index + 1}`, normalized_name: `tag_${index + 1}` }))
  await Promise.all(rows.map(async (row) => {
    const directory = path.join(imageRoot, row.name)
    await fs.promises.mkdir(directory, { recursive: true })
    await Promise.all(['image10.PNG', 'image2.webp', 'image1.jpg', 'ignored.txt'].map((file) => fs.promises.writeFile(path.join(directory, file), 'image')))
    await fs.promises.mkdir(path.join(directory, 'ignored.png'))
  }))

  await t.test('overlapping callers share reads and only four directories load at once', async (t) => {
    const store = new DanbooruCharacterImageStore()
    const original = fs.promises.readdir
    let active = 0
    let maximum = 0
    let calls = 0
    let release!: () => void
    let started!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const fourStarted = new Promise<void>((resolve) => { started = resolve })
    const reader = t.mock.method(fs.promises, 'readdir', async (...args: Parameters<typeof original>) => {
      active += 1
      calls += 1
      maximum = Math.max(maximum, active)
      if (active === 4) started()
      try {
        await blocked
        return await original(...args)
      } finally {
        active -= 1
      }
    })
    const first = Promise.all(rows.map((row) => store.getRecords(row)))
    const second = Promise.all(rows.map((row) => store.getRecords(row)))
    try {
      await fourStarted
      assert.equal(calls, 4, 'queued directory reads have not started')
      release()
      const [left, right] = await Promise.all([first, second])
      assert.deepEqual(left, right)
      assert.equal(maximum, 4)
      assert.equal(calls, rows.length, 'one directory read per character, not per caller')
      assert.deepEqual(left[0].map((image) => image.fileName), ['image1.jpg', 'image2.webp', 'image10.PNG'])
      assert.equal(left[0][0].url, '/api/danbooru-browser/character-images/1/image1.jpg')
    } finally {
      release()
      await Promise.allSettled([first, second])
      reader.mock.restore()
    }
  })

  await t.test('cache hits, explicit refresh and file resolution preserve image behavior', async () => {
    const store = new DanbooruCharacterImageStore()
    const row = rows[0]
    const before = await store.getRecords(row)
    const added = path.join(imageRoot, row.name, 'image3.gif')
    await fs.promises.writeFile(added, 'new')
    assert.equal(await store.getRecords(row), before)
    store.clear()
    assert.deepEqual((await store.getRecords(row)).map((image) => image.fileName), ['image1.jpg', 'image2.webp', 'image3.gif', 'image10.PNG'])
    assert.equal(await store.getFilePath(row, 'image3.gif'), added)
    assert.equal(await store.getFilePath(row, '../image3.gif'), null)
    assert.equal(await store.getFilePath(row, 'ignored.txt'), null)
    assert.equal(await store.getFilePath(row, 'ignored.png'), null)
    assert.equal(await store.getFilePath(row, 'missing.png'), null)
    const fallback = { tag_id: 101, name: 'name:with:colons', normalized_name: 'name:with:colons' }
    const fallbackDirectory = path.join(imageRoot, 'name_with_colons__101')
    await fs.promises.mkdir(fallbackDirectory)
    await fs.promises.writeFile(path.join(fallbackDirectory, '1.webp'), 'fallback')
    assert.deepEqual((await store.getRecords(fallback)).map((image) => image.fileName), ['1.webp'])
  })

  await t.test('clearing during a read does not repopulate the cache with its old result', async (t) => {
    const store = new DanbooruCharacterImageStore()
    const row = rows[1]
    const original = fs.promises.readdir
    let release!: () => void
    let started!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const snapshotReady = new Promise<void>((resolve) => { started = resolve })
    let calls = 0
    const reader = t.mock.method(fs.promises, 'readdir', async (...args: Parameters<typeof original>) => {
      calls += 1
      const entries = await original(...args)
      if (calls === 1) { started(); await blocked }
      return entries
    })
    const old = store.getRecords(row)
    try {
      await snapshotReady
      store.clear()
      await fs.promises.writeFile(path.join(imageRoot, row.name, 'image4.gif'), 'new')
      const fresh = await store.getRecords(row)
      release()
      assert.equal((await old).some((image) => image.fileName === 'image4.gif'), false)
      assert.equal(fresh.some((image) => image.fileName === 'image4.gif'), true)
      assert.equal(await store.getRecords(row), fresh)
      assert.equal(calls, 2)
    } finally {
      release()
      await Promise.allSettled([old])
      reader.mock.restore()
    }
  })

  await t.test('failed reads are retryable rather than cached', async (t) => {
    const store = new DanbooruCharacterImageStore()
    const original = fs.promises.readdir
    const reader = t.mock.method(fs.promises, 'readdir', async () => { throw new Error('read failed') })
    try {
      await assert.rejects(store.getRecords(rows[2]), /read failed/)
      reader.mock.restore()
      assert.equal((await store.getRecords(rows[2])).length, 3)
    } finally {
      reader.mock.restore()
    }
  })

  await t.test('least-recently-used character entries are evicted instead of growing forever', async (t) => {
    const store = new DanbooruCharacterImageStore()
    const original = fs.promises.stat
    let stats = 0
    const stat = t.mock.method(fs.promises, 'stat', async (...args: Parameters<typeof original>) => {
      stats += 1
      return original(...args)
    })
    const missing = (tag_id: number) => ({ tag_id, name: `missing_${tag_id}`, normalized_name: `missing_${tag_id}` })
    try {
      const oldestRecords = await store.getRecords(missing(1001))
      for (let id = 1000; id < 1500; id += 1) await store.getRecords(missing(id))
      await store.getRecords(missing(1000)) // Refresh recency before inserting one more character.
      await store.getRecords(missing(1500))
      const beforeHit = stats
      await store.getRecords(missing(1000))
      assert.equal(stats, beforeHit, 'the recently accessed character remains cached')
      assert.notEqual(await store.getRecords(missing(1001)), oldestRecords, 'evicted records are loaded anew even if their directory remains cached')
      // Directory recency is independent: exercise it through file lookups, not records-cache hits.
      store.clear()
      for (let id = 1000; id < 1500; id += 1) await store.getFilePath(missing(id), 'image.png')
      await store.getFilePath(missing(1000), 'image.png')
      await store.getFilePath(missing(1500), 'image.png')
      const beforeDirectoryHit = stats
      await store.getFilePath(missing(1000), 'image.png')
      assert.equal(stats, beforeDirectoryHit)
      await store.getFilePath(missing(1001), 'image.png')
      assert.ok(stats > beforeDirectoryHit, 'the oldest directory has to be resolved again')
    } finally {
      stat.mock.restore()
    }
  })
})
