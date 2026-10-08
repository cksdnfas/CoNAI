import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { ChatExecutionContext } from '@conai/shared'
import type { McpRequestContext } from '../src/mcp/context'

/**
 * Guard: every MCP tool the code registers is classified in BOTH maps, and neither map keeps entries for tools that no
 * longer exist.
 *
 * - TOOL_SCOPES (src/mcp/context.ts): a tool without a scope is silently filtered out of every non-room context.
 * - TOOL_FEATURE_PERMISSIONS (src/mcp/toolAccess.ts): a tool without an entry is silently HIDDEN from every
 *   account-bound caller (chat bots, bound HTTP keys) and rejected at call time as "Unclassified account-bound tool".
 *   An empty array counts as classified ("no feature key needed"): toolAccess only checks `=== undefined`.
 *
 * Because createMcpServer drops filtered tools before they reach the SDK, tools/list alone would never show an
 * unclassified tool. The test therefore records every name handed to `server.tool(...)` BEFORE the server.ts filter
 * runs (see recordAttempts) and uses tools/list only for the per-context counts.
 */

/** Names matching isChatGenerationTool (generate_image, generate_image_2, ...) are per-profile and classified by pattern. */
const PATTERN_CLASSIFIED = 'generate_image(_N): isChatGenerationTool -> scope "generate", permission "generation.execute"'

/**
 * Known exceptions, each with the reason. Keep these empty unless a tool is intentionally unclassified/dynamic.
 * - UNSCOPED_ALLOWED: registered tools that may lack a TOOL_SCOPES entry (CHAT_ROOM_TOOLS bypass scopes by design).
 * - FEATURE_UNCLASSIFIED_ALLOWED: account-bound tools that may lack a TOOL_FEATURE_PERMISSIONS entry.
 * - STALE_SCOPE_ALLOWED / STALE_FEATURE_ALLOWED: map keys allowed without a registration in the contexts built below.
 */
const CHAT_ROOM_TOOL_NAMES = ['chat_reply_to', 'room_call_member', 'room_history_search', 'room_history_read', 'read_lore_file', 'save_lore']
const UNSCOPED_ALLOWED = new Set<string>([
  // Chat room/lore tools are offered by CHAT_ROOM_TOOLS regardless of scopes (isContextToolAllowed returns before scopes).
  ...CHAT_ROOM_TOOL_NAMES,
])
const FEATURE_UNCLASSIFIED_ALLOWED = new Set<string>([])
const STALE_SCOPE_ALLOWED = new Set<string>([])
const STALE_FEATURE_ALLOWED = new Set<string>([])

