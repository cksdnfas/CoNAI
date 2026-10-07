import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import dns from 'node:dns'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { test } from 'node:test'
import sharp from 'sharp'
import type { Request, Response } from 'express'

test('chat profile assets: library migration, access, imports and generation references', { timeout: 60000 }, async (t) => {
  const temp = path.resolve(__dirname, '../../temp')
  fs.mkdirSync(temp, { recursive: true })
  const root = fs.mkdtempSync(path.join(temp, 'conai-profile-assets-test-'))
  process.env.RUNTIME_BASE_PATH = root
  process.env.RUNTIME_DATABASE_DIR = path.join(root, 'database')
  process.env.RUNTIME_SAVE_DIR = path.join(root, 'save')
  process.env.RUNTIME_UPLOADS_DIR = path.join(root, 'uploads')
  process.env.RUNTIME_TEMP_DIR = path.join(root, 'temp')
  const settings = await import('../src/database/userSettingsDb')
  settings.initializeUserSettingsDb()
  ;(await import('../src/database/apiGenerationDb')).initializeApiGenerationDb()
  const auth = await import('../src/database/authDb')
  auth.initializeAuthDb()
  const images = await import('../src/database/init')
  await images.initializeDatabase()
  fs.mkdirSync(path.join(root, 'temp'), { recursive: true })
  const db = settings.getUserSettingsDb()
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const assets = await import('../src/services/codex-chat/chatProfileAssets')
  const media = await import('../src/services/codex-chat/chatCardAssets')
  const { GroupPathService } = await import('../src/services/groupPathService')
  const { BackgroundQueueService } = await import('../src/services/backgroundQueue')
  const { MediaPostprocessCoordinator } = await import('../src/services/background-media/mediaPostprocessCoordinator')
  const { skippedStage } = await import('../src/services/background-media/mediaProcessingTypes')
  const { updateChatSettings } = await import('../src/services/codex-chat/chatSettings')
  const { AuthAccessControlService } = await import('../src/services/authAccessControlService')
  const { AuthAccount } = await import('../src/models/AuthAccount')
  const { RatingScoreModel } = await import('../src/models/RatingScore')
  // Hashing, files, thumbnails and groups are real; no tagger, metadata worker or external service runs.
  t.mock.method(BackgroundQueueService, 'addMetadataExtractionTask', () => {})
  t.mock.method(MediaPostprocessCoordinator, 'triggerAutoTagProcessing', () => skippedStage('auto-tag', 'test'))
  t.after(async () => {
    settings.closeUserSettingsDb()
    auth.getAuthDb().close()
    images.closeDatabase()
    const { logger } = await import('../src/utils/logger')
    await new Promise<void>((resolve) => logger.close(resolve))
    assert.equal(path.dirname(path.resolve(root)), temp)
    assert.ok(path.basename(root).startsWith('conai-profile-assets-test-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  updateChatSettings({ enabled: true })
  const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#c85784' } }).png().toBuffer()
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`
  const first = ChatProfileStore.create({ name: '이관 캐릭터', engine: 'codex', avatar: dataUrl, background: dataUrl, appearance: '외형은 생성 전용' })
  const second = ChatProfileStore.create({ name: '같은 픽셀', engine: 'codex', avatar: dataUrl })
  let hash = ''
  let originalPath = ''

  // Invoke the real middleware/route stack in memory, without a listening server or HTTP request.
  const router = (await import('../src/routes/codex-chat.routes')).default
  async function call(routePath: string, params: Record<string, string> = {}, options: { method?: string; body?: unknown; multipart?: Buffer; headers?: Record<string, string> } = {}) {
    const method = options.method ?? 'get'
    const route = (router as any).stack.find((layer: any) => layer.route?.path === routePath && layer.route.methods[method])?.route
    assert.ok(route, routePath)
    return new Promise<{ status: number; body: any; headers: Record<string, unknown> }>((resolve, reject) => {
      const headers: Record<string, unknown> = {}
      const chunks: Buffer[] = []
      let status = 200
      const req = Object.assign(new PassThrough(), { params, query: {}, body: options.body, headers: options.headers ?? {}, session: {}, method: method.toUpperCase(), socket: { remoteAddress: '127.0.0.1' } }) as unknown as Request
      const res = Object.assign(new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done() } }), {
        status(code: number) { status = code; return this },
        setHeader(name: string, value: unknown) { headers[name.toLowerCase()] = value },
        json(body: unknown) { resolve({ status, body, headers }); return this },
        send(body: unknown) { resolve({ status, body, headers }); return this },
      }) as unknown as Response
      res.on('finish', () => resolve({ status, body: Buffer.concat(chunks), headers }))
      let index = 0
      const next = (error?: unknown) => {
        if (error) { reject(error); return }
        const layer = route.stack[index++]
        if (!layer) { reject(new Error('Route did not respond')); return }
        try { Promise.resolve(layer.handle(req, res, next)).catch(reject) } catch (error) { reject(error) }
      }
      next()
      if (options.multipart) req.end(options.multipart)
    })
  }

  await t.test('migration is idempotent across profiles and encodings, keeps data URLs and public hashes', async () => {
    await assets.migrateLegacyProfileAssets()
    hash = ChatProfileStore.find(first.id)!.avatarHash!
    assert.match(hash, /^[a-f0-9]{48}$/)
    assert.equal(ChatProfileStore.find(first.id)!.backgroundHash, hash)
    assert.equal(ChatProfileStore.find(second.id)!.avatarHash, hash)
    await assets.migrateLegacyProfileAssets()
    assert.equal(ChatProfileStore.find(first.id)!.avatarHash, hash)
    const webp = await sharp(png).webp({ lossless: true }).toBuffer()
    assert.equal((await assets.ingestProfileAsset(webp, '같은 픽셀')).compositeHash, hash)
    const reused = await Promise.all([assets.ingestProfileAsset(png, '같은 픽셀'), assets.ingestProfileAsset(webp, '같은 픽셀')])
    assert.ok(reused.every((item) => item.compositeHash === hash))
    assert.equal((images.db.prepare('SELECT COUNT(*) AS n FROM media_metadata').get() as { n: number }).n, 1)
    const files = images.db.prepare('SELECT original_file_path FROM image_files WHERE composite_hash = ?').all(hash) as Array<{ original_file_path: string }>
    assert.equal(files.length, 1)
    originalPath = files[0].original_file_path
    assert.equal(fs.readdirSync(path.dirname(originalPath)).length, 1)
    const group = GroupPathService.resolveOrCreate(assets.chatCharacterGroupPath(first.name))
    assert.ok(images.db.prepare('SELECT 1 FROM image_groups WHERE group_id = ? AND composite_hash = ?').get(group.groupId, hash))
    const response = await call('/profiles')
    const publicProfile = response.body.data.find((profile: any) => profile.id === first.id)
    assert.equal(Object.hasOwn(publicProfile, 'avatar'), false)
    assert.equal((await call('/admin/profiles')).body.data.find((profile: any) => profile.id === first.id).avatar, dataUrl)
    assert.equal(publicProfile.avatarHash, hash)
    assert.equal(publicProfile.appearance, first.appearance)
    assert.ok(publicProfile.assetVersion.includes(hash.slice(0, 8)))
    assert.equal(publicProfile.avatarThumbnailUrl, `/api/images/${hash}/thumbnail`)
  })

  await t.test('profile saves validate library image hashes/crops and old-editor changes invalidate migrated hashes', () => {
    assert.throws(() => ChatProfileStore.update(first.id, { referenceHash: 'f'.repeat(48) }), /찾을 수 없어/)
    assert.throws(() => ChatProfileStore.update(first.id, { referenceHash: 'g'.repeat(48) }), /해시/)
    assert.throws(() => ChatProfileStore.update(first.id, { referenceHash: 'f'.repeat(64) }), /해시/)
    assert.throws(() => ChatProfileStore.update(first.id, { avatarCrop: { x: 0, y: 0, scale: 0 } }), /자르기/)
    const crop = { x: 0.2, y: -0.1, scale: 1.5 }
    assert.deepEqual(ChatProfileStore.update(first.id, { referenceHash: hash, avatarCrop: crop })!.avatarCrop, crop)
    assert.equal(ChatProfileStore.update(second.id, { avatar: null })!.avatarHash, null)
    const legacyEditor = ChatProfileStore.create({ name: '기존 편집기', engine: 'codex', avatar: dataUrl, avatarHash: hash, background: dataUrl, backgroundHash: hash })
    const changed = ChatProfileStore.update(legacyEditor.id, { avatar: null, avatarHash: hash, background: null, backgroundHash: hash })!
    assert.equal(changed.avatarHash, null)
    assert.equal(changed.backgroundHash, null)
  })

  await t.test('simultaneous imports of new matching pixels create one image/file and both group links', async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#48bc79' } }).png().toBuffer()
    const webp = await sharp(png).webp({ lossless: true }).toBuffer()
    const [a, b] = await Promise.all([assets.ingestProfileAsset(png, '동시 입력 A'), assets.ingestProfileAsset(webp, '동시 입력 B')])
    assert.equal(a.compositeHash, b.compositeHash)
    assert.equal((images.db.prepare('SELECT COUNT(*) AS n FROM media_metadata WHERE composite_hash = ?').get(a.compositeHash) as { n: number }).n, 1)
    assert.equal((images.db.prepare('SELECT COUNT(*) AS n FROM image_files WHERE composite_hash = ?').get(a.compositeHash) as { n: number }).n, 1)
    for (const name of ['동시 입력 A', '동시 입력 B']) assert.ok(images.db.prepare('SELECT 1 FROM image_groups WHERE group_id = ? AND composite_hash = ?').get(GroupPathService.resolveOrCreate(assets.chatCharacterGroupPath(name)).groupId, a.compositeHash))
  })

  await t.test('asset routes serve only profile references, including pending originals and missing-file fallback', async () => {
    images.db.prepare("UPDATE media_metadata SET postprocess_status = 'pending' WHERE composite_hash = ?").run(hash)
    const read = await call('/profiles/:profileId/assets/:kind', { profileId: String(first.id), kind: 'reference' })
    assert.equal(read.status, 200)
    assert.deepEqual(read.body, png)
    assert.equal((await call('/profiles/:profileId/assets/:kind', { profileId: String(second.id), kind: 'reference' })).status, 404)
    assert.equal((await call('/profiles/:profileId/assets/:kind', { profileId: String(first.id), kind: hash })).status, 404)
    assert.equal((await call('/profiles/:profileId/assets/:kind', { profileId: '999999', kind: 'avatar' })).status, 404)
    await fs.promises.unlink(originalPath)
    assert.deepEqual((await call('/profiles/:profileId/assets/:kind', { profileId: String(first.id), kind: 'avatar' })).body, png)
    assert.deepEqual((await call('/profiles/:profileId/background', { profileId: String(first.id) })).body, png)
    assert.equal((await call('/profiles/:profileId/assets/:kind', { profileId: String(first.id), kind: 'reference' })).status, 404)
    await fs.promises.writeFile(originalPath, png)
  })

  await t.test('safety hides originals, legacy background route, thumbnails and public data URL fallback; images.view is required', async (sub) => {
    const tier = RatingScoreModel.createTier({ tier_name: '테스트 숨김', min_score: 10000, max_score: null, tier_order: -100, color: '#000000', feed_visibility: 'hide' })
    images.db.prepare('UPDATE media_metadata SET rating_score = 10001 WHERE composite_hash = ?').run(hash)
    const hidden = await call('/profiles/:profileId/assets/:kind', { profileId: String(first.id), kind: 'avatar' })
    assert.equal(hidden.status, 403)
    assert.equal(hidden.body.code, 'hidden_by_safety_policy')
    assert.equal((await call('/profiles/:profileId/background', { profileId: String(first.id) })).status, 403)
    const profile = (await call('/profiles')).body.data.find((profile: any) => profile.id === first.id)
    assert.equal(Object.hasOwn(profile, 'avatar'), false)
    assert.equal(profile.avatarThumbnailUrl, null)
    images.db.prepare('UPDATE media_metadata SET rating_score = NULL WHERE composite_hash = ?').run(hash)
    RatingScoreModel.deleteTier(tier.id)
    const bootstrap = AuthAccessControlService.resolveBootstrapAccess()
    sub.mock.method(AuthAccessControlService, 'resolveBootstrapAccess', () => ({ ...bootstrap, permissionKeys: bootstrap.permissionKeys.filter((key) => key !== 'images.view') }))
    assert.equal((await call('/profiles/:profileId/assets/:kind', { profileId: String(first.id), kind: 'avatar' })).status, 403)
    assert.equal((await call('/profiles')).body.data.find((profile: any) => profile.id === first.id).avatarHash, null)
  })

  await t.test('multipart upload uses the library/group and returns a hash without mutating a profile; bad bytes are rejected', async () => {
    const boundary = 'conai-test-boundary'
    const multipart = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="characterName"\r\n\r\n업로드 캐릭터\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="avatar.png"\r\nContent-Type: image/png\r\n\r\n`), png, Buffer.from(`\r\n--${boundary}--\r\n`)])
    const response = await call('/admin/chat-assets/upload', {}, { method: 'post', multipart, headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': String(multipart.length) } })
    assert.equal(response.status, 200, JSON.stringify(response.body))
    assert.equal(response.body.data.compositeHash, hash)
    assert.ok(images.db.prepare('SELECT 1 FROM image_groups WHERE group_id = ? AND composite_hash = ?').get(GroupPathService.resolveOrCreate('채팅 캐릭터/업로드 캐릭터').groupId, hash))
    assert.equal(ChatProfileStore.find(first.id)!.avatarHash, hash)
    await assert.rejects(assets.ingestProfileAsset(Buffer.from('<html>not an image</html>'), first.name), /이미지/)
  })

  await t.test('URL protection and size/format limits work offline; cached URLs are not downloaded again', async (sub) => {
    for (const host of ['127.0.0.1', '10.0.0.1', '192.168.1.1', '::1', 'fc00::1', '::ffff:127.0.0.1', '0:0:0:0:0:ffff:7f00:1']) await assert.rejects(media.resolvePublicHost(host), /private address/)
    sub.mock.method(dns.promises, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }])
    await assert.rejects(media.resolvePublicHost('mixed.test'), /private address/)
    await assert.rejects(media.download('file:///avatar.png'), /unsupported protocol/)
    await assert.rejects(assets.downloadProfileAsset('http://127.0.0.1/a.png', first.name), /사설 주소/)
    await assert.rejects(assets.downloadProfileAsset('ftp://8.8.8.8/a.png', first.name), /http 또는 https/)
    let requests = 0
    let tooLarge = false
    let redirect = false
    let bytes = png
    // A response emitter exercises the real downloader, including declared-length limits, without opening a socket.
    sub.mock.method(https, 'get', (_url: unknown, _options: unknown, callback: (response: any) => void) => {
      requests += 1
      const request = Object.assign(new EventEmitter(), { destroy() {} })
      queueMicrotask(() => {
        const response = Object.assign(new EventEmitter(), { statusCode: redirect ? 302 : 200, headers: { ...(redirect ? { location: 'http://127.0.0.1/private.png' } : {}), 'content-length': tooLarge ? media.CHAT_MEDIA_MAX_BYTES + 1 : bytes.length }, resume() {}, destroy() {} })
        callback(response)
        if (!tooLarge) { response.emit('data', bytes); response.emit('end') }
      })
      return request
    })
    const url = 'https://8.8.8.8/avatar.png'
    const imported = await assets.downloadProfileAsset(url, 'URL 캐릭터')
    assert.equal(imported.compositeHash, hash)
    assert.equal((await assets.downloadProfileAsset(url, '다른 URL 캐릭터')).compositeHash, hash)
    assert.equal(requests, 1)
    assert.ok(db.prepare('SELECT 1 FROM chat_card_media WHERE source_url = ? AND composite_hash = ?').get(url, hash))
    redirect = true
    await assert.rejects(assets.downloadProfileAsset('https://8.8.8.8/redirect.png', first.name), /사설 주소/)
    redirect = false
    bytes = Buffer.from('<html>wrong</html>')
    await assert.rejects(assets.downloadProfileAsset('https://8.8.8.8/wrong.png', first.name), /이미지 형식/)
    tooLarge = true
    await assert.rejects(assets.downloadProfileAsset('https://8.8.8.8/large.png', first.name), /50MB/)
  })

  await t.test('file-store import only copies own images and retains the private original', async (sub) => {
    const { FileStoreService } = await import('../src/services/fileStoreService')
    const { storedFilePath } = await import('../src/services/fileStorePaths')
    sub.mock.method(AuthAccount, 'findById', (id: number) => ({ id, status: 'active', account_type: 'admin' }) as any)
    sub.mock.method(AuthAccessControlService, 'hasPermission', () => true)
    const staged = path.join(root, 'temp', 'private.png')
    fs.writeFileSync(staged, png)
    const file = FileStoreService.upload('account:1', null, [{ path: staged, originalname: 'private.png', mimetype: 'image/png', size: png.length } as Express.Multer.File])[0]
    const requester = { accountId: 1, accountType: 'admin' as const }
    assert.equal((await assets.importFileStoreProfileAsset(requester, file.id, '파일 캐릭터')).compositeHash, hash)
    assert.deepEqual(fs.readFileSync(storedFilePath('account:1', file.id)), png)
    await assert.rejects(assets.importFileStoreProfileAsset({ ...requester, accountId: 2 }, file.id, first.name), /찾을 수 없어/)
    const text = FileStoreService.writeText('account:1', null, 'memo.txt', 'text only')
    await assert.rejects(assets.importFileStoreProfileAsset(requester, text.id, first.name), /이미지 파일만/)
  })

  await t.test('card PNG remains byte-exact with chara/ccv3 chunks, even with matching pixels already in the library', async () => {
    const { PngExtractor } = await import('../src/services/metadata/extractors/pngExtractor')
    const { importChatCard } = await import('../src/services/codex-chat/chatCardImport')
    const { crc32 } = await import('node:zlib')
    const encoded = Buffer.from(JSON.stringify({ spec: 'chara_card_v3', data: { name: '원본 카드', first_mes: '안녕' } })).toString('base64')
    const chunk = (key: string) => {
      const data = Buffer.from(`${key}\0${encoded}`)
      const header = Buffer.alloc(8)
      header.writeUInt32BE(data.length)
      header.write('tEXt', 4)
      const checksum = Buffer.alloc(4)
      checksum.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), data])))
      return Buffer.concat([header, data, checksum])
    }
    const card = Buffer.concat([png.subarray(0, -12), chunk('chara'), chunk('ccv3'), png.subarray(-12)])
    const imported = await importChatCard(card, 'test')
    assert.equal(imported.avatarHash, hash)
    assert.equal(imported.referenceHash, hash)
    assert.match(imported.avatar!, /^data:image\/webp;base64,/)
    const files = images.db.prepare('SELECT original_file_path FROM image_files WHERE composite_hash = ?').all(hash) as Array<{ original_file_path: string }>
    const copy = files.map((file) => fs.readFileSync(file.original_file_path)).find((buffer) => buffer.equals(card))!
    assert.ok(copy)
    assert.deepEqual({ ...PngExtractor.extractTextChunks(copy, ['chara', 'ccv3']) }, { chara: encoded, ccv3: encoded })
    const count = files.length
    await importChatCard(card, 'test')
    assert.equal((images.db.prepare('SELECT COUNT(*) AS n FROM image_files WHERE composite_hash = ?').get(hash) as { n: number }).n, count)
    assert.ok(images.db.prepare('SELECT 1 FROM image_groups WHERE group_id = ? AND composite_hash = ?').get(GroupPathService.resolveOrCreate('채팅 카드/원본 카드').groupId, hash))
  })

  await t.test('gallery usage includes every profile asset hash', () => {
    const usages = media.chatMediaUsage([hash])
    assert.ok(usages.profiles.includes(first.name))
    assert.equal(usages.profiles.filter((name) => name === first.name).length, 1)
    for (const kind of ['avatarHash', 'backgroundHash', 'referenceHash'] as const) {
      const profile = ChatProfileStore.create({ name: kind, engine: 'codex', [kind]: hash })
      assert.ok(media.chatMediaUsage([hash]).profiles.includes(profile.name))
    }
  })

  await t.test('preset reference designation controls NAI replace/append and ComfyUI hash injection without generation', async () => {
    const { ChatGenerationPresetStore, normalizeComfyPresetConfig } = await import('../src/services/codex-chat/chatGenerationPresets')
    const { buildChatGenerationPresetJob, CHAT_NAI_REFERENCE_MAX_BYTES, CHAT_NAI_PAYLOAD_MAX_BYTES } = await import('../src/mcp/tools/chatGenerationTools')
    const { prepareComfyPromptData } = await import('../src/services/prepareComfyPromptData')
    const { validateMcpToolArguments } = await import('../src/mcp/requestSecurity')
    const { buildChatPromptPreview } = await import('../src/services/codex-chat/llmChatContext')
    const { WorkflowModel } = await import('../src/models/Workflow')
    const profile = ChatProfileStore.find(first.id)!
    const existing = { image: dataUrl, type: 'style', strength: 0.8, fidelity: 0.5 }
    const preset = ChatGenerationPresetStore.create({ name: 'NAI 테스트', kind: 'nai', nai: { characterRefs: [existing] } })
    const unchanged = await buildChatGenerationPresetJob(preset, { prompt: 'smile' }, profile)
    assert.deepEqual(unchanged, await buildChatGenerationPresetJob(preset, { prompt: 'smile' }))
    assert.equal(unchanged.request_payload!.n_samples, 1)
    for (const mode of ['replace', 'append'] as const) {
      const configured = ChatGenerationPresetStore.update(preset.id, { nai: { ...preset.nai, characterReference: mode } })!
      const job = await buildChatGenerationPresetJob(configured, { prompt: 'smile' }, profile)
      const refs = job.request_payload!.character_refs as Array<{ image: string; type: string }>
      assert.equal(refs.length, mode === 'append' ? 2 : 1)
      assert.equal(refs.at(-1)!.image, dataUrl)
      assert.equal(refs.at(-1)!.type, 'character')
      assert.equal(job.request_payload!.n_samples, 1)
      let requiresImagePermission = 0
      validateMcpToolArguments(job, () => { requiresImagePermission += 1 })
      assert.ok(requiresImagePermission > 0)
    }
    const configured = ChatGenerationPresetStore.find(preset.id)!
    const large = Buffer.alloc(CHAT_NAI_REFERENCE_MAX_BYTES + 1)
    fs.writeFileSync(originalPath, large)
    await assert.rejects(buildChatGenerationPresetJob(configured, { prompt: 'smile' }, profile), /4MB/)
    fs.writeFileSync(originalPath, png)
    const bloated = { ...configured, nai: { ...configured.nai!, vibes: [{ encoded: 'a'.repeat(CHAT_NAI_PAYLOAD_MAX_BYTES), strength: 1, information_extracted: 1 }] } }
    await assert.rejects(buildChatGenerationPresetJob(bloated, { prompt: 'smile' }, profile), /8MB/)
    const other = await assets.ingestProfileAsset(await sharp({ create: { width: 8, height: 8, channels: 3, background: '#446699' } }).png().toBuffer(), first.name)
    const changedProfile = ChatProfileStore.update(first.id, { referenceHash: other.compositeHash })!
    assert.notDeepEqual((await buildChatGenerationPresetJob(configured, { prompt: 'smile' }, changedProfile)).request_payload!.character_refs, (await buildChatGenerationPresetJob(configured, { prompt: 'smile' }, profile)).request_payload!.character_refs)
    const fields = [{ id: 'reference', label: 'Reference', jsonPath: '1.inputs.image', type: 'image' as const, required: true }, { id: 'prompt', label: 'Prompt', jsonPath: '2.inputs.text', type: 'text' as const }]
    const workflowId = WorkflowModel.create({ name: '기준 이미지 테스트', workflow_json: '{}', marked_fields: fields })
    assert.throws(() => normalizeComfyPresetConfig({ workflowId, referenceField: 'prompt', exposedFieldIds: ['prompt'] }), /이미지 필드/)
    const comfy = ChatGenerationPresetStore.create({ name: 'Comfy 테스트', kind: 'comfyui', comfyui: { workflowId, exposedFieldIds: ['reference', 'prompt'], referenceField: 'reference', fixedInputs: {} } })
    const job = await buildChatGenerationPresetJob(comfy, { prompt: 'smile', reference: 'untrusted replacement' }, profile)
    assert.deepEqual(job.inputs, { prompt: 'smile', reference: { composite_hash: hash } })
    let uploaded: unknown = null
    await prepareComfyPromptData({ async uploadInputImage(_name: string, input: unknown) { uploaded = input; return 'library-input.png' } } as any, fields, job.inputs!)
    assert.equal((uploaded as fs.ReadStream).path, (await import('../src/services/imageUploadService')).ImageUploadService.getActiveFilePath(hash))
    assert.ok(!JSON.stringify(buildChatPromptPreview(profile, [])).includes(profile.appearance))
  })

  await t.test('NAI queue size limit includes the stored authorization snapshot and never dispatches an oversized job', async () => {
    const { ChatGenerationPresetStore } = await import('../src/services/codex-chat/chatGenerationPresets')
    const { buildChatGenerationPresetJob, CHAT_NAI_PAYLOAD_MAX_BYTES } = await import('../src/mcp/tools/chatGenerationTools')
    const { enqueueMcpGenerationJob } = await import('../src/mcp/tools/generationJobTools')
    const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
    const { registerChatReply } = await import('../src/services/codex-chat/chatReplyRegistry')
    const preset = ChatGenerationPresetStore.create({ name: '큐 크기 상한', kind: 'nai', nai: { characterReference: 'replace', vibes: [{ encoded: 'a'.repeat(4 * 1024 * 1024 + 1024), strength: 1, information_extracted: 1 }] } })
    const profile = ChatProfileStore.create({ name: '크기 상한 프로필', engine: 'llm', providerName: 'test', referenceHash: hash, mcpEnabled: true, mcpScopes: ['generate'], generationPresetIds: [preset.id] })
    const threadId = CodexChatStore.createThread(null, '크기 상한', 'llm', profile.id)
    const chatContext = { kind: 'direct' as const, threadId, profileId: profile.id, replyId: 'bounded-reference' }
    const unregister = registerChatReply(chatContext, new AbortController().signal, () => ({ replyId: chatContext.replyId, replyTo: null, recipients: [] }))
    try {
      const input = await buildChatGenerationPresetJob(preset, { prompt: 'smile' }, profile)
      assert.ok(Buffer.byteLength(JSON.stringify(input.request_payload)) < CHAT_NAI_PAYLOAD_MAX_BYTES)
      await assert.rejects(enqueueMcpGenerationJob({ scopes: ['generate'], requester: { accountId: null, accountType: 'admin' }, source: 'llm-chat', generationPresetIds: [preset.id], generationPresetSnapshot: JSON.stringify(ChatGenerationPresetStore.resolve([preset.id])), chatContext }, input, 'generate_image', { maxPayloadBytes: CHAT_NAI_PAYLOAD_MAX_BYTES }), /8MB/)
      assert.equal((db.prepare('SELECT COUNT(*) AS n FROM generation_queue_jobs').get() as { n: number }).n, 0)
    } finally { unregister() }
  })
})
