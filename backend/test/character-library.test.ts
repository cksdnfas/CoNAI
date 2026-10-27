import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import sharp from 'sharp'
import { CHAT_PROFILE_TEXT_LIMITS, type ChatAssetBatch } from '@conai/shared'

test('character library: hierarchy, revisions, owner assets and lossless migration', { timeout: 60000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-character-library-'))
  process.env.RUNTIME_BASE_PATH = root
  process.env.RUNTIME_DATABASE_DIR = path.join(root, 'database')
  process.env.RUNTIME_SAVE_DIR = path.join(root, 'save')
  process.env.RUNTIME_UPLOADS_DIR = path.join(root, 'uploads')
  process.env.RUNTIME_TEMP_DIR = path.join(root, 'temp')
  const settings = await import('../src/database/userSettingsDb')
  settings.initializeUserSettingsDb()
  ;(await import('../src/database/apiGenerationDb')).initializeApiGenerationDb()
  const auth = await import('../src/database/authDb')
  auth.initializeAuthDb()
  const images = await import('../src/database/init')
  await images.initializeDatabase()
  const library = await import('../src/services/characterLibrary')
  const batches = await import('../src/services/codex-chat/chatAssetBatches')
  const { ChatGenerationPresetStore } = await import('../src/services/codex-chat/chatGenerationPresets')
  const { PromptPresetModel } = await import('../src/models/PromptPreset')
  const { DEFAULT_EXPRESSION_PRESET_NAME, ensureChatAssetSchema } = await import('../src/database/chatAssetSchema')
  const { GenerationQueueService } = await import('../src/services/generationQueueService')
  const { GenerationQueueModel } = await import('../src/models/GenerationQueue')
  const { requireQueuedChatGenerationAccess } = await import('../src/services/generation-queue/queueJobExecutors')
  const { BackgroundQueueService } = await import('../src/services/backgroundQueue')
  const { MediaPostprocessCoordinator } = await import('../src/services/background-media/mediaPostprocessCoordinator')
  const { skippedStage } = await import('../src/services/background-media/mediaProcessingTypes')
  const { settingsService } = await import('../src/services/settingsService')
  const { ingestProfileAsset } = await import('../src/services/codex-chat/chatProfileAssets')
  const { EmoticonService } = await import('../src/services/emoticonService')
  const expressions = await import('../src/services/codex-chat/chatProfileExpressions')
  t.mock.method(GenerationQueueService, 'requestDispatch', () => {})
  t.mock.method(BackgroundQueueService, 'addMetadataExtractionTask', () => {})
  t.mock.method(MediaPostprocessCoordinator, 'triggerAutoTagProcessing', () => skippedStage('auto-tag', 'test'))
  const baseSettings = settingsService.loadSettings()
  t.mock.method(settingsService, 'loadSettings', () => ({ ...baseSettings, tagger: { ...baseSettings.tagger, enabled: false } }))
  t.after(async () => {
    settings.closeUserSettingsDb()
    auth.getAuthDb().close()
    images.closeDatabase()
    const { logger } = await import('../src/utils/logger')
    await new Promise<void>((resolve) => logger.close(resolve))
    assert.equal(path.dirname(root), os.tmpdir())
    assert.ok(path.basename(root).startsWith('conai-character-library-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const db = settings.getUserSettingsDb()
  const requester = { accountId: null, accountType: 'admin' as const }
  const work = library.createCharacterFolder({ parentId: null, name: 'Work' })
  const character = library.createCharacterFolder({ parentId: work.id, name: 'Character' })
  const setting = library.createCharacterSetting({ folderId: character.id, name: 'Default', appearance: 'blue hair' })
  const libraryRouter = (await import('../src/routes/character-library.routes')).default
  const chatRouter = (await import('../src/routes/codex-chat.routes')).default
  const { chatProfileExpressionsRouter } = await import('../src/routes/chat-asset-batches.routes')
  const { AuthAccessControlService } = await import('../src/services/authAccessControlService')
  async function call(router: any, routePath: string, method: string, params: Record<string, string>, body?: unknown) {
    const route = router.stack.find((layer: any) => layer.route?.path === routePath && layer.route.methods[method])?.route
    assert.ok(route, routePath)
    return new Promise<{ status: number; body: any }>((resolve, reject) => {
      let status = 200, index = 0
      const req = { params, body, query: {}, method: method.toUpperCase(), session: {}, socket: { remoteAddress: '127.0.0.1' }, headers: {} }
      const res = { status(code: number) { status = code; return this }, json(body: unknown) { resolve({ status, body }); return this } }
      const next = (error?: unknown) => {
        if (error) { reject(error); return }
        try { Promise.resolve(route.stack[index++].handle(req, res, next)).catch(reject) } catch (error) { reject(error) }
      }
      next()
    })
  }

  await t.test('case-insensitive siblings, folder cycles and SQL pages', () => {
    assert.throws(() => library.createCharacterFolder({ parentId: null, name: 'work' }), /같은/)
    assert.throws(() => library.createCharacterSetting({ folderId: character.id, name: 'default' }), /같은/)
    assert.throws(() => library.patchCharacterFolder(work.id, { parentId: character.id }), /하위/)
    assert.throws(() => library.patchCharacterFolder(work.id, { parentId: work.id }), /하위/)
    const other = library.createCharacterFolder({ parentId: null, name: 'Other' })
    library.createCharacterFolder({ parentId: other.id, name: 'Character' })
    assert.throws(() => library.patchCharacterFolder(character.id, { parentId: other.id }), /같은/)
    const second = library.createCharacterSetting({ folderId: character.id, name: 'Swimsuit' })
    assert.equal(library.listCharacterFolders().find((folder) => folder.id === character.id)?.settingCount, 2)
    assert.deepEqual(library.getCharacterSetting(setting.id).path, ['Work', 'Character'])
    assert.equal(library.listCharacterSettings({ folderId: character.id, limit: 1 }).hasMore, true)
    assert.deepEqual(library.listCharacterSettings({ query: 'swim' }).items.map((item) => item.id), [second.id])
    assert.equal('appearance' in library.listCharacterSettings().items[0], false)
  })

  await t.test('stale revisions return 409 and current revision from REST', async () => {
    const current = library.patchCharacterSetting(setting.id, { revision: setting.revision, appearance: 'blue hair, red eyes' })
    const result = await call(libraryRouter, '/settings/:settingId', 'patch', { settingId: String(setting.id) }, { revision: setting.revision, name: 'stale' })
    assert.equal(result.status, 409)
    assert.equal(result.body.success, false)
    assert.equal(result.body.revision, current.revision)
    assert.equal(result.body.code, 'revision_conflict')
    const conflict = await call(libraryRouter, '/settings', 'post', {}, { folderId: character.id, name: 'default' })
    assert.equal(conflict.status, 409)
    assert.equal(conflict.body.code, 'name_conflict')
    assert.equal(library.getCharacterSetting(setting.id).name, 'Default')
  })

  await t.test('library names stay literal while image group labels remain path-safe', () => {
    const { GroupPathService } = require('../src/services/groupPathService') as typeof import('../src/services/groupPathService')
    const value = library.createCharacterSetting({ folderId: null, name: ' A/B  C ' })
    const groups = library.ensureCharacterGroups(value.id)
    assert.equal(library.getCharacterSetting(value.id).revision, value.revision)
    assert.equal(library.getCharacterSetting(value.id).name, 'A/B  C')
    assert.equal(GroupPathService.resolve(`캐릭터 라이브러리/A-B C #${value.id}/후보`, { create: false })?.groupId, groups.candidateGroupId)
    const renamed = library.patchCharacterSetting(value.id, { revision: library.getCharacterSetting(value.id).revision, name: 'X\\Y' })
    assert.equal(GroupPathService.resolve(`캐릭터 라이브러리/X-Y #${value.id}/표정`, { create: false })?.groupId, groups.expressionGroupId)
    assert.equal(renamed.name, 'X\\Y')
    assert.throws(() => library.createCharacterFolder({ parentId: null, name: '\nName' }))
    assert.throws(() => library.patchCharacterSetting(value.id, { revision: renamed.revision, name: 'x'.repeat(CHAT_PROFILE_TEXT_LIMITS.name + 1) }))
    // Stale child IDs reconnect to the existing sibling instead of colliding with it.
    db.prepare('UPDATE character_settings SET expression_group_id = NULL, candidate_group_id = NULL WHERE id = ?').run(value.id)
    assert.deepEqual(library.ensureCharacterGroups(value.id), groups)
  })

  await t.test('REST hash writes need images.view before looking up an image', async (sub) => {
    const access = AuthAccessControlService.resolveBootstrapAccess()
    sub.mock.method(AuthAccessControlService, 'resolveBootstrapAccess', () => ({ ...access, permissionKeys: access.permissionKeys.filter((key) => key !== 'images.view') }))
    const current = library.getCharacterSetting(setting.id)
    const created = await call(libraryRouter, '/settings', 'post', {}, { folderId: null, name: 'Forbidden hash', referenceHash: 'not-an-image' })
    assert.equal(created.status, 403)
    assert.match(created.body.error, /images.view/)
    const patched = await call(libraryRouter, '/settings/:settingId', 'patch', { settingId: String(setting.id) }, { revision: current.revision, avatarHash: 'not-an-image' })
    assert.equal(patched.status, 403)
    assert.equal(library.getCharacterSetting(setting.id).revision, current.revision)
    for (const key of ['referenceHash', 'avatarHash', 'avatarCrop']) {
      assert.equal((await call(libraryRouter, '/settings', 'post', {}, { folderId: null, name: 'No image', [key]: null })).status, 403)
      assert.equal((await call(libraryRouter, '/settings/:settingId', 'patch', { settingId: String(setting.id) }, { revision: current.revision, [key]: null })).status, 403)
    }
    assert.equal((await call(libraryRouter, '/settings', 'post', {}, { folderId: null, name: 'No image' })).status, 201)
  })

  await t.test('setting uploads require characters.edit, validate IDs and do not create groups on invalid URL', async (sub) => {
    for (const endpoint of ['upload', 'url', 'from-file-store']) {
      const response = await call(chatRouter, `/admin/chat-assets/${endpoint}`, 'post', {}, { settingId: 999999, url: 'invalid' })
      assert.equal(response.status, 404, endpoint)
      assert.equal((await call(chatRouter, `/admin/chat-assets/${endpoint}`, 'post', {}, { settingId: 'invalid' })).status, 400, endpoint)
    }
    const before = library.characterSettingRow(setting.id)
    assert.equal((await call(chatRouter, '/admin/chat-assets/url', 'post', {}, { settingId: setting.id, url: 'invalid' })).status, 400)
    assert.deepEqual(library.characterSettingRow(setting.id), before)
    const access = AuthAccessControlService.resolveBootstrapAccess()
    sub.mock.method(AuthAccessControlService, 'resolveBootstrapAccess', () => ({ ...access, permissionKeys: access.permissionKeys.filter((key) => key !== 'characters.edit') }))
    for (const endpoint of ['upload', 'url', 'from-file-store']) {
      const response = await call(chatRouter, `/admin/chat-assets/${endpoint}`, 'post', {}, { settingId: setting.id })
      assert.equal(response.status, 403, endpoint)
      assert.match(response.body.error, /characters.edit/)
    }
  })

  await t.test('setting batch reference/avatar/expressions apply atomically and retain ID-owned groups', async () => {
    const beforeImport = library.getCharacterSetting(setting.id).revision
    const { subscribeToRuntimeEvents } = await import('../src/services/runtime-events/runtimeEventBus')
    const events: string[] = []
    const unsubscribe = subscribeToRuntimeEvents((event) => events.push(event.name))
    const reference = (await ingestProfileAsset(await sharp({ create: { width: 16, height: 16, channels: 3, background: '#41aabc' } }).png().toBuffer(), '', setting.id)).compositeHash
    unsubscribe()
    assert.equal(library.getCharacterSetting(setting.id).revision, beforeImport)
    assert.equal(events.includes('characters.changed'), false)
    const candidate = (await ingestProfileAsset(await sharp({ create: { width: 16, height: 16, channels: 3, background: '#bc4a80' } }).png().toBuffer(), '', setting.id)).compositeHash
    const owner = { kind: 'setting' as const, id: setting.id }
    const preset = ChatGenerationPresetStore.create({ name: 'Setting assets', kind: 'nai', nai: { characterReference: 'none' } })
    const expressionPreset = PromptPresetModel.findByName(DEFAULT_EXPRESSION_PRESET_NAME)!
    const input = { idempotencyKey: 'setting-assets', presetId: preset.id, expressionPresetId: expressionPreset.id, expressions: ['기쁨'], slots: [{ slotKey: 'reference', kind: 'reference', prompt: 'portrait' }, { slotKey: 'avatar', kind: 'avatar', prompt: 'face' }] }
    let batch = await batches.createChatAssetBatch(requester, owner, input)
    assert.deepEqual(batch.owner, owner)
    assert.equal(batch.snapshot.appearance, 'blue hair, red eyes')
    function finish(value: ChatAssetBatch, key: string, hash: string) {
      const jobId = value.slots.find((slot) => slot.slotKey === key)!.attempts.at(-1)!.jobId
      const job = GenerationQueueModel.findById(jobId)!
      requireQueuedChatGenerationAccess(job)
      assert.equal(job.requested_group_id, library.getCharacterSetting(setting.id).candidateGroupId)
      db.prepare("UPDATE generation_queue_jobs SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?").run(jobId)
      db.prepare("INSERT INTO api_generation_history(service_type, generation_status, composite_hash, queue_job_id) VALUES ('novelai', 'completed', ?, ?)").run(hash, jobId)
    }
    finish(batch, 'reference', reference)
    batch = await batches.chooseChatAssetSlot(requester, batch.id, 'reference', reference)
    finish(batch, 'avatar', candidate)
    finish(batch, '기쁨', candidate)
    await batches.chooseChatAssetSlot(requester, batch.id, 'avatar', candidate)
    await batches.chooseChatAssetSlot(requester, batch.id, '기쁨', candidate)
    const before = library.getCharacterSetting(setting.id)
    const crop = { x: 50, y: 50, scale: 1.5 }
    const result = batches.applyChatAssetBatch(requester, batch.id, { avatarCrop: crop })
    const after = library.getCharacterSetting(setting.id)
    assert.deepEqual(result.owner, owner)
    assert.equal(after.revision, before.revision + 1)
    assert.equal(after.referenceHash, reference)
    assert.equal(after.avatarHash, candidate)
    assert.deepEqual(after.avatarCrop, crop)
    assert.equal(EmoticonService.listEntries(after.expressionGroupId!).find((entry) => entry.keywords.includes('기쁨'))?.compositeHash, candidate)
    const absentHash = await call(chatProfileExpressionsRouter, '/:name', 'put', { settingId: String(setting.id), name: '기쁨' }, {})
    assert.equal(absentHash.status, 400)
    assert.equal(library.getCharacterSetting(setting.id).revision, after.revision)
    assert.equal(EmoticonService.listEntries(after.expressionGroupId!).find((entry) => entry.keywords.includes('기쁨'))?.compositeHash, candidate)
    assert.equal(library.getCharacterSetting(setting.id, false).referenceHash, null)
    assert.equal(library.listCharacterSettings({}, false).items.find((item) => item.id === setting.id)?.avatarHash, null)
    expressions.setProfileExpression(requester, owner, '슬픔', reference)
    assert.equal(library.getCharacterSetting(setting.id).revision, after.revision + 1)
    const cleared = await call(chatProfileExpressionsRouter, '/:name', 'delete', { settingId: String(setting.id), name: '슬픔' })
    assert.equal(cleared.status, 200)
    assert.equal(cleared.body.data.setting.revision, after.revision + 2)
    assert.equal(library.getCharacterSetting(setting.id).revision, after.revision + 2)
    const repeated = await call(chatProfileExpressionsRouter, '/:name', 'delete', { settingId: String(setting.id), name: '슬픔' })
    assert.equal(repeated.body.data.setting.revision, after.revision + 2)
    const renamed = library.patchCharacterSetting(setting.id, { revision: after.revision + 2, name: 'Renamed' })
    assert.equal(renamed.expressionGroupId, after.expressionGroupId)
    const groupId = library.characterSettingRow(setting.id).asset_group_id!
    assert.equal((images.db.prepare('SELECT name FROM groups WHERE id = ?').get(groupId) as any).name, `Renamed #${setting.id}`)
    await assert.rejects(batches.createChatAssetBatch(requester, owner, { idempotencyKey: 'background', presetId: preset.id, slots: [{ slotKey: 'background', kind: 'background', prompt: 'city' }] }), /배경/)
    assert.throws(() => batches.validateChatAssetBatchProposal(requester, owner, { idempotencyKey: 'background', presetId: preset.id, slots: [{ slotKey: 'background', kind: 'background', prompt: 'city' }] }), /배경/)
    assert.throws(() => batches.getChatAssetBatch(requester, batch.id, { kind: 'profile', id: setting.id }), /찾을/)
  })

  await t.test('MCP catalog reads and proposals preserve the human save boundary', async (sub) => {
    const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
    const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
    const { ChatProposalStore } = await import('../src/services/codex-chat/chatProposals')
    const { registerChatReply } = await import('../src/services/codex-chat/chatReplyRegistry')
    const { openChatMcpBridge } = await import('../src/services/codex-chat/chatMcpBridge')
    ;(await import('../src/services/codex-chat/chatSettings')).updateChatSettings({ enabled: true })
    ;(await import('../src/models/ExternalApiProvider')).ExternalApiProvider.create({ provider_name: 'library-test', display_name: 'Library test', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
    const profile = ChatProfileStore.create({ name: 'Library assistant', engine: 'llm', providerName: 'library-test', mcpEnabled: true, mcpScopes: ['read', 'organize', 'configure'] })
    const threadId = CodexChatStore.createThread(null, 'library', 'llm', profile.id)
    const context = { threadId, profileId: profile.id, kind: 'direct' as const, replyId: 'library-proposals' }
    const close = registerChatReply(context, new AbortController().signal, () => ({ replyTo: null, recipients: ['user'] }))
    const bridge = await openChatMcpBridge(requester, ['read', 'organize', 'configure'], null, { chatContext: context })
    const data = (result: { content?: unknown[]; isError?: boolean }) => {
      assert.notEqual(result.isError, true, JSON.stringify(result))
      return JSON.parse(String((result.content?.[0] as { text?: string }).text))
    }
    try {
      assert.ok(bridge.catalogTools.has('list_character_library'))
      assert.notEqual((await bridge.call('open_tools', { category: 'characters' })).isError, true)
      const listing = data(await bridge.call('list_character_library', { folder_id: character.id }))
      assert.deepEqual(listing.path.map((entry: { name: string }) => entry.name), ['Work', 'Character'])
      assert.equal('appearance' in listing.settings.items[0], false)
      const current = data(await bridge.call('get_character_setting', { setting_id: setting.id }))
      assert.ok(current.expressions['기쁨'])
      const proposed = data(await bridge.call('propose_character_library', { action: 'save_setting', setting_id: setting.id, revision: current.revision, input: { appearance: 'proposed only' } }))
      assert.equal(ChatProposalStore.find(proposed.proposalId)?.kind, 'character_library')
      assert.equal(library.getCharacterSetting(setting.id).appearance, 'blue hair, red eyes')
      assert.equal((await bridge.call('propose_character_library', { action: 'save_setting', setting_id: setting.id, revision: current.revision - 1, input: { appearance: 'stale' } })).isError, true)
      const preset = ChatGenerationPresetStore.create({ name: 'Proposal assets', kind: 'nai', nai: { characterReference: 'none' } })
      const before = (db.prepare('SELECT COUNT(*) n FROM chat_asset_batches').get() as { n: number }).n
      const asset = data(await bridge.call('propose_profile_assets', { setting_id: setting.id, input: { presetId: preset.id, slots: [{ slotKey: 'reference', kind: 'reference', prompt: 'portrait' }] } }))
      assert.equal(ChatProposalStore.find(asset.proposalId)?.kind, 'character_assets')
      assert.equal((db.prepare('SELECT COUNT(*) n FROM chat_asset_batches').get() as { n: number }).n, before)
      ChatProfileStore.update(profile.id, { characterLink: { settingId: setting.id, synced: true } })
      const latest = data(await bridge.call('get_asset_batch', {}))
      assert.deepEqual(latest.owner, { kind: 'setting', id: setting.id })
      assert.equal(latest.id, batches.latestChatAssetBatchId({ kind: 'setting', id: setting.id }))
      ChatProfileStore.update(profile.id, { characterLink: null })
      const access = AuthAccessControlService.resolveBootstrapAccess()
      sub.mock.method(AuthAccessControlService, 'resolveBootstrapAccess', () => ({ ...access, permissionKeys: access.permissionKeys.filter((key) => key !== 'images.view') }))
      const denied = await bridge.call('propose_character_library', { action: 'save_setting', setting_id: setting.id, revision: current.revision, input: { referenceHash: 'not-an-image' } })
      assert.equal(denied.isError, true)
      assert.match(JSON.stringify(denied), /images.view/)
      for (const key of ['referenceHash', 'avatarHash', 'avatarCrop']) {
        const clear = await bridge.call('propose_character_library', { action: 'save_setting', setting_id: setting.id, revision: current.revision, input: { [key]: null } })
        assert.equal(clear.isError, true)
        assert.match(JSON.stringify(clear), /images.view/)
      }
    } finally { close(); await bridge.close() }
  })

  await t.test('synced MCP background proposals stay profile-owned and old mixed batches remain readable', async () => {
    const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
    const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
    const { registerChatReply } = await import('../src/services/codex-chat/chatReplyRegistry')
    const { openChatMcpBridge } = await import('../src/services/codex-chat/chatMcpBridge')
    const { applyProfileAssetsProposal } = await import('../src/services/codex-chat/chatAssetProposals')
    const assetRouter = (await import('../src/routes/chat-asset-batches.routes')).default
    const source = library.getCharacterSetting(setting.id)
    const profile = ChatProfileStore.create({ name: 'Background cards', engine: 'llm', providerName: 'library-test', referenceHash: source.referenceHash, mcpEnabled: true, mcpScopes: ['configure'] })
    const preset = ChatGenerationPresetStore.create({ name: 'Background cards preset', kind: 'nai', nai: { characterReference: 'none' } })
    const mixed = await batches.createChatAssetBatch(requester, profile.id, { idempotencyKey: 'mixed-before-sync', presetId: preset.id, slots: [{ slotKey: 'avatar', kind: 'avatar', prompt: 'face' }, { slotKey: 'background', kind: 'background', prompt: 'garden' }] })
    ChatProfileStore.update(profile.id, { characterLink: { settingId: setting.id, synced: true } })
    const response = await call(assetRouter, '/:batchId', 'get', { profileId: String(profile.id), batchId: String(mixed.id) })
    assert.equal(response.status, 200)
    assert.deepEqual(response.body.data.owner, { kind: 'profile', id: profile.id })
    assert.throws(() => batches.applyChatAssetBatch(requester, mixed.id), (error: any) => error.status === 409)
    const threadId = CodexChatStore.createThread(null, 'background cards', 'llm', profile.id)
    let context = { threadId, profileId: profile.id, kind: 'direct' as const, replyId: 'background-create' }
    let close = registerChatReply(context, new AbortController().signal, () => ({ replyTo: null, recipients: ['user'] }))
    let bridge = await openChatMcpBridge(requester, ['configure'], null, { chatContext: context })
    try {
      const read = await bridge.call('get_asset_batch', { profile_id: profile.id, batch_id: mixed.id })
      assert.notEqual(read.isError, true, JSON.stringify(read))
      const proposalResult = await bridge.call('propose_profile_assets', { profile_id: profile.id, input: { presetId: preset.id, slots: [{ slotKey: 'background', kind: 'background', prompt: 'garden' }] } })
      assert.notEqual(proposalResult.isError, true, JSON.stringify(proposalResult))
      const proposal = (proposalResult.structuredContent as any).proposal
      assert.equal(proposal.kind, 'profile_assets')
      assert.equal(proposal.profileId, profile.id)
      const approved = await applyProfileAssetsProposal(requester, proposal.id)
      assert.ok('batch' in approved)
      const batch = approved.batch!
      assert.deepEqual(batch.owner, { kind: 'profile', id: profile.id })
      const jobId = batch.slots[0].attempts[0].jobId
      db.prepare("UPDATE generation_queue_jobs SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?").run(jobId)
      db.prepare("INSERT INTO api_generation_history(service_type, generation_status, composite_hash, queue_job_id) VALUES ('novelai', 'completed', ?, ?)").run(source.avatarHash, jobId)
      close(); await bridge.close()
      context = { ...context, replyId: 'background-apply' }
      close = registerChatReply(context, new AbortController().signal, () => ({ replyTo: null, recipients: ['user'] }))
      bridge = await openChatMcpBridge(requester, ['configure'], null, { chatContext: context })
      assert.notEqual((await bridge.call('get_asset_batch', { profile_id: profile.id, batch_id: batch.id })).isError, true)
      const application = await bridge.call('propose_profile_assets', { action: 'apply', profile_id: profile.id, batch_id: batch.id, picks: { background: source.avatarHash } })
      assert.notEqual(application.isError, true, JSON.stringify(application))
      const card = (application.structuredContent as any).proposal
      assert.equal(card.kind, 'profile_assets')
      await applyProfileAssetsProposal(requester, card.id)
      assert.equal(ChatProfileStore.find(profile.id)?.backgroundHash, source.avatarHash)
      assert.equal(ChatProfileStore.find(profile.id)?.characterLink?.synced, true)
    } finally {
      close(); await bridge.close()
      ChatProfileStore.update(profile.id, { characterLink: null })
    }
  })

  await t.test('profile sync, detach, library save and deletion preserve local values and expression ownership', async () => {
    const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
    const { chatExpressionGroupId } = await import('../src/services/codex-chat/chatEmoticons')
    const { profileAssetFields } = await import('../src/services/codex-chat/chatProfileAssets')
    const { buildProfileUpdateProposal, buildProfileProposal } = await import('../src/mcp/tools/chatSetupTools')
    const { subscribeToRuntimeEvents } = await import('../src/services/runtime-events/runtimeEventBus')
    const source = library.getCharacterSetting(setting.id)
    let look = library.createCharacterSetting({ folderId: null, name: 'Linked look', appearance: 'silver hair', referenceHash: source.referenceHash, avatarHash: source.avatarHash, avatarCrop: { x: 10, y: 20, scale: 2 } })
    expressions.setProfileExpression(requester, { kind: 'setting', id: look.id }, 'happy', source.avatarHash)
    look = library.getCharacterSetting(look.id)
    const profile = ChatProfileStore.create({ name: 'Linked profile', engine: 'codex', appearance: 'local appearance', referenceHash: source.avatarHash, avatarHash: source.referenceHash })
    expressions.setProfileExpression(requester, profile.id, 'local', source.referenceHash)
    const ownGroup = expressions.expressionGroupId(profile)!
    const local = () => db.prepare('SELECT appearance, reference_hash, avatar_hash, avatar_crop FROM llm_chat_profiles WHERE id = ?').get(profile.id)
    const before = local()
    const preset = ChatGenerationPresetStore.create({ name: 'Linked test assets', kind: 'nai', nai: { characterReference: 'none' } })
    const input = { idempotencyKey: 'before-link', presetId: preset.id, slots: [{ slotKey: 'reference', kind: 'reference', prompt: 'portrait' }] }
    const oldBatch = await batches.createChatAssetBatch(requester, profile.id, input)
    const events: any[] = []
    const unsubscribe = subscribeToRuntimeEvents((event) => { if (event.name === 'characters.changed') events.push(event.payload) })
    try {
      const linked = ChatProfileStore.update(profile.id, { characterLink: { settingId: look.id, synced: true }, appearance: 'ignored', referenceHash: 'invalid-but-ignored' })!
      assert.equal(linked.appearance, look.appearance)
      assert.equal(linked.referenceHash, look.referenceHash)
      assert.equal(linked.avatarHash, look.avatarHash)
      assert.deepEqual(linked.avatarCrop, look.avatarCrop)
      assert.equal(linked.avatar, null)
      assert.equal(linked.characterLink?.linkedProfileCount, 1)
      assert.equal(chatExpressionGroupId(linked), look.expressionGroupId)
      assert.equal(linked.style.emoticonGroupIds[0], look.expressionGroupId)
      assert.equal(linked.style.emoticonGroupIds.includes(ownGroup), false)
      assert.deepEqual(local(), before)
      ChatProfileStore.update(profile.id, { tagline: 'unrelated' })
      assert.deepEqual(local(), before)
      for (const projection of [{}, { directory: true }, { admin: true }]) {
        const listed = ChatProfileStore.list(projection).find((entry) => entry.id === profile.id)!
        assert.equal(listed.appearance, look.appearance)
        assert.equal(chatExpressionGroupId(listed), look.expressionGroupId)
      }
      assert.equal(ChatProfileStore.draft({ name: profile.name, engine: 'codex', characterLink: { settingId: look.id, synced: true } }, profile.id).appearance, look.appearance)
      const version = profileAssetFields(linked, true).assetVersion
      look = library.patchCharacterSetting(look.id, { revision: look.revision, appearance: 'gold hair' })
      assert.notEqual(profileAssetFields(ChatProfileStore.find(profile.id)!, true).assetVersion, version)
      assert.ok(events.at(-1).profileIds.includes(profile.id))
      assert.equal(library.getCharacterSetting(look.id).linkedProfiles[0].id, profile.id)
      assert.equal(library.listCharacterSettings().items.find((entry) => entry.id === look.id)?.linkedProfileCount, 1)
      assert.throws(() => buildProfileUpdateProposal({ profile_id: profile.id, patch: { appearance: 'wrong' } }, undefined), /propose_character_library/)
      assert.throws(() => buildProfileProposal({ name: 'Proposal', system_prompt: '', appearance: 'wrong', settings: { characterLink: { settingId: look.id, synced: true } } }), /propose_character_library/)
      assert.throws(() => ChatProfileStore.update(profile.id, { characterLink: { settingId: 999999, synced: true } }), /찾을/)
      await assert.rejects(batches.createChatAssetBatch(requester, profile.id, { ...input, idempotencyKey: 'synced' }), (error: any) => error.status === 409)
      assert.throws(() => batches.applyChatAssetBatch(requester, oldBatch.id), (error: any) => error.status === 409)
      assert.throws(() => expressions.setProfileExpression(requester, profile.id, 'happy', source.avatarHash), (error: any) => error.status === 409)
      assert.throws(() => expressions.clearProfileExpression(requester, profile.id, 'happy'), (error: any) => error.status === 409)

      const background = await batches.createChatAssetBatch(requester, profile.id, { idempotencyKey: 'synced-background', presetId: preset.id, slots: [{ slotKey: 'background', kind: 'background', prompt: 'garden' }] })
      const backgroundJob = background.slots[0].attempts[0].jobId
      requireQueuedChatGenerationAccess(GenerationQueueModel.findById(backgroundJob)!)
      db.prepare("UPDATE generation_queue_jobs SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?").run(backgroundJob)
      db.prepare("INSERT INTO api_generation_history(service_type, generation_status, composite_hash, queue_job_id) VALUES ('novelai', 'completed', ?, ?)").run(source.referenceHash, backgroundJob)
      await batches.regenerateChatAssetSlot(requester, background.id, 'background', { attempt: 2 })
      await batches.cancelChatAssetSlot(requester, background.id, 'background')
      await batches.chooseChatAssetSlot(requester, background.id, 'background', source.referenceHash)
      batches.applyChatAssetBatch(requester, background.id)
      assert.equal(ChatProfileStore.find(profile.id)?.backgroundHash, source.referenceHash)
      assert.equal(ChatProfileStore.find(profile.id)?.avatarHash, look.avatarHash)

      const syncedCopy = ChatProfileStore.create({ name: 'Copy effective expressions', engine: 'codex', characterLink: { settingId: look.id, synced: true } })
      const fromSynced = library.saveCharacterSettingFromProfile({ mode: 'create', profileId: syncedCopy.id, folderId: null, name: 'Effective expression copy', appearance: look.appearance, referenceHash: look.referenceHash, avatarHash: look.avatarHash, avatarCrop: look.avatarCrop }, true)
      assert.deepEqual(EmoticonService.listEntries(fromSynced.expressionGroupId!).flatMap((entry) => entry.keywords), ['happy'])
      assert.ok(events.at(-1).settingIds.includes(look.id))
      assert.ok(events.at(-1).settingIds.includes(fromSynced.id))
      ChatProfileStore.delete(syncedCopy.id)
      assert.ok(events.at(-1).settingIds.includes(fromSynced.id))
      assert.equal(library.getCharacterSetting(fromSynced.id).linkedProfileCount, 0)

      const detached = ChatProfileStore.update(profile.id, { characterLink: { settingId: look.id, synced: false }, appearance: 'detached override' })!
      assert.equal(detached.characterLink?.synced, false)
      assert.equal(detached.appearance, 'detached override')
      assert.equal(detached.avatarHash, look.avatarHash)
      assert.equal(chatExpressionGroupId(detached), ownGroup)
      assert.equal(EmoticonService.listEntries(ownGroup).find((entry) => entry.keywords.includes('happy'))?.compositeHash, source.avatarHash)
      assert.equal(EmoticonService.listEntries(ownGroup).some((entry) => entry.keywords.includes('local')), false)
      assert.equal(library.getCharacterSetting(look.id).linkedProfileCount, 0)
      expressions.clearProfileExpression(requester, profile.id, 'happy')
      expressions.setProfileExpression(requester, profile.id, 'sad', source.referenceHash)
      const values = { profileId: profile.id, appearance: detached.appearance, referenceHash: detached.referenceHash, avatarHash: detached.avatarHash, avatarCrop: detached.avatarCrop }
      const stale = await call(libraryRouter, '/settings/from-profile', 'post', {}, { ...values, mode: 'overwrite', settingId: look.id, revision: look.revision - 1 })
      assert.equal(stale.status, 409)
      assert.equal(stale.body.code, 'revision_conflict')
      const saved = await call(libraryRouter, '/settings/from-profile', 'post', {}, { ...values, mode: 'overwrite', settingId: look.id, revision: look.revision })
      assert.equal(saved.status, 200)
      assert.equal(saved.body.data.linkedProfileCount, 1)
      assert.equal(ChatProfileStore.find(profile.id)?.characterLink?.synced, true)
      assert.deepEqual(EmoticonService.listEntries(saved.body.data.expressionGroupId).flatMap((entry) => entry.keywords), ['sad'])
      assert.equal(library.previewCharacterDelete('setting', look.id).linkedProfiles[0].id, profile.id)
      assert.throws(() => library.deleteCharacterLibrary('setting', look.id, look.revision), (error: any) => error.code === 'revision_conflict')
      library.deleteCharacterLibrary('setting', look.id, saved.body.data.revision)
      const unlinked = ChatProfileStore.find(profile.id)!
      assert.equal(unlinked.characterLink, null)
      assert.equal(unlinked.appearance, detached.appearance)
      assert.equal(unlinked.avatarHash, detached.avatarHash)
      assert.equal(chatExpressionGroupId(unlinked), ownGroup)
      assert.ok(events.at(-1).profileIds.includes(profile.id))
      const created = await call(libraryRouter, '/settings/from-profile', 'post', {}, { ...values, mode: 'create', folderId: null, name: 'From profile' })
      assert.equal(created.status, 200)
      assert.equal(ChatProfileStore.find(profile.id)?.characterLink?.settingId, created.body.data.id)
      assert.deepEqual(EmoticonService.listEntries(created.body.data.expressionGroupId).flatMap((entry) => entry.keywords), ['sad'])
      // Unlink from B copies, and deleting a detached origin only removes that origin.
      ChatProfileStore.update(profile.id, { characterLink: null })
      assert.equal(ChatProfileStore.find(profile.id)?.appearance, values.appearance)
      ChatProfileStore.update(profile.id, { characterLink: { settingId: created.body.data.id, synced: false }, appearance: 'private' })
      library.deleteCharacterLibrary('setting', created.body.data.id)
      assert.equal(ChatProfileStore.find(profile.id)?.appearance, 'private')
      assert.equal(ChatProfileStore.find(profile.id)?.characterLink, null)
    } finally { unsubscribe() }
  })

  await t.test('profile copies keep the link their draft chose; an unspecified link follows the source', async () => {
    const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
    const look = library.createCharacterSetting({ folderId: null, name: 'Copy look', appearance: 'copy hair' })
    const source = ChatProfileStore.create({ name: 'Copy source', engine: 'codex' })
    const linked = await call(chatRouter, '/admin/profiles', 'post', {}, { name: 'Linked copy', engine: 'codex', copyOf: source.id, characterLink: { settingId: look.id, synced: true } })
    assert.equal(linked.status, 201, JSON.stringify(linked.body))
    assert.deepEqual([linked.body.data.characterLink?.settingId, linked.body.data.characterLink?.synced, linked.body.data.appearance], [look.id, true, 'copy hair'])
    const inherited = await call(chatRouter, '/admin/profiles', 'post', {}, { name: 'Inherited copy', engine: 'codex', copyOf: linked.body.data.id })
    assert.deepEqual([inherited.body.data.characterLink?.settingId, inherited.body.data.characterLink?.synced], [look.id, true])
  })

  await t.test('synced effective styles round-trip without persisting settings or losing local memberships', async () => {
    const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
    const { MAX_EMOTICON_GROUPS, normalizeChatStyle } = await import('../src/services/codex-chat/chatStyle')
    const source = library.getCharacterSetting(setting.id)
    const x = library.createCharacterSetting({ folderId: null, name: 'Style X' })
    const y = library.createCharacterSetting({ folderId: null, name: 'Style Y' })
    expressions.setProfileExpression(requester, { kind: 'setting', id: x.id }, 'x', source.referenceHash)
    expressions.setProfileExpression(requester, { kind: 'setting', id: y.id }, 'y', source.avatarHash)
    const xGroup = library.getCharacterSetting(x.id).expressionGroupId!
    const yGroup = library.getCharacterSetting(y.id).expressionGroupId!
    const other = Array.from({ length: MAX_EMOTICON_GROUPS }, (_, index) => Number(images.db.prepare('INSERT INTO groups(name) VALUES (?)').run(`Extra style ${index}`).lastInsertRowid))
    const profile = ChatProfileStore.create({ name: 'Style round trip', engine: 'codex' })
    expressions.setProfileExpression(requester, profile.id, 'own', source.referenceHash)
    const own = expressions.expressionGroupId(profile)!
    images.db.prepare('UPDATE groups SET name = ? WHERE id = (SELECT parent_id FROM groups WHERE id = ?)').run(' style ROUND trip ', own)
    images.db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(' 표정 ', own)
    const storedIds = [...other.slice(0, 4), own, ...other.slice(4, MAX_EMOTICON_GROUPS - 1)]
    ChatProfileStore.update(profile.id, { style: { ...profile.style, emoticonGroupIds: storedIds } })
    let linked = ChatProfileStore.update(profile.id, { characterLink: { settingId: x.id, synced: true } })!
    for (const options of [{}, { directory: true }, { admin: true }]) {
      assert.deepEqual(ChatProfileStore.list(options).find((entry) => entry.id === profile.id)!.style.emoticonGroupIds, linked.style.emoticonGroupIds)
    }
    const localIds = (id: number) => normalizeChatStyle((db.prepare('SELECT chat_style FROM llm_chat_profiles WHERE id = ?').get(id) as { chat_style: string }).chat_style).emoticonGroupIds
    ChatProfileStore.update(profile.id, { style: linked.style })
    assert.deepEqual(localIds(profile.id), storedIds)
    linked = ChatProfileStore.update(profile.id, { characterLink: { settingId: y.id, synced: true }, style: linked.style })!
    assert.equal(linked.style.emoticonGroupIds.includes(xGroup), false)
    assert.equal(linked.style.emoticonGroupIds[0], yGroup)
    assert.deepEqual(localIds(profile.id), storedIds)
    const detached = ChatProfileStore.update(profile.id, { characterLink: null, style: linked.style })!
    assert.equal(detached.style.emoticonGroupIds[0], own)
    assert.equal(detached.style.emoticonGroupIds.includes(xGroup), false)
    assert.equal(detached.style.emoticonGroupIds.includes(yGroup), false)
    assert.deepEqual(new Set(detached.style.emoticonGroupIds), new Set(storedIds))
    const full = ChatProfileStore.create({ name: 'No own style', engine: 'codex', style: { ...profile.style, emoticonGroupIds: other } })
    const effective = ChatProfileStore.update(full.id, { characterLink: { settingId: x.id, synced: true } })!
    assert.equal(effective.style.emoticonGroupIds.length, MAX_EMOTICON_GROUPS)
    ChatProfileStore.update(full.id, { style: effective.style })
    assert.deepEqual(localIds(full.id), other, 'the hidden last local group survives an effective-style save')
    const created = ChatProfileStore.create({ name: 'Created synced style', engine: 'codex', characterLink: { settingId: x.id, synced: true }, style: effective.style })
    assert.equal(localIds(created.id).includes(xGroup), false)
    const before = db.prepare('SELECT * FROM llm_chat_profiles WHERE id = ?').get(full.id)
    const groupsBefore = images.db.prepare('SELECT COUNT(*) AS n FROM groups').get()
    for (const characterLink of [{ settingId: x.id, synced: false }, null]) {
      assert.throws(() => ChatProfileStore.update(full.id, { characterLink, style: effective.style }), /상한/)
      assert.deepEqual(db.prepare('SELECT * FROM llm_chat_profiles WHERE id = ?').get(full.id), before)
      assert.deepEqual(images.db.prepare('SELECT COUNT(*) AS n FROM groups').get(), groupsBefore)
    }
    assert.throws(() => ChatProfileStore.create({ name: 'Rejected full detached', engine: 'codex', characterLink: { settingId: x.id, synced: false }, style: { ...profile.style, emoticonGroupIds: other } }), /상한/)
    assert.equal(db.prepare("SELECT 1 FROM llm_chat_profiles WHERE name = 'Rejected full detached'").get(), undefined)
    assert.deepEqual(images.db.prepare('SELECT COUNT(*) AS n FROM groups').get(), groupsBefore)
    library.deleteCharacterLibrary('setting', x.id)
    assert.equal(ChatProfileStore.find(full.id)?.characterLink, null)
    assert.deepEqual(localIds(full.id), other)
    assert.equal(ChatProfileStore.find(full.id)?.style.emoticonGroupIds.includes(expressions.expressionGroupId(full)!), false)
  })

  await t.test('missing setting image files cannot block detach, creation or setting deletion', async () => {
    const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
    const { activeMediaFile, chatMediaUsage } = await import('../src/services/codex-chat/chatCardAssets')
    const hash = (await ingestProfileAsset(await sharp({ create: { width: 16, height: 16, channels: 3, background: '#12c519' } }).png().toBuffer(), 'Missing file')).compositeHash
    const look = library.createCharacterSetting({ folderId: null, name: 'Missing file look', referenceHash: hash, avatarHash: hash })
    const detach = ChatProfileStore.create({ name: 'Missing detach', engine: 'codex', characterLink: { settingId: look.id, synced: true } })
    const deletion = ChatProfileStore.create({ name: 'Missing deletion', engine: 'codex', characterLink: { settingId: look.id, synced: true } })
    assert.ok(chatMediaUsage([hash]).profiles.includes('캐릭터 라이브러리 / Missing file look'))
    fs.unlinkSync(activeMediaFile(hash)!.path)
    assert.throws(() => ChatProfileStore.update(detach.id, { characterLink: { settingId: look.id, synced: false }, referenceHash: hash }), /이미지/)
    const detached = ChatProfileStore.update(detach.id, { characterLink: { settingId: look.id, synced: false } })!
    assert.equal(detached.referenceHash, null)
    assert.equal(detached.avatarHash, null)
    const created = ChatProfileStore.create({ name: 'Missing create', engine: 'codex', characterLink: { settingId: look.id, synced: false } })
    assert.equal(created.referenceHash, null)
    library.deleteCharacterLibrary('setting', look.id)
    assert.equal(ChatProfileStore.find(deletion.id)?.characterLink, null)
    assert.equal(ChatProfileStore.find(deletion.id)?.referenceHash, null)
  })

  await t.test('subtree deletion counts, cascades batches and never removes media groups', () => {
    const groupId = library.characterSettingRow(setting.id).asset_group_id!
    const top = library.createCharacterSetting({ folderId: null, name: 'Top' })
    assert.deepEqual(library.previewCharacterDelete('folder', work.id), { folders: 2, settings: 2, linkedProfileCount: 0, linkedProfiles: [] })
    assert.deepEqual(library.deleteCharacterLibrary('folder', work.id), { deletedFolders: 2, deletedSettings: 2 })
    assert.throws(() => library.getCharacterSetting(setting.id), /찾을/)
    assert.equal(library.getCharacterSetting(top.id).name, 'Top')
    assert.ok(images.db.prepare('SELECT 1 FROM groups WHERE id = ?').get(groupId))
    assert.equal((db.prepare('SELECT COUNT(*) n FROM chat_asset_batches WHERE setting_id = ?').get(setting.id) as any).n, 0)
  })

  await t.test('legacy migration preserves profile batches, child attempts, timestamps, request uniqueness and sequence', () => {
    const old = new Database(':memory:')
    try {
      old.pragma('foreign_keys = ON')
      old.exec(`
        CREATE TABLE llm_chat_profiles(id INTEGER PRIMARY KEY);
        INSERT INTO llm_chat_profiles VALUES (7);
        CREATE TABLE user_preferences(key TEXT PRIMARY KEY, value TEXT);
        INSERT INTO user_preferences VALUES ('chat_expression_preset_seeded', '1');
        CREATE TABLE chat_asset_batches(id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER, profile_id INTEGER NOT NULL REFERENCES llm_chat_profiles(id) ON DELETE CASCADE, preset_id INTEGER NOT NULL, snapshot TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
        CREATE UNIQUE INDEX idx_chat_asset_batches_request ON chat_asset_batches(COALESCE(account_id, 0), profile_id, json_extract(snapshot, '$.requestKey'));
        CREATE TABLE chat_asset_slots(batch_id INTEGER REFERENCES chat_asset_batches(id) ON DELETE CASCADE, slot_key TEXT, kind TEXT, prompt TEXT, attempts TEXT, chosen_hash TEXT, PRIMARY KEY(batch_id, slot_key));
        INSERT INTO chat_asset_batches VALUES (42, NULL, 7, 3, '{"requestKey":"old","appearance":"blue hair"}', '2026-01-01');
        INSERT INTO chat_asset_slots VALUES (42, 'avatar', 'avatar', 'face', '[{"jobId":9}]', 'candidate');
        UPDATE sqlite_sequence SET seq = 99 WHERE name = 'chat_asset_batches';
      `)
      const batch = old.prepare('SELECT * FROM chat_asset_batches').get() as object
      const slot = old.prepare('SELECT * FROM chat_asset_slots').get()
      ensureChatAssetSchema(old)
      ensureChatAssetSchema(old)
      assert.deepEqual(old.prepare('SELECT * FROM chat_asset_batches').get(), { ...batch, setting_id: null })
      assert.deepEqual(old.prepare('SELECT * FROM chat_asset_slots').get(), slot)
      assert.deepEqual(old.pragma('foreign_key_check'), [])
      assert.equal((old.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'chat_asset_batches'").get() as any).seq, 99)
      assert.throws(() => old.prepare('INSERT INTO chat_asset_batches(profile_id, preset_id, snapshot) VALUES (7, 3, ?)').run('{"requestKey":"old"}'), /UNIQUE/)
      assert.throws(() => old.prepare('INSERT INTO chat_asset_batches(preset_id, snapshot) VALUES (3, ?)').run('{}'), /CHECK/)
    } finally { old.close() }
  })
})
