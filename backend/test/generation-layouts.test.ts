import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

test('generation layout presets are readable by every account and editable only by admins with a current revision', { timeout: 60000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-generation-layouts-'))
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
  const { invalidateConfiguredAuthCache } = await import('../src/services/auth/sessionAccess')
  t.after(async () => {
    auth.close()
    user.closeUserSettingsDb()
    main.closeDatabase()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
    assert.ok(path.basename(root).startsWith('conai-generation-layouts-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  const express = (await import('express')).default
  const { registerAppRoutes } = await import('../src/startup/registerAppRoutes')
  const app = express()
  const sessions = new Map<string, Record<string, unknown>>()
  app.use(express.json({ limit: '1mb' }))
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
    return { status: response.status, body: text ? JSON.parse(text) : null }
  }

  const addAccount = (name: string, type: 'admin' | 'guest') => Number(auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES (?, 'unused', ?)").run(name, type).lastInsertRowid)
  const adminId = addAccount('layout-admin', 'admin')
  auth.prepare("INSERT INTO auth_account_group_memberships (account_id, group_id) SELECT ?, id FROM auth_permission_groups WHERE group_key = 'admin'").run(adminId)
  // A guest with no page grants at all: public workflow pages still read the presets.
  const group = AuthPermissionGroup.createCustomGroup({ name: 'nothing', permissionKeys: [] })
  const guestId = addAccount('layout-guest', 'guest')
  AuthPermissionGroup.addAccountMembership(group.id, guestId)
  invalidateConfiguredAuthCache()

  const { GENERATION_LAYOUT_SURFACES } = await import('@conai/shared')
  const layoutsFile = path.join(root, 'config', 'generation-layouts.json')
  const custom = { id: 'wide-result', name: '결과 넓게', columns: [{ weight: 30, blocks: ['prompt', 'settings'] }, { weight: 70, blocks: ['result'] }], hidden: [] }

  await t.test('every signed-in account reads all surfaces; signed-out requests are refused', async () => {
    assert.equal((await call('/api/generation-layouts', 0)).status, 401)
    const response = await call('/api/generation-layouts', guestId)
    assert.equal(response.status, 200)
    assert.deepEqual(Object.keys(response.body.data).sort(), [...GENERATION_LAYOUT_SURFACES].sort())
    for (const surface of GENERATION_LAYOUT_SURFACES) {
      const snapshot = response.body.data[surface]
      assert.ok(snapshot.presets.length > 0, surface)
      assert.equal(typeof snapshot.revision, 'string', surface)
    }
  })

  await t.test('writes are refused for non-admins, unknown surfaces, missing revisions and empty lists', async () => {
    const { revision, presets } = (await call('/api/generation-layouts', adminId)).body.data.nai
    assert.equal((await call('/api/generation-layouts/nai', guestId, 'PUT', { presets }, { 'If-Match': revision })).status, 403)
    assert.equal((await call('/api/generation-layouts/nai', 0, 'PUT', { presets }, { 'If-Match': revision })).status, 401)
    assert.equal((await call('/api/generation-layouts/not-a-surface', adminId, 'PUT', { presets }, { 'If-Match': revision })).status, 404)
    assert.equal((await call('/api/generation-layouts/nai', adminId, 'PUT', { presets })).status, 428)
    assert.equal((await call('/api/generation-layouts/nai', adminId, 'PUT', { presets: [] }, { 'If-Match': revision })).status, 400)
    assert.equal((await call('/api/generation-layouts/nai', adminId, 'PUT', {}, { 'If-Match': revision })).status, 400)
    assert.equal(fs.existsSync(layoutsFile), false, 'nothing was written')
  })

  await t.test('an admin save returns the new revision, normalizes the list and leaves other surfaces alone', async () => {
    const before = (await call('/api/generation-layouts', adminId)).body.data
    const saved = await call('/api/generation-layouts/nai', adminId, 'PUT', { presets: [...before.nai.presets, custom] }, { 'If-Match': before.nai.revision })
    assert.equal(saved.status, 200)
    assert.notEqual(saved.body.data.revision, before.nai.revision)
    const stored = saved.body.data.presets.find((preset: { id: string }) => preset.id === 'wide-result')
    assert.ok(stored, 'custom preset kept')
    // Required blocks the custom list left out come back, so no preset can lose them.
    const placed = new Set([...stored.columns.flatMap((column: { blocks: string[] }) => column.blocks), ...stored.hidden])
    for (const block of before.nai.presets[0].columns.flatMap((column: { blocks: string[] }) => column.blocks)) assert.ok(placed.has(block), block)
    assert.ok(stored.columns.some((column: { blocks: string[] }) => column.blocks.includes('action')), 'required block shown')
    assert.ok(!stored.hidden.includes('action'))

    const after = (await call('/api/generation-layouts', guestId)).body.data
    assert.equal(after.nai.revision, saved.body.data.revision)
    for (const surface of GENERATION_LAYOUT_SURFACES.filter((item) => item !== 'nai')) assert.equal(after[surface].revision, before[surface].revision, surface)
    assert.equal(JSON.parse(fs.readFileSync(layoutsFile, 'utf8')).version, 2)
  })

  await t.test('a save from a stale revision conflicts and keeps the newer list', async () => {
    const first = (await call('/api/generation-layouts', adminId)).body.data.comfy
    const winner = await call('/api/generation-layouts/comfy', adminId, 'PUT', { presets: [...first.presets, { ...custom, id: 'first-admin' }] }, { 'If-Match': first.revision })
    assert.equal(winner.status, 200)
    const loser = await call('/api/generation-layouts/comfy', adminId, 'PUT', { presets: [...first.presets, { ...custom, id: 'second-admin' }] }, { 'If-Match': first.revision })
    assert.equal(loser.status, 409)
    const current = (await call('/api/generation-layouts', adminId)).body.data.comfy
    assert.equal(current.revision, winner.body.data.revision)
    assert.deepEqual(current.presets.map((preset: { id: string }) => preset.id).filter((id: string) => id.endsWith('-admin')), ['first-admin'])
  })

  await t.test('a version 1 file is read as the NAI list', async () => {
    fs.writeFileSync(layoutsFile, JSON.stringify({ version: 1, presets: [{ ...custom, id: 'legacy-only' }] }))
    const data = (await call('/api/generation-layouts', adminId)).body.data
    assert.deepEqual(data.nai.presets.map((preset: { id: string }) => preset.id), ['legacy-only'])
    assert.ok(data.comfy.presets.length > 0)
  })
})
