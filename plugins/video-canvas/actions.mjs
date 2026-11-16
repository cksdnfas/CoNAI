import { PORTS, cutEdges, outputOf } from './domain.mjs'
import { esc, fileUrl, isTerminal, ports, outputNames } from './util.mjs'
import { s, ctx, nodeById, cuts, profileOf, repTake, frameTake, shownTake, takesOf, cutOrder, frameRole, frameSource, frameLabel, settingsOf, genProfiles, defaultOf, cutDefault, upscaleSettingOf } from './state.mjs'
import { toast } from './toast.mjs'
import { showMenu } from './menu.mjs'
import { request, ui, edit, reload, launchRun, lockRunButtons, publish, saveView } from './session.mjs'
import { nodeSize, nodeBoxes, freeSpot, freeSpots, reveal } from './viewport.mjs'
import { markSelection, nodeEl } from './nodes.mjs'
import { confirmDialog, extractionDialog, extractionTarget, afterFrames, settleExtraction, watchExtraction, modal } from './dialogs.mjs'
import { onProfileChange, factsLine, ensureOptions } from './workflow.mjs'
import { openSettings } from './settings.mjs'

// ---- selection ----
export function applySelection(ids) {
  const before = s.selection
  s.sel = ids; s.selection = ids.at(-1) ?? null; s.edgeSel = null; s.nodeDetail = null
  if (s.tab !== 'detail') s.tab = 'detail'
  markSelection()
  ctx.hooks.afterSelection?.()
  lockRunButtons(); publish()
  return before !== s.selection
}
/** Selects one node (or clears) and reads it for the assistant; call inside the task queue. */
export function select(id) {
  applySelection(id ? [id] : [])
  return id ? request('read_node', { id }) : undefined
}
export function focusNode(id, takeId) {
  if (!nodeById(id)) return
  if (takeId) s.viewTake[id] = takeId
  applySelection([id]); ctx.hooks.render(); reveal(id)
  void ui(() => request('read_node', { id }))
}
// ---- creating and removing ----
const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0] & 2147483647
function nextCutName() {
  const used = new Set(cuts().map(cut => cut.data.name))
  let number = cuts().length + 1
  while (used.has(`컷 ${number}`)) number++
  return `컷 ${number}`
}
/** A new cut lands right after the last cut of the sequence, so a canvas that was never arranged already reads in order. */
function nextCutSpot() {
  const last = nodeById(cutOrder().at(-1))
  if (!last) return freeSpots(1, 'cut')[0]
  const size = nodeSize(last)
  return freeSpot({ w: size.w, h: 370 }, { x: last.x + size.w + 96, y: last.y }, nodeBoxes(), 1, 6)
}
/** Adds a cut at once; the server gives it the default cut setting. One that came back without a setting (none registered, or several and no default) opens the settings. */
export async function addCut(at) {
  await ui(async () => {
    const result = await edit([{ op: 'add_node', kind: 'cut', name: nextCutName(), at: at ?? nextCutSpot(), tempId: 'new-cut' }])
    const id = result.applied[0]?.id
    await select(id)
    if (id && !profileOf(nodeById(id))) void openSettings('cut', { message: '새 컷에 줄 컷 설정이 없어서 설정 없이 만들었어. 컷 설정을 등록하고 대표로 정하거나, 컷에서 설정을 골라줘.' })
  })
}
/** Adds a generation node with a registered generation setting. */
export function addGen(at, profileId) {
  const used = new Set(s.project.nodes.filter(node => node.kind === 'gen').map(node => node.data.name))
  let number = used.size + 1
  while (used.has(`생성 ${number}`)) number++
  return ui(async () => {
    const result = await edit([{ op: 'add_node', kind: 'gen', name: `생성 ${number}`, at: at ?? freeSpots(1, 'cut')[0], tempId: 'new-gen', profileId }])
    await select(result.applied[0]?.id)
  })
}
/** The choice of generation settings for a new generation node, as a menu at a point; with none registered the settings open on their tab. */
export function genMenu(at, x, y) {
  const list = genProfiles()
  if (!list.length) return void openSettings('gen')
  showMenu(x, y, [...list.map(profile => settingItem(list, profile, `${profile.label} · ${outputNames[outputOf(profile)]}`, { run: () => addGen(at, profile.id) })), { sep: true }, { label: '생성 설정 관리…', run: () => openSettings('gen') }])
}
/** A menu entry of a setting. When another setting of the list has the same name, the entry also shows the facts the settings rows use to tell them apart.
 *  The facts name the workflow, so they wait for the workflow list (asked for here, shown from the next menu on). */
