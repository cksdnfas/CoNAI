import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import sharp from 'sharp'

test('workflow chat nodes: run requester, characters, presets, lorebooks and chat rooms', { timeout: 120000 }, async (t) => {
  const temp = path.resolve(__dirname, '../../temp')
  fs.mkdirSync(temp, { recursive: true })
  const root = fs.mkdtempSync(path.join(temp, 'conai-workflow-chat-nodes-test-'))
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
  const { GraphWorkflowModel } = await import('../src/models/GraphWorkflow')
  const { GraphExecutionModel } = await import('../src/models/GraphExecution')
  const { ModuleDefinitionModel } = await import('../src/models/ModuleDefinition')
  const { GraphWorkflowExecutor } = await import('../src/services/graphWorkflowExecutor')
  const { GraphWorkflowExecutionQueue } = await import('../src/services/graphWorkflowExecutionQueue')
  const { createGraphWorkflowExecutionRoutes } = await import('../src/routes/graph-workflows/execution-routes')
  const { parseModuleDefinition } = await import('../src/services/graph-workflow-executor/shared')
  const { CHAT_NODE_HANDLERS } = await import('../src/services/graph-workflow-executor/system-chat-node-handlers')
  const { NODE_OPTION_SOURCES } = await import('../src/services/graph-workflow-executor/node-option-sources')
  const { getSupportedSystemOperationKeys } = await import('../src/services/graph-workflow-executor/execute-system')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { ChatGenerationPresetStore } = await import('../src/services/codex-chat/chatGenerationPresets')
  const { ChatLorebookStore } = await import('../src/services/codex-chat/chatLorebook')
  const { OwnedLorebookStore } = await import('../src/services/codex-chat/chatLorebookFiles')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { WorkflowModel } = await import('../src/models/Workflow')
  const { GenerationQueueModel } = await import('../src/models/GenerationQueue')
  const { GenerationQueueService } = await import('../src/services/generationQueueService')
  const { ingestWorkflowInputImage } = await import('../src/services/workflowInputImages')
  const { subscribeToRuntimeEvents } = await import('../src/services/runtime-events/runtimeEventBus')
  const { AuthAccount } = await import('../src/models/AuthAccount')
  const { AuthAccessControlService } = await import('../src/services/authAccessControlService')
  const authHelpers = await import('../src/routes/auth-route-helpers')
  const { BackgroundQueueService } = await import('../src/services/backgroundQueue')
  // Real isolated databases and library files; no generation dispatch, provider or metadata worker.
  t.mock.method(BackgroundQueueService, 'addMetadataExtractionTask', () => {})
  t.mock.method(GenerationQueueService, 'requestDispatch', () => {})
  t.mock.method(GenerationQueueService, 'requestCancellation', async () => ({ success: true }) as any)
  const events: Array<{ name: string; accountId: number | null; payload: any }> = []
  const unsubscribe = subscribeToRuntimeEvents((record) => { events.push({ name: record.name, accountId: record.accountId, payload: record.payload }) })
  t.after(async () => {
    unsubscribe()
    await GraphWorkflowExecutionQueue.stop()
    await new Promise<void>((resolve) => setImmediate(resolve))
    settings.closeUserSettingsDb()
    auth.getAuthDb().close()
    images.closeDatabase()
    const { logger } = await import('../src/utils/logger')
    await new Promise<void>((resolve) => logger.close(resolve))
    assert.equal(path.dirname(path.resolve(root)), temp)
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  const db = settings.getUserSettingsDb()
  const imageUrl = async (color: string) => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: color } }).png().toBuffer()
    return `data:image/png;base64,${png.toString('base64')}`
  }
  const moduleFor = (operationKey: string) => {
    const record = ModuleDefinitionModel.findAll().find((row) => {
      const fixed = typeof row.internal_fixed_values === 'string' ? JSON.parse(row.internal_fixed_values) : row.internal_fixed_values
      return fixed?.operation_key === operationKey
    })
    assert.ok(record, operationKey)
    return record
  }
  const node = (id: string, operationKey: string, inputValues: Record<string, unknown> = {}) => ({ id, module_id: moduleFor(operationKey).id, position: { x: 0, y: 0 }, input_values: inputValues })
  const edge = (source: string, sourcePort: string, target: string, targetPort: string) => ({ id: `${source}.${sourcePort}-${target}.${targetPort}`, source_node_id: source, source_port_key: sourcePort, target_node_id: target, target_port_key: targetPort })
  /** One node run through its handler, inside a real execution row. */
  async function run(operationKey: string, inputs: Record<string, unknown>, options: { requester?: number | null; edges?: ReturnType<typeof edge>[]; aborted?: boolean } = {}) {
    const graph = { nodes: [node('n', operationKey)], edges: options.edges ?? [] }
    const workflowId = GraphWorkflowModel.create({ name: `run ${operationKey}`, graph } as any)
    const executionId = GraphExecutionModel.create({ graph_workflow_id: workflowId, graph_version: 1, requested_by_account_id: options.requester ?? null })
    const controller = new AbortController()
    if (options.aborted) controller.abort()
    const context = {
      executionId,
      workflow: { id: workflowId, name: 'chat nodes', graph },
      modulesById: new Map(),
      artifactsByNode: new Map(),
      debugMode: false,
      signal: controller.signal,
      abort: () => {},
      getAbortReason: () => null,
      requestedByAccountId: options.requester ?? null,
    } as any
    await CHAT_NODE_HANDLERS[operationKey](context, graph.nodes[0] as any, parseModuleDefinition(moduleFor(operationKey)), inputs)
    const artifacts = context.artifactsByNode.get('n') as Record<string, { type: string; value: any }>
    return Object.fromEntries(Object.entries(artifacts).map(([key, artifact]) => [key, artifact.value])) as Record<string, any>
  }
  const withAuthConfigured = async (body: () => Promise<void>) => {
    const admins = t.mock.method(AuthAccount, 'countActiveAdmins', () => 1)
    authHelpers.invalidateConfiguredAuthCache()
    try { await body() } finally {
      admins.mock.restore()
      authHelpers.invalidateConfiguredAuthCache()
    }
  }

  // ---- B0: the account that starts a run travels with it ----------------------------------------------------------
  const columns = db.prepare('PRAGMA table_info(graph_executions)').all() as Array<{ name: string }>
  assert.ok(columns.some((column) => column.name === 'requested_by_account_id'))
  for (const key of Object.keys(CHAT_NODE_HANDLERS)) assert.ok(getSupportedSystemOperationKeys().includes(key), key)

  const queuedGraph = { nodes: [node('only', 'system.constant_text', { text: 'x' })], edges: [] }
  const queuedWorkflowId = GraphWorkflowModel.create({ name: 'queued', graph: queuedGraph } as any)
  const router = createGraphWorkflowExecutionRoutes() as any
  async function callRoute(routePath: string, params: Record<string, string>, session: Record<string, unknown>) {
    const route = router.stack.find((layer: any) => layer.route?.path === routePath && layer.route.methods.post)?.route
    assert.ok(route, routePath)
    const handler = route.stack[route.stack.length - 1].handle
    return new Promise<{ status: number; body: any }>((resolve, reject) => {
      let status = 200
      const res = { status(code: number) { status = code; return this }, json(data: unknown) { resolve({ status, body: data }); return this } }
      Promise.resolve(handler({ params, query: {}, body: {}, session }, res, reject)).catch(reject)
    })
  }
  const wholeRun = await callRoute('/:id/execute', { id: String(queuedWorkflowId) }, { accountId: 7 })
  assert.equal(wholeRun.status, 201)
  const nodeRun = await callRoute('/:id/nodes/:nodeId/execute', { id: String(queuedWorkflowId), nodeId: 'only' }, { accountId: 7 })
  assert.equal(nodeRun.status, 201)
  const anonymousRun = await callRoute('/:id/execute', { id: String(queuedWorkflowId) }, {})
  const scheduled = GraphWorkflowExecutionQueue.enqueue(queuedWorkflowId, {}, undefined, false, { triggerType: 'schedule' })
  assert.equal(GraphExecutionModel.findById(wholeRun.body.data.executionId)?.requested_by_account_id, 7)
  assert.equal(GraphExecutionModel.findById(nodeRun.body.data.executionId)?.requested_by_account_id, 7)
  assert.equal(GraphExecutionModel.findById(anonymousRun.body.data.executionId)?.requested_by_account_id, null)
  assert.equal(GraphExecutionModel.findById(scheduled.executionId)?.requested_by_account_id, null)

  const started: Array<{ executionId?: number; requestedByAccountId?: number | null }> = []
  const execute = t.mock.method(GraphWorkflowExecutor, 'execute', async (_workflowId: number, options: any) => { started.push(options); return {} as any })
  GraphWorkflowExecutionQueue.start()
  for (let attempt = 0; attempt < 200 && started.length < 4; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10))
  await GraphWorkflowExecutionQueue.stop()
  execute.mock.restore()
  const startedBy = new Map(started.map((options) => [options.executionId, options.requestedByAccountId]))
  assert.equal(startedBy.get(wholeRun.body.data.executionId), 7)
  assert.equal(startedBy.get(nodeRun.body.data.executionId), 7)
  assert.equal(startedBy.get(anonymousRun.body.data.executionId), null)
  assert.equal(startedBy.get(scheduled.executionId), null)

  // ---- Fixtures ---------------------------------------------------------------------------------------------------
  const referenceRef = await ingestWorkflowInputImage(await imageUrl('#3366cc'))
  const mina = ChatProfileStore.create({
    name: 'Mina',
    engine: 'codex',
    appearance: '1girl, silver hair',
    systemPrompt: 'You are {{char}}.',
    promptSections: [{ id: 'story', title: 'Story', content: '{{char}} lives in a tower.', kind: 'text', enabled: true }],
    greeting: '안녕, 나는 {{char}}야.',
  })
  ChatProfileStore.update(mina.id, { referenceHash: referenceRef.composite_hash })
  const off = ChatProfileStore.create({ name: 'Off', engine: 'codex', isEnabled: false })
  const limited = ChatProfileStore.create({ name: 'Limited', engine: 'codex' })
  // Saving keeps only existing permission groups; the scratch auth database has none to limit by.
  db.prepare('UPDATE llm_chat_profiles SET allowed_group_keys = ? WHERE id = ?').run(JSON.stringify(['vip']), limited.id)

  const world = ChatLorebookStore.create({ name: 'World', entries: [
    { keys: ['dragon'], content: '{{char}} fears dragons.', order: 10 },
    { keys: ['castle'], content: 'The castle is old.', order: 50 },
    { keys: ['dragon'], content: 'A switched-off entry.', enabled: false },
    { keys: [], content: 'Always on.', constant: true },
  ] })
  const mine = OwnedLorebookStore.create('account:1', { name: 'Mine', entries: [{ keys: ['secret'], content: 'Only account one knows.', order: 30 }] })
  const theirs = OwnedLorebookStore.create('account:2', { name: 'Theirs', entries: [{ keys: ['secret'], content: 'Only account two knows.' }] })
  db.prepare('UPDATE llm_chat_profiles SET lorebook_ids = ? WHERE id = ?').run(JSON.stringify([world.id, mine.id, theirs.id]), mina.id)

  const directRoom = CodexChatStore.createThread(1, '', 'llm', mina.id)
  const groupRoom = CodexChatStore.createThread(1, 'Tea party', 'llm', mina.id)
  db.prepare("UPDATE codex_chat_threads SET kind = 'group' WHERE id = ?").run(groupRoom)
  const otherRoom = CodexChatStore.createThread(2, 'Not yours', 'llm', mina.id)
  const bootstrapRoom = CodexChatStore.createThread(null, 'Bootstrap', 'llm', mina.id)

  const naiPreset = ChatGenerationPresetStore.create({ name: 'Portrait', kind: 'nai', nai: { promptPrefix: 'masterpiece', characterReference: 'replace', sizes: [{ label: 'portrait', width: 832, height: 1216 }] } })
  const plainNaiPreset = ChatGenerationPresetStore.create({ name: 'Plain', kind: 'nai', nai: { characterReference: 'none' } })
  const comfyWorkflowId = WorkflowModel.create({
    name: 'Comfy test',
    workflow_json: JSON.stringify({ '3': { class_type: 'KSampler', inputs: { seed: 1 } }, '6': { class_type: 'CLIPTextEncode', inputs: { text: '' } } }),
    marked_fields: [
      { id: 'positive_prompt', label: 'Positive Prompt', jsonPath: '6.inputs.text', type: 'textarea' },
      { id: 'seed', label: 'Seed', jsonPath: '3.inputs.seed', type: 'number', default_value: 1 },
    ],
  } as any)
  const comfyPreset = ChatGenerationPresetStore.create({ name: 'Scene', kind: 'comfyui', comfyui: { workflowId: comfyWorkflowId, fixedInputs: { positive_prompt: 'best quality', seed: 1 }, exposedFieldIds: [] } })

  // ---- Option sources ---------------------------------------------------------------------------------------------
  const presetOptions = await NODE_OPTION_SOURCES.chat_generation_presets({ accountId: 1 })
  assert.deepEqual(presetOptions.find((option) => option.value === String(naiPreset.id))?.label, 'Portrait · NAI')
  assert.deepEqual(presetOptions.find((option) => option.value === String(comfyPreset.id))?.label, 'Scene · ComfyUI')
  const bookLabels = async (accountId: number | null) => (await NODE_OPTION_SOURCES.chat_lorebooks({ accountId })).map((option) => option.label)
  assert.deepEqual(await bookLabels(1), ['World', 'Mine'])
  assert.deepEqual(await bookLabels(2), ['World', 'Theirs'])
  assert.deepEqual(await bookLabels(null), ['World'])
  const roomOptions = await NODE_OPTION_SOURCES.chat_rooms({ accountId: 1 })
  assert.deepEqual(roomOptions.map((option) => option.value).sort(), [String(directRoom), String(groupRoom)].sort())
  assert.equal(roomOptions.find((option) => option.value === String(directRoom))?.label, 'Mina', 'an untitled room is named after its character')
  assert.equal(roomOptions.find((option) => option.value === String(groupRoom))?.label, 'Tea party')
  assert.deepEqual((await NODE_OPTION_SOURCES.chat_rooms({ accountId: null })).map((option) => option.value), [String(bootstrapRoom)])
  await withAuthConfigured(async () => {
    assert.deepEqual(await NODE_OPTION_SOURCES.chat_rooms({ accountId: null }), [], 'nobody owns rooms once accounts exist')
  })

  // ---- B1: load a character ---------------------------------------------------------------------------------------
  const loaded = await run('system.load_chat_profile', { profile_id: mina.id }, { edges: [edge('n', 'reference_image', 'x', 'image')] })
  assert.equal(loaded.name, 'Mina')
  assert.equal(loaded.appearance, '1girl, silver hair')
  assert.match(loaded.persona, /You are Mina\./)
  assert.match(loaded.persona, /## Story\nMina lives in a tower\./)
  assert.equal(loaded.greeting, '안녕, 나는 Mina야.')
  assert.ok(typeof loaded.reference_image === 'string' && loaded.reference_image.startsWith('data:image/png;base64,'), 'a connected image is read')
  assert.ok(!('avatar_image' in loaded), 'an image the character does not have is left out')
  assert.equal(loaded.profile.reference_hash, referenceRef.composite_hash)
  const unconnected = await run('system.load_chat_profile', { profile_id: String(mina.id) })
  assert.ok(!('reference_image' in unconnected), 'an unconnected image is not read')
  await assert.rejects(run('system.load_chat_profile', { profile_id: off.id }), /꺼진 캐릭터/)
  await assert.rejects(run('system.load_chat_profile', {}), /캐릭터를 골라줘/)
  await assert.rejects(run('system.load_chat_profile', { profile_id: 99999 }), /캐릭터를 찾을 수 없어/)
  {
    const findAccount = t.mock.method(AuthAccount, 'findById', (id: number) => ({ id, status: 'active', account_type: 'guest' }) as any)
    const access = t.mock.method(AuthAccessControlService, 'resolveForAccountId', () => ({ permissionKeys: [], groupKeys: [] }) as any)
    try {
      await assert.rejects(run('system.load_chat_profile', { profile_id: limited.id }, { requester: 5 }), /실행한 계정이 쓸 수 없어/)
      access.mock.mockImplementation(() => ({ permissionKeys: [], groupKeys: ['vip'] }) as any)
      assert.equal((await run('system.load_chat_profile', { profile_id: limited.id }, { requester: 5 })).name, 'Limited')
    } finally {
      findAccount.mock.restore()
      access.mock.restore()
    }
  }

  // ---- B3: search lorebooks ---------------------------------------------------------------------------------------
  const found = await run('system.search_lorebook', { text: 'A dragon near the castle keeps a secret.', profile_id: mina.id }, { requester: 1 })
  assert.deepEqual(found.entries.map((entry: any) => entry.content), ['The castle is old.', 'Only account one knows.', 'Mina fears dragons.'], 'higher order first; only the run account\'s own book')
  assert.equal(found.text, 'The castle is old.\n\nOnly account one knows.\n\nMina fears dragons.')
  assert.equal(found.entries[0].book, 'World')
  const capped = await run('system.search_lorebook', { text: 'dragon castle secret', profile_id: mina.id, max_entries: 1 }, { requester: 1 })
  assert.deepEqual(capped.entries.map((entry: any) => entry.content), ['The castle is old.'])
  const otherAccount = await run('system.search_lorebook', { text: 'dragon castle secret', profile_id: mina.id }, { requester: 2 })
  assert.deepEqual(otherAccount.entries.map((entry: any) => entry.content), ['The castle is old.', 'Mina fears dragons.', 'Only account two knows.'])
  const bookOnly = await run('system.search_lorebook', { text: 'secret', lorebook_id: mine.id }, { requester: 1 })
  assert.deepEqual(bookOnly.entries.map((entry: any) => entry.content), ['Only account one knows.'])
  const unmatched = await run('system.search_lorebook', { text: 'nothing here', lorebook_id: world.id })
  assert.deepEqual(unmatched.entries, [])
  assert.equal(unmatched.text, '')
  await assert.rejects(run('system.search_lorebook', { text: 'secret', lorebook_id: mine.id }, { requester: 2 }), /실행한 계정의 로어북이 아니라서/)
  await assert.rejects(run('system.search_lorebook', { text: 'secret', lorebook_id: mine.id }), /실행한 계정의 로어북이 아니라서/, 'the bootstrap owner does not own account books')
  await assert.rejects(run('system.search_lorebook', { text: 'secret' }), /로어북이나 캐릭터를 골라줘/)
  await assert.rejects(run('system.search_lorebook', { text: 'secret', lorebook_id: 99999 }), /로어북을 찾을 수 없어/)

  // ---- B4: post into a chat room ----------------------------------------------------------------------------------
  const postedImage = await imageUrl('#cc3366')
  events.length = 0
  const reply = await run('system.post_to_chat_room', { room_id: directRoom, text: 'hello', image: postedImage, as: 'character' }, { requester: 1 })
  const replyRow = CodexChatStore.listMessages(directRoom).at(-1)!
  assert.equal(replyRow.id, reply.message.id)
  assert.equal(replyRow.role, 'assistant')
  assert.equal(replyRow.speaker_profile_id, null, 'direct chats name no speaker')
  assert.match(replyRow.content, /^hello\n\n!\[\]\(media:[a-f0-9]{48}\.png\)$/)
  assert.equal(reply.message.composite_hash, replyRow.content.match(/media:([a-f0-9]{48})/)![1])
  assert.deepEqual(events.filter((event) => event.name === 'chat.message.created').map((event) => [event.accountId, event.payload.threadId]), [[1, directRoom]])
  events.length = 0
  const note = await run('system.post_to_chat_room', { room_id: directRoom, image: postedImage, as: 'note' }, { requester: 1 })
  const noteRow = CodexChatStore.listMessages(directRoom).at(-1)!
  assert.equal(noteRow.role, 'user')
  assert.equal(noteRow.content, '')
  assert.deepEqual(noteRow.mediaAttachments?.map((item) => item.compositeHash), [note.message.composite_hash])
  assert.deepEqual(events.filter((event) => event.name === 'chat.message.created').map((event) => [event.accountId, event.payload.messageId]), [[1, noteRow.id]], 'open chats hear about the note too')
  await run('system.post_to_chat_room', { room_id: groupRoom, text: 'room line' }, { requester: 1 })
  assert.equal(CodexChatStore.listMessages(groupRoom).at(-1)!.speaker_profile_id, mina.id, 'group rooms name the speaking character')
  await run('system.post_to_chat_room', { room_id: bootstrapRoom, text: 'no accounts yet' })
  assert.equal(CodexChatStore.listMessages(bootstrapRoom).at(-1)!.content, 'no accounts yet')
  await assert.rejects(run('system.post_to_chat_room', { room_id: otherRoom, text: 'x' }, { requester: 1 }), /실행한 계정의 채팅방이 아니거나/)
  await assert.rejects(run('system.post_to_chat_room', { room_id: directRoom, text: 'x' }), /실행한 계정의 채팅방이 아니거나/, 'the bootstrap owner does not own account rooms')
  await assert.rejects(run('system.post_to_chat_room', { room_id: directRoom }, { requester: 1 }), /올릴 내용이나 이미지/)
  await assert.rejects(run('system.post_to_chat_room', { room_id: directRoom, text: 'x', image: 'not an image' }, { requester: 1 }), /이미지 입력을 읽지 못했어/)
  await withAuthConfigured(async () => {
    await assert.rejects(run('system.post_to_chat_room', { room_id: bootstrapRoom, text: 'x' }), /로그인한 계정으로 직접 실행/)
  })

  // ---- B2: generate with a chat preset (the queue never dispatches; the run is aborted while it waits) -------------
  const latestJob = () => {
    const row = db.prepare('SELECT id FROM generation_queue_jobs ORDER BY id DESC LIMIT 1').get() as { id: number }
    const job = GenerationQueueModel.findById(row.id)!
    return { ...job, payload: (typeof job.request_payload === 'string' ? JSON.parse(job.request_payload) : job.request_payload) as Record<string, any> }
  }
  await assert.rejects(run('system.generate_with_chat_preset', { preset_id: naiPreset.id, prompt: 'smiling', profile_id: mina.id }, { aborted: true }), /__GRAPH_EXECUTION_CANCELLED__/)
  const naiJob = latestJob()
  assert.equal(naiJob.service_type, 'novelai')
  assert.equal(naiJob.payload.prompt, 'masterpiece, 1girl, silver hair, smiling')
  assert.equal(naiJob.payload.n_samples, 1)
  assert.equal(naiJob.payload.width, 832)
  assert.equal(naiJob.payload.character_refs.length, 1, 'the character lends its reference')
  assert.ok(String(naiJob.payload.character_refs[0].image).startsWith('data:image/png;base64,'))
  await assert.rejects(run('system.generate_with_chat_preset', { preset_id: naiPreset.id, prompt: 'smiling' }, { aborted: true }), /__GRAPH_EXECUTION_CANCELLED__/)
  assert.equal(latestJob().payload.character_refs, undefined, 'no character and no image: the text alone')
  await assert.rejects(run('system.generate_with_chat_preset', { preset_id: plainNaiPreset.id, prompt: 'smiling', profile_id: mina.id }, { aborted: true }), /__GRAPH_EXECUTION_CANCELLED__/)
  assert.equal(latestJob().payload.character_refs, undefined, 'a preset without a character reference keeps it so for a character')
  await assert.rejects(run('system.generate_with_chat_preset', { preset_id: plainNaiPreset.id, prompt: 'smiling', reference_image: postedImage }, { aborted: true }), /__GRAPH_EXECUTION_CANCELLED__/)
  assert.equal(latestJob().payload.character_refs?.length, 1, 'a connected reference image always goes in')

  // Automatic routing needs one active server; nothing is ever sent to it.
  ;(await import('../src/models/ComfyUIServer')).ComfyUIServerModel.create({ name: 'never-called', endpoint: 'http://unused.invalid', capacity: 1, is_active: true })
  await assert.rejects(run('system.generate_with_chat_preset', { preset_id: comfyPreset.id, prompt: 'smiling', profile_id: mina.id }, { aborted: true }), /__GRAPH_EXECUTION_CANCELLED__/)
  const comfyJob = latestJob()
  assert.equal(comfyJob.service_type, 'comfyui')
  assert.equal(comfyJob.workflow_id, comfyWorkflowId)
  assert.equal(comfyJob.payload.prompt_data.positive_prompt, 'best quality, 1girl, silver hair, smiling')
  assert.equal(typeof comfyJob.payload.prompt_data.seed, 'number')
  assert.notEqual(comfyJob.payload.prompt_data.seed, 1, 'the fixed seed is drawn again')
  await assert.rejects(run('system.generate_with_chat_preset', { preset_id: comfyPreset.id, prompt: 'x', reference_image: postedImage }, { aborted: true }), /기준 이미지를 받을 이미지 필드가 없어/)
  await assert.rejects(run('system.generate_with_chat_preset', { prompt: 'x' }), /생성 프리셋을 골라줘/)
  await assert.rejects(run('system.generate_with_chat_preset', { preset_id: naiPreset.id, prompt: ' ' }), /프롬프트를 넣어줘/)

  // ---- A whole run: the executor hands the requester to the nodes --------------------------------------------------
  const graph = {
    nodes: [node('load', 'system.load_chat_profile', { profile_id: mina.id }), node('post', 'system.post_to_chat_room', { room_id: directRoom, as: 'character' })],
    edges: [edge('load', 'greeting', 'post', 'text')],
  }
  const workflowId = GraphWorkflowModel.create({ name: 'greet', graph } as any)
  const result = await GraphWorkflowExecutor.execute(workflowId, { requestedByAccountId: 1 }) as any
  assert.equal(CodexChatStore.listMessages(directRoom).at(-1)!.content, '안녕, 나는 Mina야.')
  const executionId = result?.executionId ?? (db.prepare('SELECT id FROM graph_executions WHERE graph_workflow_id = ? ORDER BY id DESC LIMIT 1').get(workflowId) as { id: number }).id
  assert.equal(GraphExecutionModel.findById(executionId)?.requested_by_account_id, 1)
  assert.equal(GraphExecutionModel.findById(executionId)?.status, 'completed')
  await assert.rejects(GraphWorkflowExecutor.execute(workflowId, { requestedByAccountId: 2 }), /실행한 계정의 채팅방이 아니거나/)
})
