import assert from 'node:assert/strict'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { applyOps, buildDirector, checkCut, continuationEdges, continuationPort, continuationRoom, generationRequest, isContinuation, labelTable, mediaItems, newProject, normalizeRef, profilePublication, renameContinuation, resolvePrompt, resultHash, roleOf, unusedReference } from '../../plugins/video-canvas/domain.mjs'
import { activate, createStore, unwrap } from '../../plugins/video-canvas/server.mjs'
import { createAssistantState, createRefreshQueue, excerpt, projectRows, rejectedMessage } from '../../plugins/video-canvas/assistant-state.mjs'
import { normalizeMcpWorkflowInputs } from '../src/services/comfyui/comfyWorkflowInputs'
import { CHAT_PAGE_ACTION_LIMITS, copyChatPageData, isPrivateChatPageKey, normalizeChatPageSchema, validateChatPageArguments } from '../../shared/src/utils/chatPageAction'

const hash = 'a'.repeat(32), otherHash = 'b'.repeat(32)
// With state.historyPerJob each generation job has its own history row and result hash.
const jobHash = (job: number) => String(job).padStart(32, '0')
const image = { source: 'library', compositeHash: hash }
const profile = { id: 'draft', label: '초안', workflowId: 12, directorFieldId: 'director', seedFieldId: 'seed', overrides: { frame_rate: 24, resolution: { preset: '720p' } } }
const details = { name: 'Director 기본', input_schema: [
  { id: 'director', type: 'node', node_editor: 'minimax_h3_director_dasiwa' },
  { id: 'seed', type: 'number', seed_rule: 'explicit seed', json_path: '5.inputs.seed' },
  { id: 'steps', label: '스텝', type: 'number', minimum: 1, maximum: 50 },
] }
const ops = (project: any, operations: any[], actor = 'assistant') => applyOps(project, operations, project.revision, randomUUID, actor)
function canvas() {
  const result = ops(newProject('project', '영상'), [
    { op: 'add_node', kind: 'cut', name: '컷', tempId: 'cut', at: { x: 300, y: 0 } },
    { op: 'add_node', kind: 'image', name: '유나 기준', ref: image, tempId: 'a', at: { x: 0, y: 0 } },
    { op: 'add_node', kind: 'image', name: '배경', ref: { source: 'library', compositeHash: otherHash }, tempId: 'b', at: { x: 0, y: 100 } },
    { op: 'connect', from: 'a', to: 'cut', port: 'ref_image' },
    { op: 'connect', from: 'b', to: 'cut', port: 'ref_image' },
  ])
  const project = result.project, cut = project.nodes[0]
  cut.data.mode = 'REF2VA'; cut.data.prompt = '@유나 기준 이 @배경 앞에 서 있어.'
  cut.data.profileId = profile.id; cut.data.seed = 482913
  project.profiles = [structuredClone(profile)]
  return { project, cut, a: project.nodes[1], b: project.nodes[2] }
}
test('video canvas batches temp IDs and reorders edges without partially applying rejected operations', () => {
  const { project, cut, a } = canvas()
  const before = structuredClone(project)
  const result = ops(project, [
    { op: 'set', id: cut.id, fields: { prompt: 'must roll back', seed: -2 } },
    { op: 'connect', from: a.id, to: cut.id, port: 'ref_audio' },
    { op: 'reorder', cut: cut.id, port: 'ref_image', order: project.edges.map((edge: any) => edge.id).reverse() },
  ])
  assert.equal(result.rejected.length, 2)
  assert.equal(result.applied.length, 1)
  assert.equal(result.project.nodes[0].data.prompt, before.nodes[0].data.prompt)
  assert.equal(result.project.edges[1].position, 0)
  assert.equal(result.revision, before.revision + 1)
  assert.deepEqual(project, before)
  const failedImport = ops(project, [{ op: 'import_image', ref: image, tempId: 'x', target: { cut: cut.id, port: 'ref_audio' } }])
  assert.equal(failedImport.project.nodes.length, before.nodes.length)
  assert.equal(failedImport.revision, before.revision)
})
test('video canvas writes are account isolated, revision guarded and updates keep persisted state', () => {
  const db = new Database(':memory:')
  try {
    const store = createStore(db), project = store.create('account:1', '프로젝트')
    assert.throws(() => store.get('account:2', project.id), /접근/)
    const result = ops(project, [{ op: 'add_node', kind: 'cut' }])
    // as never: allowJs infers store.mjs `save(..., log = null)` as null-only; the store takes a log object here.
    store.save('account:1', project, result.project, { ops: [], actor: 'assistant' } as never)
    assert.equal(store.list('account:1')[0].nodeCount, 1)
    assert.deepEqual(store.list('account:2'), [])
    assert.throws(() => store.save('account:1', project, result.project), (error: any) => error.status === 409)
    assert.throws(() => applyOps(result.project, [], 0, randomUUID), (error: any) => error.status === 409)
    assert.equal(createStore(db).get('account:1', project.id).nodes.length, 1)
    assert.equal(store.undo('account:1', result.project, store.lastLog(project.id)).nodes.length, 0)
  } finally { db.close() }
})
test('video canvas preserves inactive slots and sends only mode-specific start/end items', () => {
  let { project, cut, a, b } = canvas()
  project = ops(project, [
    { op: 'connect', from: a.id, to: cut.id, port: 'start' },
    { op: 'connect', from: b.id, to: cut.id, port: 'end' },
  ]).project
  cut = project.nodes[0]; cut.data.prompt = ''
  for (const [mode, slots] of [['I2VA', [0]], ['FL2VA', [0, 1]], ['L2VA', [1]], ['T2VA', []]] as const) {
    cut.data.mode = mode
    const value = buildDirector(project, cut)
    assert.deepEqual(JSON.parse(value.timeline_data).items.map((item: any) => item.slot), slots)
    assert.equal(project.edges.length, 4)
  }
  cut.data.mode = 'FL2VA'
  project.edges = project.edges.filter((edge: any) => edge.port !== 'end')
  assert.ok(checkCut(project, cut).errors.some((issue: any) => issue.code === 'required-slot'))
})
test('video canvas resolves spaced names by current media ordering and embedded audio labels', () => {
  let { project, cut } = canvas()
  assert.equal(resolvePrompt(project, cut).prompt, '<Picture 1> 이 <Picture 2> 앞에 서 있어.')
  project = ops(project, [{ op: 'reorder', cut: cut.id, port: 'ref_image', order: project.edges.map((edge: any) => edge.id).reverse() }]).project
  cut = project.nodes[0]
  assert.equal(resolvePrompt(project, cut).prompt, '<Picture 2> 이 <Picture 1> 앞에 서 있어.')
  project = ops(project, [
    { op: 'add_node', kind: 'video', name: '움직임', ref: image, tempId: 'v' },
    { op: 'connect', from: 'v', to: cut.id, port: 'ref_video', props: { media_mode: 'video_audio', trim_start: 0, trim_end: 2, audioSlot: 2 } },
  ]).project
  cut = project.nodes[0]; cut.data.prompt += ' @움직임'
  assert.match(resolvePrompt(project, cut).prompt, /<Video 1> \/ <Audio 1>$/)
  assert.deepEqual(labelTable(project, cut).map((row: any) => row.label), ['<Picture 1>', '<Picture 2>', '<Video 1>', '<Audio 1>'])
  cut.data.prompt += ' @없는것'
  assert.ok(resolvePrompt(project, cut).errors.length)
  project.nodes[2].data.name = project.nodes[1].data.name
  cut.data.prompt = '@유나 기준'
  assert.match(resolvePrompt(project, cut).errors[0], /겹쳐/)
})
test('video canvas separates blocking defects from changed-file and unused-reference warnings', () => {
  const { project, cut, a, b } = canvas()
  cut.data.prompt = '@유나 기준'
  const warning = checkCut(project, cut, { [a.id]: { status: 'changed' } })
  assert.equal(warning.blocked, false)
  assert.deepEqual(warning.warnings.map((issue: any) => issue.code), ['changed', 'unused'])
  assert.equal(checkCut(project, cut, { [b.id]: { status: 'no-permission' } }).blocked, true)
  cut.data.prompt = '@미연결'
  assert.equal(checkCut(project, cut).blocked, true)
  assert.equal(ops(project, [{ op: 'review', id: cut.id, status: 'pass' }]).rejected.length, 1)
  assert.equal(ops(project, [{ op: 'review', id: cut.id, status: 'pass' }], 'human').project.nodes[0].review, 'pass')
})
test('video canvas blocks reference count and duration overflows but not inactive connections', () => {
  const { project, cut, a } = canvas()
  let expanded = ops(project, Array.from({ length: 8 }, () => ({ op: 'connect', from: a.id, to: cut.id, port: 'ref_image' }))).project
  assert.ok(checkCut(expanded, expanded.nodes[0]).errors.some((issue: any) => issue.code === 'limit'))
  expanded.nodes[0].data.mode = 'T2VA'; expanded.nodes[0].data.prompt = ''
  assert.equal(checkCut(expanded, expanded.nodes[0]).blocked, false)
  expanded = ops(project, [
    { op: 'add_node', kind: 'video', ref: image, tempId: 'v' },
    { op: 'connect', from: 'v', to: cut.id, port: 'ref_video', props: { trim_start: 0, trim_end: 1 } },
  ]).project
  assert.ok(checkCut(expanded, expanded.nodes[0]).errors.some((issue: any) => issue.code === 'range'))
  project.nodes[0].data.mode = 'T2VA'; project.nodes[0].data.prompt = '@유나 기준'
  assert.match(resolvePrompt(project, project.nodes[0]).errors[0], /슬롯/)
})
test('video canvas builds raw Director timelines/assets with trim and audio mode and always explicit seed', () => {
  let { project, cut } = canvas()
  const result = ops(project, [
    { op: 'add_node', kind: 'audio', ref: { source: 'audio', candidateId: 'candidate-uuid' }, name: '목소리', tempId: 'voice' },
    { op: 'add_node', kind: 'video', ref: image, name: '영상', tempId: 'video' },
    { op: 'add_node', kind: 'bundle', ref: { name: 'crowd' }, name: '군중', tempId: 'bundle' },
    { op: 'connect', from: 'voice', to: cut.id, port: 'ref_audio' },
    { op: 'connect', from: 'video', to: cut.id, port: 'ref_video', props: { media_mode: 'video_audio', audioSlot: 1, trim_start: 1, trim_end: 4 } },
    { op: 'connect', from: 'bundle', to: cut.id, port: 'refmod', props: { slot: 8, strength: 0.8 } },
  ])
  project = result.project; cut = project.nodes[0]
  const video = project.nodes.find((node: any) => node.kind === 'video'), audio = project.nodes.find((node: any) => node.kind === 'audio')
  video.data.duration = 5
  cut.data.prompt += ' @목소리 @영상 @군중'
  const asset = { __ref: 'workflow-input-asset', id: 'f'.repeat(32), fileName: 'voice.wav', mimeType: 'audio/wav', bytes: 100 }
  const director = buildDirector(project, cut, { [audio.id]: asset })
  const items = JSON.parse(director.timeline_data).items
  assert.deepEqual(items.map((item: any) => item.type), ['image', 'image', 'video', 'audio'])
  assert.deepEqual([items[2].trim_start, items[2].trim_end, items[2].media_mode, items[2].audioSlot], [1, 4, 'video_audio', 1])
  assert.deepEqual(director.assets[items[0].id], { composite_hash: hash })
  assert.deepEqual(director.assets[items[3].id], asset)
  assert.equal(director.refmods[0].slot, 8)
  assert.match(director.simple_prompt, /<RefMod 8>/)
  const request = generationRequest(profile, director, 0, randomUUID())
  assert.ok('inputs' in request)
  assert.equal(request.inputs.seed, 0)
  assert.match(request.idempotency_key, /^video-canvas-[0-9a-f-]{36}$/)
  assert.throws(() => generationRequest(profile, director, undefined, 'take'))
  assert.deepEqual(normalizeRef('image', { source: 'library', compositeHash: 'a'.repeat(48) }), { source: 'library', compositeHash: 'a'.repeat(48) })
})
test('video canvas only exposes final actual-or-original hashes when postprocessing is ready', () => {
  assert.equal(resultHash({ postprocess_status: 'processing', actual_composite_hash: otherHash, composite_hash: hash }), null)
  assert.equal(resultHash({ postprocess_status: 'ready', actual_composite_hash: otherHash, composite_hash: hash }), otherHash)
  assert.equal(resultHash({ postprocess_status: 'ready', actual_composite_hash: null, composite_hash: hash }), hash)
  assert.equal(resultHash({ postprocess_status: 'ready', composite_hash: null }), null)
})