function settingItem(list, profile, label, item) {
  const twin = list.some(other => other !== profile && other.label === profile.label)
  if (twin && !s.wf) ensureOptions().catch(() => {})
  return { label, ...(twin && s.wf ? { meta: factsLine(profile) } : {}), ...item }
}
/** Puts a registered setting on a node (a generation setting of another kind of output has other fields, so the node's own values reset). */
const useSetting = (node, id) => ui(() => edit([{ op: 'set', id: node.id, fields: node.kind === 'gen' ? { profileId: id, inputs: {}, size: null } : { profileId: id } }]))
/** The registered settings of a node's use with the current one marked, and the way to the settings. */
function settingMenu(node) {
  const role = node.kind === 'gen' ? 'gen' : 'cut', current = profileOf(node)?.id, main = defaultOf('cut'), list = settingsOf(role)
  return [...list.map(profile => settingItem(list, profile, role === 'gen' ? `${profile.label} · ${outputNames[outputOf(profile)]}` : profile.id === main?.id ? `${profile.label} · 대표` : profile.label, { checked: profile.id === current, run: () => profile.id !== current && useSetting(node, profile.id) })),
    { sep: true }, { label: '설정 관리…', run: () => openSettings(role) }]
}
/** The setting menu under a card's setting button (with no setting registered for the node's use the settings open instead). */
export function chooseSetting(nodeId, anchor = nodeEl(nodeId)?.querySelector('[data-action=pick-setting]')) {
  const node = nodeById(nodeId), role = node.kind === 'gen' ? 'gen' : 'cut', rect = anchor.getBoundingClientRect()
  if (!settingsOf(role).length) return void openSettings(role)
  showMenu(rect.left, rect.bottom + 4, settingMenu(node))
}
/** The inspector's buttons of a generation node: edit this setting, register a new one, import a preset. They all go through the settings dialog;
 *  a setting created or imported there is put on the node. */
export function bindGen() {
  document.addEventListener('click', async event => {
    const target = event.target.closest('[data-gen]'), nodeId = target?.closest('[data-id]')?.dataset.id
    if (!target || target.disabled || nodeById(nodeId)?.kind !== 'gen') return
    const profile = profileOf(nodeById(nodeId)), action = target.dataset.gen
    const id = await openSettings('gen', { start: action, ...(action === 'edit' ? { id: profile.id } : {}) })
    if (id && id !== profile?.id) await useSetting(nodeById(nodeId), id)
  })
}
const modeText = change => `모드는 ${change.from} → ${change.to}로 바뀌었어.`
/** A connection to a start/end slot the cut's mode ignored switches the mode (the server says so on that operation, a `connect` or a node added or imported with a `target`): tell the person, as an extraction does. */
export function announceModeChange(result) {
  for (const { op, modeChange: change } of result.applied) if (change) toast(`${nodeById(change.cutId)?.data.name ?? '컷'}의 ${ports[op.port ?? op.target?.port]} 슬롯에 연결했어. ${modeText(change)}`)
}
const defined = fields => Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))
/** Copies cuts and generation nodes (values, setting and input connections; no takes) next to their originals, in one edit.
 *  A cut gets a new seed; a generation node keeps its seed, so the copy starts from the same result. */
