import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

test('model rows: connection ▸ models, legacy pairs, resolution, sync, deletion, migration, usage', { timeout: 60000 }, async (t) => {
  // Load runtime modules only after isolating every data path. Never open the user's databases.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-slots-test-'))
  process.env.RUNTIME_BASE_PATH = root
  process.env.RUNTIME_DATABASE_DIR = path.join(root, 'database')
  process.env.RUNTIME_SAVE_DIR = path.join(root, 'save')
  const dbModule = await import('../src/database/userSettingsDb')
  dbModule.initializeUserSettingsDb()
  t.after(async () => {
    dbModule.closeUserSettingsDb()
    ;(await import('../src/database/init')).closeDatabase()
    const { logger } = await import('../src/utils/logger')
    await new Promise<void>((resolve) => logger.close(resolve))
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('conai-slots-test-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const db = dbModule.getUserSettingsDb()
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  const { ChatProfileStore, ChatProfileError, profileGenerationOptions } = await import('../src/services/codex-chat/chatProfiles')
  const { ChatJudgePresetStore } = await import('../src/services/codex-chat/chatJudgePresets')
  const { ModelSlotStore, modelReferencesOfConnection, deleteModelsOfConnection, primaryModelOf } = await import('../src/services/codex-chat/modelSlots')
  const { resolveProfileModel, hasTranslation, modelLabelOf } = await import('../src/services/codex-chat/chatModelRoles')
  const { buildModelUsage } = await import('../src/services/codex-chat/modelUsage')
  const { migrateLlmModelRows } = await import('../src/database/llmModelRowsMigration')

  const connections = [['conn-a', 'llm_openai_compatible'], ['conn-b', 'llm_ollama'], ['plain', 'general'], ['jev', 'decision_typesafe']] as const
  for (const [name, type] of connections) {
    ExternalApiProvider.create({ provider_name: name, display_name: `Display ${name}`, provider_type: type, base_url: 'http://unused.invalid', is_enabled: true, additional_config: name === 'jev' ? {} : { default_model: `${name}-default`, request_timeout_ms: 5000 } })
  }
  const rowOf = (providerName: string, model: string) => ModelSlotStore.ensure(providerName, model, { create: false })
  const configOf = (name: string) => JSON.parse((db.prepare('SELECT additional_config FROM external_api_providers WHERE provider_name = ?').get(name) as { additional_config: string }).additional_config)

  await t.test('a connection saved with a default model gets it as its first row and keeps no model key', () => {
    assert.ok(rowOf('conn-a', 'conn-a-default'))
    assert.ok(rowOf('conn-b', 'conn-b-default'))
    assert.throws(() => rowOf('plain', 'plain-default'), /연결을 찾을 수 없어/, 'only model connections hold rows')
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM llm_model_slots WHERE provider_name = 'plain'").get() as { n: number }).n, 0)
    assert.deepEqual(configOf('conn-a'), { request_timeout_ms: 5000 })
    const defaults = ModelSlotStore.list().filter((slot) => slot.isDefault)
    assert.deepEqual(defaults.map((slot) => slot.model), ['conn-a-default'], 'the first LLM row becomes the one default')
    assert.equal(defaults[0].label, '대표 · 대화', 'the default is the chat representative model')
    assert.equal(defaults[0].kind, 'route')
    assert.equal(ModelSlotStore.defaultTarget()?.label, 'Display conn-a · conn-a-default')
    ExternalApiProvider.update('conn-b', { additional_config: { default_model: 'conn-b-second' } })
    assert.ok(rowOf('conn-b', 'conn-b-second'), 'an update with a default model adds it too')
    assert.deepEqual(configOf('conn-b'), {})
    assert.equal(primaryModelOf('conn-b'), 'conn-b-default')
  })

  await t.test('Claude profiles persist their engine without an API connection and use the Claude transport', () => {
    const profile = ChatProfileStore.create({ name: 'Claude', engine: 'claude', model: 'sonnet', providerName: 'conn-a' })
    assert.equal(ChatProfileStore.find(profile.id)?.engine, 'claude')
    assert.equal(profile.modelSlotId, null)
    assert.equal(resolveProfileModel(profile, 'chat')?.providerName, '__conai_claude_code__')
    assert.equal(modelLabelOf(profile), 'Claude Code · sonnet')
    ChatProfileStore.delete(profile.id)
  })

  await t.test('Claude profiles keep the CLI-only effort levels that API profiles refuse', () => {
    const profile = ChatProfileStore.create({ name: 'Claude max', engine: 'claude', model: 'opus', reasoningEffort: 'max' })
    assert.equal(profileGenerationOptions(profile).reasoningEffort, 'max')
    ChatProfileStore.delete(profile.id)
    assert.throws(() => ChatProfileStore.create({ name: 'Claude none', engine: 'claude', model: 'opus', reasoningEffort: 'none' }), ChatProfileError)
    assert.throws(() => ChatProfileStore.create({ name: 'API xhigh', engine: 'llm', reasoningEffort: 'xhigh' }), ChatProfileError)
  })

  await t.test('a legacy connection + model pair lands on that connection\'s row; a draft never creates one', () => {
    const before = ModelSlotStore.list().length
    const profile = ChatProfileStore.create({ name: 'legacy', engine: 'llm', providerName: 'conn-a', summaryProviderName: 'conn-b', summaryModel: 'small', judgeProviderName: 'jev' })
    assert.equal(profile.modelSlotId, rowOf('conn-a', 'conn-a-default'), 'an empty model is the connection\'s primary model')
    assert.equal(profile.summarySlotId, rowOf('conn-b', 'small'))
    assert.equal(profile.judgeSlotId, rowOf('jev', 'jev-latest'), 'a TypeSafe connection without models asks its default model')
    assert.equal(ModelSlotStore.list().length, before + 2)
    const stored = db.prepare('SELECT provider_name, model, summary_provider_name, judge_provider_name FROM llm_chat_profiles WHERE id = ?').get(profile.id)
    assert.deepEqual(stored, { provider_name: '', model: null, summary_provider_name: null, judge_provider_name: null }, 'the pair columns are cleared')

    const draft = ChatProfileStore.draft({ name: 'draft', engine: 'llm', providerName: 'conn-a', model: 'never-saved' })
    assert.equal(draft.modelSlotId, null)
    assert.equal(rowOf('conn-a', 'never-saved'), null)

    const patched = ChatProfileStore.update(profile.id, { providerName: 'conn-b', model: 'patched' })!
    assert.equal(patched.modelSlotId, rowOf('conn-b', 'patched'), 'a pair in a patch replaces the current row')
    assert.throws(() => ChatProfileStore.create({ name: 'bad', engine: 'llm', providerName: 'nope' }), /연결을 찾을 수 없어/)
    assert.throws(() => ChatProfileStore.create({ name: 'bad', engine: 'llm', providerName: 'plain' }), /연결을 찾을 수 없어/)
    ChatProfileStore.delete(profile.id)
  })

  await t.test('row validation: chat roles take LLM models only, the judge also TypeSafe ones; the default is an LLM model', () => {
    const jevRow = rowOf('jev', 'jev-latest')!
    assert.throws(() => ChatProfileStore.create({ name: 'x', engine: 'llm', modelSlotId: jevRow }), /채팅에 쓸 수 없어/)
    assert.throws(() => ChatProfileStore.create({ name: 'x', engine: 'llm', summarySlotId: jevRow }), /채팅에 쓸 수 없어/)
    assert.throws(() => ChatProfileStore.create({ name: 'x', engine: 'llm', modelSlotId: 99999 }), /모델을 찾을 수 없어/)
    const judged = ChatProfileStore.create({ name: 'judged', engine: 'llm', judgeSlotId: jevRow })
    assert.equal(judged.judgeSlotId, jevRow)
    assert.throws(() => ModelSlotStore.setDefault(jevRow), /LLM 연결의 모델만/)
    assert.throws(() => ChatJudgePresetStore.create({ name: 'p', items: [], escalationSlotId: jevRow }), /판단에 쓸 수 없는|채팅에 쓸 수 없어/)
    ChatProfileStore.delete(judged.id)
  })

  await t.test('resolution: the role\'s row, else the chat model (summary, suggestions) or nothing (translation); chat falls back to the default', () => {
    const fast = ModelSlotStore.ensure('conn-b', 'fast')!
    const profile = ChatProfileStore.create({ name: 'roles', engine: 'llm', modelSlotId: fast, translationSlotId: fast })
    const chat = resolveProfileModel(profile, 'chat')!
    assert.deepEqual([chat.providerName, chat.model, chat.via, chat.label], ['conn-b', 'fast', 'slot', 'Display conn-b · fast'])
    assert.deepEqual([resolveProfileModel(profile, 'summary')?.model, resolveProfileModel(profile, 'summary')?.via], ['fast', 'inherit'])
    assert.equal(resolveProfileModel(profile, 'suggest')?.via, 'inherit')
    assert.equal(hasTranslation(profile), true)
    assert.equal(hasTranslation({ ...profile, translationSlotId: null }), false)
    const loose = { ...profile, modelSlotId: null }
    assert.deepEqual([resolveProfileModel(loose, 'chat')?.model, resolveProfileModel(loose, 'chat')?.via], ['conn-a-default', 'default'])
    const codex = { ...profile, engine: 'codex' as const, model: 'gpt-5.5', translationSlotId: null }
    assert.equal(resolveProfileModel(codex, 'chat'), null)
    assert.equal(resolveProfileModel(codex, 'summary'), null, 'Codex helpers need a row of their own')
    assert.equal(resolveProfileModel({ ...codex, suggestSlotId: fast }, 'suggest')?.model, 'fast')
    assert.equal(modelLabelOf(codex), 'Codex · gpt-5.5')
    assert.equal(modelLabelOf(profile), 'Display conn-b · fast')
    ChatProfileStore.delete(profile.id)
  })

  await t.test('sync sets a connection\'s models in order, never dropping one in use; changing a row reaches its users', () => {
    const used = ModelSlotStore.ensure('conn-b', 'keep-me')!
    const profile = ChatProfileStore.create({ name: '세라', engine: 'llm', modelSlotId: used })
    assert.throws(() => ModelSlotStore.syncConnection('conn-b', ['conn-b-default']), /쓰는 곳이 있어서 뺄 수 없어: keep-me \(세라\)/)
    const synced = ModelSlotStore.syncConnection('conn-b', ['new-one', 'keep-me'])
    assert.deepEqual(synced.map((slot) => slot.model), ['new-one', 'keep-me'], 'unused rows go, missing ones come, in list order')
    assert.equal(synced.find((slot) => slot.model === 'keep-me')?.id, used, 'a kept model keeps its row')
    assert.deepEqual(synced.find((slot) => slot.id === used)?.profiles, [{ id: profile.id, name: '세라', roles: ['chat'] }])
    assert.throws(() => ModelSlotStore.syncConnection('plain', ['x']), /연결을 찾을 수 없어/)

    ModelSlotStore.update(used, { model: 'renamed' })
    assert.equal(resolveProfileModel(ChatProfileStore.find(profile.id)!, 'chat')?.model, 'renamed')
    assert.throws(() => ModelSlotStore.update(used, { model: 'new-one' }), /같은 모델이 이미 있어/)
    assert.throws(() => ModelSlotStore.delete(used), /쓰는 곳이 있어서 지울 수 없어: 세라/)
    ChatProfileStore.delete(profile.id)
    assert.equal(ModelSlotStore.delete(used), true)
  })

  await t.test('the default moves to another LLM row when its row goes; a connection with used models cannot be deleted', () => {
    const defaultRowId = ModelSlotStore.defaultTarget()!.id
    assert.equal(ModelSlotStore.find(defaultRowId)?.providerName, 'conn-a')
    ModelSlotStore.syncConnection('conn-a', ['conn-a-other'])
    assert.equal(ModelSlotStore.find(defaultRowId), null, 'the chat representative model never holds its row in place')
    const defaults = ModelSlotStore.list().filter((slot) => slot.isDefault)
    assert.equal(defaults.length, 1)
    assert.notEqual(defaults[0].providerType, 'decision_typesafe')
    assert.notEqual(ModelSlotStore.defaultTarget()?.id, defaultRowId, 'it moved to another LLM row')

    const row = rowOf('conn-a', 'conn-a-other')!
    const preset = ChatJudgePresetStore.create({ name: '판정', items: [], modelSlotId: rowOf('jev', 'jev-latest'), escalationSlotId: row })
    assert.match(modelReferencesOfConnection('conn-a').models.join(), /conn-a-other \(판단 프리셋 판정\)/)
    ChatJudgePresetStore.delete(preset.id)
    assert.deepEqual(modelReferencesOfConnection('conn-a'), { models: [] })
    deleteModelsOfConnection('conn-a')
    assert.deepEqual(ModelSlotStore.ofConnection('conn-a'), [])
  })

  await t.test('migration: default models, direct pairs, inherited summary models, judges and duplicate rows land on rows', () => {
    db.prepare("UPDATE external_api_providers SET additional_config = ? WHERE provider_name = 'conn-a'").run(JSON.stringify({ default_model: 'legacy-default', thinking_switch: 'none' }))
    const dupA = Number(db.prepare("INSERT INTO llm_model_slots (name, provider_name, model) VALUES ('대화', 'conn-b', 'dup')").run().lastInsertRowid)
    const dupB = Number(db.prepare("INSERT INTO llm_model_slots (name, provider_name, model, is_default) VALUES ('요약', 'conn-b', 'dup', 0)").run().lastInsertRowid)
    const insert = db.prepare(`
      INSERT INTO llm_chat_profiles (name, engine, provider_name, model, summary_provider_name, summary_model, translation_slot_id, judge_provider_name, judge_model, system_prompt, greeting)
      VALUES (@name, @engine, @provider_name, @model, @summary_provider_name, @summary_model, @translation_slot_id, @judge_provider_name, @judge_model, '', '')
    `)
    const direct = Number(insert.run({ name: 'direct', engine: 'llm', provider_name: 'conn-a', model: '', summary_provider_name: null, summary_model: 'tiny', translation_slot_id: dupB, judge_provider_name: 'jev', judge_model: '' }).lastInsertRowid)
    const codex = Number(insert.run({ name: 'codex', engine: 'codex', provider_name: '', model: 'gpt-5.5', summary_provider_name: 'conn-b', summary_model: 'sum', translation_slot_id: null, judge_provider_name: null, judge_model: null }).lastInsertRowid)
    const preset = Number(db.prepare("INSERT INTO chat_judge_presets (name, provider_name, model, escalation_provider_name, escalation_model) VALUES ('old', 'jev', 'jev-2', 'conn-b', '')").run().lastInsertRowid)

    migrateLlmModelRows(db)
    migrateLlmModelRows(db)

    const rows = ModelSlotStore.list()
    assert.equal(rows.filter((slot) => slot.providerName === 'conn-b' && slot.model === 'dup').length, 1, 'duplicates merged')
    const p = ChatProfileStore.find(direct)!
    assert.equal(p.modelSlotId, rowOf('conn-a', 'legacy-default'))
    assert.equal(p.summarySlotId, rowOf('conn-a', 'tiny'), 'a summary model alone ran on the chat connection')
    assert.equal(p.translationSlotId, dupA, 'references move to the kept duplicate')
    assert.equal(p.judgeSlotId, rowOf('jev', 'jev-latest'))
    const c = ChatProfileStore.find(codex)!
    assert.deepEqual([c.model, c.modelSlotId, c.summarySlotId], ['gpt-5.5', null, rowOf('conn-b', 'sum')])
    const migratedPreset = ChatJudgePresetStore.find(preset)!
    assert.deepEqual([migratedPreset.modelSlotId, migratedPreset.escalationSlotId], [rowOf('jev', 'jev-2'), rowOf('conn-b', 'conn-b-default')])
    assert.deepEqual(configOf('conn-a'), { thinking_switch: 'none' })
    assert.equal(rows.filter((slot) => slot.isDefault).length, 1)
    const cleared = db.prepare('SELECT provider_name, model, summary_model, judge_provider_name FROM llm_chat_profiles WHERE id = ?').get(direct)
    assert.deepEqual(cleared, { provider_name: '', model: null, summary_model: null, judge_provider_name: null })
  })

  await t.test('usage counts saved workflow LLM nodes per row through the profile they chat as', () => {
    let moduleId = (db.prepare("SELECT id FROM module_definitions WHERE internal_fixed_values LIKE '%system.call_llm%' LIMIT 1").get() as { id: number } | undefined)?.id
    if (moduleId === undefined) {
      moduleId = Number(db.prepare(`
        INSERT INTO module_definitions (name, engine_type, authoring_source, template_defaults, exposed_inputs, output_ports, internal_fixed_values)
        VALUES ('test llm', 'system', 'manual', '{}', '[]', '[]', '{"operation_key":"system.call_llm"}')
      `).run().lastInsertRowid)
    }
    const row = ModelSlotStore.ensure('conn-b', 'wf-model')!
    const viaRow = ChatProfileStore.create({ name: 'wf-profile', engine: 'llm', modelSlotId: row })
    const graph = {
      nodes: [
        { id: 'a', module_id: moduleId, input_values: { profile_id: viaRow.id } },
        { id: 'b', module_id: moduleId, input_values: { profile_id: viaRow.id } },
        { id: 'd', module_id: moduleId, input_values: { provider_name: 'conn-b' } },
        { id: 'e', module_id: moduleId + 1000, input_values: { profile_id: viaRow.id } },
      ],
      edges: [],
    }
    db.prepare('INSERT INTO graph_workflows (name, graph_json) VALUES (?, ?)').run('wf test', JSON.stringify(graph))
    assert.deepEqual(buildModelUsage().slots.find((entry) => entry.id === row), { id: row, workflowNodes: 2 })
  })

  await t.test('representative models route to a model row across connections; re-pointing one reaches everything that picked it', async () => {
    const { resolveSummaryPrompt, DEFAULT_CHAT_SUMMARY_PROMPT } = await import('../src/services/codex-chat/chatProfiles')
    const chatRoute = ModelSlotStore.routeId('chat')!
    const summaryRoute = ModelSlotStore.routeId('summary')!
    const judgeRoute = ModelSlotStore.routeId('judge')!
    assert.deepEqual(ModelSlotStore.list().filter((slot) => slot.kind === 'route').map((slot) => slot.routeKey), ['chat', 'summary', 'translation', 'suggest', 'judge'], 'the built-in routes come first, in part order')

    const a = ModelSlotStore.ensure('conn-b', 'route-a')!
    const b = ModelSlotStore.ensure('conn-a', 'route-b')!
    ModelSlotStore.updateRoute(chatRoute, { targetSlotId: a })
    const profile = ChatProfileStore.create({ name: 'routed', engine: 'llm', modelSlotId: chatRoute })
    const chat = resolveProfileModel(profile, 'chat')!
    assert.deepEqual([chat.providerName, chat.model, chat.slotId, chat.routeId], ['conn-b', 'route-a', a, chatRoute])
    assert.deepEqual([resolveProfileModel(profile, 'summary')?.model, resolveProfileModel(profile, 'summary')?.via], ['route-a', 'inherit'], 'the summary route follows the chat model')
    ModelSlotStore.updateRoute(chatRoute, { targetSlotId: b })
    assert.equal(resolveProfileModel(ChatProfileStore.find(profile.id)!, 'chat')?.model, 'route-b', 'the profile follows without being saved again, onto another connection')

    ModelSlotStore.updateRoute(summaryRoute, { targetSlotId: a })
    assert.deepEqual([resolveProfileModel(profile, 'summary')?.model, resolveProfileModel(profile, 'summary')?.via], ['route-a', 'default'], 'a summary route with a target is what an empty summary uses')
    const pinned = { ...profile, summarySlotId: summaryRoute }
    ModelSlotStore.updateRoute(summaryRoute, { targetSlotId: null })
    assert.equal(resolveProfileModel(pinned, 'summary')?.model, 'route-b', 'picking a summary route that follows the chat model follows the profile chat model')

    assert.throws(() => ModelSlotStore.updateRoute(chatRoute, { targetSlotId: null }), /비워둘 수 없어/)
    assert.throws(() => ModelSlotStore.updateRoute(chatRoute, { targetSlotId: rowOf('jev', 'jev-latest') }), /LLM 연결의 모델만/)
    assert.throws(() => ModelSlotStore.updateRoute(chatRoute, { targetSlotId: summaryRoute }), /연결의 모델만/)
    ModelSlotStore.updateRoute(judgeRoute, { targetSlotId: rowOf('jev', 'jev-latest') })
    assert.equal(ModelSlotStore.defaultJudgeTarget()?.model, 'jev-latest')
    assert.throws(() => ModelSlotStore.delete(rowOf('jev', 'jev-latest')!), /대표모델 판단/, 'the judge route holds its row')
    assert.throws(() => ModelSlotStore.delete(judgeRoute), /기본 대표모델은 지울 수 없어/)

    assert.equal(resolveSummaryPrompt(profile), DEFAULT_CHAT_SUMMARY_PROMPT)
    ModelSlotStore.updateRoute(summaryRoute, { prompt: '  짧게 요약해.  ' })
    assert.equal(resolveSummaryPrompt(profile), '짧게 요약해.', 'an empty summary prompt uses the part default')
    assert.equal(resolveSummaryPrompt({ ...profile, summaryPrompt: '내 요약' }), '내 요약', 'the profile own prompt wins')
    ModelSlotStore.updateRoute(summaryRoute, { prompt: '' })

    const fast = ModelSlotStore.createRoute({ name: '빠른 모델', targetSlotId: a })!
    assert.deepEqual([fast.kind, fast.routeKey, fast.label, fast.model], ['route', null, '대표 · 빠른 모델', 'route-a'])
    assert.throws(() => ModelSlotStore.createRoute({ name: '대화', targetSlotId: a }), /같은 이름/)
    assert.throws(() => ModelSlotStore.createRoute({ name: '빈 것' }), /가리킬 모델/)
    const user = ChatProfileStore.create({ name: 'fast-user', engine: 'llm', modelSlotId: fast.id })
    assert.throws(() => ModelSlotStore.delete(a), /대표모델 빠른 모델/, 'a named route holds its row')
    assert.throws(() => ModelSlotStore.delete(fast.id), /쓰는 곳이 있어서 지울 수 없어: fast-user/)
    ChatProfileStore.delete(user.id)
    assert.equal(ModelSlotStore.delete(fast.id), true)
    ChatProfileStore.delete(profile.id)
  })

  await t.test('route migration: the ★ / ⚖ rows a reference held move onto the chat / judge routes, other picks stay', async () => {
    const { migrateLlmModelRoutes } = await import('../src/database/llmModelRoutesMigration')
    const star = ModelSlotStore.ensure('conn-b', 'mig-star')!
    const other = ModelSlotStore.ensure('conn-b', 'mig-other')!
    const judge = rowOf('jev', 'jev-latest')!
    db.prepare('DELETE FROM llm_model_slots WHERE is_route = 1').run()
    db.prepare('UPDATE llm_model_slots SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END, is_default_judge = CASE WHEN id = ? THEN 1 ELSE 0 END').run(star, judge)
    const auto = ChatProfileStore.create({ name: 'auto', engine: 'llm', modelSlotId: star, summarySlotId: other, judgeSlotId: judge })
    const preset = ChatJudgePresetStore.create({ name: 'mig', items: [], modelSlotId: judge, escalationSlotId: star })
    migrateLlmModelRoutes(db)
    const chatRoute = ModelSlotStore.routeId('chat')!
    const judgeRoute = ModelSlotStore.routeId('judge')!
    assert.equal(ModelSlotStore.defaultTarget()?.id, star)
    assert.equal(ModelSlotStore.defaultJudgeTarget()?.id, judge)
    const migrated = ChatProfileStore.find(auto.id)!
    assert.deepEqual([migrated.modelSlotId, migrated.summarySlotId, migrated.judgeSlotId], [chatRoute, other, judgeRoute])
    const migratedPreset = ChatJudgePresetStore.find(preset.id)!
    assert.deepEqual([migratedPreset.modelSlotId, migratedPreset.escalationSlotId], [judgeRoute, chatRoute])
    migrateLlmModelRoutes(db)
    assert.equal(ModelSlotStore.list().filter((slot) => slot.kind === 'route').length, 5, 'runs once')
    ChatJudgePresetStore.delete(preset.id)
    ChatProfileStore.delete(auto.id)
  })
})
