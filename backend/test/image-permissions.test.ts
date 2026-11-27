import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'

test('permissions: independent pages, features, migration, grants, scopes and routes', { timeout: 60000 }, async (t) => {
  // Isolate all runtime paths before importing modules that open databases or settings.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-image-permissions-'))
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
  ;(await import('../src/models/ExternalApiProvider')).ExternalApiProvider.create({ provider_name: 'fixture', display_name: 'fixture', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
  ;(await import('../src/database/apiGenerationDb')).initializeApiGenerationDb()
  const { createAuthTables } = await import('../src/database/authDbSchema')
  const { seedAccessControlDefaults } = await import('../src/database/authDbSeed')
  const { PERMISSION_CATALOG, PERMISSION_KEYS, resolvePermissionKeys } = await import('@conai/shared')
  const { AuthPermissionGroup } = await import('../src/models/AuthPermissionGroup')
  const { invalidateConfiguredAuthCache } = await import('../src/services/auth/sessionAccess')
  const { AuthAccessControlService, invalidateResolvedAuthAccessCache } = await import('../src/services/authAccessControlService')
  const { allowRead } = await import('../src/middleware/authMiddleware')
  const { requireRequesterRight } = await import('../src/middleware/featureAccess')
  const { canAccessHistoryRecord } = await import('../src/routes/generation-history/historyRouteHelpers')
  t.after(async () => {
    auth.close()
    user.closeUserSettingsDb()
    main.closeDatabase()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('conai-image-permissions-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const { buildPermissionLayout, setPermissionGrant } = await import('../../frontend/src/features/settings/components/security-permission-catalog')

  const keysOf = (db: InstanceType<typeof Database>, group: string) => (db.prepare('SELECT p.permission_key AS key FROM auth_group_permissions gp JOIN auth_permissions p ON p.id = gp.permission_id JOIN auth_permission_groups g ON g.id = gp.group_id WHERE g.group_key = ? AND gp.allowed = 1 ORDER BY key').all(group) as Array<{ key: string }>).map((row) => row.key)
  const VISITOR_PAGES = ['auth.guest.create', 'content.read', 'page.groups.view', 'page.home.view', 'page.wallpaper.runtime.view', 'page.wallpaper.view']

  await t.test('databases from before v2 convert through every step to pages and read/edit/delete', () => {
    const db = new Database(':memory:')
    createAuthTables(db)
    // An auth database from before v2: old keys exist, grants use them, and nothing has been converted yet.
    const legacy = ['page.home.view', 'page.upload.view', 'prompts.view', 'groups.update', 'prompts.create', 'upload.create', 'files.organize', 'wildcards.lora.scan', 'workflows.update', 'chat.codex.use', 'chat.tools.read', 'images.copy']
    for (const key of legacy) db.prepare('INSERT INTO auth_permissions (permission_key, resource, action) VALUES (?, ?, ?)').run(key, key, 'x')
    for (const key of ['anonymous', 'editor', 'uploader', 'agent', 'stale']) db.prepare('INSERT INTO auth_permission_groups (group_key, name) VALUES (?, ?)').run(key, key)
    const grant = (group: string, key: string) => db.prepare('INSERT INTO auth_group_permissions (group_id, permission_id, allowed) SELECT g.id, p.id, 1 FROM auth_permission_groups g, auth_permissions p WHERE g.group_key = ? AND p.permission_key = ?').run(group, key)
    grant('anonymous', 'page.home.view'); grant('anonymous', 'prompts.view')
    grant('editor', 'groups.update'); grant('editor', 'prompts.create'); grant('editor', 'wildcards.lora.scan'); grant('editor', 'workflows.update')
    grant('uploader', 'upload.create'); grant('uploader', 'files.organize'); grant('uploader', 'images.copy')
    grant('agent', 'chat.codex.use'); grant('agent', 'chat.tools.read')
    grant('stale', 'page.upload.view')
    seedAccessControlDefaults(db)
    const keys = (group: string) => keysOf(db, group)
    assert.deepEqual(keys('editor'), ['content.edit', 'page.sprite.view'], 'editing everywhere; the sprite page needed image viewing, which every account carries from the guest group')
    assert.deepEqual(keys('uploader'), ['content.edit', 'page.upload.view'])
    assert.deepEqual(keys('agent'), ['page.chat.view'], 'reading is inherited; bot tool keys are gone')
    assert.deepEqual(keys('anonymous'), VISITOR_PAGES, 'visitors keep only what a signed-out visitor can use')
    assert.deepEqual(keys('guest'), ['page.characters.view', 'page.extensions.view', 'page.prompts.view'], 'member-only anonymous grants moved to the group every account inherits')
    assert.deepEqual(keys('stale'), [], 'a page stored before v2 never survives')
    assert.deepEqual(keys('admin'), [...PERMISSION_KEYS].sort())
    assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM auth_permissions WHERE permission_key NOT IN (${PERMISSION_KEYS.map(() => '?').join(', ')})`).get(...PERMISSION_KEYS) as { n: number }).n, 0)
    db.prepare("DELETE FROM auth_group_permissions WHERE group_id = (SELECT id FROM auth_permission_groups WHERE group_key = 'editor') AND permission_id = (SELECT id FROM auth_permissions WHERE permission_key = 'content.edit')").run()
    seedAccessControlDefaults(db)
    assert.ok(!keys('editor').includes('content.edit'), 'restart never restores a later revocation')
    db.close()
  })

  await t.test('permissions v3 turns v2 grants into pages and the three rights once; shared settings become admin-only', () => {
    const db = new Database(':memory:')
    createAuthTables(db)
    // A v2 database: every earlier conversion is done and groups hold v2 catalog keys.
    for (const seed of ['files_manage_split_v1', 'images_view_v1', 'files_view_v1', 'workflows_view_v1', 'independent_features_v1', 'chat_diagnostics_v1', 'permissions_v2', 'character_library_permissions_v1', 'plugins_view_v1', 'anonymous_guest_signup_enabled_v1']) {
      db.prepare('INSERT INTO auth_seed_state (seed_key) VALUES (?)').run(seed)
    }
    const v2Keys = ['images.view', 'images.delete', 'prompts.edit', 'audio.view', 'files.view', 'generation.execute', 'chat.use', 'settings.media.manage', 'auth.guest.create']
    for (const key of v2Keys) db.prepare('INSERT INTO auth_permissions (permission_key, resource, action) VALUES (?, ?, ?)').run(key, key, 'x')
    db.prepare("INSERT INTO auth_permission_groups (group_key, name) VALUES ('anonymous', 'anonymous'), ('curator', 'curator')").run()
    db.prepare("INSERT INTO auth_permission_groups (group_key, name, parent_group_id) SELECT 'helper', 'helper', id FROM auth_permission_groups WHERE group_key = 'curator'").run()
    const grant = (group: string, key: string) => db.prepare('INSERT INTO auth_group_permissions (group_id, permission_id, allowed) SELECT g.id, p.id, 1 FROM auth_permission_groups g, auth_permissions p WHERE g.group_key = ? AND p.permission_key = ?').run(group, key)
    // files.view on the visitors would open the files page, which signed-out visitors can never have.
    for (const key of ['images.view', 'files.view', 'auth.guest.create']) grant('anonymous', key)
    for (const key of ['settings.media.manage', 'images.view', 'images.delete', 'prompts.edit', 'audio.view']) grant('curator', key)
    for (const key of ['generation.execute', 'chat.use']) grant('helper', key)
    const logged: string[] = []
    const log = t.mock.method(console, 'log', (...args: unknown[]) => { logged.push(args.join(' ')) })
    try { seedAccessControlDefaults(db) } finally { log.mock.restore() }
    const keys = (group: string) => keysOf(db, group)
    assert.deepEqual(keys('anonymous'), VISITOR_PAGES)
    // Reading and the image pages come from the visitors' images.view, which every account carries through guest.
    assert.deepEqual(keys('curator'), ['content.delete', 'content.edit', 'page.audio.view'])
    assert.deepEqual(keys('helper'), ['page.chat.view', 'page.generation.view'], 'a child stores only what its parent does not give')
    assert.deepEqual(keys('admin'), [...PERMISSION_KEYS].sort())
    assert.ok(logged.some((line) => line.includes('curator:') && line.includes('administrator-only now: settings.media.manage')), 'dropped shared-settings grants are logged per group')
    assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM auth_permissions WHERE permission_key NOT IN (${PERMISSION_KEYS.map(() => '?').join(', ')})`).get(...PERMISSION_KEYS) as { n: number }).n, 0, 'v2 rows are removed after the conversion')
    db.prepare("DELETE FROM auth_group_permissions WHERE group_id = (SELECT id FROM auth_permission_groups WHERE group_key = 'curator') AND permission_id = (SELECT id FROM auth_permissions WHERE permission_key = 'content.delete')").run()
    seedAccessControlDefaults(db)
    assert.ok(!keys('curator').includes('content.delete'), 'the conversion runs once')
    db.close()
  })

  await t.test('only the 15 menu pages are stored; image detail, metadata editor and settings are derived', () => {
    const resolved = (keys: readonly string[], admin = false) => resolvePermissionKeys(keys, admin).sort()
    assert.deepEqual(resolved(['page.home.view']), ['page.home.view', 'page.image-detail.view'])
    assert.ok(resolved(['page.groups.view']).includes('page.image-detail.view'))
    assert.ok(resolved(['page.groups.view', 'content.edit']).includes('page.metadata-editor.view'))
    assert.ok(!resolved(['content.edit']).includes('page.metadata-editor.view'), 'the metadata editor also needs an image page')
    assert.deepEqual(resolved(['content.delete']), ['content.delete', 'content.read'], 'edit and delete include reading')
    assert.ok(!resolved(PERMISSION_KEYS).includes('page.settings.view'), 'settings follow the administrator role')
    assert.ok(resolved([], true).includes('page.settings.view'))
    assert.equal(PERMISSION_KEYS.filter((key) => key.startsWith('page.')).length, 15)
    for (const derived of ['page.image-detail.view', 'page.metadata-editor.view', 'page.settings.view']) assert.ok(!(PERMISSION_KEYS as readonly string[]).includes(derived), derived)
    assert.deepEqual(PERMISSION_CATALOG.filter((permission) => 'anonymous' in permission).map((permission) => permission.key).sort(), VISITOR_PAGES)
  })

  const express = (await import('express')).default
  const { registerAppRoutes } = await import('../src/startup/registerAppRoutes')
  const app = express()
  const sessions = new Map<string, Record<string, unknown>>()
  app.use(express.json())
  app.use((req, _res, next) => {
    const id = Number(req.header('x-test-account')) || undefined
    const sid = req.header('x-test-session') ?? `test-${id ?? 'anonymous'}`
    if (!sessions.has(sid)) sessions.set(sid, { authenticated: Boolean(id), accountId: id, accountType: id ? 'guest' : undefined })
    Object.assign(req, { sessionID: sid, session: sessions.get(sid) })
    next()
  })
  const pass = (_req: unknown, _res: unknown, next: () => void) => next()
  registerAppRoutes(app, { uploadsDir: path.join(root, 'uploads'), tempDir: path.join(root, 'temp'), saveDir: path.join(root, 'save'), mcpLimiter: pass, readOnlyLimiter: pass, uploadLimiter: pass })
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const status = async (url: string, accountId?: number, method = 'GET', sessionId?: string) => {
    const response = await fetch(origin + url, { method, headers: { ...(accountId ? { 'x-test-account': String(accountId) } : {}), ...(sessionId ? { 'x-test-session': sessionId } : {}), 'Content-Type': 'application/json' }, ...(method === 'GET' || method === 'HEAD' ? {} : { body: '{}' }) })
    await response.arrayBuffer()
    return response.status
  }
  await t.test('trusted bootstrap includes image viewing; remote bootstrap stays denied', async () => {
    assert.equal(await status('/api/images/metadata/bad', undefined, 'GET', 'pre-setup'), 400)
    assert.equal(await status('/api/generation-queue', undefined, 'POST'), 400)
    let rejected = 0
    allowRead({ socket: { remoteAddress: '192.0.2.1' }, headers: {}, session: {} } as never, { status: (code: number) => ({ json: () => { rejected = code } }) } as never, () => assert.fail('remote bootstrap'))
    assert.equal(rejected, 401)
  })
  const bootstrapSession = { ...sessions.get('pre-setup') }
  const adminId = Number(auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES ('admin-test', 'unused', 'admin')").run().lastInsertRowid)
  auth.prepare("INSERT INTO auth_account_group_memberships (account_id, group_id) SELECT ?, id FROM auth_permission_groups WHERE group_key = 'admin'").run(adminId)
  invalidateConfiguredAuthCache()
  await t.test('configured auth clears reused pre-setup sessions and stops advertising bootstrap admin', async () => {
    for (const [sid, url] of [['residual-media', '/api/images/metadata/bad'], ['residual-auth', '/save/missing.png']]) {
      sessions.set(sid, { ...bootstrapSession })
      assert.equal(await status(url, undefined, 'GET', sid), 401)
      assert.equal(sessions.get(sid)?.authenticated, false)
      assert.equal(sessions.get(sid)?.permissionKeys, undefined)
    }
    sessions.set('residual-status', { ...bootstrapSession })
    const payload = await (await fetch(origin + '/api/auth/status', { headers: { 'x-test-session': 'residual-status' } })).json() as { authenticated: boolean; isAdmin: boolean; accountType: string | null; permissionKeys: string[] }
    assert.equal(payload.authenticated, false)
    assert.equal(payload.isAdmin, false)
    assert.equal(payload.accountType, null)
    assert.equal(payload.permissionKeys.includes('content.read'), false)
  })
  const group = AuthPermissionGroup.createCustomGroup({ name: 'image-reader', permissionKeys: ['content.read'] })
  const accountId = Number(auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES ('reader', 'unused', 'guest')").run().lastInsertRowid)
  AuthPermissionGroup.addAccountMembership(group.id, accountId)
  await t.test('paged listings validate input after their existing access checks', async () => {
    const { WorkflowModel } = await import('../src/models/Workflow')
    const workflowId = WorkflowModel.create({ name: 'Paged artifacts', workflow_json: '{}', is_public_page: true, public_slug: 'paged-artifacts', result_view_mode: 'artifact_explorer' })
    const urls = ['/api/image-editor/save-images', `/api/workflows/${workflowId}/artifacts`, '/api/public-workflows/paged-artifacts/artifacts']
    const originalError = console.error
    let listingErrors = 0
    console.error = (...args: unknown[]) => {
      if (String(args[0]).startsWith('Error listing')) listingErrors += 1
      else originalError(...args)
    }
    try {
      for (const url of urls) {
        for (const query of ['limit=0', 'cursor=invalid', 'snapshot=']) {
          assert.equal(await status(`${url}?${query}`, adminId), 400, `${url}: ${query}`)
        }
      }
    } finally {
      console.error = originalError
    }
    assert.equal(listingErrors, 0, 'invalid input is not logged as a server error')
    for (const url of urls) {
      const response = await fetch(`${origin}${url}?limit=2`, { headers: { 'x-test-account': String(adminId) } })
      const payload = await response.json() as { data: { snapshot: string | null; total: number } }
      assert.equal(response.status, 200)
      assert.equal(typeof payload.data.snapshot, 'string')
      assert.equal(payload.data.total, 0)
    }
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: [] })
    try {
      assert.equal(await status('/api/image-editor/save-images?limit=0', accountId), 403)
      // Publishing is the grant: no read right, which would also open the whole library.
      assert.equal(await status('/api/public-workflows/paged-artifacts/artifacts?limit=0', accountId), 400, 'published artifacts reach validation')
      assert.equal(await status('/api/public-workflows/paged-artifacts/history', accountId), 200, 'own published runs are listed')
      assert.equal(await status('/api/public-workflows/paged-artifacts/queue', accountId, 'POST'), 400, 'queueing reaches input validation')
      const historyDb = user.getUserSettingsDb()
      // Save options reach the output file name, so the public queue never keeps the caller's.
      const queued = await fetch(origin + '/api/public-workflows/paged-artifacts/queue', { method: 'POST', headers: { 'x-test-account': String(accountId), 'Content-Type': 'application/json' }, body: JSON.stringify({ request_payload: { prompt_data: {}, imageSaveOptions: { format: 'x/../../../../escape' } } }) })
      const queuedBody = await queued.json() as { record: { id: number } | null }
      assert.equal(queued.status, 201)
      const storedPayload = (historyDb.prepare('SELECT request_payload FROM generation_queue_jobs WHERE id = ?').get(queuedBody.record!.id) as { request_payload: string }).request_payload
      assert.doesNotMatch(storedPayload, /escape/, 'client save options are replaced by the server settings')
      historyDb.prepare('DELETE FROM generation_queue_jobs WHERE id = ?').run(queuedBody.record!.id)
      const addRun = (ownerId: number) => Number(historyDb.prepare("INSERT INTO api_generation_history (service_type, workflow_id, requested_by_account_id, requested_by_account_type) VALUES ('comfyui', ?, ?, 'guest')").run(workflowId, ownerId).lastInsertRowid)
      const ownRun = addRun(accountId)
      assert.equal(await status(`/api/generation-history/${ownRun}/request`, accountId), 200, 'own published run is readable')
      assert.equal(await status(`/api/generation-history/${addRun(accountId + 1000)}/request`, accountId), 403, 'another account run stays private')
      WorkflowModel.update(workflowId, { is_public_page: false })
      assert.equal(await status('/api/public-workflows/paged-artifacts/queue', accountId, 'POST'), 404, 'unpublishing withdraws the grant')
      assert.equal(await status(`/api/generation-history/${ownRun}/request`, accountId), 200, 'own runs stay readable after unpublishing')
    } finally {
      AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['content.read'] })
    }
    assert.equal(await status('/api/public-workflows/paged-artifacts/artifacts?limit=2', adminId), 404)
  })
  await t.test('group merge needs edit AND delete; ordinary moves and deletes keep independent grants', async () => {
    const { GroupModel } = await import('../src/models/Group')
    const { moveCustomGroups } = await import('../src/services/groupMutationService')
    const send = async (url: string, body: unknown, method = 'POST') => {
      const response = await fetch(origin + url, { method, headers: { 'x-test-account': String(accountId), 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      await response.arrayBuffer()
      return response.status
    }
    try {
      for (const bulk of [false, true]) {
        const parent = GroupModel.create({ name: `Permission merge container ${bulk}` })
        const destination = GroupModel.create({ name: `Permission merge target ${bulk}` })
        const source = GroupModel.create({ name: `Permission merge target ${bulk}`, parent_id: parent })
        const preview = moveCustomGroups([source], null, null, { preview: true })
        const url = bulk ? '/api/groups/bulk-move' : `/api/groups/${source}/move`
        const body = { ids: [source], parent_id: null, merge_token: preview.merge_token }
        for (const permissionKeys of [[], ['content.edit'], ['content.delete']]) {
          AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys })
          assert.equal(await send(url, body), 403, `${url}: ${permissionKeys.join(',') || 'no permissions'} cannot merge`)
          assert.equal(GroupModel.findById(source)?.parent_id, parent)
        }
        AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['content.edit', 'content.delete'] })
        assert.equal(await send(url, body), 200)
        assert.equal(GroupModel.findById(source), null)
        assert.ok(GroupModel.findById(destination))
      }
      const movable = GroupModel.create({ name: 'Edit-only movable' })
      const parent = GroupModel.create({ name: 'Edit-only destination' })
      AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['content.edit'] })
      assert.equal(await send(`/api/groups/${movable}/move`, { parent_id: parent }), 200)
      assert.equal(await send(`/api/groups/${movable}`, {}, 'DELETE'), 403)
      AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['content.delete'] })
      assert.equal(await send(`/api/groups/${movable}`, {}, 'DELETE'), 200)
      const bulkDeleted = GroupModel.create({ name: 'Delete-only bulk target' })
      assert.equal(await send('/api/groups/bulk-delete', { ids: [bulkDeleted] }), 200)
    } finally {
      AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['content.read'] })
    }
  })
  await t.test('batch group cover previews need image viewing like the per-group route', async () => {
    const { GroupModel } = await import('../src/models/Group')
    const first = GroupModel.create({ name: 'Batch preview one' })
    const second = GroupModel.create({ name: 'Batch preview two' })
    for (const base of ['/api/groups', '/api/auto-folder-groups']) {
      const url = `${base}/preview-images?ids=${first},${second},${first}&count=4`
      assert.equal(await status(url, undefined, 'GET', 'batch-preview-visitor'), 401, `${base}: signed-out visitors are refused`)
      AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: [] })
      try {
        assert.equal(await status(url, accountId), 403, `${base}: without images.view`)
        assert.equal(await status(`${base}/${first}/preview-images?count=4`, accountId), 403, `${base}: the per-group route agrees`)
      } finally {
        AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['content.read'] })
      }
      const response = await fetch(origin + url, { headers: { 'x-test-account': String(accountId) } })
      assert.equal(response.status, 200)
      const payload = await response.json() as { data: Record<string, unknown[]> }
      assert.deepEqual(Object.keys(payload.data).sort(), [String(first), String(second)].sort(), `${base}: one entry per distinct id`)
      assert.ok(Object.values(payload.data).every(Array.isArray))
      for (const bad of ['', 'ids=0', 'ids=1,x', `ids=${Array.from({ length: 101 }, (_, index) => index + 1).join(',')}`]) {
        assert.equal(await status(`${base}/preview-images?${bad}`, accountId), 400, `${base}: ${bad || 'no ids'}`)
      }
    }
  })
  await t.test('group rematch jobs: anyone allowed to start the kind sees its progress; only the starter or admin cancels', async () => {
    const { RuntimeJobStore } = await import('../src/services/runtimeJobs/runtimeJobStore')
    const { groupAutoCollectSingletonKey } = await import('../src/services/runtimeJobs/handlers/groupRematchHandlers')
    const { GroupModel } = await import('../src/models/Group')
    const starterId = Number(auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES ('rematch-starter', 'unused', 'guest')").run().lastInsertRowid)
    const groupId = GroupModel.create({ name: 'Shared rematch target' })
    const shared = RuntimeJobStore.create({ kind: 'group-auto-collect', params: { groupId }, singletonKey: groupAutoCollectSingletonKey(groupId), requestedByAccountId: starterId })
    const privateJob = RuntimeJobStore.create({ kind: 'metadata-reextract-all', requestedByAccountId: starterId })
    const rebuild = RuntimeJobStore.create({ kind: 'auto-folder-rebuild', requestedByAccountId: starterId })
    type JobBody = { jobId: string; viewerCanCancel?: boolean }
    const read = async <T>(url: string, id: number) => ((await (await fetch(origin + url, { headers: { 'x-test-account': String(id) } })).json()) as { data: T }).data
    const liveJob = () => read<JobBody | null>(`/api/groups/${groupId}/auto-collect`, accountId)
    const listed = async (kind: string, id = accountId) => (await read<JobBody[]>(`/api/jobs?kind=${kind}&status=queued,running`, id)).map((job) => job.jobId)
    try {
      assert.equal(await status(`/api/jobs/${shared.jobId}`, accountId), 403, 'view-only account cannot read a job it could not start')
      assert.equal(await liveJob(), null, 'nor is it offered for resume')
      assert.ok(!(await listed('auto-folder-rebuild')).includes(rebuild.jobId), 'nor listed for resume')
      AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['content.read', 'content.edit'] })
      const response = await fetch(`${origin}/api/jobs/${shared.jobId}`, { headers: { 'x-test-account': String(accountId) } })
      assert.equal(response.status, 200, 'an account allowed to start the kind reads the joined job')
      const joined = ((await response.json()) as { data: JobBody & { progress: unknown } }).data
      assert.equal(joined.jobId, shared.jobId)
      assert.equal(joined.viewerCanCancel, false, 'and is told it cannot cancel it')
      const live = await liveJob()
      assert.equal(live?.jobId, shared.jobId, 'and resumes it when the group page opens')
      assert.equal(live?.viewerCanCancel, false)
      const rebuildListed = (await read<JobBody[]>('/api/jobs?kind=auto-folder-rebuild&status=queued,running', accountId)).find((job) => job.jobId === rebuild.jobId)
      assert.equal(rebuildListed?.viewerCanCancel, false, 'list-based resume sees the shared kind too, without cancel')
      assert.ok((await listed('group-auto-collect')).includes(shared.jobId))
      assert.ok(!(await listed('metadata-reextract-all')).includes(privateJob.jobId), 'other kinds stay listed to the starter')
      assert.ok(!(await read<JobBody[]>('/api/jobs?status=queued', accountId)).some((job) => job.jobId === privateJob.jobId))
      assert.equal(await status(`/api/jobs/${shared.jobId}/cancel`, accountId, 'POST'), 403, 'reading is not cancelling')
      assert.equal(await status(`/api/jobs/${privateJob.jobId}`, accountId), 403, 'other kinds stay starter/admin only')
      assert.equal(RuntimeJobStore.get(shared.jobId)?.status, 'queued')
      assert.equal((await read<JobBody>(`/api/jobs/${shared.jobId}`, starterId)).viewerCanCancel, undefined, 'the starter keeps its cancel')
      assert.ok((await listed('auto-folder-rebuild', starterId)).includes(rebuild.jobId))
    } finally {
      AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['content.read'] })
      for (const job of [shared, privateJob, rebuild]) RuntimeJobStore.markCancelled(job.jobId, 'test cleanup')
    }
  })
  await t.test('CLI sign-in management is admin-only; Claude chat follows the profile audience and tools the account rights', async () => {
    for (const agent of ['codex', 'claude']) {
      assert.equal(await status(`/api/settings/agent-cli/${agent}/login`), 403)
      assert.equal(await status(`/api/settings/agent-cli/${agent}/login`, accountId), 403)
      assert.equal(await status(`/api/settings/agent-cli/${agent}/update`, accountId, 'POST'), 403)
      assert.equal(await status(`/api/settings/agent-cli/${agent}/usage/refresh`, undefined, 'POST'), 403)
      assert.equal(await status(`/api/settings/agent-cli/${agent}/usage/refresh`, accountId, 'POST'), 403)
      assert.equal(await status(`/api/settings/agent-cli/${agent}/login`, adminId), 200)
    }
    assert.equal(await status('/api/settings/agent-cli/unknown/login', adminId), 400)
    const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
    const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
    const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
    const { openChatMcpBridge } = await import('../src/services/codex-chat/chatMcpBridge')
    const { LlmChatService } = await import('../src/services/codex-chat/llmChatService')
    const { registerChatReply } = await import('../src/services/codex-chat/chatReplyRegistry')
    updateChatSettings({ enabled: true })
    const profile = ChatProfileStore.create({ name: 'Claude permission fixture', engine: 'claude', mcpEnabled: true, mcpScopes: ['read'] })
    const chatContext = { threadId: CodexChatStore.createThread(accountId, 'Claude permissions', 'llm', profile.id), profileId: profile.id, kind: 'direct' as const, replyId: 'claude-permission-reply' }
    const endReply = registerChatReply(chatContext, new AbortController().signal, () => ({ replyTo: null, recipients: ['user'] }))
    const requester = { accountId, accountType: 'guest' as const }
    // Tools are offered from the account's rights when the reply starts; each call rechecks them and the profile audience.
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['content.read'] })
    const bridge = await openChatMcpBridge(requester, ['read'], null, { chatContext })
    try {
      ChatProfileStore.update(profile.id, { allowedGroupKeys: ['admin'] })
      assert.throws(() => LlmChatService.requireStartableProfile(requester, profile.id), /권한/)
      assert.equal((await bridge.call('list_prompt_presets', {})).isError, true)
      ChatProfileStore.update(profile.id, { allowedGroupKeys: [] })
      assert.equal(LlmChatService.requireStartableProfile(requester, profile.id).engine, 'claude', 'any signed-in account when the profile names no audience')
      const permitted = await bridge.call('list_prompt_presets', {})
      assert.notEqual(permitted.isError, true, JSON.stringify(permitted))
      AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: [] })
      assert.equal((await bridge.call('list_prompt_presets', {})).isError, true, 'reading presets needs the read right')
    } finally { endReply(); await bridge.close(); AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['content.read'] }) }
  })
  await t.test('a profile limited to some groups serves only their members and administrators', async () => {
    const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
    const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
    const { LlmChatService } = await import('../src/services/codex-chat/llmChatService')
    const { resolveChatAccess, canUseChatProfile } = await import('../src/services/codex-chat/codexChatAccess')
    updateChatSettings({ enabled: true })
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: [] })
    const team = AuthPermissionGroup.createCustomGroup({ name: 'team-only', permissionKeys: [] })
    const profile = ChatProfileStore.create({ name: 'Team only', engine: 'llm', providerName: 'fixture', allowedGroupKeys: [team.group_key, 'guest', 'missing-group'] })
    try {
      assert.deepEqual(profile.allowedGroupKeys, [team.group_key], 'unknown groups and the everyone-groups are dropped')
      const requester = { accountId, accountType: 'guest' as const }
      assert.equal(canUseChatProfile(resolveChatAccess(accountId), profile), false)
      assert.throws(() => LlmChatService.requireStartableProfile(requester, profile.id), /권한/)
      assert.equal(canUseChatProfile(resolveChatAccess(adminId), profile), true, 'administrators always may')
      AuthPermissionGroup.addAccountMembership(team.id, accountId)
      assert.equal(canUseChatProfile(resolveChatAccess(accountId), profile), true)
      AuthPermissionGroup.removeAccountMembership(team.id, accountId)
      ChatProfileStore.update(profile.id, { allowedGroupKeys: [] })
      assert.equal(canUseChatProfile(resolveChatAccess(accountId), ChatProfileStore.find(profile.id)!), true, 'an empty list means every signed-in account')
    } finally {
      ChatProfileStore.delete(profile.id)
      AuthPermissionGroup.deleteCustomGroup(team.id)
      AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['content.read'] })
    }
  })
  for (const directory of ['uploads', 'temp', 'save']) {
    fs.mkdirSync(path.join(root, directory), { recursive: true })
    fs.writeFileSync(path.join(root, directory, 'permission.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7WQAAAAASUVORK5CYII=', 'base64'))
  }
  await t.test('page off + image view on, inverse and action separation reach actual API mounts', async () => {
    for (const url of ['/api/images/metadata/bad', '/api/images/bad/thumbnail', '/api/images/bad/file']) assert.equal(await status(url, accountId), 400, url)
    assert.ok((sessions.get(`test-${accountId}`)?.permissionKeys as string[]).includes('content.read'))
    for (const url of ['/uploads/permission.png', '/temp/permission.png', '/save/permission.png']) assert.equal(await status(url, accountId), 200, url)
    const raw = await fetch(origin + '/uploads/permission.png', { headers: { 'x-test-account': String(accountId) } })
    assert.equal(raw.headers.get('Cache-Control'), 'private, no-cache')
    await raw.arrayBuffer()
    assert.equal(await status('/api/images/batch', accountId, 'POST'), 400)
    assert.equal(await status('/api/groups'), 401)
    assert.equal(await status('/api/groups', accountId, 'POST'), 403)
    assert.equal(await status('/api/images/bulk', accountId, 'DELETE'), 403)
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: [] })
    for (const url of ['/api/images/metadata/bad', '/api/images/bad/thumbnail', '/api/images/bad/file', '/api/runtime-media-settings/viewer', '/uploads/permission.png', '/temp/permission.png', '/save/permission.png']) assert.equal(await status(url, accountId), 403, url)
    assert.throws(() => requireRequesterRight({ accountId, accountType: 'guest' }, 'read'), /content.read/)
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['content.read', 'content.delete'] })
    assert.equal(await status('/api/images/bulk', accountId, 'DELETE'), 400)
    assert.equal(AuthAccessControlService.resolveForAccountId(accountId).permissionKeys.includes('page.home.view'), false, 'reading opens no page; pages are granted on their own')
  })
  await t.test('stored workflow media requires the read right regardless of MIME, pages or generation', async () => {
    const { storeWorkflowInputAssetFile } = await import('../src/services/workflowInputAssetStore')
    const fixtures = [
      { name: 'permission.png', mime: 'image/png', bytes: fs.readFileSync(path.join(root, 'uploads', 'permission.png')) },
      // Small MP4 header and two-frame GIF; authorization must not depend on media decoding.
      { name: 'permission.mp4', mime: 'video/mp4', bytes: Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex') },
      { name: 'permission.gif', mime: 'image/gif', bytes: Buffer.from('47494638396101000100800000000000ffffff21f904000a0000002c000000000100010000020244010021f904000a0000002c00000000010001000002024c01003b', 'hex') },
    ]
    const assets = fixtures.map((fixture) => {
      const temporaryPath = path.join(root, 'temp', fixture.name)
      fs.writeFileSync(temporaryPath, fixture.bytes)
      const ref = storeWorkflowInputAssetFile(temporaryPath, { fileName: fixture.name, mimeType: fixture.mime, bytes: fixture.bytes.length })
      return { ...fixture, url: `/api/workflow-input-assets/${ref.id}` }
    })
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: [] })
    for (const asset of assets) {
      for (const suffix of ['', `?mime=${encodeURIComponent(asset.mime)}`, '?mime=audio%2Fwav', '?mime=text%2Fplain']) {
        for (const method of ['GET', 'HEAD']) assert.equal(await status(asset.url + suffix, accountId, method), 403, `${method} ${asset.name}${suffix}`)
      }
      const deniedRange = await fetch(origin + asset.url, { headers: { 'x-test-account': String(accountId), Range: 'bytes=0-3' } })
      assert.equal(deniedRange.status, 403, asset.name)
      await deniedRange.arrayBuffer()
    }
    assert.equal(await status('/api/workflow-input-assets/bad', accountId), 403, 'permission checked before asset resolution')
    assert.equal(await status('/api/workflow-input-assets', accountId, 'POST'), 400, 'uploading an input only needs sign-in')
    // A Korean file name comes back as it was sent (multer's latin1 default would turn it into mojibake).
    const named = new FormData()
    named.append('file', new Blob([new Uint8Array(fixtures[0].bytes)], { type: 'image/png' }), '오디오 로드-audio.png')
    const uploaded = await fetch(origin + '/api/workflow-input-assets', { method: 'POST', headers: { 'x-test-account': String(accountId) }, body: named })
    assert.equal(uploaded.status, 201)
    assert.equal(((await uploaded.json()) as { data: { fileName: string } }).data.fileName, '오디오 로드-audio.png')
    assert.equal(await status('/api/workflow-input-assets/bad', accountId, 'DELETE'), 200, 'removing an input only needs sign-in')
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['content.read'] })
    for (const asset of assets) {
      assert.equal(await status(asset.url), 401, 'login boundary remains')
      for (const suffix of ['', `?mime=${encodeURIComponent(asset.mime)}`, '?mime=audio%2Fwav']) {
        const response = await fetch(origin + asset.url + suffix, { headers: { 'x-test-account': String(accountId) } })
        assert.equal(response.status, 200, asset.name + suffix)
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), asset.bytes)
      }
      const head = await fetch(origin + asset.url, { method: 'HEAD', headers: { 'x-test-account': String(accountId) } })
      assert.equal(head.status, 200, asset.name)
      assert.equal(head.headers.get('Content-Length'), String(asset.bytes.length))
      assert.equal((await head.arrayBuffer()).byteLength, 0)
      const range = await fetch(origin + asset.url, { headers: { 'x-test-account': String(accountId), Range: 'bytes=0-3' } })
      assert.equal(range.status, 206, asset.name)
      assert.equal(range.headers.get('Content-Range'), `bytes 0-3/${asset.bytes.length}`)
      assert.deepEqual(Buffer.from(await range.arrayBuffer()), asset.bytes.subarray(0, 4))
    }
    // A published workflow page grants its own inputs; an unknown or unpublished slug grants nothing.
    const db = user.getUserSettingsDb()
    db.prepare("INSERT INTO workflows (name, workflow_json, is_public_page, public_slug) VALUES ('shared-h3', '{}', 1, 'shared-h3'), ('hidden-h3', '{}', 0, 'hidden-h3')").run()
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: [] })
    assert.equal(await status('/api/workflow-input-assets?publicWorkflow=shared-h3', accountId, 'POST'), 400, 'upload reaches the handler (no file sent)')
    assert.equal(await status(assets[0].url + '?publicWorkflow=shared-h3', accountId), 200, 'preview of an uploaded input')
    assert.equal(await status(assets[0].url + '?publicWorkflow=shared-h3', accountId, 'DELETE'), 200)
    // The Director's RefMod library and records back the same form (no ComfyUI server is configured here: 404, not 403).
    assert.notEqual(await status('/api/comfyui-servers/refmods?publicWorkflow=shared-h3', accountId), 403)
    assert.equal(await status('/api/refmods?publicWorkflow=shared-h3', accountId), 200)
    // The Director picker only needs sign-in, published or not.
    assert.notEqual(await status('/api/comfyui-servers/refmods?publicWorkflow=hidden-h3', accountId), 403)
    assert.equal(await status('/api/refmods?publicWorkflow=hidden-h3', accountId), 200)
    for (const slug of ['hidden-h3', 'missing']) {
      assert.equal(await status(`${assets[1].url}?publicWorkflow=${slug}`, accountId), 403, slug)
    }
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['content.read'] })
  })
  await t.test('HTTP history and private-file records retain ownership with the read right', async () => {
    const db = user.getUserSettingsDb()
    const addHistory = (ownerId: number) => Number(db.prepare("INSERT INTO api_generation_history (service_type, requested_by_account_id, requested_by_account_type) VALUES ('novelai', ?, 'guest')").run(ownerId).lastInsertRowid)
    const own = addHistory(accountId)
    const other = addHistory(adminId)
    assert.equal(await status(`/api/generation-history/${own}`, accountId), 200)
    for (const suffix of ['', '/file', '/thumbnail', '/image']) assert.equal(await status(`/api/generation-history/${other}${suffix}`, accountId), 403, suffix)
    // An owner preview is available before public metadata/tagging finishes; no gallery access is widened.
    const hash = 'a7'.repeat(24)
    const originalPath = path.join(root, 'uploads', 'permission.png')
    const previewFolder = main.db.prepare('SELECT id FROM watched_folders LIMIT 1').get() as { id: number }
    main.db.prepare(`INSERT INTO media_metadata (composite_hash, width, height, thumbnail_path, postprocess_status, metadata_extraction_status)
      VALUES (?, 1, 1, ?, 'pending', 'pending')`).run(hash, originalPath)
    main.db.prepare(`INSERT INTO image_files (composite_hash, original_file_path, folder_id, file_type, mime_type, file_status, file_size)
      VALUES (?, ?, ?, 'image', 'image/png', 'active', ?)`).run(hash, originalPath, previewFolder.id, fs.statSync(originalPath).size)
    db.prepare("UPDATE api_generation_history SET composite_hash = ?, generation_status = 'completed' WHERE id = ?").run(hash, own)
    for (const suffix of ['/file', '/thumbnail', '/image']) {
      assert.equal(await status(`/api/generation-history/${own}${suffix}`, accountId), 200, `owner pending ${suffix}`)
      assert.equal(await status(`/api/generation-history/${own}${suffix}`, adminId), 200, `admin pending ${suffix}`)
    }
    for (const suffix of ['', '/file', '/thumbnail']) assert.equal(await status(`/api/images/${hash}${suffix}`, accountId), 404, `public pending ${suffix}`)
    const { HistoryQueryRepository } = await import('../src/repositories/history/HistoryQueryRepository')
    const { MediaMetadataFileQueries } = await import('../src/models/Image/MediaMetadataFileQueries')
    const { findImagesByGroupQuery } = await import('../src/models/GroupImageQueries')
    const previewGroupId = Number(main.db.prepare("INSERT INTO groups (name) VALUES ('pending-preview-test')").run().lastInsertRowid)
    main.db.prepare('INSERT INTO image_groups (group_id, composite_hash) VALUES (?, ?)').run(previewGroupId, hash)
    const { MediaPostprocessVisibilityService: visibility } = await import('../src/services/mediaPostprocessVisibilityService')
    const { settingsService } = await import('../src/services/settingsService')
    const settings = settingsService.loadSettings()
    const settingsMock = t.mock.method(settingsService, 'loadSettings', () => ({ ...settings,
      tagger: { ...settings.tagger, enabled: true, autoTagOnUpload: true },
      kaloscope: { ...settings.kaloscope, enabled: false },
    }))
    try {
      assert.equal(HistoryQueryRepository.findAllWithMetadata({ ids: [own] })[0].actual_composite_hash, hash)
      assert.equal(MediaMetadataFileQueries.findByHashWithFile(hash), null)
      assert.equal(findImagesByGroupQuery(previewGroupId).total, 0)
      assert.equal(visibility.markReadyIfNoPendingImmediateWork(hash), false)
      main.db.prepare('UPDATE media_metadata SET auto_tags = ? WHERE composite_hash = ?').run(JSON.stringify({ tagger: { status: 'success' } }), hash)
      assert.equal(visibility.markReadyIfNoPendingImmediateWork(hash), false, 'tagging must not release unfinished metadata')
      assert.equal(visibility.markReadyRowsWithoutPendingImmediateWork(), 0, 'scheduler release must respect metadata too')
      visibility.finishMetadataExtraction(hash, 'completed')
      assert.equal(visibility.markReadyIfNoPendingImmediateWork(hash), true)
      assert.equal(await status(`/api/images/${hash}`, accountId), 200)
      assert.equal(await status(`/api/images/${hash}/thumbnail`, accountId), 200)
      assert.equal(findImagesByGroupQuery(previewGroupId).total, 1)
      visibility.finishMetadataExtraction(hash, 'failed')
      assert.equal(await status(`/api/generation-history/${own}/image`, accountId), 200, 'enrichment failure preserves the owner result')
      assert.equal(await status(`/api/images/${hash}`, accountId), 404, 'failed enrichment stays out of public views')
      assert.equal(findImagesByGroupQuery(previewGroupId).total, 0)
      assert.equal(HistoryQueryRepository.findById(own)?.generation_status, 'completed')
      visibility.finishMetadataExtraction(hash, 'completed')
      main.db.prepare('UPDATE media_metadata SET auto_tags = ? WHERE composite_hash = ?').run(JSON.stringify({ tagger: { status: 'failed' } }), hash)
      assert.equal(visibility.markReadyIfNoPendingImmediateWork(hash), false, 'failed rating/tag extraction is not public readiness')
      assert.equal(await status(`/api/generation-history/${own}/thumbnail`, accountId), 200)
      assert.equal(findImagesByGroupQuery(previewGroupId).total, 0)
    } finally {
      settingsMock.mock.restore()
      main.db.prepare('DELETE FROM groups WHERE id = ?').run(previewGroupId)
      db.prepare('UPDATE api_generation_history SET composite_hash = NULL WHERE id = ?').run(own)
      main.db.prepare('DELETE FROM image_files WHERE composite_hash = ?').run(hash)
      main.db.prepare('DELETE FROM media_metadata WHERE composite_hash = ?').run(hash)
    }
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: [] })
    assert.equal(await status('/api/files', accountId), 403)
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['content.read'] })
    const { FileStoreService, fileOwnerKey } = await import('../src/services/fileStoreService')
    const folder = FileStoreService.createFolder(fileOwnerKey(accountId), null, 'own')
    assert.equal(await status(`/api/files/${folder.id}`, accountId), 200)
    // The file store is shared: there is no other account's store to pick, so an owner parameter changes nothing.
    assert.equal(await status(`/api/files/${folder.id}?owner=${fileOwnerKey(adminId)}`, accountId), 200)
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['content.read'] })
    assert.equal(await status('/api/generation-history/clear?service_type=novelai', accountId, 'POST'), 200)
    assert.ok(db.prepare('SELECT 1 FROM api_generation_history WHERE id = ?').get(other))
    const ownAgain = addHistory(accountId)
    assert.equal(await status(`/api/generation-history/${other}`, accountId, 'DELETE'), 403, "another account's run cannot be deleted")
    assert.equal(await status(`/api/generation-history/${ownAgain}`, accountId, 'DELETE'), 200, 'the owner deletes their own run without any right')
    const { createMcpServer } = await import('../src/mcp/server')
    const { Client } = await import('@modelcontextprotocol/client')
    const { InMemoryTransport } = await import('@modelcontextprotocol/client')
    const connect = async (scopes: Array<'read' | 'organize' | 'generate'> = ['read', 'organize', 'generate']) => {
      const server = createMcpServer({ scopes, source: 'http', requester: { accountId, accountType: 'admin' } })
      const connected = new Client({ name: 'permission-regression', version: '1' })
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      await Promise.all([server.connect(serverTransport), connected.connect(clientTransport)])
      return { server, connected }
    }
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: [] })
    let { server: mcp, connected: client } = await connect()
    // A refused call is either a tool error or, for a tool the caller may not use at all (not registered), protocol error -32602.
    const refused = (call: Promise<{ isError?: unknown }>) => call.then((result) => result.isError === true, (error: { code?: number }) => { if (error.code !== -32602) throw error; return true })
    try {
      assert.equal(await refused(client.callTool({ name: 'list_prompt_presets', arguments: {} })), true)
      // Generating needs only sign-in; a key or chat without the generate scope still cannot.
      await client.close(); await mcp.close()
      ;({ server: mcp, connected: client } = await connect(['read', 'organize']))
      assert.equal(await refused(client.callTool({ name: 'submit_generation_job', arguments: { service_type: 'codex', request_payload: { prompt: 'must not execute' } } })), true)
      AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['content.read'] })
      await client.close(); await mcp.close()
      ;({ server: mcp, connected: client } = await connect())
      assert.notEqual((await client.callTool({ name: 'list_prompt_presets', arguments: {} })).isError, true)
      assert.equal(await refused(client.callTool({ name: 'create_prompt_preset', arguments: { name: 'denied', items: [{ description: 'denied', value: 'denied' }] } })), true)
      const { PromptPresetModel } = await import('../src/models/PromptPreset')
      assert.equal(PromptPresetModel.findByName('denied'), undefined)
      const result = await client.callTool({ name: 'get_generation_history', arguments: { history_id: other } })
      assert.deepEqual(JSON.parse((result.content as Array<{ text: string }>)[0].text).records, [])
      assert.equal(await refused(client.callTool({ name: 'resolve_image_group_path', arguments: { group_path: 'must-not-create', create: true } })), true)
      AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: [] })
      assert.equal(await refused(client.callTool({ name: 'get_image_metadata', arguments: { composite_hash: 'a'.repeat(48) } })), true)
    } finally {
      await client.close()
      await mcp.close()
      AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['content.read'] })
    }
  })
  await t.test('current page connection follows page access without additional profile or chat read grants', async () => {
    const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
    const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
    const { registerChatReply } = await import('../src/services/codex-chat/chatReplyRegistry')
    const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
    const { openChatMcpBridge } = await import('../src/services/codex-chat/chatMcpBridge')
    const { parseChatPageContext } = await import('../src/services/codex-chat/chatPageContext')
    ;(await import('../src/services/codex-chat/chatPageBridge')).setChatPageCommandTimeout(100)
    const { issueCodexChatMcpToken, authenticateCodexChatMcpRequest, revokeCodexChatMcpToken } = await import('../src/services/codex-chat/codexChatAccess')
    const { requireMcpToolAccess } = await import('../src/mcp/toolAccess')
    const { WorkflowModel } = await import('../src/models/Workflow')
    updateChatSettings({ enabled: true })
    const profile = ChatProfileStore.create({ name: 'Page connection only', engine: 'llm', providerName: 'fixture', pageAssist: true, mcpEnabled: false, mcpScopes: [], toolAllowlist: [] })
    const visible = { instanceId: 'visible-page', connectionId: 'visible-connection', path: '/generation', title: 'Generation', kind: 'nai', resourceId: null, fields: [{ id: 'prompt', label: 'Prompt', type: 'text', value: 'visible draft', editable: false }], data: { files: [{ id: 'private-file' }] } }
    const keys = ['page.generation.view']
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: keys })
    const controller = new AbortController()
    try {
      for (const callerId of [adminId, accountId]) {
        const requester = { accountId: callerId, accountType: callerId === adminId ? 'admin' as const : 'guest' as const }
        const page = parseChatPageContext(visible, requester)!
        const context = { threadId: CodexChatStore.createThread(callerId, 'connected page', 'llm', profile.id), profileId: profile.id, kind: 'direct' as const, replyId: `page-only-${callerId}`, page }
        const stop = registerChatReply(context, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
        const bridge = await openChatMcpBridge(requester, [], [], { chatContext: context })
        const unbound = await openChatMcpBridge(requester, [], [], { chatContext: { ...context, page: undefined } })
        try {
          assert.equal(unbound.tools.some((tool) => tool.function.name === 'get_current_page'), false, 'page access never connects a page without user opt-in')
          const read = await bridge.call('get_current_page', {})
          assert.notEqual(read.isError, true, JSON.stringify(read))
          assert.match(JSON.stringify(read.content), /visible draft/)
          for (const tool of ['submit_generation_job', 'generate_nai', 'list_files', 'delete_files']) assert.equal(bridge.tools.some((entry) => entry.function.name === tool), false)
          if (callerId === accountId) {
            assert.equal((await bridge.call('read_page_data', { key: 'files' })).isError, true, 'current page access does not grant private file access')
            assert.doesNotMatch(JSON.stringify(read.content), /private-file/)
            const overview = parseChatPageContext({ ...visible, path: '/access', kind: 'page', fields: [] }, requester)
            assert.ok(overview, 'accessible overview requires no chat.tools.read grant')
            const workflowId = WorkflowModel.create({ name: 'Public page fixture', workflow_json: '{}', is_public_page: true, public_slug: 'page-access-fixture' })
            const published = { ...visible, path: '/public/workflows/page-access-fixture', kind: 'comfyui', resourceId: String(workflowId), fields: [] }
            assert.ok(parseChatPageContext(published, requester), 'published page follows native page access')
            WorkflowModel.update(workflowId, { is_public_page: false })
            assert.throws(() => parseChatPageContext(published, requester), /공개/)
            AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: [] })
            assert.throws(() => parseChatPageContext(visible, requester), /페이지/)
            assert.equal((await bridge.call('get_current_page', {})).isError, true, 'page revocation applies to an open reply')
            AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: keys })
          }
        } finally { stop(); await bridge.close(); await unbound.close() }
      }
      const codexProfile = ChatProfileStore.create({ name: 'Codex page only', engine: 'codex', pageAssist: true, mcpEnabled: false, toolAllowlist: [] })
      const context = { threadId: CodexChatStore.createThread(accountId, 'codex connected page', 'codex', codexProfile.id), profileId: codexProfile.id, kind: 'direct' as const, replyId: 'codex-page-only', page: parseChatPageContext(visible, { accountId, accountType: 'guest' })! }
      const stop = registerChatReply(context, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
      const token = issueCodexChatMcpToken({ accountId, accountType: 'guest' }, [], [], [], context)
      try {
        const authority = authenticateCodexChatMcpRequest({ headers: {}, socket: { remoteAddress: '127.0.0.1' } } as never, token)
        assert.ok(authority, 'Codex page connection needs no extra MCP read scope')
        assert.doesNotThrow(() => requireMcpToolAccess(authority, 'get_current_page'))
        assert.throws(() => requireMcpToolAccess(authority, 'submit_generation_job'), /Unknown|permitted/)
      } finally { stop(); revokeCodexChatMcpToken(token) }
    } finally { AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['content.read'] }) }
  })
  await t.test('chat image tools follow the account read right within the profile tools; generation needs only sign-in', async (sub) => {
    const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
    const { ChatGenerationPresetStore } = await import('../src/services/codex-chat/chatGenerationPresets')
    const { resolveChatAccess, resolveChatProfileToolGrant } = await import('../src/services/codex-chat/codexChatAccess')
    const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
    const { registerChatReply } = await import('../src/services/codex-chat/chatReplyRegistry')
    const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
    const { openChatMcpBridge } = await import('../src/services/codex-chat/chatMcpBridge')
    const { GenerationQueueModel } = await import('../src/models/GenerationQueue')
    const { GenerationQueueService } = await import('../src/services/generationQueueService')
    const { requireQueuedChatGenerationAccess } = await import('../src/services/generation-queue/queueJobExecutors')
    updateChatSettings({ enabled: true })
    sub.mock.method(GenerationQueueService, 'requestDispatch', () => {})
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: [] })
    const preset = ChatGenerationPresetStore.create({ name: 'Chat NAI', kind: 'nai' })
    const profile = ChatProfileStore.create({
      name: 'Chat images', engine: 'llm', providerName: 'fixture', mcpEnabled: true,
      mcpScopes: ['read'], toolAllowlist: ['search_images', 'get_image_metadata', 'view_images'],
      generationPresetIds: [preset.id], visionEnabled: true,
    })
    const requester = { accountId, accountType: 'guest' as const }
    const chat = { threadId: CodexChatStore.createThread(accountId, 'chat images', 'llm', profile.id), profileId: profile.id, kind: 'direct' as const, replyId: 'chat-images' }
    const stop = registerChatReply(chat, new AbortController().signal, () => ({ replyTo: null, recipients: ['user'] }))
    const open = () => {
      const grant = resolveChatProfileToolGrant(ChatProfileStore.find(profile.id)!, resolveChatAccess(accountId))
      return openChatMcpBridge(requester, grant.scopes, grant.toolAllowlist, { chatContext: chat, generationPresetIds: profile.generationPresetIds, toolCatalog: false })
    }
    const unread = await open()
    try {
      const names = unread.tools.map((tool) => tool.function.name)
      assert.equal(names.includes('search_images'), false, 'the profile allows it, but the account cannot read')
      assert.ok(names.includes('generate_image'), 'generating needs only sign-in')
      assert.equal((await unread.call('search_images', { limit: 1 })).isError, true)
    } finally { await unread.close() }
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['content.read'] })
    const bridge = await open()
    try {
      const names = bridge.tools.map((tool) => tool.function.name)
      assert.ok(names.includes('search_images'))
      assert.ok(names.includes('view_images'))
      assert.ok(names.includes('generate_image'))
      assert.equal(names.includes('delete_images'), false)
      assert.notEqual((await bridge.call('search_images', { limit: 1 })).isError, true)
      const hash = 'd8'.repeat(24)
      const imagePath = path.join(root, 'uploads', 'chat-image.png')
      await (await import('sharp')).default({ create: { width: 2, height: 2, channels: 3, background: '#123456' } }).png().toFile(imagePath)
      const folder = main.db.prepare('SELECT id FROM watched_folders LIMIT 1').get() as { id: number }
      main.db.prepare("INSERT INTO media_metadata (composite_hash, width, height, postprocess_status, metadata_extraction_status) VALUES (?, 2, 2, 'ready', 'completed')").run(hash)
      main.db.prepare("INSERT INTO image_files (composite_hash, original_file_path, folder_id, file_type, mime_type, file_status, file_size) VALUES (?, ?, ?, 'image', 'image/png', 'active', ?)")
        .run(hash, imagePath, folder.id, fs.statSync(imagePath).size)
      const viewed = await bridge.call('view_images', { composite_hashes: [hash] })
      assert.ok(viewed.content?.some((item) => (item as { type: string }).type === 'image'), JSON.stringify(viewed))
      const generated = await bridge.call('generate_image', { prompt: 'a cat', n_samples: 1 })
      assert.notEqual(generated.isError, true, JSON.stringify(generated))
      const jobId = JSON.parse((generated.content![0] as { text: string }).text).id
      const job = GenerationQueueModel.findById(jobId)!
      assert.equal(job.requested_by_account_id, accountId)
      assert.doesNotThrow(() => requireQueuedChatGenerationAccess(job))
      const continued = 'continued-chat-images'
      CodexChatStore.moveGenerationLinks(chat.threadId, chat.replyId, continued)
      assert.doesNotThrow(() => requireQueuedChatGenerationAccess(job), 'continuing the same reply must not invalidate a queued job')
      assert.ok(user.getUserSettingsDb().prepare('SELECT 1 FROM chat_result_media_grants WHERE thread_id = ? AND reply_id = ? AND composite_hash = ?')
        .get(chat.threadId, continued, hash), 'continued replies retain their proven image results')
      const { ChatAgentRunner } = await import('../src/services/codex-chat/chatAgentCalls')
      await ChatAgentRunner.poll()
      const caller = ChatProfileStore.create({ name: 'Agent caller', engine: 'llm', providerName: 'fixture' })
      const callerThread = CodexChatStore.createThread(accountId, 'agent result destination', 'llm', caller.id)
      CodexChatStore.addMessage({ thread_id: chat.threadId, role: 'assistant', content: 'Queued an image.', tool_calls: [], status: 'completed', error: null,
        routing: { replyId: continued, replyTo: null, recipients: ['user'] } })
      const now = new Date().toISOString()
      user.getUserSettingsDb().prepare(`INSERT INTO chat_agent_calls
        (account_key, caller_thread_id, caller_profile_id, agent_profile_id, agent_thread_id, agent_name, caller_name, instruction, on_done, status, finished_at, created_at)
        VALUES (?, ?, ?, ?, ?, 'Generator', 'Caller', 'draw', 'notify', 'completed', ?, ?)`)
        .run(String(accountId), callerThread, caller.id, profile.id, chat.threadId, now, now)
      await ChatAgentRunner.poll()
      const moved = user.getUserSettingsDb().prepare('SELECT thread_id, reply_id FROM chat_generation_links WHERE job_id = ?').get(jobId) as { thread_id: number; reply_id: string }
      assert.equal(moved.thread_id, callerThread)
      assert.match(moved.reply_id, /^agent-result:/)
      assert.doesNotThrow(() => requireQueuedChatGenerationAccess(job), 'publishing an agent result must preserve the original generator authority')
      const unrelatedThread = CodexChatStore.createThread(accountId, 'not a recorded destination', 'llm', caller.id)
      user.getUserSettingsDb().prepare('UPDATE chat_generation_links SET thread_id = ? WHERE job_id = ?').run(unrelatedThread, jobId)
      assert.throws(() => requireQueuedChatGenerationAccess(job), /binding/, 'an unrecorded cross-thread move must not be accepted')
      user.getUserSettingsDb().prepare('UPDATE chat_generation_links SET thread_id = ? WHERE job_id = ?').run(callerThread, jobId)
      user.getUserSettingsDb().prepare("UPDATE generation_queue_jobs SET status = 'failed' WHERE id = ?").run(jobId)
      const retry = GenerationQueueService.retryJob(jobId)!
      const retryJob = GenerationQueueModel.findById(retry.id)!
      assert.doesNotThrow(() => requireQueuedChatGenerationAccess(retryJob), 'a retry inherits the proven server link, not authority from client inputs')
      const keys = AuthAccessControlService.resolveForAccountId(accountId).permissionKeys
      assert.ok(!keys.includes('page.generation.view') && !keys.includes('page.home.view'), 'reading opens no page')
      assert.equal(await status(`/api/codex-chat/admin/profiles/${profile.id}`, accountId, 'PUT'), 403)
      // Another profile without the read scope offers no image tools to the same reader.
      const other = ChatProfileStore.create({ name: 'Generate-only profile', engine: 'llm', providerName: 'fixture', mcpEnabled: true, mcpScopes: ['generate'] })
      const foreign = await openChatMcpBridge(requester, ['generate'], null, { chatContext: { ...chat, profileId: other.id }, toolCatalog: false })
      try { assert.equal(foreign.tools.some((tool) => tool.function.name === 'search_images'), false) } finally { await foreign.close() }
      AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: [] })
      assert.equal((await bridge.call('search_images', {})).isError, true, 'an already open bridge rechecks the account')
      for (const [url, method] of [['/api/images', 'GET'], [`/api/images/${hash}/file`, 'GET']]) assert.equal(await status(url, accountId, method), 403, url)
      ChatProfileStore.update(profile.id, { allowedGroupKeys: ['admin'] })
      assert.equal((await bridge.call('generate_image', { prompt: 'outside the audience' })).isError, true)
      assert.throws(() => requireQueuedChatGenerationAccess(job), /권한|프로필/)
      assert.throws(() => requireQueuedChatGenerationAccess(retryJob), /권한|프로필/, 'retries also recheck the profile audience')
    } finally {
      stop()
      await bridge.close()
      ChatProfileStore.update(profile.id, { allowedGroupKeys: [] })
      AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['content.read'] })
    }
  })

  await t.test('linked NAI and Comfy presets generate independently of page binding and general tool selection', async (sub) => {
    const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
    const { ChatToolPresetStore } = await import('../src/services/codex-chat/chatToolPresets')
    const { ChatGenerationPresetStore } = await import('../src/services/codex-chat/chatGenerationPresets')
    const { resolveChatAccess, resolveChatProfileToolGrant } = await import('../src/services/codex-chat/codexChatAccess')
    const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
    const { registerChatReply } = await import('../src/services/codex-chat/chatReplyRegistry')
    const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
    const { openChatMcpBridge } = await import('../src/services/codex-chat/chatMcpBridge')
    const { WorkflowModel } = await import('../src/models/Workflow')
    const { ComfyUIServerModel } = await import('../src/models/ComfyUIServer')
    const { GenerationQueueModel } = await import('../src/models/GenerationQueue')
    const { GenerationQueueService } = await import('../src/services/generationQueueService')
    const { requireQueuedChatGenerationAccess } = await import('../src/services/generation-queue/queueJobExecutors')
    const { normalizeChatPageSnapshot } = await import('@conai/shared')
    const { parseChatPageContext } = await import('../src/services/codex-chat/chatPageContext')
    updateChatSettings({ enabled: true })
    sub.mock.method(GenerationQueueService, 'requestDispatch', () => {})
    ComfyUIServerModel.create({ name: 'Queue fixture', endpoint: 'http://unused.invalid', is_active: true })
    const workflowId = WorkflowModel.create({ name: 'Linked workflow', workflow_json: JSON.stringify({ '1': { class_type: 'CLIPTextEncode', inputs: { text: '' } } }), marked_fields: [{ id: 'prompt', label: 'Prompt', type: 'text', jsonPath: '1.inputs.text', required: true }] })
    const nai = ChatGenerationPresetStore.create({ name: 'Linked NAI', kind: 'nai' })
    const comfy = ChatGenerationPresetStore.create({ name: 'Linked Comfy', kind: 'comfyui', comfyui: { workflowId, exposedFieldIds: ['prompt'] } })
    const profile = ChatProfileStore.create({ name: 'Linked generator', engine: 'llm', providerName: 'fixture', pageAssist: true, mcpEnabled: true, mcpScopes: ['read'], toolAllowlist: ['get_current_page'], generationPresetIds: [nai.id, comfy.id] })
    const controller = new AbortController()
    const page = normalizeChatPageSnapshot({ instanceId: 'page-instance', connectionId: 'page-connection', path: '/generation', title: 'Generation', kind: 'page', resourceId: null, fields: [] })
    assert.ok(resolveChatAccess(adminId).scopes.includes('generate'), 'administrator already holds account generation scope')
    const permittedGuestKeys = ['page.generation.view', 'content.read']
    const cases: Array<[number, 'admin' | 'guest', boolean]> = [[adminId, 'admin', false], [adminId, 'admin', true], [accountId, 'guest', false], [accountId, 'guest', true]]
    for (const [callerId, accountType, connected] of cases) {
      AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: permittedGuestKeys })
      const requester = { accountId: callerId, accountType }
      const current = ChatProfileStore.find(profile.id)!
      const connectedPage = parseChatPageContext(connected ? page : undefined, requester)
      const context = { threadId: CodexChatStore.createThread(callerId, 'linked presets', 'llm', profile.id), profileId: profile.id, kind: 'direct' as const, replyId: `linked-${callerId}-${connected}`, ...(connectedPage ? { page: connectedPage } : {}) }
      const stop = registerChatReply(context, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
      const grant = resolveChatProfileToolGrant(current, resolveChatAccess(callerId))
      const bridge = await openChatMcpBridge(requester, grant.scopes, grant.toolAllowlist, { chatContext: context, generationPresetIds: current.generationPresetIds })
      try {
        const names = bridge.tools.map((tool) => tool.function.name)
        assert.ok(names.includes('generate_image') && names.includes('generate_image_2'))
        assert.equal(names.includes('get_current_page'), connected)
        for (const unrelated of ['submit_generation_job', 'generate_nai', 'list_workflows', 'delete_files']) assert.equal(names.includes(unrelated), false)
        for (const [tool, service] of [['generate_image', 'novelai'], ['generate_image_2', 'comfyui']]) {
          const result = await bridge.call(tool, { prompt: 'a cat' })
          assert.notEqual(result.isError, true, JSON.stringify(result))
          const queued = JSON.parse((result.content![0] as { text: string }).text)
          const job = GenerationQueueModel.findById(queued.id)!
          assert.equal(job.service_type, service)
          assert.equal(job.requested_by_account_id, callerId)
          assert.doesNotThrow(() => requireQueuedChatGenerationAccess(job))
          if (service === 'comfyui') assert.equal(job.workflow_id, workflowId)
        }
        ChatProfileStore.update(profile.id, { generationPresetIds: [] })
        assert.equal((await bridge.call('generate_image_2', { prompt: 'unlinked' })).isError, true)
        assert.deepEqual(resolveChatProfileToolGrant(ChatProfileStore.find(profile.id)!, resolveChatAccess(callerId)), { scopes: ['read'], toolAllowlist: ['get_current_page'] }, 'unlinking never enables free-form generation')
      } finally {
        stop(); await bridge.close()
        ChatProfileStore.update(profile.id, { generationPresetIds: [nai.id, comfy.id] })
      }
    }
    // Pictures of the speaker get the profile's appearance tags from the server; other pictures do not.
    ChatProfileStore.update(profile.id, { appearance: 'silver hair, red eyes' })
    const selfContext = { threadId: CodexChatStore.createThread(adminId, 'self picture', 'llm', profile.id), profileId: profile.id, kind: 'direct' as const, replyId: 'linked-self' }
    const stopSelf = registerChatReply(selfContext, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
    const selfGrant = resolveChatProfileToolGrant(ChatProfileStore.find(profile.id)!, resolveChatAccess(adminId))
    const selfBridge = await openChatMcpBridge({ accountId: adminId, accountType: 'admin' }, selfGrant.scopes, selfGrant.toolAllowlist, { chatContext: selfContext, generationPresetIds: [nai.id, comfy.id] })
    try {
      for (const tool of ['generate_image', 'generate_image_2']) {
        for (const self of [true, false]) {
          const result = await selfBridge.call(tool, { prompt: 'waving', include_self: self })
          assert.notEqual(result.isError, true, JSON.stringify(result))
          const job = GenerationQueueModel.findById(JSON.parse((result.content![0] as { text: string }).text).id)!
          assert.equal(String(job.request_payload).includes('silver hair, red eyes, waving'), self, `${tool} include_self=${self}`)
        }
      }
      // Per-character prompts reach the NAI payload, and the speaker's appearance goes to the entry marked self.
      const split = await selfBridge.call('generate_image', { prompt: '2girls, park', include_self: false, characters: [{ prompt: 'waving', self: true, center_x: 0.3, center_y: 0.5 }, { prompt: 'black hair' }] })
      assert.notEqual(split.isError, true, JSON.stringify(split))
      const splitPayload = JSON.parse(String(GenerationQueueModel.findById(JSON.parse((split.content![0] as { text: string }).text).id)!.request_payload))
      assert.deepEqual(splitPayload.characters, [{ prompt: 'silver hair, red eyes, waving', uc: '', center_x: 0.3, center_y: 0.5 }, { prompt: 'black hair', uc: '', center_x: 0.5, center_y: 0.5 }])
      assert.equal(splitPayload.use_coords, true)
      assert.equal(splitPayload.prompt.includes('silver hair'), false)
    } finally { stopSelf(); await selfBridge.close(); ChatProfileStore.update(profile.id, { appearance: '' }) }
    const guestContext = { threadId: CodexChatStore.createThread(accountId, 'guest presets', 'llm', profile.id), profileId: profile.id, kind: 'direct' as const, replyId: 'linked-guest' }
    const stop = registerChatReply(guestContext, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: [] })
    const grant = resolveChatProfileToolGrant(ChatProfileStore.find(profile.id)!, resolveChatAccess(accountId))
    const guest = await openChatMcpBridge({ accountId, accountType: 'guest' }, grant.scopes, grant.toolAllowlist, { chatContext: guestContext, generationPresetIds: [nai.id, comfy.id] })
    try {
      assert.ok(grant.scopes.includes('generate'), 'a linked preset gives the profile its generate scope')
      assert.notEqual((await guest.call('generate_image', { prompt: 'signed in only' })).isError, true, 'no rights at all still run the linked NAI preset')
      ChatProfileStore.update(profile.id, { allowedGroupKeys: ['admin'] })
      assert.equal((await guest.call('generate_image', { prompt: 'outside the audience' })).isError, true)
    } finally {
      stop(); await guest.close()
      ChatProfileStore.update(profile.id, { allowedGroupKeys: [] })
      AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['content.read'] })
    }
  })
  await t.test('library write tools enforce feature grants and group assignment at call time', async () => {
    const { requireMcpToolAccess } = await import('../src/mcp/toolAccess')
    const id = Number(auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES ('library-tool-user', 'unused', 'guest')").run().lastInsertRowid)
    const grants = AuthPermissionGroup.createCustomGroup({ name: 'library-tool-grants', permissionKeys: [] })
    AuthPermissionGroup.addAccountMembership(grants.id, id)
    const context = (scopes: Array<'read' | 'organize' | 'delete'> = ['organize', 'delete']) => ({ scopes, source: 'http' as const, requester: { accountId: id, accountType: 'admin' as const } })
    for (const name of ['upload_image', 'update_image_metadata', 'tag_images', 'delete_images', 'restore_deleted_images']) {
      assert.throws(() => requireMcpToolAccess(context(), name), /Permission required/, name)
    }
    AuthPermissionGroup.updateCustomGroup(grants.id, { name: grants.name, permissionKeys: ['content.edit'] })
    // Editing covers organizing, uploading into a group and creating its path; nothing extra per argument.
    for (const params of [{}, { group_id: 1 }, { group_path: 'Not created' }]) assert.doesNotThrow(() => requireMcpToolAccess(context(), 'upload_image', params))
    for (const name of ['update_image_metadata', 'tag_images']) assert.doesNotThrow(() => requireMcpToolAccess(context(), name))
    for (const name of ['delete_images', 'restore_deleted_images']) assert.throws(() => requireMcpToolAccess(context(), name), /content\.delete/, name)
    AuthPermissionGroup.updateCustomGroup(grants.id, { name: grants.name, permissionKeys: ['content.edit', 'content.delete'] })
    for (const name of ['upload_image', 'update_image_metadata', 'tag_images', 'delete_images', 'restore_deleted_images']) {
      assert.doesNotThrow(() => requireMcpToolAccess(context(), name, { group_path: 'Chosen group' }))
      assert.throws(() => requireMcpToolAccess(context(['read']), name), /Unknown|permitted/)
    }
    // Deleting is its own scope: organize alone no longer reaches it.
    for (const name of ['delete_images', 'restore_deleted_images']) assert.throws(() => requireMcpToolAccess(context(['organize']), name), /Unknown|permitted/)
    AuthPermissionGroup.updateCustomGroup(grants.id, { name: grants.name, permissionKeys: ['content.edit'] })
    const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
    const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
    const { registerChatReply } = await import('../src/services/codex-chat/chatReplyRegistry')
    const profile = ChatProfileStore.create({ name: 'Library uploader', engine: 'llm', providerName: 'fixture', mcpEnabled: true, mcpScopes: ['organize'] })
    const chatContext = { threadId: CodexChatStore.createThread(id, 'library upload', 'llm', profile.id), profileId: profile.id, kind: 'direct' as const, replyId: 'library-upload' }
    const stop = registerChatReply(chatContext, new AbortController().signal, () => ({ replyTo: null, recipients: ['user'] }))
    const sharp = (await import('sharp')).default
    const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#123456' } }).png().toBuffer()
    try {
      const chat = { ...context(), source: 'llm-chat' as const, chatContext }
      assert.doesNotThrow(() => requireMcpToolAccess(chat, 'upload_image', { data_url: `data:image/png;base64,${png.toString('base64')}` }), 'incoming uploads do not require images.view')
      assert.throws(() => requireMcpToolAccess(chat, 'upload_image', { data_url: 'data:image/png;base64,bm90LXB uZw==' }), /base64|MIME|match/)
    } finally { stop() }
  })
  await t.test('an after preset asks during the reply and queues the written prompt under the same grant once it ends', async (sub) => {
    const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
    const { ChatGenerationPresetStore } = await import('../src/services/codex-chat/chatGenerationPresets')
    const { resolveChatAccess, resolveChatProfileToolGrant } = await import('../src/services/codex-chat/codexChatAccess')
    const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
    const { registerChatReply } = await import('../src/services/codex-chat/chatReplyRegistry')
    const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
    const { openChatMcpBridge } = await import('../src/services/codex-chat/chatMcpBridge')
    const { GenerationQueueModel } = await import('../src/models/GenerationQueue')
    const { GenerationQueueService } = await import('../src/services/generationQueueService')
    const { requireQueuedChatGenerationAccess } = await import('../src/services/generation-queue/queueJobExecutors')
    const { ChatGenerationPromptingService } = await import('../src/services/codex-chat/chatGenerationPrompting')
    updateChatSettings({ enabled: true })
    sub.mock.method(GenerationQueueService, 'requestDispatch', () => {})
    const bodies: Array<{ messages: Array<{ role: string; content: unknown }> }> = []
    sub.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') return new Response('', { status: 404 })
      bodies.push(JSON.parse(String(init.body)))
      return Response.json({ choices: [{ message: { content: '{"prompt": "1girl, leaning on railing, sunset"}' }, finish_reason: 'stop' }] })
    })
    const inline = ChatGenerationPresetStore.create({ name: 'Inline guided', kind: 'nai', prompting: { guide: 'Always tag the expression.' } })
    const after = ChatGenerationPresetStore.create({ name: 'After reply', kind: 'nai', prompting: { timing: 'after', guide: 'Wide shots only.' } })
    const profile = ChatProfileStore.create({ name: 'After generator', engine: 'llm', providerName: 'fixture', mcpEnabled: true, mcpScopes: ['read'], toolAllowlist: [], generationPresetIds: [inline.id, after.id] })
    const threadId = CodexChatStore.createThread(adminId, 'after preset', 'llm', profile.id)
    const context = { threadId, profileId: profile.id, kind: 'direct' as const, replyId: 'after-reply' }
    const controller = new AbortController()
    const stop = registerChatReply(context, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
    const requester = { accountId: adminId, accountType: 'admin' as const }
    const grant = resolveChatProfileToolGrant(profile, resolveChatAccess(adminId))
    const bridge = await openChatMcpBridge(requester, grant.scopes, grant.toolAllowlist, { chatContext: context, generationPresetIds: profile.generationPresetIds })
    try {
      const tools = new Map(bridge.tools.map((tool) => [tool.function.name, tool.function]))
      assert.match(tools.get('generate_image')!.description ?? '', /Always tag the expression/)
      assert.deepEqual(Object.keys((tools.get('generate_image_2')!.parameters as { properties: object }).properties), ['focus'])
      const jobs = () => (user.getUserSettingsDb().prepare('SELECT COUNT(*) AS n FROM generation_queue_jobs').get() as { n: number }).n
      const before = jobs()
      const asked = await bridge.call('generate_image_2', { focus: 'the sunset view' })
      assert.notEqual(asked.isError, true, JSON.stringify(asked))
      assert.equal(JSON.parse((asked.content![0] as { text: string }).text).status, 'requested')
      assert.equal(jobs(), before)
    } finally { await bridge.close() }
    CodexChatStore.addMessage({ thread_id: threadId, role: 'assistant', content: 'She leaned on the railing as the sun went down.', tool_calls: [], status: 'completed', error: null, routing: { replyId: 'after-reply', replyTo: null, recipients: ['user'] } })
    stop()
    await (ChatGenerationPromptingService as unknown as { process: (replyId: string) => Promise<void> }).process.call(ChatGenerationPromptingService, 'after-reply')
    assert.equal(bodies.length, 1)
    assert.match(String(bodies[0].messages[0].content), /Wide shots only/)
    assert.match(String(bodies[0].messages[1].content), /leaned on the railing/)
    const row = user.getUserSettingsDb().prepare('SELECT state, job_id, error FROM chat_deferred_generations WHERE reply_id = ?').get('after-reply') as { state: string; job_id: number | null; error: string | null }
    assert.equal(row.state, 'queued', row.error ?? '')
    const job = GenerationQueueModel.findById(row.job_id!)!
    assert.equal(job.service_type, 'novelai')
    assert.equal(job.requested_by_account_id, adminId)
    assert.match(JSON.stringify(job.request_payload), /leaning on railing, sunset/)
    assert.doesNotThrow(() => requireQueuedChatGenerationAccess(job))
    assert.ok(user.getUserSettingsDb().prepare('SELECT 1 FROM chat_generation_links WHERE job_id = ? AND reply_id = ?').get(job.id, 'after-reply'))
  })
  await t.test('chat execution intersects live domain, profile, role, ownership and host boundaries', async (sub) => {
    const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
    const { ChatToolPresetStore } = await import('../src/services/codex-chat/chatToolPresets')
    const { ChatGenerationPresetStore } = await import('../src/services/codex-chat/chatGenerationPresets')
    const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
    const { registerChatReply } = await import('../src/services/codex-chat/chatReplyRegistry')
    const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
    const { openChatMcpBridge } = await import('../src/services/codex-chat/chatMcpBridge')
    const { requireMcpToolAccess } = await import('../src/mcp/toolAccess')
    const { GenerationQueueModel } = await import('../src/models/GenerationQueue')
    const { GenerationQueueService } = await import('../src/services/generationQueueService')
    const { McpArtifactService } = await import('../src/services/mcpArtifactService')
    const { enqueueMcpGenerationJob } = await import('../src/mcp/tools/generationJobTools')
    const { requireQueuedChatGenerationAccess } = await import('../src/services/generation-queue/queueJobExecutors')
    const db = user.getUserSettingsDb()
    const permissions = ['content.read', 'content.edit']
    const grant = (keys = permissions) => AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: keys })
    grant()
    updateChatSettings({ enabled: true })
    const profile = ChatProfileStore.create({ name: 'Security fixture', engine: 'llm', providerName: 'fixture', mcpEnabled: true, mcpScopes: ['read', 'generate', 'configure'] })
    const context = { threadId: CodexChatStore.createThread(accountId, 'security', 'llm', profile.id), profileId: profile.id, kind: 'direct' as const, replyId: 'security-reply' }
    const controller = new AbortController()
    const close = registerChatReply(context, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
    const bridge = await openChatMcpBridge({ accountId, accountType: 'admin' }, ['read', 'generate', 'configure'], null, { chatContext: context })
    const cancel = sub.mock.method(GenerationQueueService, 'requestCancellation', async () => {})
    const dispatch = sub.mock.method(GenerationQueueService, 'requestDispatch', () => {})
    const refresh = sub.mock.method(McpArtifactService, 'refreshDescriptor', async () => null)
    try {
      assert.notEqual((await bridge.call('list_prompt_presets', {})).isError, true, 'permitted website read survives')
      assert.equal((await bridge.call('unknown_host_tool', {})).isError, true)
      assert.throws(() => requireMcpToolAccess({ scopes: ['read'], requester: { accountId, accountType: 'admin' } }, 'unclassified_future_tool'), /Unknown|Unclassified/)
      assert.equal((await bridge.call('get_chat_setup_guide', { topic: 'display_block' })).isError, true, 'forged browser admin does not grant admin configuration')
      const own = GenerationQueueModel.create({ service_type: 'novelai', request_payload: { prompt: 'fixture' }, requested_by_account_id: accountId, requested_by_account_type: 'guest' })
      const foreign = GenerationQueueModel.create({ service_type: 'novelai', request_payload: { prompt: 'fixture' }, requested_by_account_id: adminId, requested_by_account_type: 'admin' })
      assert.notEqual((await bridge.call('get_generation_job', { job_id: own })).isError, true)
      for (const name of ['get_generation_job', 'get_generation_artifacts', 'cancel_generation_job']) assert.equal((await bridge.call(name, { job_id: foreign })).isError, true, name)
      assert.equal(cancel.mock.callCount(), 0, 'foreign cancellation denied before the side effect')
      const history = Number(db.prepare("INSERT INTO api_generation_history (service_type, requested_by_account_id, requested_by_account_type) VALUES ('novelai', ?, 'admin')").run(adminId).lastInsertRowid)
      assert.equal((await bridge.call('get_generation_history_request', { history_id: history })).isError, true)
      assert.equal((await bridge.call('refresh_artifact_download', { artifact_id: 'forged' })).isError, true)
      assert.equal(refresh.mock.callCount(), 0)
      // Codex goes through the same queue as the website's generation tab, carrying the chat grant that is rechecked at dispatch.
      const codex = await bridge.call('submit_generation_job', { service_type: 'codex', request_payload: { prompt: 'queued, never dispatched' } })
      assert.notEqual(codex.isError, true)
      const codexJob = GenerationQueueModel.findById(JSON.parse((codex.content as Array<{ text: string }>)[0].text).id)!
      assert.equal(codexJob.service_type, 'codex')
      const { requireQueuedChatGenerationAccess } = await import('../src/services/generation-queue/queueJobExecutors')
      assert.doesNotThrow(() => requireQueuedChatGenerationAccess(codexJob))
      dispatch.mock.resetCalls()
      const before = db.prepare('SELECT COUNT(*) AS count FROM generation_queue_jobs').get() as { count: number }
      assert.equal((await bridge.call('execute_graph_workflow', { workflow_id: 1 })).isError, true)
      for (const payload of [{ nested: { filePath: 'C:\\private\\secret' } }, { timeline_data: '{"assets":{"x":{"storagePath":"C:\\\\private\\\\secret"}}}' }, { __ref: 'queue-input', sha256: 'a'.repeat(64) }]) {
        assert.equal((await bridge.call('submit_generation_job', { service_type: 'comfyui', workflow_id: 1, inputs: payload })).isError, true)
      }
      assert.equal((db.prepare('SELECT COUNT(*) AS count FROM generation_queue_jobs').get() as { count: number }).count, before.count)
      ChatProfileStore.update(profile.id, { mcpEnabled: false })
      assert.equal((await bridge.call('list_prompt_presets', {})).isError, true)
      ChatProfileStore.update(profile.id, { mcpEnabled: true, toolAllowlist: [] })
      assert.equal((await bridge.call('list_prompt_presets', {})).isError, true)
      const tools = ChatToolPresetStore.create({ name: 'Live tool grant', scopes: ['read'], toolAllowlist: ['list_prompt_presets'] })
      ChatProfileStore.update(profile.id, { mcpScopes: tools.scopes, toolAllowlist: tools.toolAllowlist })
      assert.notEqual((await bridge.call('list_prompt_presets', {})).isError, true)
      ChatToolPresetStore.update(tools.id, { toolAllowlist: [] })
      assert.notEqual((await bridge.call('list_prompt_presets', {})).isError, true, 'a loaded preset is a copy: editing the preset leaves the profile alone')
      ChatToolPresetStore.delete(tools.id)
      assert.notEqual((await bridge.call('list_prompt_presets', {})).isError, true, 'deleting the preset leaves the profile alone')
      ChatProfileStore.update(profile.id, { mcpScopes: ['read', 'generate'], toolAllowlist: null })
      grant([])
      assert.equal((await bridge.call('list_prompt_presets', {})).isError, true)
      grant()
      auth.prepare("UPDATE auth_accounts SET status = 'disabled' WHERE id = ?").run(accountId)
      assert.equal((await bridge.call('list_prompt_presets', {})).isError, true)
      auth.prepare("UPDATE auth_accounts SET status = 'active' WHERE id = ?").run(accountId)
      invalidateResolvedAuthAccessCache()
      const authority = { scopes: ['generate' as const], requester: { accountId, accountType: 'guest' as const }, source: 'llm-chat' as const, chatContext: context }
      const queued = await enqueueMcpGenerationJob(authority, { service_type: 'novelai', request_payload: { prompt: 'fixture', n_samples: 1 } })
      assert.ok(queued?.id)
      assert.equal(dispatch.mock.callCount(), 1)
      close()
      const job = GenerationQueueModel.findById(queued!.id)!
      assert.doesNotThrow(() => requireQueuedChatGenerationAccess(job), 'accepted queue job remains authorized after its reply ends')
      assert.doesNotThrow(() => requireQueuedChatGenerationAccess(GenerationQueueModel.findById(own)!), 'ordinary website jobs retain their contract')
      db.prepare('INSERT INTO chat_generation_links (job_id, thread_id, reply_id) VALUES (?, ?, ?)').run(own, context.threadId, 'legacy-reply')
      assert.throws(() => requireQueuedChatGenerationAccess(GenerationQueueModel.findById(own)!), /older chat generation job/)
      // Generating needs no right: the queued job rechecks who may use the profile instead.
      grant([])
      assert.doesNotThrow(() => requireQueuedChatGenerationAccess(job))
      ChatProfileStore.update(profile.id, { allowedGroupKeys: ['admin'] })
      assert.throws(() => requireQueuedChatGenerationAccess(job), /권한|프로필/)
      ChatProfileStore.update(profile.id, { allowedGroupKeys: [] })
      grant()
      ChatProfileStore.update(profile.id, { mcpScopes: ['read'] })
      assert.throws(() => requireQueuedChatGenerationAccess(job), /프로필/)
      const preset = ChatGenerationPresetStore.create({ name: 'Preset boundary', kind: 'nai' })
      ChatProfileStore.update(profile.id, { mcpScopes: ['generate'], generationPresetIds: [preset.id] })
      const presetContext = { ...context, replyId: 'preset-security' }
      const stop = registerChatReply(presetContext, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
      const presets = await openChatMcpBridge(authority.requester, ['generate'], null, { chatContext: presetContext, generationPresetIds: [preset.id] })
      try {
        ChatGenerationPresetStore.update(preset.id, { nai: { promptPrefix: 'edited in the same second' } })
        assert.equal((await presets.call('generate_image', { prompt: 'must not generate' })).isError, true)
        assert.equal(dispatch.mock.callCount(), 1)
      } finally { stop(); await presets.close() }
      const administratorContext = { ...context, threadId: CodexChatStore.createThread(adminId, 'admin security', 'llm', profile.id), replyId: 'admin-demotion' }
      ChatProfileStore.update(profile.id, { generationPresetIds: [], mcpScopes: ['configure'] })
      const endAdmin = registerChatReply(administratorContext, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
      const adminBridge = await openChatMcpBridge({ accountId: adminId, accountType: 'admin' }, ['configure'], null, { chatContext: administratorContext })
      try {
        assert.notEqual((await adminBridge.call('get_chat_setup_guide', { topic: 'display_block' })).isError, true)
        auth.prepare("UPDATE auth_accounts SET account_type = 'guest' WHERE id = ?").run(adminId)
        invalidateResolvedAuthAccessCache()
        assert.equal((await adminBridge.call('get_chat_setup_guide', { topic: 'display_block' })).isError, true, 'live demotion removes admin authority in an open bridge')
      } finally {
        endAdmin(); await adminBridge.close()
        auth.prepare("UPDATE auth_accounts SET account_type = 'admin' WHERE id = ?").run(adminId)
        invalidateResolvedAuthAccessCache()
      }
    } finally {
      close(); await bridge.close(); grant(['content.read'])
      auth.prepare("UPDATE auth_accounts SET status = 'active' WHERE id = ?").run(accountId)
      invalidateResolvedAuthAccessCache()
    }
  })
  await t.test('account-bound artifacts keep live authenticated downloads and external keys keep signed links', async (sub) => {
    const { McpArtifactService } = await import('../src/services/mcpArtifactService')
    const { ImageUploadService } = await import('../src/services/imageUploadService')
    const { HistoryQueryRepository } = await import('../src/repositories/history/HistoryQueryRepository')
    const record = { id: 901, requested_by_account_id: accountId, requested_by_account_type: 'guest', generation_status: 'completed', actual_composite_hash: 'a'.repeat(48), actual_mime_type: 'image/png' }
    sub.mock.method(HistoryQueryRepository, 'findByIdWithMetadata', () => record)
    sub.mock.method(HistoryQueryRepository, 'findAllWithMetadata', () => [record])
    sub.mock.method(ImageUploadService, 'getActiveFilePath', () => path.join(root, 'uploads', 'permission.png'))
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['content.read'] })
    const requester = { accountId, accountType: 'admin' as const }
    const own = await McpArtifactService.createHistoryDescriptor(record.id, origin, requester)
    assert.equal(own?.download_url, `${origin}/api/generation-history/${record.id}/file`)
    assert.ok(!own?.download_url.includes('token='))
    const external = await McpArtifactService.createHistoryDescriptor(record.id, origin)
    assert.ok(external?.download_url.includes('/mcp/artifacts/'))
    assert.ok(external?.download_url.includes('token='))
    const refreshed = await McpArtifactService.refreshDescriptor(own!.artifact_id, origin, requester)
    assert.equal(refreshed?.download_url, own?.download_url)
    record.requested_by_account_id = adminId
    await assert.rejects(McpArtifactService.refreshDescriptor(own!.artifact_id, origin, requester), /not accessible/)
    record.requested_by_account_id = accountId
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: [] })
    await assert.rejects(McpArtifactService.createHistoryDescriptor(record.id, origin, requester), /content.read/)
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['content.read'] })
  })
  await t.test('functional reads and actions survive page-off, and page grants confer neither', async () => {
    const reads = ['/api/prompt-collection/search', '/api/prompt-presets', '/api/wildcards', '/api/workflows', '/api/graph-workflows', '/api/module-definitions', '/api/custom-dropdown-lists', '/api/comfyui-servers', '/api/external-api/llm-presets/options']
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['content.read'] })
    for (const url of reads) assert.equal(await status(url, accountId), 200, url)
    for (const url of ['/api/prompt-presets', '/api/prompt-collection/collect', '/api/prompt-groups', '/api/wildcards', '/api/workflows', '/api/graph-workflows', '/api/module-definitions', '/api/custom-dropdown-lists', '/api/comfyui-servers']) assert.equal(await status(url, accountId, 'POST'), 403, url)
    assert.equal(await status('/api/prompt-collection/resolve-groups', accountId, 'POST'), 400)
    assert.equal(await status('/api/wildcards/parse', accountId, 'POST'), 400)
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: [] })
    for (const url of reads) assert.equal(await status(url, accountId), 403, url)
    assert.equal(await status('/api/generation-queue', accountId), 200, 'session-only queue read survives')
    assert.equal(await status('/api/generation-queue', accountId, 'POST'), 400, 'generation only needs sign-in')
    for (const url of ['/api/settings', '/api/settings/general', '/api/external-api/providers', '/api/comfyui-servers']) assert.equal(await status(url, accountId, url.endsWith('general') ? 'PUT' : url.endsWith('servers') ? 'POST' : 'GET'), 403, url)
    assert.equal(await status('/api/custom-dropdown-lists/comfy-model-thumbnail', accountId), 403)
    assert.equal(await status('/api/nai/store/vibes/missing', accountId, 'PUT'), 403)
    assert.equal(await status('/api/nai/store/character-references', accountId, 'POST'), 403)
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: [] })
    assert.equal(await status('/api/generation-queue', accountId, 'POST'), 400, 'execute reaches input validation without pages/images')
    assert.equal(await status('/api/graph-workflows/999999/execute', accountId, 'POST'), 404)
    assert.equal(await status('/api/workflows/999999/generate', accountId, 'POST'), 400)
    assert.equal(await status('/api/public-workflows/missing/queue', accountId, 'POST'), 404, 'publication scope remains')
    assert.notEqual(await status('/api/nai/generate/upscale', accountId, 'POST'), 403, 'inline upscale makes a new copy: sign-in only')
    const safeSettings = await (await fetch(origin + '/api/runtime-settings/image-save', { headers: { 'x-test-account': String(accountId) } })).json() as { data: Record<string, unknown> }
    assert.deepEqual(Object.keys(safeSettings.data), ['imageSave'])
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['content.read'] })
    assert.equal(await status('/api/custom-dropdown-lists/comfy-model-thumbnail', accountId), 400, 'bitmap reads do not require workflow data/page rights')
    assert.equal(await status('/api/settings', adminId), 200, 'admin configuration independent of navigation')
    for (const key of ['content.edit', 'content.delete', 'page.files.view']) assert.throws(() => AuthPermissionGroup.replaceBuiltInPageAccess('anonymous', [key]), /invalid/, `visitors cannot be given ${key}`)
    for (const url of reads) assert.equal(await status(url), 401, 'preserve login boundary: ' + url)
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['content.read'] })
  })
  await t.test('SSE uses live functional grants, rejects bootstrap residue and never writes sessions', async () => {
    const { resolveEventStreamAccess, resolvePermittedEventStreamTopics, createEventStreamAccessRevalidator } = await import('../src/routes/events/event-stream-auth')
    const residue = { authenticated: true, accountType: 'admin', permissionKeys: ['page.generation.view', 'content.read'] }
    assert.deepEqual(resolveEventStreamAccess({ session: residue } as never), { ok: false, status: 401 })
    assert.deepEqual(residue, { authenticated: true, accountType: 'admin', permissionKeys: ['page.generation.view', 'content.read'] })
    assert.deepEqual(createEventStreamAccessRevalidator(null, ['generation-queue'], true)(), { ok: false, reason: 'unauthenticated' })
    assert.deepEqual(resolvePermittedEventStreamTopics(['page.generation.view'], ['generation-queue', 'generation-history', 'graph-execution', 'runtime-job']), ['generation-queue', 'runtime-job'])
    assert.deepEqual(resolvePermittedEventStreamTopics(['content.read'], ['generation-history', 'graph-execution']), ['generation-history', 'graph-execution'])
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['content.read'] })
    const revalidate = createEventStreamAccessRevalidator(accountId, ['graph-execution'])
    assert.deepEqual(revalidate(), { ok: true })
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: [] })
    assert.deepEqual(revalidate(), { ok: false, reason: 'permission-revoked' })
    assert.deepEqual(createEventStreamAccessRevalidator(accountId, ['generation-queue'])(), { ok: true })
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['content.read'] })
    const nonTopicRevalidate = createEventStreamAccessRevalidator(accountId, ['generation-queue'])
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: [] })
    assert.deepEqual(nonTopicRevalidate(), { ok: false, reason: 'permission-revoked' }, 'revoking a non-topic grant refreshes shared auth state')
    const addedGrantRevalidate = createEventStreamAccessRevalidator(accountId, ['generation-queue'])
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['content.read'] })
    assert.deepEqual(addedGrantRevalidate(), { ok: false, reason: 'permission-revoked' }, 'grant additions also refresh shared auth state')
    const { requireChatPageDataAccess } = await import('../src/services/codex-chat/chatPageContext')
    assert.doesNotThrow(() => requireChatPageDataAccess({ accountId, accountType: 'guest' }, 'presets'))
    const permissionRow = auth.prepare("SELECT id FROM auth_permissions WHERE permission_key = 'content.read'").get() as { id: number }
    auth.prepare("UPDATE auth_permissions SET permission_key = 'test.missing.content.read' WHERE id = ?").run(permissionRow.id)
    invalidateResolvedAuthAccessCache()
    try { assert.throws(() => requireChatPageDataAccess({ accountId, accountType: 'guest' }, 'presets'), /읽을 권한이 없어: read/, 'missing catalog rows never bypass the domain grant') }
    finally {
      auth.prepare("UPDATE auth_permissions SET permission_key = 'content.read' WHERE id = ?").run(permissionRow.id)
      invalidateResolvedAuthAccessCache()
    }
    const { GenerationTargetGroupService } = await import('../src/services/generationTargetGroupService')
    assert.equal(GenerationTargetGroupService.resolveForAccount(null, { groupPath: 'must-not-create' }).ok, false, 'a configured null account cannot create groups')
    AuthPermissionGroup.updateCustomGroup(group.id, { name: group.name, permissionKeys: ['content.read'] })
    // Same rule as MCP generation tools: an existing group receives results freely, a path that may create one edits.
    const existing = (await import('../src/services/groupPathService')).GroupPathService.resolveOrCreate('generation-target/existing').groupId
    assert.equal(GenerationTargetGroupService.resolveForAccount(accountId, { groupId: existing }).ok, true, 'an existing group needs no edit right')
    assert.deepEqual(GenerationTargetGroupService.resolveForAccount(accountId, { groupPath: 'generation-target/new' }).ok, false, 'a group path needs the edit right')
  })
  await t.test('anonymous and inherited grants use the same feature and scoped replacements roll back', async () => {
    AuthPermissionGroup.replaceBuiltInPageAccess('anonymous', ['content.read', 'page.home.view'])
    assert.equal(await status('/api/images/metadata/bad'), 400)
    assert.ok(AuthAccessControlService.resolveForGroupKey('guest').permissionKeys.includes('content.read'))
    assert.ok(AuthAccessControlService.resolveForGroupKey('anonymous').permissionKeys.includes('page.home.view'), 'the visitor home page is granted with it')
    auth.exec("CREATE TRIGGER fail_replace BEFORE INSERT ON auth_group_permissions WHEN NEW.permission_id = (SELECT id FROM auth_permissions WHERE permission_key = 'auth.guest.create') BEGIN SELECT RAISE(ABORT, 'test replacement rollback'); END")
    assert.throws(() => AuthPermissionGroup.replaceBuiltInPageAccess('anonymous', ['auth.guest.create']), /rollback/)
    auth.exec('DROP TRIGGER fail_replace')
    assert.ok(AuthAccessControlService.resolveForGroupKey('anonymous').permissionKeys.includes('content.read'))
    AuthPermissionGroup.replaceBuiltInPageAccess('anonymous', ['auth.guest.create'])
    assert.equal(await status('/api/images/metadata/bad'), 401)
    invalidateResolvedAuthAccessCache()
  })
  await t.test('image grants do not confer another account history or private files; UI page toggles keep actions', async () => {
    const request = { session: { authenticated: true, accountId, accountType: 'guest' } } as never
    assert.equal(canAccessHistoryRecord(request, { requested_by_account_id: accountId, requested_by_account_type: 'guest' }), true)
    assert.equal(canAccessHistoryRecord(request, { requested_by_account_id: adminId, requested_by_account_type: 'admin' }), false)
    const { resolveFeaturePermissions } = await import('../../frontend/src/features/auth/use-feature-permissions')
    const { resolveAccountDraftOwner } = await import('../../frontend/src/features/auth/auth-permissions')
    const readerDraftOwner = resolveAccountDraftOwner({ authenticated: true, hasCredentials: true, accountId })
    assert.equal(readerDraftOwner, resolveAccountDraftOwner({ authenticated: true, hasCredentials: true, accountId }), 'same-account reload keeps its draft namespace')
    assert.notEqual(readerDraftOwner, resolveAccountDraftOwner({ authenticated: true, hasCredentials: true, accountId: adminId }), 'another account never shares the draft namespace')
    assert.notEqual(resolveAccountDraftOwner({ authenticated: true, hasCredentials: false, accountId: null }), resolveAccountDraftOwner({ authenticated: false, hasCredentials: true, accountId: null }), 'bootstrap drafts are not anonymous drafts after setup')
    const none = { isAdmin: false, canRead: false, canEdit: false, canDelete: false }
    assert.deepEqual(resolveFeaturePermissions(['page.generation.view', 'page.prompts.view'], true), none, 'pages grant no action')
    assert.deepEqual(resolveFeaturePermissions(['content.read', 'content.edit', 'content.delete'], false), none, 'signed out holds nothing')
    assert.deepEqual(resolveFeaturePermissions(['content.read', 'content.delete'], true), { ...none, canRead: true, canDelete: true })
    const keys = ['page.home.view', 'content.read', 'content.edit', 'content.edit']
    assert.deepEqual(setPermissionGrant(keys, 'page.home.view', false), keys.slice(1))
    const available = AuthPermissionGroup.listBuiltInEditablePermissions().map((row) => ({ permissionKey: row.permission_key, label: row.description ?? row.permission_key, description: row.description }))
    const member = buildPermissionLayout(available, 'guest')
    assert.deepEqual(member.rights.map((row) => row.key), ['content.read', 'content.edit', 'content.delete'], 'guest signup is only for visitors')
    assert.equal(member.pages.length, 15)
    assert.ok(member.pages.every((row) => /^page\.[a-z.]+\.view$/.test(row.key)))
    const visitor = buildPermissionLayout(available, 'anonymous')
    assert.deepEqual(visitor.rights.map((row) => row.key), ['content.read', 'auth.guest.create'])
    assert.deepEqual(visitor.pages.map((row) => row.key), ['page.home.view', 'page.groups.view', 'page.wallpaper.view', 'page.wallpaper.runtime.view'])
  })
})
