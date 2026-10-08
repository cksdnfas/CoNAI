import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { test } from 'node:test'

/**
 * Every state-changing API route must refuse a signed-in account that holds no permission, unless it is one of the
 * few actions any account may take on its own things (listed below with the reason). A new route that forgets its
 * guard fails here instead of shipping open to every guest.
 */
const OPEN_TO_ANY_ACCOUNT: Record<string, string> = {
  'POST /api/auth/login': 'signing in',
  'POST /api/auth/logout': 'signing out',
  'POST /api/auth/setup': 'first-run setup, refused once accounts exist',
  'POST /api/auth/guest-accounts': 'visitor signup, gated by auth.guest.create',
  'POST /api/search-history': 'own search history',
  'DELETE /api/search-history': 'own search history',
  'DELETE /api/search-history/:id': 'own search history',
  'POST /api/generation-queue/:id/cancel': 'own queued job (kept after the generation grant is revoked)',
  'POST /api/jobs/:jobId/cancel': 'own runtime job',
  'DELETE /api/public-workflows/:slug/history': 'own public workflow runs',
  'POST /api/public-workflows/:slug/cleanup-failed': 'own failed public workflow runs',
  'POST /api/chat-proposals/:proposalId/apply': 'proposal in own chat, rechecked against the action it applies',
  'POST /api/chat-proposals/:proposalId/dismiss': 'proposal in own chat',
  'POST /api/chat-proposals/:proposalId/undo': 'proposal in own chat',
  'POST /api/chat-proposals/:proposalId/page-check': 'proposal in own chat',
  'POST /api/chat-proposals/:proposalId/page-applied': 'proposal in own chat',
}

test('state-changing API routes refuse an account without permissions', { timeout: 120000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-route-sweep-'))
  process.env.RUNTIME_BASE_PATH = root
  for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
    process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
  }
  process.env.FRONTEND_DIST_PATH = path.join(root, 'no-frontend')

  // Record every route as it is registered: [router, method, path] and where each router is mounted. The app's route
  // modules load express through require, so the patch must reach that same instance.
  // tsx can hand ESM imports and requires separate copies of express; patch every copy the app might use. Each router
  // is a function whose prototype is its own Router instance, so the shared methods live one level further up.
  const express = (await import('express')).default
  const required = createRequire(__filename)('express') as typeof import('express')
  const shared = (router: unknown) => Object.getPrototypeOf(Object.getPrototypeOf(router))
  const routerProtos = [...new Set([shared(express.Router()), shared(required.Router())])] as Array<Record<string, (...args: unknown[]) => unknown>>
  const routes: Array<{ owner: object; method: string; path: string }> = []
  const mounts: Array<{ parent: object; path: string; child: object }> = []
  const isRouter = (value: unknown) => typeof value === 'function' && routerProtos.includes(shared(value))
  for (const routerProto of routerProtos) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const original = routerProto[method]
      routerProto[method] = function (this: object, ...args: unknown[]) {
        if (typeof args[0] === 'string') routes.push({ owner: this, method: method.toUpperCase(), path: args[0] })
        return original.apply(this, args)
      }
    }
    const originalUse = routerProto.use
    routerProto.use = function (this: object, ...args: unknown[]) {
      const mountPath = typeof args[0] === 'string' ? args[0] : '/'
      for (const handler of args) if (isRouter(handler)) mounts.push({ parent: this, path: mountPath, child: handler as object })
      return originalUse.apply(this, args)
    }
  }

  const authModule = await import('../src/database/authDb')
  authModule.initializeAuthDb()
  const auth = authModule.getAuthDb()
  const main = await import('../src/database/init')
  await main.initializeDatabase()
  const user = await import('../src/database/userSettingsDb')
  user.initializeUserSettingsDb()
  ;(await import('../src/database/apiGenerationDb')).initializeApiGenerationDb()
  const { invalidateConfiguredAuthCache } = await import('../src/routes/auth-route-helpers')
  const { registerAppRoutes } = await import('../src/startup/registerAppRoutes')
  t.after(async () => {
    auth.close()
    user.closeUserSettingsDb()
    main.closeDatabase()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
    assert.ok(path.basename(root).startsWith('conai-route-sweep-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  const app = express()
  const appRouter = (app as unknown as { router: object }).router
  app.use(express.json())
  const accountId = Number(auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES ('nobody', 'unused', 'guest')").run().lastInsertRowid)
  auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES ('admin', 'unused', 'admin')").run()
  invalidateConfiguredAuthCache()
  app.use((req, _res, next) => {
    Object.assign(req, { sessionID: 'sweep', session: { authenticated: true, accountId, accountType: 'guest' } })
    next()
  })
  const pass = (_req: unknown, _res: unknown, next: () => void) => next()
  registerAppRoutes(app, { uploadsDir: path.join(root, 'uploads'), tempDir: path.join(root, 'temp'), saveDir: path.join(root, 'save'), mcpLimiter: pass, readOnlyLimiter: pass, uploadLimiter: pass })
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`

  // Full paths: walk mounts upward from each route's router to the app.
  const prefixes = (owner: object): string[] => {
    if (owner === appRouter) return ['']
    return mounts.filter((mount) => mount.child === owner).flatMap((mount) => prefixes(mount.parent).map((prefix) => `${prefix}${mount.path === '/' ? '' : mount.path}`))
  }
  const writes = [...new Set(routes
    .filter((route) => route.method !== 'GET')
    .flatMap((route) => prefixes(route.owner).map((prefix) => `${route.method} ${prefix}${route.path === '/' ? '' : route.path}` || '/'))
    .filter((key) => / \/api\//.test(key)))].sort()
  assert.ok(writes.length > 100, `found ${writes.length} write routes`)

  const open: string[] = []
  for (const key of writes) {
    if (OPEN_TO_ANY_ACCOUNT[key]) continue
    const [method, template] = key.split(' ')
    const url = template.replace(/:[A-Za-z_]+(\([^)]*\))?\??/g, '1').replace(/\*[A-Za-z_]*/g, 'x')
    const response = await fetch(origin + url, { method, headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(10000) }).catch((error: Error) => ({ status: `error ${error.name}` }))
    if ('arrayBuffer' in response) await response.arrayBuffer()
    if (response.status !== 401 && response.status !== 403) open.push(`${key} → ${response.status}`)
  }
  assert.deepEqual(open, [], 'routes an account without permissions reached past the guard')
})
