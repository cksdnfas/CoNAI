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
    let submittedExport: Record<string, any> | undefined
    let uploadCount = 0
    const exportHistory = {
      'refmod-prompt': { prompt: [], outputs: { '4': { dasiwa_refmod_export: [{ name: 'group/hero', members: [], counts: { image: 2, video: 0, audio: 0 }, warnings: [], message: 'Saved' }] } }, status: { completed: true, status_str: 'success' } },
    }
    const upstream = createServer((req, res) => {
      if (req.url === '/upload/image') {
        uploadCount++
        req.resume()
        req.on('end', () => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ name: `uploaded-${uploadCount}.png` })) })
        return
      }
      if (req.url === '/object_info/VAELoader') {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ VAELoader: { input: { required: { vae_name: [['video.vae', 'audio.vae']] } } } }))
        return
      }
      if (req.url === '/prompt') {
        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', () => {
          submittedExport = JSON.parse(body).prompt
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ prompt_id: 'refmod-prompt' }))
        })
        return
      }
      if (req.url === '/history/refmod-prompt') {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(exportHistory))
        return
      }
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
    const filtered = comfy.substitutePromptData(JSON.stringify(workflow), [field], { director: {
      ...value, mode: 'I2VA', timeline_data: JSON.stringify({
        items: [
          { id: 'first', type: 'image', slot: 0, value: 'uploaded.png' },
          { id: 'disabled', type: 'image', slot: 0, enabled: false },
          { id: 'last', type: 'image', slot: 1 },
          { id: 'sound', type: 'audio' },
        ],
        refmods: [{ slot: 2, name: 'group/hero' }], extra: 'kept',
      }),
    } })
    assert.deepEqual(JSON.parse(filtered[2].inputs.timeline_data), {
      items: [{ id: 'first', type: 'image', slot: 0, value: 'uploaded.png' }],
      refmods: [{ slot: 2, name: 'group/hero' }], extra: 'kept',
    })
    for (const directors of [{}, { 1: workflow[1], 5: workflow[1] }]) {
      const ambiguous = comfy.substitutePromptData(JSON.stringify({ ...directors, 2: workflow[2] }), [], {})
      assert.equal(ambiguous[2].inputs.timeline_data, ' {} ', 'zero or multiple Directors do not infer a snapshot')
    }

    const app = express()
    app.use(express.json())
    app.use((await import('express-session')).default({ secret: 'refmod-test-session', resave: false, saveUninitialized: false }))
    app.use('/api/comfyui-servers', (await import('../src/routes/comfyuiServers')).comfyuiServerRoutes)
    app.use('/api/refmods', (await import('../src/routes/refmods')).default)
    app.use('/api/workflows', (await import('../src/routes/workflows/templates.routes')).default)
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

    const { captureRefModRecords, listRefModRecords, linkRefModRecords, completeRefModRecords, resolveRefModRecordMedia, failRefModRecords, recoverInterruptedRefModRecords } = await import('../src/services/comfyui/refmodRecords')
    const { buildRefModExportTemplate } = await import('../src/services/comfyui/refmodExportTemplate')
    const { GenerationHistoryService, attachHistoryAudioResults } = await import('../src/services/generationHistoryService')
    const { HistoryQueryRepository } = await import('../src/repositories/history/HistoryQueryRepository')
    const { runtimePaths } = await import('../src/config/runtimePaths')
    const { db } = await import('../src/database/init')
    const template = buildRefModExportTemplate({ vaeNames: ['video.vae', 'audio.vae'] })
    const templateJson = JSON.parse(template.workflow_json)
    assert.deepEqual(Object.keys(templateJson), ['1', '2', '3', '4'])
    assert.deepEqual(templateJson[4].inputs.vae, ['2', 0])
    assert.deepEqual(templateJson[4].inputs.audio_vae, ['3', 0])
    assert.equal(templateJson[1].inputs.mode, 'REF2VA')
    assert.equal(templateJson[4].inputs.timeline_data, '')
    assert.ok(!JSON.stringify(templateJson[4]).includes('["1",'), 'Director is only a value carrier, not an executed ancestor')
    assert.deepEqual(template.marked_fields!.filter((entry) => entry.jsonPath.endsWith('.vae_name')).map((entry) => entry.options), [['video.vae', 'audio.vae'], ['video.vae', 'audio.vae']])
    assert.ok(template.marked_fields![0].node_hidden_controls!.includes('postprocess.rtx'))
    assert.deepEqual(template.marked_fields![0].node_visible_fields, ['mode', 'timeline_data'], 'creation templates expose source media lanes')
    assert.equal(buildRefModExportTemplate().marked_fields!.find((entry) => entry.id === 'audio_vae')!.type, 'text')

    const created = await fetch(`http://127.0.0.1:${proxyAddress.port}/api/workflows/templates/minimax-h3-refmod-export`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ server_id: serverId }),
    })
    assert.equal(created.status, 200)
    const templateId = ((await created.json()) as { data: { id: number } }).data.id
    assert.equal(WorkflowModel.findById(templateId)!.name, 'MiniMax H3 RefMod 생성')
    assert.equal(WorkflowServerModel.findServersByWorkflow(templateId)[0].server_id, serverId)

    const source = await (await import('sharp')).default({ create: { width: 2, height: 2, channels: 3, background: '#123456' } }).png().toBuffer()
    const hash = 'c'.repeat(48)
    await fs.promises.mkdir(runtimePaths.uploadsDir, { recursive: true })
    const libraryPath = path.join(runtimePaths.uploadsDir, 'refmod-library.png')
    await fs.promises.writeFile(libraryPath, source)
    const folderId = (db.prepare('SELECT id FROM watched_folders ORDER BY id LIMIT 1').get() as { id: number }).id
    db.prepare('INSERT INTO media_metadata (composite_hash) VALUES (?)').run(hash)
    db.prepare("INSERT INTO image_files (composite_hash, original_file_path, folder_id, file_size, mime_type) VALUES (?, ?, ?, ?, 'image/png')").run(hash, 'refmod-library.png', folderId, source.length)
    const director = {
      ...templateJson[1].inputs,
      timeline_data: JSON.stringify({ items: [
        { id: 'copy', type: 'image', order: 0, prompt: 'Copied portrait', source_width: 512, source_height: 768, trim_start: 0, trim_end: 2, source_duration: 2 },
        { id: 'library', type: 'image', order: 1, prompt: 'Library portrait' },
        { id: 'disabled', type: 'audio', enabled: false },
      ] }),
      __conai_minimax_h3_director: { assets: {
        copy: { fileName: 'portrait.html', dataUrl: `data:image/png;base64,${source.toString('base64')}` },
        library: { composite_hash: hash, fileName: 'original-library.png', mimeType: 'text/html' },
      } },
    }
    const capture = () => captureRefModRecords({
      workflowJson: template.workflow_json, markedFields: template.marked_fields!,
      promptData: { director, name: 'requested-name', description: 'Portrait bundle', concept_type: 'identity' },
      serverId, workflowId: templateId,
    })
    for (const [mimeType, bytes] of [
      ['image/png', Buffer.from('<html><script>alert(1)</script></html>')],
      ['image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')],
      ['text/html', source],
      ['audio/wav', source],
    ] as const) {
      const unsafeDirector = { ...director, __conai_minimax_h3_director: { assets: {
        ...director.__conai_minimax_h3_director.assets,
        copy: { fileName: 'unsafe.html', dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}` },
      } } }
      await assert.rejects(captureRefModRecords({
        workflowJson: template.workflow_json, markedFields: template.marked_fields!,
        promptData: { director: unsafeDirector }, serverId, workflowId: templateId,
      }), /media|type|content/i)
    }
    const handles = await capture()
    const pending = listRefModRecords(serverId)[0]
    assert.equal(pending.status, 'pending')
    assert.equal(pending.name, 'requested-name')
    assert.equal(pending.description, 'Portrait bundle')
    assert.equal(pending.concept_type, 'identity')
    assert.deepEqual(pending.members.map((member) => [member.index, member.kind, member.description, member.composite_hash]), [[0, 'image', 'Copied portrait', null], [1, 'image', 'Library portrait', hash]])
    assert.equal(pending.members[0].source_width, 512)
    assert.equal(pending.members[0].mime_type, 'image/png')
    assert.equal(pending.members[1].mime_type, 'image/png', 'library MIME is not controlled by the submitted asset')
    assert.equal(pending.members[1].file_name, 'original-library.png')
    const retainedPath = resolveRefModRecordMedia(pending.id, 0)!.filePath
    assert.deepEqual(await fs.promises.readFile(retainedPath), source)
    assert.deepEqual(await fs.promises.readdir(path.dirname(retainedPath)), ['0.png'], 'library sources are referenced, not copied')
    assert.equal(resolveRefModRecordMedia(pending.id, 1)!.filePath, libraryPath)
    const historyId = await GenerationHistoryService.createComfyUIHistory({ workflowId: templateId, workflowName: template.name, serverId })
    linkRefModRecords(handles, { historyId })
    const saved = completeRefModRecords(handles, exportHistory, 'refmod-prompt')[0]
    assert.equal(saved.status, 'saved')
    assert.equal(saved.name, 'group/hero')
    assert.equal(HistoryQueryRepository.findById(historyId)!.generation_status, 'completed')
    assert.deepEqual(HistoryQueryRepository.findDisplayFailedIds({ ids: [historyId] }), [], 'saved RefMods survive delete-failed-history selection')
    const emptyHistoryId = await GenerationHistoryService.createComfyUIHistory({ workflowId: templateId, workflowName: template.name, serverId })
    ;(await import('../src/services/historyCommandService')).HistoryCommandService.updateStatus(emptyHistoryId, 'completed')
    assert.deepEqual(HistoryQueryRepository.findDisplayFailedIds({ ids: [emptyHistoryId] }), [emptyHistoryId], 'missing-output histories remain selectable')
    const historyRow = attachHistoryAudioResults(HistoryQueryRepository.findAllWithMetadata({ ids: [historyId] }))[0]
    assert.equal(historyRow.refmod_results![0].name, 'group/hero')
    assert.equal(historyRow.refmod_name, 'group/hero', 'no-image history rows expose the RefMod display result')
    assert.equal(historyRow.refmod_record_id, saved.id)
    const enriched = await (await fetch(url)).json() as any
    assert.equal(enriched.data.entries[0].conai.id, saved.id)
    const enrichedMcp = await mcp.client.callTool({ name: 'list_comfy_refmods', arguments: { server_id: serverId } })
    assert.equal(JSON.parse(text(enrichedMcp)).entries[0].conai.id, saved.id)
    const mediaUrl = `http://127.0.0.1:${proxyAddress.port}${saved.members[0].media_url}`
    const mediaResponse = await fetch(mediaUrl)
    assert.equal(mediaResponse.status, 200)
    assert.equal(mediaResponse.headers.get('content-type'), 'image/png')
    assert.equal(mediaResponse.headers.get('content-security-policy'), 'sandbox')
    assert.equal(mediaResponse.headers.get('x-content-type-options'), 'nosniff')
    assert.deepEqual(Buffer.from(await mediaResponse.arrayBuffer()), source)
    assert.equal((await fetch(mediaUrl, { headers: { 'If-None-Match': mediaResponse.headers.get('etag')! } })).status, 304)
    const libraryMediaUrl = `http://127.0.0.1:${proxyAddress.port}${saved.members[1].media_url}`
    db.prepare("UPDATE media_metadata SET postprocess_status = 'pending' WHERE composite_hash = ?").run(hash)
    assert.equal((await fetch(libraryMediaUrl)).status, 404, 'library processing visibility is enforced')
    db.prepare("UPDATE media_metadata SET postprocess_status = 'ready' WHERE composite_hash = ?").run(hash)
    const libraryMedia = await fetch(libraryMediaUrl)
    assert.equal(libraryMedia.status, 200)
    assert.equal(libraryMedia.headers.get('content-type'), 'image/png')
    await libraryMedia.arrayBuffer()
    await failRefModRecords(handles, new Error('Late failure after successful export'))
    assert.equal(listRefModRecords(serverId).find((record) => record.id === saved.id)!.status, 'saved')
    assert.equal(fs.existsSync(retainedPath), true, 'late failures cannot remove successfully retained sources')

    const generationMcp = await connect({ scopes: ['read', 'generate'] })
    try {
      const result = await generationMcp.client.callTool({ name: 'generate_comfyui', arguments: {
        workflow_id: templateId, server_id: serverId, inputs: { director: { ...director, builder_state: {} }, video_vae: 'video.vae', audio_vae: 'audio.vae' },
      } })
      assert.notEqual(result.isError, true, text(result))
      const receipt = JSON.parse(text(result))
      assert.equal(receipt.success, true)
      assert.equal(receipt.outputCount, 0)
      assert.equal(receipt.refmod_name, 'group/hero')
      assert.equal(uploadCount, 2, 'only enabled members are uploaded')
      assert.deepEqual(JSON.parse(submittedExport!['4'].inputs.timeline_data).items.map((item: any) => item.value), ['uploaded-1.png', 'uploaded-2.png'])
    } finally {
      await generationMcp.close()
    }
    const queueExecution = await (await import('../src/services/comfyGenerationExecutor')).executeComfyGeneration({
      comfyService: comfy, workflow: submittedExport!,
    })
    assert.equal(queueExecution.representativeImage, null)
    assert.equal(queueExecution.savedImageCount, 0)
    assert.deepEqual(queueExecution.history, exportHistory, 'queue executor carries the export receipt despite having no image output')
    const failedHandles = await capture()
    const failedPath = resolveRefModRecordMedia(failedHandles[0].id, 0)!.filePath
    await failRefModRecords(failedHandles, new Error('Cancelled by user'))
    assert.equal(listRefModRecords(serverId)[0].status, 'failed')
    assert.equal(fs.existsSync(failedPath), false)

    const linkedWorkflow = JSON.parse(template.workflow_json)
    Object.assign(linkedWorkflow[4].inputs, { timeline_data: ['1', 0], name: ['1', 1], description: ['1', 2], concept_type: ['1', 3] })
    const linkedRecords = await captureRefModRecords({
      workflowJson: JSON.stringify(linkedWorkflow), markedFields: template.marked_fields!,
      promptData: { director }, serverId, workflowId: templateId,
    })
    linkRefModRecords(linkedRecords, { workflow: linkedWorkflow })
    assert.equal(listRefModRecords(serverId)[0].members.length, 2, 'linked timelines retain the Director sources without replacing the link')
    assert.equal(listRefModRecords(serverId)[0].name, null)
    assert.equal(listRefModRecords(serverId)[0].concept_type, 'generic')
    const linkedPath = resolveRefModRecordMedia(linkedRecords[0].id, 0)!.filePath

    const audioPath = path.join(root, 'refmod-tone.wav')
    ;(await import('node:child_process')).execFileSync((await import('ffmpeg-static')).default!, [
      '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.1', '-ac', '1', '-ar', '22050', audioPath,
    ], { windowsHide: true })
    const audioBytes = await fs.promises.readFile(audioPath)
    const audioDirector = {
      ...director, timeline_data: JSON.stringify({ items: [{ id: 'sound', type: 'audio' }] }),
      __conai_minimax_h3_director: { assets: { sound: { fileName: 'sound.html', dataUrl: `data:audio/wav;base64,${audioBytes.toString('base64')}` } } },
    }
    const audioRecords = await captureRefModRecords({
      workflowJson: template.workflow_json, markedFields: template.marked_fields!,
      promptData: { director: audioDirector }, serverId, workflowId: templateId,
    })
    const audioResponse = await fetch(`http://127.0.0.1:${proxyAddress.port}/api/refmods/${audioRecords[0].id}/media/0`, { headers: { Range: 'bytes=0-15' } })
    assert.equal(audioResponse.status, 206)
    assert.equal(audioResponse.headers.get('content-type'), 'audio/wav')
    assert.deepEqual(Buffer.from(await audioResponse.arrayBuffer()), audioBytes.subarray(0, 16))
    await recoverInterruptedRefModRecords()
    const interrupted = listRefModRecords(serverId).find((record) => record.id === linkedRecords[0].id)!
    assert.equal(interrupted.status, 'failed')
    assert.match(interrupted.error!, /interrupted/)
    assert.equal(fs.existsSync(linkedPath), false)
    assert.equal(listRefModRecords(serverId).find((record) => record.id === saved.id)!.status, 'saved')
    const privateFailure = await capture()
    await failRefModRecords(privateFailure, new Error(`EACCES: copyfile '${path.join(root, 'secret-file.png')}'`))
    const recordResponse = await fetch(`http://127.0.0.1:${proxyAddress.port}/api/refmods?serverId=${serverId}`)
    const recordText = await recordResponse.text()
    assert.equal(recordResponse.status, 200)
    assert.ok(!recordText.includes('secret-file.png') && !recordText.includes(root), 'instance-shared errors never expose filesystem details')
    const deleted = await fetch(`http://127.0.0.1:${proxyAddress.port}/api/refmods/${saved.id}`, { method: 'DELETE' })
    assert.equal(deleted.status, 200)
    assert.match(((await deleted.json()) as { message: string }).message, /ComfyUI server.*not deleted/)
    assert.equal(fs.existsSync(retainedPath), false)
    assert.equal(fs.existsSync(libraryPath), true)

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
