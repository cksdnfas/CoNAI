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
