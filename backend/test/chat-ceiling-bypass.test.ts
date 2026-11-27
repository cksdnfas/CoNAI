import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

/**
 * A chat can do no more than its account and its profile's tool settings allow together. Each path that used to reach
 * past the profile's tools is checked twice: the chat is not offered it, and calling it directly is refused.
 */
test('chat ceiling: no path reaches past the profile tool settings', { timeout: 60000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-chat-ceiling-'))
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
  t.after(async () => {
    authModule.getAuthDb().close()
    user.closeUserSettingsDb()
    main.closeDatabase()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
    assert.ok(path.basename(root).startsWith('conai-chat-ceiling-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  const { normalizeChatPageSnapshot } = await import('@conai/shared')
  const { isContextToolAllowed, requireMcpToolAccess } = await import('../src/mcp/toolAccess')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  updateChatSettings({ enabled: true })
  ExternalApiProvider.create({ provider_name: 'conn', display_name: 'Conn', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
  const admin = { accountId: null, accountType: 'admin' as const }
  type Context = Parameters<typeof isContextToolAllowed>[0]
  const refused = (context: Context, tool: string) => {
    assert.equal(isContextToolAllowed(context, tool), false, `${tool} is offered`)
    assert.throws(() => requireMcpToolAccess(context, tool, {}), undefined, `${tool} runs when called directly`)
  }

  await t.test('1. a connected page lends no domain tools', () => {
    const profile = ChatProfileStore.create({ name: 'Page only', engine: 'llm', providerName: 'conn', mcpEnabled: false, pageAssist: true })
    const threadId = CodexChatStore.createThread(null, 'page only', 'llm', profile.id)
    const page = normalizeChatPageSnapshot({ instanceId: 'ceiling-library', connectionId: 'ceiling-library', kind: 'library', path: '/', title: 'Library', resourceId: null, fields: [] })
    const context: Context = { source: 'llm-chat', scopes: [], toolAllowlist: [], requester: admin, chatContext: { threadId, profileId: profile.id, kind: 'direct', replyId: 'ceiling-1', page } }
    refused(context, 'search_images')
    assert.equal(isContextToolAllowed(context, 'get_current_page'), true, 'the page tools themselves follow page assist')
    assert.equal(isContextToolAllowed({ ...context, scopes: ['read'], toolAllowlist: null }, 'search_images'), true, 'with read in the profile it is offered')
  })

  await t.test('2. page actions stay inside the profile scopes', async () => {
    const { chatPageView } = await import('../src/mcp/tools/chatPageView')
    const { requireChatPageActionAccess } = await import('../src/services/codex-chat/chatPageContext')
    const page = normalizeChatPageSnapshot({ instanceId: 'ceiling-files', connectionId: 'ceiling-files', revision: 'ceiling-files-1', path: '/files', kind: 'files', title: 'Files', resourceId: 'root', fields: [],
      actions: ['files.name_save', 'files.delete'].map((id) => ({ id, label: id, description: '', effect: 'save', schema: { type: 'object', properties: {} } })) })
    const offered = (scopes: Parameters<typeof chatPageView>[3]) => (chatPageView(admin, page, null, scopes).actions ?? []).map((action) => action.id)
    assert.deepEqual(offered(['read', 'organize']), ['files.name_save'], 'an organize-only profile is not shown the delete')
    assert.throws(() => requireChatPageActionAccess(admin, page, 'files.delete', {}, ['read', 'organize']), /도구 설정에 없는 작업이야: delete/)
    assert.deepEqual(offered(['read', 'organize', 'delete']), ['files.name_save', 'files.delete'])
    assert.doesNotThrow(() => requireChatPageActionAccess(admin, page, 'files.delete', {}, ['read', 'organize', 'delete']))
  })

  await t.test('3. a plugin is driven only when the profile covers all it reaches', async () => {
    const { pluginReachScopes, pluginWithinScopes, requirePluginWithinScopes } = await import('../src/services/plugins/pluginAppPolicy')
    const writer = { id: 'ceiling-writer', appTools: ['delete_files'], capabilities: ['files.read', 'files.write'] } as Parameters<typeof pluginReachScopes>[0]
    assert.deepEqual(pluginReachScopes(writer), ['delete', 'organize', 'read'])
    // list_plugin_pages filters with pluginWithinScopes; run_plugin_action and plugin page actions call requirePluginWithinScopes.
    assert.equal(pluginWithinScopes(writer, ['read', 'organize']), false, 'hidden from a profile without delete')
    assert.throws(() => requirePluginWithinScopes(writer, ['read', 'organize']), /delete/)
    assert.equal(pluginWithinScopes(writer, ['read', 'organize', 'delete']), true)
    assert.equal(pluginWithinScopes(writer, null), true, 'outside chat the account alone decides')
  })

  await t.test('4. engine-native tools: Codex image generation stays off; web tools follow the profile list', async () => {
    const { chatFeatureOverrides } = await import('../src/services/codex-chat/codexChatRuntime')
    const features = chatFeatureOverrides(new Set(['image_generation', 'web_search', 'shell_tool', 'code_mode_host']))
    assert.deepEqual([features.image_generation, features.web_search, features.shell_tool, features.code_mode_host], [false, false, false, true])
    const profile = ChatProfileStore.create({ name: 'No web', engine: 'llm', providerName: 'conn', mcpEnabled: true, mcpScopes: ['read'], toolAllowlist: ['search_images'] })
    const threadId = CodexChatStore.createThread(null, 'no web', 'llm', profile.id)
    const context: Context = { source: 'llm-chat', scopes: ['read'], toolAllowlist: ['search_images'], requester: admin, chatContext: { threadId, profileId: profile.id, kind: 'direct', replyId: 'ceiling-4' } }
    for (const tool of ['web_search', 'web_read']) refused(context, tool)
  })

  await t.test('5. board calls and routines run with the profile grant, never wider', async () => {
    const { resolveChatAccess, resolveChatProfileToolGrant } = await import('../src/services/codex-chat/codexChatAccess')
    // postBotRunner (board calls) and chatOrders (routines) build their MCP context from this grant.
    const profile = ChatProfileStore.create({ name: 'Board bot', engine: 'llm', providerName: 'conn', mcpEnabled: true, mcpScopes: ['read'], toolAllowlist: ['posts_read'] })
    const grant = resolveChatProfileToolGrant(profile, resolveChatAccess(null))
    assert.deepEqual(grant, { scopes: ['read'], toolAllowlist: ['posts_read'] })
    const threadId = CodexChatStore.createThread(null, 'board', 'llm', profile.id)
    const context: Context = { source: 'llm-chat', ...grant, requester: admin, chatContext: { threadId, profileId: profile.id, kind: 'direct', replyId: 'ceiling-5' } }
    for (const tool of ['delete_files', 'create_file_folder', 'search_images']) refused(context, tool)
    assert.deepEqual(resolveChatProfileToolGrant({ ...profile, mcpEnabled: false }, resolveChatAccess(null)).scopes, [], 'tools off means no scopes')
  })
})