test('mcp tool classification: every registered tool has a scope and a feature permission, no stale entries', { timeout: 60000 }, async (t) => {
  // Isolate all runtime paths before importing modules that open databases or settings.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-mcp-classification-'))
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

  const { createMcpServer } = await import('../src/mcp/server')
  // Take the prototype from a real instance: the test's own import of the SDK can resolve to a different build
  // (ESM vs CJS) than the one server.ts loads, and only server.ts's class matters.
  const probe = createMcpServer({ scopes: [] })
  const proto = Object.getPrototypeOf(probe) as Record<string, unknown>
  await probe.close()
  const originalToolDescriptor = Object.getOwnPropertyDescriptor(proto, 'tool')!
  assert.equal(typeof originalToolDescriptor?.value, 'function', 'McpServer.prototype.tool must be a plain method for the recorder')

  t.after(async () => {
    Object.defineProperty(proto, 'tool', originalToolDescriptor)
    authModule.getAuthDb().close()
    user.closeUserSettingsDb()
    main.closeDatabase()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('conai-mcp-classification-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  const { ALL_MCP_HTTP_SCOPES, CHAT_ROOM_TOOLS, CHAT_PAGE_TOOLS, getMcpToolScope, isChatGenerationTool } = await import('../src/mcp/context')
  const { TOOL_FEATURE_PERMISSIONS } = await import('../src/mcp/toolAccess')
  const { CHAT_SCOPES } = await import('../src/services/codex-chat/chatSettings')
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { normalizeChatPageSnapshot, normalizeChatWorkflowSnapshot } = await import('@conai/shared')
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')

  // Keep the allowlist honest: it must mirror the real room-tool set.
  assert.deepEqual([...CHAT_ROOM_TOOLS].sort(), [...CHAT_ROOM_TOOL_NAMES].sort(), 'CHAT_ROOM_TOOLS changed; update CHAT_ROOM_TOOL_NAMES in this test')

  /**
   * server.ts does `originalTool = server.tool.bind(server)` and then assigns its filtering wrapper to `server.tool`.
   * An accessor on the prototype hands out the real method for the bind, and wraps the assigned filter so every name
   * is recorded before the filter can drop it.
   */
  let attempts: Set<string> | null = null
  const wrappedKey = Symbol('classification-recorder')
  Object.defineProperty(proto, 'tool', {
    configurable: true,
    get(this: Record<symbol, unknown>) { return this[wrappedKey] ?? originalToolDescriptor.value },
    set(this: Record<symbol, unknown>, filter: (...args: unknown[]) => unknown) {
      this[wrappedKey] = (...args: unknown[]) => {
        if (typeof args[0] === 'string') attempts?.add(args[0])
        return filter(...args)
      }
    },
  })

  /** Builds the real server for a context: names it tried to register (pre-filter) and names tools/list returns. */
  const collect = async (context: McpRequestContext) => {
    attempts = new Set()
    const server = createMcpServer(context)
    const attempted = attempts
    attempts = null
    const client = new Client({ name: 'tool-classification', version: '1' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    try {
      const listed = new Set((await client.listTools()).tools.map((tool) => tool.name))
      for (const name of listed) assert.ok(attempted.has(name), `recorder missed listed tool ${name}`)
      return { attempted, listed }
    } finally {
      await client.close()
      await server.close()
    }
  }

  // Fixtures for chat contexts: a profile that allows lore proposals, a thread, and two kinds of connected pages.
  ExternalApiProvider.create({ provider_name: 'conn', display_name: 'Conn', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
  const profile = ChatProfileStore.create({ name: 'Classifier', engine: 'llm', providerName: 'conn', mcpEnabled: true, mcpScopes: [...CHAT_SCOPES], allowLoreProposals: true })
  const threadId = CodexChatStore.createThread(null, 'classification chat', 'llm', profile.id)
  const basePage = { instanceId: 'page-classification', connectionId: 'connection-classification', title: 'Classification', fields: [] }
  const workflowPage = normalizeChatPageSnapshot({ ...basePage, path: '/generation', kind: 'workflow', resourceId: 'workflow:draft:classification',
    workflow: normalizeChatWorkflowSnapshot({ revision: 'classification-revision', name: 'Draft', description: '', nodes: [], edges: [] }) })
  const actionSchema = { type: 'object' as const, properties: { name: { type: 'string' as const, maxLength: 100 }, items: { type: 'array' as const, minItems: 1, maxItems: 8, items: { type: 'object' as const, properties: { description: { type: 'string' as const }, value: { type: 'string' as const } }, required: ['description', 'value'] } } }, required: ['name', 'items'] }
  const actionPage = normalizeChatPageSnapshot({ ...basePage, path: '/prompts', kind: 'presets', resourceId: 'new-preset', revision: 'classification-action-revision',
    actions: [{ id: 'preset.create', label: 'Create preset', description: 'Save reviewed preset', effect: 'save' as const, schema: actionSchema }], data: { selected: null } })
  const fieldsPage = normalizeChatPageSnapshot({ ...basePage, path: '/generation', kind: 'comfyui', resourceId: '1',
    fields: [{ id: 'prompt', label: 'Prompt', type: 'text', value: 'old' }] })

  const admin = { accountId: null, accountType: 'admin' as const }
  const chat = (kind: 'direct' | 'group', page?: ChatExecutionContext['page']): McpRequestContext => ({
    scopes: [...CHAT_SCOPES] as McpRequestContext['scopes'],
    source: 'codex-chat',
    requester: { ...admin },
    chatContext: { threadId, profileId: profile.id, kind, replyId: `classification-${kind}`, ...(page ? { page } : {}) },
  })
  const contexts: Array<{ name: string; accountBound: boolean; context: McpRequestContext }> = [
    { name: 'http unbound key (all HTTP scopes)', accountBound: false, context: { scopes: [...ALL_MCP_HTTP_SCOPES], source: 'http' } },
    { name: 'http bound key, admin (all HTTP scopes)', accountBound: true, context: { scopes: [...ALL_MCP_HTTP_SCOPES], source: 'http', requester: { ...admin } } },
    { name: 'codex chat, admin, group room (all chat scopes)', accountBound: true, context: chat('group') },
    { name: 'codex chat, admin, direct + workflow page', accountBound: true, context: chat('direct', workflowPage) },
    { name: 'codex chat, admin, direct + action page', accountBound: true, context: chat('direct', actionPage) },
    { name: 'codex chat, admin, direct + editable-fields page', accountBound: true, context: chat('direct', fieldsPage) },
  ]

  const attemptedAll = new Set<string>()
  const attemptedAccountBound = new Set<string>()
  const counts: string[] = []
  for (const { name, accountBound, context } of contexts) {
    const { attempted, listed } = await collect(context)
    assert.ok(attempted.size > 0, `${name}: nothing was recorded; the server.tool recorder is not wired`)
    for (const tool of attempted) {
      attemptedAll.add(tool)
      if (accountBound) attemptedAccountBound.add(tool)
    }
    const hidden = [...attempted].filter((tool) => !listed.has(tool)).sort()
    // A connected page narrows the list to its own tools, so only short filtered lists are worth printing.
    const detail = hidden.length === 0 ? '' : hidden.length <= 15 ? ` (filtered: ${hidden.join(', ')})` : ` (${hidden.length} filtered)`
    counts.push(`${name}: attempted ${attempted.size}, listed ${listed.size}${detail}`)
  }
  t.diagnostic(`tool counts per context:\n  ${counts.join('\n  ')}\n  union: ${attemptedAll.size}`)
  t.diagnostic(`pattern-classified (not in the maps): ${PATTERN_CLASSIFIED}`)

  // The contexts above must reach every conditionally registered family, or the checks below prove nothing about them.
  for (const tool of [...CHAT_ROOM_TOOLS, ...CHAT_PAGE_TOOLS, 'read_page_data', 'propose_page_action', 'list_files', 'get_chat_setup_guide']) {
    assert.ok(attemptedAll.has(tool), `fixture gap: ${tool} was never registered by the test contexts; extend the contexts`)
  }

  // TOOL_SCOPES is module-private; read its keys from the source and prove the parse against getMcpToolScope.
  const contextSource = fs.readFileSync(path.join(__dirname, '../src/mcp/context.ts'), 'utf8')
  const block = contextSource.match(/const TOOL_SCOPES[^=]*=\s*\{([\s\S]*?)\n\};/)
  assert.ok(block, 'could not locate TOOL_SCOPES in src/mcp/context.ts; update the parser in this test')
  const scopeKeys = [...block[1].matchAll(/^\s*([a-z0-9_]+)\s*:\s*'([a-z]+)'/gm)].map(([, key, scope]) => {
    assert.equal(getMcpToolScope(key), scope, `TOOL_SCOPES parse mismatch for ${key}`)
    return key
  })
  assert.ok(scopeKeys.length > 0)
  const scopeKeySet = new Set(scopeKeys)
  const classifiable = (tool: string) => !isChatGenerationTool(tool)
  for (const tool of attemptedAll) {
    if (classifiable(tool) && getMcpToolScope(tool) !== null) assert.ok(scopeKeySet.has(tool), `TOOL_SCOPES parser missed ${tool}; update the parser in this test`)
  }

  await t.test('every registered tool has a TOOL_SCOPES entry', () => {
    const missing = [...attemptedAll].filter((tool) => classifiable(tool) && getMcpToolScope(tool) === null && !UNSCOPED_ALLOWED.has(tool)).sort()
    assert.deepEqual(missing, [], `Registered MCP tools without a scope; add them to TOOL_SCOPES in src/mcp/context.ts: ${missing.join(', ')}`)
  })

  await t.test('every account-bound tool has a TOOL_FEATURE_PERMISSIONS entry', () => {
    const missing = [...attemptedAccountBound].filter((tool) => classifiable(tool) && TOOL_FEATURE_PERMISSIONS[tool] === undefined && !FEATURE_UNCLASSIFIED_ALLOWED.has(tool)).sort()
    assert.deepEqual(missing, [], `Account-bound MCP tools without a feature permission (they are silently hidden from chat bots and bound keys); add them to TOOL_FEATURE_PERMISSIONS in src/mcp/toolAccess.ts ([] = no feature key): ${missing.join(', ')}`)
  })

  await t.test('no stale TOOL_SCOPES or TOOL_FEATURE_PERMISSIONS entries', () => {
    const staleScopes = scopeKeys.filter((tool) => !attemptedAll.has(tool) && !STALE_SCOPE_ALLOWED.has(tool)).sort()
    assert.deepEqual(staleScopes, [], `TOOL_SCOPES entries for tools that are never registered; remove them from src/mcp/context.ts: ${staleScopes.join(', ')}`)
    const staleFeatures = Object.keys(TOOL_FEATURE_PERMISSIONS).filter((tool) => !attemptedAll.has(tool) && !STALE_FEATURE_ALLOWED.has(tool)).sort()
    assert.deepEqual(staleFeatures, [], `TOOL_FEATURE_PERMISSIONS entries for tools that are never registered; remove them from src/mcp/toolAccess.ts: ${staleFeatures.join(', ')}`)
  })

  await t.test('allowlisted exceptions are still needed', () => {
    const unneeded = [
      ...[...FEATURE_UNCLASSIFIED_ALLOWED].filter((tool) => TOOL_FEATURE_PERMISSIONS[tool] !== undefined),
      ...[...STALE_SCOPE_ALLOWED].filter((tool) => attemptedAll.has(tool)),
      ...[...STALE_FEATURE_ALLOWED].filter((tool) => attemptedAll.has(tool)),
    ]
    assert.deepEqual(unneeded, [], `Remove these resolved exceptions from the allowlists in this test: ${unneeded.join(', ')}`)
  })
})
