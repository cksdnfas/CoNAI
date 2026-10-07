import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { ChatExecutionContext } from '@conai/shared'
import type { CodexChatMessageRecord } from '../src/services/codex-chat/codexChatStore'

test('chat proposals: configure scope, setup tools, storage, read-time attachment, saved route', { timeout: 60000 }, async (t) => {
  // Load runtime modules only after isolating every data path. Never open the user's databases.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-proposals-test-'))
  process.env.RUNTIME_BASE_PATH = root
  process.env.RUNTIME_DATABASE_DIR = path.join(root, 'database')
  process.env.RUNTIME_SAVE_DIR = path.join(root, 'save')
  const dbModule = await import('../src/database/userSettingsDb')
  dbModule.initializeUserSettingsDb()
  const authModule = await import('../src/database/authDb')
  authModule.initializeAuthDb()
  t.after(async () => {
    authModule.getAuthDb().close()
    dbModule.closeUserSettingsDb()
    ;(await import('../src/database/init')).closeDatabase()
    const { logger } = await import('../src/utils/logger')
    await new Promise<void>((resolve) => logger.close(resolve))
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('conai-proposals-test-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const { ChatProposalStore } = await import('../src/services/codex-chat/chatProposals')
  const { attachProposals } = await import('../src/services/codex-chat/codexChatMedia')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { ChatSharedBlockStore } = await import('../src/services/codex-chat/chatDisplayBlocks')
  const { ModelSlotStore } = await import('../src/services/codex-chat/modelSlots')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { CHAT_SCOPES, updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
  updateChatSettings({ enabled: true })
  const { intersectChatScopes } = await import('../src/services/codex-chat/codexChatAccess')
  const { MCP_HTTP_SCOPES } = await import('../src/services/mcpHttpSettingsService')
  const { ALL_MCP_HTTP_SCOPES, getMcpToolScope } = await import('../src/mcp/context')
  const { openChatMcpBridge } = await import('../src/services/codex-chat/chatMcpBridge')
  const { registerChatReply } = await import('../src/services/codex-chat/chatReplyRegistry')
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')

  ExternalApiProvider.create({ provider_name: 'conn', display_name: 'Conn', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
  const slot = ModelSlotStore.create({ name: 'Fast Model', providerName: 'conn', model: 'm1' }).slot
  const profile = ChatProfileStore.create({ name: 'Mina', engine: 'llm', providerName: 'conn', systemPrompt: 'old prompt', tagline: 'old tagline', mcpScopes: ['read'] })
  const threadId = CodexChatStore.createThread(null, 'proposal chat', 'llm', profile.id)
  const controller = new AbortController()
  const replyContext = (replyId: string): ChatExecutionContext => ({ threadId, profileId: profile.id, kind: 'direct', replyId })
  const BLOCK = { key: 'Status', instruction: 'Update on scene change', example: '{"hp": 100}', template: '<b>{{hp}}</b>', fields: [{ name: 'hp', min: 0, max: 100, step: 10 }] }

  const { normalizeChatPageSnapshot, buildChatPageChanges, chatPagePatch } = await import('@conai/shared')
  const page = normalizeChatPageSnapshot({ instanceId: 'page-test-123', connectionId: 'connection-test-123', path: '/generation', title: 'Test workflow', kind: 'comfyui', resourceId: '1', fields: [
    { id: 'prompt', label: 'Prompt', type: 'text', value: ['old', 'second'] },
    { id: 'steps', label: 'Steps', type: 'number', value: '20', min: 1, max: 50, integer: true },
    { id: 'sampler', label: 'Sampler', type: 'select', value: 'euler', options: ['euler', 'euler_ancestral'] },
  ], apiKey: 'must-not-be-retained' })
  const pageProfile = ChatProfileStore.create({ name: 'Page assistant', engine: 'llm', providerName: 'conn', mcpEnabled: true, mcpScopes: ['read'], toolAllowlist: ['get_current_page', 'propose_page_changes'] })
  const pageThreadId = CodexChatStore.createThread(null, 'page chat', 'llm', pageProfile.id)

  await t.test('page inputs: atomic validation, stale targets, edited values, and safe undo', () => {
    assert.ok(!('apiKey' in page))
    const changes = buildChatPageChanges(page, [{ fieldId: 'prompt', value: 'new' }, { fieldId: 'steps', value: 30 }])
    const { fields: _fields, ...target } = page
    const proposal = { kind: 'page_fields' as const, page: target, changes, expiresAt: Date.now() + 60_000 }
    assert.deepEqual(chatPagePatch(page, proposal), { prompt: 'new', steps: '30' })
    assert.throws(() => buildChatPageChanges(page, [{ fieldId: 'prompt', value: 'new' }, { fieldId: 'steps', value: 51 }]), /범위/)
    assert.throws(() => buildChatPageChanges(page, [{ fieldId: 'sampler', value: 'unknown' }]), /선택 목록/)
    assert.throws(() => buildChatPageChanges(page, [{ fieldId: 'apiKey', value: 'secret' }]), /등록되지/)
    assert.throws(() => chatPagePatch({ ...page, instanceId: 'another-page' }, proposal), /페이지/)
    assert.throws(() => chatPagePatch({ ...page, connectionId: 'new-connection' }, proposal), /페이지/)
    assert.throws(() => chatPagePatch({ ...page, fields: page.fields.map((field) => field.id === 'steps' ? { ...field, value: '21' } : field) }, proposal), /입력값/)
    const applied = { ...page, fields: page.fields.map((field) => ({ ...field, value: changes.find((change) => change.fieldId === field.id)?.value ?? field.value })) }
    assert.deepEqual(chatPagePatch(applied, proposal, true), { prompt: ['old', 'second'], steps: '20' })
    assert.throws(() => chatPagePatch(page, { ...proposal, expiresAt: 0 }), /유효 시간/)
    assert.throws(() => normalizeChatPageSnapshot({ ...page, path: 'https://example.com' }), /페이지/)
  })

  await t.test('page extensions: registered routes, image identity, and read-only context', () => {
    const library = normalizeChatPageSnapshot({ ...page, path: '/', kind: 'library', resourceId: 'library:wide' })
    assert.equal(library.kind, 'library')
    assert.throws(() => normalizeChatPageSnapshot({ ...library, path: '/settings' }), /대상 페이지/)
    assert.throws(() => normalizeChatPageSnapshot({ ...page, path: '/prompts' }), /대상 페이지/)
    const prompts = normalizeChatPageSnapshot({ ...page, path: '/prompts', kind: 'prompt_search', resourceId: 'positive:all', fields: [
      { id: 'searchInput', label: 'Search draft', type: 'text', value: '' },
      { id: 'appliedSearch', label: 'Applied search', type: 'text', value: 'cat', editable: false },
    ] })
    assert.throws(() => buildChatPageChanges(prompts, [{ fieldId: 'appliedSearch', value: 'dog' }]), /읽기 전용/)
    const { fields: _fields, ...target } = prompts
    const forged = { kind: 'page_fields' as const, page: target, changes: [{ fieldId: 'appliedSearch', label: 'Applied search', before: 'cat', value: 'dog' }], expiresAt: Date.now() + 60_000 }
    assert.throws(() => chatPagePatch(prompts, forged), /읽기 전용/)
    const proposal = { ...forged, changes: buildChatPageChanges(prompts, [{ fieldId: 'searchInput', value: 'dog' }]) }
    assert.deepEqual(chatPagePatch(prompts, proposal), { searchInput: 'dog' })
    assert.throws(() => chatPagePatch({ ...prompts, resourceId: 'positive:3' }, proposal), /페이지/)
    const metadata = normalizeChatPageSnapshot({ ...page, path: '/images/image-a/metadata', kind: 'metadata', resourceId: 'image-a' })
    assert.equal(metadata.kind, 'metadata')
    assert.throws(() => normalizeChatPageSnapshot({ ...metadata, resourceId: 'image-b' }), /대상 페이지/)
    assert.throws(() => normalizeChatPageSnapshot({ ...metadata, path: '/images/image-a' }), /대상 페이지/)
  })

  await t.test('read-only page context never offers a modification tool', async () => {
    const context: ChatExecutionContext = { threadId: pageThreadId, profileId: pageProfile.id, kind: 'direct', replyId: 'page-read-only', page: { ...page, fields: page.fields.map((field) => ({ ...field, editable: false })) } }
    const unregister = registerChatReply(context, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
    const bridge = await openChatMcpBridge({ accountId: null, accountType: 'admin' }, ['read'], ['get_current_page', 'propose_page_changes'], { chatContext: context })
    try {
      assert.deepEqual(bridge.tools.map((tool) => tool.function.name), ['get_current_page'])
      const read = await bridge.call('get_current_page', {})
      assert.ok(!read.isError)
      assert.match(JSON.stringify(read.content), /editable/)
      assert.ok((await bridge.call('propose_page_changes', { changes: [{ fieldId: 'steps', value: 30 }] })).isError)
    } finally { unregister(); await bridge.close() }
  })

  await t.test('page tools: explicit binding, proposed fields only, and reply expiry', async () => {
    const context: ChatExecutionContext = { threadId: pageThreadId, profileId: pageProfile.id, kind: 'direct', replyId: 'page-tools', page }
    const unregister = registerChatReply(context, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
    const bridge = await openChatMcpBridge({ accountId: null, accountType: 'admin' }, ['read'], ['get_current_page', 'propose_page_changes'], { chatContext: context })
    const unbound = await openChatMcpBridge({ accountId: null, accountType: 'admin' }, ['read'])
    const broad = await openChatMcpBridge({ accountId: null, accountType: 'admin' }, ['read', 'generate', 'organize', 'configure'], null, { chatContext: context })
    try {
      assert.ok(!unbound.tools.some((tool) => tool.function.name === 'get_current_page'))
      assert.ok(!broad.tools.some((tool) => ['submit_generation_job', 'generate_nai', 'delete_files', 'propose_profile_update'].includes(tool.function.name)), 'page mode withholds side-effect tools even for broad profiles')
      assert.ok(broad.tools.every((tool) => ['get_current_page', 'propose_page_changes'].includes(tool.function.name)), 'page text cannot request unrelated private files or library data')
      assert.ok(!(await bridge.call('get_current_page', {})).isError)
      const created = await bridge.call('propose_page_changes', { changes: [{ fieldId: 'steps', value: 30 }] })
      assert.ok(!created.isError)
      assert.match(JSON.stringify(created.structuredContent), /page_fields/)
      const resultText = (created.content?.[0] as { text: string }).text
      assert.deepEqual(JSON.parse(resultText).changes, [{ fieldId: 'steps', label: 'Steps', before: '20', value: '30' }], 'the model receives the validated diff instead of guessing current values from old replies')
      assert.ok((await bridge.call('propose_page_changes', { changes: [{ fieldId: 'steps', value: 51 }] })).isError)
      unregister()
      assert.ok((await bridge.call('get_current_page', {})).isError)
    } finally { unregister(); await bridge.close(); await unbound.close(); await broad.close() }
  })

  await t.test('API LLM tools reject account permission revocation during a reply', async (sub) => {
    const { AuthAccount } = await import('../src/models/AuthAccount')
    const { AuthAccessControlService } = await import('../src/services/authAccessControlService')
    let permissions = ['chat.llm.use', 'chat.tools.read', 'page.generation.view']
    sub.mock.method(AuthAccount, 'findById', () => ({ status: 'active' }))
    sub.mock.method(AuthAccessControlService, 'resolveForAccountId', () => ({ permissionKeys: permissions }))
    const context: ChatExecutionContext = { threadId: pageThreadId, profileId: pageProfile.id, kind: 'direct', replyId: 'page-revoke', page }
    const unregister = registerChatReply(context, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
    const bridge = await openChatMcpBridge({ accountId: 7, accountType: 'guest' }, ['read'], ['get_current_page'], { chatContext: context })
    try {
      assert.ok(!(await bridge.call('get_current_page', {})).isError)
      permissions = ['chat.llm.use']
      assert.ok((await bridge.call('get_current_page', {})).isError)
    } finally { unregister(); await bridge.close() }
  })

  await t.test('generation retry keys cannot reuse another chat account job', async (sub) => {
    const { enqueueMcpGenerationJob } = await import('../src/mcp/tools/generationJobTools')
    const { GenerationQueueService } = await import('../src/services/generationQueueService')
    const { HistoryQueryRepository } = await import('../src/repositories/history/HistoryQueryRepository')
    sub.mock.method(GenerationQueueService, 'requestDispatch', () => {})
    sub.mock.method(HistoryQueryRepository, 'findAllWithMetadata', () => [])
    const input = { service_type: 'novelai' as const, request_payload: { prompt: 'isolated test', n_samples: 1 }, idempotency_key: 'same-retry-key' }
    const caller = (accountId: number) => ({ requester: { accountId, accountType: 'guest' as const }, source: 'llm-chat' as const, scopes: ['generate' as const] })
    const first = await enqueueMcpGenerationJob(caller(7), input)
    const second = await enqueueMcpGenerationJob(caller(8), input)
    const retry = await enqueueMcpGenerationJob(caller(7), input)
    assert.notEqual(first?.id, second?.id)
    assert.equal(retry?.id, first?.id)
    assert.equal(retry?.idempotency_reused, true)
  })

  await t.test('configure scope: permission, HTTP exclusion, tool gating', async () => {
    assert.ok((CHAT_SCOPES as readonly string[]).includes('configure'))
    const access = (scopes: Array<typeof CHAT_SCOPES[number]>) => ({ codex: true, llm: true, scopes })
    assert.deepEqual(intersectChatScopes(['read', 'configure'], access(['read'])), ['read'])
    assert.deepEqual(intersectChatScopes(['read', 'configure'], access(['read', 'configure'])), ['read', 'configure'])
    assert.ok(!(MCP_HTTP_SCOPES as readonly string[]).includes('configure'))
    assert.ok(!(ALL_MCP_HTTP_SCOPES as string[]).includes('configure'))
    for (const tool of ['get_chat_setup_guide', 'list_chat_profiles', 'get_chat_profile', 'list_display_blocks', 'get_display_block', 'propose_display_block', 'propose_chat_profile', 'propose_profile_update']) {
      assert.equal(getMcpToolScope(tool), 'configure', tool)
    }
    const without = await openChatMcpBridge({ accountId: null, accountType: 'admin' }, ['read'])
    const withScope = await openChatMcpBridge({ accountId: null, accountType: 'admin' }, ['configure'])
    try {
      assert.ok(!without.tools.some((tool) => tool.function.name.startsWith('propose_')))
      assert.equal(withScope.tools.filter((tool) => tool.function.name.startsWith('propose_')).length, 3)
      assert.equal(withScope.tools.length, 8)
    } finally { await without.close(); await withScope.close() }
  })

  await t.test('the permission catalog reaches the admin group only', () => {
    const db = authModule.getAuthDb()
    const holders = db.prepare(`
      SELECT g.group_key FROM auth_group_permissions gp
      JOIN auth_permissions p ON p.id = gp.permission_id JOIN auth_permission_groups g ON g.id = gp.group_id
      WHERE p.permission_key = 'chat.tools.configure' AND gp.allowed = 1
    `).all() as Array<{ group_key: string }>
    assert.deepEqual(holders.map((row) => row.group_key), ['admin'])
  })

  await t.test('store: add keeps per-reply order, list merges, markSaved', () => {
    const first = ChatProposalStore.add(replyContext('r-store'), { kind: 'display_block', name: 'one', block: { key: 'one' }, linkProfileId: null })
    const second = ChatProposalStore.add(replyContext('r-store'), { kind: 'profile_update', profileId: profile.id, profileName: 'Mina', patch: { tagline: 'x' }, before: { tagline: 'y' } })
    const other = ChatProposalStore.add(replyContext('r-other'), { kind: 'profile', input: { name: 'N' } })
    const listed = ChatProposalStore.listForThread(threadId).filter((row) => row.replyId === 'r-store')
    assert.deepEqual(listed.map((row) => [row.id, row.seq]), [[first.id, 0], [second.id, 1]])
    assert.equal(ChatProposalStore.listForThread(threadId).find((row) => row.id === other.id)?.seq, 0)
    assert.equal(ChatProposalStore.find(first.id)?.kind, 'display_block')
    const saved = ChatProposalStore.markSaved(first.id, 42)
    assert.equal(saved?.kind === 'display_block' && saved.savedId, 42)
    const savedUpdate = ChatProposalStore.markSaved(second.id, null)
    assert.equal(savedUpdate?.kind === 'profile_update' && savedUpdate.saved, true)
    assert.equal(ChatProposalStore.markSaved(999999, 1), null)
    assert.equal(ChatProposalStore.deleteForThread(threadId) >= 3, true)
    assert.equal(ChatProposalStore.listForThread(threadId).length, 0)
  })

  await t.test('attachProposals matches propose_* calls by order and appends the rest as synthetic calls', () => {
    const a = ChatProposalStore.add(replyContext('r-attach'), { kind: 'display_block', name: 'a', block: { key: 'a' }, linkProfileId: null })
    const b = ChatProposalStore.add(replyContext('r-attach'), { kind: 'profile', input: { name: 'B' } })
    const c = ChatProposalStore.add(replyContext('r-attach'), { kind: 'profile_update', profileId: profile.id, profileName: 'Mina', patch: { name: 'C' }, before: { name: 'Mina' } })
    const call = (id: string, tool: string, status: 'completed' | 'failed' = 'completed') => ({ id, tool, status, arguments: null, summary: null, historyIds: [], compositeHashes: [] })
    const message = (id: number, replyId: string | undefined, tool_calls: ReturnType<typeof call>[], role: 'assistant' | 'user' = 'assistant') =>
      ({ id, thread_id: threadId, role, content: '', tool_calls, routing: replyId ? { replyId, replyTo: null, recipients: [] } : null }) as unknown as CodexChatMessageRecord
    const [withCalls, unrelated, user] = attachProposals([
      message(1, 'r-attach', [call('1', 'search_images'), call('2', 'propose_display_block'), call('3', 'propose_chat_profile', 'failed'), call('4', 'propose_chat_profile')]),
      message(2, 'r-none', [call('5', 'propose_display_block')]),
      message(3, 'r-attach', [], 'user'),
    ])
    // The i-th propose_* call gets the i-th proposal (the failed call stored nothing and is skipped).
    assert.equal(withCalls.tool_calls[0].proposal, undefined)
    assert.equal(withCalls.tool_calls[1].proposal?.id, a.id)
    assert.equal(withCalls.tool_calls[2].proposal, undefined)
    assert.equal(withCalls.tool_calls[3].proposal?.id, b.id)
    // The third proposal has no call left: appended as a synthetic completed call.
    assert.equal(withCalls.tool_calls.length, 5)
    assert.deepEqual({ id: withCalls.tool_calls[4].id, tool: withCalls.tool_calls[4].tool, status: withCalls.tool_calls[4].status, proposalId: withCalls.tool_calls[4].proposal?.id }, { id: `proposal-${c.id}`, tool: 'propose_profile_update', status: 'completed', proposalId: c.id })
    assert.equal(unrelated.tool_calls[0].proposal, undefined)
    assert.equal(user.tool_calls.length, 0)
    // A Codex reply that kept no named calls gets every proposal as synthetic calls.
    const [codex] = attachProposals([message(4, 'r-attach', [])])
    assert.deepEqual(codex.tool_calls.map((entry) => entry.tool), ['propose_display_block', 'propose_chat_profile', 'propose_profile_update'])
    assert.equal(attachProposals([message(5, undefined, [call('6', 'propose_display_block')])])[0].tool_calls[0].proposal, undefined)
  })

  await t.test('tools: guides and read views never leak grants', async () => {
    const shared = ChatSharedBlockStore.create({ name: 'Existing card', block: { key: 'status', example: '{}' } })
    ChatProfileStore.update(profile.id, { blockIds: [shared.id] })
    const close = registerChatReply(replyContext('r-read'), controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
    const bridge = await openChatMcpBridge({ accountId: null, accountType: 'admin' }, ['configure'], null, { chatContext: replyContext('r-read') })
    const text = (result: { content?: unknown[] }) => String((result.content?.[0] as { text?: string }).text)
    try {
      const blockGuide = text(await bridge.call('get_chat_setup_guide', { topic: 'display_block' }))
      assert.match(blockGuide, /\{\{#each/)
      assert.match(blockGuide, /data-pick/)
      assert.ok(blockGuide.length < 7000)
      const profileGuide = text(await bridge.call('get_chat_setup_guide', { topic: 'profile' }))
      assert.match(profileGuide, /Fast Model/)
      assert.match(profileGuide, /Existing card/)
      const list = JSON.parse(text(await bridge.call('list_chat_profiles', {})))
      assert.equal(list[0].name, 'Mina')
      assert.deepEqual(Object.keys(list[0]).sort(), ['blockIds', 'engine', 'id', 'isEnabled', 'lorebookIds', 'model', 'modelSlotId', 'name', 'systemPromptLength', 'tagline'])
      const view = JSON.parse(text(await bridge.call('get_chat_profile', {})))
      assert.equal(view.systemPrompt, 'old prompt')
      assert.equal(typeof view.mcpEnabled, 'boolean')
      for (const forbidden of ['mcpScopes', 'toolAllowlist', 'toolPresetId', 'providerName', 'model', 'engine', 'background', 'avatar', 'generationPresetIds']) assert.equal(forbidden in view, false, forbidden)
      const blocks = JSON.parse(text(await bridge.call('list_display_blocks', {})))
      assert.deepEqual(blocks.map((row: { key: string }) => row.key), ['status'])
      assert.deepEqual(blocks[0].profiles, [{ id: profile.id, name: 'Mina' }])
      const one = JSON.parse(text(await bridge.call('get_display_block', { block_id: shared.id })))
      assert.equal(one.name, 'Existing card')
      assert.equal(one.block.key, 'status')
      assert.equal((await bridge.call('get_display_block', { block_id: 9999 })).isError, true)
    } finally { close(); await bridge.close() }
  })

  await t.test('propose tools: normalization, warnings, rejection, and a stale reply', async () => {
    const close = registerChatReply(replyContext('r-propose'), controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
    const bridge = await openChatMcpBridge({ accountId: null, accountType: 'admin' }, ['configure'], null, { chatContext: replyContext('r-propose') })
    const read = (result: { content?: unknown[] }) => String((result.content?.[0] as { text?: string }).text)
    try {
      const bad = await bridge.call('propose_display_block', { block: { key: '9bad', template: 'x' } })
      assert.equal(bad.isError, true)
      assert.equal(read(bad), 'block.key must match /^[a-z][a-z0-9_-]{0,31}$/')

      const ok = await bridge.call('propose_display_block', { name: '  My card ', block: { ...BLOCK, example: '[1]', template: '' } })
      assert.equal(ok.isError, undefined)
      const payload = JSON.parse(read(ok))
      assert.equal(payload.block.key, 'status')
      assert.equal(payload.block.enabled, true)
      assert.equal('id' in payload.block, false)
      assert.equal(payload.note, 'The card is shown to the user; nothing is saved until they press 저장.')
      assert.equal(payload.warnings.length, 3)
      assert.match(payload.warnings.join('\n'), /already used by shared block/)
      assert.match(payload.warnings.join('\n'), /not a valid JSON object/)
      assert.match(payload.warnings.join('\n'), /template is empty/)
      const stored = ChatProposalStore.find(payload.proposalId)
      assert.ok(stored && stored.kind === 'display_block')
      assert.equal(stored.kind === 'display_block' && stored.name, 'My card')
      assert.equal(stored.kind === 'display_block' && stored.linkProfileId, profile.id)
      assert.equal((ok.structuredContent as { proposal: { id: number } }).proposal.id, payload.proposalId)
      const unlinked = JSON.parse(read(await bridge.call('propose_display_block', { block: { ...BLOCK, key: 'fresh' }, link_to_profile: false })))
      assert.deepEqual(unlinked.warnings, [])
      const unlinkedStored = ChatProposalStore.find(unlinked.proposalId)
      assert.equal(unlinkedStored?.kind === 'display_block' && unlinkedStored.name, 'fresh')
      assert.equal(unlinkedStored?.kind === 'display_block' && unlinkedStored.linkProfileId, null)

      const created = JSON.parse(read(await bridge.call('propose_chat_profile', { name: 'Newbie', system_prompt: 'You are {{char}}.', model_slot: 'fast model', prompt_sections: [{ title: 'World', content: 'Rainy city' }], block_ids: [1], typeface: 'serif' })))
      assert.equal(created.input.modelSlotId, slot.id)
      assert.equal(created.input.promptSections[0].title, 'World')
      assert.deepEqual(created.input.style, { typeface: 'serif' })
      assert.deepEqual(created.warnings, [])
      assert.match(read(await bridge.call('propose_chat_profile', { name: 'X', system_prompt: 'y', model_slot: 'nope' })), /Known model slots: Fast Model/)
      assert.match(read(await bridge.call('propose_chat_profile', { name: 'X', system_prompt: 'y', lorebook_ids: [77] })), /no such id 77/)
      assert.equal((await bridge.call('propose_chat_profile', { name: '   ', system_prompt: 'y' })).isError, true)
      assert.equal((await bridge.call('propose_chat_profile', { name: 'X', system_prompt: 'y'.repeat(20_001) })).isError, true)

      const forbidden = await bridge.call('propose_profile_update', { patch: { engine: 'codex', mcpScopes: ['read'], toolAllowlist: [], name: 'Renamed' } })
      assert.equal(forbidden.isError, true)
      assert.match(read(forbidden), /Not proposable: engine, mcpScopes, toolAllowlist/)
      const unchanged = await bridge.call('propose_profile_update', { patch: { name: 'Mina', system_prompt: 'old prompt', tagline: 'old tagline' } })
      assert.equal(unchanged.isError, true)
      assert.match(read(unchanged), /Nothing would change/)
      const update = JSON.parse(read(await bridge.call('propose_profile_update', { patch: { name: 'Mina', tagline: 'new tagline', model_slot: slot.name } })))
      assert.deepEqual(update.changed, ['tagline', 'modelSlotId'])
      const updateStored = ChatProposalStore.find(update.proposalId)
      assert.ok(updateStored && updateStored.kind === 'profile_update')
      if (updateStored.kind === 'profile_update') {
        assert.deepEqual(updateStored.patch, { tagline: 'new tagline', modelSlotId: slot.id })
        assert.deepEqual(updateStored.before, { tagline: 'old tagline', modelSlotId: null })
        assert.equal(updateStored.profileName, 'Mina')
      }
      assert.match(read(await bridge.call('propose_profile_update', { profile_id: 9999, patch: { name: 'Z' } })), /not found/)

      controller.abort()
      const stale = await bridge.call('propose_display_block', { block: BLOCK })
      assert.equal(stale.isError, true)
      assert.match(read(stale), /ended|interrupted/)
    } finally { close(); await bridge.close() }
  })

  await t.test('saved route: admin + owned thread, id rules, 404', async () => {
    const express = (await import('express')).default
    const router = (await import('../src/routes/chat-proposals.routes')).default
    const app = express()
    app.use(express.json())
    // The real app mounts express-session before this router; the bootstrap owner (no accounts configured) needs an empty session.
    app.use((req, _res, next) => { (req as unknown as { session: object }).session = {}; next() })
    app.use('/api/chat-proposals', router)
    const server = http.createServer(app)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    t.after(() => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections() }))
    const port = (server.address() as { port: number }).port
    const post = async (id: number | string, body: unknown, operation = 'saved') => {
      const response = await fetch(`http://127.0.0.1:${port}/api/chat-proposals/${id}/${operation}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      return { status: response.status, json: await response.json() as { success: boolean; data?: { id: number; savedId: number | null; saved: boolean } } }
    }
    const block = ChatProposalStore.add(replyContext('r-route'), { kind: 'display_block', name: 'n', block: { key: 'n' }, linkProfileId: null })
    const update = ChatProposalStore.add(replyContext('r-route'), { kind: 'profile_update', profileId: profile.id, profileName: 'Mina', patch: { name: 'Q' }, before: { name: 'Mina' } })
    assert.equal((await post(block.id, {})).status, 400)
    assert.equal((await post(block.id, { savedId: 'x' })).status, 400)
    const done = await post(block.id, { savedId: 7 })
    assert.equal(done.status, 200)
    assert.deepEqual(done.json, { success: true, data: { id: block.id, savedId: 7, saved: true } })
    const marked = ChatProposalStore.find(block.id)
    assert.equal(marked?.kind === 'display_block' && marked.savedId, 7)
    assert.equal((await post(update.id, {})).status, 200)
    assert.equal((await post(999999, { savedId: 1 })).status, 404)
    // A chat owned by an account is invisible to the account-less requester.
    const foreignThread = CodexChatStore.createThread(5, 'foreign', 'llm', profile.id)
    const foreign = ChatProposalStore.add({ threadId: foreignThread, profileId: profile.id, kind: 'direct', replyId: 'r-foreign' }, { kind: 'profile', input: { name: 'F' } })
    assert.equal((await post(foreign.id, { savedId: 1 })).status, 404)
    const { fields: _fields, ...target } = page
    const proposed = ChatProposalStore.add({ threadId: pageThreadId, profileId: pageProfile.id, kind: 'direct', replyId: 'page-route' }, { kind: 'page_fields', page: target, changes: buildChatPageChanges(page, [{ fieldId: 'steps', value: 30 }]), expiresAt: Date.now() + 60_000 })
    const binding = { instanceId: page.instanceId, connectionId: page.connectionId }
    assert.equal((await post(proposed.id, { ...binding, connectionId: 'wrong-connection' }, 'page-check')).status, 409)
    assert.equal((await post(proposed.id, binding, 'page-check')).status, 200)
    const reviewed = ChatProposalStore.find(proposed.id)
    assert.ok(reviewed?.kind === 'page_fields')
    assert.ok(!reviewed.saved, 'authorizing a card is not applying it')
    assert.equal((await post(proposed.id, binding, 'page-applied')).status, 200)
    assert.equal((await post(proposed.id, binding, 'page-check')).status, 409, 'no duplicate apply')
    assert.equal((await post(proposed.id, { ...binding, undo: true }, 'page-check')).status, 200)
    ChatProfileStore.update(pageProfile.id, { mcpEnabled: false })
    assert.equal((await post(proposed.id, { ...binding, undo: true }, 'page-check')).status, 403)
  })
})
