export const KINDS = ['image', 'video', 'audio', 'bundle', 'cut', 'frame', 'gen']
export const MODES = ['T2VA', 'I2VA', 'FL2VA', 'L2VA', 'REF2VA']
export const PORTS = { start: 'image', end: 'image', ref_image: 'image', ref_video: 'video', ref_audio: 'audio', refmod: 'bundle' }
// A generation node's inputs: edge position N goes to the profile's Nth image field (generic workflows mark no audio/video inputs).
export const GEN_PORTS = { image: 'image' }
export const OUTPUTS = ['video', 'image', 'audio']
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
  if (revision === undefined || revision === null) fail('expected_revision이 필요해. 캔버스를 읽고 지금 revision을 넣어줘.')
  if (!Number.isInteger(revision) || project.revision !== revision) fail(`409: 캔버스가 바뀌었어. 다시 읽어줘. (rev ${project.revision})`, 409)
}
export function projectName(name) {
  if (typeof name !== 'string' || !name.trim()) fail('프로젝트 이름을 써줘.')
  return name.trim()
}
export function newProject(id, name) {
  return { id, name: projectName(String(name ?? '')), revision: 0, nodes: [], edges: [], sequence: [], takes: [], profiles: [], extractions: [], exports: [] }
}
// Projects saved before sequences existed, and undo states, are read as their cuts in creation order.
export function sequenceOf(project) {
  const cuts = project.nodes.filter(node => node.kind === 'cut').map(node => node.id), known = new Set(cuts)
  const order = [...new Set(Array.isArray(project.sequence) ? project.sequence : [])].filter(id => known.has(id))
  const listed = new Set(order)
  return [...order, ...cuts.filter(id => !listed.has(id))]
}
// The chosen take, or else the cut's latest take with a result hash.
export function representativeTake(project, cut) {
  const takes = project.takes.filter(take => take.cutId === cut.id)
  if (cut.data.pickTakeId) return takes.find(take => take.id === cut.data.pickTakeId) ?? null
  return takes.filter(take => take.resultHash).at(-1) ?? null
}
// A canvas copy with fresh node and edge IDs; nodes keep their library profile IDs. Takes and job state stay with the original.
export function duplicateCanvas(project, uuid) {
  const ids = new Map(), fresh = id => { if (!ids.has(id)) ids.set(id, uuid()); return ids.get(id) }
  const nodes = project.nodes.map(node => {
    const data = copy(node.data)
    delete data.check; delete data.pickTakeId
    return { ...copy(node), id: fresh(node.id), data }
  })
  const edges = project.edges.map(edge => ({ ...copy(edge), id: uuid(), from: fresh(edge.from), to: fresh(edge.to) }))
  return { nodes, edges, sequence: sequenceOf(project).map(fresh) }
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
// A node that runs a generator: a Director cut or a generation node.
export function generatorOf(project, id) {
  const node = nodeOf(project, id)
  if (node.kind !== 'cut' && node.kind !== 'gen') fail('영상 컷이나 생성 노드를 골라줘.')
  return node
}
export const profileOf = (project, node) => project.profiles.find(profile => profile.id === node.data.profileId)
// Stored profiles: a Director profile names its Director field, a NovelAI one carries the preset's copied `nai` settings,
// a generic workflow profile names its output (or, for an upscale, its video input field) instead.
export const adapterOf = profile => profile.directorFieldId ? 'director' : profile.nai ? 'nai' : profile.output === undefined && profile.videoFieldId == null ? 'director' : 'workflow'
export const outputOf = profile => ({ director: 'video', nai: 'image', workflow: profile.output })[adapterOf(profile)]
// What a profile is for, derived and never stored: `cut` (Director) generates cuts, `upscale` (a workflow profile with a video
// input field) upscales a cut's take, `gen` (the other workflow and NovelAI profiles) runs generation nodes.
export const roleOf = profile => adapterOf(profile) === 'director' ? 'cut' : adapterOf(profile) === 'workflow' && profile.videoFieldId ? 'upscale' : 'gen'
const ROLE_REFUSALS = { cut: '컷에는 Director 생성 설정을 골라줘.', gen: '생성 노드에는 워크플로나 NovelAI 생성 설정을 골라줘.', upscale: '업스케일에는 영상 입력 필드가 있는 업스케일 설정을 골라줘.' }
const ROLE_NAMES = { cut: '컷', gen: '생성 노드', upscale: '업스케일' }
/** `kind` is the use: `cut` (a cut's generation), `gen` (a generation node) or `upscale` (a cut's upscale); the profile's role must match. */
export function assertAdapter(kind, profile) {
  if (roleOf(profile) !== kind) fail(kind === 'gen' && roleOf(profile) === 'upscale' ? '업스케일 설정은 생성 노드에 쓸 수 없어. 컷의 업스케일 설정으로 골라줘.' : ROLE_REFUSALS[kind])
  return profile
}
function profileFor(project, kind, profileId) {
  const profile = project.profiles.find(item => item.id === profileId)
  if (!profile) fail(`생성 설정 목록에 없는 설정이야. ${ROLE_NAMES[kind]}에 맞는 생성 설정을 골라줘.`)
  return assertAdapter(kind, profile)
}
// A take's result as a source reference: sounds are audio candidates, pictures and videos library media.
export const resultRef = take => take.output === 'audio' ? { source: 'audio', candidateId: take.resultHash } : { source: 'library', compositeHash: take.resultHash }
/**
 * A copy in which every generation node with a ready representing take carries that result as its source ref, kind and
 * duration. Take snapshots keep the ref they ran with; the stored canvas never holds one.
 */
export function withResults(project) {
  const next = copy(project)
  for (const node of next.nodes) if (node.kind === 'gen' && !node.data.ref) {
    const take = representativeTake(next, node)
    if (take?.resultHash) Object.assign(node.data, { ref: resultRef(take), resultKind: take.output ?? 'video', ...(take.resultDuration ? { duration: take.resultDuration } : {}) })
  }
  return next
}
/**
 * Warnings for a cut or generation node whose shown result was made from a connected generation node's result that node no
 * longer represents (it was regenerated or another take was picked). `project` comes through withResults; take snapshots
 * keep the refs they ran with.
 */
export function staleUpstream(project, node) {
  const shown = representativeTake(project, node)
  if (!shown?.resultHash) return []
  return (shown.snapshot?.nodes ?? []).filter(old => old.kind === 'gen' && old.data.ref).flatMap(old => {
    const current = project.nodes.find(item => item.id === old.id)
    if (current?.kind !== 'gen' || !current.data.ref || sameValue(current.data.ref, old.data.ref) || !project.edges.some(edge => edge.from === current.id && edge.to === node.id)) return []
    return [{ code: 'stale-input', message: `연결한 생성 노드 '${current.data.name}'를 다시 생성했어. 이 결과는 예전 생성물로 만든 거야. 새 생성물을 쓰려면 다시 생성해줘.`, nodeId: node.id }]
  })
}
// The kind a node feeds into a slot: a frame is an image, a generation node its profile's output.
function sourceKind(project, node) {
  if (node.kind === 'frame') return 'image'
  if (node.kind !== 'gen') return node.kind
  const profile = profileOf(project, node)
  if (!profile) fail('생성 노드의 생성 설정을 먼저 골라줘.')
  return outputOf(profile)
}
// The mode that starts using a start/end slot the current mode ignores; other modes and ports stay as they are.
const SLOT_MODES = { start: { T2VA: 'I2VA', L2VA: 'FL2VA' }, end: { T2VA: 'L2VA', I2VA: 'FL2VA' } }
export const slotMode = (mode, port) => SLOT_MODES[port]?.[mode] ?? null
// Server placement uses the page's default node sizes (CSS widths, typical heights) and gap.
const GAP = 24
const boxOf = (kind, x = 0, y = 0) => ({ x, y, ...(kind === 'cut' || kind === 'gen' ? { w: 300, h: 300 } : { w: 200, h: 190 }) })
const overlaps = (a, b) => a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP
/**
 * A spot that overlaps no node: a cut to the right of the last sequence cut on its row, a node feeding a cut
 * to the left of that cut, anything else below the existing content. Scans always end past the occupied area.
 */
export function freePosition(project, kind, nearCutId = null) {
  const taken = project.nodes.map(node => boxOf(node.kind, node.x, node.y)), size = boxOf(kind)
  const free = (x, y) => !taken.some(box => overlaps({ ...size, x, y }, box))
  const scan = (start, dx, columns) => {
    for (let row = 0; ; row++) for (let column = 0; column < columns; column++) {
      const x = Math.round(start.x + dx * column * (size.w + GAP)), y = Math.round(start.y + row * (size.h + GAP))
      if (free(x, y)) return { x, y }
    }
  }
  const near = nearCutId && project.nodes.find(node => node.id === nearCutId)
  if (near) return scan({ x: near.x - size.w - 48, y: near.y }, -1, 12)
  const last = kind === 'cut' && project.nodes.find(node => node.id === project.sequence?.at(-1))
  if (last) return scan({ x: last.x + 300 + 72, y: last.y }, 1, Infinity)
  if (!project.nodes.length) return { x: 40, y: 40 }
  return scan({ x: Math.min(...taken.map(box => box.x)), y: Math.max(...taken.map(box => box.y + box.h)) + GAP }, 1, 12)
}
export function activePorts(mode) {
  return mode === 'REF2VA' ? ['ref_image', 'ref_video', 'ref_audio', 'refmod']
    : mode === 'I2VA' ? ['start'] : mode === 'FL2VA' ? ['start', 'end'] : mode === 'L2VA' ? ['end'] : []
}
export function cutEdges(project, cut, active = true) {
  return project.edges.filter(edge => edge.to === cut.id && (!active || activePorts(cut.data.mode).includes(edge.port)))
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
}
// The edges a cut (its active slots) or a generation node (all of its inputs) generates from.
export function inputEdges(project, node, active = true) {
  if (node.kind === 'cut') return cutEdges(project, node, active)
  return project.edges.filter(edge => edge.to === node.id).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
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
  fail('앱 소재의 안정 식별자가 필요해. ref는 {source:"library", compositeHash}(라이브러리 이미지·영상), {source:"audio", candidateId}(오디오 후보), {source:"files", fileId}(파일함) 중 하나로 써줘.')
}
const checkSeed = seed => { if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647) fail('시드는 0~2147483647 정수로 써줘.') }
function validateGenData(data) {
  checkSeed(data.seed)
  if (data.inputs !== undefined && !record(data.inputs)) fail('inputs는 필드 ID별 값 객체로 써줘.')
  if (data.size !== undefined && data.size !== null && typeof data.size !== 'string') fail('크기(size)는 생성 설정에 있는 NovelAI 크기 이름으로 써줘.')
}
function validateData(data) {
  if (!MODES.includes(data.mode)) fail('지원하지 않는 모드야.')
  checkSeed(data.seed)
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
// A cut's upscaleProfileId names an upscale profile; null follows the account's default upscale profile.
const editable = ['name', 'mode', 'prompt', 'raw', 'seed', 'duration', 'frame_rate', 'profileId', 'pickTakeId', 'upscaleProfileId']
const genEditable = ['name', 'prompt', 'seed', 'profileId', 'pickTakeId', 'inputs', 'size']
// Keys each edit operation reads (besides op/type); any other key is refused instead of silently dropped.
const OP_KEYS = {
  add_node: ['kind', 'tempId', 'at', 'target', 'ref', 'name'], import: ['tempId', 'at', 'target', 'ref', 'name'],
  connect: ['from', 'to', 'port', 'position', 'props'], disconnect: ['id'], reorder: ['cut', 'port', 'order'], set: ['id', 'fields'],
  move: ['id', 'x', 'y'], remove: ['id'], sequence: ['order'], review: ['id', 'status', 'memo'],
}
const RUN_KEYS = ['kind', 'tempId', 'at', 'target', 'name', 'profileId', 'seed', 'fields']
function checkKeys(op, type) {
  const runs = type === 'add_node' && (op.kind === 'cut' || op.kind === 'gen')
  const allowed = runs ? RUN_KEYS : OP_KEYS[typeof type === 'string' && type.startsWith('import_') ? 'import' : type]
  if (!allowed) fail(`모르는 편집 연산이야: ${type}`)
  const unknown = Object.keys(op).filter(key => key !== 'op' && key !== 'type' && !allowed.includes(key))
  if (!unknown.length) return
  const hint = runs && unknown.some(key => editable.includes(key) || genEditable.includes(key)) ? ' 노드 값은 fields 안에 넣어줘.' : ''
  fail(`${type}에 쓸 수 없는 키야: ${unknown.join(', ')}. 쓸 수 있는 키는 ${allowed.join(', ')}야.${hint}`)
}
function applyOne(project, op, aliases, uuid, actor) {
  const id = value => aliases.get(value) ?? value
  const type = op.op ?? op.type
  checkKeys(op, type)
  if (type === 'add_node' || type.startsWith('import_')) {
    const kind = type === 'import_launch' ? 'image' : type.startsWith('import_') ? type.slice(7) : op.kind
    if (!KINDS.includes(kind)) fail('지원하지 않는 노드 종류야.')
    if (op.tempId && (aliases.has(op.tempId) || project.nodes.some(node => node.id === op.tempId))) fail('tempId가 겹쳐.')
    const at = op.at ?? freePosition(project, kind, op.target ? id(op.target.cut) : null)
    if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) fail('좌표가 올바르지 않아.')
    const ref = kind === 'cut' || kind === 'gen' ? null : normalizeRef(kind, op.ref)
    const data = { name: String(op.name ?? ref?.name ?? ref?.compositeHash ?? kind), ref }
    if (kind === 'cut' || kind === 'gen') {
      if (op.profileId != null) profileFor(project, kind, op.profileId)
      const seed = op.seed === undefined ? 0 : op.seed, profileId = op.profileId ?? null
      if (kind === 'cut') {
        Object.assign(data, { mode: 'T2VA', prompt: '', raw: '', duration: 5, seed, profileId })
        validateData(data)
      } else {
        Object.assign(data, { prompt: '', seed, profileId, inputs: {} })
        validateGenData(data)
      }
    }
    const node = { id: uuid(), kind, x: at.x, y: at.y, data, review: 'pending', memo: '' }
    project.nodes.push(node)
    if (kind === 'cut') project.sequence.push(node.id)
    if (op.tempId) aliases.set(op.tempId, node.id)
    // Values a set would change can come with the new cut or generation node, checked by that same set.
    if (op.fields !== undefined) {
      if (!record(op.fields)) fail('fields는 필드 이름별 값 객체로 써줘.')
      applyOne(project, { op: 'set', id: node.id, fields: op.fields }, aliases, uuid, actor)
    }
    const connected = op.target ? applyOne(project, { op: 'connect', from: node.id, to: id(op.target.cut), port: op.target.port, position: op.target.position, props: op.target.props }, aliases, uuid, actor) : null
    return { id: node.id, tempId: op.tempId, ...(connected?.modeChange ? { modeChange: connected.modeChange } : {}) }
  }
  if (type === 'connect') {
    const source = nodeOf(project, id(op.from)), cut = generatorOf(project, id(op.to)), ports = cut.kind === 'cut' ? PORTS : GEN_PORTS
    if (source.id === cut.id) fail('노드를 자기 자신에 이을 수 없어. 다른 노드에 이어줘.')
    if (!own(ports, op.port) || ports[op.port] !== sourceKind(project, source)) fail('소재 종류와 입력 슬롯이 달라.')
    const peers = project.edges.filter(edge => edge.to === cut.id && edge.port === op.port)
    if (op.position !== undefined && (!Number.isInteger(op.position) || op.position < 0)) fail('슬롯 순서가 올바르지 않아.')
    const position = Math.min(op.position ?? peers.length, peers.length)
    if (['start', 'end'].includes(op.port) && peers.length) fail('시작·끝 슬롯에는 이미지 하나만 넣어줘.')
    const edge = { id: uuid(), from: source.id, to: cut.id, port: op.port, position, props: cleanProps(op.props ?? {}) }
    for (const peer of peers) if (peer.position >= position) peer.position++
    project.edges.push(edge)
    // A start/end image the cut's mode ignores would be left out of the generation, so the mode switches to one that uses it.
    const mode = cut.kind === 'cut' ? slotMode(cut.data.mode, op.port) : null
    if (!mode) return { id: edge.id }
    const modeChange = { cutId: cut.id, from: cut.data.mode, to: mode }
    cut.data.mode = mode
    return { id: edge.id, modeChange }
  }
  if (type === 'disconnect') {
    const index = project.edges.findIndex(edge => edge.id === id(op.id))
    if (index < 0) fail('연결선이 없어.')
    project.edges.splice(index, 1)
    renumber(project)
    return { id: id(op.id) }
  }
  if (type === 'reorder') {
    generatorOf(project, id(op.cut))
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
        if (['ref', 'refmods', 'builder_state', 'timeline_data', 'assets', 'media'].includes(key)) fail(`${key}는 set으로 넣을 수 없어. 소재와 RefMod는 노드로 가져와 컷 슬롯에 이어줘: RefMod는 컷 mode를 REF2VA로 두고 import_bundle {ref:{name}, target:{cut, port:"refmod"}}.`)
        if (!editable.includes(key) && !genEditable.includes(key)) fail(`바꿀 수 없는 필드야: ${key}`)
        if (node.kind === 'gen' ? !genEditable.includes(key) : node.kind === 'cut' ? !editable.includes(key) : key !== 'name') {
          fail(node.kind === 'gen' ? `${key}는 컷 전용 필드야. 생성 노드에는 ${genEditable.join('·')}만 정할 수 있어.` : node.kind === 'cut' ? `${key}는 생성 노드 전용 필드야. 컷에는 ${editable.join('·')}만 정할 수 있어.`
            : editable.includes(key) ? '컷 설정은 컷에서 바꿔줘.' : '생성 노드 필드는 생성 노드에서 바꿔줘.')
        }
        if (['name', 'prompt', 'raw'].includes(key) && typeof value !== 'string') fail('텍스트가 필요해.')
        if (key === 'pickTakeId' && value !== null && !project.takes?.some(take => take.id === value && take.cutId === node.id)) fail(node.kind === 'gen' ? '이 생성 노드의 take를 골라줘.' : '이 컷의 take를 골라줘.')
        if (key === 'profileId' && value !== null) profileFor(project, node.kind, value)
        if (key === 'upscaleProfileId' && value !== null) profileFor(project, 'upscale', value)
        node.data[key] = copy(value)
      }
      if (node.kind === 'cut') validateData(node.data)
      if (node.kind === 'gen') validateGenData(node.data)
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
    project.sequence = project.sequence.filter(cutId => cutId !== id(op.id))
    renumber(project)
    return { id: id(op.id) }
  }
  if (type === 'sequence') {
    const order = Array.isArray(op.order) ? op.order.map(id) : null
    if (!order || new Set(order).size !== order.length) fail('컷 순서는 컷 ID 배열로 한 번씩 줘.')
    for (const cutId of order) cutOf(project, cutId)
    const listed = new Set(order)
    project.sequence = [...order, ...project.sequence.filter(cutId => !listed.has(cutId))]
    return { order: project.sequence }
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
  next.sequence = sequenceOf(next)
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
  // The Director takes one prompt text; sound and music are written inside it (overall_soundscape:, non_diegetic_music:).
  const prompt = resolve(cut.data.raw || cut.data.prompt)
  // A typed <RefMod N> without a bundle in that slot reaches the Director as a tag with no reference and fails there.
  const slots = new Set(table.filter(row => row.type === 'bundle').map(row => row.slot))
  for (const [, slot] of prompt.matchAll(/<RefMod (\d+)>/g)) if (!slots.has(Number(slot))) errors.push(`<RefMod ${slot}>에 연결된 RefMod가 없어. REF2VA 컷의 RefMod 슬롯에 번들을 이어줘.`)
  for (const edge of cutEdges(project, cut)) if (!['start', 'end'].includes(edge.port) && !used.has(edge.id)) warnings.push(`쓰지 않은 참조야: @${nodeOf(project, edge.from).data.name}`)
  return { prompt, table, errors: [...new Set(errors)], warnings }
}
// Source defects shared by cut slots and generation inputs; a generation node feeds only a result withResults found.
function sourceIssues(project, edge, kind, assets, add) {
  const node = nodeOf(project, edge.from), state = assets[node.id] ?? {}
  if (['deleted', 'no-permission', 'missing'].includes(state.status)) add(state.status, state.message ?? '소재를 쓸 수 없어.', node.id)
  if (state.status === 'changed') add('changed', '가져온 뒤 파일이 바뀌었어.', node.id, false)
  if (state.status === 'unverified') add('unverified', state.message, node.id, false)
  if (node.kind === 'gen' && !node.data.ref) add('required-slot', `연결한 생성 노드에 결과가 아직 없어: ${node.data.name}. 먼저 생성해줘.`, node.id)
  else if (node.kind === 'gen' && node.data.resultKind !== kind) add('kind', `연결한 생성 노드의 결과 종류가 이 슬롯과 달라: ${node.data.name}. 결과 종류에 맞는 슬롯에 다시 이어줘.`, node.id)
}
const roleFields = profile => [profile.promptFieldId, profile.seedFieldId, ...(profile.imageFieldIds ?? [])].filter(Boolean)
const genRoles = profile => [['image', profile?.imageFieldIds ?? [], '이미지']]
// The node's own values its profile takes: exposed fields no role fills. Keys a profile edit left behind are not sent.
const genValues = (node, profile) => Object.fromEntries(Object.entries(node.data.inputs ?? {}).filter(([key]) => (profile.exposedFieldIds ?? []).includes(key) && !roleFields(profile).includes(key)))
/** A generation node's check, shaped like checkCut: `resolved.table` says which profile field each connected input fills. */
export function checkGen(project, node, assets = {}) {
  const errors = [], warnings = [], add = (code, message, nodeId = node.id, blocking = true) => (blocking ? errors : warnings).push({ code, message, nodeId })
  const profile = profileOf(project, node), edges = inputEdges(project, node), table = []
  for (const edge of edges) sourceIssues(project, edge, GEN_PORTS[edge.port], assets, add)
  for (const [port, fields, name] of genRoles(profile)) {
    const linked = edges.filter(edge => edge.port === port)
    if (profile && linked.length > fields.length) add('limit', fields.length ? `이 생성 설정은 ${name} 입력을 ${fields.length}개까지 받아. 남는 연결을 빼줘.` : `이 생성 설정에는 ${name} 입력 필드가 없어. 연결을 빼거나 ${name} 입력이 있는 생성 설정을 골라줘.`)
    linked.forEach((edge, index) => {
      const source = nodeOf(project, edge.from)
      table.push({ nodeId: source.id, edgeId: edge.id, name: source.data.name, label: fields[index] ?? null, type: port, port, slot: index, order: table.length, props: copy(edge.props) })
    })
  }
  if (profile) {
    const used = genValues(node, profile)
    for (const key of Object.keys(node.data.inputs ?? {})) if (!own(used, key)) add('input', `이 생성 설정이 받지 않는 입력이라 빼고 보내: ${key}. 필요 없으면 inputs에서 지워줘.`, node.id, false)
  }
  if (node.data.size && !(profile?.nai?.sizes ?? []).some(entry => entry.label === node.data.size)) add('input', `이 생성 설정에 없는 크기야: ${node.data.size}. 생성 설정의 크기 이름 중에서 골라줘.`)
  return { blocked: errors.length > 0, errors, warnings, resolved: { prompt: node.data.prompt ?? '', table, errors: [], warnings: [] } }
}
export const checkNode = (project, node, assets) => node.kind === 'gen' ? checkGen(project, node, assets) : checkCut(project, node, assets)
// Same as the app's joinPrompt (codex-chat/chatGenerationPayload.ts), which NovelAI chat presets use.
const joinPrompt = parts => parts.map(part => String(part ?? '').trim().replace(/^,+|,+$/g, '').trim()).filter(Boolean).join(', ')
/**
 * The NovelAI request payload a chat preset makes (chatGenerationPayload.ts) for this node's prompt and size; without a
 * chat profile there is no reference image, so only the preset's own character references go. Always one sample: more cost credits.
 */
