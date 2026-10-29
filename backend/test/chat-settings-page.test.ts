import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

/**
 * Settings tabs for a connected chat: field hints reach the model (and are the first thing a long screen drops), the
 * settings operations are bound to /settings with their tiers, and saves stay review cards.
 */
test('settings page connection: field hints, settings operation tiers and binding', { timeout: 60000 }, async (t) => {
  // Load runtime modules only after isolating every data path. Never open the user's databases.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-settings-chat-page-'))
  process.env.RUNTIME_BASE_PATH = root
  process.env.RUNTIME_DATABASE_DIR = path.join(root, 'database')
  process.env.RUNTIME_SAVE_DIR = path.join(root, 'save')
  const dbModule = await import('../src/database/userSettingsDb')
  dbModule.initializeUserSettingsDb()
  const authModule = await import('../src/database/authDb')
  authModule.initializeAuthDb()
  t.after(async () => {
    authModule.getAuthDb().close()
    dbModule.closeUserSettingsDb()
    ;(await import('../src/database/init')).closeDatabase()
    const { logger } = await import('../src/utils/logger')
    await new Promise<void>((resolve) => logger.close(resolve))
    assert.ok(path.basename(root).startsWith('conai-settings-chat-page-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const { normalizeChatPageSnapshot, normalizeChatPageActions, chatPageActionTier, chatPageActionAllowed, isPrivateChatPageKey, CHAT_PAGE_LIMITS } = await import('@conai/shared')
  const { boundedPageView } = await import('../src/services/codex-chat/chatPageContext')
  const { chatPageView } = await import('../src/mcp/tools/chatPageView')
  const admin = { accountId: null, accountType: 'admin' as const }
  const page = { instanceId: 'inst-settings-1', connectionId: 'conn-settings-1', path: '/settings', title: '설정 · 자동', kind: 'settings' as const, resourceId: 'auto', revision: 'rev-settings-1' }

  await t.test('moved resource adapters retain action IDs and their route boundaries', async () => {
    const { chatPagePermission } = await import('@conai/shared')
    assert.equal(chatPagePermission('/chat/resources'), 'page.settings.view')
    assert.equal(chatPagePermission('/settings?section=mine'), 'page.chat.view')
    assert.equal(chatPagePermission('/settings?section=chat'), 'page.settings.view')
    for (const id of ['profile.open_create', 'profile.open_edit', 'profile.draft', 'profile.save', 'profile.character_save']) {
      assert.ok(chatPageActionAllowed('/characters', id), id)
      assert.ok(!chatPageActionAllowed('/chat/resources', id), id)
    }
    for (const id of ['resource.open', 'resource.save', 'lorebook.entries', 'block.fields', 'settings.routine', 'settings.automation_switch']) assert.ok(chatPageActionAllowed('/chat/resources', id), id)
    assert.ok(!chatPageActionAllowed('/chat/resources', 'settings.save'))
    for (const path of ['/characters', '/chat/resources']) assert.equal(normalizeChatPageSnapshot({ ...page, path, fields: [] }).path, path)
  })

  await t.test('a field hint is kept, capped, and shown in the view', () => {
    const snapshot = normalizeChatPageSnapshot({ ...page, fields: [{ id: 'tagger.model', label: '모델', type: 'text', value: 'vit', hint: 'pixai-v1: more tags, CUDA GPU only' }] })
    assert.equal(snapshot.fields[0].hint, 'pixai-v1: more tags, CUDA GPU only')
    assert.equal(normalizeChatPageSnapshot({ ...page, fields: [{ id: 'a', label: 'A', type: 'text', value: '' }] }).fields[0].hint, undefined, 'no hint, no key')
    assert.throws(() => normalizeChatPageSnapshot({ ...page, fields: [{ id: 'a', label: 'A', type: 'text', value: '', hint: 'x'.repeat(CHAT_PAGE_LIMITS.hint + 1) }] }))
    assert.match(JSON.stringify(chatPageView(admin, snapshot)), /"hint":"pixai-v1/)
  })

  await t.test('a long screen drops the hints before anything else', () => {
    const fields = Array.from({ length: 20 }, (_, index) => ({ id: `f${index}`, label: `Field ${index}`, type: 'text' as const, value: 'v'.repeat(100), hint: 'h'.repeat(60) }))
    const view = chatPageView(admin, normalizeChatPageSnapshot({ ...page, fields }))
    const full = JSON.stringify(view)
    const withoutHints = JSON.stringify({ ...view, fields: view.fields.map(({ hint: _hint, ...field }) => field) })
    const bounded = boundedPageView(view, withoutHints.length + 10)
    assert.ok(full.length > withoutHints.length + 10)
    assert.equal(bounded, withoutHints, 'values stay whole; only the hints went')
    assert.equal(boundedPageView(view, full.length), full, 'within budget nothing changes')
    assert.doesNotMatch(boundedPageView(view, 2000), /"hint"/, 'shorter views carry no hints either')
  })

  await t.test('settings operations: tiers, the /settings binding and review cards for saves', () => {
    const commit = ['settings.save', 'settings.ai_runtime', 'settings.kaloscope_requeue', 'settings.mcp_http', 'settings.maintenance', 'settings.chat_options', 'settings.default_model', 'settings.default_judge',
      'settings.llm_preset', 'settings.mcp_server', 'settings.user_profile', 'settings.flag', 'settings.routine', 'settings.automation_switch']
    for (const id of commit) assert.equal(chatPageActionTier(id), 'commit', id)
    for (const id of ['settings.ai_runtime_check', 'settings.usage_period', 'settings.judge_filter']) assert.equal(chatPageActionTier(id), 'view', id)
    for (const id of ['settings.rating_tier_add', 'settings.mcp_server_draft', 'settings.content_topic']) assert.equal(chatPageActionTier(id), 'draft', id)
    for (const id of [...commit, 'settings.rating_tier_add', 'settings.content_topic']) {
      assert.ok(chatPageActionAllowed('/settings', id), id)
      assert.ok(!chatPageActionAllowed('/chat', id) && !chatPageActionAllowed('/images/abc', id), `${id} stays on /settings`)
    }
    const schema = { type: 'object' as const, properties: {} }
    assert.equal(normalizeChatPageActions('/settings', [{ id: 'settings.save', label: '설정 저장', description: '', effect: 'save', schema }])[0].effect, 'save')
    assert.throws(() => normalizeChatPageActions('/settings', [{ id: 'settings.save', label: '설정 저장', description: '', effect: 'draft', schema }]), 'a save is never a draft')
    assert.throws(() => normalizeChatPageActions('/settings', [{ id: 'settings.mcp_server', label: 'MCP', description: '', effect: 'save', schema: { type: 'object', properties: { url: { type: 'string' } } } }]), 'no outside address argument')
    // Page data and argument keys of these operations are plain; dashboard counts are keyed "tok" because token keys are private.
    for (const key of ['loreKeyLanguage', 'webEngine', 'timeoutSeconds', 'scope', 'persona', 'dailyTime', 'mcpHttpKeys', 'inputTok', 'tok']) assert.ok(!isPrivateChatPageKey(key), key)
    assert.ok(isPrivateChatPageKey('inputTokens'))
  })

  await t.test('content evaluation exposes its real settings and draft actions without model connection secrets', async () => {
    const { contentEvaluationChatActions, contentEvaluationChatData, contentEvaluationModelPatch } = await import('../../frontend/src/features/settings/components/content-evaluation-chat')
    const models: import('../../frontend/src/lib/api-codex-chat').ModelSlot[] = [{ id: 7, providerName: 'judge', providerLabel: 'Judge', providerType: 'decision_typesafe', model: 'model-a', label: 'Judge · model-a', isDefault: false, sortOrder: 0, contentRatingTierId: null, profiles: [], judgePresets: [], userProfiles: 0, chats: 0, createdDate: '', updatedDate: '' }]
    const topics = Array.from({ length: 100 }, (_, index) => ({ id: `topic-${index}`, name: `Topic ${index}`, description: index === 0 ? 'https://example.invalid/criteria' : 'Assess this topic', enabled: index < 20 }))
    const draft = { revision: 2, definitionVersion: 2, modelSlotId: 7, modelReady: true, topics }
    const translate = ((dictionary: { en?: string }) => dictionary.en ?? '') as Parameters<typeof contentEvaluationChatActions>[0]
    const actions = contentEvaluationChatActions(translate)
    const snapshot = normalizeChatPageSnapshot({ ...page, resourceId: 'content-evaluation', fields: [], actions, data: contentEvaluationChatData(draft, models) })
    const view = chatPageView(admin, snapshot)
    assert.equal((snapshot.data!.topics as unknown[]).length, 100, 'archived topics beyond the 64-field limit remain readable')
    assert.match(JSON.stringify(view), /content-evaluation/)
    assert.equal(actions.find(action => action.id === 'settings.save')?.effect, 'save')
    assert.equal(actions.find(action => action.id === 'settings.content_topic')?.effect, 'draft')
    assert.ok(actions.some(action => action.id === 'resource.open'), 'the native topic editor can be opened')
    assert.doesNotMatch(JSON.stringify(snapshot.data), /apiKey|baseUrl|password|providerName/)
    assert.deepEqual(contentEvaluationModelPatch(7, models), { modelSlotId: 7 })
    assert.deepEqual(contentEvaluationModelPatch(0, models), { modelSlotId: null })
    assert.throws(() => contentEvaluationModelPatch(99, models), /모델 ID/)
    assert.throws(() => contentEvaluationModelPatch(7.5, models), /모델 ID/)
  })

  await t.test('topic draft mutations retain stable ids and archives, reject duplicates and respect the native limits', async () => {
    const { contentEvaluationTopicPatch, putContentEvaluationTopic } = await import('../../frontend/src/features/settings/components/content-evaluation-chat')
    const topics = [{ id: 'education', name: '교육', description: '학습 관련성', enabled: true }]
    const added = contentEvaluationTopicPatch(topics, { operation: 'add', name: ' AI ', description: ' 인공지능 관련성 ' }).topics!
    assert.equal(topics.length, 1, 'draft helpers never modify their source snapshot')
    assert.equal(added[0].id, 'education')
    assert.equal(added[1].name, 'AI')
    const updated = contentEvaluationTopicPatch(added, { operation: 'update', topicId: added[1].id, description: '새 판단 기준' }).topics!
    assert.equal(updated[1].id, added[1].id)
    assert.equal(updated[1].description, '새 판단 기준')
    const archived = contentEvaluationTopicPatch(updated, { operation: 'disable', topicId: 'education' }).topics!
    assert.equal(archived.length, 2)
    assert.equal(archived[0].enabled, false)
    assert.throws(() => contentEvaluationTopicPatch(updated, { operation: 'add', name: 'ai', description: '중복' }), /같은 이름/)
    assert.throws(() => contentEvaluationTopicPatch(updated, { operation: 'update', topicId: 'missing', name: '이름' }), /목록에 없는/)
    assert.throws(() => putContentEvaluationTopic(topics, { ...topics[0], name: 'x'.repeat(41) }), /1~40자/)
    assert.throws(() => putContentEvaluationTopic(topics, { ...topics[0], description: '' }), /1~1000자/)
    const full = Array.from({ length: 100 }, (_, index) => ({ id: `t-${index}`, name: `Topic ${index}`, description: '기준', enabled: index < 20 }))
    assert.throws(() => contentEvaluationTopicPatch(full, { operation: 'update', topicId: 't-21', enabled: true }), /활성 20개/)
    assert.throws(() => contentEvaluationTopicPatch(full, { operation: 'add', name: '새 주제', description: '기준' }), /전체 100개/)
  })

  await t.test('agent-only chat access permits personal settings actions and native writes, but no-chat accounts are denied', async (s) => {
    const { withPagePermissions } = await import('@conai/shared')
    const { AuthAccount } = await import('../src/models/AuthAccount')
    const { AuthAccessControlService } = await import('../src/services/authAccessControlService')
    const { requireChatPageAccess, requireChatPageActionAccess } = await import('../src/services/codex-chat/chatPageContext')
    const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
    const agentPermissions = withPagePermissions(['chat.agent.use'], false)
    assert.ok(!agentPermissions.includes('chat.use'))
    s.mock.method(AuthAccount, 'findById', (id: number) => ({ id, status: 'active', account_type: 'guest' }) as never)
    s.mock.method(AuthAccessControlService, 'resolveForAccountId', (id: number | null | undefined) => ({
      groupKeys: [], permissionKeys: id === 2 ? agentPermissions : [],
    }))
    const personal = { path: '/settings', kind: 'settings' as const, resourceId: 'mine' }
    const agent = { accountId: 2, accountType: 'guest' as const }
    const denied = { accountId: 3, accountType: 'guest' as const }
    assert.doesNotThrow(() => requireChatPageAccess(agent, personal))
    for (const id of ['settings.user_profile', 'settings.flag']) {
      assert.doesNotThrow(() => requireChatPageActionAccess(agent, personal, id))
      assert.throws(() => requireChatPageActionAccess(denied, personal, id), /권한/)
    }
    assert.throws(() => requireChatPageAccess(denied, personal), /권한/)
    updateChatSettings({ enabled: true })
    const express = (await import('express')).default
    const router = (await import('../src/routes/codex-chat.routes')).default
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
      req.session = { accountId: req.headers['x-test-account'] === '3' ? 3 : 2, accountType: 'guest' } as typeof req.session
      next()
    })
    app.use('/api/codex-chat', router)
    const server = app.listen(0, '127.0.0.1')
    await new Promise<void>((resolve) => server.once('listening', resolve))
    try {
      const address = server.address() as import('node:net').AddressInfo
      const origin = `http://127.0.0.1:${address.port}/api/codex-chat`
      for (const [path, body] of [['/user-profiles', { name: 'User', persona: 'Persona' }], ['/flags', { name: 'Flag', content: 'Instruction' }]] as const) {
        const send = (accountId: number) => fetch(`${origin}${path}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-account': String(accountId) }, body: JSON.stringify(body),
        })
        assert.equal((await send(2)).status, 201, path)
        assert.equal((await send(3)).status, 403, path)
      }
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })

  await t.test('single lorebook reads preserve global admin and shared account boundaries', async (s) => {
    const { AuthAccount } = await import('../src/models/AuthAccount')
    const { AuthAccessControlService } = await import('../src/services/authAccessControlService')
    const { invalidateConfiguredAuthCache } = await import('../src/services/auth/sessionAccess')
    const { ChatLorebookStore } = await import('../src/services/codex-chat/chatLorebook')
    const { OwnedLorebookStore } = await import('../src/services/codex-chat/chatLorebookFiles')
    const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
    const { FileStoreService, fileOwnerKey } = await import('../src/services/fileStoreService')
    const { storedFilePath } = await import('../src/services/fileStorePaths')
    const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
    s.mock.method(AuthAccount, 'countActiveAdmins', () => 1)
    s.mock.method(AuthAccount, 'findById', (id: number) => ({ id, username: `user-${id}`, status: 'active', account_type: id === 1 ? 'admin' : 'guest' }) as never)
    s.mock.method(AuthAccessControlService, 'resolveForAccountId', (id: number | null | undefined) => ({
      groupKeys: [], permissionKeys: id === 3 ? [] : ['chat.use'],
    }))
    invalidateConfiguredAuthCache()
    updateChatSettings({ enabled: true })
    const global = ChatLorebookStore.create({ name: 'Global', entries: [{ content: 'global entry' }] })
    const account = OwnedLorebookStore.create(fileOwnerKey(2), { name: 'Shared account', entries: [{ content: 'account entry' }] })
    const threadId = CodexChatStore.createThread(2, 'Private', 'llm')
    const chatBook = OwnedLorebookStore.saveChatBook(threadId, [{ content: 'private chat entry' }])!
    const express = (await import('express')).default
    const router = (await import('../src/routes/codex-chat-lorebooks.routes')).default
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
      const accountId = Number(req.headers['x-test-account'])
      req.session = { authenticated: true, accountId, accountType: 'guest' } as typeof req.session
      next()
    })
    app.use('/api/codex-chat', router)
    const server = app.listen(0, '127.0.0.1')
    await new Promise<void>((resolve) => server.once('listening', resolve))
    try {
      const address = server.address() as import('node:net').AddressInfo
      const origin = `http://127.0.0.1:${address.port}/api/codex-chat`
      const read = (path: string, accountId: number) => fetch(`${origin}${path}`, { headers: { 'x-test-account': String(accountId) } })
      const globalRead = await read(`/admin/lorebooks/${global.id}`, 1)
      assert.equal(globalRead.status, 200)
      assert.deepEqual((await globalRead.json() as { data: unknown }).data, global)
      assert.equal((await read(`/admin/lorebooks/${global.id}`, 2)).status, 403)
      assert.equal((await read(`/admin/lorebooks/${account.id}`, 1)).status, 404)
      const accountRead = await read(`/lorebooks/${account.id}`, 1)
      assert.equal(accountRead.status, 200, 'account books are shared across accounts with chat access')
      assert.deepEqual((await accountRead.json() as { data: unknown }).data, account)
      assert.equal((await read(`/lorebooks/${account.id}`, 3)).status, 403)
      assert.equal((await read(`/lorebooks/${global.id}`, 1)).status, 404)
      assert.equal((await read(`/lorebooks/${chatBook.id}`, 2)).status, 404)
      assert.equal((await read(`/lorebooks/${chatBook.id}`, 1)).status, 404)
      assert.equal((await read('/lorebooks/99999999', 1)).status, 404)
      assert.equal((await read('/lorebooks/not-an-id', 1)).status, 400)
      assert.equal((await read('/admin/lorebooks/not-an-id', 1)).status, 400)

      const owner = fileOwnerKey(2)
      const write = (path: string, method: string, body: unknown) => fetch(`${origin}${path}`, {
        method, headers: { 'x-test-account': '1', 'content-type': 'application/json' }, body: JSON.stringify(body),
      })
      assert.equal((await write(`/admin/lorebooks/${global.id}`, 'PUT', { name: 'Invalid global', revision: 7 })).status, 400)
      assert.equal((await write(`/lorebooks/${account.id}`, 'PATCH', { name: 'Invalid account', revision: null })).status, 400)
      assert.equal(ChatLorebookStore.find(global.id)?.name, global.name)
      assert.equal(OwnedLorebookStore.requireOwn(account.id, owner).name, account.name)
      const globalLegacy = await write(`/admin/lorebooks/${global.id}`, 'PUT', { name: 'Global changed' })
      assert.equal(globalLegacy.status, 200)
      const globalCurrent = (await globalLegacy.json() as { data: typeof global }).data
      const globalConflict = await write(`/admin/lorebooks/${global.id}`, 'PUT', { name: 'Stale global', revision: global.revision })
      assert.equal(globalConflict.status, 409)
      const globalError = await globalConflict.json() as { code: string; data: typeof global }
      assert.equal(globalError.code, 'revision_conflict')
      assert.equal(globalError.data.name, 'Global changed')
      assert.equal((await write(`/admin/lorebooks/${global.id}`, 'PUT', { name: 'Checked global', revision: globalCurrent.revision })).status, 200)

      const accountLegacy = await write(`/lorebooks/${account.id}`, 'PATCH', { entries: account.entries })
      assert.equal(accountLegacy.status, 200)
      const accountCurrent = (await accountLegacy.json() as { data: typeof account }).data
      const accountConflict = await write(`/lorebooks/${account.id}`, 'PATCH', { name: 'Stale account', revision: account.revision })
      assert.equal(accountConflict.status, 409)
      const accountError = await accountConflict.json() as { code: string; data: typeof account }
      assert.equal(accountError.code, 'revision_conflict')
      assert.equal(accountError.data.name, account.name)

      // Same-second, same-size file writes must not be mistaken for the cached source stamp.
      const json = FileStoreService.findChild(owner, account.folderId!, 'lorebook.json')!
      const oldTime = (dbModule.getUserSettingsDb().prepare('SELECT updated_at FROM stored_file_entries WHERE id = ?').get(json.id) as { updated_at: string }).updated_at
      const text = fs.readFileSync(storedFilePath(owner, json.id), 'utf8')
      const changed = text.replace('account entry', 'outside entry')
      assert.notEqual(changed, text)
      assert.equal(Buffer.byteLength(changed), Buffer.byteLength(text))
      FileStoreService.writeText(owner, account.folderId!, 'lorebook.json', changed, { silent: true })
      dbModule.getUserSettingsDb().prepare('UPDATE stored_file_entries SET updated_at = ? WHERE id = ?').run(oldTime, json.id)
      const fileConflict = await write(`/lorebooks/${account.id}`, 'PATCH', { entries: accountCurrent.entries, revision: accountCurrent.revision })
      assert.equal(fileConflict.status, 409)
      const fileError = await fileConflict.json() as { code: string; data: typeof account }
      assert.equal(fileError.code, 'revision_conflict')
      assert.equal(fileError.data.entries[0].content, 'outside entry')
      const afterFile = await write(`/lorebooks/${account.id}`, 'PATCH', { entries: accountCurrent.entries })
      assert.equal(afterFile.status, 200)
      const beforeDelete = (await afterFile.json() as { data: typeof account }).data
      FileStoreService.delete(owner, [json.id])
      const deletedConflict = await write(`/lorebooks/${account.id}`, 'PATCH', { entries: beforeDelete.entries, revision: beforeDelete.revision })
      assert.equal(deletedConflict.status, 409)
      assert.equal((await deletedConflict.json() as { code: string }).code, 'revision_conflict')

      const reference = FileStoreService.writeText(owner, account.folderId!, 'reference.md', 'Reference', { silent: true })
      FileStoreService.writeText(owner, account.folderId!, 'lorebook.json', JSON.stringify({ entries: [{ content: 'Relinked', file: 'reference.md' }] }), { silent: true })
      const invalidAfterRefresh = await write(`/lorebooks/${account.id}`, 'PATCH', { name: ' ' })
      assert.equal(invalidAfterRefresh.status, 400)
      const cached = dbModule.getUserSettingsDb().prepare('SELECT entries, source_stamp FROM chat_lorebooks WHERE id = ?').get(account.id) as { entries: string; source_stamp: string }
      const refreshedJson = FileStoreService.findChild(owner, account.folderId!, 'lorebook.json')!
      const onDisk = JSON.parse(fs.readFileSync(storedFilePath(owner, refreshedJson.id), 'utf8')) as { entries: Array<{ fileId: string | null }> }
      const cachedEntries = JSON.parse(cached.entries) as Array<{ fileId: string | null }>
      assert.deepEqual(cachedEntries, onDisk.entries)
      assert.equal(cachedEntries[0].fileId, reference.id)
      assert.ok(cached.source_stamp)

      FileStoreService.writeText(owner, account.folderId!, 'lorebook.json', JSON.stringify({ entries: [{ content: 'Stale entry', file: 'reference.md' }] }), { silent: true })
      s.mock.method(FileStoreService, 'writeText', () => { throw new Error('lorebook refresh write failed') })
      for (const path of [`/lorebooks/${account.id}`, '/lorebooks']) {
        const failed = await read(path, 1)
        assert.equal(failed.status, 500)
        assert.deepEqual(await failed.json(), { success: false, error: 'lorebook refresh write failed' })
      }
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
      invalidateConfiguredAuthCache()
    }
  })
})
