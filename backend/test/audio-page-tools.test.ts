import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { ChatPageSnapshot } from '@conai/shared'
import type { McpRequestContext } from '../src/mcp/context'

/** A chat connected to the 오디오 page keeps the audio workspace tools; any other connected page narrows them away. */
test('audio page: connected /audio offers the audio tools, other pages do not', { timeout: 60000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-audio-page-tools-'))
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
    assert.ok(path.basename(root).startsWith('conai-audio-page-tools-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  const { createMcpServer } = await import('../src/mcp/server')
  const { CHAT_PAGE_KIND_TOOLS, getMcpToolScope } = await import('../src/mcp/context')
  const { TOOL_FEATURE_PERMISSIONS } = await import('../src/mcp/toolAccess')
  const { CHAT_SCOPES } = await import('../src/services/codex-chat/chatSettings')
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { normalizeChatPageSnapshot, chatPagePermission } = await import('@conai/shared')
  const { chatPageReference } = await import('../src/services/codex-chat/chatPageContext')
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')

  assert.equal(chatPagePermission('/audio'), 'page.audio.view')
  // Every page-kind tool is a real, classified tool, and review never is one.
  for (const tool of CHAT_PAGE_KIND_TOOLS.audio ?? []) {
    assert.ok(getMcpToolScope(tool), `${tool} has a scope`)
    assert.notEqual(TOOL_FEATURE_PERMISSIONS[tool], undefined, `${tool} has a feature permission`)
    assert.doesNotMatch(tool, /review/)
  }

  ExternalApiProvider.create({ provider_name: 'conn', display_name: 'Conn', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
  // A profile without any general tool scope: only a connected page can bring tools in.
  const profile = ChatProfileStore.create({ name: 'Sound', engine: 'llm', providerName: 'conn', mcpEnabled: true, mcpScopes: [] })
  const threadId = CodexChatStore.createThread(null, 'audio page chat', 'llm', profile.id)
  const base = { instanceId: 'page-audio', connectionId: 'connection-audio', title: '오디오', fields: [] }
  const audioPage = normalizeChatPageSnapshot({ ...base, path: '/audio', kind: 'audio', resourceId: 'project:p1' })
  const filesPage = normalizeChatPageSnapshot({ ...base, path: '/files', kind: 'files', resourceId: 'self:root' })
  assert.throws(() => normalizeChatPageSnapshot({ ...base, path: '/files', kind: 'audio', resourceId: null }), /맞지 않아/)

  const listTools = async (page: ChatPageSnapshot) => {
    const context: McpRequestContext = {
      scopes: [...CHAT_SCOPES] as McpRequestContext['scopes'],
      source: 'codex-chat',
      requester: { accountId: null, accountType: 'admin' },
      chatContext: { threadId, profileId: profile.id, kind: 'direct', replyId: 'audio-page-reply', page },
    }
    const server = createMcpServer(context)
    const client = new Client({ name: 'audio-page-tools', version: '1' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    try {
      return new Set((await client.listTools()).tools.map((tool) => tool.name))
    } finally {
      await client.close()
      await server.close()
    }
  }

  const onAudio = await listTools(audioPage)
  assert.ok(onAudio.has('order_audio'), 'order_audio is offered on the connected audio page')
  assert.ok(onAudio.has('list_audio_candidates') && onAudio.has('edit_audio_candidate') && onAudio.has('get_current_page'))
  assert.ok(![...onAudio].some((name) => /review|wait_audio_order/.test(name)), 'no review tool, no blocking wait in chat')
  assert.ok(!onAudio.has('search_images') && !onAudio.has('extract_sprite_sheet'), 'other tools stay narrowed away')

  const onFiles = await listTools(filesPage)
  assert.ok(!onFiles.has('order_audio') && !onFiles.has('list_audio_candidates'), 'another page does not bring the audio tools')
  assert.ok(onFiles.has('get_current_page'))

  assert.match(chatPageReference(audioPage), /오디오/)
})