function naiPayload(config, node) {
  const size = config.sizes.find(entry => entry.label === node.data.size) ?? config.sizes[0]
  return {
    prompt: joinPrompt([config.promptPrefix, node.data.prompt, config.promptSuffix]), negative_prompt: config.negativePrompt || undefined,
    model: config.model, action: 'generate', sampler: config.sampler, noise_schedule: config.noiseSchedule,
    width: size.width, height: size.height, steps: config.steps, scale: config.scale, n_samples: 1, use_coords: config.useCoords,
    characters: config.characters?.length ? copy(config.characters) : undefined, vibes: config.vibes?.length ? copy(config.vibes) : undefined,
    character_refs: config.characterRefs?.length ? copy(config.characterRefs) : undefined,
    variety_plus: config.varietyPlus, transparent_background: config.transparentBackground,
  }
}
/**
 * A generation node's adapter value: for `workflow` its exposed inputs, then its prompt and connected images in the mapped
 * fields; for `nai` the NovelAI payload without the seed.
 */
export function buildWorkflowInputs(project, node, assets = {}) {
  const check = checkGen(project, node)
  if (check.blocked) fail(check.errors.map(issue => issue.message).join('\n'))
  validateGenData(node.data)
  const profile = profileOf(project, node)
  if (!profile) fail('생성 노드의 생성 설정을 먼저 골라줘.')
  if (adapterOf(profile) === 'nai') return naiPayload(profile.nai, node)
  const values = copy(genValues(node, profile))
  if (profile.promptFieldId) values[profile.promptFieldId] = node.data.prompt
  const edges = inputEdges(project, node)
  for (const [port, fields] of genRoles(profile)) edges.filter(edge => edge.port === port).forEach((edge, index) => {
    const source = nodeOf(project, edge.from), ref = source.data.ref
    if (ref.source === 'library') values[fields[index]] = { composite_hash: ref.compositeHash }
    else if (assets[source.id]) values[fields[index]] = copy(assets[source.id])
    else fail(`업로드한 워크플로 입력이 필요해: ${source.data.name}`)
  })
  return values
}
export function checkCut(project, cut, assets = {}) {
  const errors = [], warnings = [], add = (code, message, nodeId = cut.id, blocking = true) => (blocking ? errors : warnings).push({ code, message, nodeId })
  const edges = cutEdges(project, cut), items = mediaItems(project, cut)
  for (const port of activePorts(cut.data.mode).filter(port => ['start', 'end'].includes(port))) {
    if (edges.filter(edge => edge.port === port).length !== 1) add('required-slot', `${port === 'start' ? '시작' : '끝'} 프레임이 필요해.`)
  }
  for (const edge of edges) sourceIssues(project, edge, PORTS[edge.port], assets, add)
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
  const builder = { version: cut.data.mode === 'REF2VA' ? 2 : 1, mode: cut.data.mode, duration: cut.data.duration, prompt_mode: 'simple', simple_prompt: resolved.prompt }
  return {
    ...copy(overrides), mode: cut.data.mode, duration: cut.data.duration,
    ...(cut.data.frame_rate !== undefined ? { frame_rate: cut.data.frame_rate } : {}),
    prompt_mode: 'simple', simple_prompt: resolved.prompt,
    prompt: resolved.prompt, builder_state: JSON.stringify(builder),
    timeline_data: JSON.stringify({ version: 1, items, prompt_blocks: [], refmods, builder_state: builder }),
    assets: inputAssets, refmods,
  }
}
// Both adapters may carry the app generation preset's instruction and guide; guideSkill is a { skillId, path } link read at use time.
const guideKeys = ['instruction', 'guide', 'guideSkill']
const profileKeys = {
  director: ['id', 'label', 'workflowId', 'directorFieldId', 'seedFieldId', 'serverId', 'serverTag', 'overrides', 'inputs', ...guideKeys],
  workflow: ['id', 'label', 'workflowId', 'serverId', 'serverTag', 'output', 'promptFieldId', 'seedFieldId', 'imageFieldIds', 'exposedFieldIds', 'fixedInputs', 'videoFieldId', ...guideKeys],
  nai: ['id', 'label', 'output', 'nai', ...guideKeys],
}
const SAME_ADAPTER = '같은 생성 설정 ID로 생성 방식(Director/워크플로/NovelAI)을 바꿀 수 없어. 새 생성 설정으로 저장해줘.'
// Keys naming the workflow's own fields (worked out again for another workflow), and values keyed by its field IDs.
const roleKeys = ['directorFieldId', 'seedFieldId', 'promptFieldId', 'imageFieldIds']
const fieldValueKeys = ['exposedFieldIds', 'fixedInputs', 'inputs']
/**
 * The profile a save of `input` asks for. A save of a stored profile changes only the keys it gives (null or an empty value
 * clears one); with another workflow (`fields` its input schema) the old field roles are derived again and values of fields
 * it lacks are dropped. A key of another adapter would change how the profile generates, which needs a new profile.
 */
