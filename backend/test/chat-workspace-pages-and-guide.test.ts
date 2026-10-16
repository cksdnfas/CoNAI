import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { McpRequestContext } from '../src/mcp/context'

/**
 * The chat's reach into the sprite, audio and upload pages (operation tiers, compact views), the whole-effect / folder
 * / project audio deletes, and the user guide tool.
 */
test('workspace pages, audio deletes and the user guide', { timeout: 60000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-workspace-guide-'))
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
    assert.ok(path.basename(root).startsWith('conai-workspace-guide-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  const shared = await import('@conai/shared')
  const { getMcpToolScope } = await import('../src/mcp/context')
  const { TOOL_FEATURE_PERMISSIONS } = await import('../src/mcp/toolAccess')
  const { createMcpServer } = await import('../src/mcp/server')
  const { catalogToolNames } = await import('../src/mcp/toolCatalog')
  const { Client, InMemoryTransport } = await import('@modelcontextprotocol/client')
  const admin = { accountId: null, accountType: 'admin' as const }

  const connect = async (context: McpRequestContext) => {
    const server = createMcpServer(context)
    const client = new Client({ name: 'workspace-guide', version: '1' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    t.after(async () => { await client.close(); await server.close() })
    return { server, client }
  }
  const call = async (client: InstanceType<typeof Client>, name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args }) as { isError?: boolean; content: Array<{ text: string }> }
    return { error: result.isError === true, text: result.content[0]?.text ?? '' }
  }

  await t.test('operation ids, routes and tiers of the sprite, audio and upload pages', () => {
    const { chatPageActionTier: tier, chatPageActionAllowed: allowed, chatPageActionLeavesScreen: leaves } = shared
    for (const id of ['sprite.add_videos', 'sprite.remove_videos', 'sprite.preview', 'sprite.add_sheets', 'sprite.remove_sheets', 'sprite.sheet', 'sprite.download', 'upload.reextract', 'upload.convert']) assert.equal(tier(id), 'draft', id)
    for (const id of ['sprite.run', 'upload.library']) assert.equal(tier(id), 'commit', id)
    for (const id of ['sprite.download_zip', 'audio.project', 'audio.search', 'upload.download']) assert.equal(tier(id), 'view', id)
    assert.ok(!leaves('audio.search') && !leaves('sprite.download_zip') && !leaves('upload.download'), 'these stay on the screen')
    assert.ok(allowed('/upload', 'upload.library') && !allowed('/generation', 'upload.library'), 'upload operations only on /upload')
    assert.ok(allowed('/sprite', 'sprite.run') && allowed('/audio', 'audio.project') && !allowed('/audio', 'sprite.run'))
    assert.throws(() => shared.normalizeChatPageActions('/sprite', [{ id: 'sprite.run', label: 'run', description: '', effect: 'draft', schema: { type: 'object', properties: {} } }]), /저장 범위/, 'a saving run must be declared as save')
  })

  await t.test('the page views stay small: lists capped, prompts clipped, long collections as sizes', async () => {
    const { chatPageReference } = await import('../src/services/codex-chat/chatPageContext')
    const hash = (index: number) => index.toString(16).padStart(40, '0')
    const base = { instanceId: 'inst-ws-1', connectionId: 'conn-ws-1', revision: 'rev-ws-1', title: '스프라이트 · 추출' }
    const action = (id: string, effect: 'draft' | 'save' = 'draft') => ({ id, label: id, description: 'An operation with a sentence of description, as the pages register them.', effect, schema: { type: 'object', properties: {} } })
    const videos = Array.from({ length: 100 }, (_, index) => hash(index))
    const sprite = shared.normalizeChatPageSnapshot({
      ...base, path: '/sprite', kind: 'sprite', resourceId: videos[0],
      fields: Array.from({ length: 25 }, (_, index) => ({ id: `field${index}`, label: `Field label ${index} (with a short hint)`, type: 'number', value: index, min: 0, max: 100 })),
      actions: [{ ...action('sprite.select'), schema: { type: 'object', properties: { hash: { type: 'string', enum: videos } }, required: ['hash'] } }, action('sprite.add_videos'), action('sprite.remove_videos'), action('sprite.preview'), action('sprite.run', 'save')],
      data: {
        tab: 'extract', videoHash: videos[0], videos,
        video: { name: 'walk.mp4', width: 512, height: 512, fps: 24, frameCount: 96, duration: 4 },
        batch: { running: true, counts: { done: 30, running: 1, waiting: 69 }, items: Array.from({ length: 31 }, (_, index) => ({ videoHash: videos[index], status: index === 30 ? 'running' : 'done', sheetHash: hash(500 + index) })) },
      },
    })
    const spriteReference = chatPageReference(sprite, admin)
    const upload = shared.normalizeChatPageSnapshot({
      ...base, title: '업로드', path: '/upload', kind: 'upload', resourceId: 'upload-1',
      fields: [{ id: 'mode', label: 'mode', type: 'select', value: 'inspect', options: ['library', 'inspect'] }, { id: 'prompt', label: 'Prompt', type: 'text', value: 'tag, '.repeat(600) }],
      actions: [action('upload.reextract'), action('upload.convert'), action('upload.download')],
      data: {
        selected: { fileName: 'a.png', bytes: 1234, mimeType: 'image/png' },
        extracted: { aiTool: 'NovelAI', model: 'nai-diffusion-4-5', prompt: `${'tag, '.repeat(300).slice(0, 1500)}…`, negativePrompt: 'lowres', params: { steps: '28', sampler: 'k_euler' } },
        tagger: { rating: [{ name: 'general', score: 0.9 }], general: Array.from({ length: 25 }, (_, index) => ({ name: `tag_${index}`, score: 0.5 })) },
      },
    })
    const uploadReference = chatPageReference(upload, admin)
    t.diagnostic(`page view chars: sprite extract (100 videos, batch running) ${spriteReference.length}, upload inspect (long prompt) ${uploadReference.length}`)
    assert.ok(spriteReference.length < 12_500 && uploadReference.length < 12_500, 'within the page view budget')
    assert.match(spriteReference, /"videos":\{"count":100/, 'a long video list travels as its size')
  })

  await t.test('get_app_guide: contents first, a guide outline, then sections or pages on request', async () => {
    const guides = await import('../src/services/appGuides')
    assert.ok(guides.appGuideDir(), 'the guides are found in the repository')
    const list = guides.listAppGuides()
    assert.ok(list.some((entry) => entry.topic === 'CHAT') && !list.some((entry) => entry.topic === 'index'))
    assert.equal(guides.plainGuideText('::: v-pre\nA\n:::\n::: warning Codex\nB\n:::\n[x](./CHAT.md#y)'), 'A\n> **Codex**\nB\n[x](topic:CHAT#y)')

    const outline = guides.readAppGuide('chat', { limit: 8000 })
    assert.ok(!('error' in outline) && 'sections' in outline && outline.sections.length > 3, 'a topic alone gives its outline')
    assert.ok(!('text' in outline) && outline.intro.length <= 801, 'never the whole guide by default')
    const section = guides.readAppGuide('CHAT', { section: outline.sections[1], limit: 8000 })
    assert.ok(!('error' in section) && 'text' in section && section.text.startsWith('#'))
    const page = guides.readAppGuide('CHAT', { offset: 0, limit: 2000 })
    assert.ok('text' in page && page.text.length <= 2000 && page.next_offset, 'an offset pages the whole guide')
    assert.ok('error' in guides.readAppGuide('../secrets', { limit: 100 }), 'only guide topics')
    assert.ok('error' in guides.readAppGuide('CHAT', { section: 'no such heading at all', limit: 100 }))

    assert.equal(getMcpToolScope('get_app_guide'), 'read')
    assert.deepEqual(TOOL_FEATURE_PERMISSIONS.get_app_guide, [])
    const { client } = await connect({ scopes: ['read'], requester: admin })
    const contents = JSON.parse((await call(client, 'get_app_guide', {})).text)
    assert.ok(contents.guides.length > 10 && contents.guides.every((entry: Record<string, unknown>) => Object.keys(entry).join() === 'topic,title'), 'the contents are topics and titles only')
    const missing = await call(client, 'get_app_guide', { topic: 'NOPE' })
    assert.ok(missing.error && /CHAT/.test(missing.text), 'a wrong topic lists the right ones')
  })

  await t.test('audio: whole effect, folder and project deletes name what they delete; remain available with general grants on connected pages', async () => {
    const audio = await import('../src/services/audio/audioService')
    const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
    const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
    const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
    const { CHAT_SCOPES } = await import('../src/services/codex-chat/chatSettings')
    for (const tool of ['delete_audio_group', 'delete_audio_folder', 'delete_audio_project']) {
      assert.equal(getMcpToolScope(tool), 'organize')
      assert.deepEqual(TOOL_FEATURE_PERMISSIONS[tool], ['audio.view', 'audio.edit'])
    }
    const project = audio.createAudioProject({ name: '숲' })
    const folder = audio.createAudioFolder(project.id, { name: 'UI' })
    const group = audio.createAudioGroup(project.id, { name: '발소리', label: 'footstep_[00]', folder_id: folder.id })
    const { client } = await connect({ scopes: ['read', 'organize'], requester: admin })

    const wrong = await call(client, 'delete_audio_group', { group_id: group.id, confirm_name: '바람' })
    assert.ok(wrong.error && /발소리/.test(wrong.text), 'a different name is refused')
    assert.equal(audio.getAudioGroup(group.id).name, '발소리')
    assert.ok(!(await call(client, 'delete_audio_folder', { folder_id: folder.id, confirm_name: 'UI' })).error)
    assert.equal(audio.getAudioGroup(group.id).folder_id, null, 'the effects of a deleted folder stay')
    const inbox = audio.getAudioInboxGroup(project.id)
    assert.ok((await call(client, 'delete_audio_group', { group_id: inbox.id, confirm_name: inbox.name })).error, 'the inbox stays')
    assert.ok(!(await call(client, 'delete_audio_group', { group_id: group.id, confirm_name: ' 발소리 ' })).error)
    assert.throws(() => audio.getAudioGroup(group.id))
    assert.ok(!(await call(client, 'delete_audio_project', { project_id: project.id, confirm_name: '숲' })).error)
    assert.throws(() => audio.getAudioProject(project.id))

    ExternalApiProvider.create({ provider_name: 'conn-ws', display_name: 'Conn', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
    const profile = ChatProfileStore.create({ name: 'Sound', engine: 'llm', providerName: 'conn-ws', mcpEnabled: true, mcpScopes: [...CHAT_SCOPES] })
    const threadId = CodexChatStore.createThread(null, 'audio delete chat', 'llm', profile.id)
    const page = shared.normalizeChatPageSnapshot({ instanceId: 'page-audio-del', connectionId: 'connection-audio-del', title: '오디오', fields: [], path: '/audio', kind: 'audio', resourceId: null })
    const offered = async (withPage: boolean) => {
      const { server, client: chatClient } = await connect({ scopes: [...CHAT_SCOPES] as McpRequestContext['scopes'], source: 'codex-chat', requester: admin, chatContext: { threadId, profileId: profile.id, kind: 'direct', replyId: 'audio-del-reply', ...(withPage ? { page } : {}) } })
      return new Set([...(await chatClient.listTools()).tools.map((tool) => tool.name), ...catalogToolNames(server)])
    }
    const onPage = await offered(true)
    assert.ok(onPage.has('create_audio_folder') && onPage.has('delete_audio_group'), 'ordinary pages preserve the general organize grant')
    assert.ok(onPage.has('get_app_guide'), 'the guide is a read and stays on a connected page')
    const noPage = await offered(false)
    assert.ok(noPage.has('delete_audio_group') && noPage.has('delete_audio_project'))
  })

  await t.test('extract_sprite_sheets_batch can hand back a ZIP', async () => {
    const { client } = await connect({ scopes: ['read', 'organize', 'generate', 'backup', 'restore'] as McpRequestContext['scopes'], requester: admin })
    const batch = (await client.listTools()).tools.find((tool) => tool.name === 'extract_sprite_sheets_batch')
    assert.ok(batch && 'zip' in ((batch.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}))
  })
})