export function duplicateCuts(ids) {
  const ops = [], taken = nodeBoxes()
  ids.map(nodeById).filter(node => node?.kind === 'cut' || node?.kind === 'gen').forEach((node, index) => {
    const temp = `copy-${index}`, data = node.data, size = nodeSize(node), cut = node.kind === 'cut'
    const fields = cut ? { prompt: data.prompt, raw: data.raw, duration: data.duration, seed: newSeed(), profileId: data.profileId, upscaleProfileId: data.upscaleProfileId }
      : { prompt: data.prompt, seed: data.seed, profileId: data.profileId, inputs: data.inputs, size: data.size }
    // The copy goes to the first free spot right of its source.
    ops.push({ op: 'add_node', kind: node.kind, tempId: temp, name: `${data.name} 복사`, at: freeSpot(size, { x: node.x + size.w + 24, y: node.y }, taken), fields: defined(fields) })
    for (const edge of s.project.edges.filter(edge => edge.to === node.id)) ops.push({ op: 'connect', from: edge.from, to: temp, port: edge.port, position: edge.position, props: edge.props })
    // The mode is set after the connections: a connection to a start/end slot the mode ignores would switch it, and the copy must keep the original's.
    if (cut) ops.push({ op: 'set', id: temp, fields: { mode: data.mode } })
  })
  if (!ops.length) return toast('복제할 컷이나 생성 노드를 골라줘.', { error: true })
  return ui(async () => {
    const result = await edit(ops)
    const added = result.applied.filter(item => item.tempId?.startsWith('copy-')).map(item => item.id)
    applySelection(added); ctx.hooks.render()
  })
}
export async function removeNodes(ids) {
  const nodes = ids.map(nodeById).filter(Boolean)
  if (!nodes.length) return
  const ok = await confirmDialog(nodes.length === 1 ? '이 노드를 지울까?' : `노드 ${nodes.length}개를 지울까?`, `<p>${nodes.map(node => esc(node.data.name)).join(', ')}와 연결선을 지워. 생성 이력은 남아.</p>`, '지우기')
  if (!ok) return
  await ui(async () => { await edit(nodes.map(node => ({ op: 'remove', id: node.id }))); applySelection(s.sel.filter(id => nodeById(id))); ctx.hooks.render() })
}
/** Ops that cut one connection; an extracted frame nothing else uses goes with its link, as the server's replace does it:
 *  only while its review is pending and the person has not pulled it out as a card. */
