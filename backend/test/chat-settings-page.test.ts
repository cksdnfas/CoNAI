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
})
