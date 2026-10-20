import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { ChatExecutionContext } from '@conai/shared'

test('content rating ceilings: what a model may be shown', { timeout: 60000 }, async (t) => {
  // Load runtime modules only after isolating every data path. Never open the user's databases.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-content-rating-test-'))
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
    assert.ok(path.basename(root).startsWith('conai-content-rating-test-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { ModelSlotStore } = await import('../src/services/codex-chat/modelSlots')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
  const { openChatMcpBridge } = await import('../src/services/codex-chat/chatMcpBridge')
  const { registerChatReply } = await import('../src/services/codex-chat/chatReplyRegistry')
  const { loadAttachedImages, attachedImageKey } = await import('../src/services/codex-chat/chatAttachments')
  const { profileContentLimit, contextContentLimit } = await import('../src/services/codex-chat/chatContentRating')
  const rating = await import('../src/services/contentRating')
  const { imageTaggerService } = await import('../src/services/imageTaggerService')
  const { settingsService } = await import('../src/services/settingsService')
  const { FileStoreService } = await import('../src/services/fileStoreService')
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  updateChatSettings({ enabled: true })
  ExternalApiProvider.create({ provider_name: 'conn', display_name: 'Conn', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })

  // Default tiers in order: G [0,2) · Teen [2,6) · SFW [6,15) · NSFW [15,∞). A ceiling is a tier's id.
  const { RatingScoreModel } = await import('../src/models/RatingScore')
  const tierId = (name: string) => RatingScoreModel.getAllTiers().find((tier) => tier.tier_name === name)!.id
  const teen = tierId('Teen')
  const sfw = tierId('SFW')
  const nsfw = tierId('NSFW')
  const sharp = (await import('sharp')).default
  const folderId = Number(main.db.prepare('INSERT INTO watched_folders (folder_path, folder_name) VALUES (?, ?)').run(root, 'test').lastInsertRowid)
  const addMedia = async (hash: string, score: number | null) => {
    const file = path.join(root, `${hash.slice(0, 6)}.png`)
    await sharp({ create: { width: 16, height: 16, channels: 3, background: '#4488aa' } }).png().toFile(file)
    main.db.prepare('INSERT INTO media_metadata (composite_hash, rating_score) VALUES (?, ?)').run(hash, score)
    main.db.prepare("INSERT INTO image_files (composite_hash, original_file_path, folder_id, file_size, mime_type) VALUES (?, ?, ?, ?, 'image/png')").run(hash, file, folderId, fs.statSync(file).size)
    return hash
  }
  const safe = await addMedia('a'.repeat(48), 1)
  const explicit = await addMedia('b'.repeat(48), 40)
  const unrated = await addMedia('c'.repeat(48), null)

  await t.test('a score passes up to the ceiling tier; an unknown score is unknown', () => {
    assert.equal(rating.scoreWithinLimit(40, null), true)
    assert.equal(rating.scoreWithinLimit(1, teen), true)
    assert.equal(rating.scoreWithinLimit(5.9, teen), true)
    assert.equal(rating.scoreWithinLimit(6, teen), false)
    assert.equal(rating.scoreWithinLimit(null, teen), null)
  })

  const slotId = ModelSlotStore.ensure('conn', 'm') as number
  const followsModel = ChatProfileStore.create({ name: 'Follows', engine: 'llm', modelSlotId: slotId, systemPrompt: 'p', visionEnabled: true, mcpEnabled: true, mcpScopes: ['read'] })

  await t.test('profiles follow their model row or set their own; Codex and Claude always set their own', () => {
    assert.equal(followsModel.contentRatingMode, 'model')
    assert.equal(profileContentLimit(followsModel), null)
    ModelSlotStore.update(slotId, { contentRatingTierId: teen })
    assert.equal(ModelSlotStore.find(slotId)!.contentRatingTierId, teen)
    assert.equal(profileContentLimit(followsModel), teen)
    const custom = ChatProfileStore.create({ name: 'Custom', engine: 'llm', modelSlotId: slotId, systemPrompt: 'p', contentRatingMode: 'custom', contentRatingTierId: null })
    assert.equal(profileContentLimit(custom), null, 'a custom "no ceiling" overrides the row')
    const codex = ChatProfileStore.create({ name: 'Codex', engine: 'codex', systemPrompt: 'p', contentRatingMode: 'model', contentRatingTierId: sfw })
    assert.equal(codex.contentRatingMode, 'custom')
    assert.equal(profileContentLimit(codex), sfw)
    assert.throws(() => ModelSlotStore.update(slotId, { contentRatingTierId: 99999 }), /허용 등급/)
    // An MCP request outside any chat has no ceiling; a chat request without a fixed one uses its profile's.
    assert.equal(contextContentLimit({ scopes: ['read'] }), null)
    assert.equal(contextContentLimit({ scopes: ['read'], chatContext: { threadId: 1, profileId: followsModel.id, kind: 'direct' } }), teen)
  })

  const admin = { accountId: null, accountType: 'admin' as const }
  const controller = new AbortController()
  const viewWith = async (profileId: number, args: Record<string, unknown>, contentRatingLimit?: number | null) => {
    const threadId = CodexChatStore.createThread(null, 'chat', 'llm', profileId)
    const context: ChatExecutionContext = { threadId, profileId, kind: 'direct', replyId: `r-${threadId}` }
    const unregister = registerChatReply(context, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
    const bridge = await openChatMcpBridge(admin, ['read'], null, { chatContext: context, contentRatingLimit })
    try {
      return (await bridge.call('view_images', args)).content as Array<{ type: string; text?: string }>
    } finally {
      await bridge.close()
      unregister()
    }
  }

  await t.test('view_images withholds what is above the ceiling, unrated media included while the tagger is off', async () => {
    const content = await viewWith(followsModel.id, { composite_hashes: [safe, explicit, unrated] }, teen)
    assert.equal(content.filter((part) => part.type === 'image').length, 1)
    const text = content.filter((part) => part.type === 'text').map((part) => part.text).join('\n')
    assert.match(text, new RegExp(`${explicit}: ${rating.CONTENT_RATING_BLOCKED}`))
    assert.match(text, new RegExp(`${unrated}: ${rating.CONTENT_RATING_BLOCKED}`))
    // Without a fixed ceiling the profile's applies (a Codex session reaches the tool this way).
    assert.equal((await viewWith(followsModel.id, { composite_hashes: [explicit] })).filter((part) => part.type === 'image').length, 0)
    assert.equal((await viewWith(followsModel.id, { composite_hashes: [explicit] }, null)).filter((part) => part.type === 'image').length, 1)
  })

  await t.test('attached images above the ceiling stay references', async () => {
    const media = [safe, explicit].map((compositeHash) => ({ compositeHash, name: 'x.png', mimeType: 'image/png' }))
    const shown = await loadAttachedImages(followsModel, admin, [{ mediaAttachments: media }])
    assert.ok(shown?.has(attachedImageKey('media', safe)))
    assert.ok(!shown?.has(attachedImageKey('media', explicit)))
  })

  await t.test('unrated media is rated on the spot and the score kept', async (s) => {
    s.mock.method(settingsService, 'loadSettings', () => ({ tagger: { enabled: true } }))
    let calls = 0
    s.mock.method(imageTaggerService, 'tagImage', async () => {
      calls++
      return { success: true, rating: { general: 0.05, sensitive: 0.1, questionable: 0.05, explicit: 0.8 } }
    })
    const [first, second] = await Promise.all([rating.libraryMediaAllowed(unrated, teen), rating.libraryMediaAllowed(unrated, teen)])
    assert.equal(first, false)
    assert.equal(second, false)
    assert.equal(calls, 1, 'one tagger run for concurrent callers')
    const kept = main.db.prepare('SELECT rating_score FROM media_metadata WHERE composite_hash = ?').get(unrated) as { rating_score: number }
    assert.ok(kept.rating_score >= 15)
    assert.equal(await rating.libraryMediaAllowed(unrated, nsfw), true)
    assert.equal(calls, 1)

    // Private files are rated as they land; workflow bytes when they are sent.
    const staged = path.join(root, 'upload.png')
    await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000000' } }).png().toFile(staged)
    const [entry] = FileStoreService.upload('bootstrap', null, [{ originalname: 'upload.png', path: staged, size: fs.statSync(staged).size, mimetype: 'image/png' } as Express.Multer.File])
    assert.equal(await rating.storedFileAllowed(entry.id, sfw), false)
    assert.equal(await rating.storedFileAllowed(entry.id, nsfw), true)
    const dataUrl = `data:image/png;base64,${(await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ffffff' } }).png().toBuffer()).toString('base64')}`
    assert.equal(await rating.imageDataUrlAllowed(dataUrl, teen), false)
    assert.equal(await rating.imageDataUrlAllowed(dataUrl, null), true)
  })

  await t.test('download links follow the ceiling too (a model could fetch and look at the file)', async () => {
    const { createMcpServer } = await import('../src/mcp/server')
    const { Client } = await import('@modelcontextprotocol/client')
    const { InMemoryTransport } = await import('@modelcontextprotocol/client')
    const download = async (contentRatingLimit: number | null) => {
      const server = createMcpServer({ scopes: ['read'], requester: admin, baseUrl: 'http://127.0.0.1:1', contentRatingLimit })
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      await server.connect(serverTransport)
      const client = new Client({ name: 'test', version: '1.0.0' })
      await client.connect(clientTransport)
      try {
        const result = await client.callTool({ name: 'get_media_download', arguments: { composite_hashes: [safe, explicit] } }) as { content: Array<{ text: string }> }
        return JSON.parse(result.content[0].text).items as Array<{ composite_hash: string; error?: string }>
      } finally {
        await client.close()
        await server.close()
      }
    }
    const limited = await download(teen)
    assert.equal(limited.find((item) => item.composite_hash === explicit)!.error, rating.CONTENT_RATING_BLOCKED)
    assert.notEqual(limited.find((item) => item.composite_hash === safe)!.error, rating.CONTENT_RATING_BLOCKED)
    assert.notEqual((await download(null)).find((item) => item.composite_hash === explicit)!.error, rating.CONTENT_RATING_BLOCKED)
  })

  await t.test('library text (prompts, metadata) above the ceiling is hidden, the item kept', async () => {
    const { createMcpServer } = await import('../src/mcp/server')
    const { Client, InMemoryTransport } = await import('@modelcontextprotocol/client')
    const sensitive = await addMedia('d'.repeat(48), 10)
    main.db.prepare("UPDATE media_metadata SET prompt = 'redaction probe', negative_prompt = 'neg', width = 16 WHERE composite_hash IN (?, ?)").run(safe, sensitive)
    const call = async (contentRatingLimit: number | null, name: string, args: Record<string, unknown>) => {
      const server = createMcpServer({ scopes: ['read'], requester: admin, contentRatingLimit })
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      await server.connect(serverTransport)
      const client = new Client({ name: 'test', version: '1.0.0' })
      await client.connect(clientTransport)
      try {
        const result = await client.callTool({ name, arguments: args }) as { content: Array<{ text: string }> }
        return JSON.parse(result.content[0].text)
      } finally {
        await client.close()
        await server.close()
      }
    }
    const limited = await call(teen, 'get_image_metadata', { composite_hash: sensitive })
    assert.equal(limited.rating_restricted, true)
    assert.equal(limited.composite_hash, sensitive)
    assert.equal(limited.width, 16)
    assert.doesNotMatch(JSON.stringify(limited), /redaction probe|"neg"/)
    assert.equal((await call(teen, 'get_image_metadata', { composite_hash: safe })).prompt, 'redaction probe')
    assert.equal((await call(null, 'get_image_metadata', { composite_hash: sensitive })).prompt, 'redaction probe')

    const found = (await call(teen, 'search_images', { search_text: 'redaction probe' })).images as Array<{ composite_hash: string; prompt: string; rating_restricted?: boolean }>
    assert.equal(found.length, 2, 'restricted items stay in the results')
    const hidden = found.find((image) => image.composite_hash === sensitive)!
    assert.equal(hidden.rating_restricted, true)
    assert.notEqual(hidden.prompt, 'redaction probe')
    const shown = found.find((image) => image.composite_hash === safe)!
    assert.equal(shown.rating_restricted, undefined)
    assert.equal(shown.prompt, 'redaction probe')
  })

  await t.test('a connected screen hides the prompts and tags of media above the ceiling, the live snapshot kept', async () => {
    const { normalizeChatPageSnapshot } = await import('@conai/shared')
    const { chatPageView, ratingFilteredPage } = await import('../src/mcp/tools/chatPageView')
    const detail = (hash: string) => normalizeChatPageSnapshot({ instanceId: `inst-rating-${hash.slice(0, 4)}`, connectionId: 'conn-rating', path: `/images/${hash}`, title: '이미지 상세', kind: 'image_detail', resourceId: hash, revision: 'rev-rating-1',
      fields: [{ id: 'prompt', label: 'Prompt', type: 'text', value: 'page probe', editable: false }, { id: 'tab', label: 'Tab', type: 'select', value: 'current', options: ['current', 'similar'] }],
      data: { selected: { hash, width: 16, height: 16 }, autoTags: { tagger: { general: [{ name: 'probe_tag', score: 0.9 }] } } } })
    const page = detail(explicit)
    const view = chatPageView(admin, page, teen)
    assert.doesNotMatch(JSON.stringify(view), /page probe|probe_tag/)
    assert.equal(view.data?.rating_restricted, true)
    assert.deepEqual(view.data?.selected, { hash: explicit, width: 16, height: 16 }, 'ids and sizes stay')
    assert.equal(view.fields.find((field) => field.id === 'tab')?.value, 'current')
    assert.equal(page.fields[0].value, 'page probe', 'the live snapshot is not changed')
    assert.equal(ratingFilteredPage(page, null), page, 'no ceiling: as is')
    const safePage = detail(safe)
    assert.equal(ratingFilteredPage(safePage, teen), safePage, 'media within the ceiling: as is')

    const metadata = normalizeChatPageSnapshot({ ...page, kind: 'metadata', path: `/images/${explicit}/metadata`, fields: [{ id: 'negativePrompt', label: 'Negative', type: 'text', value: 'neg probe' }, { id: 'steps', label: 'Steps', type: 'number', value: 28 }], data: { selected: { prompt: 'page probe', negativePrompt: 'neg probe', steps: 28 } } })
    const hidden = chatPageView(admin, metadata, teen)
    assert.doesNotMatch(JSON.stringify(hidden), /page probe|neg probe/)
    assert.equal((hidden.data?.selected as { steps: number }).steps, 28)

    // A save proposal on that screen: the stored card keeps the live values, the model's copy hides them.
    const { ChatProposalStore } = await import('../src/services/codex-chat/chatProposals')
    const saving = normalizeChatPageSnapshot({ ...metadata, actions: [{ id: 'metadata.save', label: 'Save metadata', description: 'Write the draft.', effect: 'save', schema: { type: 'object', properties: {} } }] })
    const assistant = ChatProfileStore.create({ name: 'Rated page assistant', engine: 'llm', modelSlotId: slotId, systemPrompt: 'p', mcpEnabled: true, mcpScopes: ['read'], toolAllowlist: ['get_current_page', 'read_page_data', 'propose_page_action'], pageAssist: true })
    const threadId = CodexChatStore.createThread(null, 'rated page', 'llm', assistant.id)
    const context: ChatExecutionContext = { threadId, profileId: assistant.id, kind: 'direct', replyId: 'rated-page-action', page: saving }
    const unregister = registerChatReply(context, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
    const bridge = await openChatMcpBridge(admin, ['read', 'generate', 'organize', 'configure'], null, { chatContext: context, contentRatingLimit: teen })
    try {
      const result = await bridge.call('propose_page_action', { actionId: 'metadata.save', arguments: {} })
      assert.ok(!result.isError, JSON.stringify(result))
      const shown = (result.structuredContent as { proposal: { id: number; before: Record<string, unknown>; rating_restricted?: boolean } }).proposal
      assert.doesNotMatch(JSON.stringify(result), /page probe|neg probe/)
      assert.equal(shown.rating_restricted, true)
      assert.equal(shown.before.steps, 28)
      const stored = ChatProposalStore.find(shown.id) as { before: Record<string, unknown> }
      assert.equal(stored.before.prompt, 'page probe', 'the review card keeps the live values')
    } finally {
      await bridge.close()
      unregister()
    }
  })

  await t.test('saving the tiers keeps their ids: ceilings follow renames and inserts; a deleted ceiling blocks all', async () => {
    const { RatingScoreService } = await import('../src/services/ratingScoreService')
    const before = RatingScoreModel.getAllTiers()
    const renamed = await RatingScoreService.updateAllTiers(before.map((tier) => ({ ...tier, tier_name: tier.id === teen ? '청소년' : tier.tier_name })))
    assert.deepEqual(renamed.map((tier) => tier.id), before.map((tier) => tier.id))
    assert.equal(renamed.find((tier) => tier.id === teen)!.tier_name, '청소년')

    // A new tier between G and 청소년 (a temporary client id): the old ids stay, the ceiling still means "up to 청소년".
    const [g, ...rest] = renamed
    const inserted = await RatingScoreService.updateAllTiers([
      { ...g, max_score: 1 },
      { id: Date.now(), tier_name: 'New', min_score: 1, max_score: 2, tier_order: 2, color: null, feed_visibility: 'show' },
      ...rest.map((tier) => ({ ...tier, tier_order: tier.tier_order + 1 })),
    ])
    assert.equal(inserted.length, 5)
    assert.ok(before.every((tier) => inserted.some((entry) => entry.id === tier.id)))
    assert.equal(rating.scoreWithinLimit(5, teen), true)
    assert.equal(rating.scoreWithinLimit(7, teen), false)

    // Removing the ceiling's tier: nothing passes it any more.
    const added = inserted.find((tier) => tier.tier_name === 'New')!
    assert.equal(rating.scoreWithinLimit(0.5, added.id), true)
    await RatingScoreService.updateAllTiers(before)
    assert.equal(rating.scoreWithinLimit(0.5, added.id), false)
  })
})