export function disconnectOps(edgeId) {
  const edge = s.project.edges.find(item => item.id === edgeId), frame = edge && nodeById(edge.from)
  const orphan = frame?.kind === 'frame' && frame.data.origin && (frame.review ?? 'pending') === 'pending' && !s.open.includes(frame.id) && !s.project.edges.some(other => other.id !== edgeId && (other.from === frame.id || other.to === frame.id))
  return [{ op: 'disconnect', id: edgeId }, ...(orphan ? [{ op: 'remove', id: frame.id }] : [])]
}
export function removeEdge(id) {
  s.edgeSel = null
  return ui(() => edit(disconnectOps(id)))
}
// ---- takes ----
export const pickTake = (cutId, takeId) => ui(() => edit([{ op: 'set', id: cutId, fields: { pickTakeId: takeId } }]))
export function cycleTake(cutId, direction) {
  const takes = takesOf(cutId).filter(take => take.status !== 'discarded'), cut = nodeById(cutId)
  const next = takes[takes.findIndex(take => take.id === shownTake(cut)?.id) + direction]
  if (!next) return
  s.viewTake[cutId] = next.id
  ctx.hooks.render()
}
export function takeAction(action, takeId) {
  const take = s.project.takes.find(take => take.id === takeId)
  if (action === 'upscale') return upscaleCut(take.cutId, take.id)
  // A failed upscale runs again as a new take on its source with the same setting, as long as that setting is still registered.
  if (action === 'upscale-again') return upscaleCut(take.cutId, take.upscaleOf, settingsOf('upscale').some(profile => profile.id === take.profile.id) ? take.profile.id : undefined)
  const args = action.startsWith('rerun-') ? { cut_id: take.cutId, take_id: takeId, profile_id: profileOf(nodeById(take.cutId))?.id ?? take.profile.id, inputs: action === 'rerun-take' ? 'take' : 'canvas', new_seed: action === 'rerun-new' }
    : { cut_id: take.cutId, action, take_id: takeId, input_digest: take.inputDigest }
  return launchRun(args)
}
/** Generate. A generation node with no setting asks for one; so does a cut with none (a proposal, or no default setting for the server to give it). */
export function runFor(cutId, mode = 'now') {
  const node = nodeById(cutId)
  if (!profileOf(node) && !(node.kind === 'cut' && mode === 'now' && cutDefault())) { toast(node.kind === 'gen' ? '생성 설정을 먼저 골라줘.' : '컷 설정을 먼저 골라줘.'); return chooseSetting(cutId) }
  return launchRun({ cut_id: cutId, mode })
}
/** Upscales the result a cut shows (an upscale stands for the take it came from). With no upscale setting to use, the settings open on their upscale tab. */
export function upscaleCut(cutId, takeId, profileId) {
  const cut = nodeById(cutId)
  if (!profileId && !upscaleSettingOf(cut)) {
    return void openSettings('upscale', { message: settingsOf('upscale').length ? '이 컷에 쓸 업스케일 설정이 없어. 업스케일 설정을 대표로 정하거나 컷의 상세에서 골라줘.' : '업스케일 설정이 없어. 영상을 불러오는 입력이 있는 워크플로로 등록해줘.' })
  }
  return launchRun({ cut_id: cutId, action: 'upscale', take_id: takeId ?? shownTake(cut).id, ...(profileId ? { profile_id: profileId } : {}) })
}
export function extractFrom({ nodeId, takeId, target, after }) {
  return ui(() => extractionDialog({ nodeId, takeId, target, after }))
}
/** Takes the last frame of the cut before this one (sequence order) into this cut's start slot. */
export async function continueFromPrevious(cutId) {
  const order = cutOrder(), prev = nodeById(order[order.indexOf(cutId) - 1])
  if (!prev) return toast('앞 컷이 없어. 시퀀스에서 앞에 컷이 있어야 해.', { error: true })
  return pullFrame(prev.id, cutId, 'start', 'last', true)
}
const FRAME_POSITIONS = { first: '첫 프레임', last: '마지막 프레임' }
/**
 * After a ref_image frame is taken again (or picked again): the old link, and its frame when nothing else uses it, goes only
 * once the new frame is connected to the same slot. A failed or cancelled extraction, or a rejected connection, leaves the old link.
 */
function replaceLink(edgeId, cutId, port) {
  const projectId = s.project.id
  return nodeIds => ui(async () => {
    if (s.project?.id !== projectId) return
    await reload()
    const joined = s.project.edges.some(edge => nodeIds.includes(edge.from) && edge.to === cutId && edge.port === port)
    if (joined && s.project.edges.some(edge => edge.id === edgeId)) await edit(disconnectOps(edgeId))
  })
}
/** Takes the first or last frame of a cut's representing result into a slot of another cut. A start/end slot's old frame is replaced
 *  by the server; `replaces` (a ref_image link) is replaced here once the new frame is connected, in the old one's place. */
