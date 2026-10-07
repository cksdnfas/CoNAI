import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import sharp from 'sharp'
import type { ChatAssetBatch, ChatAssetBatchInput } from '@conai/shared'

test('character asset batches: durable jobs, dependencies, review and approved application', { timeout: 60000 }, async (t) => {
  const temp = path.resolve(__dirname, '../../temp')
  const root = fs.mkdtempSync(path.join(temp, 'conai-asset-batches-test-'))
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
  const batches = await import('../src/services/codex-chat/chatAssetBatches')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { ChatGenerationPresetStore } = await import('../src/services/codex-chat/chatGenerationPresets')
  const { PromptPresetModel } = await import('../src/models/PromptPreset')
  const { DEFAULT_EXPRESSION_PRESET_NAME, ensureChatAssetSchema } = await import('../src/database/chatAssetSchema')
  const { GenerationQueueModel } = await import('../src/models/GenerationQueue')
  const { GenerationQueueService } = await import('../src/services/generationQueueService')
  const { requireQueuedChatGenerationAccess } = await import('../src/services/generation-queue/queueJobExecutors')
  const { ingestProfileAsset } = await import('../src/services/codex-chat/chatProfileAssets')
  const { activeMediaFile } = await import('../src/services/codex-chat/chatCardAssets')
  const { BackgroundQueueService } = await import('../src/services/backgroundQueue')
  const { MediaPostprocessCoordinator } = await import('../src/services/background-media/mediaPostprocessCoordinator')
  const { skippedStage } = await import('../src/services/background-media/mediaProcessingTypes')
  const { settingsService } = await import('../src/services/settingsService')
  const { imageTaggerService } = await import('../src/services/imageTaggerService')
  const { EmoticonService } = await import('../src/services/emoticonService')
  const { GroupPathService } = await import('../src/services/groupPathService')
  const { AuthAccount } = await import('../src/models/AuthAccount')
  const { AuthAccessControlService } = await import('../src/services/authAccessControlService')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { ChatProposalStore } = await import('../src/services/codex-chat/chatProposals')
  const { registerChatReply } = await import('../src/services/codex-chat/chatReplyRegistry')
  const { proposeProfileAssets, applyProfileAssetsProposal } = await import('../src/services/codex-chat/chatAssetProposals')
  const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
  // Real isolated databases/library files; no dispatch, tagger process, provider, server or metadata worker.
  t.mock.method(GenerationQueueService, 'requestDispatch', () => {})
  t.mock.method(BackgroundQueueService, 'addMetadataExtractionTask', () => {})
  t.mock.method(MediaPostprocessCoordinator, 'triggerAutoTagProcessing', () => skippedStage('auto-tag', 'test'))
  const baseSettings = settingsService.loadSettings()
  let taggerEnabled = false
  t.mock.method(settingsService, 'loadSettings', () => ({ ...baseSettings, tagger: { ...baseSettings.tagger, enabled: taggerEnabled } }))
  t.mock.method(imageTaggerService, 'tagImage', async () => { throw new Error('Unmocked tagger call') })
  t.after(async () => {
    taggerEnabled = false
    // Flush the service's deferred review callbacks while its isolated DB is still open.
    await new Promise<void>((resolve) => setImmediate(resolve))
    settings.closeUserSettingsDb()
    auth.getAuthDb().close()
    images.closeDatabase()
    const { logger } = await import('../src/utils/logger')
    await new Promise<void>((resolve) => logger.close(resolve))
    assert.equal(path.dirname(path.resolve(root)), temp)
    assert.ok(path.basename(root).startsWith('conai-asset-batches-test-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const db = () => settings.getUserSettingsDb()
  const requester = { accountId: null, accountType: 'admin' as const }
  const assetRouter = (await import('../src/routes/chat-asset-batches.routes')).default
  const chatRouter = (await import('../src/routes/codex-chat.routes')).default
  const proposalRouter = (await import('../src/routes/chat-proposals.routes')).default
  // Exercise the real middleware and route handlers without opening a listening socket.
  async function call(router: any, routePath: string, method: string, params: Record<string, string>, body?: unknown, session: Record<string, unknown> = {}) {
    const route = router.stack.find((layer: any) => layer.route?.path === routePath && layer.route.methods[method])?.route
    assert.ok(route, routePath)
    const middleware = router === assetRouter ? router.stack.filter((layer: any) => !layer.route).map((layer: any) => layer.handle) : []
    return new Promise<{ status: number; body: any }>((resolve, reject) => {
      let status = 200
      const req = { params, query: {}, body, session, method: method.toUpperCase(), socket: { remoteAddress: '127.0.0.1' }, headers: {} }
      const res = { status(code: number) { status = code; return this }, json(data: unknown) { resolve({ status, body: data }); return this } }
      const handlers = [...middleware, ...route.stack.map((layer: any) => layer.handle)]
      let index = 0
      const next = (error?: unknown) => {
        if (error) { reject(error); return }
        const handler = handlers[index++]
        if (!handler) { reject(new Error('Route did not respond')); return }
        try { Promise.resolve(handler(req, res, next)).catch(reject) } catch (error) { reject(error) }
      }
      next()
    })
  }
  const reference = (await ingestProfileAsset(await sharp({ create: { width: 16, height: 16, channels: 3, background: '#41aabc' } }).png().toBuffer(), '루나')).compositeHash
  const candidate = (await ingestProfileAsset(await sharp({ create: { width: 16, height: 16, channels: 3, background: '#bc4a80' } }).png().toBuffer(), '루나')).compositeHash
  const other = (await ingestProfileAsset(await sharp({ create: { width: 16, height: 16, channels: 3, background: '#eac410' } }).png().toBuffer(), '루나')).compositeHash
  const profile = ChatProfileStore.create({ name: '루나', engine: 'llm', providerName: 'test', referenceHash: reference, appearance: 'blue hair, blue eyes', mcpEnabled: true, mcpScopes: ['configure'] })
  const preset = ChatGenerationPresetStore.create({ name: '자산 생성', kind: 'nai', nai: { promptPrefix: 'quality', characterReference: 'none' } })
  const expressionPreset = PromptPresetModel.findByName(DEFAULT_EXPRESSION_PRESET_NAME)!
  function finish(batch: ChatAssetBatch, key: string, hash = candidate) {
    const jobId = batch.slots.find((slot) => slot.slotKey === key)!.attempts.at(-1)!.jobId
    db().prepare("UPDATE generation_queue_jobs SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?").run(jobId)
    db().prepare("INSERT INTO api_generation_history(service_type, generation_status, composite_hash, queue_job_id) VALUES ('novelai', 'completed', ?, ?)").run(hash, jobId)
    return jobId
  }
  function payload(batch: ChatAssetBatch, key: string) { return JSON.parse(GenerationQueueModel.findById(batch.slots.find((slot) => slot.slotKey === key)!.attempts.at(-1)!.jobId)!.request_payload) }
  let batch: ChatAssetBatch

  await t.test('default emotion seed is once-only and preserves existing or edited names/items', () => {
    assert.deepEqual(PromptPresetModel.findByIdWithItems(expressionPreset.id)!.items.map((item) => item.description), ['중립', '기쁨', '슬픔', '분노', '두려움', '놀람', '애정', '부끄러움'])
    PromptPresetModel.update(expressionPreset.id, { description: 'edited' })
    db().prepare("DELETE FROM user_preferences WHERE key = 'chat_expression_preset_seeded'").run()
    ensureChatAssetSchema(db())
    assert.equal(PromptPresetModel.findById(expressionPreset.id)!.description, 'edited')
    assert.equal(PromptPresetModel.findAll().filter((entry) => entry.name === DEFAULT_EXPRESSION_PRESET_NAME).length, 1)
  })

  await t.test('double create/retry keeps one job per slot and injects reference even for NAI none', async () => {
    const input: ChatAssetBatchInput = { idempotencyKey: 'double-create', presetId: preset.id, expressionPresetId: expressionPreset.id, expressions: ['기쁨', '슬픔'], slots: [{ slotKey: '배경', kind: 'background', prompt: 'night city' }, { slotKey: '아바타', kind: 'avatar', prompt: 'portrait' }] }
    const [first, second] = await Promise.all([batches.createChatAssetBatch(requester, profile.id, input), batches.createChatAssetBatch(requester, profile.id, input)])
    assert.equal(first.id, second.id)
    batch = first
    assert.ok(batch.slots.every((slot) => slot.attempts.length === 1))
    assert.equal((db().prepare('SELECT COUNT(*) AS n FROM generation_queue_jobs').get() as any).n, 4)
    assert.equal((db().prepare('SELECT COUNT(*) AS n FROM chat_generation_links').get() as any).n, 0)
    const group = GroupPathService.resolveOrCreate('채팅 캐릭터/루나/후보')
    for (const slot of batch.slots) {
      const job = GenerationQueueModel.findById(slot.attempts[0].jobId)!
      assert.equal(job.requested_group_id, group.groupId)
      assert.equal(payload(batch, slot.slotKey).n_samples, 1)
      assert.match(payload(batch, slot.slotKey).character_refs[0].image, /^data:image\/png;base64,/)
      assert.match(payload(batch, slot.slotKey).prompt, /quality, blue hair, blue eyes/)
      assert.equal(db().prepare('SELECT idempotency_key FROM generation_queue_idempotency WHERE job_id = ?').get(job.id)?.idempotency_key, `asset:${batch.id}:${slot.slotKey}:1`)
      requireQueuedChatGenerationAccess(job)
    }
    await assert.rejects(batches.createChatAssetBatch(requester, profile.id, { ...input, presetId: preset.id + 100 }), /멱등/)
  })

  await t.test('queue failure/restart state is derived after reopening user.db; no progress is persisted', async () => {
    const jobId = batch.slots[0].attempts[0].jobId
    db().prepare("UPDATE generation_queue_jobs SET status = 'running' WHERE id = ?").run(jobId)
    assert.equal(batches.getChatAssetBatch(requester, batch.id).slots[0].status, 'running')
    db().prepare("UPDATE generation_queue_jobs SET status = 'failed', failure_code = 'process_restarted' WHERE id = ?").run(jobId)
    settings.closeUserSettingsDb(); settings.initializeUserSettingsDb()
    ;(await import('../src/database/apiGenerationDb')).initializeApiGenerationDb()
    const slot = batches.getChatAssetBatch(requester, batch.id).slots[0]
    assert.equal(slot.status, 'failed')
    assert.equal(slot.attempts[0].failureCode, 'process_restarted')
    assert.ok(!(db().prepare('PRAGMA table_info(chat_asset_slots)').all() as any[]).some((column) => column.name === 'status'))
    ensureChatAssetSchema(db())
    assert.equal(PromptPresetModel.findById(expressionPreset.id)!.description, 'edited')
  })

  await t.test('regeneration reuses frozen appearance/preset, defaults to random seeds, and is idempotent by attempt', async () => {
    ChatGenerationPresetStore.update(preset.id, { nai: { promptPrefix: 'new quality' } })
    ChatProfileStore.update(profile.id, { appearance: 'current appearance' })
    const [first, second] = await Promise.all([batches.regenerateChatAssetSlot(requester, batch.id, '기쁨', { attempt: 2 }), batches.regenerateChatAssetSlot(requester, batch.id, '기쁨', { attempt: 2 })])
    assert.equal(first.slots[0].attempts.length, 2)
    assert.equal(second.slots[0].attempts[1].jobId, first.slots[0].attempts[1].jobId)
    assert.match(payload(first, '기쁨').prompt, /^quality, blue hair/)
    assert.equal(payload(first, '기쁨').seed, undefined)
    batch = await batches.regenerateChatAssetSlot(requester, batch.id, '기쁨', { attempt: 3, useCurrentPreset: true })
    assert.match(payload(batch, '기쁨').prompt, /^new quality, blue hair/)
    await assert.rejects(batches.regenerateChatAssetSlot(requester, batch.id, '기쁨', { attempt: 3 }), /옵션/)
  })

  await t.test('reference failure blocks followers; only successful explicit selection submits them once', async () => {
    const fresh = ChatProfileStore.create({ name: '기준 먼저', engine: 'codex' })
    let pending = await batches.createChatAssetBatch(requester, fresh.id, { idempotencyKey: 'reference-first', presetId: preset.id, slots: [{ slotKey: '기준', kind: 'reference', prompt: 'portrait' }, { slotKey: '배경', kind: 'background', prompt: 'garden' }] })
    assert.equal(pending.slots[1].attempts.length, 0)
    const jobId = pending.slots[0].attempts[0].jobId
    assert.equal(payload(pending, '기준').n_samples, 1)
    assert.equal(payload(pending, '기준').character_refs, undefined)
    db().prepare("UPDATE generation_queue_jobs SET status = 'failed' WHERE id = ?").run(jobId)
    assert.equal(batches.getChatAssetBatch(requester, pending.id).slots[1].status, 'blocked')
    await assert.rejects(batches.regenerateChatAssetSlot(requester, pending.id, '배경', { attempt: 1 }), /먼저/)
    await assert.rejects(batches.cancelChatAssetSlot(requester, pending.id, '배경'), /아직 제출/)
    await assert.rejects(batches.chooseChatAssetSlot(requester, pending.id, '기준', other), /성공/)
    pending = await batches.regenerateChatAssetSlot(requester, pending.id, '기준', { attempt: 2 })
    finish(pending, '기준', reference)
    assert.equal(batches.getChatAssetBatch(requester, pending.id).slots[1].attempts.length, 0)
    const [first, second] = await Promise.all([batches.chooseChatAssetSlot(requester, pending.id, '기준', reference), batches.chooseChatAssetSlot(requester, pending.id, '기준', reference)])
    assert.equal(first.slots[1].attempts.length, 1)
    assert.equal(second.slots[1].attempts.length, 1)
    assert.equal(first.slots[1].attempts[0].referenceHash, reference)
    assert.equal(ChatProfileStore.find(fresh.id)!.referenceHash, null)
  })

  await t.test('choosing refuses unrelated library hashes; tagger disabled returns no review', async () => {
    for (const key of ['기쁨', '슬픔', '배경', '아바타']) finish(batch, key)
    await assert.rejects(batches.chooseChatAssetSlot(requester, batch.id, '기쁨', other), /성공/)
    for (const key of ['기쁨', '슬픔', '배경', '아바타']) batch = await batches.chooseChatAssetSlot(requester, batch.id, key, candidate)
    assert.ok(batch.slots.every((slot) => !slot.attempts.at(-1)!.candidates[0].review))
    assert.equal(imageTaggerService.tagImage.mock.calls.length, 0)
  })

  await t.test('deferred mocked tagger review is cached, read does not wait, and disabled hides old cache', async (sub) => {
    taggerEnabled = true
    let release!: () => void
    const wait = new Promise<void>((resolve) => { release = resolve })
    let calls = 0
    sub.mock.method(imageTaggerService, 'tagImage', async (file: string) => {
      calls += 1
      await wait
      return { success: true, general: file === activeMediaFile(reference)!.path ? { blue_hair: 0.9, blue_eyes: 0.9 } : { smile: 0.9, blue_hair: 0.9, red_eyes: 0.9 }, rating: { general: 0.9 } }
    })
    const reading = batches.getChatAssetBatch(requester, batch.id)
    assert.equal(reading.id, batch.id)
    assert.ok(!reading.slots[0].attempts.at(-1)!.candidates[0].review)
    await new Promise<void>((resolve) => setImmediate(resolve))
    release()
    // Wait for the scheduled cache writer; it is independent of the synchronous GET.
    for (let tries = 0; tries < 20 && !batches.getChatAssetBatch(requester, batch.id).slots[0].attempts.at(-1)!.candidates[0].review; tries += 1) await new Promise<void>((resolve) => setImmediate(resolve))
    const review = batches.getChatAssetBatch(requester, batch.id).slots[0].attempts.at(-1)!.candidates[0].review!
    assert.equal(review.expression!.matches, true)
    assert.equal(review.hair.matches, true)
    assert.equal(review.eyes.matches, false)
    assert.ok(review.similarSlots.some((entry) => entry.slotKey === '슬픔' && entry.confidence === 100))
    assert.equal(review.rating.general, 0.9)
    const count = calls
    await batches.cacheChatAssetReviews(batch.id)
    assert.equal(calls, count)
    taggerEnabled = false
    assert.ok(!batches.getChatAssetBatch(requester, batch.id).slots[0].attempts.at(-1)!.candidates[0].review)
  })

  await t.test('application adds memberships/keywords, front-links expression group, and existing chat response exposes emotions', async () => {
    const generalGroup = GroupPathService.resolveOrCreate('일반 이모티콘').groupId
    images.db.prepare('UPDATE groups SET emoticon_enabled = 1 WHERE id = ?').run(generalGroup)
    EmoticonService.addImages(generalGroup, [{ compositeHash: other, keywords: ['기쁨'] }])
    ChatProfileStore.update(profile.id, { style: { ...profile.style, emoticonGroupIds: [generalGroup] } })
    const result = batches.applyChatAssetBatch(requester, batch.id, { avatarCrop: { x: 50, y: 50, scale: 1.5 } })
    const current = ChatProfileStore.find(profile.id)!
    assert.equal(current.avatarHash, candidate)
    assert.equal(current.backgroundHash, candidate)
    assert.equal(current.avatarCrop!.scale, 1.5)
    assert.deepEqual(current.style.emoticonGroupIds, [result.applied.expressionGroupId, generalGroup])
    assert.deepEqual(EmoticonService.listEntries(result.applied.expressionGroupId!)[0].keywords, ['기쁨', '슬픔'])
    const candidates = GroupPathService.resolveOrCreate('채팅 캐릭터/루나/후보').groupId
    // Executors normally add this on completion; keep the same membership as generated results.
    EmoticonService.addImages(candidates, [{ compositeHash: candidate, keywords: [] }])
    batches.applyChatAssetBatch(requester, batch.id)
    assert.ok(images.db.prepare('SELECT 1 FROM image_groups WHERE group_id = ? AND composite_hash = ?').get(candidates, candidate))
    const { listProfileEmoticons } = await import('../src/services/codex-chat/chatEmoticons')
    assert.equal(listProfileEmoticons(current.style).find((entry) => entry.keywords.includes('기쁨'))!.compositeHash, candidate)
    updateChatSettings({ enabled: true })
    const response = await call(chatRouter, '/profiles/:profileId/emoticons', 'get', { profileId: String(profile.id) })
    assert.equal(response.status, 200)
    assert.equal(response.body.data.find((entry: any) => entry.keywords.includes('기쁨')).compositeHash, candidate)
    assert.equal(GroupPathService.getPathLabel(result.applied.expressionGroupId!), '채팅 캐릭터/루나/표정')
    assert.equal(GroupPathService.getPathLabel(result.applied.backgroundGroupId!), '채팅 캐릭터/루나/배경')
  })

  await t.test('in-group keyword conflicts roll back new members and all profile fields with an explicit receipt', async () => {
    const conflictProfile = ChatProfileStore.create({ name: '키워드 충돌', engine: 'codex', referenceHash: reference })
    let conflict = await batches.createChatAssetBatch(requester, conflictProfile.id, { idempotencyKey: 'conflict', presetId: preset.id, expressionPresetId: expressionPreset.id, expressions: ['기쁨'], slots: [{ slotKey: '아바타', kind: 'avatar', prompt: 'portrait' }] })
    finish(conflict, '기쁨'); finish(conflict, '아바타')
    conflict = await batches.chooseChatAssetSlot(requester, conflict.id, '기쁨', candidate)
    conflict = await batches.chooseChatAssetSlot(requester, conflict.id, '아바타', candidate)
    const group = GroupPathService.resolveOrCreate('채팅 캐릭터/키워드 충돌/표정').groupId
    EmoticonService.addImages(group, [{ compositeHash: other, keywords: ['기쁨'] }])
    assert.throws(() => batches.applyChatAssetBatch(requester, conflict.id), (error: any) => error.status === 409 && error.details.rolledBack === true && error.details.applied.profileFields.length === 0)
    assert.equal(ChatProfileStore.find(conflictProfile.id)!.avatarHash, null)
    assert.ok(!images.db.prepare('SELECT 1 FROM image_groups WHERE group_id = ? AND composite_hash = ?').get(group, candidate))
    assert.equal(EmoticonService.findGroup(group)!.emoticon_enabled, 0)
  })

  await t.test('cancel uses queue cancellation; profile deletion cascades batches and dispatch rechecks live authority', async (sub) => {
    const deleting = ChatProfileStore.create({ name: '삭제할 캐릭터', engine: 'codex', referenceHash: reference })
    const pending = await batches.createChatAssetBatch(requester, deleting.id, { idempotencyKey: 'cancel-delete', presetId: preset.id, slots: [{ slotKey: '아바타', kind: 'avatar', prompt: 'portrait' }] })
    const cancelled = await batches.cancelChatAssetSlot(requester, pending.id, '아바타')
    assert.equal(cancelled.slots[0].status, 'cancelled')
    const record = GenerationQueueModel.findById(pending.slots[0].attempts[0].jobId)!
    sub.mock.method(AuthAccount, 'findById', () => ({ account_type: 'guest', status: 'active' } as any))
    assert.throws(() => requireQueuedChatGenerationAccess({ ...record, requested_by_account_id: 7 }), /관리자/)
    ChatProfileStore.delete(deleting.id)
    assert.equal((db().prepare('SELECT COUNT(*) AS n FROM chat_asset_slots WHERE batch_id = ?').get(pending.id) as any).n, 0)
    assert.throws(() => requireQueuedChatGenerationAccess(record), /연결/)
  })

  await t.test('ComfyUI uses the designated prompt/reference fields and replaces fixed seeds per attempt', async () => {
    const { WorkflowModel } = await import('../src/models/Workflow')
    db().prepare("INSERT INTO comfyui_servers(name, endpoint, is_active, backend_type) VALUES ('격리 모의 서버', 'http://127.0.0.1:1', 1, 'comfyui')").run()
    const fields = [{ id: 'positive', label: 'Positive', type: 'textarea', jsonPath: '6.inputs.text' }, { id: 'ref', label: 'Reference', type: 'image', jsonPath: '7.inputs.image' }, { id: 'seed', label: 'Seed', type: 'number', jsonPath: '8.inputs.seed' }]
    const workflow = WorkflowModel.create({ name: '자산 테스트', workflow_json: '{}', marked_fields: fields as any })
    const comfy = ChatGenerationPresetStore.create({ name: 'Comfy 자산', kind: 'comfyui', comfyui: { workflowId: workflow, exposedFieldIds: ['positive', 'ref'], fixedInputs: { positive: 'quality', seed: 42 }, referenceField: 'ref' } })
    const result = await batches.createChatAssetBatch(requester, profile.id, { idempotencyKey: 'comfy', presetId: comfy.id, promptField: 'positive', slots: [{ slotKey: '전신', kind: 'full', prompt: 'full body' }] })
    assert.deepEqual(payload(result, '전신').prompt_data.ref, { composite_hash: reference })
    assert.match(payload(result, '전신').prompt_data.positive, /quality, current appearance, full body/)
    assert.notEqual(payload(result, '전신').prompt_data.seed, 42)
    const regenerated = await batches.regenerateChatAssetSlot(requester, result.id, '전신', { attempt: 2 })
    assert.notEqual(payload(regenerated, '전신').prompt_data.seed, payload(result, '전신').prompt_data.seed)
    await assert.rejects(batches.createChatAssetBatch(requester, profile.id, { idempotencyKey: 'bad-comfy', presetId: comfy.id, slots: [{ slotKey: '전신', kind: 'full', prompt: 'full body' }] }), /promptField/)
  })

  await t.test('slot wildcard expansion stays in the existing generation preprocessor', async () => {
    const { WildcardModel } = await import('../src/models/Wildcard')
    WildcardModel.create({ name: 'asset_mood', items: { general: [], comfyui: [], nai: [{ content: 'smile', weight: 1 }] } })
    const pending = await batches.createChatAssetBatch(requester, profile.id, { idempotencyKey: 'wildcard', presetId: preset.id, slots: [{ slotKey: '아바타', kind: 'avatar', prompt: '++asset_mood++' }] })
    assert.match(payload(pending, '아바타').prompt, /\+\+asset_mood\+\+/)
    const { preprocessMetadata } = await import('../src/utils/nai/metadata')
    assert.match(preprocessMetadata(payload(pending, '아바타')).prompt, /smile/)
  })

  await t.test('profile_assets proposals change nothing before approval, need a second apply card, and reject non-admin', async (sub) => {
    updateChatSettings({ enabled: true })
    const threadId = CodexChatStore.createThread(null, '자산 제안', 'llm', profile.id)
    const context = { kind: 'direct' as const, threadId, profileId: profile.id, replyId: 'asset-proposal' }
    const unregister = registerChatReply(context, new AbortController().signal, () => ({ replyTo: null, recipients: [] }))
    const before = (db().prepare('SELECT COUNT(*) AS n FROM generation_queue_jobs').get() as any).n
    try {
      const proposal = proposeProfileAssets(requester, context, { input: { presetId: preset.id, slots: [{ slotKey: '아바타', kind: 'avatar', prompt: 'portrait' }] } })
      assert.equal((db().prepare('SELECT COUNT(*) AS n FROM generation_queue_jobs').get() as any).n, before)
      unregister()
      const created = await applyProfileAssetsProposal(requester, proposal.id)
      const made = created.batch!
      assert.equal(ChatProposalStore.find(proposal.id)!.kind, 'profile_assets')
      finish(made, '아바타', other)
      await batches.chooseChatAssetSlot(requester, made.id, '아바타', other)
      assert.equal(ChatProfileStore.find(profile.id)!.avatarHash, candidate)
      const secondContext = { ...context, replyId: 'asset-apply-proposal' }
      const stop = registerChatReply(secondContext, new AbortController().signal, () => ({ replyTo: null, recipients: [] }))
      const applying = proposeProfileAssets(requester, secondContext, { action: 'apply', batch_id: made.id })
      stop()
      finish(made, '아바타', candidate)
      await batches.chooseChatAssetSlot(requester, made.id, '아바타', candidate)
      await assert.rejects(applyProfileAssetsProposal(requester, applying.id), /제안 뒤 바뀌었어/)
      await batches.chooseChatAssetSlot(requester, made.id, '아바타', other)
      sub.mock.method(AuthAccount, 'findById', () => ({ account_type: 'guest', status: 'active' } as any))
      await assert.rejects(applyProfileAssetsProposal({ accountId: 8, accountType: 'admin' }, applying.id), /관리자/)
      await applyProfileAssetsProposal(requester, applying.id)
      assert.equal(ChatProfileStore.find(profile.id)!.avatarHash, other)
      await assert.rejects(applyProfileAssetsProposal(requester, applying.id), /이미 승인/)
    } finally { unregister() }
  })

  await t.test('admin API preserves profile binding, validates requests, and records live requester ownership', async (sub) => {
    const requested = { idempotencyKey: 'api-create', presetId: preset.id, slots: [{ slotKey: '아바타', kind: 'avatar', prompt: 'portrait' }] }
    const response = await call(assetRouter, '/', 'post', { profileId: String(profile.id) }, requested)
    assert.equal(response.status, 201)
    const created = response.body.data as ChatAssetBatch
    assert.equal((await call(assetRouter, '/:batchId', 'get', { profileId: String(profile.id), batchId: String(created.id) })).body.data.id, created.id)
    const wrong = ChatProfileStore.create({ name: '다른 캐릭터', engine: 'codex' })
    assert.equal((await call(assetRouter, '/:batchId/apply', 'post', { profileId: String(wrong.id), batchId: String(created.id) }, {})).status, 404)
    assert.equal((await call(assetRouter, '/', 'post', { profileId: String(profile.id) }, {})).status, 400)
    assert.equal((await call(assetRouter, '/:batchId/slots/:slotKey/regenerate', 'post', { profileId: String(profile.id), batchId: String(created.id), slotKey: '아바타' }, { attempt: 2 })).body.data.slots[0].attempts.length, 2)
    finish(batches.getChatAssetBatch(requester, created.id), '아바타', other)
    assert.equal((await call(assetRouter, '/:batchId/slots/:slotKey/choose', 'post', { profileId: String(profile.id), batchId: String(created.id), slotKey: '아바타' }, { compositeHash: other })).status, 200)
    assert.equal((await call(assetRouter, '/:batchId/apply', 'post', { profileId: String(profile.id), batchId: String(created.id) }, {})).status, 200)
    const bootstrap = AuthAccessControlService.resolveBootstrapAccess()
    sub.mock.method(AuthAccount, 'findById', (id: number) => ({ id, status: 'active', account_type: id === 7 ? 'admin' : 'guest' } as any))
    sub.mock.method(AuthAccessControlService, 'resolveForAccountId', () => bootstrap)
    const owned = await batches.createChatAssetBatch({ accountId: 7, accountType: 'guest' }, profile.id, { ...requested, idempotencyKey: 'owned' })
    const job = GenerationQueueModel.findById(owned.slots[0].attempts[0].jobId)!
    assert.equal(job.requested_by_account_id, 7)
    assert.equal(job.requested_by_account_type, 'admin')
    const authHelpers = await import('../src/routes/auth-route-helpers')
    sub.mock.method(AuthAccount, 'countActiveAdmins', () => 1)
    authHelpers.invalidateConfiguredAuthCache()
    sub.after(() => authHelpers.invalidateConfiguredAuthCache())
    assert.equal((await call(assetRouter, '/', 'post', { profileId: String(profile.id) }, requested, { accountId: 8, authenticated: true, accountType: 'admin' })).status, 403)
    const threadId = CodexChatStore.createThread(8, '일반 사용자 승인', 'llm', profile.id)
    const proposal = ChatProposalStore.add({ threadId, profileId: profile.id, kind: 'direct', replyId: 'guest' }, { kind: 'profile_assets', action: 'create', profileId: profile.id, profileName: profile.name, input: requested as ChatAssetBatchInput })
    const before = (db().prepare('SELECT COUNT(*) AS n FROM generation_queue_jobs').get() as any).n
    assert.equal((await call(proposalRouter, '/:proposalId/apply', 'post', { proposalId: String(proposal.id) }, {}, { accountId: 8, authenticated: true, accountType: 'admin' })).status, 403)
    assert.equal((db().prepare('SELECT COUNT(*) AS n FROM generation_queue_jobs').get() as any).n, before)
  })
})
