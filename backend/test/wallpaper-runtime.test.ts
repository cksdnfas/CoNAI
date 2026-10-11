import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

/**
 * Wallpaper runtime keys: a logged-out device (Lively) trades a key for a session that reads the
 * /api/wallpaper-runtime feeds as the issuing account, library images included, and nothing else.
 */
test('wallpaper runtime keys, access scope and feeds', { timeout: 120000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-wallpaper-runtime-'))
  process.env.RUNTIME_BASE_PATH = root
  for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
    process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
  }
  process.env.FRONTEND_DIST_PATH = path.join(root, 'no-frontend')

  const express = (await import('express')).default
  const authModule = await import('../src/database/authDb')
  authModule.initializeAuthDb()
  const auth = authModule.getAuthDb()
  const main = await import('../src/database/init')
  await main.initializeDatabase()
  const userDb = await import('../src/database/userSettingsDb')
  userDb.initializeUserSettingsDb()
  ;(await import('../src/database/apiGenerationDb')).initializeApiGenerationDb()
  const { invalidateConfiguredAuthCache } = await import('../src/routes/auth-route-helpers')
  const { registerAppRoutes } = await import('../src/startup/registerAppRoutes')
  const { WallpaperRuntimeToken } = await import('../src/models/WallpaperRuntimeToken')
  const { AuthAccount } = await import('../src/models/AuthAccount')
  t.after(async () => {
    auth.close()
    userDb.closeUserSettingsDb()
    main.closeDatabase()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
    assert.ok(path.basename(root).startsWith('conai-wallpaper-runtime-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  const adminId = Number(auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES ('admin', 'unused', 'admin')").run().lastInsertRowid)
  const guestId = Number(auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES ('guest', 'unused', 'guest')").run().lastInsertRowid)
  const adminGroup = auth.prepare("SELECT id FROM auth_permission_groups WHERE group_key = 'admin'").get() as { id: number }
  auth.prepare('INSERT OR IGNORE INTO auth_account_group_memberships (account_id, group_id) VALUES (?, ?)').run(adminId, adminGroup.id)
  invalidateConfiguredAuthCache()

  // One session object per "browser"; the header picks it so a test can be the logged-out kiosk or a login.
  const sessions: Record<string, Record<string, unknown>> = {
    kiosk: {},
    admin: { authenticated: true, accountId: adminId, accountType: 'admin' },
    guest: { authenticated: true, accountId: guestId, accountType: 'guest' },
  }
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    const name = String(req.headers['x-test-session'] ?? 'kiosk')
    Object.assign(req, { sessionID: name, session: sessions[name] })
    next()
  })
  const pass = (_req: unknown, _res: unknown, next: () => void) => next()
  registerAppRoutes(app, { uploadsDir: path.join(root, 'uploads'), tempDir: path.join(root, 'temp'), saveDir: path.join(root, 'save'), mcpLimiter: pass, readOnlyLimiter: pass, uploadLimiter: pass })
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const call = async (method: string, url: string, session = 'kiosk', body?: unknown) => {
    const response = await fetch(origin + url, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-test-session': session },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    let json: any = null
    try { json = JSON.parse(text) } catch { /* binary or empty */ }
    return { status: response.status, json }
  }

  await t.test('keys are issued by admins only, stored hashed, and listed without the secret', async () => {
    assert.equal((await call('POST', '/api/wallpaper-runtime/tokens', 'guest', { name: 'x' })).status, 403)
    const created = await call('POST', '/api/wallpaper-runtime/tokens', 'admin', { name: '거실 PC', presetId: 'living' })
    assert.equal(created.status, 201)
    assert.match(created.json.data.token, /^wpk_/)
    const stored = auth.prepare('SELECT token_hash, account_id FROM wallpaper_runtime_tokens WHERE id = ?').get(created.json.data.id) as { token_hash: string; account_id: number }
    assert.notEqual(stored.token_hash, created.json.data.token)
    assert.equal(stored.account_id, adminId)
    const listed = await call('GET', '/api/wallpaper-runtime/tokens', 'admin')
    assert.equal(listed.json.data.length, 1)
    assert.equal(listed.json.data[0].token, undefined)
  })

  await t.test('a logged-out browser reads nothing until it trades a live key', async () => {
    assert.equal((await call('GET', '/api/wallpaper-runtime/settings')).status, 401)
    assert.equal((await call('GET', '/api/images/count')).status, 401)
    assert.equal((await call('POST', '/api/wallpaper-runtime/session', 'kiosk', { token: 'wpk_wrong' })).status, 401)

    const { token, record } = WallpaperRuntimeToken.create({ name: 'kiosk', accountId: adminId, presetId: 'living' })
    const traded = await call('POST', '/api/wallpaper-runtime/session', 'kiosk', { token })
    assert.equal(traded.status, 200)
    assert.equal(traded.json.data.presetId, 'living')
    assert.equal(sessions.kiosk.wallpaperRuntimeTokenId, record.id)
    assert.equal(sessions.kiosk.authenticated, undefined, 'a key never logs the browser in')

    const settings = await call('GET', '/api/wallpaper-runtime/settings')
    assert.equal(settings.status, 200)
    assert.equal(settings.json.data.tokenPresetId, 'living')
    assert.equal((await call('GET', '/api/wallpaper-runtime/llm-usage')).status, 200, 'reads as the issuing admin')
    assert.equal((await call('GET', '/api/wallpaper-runtime/generation/queue')).status, 200)
    // Library image reads open up, writes and other features do not.
    assert.equal((await call('GET', '/api/images/count')).status, 200)
    assert.equal((await call('GET', '/api/generation-queue')).status, 401)
    assert.equal((await call('PUT', '/api/settings/appearance', 'kiosk', { wallpaperLayoutPresets: [] })).status, 401)

    WallpaperRuntimeToken.revoke(record.id)
    assert.equal((await call('GET', '/api/wallpaper-runtime/settings')).status, 401)
    assert.equal((await call('GET', '/api/images/count')).status, 401)
  })

  await t.test('a key stops working when its account is disabled', async () => {
    const { token } = WallpaperRuntimeToken.create({ name: 'kiosk 2', accountId: adminId, presetId: null })
    sessions.kiosk = {}
    await call('POST', '/api/wallpaper-runtime/session', 'kiosk', { token })
    assert.equal((await call('GET', '/api/wallpaper-runtime/settings')).status, 200)
    auth.prepare("UPDATE auth_accounts SET status = 'disabled' WHERE id = ?").run(adminId)
    assert.equal((await call('GET', '/api/wallpaper-runtime/settings')).status, 401)
    auth.prepare("UPDATE auth_accounts SET status = 'active' WHERE id = ?").run(adminId)
    assert.ok(AuthAccount.findById(adminId))
  })

  await t.test('generation feeds are scoped to the reader', async () => {
    const db = userDb.getUserSettingsDb()
    const insert = db.prepare(`INSERT INTO api_generation_history (service_type, generation_status, composite_hash, requested_by_account_id, requested_by_account_type) VALUES (?, 'completed', ?, ?, ?)`)
    insert.run('novelai', 'a'.repeat(64), adminId, 'admin')
    insert.run('comfyui', 'b'.repeat(64), guestId, 'guest')
    db.prepare(`INSERT INTO api_generation_history (service_type, generation_status, requested_by_account_id) VALUES ('novelai', 'failed', ?)`).run(guestId)

    const adminHistory = await call('GET', '/api/wallpaper-runtime/generation/history', 'admin')
    assert.equal(adminHistory.json.data.length, 2)
    assert.equal(adminHistory.json.data[0].thumbnailUrl, `/api/images/${'b'.repeat(64)}/thumbnail`)

    // A guest with the runtime page sees only its own generations and never admin data.
    const guestGroup = auth.prepare("SELECT id FROM auth_permission_groups WHERE group_key = 'guest'").get() as { id: number }
    auth.prepare('INSERT OR IGNORE INTO auth_account_group_memberships (account_id, group_id) VALUES (?, ?)').run(guestId, guestGroup.id)
    const permission = auth.prepare("SELECT id FROM auth_permissions WHERE permission_key = 'images.view'").get() as { id: number }
    auth.prepare('INSERT OR REPLACE INTO auth_group_permissions (group_id, permission_id, allowed) VALUES (?, ?, 1)').run(guestGroup.id, permission.id)
    ;(await import('../src/services/authAccessControlService')).invalidateResolvedAuthAccessCache()
    const guestHistory = await call('GET', '/api/wallpaper-runtime/generation/history', 'guest')
    assert.equal(guestHistory.status, 200)
    assert.deepEqual(guestHistory.json.data.map((item: { serviceType: string }) => item.serviceType), ['comfyui'])
    const guestStats = await call('GET', '/api/wallpaper-runtime/generation/stats?days=3', 'guest')
    assert.equal(guestStats.json.data.totals.total, 2)
    assert.equal(guestStats.json.data.totals.failed, 1)
    assert.equal((await call('GET', '/api/wallpaper-runtime/llm-usage', 'guest')).status, 403)
  })

  await t.test('saved layouts keep version 2 fields and reject unknown backgrounds', async () => {
    const preset = {
      id: 'living', name: '거실', canvasPresetId: 'custom', version: 2, canvasWidth: 2560, canvasHeight: 1080, themeMode: 'dark',
      background: { kind: 'group-slideshow', groupId: 3, intervalSec: 300 },
      widgets: [{ id: 'w1', type: 'generation-progress', x: 40, y: 60, w: 480, h: 120, zIndex: 1, locked: false, hidden: false, rotation: 0, style: { variant: 'glass' }, settings: {} }],
      createdAt: '2026-10-11T00:00:00Z', updatedAt: '2026-10-11T00:00:00Z',
    }
    const bad = await call('PUT', '/api/settings/appearance', 'admin', { wallpaperLayoutPresets: [{ ...preset, background: { kind: 'webcam' } }] })
    assert.equal(bad.status, 400)
    const saved = await call('PUT', '/api/settings/appearance', 'admin', { wallpaperLayoutPresets: [preset], wallpaperActivePresetId: 'living' })
    assert.equal(saved.status, 200, JSON.stringify(saved.json))
    const read = await call('GET', '/api/wallpaper-runtime/settings', 'admin')
    const stored = read.json.data.wallpaperLayoutPresets[0]
    assert.equal(stored.version, 2)
    assert.equal(stored.canvasWidth, 2560)
    assert.deepEqual(stored.background, preset.background)
    assert.deepEqual(stored.widgets[0].style, { variant: 'glass' })
  })

  await t.test('workflow activity is a few counts, failures only from the last day', async () => {
    const db = userDb.getUserSettingsDb()
    const workflowId = Number(db.prepare("INSERT INTO graph_workflows (name, graph_json) VALUES ('wf', '{}')").run().lastInsertRowid)
    const inactiveId = Number(db.prepare("INSERT INTO graph_workflows (name, graph_json, is_active) VALUES ('off', '{}', 0)").run().lastInsertRowid)
    const insert = db.prepare(`INSERT INTO graph_executions (graph_workflow_id, graph_version, status, started_at, completed_at, created_date, updated_date)
      VALUES (?, 1, ?, ?, ?, datetime('now', ?), datetime('now', ?))`)
    insert.run(workflowId, 'queued', null, null, '-5 minutes', '-5 minutes')
    insert.run(workflowId, 'running', '2026-01-01 00:00:00', null, '-1 hours', '-1 minutes')
    const completed = Number(insert.run(workflowId, 'completed', null, null, '-2 hours', '-2 hours').lastInsertRowid)
    db.prepare("UPDATE graph_executions SET completed_at = datetime('now', '-2 hours') WHERE id = ?").run(completed)
    insert.run(workflowId, 'failed', null, null, '-3 hours', '-3 hours')
    // Old failure and inactive workflows do not count.
    insert.run(workflowId, 'failed', null, null, '-3 days', '-3 days')
    insert.run(inactiveId, 'queued', null, null, '-5 minutes', '-5 minutes')

    const activity = await call('GET', '/api/wallpaper-runtime/workflow-activity', 'admin')
    assert.equal(activity.status, 200, JSON.stringify(activity.json))
    assert.deepEqual(activity.json.data.counts, { queued: 1, running: 1, completed: 1, failed: 1 })
    assert.equal(activity.json.data.workflowCount, 1)
    assert.equal(activity.json.data.oldestRunningAt, '2026-01-01T00:00:00Z')
    assert.match(activity.json.data.oldestQueuedAt, /Z$/)
  })

  await t.test('a logged-out viewer is refused account feeds instead of getting empty ones', async () => {
    sessions.kiosk = {}
    const anonymousGroup = auth.prepare("SELECT id FROM auth_permission_groups WHERE group_key = 'anonymous'").get() as { id: number }
    // The runtime page permission follows images.view.
    const permission = auth.prepare("SELECT id FROM auth_permissions WHERE permission_key = 'images.view'").get() as { id: number }
    auth.prepare('INSERT OR REPLACE INTO auth_group_permissions (group_id, permission_id, allowed) VALUES (?, ?, 1)').run(anonymousGroup.id, permission.id)
    ;(await import('../src/services/authAccessControlService')).invalidateResolvedAuthAccessCache()
    assert.equal((await call('GET', '/api/wallpaper-runtime/settings')).status, 200)
    for (const url of ['/generation/history', '/generation/stats', '/generation/queue', '/workflow-activity', '/llm-usage']) {
      const refused = await call('GET', `/api/wallpaper-runtime${url}`)
      assert.equal(refused.status, 403, url)
      // Widgets read this to say "sign in or use a key" rather than "not allowed".
      assert.equal(refused.json.code, 'sign_in_required', url)
    }
    const guestRefused = await call('GET', '/api/wallpaper-runtime/llm-usage', 'guest')
    assert.equal(guestRefused.status, 403)
    assert.equal(guestRefused.json.code, undefined)
    // Library stats stay public (visible media only).
    assert.equal((await call('GET', '/api/wallpaper-runtime/library/stats')).status, 200)
  })

  await t.test('a wallpaper sends chat only from a saved widget that allows it, into the chat it shows', async () => {
    ;(await import('../src/services/codex-chat/chatSettings')).updateChatSettings({ enabled: true })
    const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
    const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
    const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
    const { CodexChatService } = await import('../src/services/codex-chat/codexChatService')
    ExternalApiProvider.create({ provider_name: 'wp-conn', display_name: 'Conn', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
    const plain = ChatProfileStore.create({ name: 'Plain', engine: 'llm', providerName: 'wp-conn' })
    const tooled = ChatProfileStore.create({ name: 'Tooled', engine: 'llm', providerName: 'wp-conn', mcpEnabled: true, mcpScopes: ['read'] })
    const plainThread = CodexChatStore.createThread(adminId, 'plain chat', 'llm', plain.id)
    const tooledThread = CodexChatStore.createThread(adminId, 'tooled chat', 'llm', tooled.id)

    const chatWidget = (id: string, settings: Record<string, unknown>) => ({ id, type: 'chat-recent', x: 0, y: 0, w: 400, h: 300, zIndex: 1, locked: false, hidden: false, rotation: 0, style: {}, settings: { title: '', messageCount: 3, ...settings } })
    const preset = {
      id: 'chat-room', name: 'chat', canvasPresetId: 'landscape-1080p', version: 2, background: { kind: 'theme' },
      widgets: [
        chatWidget('read-only', { profileId: plain.id }),
        chatWidget('plain', { profileId: plain.id, allowReply: true }),
        chatWidget('tooled', { profileId: tooled.id, allowReply: true }),
        chatWidget('tooled-allowed', { profileId: tooled.id, allowReply: true, allowTools: true }),
        { ...chatWidget('inbox', { profileId: null, allowReply: true, listCount: 8 }), type: 'chat-inbox' },
      ],
      createdAt: '2026-10-11T00:00:00Z', updatedAt: '2026-10-11T00:00:00Z',
    }
    const savedChat = await call('PUT', '/api/settings/appearance', 'admin', { wallpaperLayoutPresets: [preset], wallpaperActivePresetId: null })
    assert.equal(savedChat.status, 200, JSON.stringify(savedChat.json))
    const { token } = WallpaperRuntimeToken.create({ name: 'chat kiosk', accountId: adminId, presetId: null })
    sessions.kiosk = {}
    assert.equal((await call('POST', '/api/wallpaper-runtime/session', 'kiosk', { token })).status, 200)
    const send = (widgetId: string, threadId: number, text = 'hi') => call('POST', '/api/wallpaper-runtime/chat/send', 'kiosk', { presetId: 'chat-room', widgetId, threadId, text })

    assert.equal((await send('read-only', plainThread)).status, 404, 'replies are off unless the widget allows them')
    assert.equal((await send('missing', plainThread)).status, 404)
    assert.equal((await send('plain', plainThread, 'x'.repeat(501))).status, 400)
    const moved = await send('plain', tooledThread)
    assert.equal(moved.status, 409, 'never a chat the widget does not follow')
    assert.equal(moved.json.code, 'chat_changed')
    const tools = await send('tooled', tooledThread)
    assert.equal(tools.status, 403)
    assert.equal(tools.json.code, 'tools_not_allowed')
    // The inbox may send into any chat of its list, nothing outside it, and keeps the tools gate.
    assert.equal((await send('inbox', 999_999)).json.code, 'chat_changed')
    assert.equal((await send('inbox', tooledThread)).json.code, 'tools_not_allowed')

    const sent = await send('plain', plainThread)
    assert.equal(sent.status, 202, JSON.stringify(sent.json))
    assert.equal(sent.json.data.threadId, plainThread)
    // Right after: still answering (409) or inside the cooldown (429), never a second send.
    assert.ok([409, 429].includes((await send('plain', plainThread)).status))
    // The reply fails against the unreachable connection; let it settle before the database closes.
    for (let waited = 0; CodexChatService.isRunning(plainThread) && waited < 10_000; waited += 50) await new Promise((resolve) => setTimeout(resolve, 50))
    assert.ok(CodexChatStore.listMessages(plainThread).some((message) => message.role === 'user' && message.content === 'hi'))
    assert.equal((await send('tooled-allowed', tooledThread)).status, 202)
    for (let waited = 0; CodexChatService.isRunning(tooledThread) && waited < 10_000; waited += 50) await new Promise((resolve) => setTimeout(resolve, 50))
  })
})
