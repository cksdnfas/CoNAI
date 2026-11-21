import './support/testTemp'
import { scratchDir } from './support/scratchRuntime'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

/**
 * RefMod entries (stage B1): the shared role resolver, source normalisation into the file store, the file-store
 * guard, a build through the queue executor against a fake ComfyUI, name adoption, legacy adoption, the bundle
 * round trip and the route permission gates.
 */
test('refmod entries: roles, sources, guard, build, adoption, bundle, permissions', { timeout: 120000 }, async (t) => {
  const root = scratchDir
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
  const { GenerationQueueService } = await import('../src/services/generationQueueService')
  t.mock.method(GenerationQueueService, 'requestDispatch', () => {})
  const { refModAdoptionsSettled } = await import('../src/services/comfyui/refmodRecords')
  t.after(async () => {
    await refModAdoptionsSettled()
    authModule.getAuthDb().close()
    user.closeUserSettingsDb()
    main.closeDatabase()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
  })

  const db = user.getUserSettingsDb()
  const { db: imagesDb } = main
  const { runtimePaths } = await import('../src/config/runtimePaths')
  const { WorkflowModel } = await import('../src/models/Workflow')
  const { ComfyUIServerModel } = await import('../src/models/ComfyUIServer')
  const { GenerationQueueModel } = await import('../src/models/GenerationQueue')
  const { buildRefModExportTemplate } = await import('../src/services/comfyui/refmodExportTemplate')
  const { resolveRefModWorkflowRoles } = await import('../src/services/comfyui/refmodWorkflowRoles')
  const { FileStoreService } = await import('../src/services/fileStoreService')
  const { storeWorkflowInputAssetFile, resolveWorkflowInputAssetPath } = await import('../src/services/workflowInputAssetStore')
  const { executeGenerationQueueJob } = await import('../src/services/generation-queue/queueJobExecutors')
  const { AuthAccessControlService } = await import('../src/services/authAccessControlService')
  const sharp = (await import('sharp')).default
  const express = (await import('express')).default
  const { createServer } = await import('node:http')

  // ---- fake ComfyUI (never a real one)
  let reportedName = 'group-hero'
  let submitted: Record<string, any> | undefined
  let uploads = 0
  let failPrompt = false
  let failExecution = false
  let presenceDown = false
  const serverLibrary: Array<Record<string, unknown>> = [{ name: 'server/only', kind: 'image', kinds: ['image'], members: [{ kind: 'image', description: 'Server member' }], concept: 'style', description: 'Server bundle', tokens: 4, mtime: 1 }]
  const upstream = createServer((req, res) => {
    const json = (value: unknown) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)) }
    if (req.url === '/upload/image') { uploads++; req.resume(); req.on('end', () => json({ name: `uploaded-${uploads}.png` })); return }
    if (req.url === '/object_info/VAELoader') return json({ VAELoader: { input: { required: { vae_name: [['video.vae', 'audio.vae']] } } } })
    if (req.url === '/prompt' && failPrompt) { req.resume(); res.statusCode = 500; req.on('end', () => json({ error: 'refused' })); return }
    if (req.url === '/prompt') {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => { submitted = JSON.parse(body).prompt; json({ prompt_id: 'build-prompt' }) })
      return
    }
    if (req.url === '/history/build-prompt' && failExecution) {
      return json({ 'build-prompt': { prompt: [], outputs: {}, status: { completed: false, status_str: 'error', messages: [['execution_error', {
        node_id: '4', node_type: 'DaSiWaH3RefModExport', exception_type: 'ValueError', exception_message: 'RefMod name must be a safe plain basename',
      }]] } } })
    }
    if (req.url === '/history/build-prompt') {
      return json({ 'build-prompt': { prompt: [], outputs: { 4: { dasiwa_refmod_export: [{ name: reportedName, members: [], counts: {}, warnings: [], message: 'Saved' }] } }, status: { completed: true, status_str: 'success' } } })
    }
    if (req.url === '/dasiwa/refmods' && presenceDown) { res.statusCode = 500; return json({ error: 'down' }) }
    if (req.url === '/dasiwa/refmods') return json(serverLibrary)
    json({})
  })
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve) => upstream.close(() => resolve())))
  const upstreamPort = (upstream.address() as import('node:net').AddressInfo).port
  const serverId = ComfyUIServerModel.create({ name: 'Fake DaSiWa', endpoint: `http://127.0.0.1:${upstreamPort}`, is_active: true, is_default: true })
  const server = ComfyUIServerModel.findById(serverId)!

  // ---- app with the real routers
  const app = express()
  app.use(express.json({ limit: '20mb' }))
  app.use((await import('express-session')).default({ secret: 'refmod-entries-test', resave: false, saveUninitialized: false }))
  app.use('/api/refmod-entries', (await import('../src/routes/refmod-entries.routes')).default)
  app.use('/api/refmods', (await import('../src/routes/refmods')).default)
  app.use('/api/generation-queue', (await import('../src/routes/generation-queue/queue-action-routes')).createGenerationQueueActionRoutes())
  const listener = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => listener.once('listening', resolve))
  t.after(() => new Promise<void>((resolve) => listener.close(() => resolve())))
  const base = `http://127.0.0.1:${(listener.address() as import('node:net').AddressInfo).port}/api/refmod-entries`
  const call = async (method: string, route: string, body?: unknown) => {
    const response = await fetch(`${base}${route}`, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await response.text()
    let data: any = text
    try { data = JSON.parse(text) } catch { /* binary */ }
    return { status: response.status, body: data }
  }

  // Mirrors isTimelineItem in frontend/src/features/image-generation/components/minimax-h3-director-dasiwa-utils.ts:
  // the editor drops every timeline item that fails it, and its next save then removes that item's file.
  const assertEditorTimeline = (director: any, label: string) => {
    const timeline = JSON.parse(director.timeline_data)
    assert.ok(Array.isArray(timeline.items) && timeline.items.length > 0, `${label}: timeline items`)
    for (const item of timeline.items) {
      assert.ok(item && typeof item === 'object' && !Array.isArray(item), `${label}: item is an object`)
      assert.equal(typeof item.id, 'string', `${label}: id`)
      assert.ok(item.type === 'image' || item.type === 'video' || item.type === 'audio', `${label}: type`)
      assert.equal(typeof item.value, 'string', `${label}: value`)
    }
    return timeline.items as Array<Record<string, any>>
  }
  // GET /:id, then PATCH the composed values back unchanged: every file stays.
  const roundTrip = async (id: number, label: string) => {
    const detail = (await call('GET', `/${id}`)).body.data
    const director = detail.form.values[detail.form.roles.director]
    const assets = director.__conai_minimax_h3_director.assets
    for (const item of assertEditorTimeline(director, label)) assert.equal(assets[item.id]?.__ref, 'refmod-entry-file', `${label}: item ${item.id} has its source`)
    const filesOf = () => (db.prepare('SELECT file_id FROM refmod_entry_files WHERE entry_id = ? ORDER BY file_id').all(id) as Array<{ file_id: string }>).map((row) => row.file_id)
    const files = filesOf()
    assert.ok(files.length > 0, `${label}: has sources`)
    const saved = await call('PATCH', `/${id}`, { revision: detail.revision, values: detail.form.values })
    assert.equal(saved.status, 200, `${label}: ${JSON.stringify(saved.body)}`)
    assert.deepEqual(saved.body.data.members.map((member: any) => member.fileId), detail.members.map((member: any) => member.fileId), `${label}: members`)
    assert.deepEqual(filesOf(), files, `${label}: entry files`)
    for (const fileId of files) assert.ok(FileStoreService.get(owner, fileId), `${label}: ${fileId} still stored`)
  }

  // ---- workflows
  const template = buildRefModExportTemplate({ vaeNames: ['video.vae', 'audio.vae'] })
  const templateId = WorkflowModel.create(template)
  const hiddenName = { ...template, name: 'Hidden name', marked_fields: template.marked_fields!.map((field) => field.id === 'name' ? { ...field, hidden: true } : field) }
  const twoExports = JSON.parse(template.workflow_json)
  twoExports[5] = { ...twoExports[4] }
  const twoExportsId = WorkflowModel.create({ ...template, name: 'Two exports', workflow_json: JSON.stringify(twoExports) })

  await t.test('one role resolver: shipped template, hidden name, two export nodes', () => {
    const shipped = resolveRefModWorkflowRoles(template.workflow_json, template.marked_fields!)
    assert.deepEqual(shipped.roles, { name: 'name', description: 'description', concept: 'concept_type', director: 'director' })
    assert.deepEqual(shipped.issues, [])
    assert.equal(shipped.buildable, true)
    const hidden = resolveRefModWorkflowRoles(hiddenName.workflow_json, hiddenName.marked_fields)
    assert.equal(hidden.roles.name, null)
    assert.deepEqual(hidden.issues, [{ code: 'name-not-exposed', severity: 'blocking' }])
    assert.equal(hidden.linkable, true)
    assert.equal(hidden.buildable, false)
    const two = resolveRefModWorkflowRoles(JSON.stringify(twoExports), template.marked_fields!)
    assert.deepEqual(two.issues, [{ code: 'multiple-export-nodes', severity: 'blocking' }])
    assert.equal(two.linkable, false)
    const none = resolveRefModWorkflowRoles(JSON.stringify({ 1: { class_type: 'KSampler', inputs: {} } }), [])
    assert.deepEqual(none.issues.map((issue) => issue.code), ['no-export-node'])
  })

  const png = (color: string) => sharp({ create: { width: 4, height: 4, channels: 3, background: color } }).png().toBuffer()
  const owner = 'bootstrap'
  let entryId = 0
  let entryFiles: string[] = []

  await t.test('save copies input assets and library images into the file store and refuses foreign files', async () => {
    const workflows = await call('GET', '/workflows')
    assert.equal(workflows.status, 200)
    assert.deepEqual(workflows.body.data.map((entry: any) => [entry.id, entry.buildable]), [[templateId, true], [twoExportsId, false]])
    const created = await call('POST', '/', { name: 'group-hero' })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    entryId = created.body.data.id
    assert.equal(created.body.data.workflowId, templateId, 'the first candidate without blocking issues is the default')
    assert.deepEqual(created.body.data.form.roles, { name: 'name', description: 'description', concept: 'concept_type', director: 'director' })
    assert.equal((await call('POST', '/', { name: 'GROUP-hero' })).body.code, 'name_conflict')
    assert.equal((await call('PATCH', `/${entryId}`, { revision: 1, workflowId: twoExportsId })).status, 400, 'an entry cannot link a workflow with two export nodes')

    // A workflow input asset (uploaded draft media) and a library image.
    const staged = path.join(root, 'upload.part')
    fs.writeFileSync(staged, await png('#336699'))
    const inputAsset = storeWorkflowInputAssetFile(staged, { fileName: 'portrait.html', mimeType: 'image/png', bytes: fs.statSync(staged).size })
    const hash = 'd'.repeat(48)
    fs.mkdirSync(runtimePaths.uploadsDir, { recursive: true })
    const libraryBytes = await png('#993366')
    fs.writeFileSync(path.join(runtimePaths.uploadsDir, 'entry-library.png'), libraryBytes)
    const folderId = (imagesDb.prepare('SELECT id FROM watched_folders ORDER BY id LIMIT 1').get() as { id: number }).id
    imagesDb.prepare('INSERT INTO media_metadata (composite_hash) VALUES (?)').run(hash)
    imagesDb.prepare("INSERT INTO image_files (composite_hash, original_file_path, folder_id, file_size, mime_type) VALUES (?, ?, ?, ?, 'image/png')").run(hash, 'entry-library.png', folderId, libraryBytes.length)
    // An uploaded sound (a synthesized WAV), an uploaded clip (the sprite-port fixture) and a data-URL sketch.
    const audioPath = path.join(root, 'entry-tone.wav')
    ;(await import('node:child_process')).execFileSync((await import('ffmpeg-static')).default!, [
      '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.1', '-ac', '1', '-ar', '22050', audioPath,
    ], { windowsHide: true })
    const audioBytes = fs.readFileSync(audioPath)
    const audioAsset = storeWorkflowInputAssetFile(audioPath, { fileName: 'tone.wav', mimeType: 'audio/wav', bytes: fs.statSync(audioPath).size })
    const videoPath = path.join(root, 'entry-clip.mp4')
    fs.copyFileSync(path.join(__dirname, 'fixtures', 'sprite-port', 'inputs', 'orange.mp4'), videoPath)
    const videoAsset = storeWorkflowInputAssetFile(videoPath, { fileName: 'clip.mp4', mimeType: 'video/mp4', bytes: fs.statSync(videoPath).size })
    const inlineBytes = await png('#55aaaa')
    const director = {
      ...JSON.parse(template.workflow_json)[1].inputs,
      timeline_data: JSON.stringify({ items: [
        // Items as the editor writes them (a string value each).
        { id: 'upload', type: 'image', order: 0, prompt: 'Uploaded face', value: 'portrait.png' },
        { id: 'library', type: 'image', order: 1, prompt: 'Library pose', value: 'entry-library.png' },
        { id: 'sound', type: 'audio', order: 2, prompt: 'Voice tone', value: 'tone.wav' },
        { id: 'clip', type: 'video', order: 3, prompt: 'Motion clip', value: 'clip.mp4' },
        { id: 'inline', type: 'image', order: 4, prompt: 'Inline sketch', value: 'sketch.png' },
      ] }),
      __conai_minimax_h3_director: { assets: {
        upload: inputAsset, library: { composite_hash: hash, mimeType: 'text/html' }, sound: audioAsset, clip: videoAsset,
        inline: { fileName: 'sketch.png', dataUrl: `data:image/png;base64,${inlineBytes.toString('base64')}` },
        orphan: { dataUrl: 'data:image/png;base64,AAAA' },
      } },
    }
    const saved = await call('PATCH', `/${entryId}`, { revision: 1, values: { director, description: 'Hero bundle', concept_type: 'identity', video_vae: 'video.vae', audio_vae: 'audio.vae' }, keywords: ['hero', 'Hero', 'face'] })
    assert.equal(saved.status, 200, JSON.stringify(saved.body))
    const entry = saved.body.data
    assert.equal(entry.revision, 2)
    assert.equal(entry.description, 'Hero bundle')
    assert.equal(entry.conceptType, 'identity')
    assert.deepEqual(entry.keywords, ['Hero', 'face'])
    const assets = entry.form.values.director.__conai_minimax_h3_director.assets
    assert.deepEqual(Object.keys(assets).sort(), ['clip', 'inline', 'library', 'sound', 'upload'], 'assets of no item are dropped')
    const mimes: Record<string, string> = { upload: 'image/png', library: 'image/png', sound: 'audio/wav', clip: 'video/mp4', inline: 'image/png' }
    for (const [key, mime] of Object.entries(mimes)) {
      assert.equal(assets[key].__ref, 'refmod-entry-file')
      assert.equal(assets[key].entryId, entryId)
      assert.equal(assets[key].mimeType, mime, key)
    }
    assert.equal(assets.upload.fileName, 'portrait.html')
    entryFiles = ['upload', 'library', 'sound', 'clip', 'inline'].map((key) => assets[key].id)
    assert.deepEqual((db.prepare('SELECT file_id FROM refmod_entry_files WHERE entry_id = ? ORDER BY file_id').all(entryId) as any[]).map((row) => row.file_id), [...entryFiles].sort())
    for (const [index, extension] of ['png', 'png', 'wav', 'mp4', 'png'].entries()) {
      const stored = FileStoreService.get(owner, entryFiles[index])
      assert.ok(stored.name.endsWith(`.${extension}`), `the stored extension follows the validated MIME: ${stored.name}`)
    }
    assert.deepEqual(fs.readFileSync(FileStoreService.resolveFile(owner, assets.sound.id).filePath), audioBytes)
    assert.deepEqual(fs.readFileSync(FileStoreService.resolveFile(owner, assets.inline.id).filePath), inlineBytes)
    for (const consumed of [audioAsset, videoAsset]) assert.equal(fs.existsSync(`${resolveWorkflowInputAssetPath(consumed.id)}.deleted`), true)
    const folder = FileStoreService.get(owner, FileStoreService.get(owner, entryFiles[0]).parentId!)
    assert.equal(folder.name, 'group-hero', 'the sources sit in a folder named after the entry')
    assert.deepEqual(fs.readFileSync(FileStoreService.resolveFile(owner, assets.library.id).filePath), libraryBytes)
    assert.equal(fs.existsSync(`${resolveWorkflowInputAssetPath(inputAsset.id)}.deleted`), true, 'the consumed input asset is marked for deletion')
    assert.deepEqual(entry.members.map((member: any) => [member.index, member.kind, member.description, member.fileId]), [
      [0, 'image', 'Uploaded face', assets.upload.id], [1, 'image', 'Library pose', assets.library.id], [2, 'audio', 'Voice tone', assets.sound.id],
      [3, 'video', 'Motion clip', assets.clip.id], [4, 'image', 'Inline sketch', assets.inline.id],
    ])
    assert.equal(entry.form.values.video_vae, 'video.vae', 'other marked fields are kept by field id')

    // Unchanged refs of this entry are kept as they are.
    const resaved = await call('PATCH', `/${entryId}`, { revision: 2, values: { director: entry.form.values.director } })
    assert.equal(resaved.status, 200, JSON.stringify(resaved.body))
    assert.deepEqual(resaved.body.data.members.map((member: any) => member.fileId), entryFiles)
    // A foreign entry's file and an arbitrary file id are refused.
    const other = (await call('POST', '/', { name: 'other' })).body.data
    const otherFile = FileStoreService.writeText(owner, null, 'stray.txt', 'x')
    for (const foreign of [{ ...assets.upload, entryId: other.id }, { ...assets.upload, id: otherFile.id }]) {
      const refused = await call('PATCH', `/${other.id}`, { revision: other.revision, values: { director: { ...director, __conai_minimax_h3_director: { assets: { upload: foreign } } } } })
      assert.equal(refused.status, 400)
      assert.equal(refused.body.code, 'foreign_file')
    }
    const stale = await call('PATCH', `/${entryId}`, { revision: 1, description: 'stale' })
    assert.equal(stale.status, 409)
    assert.equal(stale.body.code, 'revision_conflict')
    assert.equal(stale.body.revision, 3)
    const media = await fetch(`${base}/${entryId}/files/${assets.upload.id}`)
    assert.equal(media.status, 200)
    assert.equal(media.headers.get('content-type'), 'image/png')
    assert.equal(media.headers.get('content-security-policy'), 'sandbox')
    assert.equal(media.headers.get('x-content-type-options'), 'nosniff')
    await media.arrayBuffer()
    const thumbnail = await fetch(`${base}/${entryId}/files/${assets.upload.id}/thumbnail`)
    assert.equal(thumbnail.status, 200)
    assert.equal(thumbnail.headers.get('content-type'), 'image/webp')
    await thumbnail.arrayBuffer()
    assert.equal((await fetch(`${base}/${other.id}/files/${assets.upload.id}`)).status, 404, 'files are served only through their own entry')
    assert.equal((await call('GET', '/?query=pose')).body.data.items[0]?.id, entryId, 'query matches member descriptions')
    assert.equal((await call('GET', '/?query=face%20hero')).body.data.total, 1)
    assert.equal((await call('GET', '/?query=nomatch')).body.data.total, 0)
    assert.equal((await call('DELETE', `/${other.id}`)).status, 200)
    await roundTrip(entryId, 'saved entry')
  })

  await t.test('the file store refuses to delete or replace an entry source', async () => {
    const [fileId] = entryFiles
    const file = FileStoreService.get(owner, fileId)
    assert.throws(() => FileStoreService.delete(owner, [fileId]), /RefMod에서 쓰는 파일은 삭제할 수 없어/)
    assert.throws(() => FileStoreService.deleteTree(owner, file.parentId!), /RefMod에서 쓰는 파일은 삭제할 수 없어/)
    const replacement = path.join(root, 'replace.part')
    fs.writeFileSync(replacement, await png('#000000'))
    assert.throws(() => FileStoreService.upload(owner, file.parentId, [{ path: replacement, originalname: file.name, mimetype: 'image/png', size: fs.statSync(replacement).size } as Express.Multer.File], false, { id: fileId }), /RefMod에서 쓰는 파일은 덮어쓸 수 없어/)
    const renamed = FileStoreService.rename(owner, fileId, 'renamed.txt', true)
    assert.equal(renamed.name, 'renamed.txt', 'renaming stays allowed')
    assert.throws(() => FileStoreService.writeText(owner, file.parentId, 'renamed.txt', 'overwrite'), /RefMod에서 쓰는 파일은 덮어쓸 수 없어/)
    FileStoreService.rename(owner, fileId, file.name, true)
    assert.equal(FileStoreService.get(owner, fileId).size, file.size)
  })

  await t.test('build: composed promptData, input-asset copies, linked record without a retained copy, reported name adopted', async () => {
    const before = (await call('GET', `/${entryId}`)).body.data
    reportedName = 'group-hero-v2'
    const built = await call('POST', `/${entryId}/build`)
    assert.equal(built.status, 201, JSON.stringify(built.body))
    const { jobId } = built.body.data
    assert.equal((await call('POST', `/${entryId}/build`)).body.code, 'pending', 'a queued build blocks a second one')
    assert.equal((await call('GET', `/${entryId}`)).body.data.pending, true)
    assert.equal((await call('DELETE', `/${entryId}`)).status, 409, 'a pending entry is not deleted')
    const job = GenerationQueueModel.findById(jobId)!
    assert.equal(job.requested_server_id, serverId)
    const payload = JSON.parse(job.request_payload)
    assert.equal(payload.prompt_data.name, 'group-hero')
    assert.equal(payload.prompt_data.description, 'Hero bundle')
    assert.equal(payload.prompt_data.concept_type, 'identity')
    assert.equal(payload.prompt_data.video_vae, 'video.vae')
    const runAssets = payload.prompt_data.director.__conai_minimax_h3_director.assets
    assert.ok(!JSON.stringify(payload).includes('refmod-entry-file'), 'the entry-file reference never enters the run')
    assert.deepEqual(Object.keys(runAssets).sort(), ['clip', 'inline', 'library', 'sound', 'upload'])
    for (const key of Object.keys(runAssets)) {
      assert.equal(runAssets[key].__ref, 'workflow-input-asset')
      assert.equal(fs.existsSync(`${resolveWorkflowInputAssetPath(runAssets[key].id)}.deleted`), true, 'build copies are pre-marked for delayed deletion')
    }
    assert.equal(runAssets.sound.mimeType, 'audio/wav')
    assert.equal(runAssets.clip.mimeType, 'video/mp4')
    assert.deepEqual(payload.__conaiRefModEntry, { entryId, files: { upload: entryFiles[0], library: entryFiles[1], sound: entryFiles[2], clip: entryFiles[3], inline: entryFiles[4] } }, 'the build links its run through the server-only option')

    db.prepare("UPDATE generation_queue_jobs SET status = 'dispatching', assigned_server_id = ? WHERE id = ?").run(serverId, jobId)
    const transitionJob = (id: number, status: string) => { db.prepare('UPDATE generation_queue_jobs SET status = ? WHERE id = ?').run(status, id); return null }
    await executeGenerationQueueJob(GenerationQueueModel.findById(jobId)!, server, { transitionJob, attemptUpstreamCancellation: async () => undefined })
    assert.equal(uploads, 5)
    assert.deepEqual(JSON.parse(submitted!['4'].inputs.timeline_data).items.map((item: any) => item.value), [1, 2, 3, 4, 5].map((n) => `uploaded-${n}.png`))
    const record = db.prepare('SELECT * FROM minimax_refmod_records WHERE queue_job_id = ?').get(jobId) as any
    assert.equal(record.status, 'saved')
    assert.equal(record.entry_id, entryId)
    assert.deepEqual(JSON.parse(record.members_json).map((member: any) => [member.kind, member.file_id, member.retained_file]),
      [['image', entryFiles[0], undefined], ['image', entryFiles[1], undefined], ['audio', entryFiles[2], undefined], ['video', entryFiles[3], undefined], ['image', entryFiles[4], undefined]])
    const retainedDir = path.join(runtimePaths.basePath, 'refmods', String(record.id))
    assert.equal(fs.existsSync(retainedDir), false, `an entry build retains no copy: ${fs.existsSync(retainedDir) ? fs.readdirSync(retainedDir).join(',') : ''} ${runtimePaths.basePath}`)
    const recordMedia = await fetch(`${base.replace('/refmod-entries', '/refmods')}/${record.id}/media/0`)
    assert.equal(recordMedia.status, 200, 'record media is served from the entry file')
    await recordMedia.arrayBuffer()
    const listed = (await (await fetch(base.replace('/refmod-entries', '/refmods'))).json() as any).data.find((entry: any) => entry.id === record.id)
    assert.deepEqual(Object.keys(listed).sort(), ['concept_type', 'created_at', 'description', 'error', 'id', 'members', 'name', 'server_id', 'status', 'workflow_id'], 'GET /api/refmods keeps its contract')
    assert.deepEqual(Object.keys(listed.members[0]).sort(), ['composite_hash', 'description', 'file_name', 'index', 'kind', 'media_mode', 'media_url', 'mime_type', 'source_duration', 'source_height', 'source_width', 'trim_end', 'trim_start'])
    const after = (await call('GET', `/${entryId}`)).body.data
    assert.equal(after.name, 'group-hero-v2', 'the name ComfyUI reports is adopted when free')
    assert.equal(after.revision, before.revision + 1)
    assert.ok(after.lastBuiltAt)
    assert.equal(after.lastRecord.id, record.id)
    assert.equal(after.pending, false)
    assert.equal(after.records[0].status, 'saved')
  })

  await t.test('the entry link is server-issued; a failed build leaves the entry as it was; a retry stays linked', async () => {
    const { enqueueGenerationJobs } = await import('../src/services/generation-queue/queueEnqueue')
    const { RefModEntryLinkForgedError } = await import('../src/services/generation-queue/queueRefModEntryLink')
    const forged = { prompt_data: {}, __conaiRefModEntry: { entryId, files: { upload: entryFiles[0] } } }
    const jobsBefore = (db.prepare('SELECT COUNT(*) AS n FROM generation_queue_jobs').get() as { n: number }).n
    const refused = await fetch(base.replace('/refmod-entries', '/generation-queue'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service_type: 'comfyui', workflow_id: templateId, request_payload: forged }),
    })
    assert.equal(refused.status, 400)
    assert.match(await refused.text(), /RefMod entry link is server-issued/)
    assert.throws(() => enqueueGenerationJobs({ service_type: 'comfyui', workflow_id: templateId, request_payload: forged }), RefModEntryLinkForgedError)
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM generation_queue_jobs').get() as { n: number }).n, jobsBefore, 'no forged job was stored')

    const before = (await call('GET', `/${entryId}`)).body.data
    failPrompt = true
    const built = await call('POST', `/${entryId}/build`)
    assert.equal(built.status, 201, JSON.stringify(built.body))
    const { jobId } = built.body.data
    db.prepare("UPDATE generation_queue_jobs SET status = 'dispatching', assigned_server_id = ? WHERE id = ?").run(serverId, jobId)
    const transitionJob = (id: number, status: string) => { db.prepare('UPDATE generation_queue_jobs SET status = ? WHERE id = ?').run(status, id); return null }
    let failure: unknown = null
    try {
      await executeGenerationQueueJob(GenerationQueueModel.findById(jobId)!, server, { transitionJob, attemptUpstreamCancellation: async () => undefined })
    } catch (error) { failure = error }
    failPrompt = false
    assert.ok(failure, 'ComfyUI refused the prompt')
    // The dispatcher's terminal transition after a thrown executor.
    db.prepare("UPDATE generation_queue_jobs SET status = 'failed' WHERE id = ?").run(jobId)
    const record = db.prepare('SELECT id, status, entry_id FROM minimax_refmod_records WHERE queue_job_id = ?').get(jobId) as any
    assert.equal(record.status, 'failed')
    assert.equal(record.entry_id, entryId)
    const after = (await call('GET', `/${entryId}`)).body.data
    for (const key of ['name', 'revision', 'lastBuiltAt', 'description', 'conceptType', 'members']) assert.deepEqual(after[key], before[key], key)
    assert.deepEqual(after.form.values.director, before.form.values.director)
    assert.equal(after.pending, false)
    assert.deepEqual([after.lastRecord.id, after.lastRecord.status], [record.id, 'failed'])
    assert.deepEqual([after.records[0].id, after.records[0].status], [record.id, 'failed'], 'the failed run shows in the entry records')
    for (const fileId of entryFiles) assert.ok(FileStoreService.get(owner, fileId), 'entry files stay')

    // A retry copies the stored job server-side and keeps the link (through the same option).
    const retried = GenerationQueueService.retryJob(jobId)!
    const original = JSON.parse(GenerationQueueModel.findById(jobId)!.request_payload)
    const copy = JSON.parse(GenerationQueueModel.findById(retried.id)!.request_payload)
    assert.notEqual(retried.id, jobId)
    assert.deepEqual(copy.__conaiRefModEntry, original.__conaiRefModEntry)
    assert.deepEqual(copy.prompt_data, original.prompt_data)
    assert.equal((await call('GET', `/${entryId}`)).body.data.pending, true, 'the retried build counts as pending')
    db.prepare("UPDATE generation_queue_jobs SET status = 'cancelled' WHERE id = ?").run(retried.id)
  })

  await t.test('switching to another linkable workflow keeps the role columns and same-id extras', async () => {
    const videoField = template.marked_fields!.find((field) => field.id === 'video_vae')!
    const copyId = WorkflowModel.create({ ...template, name: 'Template copy', marked_fields: template.marked_fields!.map((field) => field.id === 'video_vae' ? { ...field, id: 'vae_video' } : field) })
    const current = (await call('GET', `/${entryId}`)).body.data
    const switched = await call('PATCH', `/${entryId}`, { revision: current.revision, workflowId: copyId })
    assert.equal(switched.status, 200, JSON.stringify(switched.body))
    const data = switched.body.data
    assert.equal(data.workflowId, copyId)
    assert.equal(data.form.workflow.id, copyId, 'the form is the new workflow')
    const fieldIds = data.form.fields.map((field: any) => field.id)
    assert.ok(fieldIds.includes('vae_video') && !fieldIds.includes('video_vae'), fieldIds.join(','))
    assert.deepEqual(data.form.roles, { name: 'name', description: 'description', concept: 'concept_type', director: 'director' })
    assert.equal(data.form.values.name, current.name)
    assert.equal(data.form.values.description, 'Hero bundle')
    assert.equal(data.form.values.concept_type, 'identity')
    assert.deepEqual(data.form.values.director, current.form.values.director)
    assert.deepEqual(data.members, current.members)
    assert.equal(data.form.values.audio_vae, 'audio.vae', 'a same-id extra carries over')
    assert.deepEqual(data.form.values.vae_video, JSON.parse(JSON.stringify({ value: videoField.default_value })).value, 'a field the old workflow lacked starts at its default')
    assert.equal(Object.prototype.hasOwnProperty.call(data.form.values, 'video_vae'), false)
    const back = await call('PATCH', `/${entryId}`, { revision: data.revision, workflowId: templateId })
    assert.equal(back.status, 200)
    assert.equal(back.body.data.form.values.video_vae, 'video.vae', 'an extra the other workflow lacked is still kept')
    WorkflowModel.update(copyId, { is_active: false })
  })

  await t.test('a workflow with several export nodes captures as before, ignoring an entry link', async () => {
    const { captureRefModRecords, failRefModRecords } = await import('../src/services/comfyui/refmodRecords')
    const bytes = await png('#aa5555')
    const director = {
      ...JSON.parse(template.workflow_json)[1].inputs,
      timeline_data: JSON.stringify({ items: [{ id: 'upload', type: 'image', prompt: 'Two exports' }] }),
      __conai_minimax_h3_director: { assets: { upload: { fileName: 'two.png', dataUrl: `data:image/png;base64,${bytes.toString('base64')}` } } },
    }
    const handles = await captureRefModRecords({
      workflowJson: JSON.stringify(twoExports), markedFields: template.marked_fields!, promptData: { director }, serverId, workflowId: twoExportsId,
      entry: { entryId, files: { upload: entryFiles[0] } },
    })
    assert.deepEqual(handles.map((handle) => handle.export_node_id), ['4', '5'])
    for (const handle of handles) {
      const row = db.prepare('SELECT entry_id, members_json FROM minimax_refmod_records WHERE id = ?').get(handle.id) as any
      assert.equal(row.entry_id, null)
      assert.equal(JSON.parse(row.members_json)[0].retained_file, '0.png')
      assert.deepEqual(fs.readFileSync(path.join(runtimePaths.basePath, 'refmods', String(handle.id), '0.png')), bytes)
    }
    await failRefModRecords(handles, new Error('Cancelled by user'))
    for (const handle of handles) assert.equal(fs.existsSync(path.join(runtimePaths.basePath, 'refmods', String(handle.id))), false)
  })

  await t.test('adoption: a plain run registers itself; a legacy record is adopted by copying', async () => {
    const { captureRefModRecords, completeRefModRecords, linkRefModRecords } = await import('../src/services/comfyui/refmodRecords')
    reportedName = 'plain-run'
    const bytes = await png('#55aa55')
    const director = {
      ...JSON.parse(template.workflow_json)[1].inputs,
      timeline_data: JSON.stringify({ items: [{ id: 'one', type: 'image', prompt: 'Plain member' }] }),
      __conai_minimax_h3_director: { assets: { one: { fileName: 'one.png', dataUrl: `data:image/png;base64,${bytes.toString('base64')}` } } },
    }
    const handles = await captureRefModRecords({ workflowJson: template.workflow_json, markedFields: template.marked_fields!, promptData: { director }, serverId, workflowId: templateId })
    linkRefModRecords(handles, { workflow: JSON.parse(template.workflow_json) })
    const plain = completeRefModRecords(handles, { 'build-prompt': { prompt: [], outputs: { 4: { dasiwa_refmod_export: [{ name: 'plain-run' }] } }, status: { completed: true, status_str: 'success' } } } as never, 'build-prompt')[0]
    await refModAdoptionsSettled()
    const adopted = (await call('GET', '/?query=plain')).body.data.items[0]
    assert.equal(adopted.name, 'plain-run')
    assert.equal(adopted.members[0].description, 'Plain member')
    assert.ok(adopted.members[0].fileId)
    assert.equal((db.prepare('SELECT entry_id FROM minimax_refmod_records WHERE id = ?').get(plain.id) as any).entry_id, adopted.id)
    assert.equal(fs.existsSync(path.join(runtimePaths.basePath, 'refmods', String(plain.id), '0.png')), true, 'the record keeps its own copy')

    // A record from before entries existed: no director value, no item ids.
    const legacyId = Number(db.prepare(`INSERT INTO minimax_refmod_records (name, server_id, workflow_id, status, concept_type, description, export_node_id, members_json)
      VALUES ('legacy-one', ?, ?, 'saved', 'style', 'Legacy bundle', '4', ?)`).run(serverId, templateId, JSON.stringify([{
      index: 0, kind: 'image', description: 'Legacy member', file_name: 'legacy.png', mime_type: 'image/png', media_url: '', composite_hash: null,
      media_mode: null, trim_start: null, trim_end: null, source_width: 4, source_height: 4, source_duration: null, retained_file: '0.png',
    }])).lastInsertRowid)
    const legacyDir = path.join(runtimePaths.basePath, 'refmods', String(legacyId))
    fs.mkdirSync(legacyDir, { recursive: true })
    fs.writeFileSync(path.join(legacyDir, '0.png'), bytes)
    const unregistered = (await call('GET', '/unregistered')).body.data
    assert.deepEqual(unregistered.map((entry: any) => entry.name), ['legacy-one'])
    assert.equal(unregistered[0].members[0].retained_file, undefined)
    const result = await call('POST', '/adopt', { recordIds: [legacyId], names: ['server/only', 'not-there'] })
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.deepEqual(result.body.data.created.map((entry: any) => entry.name), ['legacy-one', 'server/only'])
    assert.deepEqual(result.body.data.skipped, [{ name: 'not-there', reason: 'not-on-server' }])
    const legacy = (await call('GET', `/${result.body.data.created[0].id}`)).body.data
    assert.equal(legacy.conceptType, 'style')
    assert.deepEqual(legacy.members.map((member: any) => [member.kind, member.description, member.sourceWidth]), [['image', 'Legacy member', 4]])
    const ref = legacy.form.values.director.__conai_minimax_h3_director.assets.m0
    assert.equal(ref.__ref, 'refmod-entry-file')
    assert.deepEqual(fs.readFileSync(FileStoreService.resolveFile(owner, ref.id).filePath), bytes)
    assert.equal(fs.existsSync(path.join(legacyDir, '0.png')), true, 'adoption copies, never moves')
    const legacyItems = assertEditorTimeline(legacy.form.values.director, 'legacy adoption')
    assert.deepEqual(legacyItems.map((item) => [item.id, item.type, item.value, item.prompt]), [['m0', 'image', 'legacy.png', 'Legacy member']])
    await roundTrip(legacy.id, 'legacy adoption')
    const serverOnly = (await call('GET', `/${result.body.data.created[1].id}`)).body.data
    assert.deepEqual(serverOnly.members.map((member: any) => [member.kind, member.description, member.fileId]), [['image', 'Server member', null]])
    assert.equal(serverOnly.conceptType, 'style')
    assert.deepEqual((await call('GET', '/unregistered')).body.data, [])
    const presence = (await call('GET', '/presence')).body.data
    assert.equal(presence.status, 'ok')
    assert.deepEqual(presence.entries.map((entry: any) => entry.name), ['server/only'])

    // Bulk delete goes through the same entry deletion: the linked record and its retained folder go with it.
    const plainDir = path.join(runtimePaths.basePath, 'refmods', String(plain.id))
    assert.equal(fs.existsSync(plainDir), true)
    const bulk = await call('POST', '/bulk', { ids: [adopted.id], action: 'delete' })
    assert.equal(bulk.status, 200, JSON.stringify(bulk.body))
    assert.deepEqual(bulk.body.data, { updated: 0, deleted: 1 })
    assert.equal(db.prepare('SELECT 1 FROM minimax_refmod_records WHERE id = ?').get(plain.id), undefined)
    assert.equal(fs.existsSync(plainDir), false, 'the record deletion removes its retained folder')
  })

  await t.test('bundle export and import with skip and overwrite', async () => {
    const exported = await fetch(`${base}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [entryId] }) })
    assert.equal(exported.status, 200)
    assert.equal(exported.headers.get('content-type'), 'application/zip')
    const zip = Buffer.from(await exported.arrayBuffer())
    const AdmZip = (await import('adm-zip')).default
    const archive = new AdmZip(zip)
    const document = JSON.parse(archive.readAsText('refmods.json'))
    assert.equal(document.format, 'conai.refmods')
    assert.equal(document.entries[0].name, 'group-hero-v2')
    assert.deepEqual(document.entries[0].extras.map((extra: any) => [extra.id, extra.value]), [['video_vae', 'video.vae'], ['audio_vae', 'audio.vae']])
    const bundledAssets = document.entries[0].director.__conai_minimax_h3_director.assets
    assert.deepEqual(Object.values(bundledAssets).map((asset: any) => Object.keys(asset).sort()), Array.from({ length: 5 }, () => ['bundleFile', 'fileName', 'mimeType']))
    assert.ok(!JSON.stringify(document).match(/serverId|server_id|workflowId|workflow_id|fileId|entryId|__ref|queue|history/), `no instance ids travel: ${JSON.stringify(document)}`)
    fs.mkdirSync(runtimePaths.tempDir, { recursive: true })
    const upload = async (conflict: string) => {
      const form = new FormData()
      form.append('conflict', conflict)
      form.append('file', new Blob([zip], { type: 'application/zip' }), 'refmods.zip')
      const response = await fetch(`${base}/import`, { method: 'POST', body: form })
      return { status: response.status, body: await response.json() as any }
    }
    const skipped = await upload('skip')
    assert.equal(skipped.status, 201, JSON.stringify(skipped.body))
    assert.deepEqual(skipped.body.data, { created: 0, overwritten: 0, skipped: 1, importedFiles: 0, droppedFiles: 0 })
    const revision = (await call('GET', `/${entryId}`)).body.data.revision
    const overwritten = await upload('overwrite')
    assert.deepEqual(overwritten.body.data, { created: 0, overwritten: 1, skipped: 0, importedFiles: 5, droppedFiles: 0 })
    const replaced = (await call('GET', `/${entryId}`)).body.data
    assert.equal(replaced.revision, revision + 1)
    const newFiles = replaced.members.map((member: any) => member.fileId)
    assert.equal(newFiles.filter((id: string) => entryFiles.includes(id)).length, 0, 'sources are new copies')
    for (const oldFile of entryFiles) assert.throws(() => FileStoreService.get(owner, oldFile), /찾을 수 없어/, 'replaced sources are released')
    entryFiles = newFiles
    // Gone here, then imported fresh: a new entry on the default workflow with its extras.
    const linkedRecords = (db.prepare('SELECT id FROM minimax_refmod_records WHERE entry_id = ?').all(entryId) as Array<{ id: number }>).map((row) => row.id)
    assert.equal(linkedRecords.length, 2, 'the saved build and the failed build')
    assert.equal((await call('DELETE', `/${entryId}`)).status, 200)
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM minimax_refmod_records WHERE id IN (SELECT value FROM json_each(?))').get(JSON.stringify(linkedRecords)) as { n: number }).n, 0, 'deleting an entry deletes its run records')
    for (const fileId of newFiles) assert.throws(() => FileStoreService.get(owner, fileId), /찾을 수 없어/, 'deleting an entry deletes its own copies')
    const fresh = await upload('skip')
    assert.deepEqual(fresh.body.data, { created: 1, overwritten: 0, skipped: 0, importedFiles: 5, droppedFiles: 0 })
    const imported = (await call('GET', '/?query=hero-v2')).body.data.items[0]
    const detail = (await call('GET', `/${imported.id}`)).body.data
    assert.equal(detail.workflowId, templateId)
    assert.equal(detail.form.values.video_vae, 'video.vae')
    assert.deepEqual(detail.keywords, ['Hero', 'face'])
    const importedRefs = detail.form.values.director.__conai_minimax_h3_director.assets
    assert.deepEqual(Object.fromEntries(Object.entries(importedRefs).map(([key, ref]: [string, any]) => [key, FileStoreService.get(owner, ref.id).mimeType])),
      { upload: 'image/png', library: 'image/png', sound: 'audio/wav', clip: 'video/mp4', inline: 'image/png' })
    for (const ref of Object.values(importedRefs) as any[]) assert.equal(ref.entryId, imported.id)
    await roundTrip(imported.id, 'bundle import')
    const notZip = new FormData()
    notZip.append('file', new Blob([Buffer.from('not a zip')]), 'x.zip')
    assert.equal((await fetch(`${base}/import`, { method: 'POST', body: notZip })).status, 400)
  })

  await t.test('permission gates', async (sub) => {
    const access = AuthAccessControlService.resolveBootstrapAccess()
    const only = (keys: string[]) => {
      sub.mock.restoreAll()
      sub.mock.method(AuthAccessControlService, 'resolveBootstrapAccess', () => ({ ...access, permissionKeys: access.permissionKeys.filter((key) => keys.includes(key)) }))
    }
    const anyEntry = (db.prepare('SELECT id FROM refmod_entries ORDER BY id LIMIT 1').get() as { id: number }).id
    const anyFile = (db.prepare('SELECT entry_id, file_id FROM refmod_entry_files ORDER BY entry_id LIMIT 1').get() as { entry_id: number; file_id: string })
    const narrowReads: Array<[string, string]> = [['GET', `/${anyEntry}`], ['GET', '/unregistered'], ['GET', '/presence'], ['GET', '/workflows'], ['POST', '/export']]
    for (const keys of [['generation.execute'], ['workflows.view'], ['images.view']]) {
      only(keys)
      assert.equal((await call('GET', '/')).status, 200, `the list stays open to the Director picker: ${keys}`)
      for (const [method, route] of narrowReads) {
        assert.equal((await call(method, route, method === 'POST' ? { ids: [anyEntry] } : undefined)).status, 403, `${method} ${route} needs characters.view (${keys})`)
      }
    }
    only(['generation.execute'])
    assert.equal((await call('POST', '/', { name: 'forbidden' })).status, 403)
    assert.equal((await fetch(`${base}/${anyFile.entry_id}/files/${anyFile.file_id}`)).status, 403, 'media needs images.view')
    only(['characters.view'])
    const withMedia = (db.prepare('SELECT entry_id FROM refmod_entry_files ORDER BY entry_id LIMIT 1').get() as { entry_id: number }).entry_id
    for (const [method, route] of narrowReads) {
      const response = await fetch(`${base}${route}`, method === 'POST'
        ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [withMedia] }) } : { method })
      assert.equal(response.status, 200, `${method} ${route} with characters.view`)
      const body = Buffer.from(await response.arrayBuffer())
      if (method === 'POST') {
        const AdmZip = (await import('adm-zip')).default
        assert.deepEqual(new AdmZip(body).getEntries().map((entry) => entry.entryName), ['refmods.json'], 'the export carries no sources without images.view')
      }
    }
    assert.equal((await fetch(`${base}/${anyFile.entry_id}/files/${anyFile.file_id}`)).status, 403, 'media still needs images.view')
    assert.equal((await call('PATCH', `/${anyEntry}`, { revision: 1 })).status, 403)
    // A library image needs images.view even for an editor.
    only(['characters.view', 'characters.edit'])
    const control = db.prepare('SELECT id, revision FROM refmod_entries ORDER BY id LIMIT 1').get() as { id: number; revision: number }
    const allowed = await call('PATCH', `/${control.id}`, { revision: control.revision, description: 'Editor without images.view' })
    assert.equal(allowed.status, 200, `an editor passes the route guard: ${JSON.stringify(allowed.body)}`)
    const target = db.prepare('SELECT id, revision FROM refmod_entries WHERE id = ?').get(control.id) as { id: number; revision: number }
    const libraryOnly = {
      ...JSON.parse(template.workflow_json)[1].inputs,
      timeline_data: JSON.stringify({ items: [{ id: 'library', type: 'image', prompt: 'Library pose' }] }),
      __conai_minimax_h3_director: { assets: { library: { composite_hash: 'd'.repeat(48) } } },
    }
    const hidden = await call('PATCH', `/${target.id}`, { revision: target.revision, values: { director: libraryOnly } })
    assert.equal(hidden.status, 403, JSON.stringify(hidden.body))
    assert.match(hidden.body.error, /images\.view/, 'refused by the library-source rule, not the route guard')
    assert.equal((db.prepare('SELECT revision FROM refmod_entries WHERE id = ?').get(target.id) as { revision: number }).revision, target.revision, 'nothing was saved')
    only(['characters.edit'])
    assert.equal((await call('POST', `/${anyEntry}/build`)).status, 403, 'building also needs generation.execute')
    only([])
    assert.ok([401, 403].includes((await call('GET', '/')).status))
    assert.ok([401, 403].includes((await call('GET', '/presence')).status))
    sub.mock.restoreAll()
  })

  await t.test('MCP tools: list, get, save with friendly inputs, keep sources, adopt, build, permission gates', async (sub) => {
    const { createMcpServer } = await import('../src/mcp/server')
    const { ALL_MCP_HTTP_SCOPES } = await import('../src/mcp/context')
    const { Client, InMemoryTransport } = await import('@modelcontextprotocol/client')
    const mcp = createMcpServer({ scopes: [...ALL_MCP_HTTP_SCOPES], source: 'http', requester: { accountId: null, accountType: 'admin' } })
    const client = new Client({ name: 'refmod-entries-test', version: '1' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)])
    sub.after(async () => { await client.close(); await mcp.close() })
    const tool = async (name: string, args: Record<string, unknown> = {}) => {
      const result = await client.callTool({ name, arguments: args }) as { isError?: boolean; content: Array<{ text: string }> }
      const text = result.content[0]?.text ?? ''
      return result.isError ? { error: text, text } : { data: JSON.parse(text), text }
    }
    const listed = (await client.listTools()).tools.map((entry) => entry.name)
    for (const name of ['list_refmod_entries', 'get_refmod_entry', 'save_refmod_entry', 'adopt_refmod', 'build_refmod']) assert.ok(listed.includes(name), name)
    const filesOf = (id: number) => (db.prepare('SELECT file_id FROM refmod_entry_files WHERE entry_id = ? ORDER BY file_id').all(id) as Array<{ file_id: string }>).map((row) => row.file_id)

    // Create with friendly inputs: a library image by composite_hash and a data URL, both copied into the file store.
    const libraryBytes = fs.readFileSync(path.join(runtimePaths.uploadsDir, 'entry-library.png'))
    const sketch = await png('#22cc88')
    const created = await tool('save_refmod_entry', {
      name: 'mcp-hero', concept_type: 'identity', description: 'From MCP', keywords: ['mcp', 'MCP', 'face'],
      inputs: {
        director: { media: [
          { type: 'image', composite_hash: 'd'.repeat(48), prompt: 'Library face' },
          { type: 'image', file_name: 'sketch.png', data_url: `data:image/png;base64,${sketch.toString('base64')}`, prompt: 'Sketch' },
        ] },
        video_vae: 'video.vae', audio_vae: 'audio.vae',
      },
    })
    assert.ok(created.data, created.error)
    const entry = created.data
    assert.deepEqual([entry.name, entry.concept, entry.description, entry.keywords, entry.buildable], ['mcp-hero', 'identity', 'From MCP', ['MCP', 'face'], true])
    assert.deepEqual(entry.members.map((member: any) => [member.kind, member.description]), [['image', 'Library face'], ['image', 'Sketch']])
    const files = filesOf(entry.id)
    assert.equal(files.length, 2)
    const stored = files.map((fileId) => fs.readFileSync(FileStoreService.resolveFile(owner, fileId).filePath))
    assert.ok(stored.some((bytes) => bytes.equals(libraryBytes)), 'the library image is copied')
    assert.ok(stored.some((bytes) => bytes.equals(sketch)), 'the data URL is copied')
    assert.equal((await tool('save_refmod_entry', { name: 'MCP-hero' })).error?.includes('name_conflict'), true, 'a taken name is refused with its code')

    // list: only the whitelisted fields; include_server adds on_server and the unregistered names.
    const page = (await tool('list_refmod_entries', { query: 'mcp' })).data
    assert.equal(page.total, 1)
    assert.deepEqual(Object.keys(page.items[0]).sort(), ['buildable', 'concept', 'description', 'id', 'issues', 'lastBuiltAt', 'members', 'name', 'pending'])
    assert.deepEqual(page.items[0].members, { image: 2 })
    serverLibrary.push({ name: 'server/mcp-only', kind: 'image', kinds: ['image'], members: [{ kind: 'image', description: 'Only on the server' }], concept: 'style', description: 'Server MCP bundle', tokens: 2, mtime: 2 })
    const withServer = (await tool('list_refmod_entries', { query: 'mcp', include_server: true })).data
    assert.equal(withServer.items[0].on_server, false)
    assert.equal(withServer.server.status, 'ok')
    assert.deepEqual(withServer.unregistered.server_only, ['server/mcp-only'])

    // get: the workflow fields with current values; sources show as file name, type and kind, never their file ids.
    const read = await tool('get_refmod_entry', { entry_id: entry.id })
    assert.ok(read.data, read.error)
    for (const fileId of files) assert.ok(!read.text.includes(fileId), 'no entry file id reaches the model')
    assert.ok(!read.text.includes('refmod-entry-file'))
    const directorField = read.data.fields.find((field: any) => field.id === 'director')
    assert.equal(directorField.node_editor, 'minimax_h3_director_dasiwa')
    assert.ok(directorField.value_schema, 'described as get_workflow_details describes it')
    const media = directorField.value.media
    assert.deepEqual(media.map((item: any) => [item.prompt, item.source.mime_type, item.source.kind]), [['Library face', 'image/png', 'image'], ['Sketch', 'image/png', 'image']])
    assert.equal(read.data.fields.find((field: any) => field.id === 'video_vae').value, 'video.vae')

    // Keep-existing sources: the items echoed back unchanged keep every file; { id } plus a change keeps that file too.
    const echoed = await tool('save_refmod_entry', { entry_id: entry.id, revision: read.data.revision, inputs: { director: { media } } })
    assert.ok(echoed.data, echoed.error)
    assert.deepEqual(filesOf(entry.id), files, 'an echoed Director keeps its files')
    const renamed = await tool('save_refmod_entry', { entry_id: entry.id, revision: echoed.data.revision, inputs: { director: { media: [{ id: media[0].id }, { id: media[1].id, prompt: 'Sketch v2' }] } } })
    assert.ok(renamed.data, renamed.error)
    assert.deepEqual(filesOf(entry.id), files)
    assert.deepEqual(renamed.data.members.map((member: any) => member.description), ['Library face', 'Sketch v2'])
    const stale = await tool('save_refmod_entry', { entry_id: entry.id, revision: read.data.revision, description: 'stale' })
    assert.match(stale.error ?? '', /revision_conflict/)
    const dropped = await tool('save_refmod_entry', { entry_id: entry.id, revision: renamed.data.revision, inputs: { director: { media: [{ id: media[1].id }] } } })
    assert.ok(dropped.data, dropped.error)
    const kept = filesOf(entry.id)
    assert.equal(kept.length, 1)
    for (const fileId of files.filter((id) => !kept.includes(id))) assert.throws(() => FileStoreService.get(owner, fileId), /찾을 수 없어/, 'a source no longer listed is released')
    const restored = await tool('save_refmod_entry', { entry_id: entry.id, revision: dropped.data.revision, inputs: { director: { media: [{ id: media[1].id }, { type: 'image', composite_hash: 'd'.repeat(48), prompt: 'Library face again' }] } } })
    assert.ok(restored.data, restored.error)
    assert.equal(filesOf(entry.id).length, 2)

    // adopt: a server-only name becomes a metadata-only entry.
    const adopted = await tool('adopt_refmod', { name: 'server/mcp-only' })
    assert.ok(adopted.data, adopted.error)
    assert.deepEqual(adopted.data.created.map((item: any) => item.name), ['server/mcp-only'])
    assert.ok((await tool('adopt_refmod', {})).error, 'one of record_id or name is needed')

    // build: a queued job carrying the server-issued entry link; the run links its record to the entry.
    reportedName = 'mcp-hero'
    uploads = 0
    const built = await tool('build_refmod', { entry_id: entry.id })
    assert.ok(built.data, built.error)
    const jobId = built.data.job_id
    assert.equal(built.data.next, 'get_generation_job')
    const job = GenerationQueueModel.findById(jobId)!
    const payload = JSON.parse(job.request_payload)
    assert.equal(payload.__conaiRefModEntry.entryId, entry.id)
    assert.deepEqual(Object.values(payload.__conaiRefModEntry.files).sort(), filesOf(entry.id))
    assert.match((await tool('build_refmod', { entry_id: entry.id })).error ?? '', /pending/)
    const followed = await tool('get_generation_job', { job_id: jobId })
    assert.equal(followed.data?.id, jobId, followed.error)
    db.prepare("UPDATE generation_queue_jobs SET status = 'dispatching', assigned_server_id = ? WHERE id = ?").run(serverId, jobId)
    const transitionJob = (id: number, status: string) => { db.prepare('UPDATE generation_queue_jobs SET status = ? WHERE id = ?').run(status, id); return null }
    await executeGenerationQueueJob(GenerationQueueModel.findById(jobId)!, server, { transitionJob, attemptUpstreamCancellation: async () => undefined })
    const record = db.prepare('SELECT status, entry_id FROM minimax_refmod_records WHERE queue_job_id = ?').get(jobId) as { status: string; entry_id: number }
    assert.deepEqual([record.status, record.entry_id], ['saved', entry.id])
    db.prepare("UPDATE generation_queue_jobs SET status = 'completed' WHERE id = ?").run(jobId)
    assert.ok((await tool('list_refmod_entries', { query: 'mcp-hero' })).data.items[0].lastBuiltAt, 'the build is recorded on the entry')

    // Permission gates: the same keys as the REST routes, checked again at call time.
    const access = AuthAccessControlService.resolveBootstrapAccess()
    const only = (keys: string[]) => {
      sub.mock.restoreAll()
      sub.mock.method(AuthAccessControlService, 'resolveBootstrapAccess', () => ({ ...access, permissionKeys: access.permissionKeys.filter((key) => keys.includes(key)) }))
    }
    const current = () => (db.prepare('SELECT revision FROM refmod_entries WHERE id = ?').get(entry.id) as { revision: number }).revision
    only(['generation.execute', 'workflows.view'])
    assert.ok((await tool('list_refmod_entries')).error, 'reads need characters.view')
    assert.ok((await tool('get_refmod_entry', { entry_id: entry.id })).error)
    only(['characters.view'])
    assert.ok((await tool('list_refmod_entries')).data)
    assert.ok((await tool('save_refmod_entry', { entry_id: entry.id, revision: current(), description: 'viewer' })).error, 'saving needs characters.edit')
    assert.ok((await tool('adopt_refmod', { name: 'server/only' })).error)
    only(['characters.view', 'characters.edit'])
    assert.ok((await tool('build_refmod', { entry_id: entry.id })).error, 'building also needs generation.execute')
    const editorSave = await tool('save_refmod_entry', { entry_id: entry.id, revision: current(), description: 'Editor without images.view' })
    assert.ok(editorSave.data, editorSave.error)
    const libraryRefused = await tool('save_refmod_entry', { entry_id: entry.id, revision: current(), inputs: { director: { media: [{ type: 'image', composite_hash: 'd'.repeat(48) }] } } })
    assert.match(libraryRefused.error ?? '', /images\.view/, 'a library image needs images.view')
    only(['characters.edit', 'generation.execute'])
    assert.ok((await tool('get_refmod_entry', { entry_id: entry.id })).error, 'the build keys do not grant reads')
    sub.mock.restoreAll()
  })
  await t.test('names are plain file names: the DaSiWa rule, create, rename, MCP save; a registered sub-folder name blocks the build', async () => {
    const { refModNameProblem } = await import('@conai/shared')
    for (const name of ['영웅', 'COM0', 'a.b', 'a b', 'hero-v2', 'x'.repeat(200), '가'.repeat(66)]) assert.equal(refModNameProblem(name), null, name)
    const refused: Array<[string, string]> = [
      ['', 'empty'], ['a/b', 'characters'], ['a\\b', 'characters'], ['a:b', 'characters'], ['a%b', 'characters'], ['a\u0007b', 'characters'],
      ['.a', 'leading-dot'], ['a.', 'trailing'], ['a ', 'trailing'], [' a', 'edge-space'],
      ['CON', 'reserved'], ['con.txt', 'reserved'], ['LPT1', 'reserved'], ['com¹', 'reserved'], ['NUL .x', 'reserved'], ['가'.repeat(67), 'too-long'],
    ]
    for (const [name, problem] of refused) assert.equal(refModNameProblem(name), problem, JSON.stringify(name))

    const pathName = await call('POST', '/', { name: 'a/b' })
    assert.equal(pathName.status, 400)
    assert.equal(pathName.body.code, 'invalid_name')
    assert.ok(!/폴더|folder/.test(pathName.body.error), pathName.body.error)
    for (const name of ['CON', 'a:b', '.hidden']) assert.equal((await call('POST', '/', { name })).body.code, 'invalid_name', name)
    assert.equal((await call('POST', '/', { name: '  spaced  ' })).body.data.name, 'spaced', 'a typed name is trimmed first')
    const plain = (await call('POST', '/', { name: 'plain-name' })).body.data
    assert.equal((await call('PATCH', `/${plain.id}`, { revision: plain.revision, name: 'sub/plain' })).body.code, 'invalid_name', 'a rename is checked')
    assert.equal((await call('PATCH', `/${plain.id}`, { revision: plain.revision, values: { name: 'sub/plain' } })).body.code, 'invalid_name', 'the name field is checked')

    // Adopting a server name keeps it as the server reports it; the entry shows why it cannot be built.
    serverLibrary.push({ name: 'sub/name', kind: 'image', kinds: ['image'], members: [{ kind: 'image', description: 'Nested' }], concept: 'style', description: 'Nested bundle', tokens: 2, mtime: 3 })
    const adopted = await call('POST', '/adopt', { names: ['sub/name'] })
    assert.equal(adopted.status, 200, JSON.stringify(adopted.body))
    assert.deepEqual(adopted.body.data.created.map((item: any) => item.name), ['sub/name'])
    const nested = (await call('GET', `/${adopted.body.data.created[0].id}`)).body.data
    assert.equal(nested.buildable, false)
    assert.deepEqual(nested.issues.map((issue: any) => [issue.code, issue.severity]), [['name-not-plain', 'blocking']])
    assert.deepEqual([nested.form.values.video_vae, nested.form.values.audio_vae], ['video.vae', 'audio.vae'], 'an adopted entry starts with the last used inputs')
    const nestedBuild = await call('POST', `/${nested.id}/build`)
    assert.deepEqual([nestedBuild.status, nestedBuild.body.code, nestedBuild.body.issues.map((issue: any) => issue.code)], [409, 'blocked', ['name-not-plain']])
    assert.match(nestedBuild.body.error, /이름이 파일 이름 하나가 아니야/)
    const kept = await call('PATCH', `/${nested.id}`, { revision: nested.revision, name: 'sub/name', description: 'Still nested' })
    assert.equal(kept.status, 200, `the stored name passes unchanged: ${JSON.stringify(kept.body)}`)
    const fixed = await call('PATCH', `/${nested.id}`, { revision: kept.body.data.revision, name: 'sub-name' })
    assert.equal(fixed.status, 200, JSON.stringify(fixed.body))
    assert.deepEqual(fixed.body.data.issues, [])
  })

  await t.test('required inputs block the build and are named; a new entry starts with the last used inputs', async () => {
    const freshId = WorkflowModel.create({ ...template, name: 'Fresh RefMod' })
    const extrasOf = (id: number) => JSON.parse((db.prepare('SELECT extra_values FROM refmod_entries WHERE id = ?').get(id) as { extra_values: string }).extra_values)
    const first = (await call('POST', '/', { name: 'fresh-one', workflowId: freshId })).body.data
    const emptyIssue = { code: 'required-input-empty', severity: 'blocking', fields: [{ id: 'video_vae', label: 'Video VAE' }, { id: 'audio_vae', label: 'Audio VAE' }] }
    assert.deepEqual(first.issues, [emptyIssue], 'nothing to carry over on a new workflow')
    assert.equal(first.buildable, false)
    const refused = await call('POST', `/${first.id}/build`)
    assert.deepEqual([refused.status, refused.body.code, refused.body.issues], [409, 'blocked', [emptyIssue]])
    assert.equal(refused.body.error, '이 RefMod는 아직 만들 수 없어: ‘Video VAE’, ‘Audio VAE’ 입력을 채워줘.', 'the refusal names the inputs')
    const listedFirst = (await call('GET', '/?query=fresh-one')).body.data.items[0]
    assert.deepEqual([listedFirst.buildable, listedFirst.issues], [false, [emptyIssue]])
    const filled = await call('PATCH', `/${first.id}`, { revision: first.revision, description: 'First only', values: { video_vae: 'video.vae', audio_vae: 'audio.vae' } })
    assert.equal(filled.status, 200, JSON.stringify(filled.body))
    assert.deepEqual([filled.body.data.buildable, filled.body.data.issues], [true, []])

    // Copied into the new entry's own values when it is created; roles and the Director never are.
    const second = (await call('POST', '/', { name: 'fresh-two', workflowId: freshId })).body.data
    assert.deepEqual(extrasOf(second.id), { video_vae: 'video.vae', audio_vae: 'audio.vae' }, 'stored, not read through')
    assert.deepEqual([second.buildable, second.issues], [true, []])
    assert.equal(second.description, '')
    assert.equal(second.form.values.name, 'fresh-two')
    assert.deepEqual(second.members, [])
    assert.ok(!JSON.stringify(second.form.values.director ?? {}).includes('refmod-entry-file'), 'no Director source is shared')
    // A value no longer among the options is never copied.
    db.prepare('UPDATE refmod_entries SET extra_values = ? WHERE id IN (?, ?)').run(JSON.stringify({ video_vae: 'gone.vae', audio_vae: 'audio.vae' }), first.id, second.id)
    const third = (await call('POST', '/', { name: 'fresh-three', workflowId: freshId })).body.data
    assert.deepEqual(extrasOf(third.id), { audio_vae: 'audio.vae' })
    assert.deepEqual(third.issues, [{ ...emptyIssue, fields: [{ id: 'video_vae', label: 'Video VAE' }] }])
    assert.deepEqual(extrasOf(first.id).video_vae, 'gone.vae', 'other entries keep their values')
    // Relinking an entry to another workflow carries over too.
    const relinked = await call('PATCH', `/${third.id}`, { revision: third.revision, workflowId: templateId })
    assert.equal(relinked.status, 200, JSON.stringify(relinked.body))
    assert.equal(relinked.body.data.form.values.video_vae, 'video.vae', 'the response already shows the carried value')
    assert.equal(extrasOf(third.id).video_vae, 'video.vae')
    assert.deepEqual(relinked.body.data.issues, [])

    // A hidden required input and a required input with a default raise nothing.
    const quietId = WorkflowModel.create({ ...template, name: 'Quiet RefMod', marked_fields: template.marked_fields!.map((field) =>
      field.id === 'video_vae' ? { ...field, hidden: true } : field.id === 'audio_vae' ? { ...field, default_value: 'audio.vae' } : field) })
    const quiet = (await call('POST', '/', { name: 'quiet-one', workflowId: quietId })).body.data
    assert.deepEqual([quiet.buildable, quiet.issues], [true, []])
    assert.deepEqual(extrasOf(quiet.id), {}, 'a default is not copied over')

    // A bundle imported as a new entry starts with the last used inputs of its workflow.
    const exported = await fetch(`${base}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [quiet.id] }) })
    const zip = Buffer.from(await exported.arrayBuffer())
    assert.equal((await call('DELETE', `/${quiet.id}`)).status, 200)
    const form = new FormData()
    form.append('conflict', 'skip')
    form.append('file', new Blob([zip], { type: 'application/zip' }), 'refmods.zip')
    const imported = await fetch(`${base}/import`, { method: 'POST', body: form })
    assert.equal(imported.status, 201)
    const back = (await call('GET', '/?query=quiet-one')).body.data.items[0]
    const detail = (await call('GET', `/${back.id}`)).body.data
    assert.equal(detail.workflowId, templateId)
    assert.deepEqual([detail.form.values.video_vae, detail.form.values.audio_vae], ['video.vae', 'audio.vae'])
  })

  await t.test('a name already on the server is not built again; an unreadable server does not block; the run failure text reaches the record', async () => {
    const hero = (await call('GET', '/?query=mcp-hero')).body.data.items[0]
    assert.equal(hero.buildable, true)
    serverLibrary.push({ name: 'MCP-HERO', kind: 'image', kinds: ['image'], members: [], concept: 'identity', description: '', tokens: 1, mtime: 4 })
    const taken = await call('POST', `/${hero.id}/build`)
    assert.deepEqual([taken.status, taken.body.code], [409, 'exists_on_server'], 'case-insensitive, as the screen matches')
    assert.equal(taken.body.error, '대표 서버에 같은 이름의 RefMod가 이미 있어. ComfyUI는 덮어쓰지 않아 — 이름을 바꾸거나 서버에서 그 파일을 지운 다음 만들어줘.')
    const { createMcpServer } = await import('../src/mcp/server')
    const { ALL_MCP_HTTP_SCOPES } = await import('../src/mcp/context')
    const { Client, InMemoryTransport } = await import('@modelcontextprotocol/client')
    const mcp = createMcpServer({ scopes: [...ALL_MCP_HTTP_SCOPES], source: 'http', requester: { accountId: null, accountType: 'admin' } })
    const client = new Client({ name: 'refmod-entries-readiness', version: '1' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)])
    try {
      const tool = async (name: string, args: Record<string, unknown>) => {
        const result = await client.callTool({ name, arguments: args }) as { isError?: boolean; content: Array<{ text: string }> }
        return { isError: Boolean(result.isError), text: result.content[0]?.text ?? '' }
      }
      const mcpBuild = await tool('build_refmod', { entry_id: hero.id })
      assert.ok(mcpBuild.isError && mcpBuild.text.includes('exists_on_server') && mcpBuild.text.includes('ComfyUI는 덮어쓰지 않아'), mcpBuild.text)
      const mcpPath = await tool('save_refmod_entry', { name: 'mcp/path' })
      assert.ok(mcpPath.isError && mcpPath.text.includes('invalid_name'), mcpPath.text)
      const fresh = (await call('GET', '/?query=fresh-three')).body.data.items[0]
      db.prepare('UPDATE refmod_entries SET extra_values = ? WHERE id = ?').run('{}', fresh.id)
      const got = JSON.parse((await tool('get_refmod_entry', { entry_id: fresh.id })).text)
      assert.deepEqual(got.issues.find((issue: any) => issue.code === 'required-input-empty')?.fields.map((field: any) => field.id), ['video_vae', 'audio_vae'], 'get returns the whole issue')
      const listed = JSON.parse((await tool('list_refmod_entries', { query: 'fresh-three' })).text)
      assert.deepEqual(listed.items[0].issues, ['required-input-empty'], 'the list keeps codes')
      const blocked = await tool('build_refmod', { entry_id: fresh.id })
      assert.ok(blocked.isError && blocked.text.includes('required-input-empty (video_vae, audio_vae)'), blocked.text)
    } finally {
      await client.close()
      await mcp.close()
    }

    presenceDown = true
    const unreadable = await call('POST', `/${hero.id}/build`)
    presenceDown = false
    assert.equal(unreadable.status, 201, JSON.stringify(unreadable.body))
    db.prepare("UPDATE generation_queue_jobs SET status = 'cancelled' WHERE id = ?").run(unreadable.body.data.jobId)

    serverLibrary.splice(serverLibrary.findIndex((item) => item.name === 'MCP-HERO'), 1)
    const queued = await call('POST', `/${hero.id}/build`)
    assert.equal(queued.status, 201, JSON.stringify(queued.body))
    const { jobId } = queued.body.data
    db.prepare("UPDATE generation_queue_jobs SET status = 'dispatching', assigned_server_id = ? WHERE id = ?").run(serverId, jobId)
    const transitionJob = (id: number, status: string) => { db.prepare('UPDATE generation_queue_jobs SET status = ? WHERE id = ?').run(status, id); return null }
    failExecution = true
    await assert.rejects(executeGenerationQueueJob(GenerationQueueModel.findById(jobId)!, server, { transitionJob, attemptUpstreamCancellation: async () => undefined }))
    failExecution = false
    db.prepare("UPDATE generation_queue_jobs SET status = 'failed' WHERE id = ?").run(jobId)
    const run = (await call('GET', `/${hero.id}`)).body.data.records[0]
    assert.deepEqual([run.status, run.error], ['failed', 'ComfyUI execution error: node 4 (DaSiWaH3RefModExport) ValueError: RefMod name must be a safe plain basename'])
  })

  await t.test('record failure text: the queue text bounded, one line, no paths; any other failure stays generic', async () => {
    const { captureRefModRecords, failRefModRecords } = await import('../src/services/comfyui/refmodRecords')
    const capture = async () => {
      const bytes = await png('#5555aa')
      const director = {
        ...JSON.parse(template.workflow_json)[1].inputs,
        timeline_data: JSON.stringify({ items: [{ id: 'upload', type: 'image', prompt: 'Failure text' }] }),
        __conai_minimax_h3_director: { assets: { upload: { fileName: 'fail.png', dataUrl: `data:image/png;base64,${bytes.toString('base64')}` } } },
      }
      return captureRefModRecords({ workflowJson: template.workflow_json, markedFields: template.marked_fields!, promptData: { director }, serverId, workflowId: templateId })
    }
    const publicError = async (id: number) => (await (await fetch(base.replace('/refmod-entries', '/refmods'))).json() as any).data.find((record: any) => record.id === id).error
    const long = await capture()
    await failRefModRecords(long, new Error('ignored'), `Out of memory ${'x'.repeat(600)}`)
    const longText = await publicError(long[0].id)
    assert.equal(longText.length, 500)
    assert.ok(longText.startsWith('Out of memory x') && longText.endsWith('…'))
    const pathed = await capture()
    await failRefModRecords(pathed, new Error('ignored'), 'Missing D:\\Models\\vae\\x.safetensors\nand /opt/comfy/models/y.bin, not models/refmods/hero at http://127.0.0.1:8188')
    assert.equal(await publicError(pathed[0].id), 'Missing <path> and <path>, not models/refmods/hero at http://127.0.0.1:8188')
    const other = await capture()
    await failRefModRecords(other, new Error('secret detail from somewhere else'))
    assert.equal(await publicError(other[0].id), 'RefMod creation failed or was cancelled. See server logs for details.')
  })

  await t.test('the export template takes the server VAE names inside folders, case-insensitively', () => {
    const fields = buildRefModExportTemplate({ vaeNames: ['H3\\MiniMax_H3_Video_VAE_fp16.safetensors', 'h3/minimax_h3_audio_vae_fp32.safetensors', 'other.vae'] }).marked_fields!
    assert.deepEqual(['video_vae', 'audio_vae'].map((id) => fields.find((field) => field.id === id)!.default_value),
      ['H3\\MiniMax_H3_Video_VAE_fp16.safetensors', 'h3/minimax_h3_audio_vae_fp32.safetensors'])
  })
})
