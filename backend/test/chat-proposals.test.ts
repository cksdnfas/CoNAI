import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { ChatExecutionContext } from '@conai/shared'
import type { CodexChatMessageRecord } from '../src/services/codex-chat/codexChatStore'

test('chat proposals: configure scope, setup tools, storage, read-time attachment, saved route', { timeout: 60000 }, async (t) => {
  // Load runtime modules only after isolating every data path. Never open the user's databases.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-proposals-test-'))
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
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('conai-proposals-test-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const { ChatProposalStore } = await import('../src/services/codex-chat/chatProposals')
  const { attachProposals } = await import('../src/services/codex-chat/codexChatMedia')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { ChatSharedBlockStore } = await import('../src/services/codex-chat/chatDisplayBlocks')
  const { ModelSlotStore } = await import('../src/services/codex-chat/modelSlots')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { CHAT_SCOPES, updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
  updateChatSettings({ enabled: true })
  const { intersectChatScopes } = await import('../src/services/codex-chat/codexChatAccess')
  const { MCP_HTTP_SCOPES } = await import('../src/services/mcpHttpSettingsService')
  const { ALL_MCP_HTTP_SCOPES, getMcpToolScope } = await import('../src/mcp/context')
  const { openChatMcpBridge } = await import('../src/services/codex-chat/chatMcpBridge')
  const { registerChatReply } = await import('../src/services/codex-chat/chatReplyRegistry')
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')

  ExternalApiProvider.create({ provider_name: 'conn', display_name: 'Conn', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
  const slot = ModelSlotStore.create({ name: 'Fast Model', providerName: 'conn', model: 'm1' }).slot
  const profile = ChatProfileStore.create({ name: 'Mina', engine: 'llm', providerName: 'conn', systemPrompt: 'old prompt', tagline: 'old tagline', mcpEnabled: true, mcpScopes: ['read', 'configure'] })
  const threadId = CodexChatStore.createThread(null, 'proposal chat', 'llm', profile.id)
  const controller = new AbortController()
  const replyContext = (replyId: string): ChatExecutionContext => ({ threadId, profileId: profile.id, kind: 'direct', replyId })
  const BLOCK = { key: 'Status', instruction: 'Update on scene change', example: '{"hp": 100}', template: '<b>{{hp}}</b>', fields: [{ name: 'hp', min: 0, max: 100, step: 10 }] }

  const { normalizeChatPageSnapshot, buildChatPageChanges, chatPagePatch, applyChatWorkflowOperations, normalizeChatWorkflowSnapshot, sanitizeChatWorkflowInputs, chatPageTarget } = await import('@conai/shared')
  const { chatWorkflowModules, requireChatWorkflowModules } = await import('../src/services/codex-chat/chatWorkflowContext')
  const { ModuleDefinitionModel } = await import('../src/models/ModuleDefinition')
  const workflowModules = chatWorkflowModules()
  const textModule = workflowModules.find((module) => module.operation === 'system.constant_text')!
  const finalModule = workflowModules.find((module) => module.operation === 'system.final_result')!
  const numberModule = workflowModules.find((module) => module.operation === 'system.constant_number')!
  assert.ok(textModule && finalModule && numberModule)
  const emptyWorkflow = normalizeChatWorkflowSnapshot({ revision: 'workflow-revision-test', name: 'Draft', description: '', nodes: [], edges: [] })
  const createGraph = [
    { type: 'add_node', nodeId: 'source', moduleId: textModule.id },
    { type: 'set_input', nodeId: 'source', key: 'text', value: 'hello' },
    { type: 'add_node', nodeId: 'result', moduleId: finalModule.id },
    { type: 'connect', edgeId: 'source-result', sourceNodeId: 'source', sourcePort: 'text', targetNodeId: 'result', targetPort: 'value' },
    { type: 'set_run_input', nodeId: 'source', enabled: true, label: 'Message' },
  ]
  const page = normalizeChatPageSnapshot({ instanceId: 'page-test-123', connectionId: 'connection-test-123', path: '/generation', title: 'Test workflow', kind: 'comfyui', resourceId: '1', fields: [
    { id: 'prompt', label: 'Prompt', type: 'text', value: ['old', 'second'] },
    { id: 'steps', label: 'Steps', type: 'number', value: '20', min: 1, max: 50, integer: true },
    { id: 'sampler', label: 'Sampler', type: 'select', value: 'euler', options: ['euler', 'euler_ancestral'] },
  ], apiKey: 'must-not-be-retained' })
  const pageProfile = ChatProfileStore.create({ name: 'Page assistant', engine: 'llm', providerName: 'conn', mcpEnabled: true, mcpScopes: ['read'], toolAllowlist: ['get_current_page', 'propose_page_changes'] })
  const pageThreadId = CodexChatStore.createThread(null, 'page chat', 'llm', pageProfile.id)
  const workflowPage = normalizeChatPageSnapshot({ ...page, kind: 'workflow', resourceId: 'workflow:draft:session-test', fields: [], workflow: emptyWorkflow })
  const workflowProfile = ChatProfileStore.create({ name: 'Workflow assistant', engine: 'llm', providerName: 'conn', mcpEnabled: true, mcpScopes: ['read'], toolAllowlist: ['get_current_page', 'get_workflow_editor', 'list_workflow_modules', 'propose_workflow_changes'] })
  const workflowThreadId = CodexChatStore.createThread(null, 'workflow chat', 'llm', workflowProfile.id)

  await t.test('workflow transactions: atomic creation, rewiring/removal, protected fields and cycles', () => {
    const created = applyChatWorkflowOperations(emptyWorkflow, workflowModules, createGraph)
    assert.equal(created.graph.nodes.length, 2)
    assert.equal(created.graph.edges.length, 1)
    assert.deepEqual(created.issues, [])
    assert.deepEqual(emptyWorkflow.nodes, [], 'transaction never mutates the source graph')
    const edited = applyChatWorkflowOperations(created.graph, workflowModules, [
      { type: 'disconnect', edgeId: 'source-result' },
      { type: 'add_node', nodeId: 'middle', moduleId: textModule.id },
      { type: 'connect', edgeId: 'source-result', sourceNodeId: 'source', sourcePort: 'text', targetNodeId: 'middle', targetPort: 'text' },
      { type: 'connect', edgeId: 'middle-result', sourceNodeId: 'middle', sourcePort: 'text', targetNodeId: 'result', targetPort: 'value' },
    ])
    assert.equal(edited.graph.edges.length, 2)
    assert.equal(edited.graph.edges[0].id, 'source-result', 'a disconnected edge ID can be reused when rewiring atomically')
    assert.throws(() => applyChatWorkflowOperations(edited.graph, workflowModules, [{ type: 'set_workflow', name: 'would change' }, { type: 'connect', edgeId: 'cycle', sourceNodeId: 'middle', sourcePort: 'text', targetNodeId: 'source', targetPort: 'text' }]), /순환/)
    assert.equal(edited.graph.name, 'Draft', 'failed batch leaves all earlier operations unapplied')
    assert.throws(() => applyChatWorkflowOperations(created.graph, workflowModules, [{ type: 'add_node', nodeId: 'another', moduleId: textModule.id }, { type: 'connect', edgeId: 'duplicate', sourceNodeId: 'another', sourcePort: 'text', targetNodeId: 'result', targetPort: 'value' }]), /단일 입력/)
    assert.throws(() => applyChatWorkflowOperations(created.graph, workflowModules, [{ type: 'add_node', nodeId: 'numeric', moduleId: numberModule.id }, { type: 'connect', edgeId: 'bad-type', sourceNodeId: 'numeric', sourcePort: 'number', targetNodeId: 'source', targetPort: 'text' }]), /타입/)
    assert.throws(() => applyChatWorkflowOperations(created.graph, workflowModules, [{ type: 'set_input', nodeId: 'source', key: 'api_key', value: 'secret' }]), /ID|보호|입력/)
    assert.deepEqual(sanitizeChatWorkflowInputs({ text: 'public', api_key: 'secret', code: 'private', unknown: 'hidden' }, textModule), { text: 'public' })
    const imageModule = workflowModules.find((module) => module.operation === 'system.constant_image')!
    const media = applyChatWorkflowOperations(emptyWorkflow, workflowModules, [
      { type: 'add_node', nodeId: 'image', moduleId: imageModule.id },
      { type: 'add_node', nodeId: 'result', moduleId: finalModule.id },
      { type: 'connect', edgeId: 'image-result', sourceNodeId: 'image', sourcePort: 'image', targetNodeId: 'result', targetPort: 'value' },
    ])
    assert.equal(media.graph.edges.length, 1, 'media port wiring remains available')
    assert.throws(() => applyChatWorkflowOperations(media.graph, workflowModules, [{ type: 'set_input', nodeId: 'image', key: 'image', value: '/uploads/private.png' }]), /보호된 입력/)
    assert.deepEqual(sanitizeChatWorkflowInputs({ image: '/uploads/private.png' }, imageModule), {})
    const jsonModule = workflowModules.find((module) => module.operation === 'system.constant_json')!
    assert.throws(() => applyChatWorkflowOperations(emptyWorkflow, workflowModules, [{ type: 'add_node', nodeId: 'json', moduleId: jsonModule.id }, { type: 'set_input', nodeId: 'json', key: 'json', value: '{"api_key":"secret"}' }]), /안전한 JSON/)
    const removed = applyChatWorkflowOperations(edited.graph, workflowModules, [{ type: 'remove_node', nodeId: 'middle' }])
    assert.equal(removed.graph.edges.length, 0)
    assert.ok(removed.issues.length > 0, 'an incomplete draft is reviewed with warnings')
    assert.throws(() => normalizeChatPageSnapshot({ ...workflowPage, path: '/prompts' }), /대상 페이지/)
  })

  await t.test('workflow tools: request-owned revision, read-only catalog, reviewed proposal and schema changes', async () => {
    const context: ChatExecutionContext = { threadId: workflowThreadId, profileId: workflowProfile.id, kind: 'direct', replyId: 'workflow-tools', page: workflowPage }
    const unregister = registerChatReply(context, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
    const bridge = await openChatMcpBridge({ accountId: null, accountType: 'admin' }, ['read', 'generate', 'organize', 'configure'], null, { chatContext: context })
    try {
      assert.deepEqual(bridge.tools.map((tool) => tool.function.name).sort(), ['get_current_page', 'get_workflow_editor', 'list_workflow_modules', 'propose_workflow_changes'].sort())
      const read = await bridge.call('get_workflow_editor', {})
      assert.ok(!read.isError)
      const catalog = await bridge.call('list_workflow_modules', { moduleIds: [textModule.id] })
      assert.ok(!catalog.isError)
      assert.ok(!JSON.stringify(catalog).includes('template_defaults'))
      assert.ok((await bridge.call('propose_workflow_changes', { operations: [{ type: 'add_node', nodeId: 'unknown', moduleId: 9999999 }] })).isError)
      const result = await bridge.call('propose_workflow_changes', { revision: 'untrusted-model-revision', operations: createGraph })
      assert.ok(!result.isError, JSON.stringify(result))
      const proposal = (result.structuredContent as { proposal: import('@conai/shared').ChatProposal }).proposal
      assert.ok(proposal.kind === 'workflow_graph')
      assert.equal(proposal.nodeCount, 2)
      assert.equal(proposal.revision, emptyWorkflow.revision, 'model arguments cannot override the request-owned editor revision')
      assert.equal(proposal.saved, undefined)
      assert.ok(!('workflow' in proposal.page), 'review cards do not retain the entire page graph')
      const restored = attachProposals([{ id: 100, thread_id: workflowThreadId, role: 'assistant', content: '', tool_calls: [], routing: { replyId: context.replyId, replyTo: null, recipients: [] } } as unknown as CodexChatMessageRecord])
      assert.equal(restored[0].tool_calls[0].tool, 'propose_workflow_changes')
      assert.equal(restored[0].tool_calls[0].proposal?.id, proposal.id, 'Codex replies and reloaded history restore the graph review card')
      requireChatWorkflowModules(proposal.modules)
      ModuleDefinitionModel.update(textModule.id, { version: textModule.version + 1 })
      assert.throws(() => requireChatWorkflowModules(proposal.modules), /모듈 정의/)
      ModuleDefinitionModel.update(textModule.id, { version: textModule.version })
      unregister()
      assert.ok((await bridge.call('propose_workflow_changes', { revision: emptyWorkflow.revision, operations: createGraph })).isError)
    } finally { unregister(); await bridge.close() }
  })

  await t.test('page actions: exact native schemas, route binding, protected data and fresh revisions', async () => {
    const { copyChatPageData, validateChatPageArguments, requireChatPageActionState, chatPagePermission } = await import('@conai/shared')
    const schema = { type: 'object' as const, properties: { name: { type: 'string' as const, maxLength: 100 }, items: { type: 'array' as const, minItems: 1, maxItems: 8, items: { type: 'object' as const, properties: { description: { type: 'string' as const }, value: { type: 'string' as const } }, required: ['description', 'value'] } } }, required: ['name', 'items'] }
    const action = { id: 'preset.create', label: 'Create preset', description: 'Save reviewed preset', effect: 'save' as const, schema }
    const current = normalizeChatPageSnapshot({ ...page, path: '/prompts', kind: 'presets', resourceId: 'new-preset', fields: [], revision: 'action-revision-test', actions: [action], data: { selected: null } })
    const args = { name: 'Test', items: [{ description: 'Style', value: 'watercolor' }] }
    assert.deepEqual(validateChatPageArguments(schema, { ...args, items: JSON.stringify(args.items) }), args)
    assert.throws(() => validateChatPageArguments(schema, { ...args, url: 'https://external.invalid' }), /등록된/)
    assert.throws(() => validateChatPageArguments(schema, { name: 'Test', items: [] }), /개수/)
    assert.throws(() => copyChatPageData({ nested: { api_key: 'private' } }), /보호된/)
    assert.throws(() => copyChatPageData({ image: 'data:image/png;base64,secret' }), /페이지 데이터/)
    assert.throws(() => normalizeChatPageSnapshot({ ...current, path: '/wildcards' }), /대상 페이지/)
    assert.throws(() => normalizeChatPageSnapshot({ ...current, actions: [{ ...action, id: 'shell.execute' }] }), /등록되지/)
    assert.throws(() => normalizeChatPageSnapshot({ ...current, actions: [{ ...action, effect: 'draft' }] }), /저장 범위/)
    const proposal = { kind: 'page_action' as const, page: chatPageTarget(current), revision: current.revision!, action: current.actions![0], arguments: args, before: null, expiresAt: Date.now() + 60000 }
    requireChatPageActionState(current, proposal)
    requireChatPageActionState({ ...current, actions: [action] }, proposal)
    const nodeSchema = { type: 'object' as const, properties: { postprocess: { type: 'object' as const, properties: { rtx: { type: 'object' as const, properties: { quality: { type: 'string' as const, enum: ['High', 'Ultra'] } } } } } } }
    assert.ok(normalizeChatPageSnapshot({ ...page, revision: 'nested-node-schema', data: { nodes: [{ fieldId: 'director', schema: nodeSchema }] } }).data?.nodes)
    assert.throws(() => requireChatPageActionState({ ...current, revision: 'different-revision' }, proposal), /입력이나 선택/)
    assert.throws(() => requireChatPageActionState(current, { ...proposal, expiresAt: 0 }), /만료/)
    assert.equal(chatPagePermission('/chat'), 'page.chat.view')
    assert.equal(chatPagePermission('/public/workflows/example'), '')
    assert.equal(normalizeChatPageSnapshot({ ...page, path: '/public/workflows/example' }).kind, 'comfyui')
    assert.equal(normalizeChatPageSnapshot({ ...page, path: '/public/workflows/example', revision: 'shared-create', actions: [{ id: 'comfy.open_create', label: 'Open', description: 'Open native editor', effect: 'draft', schema: { type: 'object', properties: {} } }] }).actions?.[0].id, 'comfy.open_create')
    assert.deepEqual(buildChatPageChanges(page, [{ fieldId: 'prompt', value: ['first', 'second edited'] }])[0].value, ['first', 'second edited'])
  })

  await t.test('page action tools: user review only, native record changes and expired replies', async () => {
    const { PromptPresetModel } = await import('../src/models/PromptPreset')
    const { nativeEditRevision } = await import('../src/services/nativeEditRevision')
    const { chatPageNativeActionRevision } = await import('../src/services/codex-chat/chatPageNativeActions')
    const preset = PromptPresetModel.create({ name: 'Action fixture', items: [{ description: 'Style', value: 'old' }] })
    const saved = PromptPresetModel.findByIdWithItems(preset.id)!
    const action = { id: 'preset.update', label: 'Edit preset', description: 'Save reviewed preset', effect: 'save' as const, schema: { type: 'object' as const, properties: { id: { type: 'number' as const, enum: [preset.id] }, name: { type: 'string' as const }, items: { type: 'array' as const, minItems: 1, items: { type: 'object' as const, properties: { description: { type: 'string' as const }, value: { type: 'string' as const } }, required: ['description', 'value'] } } }, required: ['id', 'name', 'items'] } }
    const snapshot = normalizeChatPageSnapshot({ ...page, path: '/prompts', kind: 'presets', resourceId: String(preset.id), fields: [], revision: 'native-action-revision', actions: [action], data: { presets: [{ id: preset.id, name: preset.name }], selected: { id: preset.id, revision: nativeEditRevision(saved) } } })
    const actionProfile = ChatProfileStore.create({ name: 'Action assistant', engine: 'llm', providerName: 'conn', mcpEnabled: true, mcpScopes: ['read'], toolAllowlist: ['get_current_page', 'read_page_data', 'propose_page_action'] })
    const actionThreadId = CodexChatStore.createThread(null, 'action chat', 'llm', actionProfile.id)
    const context: ChatExecutionContext = { threadId: actionThreadId, profileId: actionProfile.id, kind: 'direct', replyId: 'page-action-tools', page: snapshot }
    const unregister = registerChatReply(context, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
    const bridge = await openChatMcpBridge({ accountId: null, accountType: 'admin' }, ['read', 'generate', 'organize', 'configure'], null, { chatContext: context })
    try {
      assert.deepEqual(bridge.tools.map((tool) => tool.function.name).sort(), ['get_current_page', 'read_page_data', 'propose_page_action'].sort())
      assert.ok(!(await bridge.call('read_page_data', { key: 'presets', limit: 1 })).isError)
      const args = { id: preset.id, name: 'Edited fixture', items: [{ description: 'Style', value: 'new' }] }
      assert.ok((await bridge.call('propose_page_action', { actionId: 'preset.update', arguments: { ...args, id: preset.id + 1 } })).isError)
      const result = await bridge.call('propose_page_action', { actionId: 'preset.update', arguments: args })
      assert.ok(!result.isError, JSON.stringify(result))
      const proposal = (result.structuredContent as { proposal: import('@conai/shared').ChatProposal }).proposal
      assert.ok(proposal.kind === 'page_action')
      assert.equal(proposal.revision, snapshot.revision)
      assert.equal(proposal.nativeRevision, nativeEditRevision(saved))
      assert.equal(PromptPresetModel.findById(preset.id)?.name, 'Action fixture', 'proposals never save native data')
      assert.equal(ChatProposalStore.find(proposal.id)?.kind, 'page_action')
      const restored = attachProposals([{ id: 199, thread_id: actionThreadId, role: 'assistant', content: '', tool_calls: [], routing: { replyId: context.replyId, replyTo: null, recipients: [] } } as unknown as CodexChatMessageRecord])
      assert.equal(restored[0].tool_calls[0].tool, 'propose_page_action')
      PromptPresetModel.update(preset.id, { items: [{ description: 'Style', value: 'concurrent change' }] })
      assert.throws(() => chatPageNativeActionRevision(snapshot, 'preset.update', args), /최신 내용/)
      assert.ok((await bridge.call('propose_page_action', { actionId: 'preset.update', arguments: args })).isError)
      unregister()
      assert.ok((await bridge.call('propose_page_action', { actionId: 'preset.update', arguments: args })).isError)
    } finally { unregister(); await bridge.close() }
  })

  await t.test('native reviewed writes: compare-and-swap protects prompts, presets, wildcards and Comfy workflows', async (sub) => {
    const express = (await import('express')).default
    const { nativeEditRevision } = await import('../src/services/nativeEditRevision')
    const { db, initializeDatabase } = await import('../src/database/init')
    await initializeDatabase()
    const { PromptGroupModel } = await import('../src/models/PromptGroup')
    const { PromptPresetModel } = await import('../src/models/PromptPreset')
    const { WildcardModel } = await import('../src/models/Wildcard')
    const { WorkflowModel } = await import('../src/models/Workflow')
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => { (req as unknown as { session: object }).session = {}; next() })
    app.use('/prompts', (await import('../src/routes/promptCollection')).default)
    app.use('/presets', (await import('../src/routes/prompt-presets.routes')).promptPresetRoutes)
    app.use('/wildcards', (await import('../src/routes/wildcards')).default)
    app.use('/workflows', (await import('../src/routes/workflows/crud.routes')).default)
    const server = http.createServer(app)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    sub.after(() => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections() }))
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    const request = async (url: string, method = 'GET', body?: unknown, revision?: string) => {
      const response = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(revision ? { 'If-Match': revision } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      return { status: response.status, json: await response.json() as { data: Record<string, unknown> } }
    }
    const input = { type: 'positive', prompt: 'reviewed prompt fixture', synonyms: ['alias'], group_id: null }
    const created = await request('/prompts/item', 'POST', input)
    assert.equal(created.status, 201, JSON.stringify(created.json))
    const id = Number(created.json.data.id)
    db.prepare('UPDATE prompt_collection SET usage_count = 9 WHERE id = ?').run(id)
    const read = await request(`/prompts/item/${id}?type=positive`)
    const revision = String(read.json.data.assistant_revision)
    assert.equal((await request(`/prompts/item/${id}`, 'PUT', { ...input, prompt: 'reviewed edited prompt' }, revision)).status, 200)
    assert.equal((await request(`/prompts/item/${id}`, 'PUT', input, revision)).status, 409)
    assert.equal((await request(`/prompts/item/${id}?type=positive`)).json.data.usage_count, 9)
    assert.equal((await request('/prompts/item', 'POST', { ...input, prompt: 'reviewed edited prompt' })).status, 409)
    const locked = PromptGroupModel.create({ group_name: 'LoRA' })
    db.prepare('UPDATE prompt_collection SET group_id = ? WHERE id = ?').run(locked, id)
    assert.equal((await request(`/prompts/item/${id}`, 'PUT', input)).status, 403)
    assert.equal((await request('/prompts/item', 'POST', { ...input, group_id: locked })).status, 400)

    const preset = PromptPresetModel.create({ name: 'CAS preset', items: [{ description: 'Style', value: 'old' }] })
    const presetRevision = nativeEditRevision(PromptPresetModel.findByIdWithItems(preset.id))
    assert.equal((await request(`/presets/${preset.id}`, 'PUT', { name: 'CAS preset', items: [{ description: 'Style', value: 'new' }] }, presetRevision)).status, 200)
    assert.equal((await request(`/presets/${preset.id}`, 'PUT', { description: 'stale' }, presetRevision)).status, 409)
    assert.equal(PromptPresetModel.findByIdWithItems(preset.id)?.items?.[0].value, 'new')

    const wildcard = WildcardModel.create({ name: 'CAS wildcard', items: { general: [{ content: 'old', weight: 1 }], nai: [], comfyui: [] } })
    const wildcardRevision = nativeEditRevision(WildcardModel.findByIdWithItems(wildcard.id))
    assert.equal((await request(`/wildcards/${wildcard.id}`, 'PUT', { description: 'new' }, wildcardRevision)).status, 200)
    assert.equal((await request(`/wildcards/${wildcard.id}`, 'PUT', { description: 'stale' }, wildcardRevision)).status, 409)
    assert.equal(WildcardModel.findById(wildcard.id)?.description, 'new')

    const workflowId = WorkflowModel.create({ name: 'CAS Comfy', workflow_json: JSON.stringify({ 1: { class_type: 'Text', inputs: { text: 'draft' } } }), marked_fields: [] })
    const workflowRevision = nativeEditRevision(WorkflowModel.findById(workflowId))
    assert.equal((await request(`/workflows/${workflowId}`, 'PUT', { description: 'new' }, workflowRevision)).status, 200)
    assert.equal((await request(`/workflows/${workflowId}`, 'PUT', { description: 'stale' }, workflowRevision)).status, 409)
    assert.equal(WorkflowModel.findById(workflowId)?.description, 'new')
  })

  await t.test('page inputs: atomic validation, stale targets, edited values, and safe undo', () => {
    assert.ok(!('apiKey' in page))
    const changes = buildChatPageChanges(page, [{ fieldId: 'prompt', value: 'new' }, { fieldId: 'steps', value: 30 }])
    const { fields: _fields, ...target } = page
    const proposal = { kind: 'page_fields' as const, page: target, changes, expiresAt: Date.now() + 60_000 }
    assert.deepEqual(chatPagePatch(page, proposal), { prompt: 'new', steps: '30' })
    assert.throws(() => buildChatPageChanges(page, [{ fieldId: 'prompt', value: 'new' }, { fieldId: 'steps', value: 51 }]), /범위/)
    assert.throws(() => buildChatPageChanges(page, [{ fieldId: 'sampler', value: 'unknown' }]), /선택 목록/)
    assert.throws(() => buildChatPageChanges(page, [{ fieldId: 'apiKey', value: 'secret' }]), /등록되지/)
    assert.throws(() => chatPagePatch({ ...page, instanceId: 'another-page' }, proposal), /페이지/)
    assert.throws(() => chatPagePatch({ ...page, connectionId: 'new-connection' }, proposal), /페이지/)
    assert.throws(() => chatPagePatch({ ...page, fields: page.fields.map((field) => field.id === 'steps' ? { ...field, value: '21' } : field) }, proposal), /입력값/)
    const applied = { ...page, fields: page.fields.map((field) => ({ ...field, value: changes.find((change) => change.fieldId === field.id)?.value ?? field.value })) }
    assert.deepEqual(chatPagePatch(applied, proposal, true), { prompt: ['old', 'second'], steps: '20' })
    assert.throws(() => chatPagePatch(page, { ...proposal, expiresAt: 0 }), /유효 시간/)
    assert.throws(() => normalizeChatPageSnapshot({ ...page, path: 'https://example.com' }), /페이지/)
  })

  await t.test('page extensions: registered routes, image identity, and read-only context', () => {
    const library = normalizeChatPageSnapshot({ ...page, path: '/', kind: 'library', resourceId: 'library:wide' })
    assert.equal(library.kind, 'library')
    assert.throws(() => normalizeChatPageSnapshot({ ...library, path: '/settings' }), /대상 페이지/)
    assert.throws(() => normalizeChatPageSnapshot({ ...page, path: '/prompts' }), /대상 페이지/)
    const prompts = normalizeChatPageSnapshot({ ...page, path: '/prompts', kind: 'prompt_search', resourceId: 'positive:all', fields: [
      { id: 'searchInput', label: 'Search draft', type: 'text', value: '' },
      { id: 'appliedSearch', label: 'Applied search', type: 'text', value: 'cat', editable: false },
    ] })
    assert.throws(() => buildChatPageChanges(prompts, [{ fieldId: 'appliedSearch', value: 'dog' }]), /읽기 전용/)
    const { fields: _fields, ...target } = prompts
    const forged = { kind: 'page_fields' as const, page: target, changes: [{ fieldId: 'appliedSearch', label: 'Applied search', before: 'cat', value: 'dog' }], expiresAt: Date.now() + 60_000 }
    assert.throws(() => chatPagePatch(prompts, forged), /읽기 전용/)
    const proposal = { ...forged, changes: buildChatPageChanges(prompts, [{ fieldId: 'searchInput', value: 'dog' }]) }
    assert.deepEqual(chatPagePatch(prompts, proposal), { searchInput: 'dog' })
    assert.throws(() => chatPagePatch({ ...prompts, resourceId: 'positive:3' }, proposal), /페이지/)
    const metadata = normalizeChatPageSnapshot({ ...page, path: '/images/image-a/metadata', kind: 'metadata', resourceId: 'image-a' })
    assert.equal(metadata.kind, 'metadata')
    assert.throws(() => normalizeChatPageSnapshot({ ...metadata, resourceId: 'image-b' }), /대상 페이지/)
    assert.throws(() => normalizeChatPageSnapshot({ ...metadata, path: '/images/image-a' }), /대상 페이지/)
  })

  await t.test('read-only page context never offers a modification tool', async () => {
    const context: ChatExecutionContext = { threadId: pageThreadId, profileId: pageProfile.id, kind: 'direct', replyId: 'page-read-only', page: { ...page, fields: page.fields.map((field) => ({ ...field, editable: false })) } }
    const unregister = registerChatReply(context, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
    const bridge = await openChatMcpBridge({ accountId: null, accountType: 'admin' }, ['read'], ['get_current_page', 'propose_page_changes'], { chatContext: context })
    try {
      assert.deepEqual(bridge.tools.map((tool) => tool.function.name), ['get_current_page'])
      const read = await bridge.call('get_current_page', {})
      assert.ok(!read.isError)
      assert.match(JSON.stringify(read.content), /editable/)
      assert.ok((await bridge.call('propose_page_changes', { changes: [{ fieldId: 'steps', value: 30 }] })).isError)
    } finally { unregister(); await bridge.close() }
  })

  await t.test('page tools: explicit binding, proposed fields only, and reply expiry', async () => {
    const context: ChatExecutionContext = { threadId: pageThreadId, profileId: pageProfile.id, kind: 'direct', replyId: 'page-tools', page }
    const unregister = registerChatReply(context, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
    const bridge = await openChatMcpBridge({ accountId: null, accountType: 'admin' }, ['read'], ['get_current_page', 'propose_page_changes'], { chatContext: context })
    const unbound = await openChatMcpBridge({ accountId: null, accountType: 'admin' }, ['read'])
    const broad = await openChatMcpBridge({ accountId: null, accountType: 'admin' }, ['read', 'generate', 'organize', 'configure'], null, { chatContext: context })
    try {
      assert.ok(!unbound.tools.some((tool) => tool.function.name === 'get_current_page'))
      assert.ok(!broad.tools.some((tool) => ['submit_generation_job', 'generate_nai', 'delete_files', 'propose_profile_update'].includes(tool.function.name)), 'page mode withholds side-effect tools even for broad profiles')
      assert.ok(broad.tools.every((tool) => ['get_current_page', 'propose_page_changes'].includes(tool.function.name)), 'page text cannot request unrelated private files or library data')
      assert.ok(!(await bridge.call('get_current_page', {})).isError)
      const created = await bridge.call('propose_page_changes', { changes: [{ fieldId: 'steps', value: 30 }] })
      assert.ok(!created.isError)
      assert.match(JSON.stringify(created.structuredContent), /page_fields/)
      const resultText = (created.content?.[0] as { text: string }).text
      assert.deepEqual(JSON.parse(resultText).changes, [{ fieldId: 'steps', label: 'Steps', before: '20', value: '30' }], 'the model receives the validated diff instead of guessing current values from old replies')
      assert.ok((await bridge.call('propose_page_changes', { changes: [{ fieldId: 'steps', value: 51 }] })).isError)
      unregister()
      assert.ok((await bridge.call('get_current_page', {})).isError)
    } finally { unregister(); await bridge.close(); await unbound.close(); await broad.close() }
  })

  await t.test('API LLM tools reject account permission revocation during a reply', async (sub) => {
    const { AuthAccount } = await import('../src/models/AuthAccount')
    const { AuthAccessControlService } = await import('../src/services/authAccessControlService')
    let permissions = ['chat.use', 'page.generation.view', 'workflows.view']
    sub.mock.method(AuthAccount, 'findById', () => ({ status: 'active', account_type: 'guest' }))
    sub.mock.method(AuthAccessControlService, 'resolveForAccountId', () => ({ permissionKeys: permissions }))
    const ownedThread = CodexChatStore.createThread(7, 'owned page', 'llm', pageProfile.id)
    const context: ChatExecutionContext = { threadId: ownedThread, profileId: pageProfile.id, kind: 'direct', replyId: 'page-revoke', page }
    const unregister = registerChatReply(context, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
    const bridge = await openChatMcpBridge({ accountId: 7, accountType: 'guest' }, ['read'], ['get_current_page'], { chatContext: context })
    try {
      assert.ok(!(await bridge.call('get_current_page', {})).isError)
      permissions = ['chat.use']
      assert.ok((await bridge.call('get_current_page', {})).isError)
    } finally { unregister(); await bridge.close() }
  })

  await t.test('workflow feature permission protects graph tools independently of current page reading', async (sub) => {
    const { AuthAccount } = await import('../src/models/AuthAccount')
    const { AuthAccessControlService } = await import('../src/services/authAccessControlService')
    const db = authModule.getAuthDb()
    const installed = db.prepare('SELECT id FROM auth_permissions WHERE permission_key = ?').get('workflows.view')
    if (!installed) {
      db.prepare('INSERT INTO auth_permissions (permission_key, resource, action) VALUES (?, ?, ?)').run('workflows.view', 'workflows', 'view')
      sub.after(() => { db.prepare('DELETE FROM auth_permissions WHERE permission_key = ?').run('workflows.view') })
    }
    let permissions = ['chat.use', 'page.generation.view']
    sub.mock.method(AuthAccount, 'findById', () => ({ status: 'active', account_type: 'guest' }))
    sub.mock.method(AuthAccessControlService, 'resolveForAccountId', () => ({ permissionKeys: permissions }))
    const ownedThread = CodexChatStore.createThread(7, 'owned workflow', 'llm', workflowProfile.id)
    const context: ChatExecutionContext = { threadId: ownedThread, profileId: workflowProfile.id, kind: 'direct', replyId: 'workflow-feature-revoke', page: workflowPage }
    const unregister = registerChatReply(context, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
    const bridge = await openChatMcpBridge({ accountId: 7, accountType: 'guest' }, ['read'], null, { chatContext: context })
    try {
      assert.ok(!(await bridge.call('get_current_page', {})).isError, 'current page reading follows page access')
      assert.ok((await bridge.call('get_workflow_editor', {})).isError)
      assert.ok((await bridge.call('list_workflow_modules', {})).isError)
      permissions.push('workflows.view')
      assert.ok(!(await bridge.call('get_workflow_editor', {})).isError)
      permissions = permissions.filter((permission) => permission !== 'workflows.view')
      assert.ok((await bridge.call('propose_workflow_changes', { operations: createGraph })).isError, 'revocation is checked during the same reply')
    } finally { unregister(); await bridge.close() }
  })

  await t.test('generation retry keys cannot reuse another chat account job', async (sub) => {
    const { enqueueMcpGenerationJob } = await import('../src/mcp/tools/generationJobTools')
    const { GenerationQueueService } = await import('../src/services/generationQueueService')
    const { HistoryQueryRepository } = await import('../src/repositories/history/HistoryQueryRepository')
    sub.mock.method(GenerationQueueService, 'requestDispatch', () => {})
    sub.mock.method(HistoryQueryRepository, 'findAllWithMetadata', () => [])
    const input = { service_type: 'novelai' as const, request_payload: { prompt: 'isolated test', n_samples: 1 }, idempotency_key: 'same-retry-key' }
    const { AuthAccount } = await import('../src/models/AuthAccount')
    const { AuthAccessControlService } = await import('../src/services/authAccessControlService')
    sub.mock.method(AuthAccount, 'findById', () => ({ status: 'active', account_type: 'guest' }))
    sub.mock.method(AuthAccessControlService, 'resolveForAccountId', () => ({ permissionKeys: ['chat.use', 'generation.execute', 'images.view'] }))
    const generator = ChatProfileStore.create({ name: 'Generator', engine: 'llm', providerName: 'conn', mcpEnabled: true, mcpScopes: ['generate'] })
    const callers = [7, 8].map((accountId) => {
      const chatContext: ChatExecutionContext = { threadId: CodexChatStore.createThread(accountId, 'generation', 'llm', generator.id), profileId: generator.id, kind: 'direct', replyId: `generation-${accountId}` }
      const close = registerChatReply(chatContext, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
      sub.after(close)
      return { requester: { accountId, accountType: 'guest' as const }, source: 'llm-chat' as const, scopes: ['generate' as const], chatContext }
    })
    const caller = (accountId: number) => callers.find((caller) => caller.requester.accountId === accountId)!

    const first = await enqueueMcpGenerationJob(caller(7), input)
    const second = await enqueueMcpGenerationJob(caller(8), input)
    const retry = await enqueueMcpGenerationJob(caller(7), input)
    assert.notEqual(first?.id, second?.id)
    assert.equal(retry?.id, first?.id)
    assert.equal(retry?.idempotency_reused, true)
  })

  await t.test('configure scope: permission, HTTP exclusion, tool gating', async () => {
    assert.ok((CHAT_SCOPES as readonly string[]).includes('configure'))
    const access = (scopes: Array<typeof CHAT_SCOPES[number]>) => ({ codex: true, llm: true, scopes })
    assert.deepEqual(intersectChatScopes(['read', 'configure'], access(['read'])), ['read'])
    assert.deepEqual(intersectChatScopes(['read', 'configure'], access(['read', 'configure'])), ['read', 'configure'])
    assert.ok(!(MCP_HTTP_SCOPES as readonly string[]).includes('configure'))
    assert.ok(!(ALL_MCP_HTTP_SCOPES as string[]).includes('configure'))
    for (const tool of ['get_chat_setup_guide', 'list_chat_profiles', 'get_chat_profile', 'list_display_blocks', 'get_display_block', 'propose_display_block', 'propose_chat_profile', 'propose_profile_update']) {
      assert.equal(getMcpToolScope(tool), 'configure', tool)
    }
    const without = await openChatMcpBridge({ accountId: null, accountType: 'admin' }, ['read'])
    const withScope = await openChatMcpBridge({ accountId: null, accountType: 'admin' }, ['configure'])
    try {
      assert.ok(!without.tools.some((tool) => tool.function.name.startsWith('propose_')))
      assert.equal(withScope.tools.filter((tool) => tool.function.name.startsWith('propose_')).length, 4)
      assert.equal(withScope.tools.length, 9)
    } finally { await without.close(); await withScope.close() }
  })

  await t.test('chat setup proposals belong to administrators, not to a grantable key', async (sub) => {
    const { AuthAccount } = await import('../src/models/AuthAccount')
    const { resolveChatAccess } = await import('../src/services/codex-chat/codexChatAccess')
    let accountType = 'guest'
    sub.mock.method(AuthAccount, 'findById', () => ({ status: 'active', account_type: accountType }))
    assert.ok(!resolveChatAccess(7).scopes.includes('configure'))
    accountType = 'admin'
    assert.ok(resolveChatAccess(7).scopes.includes('configure'))
    assert.equal(authModule.getAuthDb().prepare("SELECT 1 FROM auth_permissions WHERE permission_key LIKE 'chat.tools.%'").get(), undefined)
  })

  await t.test('store: add keeps per-reply order, list merges, markSaved', () => {
    const first = ChatProposalStore.add(replyContext('r-store'), { kind: 'display_block', name: 'one', block: { key: 'one' }, linkProfileId: null })
    const second = ChatProposalStore.add(replyContext('r-store'), { kind: 'profile_update', profileId: profile.id, profileName: 'Mina', patch: { tagline: 'x' }, before: { tagline: 'y' } })
    const other = ChatProposalStore.add(replyContext('r-other'), { kind: 'profile', input: { name: 'N' } })
    const listed = ChatProposalStore.listForThread(threadId).filter((row) => row.replyId === 'r-store')
    assert.deepEqual(listed.map((row) => [row.id, row.seq]), [[first.id, 0], [second.id, 1]])
    assert.equal(ChatProposalStore.listForThread(threadId).find((row) => row.id === other.id)?.seq, 0)
    assert.equal(ChatProposalStore.find(first.id)?.kind, 'display_block')
    const saved = ChatProposalStore.markSaved(first.id, 42)
    assert.equal(saved?.kind === 'display_block' && saved.savedId, 42)
    const savedUpdate = ChatProposalStore.markSaved(second.id, null)
    assert.equal(savedUpdate?.kind === 'profile_update' && savedUpdate.saved, true)
    assert.equal(ChatProposalStore.markSaved(999999, 1), null)
    assert.equal(ChatProposalStore.deleteForThread(threadId) >= 3, true)
    assert.equal(ChatProposalStore.listForThread(threadId).length, 0)
  })

  await t.test('attachProposals matches propose_* calls by order and appends the rest as synthetic calls', () => {
    const a = ChatProposalStore.add(replyContext('r-attach'), { kind: 'display_block', name: 'a', block: { key: 'a' }, linkProfileId: null })
    const b = ChatProposalStore.add(replyContext('r-attach'), { kind: 'profile', input: { name: 'B' } })
    const c = ChatProposalStore.add(replyContext('r-attach'), { kind: 'profile_update', profileId: profile.id, profileName: 'Mina', patch: { name: 'C' }, before: { name: 'Mina' } })
    const call = (id: string, tool: string, status: 'completed' | 'failed' = 'completed') => ({ id, tool, status, arguments: null, summary: null, historyIds: [], compositeHashes: [] })
    const message = (id: number, replyId: string | undefined, tool_calls: ReturnType<typeof call>[], role: 'assistant' | 'user' = 'assistant') =>
      ({ id, thread_id: threadId, role, content: '', tool_calls, routing: replyId ? { replyId, replyTo: null, recipients: [] } : null }) as unknown as CodexChatMessageRecord
    const [withCalls, unrelated, user] = attachProposals([
      message(1, 'r-attach', [call('1', 'search_images'), call('2', 'propose_display_block'), call('3', 'propose_chat_profile', 'failed'), call('4', 'propose_chat_profile')]),
      message(2, 'r-none', [call('5', 'propose_display_block')]),
      message(3, 'r-attach', [], 'user'),
    ])
    // The i-th propose_* call gets the i-th proposal (the failed call stored nothing and is skipped).
    assert.equal(withCalls.tool_calls[0].proposal, undefined)
    assert.equal(withCalls.tool_calls[1].proposal?.id, a.id)
    assert.equal(withCalls.tool_calls[2].proposal, undefined)
    assert.equal(withCalls.tool_calls[3].proposal?.id, b.id)
    // The third proposal has no call left: appended as a synthetic completed call.
    assert.equal(withCalls.tool_calls.length, 5)
    assert.deepEqual({ id: withCalls.tool_calls[4].id, tool: withCalls.tool_calls[4].tool, status: withCalls.tool_calls[4].status, proposalId: withCalls.tool_calls[4].proposal?.id }, { id: `proposal-${c.id}`, tool: 'propose_profile_update', status: 'completed', proposalId: c.id })
    assert.equal(unrelated.tool_calls[0].proposal, undefined)
    assert.equal(user.tool_calls.length, 0)
    // A Codex reply that kept no named calls gets every proposal as synthetic calls.
    const [codex] = attachProposals([message(4, 'r-attach', [])])
    assert.deepEqual(codex.tool_calls.map((entry) => entry.tool), ['propose_display_block', 'propose_chat_profile', 'propose_profile_update'])
    assert.equal(attachProposals([message(5, undefined, [call('6', 'propose_display_block')])])[0].tool_calls[0].proposal, undefined)
  })

  await t.test('tools: guides and read views never leak grants', async () => {
    const shared = ChatSharedBlockStore.create({ name: 'Existing card', block: { key: 'status', example: '{}' } })
    ChatProfileStore.update(profile.id, { blockIds: [shared.id] })
    const close = registerChatReply(replyContext('r-read'), controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
    const bridge = await openChatMcpBridge({ accountId: null, accountType: 'admin' }, ['configure'], null, { chatContext: replyContext('r-read') })
    const text = (result: { content?: unknown[] }) => String((result.content?.[0] as { text?: string }).text)
    try {
      const blockGuide = text(await bridge.call('get_chat_setup_guide', { topic: 'display_block' }))
      assert.match(blockGuide, /\{\{#each/)
      assert.match(blockGuide, /data-pick/)
      assert.ok(blockGuide.length < 7000)
      const profileGuide = text(await bridge.call('get_chat_setup_guide', { topic: 'profile' }))
      assert.match(profileGuide, /Fast Model/)
      assert.match(profileGuide, /Existing card/)
      const list = JSON.parse(text(await bridge.call('list_chat_profiles', {})))
      assert.equal(list[0].name, 'Mina')
      assert.deepEqual(Object.keys(list[0]).sort(), ['blockIds', 'engine', 'id', 'isEnabled', 'lorebookIds', 'model', 'modelSlotId', 'name', 'systemPromptLength', 'tagline'])
      const view = JSON.parse(text(await bridge.call('get_chat_profile', {})))
      assert.equal(view.systemPrompt, 'old prompt')
      assert.equal(typeof view.mcpEnabled, 'boolean')
      for (const forbidden of ['mcpScopes', 'toolAllowlist', 'toolPresetId', 'providerName', 'model', 'engine', 'background', 'avatar', 'generationPresetIds']) assert.equal(forbidden in view, false, forbidden)
      const blocks = JSON.parse(text(await bridge.call('list_display_blocks', {})))
      assert.deepEqual(blocks.map((row: { key: string }) => row.key), ['status'])
      assert.deepEqual(blocks[0].profiles, [{ id: profile.id, name: 'Mina' }])
      const one = JSON.parse(text(await bridge.call('get_display_block', { block_id: shared.id })))
      assert.equal(one.name, 'Existing card')
      assert.equal(one.block.key, 'status')
      assert.equal((await bridge.call('get_display_block', { block_id: 9999 })).isError, true)
    } finally { close(); await bridge.close() }
  })

  await t.test('propose tools: normalization, warnings, rejection, and a stale reply', async () => {
    const close = registerChatReply(replyContext('r-propose'), controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
    const bridge = await openChatMcpBridge({ accountId: null, accountType: 'admin' }, ['configure'], null, { chatContext: replyContext('r-propose') })
    const read = (result: { content?: unknown[] }) => String((result.content?.[0] as { text?: string }).text)
    try {
      const bad = await bridge.call('propose_display_block', { block: { key: '9bad', template: 'x' } })
      assert.equal(bad.isError, true)
      assert.equal(read(bad), 'block.key must match /^[a-z][a-z0-9_-]{0,31}$/')

      const ok = await bridge.call('propose_display_block', { name: '  My card ', block: { ...BLOCK, example: '[1]', template: '' } })
      assert.equal(ok.isError, undefined)
      const payload = JSON.parse(read(ok))
      assert.equal(payload.block.key, 'status')
      assert.equal(payload.block.enabled, true)
      assert.equal('id' in payload.block, false)
      assert.equal(payload.note, 'The card is shown to the user; nothing is saved until they press 저장.')
      assert.equal(payload.warnings.length, 3)
      assert.match(payload.warnings.join('\n'), /already used by shared block/)
      assert.match(payload.warnings.join('\n'), /not a valid JSON object/)
      assert.match(payload.warnings.join('\n'), /template is empty/)
      const stored = ChatProposalStore.find(payload.proposalId)
      assert.ok(stored && stored.kind === 'display_block')
      assert.equal(stored.kind === 'display_block' && stored.name, 'My card')
      assert.equal(stored.kind === 'display_block' && stored.linkProfileId, profile.id)
      assert.equal((ok.structuredContent as { proposal: { id: number } }).proposal.id, payload.proposalId)
      const unlinked = JSON.parse(read(await bridge.call('propose_display_block', { block: { ...BLOCK, key: 'fresh' }, link_to_profile: false })))
      assert.deepEqual(unlinked.warnings, [])
      const unlinkedStored = ChatProposalStore.find(unlinked.proposalId)
      assert.equal(unlinkedStored?.kind === 'display_block' && unlinkedStored.name, 'fresh')
      assert.equal(unlinkedStored?.kind === 'display_block' && unlinkedStored.linkProfileId, null)

      const created = JSON.parse(read(await bridge.call('propose_chat_profile', { name: 'Newbie', system_prompt: 'You are {{char}}.', model_slot: 'fast model', prompt_sections: [{ title: 'World', content: 'Rainy city' }], block_ids: [1], typeface: 'serif' })))
      assert.equal(created.input.modelSlotId, slot.id)
      assert.equal(created.input.promptSections[0].title, 'World')
      assert.deepEqual(created.input.style, { typeface: 'serif' })
      assert.deepEqual(created.warnings, [])
      assert.match(read(await bridge.call('propose_chat_profile', { name: 'X', system_prompt: 'y', model_slot: 'nope' })), /Known model slots: Fast Model/)
      assert.match(read(await bridge.call('propose_chat_profile', { name: 'X', system_prompt: 'y', lorebook_ids: [77] })), /no such id 77/)
      assert.equal((await bridge.call('propose_chat_profile', { name: '   ', system_prompt: 'y' })).isError, true)
      assert.equal((await bridge.call('propose_chat_profile', { name: 'X', system_prompt: 'y'.repeat(20_001) })).isError, true)

      const forbidden = await bridge.call('propose_profile_update', { patch: { engine: 'codex', mcpScopes: ['read'], toolAllowlist: [], name: 'Renamed' } })
      assert.equal(forbidden.isError, true)
      assert.match(read(forbidden), /Not proposable: engine, mcpScopes, toolAllowlist/)
      const unchanged = await bridge.call('propose_profile_update', { patch: { name: 'Mina', system_prompt: 'old prompt', tagline: 'old tagline' } })
      assert.equal(unchanged.isError, true)
      assert.match(read(unchanged), /Nothing would change/)
      const update = JSON.parse(read(await bridge.call('propose_profile_update', { patch: { name: 'Mina', tagline: 'new tagline', model_slot: slot.name } })))
      assert.deepEqual(update.changed, ['tagline', 'modelSlotId'])
      const updateStored = ChatProposalStore.find(update.proposalId)
      assert.ok(updateStored && updateStored.kind === 'profile_update')
      if (updateStored.kind === 'profile_update') {
        assert.deepEqual(updateStored.patch, { tagline: 'new tagline', modelSlotId: slot.id })
        assert.deepEqual(updateStored.before, { tagline: 'old tagline', modelSlotId: null })
        assert.equal(updateStored.profileName, 'Mina')
      }
      assert.match(read(await bridge.call('propose_profile_update', { profile_id: 9999, patch: { name: 'Z' } })), /not found/)

      controller.abort()
      const stale = await bridge.call('propose_display_block', { block: BLOCK })
      assert.equal(stale.isError, true)
      assert.match(read(stale), /ended|interrupted/)
    } finally { close(); await bridge.close() }
  })

  await t.test('saved route: admin + owned thread, id rules, 404', async () => {
    const express = (await import('express')).default
    const router = (await import('../src/routes/chat-proposals.routes')).default
    const app = express()
    app.use(express.json())
    // The real app mounts express-session before this router; the bootstrap owner (no accounts configured) needs an empty session.
    app.use((req, _res, next) => { (req as unknown as { session: object }).session = {}; next() })
    app.use('/api/chat-proposals', router)
    const server = http.createServer(app)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    t.after(() => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections() }))
    const port = (server.address() as { port: number }).port
    const post = async (id: number | string, body: unknown, operation = 'saved') => {
      const response = await fetch(`http://127.0.0.1:${port}/api/chat-proposals/${id}/${operation}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      return { status: response.status, json: await response.json() as { success: boolean; data?: { id: number; savedId: number | null; saved: boolean } } }
    }
    const block = ChatProposalStore.add(replyContext('r-route'), { kind: 'display_block', name: 'n', block: { key: 'n' }, linkProfileId: null })
    const update = ChatProposalStore.add(replyContext('r-route'), { kind: 'profile_update', profileId: profile.id, profileName: 'Mina', patch: { name: 'Q' }, before: { name: 'Mina' } })
    assert.equal((await post(block.id, {})).status, 400)
    assert.equal((await post(block.id, { savedId: 'x' })).status, 400)
    const done = await post(block.id, { savedId: 7 })
    assert.equal(done.status, 200)
    assert.deepEqual(done.json, { success: true, data: { id: block.id, savedId: 7, saved: true } })
    const marked = ChatProposalStore.find(block.id)
    assert.equal(marked?.kind === 'display_block' && marked.savedId, 7)
    assert.equal((await post(update.id, {})).status, 200)
    assert.equal((await post(999999, { savedId: 1 })).status, 404)
    // A chat owned by an account is invisible to the account-less requester.
    const foreignThread = CodexChatStore.createThread(5, 'foreign', 'llm', profile.id)
    const foreign = ChatProposalStore.add({ threadId: foreignThread, profileId: profile.id, kind: 'direct', replyId: 'r-foreign' }, { kind: 'profile', input: { name: 'F' } })
    assert.equal((await post(foreign.id, { savedId: 1 })).status, 404)
    const { fields: _fields, ...target } = page
    const proposed = ChatProposalStore.add({ threadId: pageThreadId, profileId: pageProfile.id, kind: 'direct', replyId: 'page-route' }, { kind: 'page_fields', page: target, changes: buildChatPageChanges(page, [{ fieldId: 'steps', value: 30 }]), expiresAt: Date.now() + 60_000 })
    const binding = { instanceId: page.instanceId, connectionId: page.connectionId }
    assert.equal((await post(proposed.id, { ...binding, connectionId: 'wrong-connection' }, 'page-check')).status, 409)
    assert.equal((await post(proposed.id, binding, 'page-check')).status, 200)
    const reviewed = ChatProposalStore.find(proposed.id)
    assert.ok(reviewed?.kind === 'page_fields')
    assert.ok(!reviewed.saved, 'authorizing a card is not applying it')
    assert.equal((await post(proposed.id, binding, 'page-applied')).status, 200)
    assert.equal((await post(proposed.id, binding, 'page-check')).status, 409, 'no duplicate apply')
    assert.equal((await post(proposed.id, { ...binding, undo: true }, 'page-check')).status, 200)
    const transaction = applyChatWorkflowOperations(emptyWorkflow, workflowModules, createGraph)
    const graphProposal = ChatProposalStore.add({ threadId: workflowThreadId, profileId: workflowProfile.id, kind: 'direct', replyId: 'workflow-route' }, {
      kind: 'workflow_graph', page: chatPageTarget(workflowPage), revision: emptyWorkflow.revision, operations: transaction.operations,
      modules: [textModule, finalModule], changes: transaction.changes, issues: transaction.issues, nodeCount: 2, edgeCount: 1, expiresAt: Date.now() + 60_000,
    })
    const graphBinding = { ...binding, revision: emptyWorkflow.revision }
    assert.equal((await post(graphProposal.id, { ...graphBinding, revision: 'wrong-revision' }, 'page-check')).status, 409)
    assert.equal((await post(graphProposal.id, graphBinding, 'page-check')).status, 200)
    ModuleDefinitionModel.update(textModule.id, { version: textModule.version + 1 })
    assert.equal((await post(graphProposal.id, graphBinding, 'page-check')).status, 409, 'server rechecks current module interfaces')
    ModuleDefinitionModel.update(textModule.id, { version: textModule.version })
    assert.equal((await post(graphProposal.id, graphBinding, 'page-applied')).status, 200)
    assert.equal(ChatProposalStore.find(graphProposal.id)?.kind === 'workflow_graph' && (ChatProposalStore.find(graphProposal.id) as { saved?: boolean }).saved, true)
    assert.equal((await post(graphProposal.id, graphBinding, 'page-check')).status, 409)
    assert.equal((await post(graphProposal.id, { ...graphBinding, undo: true }, 'page-check')).status, 200)
    ChatProfileStore.update(workflowProfile.id, { toolAllowlist: ['get_current_page'] })
    assert.equal((await post(graphProposal.id, { ...graphBinding, undo: true }, 'page-check')).status, 403)
    ChatProfileStore.update(pageProfile.id, { mcpEnabled: false })
    assert.equal((await post(proposed.id, { ...binding, undo: true }, 'page-check')).status, 403)
  })
})
