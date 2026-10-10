import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

/**
 * A chat sees the app tools as a table of contents: open_tools reads a category's schemas, run_tool calls one with the
 * same permission checks and validation as a direct call, and the LLM bridge routes a catalogued name called directly.
 */
test('chat tool catalog: contents, open, run, validation and routing', { timeout: 60000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-chat-tool-catalog-'))
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
    ;(await import('../src/database/audioDb')).closeAudioDb()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
    assert.ok(path.basename(root).startsWith('conai-chat-tool-catalog-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  const { createMcpServer } = await import('../src/mcp/server')
  const { CATALOG_OPEN_TOOL, CATALOG_RUN_TOOL, catalogToolNames, unwrapCatalogCall } = await import('../src/mcp/toolCatalog')
  const { CHAT_SCOPES, updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
  updateChatSettings({ enabled: true })
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { registerChatReply } = await import('../src/services/codex-chat/chatReplyRegistry')
  const { openChatMcpBridge } = await import('../src/services/codex-chat/chatMcpBridge')
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')

  ExternalApiProvider.create({ provider_name: 'conn', display_name: 'Conn', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
  const profile = ChatProfileStore.create({ name: 'Catalog', engine: 'llm', providerName: 'conn', mcpEnabled: true, mcpScopes: [...CHAT_SCOPES] })
  const threadId = CodexChatStore.createThread(null, 'catalog chat', 'llm', profile.id)
  const admin = { accountId: null, accountType: 'admin' as const }
  const chatContext = { threadId, profileId: profile.id, kind: 'direct' as const, replyId: 'catalog-reply' }
  const controller = new AbortController()
  const unregister = registerChatReply(chatContext, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
  t.after(() => unregister())

  const text = (result: unknown) => ((result as { content?: Array<{ text?: string }> }).content ?? []).map((part) => part.text ?? '').join('\n')

  // HTTP clients keep the flat list; a chat gets the contents.
  const http = createMcpServer({ scopes: [...CHAT_SCOPES] as never, source: 'http' })
  assert.deepEqual(catalogToolNames(http), [])
  await http.close()

  const server = createMcpServer({ scopes: [...CHAT_SCOPES] as never, source: 'llm-chat', requester: admin, chatContext })
  const client = new Client({ name: 'catalog', version: '1' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  try {
    const listed = (await client.listTools()).tools
    const names = listed.map((tool) => tool.name)
    assert.ok(names.includes(CATALOG_OPEN_TOOL) && names.includes(CATALOG_RUN_TOOL))
    assert.ok(names.includes('offer_choices'), 'the chat own tools stay direct')
    assert.ok(!names.includes('create_audio_folder') && !names.includes('search_images'), 'app tools sit behind the catalog')
    const catalogued = catalogToolNames(server)
    assert.ok(catalogued.includes('create_audio_folder') && catalogued.includes('move_audio_candidates') && catalogued.includes('search_images'))
    const contents = listed.find((tool) => tool.name === CATALOG_OPEN_TOOL)!.description ?? ''
    assert.match(contents, /- audio: .*\n\s+.*create_audio_folder/)
    assert.ok(listed.length < catalogued.length, 'the catalog is the smaller list')

    // Open a category: descriptions and input schemas.
    const opened = JSON.parse(text(await client.callTool({ name: CATALOG_OPEN_TOOL, arguments: { category: 'audio' } }))) as { tools: Array<{ name: string; input_schema: { properties?: Record<string, unknown> } }> }
    const folder = opened.tools.find((tool) => tool.name === 'create_audio_folder')
    assert.ok(folder && folder.input_schema.properties?.project_id, 'the schema comes with the tool')
    assert.ok(opened.tools.every((tool) => catalogued.includes(tool.name)))
    const unknownCategory = await client.callTool({ name: CATALOG_OPEN_TOOL, arguments: { category: 'nope' } })
    assert.equal(unknownCategory.isError, true)

    // Run tools: create a project, then a folder in it.
    const project = await client.callTool({ name: CATALOG_RUN_TOOL, arguments: { tool: 'create_audio_project', arguments: { name: 'Loops' } } })
    assert.notEqual(project.isError, true, text(project))
    const projectId = (JSON.parse(text(project)) as { project?: { id: number }; id?: number }).project?.id ?? (JSON.parse(text(project)) as { id: number }).id
    assert.ok(projectId)
    const created = await client.callTool({ name: CATALOG_RUN_TOOL, arguments: { tool: 'create_audio_folder', arguments: { project_id: projectId, name: '루프 마법진' } } })
    assert.notEqual(created.isError, true, text(created))
    const folders = await client.callTool({ name: CATALOG_RUN_TOOL, arguments: { tool: 'list_audio_folders', arguments: { project_id: projectId } } })
    assert.match(text(folders), /루프 마법진/)

    // Bad arguments and unknown tools come back as errors, not crashes.
    const invalid = await client.callTool({ name: CATALOG_RUN_TOOL, arguments: { tool: 'create_audio_folder', arguments: { project_id: 'x' } } })
    assert.equal(invalid.isError, true)
    assert.match(text(invalid), /open_tools/)
    const unknown = await client.callTool({ name: CATALOG_RUN_TOOL, arguments: { tool: 'wait_audio_order', arguments: {} } })
    assert.equal(unknown.isError, true, 'a tool withheld from chat is not in the catalog either')
  } finally {
    await client.close()
    await server.close()
  }

  // The reply's own checks still run inside the catalog: an expired reply is refused.
  const expired = createMcpServer({ scopes: [...CHAT_SCOPES] as never, source: 'llm-chat', requester: admin, chatContext: { ...chatContext, replyId: 'gone' } })
  const expiredClient = new Client({ name: 'catalog-expired', version: '1' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await Promise.all([expired.connect(b), expiredClient.connect(a)])
  try {
    const refused = await expiredClient.callTool({ name: CATALOG_RUN_TOOL, arguments: { tool: 'list_audio_projects', arguments: {} } })
    assert.equal(refused.isError, true)
  } finally {
    await expiredClient.close()
    await expired.close()
  }

  // The LLM bridge routes a catalogued name called directly.
  const bridge = await openChatMcpBridge(admin, [...CHAT_SCOPES], null, { chatContext })
  try {
    assert.ok(bridge.catalogTools.has('list_audio_projects'))
    const projects = await bridge.call('list_audio_projects', {})
    assert.notEqual(projects.isError, true)
    assert.match(text(projects), /Loops/)
  } finally {
    await bridge.close()
  }

  assert.deepEqual(unwrapCatalogCall(CATALOG_RUN_TOOL, { tool: 'order_audio', arguments: { count: 1 } }), { tool: 'order_audio', arguments: { count: 1 } })
  assert.deepEqual(unwrapCatalogCall('offer_choices', { a: 1 }), { tool: 'offer_choices', arguments: { a: 1 } })
})
