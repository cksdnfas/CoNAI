import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

test('maintenance routes are admin-only and search history is per account', { timeout: 60000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-admin-guards-'))
  process.env.RUNTIME_BASE_PATH = root
  for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
    process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
  }
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
  t.after(async () => {
    auth.close()
    user.closeUserSettingsDb()
    main.closeDatabase()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
    assert.ok(path.basename(root).startsWith('conai-admin-guards-'))
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
  const call = async (url: string, accountId: number, method = 'GET', body: unknown = {}) => {
    const response = await fetch(origin + url, { method, headers: { 'x-test-account': String(accountId), 'Content-Type': 'application/json' }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) })
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null }
  }

  const addAccount = (name: string, type: 'admin' | 'guest') => Number(auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES (?, 'unused', ?)").run(name, type).lastInsertRowid)
  const adminId = addAccount('admin-test', 'admin')
  auth.prepare("INSERT INTO auth_account_group_memberships (account_id, group_id) SELECT ?, id FROM auth_permission_groups WHERE group_key = 'admin'").run(adminId)
  const group = AuthPermissionGroup.createCustomGroup({ name: 'viewer', permissionKeys: ['images.view'] })
  const guestId = addAccount('viewer', 'guest')
  const otherId = addAccount('viewer-2', 'guest')
  AuthPermissionGroup.addAccountMembership(group.id, guestId)
  AuthPermissionGroup.addAccountMembership(group.id, otherId)
  invalidateConfiguredAuthCache()

  await t.test('a guest with image viewing cannot run server maintenance', async () => {
    const maintenance: Array<[string, string]> = [
      ['/api/system/cache-stats', 'GET'], ['/api/system/cache-stats/reset', 'POST'], ['/api/system/cache/invalidate', 'POST'],
      ['/api/system/maintenance/orphan-cleanup', 'POST'], ['/api/system/database-backups', 'GET'], ['/api/system/database-backups', 'POST'],
      ['/api/system/maintenance/compact-database', 'POST'], ['/api/system/database-stats', 'GET'],
      ['/api/system/database-backups/20260101-000000/download', 'GET'], ['/api/system/database-backups/20260101-000000', 'DELETE'],
      ['/api/file-verification/stats', 'GET'], ['/api/file-verification/verify', 'POST'], ['/api/file-verification/settings', 'PUT'],
      ['/api/civitai/settings', 'PUT'], ['/api/civitai/stats/reset', 'POST'], ['/api/civitai/models', 'DELETE'],
      ['/api/civitai/rescan-all', 'POST'], ['/api/civitai/reset-failed', 'POST'], ['/api/civitai/lookup/abc', 'POST'],
    ]
    for (const [url, method] of maintenance) assert.equal((await call(url, guestId, method)).status, 403, `${method} ${url}`)
    assert.equal((await call('/api/civitai/settings', guestId)).status, 200, 'model info reads stay open to image viewers')
    assert.equal((await call('/api/file-verification/stats', adminId)).status, 200)
    assert.equal((await call('/api/civitai/settings', adminId, 'PUT', { enabled: false })).status, 200)
    assert.equal((await call('/api/system/database-backups', adminId)).status, 200)
    ;(await import('../src/services/runtimeJobs')).registerRuntimeJobHandlers()
    const dryRun = await call('/api/system/maintenance/orphan-cleanup', adminId, 'POST', {})
    assert.equal(dryRun.status, 202)
    assert.equal(dryRun.body.data.kind, 'media-orphan-cleanup')
    let job = dryRun.body.data
    for (let i = 0; i < 100 && (job.status === 'queued' || job.status === 'running'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      job = (await call(`/api/jobs/${job.jobId}`, adminId)).body.data
    }
    assert.equal(job.status, 'completed', `orphan cleanup dry run finished: ${job.failureMessage ?? ''}`)
    assert.equal(job.result.dryRun, true, 'an empty body is a dry run')

    const compact = await call('/api/system/maintenance/compact-database', adminId, 'POST', {})
    assert.equal(compact.status, 202, JSON.stringify(compact.body))
    job = compact.body.data
    for (let i = 0; i < 100 && (job.status === 'queued' || job.status === 'running'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      job = (await call(`/api/jobs/${job.jobId}`, adminId)).body.data
    }
    assert.equal(job.status, 'completed', `VACUUM finished: ${job.failureMessage ?? ''}`)
    assert.ok(job.result.bytesAfter <= job.result.bytesBefore)
  })

  await t.test('database stats, backup download and delete', async () => {
    const stats = await call('/api/system/database-stats', adminId)
    assert.equal(stats.status, 200)
    const images = stats.body.data.databases.find((entry: { fileName: string }) => entry.fileName === 'images.db')
    assert.ok(images, 'images.db listed')
    for (const key of ['fileBytes', 'walBytes', 'pageSize', 'pageCount', 'databaseBytes', 'freelistPages', 'reclaimableBytes']) {
      assert.equal(typeof images[key], 'number', key)
    }
    assert.equal(images.databaseBytes, images.pageSize * images.pageCount)
    assert.equal(images.reclaimableBytes, images.pageSize * images.freelistPages)
    assert.ok(images.fileBytes >= images.walBytes)

    // A real backup, with per-file byte progress on the job.
    const started = await call('/api/system/database-backups', adminId, 'POST', {})
    assert.equal(started.status, 202)
    let job = started.body.data
    for (let i = 0; i < 200 && (job.status === 'queued' || job.status === 'running'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      job = (await call(`/api/jobs/${job.jobId}`, adminId)).body.data
    }
    assert.equal(job.status, 'completed', job.failureMessage ?? '')
    assert.match(job.phase ?? '', /\.db$/, 'phase names the file being copied')
    assert.equal(job.progress.processed, job.progress.total, 'progress counts bytes of the last file')
    assert.equal(job.progress.total % 512, 0, 'bytes, not pages')
    const latest = (await call('/api/jobs?kind=database-backup&limit=1', adminId)).body.data
    assert.equal(latest[0].jobId, job.jobId, 'the jobs API filters by kind for the last result')

    const stamp = (await call('/api/system/database-backups', adminId)).body.data.backups[0].name as string
    const download = await fetch(`${origin}/api/system/database-backups/${stamp}/download`, { headers: { 'x-test-account': String(adminId) } })
    assert.equal(download.status, 200)
    assert.equal(download.headers.get('content-type'), 'application/zip')
    const AdmZip = (await import('adm-zip')).default
    const names = new AdmZip(Buffer.from(await download.arrayBuffer())).getEntries().map((entry) => entry.entryName).sort()
    assert.ok(names.includes('images.db') && names.includes('user.db'), names.join(','))

    // Only finished stamp folders: no traversal, no .partial, no files posing as folders.
    const backupRoot = path.join(root, 'database', 'backups')
    fs.mkdirSync(path.join(backupRoot, '20260101-000000.partial'), { recursive: true })
    fs.writeFileSync(path.join(backupRoot, '20260101-000001'), 'not a folder')
    for (const bad of ['..', '..%2F..%2Fdatabase', '%2E%2E', '20260101-000000.partial', '20260101-000001', 'images.db', '20991231-235959']) {
      assert.equal((await call(`/api/system/database-backups/${bad}/download`, adminId)).status, 404, `download ${bad}`)
      assert.equal((await call(`/api/system/database-backups/${bad}`, adminId, 'DELETE')).status, 404, `delete ${bad}`)
    }
    assert.ok(fs.existsSync(path.join(backupRoot, '20260101-000000.partial')))

    // Refused while a backup job is queued or running.
    const { RuntimeJobStore } = await import('../src/services/runtimeJobs/runtimeJobStore')
    const live = RuntimeJobStore.create({ kind: 'database-backup', singletonKey: 'test-live-backup' })
    assert.equal((await call(`/api/system/database-backups/${stamp}`, adminId, 'DELETE')).status, 409)
    assert.ok(fs.existsSync(path.join(backupRoot, stamp)))
    RuntimeJobStore.markCancelled(live.jobId, 'test')

    assert.equal((await call(`/api/system/database-backups/${stamp}`, adminId, 'DELETE')).status, 200)
    assert.ok(!fs.existsSync(path.join(backupRoot, stamp)))
    assert.equal((await call(`/api/system/database-backups/${stamp}/download`, adminId)).status, 404)
  })

  await t.test('search history belongs to the account that saved it', async () => {
    const chips = [{ id: 'c1', scope: 'positive', operator: 'OR', label: 'cat', value: 'cat' }]
    assert.equal((await call('/api/search-history', guestId, 'POST', { label: 'mine', chips })).status, 201)
    assert.equal((await call('/api/search-history', otherId, 'POST', { label: 'theirs', chips })).status, 201)
    const mine = (await call('/api/search-history', guestId)).body.data as Array<{ id: string; label: string }>
    const theirs = (await call('/api/search-history', otherId)).body.data as Array<{ id: string; label: string }>
    assert.deepEqual(mine.map((entry) => entry.label), ['mine'])
    assert.deepEqual(theirs.map((entry) => entry.label), ['theirs'])
    assert.equal((await call(`/api/search-history/${theirs[0].id}`, guestId, 'DELETE')).status, 404)
    await call('/api/search-history', guestId, 'DELETE')
    assert.equal((await call('/api/search-history', otherId)).body.data.length, 1, 'clearing is per account')
  })

  await t.test('a demoted admin loses admin-only routes at once', async () => {
    assert.equal((await call('/api/file-verification/stats', adminId)).status, 200)
    auth.prepare("UPDATE auth_accounts SET account_type = 'guest' WHERE id = ?").run(adminId)
    assert.equal((await call('/api/file-verification/stats', adminId)).status, 403)
  })
})