async function pullFrame(fromId, cutId, port, position, confirm = false, replaces = null) {
  const from = nodeById(fromId), take = frameTake(from)
  if (!take?.resultHash) return toast(`${from.data.name}에 쓸 결과가 아직 없어. 먼저 생성해줘.`, { error: true })
  const cut = nodeById(cutId), single = ['start', 'end'].includes(port), existing = single ? cutEdges(s.project, cut, false).find(edge => edge.port === port) : null
  if (existing && confirm && !await confirmDialog(`${ports[port]}을 바꿀까?`, `<p>${esc(cut.data.name)}의 ${ports[port]} 연결을 ${esc(from.data.name)}의 ${FRAME_POSITIONS[position]}으로 바꿔.</p>`, '바꾸기', false)) return
  await ui(async () => {
    // The server switches the cut's mode when its current mode ignores the slot.
    const old = replaces && s.project.edges.find(edge => edge.id === replaces)
    const target = await extractionTarget(cutId, port, old?.position)
    const result = await request('extract_frame', { expected_revision: s.project.revision, take_id: take.id, position, format: 'png', target })
    if (old) afterFrames(result.id, replaceLink(old.id, cutId, port))
    await reload()
    settleExtraction(result)
    if (!isTerminal(result.status)) watchExtraction(result.id)
    toast(`${cut.data.name}의 ${ports[port]} 슬롯에 ${from.data.name}의 ${FRAME_POSITIONS[position]}을 가져오는 중이야.${result.modeChange ? ` ${modeText(result.modeChange)}` : ''}`)
  })
}
/** A cut's result dropped on a slot of another cut: a video reference imports the clip, an image slot takes a frame of it. */
export async function connectCutResult(fromId, { cut: cutId, port }) {
  const from = nodeById(fromId), take = repTake(from)
  if (!take?.resultHash) return toast(`${from.data.name}에 쓸 결과가 아직 없어. 먼저 생성해줘.`, { error: true })
  if (port !== 'ref_video') return pullFrame(fromId, cutId, port, port === 'end' ? 'first' : 'last')
  const cut = nodeById(cutId)
  // The clip becomes a video node named after its cut, filed to the left of the cut that uses it.
  const at = freeSpot({ w: 200, h: 190 }, { x: cut.x - 248, y: cut.y }, nodeBoxes(), -1)
  await ui(async () => {
    await edit([{ op: 'import_video', ref: { source: 'library', compositeHash: take.resultHash }, name: from.data.name, at, tempId: 'result-clip' }, { op: 'connect', from: 'result-clip', to: cutId, port }])
    toast(`${from.data.name}의 결과를 ${cut.data.name}의 ${ports[port]}에 연결했어.`)
  })
}
// ---- links: a frame of one cut's result between two cuts ----
const sourceOf = edge => { const frame = nodeById(edge.from), source = frame && frameSource(frame); return source && { frame, ...source, target: nodeById(edge.to) } }
/** Takes the frame again from the source cut's current result (the first/last/middle it was taken from, last by default). */
export function repull(edgeId) {
  const edge = s.project.edges.find(item => item.id === edgeId), link = edge && sourceOf(edge)
  if (!link) return
  const position = ['first', 'middle', 'last'].includes(link.frame.data.origin.position) ? link.frame.data.origin.position : 'last'
  return pullFrame(link.cut.id, link.target.id, edge.port, position, false, edge.port === 'ref_image' ? edgeId : null)
}
function pickFrame(edgeId) {
  const edge = s.project.edges.find(item => item.id === edgeId), link = edge && sourceOf(edge), take = link && frameTake(link.cut)
  if (!take) return toast('이 컷에 쓸 결과가 아직 없어. 먼저 생성해줘.', { error: true })
  const listed = edge.port === 'ref_image'
  return extractFrom({ takeId: take.id, target: { cut: link.target.id, port: edge.port, ...(listed ? { position: edge.position } : {}) }, ...(listed ? { after: replaceLink(edgeId, link.target.id, edge.port) } : {}) })
}
const viewFrame = frame => modal(frameLabel(frame), `<img class="vc-big" src="${fileUrl(frame.data.ref.compositeHash)}" alt="">`, { close: '닫기' })
export function linkMenu(edgeId) {
  const edge = s.project.edges.find(item => item.id === edgeId), frame = edge && nodeById(edge.from)
  if (!frame) return []
  return [
    { label: '크게 보기', run: () => viewFrame(frame) },
    { label: '다시 뽑기', run: () => repull(edgeId) },
    { label: '다른 프레임 고르기…', run: () => pickFrame(edgeId) },
    { label: '노드로 꺼내기', run: () => openFrameCard(frame.id) },
    { sep: true },
    { label: '연결 끊기', danger: true, run: () => removeEdge(edgeId) },
  ]
}
/** Puts a frame on the canvas as a card at a spot (the project's stored view remembers it as open). */
function pullOut(frameId, spot) {
  return ui(async () => {
    await edit([{ op: 'move', id: frameId, x: spot.x, y: spot.y }])
    s.open = [...new Set([...s.open, frameId])]; saveView()
    ctx.hooks.render(); reveal(frameId)
  })
}
/** A link's frame becomes a card below the cut it feeds. */
export function openFrameCard(frameId) {
  const edge = s.project.edges.find(item => item.from === frameId), target = nodeById(edge?.to)
  const spot = target ? freeSpot({ w: 200, h: 190 }, { x: target.x - 224, y: target.y + nodeSize(target).h + 48 }, nodeBoxes(), -1) : freeSpots(1, 'frame')[0]
  return pullOut(frameId, spot)
}
/** A tray frame becomes a card where the canvas is showing. */
export const takeOutFrame = frameId => pullOut(frameId, freeSpots(1, 'frame')[0])
export function foldFrame(frameId) {
  s.open = s.open.filter(id => id !== frameId); saveView()
  applySelection(s.sel.filter(id => id !== frameId))
  ctx.hooks.render()
}
export async function eraseFrames(ids) {
  if (!ids.length) return
  if (ids.length > 1 && !await confirmDialog(`남은 프레임 ${ids.length}개를 지울까?`, '<p>쓰지 않는 추출 프레임 노드가 지워져.</p>', '지우기')) return
  await ui(() => edit(ids.map(id => ({ op: 'remove', id }))))
}
/** Shows a frame the server just made: its card, or the cut it feeds when it is folded into a link. */
export function focusFrame(id) {
  const node = nodeById(id), edge = node && s.project.edges.find(item => item.from === id)
  if (!node) return
  if (frameRole(node) === 'card') focusNode(id)
  else if (edge) focusNode(edge.to)
}
// ---- layout ----
/**
 * One lane of cuts in sequence order, 96px apart. Each cut's inputs sit in a lane below it, in columns that end 24px left of
 * that cut, so no column ever sits between two cuts. Left to right in that lane: the media sources, then the generation nodes,
 * one column per step (a generation node that feeds another goes left of it), the column next to the cut holding the ones
 * that feed it. Inside a column nodes are ordered by the cut and slot they end up in. Frames folded into links park in the lane.
 */
