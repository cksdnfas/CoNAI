import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

test('administrators browse server folders and manage the RecycleBin safely', { timeout: 60000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-system-folders-'))
  process.env.RUNTIME_BASE_PATH = root
  for (const part of ['UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
    process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
  }
  // The databases sit inside a browsable root on purpose: they must stay hidden and unreachable.
  process.env.RUNTIME_DATABASE_DIR = path.join(root, 'save', 'database')
  process.env.FRONTEND_DIST_PATH = path.join(root, 'no-frontend')
  const authModule = await import('../src/database/authDb')
  authModule.initializeAuthDb()
  const auth = authModule.getAuthDb()
  const main = await import('../src/database/init')
  await main.initializeDatabase()
  const user = await import('../src/database/userSettingsDb')
  user.initializeUserSettingsDb()
  ;(await import('../src/database/apiGenerationDb')).initializeApiGenerationDb()
  const { AuthPermissionGroup } = await import('../src/models/AuthPermissionGroup')
  const { invalidateConfiguredAuthCache } = await import('../src/routes/auth-route-helpers')
  const recycle = await import('../src/utils/recycleBin')
  t.after(async () => {
    auth.close()
    user.closeUserSettingsDb()
    main.closeDatabase()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
    assert.ok(path.basename(root).startsWith('conai-system-folders-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  const express = (await import('express')).default
  const { registerAppRoutes } = await import('../src/startup/registerAppRoutes')
  const app = express()
  const sessions = new Map<string, Record<string, unknown>>()
  app.use(express.json())
  app.use((req, _res, next) => {
    const id = Number(req.header('x-test-account')) || undefined
    const sid = `test-${id ?? 'anonymous'}`
    // Sessions start with a stale "admin" role so only a fresh account read can grant admin access.
    if (!sessions.has(sid)) sessions.set(sid, { authenticated: Boolean(id), accountId: id, accountType: id ? 'admin' : undefined })
    Object.assign(req, { sessionID: sid, session: sessions.get(sid) })
    next()
  })
  const pass = (_req: unknown, _res: unknown, next: () => void) => next()
  registerAppRoutes(app, { uploadsDir: path.join(root, 'uploads'), tempDir: path.join(root, 'temp'), saveDir: path.join(root, 'save'), mcpLimiter: pass, readOnlyLimiter: pass, uploadLimiter: pass })
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const call = async (url: string, accountId: number, method = 'GET', body: unknown = {}, headers: Record<string, string> = {}) => {
    const response = await fetch(origin + url, { method, headers: { 'x-test-account': String(accountId), 'Content-Type': 'application/json', ...headers }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) })
    const text = await response.text()
    let parsed: any = text
    try { parsed = text ? JSON.parse(text) : null } catch { /* raw body */ }
    return { status: response.status, body: parsed, headers: response.headers }
  }

  const addAccount = (name: string, type: 'admin' | 'guest') => Number(auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES (?, 'unused', ?)").run(name, type).lastInsertRowid)
  const adminId = addAccount('admin-test', 'admin')
  auth.prepare("INSERT INTO auth_account_group_memberships (account_id, group_id) SELECT ?, id FROM auth_permission_groups WHERE group_key = 'admin'").run(adminId)
  const group = AuthPermissionGroup.createCustomGroup({ name: 'file-users', permissionKeys: ['files.view', 'files.edit', 'files.delete', 'images.view'] })
  const guestId = addAccount('file-user', 'guest')
  AuthPermissionGroup.addAccountMembership(group.id, guestId)
  invalidateConfiguredAuthCache()

  const uploads = path.join(root, 'uploads')
  const bin = path.join(root, 'recycle_bin')
  fs.mkdirSync(path.join(uploads, 'images', '2026-10-08'), { recursive: true })
  fs.mkdirSync(bin, { recursive: true })

  await t.test('only administrators reach system folders, even with every file store permission', async () => {
    assert.equal((await call('/api/system-folders', guestId)).status, 403)
    assert.equal((await call('/api/system-folders/uploads', guestId)).status, 403)
    assert.equal((await call('/api/system-folders/recycle-bin/empty', guestId, 'POST')).status, 403)
    assert.equal((await call('/api/system-folders/recycle-bin/restore', guestId, 'POST', { names: ['x'] })).status, 403)
    const roots = await call('/api/system-folders', adminId)
    assert.equal(roots.status, 200)
    assert.deepEqual(roots.body.data.map((item: { id: string }) => item.id), ['recycle-bin', 'uploads', 'save', 'temp', 'logs'])
    assert.ok(!JSON.stringify(roots.body).includes(root), 'root locations stay server-side')
  })

  await t.test('paths cannot leave the root, follow links, or reach the databases', async () => {
    for (const bad of ['..', 'images/../..', 'images\\..\\..', 'C:', 'C:/Windows', '/etc', 'images//2026-10-08', 'a\u0000b']) {
      const response = await call(`/api/system-folders/uploads?path=${encodeURIComponent(bad)}`, adminId)
      assert.ok(response.status === 400 || response.status === 404, `${JSON.stringify(bad)} -> ${response.status}`)
    }
    assert.equal((await call('/api/system-folders/nope', adminId)).status, 404)

    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-outside-'))
    t.after(() => fs.rmSync(outside, { recursive: true, force: true }))
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret')
    fs.symlinkSync(outside, path.join(uploads, 'escape'), 'junction')
    const listing = await call('/api/system-folders/uploads', adminId)
    assert.equal(listing.status, 200)
    assert.ok(!listing.body.data.entries.some((entry: { name: string }) => entry.name === 'escape'), 'links are not listed')
    assert.equal((await call('/api/system-folders/uploads?path=escape', adminId)).status, 403)
    assert.equal((await call('/api/system-folders/uploads/download?path=escape/secret.txt', adminId)).status, 403)
    try {
      fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(uploads, 'link.txt'), 'file')
      assert.equal((await call('/api/system-folders/uploads/download?path=link.txt', adminId)).status, 403)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error // File symlinks need privilege on Windows.
    }

    const save = await call('/api/system-folders/save', adminId)
    assert.equal(save.status, 200)
    assert.ok(!save.body.data.entries.some((entry: { name: string }) => entry.name === 'database'), 'the database folder is hidden')
    assert.equal((await call('/api/system-folders/save/download?path=database/images.db', adminId)).status, 403)
  })

  await t.test('read-only roots list, view and download with byte ranges', async () => {
    fs.writeFileSync(path.join(uploads, 'images', '2026-10-08', '20261008_101010_aaaaaa_a.txt'), 'hello world')
    const listing = await call('/api/system-folders/uploads?path=images/2026-10-08', adminId)
    assert.equal(listing.status, 200)
    assert.equal(listing.body.data.entries[0].path, 'images/2026-10-08/20261008_101010_aaaaaa_a.txt')
    assert.deepEqual(listing.body.data.breadcrumbs.map((crumb: { path: string }) => crumb.path), ['images', 'images/2026-10-08'])
    const ranged = await call('/api/system-folders/uploads/download?path=images/2026-10-08/20261008_101010_aaaaaa_a.txt', adminId, 'GET', {}, { Range: 'bytes=0-4' })
    assert.equal(ranged.status, 206)
    assert.equal(ranged.body, 'hello')
    const view = await call('/api/system-folders/uploads/view?path=images/2026-10-08/20261008_101010_aaaaaa_a.txt', adminId)
    assert.equal(view.status, 200)
    assert.match(view.headers.get('content-type') ?? '', /^text\/plain/)
    assert.equal(view.headers.get('content-security-policy'), 'sandbox')
  })

  await t.test('RecycleBin names never collide and keep deletion order', async () => {
    const now = new Date('2026-10-08T01:02:03.456Z')
    const names = new Set(Array.from({ length: 200 }, () => recycle.generateRecycleBinFileName('/a/ComfyUI_00001_.png', now)))
    assert.equal(names.size, 200)
    const long = recycle.generateRecycleBinFileName(`/a/${'가'.repeat(150)}.png`, now)
    assert.ok(Buffer.byteLength(long, 'utf8') <= 200 && long.endsWith('.png'))
    assert.deepEqual(recycle.parseRecycleBinFileName([...names][0]), { deletedAt: '2026-10-08T01:02:03.456Z', originalName: 'ComfyUI_00001_.png' })
    assert.deepEqual(recycle.parseRecycleBinFileName('2025-01-15T12-30-45-123Z_한글.png'), { deletedAt: '2025-01-15T12:30:45.123Z', originalName: '한글.png' })

    // Two same-named files deleted at once (every copy of one image) both survive.
    const left = path.join(uploads, 'left'); const right = path.join(uploads, 'right')
    fs.mkdirSync(left); fs.mkdirSync(right)
    fs.writeFileSync(path.join(left, 'same.png'), 'L'); fs.writeFileSync(path.join(right, 'same.png'), 'R')
    const [first, second] = await Promise.all([
      recycle.deleteFile(path.join(left, 'same.png'), true, 'library'),
      recycle.deleteFile(path.join(right, 'same.png'), true, 'library'),
    ])
    assert.ok(first && second && first !== second)
    assert.deepEqual([fs.readFileSync(first, 'utf8'), fs.readFileSync(second, 'utf8')].sort(), ['L', 'R'])
  })

  await t.test('RecycleBin files restore to where they came from', async () => {
    const original = path.join(uploads, 'images', '2026-10-08', 'restore-me.png')
    fs.writeFileSync(original, 'v1')
    const binPath = await recycle.deleteFile(original, true, 'library') as string
    const binName = path.basename(binPath)
    const legacyName = '2025-01-15T12-30-45-123Z_legacy.png'
    fs.writeFileSync(path.join(bin, legacyName), 'old')

    const listing = await call('/api/system-folders/recycle-bin?limit=500', adminId)
    assert.equal(listing.status, 200)
    const entry = listing.body.data.entries.find((item: { name: string }) => item.name === binName)
    assert.equal(entry.recycle.restorable, true)
    assert.equal(entry.recycle.originalPath, path.resolve(original))
    assert.equal(entry.recycle.source, 'library')
    assert.equal(entry.recycle.originalName, 'restore-me.png')
    const legacy = listing.body.data.entries.find((item: { name: string }) => item.name === legacyName)
    assert.deepEqual(legacy.recycle, { originalName: 'legacy.png', originalPath: null, deletedAt: '2025-01-15T12:30:45.123Z', source: null, restorable: false })
    const names = listing.body.data.entries.map((item: { name: string }) => item.name)
    assert.deepEqual(names, [...names].sort().reverse(), 'newest first')

    const restored = await call('/api/system-folders/recycle-bin/restore', adminId, 'POST', { names: [binName, legacyName] })
    assert.equal(restored.status, 200)
    assert.deepEqual(restored.body.data.done, [{ name: binName, restoredTo: path.resolve(original) }])
    assert.equal(restored.body.data.failed[0].name, legacyName)
    assert.equal(fs.readFileSync(original, 'utf8'), 'v1')
    assert.ok(!fs.existsSync(binPath))

    // An occupied original location fails unless a sibling name is allowed.
    const again = path.basename(await recycle.deleteFile(original, true, 'library') as string)
    fs.writeFileSync(original, 'v2')
    const refused = await call('/api/system-folders/recycle-bin/restore', adminId, 'POST', { names: [again] })
    assert.equal(refused.body.data.done.length, 0)
    assert.equal(fs.readFileSync(original, 'utf8'), 'v2')
    const renamed = await call('/api/system-folders/recycle-bin/restore', adminId, 'POST', { names: [again], conflict: 'rename' })
    assert.equal(renamed.body.data.done[0].restoredTo, path.join(path.dirname(path.resolve(original)), 'restore-me (복원 1).png'))
    assert.equal(fs.readFileSync(original, 'utf8'), 'v2')

    assert.equal((await call('/api/system-folders/recycle-bin/restore', adminId, 'POST', { names: ['../x'] })).status, 400)
    assert.equal((await call('/api/system-folders/recycle-bin/delete', adminId, 'POST', { names: [] })).status, 400)
  })

  await t.test('permanent delete and empty only touch RecycleBin files', async () => {
    fs.writeFileSync(path.join(bin, '2026-01-01T00-00-00-000Z_a.txt'), 'a')
    const removed = await call('/api/system-folders/recycle-bin/delete', adminId, 'POST', { names: ['2026-01-01T00-00-00-000Z_a.txt', 'missing.txt'] })
    assert.deepEqual(removed.body.data.done, [{ name: '2026-01-01T00-00-00-000Z_a.txt' }])
    assert.equal(removed.body.data.failed[0].name, 'missing.txt')

    fs.mkdirSync(path.join(bin, 'kept-folder'))
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-outside-'))
    t.after(() => fs.rmSync(outside, { recursive: true, force: true }))
    fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep')
    fs.symlinkSync(outside, path.join(bin, 'link'), 'junction')
    const emptied = await call('/api/system-folders/recycle-bin/empty', adminId, 'POST')
    assert.equal(emptied.status, 200)
    assert.ok(emptied.body.data.deleted >= 2)
    assert.deepEqual(fs.readdirSync(bin).sort(), ['kept-folder', 'link'])
    assert.ok(fs.existsSync(path.join(outside, 'keep.txt')), 'nothing behind a link is deleted')
    const after = await call('/api/system-folders/recycle-bin', adminId)
    assert.deepEqual(after.body.data.entries.map((item: { name: string }) => item.name), ['kept-folder'])
    const orphanOrigins = user.getUserSettingsDb().prepare('SELECT COUNT(*) AS count FROM recycle_bin_entries').get() as { count: number }
    assert.equal(orphanOrigins.count, 0)
  })

  await t.test('a file deleted into the bin while it is being emptied stays, with its origin', async () => {
    for (let index = 0; index < 5; index += 1) fs.writeFileSync(path.join(bin, `2026-02-01T00-00-00-00${index}Z_old.txt`), 'old')
    const lateName = '2026-10-08T09-00-00-000Z-late01_late.png'
    const originalUnlink = fs.promises.unlink
    let injected = false
    fs.promises.unlink = (async (target: fs.PathLike) => {
      if (!injected) {
        // Another delete lands in the bin after emptying read the directory.
        injected = true
        fs.writeFileSync(path.join(bin, lateName), 'late')
        user.getUserSettingsDb().prepare("INSERT INTO recycle_bin_entries (bin_name, original_path, size, source) VALUES (?, ?, 4, 'library')").run(lateName, path.join(uploads, 'late.png'))
      }
      return originalUnlink(target)
    }) as typeof fs.promises.unlink
    try {
      const emptied = await call('/api/system-folders/recycle-bin/empty', adminId, 'POST')
      assert.equal(emptied.body.data.deleted, 5)
    } finally {
      fs.promises.unlink = originalUnlink
    }
    assert.ok(fs.existsSync(path.join(bin, lateName)))
    const listing = await call('/api/system-folders/recycle-bin', adminId)
    const late = listing.body.data.entries.find((item: { name: string }) => item.name === lateName)
    assert.equal(late.recycle.restorable, true)
    assert.equal(late.recycle.originalPath, path.join(uploads, 'late.png'))
  })

  await t.test('moving a file back never replaces a file that appeared at the target', async () => {
    const dir = fs.mkdtempSync(path.join(root, 'move-'))
    const source = path.join(dir, 'source.png'); const target = path.join(dir, 'target.png')
    fs.writeFileSync(source, 'from-bin'); fs.writeFileSync(target, 'created-meanwhile')
    await assert.rejects(recycle.moveFileWithoutReplacing(source, target), { code: 'EEXIST' })
    assert.equal(fs.readFileSync(target, 'utf8'), 'created-meanwhile')
    assert.equal(fs.readFileSync(source, 'utf8'), 'from-bin')

    // Without hard links (another volume, FAT, some shares) the exclusive copy refuses the same way.
    const originalLink = fs.promises.link
    fs.promises.link = (async () => { throw Object.assign(new Error('cross-device'), { code: 'EXDEV' }) }) as typeof fs.promises.link
    try {
      await assert.rejects(recycle.moveFileWithoutReplacing(source, target), { code: 'EEXIST' })
      assert.equal(fs.readFileSync(target, 'utf8'), 'created-meanwhile')
      assert.equal(fs.readFileSync(source, 'utf8'), 'from-bin')
      await recycle.moveFileWithoutReplacing(source, path.join(dir, 'free.png'))
      assert.equal(fs.readFileSync(path.join(dir, 'free.png'), 'utf8'), 'from-bin')
      assert.ok(!fs.existsSync(source))
    } finally {
      fs.promises.link = originalLink
    }

    // Through the route: the original spot is taken only after the bin entry was recorded.
    const original = path.join(uploads, 'race.png')
    fs.writeFileSync(original, 'v1')
    const binName = path.basename(await recycle.deleteFile(original, true, 'library') as string)
    fs.writeFileSync(original, 'newer')
    const refused = await call('/api/system-folders/recycle-bin/restore', adminId, 'POST', { names: [binName] })
    assert.equal(refused.body.data.failed[0].name, binName)
    assert.equal(fs.readFileSync(original, 'utf8'), 'newer')
    assert.ok(fs.existsSync(path.join(bin, binName)))
    const renamed = await call('/api/system-folders/recycle-bin/restore', adminId, 'POST', { names: [binName], conflict: 'rename' })
    assert.equal(renamed.body.data.done[0].restoredTo, path.join(uploads, 'race (복원 1).png'))
    assert.equal(fs.readFileSync(path.join(uploads, 'race (복원 1).png'), 'utf8'), 'v1')
    assert.equal(fs.readFileSync(original, 'utf8'), 'newer')
  })
})
