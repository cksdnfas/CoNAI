import { randomUUID, randomInt, createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { applyOps, buildDirector, canonical, checkCut, cutEdges, cutOf, expected, fail, generationRequest, nodeOf, normalizeRef, profilePublication, resultHash, validateProfile } from './domain.mjs'
import { excerpt, recordPage } from './assistant-state.mjs'
import { createStore, workflowSourceKey } from './store.mjs'
export { createStore } from './store.mjs'

export function unwrap(result) {
  if (!result?.content) return result
  const text = result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
  if (result.isError) fail(text)
  try { return JSON.parse(text) } catch { return text }
}
const digest = value => createHash('sha256').update(canonical(value)).digest('hex')
const ownerOf = account => {
  if (!account) fail('계정이 필요해.', 403)
  return account.id === null ? 'bootstrap' : `account:${account.id}`
}
const enumArg = (value, choices, name) => { if (value !== undefined && !choices.includes(value)) fail(`${name}: ${choices.join(' / ')} 중에서 골라줘.`) }
const booleanArg = (value, name) => { if (value !== undefined && typeof value !== 'boolean') fail(`${name}: 참/거짓 값이 필요해.`) }
const requiredText = (value, name) => { if (typeof value !== 'string' || !value.trim()) fail(`${name}가 필요해.`) }
const terminal = status => ['completed', 'failed', 'cancelled'].includes(status)
const safeTake = take => {
  const { request, baseDirector, snapshot, guard, ...safe } = take
  return { ...safe, profile: profilePublication(take.profile), takeId: take.id }
}
const checkSummary = check => ({ blocked: check.blocked, errors: check.errors, warnings: check.warnings })
const reviewFields = (cut, profile, resolved) => ({
  cut_mode: cut.data.mode, duration: cut.data.duration, seed: cut.data.seed,
  profile_id: profile.id, profile_label: profile.label,
  prompt: resolved.prompt, soundscape: resolved.soundscape, music: resolved.music,
  slot_summary: JSON.stringify(resolved.table.map(({ port, slot, label, name, props }) => ({ port, slot, label, name, props }))),
})
export function createService(conai, store = createStore(conai.db)) {
  const preparing = new Map(), submitting = new Map(), uploads = new Map()
  const call = async (name, args) => unwrap(await conai.tools.call(name, args))
  const json = async (path, options) => {
    const response = await conai.app.fetch(path, options), body = await response.json()
    if (!response.ok || body.success === false) fail(body.error ?? response.statusText, response.status)
    return body
  }
  const save = (owner, before, next, log) => { next.revision = before.revision + 1; return store.save(owner, before, next, log) }
  const cached = (cache, key, fn) => {
    if (!cache.has(key)) cache.set(key, Promise.resolve().then(fn))
    return cache.get(key)
  }
  async function bundleRecord(node, cache) {
    if (!node.data.ref.recordId) return null
    const records = await cached(cache, 'refmod-records', async () => (await json('/api/refmods')).data)
    const record = records.find(record => record.id === node.data.ref.recordId && record.name === node.data.ref.name)
    if (!record) fail('번들 레코드가 삭제됐어.', 404)
    return record
  }
  const bundleFingerprint = (node, record, entries = []) => digest(record
    ? { name: record.name, status: record.status, members: record.members }
    : { name: node.data.ref.name, entries })
  async function bundleState(node, project, cache) {
    const connected = project.nodes.filter(cut => cut.kind === 'cut' && cutEdges(project, cut).some(edge => edge.from === node.id))
    const profiles = [...new Map(connected.map(cut => {
      const profile = project.profiles.find(profile => profile.id === cut.data.profileId)
      return [profile?.id ?? '', profile]
    })).values()]
    if (!profiles.length) profiles.push(undefined)
    const entries = []
    for (const profile of profiles) {
      const args = { ...(profile ? { workflow_id: profile.workflowId } : {}), ...(profile?.serverId ? { server_id: profile.serverId } : {}) }
      const library = await cached(cache, `refmods:${canonical(args)}`, () => call('list_comfy_refmods', args))
      const entry = library.entries.find(entry => (typeof entry === 'string' ? entry : entry.name) === node.data.ref.name)
      if (!entry) fail('서버에 번들이 없어.', 404)
      entries.push(entry)
    }
    const record = await bundleRecord(node, cache)
    return { fingerprint: bundleFingerprint(node, record, entries), members: (record?.members ?? entries[0]?.members ?? []).map(member => ({ kind: member.kind })) }
  }
  async function inspect(project, cutId) {
    const cache = new Map(), sources = {}, assets = {}
    const nodes = cutId ? [...new Set(cutEdges(project, cutOf(project, cutId)).map(edge => edge.from))].map(id => nodeOf(project, id)) : project.nodes.filter(node => node.kind !== 'cut')
    for (const node of nodes) {
      try {
        const resolved = node.kind === 'bundle' ? await bundleState(node, project, cache)
          : await cached(cache, `media:${canonical(node.data.ref)}`, () => conai.media.resolve(node.data.ref))
        sources[node.id] = resolved
        assets[node.id] = { status: node.data.fingerprint && node.data.fingerprint !== resolved.fingerprint ? 'changed' : 'ready', fingerprint: resolved.fingerprint, ...(resolved.members ? { members: resolved.members } : {}) }
      } catch (error) {
        assets[node.id] = { status: error.status === 403 ? 'no-permission' : error.status === 404 ? 'missing' : 'unverified', message: error.message }
      }
    }
    return { sources, assets, cuts: project.nodes.filter(node => node.kind === 'cut' && (!cutId || node.id === cutId)).map(cut => ({ id: cut.id, ...checkCut(project, cut, assets) })) }
  }
  async function upload(owner, node, resolved, takeId) {
    resolved ??= await conai.media.resolve(node.data.ref)
    const key = workflowSourceKey(node.data.ref, resolved.fingerprint)
    const saved = store.upload(owner, key)
    if (saved) { store.linkUpload(owner, takeId, key); return saved }
    const flight = `${owner}:${key}`
    if (uploads.has(flight)) {
      const ref = await uploads.get(flight)
      store.linkUpload(owner, takeId, key)
      return ref
    }
    const pending = (async () => {
      let bytes
      try { bytes = await readFile(resolved.path) }
      catch { fail(`소재 파일을 읽을 수 없어: ${node.data.name}. 소재를 다시 확인해줘.`) }
      const boundary = `vc-${randomUUID()}`, fileName = resolved.name.replace(/["\r\n\\]/g, '_')
      const mimeType = resolved.mimeType.replace(/[\r\n]/g, '')
      const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)])
      const response = await json('/api/workflow-input-assets', { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body })
      store.cacheUpload(owner, key, response.data)
      store.linkUpload(owner, takeId, key)
      return response.data
    })()
    uploads.set(flight, pending)
    try { return await pending } finally { uploads.delete(flight) }
  }
  function inputFor(project, args, chosenSeed) {
    let source = structuredClone(project), cut = cutOf(source, args.cut_id), previous
    if (args.take_id) {
      previous = project.takes.find(take => take.id === args.take_id && take.cutId === cut.id)
      if (!previous) fail('다시 돌릴 take가 없어.')
      if (args.inputs === 'take') {
        if (previous.status === 'discarded') fail('폐기한 제안의 입력은 다시 쓸 수 없어. 현재 입력으로 새로 생성해줘.')
        source.nodes = structuredClone(previous.snapshot.nodes); source.edges = structuredClone(previous.snapshot.edges)
        cut = cutOf(source, cut.id)
      }
    }
    const seed = chosenSeed ?? previous?.seed ?? cut.data.seed
    const profile = project.profiles.find(profile => profile.id === (args.profile_id ?? cut.data.profileId))
    if (!profile) fail('생성 프로필을 먼저 만들어 골라줘.')
    cut.data.seed = seed; cut.data.profileId = profile.id; source.profiles = [profile]
    const identities = {}
    for (const edge of cutEdges(source, cut)) {
      const node = nodeOf(source, edge.from)
      if (node.kind !== 'bundle' && node.data.ref.source !== 'library') identities[node.id] = { ...node.data.ref, fingerprint: node.data.fingerprint ?? null }
    }
    const intended = buildDirector(source, cut, identities)
    const inputDigest = digest({ director: { ...intended, ...profile.overrides }, seed, profile })
    return { source, cut, seed, profile: structuredClone(profile), previous: args.inputs === 'take' ? previous : null, inputDigest }
  }
  function currentDigest(owner, projectId, take) {
    return inputFor(store.get(owner, projectId), take.guard, take.seed).inputDigest
  }
  function assertDigest(owner, projectId, take, supplied) {
    let current
    try { current = currentDigest(owner, projectId, take) } catch { fail('409: 컷 입력이 바뀌었어. read_node로 다시 읽고 제안해줘.', 409) }
    if (supplied !== take.inputDigest || current !== take.inputDigest) fail('409: 컷 입력이 바뀌었어. read_node로 다시 읽고 제안해줘.', 409)
  }
  async function refreshTake(owner, projectId, takeId) {
    const take = store.take(owner, projectId, takeId)
    if (!take.jobId || take.resultHash) return take
    const job = await call('get_generation_job', { job_id: take.jobId })
    let historyId = take.historyId, hash = null
    for (const id of job.history_ids ?? (take.historyId ? [take.historyId] : [])) {
      historyId = id; hash = resultHash((await json(`/api/generation-history/${id}`)).record)
      if (hash) break
    }
    return store.setTake(owner, projectId, takeId, { status: job.status, historyId: historyId ?? null, resultHash: hash })
  }
  async function submit(owner, projectId, takeId) {
    const take = store.take(owner, projectId, takeId)
    if (take.jobId) return take
    if (!take.request) fail('입력 준비가 끝나지 않았어. 상태를 읽어줘.')
    if (submitting.has(take.id)) return submitting.get(take.id)
    const promise = (async () => {
      try {
        const job = await call('submit_generation_job', take.request)
        return store.setTake(owner, projectId, takeId, { jobId: job.job_id ?? job.id, status: job.status ?? 'queued', error: null })
      } catch (error) { error.outcome = safeTake(store.setTake(owner, projectId, takeId, { status: 'failed', error: error.message })); throw error }
    })()
    submitting.set(take.id, promise)
    try { return await promise } finally { submitting.delete(take.id) }
  }
  async function releaseDiscarded(owner, projectId, takeId) {
    const cleanupErrors = []
    for (const upload of store.releaseCandidates(owner, takeId)) {
      try { await json(`/api/workflow-input-assets/${upload.ref.id}`, { method: 'DELETE' }); store.removeUpload(owner, upload.keys) }
      catch (error) { cleanupErrors.push(error.message) }
    }
    return store.setTake(owner, projectId, takeId, { cleanupErrors })
  }
  async function run(owner, args, actor, signal, reviewed = false) {
    enumArg(args.mode, ['now', 'propose'], 'mode')
    enumArg(args.inputs, ['take', 'canvas'], 'inputs')
    enumArg(args.action, ['approve', 'discard', 'retry', 'cancel'], 'action')
    booleanArg(args.new_seed, 'new_seed')
    if (['approve', 'discard'].includes(args.action) && actor !== 'human') fail('제안 승인·폐기는 사람이 캔버스에서 직접 해줘.', 403)
    const project = store.get(owner, args.project_id)
    let reviewedFields
    if (reviewed) {
      const cut = cutOf(project, args.cut_id), profile = project.profiles.find(profile => profile.id === cut.data.profileId), check = checkCut(project, cut)
      if (!profile || check.blocked || args.action !== undefined || args.take_id !== undefined || args.new_seed !== undefined) fail('409: 검토할 컷 입력을 다시 읽어줘.', 409)
      const current = reviewFields(cut, profile, check.resolved)
      reviewedFields = Object.fromEntries(Object.keys(current).map(key => [key, args[key]]))
      let matches = false
      try { matches = canonical({ ...current, slot_summary: JSON.parse(current.slot_summary) }) === canonical({ ...reviewedFields, slot_summary: JSON.parse(reviewedFields.slot_summary) }) } catch { /* A malformed summary cannot approve a different input. */ }
      if (!matches || args.input_digest !== inputFor(project, { cut_id: cut.id }).inputDigest) fail('409: 검토 카드 내용이 현재 컷과 달라. read_node로 다시 읽고 제안해줘.', 409)
    }
    const view = take => ({ ...safeTake(take), revision: store.get(owner, project.id).revision })
    if (args.action) {
      requiredText(args.take_id, 'take_id')
      const take = store.take(owner, project.id, args.take_id)
      if (args.action === 'discard') {
        if (take.status !== 'proposed' || args.input_digest !== take.inputDigest) fail('제안과 입력 digest를 다시 확인해줘.', 409)
        store.setTake(owner, project.id, take.id, { status: 'discarded' })
        return view(await releaseDiscarded(owner, project.id, take.id))
      }
      if (args.action === 'cancel') {
        if (!take.jobId) fail('취소할 작업이 없어.')
        const result = await call('cancel_generation_job', { job_id: take.jobId })
        return view(store.setTake(owner, project.id, take.id, { status: result.status ?? 'cancelled' }))
      }
      if (args.action === 'approve') {
        if (take.status !== 'proposed') fail('제안된 take를 골라줘.')
        assertDigest(owner, project.id, take, args.input_digest)
      } else if (take.status === 'proposed' || take.status === 'discarded') fail('제안은 사람이 승인해야 해.', 403)
      if (take.jobId) return view(take)
      const checked = await inspect({ ...project, ...take.snapshot, profiles: [take.profile] }, take.cutId)
      if (checked.cuts[0].blocked) fail(checked.cuts[0].errors.map(issue => issue.message).join('\n'))
      store.setTake(owner, project.id, take.id, { checks: checkSummary(checked.cuts[0]) })
      signal?.throwIfAborted()
      return view(await submit(owner, project.id, take.id))
    }
    requiredText(args.requestId, 'requestId')
    const fingerprint = digest({ cut_id: args.cut_id, take_id: args.take_id, inputs: args.inputs ?? 'canvas', profile_id: args.profile_id, mode: args.mode ?? 'now', new_seed: args.new_seed ?? false, input_digest: args.input_digest, review: reviewedFields })
    const existing = store.request(owner, project.id, args.requestId, fingerprint)
    if (existing) return view(existing)
    if (args.mode !== 'propose' && args.input_digest === undefined) expected(project, args.expected_revision)
    if (args.mode === 'propose' && args.new_seed) fail('새 시드는 먼저 컷에서 골라줘.')
    const prepared = inputFor(project, args, args.new_seed ? randomInt(0, 2147483648) : undefined)
    if (args.mode === 'propose' && args.input_digest !== prepared.inputDigest || args.input_digest !== undefined && args.input_digest !== prepared.inputDigest) fail('409: 컷 입력 digest를 read_node로 다시 읽어줘.', 409)
    const flight = `${owner}:${project.id}:${prepared.cut.id}:${prepared.inputDigest}:${args.mode ?? 'now'}`
    if (preparing.has(flight)) {
      const running = preparing.get(flight)
      store.linkRequest(owner, project.id, args.requestId, fingerprint, running.id)
      return view(await running.promise)
    }
    const { source, cut, seed, profile } = prepared, id = randomUUID()
    const snapshot = { nodes: source.nodes.filter(node => node.id === cut.id || cutEdges(source, cut).some(edge => edge.from === node.id)), edges: cutEdges(source, cut) }
    const take = { id, cutId: cut.id, seed, profile, snapshot, inputDigest: prepared.inputDigest,
      guard: { cut_id: cut.id, profile_id: profile.id, take_id: args.take_id, inputs: args.inputs ?? 'canvas' },
      resolved: checkCut(source, cut).resolved, status: 'preparing', jobId: null, historyId: null, resultHash: null, review: 'pending', memo: '', label: profile.label }
    store.addTake(owner, project.id, take)
    store.linkRequest(owner, project.id, args.requestId, fingerprint, id)
    if (args.new_seed) {
      const next = structuredClone(project); cutOf(next, cut.id).data.seed = seed; save(owner, project, next)
    }
    const promise = (async () => {
      try {
        signal?.throwIfAborted()
        validateProfile(profile, await call('get_workflow_details', { workflow_id: profile.workflowId }))
        const checked = await inspect(source, cut.id), issues = checked.cuts[0]
        store.setTake(owner, project.id, id, { checks: checkSummary(issues) })
        if (issues.blocked) fail(issues.errors.map(issue => issue.message).join('\n'))
        let baseDirector
        if (prepared.previous?.baseDirector) baseDirector = structuredClone(prepared.previous.baseDirector)
        else {
          const assets = {}
          for (const edge of cutEdges(source, cut)) {
            const node = nodeOf(source, edge.from)
            if (node.kind === 'bundle' || node.data.ref.source === 'library' || assets[node.id]) continue
            assets[node.id] = prepared.previous?.request?.inputs?.[prepared.previous.profile.directorFieldId]?.assets?.[edge.id] ?? await upload(owner, node, checked.sources[node.id], id)
          }
          baseDirector = buildDirector(source, cut, assets)
        }
        const request = generationRequest(profile, { ...baseDirector, ...structuredClone(profile.overrides ?? {}) }, seed, id)
        signal?.throwIfAborted()
        assertDigest(owner, project.id, take, take.inputDigest)
        const saved = store.setTake(owner, project.id, id, { baseDirector, request, status: args.mode === 'propose' ? 'proposed' : 'submitting' })
        store.retainUploads(owner, saved)
        return args.mode === 'propose' ? saved : await submit(owner, project.id, id)
      } catch (error) {
        error.outcome = safeTake(store.setTake(owner, project.id, id, { status: 'failed', error: error.message }))
        throw error
      }
    })()
    preparing.set(flight, { id, promise })
    try { return view(await promise) } finally { preparing.delete(flight) }
  }
  function finishExtraction(owner, projectId, id, job) {
    return conai.db.transaction(() => {
      const before = store.get(owner, projectId), next = structuredClone(before), extraction = store.extraction(owner, projectId, id)
      if (terminal(extraction.status) && !terminal(job.status)) return { ...extraction, revision: before.revision }
      const nodeIds = [...(extraction.nodeIds ?? [])], savedKeys = [...(extraction.savedKeys ?? [])], rejected = [...(extraction.rejected ?? [])], hashes = [...(extraction.resultHashes ?? [])]
      if (terminal(job.status)) for (const [index, item] of (job.saved ?? []).entries()) {
        const key = `${item.composite_hash}:${item.seconds ?? index}`
        if (savedKeys.includes(key)) continue
        const result = applyOps(next, [{ op: 'add_node', kind: 'frame', ref: { source: 'library', compositeHash: item.composite_hash }, name: `프레임 ${item.seconds ?? extraction.position ?? index}`, at: { x: 420, y: 80 + nodeIds.length * 150 } }], next.revision, randomUUID)
        if (result.rejected.length) { rejected.push(...result.rejected); continue }
        next.nodes = result.project.nodes
        const node = nodeOf(next, result.applied[0].id)
        node.data.origin = { ...extraction.source, position: extraction.position, seconds: item.seconds, frame_index: extraction.frame_index }
        nodeIds.push(node.id); savedKeys.push(key); hashes.push(item.composite_hash)
        if (extraction.target) {
          const connect = applyOps(next, [{ op: 'connect', from: node.id, to: extraction.target.cut, port: extraction.target.port, position: extraction.target.position }], next.revision, randomUUID)
          next.edges = connect.project.edges; rejected.push(...connect.rejected)
        }
      }
      if (next.nodes.length !== before.nodes.length) save(owner, before, next)
      return { ...store.setExtraction(owner, projectId, id, { jobId: job.job_id ?? extraction.jobId, status: job.status, progress: job.progress ?? null,
        error: job.error ?? (job.failed?.length ? JSON.stringify(job.failed) : null), nodeIds, savedKeys, rejected, resultHashes: hashes }), revision: store.get(owner, projectId).revision }
    })()
  }
  async function waitExtraction(owner, projectId, id, seconds, signal, cancel = false) {
    const deadline = Date.now() + seconds * 1000
    let item = store.extraction(owner, projectId, id)
    do {
      signal?.throwIfAborted()
      const job = await call('get_media_edit_job', { job_id: item.jobId, wait_seconds: cancel ? 0 : Math.max(0, (deadline - Date.now()) / 1000), cancel })
      item = finishExtraction(owner, projectId, id, job)
      signal?.throwIfAborted()
      if (terminal(item.status) || cancel) break
    } while (Date.now() < deadline)
    return item
  }
  async function extract(owner, args, signal) {
    enumArg(args.position, ['first', 'middle', 'last'], 'position'); enumArg(args.format, ['png', 'webp'], 'format'); booleanArg(args.cancel, 'cancel')
    const seconds = args.wait_seconds ?? 0
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 120) fail('wait_seconds는 호스트가 지원하는 0~120초로 써줘.')
    if (args.frame_index !== undefined && (!Number.isInteger(args.frame_index) || args.frame_index < 0)) fail('frame_index는 0 이상 정수로 써줘.')
    if (args.at_seconds !== undefined && (!Array.isArray(args.at_seconds) || !args.at_seconds.length || args.at_seconds.length > 16 || args.at_seconds.some(value => !Number.isFinite(value) || value < 0))) fail('at_seconds는 호스트가 지원하는 0 이상 시간 1~16개로 써줘.')
    const before = store.get(owner, args.project_id)
    if (args.extraction_id) {
      const item = store.extraction(owner, before.id, args.extraction_id)
      if (terminal(item.status)) return item
      if (!item.jobId) fail('조회할 추출 작업이 없어.')
      return waitExtraction(owner, before.id, item.id, seconds, signal, args.cancel === true)
    }
    expected(before, args.expected_revision)
    let hash
    if (args.take_id) {
      hash = (await refreshTake(owner, before.id, args.take_id)).resultHash
      if (!hash) fail('결과 후처리가 끝나고 해시가 준비되면 프레임을 뽑을 수 있어.')
    } else {
      const node = nodeOf(before, args.node_id)
      if (node.kind !== 'video' || node.data.ref.source !== 'library') fail('라이브러리 영상만 프레임을 뽑을 수 있어.')
      await conai.media.resolve(node.data.ref); hash = node.data.ref.compositeHash
    }
    if (args.target) {
      requiredText(args.target.port, 'target.port'); enumArg(args.target.port, ['start', 'end', 'ref_image'], 'target.port'); cutOf(before, args.target.cut)
      if (args.target.position !== undefined && (!Number.isInteger(args.target.position) || args.target.position < 0)) fail('target.position은 0 이상 정수로 써줘.')
    }
    expected(store.get(owner, before.id), args.expected_revision)
    signal?.throwIfAborted()
    const id = randomUUID()
    store.addExtraction(owner, before.id, { id, status: 'starting', jobId: null, source: { nodeId: args.node_id ?? null, takeId: args.take_id ?? null }, position: args.position, at_seconds: args.at_seconds, frame_index: args.frame_index, target: args.target ?? null })
    try {
      const job = await call('save_video_frame', { composite_hash: hash, ...(args.position ? { position: args.position } : {}), ...(args.at_seconds ? { at_seconds: args.at_seconds } : {}), ...(args.frame_index !== undefined ? { frame_index: args.frame_index } : {}), format: args.format ?? 'png', wait_seconds: 0 })
      const item = finishExtraction(owner, before.id, id, job)
      return seconds && !terminal(item.status) ? waitExtraction(owner, before.id, id, seconds, signal) : item
    } catch (error) {
      if (!signal?.aborted) store.setExtraction(owner, before.id, id, { status: 'failed', error: error.message })
      throw error
    }
  }
  function readNode(project, body) {
    const node = nodeOf(project, body.id), edges = recordPage(project.edges.filter(edge => edge.from === node.id || edge.to === node.id), { cursor: body.edge_cursor, limit: body.limit })
    const takes = recordPage(project.takes.filter(take => take.cutId === node.id).slice().reverse().map(safeTake), { cursor: body.take_cursor, limit: body.limit })
    let preview = null
    if (node.kind === 'cut') {
      const check = checkCut(project, node)
      const profile = project.profiles.find(profile => profile.id === node.data.profileId)
      preview = { mode: node.data.mode, duration: node.data.duration, seed: node.data.seed, profile: profile ? profilePublication(profile) : null, resolved: check.resolved, checks: checkSummary(check), inputDigest: null }
      if (preview.profile && !check.blocked) {
        preview.inputDigest = inputFor(project, { cut_id: node.id }).inputDigest
        preview.review = { cut_id: node.id, input_digest: preview.inputDigest, ...reviewFields(node, preview.profile, check.resolved) }
      }
    }
    return { revision: project.revision, node, preview, edges: edges.items, takes: takes.items, nextEdgeCursor: edges.nextCursor, nextTakeCursor: takes.nextCursor, totalEdges: edges.total, totalTakes: takes.total }
  }
  async function dispatch(body, account, actor = 'assistant', { signal } = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail('요청 객체가 필요해.')
    actor = actor === 'human' && body.origin !== 'assistant' ? 'human' : 'assistant'
    const owner = ownerOf(account), action = body.op
    if (action === 'list_projects') {
      const projects = store.list(owner, body.offset ?? 0)
      return { projects, nextOffset: projects.length === 40 ? (body.offset ?? 0) + 40 : null }
    }
    if (action === 'create_project') return store.create(owner, body.name)
    requiredText(body.project_id, 'project_id')
    if (action === 'run_cut') return run(owner, body, actor, signal)
    if (action === 'propose_run_cut') return run(owner, { ...body, mode: 'now' }, actor, signal, true)
    if (action === 'extract_frame') return extract(owner, body, signal)
    const project = store.get(owner, body.project_id)
    if (action === 'read_canvas') return body.full && actor === 'human' ? project : excerpt(project, body)
    if (action === 'read_node') return readNode(project, body)
    if (action === 'get_take') return { ...safeTake(await refreshTake(owner, project.id, body.take_id)), revision: project.revision }
    if (action === 'refresh') {
      for (const take of project.takes.filter(take => take.jobId && !take.resultHash && !['failed', 'cancelled'].includes(take.status))) await refreshTake(owner, project.id, take.id)
      return store.get(owner, project.id)
    }
    if (action === 'check') {
      const result = await inspect(project, body.cut_id)
      store.setChecks(owner, project.id, result.assets)
      return { assets: result.assets, cuts: result.cuts, revision: store.get(owner, project.id).revision }
    }
    expected(project, body.expected_revision)
    if (action === 'save_profile') {
      const profile = validateProfile(body.profile, await call('get_workflow_details', { workflow_id: body.profile?.workflowId }))
      profile.id ??= randomUUID()
      const next = structuredClone(project), index = next.profiles.findIndex(item => item.id === profile.id)
      if (index < 0) next.profiles.push(profile)
      else next.profiles[index] = profile
      return save(owner, project, next)
    }
    if (action === 'accept_fingerprint') {
      const node = nodeOf(project, body.id), next = structuredClone(project)
      const resolved = node.kind === 'bundle' ? await bundleState(node, project, new Map()) : await conai.media.resolve(node.data.ref)
      nodeOf(next, node.id).data.fingerprint = resolved.fingerprint
      if (resolved.members) nodeOf(next, node.id).data.members = resolved.members
      save(owner, project, next); store.setChecks(owner, project.id, { [node.id]: { status: 'ready', fingerprint: resolved.fingerprint, ...(resolved.members ? { members: resolved.members } : {}) } })
      return store.get(owner, project.id)
    }
    if (action === 'undo') {
      const log = store.lastLog(project.id)
      if (!log) fail('되돌릴 어시스턴트 배치가 없어.')
      return store.undo(owner, project, log)
    }
    if (action === 'apply_ops' || action === 'human_review') {
      if (action === 'human_review' && actor !== 'human') fail('검수는 사람이 직접 해줘.', 403)
      const ops = structuredClone(typeof body.ops === 'string' ? JSON.parse(body.ops) : body.ops)
      if (!Array.isArray(ops)) fail('ops 배열이 필요해.')
      const metadata = new Map(), cache = new Map()
      for (const op of ops) {
        if (!op || typeof op !== 'object') continue
        const type = op.op ?? op.type
        if (type === 'add_node' && op.kind === 'cut' && op.seed === undefined) op.seed = randomInt(0, 2147483648)
        if (type?.startsWith('import_') || type === 'add_node' && op.kind !== 'cut') {
          const kind = type === 'add_node' ? op.kind : type === 'import_launch' ? 'image' : type.slice(7)
          try {
            const ref = normalizeRef(kind, op.ref)
            if (kind === 'bundle') {
              const node = { data: { ref } }, record = await bundleRecord(node, cache)
              if (record) metadata.set(op, { fingerprint: bundleFingerprint(node, record), members: record.members.map(member => ({ kind: member.kind })) })
              continue
            }
            const resolved = await cached(cache, `media:${canonical(ref)}`, () => conai.media.resolve(ref))
            if (!resolved.mimeType.startsWith(`${kind === 'frame' ? 'image' : kind}/`)) fail('가져올 소재 종류와 파일 형식이 달라.')
            const info = ref.source === 'library' ? await cached(cache, `info:${canonical(ref)}`, () => call('get_image_metadata', { composite_hash: ref.compositeHash })) : ref.source === 'audio' ? await cached(cache, `info:${canonical(ref)}`, () => call('get_audio_candidate', { candidate_id: ref.candidateId })) : {}
            metadata.set(op, { fingerprint: resolved.fingerprint, name: resolved.name, duration: info.duration_seconds ?? info.duration })
          } catch (error) { metadata.set(op, { error: error.message }) }
        }
      }
      const allowed = ops.filter(op => !metadata.get(op)?.error)
      const result = applyOps(project, allowed, body.expected_revision, randomUUID, action === 'human_review' ? 'human' : 'assistant')
      for (const applied of result.applied) {
        const original = allowed.find(op => canonical(op) === canonical(applied.op)), resolved = metadata.get(original)
        if (resolved && applied.id) {
          const node = nodeOf(result.project, applied.id)
          for (const key of ['fingerprint', 'duration', 'members']) if (resolved[key] !== undefined) node.data[key] = resolved[key]
          if (resolved.name && (node.data.name === node.kind || node.data.name === node.data.ref?.compositeHash)) node.data.name = resolved.name
        }
        if ((applied.op.op ?? applied.op.type) === 'review' && project.takes.some(take => take.id === applied.id)) {
          const reviewed = result.project.takes.find(take => take.id === applied.id)
          store.setTake(owner, project.id, applied.id, { review: reviewed.review, memo: reviewed.memo })
        }
      }
      result.rejected.push(...ops.filter(op => metadata.get(op)?.error).map(op => ({ op, reason: metadata.get(op).error })))
      if (result.applied.length) store.save(owner, project, result.project, actor === 'assistant' ? { ops, actor } : null)
      return { revision: result.revision, applied: result.applied, rejected: result.rejected, tempIds: result.tempIds }
    }
    fail(`모르는 요청이야: ${action}`)
  }
  return { dispatch, store, finished({ jobId, status, history }) {
    for (const row of store.byJob(jobId)) {
      const take = store.take(row.account, row.project, row.id)
      store.setTake(row.account, row.project, row.id, { status, historyId: history?.[0]?.id ?? take.historyId })
    }
  } }
}
export function activate(conai) {
  const service = createService(conai)
  const common = { project_id: { type: 'string' }, expected_revision: { type: 'integer', minimum: 0 } }
  const definitions = [
    ['list_projects', 'read', { offset: { type: 'integer', minimum: 0 } }, []],
    ['read_canvas', 'read', { project_id: common.project_id, node_id: { type: 'string' }, cursor: { type: 'string' }, edge_cursor: { type: 'string' }, take_cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1 } }, ['project_id']],
    ['apply_ops', 'organize', { ...common, ops: { type: 'array', items: { type: 'object' } }, create_name: { type: 'string' }, undo: { type: 'boolean' }, profile: { type: 'object' } }, []],
    ['check', 'organize', { ...common, cut_id: { type: 'string' } }, ['project_id']],
    ['run_cut', 'generate', { ...common, requestId: { type: 'string' }, input_digest: { type: 'string' }, cut_id: { type: 'string' }, mode: { type: 'string', enum: ['now', 'propose'] }, profile_id: { type: 'string' }, take_id: { type: 'string' }, inputs: { type: 'string', enum: ['take', 'canvas'] }, new_seed: { type: 'boolean' }, action: { type: 'string', enum: ['retry', 'cancel'] } }, ['project_id']],
    ['get_take', 'read', { project_id: common.project_id, take_id: { type: 'string' } }, ['project_id', 'take_id']],
    ['extract_frame', 'generate', { ...common, node_id: { type: 'string' }, take_id: { type: 'string' }, extraction_id: { type: 'string' }, position: { type: 'string', enum: ['first', 'middle', 'last'] }, at_seconds: { type: 'array', items: { type: 'number', minimum: 0 } }, frame_index: { type: 'integer', minimum: 0 }, format: { type: 'string', enum: ['png', 'webp'] }, target: { type: 'object', properties: { cut: { type: 'string' }, port: { type: 'string', enum: ['start', 'end', 'ref_image'] }, position: { type: 'integer', minimum: 0 } }, required: ['cut', 'port'] }, cancel: { type: 'boolean' }, wait_seconds: { type: 'number', minimum: 0, maximum: 120 } }, ['project_id']],
  ]
  for (const [name, scope, properties, required] of definitions) conai.tools.register({
    name, scope,
    description: {
      list_projects: 'List account-owned video canvas projects, with nextOffset.',
      read_canvas: 'Read paged canvas nodes/edges; node_id reads detail, paged edges/takes, and preview.inputDigest. Follow nextCursor/nextEdgeCursor/nextTakeCursor.',
      apply_ops: 'Batch canvas ops with expected_revision; tempIds and applied/rejected are returned. create_name creates a project; profile saves a validated profile; undo restores the latest assistant batch. Human reviews cannot be supplied by an assistant.',
      check: 'Check live source fingerprints, permissions, typed slots, limits and prompt names. Missing/permission/required-slot/limit/token errors block; changed files and unused references warn.',
      run_cut: 'New runs need requestId and expected_revision. mode propose needs input_digest from read_canvas(node_id). Proposals are approved/discarded only by a human on the canvas. take_id + inputs take|canvas reruns with profile_id; action retry/cancel manages a take. Arguments are validated by the plugin.',
      get_take: 'Refresh a take, resolving actual-or-original result hash only after postprocessing is ready.',
      extract_frame: 'Start a library video frame extraction or query extraction_id; wait_seconds (0..120) waits with cancellation/progress, target connects start/end/ref_image. Native tool errors are preserved.',
    }[name],
    inputSchema: { type: 'object', properties, required },
    handler: async (args, context) => {
      try {
        return await service.dispatch({ ...args, op: name === 'read_canvas' && args.node_id ? 'read_node' : name === 'apply_ops' && args.create_name ? 'create_project' : name === 'apply_ops' && args.profile ? 'save_profile' : name === 'apply_ops' && args.undo ? 'undo' : name, name: args.create_name, id: args.node_id }, context.account, 'assistant', { signal: context.signal })
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: error.message }, ...(error.outcome ? [{ type: 'text', text: JSON.stringify(error.outcome) }] : [])] }
      }
    },
  })
  conai.onRequest(async ({ body, account }, context = {}) => {
    try { return await service.dispatch(body, account, 'human', { signal: context.signal }) }
    catch (error) { return { ok: false, status: error.status ?? 400, error: error.message, ...(error.outcome ? { outcome: error.outcome } : {}) } }
  })
  conai.hooks.on('generation.finished', event => service.finished(event))
  return service
}