export function mergeProfile(input, existing, fields) {
  const given = { ...input }
  if (existing) {
    const keys = profileKeys[adapterOf(existing)]
    if (Object.keys(input).some(key => !keys.includes(key) && Object.values(profileKeys).some(list => list.includes(key)))
      || adapterOf(existing) === 'nai' && input.output !== undefined && input.output !== 'image') fail(SAME_ADAPTER)
    const moved = input.workflowId !== undefined && input.workflowId !== existing.workflowId, ids = new Set((fields ?? []).map(field => field.id))
    for (const key of keys) {
      if (given[key] !== undefined || existing[key] === undefined || moved && roleKeys.includes(key)) continue
      const value = copy(existing[key])
      given[key] = !moved || !fieldValueKeys.includes(key) ? value
        : Array.isArray(value) ? value.filter(id => ids.has(id)) : Object.fromEntries(Object.entries(value).filter(([id]) => ids.has(id)))
    }
  }
  for (const key of ['serverId', 'serverTag']) if (given[key] === null) delete given[key]
  return given
}
const profileData = profile => copy(Object.fromEntries(profileKeys[adapterOf(profile)].filter(key => profile[key] !== undefined).map(key => [key, profile[key]])))
const textKeys = ['id', 'label', 'instruction', 'guide', 'guideSkill']
/**
 * The stored profile with only its name and guide texts changed, or null when `input` changes anything else (that save checks
 * the workflow). A profile whose workflow became unusable or was removed can still be renamed this way.
 */