export function arrangeOps() {
  const order = cutOrder().map(nodeById), gap = 24, between = 96, columnHeight = 440, top = 20
  const index = new Map(order.map((cut, i) => [cut.id, i])), portRank = Object.keys(PORTS)
  const outgoing = node => s.project.edges.filter(edge => edge.from === node.id)
  const before = (a, b) => { for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]; return a.length - b.length }
  // The first cut and slot a node's result ends up in, directly or through generation nodes (`rank` orders it among its neighbours).
  const firstUse = (node, seen = new Set([node.id])) => outgoing(node).flatMap(edge => {
    if (index.has(edge.to)) return [{ cut: edge.to, rank: [index.get(edge.to), portRank.indexOf(edge.port), edge.position] }]
    const next = nodeById(edge.to), through = next?.kind === 'gen' && !seen.has(next.id) ? firstUse(next, new Set([...seen, next.id])) : null
    return through ? [{ cut: through.cut, rank: [...through.rank, edge.position] }] : []
  }).sort((a, b) => before(a.rank, b.rank))[0]
  // How many generation nodes sit between a generation node and the end of its chain (0: nothing generated is built on it).
  const stepsOf = (gen, seen = new Set([gen.id])) => Math.max(-1, ...outgoing(gen).map(edge => nodeById(edge.to)).filter(next => next?.kind === 'gen' && !seen.has(next.id)).map(next => stepsOf(next, new Set([...seen, next.id])))) + 1
  const lanes = new Map([...order.map(cut => cut.id), null].map(id => [id, { sources: [], gens: [], parked: [] }]))
  for (const node of s.project.nodes.filter(node => node.kind !== 'cut')) {
    const role = frameRole(node), use = firstUse(node), lane = lanes.get(use?.cut ?? null), rank = use?.rank ?? [0, 0, 0]
    if (role === 'tray') continue
    if (role === 'link') { if (use) lane.parked.push(node) }
    else if (node.kind === 'gen') lane.gens.push({ node, rank, steps: stepsOf(node) })
    else lane.sources.push({ node, rank })
  }
  const laneY = top + Math.max(300, ...order.map(cut => nodeSize(cut).h)) + 48
  // Columns of one group of nodes (a column wraps once it gets taller than `limit`).
  const columnsOf = (items, limit = columnHeight) => {
    const columns = []
    for (const { node } of items.sort((a, b) => before(a.rank, b.rank))) {
      const size = nodeSize(node), column = columns.at(-1)
      if (column && column.height + gap + size.h <= limit) { column.items.push({ node, y: column.height + gap }); column.height += gap + size.h; column.width = Math.max(column.width, size.w) }
      else columns.push({ items: [{ node, y: 0 }], height: size.h, width: size.w })
    }
    return columns
  }
  const columnsFor = lane => [...columnsOf(lane.sources), ...[...new Set(lane.gens.map(gen => gen.steps))].sort((a, b) => b - a).flatMap(steps => columnsOf(lane.gens.filter(gen => gen.steps === steps), Infinity))]
  const ops = [], place = (columns, left) => { for (const column of columns) { for (const item of column.items) ops.push({ op: 'move', id: item.node.id, x: left, y: laneY + item.y }); left += column.width + gap } }
  const widthOf = columns => columns.reduce((sum, column) => sum + column.width + gap, 0)
  let cutRight = top - between, laneRight = top - gap
  for (const cut of order) {
    const lane = lanes.get(cut.id), columns = columnsFor(lane), width = widthOf(columns), x = Math.max(cutRight + between, laneRight + gap + width)
    place(columns, x - width)
    for (const frame of lane.parked) ops.push({ op: 'move', id: frame.id, x: x - gap - nodeSize(frame).w, y: laneY })
    ops.push({ op: 'move', id: cut.id, x, y: top })
    cutRight = x + nodeSize(cut).w; laneRight = x - gap
  }
  place(columnsFor(lanes.get(null)), Math.max(cutRight + between, laneRight + gap))
  return ops
}
// ---- field edits (delegated change events) ----
/** A rejected edit leaves the redraw skipped (the HTML did not change), so the control is put back to the server value by hand. */
function restoreControl(target) {
  if (target.tagName === 'SELECT') for (const option of target.options) option.selected = option.defaultSelected
  else target.value = target.defaultValue
}
export async function onFieldChange(target) {
  try { await applyFieldChange(target) } catch (error) { restoreControl(target); throw error }
}
async function applyFieldChange(target) {
  const id = target.closest('[data-id]')?.dataset.id
  if (!id) return
  if (target.dataset.pf) return onProfileChange(target)
  if (target.dataset.field) return edit([{ op: 'set', id, fields: { [target.dataset.field]: ['seed', 'duration'].includes(target.dataset.field) ? Number(target.value) : target.value } }])
  if (target.dataset.prop) return edit([{ op: 'set', id: target.dataset.edge, fields: { props: { [target.dataset.prop]: ['description', 'media_mode'].includes(target.dataset.prop) ? target.value : Number(target.value) } } }])
  if (target.dataset.memo) {
    const item = nodeById(target.dataset.memo) ?? s.project.takes.find(take => take.id === target.dataset.memo)
    await request('human_review', { expected_revision: s.project.revision, ops: [{ op: 'review', id: item.id, status: item.review, memo: target.value }] })
    await reload()
  }
}
