import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

/**
 * What a chat gets for ComfyUI authoring: the seed rule in the generation tools and page guidance, the server-check tool
 * (offered to chat, also while a page is connected), and the editor's check / suggested-field operations.
 */
test('comfy chat authoring: seed rule, check_comfy_workflow, editor operations', { timeout: 60000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-comfy-chat-authoring-'))
  process.env.RUNTIME_BASE_PATH = root
  for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
    process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
  }
  process.env.FRONTEND_DIST_PATH = path.join(root, 'no-frontend')
  const authModule = await import('../src/database/authDb')
  authModule.initializeAuthDb()
  const main = await import('../src/database/init')
  await main.initializeDatabase()
  const user = await import('../src/database/userSettingsDb')
  user.initializeUserSettingsDb()
  ;(await import('../src/database/apiGenerationDb')).initializeApiGenerationDb()
  t.after(async () => {
    authModule.getAuthDb().close()
    user.closeUserSettingsDb()
    main.closeDatabase()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
    assert.ok(path.basename(root).startsWith('conai-comfy-chat-authoring-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  const { createMcpServer } = await import('../src/mcp/server')
  const { catalogToolNames } = await import('../src/mcp/toolCatalog')
  const { ALL_MCP_HTTP_SCOPES, GENERATION_PRESET_BLOCKED_TOOLS } = await import('../src/mcp/context')
  const { CHAT_SCOPES } = await import('../src/services/codex-chat/chatSettings')
  const { chatPageReference } = await import('../src/services/codex-chat/chatPageContext')
  const { describeMcpMarkedField } = await import('../src/services/comfyui/comfyWorkflowInputs')
  const { COMFY_SEED_RULE } = await import('../src/services/comfyui/seedControl')
  const { WorkflowModel } = await import('../src/models/Workflow')
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { chatPageActionLeavesScreen, chatPageActionTier, normalizeChatPageSnapshot } = await import('@conai/shared')
  const { Client, InMemoryTransport } = await import('@modelcontextprotocol/client')

  // Marked seed fields carry the rule; other fields do not.
  const seedField = describeMcpMarkedField({ id: 'seed', label: 'Seed', type: 'number', jsonPath: '3.inputs.seed' } as never)
  const stepsField = describeMcpMarkedField({ id: 'steps', label: 'Steps', type: 'number', jsonPath: '3.inputs.steps' } as never)
  assert.match(String((seedField as Record<string, unknown>).seed_rule), /-1/)
  assert.equal((stepsField as Record<string, unknown>).seed_rule, undefined)
  assert.ok(!GENERATION_PRESET_BLOCKED_TOOLS.has('check_comfy_workflow'), 'presets allow authorized diagnostics')
  const { isContextToolAllowed } = await import('../src/mcp/toolAccess')
  const presetContext = { source: 'llm-chat' as const, scopes: ['read', 'generate'] as const, generationPresetIds: [1] }
  for (const name of ['list_workflows', 'get_workflow_details', 'get_graph_workflow_execution', 'list_comfyui_servers']) {
    assert.equal(isContextToolAllowed({ ...presetContext, scopes: [...presetContext.scopes] }, name), true, name)
    assert.equal(isContextToolAllowed({ ...presetContext, scopes: ['generate'] }, name), false, 'reads still need a read grant')
    assert.equal(isContextToolAllowed({ ...presetContext, scopes: ['read'], toolAllowlist: [] }, name), false, 'reads still follow the allowlist')
  }
  assert.equal(isContextToolAllowed({ ...presetContext, scopes: [...presetContext.scopes] }, 'submit_generation_job'), false, 'presets still block free-form generation')


  const connect = async (context: Parameters<typeof createMcpServer>[0]) => {
    const server = createMcpServer(context)
    const client = new Client({ name: 'comfy-authoring', version: '1' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    return { server, client, close: async () => { await client.close(); await server.close() } }
  }
  const text = (result: Awaited<ReturnType<InstanceType<typeof Client>['callTool']>>) => (result.content as Array<{ text?: string }>).map((part) => part.text ?? '').join('')

  // External MCP: the tool lists directly, with the seed rule in the input schemas.
  const http = await connect({ scopes: ALL_MCP_HTTP_SCOPES })
  try {
    const tools = (await http.client.listTools()).tools
    const describe = (name: string) => tools.find((tool) => tool.name === name)?.description ?? ''
    for (const [name, field] of [['generate_comfyui', 'inputs'], ['check_comfy_workflow', 'workflow_json']]) {
      const schema = tools.find((tool) => tool.name === name)?.inputSchema as { properties?: Record<string, { description?: string }> } | undefined
      assert.ok(schema?.properties?.[field]?.description?.includes(COMFY_SEED_RULE), `${name} explains the seed rule`)
    }
    assert.ok(JSON.stringify(tools.find((tool) => tool.name === 'submit_generation_job')?.inputSchema).includes('conai_fixed_seeds'), 'submit_generation_job inputs explain the seed rule')
    assert.match(describe('import_workflow_definition'), /editor \("Save"\) workflow/)

    const neither = await http.client.callTool({ name: 'check_comfy_workflow', arguments: {} })
    assert.equal(neither.isError, true)
    assert.match(text(neither), /either workflow_id or workflow_json/)

    const apiWorkflow = JSON.stringify({ 1: { class_type: 'KSampler', inputs: { seed: 5 } } })
    const draft = await http.client.callTool({ name: 'check_comfy_workflow', arguments: { workflow_json: apiWorkflow } })
    assert.notEqual(draft.isError, true, text(draft))
    const draftResult = JSON.parse(text(draft))
    assert.equal(draftResult.converted, false)
    assert.deepEqual(draftResult.servers, [])
    assert.match(draftResult.note, /No active ComfyUI server/)

    // An editor workflow needs a server to convert; with none registered the reason comes back.
    const uiDraft = await http.client.callTool({ name: 'check_comfy_workflow', arguments: { workflow_json: JSON.stringify({ nodes: [], links: [] }) } })
    assert.equal(uiDraft.isError, true)
    assert.match(text(uiDraft), /API 형식/)

    const id = WorkflowModel.create({ name: 'Checked', workflow_json: apiWorkflow, marked_fields: [], api_endpoint: 'http://unused.invalid' } as never)
    const saved = await http.client.callTool({ name: 'check_comfy_workflow', arguments: { workflow_id: id } })
    assert.notEqual(saved.isError, true, text(saved))
    const missing = await http.client.callTool({ name: 'check_comfy_workflow', arguments: { workflow_id: 999999 } })
    assert.match(text(missing), /not found/)
  } finally {
    await http.close()
  }

  // A chat sees it in the catalog, and keeps it on a connected page (a read: nothing is saved or run).
  ExternalApiProvider.create({ provider_name: 'conn', display_name: 'Conn', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
  const profile = ChatProfileStore.create({ name: 'Comfy author', engine: 'llm', providerName: 'conn', mcpEnabled: true, mcpScopes: [...CHAT_SCOPES] })
  const threadId = CodexChatStore.createThread(null, 'comfy chat', 'llm', profile.id)
  const author = normalizeChatPageSnapshot({
    instanceId: 'page-comfy', connectionId: 'connection-comfy', path: '/generation', title: 'ComfyUI 워크플로 등록·수정', kind: 'comfy_author', resourceId: 'new-comfy', revision: 'revision-1',
    fields: [{ id: 'name', label: '이름', type: 'text', value: '' }],
    actions: [
      { id: 'comfy.author', label: 'Edit', description: 'Edit', effect: 'draft', schema: { type: 'object', properties: {} } },
      { id: 'comfy.check', label: 'Check', description: 'Check', effect: 'draft', schema: { type: 'object', properties: {} } },
      { id: 'comfy.suggest_fields', label: 'Suggest', description: 'Suggest', effect: 'draft', schema: { type: 'object', properties: { jsonPaths: { type: 'array', items: { type: 'string', enum: ['3.inputs.seed'] } } } } },
      { id: 'comfy.register', label: 'Register', description: 'Register', effect: 'save', schema: { type: 'object', properties: {} } },
    ],
    data: { check: { state: 'none' }, seedInputs: [], suggestedFields: [] },
  })
  for (const page of [undefined, author]) {
    const chat = await connect({ scopes: [...CHAT_SCOPES] as never, source: 'llm-chat', requester: { accountId: null, accountType: 'admin' }, chatContext: { threadId, profileId: profile.id, kind: 'direct', replyId: 'comfy-reply', ...(page ? { page } : {}) } })
    try {
      const names = new Set([...(await chat.client.listTools()).tools.map((tool) => tool.name), ...catalogToolNames(chat.server)])
      assert.ok(names.has('check_comfy_workflow'), `check_comfy_workflow is offered ${page ? 'on a connected page' : 'without a page'}`)
      assert.ok(!names.has('import_workflow_definition'), 'importing stays out of chat')
    } finally {
      await chat.close()
    }
  }

  assert.equal(chatPageActionTier('comfy.check'), 'view')
  assert.equal(chatPageActionLeavesScreen('comfy.check'), false, 'checking keeps the editor and its unsaved draft')
  assert.equal(chatPageActionTier('comfy.suggest_fields'), 'draft')
  assert.throws(() => normalizeChatPageSnapshot({ instanceId: 'page-presets', connectionId: 'connection-presets', path: '/prompts', title: 'x', kind: 'presets', resourceId: 'presets', revision: 'revision-1', fields: [], actions: [{ id: 'comfy.check', label: 'Check', description: 'Check', effect: 'draft', schema: { type: 'object', properties: {} } }] }), /페이지 작업/)

  const authorGuide = chatPageReference(author)
  assert.ok(authorGuide.includes('comfy.check') && authorGuide.includes('fixedSeeds') && authorGuide.includes(COMFY_SEED_RULE), 'the editor guide covers conversion, the check, fixed seeds and the seed rule')
  const form = normalizeChatPageSnapshot({ instanceId: 'page-form', connectionId: 'connection-form', path: '/generation', title: 'ComfyUI · Test', kind: 'comfyui', resourceId: '1', fields: [{ id: 'seed', label: 'Seed', type: 'number', value: '', allowEmpty: true }], data: { seedFields: ['seed'] } })
  assert.ok(chatPageReference(form).includes('data.seedFields') && chatPageReference(form).includes(COMFY_SEED_RULE), 'the generation form guide explains seed fields')

  await t.test('MiniMax RefMods: validated Director rows, export snapshots and library discovery', async (t) => {
    const { normalizeMcpWorkflowInputs, createMcpComfyService } = await import('../src/services/comfyui/comfyWorkflowInputs')
    const { ComfyUIServerModel, WorkflowServerModel } = await import('../src/models/ComfyUIServer')
    const field = {
      id: 'director', label: 'Director', type: 'node', node_editor: 'minimax_h3_director_dasiwa', jsonPath: '1.inputs',
      default_value: { mode: 'REF2VA', duration: 5, frame_rate: 24, timeline_data: '{"items":[]}' },
    } as never
    const normalize = (value: Record<string, unknown>) => normalizeMcpWorkflowInputs([field], { director: value }).director
    const invalid = [{ slot: 1, name: 'hero' }, { slot: 1, name: 'duplicate' }, { slot: 2, name: 'style', strength: 1.5 }]
    assert.throws(() => normalize({ refmods: invalid }), /duplicate slot 1.*strength.*0.*1/i)
    assert.throws(() => normalize({ timeline_data: JSON.stringify({ refmods: invalid }) }), /duplicate slot 1.*strength.*0.*1/i)
    const value = normalize({ refmods: [{ slot: '2', name: ' group/hero ', strength: '0.6' }, { slot: 8, name: 'style', enabled: false }] })
    assert.deepEqual(JSON.parse(value.timeline_data).refmods, [
      { slot: 2, name: 'group/hero', enabled: true, strength: 0.6, description: '' },
      { slot: 8, name: 'style', enabled: false, strength: 1, description: '' },
    ])
    assert.equal(value.refmods, undefined)
    assert.equal(JSON.parse(normalize({}).timeline_data).refmods, undefined, 'omitting RefMods preserves existing Director behavior')
    assert.throws(() => normalize({ refmods: ['group/hero'] }), /array of \{ slot, name/)
    const hiddenRow = JSON.stringify({ items: [], refmods: [{ slot: 1, name: '' }] })
    assert.deepEqual(JSON.parse(normalize({ mode: 'T2VA', timeline_data: hiddenRow }).timeline_data).refmods, [{ slot: 1, name: '' }], 'rows hidden outside REF2VA are kept, not validated')
    assert.throws(() => normalize({ mode: 'REF2VA', timeline_data: hiddenRow }), /slot 1 requires a name/)

    const { createServer } = await import('node:http')
    const express = (await import('express')).default
    let upstreamStatus = 200
    const upstream = createServer((req, res) => {
      assert.equal(req.url, '/dasiwa/refmods')
      res.writeHead(upstreamStatus, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify([
        { name: 'group/hero', kind: 'image', kinds: ['image', 'invalid'], members: [{ kind: 'image', description: 'Hero' }], concept: 'identity', description: 'Hero bundle', tokens: 12, mtime: 123 },
        { name: 'invalid', kind: 'invalid' }, null,
      ]))
    })
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
    t.after(() => new Promise<void>((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve())))
    const address = upstream.address() as import('node:net').AddressInfo
    const serverId = ComfyUIServerModel.create({ name: 'DaSiWa', endpoint: `http://127.0.0.1:${address.port}`, is_active: true, is_default: true })
    const serverRecord = ComfyUIServerModel.findById(serverId)!
    const comfy = createMcpComfyService(serverRecord)
    const workflow = {
      1: { class_type: 'MiniMaxH3Director', inputs: { timeline_data: '{"items":[{"id":"old"}]}' } },
      2: { class_type: 'DaSiWaH3RefModExport', inputs: { timeline_data: ' {} ', request_id: 'cached' } },
      3: { class_type: 'DaSiWaH3RefModExport', inputs: { timeline_data: ['1', 0], request_id: ['1', 1] } },
      4: { class_type: 'DaSiWaH3RefModExport', inputs: { timeline_data: '{"items":[{"id":"custom"}]}', request_id: '' } },
    }
    const submitted = comfy.substitutePromptData(JSON.stringify(workflow), [field], { director: value })
    assert.equal(submitted[2].inputs.timeline_data, value.timeline_data, 'export uses the final substituted Director snapshot')
    assert.match(submitted[2].inputs.request_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    assert.notEqual(comfy.substitutePromptData(JSON.stringify(workflow), [field], { director: value })[2].inputs.request_id, submitted[2].inputs.request_id)
    assert.deepEqual(submitted[3].inputs, workflow[3].inputs, 'linked inputs are preserved')
    assert.equal(submitted[4].inputs.timeline_data, workflow[4].inputs.timeline_data, 'explicit snapshots are preserved')
    for (const directors of [{}, { 1: workflow[1], 5: workflow[1] }]) {
      const ambiguous = comfy.substitutePromptData(JSON.stringify({ ...directors, 2: workflow[2] }), [], {})
      assert.equal(ambiguous[2].inputs.timeline_data, ' {} ', 'zero or multiple Directors do not infer a snapshot')
    }

    const app = express()
    app.use('/api/comfyui-servers', (await import('../src/routes/comfyuiServers')).comfyuiServerRoutes)
    const proxy = app.listen(0, '127.0.0.1')
    await new Promise<void>((resolve) => proxy.once('listening', resolve))
    t.after(() => new Promise<void>((resolve, reject) => proxy.close((error) => error ? reject(error) : resolve())))
    const proxyAddress = proxy.address() as import('node:net').AddressInfo
    const url = `http://127.0.0.1:${proxyAddress.port}/api/comfyui-servers/refmods`
    const expected = { server_id: serverId, server_name: 'DaSiWa', entries: [
      { name: 'group/hero', kind: 'image', kinds: ['image'], members: [{ kind: 'image', description: 'Hero' }], concept: 'identity', description: 'Hero bundle', tokens: 12, mtime: 123 },
    ] }
    const workflowId = WorkflowModel.create({ name: 'RefMod library', workflow_json: JSON.stringify(workflow), marked_fields: [], api_endpoint: 'http://unused.invalid' } as never)
    WorkflowServerModel.linkServer(workflowId, serverId)
    const mcp = await connect({ scopes: ['read'] })
    t.after(() => mcp.close())
    for (const query of ['', `?serverId=${serverId}`, `?workflowId=${workflowId}`]) {
      const response = await fetch(`${url}${query}`)
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { success: true, data: expected })
    }
    const tools = (await mcp.client.listTools()).tools
    assert.ok(tools.some((tool) => tool.name === 'list_comfy_refmods'))
    const library = await mcp.client.callTool({ name: 'list_comfy_refmods', arguments: { workflow_id: workflowId } })
    assert.notEqual(library.isError, true, text(library))
    assert.deepEqual(JSON.parse(text(library)), expected)
    for (const status of [404, 500]) {
      upstreamStatus = status
      const response = await fetch(url)
      assert.equal(response.status, status === 404 ? 404 : 502)
      const failure = await response.json() as { success: boolean; error: string }
      assert.equal(failure.success, false)
      assert.match(failure.error, status === 404 ? /DaSiWa.*not installed/i : /RefMod.*500/i)
      const result = await mcp.client.callTool({ name: 'list_comfy_refmods', arguments: { server_id: serverId } })
      assert.equal(result.isError, true)
      assert.match(text(result), status === 404 ? /DaSiWa.*not installed/i : /RefMod.*500/i)
    }
  })
})
