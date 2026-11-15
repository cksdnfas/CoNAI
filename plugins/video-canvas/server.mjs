import { randomUUID, randomInt, createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { applyOps, buildDirector, canonical, checkCut, completeProfile, cutEdges, cutOf, duplicateCanvas, expected, fail, freePosition, generationRequest, nodeOf, normalizeRef, profilePublication, representativeTake, resultHash, sequenceOf, slotMode, validateProfile, workflowOption } from './domain.mjs'
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
const waitArg = value => {
  const seconds = value ?? 0
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 120) fail('wait_seconds는 호스트가 지원하는 0~120초로 써줘.')
  return seconds
}
const unfinished = take => take.jobId && !take.resultHash && !['failed', 'cancelled'].includes(take.status)
// A take nothing more will happen to: a result, an end without one, or a proposal waiting for a person.
const settled = take => Boolean(take.resultHash) || ['failed', 'cancelled', 'discarded', 'proposed'].includes(take.status) || take.status === 'completed' && Boolean(take.jobId) && (!take.historyId || take.postprocessFailed === true)
const INTERRUPTED = '이어 생성 작업이 중단됐어. 다시 실행하면 결과가 있는 컷은 건너뛰어.'
const POSTPROCESS_FAILED = '결과 후처리가 실패했어.'
// Media-edit jobs fill only total/processed (and the label); the item counters stay 0 even after a job saved its results.
function mediaProgress(job) {
  if (!job.progress || typeof job.progress !== 'object') return job.progress ?? null
  const { succeeded, failed, skipped, ...filled } = job.progress
  return filled
}
const CHAIN_INPUT_CHANGED = '이어 생성 준비 중에 컷이 바뀌어서 바뀐 입력으로 다시 생성했어.'
// Resolves after `ms`, or earlier when a listener in `wake` is called; rejects when the signal aborts.
const pause = (ms, signal, wake) => new Promise((resolve, reject) => {
  const cleanup = () => { clearTimeout(timer); wake?.delete(resume); signal?.removeEventListener('abort', abort) }
  const resume = () => { cleanup(); resolve() }
  const abort = () => { cleanup(); reject(signal.reason) }
  const timer = setTimeout(resume, Math.max(0, ms))
  wake?.add(resume)
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
})
// A background step re-reads the revision after a concurrent edit; other failures end the step.
const retryStale = async fn => {
  for (;;) {
    try { return await fn() } catch (error) { if (error.status !== 409) throw error }
  }
}
const POSITION_NAMES = { first: '첫 프레임', middle: '가운데 프레임', last: '마지막 프레임' }
function frameName(extraction, item, index) {
  // Extractions started before frames were named after their source keep the old label.
  if (!extraction.sourceName) return `프레임 ${item.seconds ?? extraction.position ?? index}`
  const where = POSITION_NAMES[extraction.position] ?? (extraction.frame_index !== undefined ? `${extraction.frame_index}번 프레임`
    : `${Number(Number(item.seconds ?? extraction.at_seconds?.[index] ?? 0).toFixed(2))}초 프레임`)
  return `${extraction.sourceName} ${where}`
}
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
    let historyId = take.historyId, hash = null, rows = 0, failedRows = 0
    for (const id of job.history_ids ?? (take.historyId ? [take.historyId] : [])) {
      const record = (await json(`/api/generation-history/${id}`)).record
      rows++; if (record?.postprocess_status === 'failed') failedRows++
      historyId = id; hash = resultHash(record)
      if (hash) break
    }
    // Every output failed postprocessing: no result hash will come, so waits and chains stop on it.
    const postprocessFailed = job.status === 'completed' && rows > 0 && failedRows === rows
    const marker = postprocessFailed ? { postprocessFailed, error: POSTPROCESS_FAILED } : take.postprocessFailed ? { postprocessFailed, error: null } : {}
    return store.setTake(owner, projectId, takeId, { status: job.status, historyId: historyId ?? null, resultHash: hash, ...marker, ...failure(job, take) })
  }
  // The generation job's own failure text; a failed take always carries one, so refresh stops asking.
  function failure(job, take) {
    if (job.status === 'failed') return { error: job.failure_message || job.failure_code || take.error || '생성 작업이 실패했어.' }
    if (job.status === 'cancelled') return { error: job.failure_message || take.error || null }
    return {}
  }
  // The host wait returns when the job ends; preparation and postprocessing are polled between reads.
  async function waitTake(owner, projectId, takeId, seconds, signal) {
    const deadline = Date.now() + seconds * 1000
    let take = await refreshTake(owner, projectId, takeId)
    while (!settled(take) && Date.now() < deadline) {
      signal?.throwIfAborted()
      const remaining = (deadline - Date.now()) / 1000
      if (take.jobId && !terminal(take.status) && remaining >= 5) await call('wait_generation_job', { job_id: take.jobId, timeout_seconds: Math.min(180, Math.floor(remaining)) })
      else await pause(Math.min(2000, remaining * 1000), signal)
      signal?.throwIfAborted()
      take = await refreshTake(owner, projectId, takeId)
    }
    return take
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
  async function releaseUploads(owner, takeId) {
    const cleanupErrors = []
    for (const upload of store.releaseCandidates(owner, takeId)) {
      try { await json(`/api/workflow-input-assets/${upload.ref.id}`, { method: 'DELETE' }); store.removeUpload(owner, upload.keys) }
      catch (error) { cleanupErrors.push(error.message) }
    }
    return cleanupErrors
  }
  async function releaseDiscarded(owner, projectId, takeId) {
    return store.setTake(owner, projectId, takeId, { cleanupErrors: await releaseUploads(owner, takeId) })
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
    store.useProfile(owner, project.id, profile.id)
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
      let modeChange = extraction.modeChange ?? null
      // A cancelled chain's frame stays in the library only: it never becomes a node, a connection or a mode switch.
      const chain = extraction.chainId ? before.chains.find(item => item.id === extraction.chainId) : null
      const cancelled = Boolean(chain?.cancelRequested || chain?.status === 'cancelled')
      let changed = false
      if (terminal(job.status)) for (const [index, item] of (job.saved ?? []).entries()) {
        const key = `${item.composite_hash}:${item.seconds ?? index}`
        if (savedKeys.includes(key)) continue
        if (cancelled) { savedKeys.push(key); hashes.push(item.composite_hash); continue }
        const target = extraction.target, at = freePosition(next, 'frame', target && next.nodes.some(node => node.id === target.cut) ? target.cut : null)
        const result = applyOps(next, [{ op: 'add_node', kind: 'frame', ref: { source: 'library', compositeHash: item.composite_hash }, name: frameName(extraction, item, index), at }], next.revision, randomUUID)
        if (result.rejected.length) { rejected.push(...result.rejected); continue }
        next.nodes = result.project.nodes
        const node = nodeOf(next, result.applied[0].id)
        node.data.origin = { ...extraction.source, position: extraction.position, seconds: item.seconds, frame_index: extraction.frame_index }
        nodeIds.push(node.id); savedKeys.push(key); hashes.push(item.composite_hash); changed = true
        if (target) {
          // A replacing target (the chain run, a page replace) drops the slot's current image, but only when the new one connects.
          const replaced = target.replace ? next.edges.filter(edge => edge.to === target.cut && edge.port === target.port) : []
          const connect = applyOps(next, [...replaced.map(edge => ({ op: 'disconnect', id: edge.id })), { op: 'connect', from: node.id, to: target.cut, port: target.port, position: target.position }], next.revision, randomUUID)
          const connected = connect.applied.some(item => item.op.op === 'connect')
          rejected.push(...connect.rejected)
          if (connected) {
            next.edges = connect.project.edges
            // The replaced frame goes with its link when it was extracted, is used nowhere else and the person has not reviewed it.
            const stale = new Set(replaced.map(edge => nodeOf(next, edge.from)).filter(old => old.kind === 'frame' && old.data.origin && (old.review ?? 'pending') === 'pending'
              && !next.edges.some(edge => edge.from === old.id || edge.to === old.id)).map(old => old.id))
            if (stale.size) next.nodes = next.nodes.filter(old => !stale.has(old.id))
            // A start/end image the cut's mode ignores switches the mode to one that uses it, in the same edit.
            const cut = cutOf(next, target.cut), mode = slotMode(cut.data.mode, target.port)
            if (mode) { modeChange = { cutId: cut.id, from: cut.data.mode, to: mode }; cut.data.mode = mode }
          }
        }
      }
      if (changed) save(owner, before, next)
      return { ...store.setExtraction(owner, projectId, id, { jobId: job.job_id ?? extraction.jobId, status: job.status, progress: mediaProgress(job),
        error: job.error ?? (job.failed?.length ? JSON.stringify(job.failed) : null), nodeIds, savedKeys, rejected, resultHashes: hashes, modeChange }), revision: store.get(owner, projectId).revision }
    })()
  }
  // Media-edit jobs keep their state outside the canvas revision; aborting stops only this wait.
  async function waitMedia(item, finish, seconds, signal, cancel = false) {
    const deadline = Date.now() + seconds * 1000
    do {
      signal?.throwIfAborted()
      const job = await call('get_media_edit_job', { job_id: item.jobId, wait_seconds: cancel ? 0 : Math.max(0, (deadline - Date.now()) / 1000), cancel })
      item = finish(job)
      signal?.throwIfAborted()
      if (terminal(item.status) || cancel) break
    } while (Date.now() < deadline)
    return item
  }
  const waitExtraction = (owner, projectId, id, seconds, signal, cancel) =>
    waitMedia(store.extraction(owner, projectId, id), job => finishExtraction(owner, projectId, id, job), seconds, signal, cancel)
  function finishExport(owner, projectId, id, job) {
    const item = store.exportJob(owner, projectId, id)
    if (terminal(item.status) && !terminal(job.status)) return item
    return store.setExport(owner, projectId, id, { jobId: job.job_id ?? item.jobId, status: job.status, progress: mediaProgress(job),
      resultHash: job.saved?.[0]?.composite_hash ?? item.resultHash, error: job.error ?? (job.failed?.length ? JSON.stringify(job.failed) : null) })
  }
  const waitExport = (owner, projectId, id, seconds, signal, cancel) =>
    waitMedia(store.exportJob(owner, projectId, id), job => finishExport(owner, projectId, id, job), seconds, signal, cancel)
  async function joinVideos(hashes) {
    try { return await call('join_videos', { composite_hashes: hashes, wait_seconds: 0 }) }
    catch (error) {
      if (!(await conai.tools.list()).some(tool => tool.name === 'join_videos')) fail('이 앱 버전에는 영상 이어붙이기(join_videos)가 없어. 앱을 업데이트한 뒤 다시 내보내줘.', 501)
      throw error
    }
  }
  // The given cut IDs, or the whole sequence, in order.
  function cutList(project, ids, empty) {
    if (ids !== undefined && (!Array.isArray(ids) || new Set(ids).size !== ids.length)) fail('cut_ids는 겹치지 않는 컷 ID 배열로 줘.')
    const cutIds = ids ?? sequenceOf(project)
    if (!cutIds.length) fail(empty)
    for (const id of cutIds) cutOf(project, id)
    return cutIds
  }
  // ---- chain runs: a plugin task generating the cuts in order, each starting from the previous cut's last frame ----
  // chainsHere: chains whose task runs in this process, with the abort a cancel request triggers at once.
  const chainWake = new Map(), chainsHere = new Map()
  function updateChain(owner, projectId, id, patch) {
    const chain = store.setChain(owner, projectId, id, patch)
    for (const resume of [...(chainWake.get(id) ?? [])]) resume()
    if (terminal(chain.status)) chainWake.delete(id)
    return chain
  }
  function setStep(owner, projectId, id, index, patch) {
    const chain = store.chain(owner, projectId, id)
    return updateChain(owner, projectId, id, { steps: chain.steps.map((step, at) => at === index ? { ...step, ...patch } : step) })
  }
  function finishChain(owner, projectId, id, status, error = null, stepError = error) {
    const chain = store.chain(owner, projectId, id)
    if (terminal(chain.status)) return chain
    const steps = chain.steps.map(step => status !== 'completed' && step.cutId === chain.current && !['completed', 'skipped'].includes(step.status)
      ? { ...step, status: status === 'cancelled' ? 'cancelled' : 'failed', error: stepError } : step)
    return updateChain(owner, projectId, id, { status, error, steps, ...(status === 'completed' ? { current: null } : {}) })
  }
  // A chain whose task ended without finishing it (an app restart, a package update) is closed on the next read.
  async function settleChain(owner, projectId, id) {
    const chain = store.chain(owner, projectId, id)
    if (terminal(chain.status) || !chain.jobId || chainsHere.has(id)) return chain
    let job
    try { job = await conai.jobs.get(chain.jobId) } catch (error) { job = { status: 'failed', error: error.message } }
    if (!terminal(job.status)) return chain
    return finishChain(owner, projectId, id, job.status === 'cancelled' ? 'cancelled' : 'failed', job.error ?? INTERRUPTED)
  }
  async function waitChain(owner, projectId, id, seconds, signal) {
    const deadline = Date.now() + seconds * 1000
    let chain = await settleChain(owner, projectId, id)
    while (!terminal(chain.status) && Date.now() < deadline) {
      if (!chainWake.has(id)) chainWake.set(id, new Set())
      await pause(deadline - Date.now(), signal, chainWake.get(id))
      chain = store.chain(owner, projectId, id)
    }
    return chain
  }
  async function startChain(owner, args, signal) {
    booleanArg(args.regenerate, 'regenerate'); booleanArg(args.keep_start, 'keep_start')
    const seconds = waitArg(args.wait_seconds)
    let project = store.get(owner, args.project_id), revision = args.expected_revision
    expected(project, revision)
    const cutIds = cutList(project, args.cut_ids, '생성할 컷이 없어.')
    let runs = cutIds.map(id => cutOf(project, id)).filter(cut => args.regenerate || !representativeTake(project, cut)?.resultHash)
    const auto = await ensureProfile(owner, project.id, runs.map(cut => cut.id), revision)
    if (auto) {
      project = store.get(owner, project.id); revision = auto.revision
      runs = runs.map(cut => cutOf(project, cut.id))
    }
    const unprofiled = runs.filter(cut => !project.profiles.some(profile => profile.id === cut.data.profileId)).map(cut => cut.data.name)
    if (unprofiled.length) fail(`생성 프로필이 없는 컷이 있어: ${unprofiled.join(', ')}. 프로필을 고른 뒤 다시 실행해줘.`)
    for (const chain of project.chains.filter(chain => !terminal(chain.status))) await settleChain(owner, project.id, chain.id)
    project = store.get(owner, project.id)
    expected(project, revision)
    const active = project.chains.find(chain => !terminal(chain.status))
    if (active) fail(`409: 이 프로젝트의 이어 생성이 이미 진행 중이야. chain_id ${active.id}로 기다리거나 취소해줘.`, 409)
    const id = randomUUID()
    store.addChain(owner, project.id, { id, status: 'queued', jobId: null, cutIds, current: null, regenerate: args.regenerate === true, keepStart: args.keep_start === true, error: null,
      steps: cutIds.map(cutId => ({ cutId, status: 'pending', takeId: null, extractionId: null, error: null })) })
    let job
    try { job = await conai.jobs.start({ requestId: `video-canvas-chain:${id}`, data: { project_id: project.id, chain_id: id } }) } catch (error) {
      store.removeChain(owner, project.id, id)
      if (error.status === 429) fail(`앱에서 다른 영상 캔버스 이어 생성이 실행 중이야. 끝나거나 취소된 뒤 다시 실행해줘. (${error.message})`, 429)
      throw error
    }
    updateChain(owner, project.id, id, { jobId: job.jobId })
    const chain = seconds ? await waitChain(owner, project.id, id, seconds, signal) : store.chain(owner, project.id, id)
    return auto ? { ...chain, autoProfile: auto.profile } : chain
  }
  async function cancelChain(owner, projectId, id) {
    const chain = updateChain(owner, projectId, id, { cancelRequested: true })
    // Synchronously, so the task cannot pass its last abort check and submit while this request awaits below.
    chainsHere.get(id)?.abort(new Error('cancelled'))
    for (const extraction of store.get(owner, projectId).extractions.filter(item => item.chainId === id && item.jobId && !terminal(item.status))) {
      // A failed extraction cancel must not keep the generation and the task from being cancelled below.
      await waitExtraction(owner, projectId, extraction.id, 0, undefined, true).catch(error => conai.warn(`chain extraction cancel failed: ${error.message}`))
    }
    // The task's own calls end with its cancellation, so the running generation is cancelled from this request.
    const step = chain.steps.find(step => step.cutId === chain.current)
    // A generation the person started and the chain only waited on stays theirs.
    let take = step?.adopted ? null : step?.takeId ? store.take(owner, projectId, step.takeId) : step?.requestId ? store.requestTake(owner, projectId, step.requestId) : null
    // A submit in flight can still create a host job; wait for it so that job is cancelled too.
    if (take && !take.jobId && submitting.has(take.id)) {
      await submitting.get(take.id).catch(() => {})
      take = store.take(owner, projectId, take.id)
    }
    if (take?.jobId && !terminal(take.status)) store.setTake(owner, projectId, take.id, { status: (await call('cancel_generation_job', { job_id: take.jobId })).status ?? 'cancelled' })
    if (chain.jobId) await conai.jobs.cancel(chain.jobId)
    return finishChain(owner, projectId, id, 'cancelled')
  }
  async function chainStep(owner, projectId, id, index, signal) {
    const chain = store.chain(owner, projectId, id), cutId = chain.cutIds[index]
    updateChain(owner, projectId, id, { current: cutId })
    // A take that finished since its last read counts as the cut's ready result.
    for (const take of store.get(owner, projectId).takes.filter(take => take.cutId === cutId && unfinished(take))) await refreshTake(owner, projectId, take.id)
    const project = store.get(owner, projectId), cut = cutOf(project, cutId), ready = representativeTake(project, cut)
    if (!chain.regenerate && ready?.resultHash) return setStep(owner, projectId, id, index, { status: 'skipped', takeId: ready.id })
    // A generation already queued or running for this cut (a manual run_cut) is waited on instead of submitting another.
    const running = chain.regenerate ? null : project.takes.filter(take => take.cutId === cutId && take.jobId && !settled(take)).at(-1)
    if (running) {
      setStep(owner, projectId, id, index, { status: 'generating', takeId: running.id, adopted: true })
      return finishStep(owner, projectId, id, index, running, signal)
    }
    if (index > 0) {
      if (chain.keepStart && project.edges.some(edge => edge.to === cutId && edge.port === 'start')) {
        const before = store.get(owner, projectId), next = structuredClone(before), mode = slotMode(cutOf(before, cutId).data.mode, 'start')
        if (mode) { cutOf(next, cutId).data.mode = mode; save(owner, before, next) }
      } else {
        setStep(owner, projectId, id, index, { status: 'extracting' })
        const previous = store.chain(owner, projectId, id).steps[index - 1].takeId
        let extraction = await retryStale(() => extract(owner, { project_id: projectId, expected_revision: store.get(owner, projectId).revision, take_id: previous, position: 'last', target: { cut: cutId, port: 'start' }, wait_seconds: 120 }, signal, { replace: true, chainId: id }))
        setStep(owner, projectId, id, index, { extractionId: extraction.id })
        while (!terminal(extraction.status)) extraction = await waitExtraction(owner, projectId, extraction.id, 120, signal)
        if (extraction.status !== 'completed' || !extraction.nodeIds.length) fail(extraction.error ?? '앞 컷의 마지막 프레임을 뽑지 못했어.')
        if (extraction.rejected.length) fail(extraction.rejected.map(item => item.reason).join(' / '))
      }
    }
    // Each attempt gets its own request ID: a retry after a concurrent cut edit must not get back the take that edit failed.
    let take
    for (let attempt = 0; !take; attempt++) {
      const requestId = `chain:${id}:${cutId}:${attempt}`
      setStep(owner, projectId, id, index, { status: 'generating', requestId })
      try { take = await run(owner, { project_id: projectId, cut_id: cutId, requestId, expected_revision: store.get(owner, projectId).revision }, 'assistant', signal) } catch (error) {
        if (error.status !== 409) throw error
        const stale = store.requestTake(owner, projectId, requestId)
        if (stale?.status === 'failed') store.setTake(owner, projectId, stale.id, { error: CHAIN_INPUT_CHANGED })
      }
    }
    setStep(owner, projectId, id, index, { takeId: take.id })
    return finishStep(owner, projectId, id, index, take, signal)
  }
  async function finishStep(owner, projectId, id, index, take, signal) {
    while (!settled(take)) take = await waitTake(owner, projectId, take.id, 120, signal)
    if (!take.resultHash) fail(take.error ?? (take.status === 'completed' ? '생성은 끝났지만 결과 영상이 없어.' : `생성이 ${take.status} 상태로 끝났어.`))
    // Export follows the cut's pick; it must name the take the next cut continues from.
    await retryStale(() => {
      const before = store.get(owner, projectId), pick = cutOf(before, take.cutId).data.pickTakeId
      if (!pick || pick === take.id) return
      const next = structuredClone(before)
      cutOf(next, take.cutId).data.pickTakeId = take.id
      save(owner, before, next)
    })
    return setStep(owner, projectId, id, index, { status: 'completed' })
  }
  // The plugin task body: runs as the account that started the chain, until the last cut or the first failure.
  async function runChain(data, { account, signal }) {
    const owner = ownerOf(account), projectId = data.project_id, id = data.chain_id, local = new AbortController(), steps = AbortSignal.any([signal, local.signal])
    chainsHere.set(id, local)
    try {
      if (terminal(store.chain(owner, projectId, id).status)) return { id }
      updateChain(owner, projectId, id, { status: 'running' })
      for (let index = 0; index < store.chain(owner, projectId, id).cutIds.length; index++) {
        steps.throwIfAborted()
        await chainStep(owner, projectId, id, index, steps)
      }
      return { id, status: finishChain(owner, projectId, id, 'completed').status }
    } catch (error) {
      const chain = store.chain(owner, projectId, id)
      if (chain.cancelRequested) return { id, status: finishChain(owner, projectId, id, 'cancelled').status }
      if (signal.aborted) return { id, status: finishChain(owner, projectId, id, 'failed', INTERRUPTED).status }
      const name = store.get(owner, projectId).nodes.find(node => node.id === chain.current)?.data.name ?? '이어 생성'
      return { id, status: finishChain(owner, projectId, id, 'failed', `${name}: ${error.message}`, error.message).status }
    } finally { chainsHere.delete(id) }
  }
  async function chainRequest(owner, args, signal) {
    booleanArg(args.cancel, 'cancel')
    if (!args.chain_id) return startChain(owner, args, signal)
    const seconds = waitArg(args.wait_seconds), chain = store.chain(owner, args.project_id, args.chain_id)
    if (args.cancel === true && !terminal(chain.status)) return cancelChain(owner, args.project_id, chain.id)
    return waitChain(owner, args.project_id, chain.id, seconds, signal)
  }
  async function exportSequence(owner, args, signal) {
    booleanArg(args.cancel, 'cancel')
    const seconds = waitArg(args.wait_seconds)
    if (args.export_id) {
      const item = store.exportJob(owner, args.project_id, args.export_id)
      if (terminal(item.status)) return item
      if (!item.jobId) fail('조회할 내보내기 작업이 없어.')
      return waitExport(owner, args.project_id, item.id, seconds, signal, args.cancel === true)
    }
    let project = store.get(owner, args.project_id)
    expected(project, args.expected_revision)
    const cutIds = cutList(project, args.cut_ids, '내보낼 컷이 없어.')
    for (const take of project.takes.filter(take => cutIds.includes(take.cutId) && unfinished(take))) await refreshTake(owner, project.id, take.id)
    project = store.get(owner, project.id)
    const takes = cutIds.map(id => representativeTake(project, cutOf(project, id)))
    const missing = cutIds.filter((id, index) => !takes[index]?.resultHash).map(id => cutOf(project, id).data.name)
    if (missing.length) fail(`결과 영상이 준비되지 않은 컷이 있어: ${missing.join(', ')}. 생성이 끝나거나 대표 take를 고른 뒤 다시 내보내줘.`)
    // join_videos itself takes two or more videos; one cut's take is already its video.
    if (cutIds.length < 2) fail('이어 붙이려면 컷이 둘 이상 필요해. 한 컷은 대표 take 결과를 그대로 쓰면 돼.')
    expected(project, args.expected_revision)
    signal?.throwIfAborted()
    const sourceHashes = takes.map(take => take.resultHash), id = randomUUID()
    store.addExport(owner, project.id, { id, status: 'starting', jobId: null, progress: null, resultHash: null, error: null, cutIds, takeIds: takes.map(take => take.id), sourceHashes })
    try {
      const item = finishExport(owner, project.id, id, await joinVideos(sourceHashes))
      return seconds && !terminal(item.status) ? waitExport(owner, project.id, id, seconds, signal) : item
    } catch (error) {
      if (!signal?.aborted) store.setExport(owner, project.id, id, { status: 'failed', error: error.message })
      throw error
    }
  }
  async function extract(owner, args, signal, { replace = false, chainId = null } = {}) {
    enumArg(args.position, ['first', 'middle', 'last'], 'position'); enumArg(args.format, ['png', 'webp'], 'format'); booleanArg(args.cancel, 'cancel')
    const seconds = waitArg(args.wait_seconds)
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
    let hash, sourceName
    if (args.take_id) {
      const take = await refreshTake(owner, before.id, args.take_id)
      hash = take.resultHash
      if (!hash) fail('결과 후처리가 끝나고 해시가 준비되면 프레임을 뽑을 수 있어.')
      sourceName = before.nodes.find(node => node.id === take.cutId)?.data.name ?? '컷'
    } else {
      const node = nodeOf(before, args.node_id)
      if (node.kind !== 'video' || node.data.ref.source !== 'library') fail('라이브러리 영상만 프레임을 뽑을 수 있어.')
      await conai.media.resolve(node.data.ref); hash = node.data.ref.compositeHash
      sourceName = node.data.name
    }
    if (args.target) {
      requiredText(args.target.port, 'target.port'); enumArg(args.target.port, ['start', 'end', 'ref_image'], 'target.port'); cutOf(before, args.target.cut)
      if (args.target.position !== undefined && (!Number.isInteger(args.target.position) || args.target.position < 0)) fail('target.position은 0 이상 정수로 써줘.')
      booleanArg(args.target.replace, 'target.replace')
    }
    expected(store.get(owner, before.id), args.expected_revision)
    signal?.throwIfAborted()
    const id = randomUUID()
    // target.replace (start/end only) lets the extraction take the slot over in its own edit, as a chain run does.
    const target = args.target ? { cut: args.target.cut, port: args.target.port, position: args.target.position, ...(replace || args.target.replace === true && args.target.port !== 'ref_image' ? { replace: true } : {}) } : null
    store.addExtraction(owner, before.id, { id, status: 'starting', jobId: null, source: { nodeId: args.node_id ?? null, takeId: args.take_id ?? null }, sourceName, position: args.position, at_seconds: args.at_seconds, frame_index: args.frame_index, target, modeChange: null, ...(chainId ? { chainId } : {}) })
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
  async function directorWorkflows() {
    const workflows = await json('/api/workflows?kind=image')
    // Only workflows that mark a Director node need their generation schema (inline choices, seed rule).
    return Promise.all(workflows.data.map(async workflow => {
      const details = workflow.marked_fields?.some(field => field.type === 'node' && field.node_editor === 'minimax_h3_director_dasiwa') ? await call('get_workflow_details', { workflow_id: workflow.id }) : undefined
      return { option: workflowOption(workflow, details), details }
    }))
  }
  async function workflowOptions() {
    const [workflows, servers] = await Promise.all([directorWorkflows(), call('list_comfyui_servers', { active_only: true })])
    const rows = servers.map(server => ({ id: server.id, name: server.name, tags: server.routing_tags ?? [] }))
    return { workflows: workflows.map(row => row.option), servers: rows, tags: [...new Set(rows.flatMap(server => server.tags))].sort() }
  }
  async function checkedProfile(input) {
    if (!Number.isInteger(input?.workflowId) || input.workflowId < 1) fail('프로필 이름과 워크플로를 골라줘.')
    const details = await call('get_workflow_details', { workflow_id: input.workflowId })
    const profile = validateProfile(completeProfile(input, details), details)
    profile.id ??= randomUUID()
    return profile
  }
  // The default profile of the only usable Director workflow; with none or several, the usable ones for the refusal.
  async function soleProfile() {
    const usable = (await directorWorkflows()).filter(row => row.option.usable)
    if (usable.length !== 1) return { profile: null, usable: usable.map(row => row.option) }
    const [{ option, details }] = usable
    return { profile: { ...validateProfile(completeProfile({ workflowId: option.workflowId }, details), details), id: randomUUID() }, usable: [option] }
  }
  const profileSummary = profile => ({ id: profile.id, label: profile.label, workflowId: profile.workflowId })
  // A run in a project without any profile gets the sole usable workflow's default profile on every cut, so each later run finds it.
  async function ensureProfile(owner, projectId, cutIds, revision) {
    const before = store.get(owner, projectId)
    // Without any profile in the project, no cut has a usable one.
    if (before.profiles.length || !cutIds.length) return null
    for (const id of cutIds) cutOf(before, id)
    expected(before, revision)
    const { profile, usable } = await soleProfile()
    if (!profile) {
      if (!usable.length) fail('생성 프로필이 없고 쓸 수 있는 Director 워크플로도 없어. workflow_options에서 이유를 확인해줘.')
      fail(`생성 프로필이 없어. 쓸 수 있는 워크플로가 여럿이라 고를 수 없어: ${usable.map(item => `${item.name}(workflowId ${item.workflowId})`).join(', ')}. 이 중 하나로 프로필을 저장해줘(profile {"workflowId": ID}).`)
    }
    const current = store.get(owner, projectId)
    expected(current, revision)
    const next = structuredClone(current)
    for (const node of next.nodes) if (node.kind === 'cut' && !next.profiles.some(item => item.id === node.data.profileId)) node.data.profileId = profile.id
    next.profiles.push(profile)
    const saved = save(owner, current, next)
    store.useProfile(owner, projectId, profile.id)
    return { profile: profileSummary(profile), revision: saved.revision }
  }
  async function dispatch(body, account, actor = 'assistant', { signal, page = false } = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail('요청 객체가 필요해.')
    actor = actor === 'human' && body.origin !== 'assistant' ? 'human' : 'assistant'
    const owner = ownerOf(account), action = body.op
    if (action === 'list_projects') {
      const offset = body.offset ?? 0
      if (body.query !== undefined && typeof body.query !== 'string') fail('query는 텍스트로 써줘.')
      booleanArg(body.archived, 'archived')
      const projects = store.list(owner, { offset, limit: body.limit, query: body.query?.trim() || undefined, sort: body.sort, archived: body.archived })
      const total = store.count(owner, { query: body.query?.trim() || undefined, archived: body.archived })
      return { projects, total, nextOffset: offset + projects.length < total ? offset + projects.length : null }
    }
    if (action === 'create_project') {
      if (body.profile === undefined) return store.create(owner, body.name)
      // One operation: the profile is validated first and created with the project, so no other revision is involved.
      const profile = await checkedProfile(body.profile)
      const created = store.create(owner, body.name, { profiles: [profile] }, profile.id)
      return { ...store.get(owner, created.id), profileId: profile.id }
    }
    if (action === 'workflow_options') return workflowOptions()
    requiredText(body.project_id, 'project_id')
    if (action === 'rename_project') return store.rename(owner, body.project_id, body.name)
    if (action === 'archive_project') {
      if (typeof body.archived !== 'boolean') fail('archived: 참/거짓 값이 필요해.')
      return store.archive(owner, body.project_id, body.archived)
    }
    if (action === 'duplicate_project') {
      const source = store.get(owner, body.project_id)
      const { profileIds, ...canvas } = duplicateCanvas(source, randomUUID)
      return store.create(owner, body.name ?? `${source.name} 사본`, canvas, profileIds.get(source.lastProfileId) ?? null)
    }
    if (action === 'delete_project') {
      // The page runs this for a person or after its commit card; headless tools cannot reach it.
      if (!page) fail('프로젝트 삭제는 캔버스 화면에서 사람이 하거나 승인 카드로 제안해줘.', 403)
      const project = store.get(owner, body.project_id)
      if (body.name !== undefined && body.name !== project.name) fail('409: 프로젝트 이름이 달라. 목록을 다시 읽고 제안해줘.', 409)
      // An upload still in flight would be linked to a take that no longer exists and never be released.
      if (project.takes.some(take => ['preparing', 'submitting'].includes(take.status))) fail('생성 준비 중인 take가 있어. 끝난 뒤 지워줘.', 409)
      for (const chain of project.chains.filter(chain => !terminal(chain.status))) {
        if (!terminal((await settleChain(owner, project.id, chain.id)).status)) fail('이어 생성이 진행 중이야. 취소한 뒤 지워줘.', 409)
      }
      store.remove(owner, project.id)
      return { id: project.id, deleted: true, cleanupErrors: await releaseUploads(owner) }
    }
    if (action === 'run_cut') {
      const seconds = waitArg(body.wait_seconds), started = Date.now()
      const auto = !body.action && body.mode !== 'propose' && body.profile_id === undefined && typeof body.cut_id === 'string' ? await ensureProfile(owner, body.project_id, [body.cut_id], body.expected_revision) : null
      const take = await run(owner, auto ? { ...body, expected_revision: auto.revision } : body, actor, signal)
      // The wait counts from the call's start, so preparation and waiting together stay within wait_seconds.
      const remaining = seconds - (Date.now() - started) / 1000
      const result = remaining <= 0 || settled(take) ? take : { ...safeTake(await waitTake(owner, body.project_id, take.id, remaining, signal)), revision: store.get(owner, body.project_id).revision }
      return auto ? { ...result, autoProfile: auto.profile } : result
    }
    if (action === 'propose_run_cut') return run(owner, { ...body, mode: 'now' }, actor, signal, true)
    if (action === 'extract_frame') return extract(owner, body, signal)
    if (action === 'export_sequence') return exportSequence(owner, body, signal)
    if (action === 'run_chain') return chainRequest(owner, body, signal)
    const project = store.get(owner, body.project_id)
    if (action === 'read_canvas') return body.full && actor === 'human' ? project : excerpt(project, body)
    if (action === 'read_node') return readNode(project, body)
    if (action === 'get_take') {
      // A cut is read as its newest take, so a run can be followed without its take ID.
      const seconds = waitArg(body.wait_seconds)
      let takeId = body.take_id
      if (!takeId) {
        requiredText(body.cut_id, 'take_id 또는 cut_id')
        cutOf(project, body.cut_id)
        takeId = project.takes.filter(take => take.cutId === body.cut_id).at(-1)?.id
        if (!takeId) fail('이 컷에는 아직 take가 없어. run_cut이나 run_chain으로 먼저 생성해줘.')
      }
      const take = await waitTake(owner, project.id, takeId, seconds, signal)
      return { ...safeTake(take), revision: store.get(owner, project.id).revision }
    }
    if (action === 'refresh') {
      for (const take of project.takes.filter(take => unfinished(take) || take.jobId && take.status === 'failed' && !take.error)) await refreshTake(owner, project.id, take.id)
      for (const chain of project.chains.filter(chain => !terminal(chain.status))) await settleChain(owner, project.id, chain.id)
      return store.get(owner, project.id)
    }
    if (action === 'check') {
      const result = await inspect(project, body.cut_id)
      store.setChecks(owner, project.id, result.assets)
      return { assets: result.assets, cuts: result.cuts, revision: store.get(owner, project.id).revision }
    }
    expected(project, body.expected_revision)
    if (action === 'save_profile') {
      const profile = await checkedProfile(body.profile)
      const next = structuredClone(project), index = next.profiles.findIndex(item => item.id === profile.id)
      if (index < 0) next.profiles.push(profile)
      else next.profiles[index] = profile
      const saved = save(owner, project, next)
      store.useProfile(owner, project.id, profile.id)
      return { ...saved, lastProfileId: profile.id }
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
      let base = project, defaultProfile = project.profiles.some(profile => profile.id === project.lastProfileId) ? project.lastProfileId : project.profiles.at(-1)?.id
      // A cut added to a project without any profile gets the sole usable workflow's default profile, saved in the same edit.
      // It is optional here: without workflow discovery (no workflows.view, a failing workflow) the cut is still added and a run reports why.
      const autoProfile = !project.profiles.length && ops.some(op => op && (op.op ?? op.type) === 'add_node' && op.kind === 'cut' && op.profileId === undefined)
        ? (await soleProfile().catch(error => { conai.warn(`auto profile skipped: ${error.message}`); return { profile: null } })).profile : null
      if (autoProfile) { base = structuredClone(project); base.profiles.push(autoProfile); defaultProfile = autoProfile.id }
      for (const op of ops) {
        if (!op || typeof op !== 'object') continue
        const type = op.op ?? op.type
        if (type === 'add_node' && op.kind === 'cut' && op.seed === undefined) op.seed = randomInt(0, 2147483648)
        if (type === 'add_node' && op.kind === 'cut' && op.profileId === undefined && defaultProfile) op.profileId = defaultProfile
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
      const result = applyOps(base, allowed, body.expected_revision, randomUUID, action === 'human_review' ? 'human' : 'assistant')
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
      const chosen = result.applied.map(item => item.op).filter(op => (op.op ?? op.type) === 'set' && typeof op.fields?.profileId === 'string').at(-1)
      if (chosen) store.useProfile(owner, project.id, chosen.fields.profileId)
      else if (autoProfile && result.applied.length) store.useProfile(owner, project.id, autoProfile.id)
      return { revision: result.revision, applied: result.applied, rejected: result.rejected, tempIds: result.tempIds, ...(autoProfile && result.applied.length ? { autoProfile: profileSummary(autoProfile) } : {}) }
    }
    fail(`모르는 요청이야: ${action}`)
  }
  return { dispatch, store, runChain, async finished({ jobId, status, history }) {
    const rows = store.byJob(jobId)
    // The hook carries only a failure code; the job's failure text is read once for the takes it ended.
    let job = null
    if (rows.length && ['failed', 'cancelled'].includes(status)) {
      try { job = { ...await call('get_generation_job', { job_id: jobId }), status } } catch (error) { conai.warn(`generation ${jobId} failure text unavailable: ${error.message}`) }
    }
    for (const row of rows) {
      const take = store.take(row.account, row.project, row.id)
      store.setTake(row.account, row.project, row.id, { status, historyId: history?.[0]?.id ?? take.historyId, ...(job ? failure(job, take) : {}) })
    }
  } }
}
export function activate(conai) {
  const service = createService(conai)
  const common = { project_id: { type: 'string' }, expected_revision: { type: 'integer', minimum: 0 } }
  // A null cursor is the same as an omitted one (the first page).
  const cursor = { type: ['string', 'null'] }, wait = { type: 'number', minimum: 0, maximum: 120 }
  conai.onJob((data, context) => service.runChain(data, context))
  const definitions = [
    ['list_projects', 'read', { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1 }, query: { type: 'string' }, sort: { type: 'string', enum: ['updated', 'name', 'created'] }, archived: { type: 'boolean' } }, []],
    ['manage_project', 'organize', { project_id: common.project_id, action: { type: 'string', enum: ['rename', 'archive', 'duplicate'] }, name: { type: 'string' }, archived: { type: 'boolean' } }, ['project_id', 'action']],
    ['workflow_options', 'read', {}, []],
    ['read_canvas', 'read', { project_id: common.project_id, node_id: { type: 'string' }, cursor: cursor, edge_cursor: cursor, take_cursor: cursor, limit: { type: 'integer', minimum: 1 } }, ['project_id']],
    ['apply_ops', 'organize', { ...common, ops: { type: 'array', items: { type: 'object' } }, create_name: { type: 'string' }, undo: { type: 'boolean' }, profile: { type: 'object' } }, []],
    ['check', 'organize', { ...common, cut_id: { type: 'string' } }, ['project_id']],
    ['run_cut', 'generate', { ...common, requestId: { type: 'string' }, input_digest: { type: 'string' }, cut_id: { type: 'string' }, mode: { type: 'string', enum: ['now', 'propose'] }, profile_id: { type: 'string' }, take_id: { type: 'string' }, inputs: { type: 'string', enum: ['take', 'canvas'] }, new_seed: { type: 'boolean' }, action: { type: 'string', enum: ['retry', 'cancel'] }, wait_seconds: wait }, ['project_id']],
    ['get_take', 'read', { project_id: common.project_id, take_id: { type: 'string' }, cut_id: { type: 'string' }, wait_seconds: wait }, ['project_id']],
    ['run_chain', 'generate', { ...common, cut_ids: { type: 'array', items: { type: 'string' } }, regenerate: { type: 'boolean' }, keep_start: { type: 'boolean' }, chain_id: { type: 'string' }, cancel: { type: 'boolean' }, wait_seconds: wait }, ['project_id']],
    ['extract_frame', 'generate', { ...common, node_id: { type: 'string' }, take_id: { type: 'string' }, extraction_id: { type: 'string' }, position: { type: 'string', enum: ['first', 'middle', 'last'] }, at_seconds: { type: 'array', items: { type: 'number', minimum: 0 } }, frame_index: { type: 'integer', minimum: 0 }, format: { type: 'string', enum: ['png', 'webp'] }, target: { type: 'object', properties: { cut: { type: 'string' }, port: { type: 'string', enum: ['start', 'end', 'ref_image'] }, position: { type: 'integer', minimum: 0 } }, required: ['cut', 'port'] }, cancel: { type: 'boolean' }, wait_seconds: wait }, ['project_id']],
    ['export_sequence', 'generate', { ...common, cut_ids: { type: 'array', items: { type: 'string' } }, export_id: { type: 'string' }, cancel: { type: 'boolean' }, wait_seconds: wait }, ['project_id']],
  ]
  for (const [name, scope, properties, required] of definitions) conai.tools.register({
    name, scope,
    description: {
      list_projects: 'List account-owned video canvas projects (40 per page by default) with total and nextOffset. query searches names; sort updated|name|created; archived:true lists only archived projects. Rows carry cutCount and a cover composite hash.',
      manage_project: 'Rename (name), archive/unarchive (archived, default true) or duplicate (optional name) a project. Duplicates copy nodes, edges, profiles and sequence with fresh IDs, not takes/extractions/exports. Deletion is only offered on the canvas page.',
      workflow_options: 'List image workflows with usable/reason, the detected Director and seed field IDs, adjustable Director defaults (override keys) and other simple marked fields; plus active ComfyUI servers and routing tags. Save a profile with apply_ops profile {workflowId, label?, serverId|serverTag?, overrides?, inputs?}.',
      export_sequence: 'Last step of a multi-cut video, after run_chain completed. Join the cuts\' representing takes (data.pickTakeId, else the latest take with a result) into one library video in sequence order, or cut_ids order. Needs expected_revision; cuts without a ready result block it. Returns id/status/jobId/progress/resultHash; export_id reads, waits (0..120 s) or cancels.',
      read_canvas: 'Read paged canvas nodes/edges. Each cut row has newestTakeId/newestTakeStatus/newestTakeError, hasReadyResult, representingTakeId and resultHash (generation state); humanReview is only the person\'s review, not a generation state. node_id reads detail, paged edges/takes and preview.inputDigest. Pass nextCursor/nextEdgeCursor/nextTakeCursor back only while they are non-null; null or omitted means the first page.',
      apply_ops: 'Create and edit cuts. Multi-cut video: 1) create_name makes a project (expected_revision is ignored; with profile in the same call it is created with that profile and returns id, revision and profileId), 2) one ops batch adds the cuts (add_node kind cut with name, then set fields prompt/duration/mode) in story order, 3) run_chain, 4) export_sequence. Consistency: give every cut of one video the same style/subject/setting description in its prompt and describe only what changes; run_chain continues each later cut from the previous cut\'s last frame. RefMod: set the cut mode to REF2VA, then import_bundle {ref:{name}, target:{cut, port:"refmod", props:{strength, description}}} with a name from list_comfy_refmods, and mention it in the prompt as @name (it becomes <RefMod N>); it cannot be given through set fields or profile overrides. Ops need expected_revision; tempIds and applied/rejected are returned. Nodes without at are placed without overlap. sequence {order:[cutId]} reorders the export sequence (unlisted cuts follow); set {fields:{pickTakeId}} picks the take representing a cut. New cuts get the latest used profile; in a project without any profile, adding or running a cut creates the default profile of the only usable workflow (reported as autoProfile), and with several usable workflows you save one with profile. profile saves a validated profile (only workflowId is required); undo restores the latest assistant batch. Human reviews cannot be supplied by an assistant.',
      check: 'Check live source fingerprints, permissions, typed slots, limits and prompt names. Missing/permission/required-slot/limit/token errors block; changed files and unused references warn.',
      run_cut: 'The normal way to generate one cut now (several cuts of one video: run_chain). New runs need requestId and expected_revision; wait_seconds (0..120) waits for the take to finish with its result hash in the same call. mode propose is only for when the person asked to review before generating; proposals are approved only by a human. take_id + inputs take|canvas reruns with profile_id; action retry/cancel manages a take.',
      get_take: 'Read a take by take_id, or a cut\'s newest take by cut_id. wait_seconds (0..120) waits until it is finished (completed with result hash, failed or cancelled; error holds the failure text). Repeat while status is unfinished.',
      run_chain: 'Generate several cuts as one continuous video in the background (keeps running after your turn). Starts with expected_revision and optional cut_ids (default: the whole sequence); cuts with a ready result are skipped unless regenerate:true. Every later cut gets the previous cut\'s last frame in its start slot (T2VA becomes I2VA, L2VA becomes FL2VA) and is generated with its own prompt/seed/profile; keep_start:true keeps a start image a cut already has. Stops at the first failure, naming the cut and reason. One active chain per project. Returns id/status/current/steps[{cutId,status,takeId,error}]; chain_id with wait_seconds (0..120) waits, cancel:true cancels the running generation. When completed, call export_sequence.',
      extract_frame: 'Start a library video or take frame extraction or query extraction_id; wait_seconds (0..120) waits with cancellation/progress. target connects the frame to start/end/ref_image; a start/end slot the cut\'s mode ignores switches the mode (start: T2VA->I2VA, L2VA->FL2VA; end: T2VA->L2VA, I2VA->FL2VA), reported as modeChange. Frames are named after their source and position. Chained cuts: prefer run_chain.',
    }[name],
    inputSchema: { type: 'object', properties, required },
    handler: async (args, context) => {
      try {
        const body = name === 'manage_project'
          ? { ...args, op: `${args.action}_project`, archived: args.action === 'archive' ? args.archived ?? true : undefined }
          : { ...args, op: name === 'read_canvas' && args.node_id ? 'read_node' : name === 'apply_ops' && args.create_name ? 'create_project' : name === 'apply_ops' && args.profile ? 'save_profile' : name === 'apply_ops' && args.undo ? 'undo' : name, name: args.create_name, id: args.node_id }
        return await service.dispatch(body, context.account, 'assistant', { signal: context.signal })
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: error.message }, ...(error.outcome ? [{ type: 'text', text: JSON.stringify(error.outcome) }] : [])] }
      }
    },
  })
  conai.onRequest(async ({ body, account }, context = {}) => {
    try { return await service.dispatch(body, account, 'human', { signal: context.signal, page: true }) }
    catch (error) { return { ok: false, status: error.status ?? 400, error: error.message, ...(error.outcome ? { outcome: error.outcome } : {}) } }
  })
  conai.hooks.on('generation.finished', event => service.finished(event))
  return service
}
