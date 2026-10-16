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

  // External MCP: the tool lists directly, with the seed rule in the generation tool descriptions.
  const http = await connect({ scopes: ALL_MCP_HTTP_SCOPES })
  try {
    const tools = (await http.client.listTools()).tools
    const describe = (name: string) => tools.find((tool) => tool.name === name)?.description ?? ''
    for (const name of ['generate_comfyui', 'check_comfy_workflow']) assert.ok(describe(name).includes(COMFY_SEED_RULE), `${name} explains the seed rule`)
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
})
