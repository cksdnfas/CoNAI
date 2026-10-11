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
  const { Client } = await import('@modelcontextprotocol/client')
  const { InMemoryTransport } = await import('@modelcontextprotocol/client')

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

  // The admin tool picker lists every tool by name, not the catalog's two entries.
  const picker = await openChatMcpBridge(admin, [...CHAT_SCOPES], null, { toolCatalog: false })
  try {
    const names = picker.tools.map((tool) => tool.function.name)
    assert.ok(names.includes('list_audio_projects'))
    assert.ok(names.includes('submit_generation_job'))
    assert.ok(!names.includes(CATALOG_OPEN_TOOL) && !names.includes(CATALOG_RUN_TOOL))
    assert.equal(picker.catalogTools.size, 0)
  } finally {
    await picker.close()
  }

  assert.deepEqual(unwrapCatalogCall(CATALOG_RUN_TOOL, { tool: 'order_audio', arguments: { count: 1 } }), { tool: 'order_audio', arguments: { count: 1 } })
  assert.deepEqual(unwrapCatalogCall('offer_choices', { a: 1 }), { tool: 'offer_choices', arguments: { a: 1 } })
})

test('the tool catalog pages complete schemas and retains a single oversized definition', async () => {
  const { McpServer } = await import('@modelcontextprotocol/server')
  const { Client, InMemoryTransport } = await import('@modelcontextprotocol/client')
  const { z } = await import('zod')
  const { createToolCatalog } = await import('../src/mcp/toolCatalog')
  const server = new McpServer({ name: 'catalog-test', version: '1' })
  const register = server.registerTool.bind(server) as (...args: unknown[]) => unknown
  const catalog = createToolCatalog(server, (args) => { register(...args) })
  const descriptions = Array.from({ length: 11 }, (_, index) => `${index}:` + 'schema'.repeat(index === 0 ? 3000 : 700))
  descriptions.forEach((description, index) => catalog.add(`tool_${index}`, 'files', [
    `tool_${index}`, { description: 'Read a test document.', inputSchema: z.object({ text: z.string().describe(description) }) },
    async () => ({ content: [{ type: 'text', text: 'ok' }] }),
  ]))
  catalog.install()
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'catalog-test-client', version: '1' })
  try {
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    let args: Record<string, unknown> = { category: 'files' }
    const names: string[] = []
    let pages = 0
    for (;;) {
      const result = await client.callTool({ name: 'open_tools', arguments: args })
      const content = result.content as Array<{ type: string; text: string }>
      const page = JSON.parse(content[0].text)
      pages += 1
      assert.ok(page.tools.length > 0)
      for (const tool of page.tools) {
        names.push(tool.name)
        assert.equal(tool.input_schema.properties.text.description, descriptions[Number(tool.name.slice(5))])
      }
      if (page.next_offset === undefined) break
      assert.equal(page.next_offset, names.length)
      args = page.continue_with
      assert.ok(pages <= descriptions.length, 'paging must make progress')
    }
    assert.ok(pages > 1)
    assert.deepEqual(names, descriptions.map((_, index) => `tool_${index}`))
  } finally {
    await client.close()
    await server.close()
  }
})
