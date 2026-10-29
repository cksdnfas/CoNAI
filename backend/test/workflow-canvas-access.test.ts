import './support/testTemp'
import './support/scratchRuntime'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { test } from 'node:test'
import express from 'express'
import { initializeAuthDb, getAuthDb } from '../src/database/authDb'
import { initializeDatabase, closeDatabase } from '../src/database/init'
import { initializeUserSettingsDb, closeUserSettingsDb } from '../src/database/userSettingsDb'
import { runtimePaths } from '../src/config/runtimePaths'
import { AuthPermissionGroup } from '../src/models/AuthPermissionGroup'
import { invalidateConfiguredAuthCache } from '../src/services/auth/sessionAccess'
import { workflowRoutes } from '../src/routes/workflows'

test('the integrated canvas listing requires an administrator and image access', async (t) => {
  initializeAuthDb()
  await initializeDatabase()
  initializeUserSettingsDb()
  const auth = getAuthDb()
  const addAccount = (name: string, type: 'admin' | 'guest') => Number(
    auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES (?, 'unused', ?)").run(name, type).lastInsertRowid,
  )
  const admin = addAccount('canvas-admin', 'admin')
  const guest = addAccount('canvas-guest', 'guest')
  auth.prepare("INSERT INTO auth_account_group_memberships (account_id, group_id) SELECT ?, id FROM auth_permission_groups WHERE group_key = 'admin'").run(admin)
  const group = AuthPermissionGroup.createCustomGroup({ name: 'canvas-viewer', permissionKeys: ['workflows.view', 'images.view'] })
  AuthPermissionGroup.addAccountMembership(group.id, guest)
  invalidateConfiguredAuthCache()

  await fs.promises.mkdir(runtimePaths.canvasDir, { recursive: true })
  await fs.promises.writeFile(path.join(runtimePaths.canvasDir, 'canvas.png'), 'image')
  const app = express()
  app.use((req, _res, next) => {
    const accountId = Number(req.header('x-test-account'))
    Object.assign(req, { session: { authenticated: true, accountId, accountType: 'admin' } })
    next()
  })
  app.use('/api/workflows', workflowRoutes)
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    auth.close()
    closeUserSettingsDb()
    closeDatabase()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
  })
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/workflows/canvas-images`
  assert.equal((await fetch(url, { headers: { 'x-test-account': String(guest) } })).status, 403)
  const response = await fetch(url, { headers: { 'x-test-account': String(admin) } })
  assert.equal(response.status, 200)
  const body = await response.json() as { canvasPath: string; data: Array<{ filename: string }> }
  assert.equal(body.canvasPath, runtimePaths.canvasDir)
  assert.deepEqual(body.data.map((image) => image.filename), ['canvas.png'])
})
