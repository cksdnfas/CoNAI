import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

test('model slots: store, per-role resolution, adoption, deletion, usage', { timeout: 60000 }, async (t) => {
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
  const { ChatProfileStore, ChatProfileError } = await import('../src/services/codex-chat/chatProfiles')
  const { ModelSlotStore, modelReferencesOfConnection } = await import('../src/services/codex-chat/modelSlots')
  const { resolveProfileModel, hasTranslation, modelLabelOf } = await import('../src/services/codex-chat/chatModelRoles')
  const { buildModelUsage } = await import('../src/services/codex-chat/modelUsage')

  for (const [name, type] of [['conn-a', 'llm_openai_compatible'], ['conn-b', 'llm_ollama'], ['plain', 'general']] as const) {
    ExternalApiProvider.create({ provider_name: name, display_name: `Display ${name}`, provider_type: type, base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: `${name}-default` } })
  }
  const llmProfile = (name: string, extra: Record<string, unknown> = {}) => ChatProfileStore.create({ name, engine: 'llm', providerName: 'conn-a', ...extra })
  const asLegacy = (profile: ReturnType<typeof ChatProfileStore.create>) => ({ ...profile, modelSlotId: null, summarySlotId: null, translationSlotId: null, suggestSlotId: null })

  await t.test('Claude profiles persist their engine without an API connection and use the Claude transport', () => {
    const profile = ChatProfileStore.create({ name: 'Claude', engine: 'claude', model: 'sonnet', providerName: 'conn-a' })
    assert.equal(ChatProfileStore.find(profile.id)?.engine, 'claude')
    assert.equal(profile.providerName, '')
    assert.equal(profile.modelSlotId, null)
    assert.equal(resolveProfileModel(profile, 'chat')?.providerName, '__conai_claude_code__')
    assert.equal(modelLabelOf(profile), 'Claude Code · sonnet')
    ChatProfileStore.delete(profile.id)
  })

  await t.test('profiles with no slot ids resolve exactly like the old direct expressions', () => {
    assert.equal(ModelSlotStore.list().length, 0)
    const legacy = {
      chat: (p: any) => p.engine === 'llm' && p.providerName ? { providerName: p.providerName, model: p.model || null } : null,
      summary: (p: any) => {
        const providerName = p.summaryProviderName || p.providerName
        return providerName ? { providerName, model: p.summaryProviderName ? p.summaryModel || null : p.summaryModel || p.model || null } : null
      },
      suggest: (p: any) => {
        const providerName = p.suggestProviderName || (p.engine === 'llm' ? p.providerName : '')
        return providerName ? { providerName, model: p.suggestProviderName ? p.suggestModel || null : p.suggestModel || p.model || null } : null
      },
      translation: (p: any) => (p.translationProviderName ? { providerName: p.translationProviderName, model: p.translationModel || null } : null),
    }
    const inputs: Array<Record<string, unknown>> = []
    for (const engine of ['llm', 'codex'] as const) {
      for (const model of ['', 'chat-model']) {
        for (const aux of [
          {},
          { summaryModel: 'sum-model' },
          { summaryProviderName: 'conn-b' },
          { summaryProviderName: 'conn-b', summaryModel: 'sum-model' },
          { translationProviderName: 'conn-b' },
          { translationProviderName: 'conn-b', translationModel: 'tr-model' },
          { translationModel: 'orphan-model' },
          { suggestModel: 'sg-model' },
          { suggestProviderName: 'conn-b', suggestModel: 'sg-model' },
        ]) {
          inputs.push({ engine, model, ...(engine === 'llm' ? { providerName: 'conn-a' } : {}), ...aux })
        }
      }
    }
    inputs.forEach((input, index) => {
      const profile = ChatProfileStore.create({ name: `legacy-${index}`, ...input })
      for (const role of ['chat', 'summary', 'suggest', 'translation'] as const) {
        const expected = legacy[role](profile)
        const actual = resolveProfileModel(profile, role)
        assert.deepEqual(actual && { providerName: actual.providerName, model: actual.model }, expected, `${JSON.stringify(input)} ${role}`)
      }
      assert.equal(hasTranslation(profile), Boolean(profile.translationProviderName))
      ChatProfileStore.delete(profile.id)
    })
  })

  await t.test('slot CRUD: validation, unique name, single default', () => {
    const { slot: chat } = ModelSlotStore.create({ name: '대화', providerName: 'conn-a', model: 'big', isDefault: true })
    assert.equal(chat.isDefault, true)
    assert.equal(ModelSlotStore.findDefault()?.id, chat.id)
    assert.throws(() => ModelSlotStore.create({ name: '대화', providerName: 'conn-a', model: 'x' }), { message: '같은 이름의 모델이 이미 있어.' })
    assert.throws(() => ModelSlotStore.create({ name: '  대화', providerName: 'conn-a', model: 'x' }), { message: '같은 이름의 모델이 이미 있어.' })
    assert.throws(() => ModelSlotStore.create({ name: 'ABC'.toLowerCase(), providerName: 'nope', model: 'x' }), { message: 'LLM 연결을 찾을 수 없어.' })
    assert.throws(() => ModelSlotStore.create({ name: 'abc', providerName: 'plain', model: 'x' }), { message: 'LLM 연결을 찾을 수 없어.' })
    assert.throws(() => ModelSlotStore.create({ name: 'abc', providerName: 'conn-a', model: '' }), ChatProfileError)
    assert.throws(() => ModelSlotStore.create({ name: '', providerName: 'conn-a', model: 'x' }), ChatProfileError)
    assert.throws(() => ModelSlotStore.create({ name: 'x'.repeat(81), providerName: 'conn-a', model: 'x' }), ChatProfileError)
    assert.throws(() => ModelSlotStore.create({ name: 'abc', providerName: 'conn-a', model: 'm'.repeat(201) }), ChatProfileError)
    assert.equal(ModelSlotStore.list().length, 1, 'failed creates leave nothing behind')

    const { slot: aux } = ModelSlotStore.create({ name: 'Aux', providerName: 'conn-b', model: 'small' })
    assert.equal(aux.isDefault, false)
    assert.throws(() => ModelSlotStore.update(aux.id, { name: '대화' }), { message: '같은 이름의 모델이 이미 있어.' })
    assert.throws(() => ModelSlotStore.update(aux.id, { name: 'aux2' }) && ModelSlotStore.update(aux.id, { name: 'AUX' }) && ModelSlotStore.create({ name: 'aux', providerName: 'conn-a', model: 'x' }), { message: '같은 이름의 모델이 이미 있어.' })
    assert.equal(ModelSlotStore.update(aux.id, { name: 'Aux' })?.slot.name, 'Aux', 'renaming to its own name (any case) is allowed')
    ModelSlotStore.update(aux.id, { isDefault: true })
    assert.deepEqual(ModelSlotStore.list().filter((slot) => slot.isDefault).map((slot) => slot.name), ['Aux'])
    ModelSlotStore.setDefault(chat.id)
    assert.deepEqual(ModelSlotStore.list().filter((slot) => slot.isDefault).map((slot) => slot.name), ['대화'])
    assert.equal(ModelSlotStore.update(9999, { name: 'x' }), null)
    assert.equal(ModelSlotStore.setDefault(9999), null)
    assert.equal(ModelSlotStore.update(aux.id, { model: 'smaller' })?.slot.model, 'smaller')
    assert.equal(ModelSlotStore.find(aux.id)?.providerName, 'conn-b', 'fields left out keep their value')
    // Deleting the default leaves no default.
    assert.equal(ModelSlotStore.delete(chat.id), true)
    assert.equal(ModelSlotStore.findDefault(), null)
    assert.equal(ModelSlotStore.delete(chat.id), false)
    ModelSlotStore.delete(aux.id)
    assert.equal(ModelSlotStore.list().length, 0)
  })

  await t.test('profile validation of slot ids and the slot-only llm profile', () => {
    assert.throws(() => ChatProfileStore.create({ name: 'bad', engine: 'llm', providerName: 'conn-a', modelSlotId: 999 }), { message: '모델을 찾을 수 없어.' })
    assert.throws(() => ChatProfileStore.create({ name: 'bad', engine: 'llm', providerName: 'conn-a', summarySlotId: 999 }), { message: '모델을 찾을 수 없어.' })
    assert.throws(() => ChatProfileStore.create({ name: 'bad', engine: 'llm' }), { message: 'LLM 연결을 골라줘.' })
    const { slot } = ModelSlotStore.create({ name: 'Chat', providerName: 'conn-a', model: 'big' })
    const slotOnly = ChatProfileStore.create({ name: 'slot-only', engine: 'llm', modelSlotId: slot.id })
    assert.equal(slotOnly.providerName, '')
    assert.equal(slotOnly.modelSlotId, slot.id)
    const codex = ChatProfileStore.create({ name: 'codex', engine: 'codex', modelSlotId: slot.id, translationSlotId: slot.id })
    assert.equal(codex.modelSlotId, null, 'codex has no chat slot')
    assert.equal(codex.translationSlotId, slot.id, 'but its helper roles may use slots')
    assert.equal(resolveProfileModel(codex, 'chat'), null)
    assert.equal(resolveProfileModel(codex, 'translation')?.via, 'slot')
    assert.equal(resolveProfileModel(codex, 'summary'), null, 'codex has no chat connection to inherit')
    assert.equal(resolveProfileModel(codex, 'suggest'), null)
    ChatProfileStore.delete(slotOnly.id)
    ChatProfileStore.delete(codex.id)
    ModelSlotStore.delete(slot.id)
  })

  await t.test('resolution precedence for every role, including inherit and default fallback', () => {
    const chatSlot = ModelSlotStore.create({ name: 'chat', providerName: 'conn-a', model: 'big' }).slot
    const auxSlot = ModelSlotStore.create({ name: 'aux', providerName: 'conn-b', model: 'small' }).slot
    const pick = (resolved: ReturnType<typeof resolveProfileModel>) => resolved && [resolved.via, resolved.providerName, resolved.model, resolved.slotId]

    // chat: slot > direct > default slot > null
    const slotted = llmProfile('p-slot', { model: 'direct-model', modelSlotId: chatSlot.id })
    assert.deepEqual(pick(resolveProfileModel(slotted, 'chat')), ['slot', 'conn-a', 'big', chatSlot.id])
    const direct = llmProfile('p-direct', { model: 'direct-model' })
    assert.deepEqual(pick(resolveProfileModel(direct, 'chat')), ['direct', 'conn-a', 'direct-model', null])
    assert.deepEqual(pick(resolveProfileModel(llmProfile('p-direct-empty'), 'chat')), ['direct', 'conn-a', null, null])
    const bare = { ...asLegacy(direct), providerName: '', model: '' }
    assert.equal(resolveProfileModel(bare, 'chat'), null, 'no slot, no connection, no default slot')
    ModelSlotStore.setDefault(auxSlot.id)
    assert.deepEqual(pick(resolveProfileModel(bare, 'chat')), ['default', 'conn-b', 'small', auxSlot.id])
    assert.deepEqual(pick(resolveProfileModel({ ...bare, modelSlotId: 12345 }, 'chat')), ['default', 'conn-b', 'small', auxSlot.id], 'a missing slot id counts as unset')

    // summary / suggest: slot > direct > inherit chat (own model overrides)
    const mixed = llmProfile('p-mixed', { model: 'chat-model', summarySlotId: auxSlot.id, suggestProviderName: 'conn-b', suggestModel: 'sg' })
    assert.deepEqual(pick(resolveProfileModel(mixed, 'summary')), ['slot', 'conn-b', 'small', auxSlot.id])
    assert.deepEqual(pick(resolveProfileModel(mixed, 'suggest')), ['direct', 'conn-b', 'sg', null])
    const inheriting = llmProfile('p-inherit', { model: 'chat-model', summaryModel: 'sum-only' })
    assert.deepEqual(pick(resolveProfileModel(inheriting, 'summary')), ['inherit', 'conn-a', 'sum-only', null])
    assert.deepEqual(pick(resolveProfileModel(inheriting, 'suggest')), ['inherit', 'conn-a', 'chat-model', null])
    const viaSlot = llmProfile('p-inherit-slot', { modelSlotId: chatSlot.id })
    assert.deepEqual(pick(resolveProfileModel(viaSlot, 'summary')), ['inherit', 'conn-a', 'big', chatSlot.id])
    assert.equal(resolveProfileModel(inheriting, 'summary')?.slotName, null)

    // translation: slot > direct > off
    assert.equal(resolveProfileModel(inheriting, 'translation'), null)
    assert.equal(hasTranslation(inheriting), false)
    assert.deepEqual(pick(resolveProfileModel(llmProfile('p-tr', { translationSlotId: auxSlot.id }), 'translation')), ['slot', 'conn-b', 'small', auxSlot.id])
    assert.deepEqual(pick(resolveProfileModel(llmProfile('p-tr2', { translationProviderName: 'conn-b', translationModel: 'tm' }), 'translation')), ['direct', 'conn-b', 'tm', null])
    assert.equal(hasTranslation(llmProfile('p-tr3', { translationSlotId: auxSlot.id })), true)

    // a slot's model change reaches every role that uses it at once
    ModelSlotStore.update(chatSlot.id, { model: 'bigger' })
    assert.equal(resolveProfileModel(ChatProfileStore.find(slotted.id)!, 'chat')?.model, 'bigger')
    assert.equal(resolveProfileModel(ChatProfileStore.find(viaSlot.id)!, 'summary')?.model, 'bigger')

    // the line the chat UI shows
    assert.equal(modelLabelOf(ChatProfileStore.find(slotted.id)!), 'chat · bigger')
    assert.equal(modelLabelOf(direct), 'Display conn-a · direct-model')
    assert.equal(modelLabelOf(llmProfile('p-label')), 'Display conn-a · conn-a-default')
    assert.equal(modelLabelOf(ChatProfileStore.create({ name: 'cx', engine: 'codex' })), 'Codex · 기본 모델')
    for (const profile of ChatProfileStore.list()) ChatProfileStore.delete(profile.id)
    for (const slot of ModelSlotStore.list()) ModelSlotStore.delete(slot.id)
  })

  await t.test('adoptProfiles binds only exact direct matches with no slot yet', () => {
    const exact = llmProfile('exact', { model: 'm1', summaryProviderName: 'conn-a', summaryModel: 'm1', translationProviderName: 'conn-a', translationModel: 'm1', suggestProviderName: 'conn-a', suggestModel: 'm1' })
    const otherModel = llmProfile('other-model', { model: 'm2' })
    const otherConn = ChatProfileStore.create({ name: 'other-conn', engine: 'llm', providerName: 'conn-b', model: 'm1' })
    const emptyModel = llmProfile('empty-model', { model: '' })
    const codex = ChatProfileStore.create({ name: 'codex', engine: 'codex', model: 'm1', summaryProviderName: 'conn-a', summaryModel: 'm1' })
    const preSlotted = ModelSlotStore.create({ name: 'pre', providerName: 'conn-b', model: 'zzz' }).slot
    const alreadySlotted = llmProfile('already', { model: 'm1', modelSlotId: preSlotted.id })

    const plain = ModelSlotStore.create({ name: 'no-adopt', providerName: 'conn-a', model: 'm1' })
    assert.deepEqual(plain.adopted, { chat: 0, summary: 0, translation: 0, suggest: 0 })
    assert.equal(ChatProfileStore.find(exact.id)?.modelSlotId, null)

    const { slot, adopted } = ModelSlotStore.update(plain.slot.id, { adoptProfiles: true })!
    // chat: exact only (not other model/connection, not empty model, not codex, not the already-slotted one); the helper roles also count codex.
    assert.deepEqual(adopted, { chat: 1, summary: 2, translation: 1, suggest: 1 })
    const adoptedExact = ChatProfileStore.find(exact.id)!
    assert.deepEqual([adoptedExact.modelSlotId, adoptedExact.summarySlotId, adoptedExact.translationSlotId, adoptedExact.suggestSlotId], [slot.id, slot.id, slot.id, slot.id])
    assert.equal(ChatProfileStore.find(otherModel.id)?.modelSlotId, null)
    assert.equal(ChatProfileStore.find(otherConn.id)?.modelSlotId, null)
    assert.equal(ChatProfileStore.find(emptyModel.id)?.modelSlotId, null, 'an empty model is the connection default, not a named model')
    assert.equal(ChatProfileStore.find(codex.id)?.modelSlotId, null)
    assert.equal(ChatProfileStore.find(codex.id)?.summarySlotId, slot.id)
    assert.equal(ChatProfileStore.find(alreadySlotted.id)?.modelSlotId, preSlotted.id)
    assert.deepEqual(slot.profiles.find((profile) => profile.id === exact.id)?.roles, ['chat', 'summary', 'translation', 'suggest'])

    // creating with the option adopts too, and a second run adopts nothing new
    const created = ModelSlotStore.create({ name: 'adopt-on-create', providerName: 'conn-a', model: 'm2', adoptProfiles: true })
    assert.equal(created.adopted.chat, 1)
    assert.equal(ChatProfileStore.find(otherModel.id)?.modelSlotId, created.slot.id)
    assert.deepEqual(ModelSlotStore.update(created.slot.id, { adoptProfiles: true })!.adopted, { chat: 0, summary: 0, translation: 0, suggest: 0 })
  })

  await t.test('deleting a slot nulls profile references; connection references block deletion', () => {
    const slot = ModelSlotStore.find(ModelSlotStore.list().find((entry) => entry.name === 'no-adopt')!.id)!
    const users = slot.profiles.map((profile) => profile.id)
    assert.ok(users.length >= 2)
    assert.equal(ModelSlotStore.delete(slot.id), true)
    for (const id of users) {
      const profile = ChatProfileStore.find(id)!
      assert.deepEqual([profile.modelSlotId, profile.summarySlotId, profile.translationSlotId, profile.suggestSlotId], [null, null, null, null])
      assert.equal(db.prepare('SELECT model_slot_id, summary_slot_id, translation_slot_id, suggest_slot_id FROM llm_chat_profiles WHERE id = ?').get(id) !== undefined, true)
    }
    const raw = db.prepare('SELECT COUNT(*) AS count FROM llm_chat_profiles WHERE model_slot_id = ? OR summary_slot_id = ? OR translation_slot_id = ? OR suggest_slot_id = ?').get(slot.id, slot.id, slot.id, slot.id) as { count: number }
    assert.equal(raw.count, 0, 'the columns themselves are cleared')
    // direct pairs survive the slot, so the profile keeps working as before
    assert.equal(resolveProfileModel(ChatProfileStore.find(users[0])!, 'chat')?.via, 'direct')

    // a stale slot id written behind the store's back reads as unset, and a save clears it
    const victim = llmProfile('stale')
    db.prepare('UPDATE llm_chat_profiles SET model_slot_id = 424242 WHERE id = ?').run(victim.id)
    assert.equal(ChatProfileStore.find(victim.id)?.modelSlotId, null)
    ChatProfileStore.update(victim.id, { tagline: 'saved' })
    assert.equal((db.prepare('SELECT model_slot_id FROM llm_chat_profiles WHERE id = ?').get(victim.id) as { model_slot_id: number | null }).model_slot_id, null)

    const refs = modelReferencesOfConnection('conn-b')
    assert.ok(refs.slots.includes('pre'))
    assert.ok(refs.profiles.includes('other-conn'))
    assert.deepEqual(modelReferencesOfConnection('plain'), { slots: [], profiles: [] })
  })

  await t.test('usage lists slots, direct profiles per connection and saved workflow LLM nodes', () => {
    let moduleId = (db.prepare("SELECT id FROM module_definitions WHERE internal_fixed_values LIKE '%system.call_llm%' LIMIT 1").get() as { id: number } | undefined)?.id
    if (moduleId === undefined) {
      moduleId = Number(db.prepare(`
        INSERT INTO module_definitions (name, engine_type, authoring_source, template_defaults, exposed_inputs, output_ports, internal_fixed_values)
        VALUES ('test llm', 'system', 'manual', '{}', '[]', '[]', '{"operation_key":"system.call_llm"}')
      `).run().lastInsertRowid)
    }
    const slot = ModelSlotStore.create({ name: 'wf', providerName: 'conn-a', model: 'wf-model' }).slot
    const viaSlot = llmProfile('wf-slot-profile', { modelSlotId: slot.id })
    const viaDirect = ChatProfileStore.create({ name: 'wf-direct-profile', engine: 'llm', providerName: 'conn-b', model: 'x' })
    const graph = {
      nodes: [
        { id: 'a', module_id: moduleId, input_values: { profile_id: viaSlot.id } },
        { id: 'b', module_id: moduleId, input_values: { profile_id: viaSlot.id } },
        { id: 'c', module_id: moduleId, input_values: { profile_id: viaDirect.id } },
        { id: 'd', module_id: moduleId, input_values: { provider_name: 'conn-a' } },
        { id: 'e', module_id: moduleId + 1000, input_values: { profile_id: viaSlot.id } },
      ],
      edges: [],
    }
    db.prepare('INSERT INTO graph_workflows (name, graph_json) VALUES (?, ?)').run('wf test', JSON.stringify(graph))

    const usage = buildModelUsage()
    const slotUsage = usage.slots.find((entry) => entry.id === slot.id)!
    assert.deepEqual(slotUsage.profiles, [{ id: viaSlot.id, name: 'wf-slot-profile', roles: ['chat'] }])
    assert.equal(slotUsage.workflowNodes, 2)
    const connA = usage.connections.find((entry) => entry.providerName === 'conn-a')!
    const connB = usage.connections.find((entry) => entry.providerName === 'conn-b')!
    assert.equal(usage.connections.some((entry) => entry.providerName === 'plain'), false, 'only LLM connections')
    assert.ok(connA.slots.some((entry) => entry.id === slot.id))
    assert.equal(connA.workflowNodes, 2, 'nodes whose profile chats through the connection, via slot')
    assert.equal(connB.workflowNodes, 1)
    assert.ok(connB.directProfiles.some((entry) => entry.id === viaDirect.id && entry.roles.join() === 'chat'))
    assert.equal(connA.directProfiles.some((entry) => entry.id === viaSlot.id), false, 'a slot-backed role is not direct use')
  })
})
