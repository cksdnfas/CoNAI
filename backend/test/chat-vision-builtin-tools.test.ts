import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { ChatExecutionContext } from '@conai/shared'

test('view_media_frames: every chat whose model sees images has it, whatever its tool settings', { timeout: 60000 }, async (t) => {
  // Load runtime modules only after isolating every data path. Never open the user's databases.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-vision-tools-test-'))
  process.env.RUNTIME_BASE_PATH = root
  for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE']) process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
  const authModule = await import('../src/database/authDb')
  authModule.initializeAuthDb()
  const main = await import('../src/database/init')
  await main.initializeDatabase()
  const user = await import('../src/database/userSettingsDb')
  user.initializeUserSettingsDb()
  t.after(async () => {
    authModule.getAuthDb().close()
    user.closeUserSettingsDb()
    main.closeDatabase()
    const { logger } = await import('../src/utils/logger')
    await new Promise<void>((resolve) => logger.close(resolve))
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('conai-vision-tools-test-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
  const { openChatMcpBridge } = await import('../src/services/codex-chat/chatMcpBridge')
  const { registerChatReply } = await import('../src/services/codex-chat/chatReplyRegistry')
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  updateChatSettings({ enabled: true })
  ExternalApiProvider.create({ provider_name: 'conn', display_name: 'Conn', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })

  const admin = { accountId: null, accountType: 'admin' as const }
  const controller = new AbortController()
  const offered = async (profileId: number, scopes: Array<'read'>, toolAllowlist: string[] | null) => {
    const threadId = CodexChatStore.createThread(null, 'chat', 'llm', profileId)
    const context: ChatExecutionContext = { threadId, profileId, kind: 'direct', replyId: `r-${profileId}-${scopes.length}` }
    const unregister = registerChatReply(context, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
    const bridge = await openChatMcpBridge(admin, scopes, toolAllowlist, { chatContext: context })
    try {
      const names = bridge.tools.map((tool) => tool.function.name)
      const call = names.includes('view_media_frames') ? await bridge.call('view_media_frames', { composite_hash: 'a'.repeat(32) }) : null
      return { names, call }
    } finally {
      await bridge.close()
      unregister()
    }
  }
  const textOf = (result: { content?: unknown[] } | null) => JSON.stringify(result?.content ?? [])

  const seeing = ChatProfileStore.create({ name: 'Seer', engine: 'llm', providerName: 'conn', systemPrompt: 'p', visionEnabled: true, mcpEnabled: false })
  const noTools = await offered(seeing.id, [], null)
  assert.ok(noTools.names.includes('view_media_frames'), 'offered with MCP off')
  assert.ok(!noTools.names.includes('view_images'), 'view_images still follows the profile')
  // Allowed: it reaches the lookup, which finds nothing, instead of a permission refusal.
  assert.match(textOf(noTools.call), /not an available media item/)

  const narrowed = ChatProfileStore.create({ name: 'Narrow', engine: 'llm', providerName: 'conn', systemPrompt: 'p', visionEnabled: true, mcpEnabled: true, mcpScopes: ['read'] })
  const listed = await offered(narrowed.id, ['read'], ['search_images'])
  assert.ok(listed.names.includes('view_media_frames'), 'offered past a tool list that leaves it out')
  assert.match(textOf(listed.call), /not an available media item/)

  const blind = ChatProfileStore.create({ name: 'Blind', engine: 'llm', providerName: 'conn', systemPrompt: 'p', visionEnabled: false, mcpEnabled: true, mcpScopes: ['read'] })
  assert.ok(!(await offered(blind.id, ['read'], null)).names.includes('view_media_frames'), 'never offered to a model that cannot see')
})
