import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

/**
 * A chat connected to the sprite tab keeps the sprite engine tools: the connected-page rule hides every non-page tool,
 * so /sprite adds its own tools to the page tools. Any other connected page still hides them.
 */
test('sprite page connection: sprite tools stay listed on /sprite, hidden on other pages', { timeout: 60000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-sprite-chat-page-'))
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
    assert.ok(path.basename(root).startsWith('conai-sprite-chat-page-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  const { createMcpServer } = await import('../src/mcp/server')
  const { catalogToolNames } = await import('../src/mcp/toolCatalog')
  const { CHAT_PAGE_KIND_TOOLS } = await import('../src/mcp/context')
  const { CHAT_SCOPES } = await import('../src/services/codex-chat/chatSettings')
  const { chatPageReference } = await import('../src/services/codex-chat/chatPageContext')
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { chatPagePermission, normalizeChatPageSnapshot } = await import('@conai/shared')
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')

  ExternalApiProvider.create({ provider_name: 'conn', display_name: 'Conn', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
  const profile = ChatProfileStore.create({ name: 'Sprite page', engine: 'llm', providerName: 'conn', mcpEnabled: true, mcpScopes: [...CHAT_SCOPES] })
  const threadId = CodexChatStore.createThread(null, 'sprite page chat', 'llm', profile.id)
  const base = { instanceId: 'page-sprite', connectionId: 'connection-sprite', fields: [] }
  const spritePage = normalizeChatPageSnapshot({ ...base, path: '/sprite', title: 'Sprite', kind: 'sprite', resourceId: null,
    fields: [{ id: 'startTime', label: 'Start', type: 'number', value: 0 }], data: { videoHash: 'a'.repeat(48) } })
  const promptsPage = normalizeChatPageSnapshot({ ...base, path: '/prompts', title: 'Presets', kind: 'presets', resourceId: 'presets' })
  assert.equal(chatPagePermission('/sprite'), 'page.sprite.view')
  assert.throws(() => normalizeChatPageSnapshot({ ...base, path: '/prompts', title: 'Wrong', kind: 'sprite', resourceId: null }), /맞지 않아/)

  const list = async (page?: typeof spritePage) => {
    const server = createMcpServer({
      scopes: [...CHAT_SCOPES] as never,
      source: 'llm-chat',
      requester: { accountId: null, accountType: 'admin' },
      chatContext: { threadId, profileId: profile.id, kind: 'direct', replyId: 'sprite-page-reply', page },
    })
    const client = new Client({ name: 'sprite-page', version: '1' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    try {
      return new Set([...(await client.listTools()).tools.map((tool) => tool.name), ...catalogToolNames(server)])
    } finally {
      await client.close()
      await server.close()
    }
  }

  const onSprite = await list(spritePage)
  for (const tool of CHAT_PAGE_KIND_TOOLS.sprite!) assert.ok(onSprite.has(tool), `${tool} is offered on the connected sprite page`)
  assert.ok(onSprite.has('get_current_page'), 'the ordinary page tools stay')
  assert.ok(!onSprite.has('move_files') && !onSprite.has('generate_comfyui'), 'unrelated tools that change things stay hidden')
  assert.ok(onSprite.has('list_workflows') && onSprite.has('get_chat_setup_guide'), 'reads and setup proposals stay offered')
  assert.ok(!onSprite.has('wait_sprite_job'), 'blocking waits stay out of chat')

  const onPrompts = await list(promptsPage)
  assert.ok(!onPrompts.has('extract_sprite_sheet'), 'another connected page hides the sprite tools')
  assert.ok(onPrompts.has('get_current_page'))
  assert.ok((await list()).has('extract_sprite_sheet'), 'without a page the sprite tools are offered (through the catalog)')

  assert.match(chatPageReference(spritePage), /extract_sprite_sheet/)
  assert.doesNotMatch(chatPageReference(promptsPage), /extract_sprite_sheet/)
})
