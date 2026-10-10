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
