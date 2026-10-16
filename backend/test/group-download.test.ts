import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import AdmZip from 'adm-zip'

test('group downloads preserve membership, file contents and independent request lifetimes', { timeout: 60000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-group-download-'))
  process.env.RUNTIME_BASE_PATH = root
  for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
    process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
  }
  const auth = await import('../src/database/authDb')
  auth.initializeAuthDb()
  const main = await import('../src/database/init')
  await main.initializeDatabase()
  const user = await import('../src/database/userSettingsDb')
  user.initializeUserSettingsDb()
  ;(await import('../src/database/apiGenerationDb')).initializeApiGenerationDb()
  const { GroupDownloadService } = await import('../src/services/groupDownloadService')
  const { MediaMetadataModel } = await import('../src/models/Image/MediaMetadataModel')
  const { ImageSafetyService } = await import('../src/services/imageSafetyService')
  const { writeZip } = await import('../src/utils/zipArchive')
  const outputs = new Set<string>()
  t.after(async () => {
    await Promise.all([...outputs].map((file) => GroupDownloadService.cleanupTempFile(file)))
    user.closeUserSettingsDb()
    main.closeDatabase()
    auth.getAuthDb().close()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('conai-group-download-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const db = main.db
  const groupId = Number(db.prepare('INSERT INTO groups (name) VALUES (?)').run(`테스트 그룹 ${path.basename(root)}`).lastInsertRowid)
  const folder = Number((db.prepare('SELECT id FROM watched_folders LIMIT 1').get() as { id: number }).id)
  const hash = (n: number) => n.toString(16).padStart(48, '0')
  const source = (n: number, name: string) => path.join(root, 'uploads', String(n), name)
  const insert = db.prepare("INSERT INTO media_metadata (composite_hash, postprocess_status, prompt, auto_tags) VALUES (?, 'ready', ?, ?)")
  const file = db.prepare("INSERT INTO image_files (composite_hash, original_file_path, folder_id, file_status, file_size, mime_type) VALUES (?, ?, ?, 'active', 10, 'image/png')")
  const member = db.prepare('INSERT INTO image_groups (group_id, composite_hash, order_index) VALUES (?, ?, ?)')
  const names = ['a.png', 'a.png', 'a_001.png', 'a.jpg']
  db.transaction(() => {
    for (let n = 1; n <= 1005; n++) {
      insert.run(hash(n), `tag-${n}, extra`, JSON.stringify({ taglist: `tag-${n}` }))
      file.run(hash(n), source(n, names[n - 1] ?? 'missing.png'), folder)
      if (n <= 1004) member.run(groupId, hash(n), n)
    }
  })()
  for (let n = 1; n <= 4; n++) {
    fs.mkdirSync(path.dirname(source(n, names[n - 1])), { recursive: true })
    fs.writeFileSync(source(n, names[n - 1]), `image-${n}`)
  }
  const base = { groupId, groupType: 'custom' as const, downloadType: 'original' as const }
  const track = async (options: Parameters<typeof GroupDownloadService.createGroupZip>[0]) => {
    const result = await GroupDownloadService.createGroupZip(options)
    outputs.add(result.zipPath)
    return result
  }

  await t.test('selected exports fetch only selected member metadata and still apply visibility and readiness', async (t) => {
    const load = MediaMetadataModel.findByHashesWithFiles.bind(MediaMetadataModel)
    let loaded = 0
    t.mock.method(MediaMetadataModel, 'findByHashesWithFiles', (hashes: string[]) => { loaded += hashes.length; return load(hashes) })
    const result = await track({ ...base, compositeHashes: [hash(1), hash(2), hash(1005)] })
    assert.equal(result.fileCount, 2)
    assert.equal(loaded, 2, 'the 1004-member group loads only the two selected members')
    const zip = new AdmZip(result.zipPath)
    assert.deepEqual(zip.getEntries().map((entry) => entry.getData().toString()).sort(), ['image-1', 'image-2'])
    db.prepare("UPDATE media_metadata SET postprocess_status = 'pending' WHERE composite_hash = ?").run(hash(2))
    t.mock.method(ImageSafetyService, 'buildVisibleScoreCondition', (field: string) => `(${field} IS NULL OR ${field} < 90)`)
    db.prepare('UPDATE media_metadata SET rating_score = 99 WHERE composite_hash = ?').run(hash(3))
    const filtered = await track({ ...base, compositeHashes: [hash(1), hash(2), hash(3)] })
    assert.equal(filtered.fileCount, 1)
    db.prepare("UPDATE media_metadata SET postprocess_status = 'ready', rating_score = NULL").run()
    t.diagnostic('1004 group members, 2 selected members: 2 metadata records requested')
  })

  await t.test('concurrent requests keep separate ZIPs and cap active writers', async (t) => {
    let active = 0, maximum = 0
    const create = fs.createWriteStream.bind(fs)
    t.mock.method(fs, 'createWriteStream', (...args: Parameters<typeof fs.createWriteStream>) => {
      const stream = create(...args)
      active++
      maximum = Math.max(maximum, active)
      stream.once('close', () => { active-- })
      return stream
    })
    const results = await Promise.all(Array.from({ length: 5 }, (_, index) => track({ ...base, compositeHashes: [hash(index % 4 + 1)] })))
    assert.equal(new Set(results.map((result) => result.zipPath)).size, 5)
    assert.equal(new Set(results.map((result) => result.fileName)).size, 1)
    results.forEach((result, index) => assert.equal(new AdmZip(result.zipPath).getEntries()[0].getData().toString(), `image-${index % 4 + 1}`))
    assert.ok(maximum <= 2)
    assert.equal(active, 0)
  })

  await t.test('generated suffixes and captions never overwrite another image or caption', async () => {
    const result = await track({ ...base, compositeHashes: [1, 2, 3, 4].map(hash), captionOptions: { captionMode: 'merged' } })
    const zip = new AdmZip(result.zipPath)
    const entries = zip.getEntries()
    assert.equal(entries.length, 8)
    assert.equal(new Set(entries.map((entry) => entry.entryName.toLowerCase())).size, 8)
    for (const entry of entries.filter((entry) => !entry.entryName.endsWith('.txt'))) {
      const n = entry.getData().toString().replace('image-', '')
      assert.equal(zip.readAsText(entry.entryName.replace(/\.[^.]+$/, '.txt')), `tag-${n}, extra`)
    }
  })

  await t.test('file counts read metadata in bounded batches and check each path once', async (t) => {
    const load = MediaMetadataModel.findByHashesWithFiles.bind(MediaMetadataModel)
    const batches: number[] = []
    t.mock.method(MediaMetadataModel, 'findByHashesWithFiles', (hashes: string[]) => { batches.push(hashes.length); return load(hashes) })
    const stat = t.mock.method(fs.promises, 'stat')
    assert.deepEqual(await GroupDownloadService.getFileCountByType(groupId, 'custom'), { original: 4, thumbnail: 0, video: 0 })
    assert.deepEqual(batches, [500, 500, 4])
    assert.equal(stat.mock.callCount(), 1004, 'without thumbnails, each original is checked once, not once per download type')
  })

  await t.test('cancelled writes close handles and remove partial downloads', async (t) => {
    const controller = new AbortController()
    const create = fs.createWriteStream.bind(fs)
    let partial = ''
    t.mock.method(fs, 'createWriteStream', (...args: Parameters<typeof fs.createWriteStream>) => {
      partial = String(args[0])
      const stream = create(...args)
      stream.once('ready', () => controller.abort())
      return stream
    })
    await assert.rejects(GroupDownloadService.createGroupZip({ ...base, signal: controller.signal }), { name: 'AbortError' })
    assert.ok(partial)
    assert.equal(fs.existsSync(partial), false)
  })

  await t.test('streaming ZIP failure is reported instead of returning an incomplete archive', async () => {
    const archive = path.join(root, 'missing.zip')
    await assert.rejects(writeZip(archive, [{ name: 'missing.png', file: path.join(root, 'missing.png') }]), { code: 'ENOENT' })
    const controller = new AbortController()
    async function* entries() {
      yield { name: 'first.txt', data: Buffer.from('first') }
      controller.abort()
      yield { name: 'second.txt', data: Buffer.from('second') }
    }
    await assert.rejects(writeZip(path.join(root, 'cancel.zip'), entries(), controller.signal), { name: 'AbortError' })
  })

  await t.test('HTTP downloads support Unicode names and groups whose files live only in child folders', async (t) => {
    const express = (await import('express')).default
    const { groupReadRoutes } = await import('../src/routes/groups.read.routes')
    const { default: autoFolderRoutes } = await import('../src/routes/autoFolderGroups')
    const app = express()
    app.use((req, _res, next) => { Object.assign(req, { session: {} }); next() })
    app.use('/groups', groupReadRoutes)
    app.use('/folders', autoFolderRoutes)
    const server = http.createServer(app)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    const folderRow = db.prepare('INSERT INTO auto_folder_groups (folder_path, absolute_path, display_name, parent_id) VALUES (?, ?, ?, ?)')
    const parent = Number(folderRow.run('watch:parent', root, 'parent', null).lastInsertRowid)
    const child = Number(folderRow.run('watch:child', root, 'child', parent).lastInsertRowid)
    db.prepare('INSERT INTO auto_folder_group_images (group_id, composite_hash) VALUES (?, ?)').run(child, hash(1))
    const result = await fetch(`${origin}/folders/${parent}/download?type=original&include_children=true`)
    assert.equal(result.status, 200)
    assert.equal(new AdmZip(Buffer.from(await result.arrayBuffer())).getEntries()[0].getData().toString(), 'image-1')
    const unicode = await fetch(`${origin}/groups/${groupId}/download?type=original&hashes=${encodeURIComponent(JSON.stringify([hash(1)]))}`)
    assert.equal(unicode.status, 200)
    assert.ok(decodeURIComponent(unicode.headers.get('content-disposition') ?? '').includes('테스트 그룹'))
    await unicode.arrayBuffer()
    assert.equal((await fetch(`${origin}/folders/${parent}/download?type=invalid`)).status, 400)

    const controller = new AbortController()
    const create = fs.createWriteStream.bind(fs)
    let partial = ''
    t.mock.method(fs, 'createWriteStream', (...args: Parameters<typeof fs.createWriteStream>) => {
      partial = String(args[0])
      const stream = create(...args)
      stream.once('ready', () => controller.abort())
      return stream
    })
    let serverFinished!: () => void
    const finished = new Promise<void>((resolve) => { serverFinished = resolve })
    const createZip = GroupDownloadService.createGroupZip.bind(GroupDownloadService)
    t.mock.method(GroupDownloadService, 'createGroupZip', async (options: Parameters<typeof createZip>[0]) => {
      try { return await createZip(options) }
      finally { serverFinished() }
    })
    await assert.rejects(fetch(`${origin}/groups/${groupId}/download?type=original`, { signal: controller.signal }), { name: 'AbortError' })
    await finished
    assert.ok(partial)
    assert.equal(fs.existsSync(partial), false, 'disconnecting the HTTP client cancels ZIP work and removes its partial output')
  })
})