export function relabelProfile(input, existing) {
  if (Object.keys(input).some(key => !textKeys.includes(key) && !sameValue(input[key], existing[key]))) return null
  const given = mergeProfile(input, existing)
  return { ...profileData({ ...given, label: String(given.label ?? '').trim() ? given.label : existing.label }), ...guideData(given) }
}
// Data-URL values (an image fixed in a preset) are blobs the assistant has no use for; it reads a marker instead.
const DATA_URL = '(data URL)'
const withoutDataUrls = value => typeof value === 'string' ? (/^data:/i.test(value.trim()) ? DATA_URL : value)
  : Array.isArray(value) ? value.map(withoutDataUrls) : record(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withoutDataUrls(item)])) : value
export function profilePublication(profile) {
  const value = withoutDataUrls(profileData(profile))
  // Marked field IDs are workflow-chosen keys, published as text like the overrides.
  if (adapterOf(value) === 'workflow') return { ...value, fixedInputs: JSON.stringify(value.fixedInputs ?? {}) }
  // Vibe encodings and reference images are large base64 the assistant has no use for; it reads their counts (a take's copy stores only counts).
  if (adapterOf(value) === 'nai') {
    const { vibes, characterRefs, ...settings } = value.nai, count = list => Array.isArray(list) ? list.length : list ?? 0
    return { ...value, nai: { ...settings, vibes: count(vibes), characterRefs: count(characterRefs) } }
  }
  return { ...value, overrides: JSON.stringify(value.overrides ?? {}), ...(value.inputs ? { inputs: JSON.stringify(value.inputs) } : {}) }
}
// Field rows come from get_workflow_details (json_path/seed_rule) or a stored workflow (jsonPath).
const isDirectorField = field => field.type === 'node' && field.node_editor === 'minimax_h3_director_dasiwa'
const isSeedField = field => field.type === 'number' && Boolean(field.seed_rule || /(?:^|\.)(?:seed|noise_seed)$/.test(field.json_path ?? field.jsonPath ?? ''))
const simpleTypes = ['text', 'textarea', 'number', 'select']
const cutKeys = ['mode', 'duration', 'media', 'assets', 'timeline_data', 'refmods', 'builder_state', 'prompt', 'simple_prompt']
const isTextField = field => field.type === 'text' || field.type === 'textarea'
/**
 * Roles a generic workflow profile leaves unset, by the app generation preset's rule (chatGenerationPresets comfyAssetFields):
 * the prompt is the only exposed text field, else the one named like a positive prompt, else the only text field; the seed
 * is the seed-marked number field; input images are the image fields not fixed.
 */
