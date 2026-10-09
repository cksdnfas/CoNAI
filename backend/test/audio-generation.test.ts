import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { test } from 'node:test'

/**
 * Audio workspace, phase 2: the workflow kind, audio workflow bindings, the /object_info compatibility check, audio
 * orders through the real generation queue against a stub ComfyUI, the executor's audio output sink (and that image
 * jobs still land in the image library), crash recovery, retry, cancel, REST and MCP, and the chat reference shape.
 */
test('audio generation: workflows, orders, queue sink, REST, MCP and chat references', { timeout: 300000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-audio-generation-'))
  process.env.RUNTIME_BASE_PATH = root
  for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
    process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
  }
  process.env.FRONTEND_DIST_PATH = path.join(root, 'no-frontend')

  const authModule = await import('../src/database/authDb')
  authModule.initializeAuthDb()
  const auth = authModule.getAuthDb()
  const main = await import('../src/database/init')
  await main.initializeDatabase()
  const user = await import('../src/database/userSettingsDb')
  user.initializeUserSettingsDb()
  ;(await import('../src/database/apiGenerationDb')).initializeApiGenerationDb()
  const audioDbModule = await import('../src/database/audioDb')
  const audioDb = audioDbModule.initializeAudioDb()
  const { GenerationQueueService } = await import('../src/services/generationQueueService')
  t.after(async () => {
    GenerationQueueService.stop()
    auth.close()
    user.closeUserSettingsDb()
    audioDbModule.closeAudioDb()
    main.closeDatabase()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('conai-audio-generation-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  const service = await import('../src/services/audio/audioService')
  const workflows = await import('../src/services/audio/audioWorkflows')
  const orders = await import('../src/services/audio/audioOrders')
  const store = await import('../src/services/audio/audioStore')
  const { WorkflowModel } = await import('../src/models/Workflow')
  const { ComfyUIServerModel } = await import('../src/models/ComfyUIServer')
  const { GenerationQueueModel } = await import('../src/models/GenerationQueue')

  // ---------------------------------------------------------------- stub ComfyUI
  const ffmpeg = createRequire(__filename)('ffmpeg-static') as string
  const fixtures = path.join(root, 'fixtures')
  fs.mkdirSync(fixtures, { recursive: true })
  const wavPath = path.join(fixtures, 'out.flac')
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=500:duration=0.3', '-ac', '1', '-ar', '22050', wavPath])
  const sharp = (await import('sharp')).default
  const pngBytes = await sharp({ create: { width: 16, height: 12, channels: 3, background: { r: 200, g: 40, b: 40 } } }).png().toBuffer()

  type Prompt = { id: string; graph: Record<string, { class_type: string; inputs: Record<string, unknown> }>; done: boolean; releaseAt: number }
  const prompts = new Map<string, Prompt>()
  const received: Prompt[] = []
  const objectInfo = (models: string[]): Record<string, unknown> => ({
    CheckpointLoaderSimple: { input: { required: { ckpt_name: [models] } } },
    CLIPLoader: { input: { required: { clip_name: [['t5gemma_b_b_ul2.safetensors']], type: [['stable_audio', 'sd3']] }, optional: { device: [['default', 'cpu']] } } },
    CLIPTextEncode: { input: { required: { text: ['STRING', { multiline: true }], clip: ['CLIP'] } } },
    EmptyLatentAudio: { input: { required: { seconds: ['FLOAT', { default: 47.6, min: 1, max: 47.6, step: 0.1 }], batch_size: ['INT', { default: 1, min: 1, max: 4096 }] } } },
    KSampler: { input: { required: { model: ['MODEL'], seed: ['INT', { min: 0, max: 18446744073709551615 }], steps: ['INT', { min: 1, max: 10000 }], cfg: ['FLOAT', { min: 0, max: 100 }], sampler_name: [['euler', 'lcm']], scheduler: [['simple', 'karras']], positive: ['CONDITIONING'], negative: ['CONDITIONING'], latent_image: ['LATENT'], denoise: ['FLOAT', { min: 0, max: 1 }] } } },
    VAEDecodeAudio: { input: { required: { samples: ['LATENT'], vae: ['VAE'] } } },
    SaveAudioAdvanced: { input: { required: { audio: ['AUDIO'], filename_prefix: ['STRING', {}], format: ['COMBO', { options: ['flac', 'mp3', 'opus'] }] } } },
    'Seed (rgthree)': { input: { required: { seed: ['INT', { min: -1125899906842624, max: 1125899906842624 }] } } },
    SaveImage: { input: { required: { images: ['IMAGE'], filename_prefix: ['STRING', {}] } } },
    EmptyImage: { input: { required: { width: ['INT', { min: 1, max: 8192 }], height: ['INT', { min: 1, max: 8192 }] } } },
    // ComfyUI reports a CustomCombo's choices as an empty list: they travel as the node's own option inputs.
    CustomCombo: { input: { required: { choice: ['COMBO', { multiselect: false, options: [] }] } } },
  })
  const startStub = async (models: string[]) => {
    const info = objectInfo(models)
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://stub')
      const json = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
      if (req.method === 'GET' && url.pathname.startsWith('/object_info/')) {
        const name = decodeURIComponent(url.pathname.slice('/object_info/'.length))
        return json(200, info[name] ? { [name]: info[name] } : {})
      }
      if (req.method === 'POST' && url.pathname === '/prompt') {
        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', () => {
          const parsed = JSON.parse(body) as { prompt: Prompt['graph'] }
          const text = JSON.stringify(parsed.prompt)
          const prompt: Prompt = { id: crypto.randomUUID(), graph: parsed.prompt, done: false, releaseAt: text.includes('SLOW') ? Date.now() + 60_000 : 0 }
          prompts.set(prompt.id, prompt)
          received.push(prompt)
          json(200, { prompt_id: prompt.id, number: received.length, node_errors: {} })
        })
        return
      }
      if (req.method === 'GET' && url.pathname.startsWith('/history/')) {
        const prompt = prompts.get(url.pathname.slice('/history/'.length))
        if (!prompt || Date.now() < prompt.releaseAt) return json(200, {})
        const text = JSON.stringify(prompt.graph)
        const isAudio = Object.values(prompt.graph).some((node) => node.class_type === 'SaveAudioAdvanced')
        const outputs = text.includes('NOAUDIO') ? { 6: { images: [] } }
          : text.includes('MIXED') ? {
            1: { images: [{ filename: `img_${prompt.id.slice(0, 6)}.png`, subfolder: '', type: 'output' }] },
            8: { audio: [{ filename: `mix_${prompt.id.slice(0, 6)}.flac`, subfolder: 'audio', type: 'output' }] },
          }
          : isAudio ? { 8: { audio: [{ filename: `sfx_${prompt.id.slice(0, 6)}.flac`, subfolder: 'audio/conai_sfx', type: 'output' }] } }
            : { 1: { images: [{ filename: `img_${prompt.id.slice(0, 6)}.png`, subfolder: '', type: 'output' }] } }
        return json(200, { [prompt.id]: { prompt: [], outputs, status: { status_str: 'success', completed: true, messages: [] } } })
      }
      if (req.method === 'GET' && url.pathname === '/history') return json(200, {})
      if (req.method === 'GET' && url.pathname === '/queue') return json(200, { queue_running: [], queue_pending: [] })
      if (req.method === 'GET' && url.pathname === '/system_stats') return json(200, { system: {}, devices: [] })
      if (req.method === 'GET' && url.pathname === '/view') {
        const name = url.searchParams.get('filename') ?? ''
        res.writeHead(200, { 'Content-Type': name.endsWith('.png') ? 'image/png' : 'audio/flac' })
        res.end(name.endsWith('.png') ? pngBytes : fs.readFileSync(wavPath))
        return
      }
      if (req.method === 'POST') return json(200, {})
      json(404, { error: 'not found' })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()) }))
    return `http://127.0.0.1:${(server.address() as { port: number }).port}`
  }
  const goodEndpoint = await startStub(['stable_audio_3_medium_base.safetensors', 'sdxl.safetensors'])
  const badEndpoint = await startStub(['other_model.safetensors'])
  const deadEndpoint = 'http://127.0.0.1:9' // discard port: nothing answers

  const goodServerId = ComfyUIServerModel.create({ name: 'stub-good', endpoint: goodEndpoint, capacity: 1, is_active: true })
  const badServerId = ComfyUIServerModel.create({ name: 'stub-bad', endpoint: badEndpoint, capacity: 1, is_active: true })
  const deadServerId = ComfyUIServerModel.create({ name: 'stub-dead', endpoint: deadEndpoint, capacity: 1, is_active: true })

  // ---------------------------------------------------------------- workflow kind
  const imageWorkflowId = WorkflowModel.create({
    name: 'image wf',
    workflow_json: JSON.stringify({ 1: { class_type: 'SaveImage', inputs: { filename_prefix: 'x', images: ['2', 0] } }, 2: { class_type: 'EmptyImage', inputs: { width: 16, height: 12 } } }),
    marked_fields: [],
  })

  await t.test('workflow kind defaults to image and filters lists', async () => {
    assert.equal(WorkflowModel.findById(imageWorkflowId)?.kind, 'image')
    const userDb = user.getUserSettingsDb()
    const column = (userDb.prepare("SELECT dflt_value, [notnull] AS nn FROM pragma_table_info('workflows') WHERE name = 'kind'").get() as { dflt_value: string; nn: number })
    assert.equal(column.dflt_value, "'image'")
    assert.equal(column.nn, 1)
  })

  const defaultWorkflow = await workflows.addDefaultStableAudioWorkflow()

  await t.test('the default Stable Audio workflow is an audio workflow, bound by role and hidden from image lists', () => {
    assert.equal(WorkflowModel.findById(defaultWorkflow.id)?.kind, 'audio')
    assert.deepEqual(WorkflowModel.findAllSummaries(false, 'image').map((row) => row.id), [imageWorkflowId])
    assert.deepEqual(WorkflowModel.findAllSummaries(false, 'audio').map((row) => row.id), [defaultWorkflow.id])
    assert.equal(WorkflowModel.findAllSummaries(false).length, 2)
    assert.deepEqual(defaultWorkflow.suggested, { prompt: 'prompt', seconds: 'seconds', seed: 'seed' })
    assert.equal(defaultWorkflow.binding?.is_default, true)
    assert.equal(defaultWorkflow.binding?.prompt_field_id, 'prompt')
  })

  await t.test('roles are suggested from marked fields by node and path', () => {
    const suggested = workflows.suggestAudioWorkflowRoles({
      workflow_json: JSON.stringify({ 3: { class_type: 'CLIPTextEncode', inputs: {} }, 5: { class_type: 'EmptyLatentAudio', inputs: {} }, 6: { class_type: 'KSampler', inputs: {} }, 9: { class_type: 'Seed (rgthree)', inputs: {} } }),
      marked_fields: JSON.stringify([
        { id: 'neg', label: 'neg', jsonPath: '4.inputs.text', type: 'text' },
        { id: 'sampler_seed', label: 's', jsonPath: '6.inputs.seed', type: 'number' },
        { id: 'pos', label: 'p', jsonPath: '3.inputs.text', type: 'textarea' },
        { id: 'len', label: 'l', jsonPath: '5.inputs.seconds', type: 'number' },
        { id: 'rg', label: 'r', jsonPath: '9.inputs.seed', type: 'number' },
      ]),
    })
    assert.deepEqual(suggested, { prompt: 'pos', seconds: 'len', seed: 'rg' })
  })

  await t.test('binding validation: field types, distinct roles, audio kind only', async () => {
    await assert.rejects(workflows.saveAudioWorkflowBinding(defaultWorkflow.id, { prompt_field_id: 'seconds', seconds_field_id: 'seconds', seed_field_id: 'seed' }), /prompt/)
    await assert.rejects(workflows.saveAudioWorkflowBinding(defaultWorkflow.id, { prompt_field_id: 'prompt', seconds_field_id: 'missing', seed_field_id: 'seed' }), /없어/)
    await assert.rejects(workflows.saveAudioWorkflowBinding(defaultWorkflow.id, { prompt_field_id: 'prompt', seconds_field_id: 'seed', seed_field_id: 'seed' }), /서로 다른/)
    await assert.rejects(workflows.saveAudioWorkflowBinding(imageWorkflowId, { prompt_field_id: 'a', seconds_field_id: 'b', seed_field_id: 'c' }), /오디오 종류/)
  })

  await t.test('compatibility: ok, incompatible model list and unreachable server are told apart', async () => {
    workflows.clearAudioObjectInfoCache()
    const compat = await workflows.checkAudioWorkflowCompatibility(defaultWorkflow.id, { force: true })
    const byId = new Map(compat.servers.map((entry) => [entry.server_id, entry]))
    assert.equal(byId.get(goodServerId)?.status, 'ok', JSON.stringify(byId.get(goodServerId)))
    assert.equal(byId.get(goodServerId)?.seconds_max, 47.6)
    assert.equal(byId.get(badServerId)?.status, 'incompatible')
    assert.ok(byId.get(badServerId)?.issues.some((issue) => issue.includes('stable_audio_3_medium_base.safetensors')))
    assert.equal(byId.get(deadServerId)?.status, 'unreachable')
    assert.equal(compat.ok, true)
    assert.equal(compat.seconds_max, 47.6)
    assert.equal(workflows.getAudioWorkflowBinding(defaultWorkflow.id)?.compat?.seconds_max, 47.6, 'stored on the binding')
    // Only the good server takes part in the rest of the test.
    ComfyUIServerModel.update(badServerId, { is_active: false })
    ComfyUIServerModel.update(deadServerId, { is_active: false })
    await workflows.checkAudioWorkflowCompatibility(defaultWorkflow.id, { force: true })
  })

  await t.test('compatibility: a dynamic combo is checked against its own options, not the empty server list', async () => {
    const comboWorkflow = (choice: string) => WorkflowModel.create({
      name: `combo ${choice}`,
      workflow_json: JSON.stringify({ '52:43': { class_type: 'CustomCombo', inputs: { choice, index: 2, option1: 'Music', option2: 'SFX', option3: '' } } }),
      marked_fields: [],
      kind: 'audio',
    })
    const okId = comboWorkflow('SFX')
    const badId = comboWorkflow('Speech')
    try {
      workflows.clearAudioObjectInfoCache()
      const ok = await workflows.checkAudioWorkflowCompatibility(okId, { force: true })
      assert.equal(ok.servers[0]?.status, 'ok', JSON.stringify(ok.servers))
      const bad = await workflows.checkAudioWorkflowCompatibility(badId, { force: true })
      assert.ok(bad.servers[0]?.issues.some((issue) => issue.includes('"Speech"')), JSON.stringify(bad.servers))
    } finally {
      WorkflowModel.delete(okId)
      WorkflowModel.delete(badId)
    }
  })

  // ---------------------------------------------------------------- orders
  const project = service.createAudioProject({ name: '게임 A' }, null)
  const snow = service.createAudioGroup(project.id, { name: '발자국 · 눈', label: 'footstep_snow_[00]' })
  const actor = { accountId: null, accountType: null, scope: 'test' }
  GenerationQueueService.start()

  const waitForOrder = async (orderId: string, timeoutMs = 60_000) => {
    const deadline = Date.now() + timeoutMs
    let order = orders.getAudioOrder(orderId)
    while (order.status === 'active' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200))
      order = orders.getAudioOrder(orderId)
    }
    return order
  }

  await t.test('order validation, idempotency and 409 on a reused key', async () => {
    await assert.rejects(orders.createAudioOrder({ group_id: snow.id, text: '', seconds: 3, count: 1 }, actor), /text/)
    await assert.rejects(orders.createAudioOrder({ group_id: snow.id, text: 'x', seconds: 60, count: 1 }, actor), /47/)
    await assert.rejects(orders.createAudioOrder({ group_id: snow.id, text: 'x', seconds: 3, count: 51 }, actor), /count/)
    await assert.rejects(orders.createAudioOrder({ group_id: snow.id, text: 'x', seconds: 3, count: 2, seed: 1125899906842624 }, actor), /seed/)
  })

  let firstOrderId = ''
  await t.test('an order queues one job per seed and the sink turns each into a candidate', async () => {
    const imagesBefore = (main.db.prepare('SELECT count(*) AS n FROM image_files').get() as { n: number }).n
    const order = await orders.createAudioOrder({ group_id: snow.id, text: 'soft footstep on snow', seconds: 2.5, count: 3, seed: 100, request_key: 'order-key-0001' }, actor)
    firstOrderId = order.id
    assert.deepEqual(order.jobs.map((job) => job.seed), [100, 101, 102])
    assert.equal(order.job_ids.length, 3)
    const again = await orders.createAudioOrder({ group_id: snow.id, text: 'soft footstep on snow', seconds: 2.5, count: 3, seed: 100, request_key: 'order-key-0001' }, actor)
    assert.equal(again.id, order.id, 'same key + same body = same order')
    assert.deepEqual(again.job_ids, order.job_ids)
    await assert.rejects(orders.createAudioOrder({ group_id: snow.id, text: 'different', seconds: 2.5, count: 3, seed: 100, request_key: 'order-key-0001' }, actor), (error: unknown) => (error as { status?: number }).status === 409)

    const done = await waitForOrder(order.id)
    assert.equal(done.status, 'completed', JSON.stringify(done.jobs))
    assert.equal(done.audio_candidate_ids.length, 3)
    const sentSeeds = received.filter((prompt) => JSON.stringify(prompt.graph).includes('soft footstep on snow')).map((prompt) => prompt.graph['9'].inputs.seed).sort()
    assert.deepEqual(sentSeeds, [100, 101, 102], 'each job reached ComfyUI with its own exact seed')
    assert.ok(received.every((prompt) => prompt.graph['5'] === undefined || prompt.graph['5'].inputs.batch_size === 1))

    const candidate = service.getAudioCandidate(done.jobs[1].candidate_ids[0])
    assert.equal(candidate.origin, 'generated')
    assert.equal(candidate.name, '발자국 · 눈 · 101')
    assert.equal(candidate.order_id, order.id)
    assert.equal(candidate.job_id, String(done.jobs[1].job_id))
    const provenance = candidate.provenance as Record<string, unknown>
    assert.equal(provenance.seed, 101)
    assert.equal(provenance.prompt, 'soft footstep on snow')
    assert.equal(provenance.seconds, 2.5)
    assert.equal(provenance.workflow_id, defaultWorkflow.id)
    assert.equal(provenance.server_id, goodServerId)
    assert.ok(fs.existsSync(store.audioBlobPath(candidate.file_hash, 'flac')))

    // Nothing reached the image library or the image generation history.
    assert.equal((main.db.prepare('SELECT count(*) AS n FROM image_files').get() as { n: number }).n, imagesBefore)
    const histories = user.getUserSettingsDb().prepare(`SELECT count(*) AS n FROM api_generation_history WHERE queue_job_id IN (${done.job_ids.join(',')})`).get() as { n: number }
    assert.equal(histories.n, 0)
    const debug = GenerationQueueModel.findById(done.job_ids[0])
    assert.match(String(debug?.debug_meta ?? ''), /audio_candidate_ids/)
  })

  await t.test('a job without an audio output fails, and a retry runs the same seed as a new attempt', async () => {
    const order = await orders.createAudioOrder({ group_id: snow.id, text: 'NOAUDIO please', seconds: 1, count: 1, seed: 7 }, actor)
    const failed = await waitForOrder(order.id)
    assert.equal(failed.status, 'failed')
    assert.match(String(failed.jobs[0].failure_message), /audio output/)
    const oldJobId = failed.jobs[0].job_id

    // Change the prompt by editing the order row, so the retry produces audio this time.
    audioDb.prepare("UPDATE audio_orders SET text = 'retried take' WHERE id = ?").run(order.id)
    const retried = orders.retryAudioOrderJob(order.id, 0)
    assert.equal(retried.jobs[0].attempt, 2)
    assert.notEqual(retried.jobs[0].job_id, oldJobId)
    assert.ok(GenerationQueueModel.findIdempotentJob(orders.AUDIO_ORDER_QUEUE_SCOPE, `audio:${order.id}:0:2`))
    const done = await waitForOrder(order.id)
    assert.equal(done.status, 'completed')
    assert.equal(service.getAudioCandidate(done.audio_candidate_ids[0]).provenance && (service.getAudioCandidate(done.audio_candidate_ids[0]).provenance as { seed: number }).seed, 7)
    assert.throws(() => orders.retryAudioOrderJob(order.id, 0), /실패했거나/)
  })

  await t.test('an image workflow job still lands in the image library as before', async () => {
    const jobId = GenerationQueueModel.create({
      service_type: 'comfyui', priority: 100, workflow_id: imageWorkflowId, workflow_name: 'image wf',
      request_payload: { prompt_data: {} }, request_summary: 'image regression',
    })
    GenerationQueueService.requestDispatch()
    const job = await GenerationQueueService.waitForTerminalJob(jobId, { timeoutMs: 60_000 })
    assert.equal(job?.status, 'completed', JSON.stringify(job))
    const history = user.getUserSettingsDb().prepare('SELECT composite_hash, generation_status FROM api_generation_history WHERE queue_job_id = ?').get(jobId) as { composite_hash: string | null; generation_status: string }
    assert.equal(history.generation_status, 'completed')
    assert.ok(history.composite_hash, 'image history points at the saved image')
    assert.ok(main.db.prepare('SELECT 1 FROM image_files WHERE composite_hash = ?').get(history.composite_hash))
  })

  await t.test('crash recovery: rows without a queue job are queued once, existing keys are reused', async () => {
    // (a) A row whose job id was lost after queueing gets the same job back from its idempotency key.
    const firstRow = audioDb.prepare('SELECT job_id FROM audio_order_jobs WHERE order_id = ? AND idx = 0').get(firstOrderId) as { job_id: number }
    audioDb.prepare("UPDATE audio_order_jobs SET job_id = NULL, status_cache = 'pending' WHERE order_id = ? AND idx = 0").run(firstOrderId)
    assert.equal(orders.reconcileAllAudioOrders(), 0, 'reused, nothing new queued')
    assert.equal((audioDb.prepare('SELECT job_id FROM audio_order_jobs WHERE order_id = ? AND idx = 0').get(firstOrderId) as { job_id: number }).job_id, firstRow.job_id)

    // (b) An order stored but never queued (crash right after the insert) is queued by the reconcile.
    const id = crypto.randomUUID()
    const at = new Date().toISOString()
    audioDb.prepare(`INSERT INTO audio_orders (id, request_scope, request_key, request_hash, group_id, workflow_id, text, seconds, count, base_seed, created_at)
      VALUES (?, 'test', 'crash-key-0001', 'h', ?, ?, 'after crash', 1, 2, 500, ?)`).run(id, snow.id, defaultWorkflow.id, at)
    audioDb.prepare("INSERT INTO audio_order_jobs (order_id, idx, seed, attempt, status_cache, updated_at) VALUES (?, 0, 500, 1, 'pending', ?), (?, 1, 501, 1, 'pending', ?)").run(id, at, id, at)
    assert.equal(orders.reconcileAllAudioOrders(), 2)
    assert.equal(orders.reconcileAllAudioOrders(), 0, 'a second pass finds nothing to do')
    const done = await waitForOrder(id)
    assert.equal(done.status, 'completed')
    assert.deepEqual(done.jobs.map((job) => job.seed), [500, 501])
  })

  await t.test('cancel stops the running job and the queued one behind it', async () => {
    const order = await orders.createAudioOrder({ group_id: snow.id, text: 'SLOW rumble', seconds: 1, count: 2 }, actor)
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline && orders.getAudioOrder(order.id).counts.running === 0) await new Promise((resolve) => setTimeout(resolve, 100))
    const cancelled = await orders.cancelAudioOrder(order.id)
    assert.ok(cancelled.jobs.every((job) => job.status !== 'completed'))
    const done = await waitForOrder(order.id, 30_000)
    assert.equal(done.status, 'cancelled', JSON.stringify(done.jobs))
    assert.equal(done.audio_candidate_ids.length, 0)
  })

  // ---------------------------------------------------------------- REST
  const { invalidateConfiguredAuthCache } = await import('../src/routes/auth-route-helpers')
  const { AuthPermissionGroup } = await import('../src/models/AuthPermissionGroup')
  const adminId = Number(auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES ('admin-gen', 'unused', 'admin')").run().lastInsertRowid)
  auth.prepare("INSERT INTO auth_account_group_memberships (account_id, group_id) SELECT ?, id FROM auth_permission_groups WHERE group_key = 'admin'").run(adminId)
  const account = (name: string, keys: string[]) => {
    const group = AuthPermissionGroup.createCustomGroup({ name, permissionKeys: keys })
    const id = Number(auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES (?, 'unused', 'guest')").run(name).lastInsertRowid)
    AuthPermissionGroup.addAccountMembership(group.id, id)
    return id
  }
  const listenerId = account('listener', ['audio.view'])
  const editorId = account('editor', ['audio.view', 'audio.edit'])
  const producerId = account('producer', ['audio.view', 'audio.edit', 'generation.execute', 'workflows.view'])
  invalidateConfiguredAuthCache()

  const express = (await import('express')).default
  const { registerAppRoutes } = await import('../src/startup/registerAppRoutes')
  const app = express()
  const sessions = new Map<string, Record<string, unknown>>()
  app.use(express.json())
  app.use((req, _res, next) => {
    const id = Number(req.header('x-test-account')) || undefined
    const sid = `test-${id ?? 'anonymous'}`
    if (!sessions.has(sid)) sessions.set(sid, { authenticated: Boolean(id), accountId: id, accountType: id === adminId ? 'admin' : id ? 'guest' : undefined })
    Object.assign(req, { sessionID: sid, session: sessions.get(sid) })
    next()
  })
  const pass = (_req: unknown, _res: unknown, next: () => void) => next()
  registerAppRoutes(app, { uploadsDir: path.join(root, 'uploads'), tempDir: path.join(root, 'temp'), saveDir: path.join(root, 'save'), mcpLimiter: pass, readOnlyLimiter: pass, uploadLimiter: pass })
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()) }))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const call = async (url: string, accountId?: number, init: RequestInit = {}) => {
    const response = await fetch(origin + url, { ...init, headers: { ...(accountId ? { 'x-test-account': String(accountId) } : {}), ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) } })
    const text = await response.text()
    return { status: response.status, json: () => JSON.parse(text), text }
  }

  await t.test('REST: workflow lists by kind, binding and orders follow audio.edit + generation.execute', async () => {
    assert.deepEqual((await call('/api/workflows?kind=audio', adminId)).json().data.map((row: { id: number }) => row.id), [defaultWorkflow.id])
    assert.deepEqual((await call('/api/workflows?kind=image', adminId)).json().data.map((row: { id: number }) => row.id), [imageWorkflowId])
    assert.equal((await call('/api/workflows', adminId, { method: 'PUT' })).status, 404)
    const kindPut = await call(`/api/workflows/${imageWorkflowId}`, adminId, { method: 'PUT', body: JSON.stringify({ kind: 'video' }) })
    assert.equal(kindPut.status, 400)

    const listed = await call('/api/audio/workflows', listenerId)
    assert.equal(listed.status, 200)
    assert.equal(listed.json().data[0].binding.prompt_field_id, 'prompt')
    assert.equal((await call(`/api/audio/workflows/${defaultWorkflow.id}/check`, listenerId, { method: 'POST' })).status, 403)
    assert.equal((await call('/api/audio/workflows/default', editorId, { method: 'POST' })).status, 403, 'adding a workflow needs workflows.edit')

    const body = JSON.stringify({ group_id: snow.id, text: 'rest take', seconds: 1, count: 1, seed: 900, request_key: 'rest-key-0001' })
    assert.equal((await call('/api/audio/orders', listenerId, { method: 'POST', body })).status, 403)
    assert.equal((await call('/api/audio/orders', editorId, { method: 'POST', body })).status, 403, 'ordering needs generation.execute')
    const placed = await call('/api/audio/orders', producerId, { method: 'POST', body })
    assert.equal(placed.status, 201, placed.text)
    const orderId = placed.json().data.id as string
    assert.equal((await call('/api/audio/orders', producerId, { method: 'POST', body })).json().data.id, orderId, 'same key → same order')
    const conflict = await call('/api/audio/orders', producerId, { method: 'POST', body: JSON.stringify({ group_id: snow.id, text: 'other', seconds: 1, count: 1, request_key: 'rest-key-0001' }) })
    assert.equal(conflict.status, 409)
    // Keys are per account: the admin's identical key is a separate order.
    assert.notEqual((await call('/api/audio/orders', adminId, { method: 'POST', body })).json().data.id, orderId)
    const done = await waitForOrder(orderId)
    assert.equal(done.status, 'completed')
    assert.ok((await call(`/api/audio/orders?group_id=${snow.id}`, listenerId)).json().data.items.some((order: { id: string }) => order.id === orderId))
    assert.equal((await call(`/api/audio/orders/${orderId}/cancel`, listenerId, { method: 'POST' })).status, 403)
  })

  // ---------------------------------------------------------------- MCP
  await t.test('MCP: order tools need audio.edit + generation.execute; wait is withheld from chat', async () => {
    const { createMcpServer } = await import('../src/mcp/server')
    const { ALL_MCP_HTTP_SCOPES, CHAT_BLOCKED_TOOLS } = await import('../src/mcp/context')
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
    const connect = async (requester: { accountId: number; accountType: 'admin' | 'guest' }) => {
      const mcp = createMcpServer({ scopes: [...ALL_MCP_HTTP_SCOPES], source: 'http', requester })
      const client = new Client({ name: 'audio-gen-test', version: '1' })
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)])
      t.after(async () => { await client.close(); await mcp.close() })
      return client
    }
    const names = async (client: Awaited<ReturnType<typeof connect>>) => (await client.listTools()).tools.map((tool) => tool.name)
    const listener = await names(await connect({ accountId: listenerId, accountType: 'guest' }))
    assert.ok(listener.includes('list_audio_workflows') && listener.includes('get_audio_order'))
    assert.ok(!listener.includes('order_audio'))
    assert.ok(!(await names(await connect({ accountId: editorId, accountType: 'guest' }))).includes('order_audio'))
    assert.ok(CHAT_BLOCKED_TOOLS.has('wait_audio_order'))

    const admin = await connect({ accountId: adminId, accountType: 'admin' })
    const listedWorkflows = JSON.parse(((await admin.callTool({ name: 'list_workflows', arguments: {} })) as { content: Array<{ text: string }> }).content[0].text) as Array<{ id: number }>
    assert.deepEqual(listedWorkflows.map((row) => row.id), [imageWorkflowId], 'list_workflows lists image workflows unless asked')
    const placed = await admin.callTool({ name: 'order_audio', arguments: { audio_group_id: snow.id, text: 'mcp take', seconds: 1, count: 2, seed: 40, request_key: 'mcp-key-00001' } }) as { isError?: boolean; content: Array<{ text: string }> }
    assert.notEqual(placed.isError, true, placed.content[0]?.text)
    const summary = JSON.parse(placed.content[0].text)
    assert.equal(summary.job_ids.length, 2)
    const waited = await admin.callTool({ name: 'wait_audio_order', arguments: { order_id: summary.order_id, timeout_seconds: 60 } }) as { content: Array<{ text: string }> }
    const finished = JSON.parse(waited.content[0].text)
    assert.equal(finished.finished, true)
    assert.equal(finished.audio_candidate_ids.length, 2)

    // Ownership: another account's MCP session cannot read the admin's order.
    const producer = await connect({ accountId: producerId, accountType: 'guest' })
    const foreign = await producer.callTool({ name: 'get_audio_order', arguments: { order_id: summary.order_id } }) as { isError?: boolean }
    assert.equal(foreign.isError, true)

    // ---- chat reference shape
    const { readMcpToolResult } = await import('../src/services/codex-chat/chatToolReferences')
    const pendingRead = readMcpToolResult({ content: [{ type: 'text', text: placed.content[0].text }] }, 'order_audio')
    assert.deepEqual(pendingRead.jobIds.sort(), [...summary.job_ids].sort())
    assert.deepEqual(pendingRead.pendingJobIds.sort(), [...summary.job_ids].sort(), 'just placed: every job still pending')
    const finishedRead = readMcpToolResult({ content: [{ type: 'text', text: waited.content[0].text }] }, 'get_audio_order')
    assert.deepEqual(finishedRead.pendingJobIds, [])
    assert.deepEqual(finishedRead.audioCandidateIds.sort(), [...finished.audio_candidate_ids].sort())

    const { attachResolvedJobResults, generationOutcomeNote } = await import('../src/services/codex-chat/codexChatMedia')
    const audioByJob = orders.audioCandidatesByQueueJob(summary.job_ids)
    const message = { id: 1, thread_id: 1, routing: { replyId: 'r1' }, tool_calls: [{ id: 'c1', tool: 'order_audio', status: 'completed', arguments: null, summary: null, historyIds: [], compositeHashes: [], jobIds: summary.job_ids, pendingJobIds: summary.job_ids }] }
    const [attached] = attachResolvedJobResults([message as never], new Map(), new Set(), new Map(summary.job_ids.map((id: number) => [id, 'r1'])), new Map(), audioByJob)
    const call0 = attached.tool_calls[0] as { audioCandidateIds?: string[]; pendingJobIds?: number[]; generated?: boolean }
    assert.deepEqual([...(call0.audioCandidateIds ?? [])].sort(), [...finished.audio_candidate_ids].sort())
    assert.deepEqual(call0.pendingJobIds, [])
    assert.equal(call0.generated, true)
    assert.match(generationOutcomeNote(summary.job_ids[0], { status: 'completed', images: 0, sounds: 1 }), /1 sound candidate attached/)

    // Audio jobs never read as images in chat: failure text, outcome notes, and the dispatch grant check.
    const { failureMessageOf } = await import('../src/services/codex-chat/codexChatMedia')
    const jobCandidates = await import('../src/services/audio/audioJobCandidates')
    assert.equal(failureMessageOf('failed', null, 'audio'), '오디오 생성에 실패했어')
    assert.equal(failureMessageOf('completed', 'no_image', 'audio'), '완료된 오디오가 없어')
    assert.equal(failureMessageOf('failed', null), '이미지 생성에 실패했어')
    assert.match(generationOutcomeNote(summary.job_ids[0], { status: 'failed', images: 0, audio: true }), /Audio job .* failed: no sound/)
    assert.match(generationOutcomeNote(summary.job_ids[0], { status: 'running', images: 0, audio: true }), /its sound attaches/)
    assert.deepEqual(jobCandidates.audioOrderGroupsByQueueJob(summary.job_ids), new Map(summary.job_ids.map((id: number) => [id, snow.id])))

    const { isAudioOrderChatJob } = await import('../src/services/generation-queue/queueJobExecutors')
    assert.equal(isAudioOrderChatJob(summary.job_ids[0], 'order_audio'), true, 'an audio order job needs no workflows.view')
    assert.equal(isAudioOrderChatJob(summary.job_ids[0], 'generate_comfyui'), false)
    assert.equal(isAudioOrderChatJob(999_999, 'order_audio'), false, 'an audio tool name alone is not enough')
  })

  // ---------------------------------------------------------------- generation tab: image workflows that save sounds
  const { GenerationHistoryService } = await import('../src/services/generationHistoryService')
  const { AUDIO_GENERATION_TAB_PROJECT_NAME } = await import('../src/services/audio/audioGenerationOutputs')
  const jobCandidates = await import('../src/services/audio/audioJobCandidates')
  const historyOwnerId = account('history-owner', ['images.view', 'generation.execute', 'workflows.view'])
  const historyStrangerId = account('history-stranger', ['images.view'])
  invalidateConfiguredAuthCache()
  const runImageWorkflow = async (workflowId: number) => {
    const jobId = GenerationQueueModel.create({
      service_type: 'comfyui', priority: 100, workflow_id: workflowId, workflow_name: 'sound wf',
      request_payload: { prompt_data: {} }, request_summary: 'generation tab sound',
      requested_by_account_id: historyOwnerId, requested_by_account_type: 'guest',
    })
    GenerationQueueService.requestDispatch()
    const job = await GenerationQueueService.waitForTerminalJob(jobId, { timeoutMs: 60_000 })
    assert.equal(job?.status, 'completed', JSON.stringify(job))
    const history = user.getUserSettingsDb().prepare('SELECT id, composite_hash, generation_status FROM api_generation_history WHERE queue_job_id = ?').get(jobId) as { id: number; composite_hash: string | null; generation_status: string }
    return { jobId, history }
  }

  await t.test('an image workflow that only saves a sound completes, and its history row plays it', async () => {
    const soundWorkflowId = WorkflowModel.create({
      name: 'tts wf',
      workflow_json: JSON.stringify({ 8: { class_type: 'SaveAudioAdvanced', inputs: { filename_prefix: 'speech', format: 'flac', audio: ['7', 0] } } }),
      marked_fields: [],
    })
    assert.equal(WorkflowModel.findById(soundWorkflowId)?.kind, 'image')
    const { jobId, history } = await runImageWorkflow(soundWorkflowId)
    assert.equal(history.generation_status, 'completed')
    assert.equal(history.composite_hash, null)

    const results = jobCandidates.audioResultsByQueueJob([jobId]).get(jobId) ?? []
    assert.equal(results.length, 1)
    const candidate = service.getAudioCandidate(results[0].id)
    assert.equal(candidate.origin, 'generated')
    assert.equal(candidate.name, 'tts wf')
    assert.equal(candidate.job_id, String(jobId))
    assert.equal((candidate.provenance as { history_id: number }).history_id, history.id)
    const inbox = service.getAudioGroup(candidate.group_id)
    assert.equal(inbox.is_inbox, true)
    assert.equal(service.getAudioProject(inbox.project_id).name, AUDIO_GENERATION_TAB_PROJECT_NAME)

    const listed = await GenerationHistoryService.getAllHistory({ queue_job_id: jobId })
    assert.deepEqual(listed.records[0].audio_results?.map((entry) => entry.id), [candidate.id])
    assert.equal(listed.records[0].audio_results?.[0].mime_type, 'audio/flac')
    const byWorkflow = await GenerationHistoryService.getHistoryByWorkflow(soundWorkflowId, {})
    assert.deepEqual(byWorkflow.records[0].audio_results?.map((entry) => entry.id), [candidate.id], 'the workflow-scoped history (generation page) lists the sound too')
    const { HistoryQueryRepository } = await import('../src/repositories/history/HistoryQueryRepository')
    assert.deepEqual(HistoryQueryRepository.findDisplayFailedIds({ queue_job_id: jobId }), [], 'failed-row cleanup leaves a sound-only run alone')

    const url = `/api/generation-history/${history.id}/audio/${candidate.id}`
    const played = await fetch(origin + url, { headers: { 'x-test-account': String(historyOwnerId) } })
    assert.equal(played.status, 200)
    assert.equal(played.headers.get('content-type'), 'audio/flac')
    assert.ok((await played.arrayBuffer()).byteLength > 0)
    const ranged = await fetch(origin + url, { headers: { 'x-test-account': String(historyOwnerId), Range: 'bytes=0-9' } })
    assert.equal(ranged.status, 206)
    assert.equal((await ranged.arrayBuffer()).byteLength, 10)
    assert.equal((await call(url, adminId)).status, 200, 'admins see every history row')
    assert.equal((await call(url, historyStrangerId)).status, 403, 'another account cannot play it')
    assert.equal((await call(url)).status, 401)
    assert.equal((await call(`/api/generation-history/${history.id}/audio/${crypto.randomUUID()}`, historyOwnerId)).status, 404, 'only the sounds of this run')

    // A deleted take leaves the history row.
    service.deleteAudioCandidates([candidate.id])
    assert.equal((await GenerationHistoryService.getAllHistory({ queue_job_id: jobId })).records[0].audio_results, undefined)
    assert.deepEqual(HistoryQueryRepository.findDisplayFailedIds({ queue_job_id: jobId }), [history.id], 'without its sound the row reads as failed again')
    assert.equal((await call(url, historyOwnerId)).status, 404)
  })

  await t.test('an audio workflow run from the generation tab keeps a history row that plays its sound', async () => {
    const audioWorkflowId = WorkflowModel.create({
      name: 'voice wf',
      workflow_json: JSON.stringify({ 8: { class_type: 'SaveAudioAdvanced', inputs: { filename_prefix: 'voice', format: 'flac', audio: ['7', 0] } } }),
      marked_fields: [],
      kind: 'audio',
    })
    assert.equal(WorkflowModel.findById(audioWorkflowId)?.kind, 'audio')
    const { jobId, history } = await runImageWorkflow(audioWorkflowId)
    assert.equal(history.generation_status, 'completed')
    const results = jobCandidates.audioResultsByQueueJob([jobId]).get(jobId) ?? []
    assert.equal(results.length, 1)
    const candidate = service.getAudioCandidate(results[0].id)
    assert.equal(service.getAudioProject(service.getAudioGroup(candidate.group_id).project_id).name, AUDIO_GENERATION_TAB_PROJECT_NAME)
    const byWorkflow = await GenerationHistoryService.getHistoryByWorkflow(audioWorkflowId, {})
    assert.deepEqual(byWorkflow.records[0].audio_results?.map((entry) => entry.id), [candidate.id])
    const played = await fetch(`${origin}/api/generation-history/${history.id}/audio/${candidate.id}`, { headers: { 'x-test-account': String(historyOwnerId) } })
    assert.equal(played.status, 200)
  })

  await t.test('an image workflow that saves a picture and a sound keeps both', async () => {
    const mixedWorkflowId = WorkflowModel.create({
      name: 'mixed wf',
      workflow_json: JSON.stringify({
        1: { class_type: 'SaveImage', inputs: { filename_prefix: 'MIXED', images: ['2', 0] } },
        2: { class_type: 'EmptyImage', inputs: { width: 16, height: 12 } },
      }),
      marked_fields: [],
    })
    const { jobId, history } = await runImageWorkflow(mixedWorkflowId)
    assert.ok(history.composite_hash, 'the picture still lands in the image library')
    assert.equal(jobCandidates.audioResultsByQueueJob([jobId]).get(jobId)?.length, 1, 'the sound lands in the audio store')
    const debug = JSON.parse(String(GenerationQueueModel.findById(jobId)?.debug_meta ?? '{}'))
    assert.equal(debug.audio_candidate_ids?.length, 1)
    const listed = await GenerationHistoryService.getAllHistory({ queue_job_id: jobId })
    assert.ok(listed.records[0].actual_composite_hash, 'the row keeps its picture')
    assert.equal(listed.records[0].audio_results?.length, 1, 'and lists the sound beside it')

    // Codex chats are told a finished job once, in the next turn's input (images and sounds alike).
    const { pendingGenerationOutcomes, generationOutcomeNote } = await import('../src/services/codex-chat/codexChatMedia')
    assert.match(generationOutcomeNote(jobId, { status: 'completed', images: 1, sounds: 1 }), /1 image and 1 sound candidate attached/)
    const reply = { id: 1, thread_id: 999, role: 'assistant', content: '', routing: { replyId: 'r-mixed' }, tool_calls: [{ id: 'c1', tool: 'generate_comfyui', status: 'completed', arguments: null, summary: null, historyIds: [], compositeHashes: [], jobIds: [jobId] }] }
    const first = pendingGenerationOutcomes(999, [reply as never], new Set())
    assert.deepEqual(first.keys, [`outcome:${jobId}`])
    assert.match(first.text, new RegExp(`Generation job #${jobId} finished: 1 image and 1 sound`))
    assert.deepEqual(pendingGenerationOutcomes(999, [reply as never], new Set(first.keys)), { text: '', keys: [] }, 'told once')
    const unknown = { ...reply, tool_calls: [{ ...reply.tool_calls[0], jobIds: [987_654] }] }
    assert.deepEqual(pendingGenerationOutcomes(999, [unknown as never], new Set()), { text: '', keys: [] }, 'a job that has not finished waits')

    // A bot polling the job sees its sounds too.
    const { createMcpServer } = await import('../src/mcp/server')
    const { ALL_MCP_HTTP_SCOPES } = await import('../src/mcp/context')
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
    const mcp = createMcpServer({ scopes: [...ALL_MCP_HTTP_SCOPES], source: 'http', requester: { accountId: historyOwnerId, accountType: 'guest' } })
    const client = new Client({ name: 'mixed-job-test', version: '1' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)])
    const described = await client.callTool({ name: 'get_generation_job', arguments: { job_id: jobId } }) as { isError?: boolean; content: Array<{ text: string }> }
    await client.close()
    await mcp.close()
    assert.notEqual(described.isError, true, described.content[0]?.text)
    assert.deepEqual(JSON.parse(described.content[0].text).audio_candidate_ids, jobCandidates.audioResultsByQueueJob([jobId]).get(jobId)?.map((entry) => entry.id))
    // Let the saved picture's background metadata pass finish before teardown removes the runtime folders.
    const { BackgroundQueueService } = await import('../src/services/backgroundQueue')
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline && (BackgroundQueueService.getQueueStatus().processing || BackgroundQueueService.getQueueStatus().queueLength > 0)) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  })

  await t.test('output collection: sounds skip the final-node pick and audio files in `files` are sounds', async () => {
    const { extractComfyOutputInfo } = await import('../src/services/comfyui/outputCollector')
    const history = { p: { prompt: [], status: { status_str: 'success', completed: true, messages: [] }, outputs: {
      3: { images: [{ filename: 'early.png', subfolder: '', type: 'output' }] },
      9: { images: [{ filename: 'final.png', subfolder: '', type: 'output' }] },
      12: { audio: [{ filename: 'voice.flac', subfolder: '', type: 'output' }] },
      14: { files: [{ filename: 'extra.wav', subfolder: '', type: 'output' }] },
    } } } as never
    assert.deepEqual(extractComfyOutputInfo(history, 'p', true).map((output) => [output.filename, output.kind]), [['final.png', 'image'], ['voice.flac', 'audio'], ['extra.wav', 'audio']])
    assert.deepEqual(extractComfyOutputInfo(history, 'p', false).map((output) => output.filename), ['early.png', 'final.png', 'voice.flac', 'extra.wav'])
  })
})
