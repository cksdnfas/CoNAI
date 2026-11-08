export const KINDS = ['image', 'video', 'audio', 'bundle', 'cut', 'frame']
export const MODES = ['T2VA', 'I2VA', 'FL2VA', 'L2VA', 'REF2VA']
export const PORTS = { start: 'image', end: 'image', ref_image: 'image', ref_video: 'video', ref_audio: 'audio', refmod: 'bundle' }
export const LIMITS = { ref_image: 9, ref_video: 3, ref_audio: 3, refmod: 8 }
const copy = value => structuredClone(value)
export function fail(message, status = 400) { throw Object.assign(new Error(message), { status }) }
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const record = value => value && typeof value === 'object' && !Array.isArray(value)
export function canonical(value) {
  const ordered = item => Array.isArray(item) ? item.map(ordered) : record(item) ? Object.fromEntries(Object.keys(item).sort().filter(key => item[key] !== undefined).map(key => [key, ordered(item[key])])) : item
  return JSON.stringify(ordered(value))
}
export function sameValue(left, right) { return canonical(left) === canonical(right) }
export function expected(project, revision) {
  if (!Number.isInteger(revision) || project.revision !== revision) fail(`409: 캔버스가 바뀌었어. 다시 읽어줘. (rev ${project.revision})`, 409)
}
export function newProject(id, name) {
  if (!String(name ?? '').trim()) fail('프로젝트 이름을 써줘.')
  return { id, name: String(name).trim(), revision: 0, nodes: [], edges: [], takes: [], profiles: [], extractions: [] }
}
export function nodeOf(project, id) {
  const node = project.nodes.find(node => node.id === id)
  if (!node) fail(`노드가 없어: ${id}`, 404)
  return node
}
export function cutOf(project, id) {
  const node = nodeOf(project, id)
  if (node.kind !== 'cut') fail('영상 컷을 골라줘.')
  return node
}
export function activePorts(mode) {
  return mode === 'REF2VA' ? ['ref_image', 'ref_video', 'ref_audio', 'refmod']
    : mode === 'I2VA' ? ['start'] : mode === 'FL2VA' ? ['start', 'end'] : mode === 'L2VA' ? ['end'] : []
}
export function cutEdges(project, cut, active = true) {
  return project.edges.filter(edge => edge.to === cut.id && (!active || activePorts(cut.data.mode).includes(edge.port)))
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
}
export function normalizeRef(kind, input) {
  const ref = input ?? {}
  if (kind === 'bundle') {
    if (!String(ref.name ?? '').trim()) fail('RefMod 이름을 골라줘.')
    return { name: String(ref.name).trim(), ...(ref.recordId ? { recordId: ref.recordId } : {}) }
  }
  if (ref.source === 'library' && /^(?:[a-f0-9]{32}|[a-f0-9]{48})$/i.test(ref.compositeHash ?? '')) return { source: 'library', compositeHash: ref.compositeHash.toLowerCase() }
  if (ref.source === 'audio' && kind === 'audio' && typeof ref.candidateId === 'string' && ref.candidateId.trim()) return { source: 'audio', candidateId: ref.candidateId.trim() }
  if (ref.source === 'files' && typeof ref.fileId === 'string' && ref.fileId) return { source: 'files', fileId: ref.fileId }
  fail('앱 소재의 안정 식별자가 필요해.')
}
function validateData(data) {
  if (!MODES.includes(data.mode)) fail('지원하지 않는 모드야.')
  if (!Number.isInteger(data.seed) || data.seed < 0 || data.seed > 2147483647) fail('시드는 0~2147483647 정수로 써줘.')
  if (!Number.isInteger(data.duration) || data.duration < 1 || data.duration > 60) fail('길이는 1~60초 정수로 써줘.')
  if (data.frame_rate !== undefined && (!Number.isFinite(data.frame_rate) || data.frame_rate < 0.1 || data.frame_rate > 240)) fail('프레임 레이트는 0.1~240으로 써줘.')
}
function renumber(project) {
  const groups = new Map()
  for (const edge of project.edges) {
    const key = `${edge.to}:${edge.port}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(edge)
  }
  for (const peers of groups.values()) peers.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)).forEach((edge, index) => { edge.position = index })
}
const editable = ['name', 'mode', 'prompt', 'soundscape', 'music', 'raw', 'seed', 'duration', 'frame_rate', 'profileId']
function applyOne(project, op, aliases, uuid, actor) {
  const id = value => aliases.get(value) ?? value
  const type = op.op ?? op.type
  if (type === 'add_node' || type.startsWith('import_')) {
    const kind = type === 'import_launch' ? 'image' : type.startsWith('import_') ? type.slice(7) : op.kind
    if (!KINDS.includes(kind)) fail('지원하지 않는 노드 종류야.')
    if (op.tempId && (aliases.has(op.tempId) || project.nodes.some(node => node.id === op.tempId))) fail('tempId가 겹쳐.')
    const at = op.at ?? { x: 40, y: 40 }
    if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) fail('좌표가 올바르지 않아.')
    const ref = kind === 'cut' ? null : normalizeRef(kind, op.ref)
    const data = { name: String(op.name ?? ref?.name ?? ref?.compositeHash ?? kind), ref }
    if (kind === 'cut') Object.assign(data, { mode: 'T2VA', prompt: '', soundscape: '', music: '', raw: '', duration: 5, seed: op.seed === undefined ? 0 : op.seed, profileId: null })
    if (kind === 'cut') validateData(data)
    const node = { id: uuid(), kind, x: at.x, y: at.y, data, review: 'pending', memo: '' }
    project.nodes.push(node)
    if (op.tempId) aliases.set(op.tempId, node.id)
    if (op.target) applyOne(project, { op: 'connect', from: node.id, to: id(op.target.cut), port: op.target.port, position: op.target.position, props: op.target.props }, aliases, uuid, actor)
    return { id: node.id, tempId: op.tempId }
  }
  if (type === 'connect') {
    const source = nodeOf(project, id(op.from)), cut = cutOf(project, id(op.to))
    const kind = source.kind === 'frame' ? 'image' : source.kind
    if (!own(PORTS, op.port) || PORTS[op.port] !== kind) fail('소재 종류와 입력 슬롯이 달라.')
    const peers = project.edges.filter(edge => edge.to === cut.id && edge.port === op.port)
    if (op.position !== undefined && (!Number.isInteger(op.position) || op.position < 0)) fail('슬롯 순서가 올바르지 않아.')
    const position = Math.min(op.position ?? peers.length, peers.length)
    if (['start', 'end'].includes(op.port) && peers.length) fail('시작·끝 슬롯에는 이미지 하나만 넣어줘.')
    const edge = { id: uuid(), from: source.id, to: cut.id, port: op.port, position, props: cleanProps(op.props ?? {}) }
    for (const peer of peers) if (peer.position >= position) peer.position++
    project.edges.push(edge)
    return { id: edge.id }
  }
  if (type === 'disconnect') {
    const index = project.edges.findIndex(edge => edge.id === id(op.id))
    if (index < 0) fail('연결선이 없어.')
    project.edges.splice(index, 1)
    renumber(project)
    return { id: id(op.id) }
  }
  if (type === 'reorder') {
    cutOf(project, id(op.cut))
    const peers = project.edges.filter(edge => edge.to === id(op.cut) && edge.port === op.port)
    const order = op.order?.map(id)
    if (!Array.isArray(order) || order.length !== peers.length || new Set(order).size !== peers.length || peers.some(edge => !order.includes(edge.id))) fail('이 슬롯의 연결선 ID를 빠짐없이 한 번씩 줘.')
    for (const edge of peers) edge.position = order.indexOf(edge.id)
    return { order }
  }
  if (type === 'set') {
    const edge = project.edges.find(edge => edge.id === id(op.id))
    if (edge) {
      if (Object.keys(op.fields ?? {}).some(key => key !== 'props')) fail('연결선은 props만 바꿀 수 있어.')
      edge.props = cleanProps({ ...edge.props, ...op.fields.props })
    } else {
      const node = nodeOf(project, id(op.id))
      for (const [key, value] of Object.entries(op.fields ?? {})) {
        if (!editable.includes(key)) fail(`바꿀 수 없는 필드야: ${key}`)
        if (node.kind !== 'cut' && key !== 'name') fail('컷 설정은 컷에서 바꿔줘.')
        if (['name', 'prompt', 'soundscape', 'music', 'raw'].includes(key) && typeof value !== 'string') fail('텍스트가 필요해.')
        node.data[key] = value
      }
      if (node.kind === 'cut') validateData(node.data)
    }
    return { id: id(op.id) }
  }
  if (type === 'move') {
    const node = nodeOf(project, id(op.id))
    if (!Number.isFinite(op.x) || !Number.isFinite(op.y)) fail('좌표가 올바르지 않아.')
    Object.assign(node, { x: op.x, y: op.y })
    return { id: node.id }
  }
  if (type === 'remove') {
    nodeOf(project, id(op.id))
    project.nodes = project.nodes.filter(node => node.id !== id(op.id))
    project.edges = project.edges.filter(edge => edge.from !== id(op.id) && edge.to !== id(op.id))
    renumber(project)
    return { id: id(op.id) }
  }
  if (type === 'review') {
    if (actor !== 'human') fail('검수는 사람이 화면에서 해줘. 어시스턴트 주장은 검수가 아니야.')
    if (!['pending', 'pass', 'redo'].includes(op.status)) fail('검수 상태가 올바르지 않아.')
    const item = project.nodes.find(node => node.id === id(op.id)) ?? project.takes.find(take => take.id === id(op.id))
    if (!item) fail('검수할 항목이 없어.')
    item.review = op.status
    item.memo = String(op.memo ?? '')
    return { id: item.id }
  }
  fail(`모르는 편집 연산이야: ${type}`)
}
export function cleanProps(props) {
  if (!record(props) || Object.keys(props).some(key => !['trim_start', 'trim_end', 'media_mode', 'audioSlot', 'strength', 'description', 'slot'].includes(key))) fail('연결 속성이 올바르지 않아.')
  if (props.media_mode !== undefined && !['video', 'audio', 'video_audio'].includes(props.media_mode)) fail('영상 소리 모드가 올바르지 않아.')
  for (const key of ['trim_start', 'trim_end', 'strength', 'audioSlot', 'slot']) if (props[key] !== undefined && !Number.isFinite(props[key])) fail(`${key}: 숫자가 필요해.`)
  if (props.description !== undefined && typeof props.description !== 'string') fail('번들 설명은 텍스트로 써줘.')
  return copy(props)
}
export function applyOps(project, ops, revision, uuid, actor = 'assistant') {
  expected(project, revision)
  if (!Array.isArray(ops)) fail('ops 배열이 필요해.')
  let next = copy(project)
  renumber(next)
  const applied = [], rejected = [], aliases = new Map()
  for (const op of ops) {
    const trial = copy(next), trialAliases = new Map(aliases)
    try {
      if (!record(op)) fail('연산 객체가 필요해.')
      const result = applyOne(trial, op, trialAliases, uuid, actor)
      next = trial
      for (const [key, value] of trialAliases) aliases.set(key, value)
      applied.push({ op: copy(op), ...result })
    } catch (error) { rejected.push({ op: copy(op), reason: error.message }) }
  }
  if (applied.length) next.revision++
  return { project: next, revision: next.revision, applied, rejected, tempIds: Object.fromEntries(aliases) }
}
export function mediaItems(project, cut) {
  const items = [], ranks = { image: 0, video: 0, audio: 0 }
  const kinds = { image: 0, video: 1, audio: 2 }
  const position = edge => edge.port === 'start' ? 0 : edge.port === 'end' ? 1 : edge.position
  const edges = cutEdges(project, cut).filter(edge => edge.port !== 'refmod')
    .sort((a, b) => kinds[PORTS[a.port]] - kinds[PORTS[b.port]] || position(a) - position(b) || a.id.localeCompare(b.id))
  for (const edge of edges) {
    const node = nodeOf(project, edge.from), type = PORTS[edge.port]
    const slot = edge.port === 'start' ? 0 : edge.port === 'end' ? 1 : ranks[type]++
    const duration = node.data.duration ?? 2
    items.push({
      id: edge.id, type, slot, order: items.length, start: slot, enabled: true,
      value: node.data.name, duration: type === 'image' ? 1 : duration,
      ...(type !== 'image' ? { trim_start: edge.props.trim_start ?? 0, trim_end: edge.props.trim_end ?? duration, source_duration: duration } : {}),
      ...(type === 'video' ? { media_mode: edge.props.media_mode ?? 'video', ...(edge.props.audioSlot !== undefined ? { audioSlot: edge.props.audioSlot } : {}) } : {}),
    })
  }
  const occupiedAudio = new Set(items.filter(item => item.type === 'audio').map(item => item.slot))
  for (const item of items.filter(item => item.type === 'video' && hasAudio(item) && item.audioSlot !== undefined)) occupiedAudio.add(item.audioSlot)
  for (const item of items.filter(item => item.type === 'video' && hasAudio(item))) {
    if (item.audioSlot === undefined) {
      let slot = 0
      while (occupiedAudio.has(slot)) slot++
      item.audioSlot = slot
      occupiedAudio.add(slot)
    }
  }
  return items.sort((a, b) => kinds[a.type] - kinds[b.type] || a.slot - b.slot || a.order - b.order)
}
const hasAudio = item => item.type === 'audio' || item.type === 'video' && ['audio', 'video_audio'].includes(item.media_mode)
export function labelTable(project, cut) {
  const items = mediaItems(project, cut), rows = []
  for (const [type, title, filter] of [
    ['image', 'Picture', item => item.type === 'image'],
    ['video', 'Video', item => item.type === 'video' && item.media_mode !== 'audio'],
    ['audio', 'Audio', hasAudio],
  ]) items.filter(filter).forEach((item, index) => {
    const edge = project.edges.find(edge => edge.id === item.id), node = nodeOf(project, edge.from)
    rows.push({ nodeId: node.id, edgeId: edge.id, name: node.data.name, label: `<${title} ${index + 1}>`, type, port: edge.port, slot: type === 'audio' && item.type === 'video' ? item.audioSlot : item.slot, order: item.order, props: copy(edge.props) })
  })
  for (const edge of cutEdges(project, cut).filter(edge => edge.port === 'refmod')) {
    const node = nodeOf(project, edge.from), slot = edge.props.slot ?? edge.position + 1
    rows.push({ nodeId: node.id, edgeId: edge.id, name: node.data.name, label: `<RefMod ${slot}>`, type: 'bundle', port: edge.port, slot, order: edge.position, props: copy(edge.props) })
  }
  return rows
}
export function resolvePrompt(project, cut) {
  const table = labelTable(project, cut), errors = [], warnings = [], used = new Set()
  const groups = new Map()
  for (const row of table) {
    if (!groups.has(row.name)) groups.set(row.name, [])
    groups.get(row.name).push(row)
  }
  const names = project.nodes.filter(node => node.kind !== 'cut').map(node => node.data.name).filter(Boolean).sort((a, b) => b.length - a.length)
  const resolve = input => String(input ?? '').replace(/@/g, '\u0000').split('\u0000').map((part, index) => {
    if (!index) return part
    const name = names.find(name => part.startsWith(name) && (!part[name.length] || /[\s.,!?;:()[\]{}"'<>]/u.test(part[name.length])))
    if (!name) { errors.push(`모르는 @이름이야: @${part.split(/[\s.,!?]/u)[0]}`); return `@${part}` }
    const rows = groups.get(name)
    if (!rows) { errors.push(`현재 모드 슬롯에 없는 참조야: @${name}`); return `@${part}` }
    const distinct = new Set(rows.map(row => row.nodeId))
    const edges = new Set(rows.map(row => row.edgeId))
    if (distinct.size > 1 || edges.size > 1) { errors.push(`@이름이 겹쳐: @${name}`); return `@${part}` }
    rows.forEach(row => used.add(row.edgeId))
    return rows.map(row => row.label).join(' / ') + part.slice(name.length)
  }).join('')
  const fields = { prompt: resolve(cut.data.raw || cut.data.prompt), soundscape: resolve(cut.data.soundscape), music: resolve(cut.data.music) }
  for (const edge of cutEdges(project, cut)) if (!['start', 'end'].includes(edge.port) && !used.has(edge.id)) warnings.push(`쓰지 않은 참조야: @${nodeOf(project, edge.from).data.name}`)
  return { ...fields, table, errors: [...new Set(errors)], warnings }
}
export function checkCut(project, cut, assets = {}) {
  const errors = [], warnings = [], add = (code, message, nodeId = cut.id, blocking = true) => (blocking ? errors : warnings).push({ code, message, nodeId })
  const edges = cutEdges(project, cut), items = mediaItems(project, cut)
  for (const port of activePorts(cut.data.mode).filter(port => ['start', 'end'].includes(port))) {
    if (edges.filter(edge => edge.port === port).length !== 1) add('required-slot', `${port === 'start' ? '시작' : '끝'} 프레임이 필요해.`)
  }
  for (const edge of edges) {
    const node = nodeOf(project, edge.from), state = assets[node.id] ?? {}
    if (['deleted', 'no-permission', 'missing'].includes(state.status)) add(state.status, state.message ?? '소재를 쓸 수 없어.', node.id)
    if (state.status === 'changed') add('changed', '가져온 뒤 파일이 바뀌었어.', node.id, false)
    if (state.status === 'unverified') add('unverified', state.message, node.id, false)
  }
  if (cut.data.mode === 'REF2VA') {
    for (const [port, limit] of Object.entries(LIMITS)) if (edges.filter(edge => edge.port === port).length > limit) add('limit', `${port}: ${limit}개를 넘었어.`)
    if (items.length > 12) add('limit', '참조 합계는 12개까지야.')
    if (items.some(item => item.type === 'audio') && !items.some(item => item.type === 'image' || item.type === 'video')) add('required-slot', '오디오 참조에는 이미지 또는 영상이 필요해.')
    for (const type of ['video', 'audio']) {
      const media = items.filter(item => item.type === type)
      let total = 0
      for (const item of media) {
        const duration = item.trim_end - item.trim_start
        if (!Number.isFinite(duration) || item.trim_start < 0 || duration < 2 || duration > 15 || item.trim_end > item.source_duration) add('range', '영상·오디오 구간은 원본 안의 2~15초여야 해.')
        total += duration
      }
      if (total > 15) add('limit', `${type} 참조 구간 합계는 15초까지야.`)
    }
    const bundles = edges.filter(edge => edge.port === 'refmod'), slots = new Set()
    for (const edge of bundles) {
      const slot = edge.props.slot ?? edge.position + 1, strength = edge.props.strength ?? 1
      if (!Number.isInteger(slot) || slot < 1 || slot > 8 || slots.has(slot) || strength < 0 || strength > 1) add('limit', '번들 슬롯은 중복 없이 1~8, 강도는 0~1로 써줘.')
      slots.add(slot)
    }
    // The host counts primary media; stream counts are advisory until its validator agrees.
    const visualVideos = items.filter(item => item.type === 'video' && item.media_mode !== 'audio').length
    const audioStreams = items.filter(hasAudio).length
    if (audioStreams > 3 || items.filter(item => item.type === 'image').length + visualVideos + audioStreams > 12) add('stream-limit', '영상에 포함된 소리까지 세면 앱 화면의 참조 한도를 넘어. 호스트 판정을 확인해줘.', cut.id, false)
    const audioSlots = items.filter(hasAudio).map(item => item.type === 'video' ? item.audioSlot : item.slot)
    if (audioSlots.some(slot => !Number.isInteger(slot) || slot < 0 || slot > 2) || new Set(audioSlots).size !== audioSlots.length) add('stream-slot', '오디오 스트림 슬롯은 중복 없이 0~2로 골라줘. 호스트 판정을 확인해줘.', cut.id, false)
  }
  const resolved = resolvePrompt(project, cut)
  resolved.errors.forEach(message => add('token', message))
  resolved.warnings.forEach(message => add('unused', message, cut.id, false))
  return { blocked: errors.length > 0, errors, warnings, resolved }
}
export function buildDirector(project, cut, assets = {}, overrides = {}) {
  const check = checkCut(project, cut)
  if (check.blocked) fail(check.errors.map(issue => issue.message).join('\n'))
  validateData(cut.data)
  const resolved = check.resolved, items = mediaItems(project, cut), inputAssets = {}
  for (const item of items) {
    const edge = project.edges.find(edge => edge.id === item.id), node = nodeOf(project, edge.from)
    const ref = node.data.ref
    if (ref.source === 'library') inputAssets[item.id] = { composite_hash: ref.compositeHash }
    else if (assets[node.id]) inputAssets[item.id] = copy(assets[node.id])
    else fail(`업로드한 워크플로 입력이 필요해: ${node.data.name}`)
  }
  const refmods = cutEdges(project, cut).filter(edge => edge.port === 'refmod').map(edge => ({
    slot: edge.props.slot ?? edge.position + 1, name: nodeOf(project, edge.from).data.ref.name,
    enabled: true, strength: edge.props.strength ?? 1, description: edge.props.description ?? '',
  }))
  const builder = { version: cut.data.mode === 'REF2VA' ? 2 : 1, mode: cut.data.mode, duration: cut.data.duration, prompt_mode: 'simple', simple_prompt: resolved.prompt, soundscape: resolved.soundscape, music: resolved.music }
  return {
    ...copy(overrides), mode: cut.data.mode, duration: cut.data.duration,
    ...(cut.data.frame_rate !== undefined ? { frame_rate: cut.data.frame_rate } : {}),
    prompt_mode: 'simple', simple_prompt: resolved.prompt, soundscape: resolved.soundscape, music: resolved.music,
    prompt: resolved.prompt, builder_state: JSON.stringify(builder),
    timeline_data: JSON.stringify({ version: 1, items, prompt_blocks: [], refmods, builder_state: builder }),
    assets: inputAssets, refmods,
  }
}
const profileKeys = ['id', 'label', 'workflowId', 'directorFieldId', 'seedFieldId', 'serverId', 'serverTag', 'overrides']
const profileData = profile => copy(Object.fromEntries(profileKeys.filter(key => profile[key] !== undefined).map(key => [key, profile[key]])))
export function profilePublication(profile) {
  const value = profileData(profile)
  return { ...value, overrides: JSON.stringify(value.overrides ?? {}) }
}
export function validateProfile(profile, details) {
  if (!record(profile) || !String(profile.label ?? '').trim() || !Number.isInteger(profile.workflowId) || profile.workflowId < 1) fail('프로필 이름과 워크플로를 골라줘.')
  const fields = details.input_schema ?? []
  if (!fields.some(field => field.id === profile.directorFieldId && field.type === 'node' && field.node_editor === 'minimax_h3_director_dasiwa')) fail('MiniMax H3 Director Marked Field를 골라줘.')
  if (!fields.some(field => field.id === profile.seedFieldId && field.type === 'number' && (field.seed_rule || /(?:^|\.)(?:seed|noise_seed)$/.test(field.json_path ?? '')))) fail('워크플로 편집에서 숫자 시드를 Marked Field로 열어줘.')
  if (profile.serverId && profile.serverTag) fail('서버 ID와 태그 중 하나만 골라줘.')
  if (profile.overrides !== undefined && !record(profile.overrides)) fail('overrides는 JSON 객체로 써줘.')
  if (Object.keys(profile.overrides ?? {}).some(key => ['mode', 'duration', 'media', 'assets', 'timeline_data', 'refmods', 'builder_state', 'prompt', 'simple_prompt'].includes(key))) fail('프로필은 컷 입력을 덮어쓸 수 없어.')
  return profileData(profile)
}
export function generationRequest(profile, director, seed, takeId) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647) fail('시드가 올바르지 않아.')
  return { service_type: 'comfyui', workflow_id: profile.workflowId,
    inputs: { [profile.directorFieldId]: director, [profile.seedFieldId]: seed },
    ...(profile.serverId ? { server_id: profile.serverId } : {}), ...(profile.serverTag ? { server_tag: profile.serverTag } : {}),
    idempotency_key: `video-canvas-${takeId}` }
}
export function resultHash(history) {
  return history && (history.postprocess_status == null || history.postprocess_status === 'ready') ? history.actual_composite_hash ?? history.composite_hash ?? null : null
}
