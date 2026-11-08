import assert from 'node:assert/strict'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { applyOps, buildDirector, checkCut, generationRequest, labelTable, mediaItems, newProject, normalizeRef, resolvePrompt, resultHash } from '../../plugins/video-canvas/domain.mjs'
import { activate, createStore, unwrap } from '../../plugins/video-canvas/server.mjs'
import { createAssistantState, createRefreshQueue, excerpt, rejectedMessage } from '../../plugins/video-canvas/assistant-state.mjs'
import { normalizeMcpWorkflowInputs } from '../src/services/comfyui/comfyWorkflowInputs'
import { CHAT_PAGE_ACTION_LIMITS, copyChatPageData, isPrivateChatPageKey, normalizeChatPageSchema, validateChatPageArguments } from '../../shared/src/utils/chatPageAction'

const hash = 'a'.repeat(32), otherHash = 'b'.repeat(32)
const image = { source: 'library', compositeHash: hash }
const profile = { id: 'draft', label: '초안', workflowId: 12, directorFieldId: 'director', seedFieldId: 'seed', overrides: { frame_rate: 24, resolution: { preset: '720p' } } }
const details = { input_schema: [
  { id: 'director', type: 'node', node_editor: 'minimax_h3_director_dasiwa' },
  { id: 'seed', type: 'number', seed_rule: 'explicit seed', json_path: '5.inputs.seed' },
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
    store.save('account:1', project, result.project, { ops: [], actor: 'assistant' })
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
  const state: any = { ready: false, fingerprint: 'fingerprint', audioRevision: 'revision-one', members: [{ kind: 'image' }], frames: [], frameId: randomUUID(), job: 480 }
  let pageHandler: any
  const conai = {
    db,
    tools: {
      register(definition: any) { registered.push(definition) },
      async call(name: string, args: any) {
        calls.push({ name, args })
        if (name === 'get_workflow_details') { state.detailsStarted?.(); if (state.detailsGate) await state.detailsGate; return details }
        if (name === 'get_image_metadata') return { duration: 4 }
        if (name === 'get_audio_candidate') return { duration_seconds: 4, revision: state.audioRevision }
        if (name === 'list_comfy_refmods') return { server_id: 1, entries: [{ name: 'crowd', members: state.members }] }
        if (name === 'submit_generation_job') return { job_id: ++state.job, status: 'queued' }
        if (name === 'cancel_generation_job') return { status: 'cancelled' }
        if (name === 'get_generation_job') return { status: 'completed', history_ids: [91] }
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
      if (url === '/api/generation-history/91') return Response.json({ record: { postprocess_status: state.ready ? 'ready' : 'processing', composite_hash: hash, actual_composite_hash: otherHash } })
      throw new Error(`Unexpected URL: ${url}`)
    } },
    hooks: { on(name: string, handler: any) { hooks.set(name, handler) } }, onRequest(handler: any) { pageHandler = handler },
  }
  const service = activate(conai), account = { id: 1 }
  const dispatch = (op: string, args: any = {}, actor = 'assistant', options = {}) => service.dispatch({ op, ...args }, account, actor, options)
  const tool = async (name: string, args: any, actorAccount = account) => unwrap(await registered.find(tool => tool.name === name).handler(args, { account: actorAccount }))
  return { db, conai, calls, state, service, dispatch, tool, emit: (name: string, event: any) => hooks.get(name)(event), page: (body: any) => pageHandler({ body, account }), markReady: () => { state.ready = true } }
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
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM vc_undo').get().n, 1)
    const batch = await f.dispatch('apply_ops', { project_id: project.id, expected_revision: 6, ops: [{ op: 'set', id: project.nodes[0].id, fields: { prompt: '바뀐 장면' } }] })
    await f.dispatch('run_cut', await runArgs(f, project))
    await f.dispatch('check', { project_id: project.id })
    const undone = await f.dispatch('undo', { project_id: project.id, expected_revision: batch.revision })
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
    do { const page = excerpt(f.service.store.get('account:1', project.id), { edge_cursor: cursor, limit: 7 }); ids.push(...page.edges.map((edge: any) => edge.id)); cursor = page.nextEdgeCursor } while (cursor)
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
    for (const mismatch of [{ cut_mode: 'T2VA' }, { seed: 0 }, { duration: 6 }, { profile_id: 'other' }, { profile_label: '다른 프로필' }, { prompt: '다른 프롬프트' }, { soundscape: '소리' }, { music: '음악' }, { slot_summary: '[]' }]) {
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
    for (const field of ['prompt', 'soundscape', 'music', 'slot_summary', 'profile_label']) {
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
    assert.equal(saved.profiles[0].unknown_token, undefined)
    assert.deepEqual(saved.profiles[0].overrides, { prompt_enhancer_token_limit: 12000 })
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
    state.set('lastEdit', { profiles: saved.profiles, applied: [], rejected: [], tempIds: {} })
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
