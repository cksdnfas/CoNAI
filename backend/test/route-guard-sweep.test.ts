import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { test } from 'node:test'

/**
 * Every state-changing API route must refuse a signed-in account that holds no permission, unless it is one of the
 * actions any account may take (its own things, generation and new copies; listed below with the reason). With only
 * the read right, every route that changes or removes shared data must still refuse. A new route that forgets its
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
  'POST /api/public-workflows/:slug/queue': 'published workflow, bounded by its per-role queue limit',
  'POST /api/generation-history/download/batch': 'own runs only',
  'DELETE /api/generation-history/:id': 'own run (with its files when asked)',
  'POST /api/generation-history/clear': 'own runs',
  'POST /api/generation-history/cleanup-failed': 'own failed runs',
  'POST /api/generation-queue': 'generation',
  'POST /api/generation-queue/:id/retry': 'own queued job',
  'POST /api/workflows/:id/generate': 'generation',
  'POST /api/graph-workflows/:id/execute': 'generation',
  'POST /api/graph-workflows/:id/nodes/:nodeId/execute': 'generation',
  'POST /api/graph-workflows/executions/:executionId/cancel': 'generation (no owner is recorded; any account that may generate, as before)',
  'POST /api/graph-workflows/input-images': 'generation input upload',
  'POST /api/graph-workflows/schedules': 'own schedule',
  'PUT /api/graph-workflows/schedules/:scheduleId': 'own schedule; others need edit',
  'DELETE /api/graph-workflows/schedules/:scheduleId': 'own schedule; others need delete',
  'POST /api/graph-workflows/schedules/:scheduleId/pause': 'own schedule; others need edit',
  'POST /api/graph-workflows/schedules/:scheduleId/resume': 'own schedule',
  'POST /api/graph-workflows/schedules/:scheduleId/run-now': 'own schedule',
  'POST /api/workflow-input-assets': 'generation input upload',
  'DELETE /api/workflow-input-assets/:assetId': 'generation input upload',
  'POST /api/refmod-entries/:id/build': 'generation',
  'POST /api/nai/cost/calculate': 'generation cost estimate',
  'POST /api/image-editor/inpaint': 'new copy (media processing)',
  'POST /api/images/convert-webp': 'converts an uploaded file, saves nothing',
  'POST /api/images/rewrite-metadata': 'rewrites an uploaded file, saves nothing',
  'POST /api/images/extract-metadata': 'reads an uploaded file, saves nothing',
  'POST /api/images/extract-tagger': 'reads an uploaded file, saves nothing',
  'POST /api/images/extract-kaloscope': 'reads an uploaded file, saves nothing',
  'POST /api/chat-proposals/:proposalId/apply': 'proposal in own chat, rechecked against the action it applies',
  'POST /api/chat-proposals/:proposalId/dismiss': 'proposal in own chat',
  'POST /api/chat-proposals/:proposalId/undo': 'proposal in own chat',
  'POST /api/chat-proposals/:proposalId/page-check': 'proposal in own chat',
  'POST /api/chat-proposals/:proposalId/page-applied': 'proposal in own chat',
  'POST /api/chat-proposals/:proposalId/task-approve': 'task plan in own chat',
  'DELETE /api/wallpaper-runtime/session': "drops this browser's own wallpaper key session",
}

/** Writes that only read shared data, or make new copies from library sources: the read right is enough. */
const OPEN_TO_READERS: Record<string, string> = {
  'POST /api/images/batch': 'read',
  'POST /api/images/download/batch': 'read',
  'POST /api/images/random-from-search': 'read',
  'POST /api/images/search': 'read',
  'POST /api/images/search/ids': 'read',
  'POST /api/images/search/complex': 'read',
  'POST /api/images/search/complex/ids': 'read',
  'POST /api/images/search/complex/validate': 'read',
  'POST /api/images/search-by-autotags': 'read',
  'POST /api/images/batch-resize': 'new copies of library images',
  'POST /api/groups/resolve-path': 'read; creating missing groups needs edit',
  'POST /api/prompt-collection/resolve-groups': 'read',
  'PUT /api/prompt-collection/editor-settings': "the account's own editor settings",
  'POST /api/wildcards/parse': 'read',
  'POST /api/workflows/check': 'read',
  'POST /api/art-styles/export': 'read',
  'POST /api/character-library/settings/export': 'read',
  'POST /api/refmod-entries/export': 'read',
  'POST /api/files/:id/reindex': 'retries search indexing, content unchanged',
  'POST /api/workspaces/:id/read': 'read',
  'POST /api/workspaces/:id/search': 'read',
  'PUT /api/workspaces/threads/:threadId': 'own chat thread; write mode needs edit',
  'POST /api/sprite/extract': 'new copies of library images',
  'POST /api/sprite/extract-batch': 'new copies of library images',
  'POST /api/sprite/normalize': 'new copies of library images',
  'POST /api/sprite/normalize-sources': 'new copies of library images',
  'POST /api/sprite/animation': 'new copies of library images',
  'POST /api/sprite/builds/:buildId/save': 'saves a new copy',
  'POST /api/sprite/batches/:jobId/stop': 'own job',
  'POST /api/audio/orders': 'generation',
  'POST /api/audio/orders/:orderId/cancel': 'generation',
  'POST /api/audio/orders/:orderId/jobs/:idx/retry': 'generation',
  'POST /api/audio/candidates/:candidateId/preview': 'preview render, saves nothing',
  // The board: writing, commenting, voting and calling bots are the reader's own; the store checks the author.
  'POST /api/posts': 'own post',
  'PATCH /api/posts/:id': 'own post',
  'DELETE /api/posts/:id': 'own post',
  'POST /api/posts/:id/trash': 'own post',
  'POST /api/posts/:id/restore': 'own post',
  'POST /api/posts/:id/permanent-delete': 'own post',
  'POST /api/posts/:id/permanent-delete/preview': 'own post',
  'POST /api/posts/:id/topic-evaluation': 'own post',
  'PATCH /api/posts/:id/knowledge': 'own post',
  'POST /api/posts/:id/knowledge/versions/:contentVersion/restore': 'own post',
  'POST /api/posts/:id/review': 'reporting an error; the other review actions need edit (checked in the store)',
  'POST /api/posts/:id/comments': 'own comment',
  'PATCH /api/posts/comments/:id': 'own comment',
  'DELETE /api/posts/comments/:id': 'own comment',
  'PUT /api/posts/:id/vote': 'own vote',
  'DELETE /api/posts/:id/vote': 'own vote',
  'PUT /api/posts/:id/task-fit': 'own vote',
  'POST /api/posts/:id/evaluations/:requestId/cancel': 'own evaluation request',
  'POST /api/posts/knowledge/proposals': 'own proposal',
  'POST /api/posts/knowledge/proposals/:proposalId/apply': 'proposal on own post',
  'POST /api/posts/knowledge/proposals/:proposalId/reject': 'proposal on own post',
  'POST /api/posts/runs/:id/cancel': 'own bot run',
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
  const { invalidateConfiguredAuthCache } = await import('../src/services/auth/sessionAccess')
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
  const readerId = Number(auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES ('reader', 'unused', 'guest')").run().lastInsertRowid)
  auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES ('admin', 'unused', 'admin')").run()
  const { AuthPermissionGroup } = await import('../src/models/AuthPermissionGroup')
  AuthPermissionGroup.addAccountMembership(AuthPermissionGroup.createCustomGroup({ name: 'readers', permissionKeys: ['content.read'] }).id, readerId)
  invalidateConfiguredAuthCache()
  app.use((req, _res, next) => {
    const id = Number(req.header('x-sweep-account')) || accountId
    Object.assign(req, { sessionID: `sweep-${id}`, session: { authenticated: true, accountId: id, accountType: 'guest' } })
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

  const reached = async (key: string, asAccount: number) => {
    const [method, template] = key.split(' ')
    const url = template.replace(/:[A-Za-z_]+(\([^)]*\))?\??/g, '1').replace(/\*[A-Za-z_]*/g, 'x')
    const response = await fetch(origin + url, { method, headers: { 'Content-Type': 'application/json', 'x-sweep-account': String(asAccount) }, body: '{}', signal: AbortSignal.timeout(10000) }).catch((error: Error) => ({ status: `error ${error.name}` }))
    if ('arrayBuffer' in response) await response.arrayBuffer()
    return response.status !== 401 && response.status !== 403 ? `${key} → ${response.status}` : null
  }
  const open: string[] = []
  const readerOpen: string[] = []
  for (const key of writes) {
    if (OPEN_TO_ANY_ACCOUNT[key]) continue
    const none = await reached(key, accountId)
    if (none) open.push(none)
    if (OPEN_TO_READERS[key]) continue
    const reader = await reached(key, readerId)
    if (reader) readerOpen.push(reader)
  }
  assert.deepEqual(open, [], 'routes an account without permissions reached past the guard')
  assert.deepEqual(readerOpen, [], 'edit or delete routes an account with only the read right reached past the guard')
  for (const key of Object.keys(OPEN_TO_READERS)) assert.ok(writes.includes(key), `${key} is still a route`)
})