function serviceFixture() {
  const db = new Database(':memory:'), calls: any[] = [], registered: any[] = [], hooks = new Map<string, any>()
  const state: any = { ready: false, fingerprint: 'fingerprint', audioRevision: 'revision-one', members: [{ kind: 'image' }], frames: [], frameId: randomUUID(), job: 480, joinTool: true, joins: [], jobs: {}, admin: true, presets: {}, sections: {} }
  // The host shows generation presets to administrators only; skill sections are read for any account and throw once gone.
  const refused = () => Object.assign(new Error('관리자만 볼 수 있어.'), { status: 403 })
  let pageHandler: any, jobHandler: any
  // Plugin tasks run in the background like the host's: the handler gets the starting account and a cancel signal.
  const tasks = new Map<string, any>()
  const conai = {
    db,
    warn() {},
    onJob(handler: any) { jobHandler = handler },
    jobs: {
      async start({ data }: any) {
        if (state.taskBusy) throw Object.assign(new Error('이 플러그인의 작업이 이미 실행 중이야.'), { status: 429 })
        const jobId = randomUUID(), controller = new AbortController(), task: any = { status: 'running', controller }
        tasks.set(jobId, task)
        task.done = new Promise(resolve => setImmediate(resolve)).then(() => jobHandler(data, { account: { id: 1, type: 'admin' }, signal: controller.signal }))
          .then(() => { task.status = controller.signal.aborted ? 'cancelled' : 'completed' }, (error: any) => { task.status = 'failed'; task.error = error.message })
        return { jobId, status: 'queued' }
      },
      async get(jobId: string) { const task = tasks.get(jobId); return { jobId, status: task.status, error: task.error ?? null } },
      async cancel(jobId: string) { tasks.get(jobId).controller.abort(new Error('cancelled')); return { jobId, status: 'cancelled' } },
    },
    tools: {
      register(definition: any) { registered.push(definition) },
      async list() { return [{ name: 'clip_video' }, ...(state.joinTool ? [{ name: 'join_videos' }] : [])] },
      async call(name: string, args: any) {
        calls.push({ name, args })
        if (name === 'join_videos') {
          if (!state.joinTool) throw new Error('플러그인 실행 문맥에서 지원하지 않는 앱 도구야: join_videos')
          return { job_id: state.frameId, ...(state.joins.shift() ?? { status: 'running', progress: 0 }) }
        }
        if (name === 'list_comfyui_servers') return [{ id: 1, name: '메인', routing_tags: ['gpu'] }, { id: 2, name: '보조', routing_tags: ['gpu', 'fast'] }]
        if (name === 'get_workflow_details') { state.detailsStarted?.(); if (state.detailsGate) await state.detailsGate; return state.workflowDetails?.[args.workflow_id] ?? details }
        if (name === 'get_image_metadata') return { duration: 4 }
        if (name === 'get_audio_candidate') return { duration_seconds: 4, revision: state.audioRevision }
        if (name === 'list_comfy_refmods') return { server_id: 1, entries: [{ name: 'crowd', members: state.members }] }
        if (name === 'submit_generation_job') return { job_id: ++state.job, status: 'queued' }
        if (name === 'cancel_generation_job') { state.jobs[args.job_id] = { status: 'cancelled' }; return { status: 'cancelled' } }
        if (name === 'get_generation_job') return state.jobs[args.job_id] ?? { status: 'completed', history_ids: [state.historyPerJob ? args.job_id : 91] }
        if (name === 'wait_generation_job') { state.onWait?.(args); await new Promise(resolve => setTimeout(resolve, 5)); return { finished: true } }
        if (name === 'save_video_frame') return { job_id: state.frameId, ...(state.frames.shift() ?? { status: 'completed', saved: [{ composite_hash: otherHash, seconds: 3.9 }] }) }
        if (name === 'get_media_edit_job') {
          state.frameWait?.(args)
          return { job_id: state.frameId, ...(args.cancel ? { status: 'cancelled' } : state.frames.shift() ?? { status: 'failed', error: 'unexpected frame wait' }) }
        }
        throw new Error(`Unexpected tool: ${name}`)
      },
    },
    media: { async resolve(ref: any) {
      calls.push({ name: 'resolve', args: ref })
      if (!['library', 'audio', 'files'].includes(ref.source)) throw new Error('invalid media reference')
      // New library media is hidden until its postprocessing ends.
      if (state.pendingMedia > 0) { state.pendingMedia--; throw Object.assign(new Error('아직 사용할 수 없는 미디어야.'), { status: 404 }) }
      return { fingerprint: state.fingerprint, mimeType: ref.source === 'audio' ? 'audio/ogg' : 'image/png', name: ref.source === 'audio' ? 'voice.ogg' : 'image.png', path: state.filePath ?? path.resolve(__dirname, 'fixtures/av-golden/audio/exports/short_blip_default_ogg.ogg') }
    } },
    app: { async fetch(url: string, options: any) {
      calls.push({ url, options })
      if (url === '/api/workflow-input-assets') {
        assert.match(Buffer.from(options.body).toString('latin1'), /Content-Disposition: form-data; name="file"; filename="voice.ogg"/)
        return Response.json({ success: true, data: { __ref: 'workflow-input-asset', id: 'f'.repeat(32), fileName: 'voice.ogg', mimeType: 'audio/ogg', bytes: 100 } })
      }
      if (url.startsWith('/api/workflow-input-assets/') && options?.method === 'DELETE') return Response.json({ success: true, data: { removed: true } })
      if (url === '/api/refmods') return Response.json({ data: [{ id: 1, name: 'crowd', status: 'saved', members: state.members }] })
      if (url === '/api/workflows?kind=audio') return Response.json({ success: true, data: [] })
      if (url === '/api/workflows?kind=image' && state.workflowsDenied) return Response.json({ success: false, error: '워크플로 보기 권한이 없어.' }, { status: 403 })
      if (url === '/api/workflows?kind=image') return Response.json({ success: true, data: [
        { id: 12, name: 'Director 기본', is_active: true, marked_fields: [
          { id: 'director', type: 'node', node_editor: 'minimax_h3_director_dasiwa', jsonPath: '3.inputs', node_hidden_controls: ['secret_switch'], default_value: { mode: 'T2VA', duration: 5, width: 1280, height: 720, frame_rate: 24, model_name: 'h3.safetensors', secret_switch: true, links: ['4', 0], timeline_data: JSON.stringify({ items: [], resolution: { aspect: '16:9', resolution: '720p' } }) } },
          { id: 'seed', type: 'number', jsonPath: '5.inputs.seed' },
          { id: 'steps', label: '스텝', type: 'number', jsonPath: '6.inputs.steps', default_value: 20 },
        ] },
        { id: 13, name: '이미지', is_active: true, marked_fields: [{ id: 'prompt', type: 'text', jsonPath: '1.inputs.text' }] },
        ...(state.secondDirector ? [{ id: 14, name: 'Director 보조', is_active: true, marked_fields: [
          { id: 'director', type: 'node', node_editor: 'minimax_h3_director_dasiwa', jsonPath: '3.inputs', default_value: { mode: 'T2VA' } },
          { id: 'seed', type: 'number', jsonPath: '5.inputs.seed' }] }] : []),
      ] })
      if (url === '/api/generation-history/91') return Response.json({ record: { postprocess_status: state.ready ? 'ready' : 'processing', composite_hash: hash, actual_composite_hash: otherHash } })
      if (url.startsWith('/api/generation-history/')) {
        const job = Number(url.split('/').at(-1))
        return Response.json({ record: { postprocess_status: state.failedHistory?.includes(job) ? 'failed' : 'ready', composite_hash: jobHash(job) } })
      }
      throw new Error(`Unexpected URL: ${url}`)
    } },
    generationPresets: {
      async list() { if (!state.admin) throw refused(); return Object.values(state.presets).map((preset) => structuredClone(preset)) },
      async get(id: number) { if (!state.admin) throw refused(); if (!state.presets[id]) throw Object.assign(new Error('프리셋이 없어.'), { status: 404 }); return structuredClone(state.presets[id]) },
    },
    skills: { async section({ skillId, path }: any) {
      const text = state.sections[`${skillId}:${path}`]
      if (text === undefined) throw Object.assign(new Error('스킬 섹션이 없어.'), { status: 404 })
      return { skillId, path, skillName: '스타일', title: path, updatedDate: '2026-01-01', text }
    } },
    hooks: { on(name: string, handler: any) { hooks.set(name, handler) } }, onRequest(handler: any) { pageHandler = handler },
  }
  const service = activate(conai), account = { id: 1 }
  const dispatch = (op: string, args: any = {}, actor = 'assistant', options = {}) => service.dispatch({ op, ...args }, account, actor, options)
  const tool = async (name: string, args: any, actorAccount = account) => unwrap(await registered.find(tool => tool.name === name).handler(args, { account: actorAccount }))
  return { db, conai, calls, state, service, dispatch, tool, tasks, emit: (name: string, event: any) => hooks.get(name)(event), page: (body: any) => pageHandler({ body, account }), markReady: () => { state.ready = true } }
}
async function until<T>(read: () => T): Promise<T> {
  for (let attempt = 0; attempt < 400; attempt++) {
    const value = read()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('condition not reached')
}
async function fixtureProject(f: ReturnType<typeof serviceFixture>, audio = false) {
  const created = await f.dispatch('create_project', { name: '영화' })
  let { project } = canvas()
  project.id = created.id; project.revision = 1
  if (audio) project = ops(project, [
    { op: 'add_node', kind: 'audio', name: '목소리', ref: { source: 'audio', candidateId: 'voice' }, tempId: 'voice' },
    { op: 'connect', from: 'voice', to: project.nodes[0].id, port: 'ref_audio' },
  ]).project
  project.revision = 1
  for (const node of project.nodes.filter((node: any) => node.kind !== 'cut')) node.data.fingerprint = 'fingerprint'
  f.service.store.save('account:1', created, project)
  // Profiles live in the account library, not in the project.
  f.service.store.putProfile('account:1', structuredClone(profile))
  return project
}
async function runArgs(f: ReturnType<typeof serviceFixture>, project: any, extra: any = {}) {
  const preview = await f.dispatch('read_node', { project_id: project.id, id: project.nodes[0].id })
  return { project_id: project.id, cut_id: project.nodes[0].id, expected_revision: preview.revision, requestId: randomUUID(), ...extra,
    ...(extra.mode === 'propose' ? { input_digest: preview.preview.inputDigest } : {}) }
}
test('video canvas proposal approval, uploads, retries and delayed hashes share the server submission path', async () => {
  const f = serviceFixture()
  try {
    const project = await fixtureProject(f, true), cut = project.nodes[0]
    const proposal = await f.dispatch('run_cut', await runArgs(f, project, { mode: 'propose' }))
    assert.equal(proposal.status, 'proposed')
    assert.equal(f.calls.filter(call => call.name === 'submit_generation_job').length, 0)
    for (const action of ['approve', 'discard', 'retry']) await assert.rejects(() => f.tool('run_cut', { project_id: project.id, take_id: proposal.id, action, input_digest: proposal.inputDigest, origin: 'human' }), /사람/)
    const run = await f.dispatch('run_cut', { project_id: project.id, take_id: proposal.id, action: 'approve', input_digest: proposal.inputDigest }, 'human')
    assert.equal(run.jobId, 481)
    assert.equal(f.calls.find(call => call.name === 'submit_generation_job').args.inputs.seed, 482913)
    assert.equal(f.calls.filter(call => call.url === '/api/workflow-input-assets').length, 1)
    const rerun = await f.dispatch('run_cut', await runArgs(f, project, { take_id: run.id, inputs: 'take' }))
    assert.equal(rerun.seed, run.seed)
    assert.deepEqual(f.calls.filter(call => call.name === 'submit_generation_job')[1].args.inputs.director.assets, f.calls.find(call => call.name === 'submit_generation_job').args.inputs.director.assets)
    assert.equal(f.calls.filter(call => call.url === '/api/workflow-input-assets').length, 1)
    assert.equal((await f.dispatch('get_take', { project_id: project.id, take_id: run.id })).resultHash, null)
    f.markReady()
    assert.equal((await f.dispatch('get_take', { project_id: project.id, take_id: run.id })).resultHash, otherHash)
    const current = f.service.store.get('account:1', project.id)
    const frame = await f.dispatch('extract_frame', { project_id: project.id, expected_revision: current.revision, take_id: run.id, position: 'last', target: { cut: cut.id, port: 'start' } })
    assert.equal(frame.nodeIds.length, 1)
    const saved = f.service.store.get('account:1', project.id)
    assert.equal(saved.nodes.find((node: any) => node.id === frame.nodeIds[0]).kind, 'frame')
    assert.ok(saved.edges.some((edge: any) => edge.from === frame.nodeIds[0] && edge.port === 'start'))
    await f.dispatch('run_cut', { project_id: project.id, take_id: run.id, action: 'retry' })
    assert.equal(f.calls.filter(call => call.name === 'submit_generation_job').length, 2)
    const read = await f.tool('read_canvas', { project_id: project.id, node_id: cut.id })
    assert.equal(read.node.id, cut.id)
    assert.ok(read.edges.some((edge: any) => edge.from === frame.nodeIds[0]))
    await assert.rejects(() => f.tool('read_canvas', { project_id: project.id }, { id: 2 }), /접근/)
  } finally { f.db.close() }
})
test('video canvas ranks remain contiguous after disconnect, append and source removal', () => {
  let project = ops(newProject('p', 'p'), [
    { op: 'add_node', kind: 'cut', tempId: 'cut' },
    ...Array.from({ length: 9 }, (_, index) => ({ op: 'add_node', kind: 'image', name: `소재 ${index}`, ref: image, tempId: `n${index}` })),
    ...Array.from({ length: 9 }, (_, index) => ({ op: 'connect', from: `n${index}`, to: 'cut', port: 'ref_image' })),
  ]).project
  project.nodes[0].data.mode = 'REF2VA'
  const firstSource = project.edges[0].from, cutId = project.nodes[0].id
  project = ops(project, [{ op: 'disconnect', id: project.edges[0].id }, { op: 'connect', from: firstSource, to: cutId, port: 'ref_image', position: 999 }]).project
  assert.deepEqual(project.edges.slice().sort((a: any, b: any) => a.position - b.position).map((edge: any) => edge.from), [...project.nodes.slice(2).map((node: any) => node.id), firstSource])
  assert.deepEqual(mediaItems(project, project.nodes[0]).map((item: any) => [item.slot, item.order]), [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6], [7, 7], [8, 8]])
  project = ops(project, [{ op: 'remove', id: firstSource }]).project
  assert.deepEqual(project.edges.map((edge: any) => edge.position), [0, 1, 2, 3, 4, 5, 6, 7])
})
test('video canvas rejects invalid add/set seeds and frame anchors are not unused references', () => {
  const project = newProject('p', 'p')
  for (const seed of [-1, -2, 2147483648, 0.5, null]) assert.equal(ops(project, [{ op: 'add_node', kind: 'cut', seed }]).rejected.length, 1)
  const built = canvas()
  const changed = ops(built.project, [
    { op: 'connect', from: built.a.id, to: built.cut.id, port: 'start' },
    { op: 'connect', from: built.b.id, to: built.cut.id, port: 'end' },
    { op: 'set', id: built.cut.id, fields: { mode: 'FL2VA', prompt: '' } },
    { op: 'set', id: built.cut.id, fields: { seed: -1 } },
  ])
  assert.equal(changed.rejected.length, 1)
  assert.deepEqual(resolvePrompt(changed.project, changed.project.nodes[0]).warnings, [])
  assert.deepEqual(mediaItems(changed.project, changed.project.nodes[0]).map((item: any) => [item.slot, item.order]), [[0, 0], [1, 1]])
})
test('video canvas uses only the new profile overrides and preserves saved workflow frame rate', async () => {
  const f = serviceFixture()
  try {
    const project = await fixtureProject(f), cut = project.nodes[0]
    const first = { ...profile, overrides: { frame_rate: 60, width: 1280, postprocess: { simple: { enabled: true } } } }
    await f.dispatch('save_profile', { project_id: project.id, expected_revision: 1, profile: first })
    const take = await f.dispatch('run_cut', await runArgs(f, project))
    await f.dispatch('save_profile', { project_id: project.id, expected_revision: 2, profile: { ...profile, id: 'final', label: '본작업', overrides: { width: 1920 } } })
    const second = await f.dispatch('run_cut', await runArgs(f, project, { take_id: take.id, inputs: 'take', profile_id: 'final' }))
    const sent = f.calls.filter(call => call.name === 'submit_generation_job').at(-1).args.inputs.director
    const native = normalizeMcpWorkflowInputs([{ id: 'director', type: 'node', node_editor: 'minimax_h3_director_dasiwa', default_value: { frame_rate: 30, timeline_data: JSON.stringify({ postprocess: { simple: { enabled: false } } }) } }] as any, { director: sent })
    assert.equal(second.profile.id, 'final')
    assert.equal(second.seed, take.seed)
    assert.equal(native.director.frame_rate, 30)
    assert.equal(native.director.width, 1920)
    assert.equal(JSON.parse(native.director.timeline_data).postprocess.simple.enabled, false)
    cut.data.frame_rate = 48
    const explicit = normalizeMcpWorkflowInputs([{ id: 'director', type: 'node', node_editor: 'minimax_h3_director_dasiwa', default_value: { frame_rate: 30 } }] as any, { director: buildDirector(project, cut) })
    assert.equal(explicit.director.frame_rate, 48)
  } finally { f.db.close() }
})
test('video canvas durable request IDs and in-flight cut digests submit once under concurrent calls', async () => {
  const f = serviceFixture()
  try {
    const project = await fixtureProject(f)
    let release!: () => void, started!: () => void
    f.state.detailsGate = new Promise<void>(resolve => { release = resolve })
    const entered = new Promise<void>(resolve => { started = resolve }); f.state.detailsStarted = started
    const args = await runArgs(f, project)
    const first = f.dispatch('run_cut', args)
    await entered
    const second = f.dispatch('run_cut', { ...args, requestId: randomUUID() })
    const retry = await f.dispatch('run_cut', args)
    release()
    const [a, b] = await Promise.all([first, second])
    assert.equal(a.id, b.id); assert.equal(a.id, retry.id)
    assert.equal(f.calls.filter(call => call.name === 'submit_generation_job').length, 1)
    const edited = await f.dispatch('apply_ops', { project_id: project.id, expected_revision: 1, ops: [{ op: 'move', id: project.nodes[1].id, x: 1, y: 2 }] })
    assert.equal(edited.revision, 2)
    assert.equal((await f.dispatch('run_cut', args)).id, a.id)
    await assert.rejects(() => f.dispatch('run_cut', { ...args, new_seed: true }), /requestId/)
  } finally { f.db.close() }
})
test('video canvas generation hook uses the job index and status updates do not stale edit revisions or proposals', async () => {
  const f = serviceFixture()
  try {
    const project = await fixtureProject(f)
    const proposal = await f.dispatch('run_cut', { ...await runArgs(f, project, { mode: 'propose' }), expected_revision: 0 })
    const queued = await f.dispatch('run_cut', await runArgs(f, project))
    const unrelated = await f.dispatch('create_project', { name: 'unrelated' })
    f.db.prepare("UPDATE vc_project SET data='not-json' WHERE id=?").run(unrelated.id)
    f.emit('generation.finished', { jobId: queued.jobId, status: 'completed', history: [{ id: 91, compositeHash: otherHash }] })
    const after = f.service.store.get('account:1', project.id)
    assert.equal(after.revision, 1)
    assert.equal(after.takes.find((take: any) => take.id === queued.id).historyId, 91)
    assert.equal(after.takes.find((take: any) => take.id === queued.id).resultHash, null)
    assert.equal((await f.dispatch('get_take', { project_id: project.id, take_id: queued.id })).resultHash, null)
    f.markReady()
    assert.equal((await f.dispatch('get_take', { project_id: project.id, take_id: queued.id })).resultHash, otherHash)
    const approved = await f.dispatch('run_cut', { project_id: project.id, take_id: proposal.id, action: 'approve', input_digest: proposal.inputDigest, expected_revision: 0 }, 'human')
    assert.equal(approved.status, 'queued')
    const nextProposal = await f.dispatch('run_cut', await runArgs(f, project, { mode: 'propose' }))
    await f.dispatch('apply_ops', { project_id: project.id, expected_revision: 1, ops: [{ op: 'set', id: project.nodes[0].id, fields: { prompt: '다른 장면' } }] })
    await assert.rejects(() => f.dispatch('run_cut', { project_id: project.id, action: 'approve', take_id: nextProposal.id, input_digest: nextProposal.inputDigest }, 'human'), (error: any) => error.status === 409)
    for (const bad of [{ mode: 'evil' }, { action: 'evil' }, { inputs: 'evil' }, { new_seed: 'yes' }]) await assert.rejects(() => f.tool('run_cut', { project_id: project.id, ...bad }))
  } finally { f.db.close() }
})
test('video canvas keeps one assistant undo batch without logging human drags or job state', async () => {
  const f = serviceFixture()
  try {
    const project = await fixtureProject(f)
    await f.dispatch('apply_ops', { project_id: project.id, expected_revision: 1, ops: [{ op: 'move', id: project.nodes[1].id, x: 10, y: 10 }] })
    const log = f.service.store.lastLog(project.id)
    for (let index = 0; index < 4; index++) await f.dispatch('apply_ops', { project_id: project.id, expected_revision: 2 + index, ops: [{ op: 'move', id: project.nodes[1].id, x: index, y: index }] }, 'human')
    assert.equal(f.service.store.lastLog(project.id).before_data, log.before_data)
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM vc_undo').get() as { n: number }).n, 1)
    const batch = await f.dispatch('apply_ops', { project_id: project.id, expected_revision: 6, ops: [{ op: 'set', id: project.nodes[0].id, fields: { prompt: '바뀐 장면' } }] })
    await f.dispatch('run_cut', await runArgs(f, project))
    await f.dispatch('check', { project_id: project.id })
    await f.dispatch('undo', { project_id: project.id, expected_revision: batch.revision })
    const undone = f.service.store.get('account:1', project.id)
    assert.equal(undone.nodes[0].data.prompt, project.nodes[0].data.prompt)
    assert.equal(undone.takes.length, 1)
  } finally { f.db.close() }
})
test('video canvas audio checks use the file fingerprint and uploads are reused and released for discarded proposals', async () => {
  const f = serviceFixture()
  try {
    const project = await fixtureProject(f, true), audio = project.nodes.find((node: any) => node.kind === 'audio')
    f.state.audioRevision = 'renamed-review-notes-changed'
    assert.equal((await f.dispatch('check', { project_id: project.id })).assets[audio.id].status, 'ready')
    const first = await f.dispatch('run_cut', await runArgs(f, project, { mode: 'propose' }))
    const second = await f.dispatch('run_cut', await runArgs(f, project, { mode: 'propose' }))
    assert.equal(f.calls.filter(call => call.url === '/api/workflow-input-assets').length, 1)
    await f.dispatch('run_cut', { project_id: project.id, take_id: first.id, action: 'discard', input_digest: first.inputDigest }, 'human')
    assert.equal(f.calls.filter(call => call.options?.method === 'DELETE').length, 0)
    await f.dispatch('run_cut', { project_id: project.id, take_id: second.id, action: 'discard', input_digest: second.inputDigest }, 'human')
    assert.equal(f.calls.filter(call => call.options?.method === 'DELETE').length, 1)
    await assert.rejects(async () => f.dispatch('run_cut', { ...await runArgs(f, project), take_id: second.id, inputs: 'take' }), /폐기한 제안/)
    assert.equal(f.calls.filter(call => call.url === '/api/workflow-input-assets').length, 1)
    await f.dispatch('run_cut', await runArgs(f, project, { take_id: second.id, inputs: 'canvas' }))
    assert.equal(f.calls.filter(call => call.url === '/api/workflow-input-assets').length, 2)
    f.state.fingerprint = 'new-file'
    assert.equal((await f.dispatch('check', { project_id: project.id })).assets[audio.id].status, 'changed')
  } finally { f.db.close() }
})
test('video canvas bundle checks share remote calls and bundle fingerprint refresh never uses media.resolve', async () => {
  const f = serviceFixture()
  try {
    const project = await fixtureProject(f), cut = project.nodes[0]
    const imported = await f.dispatch('apply_ops', { project_id: project.id, expected_revision: 1, ops: [
      { op: 'import_bundle', ref: { name: 'crowd', recordId: 1 }, tempId: 'one' },
      { op: 'import_bundle', ref: { name: 'crowd', recordId: 1 }, tempId: 'two' },
      { op: 'connect', from: 'one', to: cut.id, port: 'refmod' }, { op: 'connect', from: 'two', to: cut.id, port: 'refmod' },
    ] })
    f.state.members = [{ kind: 'image' }, { kind: 'audio' }]
    const start = f.calls.length, checks = await f.dispatch('check', { project_id: project.id })
    assert.equal(f.calls.slice(start).filter(call => call.name === 'list_comfy_refmods').length, 1)
    assert.equal(f.calls.slice(start).filter(call => call.url === '/api/refmods').length, 1)
    const id = imported.tempIds.one
    assert.equal(checks.assets[id].status, 'changed')
    await f.dispatch('accept_fingerprint', { project_id: project.id, expected_revision: imported.revision, id }, 'human')
    assert.equal((await f.dispatch('check', { project_id: project.id })).assets[id].status, 'ready')
  } finally { f.db.close() }
})
test('video canvas long-waits extraction progress, accumulates rejected connections and honours abort', async () => {
  const f = serviceFixture()
  try {
    const project = await fixtureProject(f), take = await f.dispatch('run_cut', await runArgs(f, project))
    f.markReady()
    f.state.frames = [{ status: 'running', progress: 0 }, { status: 'running', progress: 0.5 }, { status: 'completed', saved: ['c', 'd', 'e'].map((value, index) => ({ composite_hash: value.repeat(32), seconds: index })) }]
    const first = await f.dispatch('extract_frame', { project_id: project.id, expected_revision: 1, take_id: take.id, target: { cut: project.nodes[0].id, port: 'start' } })
    assert.equal(first.status, 'running')
    assert.equal(f.service.store.get('account:1', project.id).revision, 1)
    const finished = await f.dispatch('extract_frame', { project_id: project.id, extraction_id: first.id, wait_seconds: 120 })
    assert.equal(finished.nodeIds.length, 3)
    assert.equal(finished.rejected.length, 2)
    assert.equal(f.service.store.get('account:1', project.id).revision, 2)
    assert.ok(f.calls.some(call => call.name === 'get_media_edit_job' && call.args.wait_seconds > 0))
    f.state.frames = [{ status: 'running' }, { status: 'running', progress: 0.2 }]
    const next = await f.dispatch('extract_frame', { project_id: project.id, expected_revision: 2, take_id: take.id })
    const controller = new AbortController()
    f.state.frameWait = () => controller.abort()
    await assert.rejects(() => f.dispatch('extract_frame', { project_id: project.id, extraction_id: next.id, wait_seconds: 120 }, 'assistant', { signal: controller.signal }), { name: 'AbortError' })
    assert.equal(f.service.store.extraction('account:1', project.id, next.id).progress, 0.2)
    assert.equal(f.service.store.get('account:1', project.id).revision, 2)
  } finally { f.db.close() }
})
test('video canvas sanitizes filesystem read failures before returning page outcomes', async () => {
  const f = serviceFixture()
  try {
    const project = await fixtureProject(f, true)
    f.state.filePath = path.join(__dirname, 'private-does-not-exist', 'secret.ogg')
    const result = await f.page({ op: 'run_cut', ...await runArgs(f, project) })
    assert.equal(result.ok, false)
    assert.match(result.error, /파일을 읽을 수 없어/)
    assert.equal(JSON.stringify(result).includes('private-does-not-exist'), false)
    assert.equal(result.outcome.status, 'failed')
  } finally { f.db.close() }
})
test('video canvas canvas/node pages and bounded published outcomes preserve all records and large text', async () => {
  const f = serviceFixture()
  try {
    const project = await fixtureProject(f), cut = project.nodes[0]
    const expanded = ops(project, Array.from({ length: 100 }, () => ({ op: 'connect', from: project.nodes[1].id, to: cut.id, port: 'ref_image' }))).project
    f.service.store.save('account:1', project, expanded)
    for (let index = 0; index < 25; index++) f.service.store.addTake('account:1', project.id, { id: `take-${index}`, cutId: cut.id, seed: index, status: 'proposed', profile, resolved: {} })
    const ids: string[] = [], takes: string[] = []
    let cursor: string | null = null
    // as never: allowJs infers excerpt()'s options from its defaulted keys only; it reads edge_cursor and limit too.
    do { const page = excerpt(f.service.store.get('account:1', project.id), { edge_cursor: cursor, limit: 7 } as never); ids.push(...page.edges.map((edge: any) => edge.id)); cursor = page.nextEdgeCursor } while (cursor)
    assert.equal(new Set(ids).size, 102)
    cursor = null
    do { const page = await f.tool('read_canvas', { project_id: project.id, node_id: cut.id, take_cursor: cursor, limit: 7 }); takes.push(...page.takes.map((take: any) => take.id)); assert.ok(page.edges.length); cursor = page.nextTakeCursor } while (cursor)
    assert.equal(new Set(takes).size, 25)
    const text = '큰 장면 설명 '.repeat(30000), publication = createAssistantState()
    publication.set('lastNode', { node: { id: cut.id, prompt: text }, edges: [...ids, ...Array.from({ length: 600 }, (_, index) => `extra-${index}`)] }, { nodeId: cut.id })
    publication.set('lastRun', { takeId: 'take-1', seed: 482913, resolved: { prompt: text, table: [{ label: '<Picture 1>', name: '유나' }] }, checks: { blocked: false } }, { takeId: 'take-1', seed: 482913 })
    let restored = ''; cursor = null
    do {
      publication.page('lastNode', cursor)
      const snapshot = publication.snapshot({ launch: null }, 2)
      assert.ok(JSON.stringify(snapshot).length <= 200000)
      copyChatPageData(JSON.parse(JSON.stringify(snapshot.data)))
      restored += snapshot.data.lastNode.json ? JSON.parse(snapshot.data.lastNode.json) : JSON.stringify(snapshot.data.lastNode.data)
      assert.equal(snapshot.data.lastRun.summary.seed, 482913)
      cursor = snapshot.data.lastNode.nextCursor
    } while (cursor)
    assert.equal(JSON.parse(restored).node.prompt, text)
    const message = rejectedMessage({ applied: [{ id: 'a' }], rejected: [{ reason: '슬롯이 달라' }] })
    assert.match(message, /1건 적용, 1건 거절/); assert.ok(message.length <= 500)
  } finally { f.db.close() }
})
test('video canvas refresh queues one follow-up when completion arrives during an active refresh', async () => {
  let release!: () => void, entered!: () => void, count = 0
  const gate = new Promise<void>(resolve => { release = resolve }), started = new Promise<void>(resolve => { entered = resolve })
  const refresh = createRefreshQueue(async () => { count++; if (count === 1) { entered(); await gate } })
  const pending = refresh(); await started
  refresh(); refresh(); release()
  await pending
  assert.equal(count, 2)
})
test('video canvas proposal cards bind human-readable fields to the current server preview', async () => {
  const f = serviceFixture()
  try {
    const project = await fixtureProject(f)
    const node = await f.dispatch('read_node', { project_id: project.id, id: project.nodes[0].id })
    assert.ok(node.preview.review, 'cut preview must expose the exact reviewable card arguments')
    assert.equal(node.preview.review.cut_mode, 'REF2VA')
    assert.equal(node.preview.review.seed, 482913)
    assert.equal(node.preview.review.profile_label, '초안')
    assert.equal(node.preview.review.prompt, '<Picture 1> 이 <Picture 2> 앞에 서 있어.')
    assert.equal(JSON.parse(node.preview.review.slot_summary)[0].label, '<Picture 1>')
    const fields = { ...node.preview.review, project_id: project.id }
    for (const mismatch of [{ cut_mode: 'T2VA' }, { seed: 0 }, { duration: 6 }, { profile_id: 'other' }, { profile_label: '다른 프로필' }, { prompt: '다른 프롬프트' }, { slot_summary: '[]' }]) {
      await assert.rejects(() => f.dispatch('propose_run_cut', { ...fields, ...mismatch, requestId: randomUUID() }), (error: { status: number }) => error.status === 409)
    }
    assert.equal(f.calls.filter(call => call.name === 'submit_generation_job').length, 0)
    const accepted = await f.dispatch('propose_run_cut', { ...fields, requestId: randomUUID() })
    assert.equal(accepted.status, 'queued')
    assert.equal(f.calls.filter(call => call.name === 'submit_generation_job').length, 1)
  } finally { f.db.close() }
})
test('video canvas publishes arbitrary tempId and op keys without copying a protected-key policy', () => {
  const tempId = 'token-shot'
  assert.equal(isPrivateChatPageKey(tempId), true)
  const batch = { applied: [{ op: { op: 'add_node', kind: 'cut', tempId }, id: 'n1', tempId }], rejected: [{ op: { op: 'set', fields: { [tempId]: true } }, reason: '필드가 달라' }], tempIds: { [tempId]: 'n1' } }
  assert.throws(() => copyChatPageData(batch), /token-shot/)
  const state = createAssistantState()
  state.set('lastEdit', batch)
  const snapshot = state.snapshot({}, 1)
  assert.doesNotThrow(() => copyChatPageData(JSON.parse(JSON.stringify(snapshot.data))))
  assert.deepEqual(snapshot.data.lastEdit.data.tempIds, [{ tempId, id: 'n1' }])
  assert.equal(JSON.parse(snapshot.data.lastEdit.data.rejected[0].op).fields[tempId], true)
})
test('video canvas ignores invalid outcome cursors without poisoning later snapshots', () => {
  const state = createAssistantState()
  state.set('lastNode', { node: { id: 'cut' } })
  state.page('lastNode', '999999999')
  assert.doesNotThrow(() => state.snapshot({}, 1))
  state.set('lastRun', { takeId: 'take' })
  assert.doesNotThrow(() => state.snapshot({}, 2))
  assert.equal(state.snapshot({}, 2).data.lastNode.data.node.id, 'cut')
})
test('video canvas manifest accepts user text up to the actual host text boundary', async () => {
  const f = serviceFixture()
  try {
    const project = await fixtureProject(f)
    const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../plugins/video-canvas/plugin.json'), 'utf8'))
    const action = (id: string) => normalizeChatPageSchema(manifest.pages[0].actions.find((item: { id: string }) => item.id === `video-canvas.${id}`).schema)
    const review = (await f.dispatch('read_node', { project_id: project.id, id: project.nodes[0].id })).preview.review
    const proposeSchema = action('propose_run_cut')
    for (const field of ['prompt', 'slot_summary', 'profile_label']) {
      assert.doesNotThrow(() => validateChatPageArguments(proposeSchema, { ...review, [field]: 'x'.repeat(8001) }))
      assert.doesNotThrow(() => validateChatPageArguments(proposeSchema, { ...review, [field]: 'x'.repeat(CHAT_PAGE_ACTION_LIMITS.text) }))
      assert.throws(() => validateChatPageArguments(proposeSchema, { ...review, [field]: 'x'.repeat(CHAT_PAGE_ACTION_LIMITS.text + 1) }))
    }
    for (const field of ['ops', 'create_name', 'profile_json']) {
      assert.doesNotThrow(() => validateChatPageArguments(action('edit'), { expected_revision: 1, [field]: 'x'.repeat(8001) }))
    }
  } finally { f.db.close() }
})
test('video canvas profile publication keeps override keys in JSON strings and drops unknown profile fields', async () => {
  const f = serviceFixture()
  try {
    const project = await fixtureProject(f)
    const saved = await f.dispatch('save_profile', { project_id: project.id, expected_revision: 1,
      profile: { ...profile, unknown_token: 'not a profile field', overrides: { prompt_enhancer_token_limit: 12000 } } })
    assert.equal(saved.profile.unknown_token, undefined)
    assert.deepEqual(f.service.store.get('account:1', project.id).profiles[0].overrides, { prompt_enhancer_token_limit: 12000 })
    assert.deepEqual(JSON.parse(saved.profile.overrides), { prompt_enhancer_token_limit: 12000 })
    const run = await f.dispatch('run_cut', await runArgs(f, project))
    const detail = await f.dispatch('read_node', { project_id: project.id, id: project.nodes[0].id })
    const take = await f.dispatch('get_take', { project_id: project.id, take_id: run.id })
    for (const published of [run.profile, take.profile, detail.preview.profile, detail.takes[0].profile]) {
      assert.equal(typeof published.overrides, 'string')
      assert.deepEqual(JSON.parse(published.overrides), { prompt_enhancer_token_limit: 12000 })
    }
    const state = createAssistantState()
    state.set('lastNode', detail)
    state.set('lastRun', run)
    // The page publishes a person's library save once (session recordEdits) before it records it for the assistant.
    const pageSaved = await f.page({ op: 'save_profile', profile: { id: profile.id, label: '페이지에서 저장' } })
    state.set('lastEdit', { profileId: pageSaved.profileId, profiles: [{ ...profilePublication(pageSaved.profile), role: roleOf(pageSaved.profile) }], settings: pageSaved.settings, applied: [{ op: 'save_profile' }], rejected: [], tempIds: {} })
    assert.doesNotThrow(() => copyChatPageData(JSON.parse(JSON.stringify(state.snapshot({}, saved.revision).data))))
    assert.equal(typeof state.snapshot({}, saved.revision).data.lastEdit.data.profiles[0].overrides, 'string')
    assert.equal(f.calls.find(call => call.name === 'submit_generation_job').args.inputs.director.prompt_enhancer_token_limit, 12000)
  } finally { f.db.close() }
})
test('video canvas host-shape fallback follows protected-key names and their host exceptions', () => {
  for (const key of ['prompt_enhancer_token_limit', 'password', 'secret', 'credential', 'api_key', 'authorization', 'bearer', 'headers', '비밀번호', '인증키', '__proto__', 'prototype', 'constructor', 'dataUrl', 'base64', 'encoded', 'maxTokens', 'contextTokens', 'reasoningBudgetTokens', 'prompt']) {
    const state = createAssistantState(), value = { settings: { [key]: 1 } }
    state.set('futureUserData', value)
    const snapshot = state.snapshot({}, 1), section = snapshot.data.futureUserData
    assert.doesNotThrow(() => copyChatPageData(JSON.parse(JSON.stringify(snapshot.data))))
    if (isPrivateChatPageKey(key)) {
      assert.equal(section.encoding, 'json-string')
      assert.deepEqual(JSON.parse(JSON.parse(section.json)), value)
    } else assert.deepEqual(section.data, value)
  }
})
test('video canvas project list, rename, archive, duplicate and delete stay account-owned', async () => {
  const f = serviceFixture()
  try {
    const project = await fixtureProject(f, true)
    const take = await f.dispatch('run_cut', await runArgs(f, project))
    f.markReady()
    await f.dispatch('get_take', { project_id: project.id, take_id: take.id })
    await f.dispatch('create_project', { name: '두 번째 장면' })
    const other = { id: 2 }, asOther = (body: any) => f.service.dispatch(body, other, 'human', { page: true })
    for (const op of ['rename_project', 'archive_project', 'duplicate_project', 'delete_project']) {
      await assert.rejects(() => asOther({ op, project_id: project.id, name: '남의 것', archived: true }), (error: any) => error.status === 404)
    }
    await assert.rejects(() => f.tool('manage_project', { project_id: project.id, action: 'rename', name: '남의 것' }, other), /접근/)
    assert.deepEqual((await asOther({ op: 'list_projects' })).projects, [])
    const listed = await f.dispatch('list_projects', { query: '영', sort: 'name' })
    assert.equal(listed.total, 1)
    assert.equal(listed.nextOffset, null)
    const { updated, created, ...row } = listed.projects[0]
    assert.ok(updated && created)
    assert.deepEqual(row, { id: project.id, name: '영화', revision: 1, nodeCount: 4, cutCount: 1, archived: false, cover: otherHash })
    assert.deepEqual((await f.dispatch('list_projects', { limit: 1 })).nextOffset, 1)

    const renamed = await f.tool('manage_project', { project_id: project.id, action: 'rename', name: '  새 영화 ' })
    assert.equal(renamed.name, '새 영화')
    assert.equal(renamed.revision, 1)
    assert.equal(f.service.store.get('account:1', project.id).name, '새 영화')
    const copy = await f.tool('manage_project', { project_id: project.id, action: 'duplicate' })
    assert.equal(copy.name, '새 영화 사본')
    assert.equal(copy.takes.length, 0)
    assert.equal(copy.nodes.length, 4)
    assert.ok(copy.nodes.every((node: any) => !project.nodes.some((old: any) => old.id === node.id)))
    assert.deepEqual(copy.sequence, [copy.nodes[0].id])
    assert.equal(copy.nodes[0].data.profileId, 'draft')
    assert.ok(copy.edges.every((edge: any) => copy.nodes.some((node: any) => node.id === edge.from) && edge.to === copy.nodes[0].id))

    assert.equal((await f.tool('manage_project', { project_id: project.id, action: 'archive' })).archived, true)
    assert.equal((await f.dispatch('list_projects')).projects.some((item: any) => item.id === project.id), false)
    assert.deepEqual((await f.dispatch('list_projects', { archived: true })).projects.map((item: any) => item.id), [project.id])

    await assert.rejects(() => f.dispatch('delete_project', { project_id: project.id }), (error: any) => error.status === 403)
    assert.equal((await f.page({ op: 'delete_project', project_id: project.id, name: '다른 이름' })).status, 409)
    assert.deepEqual(await f.page({ op: 'delete_project', project_id: project.id, name: '새 영화', origin: 'assistant' }), { id: project.id, deleted: true, cleanupErrors: [] })
    assert.equal(f.calls.filter(call => call.options?.method === 'DELETE').length, 1)
    for (const table of ['vc_take', 'vc_take_upload', 'vc_upload', 'vc_run_request']) assert.equal((f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n, 0)
    assert.equal((await f.dispatch('list_projects')).total, 2)
  } finally { f.db.close() }
})
test('video canvas sequence follows cut adds and removals, rejects non-cuts and is undoable', async () => {
  const f = serviceFixture()
  try {
    const project = await fixtureProject(f), first = project.nodes[0].id
    const sequence = () => f.service.store.get('account:1', project.id).sequence
    f.db.prepare("UPDATE vc_project SET data=json_remove(data,'$.sequence') WHERE id=?").run(project.id)
    assert.deepEqual(sequence(), [first])
    const added = await f.dispatch('apply_ops', { project_id: project.id, expected_revision: 1, ops: [{ op: 'add_node', kind: 'cut', tempId: 'b' }, { op: 'add_node', kind: 'cut', tempId: 'c' }] })
    const { b, c } = added.tempIds
    assert.deepEqual(sequence(), [first, b, c])
    assert.equal(f.service.store.get('account:1', project.id).nodes.find((node: any) => node.id === b).data.profileId, 'draft')
    const reordered = await f.dispatch('apply_ops', { project_id: project.id, expected_revision: added.revision, ops: [
      { op: 'sequence', order: [c, first] }, { op: 'sequence', order: [project.nodes[1].id] }, { op: 'sequence', order: ['missing'] }, { op: 'sequence', order: [c, c] },
    ] })
    assert.equal(reordered.rejected.length, 3)
    assert.deepEqual(sequence(), [c, first, b])
    const undone = await f.dispatch('undo', { project_id: project.id, expected_revision: reordered.revision })
    assert.deepEqual(f.service.store.get('account:1', project.id).sequence, [first, b, c])
    await f.dispatch('apply_ops', { project_id: project.id, expected_revision: undone.revision, ops: [{ op: 'remove', id: first }] }, 'human')
    assert.deepEqual(sequence(), [b, c])
  } finally { f.db.close() }
})
test('video canvas workflow options detect Director/seed fields and a workflow-only profile saves and sends extra inputs', async () => {
  const f = serviceFixture()
  try {
    const project = await fixtureProject(f)
    const options = await f.dispatch('workflow_options')
    assert.deepEqual(options.servers, [{ id: 1, name: '메인', tags: ['gpu'] }, { id: 2, name: '보조', tags: ['gpu', 'fast'] }])
    assert.deepEqual(options.tags, ['fast', 'gpu'])
    const [director, image] = options.workflows
    assert.deepEqual({ usable: director.usable, directorFieldId: director.directorFieldId, seedFieldId: director.seedFieldId }, { usable: true, directorFieldId: 'director', seedFieldId: 'seed' })
    assert.deepEqual(director.defaults, { frame_rate: 24, resolution: { aspect: '16:9', resolution: '720p' } }, 'only what the Director editor shows: the resolution panel replaces raw width/height, other node inputs stay out')
    assert.deepEqual(director.extraFields, [{ id: 'steps', label: '스텝', type: 'number', min: 1, max: 50, default: 20 }])
    assert.equal(image.usable, false)
    assert.match(image.reason, /Director/)
    assert.equal(f.calls.filter(call => call.name === 'get_workflow_details').length, 1)

    await assert.rejects(() => f.dispatch('save_profile', { project_id: project.id, expected_revision: 1, profile: { workflowId: 12, inputs: { steps: 99 } } }), /스텝/)
    await assert.rejects(() => f.dispatch('save_profile', { project_id: project.id, expected_revision: 1, profile: { workflowId: 12, inputs: { seed: 1 } } }), /정할 수 없는/)
    const saved = await f.tool('apply_ops', { project_id: project.id, expected_revision: 1, profile: { workflowId: 12, serverTag: 'gpu', inputs: { steps: 30 } } })
    const { id, ...created } = saved.profile
    assert.deepEqual(created, { label: 'Director 기본', workflowId: 12, directorFieldId: 'director', seedFieldId: 'seed', serverTag: 'gpu', overrides: '{}', inputs: '{"steps":30}', role: 'cut' })
    // A second cut profile becomes the default only when chosen.
    assert.equal(saved.settings.cutProfileId, null)
    await f.dispatch('save_settings', { settings: { cutProfileId: id } })
    const added = await f.dispatch('apply_ops', { project_id: project.id, expected_revision: saved.revision, ops: [{ op: 'add_node', kind: 'cut', tempId: 'cut' }] })
    assert.equal(f.service.store.get('account:1', project.id).nodes.find((node: any) => node.id === added.tempIds.cut).data.profileId, id)
    const run = await f.dispatch('run_cut', await runArgs(f, project, { profile_id: id }))
    const request = f.calls.filter(call => call.name === 'submit_generation_job').at(-1).args
    assert.deepEqual({ steps: request.inputs.steps, seed: request.inputs.seed, tag: request.server_tag }, { steps: 30, seed: 482913, tag: 'gpu' })
    assert.equal(typeof run.profile.inputs, 'string')
  } finally { f.db.close() }
})
test('video canvas exports representing takes in sequence order through join_videos with wait, cancel and a missing tool', async () => {
  const f = serviceFixture()
  try {
    const project = await fixtureProject(f), first = project.nodes[0].id
    const take = await f.dispatch('run_cut', await runArgs(f, project))
    const added = await f.dispatch('apply_ops', { project_id: project.id, expected_revision: 1, ops: [{ op: 'add_node', kind: 'cut', name: '엔딩', tempId: 'end' }] })
    const end = added.tempIds.end
    const picks = await f.dispatch('apply_ops', { project_id: project.id, expected_revision: added.revision, ops: [{ op: 'set', id: end, fields: { pickTakeId: take.id } }, { op: 'set', id: end, fields: { pickTakeId: 'nope' } }] })
    assert.equal(picks.rejected.length, 2)
    await assert.rejects(() => f.dispatch('export_sequence', { project_id: project.id, expected_revision: added.revision }), /준비되지 않은 컷이 있어: 컷, 엔딩\./)
    f.markReady()
    await assert.rejects(() => f.dispatch('export_sequence', { project_id: project.id, expected_revision: added.revision }), /준비되지 않은 컷이 있어: 엔딩\./)
    assert.equal(f.calls.filter(call => call.name === 'join_videos').length, 0)

    f.service.store.addTake('account:1', project.id, { id: 'end-take', cutId: end, seed: 1, status: 'completed', profile, resolved: {}, jobId: null, resultHash: 'd'.repeat(32) })
    const ordered = await f.dispatch('apply_ops', { project_id: project.id, expected_revision: added.revision, ops: [{ op: 'sequence', order: [end] }, { op: 'set', id: end, fields: { pickTakeId: 'end-take' } }] })
    const started = await f.dispatch('export_sequence', { project_id: project.id, expected_revision: ordered.revision })
    assert.deepEqual(f.calls.find(call => call.name === 'join_videos').args, { composite_hashes: ['d'.repeat(32), otherHash], wait_seconds: 0 })
    assert.deepEqual({ status: started.status, jobId: started.jobId, cutIds: started.cutIds, takeIds: started.takeIds, resultHash: started.resultHash }, { status: 'running', jobId: f.state.frameId, cutIds: [end, first], takeIds: ['end-take', take.id], resultHash: null })
    f.state.frames = [{ status: 'running', progress: 0.5 }, { status: 'completed', progress: 1, saved: [{ source_composite_hash: 'd'.repeat(32), composite_hash: 'e'.repeat(32) }] }]
    const finished = await f.tool('export_sequence', { project_id: project.id, export_id: started.id, wait_seconds: 120 })
    assert.deepEqual({ status: finished.status, resultHash: finished.resultHash }, { status: 'completed', resultHash: 'e'.repeat(32) })
    const read = f.service.store.get('account:1', project.id)
    assert.equal(read.revision, ordered.revision)
    assert.equal(read.exports[0].resultHash, 'e'.repeat(32))

    await assert.rejects(() => f.dispatch('export_sequence', { project_id: project.id, expected_revision: ordered.revision, cut_ids: [first] }), /둘 이상/)
    const subset = await f.dispatch('export_sequence', { project_id: project.id, expected_revision: ordered.revision, cut_ids: [first, end] })
    assert.deepEqual(f.calls.filter(call => call.name === 'join_videos').at(-1).args.composite_hashes, [otherHash, 'd'.repeat(32)])
    const cancelled = await f.dispatch('export_sequence', { project_id: project.id, export_id: subset.id, cancel: true })
    assert.equal(cancelled.status, 'cancelled')
    assert.equal(f.calls.at(-1).args.cancel, true)

    f.state.joinTool = false
    await assert.rejects(() => f.dispatch('export_sequence', { project_id: project.id, expected_revision: ordered.revision }), (error: any) => error.status === 501 && /join_videos/.test(error.message))
    assert.equal(f.service.store.get('account:1', project.id).exports.at(-1).status, 'failed')
  } finally { f.db.close() }
})
test('video canvas waits for a take by take or cut and carries the generation failure text', async () => {
  const f = serviceFixture()
  try {
    const project = await fixtureProject(f), cut = project.nodes[0]
    await assert.rejects(() => f.dispatch('get_take', { project_id: project.id, cut_id: cut.id }), /아직 take가 없어/)
    await assert.rejects(() => f.dispatch('get_take', { project_id: project.id }), /take_id 또는 cut_id/)
    f.state.jobs[481] = { status: 'running' }
    f.state.onWait = (args: any) => { assert.equal(args.job_id, 481); delete f.state.jobs[481]; f.markReady() }
    const run = await f.dispatch('run_cut', { ...await runArgs(f, project), wait_seconds: 30 })
    assert.deepEqual({ status: run.status, resultHash: run.resultHash }, { status: 'completed', resultHash: otherHash })
    const waited = f.calls.find(call => call.name === 'wait_generation_job').args
    assert.ok(waited.timeout_seconds >= 5 && waited.timeout_seconds <= 30)
    assert.equal((await f.tool('get_take', { project_id: project.id, cut_id: cut.id, wait_seconds: 120 })).id, run.id)

    f.state.onWait = undefined
    const hooked = await f.dispatch('run_cut', await runArgs(f, project))
    f.state.jobs[482] = { status: 'failed', failure_message: 'ComfyUI 저장 실패', history_ids: [] }
    await f.emit('generation.finished', { jobId: 482, status: 'failed', history: [], failureCode: 'execution_error' })
    assert.equal(f.service.store.take('account:1', project.id, hooked.id).error, 'ComfyUI 저장 실패')
    const polled = await f.dispatch('run_cut', await runArgs(f, project))
    f.state.jobs[483] = { status: 'failed', failure_message: '디스크 부족' }
    const read = await f.dispatch('get_take', { project_id: project.id, cut_id: cut.id, wait_seconds: 10 })
    assert.deepEqual({ id: read.id, status: read.status, error: read.error }, { id: polled.id, status: 'failed', error: '디스크 부족' })

    const row = excerpt(f.service.store.get('account:1', project.id)).nodes.find((node: any) => node.id === cut.id)
    assert.deepEqual({ ...row, checkStatus: undefined }, { id: cut.id, kind: 'cut', name: '컷', checkStatus: undefined, humanReview: 'pending', mode: 'REF2VA',
      newestTakeId: polled.id, newestTakeStatus: 'failed', newestTakeError: '디스크 부족', hasReadyResult: true, representingTakeId: run.id, resultHash: otherHash })
    const publication = createAssistantState()
    publication.set('lastRun', { id: run.id })
    const before = publication.snapshot({}, 1).data.lastRun.fresh
    publication.set('lastRun', { id: run.id })
    assert.notEqual(publication.snapshot({}, 1).data.lastRun.fresh.seq, before.seq)
    // Republished state keeps its stamp while its value stands, so an operation that left it alone does not send it back.
    publication.keep('canvas', { id: project.id, nodes: [] }, { total: 0 })
    const held = publication.snapshot({}, 1).data.canvas.fresh
    publication.keep('canvas', { id: project.id, nodes: [] }, { total: 0 })
    assert.equal(publication.snapshot({}, 1).data.canvas.fresh.seq, held.seq)
    publication.keep('canvas', { id: project.id, nodes: [cut.id] }, { total: 1 })
    assert.notEqual(publication.snapshot({}, 1).data.canvas.fresh.seq, held.seq)
    // An edit moves the open project's revision, time and counts: its listed row leaves them to `canvas`, so the list stands.
    const listed = (revision: number) => projectRows([{ id: 'a', name: 'A', revision, updated: `t${revision}`, created: 'c', nodeCount: revision, cutCount: revision, archived: false, cover: null },
      { id: 'b', name: 'B', revision: 4, updated: 'u', created: 'c', nodeCount: 2, cutCount: 1, archived: false, cover: null }], 'a')
    assert.deepEqual(listed(1), listed(2))
    assert.deepEqual(listed(1), [{ id: 'a', name: 'A', open: true, created: 'c', archived: false, cover: null }, { id: 'b', name: 'B', revision: 4, updated: 'u', created: 'c', nodeCount: 2, cutCount: 1, archived: false, cover: null }])
  } finally { f.db.close() }
})
test('video canvas extraction targets switch the cut mode, frames are named after their source and nodes are placed apart', async () => {
  const f = serviceFixture()
  try {
    const project = await fixtureProject(f)
    const take = await f.dispatch('run_cut', await runArgs(f, project))
    f.markReady()
    const added = await f.dispatch('apply_ops', { project_id: project.id, expected_revision: 1, ops: [{ op: 'add_node', kind: 'cut', name: '둘째', tempId: 'next' }, { op: 'add_node', kind: 'cut', name: '셋째', tempId: 'last' }] })
    const next = added.tempIds.next, node = (id: string) => f.service.store.get('account:1', project.id).nodes.find((item: any) => item.id === id)
    assert.deepEqual([node(next).x, node(next).y, node(added.tempIds.last).x, node(added.tempIds.last).y], [672, 0, 1044, 0])

    const start = await f.dispatch('extract_frame', { project_id: project.id, expected_revision: added.revision, take_id: take.id, position: 'last', target: { cut: next, port: 'start' } })
    assert.deepEqual(start.modeChange, { cutId: next, from: 'T2VA', to: 'I2VA' })
    const frame = node(start.nodeIds[0])
    assert.equal(frame.data.name, '컷 마지막 프레임')
    assert.ok(frame.x + 200 < 672 && frame.y === 0)
    assert.equal(node(next).data.mode, 'I2VA')
    const end = await f.dispatch('extract_frame', { project_id: project.id, expected_revision: start.revision, take_id: take.id, position: 'first', target: { cut: next, port: 'end' } })
    assert.deepEqual(end.modeChange, { cutId: next, from: 'I2VA', to: 'FL2VA' })
    assert.equal(node(end.nodeIds[0]).data.name, '컷 첫 프레임')
    assert.notDeepEqual([node(end.nodeIds[0]).x, node(end.nodeIds[0]).y], [frame.x, frame.y])
    // A replacing extraction removes the extracted frame it pushes out of the slot in the same edit; a reviewed frame stays.
    assert.deepEqual(frame.data.origin, { nodeId: null, takeId: take.id, position: 'last', seconds: 3.9 })
    const startFrom = () => f.service.store.get('account:1', project.id).edges.filter((edge: any) => edge.to === next && edge.port === 'start').map((edge: any) => edge.from)
    const swapped = await f.dispatch('extract_frame', { project_id: project.id, expected_revision: end.revision, take_id: take.id, position: 'last', target: { cut: next, port: 'start', replace: true } })
    assert.equal(swapped.revision, end.revision + 1)
    assert.equal(node(frame.id), undefined)
    assert.deepEqual(startFrom(), swapped.nodeIds)
    const reviewed = await f.dispatch('human_review', { project_id: project.id, expected_revision: swapped.revision, ops: [{ op: 'review', id: swapped.nodeIds[0], status: 'pass' }] }, 'human')
    const again = await f.dispatch('extract_frame', { project_id: project.id, expected_revision: reviewed.revision, take_id: take.id, position: 'last', target: { cut: next, port: 'start', replace: true } })
    assert.equal(node(swapped.nodeIds[0]).review, 'pass')
    assert.deepEqual(startFrom(), again.nodeIds)

    const current = f.service.store.get('account:1', project.id), withVideo = ops(current, [{ op: 'add_node', kind: 'video', name: '참고 영상', ref: image }])
    f.service.store.save('account:1', current, withVideo.project)
    const video = withVideo.applied[0].id
    f.state.frames = [{ status: 'completed', saved: [{ composite_hash: 'c'.repeat(32), seconds: 1.5 }] }]
    const timed = await f.dispatch('extract_frame', { project_id: project.id, expected_revision: withVideo.revision, node_id: video, at_seconds: [1.5] })
    assert.equal(node(timed.nodeIds[0]).data.name, '참고 영상 1.5초 프레임')
    assert.equal(timed.modeChange, null)
    f.state.frames = [{ status: 'completed', saved: [{ composite_hash: 'd'.repeat(32), seconds: 0.5 }] }]
    const indexed = await f.dispatch('extract_frame', { project_id: project.id, expected_revision: timed.revision, node_id: video, frame_index: 12 })
    assert.equal(node(indexed.nodeIds[0]).data.name, '참고 영상 12번 프레임')
  } finally { f.db.close() }
})
test('video canvas chain run generates the sequence from each previous last frame, skips ready cuts and feeds export', async () => {
  const f = serviceFixture()
  try {
    f.state.historyPerJob = true
    const project = await fixtureProject(f), first = project.nodes[0]
    const take = await f.dispatch('run_cut', await runArgs(f, project))
    const added = await f.dispatch('apply_ops', { project_id: project.id, expected_revision: 1, ops: [{ op: 'add_node', kind: 'cut', name: '둘째', tempId: 'b' }, { op: 'add_node', kind: 'cut', name: '셋째', tempId: 'c' }] })
    const { b, c } = added.tempIds
    // The first extracted frame is still postprocessing when its job ends: the chain waits for it instead of failing the cut.
    f.state.pendingMedia = 1
    const chain = await f.dispatch('run_chain', { project_id: project.id, expected_revision: added.revision, wait_seconds: 120 })
    assert.equal(chain.status, 'completed')
    assert.equal(f.state.pendingMedia, 0)
    assert.equal(chain.current, null)
    assert.deepEqual(chain.steps.map((step: any) => [step.cutId, step.status, step.error]), [[first.id, 'skipped', null], [b, 'completed', null], [c, 'completed', null]])
    assert.equal(chain.steps[0].takeId, take.id)
    assert.deepEqual(f.calls.filter(call => call.name === 'save_video_frame').map(call => [call.args.composite_hash, call.args.position]), [[jobHash(481), 'last'], [jobHash(482), 'last']])
    const read = f.service.store.get('account:1', project.id)
    for (const [cut, source] of [[b, '컷'], [c, '둘째']]) {
      const edge = read.edges.find((item: any) => item.to === cut && item.port === 'start')
      assert.equal(read.nodes.find((item: any) => item.id === edge.from).data.name, `${source} 마지막 프레임`)
      assert.equal(read.nodes.find((item: any) => item.id === cut).data.mode, 'I2VA')
    }
    assert.deepEqual(chain.steps.slice(1).map((step: any) => read.takes.find((item: any) => item.id === step.takeId).jobId), [482, 483])
    assert.deepEqual(read.chains.map((item: any) => item.id), [chain.id])
    await f.dispatch('export_sequence', { project_id: project.id, expected_revision: read.revision })
    assert.deepEqual(f.calls.find(call => call.name === 'join_videos').args.composite_hashes, [jobHash(481), jobHash(482), jobHash(483)])
  } finally { f.db.close() }
})
test('video canvas chain stops at a failed cut, keeps one active chain per project and cancels the running generation', async () => {
  const f = serviceFixture()
  try {
    const project = await fixtureProject(f), first = project.nodes[0]
    const added = await f.dispatch('apply_ops', { project_id: project.id, expected_revision: 1, ops: [{ op: 'add_node', kind: 'cut', name: '둘째', tempId: 'b' }] })
    const b = added.tempIds.b
    f.state.jobs[481] = { status: 'failed', failure_message: '저장 실패', history_ids: [] }
    const failed = await f.tool('run_chain', { project_id: project.id, expected_revision: added.revision, wait_seconds: 120 })
    assert.deepEqual({ status: failed.status, error: failed.error, current: failed.current }, { status: 'failed', error: '컷: 저장 실패', current: first.id })
    assert.deepEqual(failed.steps.map((step: any) => [step.cutId, step.status, step.error]), [[first.id, 'failed', '저장 실패'], [b, 'pending', null]])
    assert.equal(f.calls.filter(call => call.name === 'save_video_frame').length, 0)

    f.state.jobs[482] = { status: 'running' }
    const running = await f.dispatch('run_chain', { project_id: project.id, expected_revision: added.revision })
    assert.equal(running.status, 'queued')
    const takeId = await until(() => f.service.store.chain('account:1', project.id, running.id).steps[0].takeId)
    await assert.rejects(() => f.dispatch('run_chain', { project_id: project.id, expected_revision: added.revision }), (error: any) => error.status === 409 && /이미 진행 중/.test(error.message))
    const cancelled = await f.dispatch('run_chain', { project_id: project.id, chain_id: running.id, cancel: true })
    assert.deepEqual({ status: cancelled.status, step: cancelled.steps[0].status }, { status: 'cancelled', step: 'cancelled' })
    assert.deepEqual(f.calls.filter(call => call.name === 'cancel_generation_job').map(call => call.args.job_id), [482])
    await f.tasks.get(cancelled.jobId).done
    assert.equal(f.service.store.take('account:1', project.id, takeId).status, 'cancelled')
    assert.equal(f.service.store.chain('account:1', project.id, running.id).status, 'cancelled')
    assert.equal(f.calls.filter(call => call.name === 'submit_generation_job').length, 2)

    // A cancelled chain's extraction that finishes later (it had no job yet at the cancel) leaves its frame in the library only.
    const before = f.service.store.get('account:1', project.id), late = randomUUID()
    f.service.store.addExtraction('account:1', project.id, { id: late, status: 'running', jobId: f.state.frameId, source: { nodeId: null, takeId }, sourceName: '컷', position: 'last', target: { cut: b, port: 'start', replace: true }, modeChange: null, chainId: running.id })
    f.state.frames = [{ status: 'completed', saved: [{ composite_hash: 'c'.repeat(32), seconds: 3.9 }] }]
    const late_ = await f.dispatch('extract_frame', { project_id: project.id, extraction_id: late, wait_seconds: 0 })
    assert.deepEqual({ status: late_.status, nodeIds: late_.nodeIds, resultHashes: late_.resultHashes, modeChange: late_.modeChange, revision: late_.revision }, { status: 'completed', nodeIds: [], resultHashes: ['c'.repeat(32)], modeChange: null, revision: before.revision })
    const after = f.service.store.get('account:1', project.id)
    const modeOf = (read: any) => read.nodes.find((node: any) => node.id === b).data.mode
    assert.deepEqual([after.nodes.length, after.edges.length, modeOf(after)], [before.nodes.length, before.edges.length, modeOf(before)])
  } finally { f.db.close() }
})
test('video canvas gives an account without cut settings the sole usable workflow profile as its default and lists the choices otherwise', async () => {
  const f = serviceFixture()
  try {
    const project = await f.dispatch('create_project', { name: '빈 영상' })
    const added = await f.dispatch('apply_ops', { project_id: project.id, expected_revision: 0, ops: [{ op: 'add_node', kind: 'cut', name: '첫 컷', tempId: 'a' }] })
    assert.deepEqual({ ...added.autoProfile, id: undefined }, { id: undefined, label: 'Director 기본', workflowId: 12 })
    const read = f.service.store.get('account:1', project.id)
    assert.deepEqual(read.profiles.map((item: any) => item.id), [added.autoProfile.id])
    assert.equal(read.nodes[0].data.profileId, added.autoProfile.id)
    assert.equal(read.settings.cutProfileId, added.autoProfile.id)
    assert.equal((await f.dispatch('apply_ops', { project_id: project.id, expected_revision: added.revision, ops: [{ op: 'add_node', kind: 'cut', name: '둘째' }] })).autoProfile, undefined)

    // With the library empty again and several usable workflows, nothing is made and the choices are listed.
    assert.equal((await f.page({ op: 'delete_profile', id: added.autoProfile.id })).settings.cutProfileId, null)
    f.state.secondDirector = true
    const other = await f.dispatch('create_project', { name: '고를 영상' })
    const plain = await f.dispatch('apply_ops', { project_id: other.id, expected_revision: 0, ops: [{ op: 'add_node', kind: 'cut', name: '컷', tempId: 'a' }] })
    assert.equal(plain.autoProfile, undefined)
    const cut = plain.tempIds.a, args = { project_id: other.id, cut_id: cut, expected_revision: plain.revision }
    await assert.rejects(() => f.dispatch('run_cut', { ...args, requestId: randomUUID() }), (error: any) => /Director 기본\(workflowId 12\)/.test(error.message) && /Director 보조\(workflowId 14\)/.test(error.message) && /프로필을 저장/.test(error.message))
    await assert.rejects(() => f.dispatch('run_chain', { project_id: other.id, expected_revision: plain.revision }), /여럿/)
    assert.equal(f.service.store.profiles('account:1').length, 0)
    // Workflow discovery failing (no workflows.view) leaves the cut added without a profile; a run reports the real reason.
    f.state.workflowsDenied = true
    const denied = await f.dispatch('apply_ops', { project_id: other.id, expected_revision: plain.revision, ops: [{ op: 'add_node', kind: 'cut', name: '둘째 컷', tempId: 'b' }] }, 'human')
    assert.deepEqual({ applied: denied.applied.length, rejected: denied.rejected, autoProfile: denied.autoProfile }, { applied: 1, rejected: [], autoProfile: undefined })
    const second = denied.tempIds.b
    assert.equal(f.service.store.get('account:1', other.id).nodes.find((node: any) => node.id === second).data.profileId, null)
    await assert.rejects(() => f.dispatch('run_cut', { ...args, expected_revision: denied.revision, requestId: randomUUID() }), /워크플로 보기 권한/)
    f.state.workflowsDenied = false
    f.state.secondDirector = false
    const run = await f.dispatch('run_cut', { ...args, expected_revision: denied.revision, requestId: randomUUID() })
    assert.equal(run.status, 'queued')
    assert.equal(run.autoProfile.workflowId, 12)
    assert.equal(run.profile.id, run.autoProfile.id)
    const after = f.service.store.get('account:1', other.id)
    assert.equal(after.revision, denied.revision + 1)
    assert.equal(after.settings.cutProfileId, run.autoProfile.id)
    // Every cut of the project without a cut profile gets the new default, so the next cut runs without one being chosen.
    assert.deepEqual([cut, second].map(id => after.nodes.find((node: any) => node.id === id).data.profileId), [run.autoProfile.id, run.autoProfile.id])
    assert.equal(f.calls.filter(call => call.name === 'submit_generation_job').at(-1).args.workflow_id, 12)
    const next = await f.dispatch('run_cut', { project_id: other.id, cut_id: second, expected_revision: after.revision, requestId: randomUUID() })
    assert.deepEqual({ status: next.status, profile: next.profile.id, autoProfile: next.autoProfile }, { status: 'queued', profile: run.autoProfile.id, autoProfile: undefined })
  } finally { f.db.close() }
})
test('video canvas creates a project together with its profile in one operation and ignores expected_revision', async () => {
  const f = serviceFixture()
  try {
    const existing = await f.dispatch('create_project', { name: '기존 영상' })
    const created = await f.tool('apply_ops', { create_name: '새 영상', expected_revision: 99, profile: { workflowId: 12, serverTag: 'gpu' } })
    assert.notEqual(created.id, existing.id)
    assert.equal(created.revision, 0)
    // The library's first cut profile becomes the default new cuts get.
    assert.equal(created.settings.cutProfileId, created.profileId)
    const stored = f.service.store.profiles('account:1').find((item: any) => item.id === created.profileId)
    assert.deepEqual([stored.label, stored.serverTag], ['Director 기본', 'gpu'])
    const added = await f.dispatch('apply_ops', { project_id: created.id, expected_revision: 0, ops: [{ op: 'add_node', kind: 'cut', name: '컷', tempId: 'a' }] })
    assert.equal(f.service.store.get('account:1', created.id).nodes[0].data.profileId, created.profileId)
    assert.equal(added.autoProfile, undefined)

    const total = () => f.service.store.count('account:1', {})
    const before = total()
    await assert.rejects(() => f.tool('apply_ops', { create_name: '잘못된 영상', expected_revision: 0, profile: { workflowId: 12, serverId: 1, serverTag: 'gpu' } }), /하나만/)
    assert.equal(total(), before)
    const page = await f.page({ op: 'create_project', name: '페이지 영상', profile: { workflowId: 12 } })
    assert.ok(f.service.store.profiles('account:1').some((item: any) => item.id === page.profileId))
    const plain = await f.tool('apply_ops', { create_name: '그냥 영상', expected_revision: 42 })
    assert.deepEqual([plain.revision, total()], [0, before + 2])
  } finally { f.db.close() }
})
test('video canvas treats failed postprocessing as a finished take for waits and chains', async () => {
  const f = serviceFixture()
  try {
    f.state.historyPerJob = true; f.state.failedHistory = [481, 482]
    const project = await fixtureProject(f), started = Date.now()
    const take = await f.dispatch('run_cut', { ...await runArgs(f, project), wait_seconds: 30 })
    assert.deepEqual({ status: take.status, resultHash: take.resultHash, error: take.error, marker: take.postprocessFailed }, { status: 'completed', resultHash: null, error: '결과 후처리가 실패했어.', marker: true })
    assert.equal((await f.dispatch('get_take', { project_id: project.id, take_id: take.id, wait_seconds: 120 })).error, '결과 후처리가 실패했어.')
    assert.ok(Date.now() - started < 5000)
    const chain = await f.dispatch('run_chain', { project_id: project.id, expected_revision: 1, wait_seconds: 120 })
    assert.deepEqual({ status: chain.status, error: chain.error }, { status: 'failed', error: '컷: 결과 후처리가 실패했어.' })
    assert.equal(f.calls.filter(call => call.name === 'submit_generation_job').length, 2)
  } finally { f.db.close() }
})
test('video canvas chain adopts a generation already running for the cut instead of submitting another', async () => {
  const f = serviceFixture()
  try {
    f.state.historyPerJob = true
    const project = await fixtureProject(f)
    f.state.jobs[481] = { status: 'running' }
    const manual = await f.dispatch('run_cut', await runArgs(f, project))
    f.state.onWait = (args: any) => { if (args.job_id === 481) delete f.state.jobs[481] }
    const chain = await f.dispatch('run_chain', { project_id: project.id, expected_revision: 1, wait_seconds: 120 })
    assert.deepEqual({ status: chain.status, step: chain.steps[0].status, takeId: chain.steps[0].takeId }, { status: 'completed', step: 'completed', takeId: manual.id })
    assert.equal(f.calls.filter(call => call.name === 'submit_generation_job').length, 1)
    assert.equal(f.service.store.take('account:1', project.id, manual.id).resultHash, jobHash(481))
  } finally { f.db.close() }
})
test('video canvas chain moves a cut pick to the take it generated so export and the next cut agree', async () => {
  const f = serviceFixture()
  try {
    f.state.historyPerJob = true
    const project = await fixtureProject(f), first = project.nodes[0]
    const ready = await f.dispatch('run_cut', await runArgs(f, project))
    const added = await f.dispatch('apply_ops', { project_id: project.id, expected_revision: 1, ops: [{ op: 'add_node', kind: 'cut', name: '둘째', tempId: 'b' }] })
    const b = added.tempIds.b
    f.state.jobs[482] = { status: 'failed', failure_message: '실패' }
    const broken = await f.dispatch('run_cut', { project_id: project.id, cut_id: b, expected_revision: added.revision, requestId: randomUUID() })
    assert.equal((await f.dispatch('get_take', { project_id: project.id, take_id: broken.id })).status, 'failed')
    const picked = await f.dispatch('apply_ops', { project_id: project.id, expected_revision: added.revision, ops: [
      { op: 'set', id: first.id, fields: { pickTakeId: ready.id } }, { op: 'set', id: b, fields: { pickTakeId: broken.id } }] })
    const pick = (id: string) => f.service.store.get('account:1', project.id).nodes.find((node: any) => node.id === id).data.pickTakeId

    const resumed = await f.dispatch('run_chain', { project_id: project.id, expected_revision: picked.revision, wait_seconds: 120 })
    assert.deepEqual(resumed.steps.map((step: any) => step.status), ['skipped', 'completed'])
    assert.equal(pick(first.id), ready.id)
    assert.equal(pick(b), resumed.steps[1].takeId)
    let revision = f.service.store.get('account:1', project.id).revision
    await f.dispatch('export_sequence', { project_id: project.id, expected_revision: revision })
    assert.deepEqual(f.calls.filter(call => call.name === 'join_videos').at(-1).args.composite_hashes, [jobHash(481), jobHash(483)])

    const again = await f.dispatch('run_chain', { project_id: project.id, expected_revision: revision, regenerate: true, wait_seconds: 120 })
    assert.equal(again.status, 'completed')
    assert.deepEqual([pick(first.id), pick(b)], again.steps.map((step: any) => step.takeId))
    assert.equal(f.calls.filter(call => call.name === 'save_video_frame').at(-1).args.composite_hash, jobHash(484))
    revision = f.service.store.get('account:1', project.id).revision
    await f.dispatch('export_sequence', { project_id: project.id, expected_revision: revision })
    assert.deepEqual(f.calls.filter(call => call.name === 'join_videos').at(-1).args.composite_hashes, [jobHash(484), jobHash(485)])
  } finally { f.db.close() }
})

// A plain image workflow (no Director field) for generation nodes, and a second one with other field IDs.
const genDetails = { name: '배경 이미지', input_schema: [
  { id: 'prompt', label: 'Positive prompt', type: 'text' },
  { id: 'seed', type: 'number', json_path: '3.inputs.seed' },
  { id: 'image', type: 'image' },
  { id: 'steps', label: '스텝', type: 'number', minimum: 1, maximum: 50 },
  { id: 'cfg', type: 'number' },
] }
const otherGenDetails = { name: '다른 이미지', input_schema: [
  { id: 'text', label: 'prompt', type: 'textarea' },
  { id: 'noise_seed', type: 'number', json_path: '9.inputs.noise_seed' },
  { id: 'ref', type: 'image' },
  { id: 'steps', label: '스텝', type: 'number', minimum: 1, maximum: 50 },
] }
const generator = { id: 'gen-profile', label: '배경 생성', workflowId: 20, output: 'image', promptFieldId: 'prompt', seedFieldId: 'seed', imageFieldIds: ['image'], exposedFieldIds: ['steps'], fixedInputs: { cfg: 7 } }
const revisionOf = (f: ReturnType<typeof serviceFixture>, project: any) => f.service.store.get('account:1', project.id).revision
const storedProfile = (f: ReturnType<typeof serviceFixture>, project: any, id: string) => f.service.store.get('account:1', project.id).profiles.find((item: any) => item.id === id)
// The fixture cut (T2VA, plain prompt) with a generation node on its start slot.
async function genProject(f: ReturnType<typeof serviceFixture>) {
  f.state.historyPerJob = true
  f.state.workflowDetails = { 20: genDetails, 21: otherGenDetails }
  const project = await fixtureProject(f), cut = project.nodes[0]
  await f.dispatch('save_profile', { project_id: project.id, expected_revision: revisionOf(f, project), profile: generator })
  const edit = await f.dispatch('apply_ops', { project_id: project.id, expected_revision: revisionOf(f, project), ops: [
    { op: 'set', id: cut.id, fields: { mode: 'T2VA', prompt: '노을 진 바다를 걷는 유나' } },
    { op: 'add_node', kind: 'gen', name: '바다 배경', tempId: 'gen', profileId: 'gen-profile', seed: 77, fields: { prompt: '노을 진 바다', inputs: { steps: 30 } } },
    { op: 'connect', from: 'gen', to: cut.id, port: 'start' },
  ] })
  return { project, cut, gen: edit.tempIds.gen, edit }
}
async function generate(f: ReturnType<typeof serviceFixture>, project: any, nodeId: string) {
  const started = await f.dispatch('run_cut', { project_id: project.id, cut_id: nodeId, expected_revision: revisionOf(f, project), requestId: randomUUID() })
  return f.dispatch('get_take', { project_id: project.id, take_id: started.id })
}
test('video canvas generation node submits mapped workflow inputs and feeds its result to a cut start slot', async () => {
  const f = serviceFixture()
  try {
    const { project, cut, gen, edit } = await genProject(f)
    assert.deepEqual(edit.rejected, [])
    assert.deepEqual(edit.applied[2].modeChange, { cutId: cut.id, from: 'T2VA', to: 'I2VA' })
    const waiting = await f.dispatch('check', { project_id: project.id, cut_id: cut.id })
    assert.equal(waiting.cuts[0].blocked, true)
    assert.ok(waiting.cuts[0].errors.some((issue: any) => /결과가 아직 없어/.test(issue.message)))
    await assert.rejects(() => f.dispatch('run_cut', { project_id: project.id, cut_id: cut.id, expected_revision: revisionOf(f, project), requestId: randomUUID() }), /결과가 아직 없어/)

    const result = await generate(f, project, gen)
    assert.ok(result.resultHash)
    const submits = f.calls.filter(call => call.name === 'submit_generation_job')
    assert.equal(submits.length, 1)
    assert.deepEqual(submits[0].args, { service_type: 'comfyui', workflow_id: 20, inputs: { cfg: 7, steps: 30, prompt: '노을 진 바다', seed: 77 }, idempotency_key: `video-canvas-${result.id}` })

    assert.equal((await f.dispatch('check', { project_id: project.id, cut_id: cut.id })).cuts[0].blocked, false)
    await generate(f, project, cut.id)
    const director = f.calls.filter(call => call.name === 'submit_generation_job').at(-1).args.inputs.director
    assert.equal(director.mode, 'I2VA')
    assert.ok(Object.values(director.assets).some((asset: any) => asset.composite_hash === result.resultHash))
  } finally { f.db.close() }
})
test('video canvas warns without blocking when a cut result used an older generation node result', async () => {
  const f = serviceFixture()
  try {
    const { project, cut, gen } = await genProject(f)
    await generate(f, project, gen)
    await generate(f, project, cut.id)
    const fresh = await f.dispatch('check', { project_id: project.id, cut_id: cut.id })
    assert.ok(!fresh.cuts[0].warnings.some((issue: any) => issue.code === 'stale-input'))

    await generate(f, project, gen)
    const stale = await f.dispatch('check', { project_id: project.id, cut_id: cut.id })
    assert.equal(stale.cuts[0].blocked, false)
    assert.ok(stale.cuts[0].warnings.some((issue: any) => issue.code === 'stale-input' && issue.message.includes('바다 배경')))
  } finally { f.db.close() }
})
test('video canvas NovelAI generation sends one sample with a real seed and keeps the reference blobs out of results', async () => {
  const f = serviceFixture()
  try {
    f.state.historyPerJob = true
    const vibe = 'VIBE-ENCODED-BLOB', reference = 'data:image/png;base64,CHARACTER-REF-BLOB'
    f.state.presets[5] = { id: 5, name: 'NAI 일러스트', instruction: '일러스트용', kind: 'nai', comfyui: null, prompting: { guide: '', guideSkill: null },
      nai: { model: 'nai-diffusion-4-5-full', sampler: 'k_euler', noiseSchedule: 'karras', steps: 28, scale: 5, varietyPlus: false, transparentBackground: false,
        promptPrefix: 'masterpiece', promptSuffix: 'best quality', negativePrompt: 'lowres', sizes: [{ label: '세로', width: 832, height: 1216 }], characters: [], useCoords: false,
        vibes: [{ encoded: vibe, strength: 0.6 }], characterRefs: [{ image: reference, fidelity: 1 }], characterReference: { mode: 'replace' }, n_samples: 4 } }
    const created = await f.dispatch('create_project', { name: '일러스트', preset: { id: 5 } })
    const project = { id: created.id }
    const edit = await f.dispatch('apply_ops', { project_id: project.id, expected_revision: created.revision, ops: [{ op: 'add_node', kind: 'gen', name: '소녀', tempId: 'gen', seed: 0, fields: { prompt: '바닷가 소녀' } }] })
    const gen = edit.tempIds.gen
    const started = await f.dispatch('run_cut', { project_id: project.id, cut_id: gen, expected_revision: revisionOf(f, project), requestId: randomUUID() })
    const take = await f.dispatch('get_take', { project_id: project.id, take_id: started.id })
    const submitted = f.calls.find(call => call.name === 'submit_generation_job').args
    assert.equal(submitted.service_type, 'novelai')
    assert.equal(submitted.request_payload.n_samples, 1)
    assert.equal(submitted.request_payload.prompt, 'masterpiece, 바닷가 소녀, best quality')
    assert.ok(submitted.request_payload.seed > 0)
    assert.equal(take.seed, submitted.request_payload.seed)
    assert.equal(f.service.store.get('account:1', project.id).nodes.find((node: any) => node.id === gen).data.seed, submitted.request_payload.seed)
    // The request keeps the one copy a same-key retry resends.
    assert.equal(f.service.store.take('account:1', project.id, take.id).request.request_payload.vibes[0].encoded, vibe)

    const results = [created, edit, started, take,
      await f.dispatch('read_node', { project_id: project.id, id: gen }),
      await f.tool('read_canvas', { project_id: project.id, node_id: gen }),
      await f.tool('read_canvas', { project_id: project.id }),
      await f.tool('get_take', { project_id: project.id, take_id: take.id })]
    for (const result of results) {
      const text = JSON.stringify(result)
      assert.ok(!text.includes('VIBE-ENCODED-BLOB') && !text.includes('CHARACTER-REF-BLOB'))
    }
    assert.ok(!JSON.stringify(f.service.store.take('account:1', project.id, take.id).profile).includes('BLOB'))
  } finally { f.db.close() }
})
test('video canvas preset import copies the preset for administrators and refuses others and unknown keys', async () => {
  const f = serviceFixture()
  try {
    f.state.historyPerJob = true
    f.state.workflowDetails = { 20: genDetails }
    f.state.presets[7] = { id: 7, name: '배경 프리셋', instruction: '배경을 만들어', kind: 'comfyui', nai: null,
      comfyui: { workflowId: 20, serverId: 2, serverTag: null, fixedInputs: { cfg: 6 }, exposedFieldIds: ['steps'], referenceField: 'image', promptField: 'prompt' },
      prompting: { timing: 'before', guide: '밝게', guideSkill: { skillId: 3, path: 'style/bg', skillName: '스타일', title: '배경' }, previousImages: 2 } }
    const project = await fixtureProject(f)
    const imported = await f.dispatch('import_preset', { project_id: project.id, expected_revision: revisionOf(f, project), preset: { id: 7 } })
    const id = imported.profileId
    const copied = { id, label: '배경 프리셋', workflowId: 20, serverId: 2, output: 'image', promptFieldId: 'prompt', seedFieldId: 'seed', imageFieldIds: ['image'],
      exposedFieldIds: ['steps'], fixedInputs: { cfg: 6 }, instruction: '배경을 만들어', guide: '밝게', guideSkill: { skillId: 3, path: 'style/bg' } }
    assert.deepEqual(storedProfile(f, project, id), copied)

    f.state.presets[7].comfyui.fixedInputs.cfg = 9
    f.state.presets[7].prompting.guide = '어둡게'
    const edit = await f.dispatch('apply_ops', { project_id: project.id, expected_revision: revisionOf(f, project), ops: [{ op: 'add_node', kind: 'gen', name: '배경', tempId: 'gen', profileId: id, seed: 3, fields: { prompt: '숲' } }] })
    await generate(f, project, edit.tempIds.gen)
    assert.equal(f.calls.filter(call => call.name === 'submit_generation_job').at(-1).args.inputs.cfg, 6)
    assert.deepEqual(storedProfile(f, project, id), copied)

    await assert.rejects(() => f.dispatch('import_preset', { project_id: project.id, expected_revision: revisionOf(f, project), preset: { id: 7, guideSkill: { skillId: 3, path: 'style/bg' } } }), /preset에 쓸 수 없는 키야: guideSkill/)
    f.state.admin = false
    await assert.rejects(() => f.dispatch('import_preset', { project_id: project.id, expected_revision: revisionOf(f, project), preset: { id: 7 } }), (error: any) => error.status === 403)
  } finally { f.db.close() }
})
test('video canvas guide skill links are set by administrators, carried by forks and read into the node preview', async () => {
  const f = serviceFixture()
  try {
    const { project, gen } = await genProject(f)
    const link = { skillId: 3, path: 'style/bg' }
    f.state.sections['3:style/bg'] = '배경은 밝은 톤으로 그려.'
    await f.dispatch('save_profile', { project_id: project.id, expected_revision: revisionOf(f, project), profile: { ...generator, guide: '밝게', guideSkill: link } })

    f.state.admin = false
    await assert.rejects(() => f.dispatch('save_profile', { project_id: project.id, expected_revision: revisionOf(f, project), profile: { id: generator.id, guideSkill: { skillId: 3, path: 'style/other' } } }), /관리자/)
    await assert.rejects(() => f.dispatch('save_profile', { project_id: project.id, expected_revision: revisionOf(f, project), profile: { ...generator, id: 'other', guideSkill: { skillId: 4, path: 'x' } } }), /관리자/)
    await f.dispatch('save_profile', { project_id: project.id, expected_revision: revisionOf(f, project), profile: { id: generator.id, guide: '더 밝게' } })
    assert.deepEqual(storedProfile(f, project, generator.id).guideSkill, link)
    await f.dispatch('save_profile', { project_id: project.id, expected_revision: revisionOf(f, project), profile: { ...generator, id: 'fork', guideSkill: link } })
    assert.deepEqual(storedProfile(f, project, 'fork').guideSkill, link)

    const read = await f.dispatch('read_node', { project_id: project.id, id: gen })
    assert.equal(read.preview.guide.text, '더 밝게')
    assert.equal(read.preview.guide.skill.text, '배경은 밝은 톤으로 그려.')
    assert.equal(read.preview.guide.guideWarning, undefined)
    delete f.state.sections['3:style/bg']
    const gone = await f.dispatch('read_node', { project_id: project.id, id: gen })
    assert.equal(gone.preview.guide.text, '더 밝게')
    assert.match(gone.preview.guide.guideWarning, /읽을 수 없어/)
  } finally { f.db.close() }
})
test('video canvas partial profile saves keep omitted settings, clear explicit nulls and re-derive roles for another workflow', async () => {
  const f = serviceFixture()
  try {
    f.state.workflowDetails = { 20: genDetails, 21: otherGenDetails }
    const project = await fixtureProject(f)
    const full = { ...generator, id: 'g', serverId: 2, instruction: '배경용', guide: '밝게' }
    const save = (profile: any) => f.dispatch('save_profile', { project_id: project.id, expected_revision: revisionOf(f, project), profile })
    await save(full)
    await save({ id: 'g', workflowId: 20, guide: '새 가이드' })
    assert.deepEqual(storedProfile(f, project, 'g'), { ...full, guide: '새 가이드' })
    await save({ id: 'g', serverId: null })
    const { serverId, ...withoutServer } = full
    assert.deepEqual(storedProfile(f, project, 'g'), { ...withoutServer, guide: '새 가이드' })
    await save({ id: 'g', workflowId: 21 })
    assert.deepEqual(storedProfile(f, project, 'g'), { ...withoutServer, guide: '새 가이드', workflowId: 21, promptFieldId: 'text', seedFieldId: 'noise_seed', imageFieldIds: ['ref'], exposedFieldIds: ['steps'], fixedInputs: {} })
  } finally { f.db.close() }
})
test('video canvas add_node takes set fields, rejects unknown op keys and ops without expected_revision', async () => {
  const f = serviceFixture()
  try {
    const project = await fixtureProject(f)
    const added = await f.dispatch('apply_ops', { project_id: project.id, expected_revision: revisionOf(f, project), ops: [{ op: 'add_node', kind: 'cut', name: '새 컷', tempId: 'n', fields: { prompt: '걷는다', duration: 6, seed: 5 } }] })
    const node = f.service.store.get('account:1', project.id).nodes.find((item: any) => item.id === added.tempIds.n)
    assert.deepEqual([node.data.prompt, node.data.duration, node.data.seed], ['걷는다', 6, 5])

    const before = f.service.store.get('account:1', project.id).nodes.length
    const unknown = await f.dispatch('apply_ops', { project_id: project.id, expected_revision: revisionOf(f, project), ops: [{ op: 'add_node', kind: 'cut', name: '잃어버린 컷', prompt: '사라지면 안 돼' }] })
    assert.equal(unknown.applied.length, 0)
    assert.match(unknown.rejected[0].reason, /쓸 수 없는 키야: prompt/)
    assert.match(unknown.rejected[0].reason, /fields 안에/)
    assert.equal(f.service.store.get('account:1', project.id).nodes.length, before)
    await assert.rejects(() => f.dispatch('apply_ops', { project_id: project.id, ops: [{ op: 'add_node', kind: 'cut', name: '컷' }] }), /expected_revision이 필요해/)
  } finally { f.db.close() }
})
test('video canvas migrates embedded profiles into one library per account with their IDs and shares it across projects', async () => {
  const f = serviceFixture()
  try {
    // Before the library, each project embedded its profiles and its cuts named them.
    const cut = (id: string, profileId: string) => ({ id, kind: 'cut', x: 0, y: 0, data: { name: id, mode: 'T2VA', prompt: '', raw: '', duration: 5, seed: 1, profileId }, review: 'pending', memo: '' })
    const embedded = { a: [{ ...profile, id: 'used' }, structuredClone(generator)], b: [{ ...profile, id: 'newer', label: '나중' }] }
    const old = (id: string, account: string, profiles: any[], nodes: any[]) => f.db.prepare("INSERT INTO vc_project(id,account,name,revision,data,updated,created) VALUES(?,?,?,7,?,'2026-01-01 00:00:00','2026-01-01 00:00:00')")
      .run(id, account, id, JSON.stringify({ id, name: id, revision: 7, nodes, edges: [], sequence: nodes.map(node => node.id), profiles }))
    old('old-a', 'account:1', embedded.a, [cut('a1', 'used'), cut('a2', 'used')])
    // A repeated ID with the same content is stored once; with other content the later project's version gets a new ID.
    old('old-b', 'account:1', [...embedded.b, { ...profile, id: 'used' }], [cut('b1', 'newer')])
    const other = { ...profile, id: 'used', label: '다른 내용' }
    old('old-d', 'account:1', [other], [cut('d1', 'used')])
    f.db.prepare("INSERT INTO vc_take(id,project,account,job_id,status,data) VALUES('take-d','old-d','account:1',1,'completed',?)")
      .run(JSON.stringify({ id: 'take-d', cutId: 'd1', seed: 1, profile: other, snapshot: { nodes: [cut('d1', 'used')], edges: [] }, guard: { cut_id: 'd1', profile_id: 'used', inputs: 'canvas' }, status: 'completed', jobId: 1, resultHash: null }))
    f.db.prepare("INSERT INTO vc_undo VALUES('old-d','account:1',7,'{}','[]',0)").run()
    old('old-c', 'account:2', [{ ...profile, id: 'theirs' }], [])
    f.db.exec('DROP TABLE vc_profile; DROP TABLE vc_settings')
    const rows = () => f.db.prepare('SELECT id, revision, updated, data FROM vc_project ORDER BY id').all().map((row: any) => row.id === 'old-d' ? { ...row, data: undefined } : row)
    const before = rows()
    createStore(f.db)
    assert.deepEqual(rows(), before)
    const library = await f.dispatch('library', {}, 'human'), renamed = library.profiles.at(-1).id
    assert.notEqual(renamed, 'used')
    assert.deepEqual(library.profiles, [...embedded.a, ...embedded.b, { ...other, id: renamed }])
    assert.deepEqual(library.settings, { cutProfileId: 'used', upscaleProfileId: null })
    assert.deepEqual(library.usage, { used: 2, newer: 1, [renamed]: 1 })
    assert.deepEqual(f.service.store.get('account:1', 'old-b').profiles.map((item: any) => item.id), ['used', generator.id, 'newer', renamed])
    // Only the project holding the other version is rewritten to name it, its takes included; its undo batch is gone.
    assert.equal(f.service.store.get('account:1', 'old-d').nodes[0].data.profileId, renamed)
    const take = f.service.store.take('account:1', 'old-d', 'take-d')
    assert.deepEqual([take.snapshot.nodes[0].data.profileId, take.guard.profile_id, take.profile.id], [renamed, renamed, renamed])
    assert.equal(f.service.store.lastLog('old-d'), undefined)
    assert.deepEqual((await f.service.dispatch({ op: 'library' }, { id: 2 }, 'human', { page: true })).profiles.map((item: any) => item.id), ['theirs'])

    // The assistant's create_name + profile flow adds one library row, not one per project.
    const first = await f.tool('apply_ops', { create_name: '하나', profile: { workflowId: 12 } })
    const second = await f.tool('apply_ops', { create_name: '둘', profile: { workflowId: 12 } })
    assert.equal(second.profileId, first.profileId)
    assert.equal(f.service.store.profiles('account:1').length, 5)
    // A project's embedded copy goes with its next save; deleting the default clears it and the cuts keep the ID.
    await f.dispatch('apply_ops', { project_id: 'old-a', expected_revision: 7, ops: [{ op: 'move', id: 'a1', x: 5, y: 5 }] })
    assert.deepEqual(f.db.prepare("SELECT id, json_type(data,'$.profiles') AS profiles FROM vc_project WHERE id IN ('old-a','old-b') ORDER BY id").all(), [{ id: 'old-a', profiles: null }, { id: 'old-b', profiles: 'array' }])
    assert.equal((await f.page({ op: 'delete_profile', id: 'used' })).settings.cutProfileId, null)
    assert.equal(f.service.store.get('account:1', 'old-a').nodes[0].data.profileId, 'used')
  } finally { f.db.close() }
})
test('video canvas refuses a library save made from a stale read of the entry', async () => {
  const f = serviceFixture()
  try {
    await fixtureProject(f)
    const read = await f.page({ op: 'library' }), revision = read.revisions[profile.id]
    const first = await f.page({ op: 'save_profile', profile: { id: profile.id, label: '먼저' }, expected_profile_revision: revision })
    assert.equal(first.profileRevision, revision + 1)
    const stale = await f.page({ op: 'save_profile', profile: { id: profile.id, label: '나중' }, expected_profile_revision: revision })
    assert.deepEqual([stale.ok, stale.status], [false, 409])
    assert.equal(f.service.store.profiles('account:1')[0].label, '먼저')
  } finally { f.db.close() }
})
test('video canvas merges library entries equal apart from their ID and moves the projects naming the removed ones to the kept one', async () => {
  const f = serviceFixture()
  try {
    const { store } = f.service
    const cut = (id: string, profileId: string) => ({ id, kind: 'cut', x: 0, y: 0, data: { name: id, mode: 'T2VA', prompt: '', raw: '', duration: 5, seed: 1, profileId }, review: 'pending', memo: '' })
    const project = (id: string, account: string, nodes: any[]) => f.db.prepare("INSERT INTO vc_project(id,account,name,revision,data,updated,created) VALUES(?,?,?,3,?,'2026-01-01 00:00:00','2026-01-01 00:00:00')")
      .run(id, account, id, JSON.stringify({ id, name: id, revision: 3, nodes, edges: [], sequence: nodes.map(node => node.id) }))
    // Two groups of equal entries (the second differs from the first only by its label), an entry of its own and another account.
    for (const [id, label] of [['old', profile.label], ['a', profile.label], ['b', profile.label], ['m', '둘'], ['n', '둘'], ['single', '하나']]) store.putProfile('account:1', { ...profile, id, label })
    for (const id of ['x', 'y']) store.putProfile('account:2', { ...profile, id })
    store.setSettings('account:1', { cutProfileId: 'a', upscaleProfileId: null })
    project('p1', 'account:1', [cut('c1', 'b'), cut('c2', 'n')])
    project('p2', 'account:1', [cut('c3', 'single')])
    project('p3', 'account:2', [cut('c4', 'y')])
    f.db.prepare("INSERT INTO vc_take(id,project,account,job_id,status,data) VALUES('take-1','p1','account:1',1,'completed',?)")
      .run(JSON.stringify({ id: 'take-1', cutId: 'c1', seed: 1, profile: { ...profile, id: 'old' }, snapshot: { nodes: [cut('c1', 'old')], edges: [] }, guard: { cut_id: 'c1', profile_id: 'old', inputs: 'canvas' }, status: 'completed', jobId: 1, resultHash: null }))
    f.db.prepare("INSERT INTO vc_undo VALUES('p1','account:1',3,?,'[]',0)").run(JSON.stringify({ nodes: [cut('c1', 'b')], edges: [], sequence: [] }))
    const untouched = () => f.db.prepare("SELECT id, revision, updated, data FROM vc_project WHERE id IN ('p2','p3') ORDER BY id").all()
    const before = untouched()
    assert.equal((await f.page({ op: 'library' })).duplicates, 3)
    await assert.rejects(() => f.dispatch('merge_profiles', {}), (error: any) => error.status === 403)

    // The default is kept over the more used entry; without a default the most used is kept over the oldest.
    assert.deepEqual(await f.page({ op: 'merge_profiles' }), { merged: 3, settings: { cutProfileId: 'a', upscaleProfileId: null } })
    const library = await f.page({ op: 'library' })
    assert.deepEqual([library.profiles.map((item: any) => item.id), library.duplicates], [['a', 'n', 'single'], 0])
    const moved = store.get('account:1', 'p1'), take = store.take('account:1', 'p1', 'take-1')
    assert.deepEqual([moved.revision, moved.nodes.map((node: any) => node.data.profileId)], [4, ['a', 'n']])
    assert.equal((f.db.prepare("SELECT revision FROM vc_project WHERE id='p1'").get() as any).revision, 4)
    assert.deepEqual([take.snapshot.nodes[0].data.profileId, take.guard.profile_id, take.profile.id], ['a', 'a', 'a'])
    assert.equal(store.lastLog('p1'), undefined)
    assert.deepEqual(untouched(), before)
    assert.deepEqual(store.profiles('account:2').map((item: any) => item.id), ['x', 'y'])
    assert.deepEqual(await f.page({ op: 'merge_profiles' }), { merged: 0, settings: { cutProfileId: 'a', upscaleProfileId: null } })
  } finally { f.db.close() }
})
test('video canvas gives a new cut the default cut setting and a new generation node no setting among several', async () => {
  const f = serviceFixture()
  try {
    f.state.workflowDetails = { 20: genDetails }
    const project = await fixtureProject(f)
    // A second cut profile does not become the default by itself.
    assert.equal((await f.dispatch('save_profile', { profile: { ...profile, id: 'final', label: '본작업' } })).settings.cutProfileId, null)
    await assert.rejects(() => f.dispatch('save_settings', { settings: { cutProfileId: 'missing' } }), (error: any) => error.status === 404)
    assert.deepEqual((await f.dispatch('save_settings', { settings: { cutProfileId: 'draft' } })).settings, { cutProfileId: 'draft', upscaleProfileId: null })
    await f.dispatch('save_profile', { profile: generator })
    await assert.rejects(() => f.dispatch('save_settings', { settings: { cutProfileId: generator.id } }), /Director/)
    const one = await f.dispatch('apply_ops', { project_id: project.id, expected_revision: revisionOf(f, project), ops: [{ op: 'add_node', kind: 'cut', tempId: 'cut' }, { op: 'add_node', kind: 'gen', tempId: 'gen' }] })
    await f.dispatch('save_profile', { profile: { ...generator, id: 'gen-two', label: '두 번째 배경' } })
    const several = await f.dispatch('apply_ops', { project_id: project.id, expected_revision: one.revision, ops: [{ op: 'add_node', kind: 'gen', tempId: 'gen' }] })
    const data = (id: string) => f.service.store.get('account:1', project.id).nodes.find((node: any) => node.id === id).data
    assert.deepEqual([data(one.tempIds.cut).profileId, data(one.tempIds.gen).profileId, data(several.tempIds.gen).profileId], ['draft', generator.id, null])
  } finally { f.db.close() }
})
test('video canvas upscales a finished cut take into a new take of the cut and moves the pick to it', async () => {
  const f = serviceFixture()
  try {
    f.state.historyPerJob = true
    f.state.workflowDetails = { 30: { name: '영상 업스케일', input_schema: [
      { id: 'video', label: '영상', type: 'image', json_path: '2.inputs.video', node_class_type: 'VHS_LoadVideo' },
      { id: 'seed', type: 'number', json_path: '4.inputs.seed' }, { id: 'scale', type: 'number' }] } }
    const project = await fixtureProject(f), cut = project.nodes[0]
    const source = await f.dispatch('get_take', { project_id: project.id, take_id: (await f.dispatch('run_cut', await runArgs(f, project))).id })
    const saved = await f.dispatch('save_profile', { profile: { workflowId: 30, videoFieldId: 'video', fixedInputs: { scale: 2 } } })
    assert.deepEqual([saved.profile.role, saved.profile.output, saved.settings.upscaleProfileId], ['upscale', 'video', saved.profileId])
    // An upscale setting generates neither a cut nor a generation node.
    await assert.rejects(async () => f.dispatch('run_cut', await runArgs(f, project, { profile_id: saved.profileId })), /Director/)
    const picked = await f.dispatch('apply_ops', { project_id: project.id, expected_revision: 1, ops: [{ op: 'set', id: cut.id, fields: { pickTakeId: source.id } }, { op: 'add_node', kind: 'gen', profileId: saved.profileId }] })
    assert.match(picked.rejected[0].reason, /업스케일 설정은 생성 노드에/)

    const upscaled = await f.dispatch('run_cut', { project_id: project.id, cut_id: cut.id, action: 'upscale', requestId: randomUUID(), expected_revision: picked.revision })
    assert.equal(upscaled.upscaleOf, source.id)
    assert.equal('output' in f.service.store.take('account:1', project.id, upscaled.id), false)
    assert.deepEqual(f.calls.filter(call => call.name === 'submit_generation_job').at(-1).args, { service_type: 'comfyui', workflow_id: 30, inputs: { scale: 2, video: { composite_hash: source.resultHash }, seed: upscaled.seed }, idempotency_key: `video-canvas-${upscaled.id}` })
    assert.equal((await f.dispatch('get_take', { project_id: project.id, take_id: upscaled.id })).resultHash, jobHash(482))
    const after = f.service.store.get('account:1', project.id)
    assert.deepEqual([after.nodes[0].data.pickTakeId, after.revision], [upscaled.id, picked.revision + 1])
    // Upscaling the upscaled take again starts from the generated take.
    const again = await f.dispatch('run_cut', { project_id: project.id, cut_id: cut.id, action: 'upscale', requestId: randomUUID(), expected_revision: after.revision })
    assert.equal(again.upscaleOf, source.id)
  } finally { f.db.close() }
})

// ---- continuation into the next cut: start for most modes, a reference image for REF2VA that its prompt names ----
// The node's own wording for a first-frame reference (what an assistant writes; the plugin never writes it).
const FIRST = (name: string) => '@' + name + ' is the first frame of [Shot 1].'
const count = (text: string, part: string) => text.split(part).length - 1
function continuationCanvas() {
  let project: any = ops(newProject('project', '영상'), [
    { op: 'add_node', kind: 'cut', name: '앞', tempId: 'a' },
    { op: 'add_node', kind: 'cut', name: '뒤', tempId: 'b' },
    { op: 'add_node', kind: 'image', name: '크림', ref: image, tempId: 'cream' },
    { op: 'add_node', kind: 'image', name: '포즈', ref: { source: 'library', compositeHash: otherHash }, tempId: 'pose' },
    { op: 'add_node', kind: 'frame', name: '앞 마지막 프레임', ref: image, tempId: 'frame' },
  ]).project
  const [a, b, cream, pose, frame] = project.nodes
  project.takes = [{ id: 'take-a', cutId: a.id, status: 'completed', resultHash: hash }]
  frame.data.origin = { nodeId: null, takeId: 'take-a', position: 'last', seconds: 4.9 }
  return { project, a, b, cream, pose, frame }
}
test('video canvas continuation rules: the port follows the mode, the text stays the person\'s and a REF2VA frame is bound by its mention', () => {
  assert.deepEqual(['T2VA', 'I2VA', 'FL2VA', 'L2VA', 'REF2VA'].map(continuationPort), ['start', 'start', 'start', 'start', 'ref_image'])
  let { project, b, cream, pose, frame } = continuationCanvas()
  const prompt = 'subject_definitions:\nGhost: cream body.\nsummary:\nThe ghost rises.'
  project = ops(project, [{ op: 'set', id: b.id, fields: { mode: 'REF2VA', prompt } }]).project
  // The earlier reference image keeps its <Picture 1>; the continuation is appended after it, and nothing is written into the text.
  let result = ops(project, [{ op: 'connect', from: cream.id, to: b.id, port: 'ref_image' }, { op: 'connect', from: frame.id, to: b.id, port: 'ref_image' }, { op: 'connect', from: pose.id, to: b.id, port: 'end' }])
  project = result.project
  let cut = project.nodes.find((node: any) => node.id === b.id)
  assert.ok(result.applied.every((item: any) => item.promptChange === undefined))
  assert.equal(cut.data.prompt, prompt)
  assert.deepEqual(continuationEdges(project, cut).map((edge: any) => [edge.port, edge.position]), [['ref_image', 1]])
  assert.deepEqual(labelTable(project, cut).filter((row: any) => row.type === 'image').map((row: any) => [row.name, row.label]), [['크림', '<Picture 1>'], ['앞 마지막 프레임', '<Picture 2>']])
  // Unnamed, it is a reference the text does not use: a warning, not an error that blocks the cut.
  let resolved = resolvePrompt(project, cut)
  assert.deepEqual(resolved.errors, [])
  assert.ok(resolved.warnings.includes(unusedReference('앞 마지막 프레임')))
  // Named in the sent text (raw when it has text), it is that Picture.
  const named = structuredClone(project), namedCut = named.nodes.find((node: any) => node.id === b.id)
  namedCut.data.raw = 'subject_definitions:\n' + FIRST('앞 마지막 프레임') + '\nThe ghost rises.'
  resolved = resolvePrompt(named, namedCut)
  assert.deepEqual(resolved.errors, [])
  assert.match(resolved.prompt, /^subject_definitions:\n<Picture 2> is the first frame of \[Shot 1\]\.\nThe ghost rises\.$/)
  assert.ok(!resolved.warnings.includes(unusedReference('앞 마지막 프레임')))
  // A replacement frame named differently takes the old mentions along, in both texts; the same name or no mention changes nothing.
  namedCut.data.prompt = 'Keep @앞 마지막 프레임.'
  const renamedFrame = named.nodes.find((node: any) => node.id === frame.id)
  renamedFrame.data.name = '첫 컷 마지막 프레임'
  assert.deepEqual(renameContinuation(named, namedCut, renamedFrame, '앞 마지막 프레임'), { cutId: b.id, field: 'raw', name: '첫 컷 마지막 프레임', renamed: '앞 마지막 프레임' })
  assert.equal(namedCut.data.raw, 'subject_definitions:\n' + FIRST('첫 컷 마지막 프레임') + '\nThe ghost rises.')
  assert.equal(namedCut.data.prompt, 'Keep @첫 컷 마지막 프레임.')
  assert.deepEqual(resolvePrompt(named, namedCut).errors, [])
  assert.equal(renameContinuation(named, namedCut, renamedFrame, '첫 컷 마지막 프레임'), null)
  assert.equal(renameContinuation(project, cut, frame, '다른 프레임'), null)
  assert.equal(cut.data.prompt, prompt)

  // The continuation link follows the mode both ways, the text untouched; the image on the end slot is no continuation and stays.
  result = ops(project, [{ op: 'set', id: b.id, fields: { mode: 'I2VA' } }])
  assert.deepEqual(result.applied[0].continuationMove, { cutId: b.id, edgeId: continuationEdges(project, cut)[0].id, from: 'ref_image', to: 'start' })
  assert.equal(result.applied[0].promptChange, undefined)
  let moved = result.project
  assert.deepEqual(moved.edges.filter((edge: any) => edge.to === b.id).map((edge: any) => [edge.from, edge.port, edge.position]).sort(), [[cream.id, 'ref_image', 0], [frame.id, 'start', 0], [pose.id, 'end', 0]].sort())
  // Back to REF2VA: the frame returns after the other reference images; the text is still exactly what was set.
  result = ops(moved, [{ op: 'set', id: b.id, fields: { prompt: 'summary:\nThe ghost rises.', mode: 'REF2VA' } }])
  assert.equal(result.applied[0].continuationMove.to, 'ref_image')
  assert.equal(result.applied[0].promptChange, undefined)
  moved = result.project
  assert.equal(moved.nodes.find((node: any) => node.id === b.id).data.prompt, 'summary:\nThe ghost rises.')
  assert.deepEqual(moved.edges.filter((edge: any) => edge.to === b.id && edge.port === 'ref_image').map((edge: any) => [edge.from, edge.position]), [[cream.id, 0], [frame.id, 1]])
  // T2VA uses no start slot: the frame stays among the (now unused) reference images, as every other connection does.
  result = ops(moved, [{ op: 'set', id: b.id, fields: { mode: 'T2VA' } }])
  assert.equal(result.applied[0].continuationMove, undefined)
  assert.equal(result.project.edges.find((edge: any) => edge.from === frame.id).port, 'ref_image')
  // A cut set to I2VA whose start slot holds another image keeps both where they are.
  const held = ops(moved, [{ op: 'connect', from: pose.id, to: b.id, port: 'start' }, { op: 'set', id: b.id, fields: { mode: 'I2VA' } }])
  assert.equal(held.applied[1].continuationMove, undefined)
  assert.equal(held.project.edges.find((edge: any) => edge.from === frame.id).port, 'ref_image')
  // Only a frame of the cut right before is a continuation.
  const reordered = ops(moved, [{ op: 'sequence', order: [b.id] }]).project
  assert.equal(isContinuation(reordered, reordered.edges.find((edge: any) => edge.from === frame.id)), false)
  // A full set of reference images has no room for it.
  const full = structuredClone(moved), fullCut = full.nodes.find((node: any) => node.id === b.id)
  for (let index = 0; index < 7; index++) full.edges.push({ id: 'extra-' + index, from: cream.id, to: b.id, port: 'ref_image', position: 2 + index, props: {} })
  assert.throws(() => continuationRoom(full, fullCut), /9개/)
  assert.doesNotThrow(() => continuationRoom(full, fullCut, [continuationEdges(full, fullCut)[0].id]))
})
test('video canvas extraction into a REF2VA cut lands among its reference images, says when it is unnamed and replaces the earlier continuation', async () => {
  const f = serviceFixture()
  try {
    f.state.historyPerJob = true
    const project = await fixtureProject(f), first = project.nodes[0]
    const take = await f.dispatch('run_cut', await runArgs(f, project))
    await f.dispatch('get_take', { project_id: project.id, take_id: take.id })
    const prompt = 'subject_definitions:\n@유나 기준: the girl.\nsummary:\nShe turns.'
    const added = await f.dispatch('apply_ops', { project_id: project.id, expected_revision: 1, ops: [
      { op: 'add_node', kind: 'cut', name: '둘째', tempId: 'b', fields: { mode: 'REF2VA', prompt } },
      { op: 'connect', from: project.nodes[1].id, to: 'b', port: 'ref_image' },
    ] })
    const b = added.tempIds.b
    const read = () => f.service.store.get('account:1', project.id), cutB = () => read().nodes.find((node: any) => node.id === b)
    const refs = () => read().edges.filter((edge: any) => edge.to === b && edge.port === 'ref_image').sort((x: any, y: any) => x.position - y.position).map((edge: any) => read().nodes.find((node: any) => node.id === edge.from).data.name)
    const first_ = await f.dispatch('extract_frame', { project_id: project.id, expected_revision: added.revision, take_id: take.id, position: 'last', target: { cut: b, port: 'ref_image' } })
    assert.deepEqual([first_.modeChange, first_.promptChange, first_.frameName, first_.unnamed], [null, null, '컷 마지막 프레임', unusedReference('컷 마지막 프레임')])
    assert.deepEqual(refs(), ['유나 기준', '컷 마지막 프레임'])
    assert.equal(cutB().data.prompt, prompt)
    assert.ok(!read().edges.some((edge: any) => edge.to === b && edge.port === 'start'))
    // The Director gets it as a timeline item with its own asset; once the prompt names it, the prompt binds it as that Picture.
    const named = await f.dispatch('apply_ops', { project_id: project.id, expected_revision: first_.revision, ops: [{ op: 'set', id: b, fields: { prompt: 'subject_definitions:\n' + FIRST('컷 마지막 프레임') + '\n@유나 기준: the girl.\nsummary:\nShe turns.' } }] })
    const value = buildDirector(read(), cutB())
    const item = JSON.parse(value.timeline_data).items.find((entry: any) => entry.value === '컷 마지막 프레임')
    assert.deepEqual([item.type, item.slot], ['image', 1])
    assert.equal(value.assets[item.id].composite_hash, otherHash)
    assert.match(value.simple_prompt, /^subject_definitions:\n<Picture 2> is the first frame of \[Shot 1\]\.\n<Picture 1>: the girl\./)
    // Again (an image added after it meanwhile): the new frame takes the old one's place, the orphan frame goes, the text is left alone.
    const extra = await f.dispatch('apply_ops', { project_id: project.id, expected_revision: named.revision, ops: [{ op: 'connect', from: project.nodes[2].id, to: b, port: 'ref_image' }] })
    const oldFrame = first_.nodeIds[0], namedText = cutB().data.prompt
    const again = await f.dispatch('extract_frame', { project_id: project.id, expected_revision: extra.revision, take_id: take.id, position: 'last', target: { cut: b, port: 'ref_image' } })
    assert.deepEqual([again.promptChange, again.frameName, again.unnamed], [null, '컷 마지막 프레임', undefined])
    assert.deepEqual(refs(), ['유나 기준', '컷 마지막 프레임', '배경'])
    assert.equal(read().nodes.some((node: any) => node.id === oldFrame), false)
    assert.equal(cutB().data.prompt, namedText)
    // A renamed source names its frame differently: the mention follows instead of blocking the cut as an unknown name.
    const renamed = await f.dispatch('apply_ops', { project_id: project.id, expected_revision: again.revision, ops: [{ op: 'set', id: first.id, fields: { name: '첫 컷' } }] })
    const third = await f.dispatch('extract_frame', { project_id: project.id, expected_revision: renamed.revision, take_id: take.id, position: 'last', target: { cut: b, port: 'ref_image' } })
    assert.deepEqual(third.promptChange, { cutId: b, field: 'prompt', name: '첫 컷 마지막 프레임', renamed: '컷 마지막 프레임' })
    assert.deepEqual([third.frameName, third.unnamed], ['첫 컷 마지막 프레임', undefined])
    assert.equal(cutB().data.prompt, 'subject_definitions:\n' + FIRST('첫 컷 마지막 프레임') + '\n@유나 기준: the girl.\nsummary:\nShe turns.')
    assert.deepEqual(resolvePrompt(read(), cutB()).errors, [])
    // A continuation left on the start slot REF2VA ignores (older data) is replaced by the next one too.
    const current = read(), broken = structuredClone(current)
    const link = broken.edges.find((edge: any) => edge.to === b && edge.from === third.nodeIds[0])
    Object.assign(link, { port: 'start', position: 0 })
    f.service.store.save('account:1', current, { ...broken, revision: current.revision + 1 })
    const fixed = await f.dispatch('extract_frame', { project_id: project.id, expected_revision: current.revision + 1, take_id: take.id, position: 'last', target: { cut: b, port: 'ref_image' } })
    assert.ok(!read().edges.some((edge: any) => edge.to === b && edge.port === 'start'))
    assert.deepEqual(refs(), ['유나 기준', '배경', '첫 컷 마지막 프레임'])
    assert.equal(fixed.promptChange, null)
    // No room left among nine reference images: refused before a frame is made.
    const before = read(), filled = structuredClone(before)
    filled.edges = filled.edges.filter((edge: any) => !(edge.to === b && edge.from === fixed.nodeIds[0]))
    for (let index = 0; index < 7; index++) filled.edges.push({ id: 'fill-' + index, from: project.nodes[1].id, to: b, port: 'ref_image', position: 2 + index, props: {} })
    f.service.store.save('account:1', before, { ...filled, revision: before.revision + 1 })
    const frames = f.calls.filter(call => call.name === 'save_video_frame').length
    await assert.rejects(() => f.dispatch('extract_frame', { project_id: project.id, expected_revision: before.revision + 1, take_id: take.id, position: 'last', target: { cut: b, port: 'ref_image' } }), /9개/)
    assert.equal(f.calls.filter(call => call.name === 'save_video_frame').length, frames)
  } finally { f.db.close() }
})
test('video canvas chain binds a continuation frame a REF2VA prompt named before it existed, and a start-mode cut continues from its start slot', async () => {
  const f = serviceFixture()
  try {
    f.state.historyPerJob = true
    const project = await fixtureProject(f)
    // An assistant writes every prompt first: cut B already names the frame the chain will make from cut 컷.
    const prompt = 'subject_definitions:\n' + FIRST('컷 마지막 프레임') + '\n@유나 기준: the girl.\nsummary:\nShe turns.'
    const added = await f.dispatch('apply_ops', { project_id: project.id, expected_revision: 1, ops: [
      { op: 'add_node', kind: 'cut', name: '둘째', tempId: 'b', fields: { mode: 'REF2VA', prompt } },
      { op: 'connect', from: project.nodes[1].id, to: 'b', port: 'ref_image' },
      { op: 'add_node', kind: 'cut', name: '셋째', tempId: 'c', fields: { prompt: 'She walks away.' } },
    ] })
    assert.deepEqual(added.rejected, [])
    const { b, c } = added.tempIds
    const read = () => f.service.store.get('account:1', project.id), node = (id: string) => read().nodes.find((item: any) => item.id === id)
    const into = (cut: string) => read().edges.filter((edge: any) => edge.to === cut && ['start', 'ref_image'].includes(edge.port)).map((edge: any) => [edge.port, node(edge.from).data.name])
    const chain = await f.dispatch('run_chain', { project_id: project.id, expected_revision: added.revision, wait_seconds: 120 })
    assert.equal(chain.status, 'completed', chain.error)
    assert.deepEqual(f.calls.filter(call => call.name === 'save_video_frame').map(call => call.args.composite_hash), [jobHash(481), jobHash(482)])
    assert.deepEqual(into(b), [['ref_image', '유나 기준'], ['ref_image', '컷 마지막 프레임']])
    assert.deepEqual([node(b).data.mode, node(b).data.prompt], ['REF2VA', prompt])
    // Not REF2VA: unchanged, the start slot and T2VA -> I2VA.
    assert.deepEqual(into(c), [['start', '둘째 마지막 프레임']])
    assert.equal(node(c).data.mode, 'I2VA')
    // The Director payload cut B was submitted with binds the frame as its Picture.
    const takeB = read().takes.find((take: any) => take.id === chain.steps[1].takeId)
    const director = f.calls.filter(call => call.name === 'submit_generation_job')[1].args.inputs.director
    const item = JSON.parse(director.timeline_data).items.find((entry: any) => entry.value === '컷 마지막 프레임')
    assert.deepEqual([item.type, item.slot, director.assets[item.id].composite_hash], ['image', 1, otherHash])
    assert.match(director.simple_prompt, /^subject_definitions:\n<Picture 2> is the first frame of \[Shot 1\]\.\n<Picture 1>: the girl\./)
    assert.ok(takeB.resolved.table.some((row: any) => row.name === '컷 마지막 프레임' && row.label === '<Picture 2>'))
    const extraction = read().extractions.find((item: any) => item.id === chain.steps[1].extractionId)
    assert.deepEqual([extraction.promptChange, extraction.frameName, extraction.unnamed, chain.steps[1].unnamed, chain.steps[2].unnamed], [null, '컷 마지막 프레임', undefined, undefined, undefined])
    // Running it again replaces the continuation instead of piling reference images up.
    const firstFrame = read().edges.find((edge: any) => edge.to === b && node(edge.from).data.name === '컷 마지막 프레임').from
    const again = await f.dispatch('run_chain', { project_id: project.id, expected_revision: read().revision, regenerate: true, wait_seconds: 120 })
    assert.equal(again.status, 'completed', again.error)
    assert.deepEqual(into(b), [['ref_image', '유나 기준'], ['ref_image', '컷 마지막 프레임']])
    assert.equal(node(firstFrame), undefined)
    assert.equal(node(b).data.prompt, prompt)
    // keep_start on a REF2VA cut keeps its continuation frame: one left on the unused start slot moves into the reference images, nothing is
    // extracted for it and nothing is written; the step says the text does not name it.
    const current = read(), broken = structuredClone(current), link = broken.edges.find((edge: any) => edge.to === b && edge.port === 'ref_image' && edge.position === 1)
    Object.assign(link, { port: 'start', position: 0 })
    broken.nodes.find((item: any) => item.id === b).data.prompt = 'summary:\nShe turns.'
    f.service.store.save('account:1', current, { ...broken, revision: current.revision + 1 })
    const frames = f.calls.filter(call => call.name === 'save_video_frame').length
    const kept = await f.dispatch('run_chain', { project_id: project.id, expected_revision: current.revision + 1, regenerate: true, keep_start: true, wait_seconds: 120 })
    assert.equal(kept.status, 'completed', kept.error)
    assert.equal(f.calls.filter(call => call.name === 'save_video_frame').length, frames)
    assert.deepEqual(into(b), [['ref_image', '유나 기준'], ['ref_image', '컷 마지막 프레임']])
    assert.equal(read().edges.find((edge: any) => edge.to === b && edge.port === 'ref_image' && edge.position === 1).from, link.from)
    assert.equal(node(b).data.prompt, 'summary:\nShe turns.')
    assert.deepEqual([kept.steps[1].unnamed, kept.steps[2].unnamed], [unusedReference('컷 마지막 프레임'), undefined])
    assert.deepEqual(into(c), [['start', '둘째 마지막 프레임']])
  } finally { f.db.close() }
})
test('video canvas continues among reference images only with the last frame, and taking it out leaves the text alone', () => {
  let { project, b, frame } = continuationCanvas()
  const prompt = 'subject_definitions:\n' + FIRST('앞 마지막 프레임') + '\nGhost: cream body.'
  project = ops(project, [{ op: 'set', id: b.id, fields: { mode: 'REF2VA', prompt } }]).project
  const cutOf = (state: any) => state.nodes.find((node: any) => node.id === b.id)
  // A first or middle frame of the cut before is a reference the person chose: no continuation. On the start slot any frame continues.
  const middle = structuredClone(project)
  middle.nodes.find((node: any) => node.id === frame.id).data.origin.position = 'middle'
  let result = ops(middle, [{ op: 'connect', from: frame.id, to: b.id, port: 'ref_image' }])
  const chosen = result.project.edges.find((edge: any) => edge.from === frame.id)
  assert.equal(result.applied[0].promptChange, undefined)
  assert.equal(isContinuation(result.project, chosen), false)
  assert.equal(isContinuation(result.project, { ...chosen, port: 'start' }), true)
  assert.deepEqual(continuationEdges(result.project, cutOf(result.project)), [])
  // The last frame continues; disconnecting or removing it changes no text (the person's mention then reads as unknown, as any other would).
  project = ops(project, [{ op: 'connect', from: frame.id, to: b.id, port: 'ref_image' }]).project
  const edge = project.edges.find((item: any) => item.from === frame.id)
  assert.deepEqual(continuationEdges(project, cutOf(project)).map((item: any) => item.id), [edge.id])
  assert.deepEqual(resolvePrompt(project, cutOf(project)).errors, [])
  for (const op of [{ op: 'disconnect', id: edge.id }, { op: 'remove', id: frame.id }]) {
    result = ops(project, [op])
    assert.equal(result.applied[0].promptChange, undefined)
    assert.equal(cutOf(result.project).data.prompt, prompt)
    assert.equal(count(cutOf(result.project).data.prompt, '앞 마지막 프레임'), 1)
  }
})
test('video canvas extracts a middle frame of the cut before into reference images as a plain reference, replacing nothing', async () => {
  const f = serviceFixture()
  try {
    f.state.historyPerJob = true
    const project = await fixtureProject(f)
    const take = await f.dispatch('run_cut', await runArgs(f, project))
    await f.dispatch('get_take', { project_id: project.id, take_id: take.id })
    const added = await f.dispatch('apply_ops', { project_id: project.id, expected_revision: 1, ops: [{ op: 'add_node', kind: 'cut', name: '둘째', tempId: 'b', fields: { mode: 'REF2VA', prompt: 'summary:\nShe turns.' } }] })
    const b = added.tempIds.b, read = () => f.service.store.get('account:1', project.id), cutB = () => read().nodes.find((node: any) => node.id === b)
    const refs = () => read().edges.filter((edge: any) => edge.to === b && edge.port === 'ref_image').sort((x: any, y: any) => x.position - y.position).map((edge: any) => edge.from)
    const last = await f.dispatch('extract_frame', { project_id: project.id, expected_revision: added.revision, take_id: take.id, position: 'last', target: { cut: b, port: 'ref_image' } })
    assert.deepEqual([last.promptChange, last.unnamed], [null, unusedReference('컷 마지막 프레임')])
    const middle = await f.dispatch('extract_frame', { project_id: project.id, expected_revision: last.revision, take_id: take.id, position: 'middle', target: { cut: b, port: 'ref_image' } })
    assert.deepEqual([middle.promptChange, middle.frameName, middle.unnamed], [null, '컷 가운데 프레임', unusedReference('컷 가운데 프레임')])
    assert.deepEqual(refs(), [last.nodeIds[0], middle.nodeIds[0]])
    assert.equal(cutB().data.prompt, 'summary:\nShe turns.')
    assert.deepEqual(continuationEdges(read(), cutB()).map((edge: any) => edge.from), [last.nodeIds[0]])
  } finally { f.db.close() }
})
test('video canvas chain over chosen cuts continues each from the cut it ran before and keeps one reference frame its prompt named early', async () => {
  const f = serviceFixture()
  try {
    f.state.historyPerJob = true
    const project = await fixtureProject(f), a = project.nodes[0].id
    const prompt = 'subject_definitions:\n' + FIRST('컷 마지막 프레임') + '\n@유나 기준: the girl.\nsummary:\nShe turns.'
    const added = await f.dispatch('apply_ops', { project_id: project.id, expected_revision: 1, ops: [
      { op: 'add_node', kind: 'cut', name: '둘째', tempId: 'b', fields: { prompt: 'She waits.' } },
      { op: 'add_node', kind: 'cut', name: '셋째', tempId: 'c', fields: { mode: 'REF2VA', prompt } },
      { op: 'connect', from: project.nodes[1].id, to: 'c', port: 'ref_image' },
    ] })
    const { b, c } = added.tempIds
    const read = () => f.service.store.get('account:1', project.id), node = (id: string) => read().nodes.find((item: any) => item.id === id)
    const fromA = () => read().edges.filter((edge: any) => edge.to === c && ['start', 'ref_image'].includes(edge.port) && node(edge.from).data.origin?.takeId).map((edge: any) => [edge.port, node(edge.from).data.name])
    // Cut C runs right after A (B is skipped), so it continues from A although A is not the cut before it in the sequence.
    const first = await f.dispatch('run_chain', { project_id: project.id, expected_revision: added.revision, cut_ids: [a, c], regenerate: true, wait_seconds: 120 })
    assert.equal(first.status, 'completed', first.error)
    assert.deepEqual(fromA(), [['ref_image', '컷 마지막 프레임']])
    const extraction = read().extractions.find((item: any) => item.id === first.steps[1].extractionId)
    assert.deepEqual([extraction.promptChange, extraction.frameName, extraction.unnamed], [null, '컷 마지막 프레임', undefined])
    const firstFrame = read().edges.find((edge: any) => edge.to === c && node(edge.from).data.origin?.takeId).from
    // Again: the frame is replaced in its place, not piled up, and the text is untouched.
    const second = await f.dispatch('run_chain', { project_id: project.id, expected_revision: read().revision, cut_ids: [a, c], regenerate: true, wait_seconds: 120 })
    assert.equal(second.status, 'completed', second.error)
    assert.deepEqual(fromA(), [['ref_image', '컷 마지막 프레임']])
    assert.equal(node(firstFrame), undefined)
    assert.equal(node(c).data.prompt, prompt)
    assert.deepEqual(read().edges.filter((edge: any) => edge.to === b), [])
    // Cut C's Director payload has the frame as a reference image its prompt binds.
    const value = buildDirector(read(), node(c)), item = JSON.parse(value.timeline_data).items.find((entry: any) => entry.value === '컷 마지막 프레임')
    assert.deepEqual([item.type, item.slot], ['image', 1])
    assert.match(value.simple_prompt, /^subject_definitions:\n<Picture 2> is the first frame of \[Shot 1\]\.\n<Picture 1>: the girl\./)
    const takeC = read().takes.find((take: any) => take.id === second.steps[1].takeId)
    assert.match(takeC.resolved.prompt, /<Picture 2> is the first frame of \[Shot 1\]\./)
    // keep_start keeps that frame: nothing is extracted for C.
    const frames = f.calls.filter(call => call.name === 'save_video_frame').length
    const kept = await f.dispatch('run_chain', { project_id: project.id, expected_revision: read().revision, cut_ids: [a, c], regenerate: true, keep_start: true, wait_seconds: 120 })
    assert.equal(kept.status, 'completed', kept.error)
    assert.equal(f.calls.filter(call => call.name === 'save_video_frame').length, frames)
    assert.deepEqual(fromA(), [['ref_image', '컷 마지막 프레임']])
    assert.equal(kept.steps[1].unnamed, undefined)
  } finally { f.db.close() }
})
