import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import sharp from 'sharp'
import type { ChatCompletionMessage } from '../src/services/codex-chat/llmChatCompletion'

test('workflow LLM nodes: model resolution, chat-path requests, usage, new nodes, option lists, saved-graph migration', { timeout: 60000 }, async (t) => {
  // Load runtime modules only after isolating every data path. Never open the user's databases.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-workflow-llm-test-'))
  process.env.RUNTIME_BASE_PATH = root
  process.env.RUNTIME_DATABASE_DIR = path.join(root, 'database')
  process.env.RUNTIME_SAVE_DIR = path.join(root, 'save')
  process.env.RUNTIME_TEMP_DIR = path.join(root, 'temp')
  const dbModule = await import('../src/database/userSettingsDb')
  dbModule.initializeUserSettingsDb()
  t.after(async () => {
    dbModule.closeUserSettingsDb()
    ;(await import('../src/database/init')).closeDatabase()
    const { logger } = await import('../src/utils/logger')
    await new Promise<void>((resolve) => logger.close(resolve))
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('conai-workflow-llm-test-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const db = dbModule.getUserSettingsDb()
  const { ensureBuiltinSystemModules } = await import('../src/database/userSettingsBuiltinModules')
  ensureBuiltinSystemModules(db)
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { ChatLorebookStore } = await import('../src/services/codex-chat/chatLorebook')
  const { ModelSlotStore } = await import('../src/services/codex-chat/modelSlots')
  const { buildModelUsage } = await import('../src/services/codex-chat/modelUsage')
  const { APPEARANCE_DRAFT_PROMPT } = await import('../src/services/codex-chat/chatAppearanceDraft')
  const { readCodexExecUsage } = await import('../src/services/codexMessageService')
  const { resolveWorkflowLlm } = await import('../src/services/graph-workflow-executor/workflow-llm-runtime')
  const { executeCallLlmNode } = await import('../src/services/graph-workflow-executor/system-llm-operations')
  const { buildChatProfileReplyMessages } = await import('../src/services/graph-workflow-executor/system-llm-node-operations')
  const { LLM_NODE_HANDLERS } = await import('../src/services/graph-workflow-executor/system-llm-node-handlers')
  const { LLM_NODE_OPTION_SOURCES } = await import('../src/services/graph-workflow-executor/node-option-sources-llm')
  const { BUILTIN_LLM_NODE_DEFINITIONS } = await import('../src/database/userSettingsBuiltinLlmModuleDefinitionData')
  const { migrateWorkflowLlmNodes } = await import('../src/database/workflowLlmNodeMigration')

  for (const [name, type] of [['strata', 'llm_openai_compatible'], ['olla', 'llm_ollama'], ['jev', 'decision_typesafe']] as const) {
    ExternalApiProvider.create({ provider_name: name, display_name: `Display ${name}`, provider_type: type, base_url: 'http://unused.invalid', is_enabled: true, additional_config: {} })
  }
  const gemma = ModelSlotStore.ensure('strata', 'gemma-4')!
  const qwen = ModelSlotStore.ensure('olla', 'qwen3')!
  const jev = ModelSlotStore.ensure('jev', 'jev-latest')!
  assert.equal(ModelSlotStore.defaultTarget()?.id, gemma, 'the first LLM row is the ★ default')

  // Every request goes to this stand-in server; nothing leaves the process.
  const requests: Array<{ url: string; body: { model: string; messages: ChatCompletionMessage[]; temperature?: number; max_tokens?: number; reasoning_effort?: string } }> = []
  let answer = 'ok'
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) })
    return Response.json({ choices: [{ message: { content: answer }, finish_reason: 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 3 } })
  })
  const lastRequest = () => requests[requests.length - 1].body
  const lastUsage = () => db.prepare('SELECT purpose, engine, provider_name, model, profile_id FROM llm_usage_events ORDER BY id DESC LIMIT 1').get()
  const textOf = (message: ChatCompletionMessage | undefined) => {
    const content = message?.content
    if (typeof content === 'string') return content
    return Array.isArray(content) ? content.map((part) => (part.type === 'text' ? part.text : '')).join('\n') : ''
  }

  const workflowId = Number(db.prepare("INSERT INTO graph_workflows (name, graph_json) VALUES ('llm nodes', '{\"nodes\":[],\"edges\":[]}')").run().lastInsertRowid)
  const executionId = Number(db.prepare('INSERT INTO graph_executions (graph_workflow_id, graph_version) VALUES (?, 1)').run(workflowId).lastInsertRowid)
  const context = () => ({
    executionId,
    workflow: {} as never,
    modulesById: new Map(),
    artifactsByNode: new Map(),
    debugMode: false,
    signal: new AbortController().signal,
    abort: () => {},
    getAbortReason: () => null,
  })
  const node = { id: 'n1', module_id: 1, position: { x: 0, y: 0 } }
  const definition = { name: 'test node' } as never
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#3366cc' } }).png().toBuffer()
  const pngDataUrl = `data:image/png;base64,${png.toString('base64')}`

  const sera = ChatProfileStore.create({ name: '세라', engine: 'llm', modelSlotId: qwen, temperature: 0.9, systemPrompt: 'You are Sera.', authorNote: 'NOTE_TEXT',
    promptSections: [{ id: 'post', title: '', kind: 'post', enabled: true, content: 'Stay in character.' }] })
  const claude = ChatProfileStore.create({ name: '클로드', engine: 'claude', model: 'sonnet' })
  const codex = ChatProfileStore.create({ name: '코덱스', engine: 'codex', model: 'gpt-5.5', reasoningEffort: 'high' })
  const off = ChatProfileStore.create({ name: '꺼짐이', engine: 'llm', isEnabled: false })

  await t.test('resolution: ★ default, a row, a profile, a row over an API profile, other engines, legacy pairs, errors', () => {
    assert.deepEqual((({ engine, providerName, model, via }) => ({ engine, providerName, model, via }))(resolveWorkflowLlm({}) as { engine: string; providerName: string; model: string; via: string }), { engine: 'api', providerName: 'strata', model: 'gemma-4', via: 'default' })
    assert.equal((resolveWorkflowLlm({ modelSlotId: qwen }) as { model: string }).model, 'qwen3')
    assert.throws(() => resolveWorkflowLlm({ modelSlotId: jev }), /판단 전용/)
    assert.throws(() => resolveWorkflowLlm({ modelSlotId: 99999 }), /모델을 찾을 수 없어/)

    const viaProfile = resolveWorkflowLlm({ profileId: sera.id })
    assert.equal(viaProfile.engine, 'api')
    assert.equal(viaProfile.engine === 'api' && viaProfile.model, 'qwen3')
    assert.equal(viaProfile.engine === 'api' && viaProfile.profileGeneration.temperature, 0.9)
    const rowOverProfile = resolveWorkflowLlm({ profileId: sera.id, modelSlotId: gemma })
    assert.equal(rowOverProfile.engine === 'api' && rowOverProfile.model, 'gemma-4', 'a row replaces an API profile\'s model')
    assert.equal(rowOverProfile.engine === 'api' && rowOverProfile.profileGeneration.temperature, 0.9, 'and keeps its options')

    const viaClaude = resolveWorkflowLlm({ profileId: claude.id, modelSlotId: gemma })
    assert.equal(viaClaude.engine, 'claude-code', 'a Claude Code profile keeps its engine')
    assert.equal(viaClaude.engine === 'claude-code' && viaClaude.model, 'sonnet')
    const viaCodex = resolveWorkflowLlm({ profileId: codex.id })
    assert.deepEqual(viaCodex.engine === 'codex' && [viaCodex.model, viaCodex.reasoningEffort], ['gpt-5.5', 'high'])

    assert.throws(() => resolveWorkflowLlm({ profileId: off.id }), /꺼진 프로필/)
    assert.throws(() => resolveWorkflowLlm({ profileId: 99999 }), /채팅 프로필을 찾을 수 없어/)
    const legacy = resolveWorkflowLlm({ legacy: { providerName: 'olla', model: 'other-model' } })
    assert.deepEqual(legacy.engine === 'api' && [legacy.providerName, legacy.model, legacy.via], ['olla', 'other-model', 'legacy'])
    const legacyPrimary = resolveWorkflowLlm({ legacy: { providerName: 'olla', model: null } })
    assert.equal(legacyPrimary.engine === 'api' && legacyPrimary.model, 'qwen3', 'an empty model is the connection\'s primary row')

    const translator = ChatProfileStore.create({ name: '번역가', engine: 'llm', modelSlotId: qwen, translationSlotId: gemma })
    assert.equal((resolveWorkflowLlm({ profileId: translator.id, role: 'translation' }) as { model: string }).model, 'gemma-4')
    assert.equal((resolveWorkflowLlm({ profileId: sera.id, role: 'translation' }) as { model: string }).model, 'qwen3', 'no translation row: the chat model')
  })

  await t.test('without a row, a profile or a ★ default the error says what to do', (s) => {
    s.mock.method(ModelSlotStore, 'defaultTarget', () => null)
    assert.throws(() => resolveWorkflowLlm({}), /기본 모델이 없어/)
  })

  await t.test('LLM 호출 goes through the chat completion path: node options win, JSON, image part, usage as workflow', async () => {
    answer = '```json\n{"mood":"happy"}\n```'
    const ctx = context()
    await executeCallLlmNode(ctx, node, definition, {
      prompt: '기분은?', system_prompt: 'SYSTEM_TEXT', structured_output_json: '{"mood":""}', image: pngDataUrl,
      profile_id: sera.id, temperature: 0.1, max_tokens: 50, reasoning_effort: 'low',
    })
    const body = lastRequest()
    assert.equal(body.model, 'qwen3')
    assert.deepEqual([body.temperature, body.max_tokens, body.reasoning_effort], [0.1, 50, 'low'])
    assert.equal(body.messages[0].role, 'system')
    assert.match(textOf(body.messages[0]), /SYSTEM_TEXT/)
    assert.match(textOf(body.messages[0]), /JSON/)
    const user = body.messages[body.messages.length - 1]
    assert.ok(Array.isArray(user.content) && user.content.some((part) => part.type === 'image_url' && part.image_url.url === pngDataUrl), 'the node image goes as an image part')
    const artifacts = ctx.artifactsByNode.get('n1')!
    assert.deepEqual(artifacts.json.value, { mood: 'happy' })
    assert.equal((artifacts.metadata.value as { model: string }).model, 'qwen3')
    assert.equal((artifacts.metadata.value as { profile_id: number }).profile_id, sera.id)
    assert.deepEqual(lastUsage(), { purpose: 'workflow', engine: 'api', provider_name: 'olla', model: 'qwen3', profile_id: sera.id })

    answer = 'plain answer'
    const empty = context()
    await executeCallLlmNode(empty, node, definition, { prompt: 'hi' })
    assert.equal(lastRequest().model, 'gemma-4', 'nothing picked: the ★ default row')
    assert.equal(empty.artifactsByNode.get('n1')!.text.value, 'plain answer')
    assert.equal(empty.artifactsByNode.get('n1')!.json, undefined)
    await executeCallLlmNode(context(), node, definition, { prompt: 'hi', provider_name: 'olla', model: 'legacy-model' })
    assert.equal(lastRequest().model, 'legacy-model', 'a saved connection + model still runs')
    await executeCallLlmNode(context(), node, definition, { prompt: 'hi', model_slot_id: String(qwen), provider_name: 'strata', model: 'ignored' })
    assert.equal(lastRequest().model, 'qwen3', 'a row wins over leftover pair keys')
  })

  await t.test('번역 asks for the language with the markup rules, cool and without thinking', async () => {
    answer = 'Hello'
    const ctx = context()
    await LLM_NODE_HANDLERS['system.translate_text'](ctx, node, definition, { text: '안녕', target_language: '日本語', instructions: 'KEEP_SHORT' })
    const body = lastRequest()
    assert.match(textOf(body.messages[0]), /into natural, fluent Japanese/)
    assert.match(textOf(body.messages[0]), /KEEP_SHORT/)
    assert.match(textOf(body.messages[0]), /fenced code blocks/)
    assert.equal(textOf(body.messages[1]), '안녕')
    assert.equal(body.temperature, 0.2)
    assert.equal(ctx.artifactsByNode.get('n1')!.text.value, 'Hello')
    await assert.rejects(Promise.resolve(LLM_NODE_HANDLERS['system.translate_text'](context(), node, definition, { text: '  ' })), /비어 있어/)
  })

  await t.test('판단 answers yes/no and choices with the judge model, against the threshold', async () => {
    answer = '{"answer":{"yes":0.8,"no":0.2}}'
    const ctx = context()
    await LLM_NODE_HANDLERS['system.judge_text'](ctx, node, definition, { text: '화났어!!', question: '화났어?' })
    let out = ctx.artifactsByNode.get('n1')!
    assert.deepEqual([out.yes.value, out.choice.value, out.probability.value], [true, 'yes', 0.8])
    assert.equal(lastRequest().model, 'gemma-4', 'the ★ default row judges when none is picked')
    assert.equal((lastUsage() as { purpose: string }).purpose, 'workflow')

    const strict = context()
    await LLM_NODE_HANDLERS['system.judge_text'](strict, node, definition, { text: '화났어!!', question: '화났어?', threshold: 0.9, model_slot_id: qwen })
    assert.equal(strict.artifactsByNode.get('n1')!.yes.value, false)
    assert.equal(lastRequest().model, 'qwen3')

    answer = '{"answer":{"A":0.1,"B":0.7,"C":0.2}}'
    const choice = context()
    await LLM_NODE_HANDLERS['system.judge_text'](choice, node, definition, { text: 'text', question: 'which?', mode: 'choice', choices: 'A\nB\n\nC\nB' })
    out = choice.artifactsByNode.get('n1')!
    assert.deepEqual([out.yes.value, out.choice.value, out.probability.value], [true, 'B', 0.7])
    assert.deepEqual((out.json.value as { distribution: Record<string, number> }).distribution, { A: 0.1, B: 0.7, C: 0.2 })
    await assert.rejects(Promise.resolve(LLM_NODE_HANDLERS['system.judge_text'](context(), node, definition, { text: 't', question: 'q', mode: 'choice', choices: 'only' })), /두 줄 이상/)
  })

  await t.test('캐릭터로 답하기 builds one chat turn: persona, history turns, lore, author note, post instructions', async () => {
    const book = ChatLorebookStore.create({ name: '세계', entries: [{ id: 'sea', title: '바다', keys: ['바다'], content: 'SEA_LORE_TEXT' }] })
    const profile = ChatProfileStore.update(sera.id, { lorebookIds: [book.id] })!
    const messages = buildChatProfileReplyMessages({ profile, message: '바다 가자', history: '사용자: 안녕\n세라: 반가워', userName: '민수', useLorebooks: true })
    assert.equal(messages[0].role, 'system')
    assert.match(textOf(messages[0]), /You are Sera\./)
    assert.deepEqual(messages.slice(1, 3).map((message) => message.role), ['user', 'assistant'])
    assert.ok(textOf(messages[1]).endsWith('안녕'))
    assert.equal(textOf(messages[2]), '반가워')
    // Lore and the author's note go in at the profile's depth (4: the oldest user turn here), as in a chat.
    assert.ok(textOf(messages[1]).includes('SEA_LORE_TEXT') && textOf(messages[1]).includes('NOTE_TEXT'))
    const last = textOf(messages[messages.length - 1])
    assert.ok(last.startsWith('바다 가자') && last.includes('Stay in character.'))
    const shallow = buildChatProfileReplyMessages({ profile: ChatProfileStore.update(sera.id, { loreDepth: 0 })!, message: '바다 가자', history: null, userName: null, useLorebooks: true })
    assert.ok(textOf(shallow[shallow.length - 1]).includes('SEA_LORE_TEXT'), 'depth 0: the message itself')
    const withoutLore = buildChatProfileReplyMessages({ profile, message: '바다 가자', history: null, userName: null, useLorebooks: false })
    assert.ok(!withoutLore.some((message) => textOf(message).includes('SEA_LORE_TEXT')))
    const freeHistory = buildChatProfileReplyMessages({ profile, message: 'hi', history: 'just notes', userName: null, useLorebooks: false })
    assert.match(textOf(freeHistory[freeHistory.length - 1]), /앞 대화\njust notes/)

    answer = '좋아!'
    const ctx = context()
    await LLM_NODE_HANDLERS['system.chat_profile_reply'](ctx, node, definition, { profile_id: sera.id, message: '바다 가자', history: '사용자: 안녕\n세라: 반가워' })
    assert.equal(ctx.artifactsByNode.get('n1')!.text.value, '좋아!')
    assert.equal(lastRequest().model, 'qwen3')
    assert.equal(lastRequest().temperature, 0.9, 'the profile\'s own options')
    assert.deepEqual(lastUsage(), { purpose: 'workflow', engine: 'api', provider_name: 'olla', model: 'qwen3', profile_id: sera.id })
    await assert.rejects(Promise.resolve(LLM_NODE_HANDLERS['system.chat_profile_reply'](context(), node, definition, { message: 'hi' })), /프로필을 골라줘/)
  })

  await t.test('외형 태그 uses the appearance prompt with the image as JPEG and a tag-sized output limit', async () => {
    answer = 'silver hair, red eyes'
    const ctx = context()
    await LLM_NODE_HANDLERS['system.draft_appearance_tags'](ctx, node, definition, { image: pngDataUrl, description: 'a girl' })
    const body = lastRequest()
    assert.equal(textOf(body.messages[0]), APPEARANCE_DRAFT_PROMPT)
    const content = body.messages[1].content
    assert.ok(Array.isArray(content))
    assert.equal(content[0].type === 'text' && content[0].text, 'a girl')
    assert.ok(content.some((part) => part.type === 'image_url' && part.image_url.url.startsWith('data:image/jpeg;base64,')))
    assert.equal(body.max_tokens, 1024)
    assert.equal(ctx.artifactsByNode.get('n1')!.tags.value, 'silver hair, red eyes')
    await LLM_NODE_HANDLERS['system.draft_appearance_tags'](context(), node, definition, { profile_id: sera.id })
    assert.match(textOf(lastRequest().messages[1]), /Character: 세라\nYou are Sera\./, 'the profile fills an empty description')
    await assert.rejects(Promise.resolve(LLM_NODE_HANDLERS['system.draft_appearance_tags'](context(), node, definition, {})), /설명이나 이미지/)
  })

  await t.test('option lists: LLM rows, judge rows, profiles', async () => {
    ExternalApiProvider.update('olla', { is_enabled: false })
    const rows = await LLM_NODE_OPTION_SOURCES.llm_model_rows({ accountId: null })
    assert.deepEqual(rows.slice(0, 2), [
      { value: String(gemma), label: 'gemma-4 · Display strata', is_default: true },
      { value: String(qwen), label: 'qwen3 · Display olla', disabled: true },
    ])
    assert.ok(!rows.some((row) => row.value === String(jev)), 'no TypeSafe rows for LLM nodes')
    const judges = await LLM_NODE_OPTION_SOURCES.judge_model_rows({ accountId: null })
    assert.ok(judges.some((row) => row.value === String(jev) && row.label === 'jev-latest · Display jev'))
    const profiles = await LLM_NODE_OPTION_SOURCES.chat_profiles({ accountId: null })
    assert.deepEqual(profiles.find((entry) => entry.value === String(off.id)), { value: String(off.id), label: '꺼짐이 (꺼짐)', disabled: true })
    assert.deepEqual(profiles.find((entry) => entry.value === String(codex.id)), { value: String(codex.id), label: '코덱스' })
    ExternalApiProvider.update('olla', { is_enabled: true })
  })

  await t.test('definitions: every new node has a handler; LLM 호출 picks a row, no longer a connection', () => {
    assert.deepEqual(BUILTIN_LLM_NODE_DEFINITIONS.map((entry) => entry.internalFixedValues.operation_key).sort(), Object.keys(LLM_NODE_HANDLERS).sort())
    const seeded = (operationKey: string) => {
      const row = db.prepare('SELECT exposed_inputs, ui_schema FROM module_definitions WHERE internal_fixed_values LIKE ?').get(`%"${operationKey}"%`) as { exposed_inputs: string; ui_schema: string }
      return {
        inputs: JSON.parse(row.exposed_inputs) as Array<{ key: string; required?: boolean; default_value?: unknown }>,
        ui: JSON.parse(row.ui_schema) as Array<{ key: string; options_source?: string; initial_option?: string; default_value?: unknown; options?: unknown }>,
      }
    }
    const llm = seeded('system.call_llm')
    assert.ok(!llm.inputs.some((input) => input.key === 'provider_name' || input.key === 'model'))
    assert.ok(!llm.inputs.some((input) => input.required))
    assert.equal(llm.ui.find((field) => field.key === 'model_slot_id')?.options_source, 'llm_model_rows')
    assert.equal(llm.ui.find((field) => field.key === 'profile_id')?.options_source, 'chat_profiles')
    // Codex models come only from the CLI's live list: no baked-in names or default, a new node starts on the newest.
    const codexNode = seeded('system.call_codex_message')
    const codexModelField = codexNode.ui.find((field) => field.key === 'model')
    assert.deepEqual([codexModelField?.options_source, codexModelField?.initial_option, codexModelField?.default_value, codexModelField?.options], ['codex_models', 'first', undefined, undefined])
    assert.equal(codexNode.inputs.find((input) => input.key === 'model')?.default_value, undefined)
    assert.equal(codexNode.ui.find((field) => field.key === 'reasoning_effort')?.options_source, 'codex_reasoning_efforts')
    assert.equal(typeof LLM_NODE_OPTION_SOURCES.codex_reasoning_efforts, 'function')
    assert.equal(seeded('system.judge_text').ui.find((field) => field.key === 'model_slot_id')?.options_source, 'judge_model_rows')
    for (const operationKey of Object.keys(LLM_NODE_HANDLERS)) assert.ok(seeded(operationKey).inputs.length > 0, operationKey)
  })

  await t.test('migration: saved LLM nodes naming a connection pick its row; gone connections stay; a second run changes nothing', () => {
    const moduleId = (db.prepare("SELECT id FROM module_definitions WHERE internal_fixed_values LIKE '%\"system.call_llm\"%'").get() as { id: number }).id
    const graph = {
      nodes: [
        { id: 'a', module_id: moduleId, input_values: { provider_name: 'strata', model: 'gemma-4', prompt: 'p' } },
        { id: 'b', module_id: moduleId, input_values: { provider_name: 'strata', model: 'brand-new' } },
        { id: 'c', module_id: moduleId, input_values: { provider_name: 'olla', model: '' } },
        { id: 'd', module_id: moduleId, input_values: { provider_name: 'gone', model: 'x' } },
        { id: 'e', module_id: moduleId, input_values: { provider_name: 'strata', model: 'm', profile_id: sera.id } },
        { id: 'f', module_id: moduleId, input_values: { provider_name: '', model: 'stale' } },
        { id: 'g', module_id: moduleId + 1000, input_values: { provider_name: 'strata', model: 'gemma-4' } },
      ],
      edges: [],
    }
    const id = Number(db.prepare('INSERT INTO graph_workflows (name, graph_json) VALUES (?, ?)').run('legacy llm', JSON.stringify(graph)).lastInsertRowid)
    const read = () => JSON.parse((db.prepare('SELECT graph_json FROM graph_workflows WHERE id = ?').get(id) as { graph_json: string }).graph_json) as typeof graph
    migrateWorkflowLlmNodes(db)
    const after = read()
    const values = (nodeId: string) => after.nodes.find((entry) => entry.id === nodeId)!.input_values as Record<string, unknown>
    const created = ModelSlotStore.ensure('strata', 'brand-new', { create: false })
    assert.ok(created, 'a model with no row gets one')
    assert.deepEqual(values('a'), { prompt: 'p', model_slot_id: gemma })
    assert.deepEqual(values('b'), { model_slot_id: created })
    assert.deepEqual(values('c'), { model_slot_id: qwen }, 'an empty model: the connection\'s primary row')
    assert.deepEqual(values('d'), { provider_name: 'gone', model: 'x' })
    assert.deepEqual(values('e'), { profile_id: sera.id })
    assert.deepEqual(values('f'), {})
    assert.deepEqual(values('g'), { provider_name: 'strata', model: 'gemma-4' }, 'other nodes are not touched')
    const once = (db.prepare('SELECT graph_json FROM graph_workflows WHERE id = ?').get(id) as { graph_json: string }).graph_json
    const rowCount = (db.prepare('SELECT COUNT(*) AS n FROM llm_model_slots').get() as { n: number }).n
    migrateWorkflowLlmNodes(db)
    assert.equal((db.prepare('SELECT graph_json FROM graph_workflows WHERE id = ?').get(id) as { graph_json: string }).graph_json, once)
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM llm_model_slots').get() as { n: number }).n, rowCount)

    const usage = new Map(buildModelUsage().slots.map((entry) => [entry.id, entry.workflowNodes]))
    assert.equal(usage.get(gemma), 1, 'node a names gemma')
    assert.equal(usage.get(qwen), 2, 'node c names qwen; node e reaches it through 세라')
  })

  await t.test('Codex exec usage comes from its turn.completed events', () => {
    const jsonl = [
      '{"type":"thread.started","thread_id":"t"}',
      '{"type":"turn.completed","usage":{"input_tokens":120,"cached_input_tokens":20,"output_tokens":7}}',
      'not json turn.completed',
      '{"type":"turn.completed","usage":{"input_tokens":5,"output_tokens":1}}',
    ].join('\n')
    assert.deepEqual(readCodexExecUsage(jsonl), { inputTokens: 125, cachedInputTokens: 20, outputTokens: 8 })
    assert.equal(readCodexExecUsage('{"type":"item.completed"}'), null)
  })
})
