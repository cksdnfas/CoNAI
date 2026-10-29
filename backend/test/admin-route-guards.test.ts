import './support/testTemp'
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
  const { invalidateConfiguredAuthCache } = await import('../src/services/auth/sessionAccess')
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
  const adminId = addAccount('admin-test', 'admin')
  auth.prepare("INSERT INTO auth_account_group_memberships (account_id, group_id) SELECT ?, id FROM auth_permission_groups WHERE group_key = 'admin'").run(adminId)
  const group = AuthPermissionGroup.createCustomGroup({ name: 'viewer', permissionKeys: ['images.view'] })
  const guestId = addAccount('viewer', 'guest')
  const otherId = addAccount('viewer-2', 'guest')
  AuthPermissionGroup.addAccountMembership(group.id, guestId)
  AuthPermissionGroup.addAccountMembership(group.id, otherId)
  invalidateConfiguredAuthCache()

  await t.test('moving resource editors keeps administrator access; personal settings cannot run shared actions', async () => {
    const { requireChatPageAccess, requireChatPageActionAccess } = await import('../src/services/codex-chat/chatPageContext')
    const guest = { accountId: guestId, accountType: 'guest' as const }
    assert.throws(() => requireChatPageAccess(guest, { path: '/chat/resources', kind: 'settings', resourceId: 'chat' }), /권한/)
    assert.throws(() => requireChatPageActionAccess(guest, { path: '/characters', kind: 'settings' }, 'profile.save'), /관리자/)
    const personal = { path: '/settings', kind: 'settings' as const, resourceId: 'mine' }
    assert.throws(() => requireChatPageActionAccess(guest, personal, 'settings.save'), /내 설정/)
    assert.throws(() => requireChatPageActionAccess(guest, personal, 'settings.mcp_server'), /내 설정/)
    const chatGroup = AuthPermissionGroup.createCustomGroup({ name: 'personal-settings', permissionKeys: ['chat.use'] })
    AuthPermissionGroup.addAccountMembership(chatGroup.id, guestId)
    assert.doesNotThrow(() => requireChatPageAccess(guest, personal))
    assert.doesNotThrow(() => requireChatPageActionAccess(guest, personal, 'settings.user_profile'))
    assert.doesNotThrow(() => requireChatPageActionAccess(guest, personal, 'settings.flag'))
  })

  await t.test('all page-setting snapshots fit the public field contract without exposing extra values', async () => {
    const { PAGE_SETTINGS_SCOPES, pageSettingsPatch } = await import('@conai/shared')
    for (const [scope, definition] of Object.entries(PAGE_SETTINGS_SCOPES)) {
      const response = await call(`/api/page-settings/${scope}`, adminId)
      assert.equal(response.status, 200, scope)
      const { values } = response.body.data
      assert.deepEqual(Object.keys(values).sort(), definition.fields.map((field) => field.id).sort(), scope)
      assert.doesNotThrow(() => pageSettingsPatch(scope as keyof typeof PAGE_SETTINGS_SCOPES, values), scope)
    }
  })

  await t.test('page settings require explicit grants, bound fields, current revisions and live access', async () => {
    const url = '/api/page-settings/image-save'
    assert.equal((await call(url, 0)).status, 401)
    assert.equal((await call(url, guestId)).status, 403)
    const delegated = AuthPermissionGroup.createCustomGroup({ name: 'media-settings', permissionKeys: ['settings.media.manage'] })
    AuthPermissionGroup.addAccountMembership(delegated.id, guestId)
    const initial = await call(url, guestId)
    assert.equal(initial.status, 200)
    const { values, revision } = initial.body.data
    assert.deepEqual(Object.keys(initial.body.data).sort(), ['revision', 'values'])
    assert.equal(typeof values.quality, 'number')
    assert.equal('llm' in values, false)
    assert.equal((await call('/api/settings', guestId)).status, 403)
    assert.equal((await call('/api/page-settings/chat', guestId)).status, 403)
    assert.equal((await call('/api/page-settings/tagger/check-dependencies', guestId, 'POST')).status, 403)
    assert.equal((await call(url, guestId, 'PUT', { quality: 80 })).status, 428)
    assert.equal((await call(url, guestId, 'PUT', { quality: '80' }, { 'If-Match': revision })).status, 400)
    assert.equal((await call(url, guestId, 'PUT', { pythonPath: 'forbidden' }, { 'If-Match': revision })).status, 400)
    const quality = values.quality === 80 ? 81 : 80
    const saved = await call(url, guestId, 'PUT', { quality }, { 'If-Match': revision })
    assert.equal(saved.status, 200)
    assert.equal(saved.body.data.values.quality, quality)
    assert.notEqual(saved.body.data.revision, revision)
    assert.equal((await call(url, guestId, 'PUT', { quality: 90 }, { 'If-Match': revision })).status, 409)
    const native = await call('/api/settings', adminId)
    assert.equal(native.body.data.imageSave.quality, quality)
    assert.equal(native.body.data.imageSave.maxWidth, values.maxWidth)
    assert.equal((await call('/api/settings/image-save', adminId, 'PUT', { quality: 90 }, { 'If-Match': revision })).status, 409, 'a stale native settings draft cannot overwrite a modal save')
    // A change made through the existing settings tab also invalidates an open modal's version.
    assert.equal((await call('/api/settings/image-save', adminId, 'PUT', { quality: 79 })).status, 200)
    assert.equal((await call(url, guestId, 'PUT', { quality: 91 }, { 'If-Match': saved.body.data.revision })).status, 409)
    const latest = (await call(url, guestId)).body.data
    AuthPermissionGroup.removeAccountMembership(delegated.id, guestId)
    assert.equal((await call(url, guestId)).status, 403)
    assert.equal((await call(url, guestId, 'PUT', { quality: 92 }, { 'If-Match': latest.revision })).status, 403)
    const { requireChatPageAccess, requireChatPageActionAccess } = await import('../src/services/codex-chat/chatPageContext')
    const requester = { accountId: guestId, accountType: 'guest' as const }
    const page = { path: '/', kind: 'page_settings' as const, resourceId: 'thumbnail' }
    assert.throws(() => requireChatPageAccess(requester, page))
    assert.throws(() => requireChatPageActionAccess(requester, page, 'page_settings.save'))
    AuthPermissionGroup.addAccountMembership(delegated.id, guestId)
    requireChatPageAccess(requester, page)
    requireChatPageActionAccess(requester, page, 'page_settings.save')
    assert.throws(() => requireChatPageAccess(requester, { ...page, resourceId: 'general' }))
    AuthPermissionGroup.removeAccountMembership(delegated.id, guestId)
  })

  await t.test('native and delegated revisions cover hidden settings without disclosing them', async () => {
    const delegated = AuthPermissionGroup.createCustomGroup({ name: 'shared-settings-revision', permissionKeys: ['settings.library.manage', 'settings.appearance.manage'] })
    AuthPermissionGroup.addAccountMembership(delegated.id, guestId)
    const initial = (await call('/api/settings', adminId)).body.data
    const general = (await call('/api/page-settings/general', guestId)).body.data
    const protection = { ...initial.general.deleteProtection, enabled: !initial.general.deleteProtection.enabled }
    assert.equal((await call('/api/settings/general', adminId, 'PUT', { deleteProtection: protection })).status, 200)
    assert.equal((await call('/api/settings/general', adminId, 'PUT', { deleteProtection: initial.general.deleteProtection }, { 'If-Match': initial.pageSettingsRevisions.general })).status, 409)
    assert.equal((await call('/api/page-settings/general', guestId, 'PUT', { enableGallery: !general.values.enableGallery }, { 'If-Match': general.revision })).status, 409)
    const latestGeneral = (await call('/api/page-settings/general', guestId)).body.data
    assert.equal('deleteProtection' in latestGeneral.values, false)
    assert.equal((await call('/api/page-settings/general', guestId, 'PUT', { enableGallery: !latestGeneral.values.enableGallery }, { 'If-Match': latestGeneral.revision })).status, 200)
    assert.deepEqual((await call('/api/settings', adminId)).body.data.general.deleteProtection, protection)

    const appearance = (await call('/api/page-settings/appearance', guestId)).body.data
    const native = (await call('/api/settings', adminId)).body.data
    assert.equal((await call('/api/settings/appearance', adminId, 'PUT', { customPrimaryColor: '#123456' })).status, 200)
    assert.equal((await call('/api/settings/appearance', adminId, 'PUT', { customPrimaryColor: native.appearance.customPrimaryColor }, { 'If-Match': native.pageSettingsRevisions.appearance })).status, 409)
    assert.equal((await call('/api/page-settings/appearance', guestId, 'PUT', { themeMode: 'dark' }, { 'If-Match': appearance.revision })).status, 409)
    const latestAppearance = (await call('/api/page-settings/appearance', guestId)).body.data
    assert.equal('customPrimaryColor' in latestAppearance.values, false)
    assert.equal((await call('/api/page-settings/appearance', guestId, 'PUT', { themeMode: 'dark' }, { 'If-Match': latestAppearance.revision })).status, 200)
    assert.equal((await call('/api/settings', adminId)).body.data.appearance.customPrimaryColor, '#123456')
    const runtimeSnapshot = (await call('/api/settings', adminId)).body.data
    const { settingsService } = await import('../src/services/settingsService')
    const cpuThreads = runtimeSnapshot.aiRuntime.cpuThreads === 2 ? 3 : 2
    settingsService.updateAiRuntimeSettings({ cpuThreads })
    assert.equal((await call('/api/settings/ai-runtime', adminId, 'PUT', { cpuThreads: runtimeSnapshot.aiRuntime.cpuThreads }, { 'If-Match': runtimeSnapshot.pageSettingsRevisions['ai-runtime'] })).status, 409)
    assert.equal((await call('/api/settings/tagger', adminId, 'PUT', { pythonPath: runtimeSnapshot.tagger.pythonPath }, { 'If-Match': runtimeSnapshot.pageSettingsRevisions.tagger })).status, 400)
    assert.equal((await call('/api/settings', adminId)).body.data.aiRuntime.cpuThreads, cpuThreads)
    AuthPermissionGroup.removeAccountMembership(delegated.id, guestId)
  })

  await t.test('immediate group colors do not invalidate a general draft or get overwritten by it', async () => {
    const before = (await call('/api/settings', adminId)).body.data
    const colors = { 'revision-test': '#123abc' }
    assert.equal((await call('/api/settings/general', adminId, 'PUT', { permissionGroupColors: colors })).status, 200)
    const afterColors = (await call('/api/settings', adminId)).body.data
    assert.equal(afterColors.pageSettingsRevisions.general, before.pageSettingsRevisions.general)
    const saved = await call('/api/settings/general', adminId, 'PUT', { promptForDownloadLocation: !before.general.promptForDownloadLocation }, { 'If-Match': before.pageSettingsRevisions.general })
    assert.equal(saved.status, 200)
    assert.deepEqual(saved.body.data.general.permissionGroupColors, colors)
    assert.equal((await call('/api/settings/general', adminId, 'PUT', { permissionGroupColors: {} }, { 'If-Match': before.pageSettingsRevisions.general })).status, 400)
    assert.deepEqual((await call('/api/settings', adminId)).body.data.general.permissionGroupColors, colors)
  })

  await t.test('saving AI runtime and tagger together keeps both changes and rejects checked legacy paths', async () => {
    const { settingsService } = await import('../src/services/settingsService')
    const { taggerDaemon } = await import('../src/services/taggerDaemon')
    const { kaloscopeTaggerService } = await import('../src/services/kaloscopeTaggerService')
    const { textWorker } = await import('../src/services/aiWorker/textEmbeddingService')
    const { semanticIndexer } = await import('../src/services/embeddings/semanticIndex')
    const { imageTaggerService } = await import('../src/services/imageTaggerService')
    const { autoTagScheduler } = await import('../src/services/autoTagScheduler')
    settingsService.updateTaggerSettings({ enabled: false, model: 'vit' })
    const mocks = [
      t.mock.method(taggerDaemon, 'stop', async () => {}),
      t.mock.method(kaloscopeTaggerService, 'stopDaemon', async () => {}),
      t.mock.method(textWorker, 'stop', async () => {}),
      t.mock.method(semanticIndexer, 'poke', () => {}),
      t.mock.method(imageTaggerService, 'checkPythonDependencies', async () => ({ available: true, message: 'ready' })),
      t.mock.method(imageTaggerService, 'reloadConfig', async () => {}),
      t.mock.method(autoTagScheduler, 'restart', () => {}),
    ]
    try {
      const before = (await call('/api/settings', adminId)).body.data
      const runtime = await call('/api/settings/ai-runtime', adminId, 'PUT', { pythonSource: 'custom', customPythonPath: 'new-python' }, { 'If-Match': before.pageSettingsRevisions['ai-runtime'] })
      assert.equal(runtime.status, 200)
      const tagger = await call('/api/settings/tagger', adminId, 'PUT', { enabled: true }, { 'If-Match': before.pageSettingsRevisions.tagger })
      assert.equal(tagger.status, 200)
      assert.equal(tagger.body.data.aiRuntime.customPythonPath, 'new-python')
      assert.equal(tagger.body.data.tagger.enabled, true)
      assert.equal((await call('/api/settings/tagger', adminId, 'PUT', { enabled: false }, { 'If-Match': before.pageSettingsRevisions.tagger })).status, 409)
      assert.equal((await call('/api/settings/tagger', adminId, 'PUT', { pythonPath: 'old-python' }, { 'If-Match': tagger.body.data.pageSettingsRevisions.tagger })).status, 400)
      assert.equal((await call('/api/settings/tagger', adminId, 'PUT', { pythonPath: 'legacy-python' })).status, 200)
      assert.equal((await call('/api/settings', adminId)).body.data.aiRuntime.customPythonPath, 'legacy-python')
    } finally {
      for (const mock of mocks) mock.mock.restore()
    }
  })

  await t.test('wallpaper collection replacement detects additions and deletions; live changes preserve the collection', async () => {
    const url = '/api/settings/appearance'
    const date = '2026-10-11T00:00:00Z'
    const first = { id: 'revision-first', name: 'First', canvasPresetId: 'custom', widgets: [], createdAt: date, updatedAt: date }
    const second = { ...first, id: 'revision-second', name: 'Second' }
    assert.equal((await call(url, adminId, 'PUT', { wallpaperLayoutPresets: [first], wallpaperActivePresetId: first.id })).status, 200)
    const stale = (await call('/api/settings', adminId)).body.data
    assert.equal((await call(url, adminId, 'PUT', { wallpaperLayoutPresets: [first, second] })).status, 200)
    assert.equal((await call(url, adminId, 'PUT', { wallpaperLayoutPresets: [first] }, { 'If-Match': stale.pageSettingsRevisions.appearance })).status, 409)
    const added = (await call('/api/settings', adminId)).body.data
    assert.equal((await call(url, adminId, 'PUT', { wallpaperActivePresetId: second.id }, { 'If-Match': added.pageSettingsRevisions.appearance })).status, 200)
    const live = (await call('/api/settings', adminId)).body.data
    assert.deepEqual(live.appearance.wallpaperLayoutPresets.map((preset: { id: string }) => preset.id), [first.id, second.id])
    assert.equal(live.appearance.wallpaperActivePresetId, second.id)
    assert.equal((await call(url, adminId, 'PUT', { wallpaperLayoutPresets: [first], wallpaperActivePresetId: null })).status, 200)
    assert.equal((await call(url, adminId, 'PUT', { wallpaperLayoutPresets: [first, second] }, { 'If-Match': live.pageSettingsRevisions.appearance })).status, 409)
    const afterDelete = (await call('/api/settings', adminId)).body.data
    assert.deepEqual(afterDelete.appearance.wallpaperLayoutPresets.map((preset: { id: string }) => preset.id), [first.id])
    assert.equal(afterDelete.appearance.customPrimaryColor, '#123456')
  })

  await t.test('each LLM collection rejects stale saves and deletes while revision-less writers remain supported', async () => {
    const url = '/api/settings/llm'
    const kinds = ['systemPromptPresets', 'promptPresets', 'structuredOutputJsonPresets'] as const
    const initial = (await call('/api/settings/llm-presets/options', adminId)).body.data
    for (const kind of kinds) {
      const before = (await call('/api/settings/llm-presets/options', adminId)).body.data
      const preset = { id: `revision-${kind}`, name: `Revision ${kind}`, content: kind === 'structuredOutputJsonPresets' ? '{}' : 'content', createdAt: '2026-10-11T00:00:00Z', updatedAt: '2026-10-11T00:00:00Z' }
      assert.equal((await call(url, adminId, 'PUT', { [kind]: [...initial[kind], preset] })).status, 200)
      assert.equal((await call(url, adminId, 'PUT', { [kind]: initial[kind] }, { 'If-Match': initial.collectionRevisions[kind] })).status, 409)
      const current = (await call('/api/settings/llm-presets/options', adminId)).body.data
      assert.ok(current[kind].some((item: { id: string }) => item.id === preset.id))
      for (const other of kinds.filter((key) => key !== kind)) {
        assert.deepEqual(current[other], before[other])
        assert.equal(current.collectionRevisions[other], before.collectionRevisions[other])
      }
      assert.equal((await call(url, adminId, 'PUT', { [kind]: current[kind].filter((item: { id: string }) => item.id !== preset.id) }, { 'If-Match': current.collectionRevisions[kind] })).status, 200)
      assert.equal((await call(url, adminId, 'PUT', { [kind]: current[kind] }, { 'If-Match': current.collectionRevisions[kind] })).status, 409)
    }
    const latest = (await call('/api/settings/llm-presets/options', adminId)).body.data
    assert.equal((await call(url, adminId, 'PUT', { systemPromptPresets: latest.systemPromptPresets, promptPresets: latest.promptPresets }, { 'If-Match': latest.collectionRevisions.promptPresets })).status, 400)
    assert.deepEqual(latest.systemPromptPresets, initial.systemPromptPresets)
    assert.deepEqual(latest.promptPresets, initial.promptPresets)
    assert.deepEqual(latest.structuredOutputJsonPresets, initial.structuredOutputJsonPresets)
  })

  await t.test('a native settings response pairs the latest state with its revision after an async reload', async () => {
    const { settingsService } = await import('../src/services/settingsService')
    const { imageTaggerService } = await import('../src/services/imageTaggerService')
    const { autoTagScheduler } = await import('../src/services/autoTagScheduler')
    settingsService.updateTaggerSettings({ enabled: false, model: 'vit', generalThreshold: 0.4 })
    settingsService.updateAiRuntimeSettings({ customPythonPath: 'different-runtime-python' })
    const initial = (await call('/api/settings', adminId)).body.data
    let started!: () => void
    let release!: () => void
    const entered = new Promise<void>((resolve) => { started = resolve })
    const released = new Promise<void>((resolve) => { release = resolve })
    const reload = t.mock.method(imageTaggerService, 'reloadConfig', async () => { started(); await released })
    const restart = t.mock.method(autoTagScheduler, 'restart', () => {})
    const pending = call('/api/settings/tagger', adminId, 'PUT', { generalThreshold: 0.5 }, { 'If-Match': initial.pageSettingsRevisions.tagger })
    try {
      await Promise.race([entered, pending.then(() => { throw new Error('The request never reached reload') })])
      settingsService.updateTaggerSettings({ generalThreshold: 0.6 })
      release()
      const response = await pending
      const latest = (await call('/api/settings', adminId)).body.data
      assert.equal(response.status, 200)
      assert.equal(response.body.data.tagger.generalThreshold, 0.6)
      assert.equal(response.body.data.aiRuntime.customPythonPath, 'different-runtime-python')
      assert.equal(response.body.data.pageSettingsRevisions.tagger, latest.pageSettingsRevisions.tagger)
    } finally {
      release()
      await pending
      reload.mock.restore()
      restart.mock.restore()
    }
  })

  await t.test('contextual settings bind the resource to its host page and keep saves as review cards', async () => {
    const { normalizeChatPageSnapshot, chatPageActionTier, chatPageActionAllowed } = await import('@conai/shared')
    const admin = { accountId: adminId, accountType: 'admin' as const }
    const page = { instanceId: 'inst-settings-1', connectionId: 'conn-settings-1', title: 'Settings', revision: 'rev-settings-1' }
    const { requireChatPageAccess, requireChatPageActionAccess } = await import('../src/services/codex-chat/chatPageContext')
    const snapshot = normalizeChatPageSnapshot({ ...page, path: '/upload', kind: 'page_settings', resourceId: 'image-save', fields: [{ id: 'quality', label: '품질', type: 'number', value: 80 }], actions: [{ id: 'page_settings.save', label: '저장', description: '', effect: 'save', schema: { type: 'object', properties: {} } }] })
    requireChatPageAccess(admin, snapshot)
    requireChatPageActionAccess(admin, snapshot, 'page_settings.save')
    assert.equal(chatPageActionTier('page_settings.save'), 'commit')
    assert.equal(chatPageActionTier('page.settings_open'), 'view')
    assert.throws(() => normalizeChatPageSnapshot({ ...snapshot, resourceId: 'chat' }))
    assert.throws(() => normalizeChatPageSnapshot({ ...snapshot, path: '/public/workflows/example' }))
    assert.throws(() => requireChatPageActionAccess(admin, { ...snapshot, kind: 'upload' }, 'page_settings.save'))
    assert.throws(() => requireChatPageActionAccess(admin, snapshot, 'page_settings.select', { scope: 'chat' }))
    assert.ok(!chatPageActionAllowed('/upload', 'settings.mcp_http'), 'the old admin actions are not opened to other pages')
  })

  await t.test('revoking a grant during a worker dependency check prevents the deferred settings write', async () => {
    const { settingsService } = await import('../src/services/settingsService')
    const { imageTaggerService } = await import('../src/services/imageTaggerService')
    settingsService.updateTaggerSettings({ enabled: false, model: 'vit' })
    const analysis = AuthPermissionGroup.createCustomGroup({ name: 'analysis-settings', permissionKeys: ['settings.analysis.manage'] })
    AuthPermissionGroup.addAccountMembership(analysis.id, guestId)
    const initial = (await call('/api/page-settings/tagger', guestId)).body.data
    let started!: () => void
    let release!: () => void
    const entered = new Promise<void>((resolve) => { started = resolve })
    const released = new Promise<void>((resolve) => { release = resolve })
    const check = t.mock.method(imageTaggerService, 'checkPythonDependencies', async () => { started(); await released; return { available: true, message: 'ready' } })
    const pending = call('/api/page-settings/tagger', guestId, 'PUT', { enabled: true }, { 'If-Match': initial.revision })
    try {
      await Promise.race([entered, pending.then(() => { throw new Error('The request never reached the dependency check') })])
      AuthPermissionGroup.removeAccountMembership(analysis.id, guestId)
      release()
      assert.equal((await pending).status, 403)
      assert.equal(settingsService.loadSettings().tagger.enabled, false)
    } finally {
      release()
      await pending
      check.mock.restore()
      AuthPermissionGroup.removeAccountMembership(analysis.id, guestId)
    }
  })

  await t.test('only admins can change the shared app mark and invalid images preserve the saved mark', async () => {
    const url = '/api/settings/appearance'
    assert.equal((await call(url, 0, 'PUT', { appIconDataUrl: '' })).status, 401)
    assert.equal((await call(url, guestId, 'PUT', { appIconDataUrl: '' })).status, 403)
    assert.equal((await call('/api/settings/appearance-public', 0)).body.data.appIconDataUrl, '')

    const sharp = (await import('sharp')).default
    const image = await sharp({ create: { width: 2, height: 1, channels: 4, background: { r: 80, g: 120, b: 160, alpha: 0.5 } } }).png().toBuffer()
    const saved = await call(url, adminId, 'PUT', { appIconDataUrl: `data:image/png;base64,${image.toString('base64')}` })
    assert.equal(saved.status, 200)
    const mark = saved.body.data.appearance.appIconDataUrl
    assert.equal((await call('/api/settings/appearance-public', 0)).body.data.appIconDataUrl, mark)
    const metadata = await sharp(Buffer.from(mark.split(',')[1], 'base64')).metadata()
    assert.equal(metadata.width, 128)
    assert.equal(metadata.height, 128)
    assert.equal(metadata.hasAlpha, true)
    const pixels = await sharp(Buffer.from(mark.split(',')[1], 'base64')).ensureAlpha().raw().toBuffer()
    assert.equal(pixels[3], 0, 'padding remains fully transparent')
    assert.equal(pixels[(64 * 128 + 64) * 4 + 3], 128, 'partial transparency survives resize and storage')

    for (const appIconDataUrl of [null, 'https://example.com/icon.png', 'data:image/svg+xml;base64,PHN2Zy8+', 'data:image/png;base64,YmFk', `data:image/png;base64,${'A'.repeat(384 * 1024)}`]) {
      assert.equal((await call(url, adminId, 'PUT', { appIconDataUrl })).status, 400)
    }
    assert.equal((await call('/api/settings/appearance-public', 0)).body.data.appIconDataUrl, mark)
    assert.equal((await call(url, adminId, 'PUT', { appIconDataUrl: '' })).status, 200)
    assert.equal((await call('/api/settings/appearance-public', 0)).body.data.appIconDataUrl, '')
  })

  await t.test('a prompt viewer cannot install or check shared Danbooru database releases', async () => {
    const promptGroup = AuthPermissionGroup.createCustomGroup({ name: 'prompt-viewer', permissionKeys: ['prompts.view'] })
    const promptViewer = addAccount('prompt-viewer', 'guest')
    AuthPermissionGroup.addAccountMembership(promptGroup.id, promptViewer)
    assert.equal((await call('/api/danbooru-browser/summary', promptViewer)).status, 200)
    for (const [url, method] of [
      ['/api/danbooru-browser/installation', 'GET'],
      ['/api/danbooru-browser/installation', 'POST'],
      ['/api/danbooru-browser/installation/check', 'POST'],
    ]) assert.equal((await call(url, promptViewer, method)).status, 403)
  })

  await t.test('a guest with image viewing cannot run server maintenance', async () => {
    const maintenance: Array<[string, string]> = [
      ['/api/system/cache-stats', 'GET'], ['/api/system/cache-stats/reset', 'POST'], ['/api/system/cache/invalidate', 'POST'],
      ['/api/system/maintenance/orphan-cleanup', 'POST'], ['/api/system/database-backups', 'GET'], ['/api/system/database-backups', 'POST'],
      ['/api/system/maintenance/compact-database', 'POST'], ['/api/system/database-stats', 'GET'],
      ['/api/system/database-backups/20260101-000000/download', 'GET'], ['/api/system/database-backups/20260101-000000', 'DELETE'],
      ['/api/file-verification/stats', 'GET'], ['/api/file-verification/verify', 'POST'], ['/api/file-verification/settings', 'PUT'],
    ]
    for (const [url, method] of maintenance) assert.equal((await call(url, guestId, method)).status, 403, `${method} ${url}`)
    assert.equal((await call('/api/file-verification/stats', adminId)).status, 200)
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
    // A fresh test database has no free pages to reclaim; VACUUM rewrites the schema in its own order, which can cost
    // a page of packing on an already compact file.
    assert.ok(job.result.bytesAfter <= job.result.bytesBefore + 4096, JSON.stringify(job.result))
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
