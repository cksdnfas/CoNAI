import './support/testTemp'
import { scratchDir } from './support/scratchRuntime'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import sharp from 'sharp'

test('art styles: own file-store copies, CRUD, conflicts, search and badges, bundle round trip, legacy rows, permission gates', { timeout: 90000 }, async (t) => {
  const settings = await import('../src/database/userSettingsDb')
  settings.initializeUserSettingsDb()
  ;(await import('../src/database/apiGenerationDb')).initializeApiGenerationDb()
  const auth = await import('../src/database/authDb')
  auth.initializeAuthDb()
  const imagesDb = await import('../src/database/init')
  await imagesDb.initializeDatabase()
  const styles = await import('../src/services/artStyles')
  const { ingestMedia, activeMediaFile, chatMediaUsage } = await import('../src/services/codex-chat/chatCardAssets')
  const { FileStoreService } = await import('../src/services/fileStoreService')
  const { storeWorkflowInputAssetFile, resolveWorkflowInputAssetPath } = await import('../src/services/workflowInputAssetStore')
  const { writeZip } = await import('../src/utils/zipArchive')
  const { BackgroundQueueService } = await import('../src/services/backgroundQueue')
  const { MediaPostprocessCoordinator } = await import('../src/services/background-media/mediaPostprocessCoordinator')
  const { skippedStage } = await import('../src/services/background-media/mediaProcessingTypes')
  const { settingsService } = await import('../src/services/settingsService')
  const { AuthAccessControlService } = await import('../src/services/authAccessControlService')
  const router = (await import('../src/routes/art-styles.routes')).default
  t.mock.method(BackgroundQueueService, 'addMetadataExtractionTask', () => {})
  t.mock.method(MediaPostprocessCoordinator, 'triggerAutoTagProcessing', () => skippedStage('auto-tag', 'test'))
  const baseSettings = settingsService.loadSettings()
  t.mock.method(settingsService, 'loadSettings', () => ({ ...baseSettings, tagger: { ...baseSettings.tagger, enabled: false } }))
  t.after(async () => {
    settings.closeUserSettingsDb()
    auth.getAuthDb().close()
    imagesDb.closeDatabase()
    const { logger } = await import('../src/utils/logger')
    await new Promise<void>((resolve) => logger.close(resolve))
  })
  const db = settings.getUserSettingsDb()
  async function call(routePath: string, method: string, params: Record<string, string> = {}, body?: unknown, query: Record<string, string> = {}) {
    const route = router.stack.find((layer: any) => layer.route?.path === routePath && layer.route.methods[method])?.route as any
    assert.ok(route, routePath)
    return new Promise<{ status: number; body: any }>((resolve, reject) => {
      let status = 200, index = 0
      const req = { params, body, query, method: method.toUpperCase(), session: {}, socket: { remoteAddress: '127.0.0.1' }, headers: {} }
      const res = { status(code: number) { status = code; return this }, json(body: unknown) { resolve({ status, body }); return this }, setHeader() {} }
      const next = (error?: unknown) => {
        if (error) { reject(error); return }
        try { Promise.resolve(route.stack[index++].handle(req, res, next)).catch(reject) } catch (error) { reject(error) }
      }
      next()
    })
  }
  const withoutPermission = (context: { mock: typeof t.mock }, key: string) => {
    const access = AuthAccessControlService.resolveBootstrapAccess()
    context.mock.method(AuthAccessControlService, 'resolveBootstrapAccess', () => ({ ...access, permissionKeys: access.permissionKeys.filter((permission) => permission !== key) }))
  }
  const conflict = (code: string, revision?: number) => (error: unknown) =>
    error instanceof styles.ArtStyleError && error.status === 409 && error.code === code && (revision === undefined || error.revision === revision)
  const png = (background: string, size = 16) => sharp({ create: { width: size, height: size, channels: 3, background } }).png().toBuffer()
  const image = async (background: string) => (await ingestMedia(await png(background))).compositeHash
  /** A staged upload, as POST /api/workflow-input-assets leaves it. */
  const staged = async (background: string, fileName: string) => {
    const temp = path.join(scratchDir, `staged-${background.slice(1)}.png`)
    fs.writeFileSync(temp, await png(background, 24))
    return storeWorkflowInputAssetFile(temp, { fileName, mimeType: 'image/png', bytes: fs.statSync(temp).size })
  }
  const ids = (input: unknown) => styles.listArtStyles(input).items.map((item) => item.id)
  const imageIds = (styleId: number) => styles.getArtStyle(styleId).images.map((entry) => entry.id)
  const stored = (fileId: string) => { try { return FileStoreService.get('bootstrap', fileId) } catch { return null } }
  const fileBytes = (fileId: string) => fs.readFileSync(FileStoreService.resolveFile('bootstrap', fileId).filePath)
  const rootFolder = () => FileStoreService.findChild('bootstrap', null, styles.ART_STYLE_FILE_ROOT_FOLDER)
  const styleFolder = (title: string) => { const root = rootFolder(); return root ? FileStoreService.findChild('bootstrap', root.id, title) : null }

  const first = await image('#3a7bd5')
  const second = await image('#d53a7b')
  const upload = await staged('#7bd53a', 'sketch.png')

  const watercolor = await styles.createArtStyle({
    title: 'Watercolor', description: 'soft\nwash ', badges: ['Paint', 'paint', ' Soft '], keywords: ['pastel'],
    positive: 'watercolor, soft edges', negative: 'lineart', images: [{ composite_hash: first }, upload, { composite_hash: second }],
  })
  const ink = await styles.createArtStyle({ title: 'Ink Sketch', badges: ['Mono'], keywords: ['lineart'] })

  await t.test('create: library picks and a staged upload become the style\'s own copies, read back in order', () => {
    assert.equal(watercolor.description, 'soft wash')
    assert.deepEqual(watercolor.badges, ['Paint', 'Soft'])
    assert.equal(watercolor.images.length, 3)
    assert.deepEqual(watercolor.images.map((entry) => [entry.name, entry.mimeType, entry.width]), [
      [path.basename(activeMediaFile(first)!.path), 'image/png', 16], ['sketch.png', 'image/png', 24], [path.basename(activeMediaFile(second)!.path), 'image/png', 16],
    ])
    assert.equal(watercolor.coverImageId, watercolor.images[0].id)
    assert.equal(watercolor.imageCount, 3)
    assert.equal(watercolor.revision, 1)
    // Copies, byte for byte, in the style's folder; the library holds nothing new and the upload is consumed.
    assert.deepEqual(fileBytes(watercolor.images[0].id), fs.readFileSync(activeMediaFile(first)!.path))
    const folder = styleFolder('Watercolor')
    assert.ok(folder)
    for (const entry of watercolor.images) assert.equal(stored(entry.id)?.parentId, folder!.id)
    assert.ok(fs.existsSync(`${resolveWorkflowInputAssetPath(upload.id)}.deleted`), 'the staged upload is consumed')
    assert.deepEqual(chatMediaUsage([first]).profiles, [], 'the library image is not tied to the style')
    assert.equal(styles.listArtStyles({ query: 'Watercolor' }).items[0].coverImageId, watercolor.images[0].id)
    assert.deepEqual([ink.images, ink.coverImageId, ink.imageCount], [[], null, 0])
    assert.equal(styleFolder('Ink Sketch'), null, 'no folder until a first image')
  })

  await t.test('patch: keep, reorder and remove by { id }; removed copies are deleted; conflicts', async () => {
    const [a, b, c] = watercolor.images.map((entry) => entry.id)
    await assert.rejects(styles.createArtStyle({ title: 'WATERCOLOR' }), conflict('name_conflict'))
    await assert.rejects(styles.patchArtStyle(ink.id, { revision: ink.revision, title: 'watercolor' }), conflict('name_conflict'))
    await assert.rejects(styles.patchArtStyle(watercolor.id, { revision: watercolor.revision + 5, positive: 'x' }), conflict('revision_conflict', watercolor.revision))
    await assert.rejects(styles.patchArtStyle(watercolor.id, { revision: watercolor.revision, images: [{ composite_hash: 'not-an-image' }] }), styles.ArtStyleError)
    // An id is never taken for a hash (or the other way round), and another style's file is refused.
    await assert.rejects(styles.patchArtStyle(watercolor.id, { revision: watercolor.revision, images: [a] as never }), styles.ArtStyleError)
    await assert.rejects(styles.patchArtStyle(watercolor.id, { revision: watercolor.revision, images: [{ composite_hash: a }] }), /라이브러리에서 이미지를 찾을 수 없어/)
    await assert.rejects(styles.patchArtStyle(ink.id, { revision: ink.revision, images: [{ id: a }] }), /이 스타일에 없는 이미지야/)
    await assert.rejects(styles.patchArtStyle(watercolor.id, { revision: watercolor.revision, images: [{ id: a }, { id: a }] }), /두 번/)
    await assert.rejects(styles.createArtStyle({ title: 'Too many', badges: Array.from({ length: 13 }, (_, index) => `b${index}`) }), /배지/)
    const before = db.prepare('SELECT COUNT(*) n FROM stored_file_entries WHERE deleted_at IS NULL').get() as { n: number }
    const renamed = await styles.patchArtStyle(watercolor.id, { revision: watercolor.revision, title: 'Watercolor Wash', images: [{ id: c }, { id: a }], favorite: true })
    assert.equal(renamed.revision, watercolor.revision + 1)
    assert.deepEqual(renamed.images.map((entry) => entry.id), [c, a])
    assert.equal(renamed.coverImageId, c)
    assert.equal(renamed.positive, watercolor.positive)
    assert.ok(renamed.favorite)
    assert.equal(stored(b), null, 'a removed copy is deleted')
    assert.equal((db.prepare('SELECT COUNT(*) n FROM stored_file_entries WHERE deleted_at IS NULL').get() as { n: number }).n, before.n - 1)
    // The folder stays where it is on a rename (kept while the style exists).
    assert.equal(stored(c)?.parentId, styleFolder('Watercolor')!.id)
    assert.deepEqual(styles.getArtStyle(watercolor.id, false).images, [])
    assert.equal(styles.getArtStyle(watercolor.id, false).coverImageId, null)
    // A failed write (the title is taken) leaves no copy behind.
    const live = (db.prepare('SELECT COUNT(*) n FROM stored_file_entries WHERE deleted_at IS NULL').get() as { n: number }).n
    await assert.rejects(styles.patchArtStyle(ink.id, { revision: ink.revision, title: 'Watercolor Wash', images: [{ composite_hash: first }] }), conflict('name_conflict'))
    assert.equal((db.prepare('SELECT COUNT(*) n FROM stored_file_entries WHERE deleted_at IS NULL').get() as { n: number }).n, live)
  })

  await t.test('the library can change: deleting the original leaves the style\'s copy readable', () => {
    const style = styles.getArtStyle(watercolor.id)
    const original = activeMediaFile(first)!.path
    const copy = style.images.find((entry) => fileBytes(entry.id).equals(fs.readFileSync(original)))!
    imagesDb.db.prepare("UPDATE image_files SET file_status = 'deleted' WHERE composite_hash = ?").run(first)
    fs.rmSync(original, { force: true })
    assert.equal(activeMediaFile(first), null)
    assert.ok(styles.resolveArtStyleFile(watercolor.id, copy.id))
    assert.deepEqual(imageIds(watercolor.id), style.images.map((entry) => entry.id))
  })

  await t.test('the Files page cannot delete a style copy; one lost anyway is skipped on every read', async () => {
    const copy = await styles.createArtStyle({ title: 'Fragile', images: [{ composite_hash: second }, (await staged('#d5b43a', 'b.png'))] })
    const [gone, kept] = copy.images.map((entry) => entry.id)
    assert.throws(() => FileStoreService.delete('bootstrap', [gone]), /그림 스타일에서 쓰는 파일은 삭제할 수 없어/)
    assert.throws(() => FileStoreService.deleteTree('bootstrap', stored(gone)!.parentId!), /그림 스타일에서 쓰는 파일은 삭제할 수 없어/)
    assert.equal(FileStoreService.rename('bootstrap', kept, 'renamed.png').name, 'renamed.png', 'renaming stays allowed')
    // Lost outside the Files page (its row is gone from the store).
    db.prepare('UPDATE stored_file_entries SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?').run(gone)
    const read = styles.getArtStyle(copy.id)
    assert.deepEqual([read.images.map((entry) => entry.id), read.coverImageId, read.imageCount], [[kept], kept, 1])
    assert.equal(styles.listArtStyles({ query: 'Fragile' }).items[0].imageCount, 1)
    assert.equal(styles.resolveArtStyleFile(copy.id, gone), null)
    assert.equal((await call('/:styleId/files/:fileId', 'get', { styleId: String(copy.id), fileId: gone })).status, 404)
    // Saving what the screen shows drops the dead row too.
    const saved = await styles.patchArtStyle(copy.id, { revision: read.revision, images: [{ id: kept }] })
    assert.deepEqual(saved.images.map((entry) => entry.id), [kept])
    assert.equal((db.prepare('SELECT COUNT(*) n FROM art_style_files WHERE style_id = ?').get(copy.id) as { n: number }).n, 1)
    await styles.deleteArtStyle(copy.id)
  })

  await t.test('query terms, badge filters, favorite and badge counts', async () => {
    assert.deepEqual(ids({ query: 'paint pastel' }), [watercolor.id])
    assert.deepEqual(ids({ query: 'ink pastel' }), [])
    assert.deepEqual(ids({ query: 'LINEART' }), [ink.id])
    assert.deepEqual(ids({ query: 'wash' }), [watercolor.id])
    assert.deepEqual(ids({ badges: ['paint'] }), [watercolor.id])
    assert.deepEqual(ids({ badges: ['Paint', 'Mono'] }), [])
    assert.deepEqual(ids({ favorite: true }), [watercolor.id])
    assert.deepEqual(ids({ sort: 'created_asc' }), [watercolor.id, ink.id])
    assert.deepEqual(styles.artStyleBadges({}), [{ badge: 'Mono', count: 1 }, { badge: 'Paint', count: 1 }, { badge: 'Soft', count: 1 }])
    assert.deepEqual(styles.artStyleBadges({ query: 'lineart' }), [{ badge: 'Mono', count: 1 }])
    const page = styles.listArtStyles({ limit: 1 })
    assert.equal(page.total, 2)
    assert.ok(page.hasMore)
    assert.equal((await styles.bulkArtStyles({ action: 'favorite', ids: [watercolor.id, ink.id], favorite: true })).changed, 1)
    assert.deepEqual(ids({ favorite: true }).sort(), [watercolor.id, ink.id].sort())
  })

  await t.test('duplicate copies the images into the new style', async () => {
    const source = styles.getArtStyle(watercolor.id)
    await assert.rejects(styles.createArtStyle({ title: 'Copy', duplicateOf: watercolor.id, images: [] }), /함께 쓸 수 없어/)
    const copy = await styles.createArtStyle({ title: 'Watercolor Copy', duplicateOf: watercolor.id })
    assert.equal(copy.images.length, source.images.length)
    copy.images.forEach((entry, index) => {
      assert.notEqual(entry.id, source.images[index].id)
      assert.deepEqual(fileBytes(entry.id), fileBytes(source.images[index].id))
    })
    assert.deepEqual((await styles.createArtStyle({ title: 'Blind copy', duplicateOf: watercolor.id }, { owner: 'bootstrap', canViewImages: false })).imageCount, 0)
    await styles.bulkArtStyles({ action: 'delete', ids: [copy.id, ids({ query: 'Blind copy' })[0]] })
    for (const entry of copy.images) assert.equal(stored(entry.id), null)
    assert.ok(imageIds(watercolor.id).every((id) => stored(id)))
  })

  await t.test('delete removes the copies and the emptied folder; export → delete → import restores the images', async () => {
    const original = styles.getArtStyle(watercolor.id)
    const bundle = styles.exportArtStyles({ ids: [watercolor.id] }, true)
    assert.equal(bundle.files.length, original.images.length)
    assert.deepEqual(bundle.document.styles[0].images.map((entry) => entry.name), original.images.map((entry) => entry.name))
    assert.equal(styles.exportArtStyles({}, false).document.styles.every((style) => style.images.length === 0), true)
    const bundlePath = path.join(scratchDir, 'styles.zip')
    const bytes = original.images.map((entry) => fileBytes(entry.id))
    // The bundle's files are the style's copies: keep their bytes for the second bundle, made after the delete.
    const bundled = bundle.files.map((entry) => ({ name: entry.name, data: fs.readFileSync(entry.path) }))
    await writeZip(bundlePath, [{ name: styles.ART_STYLE_BUNDLE_DOCUMENT, data: Buffer.from(JSON.stringify(bundle.document)) }, ...bundled])

    await assert.rejects(styles.deleteArtStyle(watercolor.id, original.revision - 1), conflict('revision_conflict', original.revision))
    await styles.deleteArtStyle(watercolor.id, original.revision)
    assert.throws(() => styles.getArtStyle(watercolor.id), /찾을 수 없어/)
    for (const entry of original.images) assert.equal(stored(entry.id), null, 'copies go with the style')
    assert.equal(styleFolder('Watercolor'), null, 'the emptied folder goes too')
    assert.equal((db.prepare('SELECT COUNT(*) n FROM art_style_terms WHERE style_id = ?').get(watercolor.id) as any).n, 0)

    assert.deepEqual(await styles.importArtStyles({ bundlePath }), { created: 1, renamed: 0, importedImages: original.images.length, droppedImages: 0 })
    const restored = styles.getArtStyle(ids({ query: 'Watercolor Wash' })[0])
    assert.deepEqual(restored.images.map((entry) => entry.name), original.images.map((entry) => entry.name))
    assert.deepEqual(restored.images.map((entry) => fileBytes(entry.id)), bytes)
    assert.deepEqual([restored.description, restored.badges, restored.keywords, restored.positive, restored.negative, restored.favorite], [original.description, original.badges, original.keywords, original.positive, original.negative, original.favorite])
    assert.equal(stored(restored.images[0].id)?.parentId, styleFolder('Watercolor Wash')!.id)
    // Again: the title is taken, so it gets a number; a missing entry is dropped; without images.view no image comes.
    const broken = { ...bundle.document, styles: [{ ...bundle.document.styles[0], images: [...bundle.document.styles[0].images, { bundleFile: 'images/9/9.png', name: 'gone.png', mimeType: 'image/png' }] }] }
    await writeZip(bundlePath, [{ name: styles.ART_STYLE_BUNDLE_DOCUMENT, data: Buffer.from(JSON.stringify(broken)) }, ...bundled])
    assert.deepEqual(await styles.importArtStyles({ bundlePath }), { created: 1, renamed: 1, importedImages: original.images.length, droppedImages: 1 })
    assert.equal((await styles.importArtStyles({ bundlePath }, { owner: 'bootstrap', canViewImages: false })).droppedImages, original.images.length + 1)
    assert.deepEqual(styles.getArtStyle(ids({ query: 'Watercolor Wash (3)' })[0]).images, [])
    await assert.rejects(styles.importArtStyles({ bundlePath: activeMediaFile(second)!.path }), /그림 스타일 묶음/)
    const copies = ids({ query: 'Watercolor Wash (' })
    assert.equal((await styles.bulkArtStyles({ action: 'delete', ids: copies })).changed, copies.length)
  })

  await t.test('legacy rows: library hashes in the old column are copied once, then the column is emptied', async () => {
    const legacyImage = await image('#5ad53a')
    const video = 'b'.repeat(32)
    const legacyId = Number(db.prepare('INSERT INTO art_styles(title, images, asset_group_id) VALUES (?, ?, 7)').run('Legacy', JSON.stringify([legacyImage, 'f'.repeat(48), video, legacyImage])).lastInsertRowid)
    const emptyId = Number(db.prepare('INSERT INTO art_styles(title, images) VALUES (?, ?)').run('Legacy gone', JSON.stringify(['e'.repeat(48)])).lastInsertRowid)
    assert.deepEqual(await styles.convertLegacyArtStyleImages(), { converted: 2, failed: 0 })
    const legacy = styles.getArtStyle(legacyId)
    assert.equal(legacy.images.length, 1)
    assert.deepEqual(fileBytes(legacy.images[0].id), fs.readFileSync(activeMediaFile(legacyImage)!.path))
    assert.equal(stored(legacy.images[0].id)?.parentId, styleFolder('Legacy')!.id)
    assert.deepEqual((db.prepare('SELECT images FROM art_styles WHERE id IN (?, ?) ORDER BY id').all(legacyId, emptyId) as Array<{ images: string }>).map((row) => row.images), ['[]', '[]'])
    assert.equal(styles.getArtStyle(emptyId).imageCount, 0)
    assert.deepEqual(await styles.convertLegacyArtStyleImages(), { converted: 0, failed: 0 }, 'idempotent')
    assert.equal(styles.getArtStyle(legacyId).images.length, 1)
    await styles.bulkArtStyles({ action: 'delete', ids: [legacyId, emptyId] })
  })

  await t.test('legacy rows not converted yet: an image save converts first and refuses the stale draft; a duplicate converts its source', async () => {
    const legacyImage = await image('#3a5ad5')
    const pendingId = Number(db.prepare('INSERT INTO art_styles(title, images) VALUES (?, ?)').run('Legacy pending', JSON.stringify([legacyImage])).lastInsertRowid)
    const read = styles.getArtStyle(pendingId)
    assert.equal(read.images.length, 0, 'unconverted hashes are not images yet')
    // A draft read before conversion would otherwise drop the old images silently.
    await assert.rejects(styles.patchArtStyle(pendingId, { images: [{ composite_hash: second }], revision: read.revision }), (error: any) => error.status === 409 && error.code === 'revision_conflict')
    const converted = styles.getArtStyle(pendingId)
    assert.equal(converted.revision, read.revision + 1)
    assert.equal(converted.images.length, 1)
    assert.deepEqual(fileBytes(converted.images[0].id), fs.readFileSync(activeMediaFile(legacyImage)!.path))
    const saved = await styles.patchArtStyle(pendingId, { images: [{ id: converted.images[0].id }, { composite_hash: second }], revision: converted.revision })
    assert.equal(saved.images.length, 2)
    // A text-only save of an unconverted style leaves the old list for the conversion.
    const otherId = Number(db.prepare('INSERT INTO art_styles(title, images) VALUES (?, ?)').run('Legacy text', JSON.stringify([legacyImage])).lastInsertRowid)
    await styles.patchArtStyle(otherId, { description: 'kept', revision: styles.getArtStyle(otherId).revision })
    assert.equal((db.prepare('SELECT images FROM art_styles WHERE id = ?').get(otherId) as { images: string }).images, JSON.stringify([legacyImage]))
    const copy = await styles.createArtStyle({ title: 'Legacy text copy', duplicateOf: otherId })
    assert.equal(copy.images.length, 1, 'the duplicate carries the converted image')
    assert.equal(styles.getArtStyle(otherId).images.length, 1)
    await styles.bulkArtStyles({ action: 'delete', ids: [pendingId, otherId, copy.id] })
  })

  await t.test('REST: envelope, gates, the files route serves only the style\'s own files', async (sub) => {
    const created = await call('/', 'post', {}, { title: 'Pixel', images: [{ composite_hash: second }] })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    const pixel = created.body.data
    assert.equal(pixel.coverImageId, pixel.images[0].id)
    const taken = await call('/', 'post', {}, { title: 'pixel' })
    assert.deepEqual([taken.status, taken.body.success, taken.body.code], [409, false, 'name_conflict'])
    const stale = await call('/:styleId', 'patch', { styleId: String(pixel.id) }, { revision: 99, title: 'x' })
    assert.deepEqual([stale.status, stale.body.code, stale.body.revision], [409, 'revision_conflict', pixel.revision])
    const listed = await call('/', 'get', {}, undefined, { query: 'pix', badges: '[]', sort: 'name' })
    assert.deepEqual(listed.body.data.items.map((item: any) => item.title), ['Pixel'])
    assert.equal((await call('/:styleId', 'get', { styleId: 'abc' })).status, 400)
    assert.equal((await call('/:styleId', 'get', { styleId: '999999' })).status, 404)
    // A REST file-store pick: a copy of a stored image file the requester may read.
    const loose = FileStoreService.upload('bootstrap', null, [{ path: await (async () => { const p = path.join(scratchDir, 'loose.png'); fs.writeFileSync(p, await png('#123456')); return p })(), originalname: 'loose.png', mimetype: 'image/png', size: 100 } as Express.Multer.File], false)[0]
    const picked = await call('/:styleId', 'patch', { styleId: String(pixel.id) }, { revision: pixel.revision, images: [{ id: pixel.images[0].id }, { file_id: loose.id }] })
    assert.equal(picked.status, 200, JSON.stringify(picked.body))
    assert.equal(picked.body.data.images.length, 2)
    assert.notEqual(picked.body.data.images[1].id, loose.id)
    assert.ok(stored(loose.id), 'the picked file stays where it was')
    // Files: wrong ids are 400, a file the style does not hold is 404 (another style's, a loose one).
    const other = styles.getArtStyle(ids({ query: 'Watercolor Wash' })[0])
    for (const fileId of [other.images[0].id, loose.id]) {
      assert.equal((await call('/:styleId/files/:fileId', 'get', { styleId: String(pixel.id), fileId })).status, 404)
      assert.equal((await call('/:styleId/files/:fileId/thumbnail', 'get', { styleId: String(pixel.id), fileId })).status, 404)
    }
    assert.equal((await call('/:styleId/files/:fileId', 'get', { styleId: String(pixel.id), fileId: 'nope' })).status, 400)

    await sub.test('without images.view', async (inner) => {
      withoutPermission(inner, 'images.view')
      const read = await call('/:styleId', 'get', { styleId: String(pixel.id) })
      assert.deepEqual([read.status, read.body.data.images, read.body.data.coverImageId, read.body.data.imageCount], [200, [], null, 2])
      assert.equal((await call('/', 'get')).body.data.items.find((item: any) => item.title === 'Pixel').coverImageId, null)
      assert.equal((await call('/', 'post', {}, { title: 'Hidden', images: [] })).status, 403)
      assert.equal((await call('/:styleId/files/:fileId', 'get', { styleId: String(pixel.id), fileId: pixel.images[0].id })).status, 403)
      const patched = await call('/:styleId', 'patch', { styleId: String(pixel.id) }, { revision: picked.body.data.revision, positive: 'pixel art' })
      assert.equal(patched.status, 200)
      assert.equal(styles.getArtStyle(pixel.id).images.length, 2)
    })
    await sub.test('without characters.edit', async (inner) => {
      withoutPermission(inner, 'characters.edit')
      const styleId = String(pixel.id)
      for (const [routePath, method, params] of [['/', 'post', {}], ['/:styleId', 'patch', { styleId }], ['/:styleId', 'delete', { styleId }], ['/bulk', 'post', {}], ['/import', 'post', {}]] as const) {
        const response = await call(routePath, method, params, { title: 'Nope', revision: 1, ids: [1], action: 'delete' })
        assert.equal(response.status, 403, `${method} ${routePath}`)
      }
      assert.equal((await call('/', 'get')).status, 200)
      assert.ok(styles.getArtStyle(pixel.id))
    })
    await sub.test('without characters.view', async (inner) => {
      withoutPermission(inner, 'characters.view')
      for (const [routePath, method] of [['/', 'get'], ['/badges', 'get'], ['/:styleId', 'get'], ['/export', 'post'], ['/:styleId/files/:fileId', 'get']] as const) {
        assert.equal((await call(routePath, method, { styleId: String(pixel.id), fileId: pixel.images[0].id }, {})).status, 403, `${method} ${routePath}`)
      }
    })
    const removed = await call('/:styleId', 'delete', { styleId: String(pixel.id) })
    assert.equal(removed.status, 200)
    for (const entry of picked.body.data.images) assert.equal(stored(entry.id), null)
  })

  await t.test('chat tools: list fields, reads with images, proposals saved only through the REST write, permission gates', async (sub) => {
    const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
    const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
    const { ChatProposalStore } = await import('../src/services/codex-chat/chatProposals')
    const { registerChatReply } = await import('../src/services/codex-chat/chatReplyRegistry')
    const { openChatMcpBridge } = await import('../src/services/codex-chat/chatMcpBridge')
    const proposalsRouter = (await import('../src/routes/chat-proposals.routes')).default
    ;(await import('../src/services/codex-chat/chatSettings')).updateChatSettings({ enabled: true })
    ;(await import('../src/models/ExternalApiProvider')).ExternalApiProvider.create({ provider_name: 'style-test', display_name: 'Style test', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
    const profile = ChatProfileStore.create({ name: 'Style assistant', engine: 'llm', providerName: 'style-test', mcpEnabled: true, mcpScopes: ['read', 'organize'], visionEnabled: true })
    const blind = ChatProfileStore.create({ name: 'Blind assistant', engine: 'llm', providerName: 'style-test', mcpEnabled: true, mcpScopes: ['read', 'organize'], visionEnabled: false })
    const threadId = CodexChatStore.createThread(null, 'styles', 'llm', profile.id)
    const blindThread = CodexChatStore.createThread(null, 'styles blind', 'llm', blind.id)
    const context = { threadId, profileId: profile.id, kind: 'direct' as const, replyId: 'style-proposals' }
    const requester = { accountId: null, accountType: 'admin' as const }
    const closeReply = registerChatReply(context, new AbortController().signal, () => ({ replyTo: null, recipients: ['user'] }))
    const open = () => openChatMcpBridge(requester, ['read', 'organize'], null, { chatContext: context })
    const data = (result: { content?: unknown[]; isError?: boolean }) => {
      assert.notEqual(result.isError, true, JSON.stringify(result))
      return JSON.parse(String((result.content?.[0] as { text?: string }).text))
    }
    /** A refused call: an error result, or a tool the bridge no longer offers. */
    const refused = async (bridge: Awaited<ReturnType<typeof open>>, tool: string, input: unknown) => {
      try { return (await bridge.call(tool, input as Record<string, unknown>)).isError === true } catch { return true }
    }
    const markSaved = (proposalId: number, savedId: number) => {
      const route = (proposalsRouter as any).stack.find((layer: any) => layer.route?.path === '/:proposalId/saved')?.route
      return new Promise<{ status: number; body: any }>((resolve, reject) => {
        let status = 200, index = 0
        const req = { params: { proposalId: String(proposalId) }, body: { savedId }, query: {}, method: 'POST', session: {}, socket: { remoteAddress: '127.0.0.1' }, headers: {} }
        const res = { status(code: number) { status = code; return this }, json(body: unknown) { resolve({ status, body }); return this } }
        const next = (error?: unknown) => {
          if (error) { reject(error); return }
          try { Promise.resolve(route.stack[index++].handle(req, res, next)).catch(reject) } catch (error) { reject(error) }
        }
        next()
      })
    }
    const third = await image('#a13ad5')
    const ocean = await styles.createArtStyle({ title: 'Ocean Glow', description: 'cool tones', badges: ['Light'], keywords: ['sea'], positive: 'ocean light', negative: 'blurry', images: [{ composite_hash: second }] })
    const [held] = ocean.images
    const bridge = await open()
    try {
      assert.ok(bridge.catalogTools.has('list_art_styles') && bridge.catalogTools.has('get_art_style'), 'catalogued, not direct')
      const listed = data(await bridge.call('list_art_styles', { query: 'glow sea', badges: ['Light'] }))
      assert.deepEqual(listed.items, [{ id: ocean.id, title: 'Ocean Glow', description: 'cool tones', badges: ['Light'], imageCount: 1 }])
      assert.deepEqual([listed.total, listed.hasMore], [1, false])
      const read = data(await bridge.call('get_art_style', { style_id: ocean.id }))
      assert.deepEqual(read, JSON.parse(JSON.stringify(styles.getArtStyle(ocean.id))))
      assert.deepEqual([read.positive, read.negative, read.images.map((entry: any) => entry.id), read.revision], ['ocean light', 'blurry', [held.id], ocean.revision])
      // Looking at the style's images: an image part per held id (through run_tool), a note for anything else.
      const viewed = await bridge.call('get_art_style', { style_id: ocean.id, view_ids: [held.id, 'c'.repeat(32)] })
      assert.notEqual(viewed.isError, true, JSON.stringify(viewed))
      const parts = viewed.content as Array<{ type: string; text?: string; mimeType?: string }>
      assert.deepEqual(JSON.parse(parts[0].text!).id, ocean.id)
      assert.deepEqual(parts.slice(1).map((part) => part.type), ['text', 'image', 'text'])
      assert.equal(parts[1].text, `image ${held.id}:`)
      assert.match(parts[3].text!, /not an image of this style/)

      // An update card holds the checked input; nothing changes until the card's REST write.
      const update = data(await bridge.call('propose_art_style', { action: 'save_style', style_id: ocean.id, revision: read.revision, input: { positive: 'ocean light, glow', badges: ['Light', 'light', 'Calm'], images: [{ composite_hash: third }, { id: held.id }] } }))
      const card = ChatProposalStore.find(update.proposalId)
      assert.ok(card?.kind === 'art_style' && card.action === 'save_style')
      assert.deepEqual([card.styleId, card.revision, card.title], [ocean.id, ocean.revision, 'Ocean Glow'])
      assert.deepEqual(card.input, { positive: 'ocean light, glow', badges: ['Light', 'Calm'], images: [{ composite_hash: third }, { id: held.id }] })
      assert.equal(styles.getArtStyle(ocean.id).positive, 'ocean light')
      assert.equal(styles.getArtStyle(ocean.id).images.length, 1, 'nothing copied by the proposal')
      const applied = await call('/:styleId', 'patch', { styleId: String(ocean.id) }, { ...card.input, revision: card.revision })
      assert.equal(applied.status, 200, JSON.stringify(applied.body))
      assert.equal(applied.body.data.positive, 'ocean light, glow')
      assert.deepEqual(applied.body.data.images.map((entry: any) => entry.id).slice(1), [held.id])
      assert.equal((await markSaved(card.id, ocean.id)).status, 200)
      assert.equal(ChatProposalStore.find(card.id)?.saved, true)

      // A create card: the title and images are checked when proposing and the card's POST creates it.
      assert.equal(await refused(bridge, 'propose_art_style', { action: 'save_style', input: { title: 'ocean glow' } }), true)
      assert.equal(await refused(bridge, 'propose_art_style', { action: 'save_style', input: { title: 'Bad image', images: [{ composite_hash: 'not-an-image' }] } }), true)
      assert.equal(await refused(bridge, 'propose_art_style', { action: 'save_style', input: { title: 'Bare hash', images: [third] } }), true)
      assert.equal(await refused(bridge, 'propose_art_style', { action: 'save_style', input: { title: 'Foreign id', images: [{ id: held.id }] } }), true)
      assert.equal(await refused(bridge, 'propose_art_style', { action: 'save_style', input: { title: 'Data', images: [{ data_url: 'data:image/png;base64,AA' }] } }), true)
      const create = ChatProposalStore.find(data(await bridge.call('propose_art_style', { action: 'save_style', input: { title: 'Dusk', positive: 'dusk sky', images: [{ composite_hash: third }] } })).proposalId)
      assert.ok(create?.kind === 'art_style' && create.action === 'save_style' && create.styleId === null)
      assert.equal(styles.listArtStyles({ query: 'Dusk' }).total, 0)
      const created = await call('/', 'post', {}, create.input)
      assert.equal(created.status, 201)
      assert.deepEqual([created.body.data.positive, created.body.data.imageCount], ['dusk sky', 1])

      // Stale: refused when proposing, and a card whose style changed afterwards is refused when applied.
      const latest = styles.getArtStyle(ocean.id)
      assert.equal(await refused(bridge, 'propose_art_style', { action: 'save_style', style_id: ocean.id, revision: latest.revision - 1, input: { positive: 'stale' } }), true)
      assert.equal(await refused(bridge, 'propose_art_style', { action: 'save_style', style_id: ocean.id, input: { positive: 'no revision' } }), true)
      const removal = ChatProposalStore.find(data(await bridge.call('propose_art_style', { action: 'delete_style', style_id: ocean.id, revision: latest.revision })).proposalId)
      assert.ok(removal?.kind === 'art_style' && removal.action === 'delete_style')
      await styles.patchArtStyle(ocean.id, { revision: latest.revision, description: 'changed meanwhile' })
      const stale = await call('/:styleId', 'delete', { styleId: String(ocean.id) }, undefined, { revision: String(removal.revision) })
      assert.deepEqual([stale.status, stale.body.code], [409, 'revision_conflict'])
      assert.equal(styles.getArtStyle(ocean.id).description, 'changed meanwhile')
    } finally { await bridge.close() }

    await sub.test('viewing needs images.view and a model that sees images, never files.view', async (inner) => {
      withoutPermission(inner, 'files.view')
      const gated = await open()
      try {
        const viewed = await gated.call('get_art_style', { style_id: ocean.id, view_ids: [held.id] })
        assert.ok((viewed.content as Array<{ type: string }>).some((part) => part.type === 'image'), JSON.stringify(viewed))
      } finally { await gated.close() }
      const blindContext = { threadId: blindThread, profileId: blind.id, kind: 'direct' as const, replyId: 'blind' }
      const closeBlind = registerChatReply(blindContext, new AbortController().signal, () => ({ replyTo: null, recipients: ['user'] }))
      const blindBridge = await openChatMcpBridge(requester, ['read', 'organize'], null, { chatContext: blindContext })
      try {
        const refusedView = await blindBridge.call('get_art_style', { style_id: ocean.id, view_ids: [held.id] })
        assert.equal(refusedView.isError, true)
        assert.match(JSON.stringify(refusedView.content), /Image viewing is off/)
        assert.equal(data(await blindBridge.call('get_art_style', { style_id: ocean.id })).id, ocean.id)
      } finally { await blindBridge.close(); closeBlind() }
    })
    await sub.test('without images.view: images hidden and image changes refused', async (inner) => {
      withoutPermission(inner, 'images.view')
      const gated = await open()
      try {
        const read = data(await gated.call('get_art_style', { style_id: ocean.id }))
        assert.deepEqual([read.images, read.coverImageId, read.imageCount], [[], null, 2])
        assert.equal((await gated.call('get_art_style', { style_id: ocean.id, view_ids: [held.id] })).isError, true)
        assert.equal(await refused(gated, 'propose_art_style', { action: 'save_style', style_id: ocean.id, revision: read.revision, input: { images: [] } }), true)
      } finally { await gated.close() }
    })
    await sub.test('without characters.edit: reads stay, proposals refused', async (inner) => {
      withoutPermission(inner, 'characters.edit')
      const gated = await open()
      try {
        assert.equal(data(await gated.call('list_art_styles', {})).total > 0, true)
        assert.equal(await refused(gated, 'propose_art_style', { action: 'save_style', input: { title: 'Not allowed' } }), true)
      } finally { await gated.close() }
    })
    await sub.test('without characters.view: nothing to read', async (inner) => {
      withoutPermission(inner, 'characters.view')
      const gated = await open()
      try {
        assert.equal(await refused(gated, 'list_art_styles', {}), true)
        assert.equal(await refused(gated, 'get_art_style', { style_id: ocean.id }), true)
      } finally { await gated.close() }
    })
    closeReply()
  })
})