function generatorRoles(fields, given = {}) {
  const texts = fields.filter(isTextField), describe = field => `${field.id} ${field.label ?? ''}`
  const named = list => list.filter(field => /positive|prompt|프롬프트|긍정/i.test(describe(field)) && !/negative|neg_|부정|undesired/i.test(describe(field)))
  const exposed = texts.filter(field => (given.exposedFieldIds ?? []).includes(field.id))
  const pick = [exposed, named(exposed), named(texts), texts].find(list => list.length === 1)
  return {
    promptFieldId: given.promptFieldId !== undefined ? given.promptFieldId : pick?.[0].id ?? null,
    seedFieldId: given.seedFieldId !== undefined ? given.seedFieldId : fields.find(isSeedField)?.id ?? null,
    imageFieldIds: given.imageFieldIds ?? fields.filter(field => field.type === 'image' && field.id !== given.videoFieldId && !(record(given.fixedInputs) && own(given.fixedInputs, field.id))).map(field => field.id),
  }
}
// An image-type marked field that loads a video: its node class says video, or it fills a node's `video` input.
const isVideoField = field => field.type === 'image' && (/video/i.test(field.node_class_type ?? '') || String(field.json_path ?? field.jsonPath ?? '').split('.').at(-1) === 'video')
// A profile given as just a workflow takes the workflow name and its own Director and seed fields; one with an output, its generic roles.
export function completeProfile(profile, details) {
  if (!record(profile)) fail('프로필 이름과 워크플로를 골라줘.')
  const fields = details.input_schema ?? []
  const label = String(profile.label ?? '').trim() ? profile.label : details.name
  if (adapterOf(profile) === 'workflow') {
    // An upscale profile (one with a video input field) always makes a video.
    const { videoFieldId, ...generic } = profile, upscale = videoFieldId == null ? {} : { videoFieldId, output: 'video' }
    return { ...generic, label, ...generatorRoles(fields, profile), exposedFieldIds: profile.exposedFieldIds ?? [], fixedInputs: profile.fixedInputs ?? {}, ...upscale }
  }
  return { ...profile, label,
    directorFieldId: profile.directorFieldId ?? fields.find(isDirectorField)?.id,
    seedFieldId: profile.seedFieldId ?? fields.find(isSeedField)?.id }
}
function validateInputs(profile, fields) {
  if (profile.inputs === undefined) return
  if (!record(profile.inputs)) fail('inputs는 필드 ID별 값 객체로 써줘.')
  checkValues(profile.inputs, fields, key => key !== profile.directorFieldId && key !== profile.seedFieldId, '프로필에서 정할 수 없는 워크플로 입력이야')
}
// A generation node's own values for its profile's exposed simple fields (role fields are filled by the node itself).
export function validateGenInputs(node, profile, details) {
  checkValues(genValues(node, profile), details.input_schema ?? [], () => true, '이 생성 설정에서 정할 수 없는 입력이야')
}
function checkValues(values, fields, allowed, refusal) {
  for (const [key, value] of Object.entries(values)) {
    const field = fields.find(field => field.id === key)
    if (!field || !allowed(key) || !simpleTypes.includes(field.type)) fail(`${refusal}: ${key}`)
    const name = field.label || key
    if (field.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${name}: 숫자가 필요해.`)
      const min = field.minimum ?? field.min, max = field.maximum ?? field.max
      if (min !== undefined && value < min || max !== undefined && value > max) fail(`${name}: ${min ?? ''}~${max ?? ''} 범위로 써줘.`)
    } else if (typeof value !== 'string') fail(`${name}: 텍스트가 필요해.`)
    else if (field.type === 'select' && Array.isArray(field.options) && !field.options.includes(value)) fail(`${name}: 목록에 있는 값을 골라줘.`)
  }
}
// Guide text is copied; the skill section stays a link, so only its { skillId, path } is stored.
function guideData(profile) {
  for (const key of ['instruction', 'guide']) if (profile[key] !== undefined && typeof profile[key] !== 'string') fail(`${key}는 텍스트로 써줘.`)
  const link = profile.guideSkill
  if (link === undefined || link === null) return {}
  if (!record(link) || !Number.isInteger(link.skillId) || link.skillId < 1 || typeof link.path !== 'string' || !link.path.trim()) fail('가이드 스킬(guideSkill)은 스킬 섹션 링크 {skillId, path}로 골라줘.')
  return { guideSkill: { skillId: link.skillId, path: link.path } }
}
function validateGenerator(profile, fields) {
  const field = id => fields.find(item => item.id === id)
  if (fields.some(isDirectorField)) fail('Director 워크플로는 컷의 생성 설정으로 써줘.')
  if (!OUTPUTS.includes(profile.output)) fail('결과 종류(output)는 video / image / audio 중에서 골라줘.')
  if (profile.promptFieldId != null && !(field(profile.promptFieldId) && isTextField(field(profile.promptFieldId)))) fail('프롬프트 필드는 텍스트 Marked Field 하나로 골라줘.')
  if (profile.seedFieldId != null && !(field(profile.seedFieldId) && isSeedField(field(profile.seedFieldId)))) fail('시드 필드는 숫자 시드 Marked Field로 골라줘.')
  const images = profile.imageFieldIds ?? []
  if (!Array.isArray(images) || new Set(images).size !== images.length || images.some(id => field(id)?.type !== 'image')) fail('이미지 입력 필드는 겹치지 않는 이미지 Marked Field ID 배열로 골라줘.')
  // The host uploads a library video as it is into an image-type field (prepareComfyPromptData getComfyMediaUploadInput);
  // the field must load a video by the rule workflowOption lists `upscale.videoFields` with.
  if (profile.videoFieldId !== undefined && (!field(profile.videoFieldId) || !isVideoField(field(profile.videoFieldId)) || images.includes(profile.videoFieldId))) fail('업스케일 영상 입력 필드(videoFieldId)는 영상을 불러오는 이미지 Marked Field 중에서, 이미지 입력 필드와 겹치지 않게 골라줘.')
  const exposed = profile.exposedFieldIds ?? []
  if (!Array.isArray(exposed) || exposed.some(id => !field(id))) fail('exposedFieldIds는 이 워크플로의 Marked Field ID 배열로 써줘.')
  if (profile.fixedInputs !== undefined && !record(profile.fixedInputs)) fail('fixedInputs는 필드 ID별 값 객체로 써줘.')
  const unknown = Object.keys(profile.fixedInputs ?? {}).find(key => !field(key))
  if (unknown) fail(`워크플로에 없는 고정 입력이야: ${unknown}. fixedInputs에서 빼줘.`)
}
export function validateProfile(profile, details) {
  if (!record(profile) || !String(profile.label ?? '').trim() || adapterOf(profile) !== 'nai' && (!Number.isInteger(profile.workflowId) || profile.workflowId < 1)) fail('프로필 이름과 워크플로를 골라줘.')
  const fields = details.input_schema ?? []
  if (profile.serverId && profile.serverTag) fail('서버 ID와 태그 중 하나만 골라줘.')
  const guide = guideData(profile)
  if (adapterOf(profile) === 'nai') {
    if (!Array.isArray(profile.nai.sizes) || !profile.nai.sizes.length || profile.nai.sizes.some(size => !Number.isInteger(size?.width) || !Number.isInteger(size?.height))) fail('NovelAI 설정에 크기가 없어. 생성 프리셋을 다시 확인해줘.')
    return { ...profileData({ ...profile, output: 'image' }), ...guide }
  }
  if (adapterOf(profile) === 'workflow') {
    validateGenerator(profile, fields)
    return { ...profileData(profile), ...guide }
  }
  if (!fields.some(field => field.id === profile.directorFieldId && isDirectorField(field))) fail('MiniMax H3 Director Marked Field를 골라줘.')
  if (!fields.some(field => field.id === profile.seedFieldId && isSeedField(field))) fail('워크플로 편집에서 숫자 시드를 Marked Field로 열어줘.')
  if (profile.overrides !== undefined && !record(profile.overrides)) fail('overrides는 JSON 객체로 써줘.')
  if (Object.keys(profile.overrides ?? {}).some(key => cutKeys.includes(key))) fail('프로필은 컷 입력을 덮어쓸 수 없어. 소재와 RefMod는 컷 슬롯에 이어줘.')
  validateInputs(profile, fields)
  return { ...profileData(profile), ...guide }
}
const scalar = value => ['string', 'number', 'boolean'].includes(typeof value)
const scalars = (value, skip = () => false) => Object.fromEntries(Object.entries(value).filter(([key, item]) => scalar(item) && !skip(key)))
// Director values a profile may override, flat: scalar node values plus the timeline resolution block.
function directorDefaults(field) {
  const value = record(field?.default_value) ? field.default_value : {}, hidden = field?.node_hidden_controls ?? []
  // Same rule as the app's Director editor: only the settings the workflow opened (node_visible_fields, all by default).
  // The resolution panel comes with the timeline and sets the canvas itself, so raw width/height show only without it.
  const visible = field?.node_visible_fields ?? ['width', 'height', 'frame_rate', 'ref_image_size', 'timeline_data']
  const panel = visible.includes('timeline_data') && !hidden.includes('resolution')
  const open = ['frame_rate', 'ref_image_size', ...(panel ? [] : ['width', 'height'])].filter(key => visible.includes(key) && !hidden.includes(key))
  const defaults = scalars(value, key => !open.includes(key))
  let timeline = value.timeline_data
  if (typeof timeline === 'string') try { timeline = JSON.parse(timeline) } catch { timeline = null }
  if (panel && record(timeline?.resolution)) defaults.resolution = scalars(timeline.resolution)
  return defaults
}
// workflow: a GET /api/workflows row (marked_fields with defaults); details: its get_workflow_details, when fetched.
export function workflowOption(workflow, details) {
  const marked = workflow.marked_fields ?? [], fields = details?.input_schema ?? marked
  const director = fields.find(isDirectorField), seed = fields.find(isSeedField)
  const reason = !director && !seed ? 'Director 노드와 숫자 시드를 Marked Field로 열어줘.'
    : !director ? 'MiniMax H3 Director 노드를 Marked Field로 열어줘.'
      : !seed ? '워크플로 편집에서 숫자 시드를 Marked Field로 열어줘.'
        : !workflow.is_active ? '꺼진 워크플로우야. ComfyUI 탭에서 켜줘.' : null
  const defaultOf = id => marked.find(field => field.id === id)?.default_value
  const extraFields = fields.filter(field => field !== director && field !== seed && simpleTypes.includes(field.type)).map(field => ({
    id: field.id, label: field.label || field.id, type: field.type,
    ...(Array.isArray(field.options) ? { options: field.options } : {}),
    ...(field.minimum ?? field.min) !== undefined ? { min: field.minimum ?? field.min } : {},
    ...(field.maximum ?? field.max) !== undefined ? { max: field.maximum ?? field.max } : {},
    ...(defaultOf(field.id) !== undefined ? { default: defaultOf(field.id) } : {}),
  }))
  // `usable`/`reason` are for cuts (Director); `generator` is the same workflow as a generation node's generic profile.
  const generatorReason = director ? 'Director 워크플로는 컷의 생성 설정으로 써줘.' : !workflow.is_active ? '꺼진 워크플로우야. ComfyUI 탭에서 켜줘.' : null
  // `upscale` is the same workflow as an upscale profile: its videoFieldId is one of `videoFields`.
  const videoFields = fields.filter(isVideoField)
  const upscaleReason = director ? 'Director 워크플로는 업스케일에 쓸 수 없어.'
    : !videoFields.length ? '영상을 불러오는 이미지 Marked Field가 없어. 워크플로 편집에서 영상 불러오기 노드의 입력을 Marked Field로 열어줘.'
      : !workflow.is_active ? '꺼진 워크플로우야. ComfyUI 탭에서 켜줘.' : null
  return { workflowId: workflow.id, name: workflow.name, kind: workflow.kind === 'audio' ? 'audio' : 'image', usable: !reason, ...(reason ? { reason } : {}),
    directorFieldId: director?.id ?? null, seedFieldId: seed?.id ?? null,
    defaults: directorDefaults(director && marked.find(field => field.id === director.id)), extraFields,
    generator: { usable: !generatorReason, ...(generatorReason ? { reason: generatorReason } : {}), output: workflow.kind === 'audio' ? 'audio' : 'image', ...generatorRoles(fields),
      imageFields: fields.filter(field => field.type === 'image').map(field => ({ id: field.id, label: field.label || field.id })) },
    upscale: { usable: !upscaleReason, ...(upscaleReason ? { reason: upscaleReason } : {}), videoFields: videoFields.map(field => ({ id: field.id, label: field.label || field.id })), seedFieldId: seed?.id ?? null } }
}
/** The adapters' submit request: `director` sends the Director value and seed, `workflow` fixed inputs under the node's values and seed. */
export function generationRequest(profile, value, seed, takeId) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647) fail('시드가 올바르지 않아.')
  // NovelAI reads the seed from request_payload.seed (backend utils/nai/metadata.ts); the payload always has n_samples 1.
  if (adapterOf(profile) === 'nai') return { service_type: 'novelai', request_payload: { ...copy(value), n_samples: 1, seed }, idempotency_key: `video-canvas-${takeId}` }
  const inputs = adapterOf(profile) === 'director'
    ? { ...copy(profile.inputs ?? {}), [profile.directorFieldId]: value, [profile.seedFieldId]: seed }
    : { ...copy(profile.fixedInputs ?? {}), ...copy(value), ...(profile.seedFieldId ? { [profile.seedFieldId]: seed } : {}) }
  return { service_type: 'comfyui', workflow_id: profile.workflowId, inputs,
    ...(profile.serverId ? { server_id: profile.serverId } : {}), ...(profile.serverTag ? { server_tag: profile.serverTag } : {}),
    idempotency_key: `video-canvas-${takeId}` }
}
export function resultHash(history) {
  return history && (history.postprocess_status == null || history.postprocess_status === 'ready') ? history.actual_composite_hash ?? history.composite_hash ?? null : null
}
