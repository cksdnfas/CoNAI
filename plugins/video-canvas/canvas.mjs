import { $, names, patch } from './util.mjs'
import { s, ctx, nodeById, repTake, frameRole, outputKind, takeOutput, SLOT_KINDS } from './state.mjs'
import { ui, edit, task, request, openDetail, showInspector } from './session.mjs'
import { showMenu } from './menu.mjs'
import { transform, zoomAt, toStage, fit } from './viewport.mjs'
import { nodeEl } from './nodes.mjs'
import { drawEdges, center, curve, inStage } from './links.mjs'
import { picker } from './dialogs.mjs'
import { applySelection, addCut, addGen, duplicateCuts, announceModeChange, removeNodes, removeEdge, pickTake, takeAction, runFor, changeWorkflow, extractFrom, continueFromPrevious, connectCutResult, disconnectOps, linkMenu, foldFrame, arrangeOps } from './actions.mjs'

// ---- connecting: drag from an output port, live line, snap, drop ----
const RESULT_PORTS = ['ref_video', 'start', 'end', 'ref_image']
let link = null
// The cards that take connections: cuts and generation nodes.
const TARGETS = '.vc-node[data-kind=cut], .vc-node[data-kind=gen]'
function startLink(event, from, reroute) {
  // A generation node's result is the kind its profile makes; with no profile nothing fits yet.
  const source = nodeById(from), kind = outputKind(source)
  link = { from, kind, reroute, slots: [], snap: null, bodyCut: null, start: center(nodeEl(from).querySelector('.vc-output')) }
  const compatibleCuts = new Set()
  for (const el of $('nodes').querySelectorAll('.vc-slot')) {
    const port = el.dataset.port, edgeId = el.dataset.edge
    const own = Boolean(reroute) && edgeId === reroute.id
    // A cut's result goes into a video reference as a clip, or into a frame slot as an extracted frame; never into itself.
    const compatible = source.kind === 'cut' ? RESULT_PORTS.includes(port) && el.closest('[data-id]').dataset.id !== from : SLOT_KINDS[port] === kind && el.closest('[data-id]').dataset.id !== from
    el.classList.add(compatible ? 'can' : 'cant')
    if (!compatible) continue
    const cut = el.closest('[data-id]').dataset.id
    compatibleCuts.add(cut)
    link.slots.push({ el, cut, port, position: Number(el.dataset.position), edgeId, own, pos: center(el.querySelector('.vc-input')) })
  }
  for (const el of $('nodes').querySelectorAll(TARGETS)) el.classList.toggle('cant', !compatibleCuts.has(el.dataset.id))
  nodeEl(from).classList.remove('cant')
  $('canvas').classList.add('linking'); $('link-line').dataset.kind = kind
  $('canvas').setPointerCapture?.(event.pointerId)
  event.preventDefault()
  if (reroute) { s.ghostEdge = reroute.id; drawEdges() }
  updateLink(event)
}
function updateLink(event) {
  const stage = $('stage').getBoundingClientRect(), pointer = { x: event.clientX, y: event.clientY }
  const hit = document.elementFromPoint?.(pointer.x, pointer.y)
  const row = hit?.closest('.vc-slot') && link.slots.find(slot => slot.el === hit.closest('.vc-slot'))
  let near = null, nearest = 40
  for (const slot of link.slots) { const distance = Math.hypot(slot.pos.x - pointer.x, slot.pos.y - pointer.y); if (distance < nearest) { near = slot; nearest = distance } }
  const snap = row || near
  if (link.snap !== snap) { link.snap?.el.classList.remove('snap'); snap?.el.classList.add('snap'); link.snap = snap }
  const cutEl = hit?.closest(TARGETS), cutId = !snap && cutEl && link.slots.some(slot => slot.cut === cutEl.dataset.id && !slot.edgeId) ? cutEl.dataset.id : null
  if (cutId !== link.bodyCut) { $('nodes').querySelectorAll('.vc-node.drop').forEach(el => el.classList.remove('drop')); if (cutId) cutEl.classList.add('drop'); link.bodyCut = cutId }
  $('link-line').style.display = 'block'
  $('link-line').setAttribute('d', curve(inStage(link.start, stage), inStage(snap ? snap.pos : pointer, stage)))
}
function endLink() {
  if (!link) return
  const ghost = link.reroute
  document.querySelectorAll('.vc-slot.can, .vc-slot.cant, .vc-slot.snap').forEach(el => el.classList.remove('can', 'cant', 'snap'))
  document.querySelectorAll('.vc-node.cant, .vc-node.drop').forEach(el => el.classList.remove('cant', 'drop'))
  $('canvas').classList.remove('linking'); $('link-line').style.display = 'none'
  link = null
  if (ghost) { s.ghostEdge = null; drawEdges() }
}
function releaseLink(event) {
  updateLink(event)
  const { from, reroute, snap, bodyCut, slots } = link
  const free = slots.filter(slot => slot.cut === bodyCut && !slot.edgeId)
  const target = snap ?? (bodyCut ? free.find(slot => !slot.el.classList.contains('unused')) ?? free[0] : null)
  endLink()
  if (nodeById(from)?.kind === 'cut') { if (target) void connectCutResult(from, target); return }
  if (target) {
    if (target.own) return
    // A frame dropped on the start/end slot it already fills changes nothing (also when it is the edge being dragged).
    if (['start', 'end'].includes(target.port) && s.project.edges.some(edge => edge.id === target.edgeId && edge.from === from)) return
    // A single slot (start/end) that is already filled is replaced (an extracted frame it held goes with its link); a list slot inserts before the connection it was dropped on.
    const replace = target.edgeId && ['start', 'end'].includes(target.port) && target.edgeId !== reroute?.id ? disconnectOps(target.edgeId) : []
    let position = target.edgeId && !replace.length ? target.position : undefined
    // Taking the connection out of the same slot list shifts the later positions up by one.
    if (position !== undefined && reroute?.to === target.cut && reroute.port === target.port && reroute.position < position) position--
    void ui(async () => announceModeChange(await edit([...(reroute ? [{ op: 'disconnect', id: reroute.id }] : []), ...replace, { op: 'connect', from, to: target.cut, port: target.port, ...(position === undefined ? {} : { position }), ...(reroute ? { props: reroute.props } : {}) }])))
  } else if (reroute) void ui(() => edit([{ op: 'disconnect', id: reroute.id }]))
}

// ---- selection bar: only for several nodes (one node has its ⋯ menu and the context menu) ----
const fbtn = (action, label, cls = '') => `<button class="${cls}" data-action="${action}">${label}</button>`
export function renderFloat() {
  const float = $('float'), nodes = s.sel.map(nodeById).filter(Boolean)
  if (!s.project || nodes.length < 2) { float.hidden = true; return }
  patch(float, `<span class="vc-float-count">${nodes.length}개 선택</span>${nodes.some(node => node.kind === 'cut' || node.kind === 'gen') ? fbtn('duplicate-selected', '복제') : ''}${fbtn('remove-selected', '삭제', 'destructive')}`)
  float.hidden = false
}

// ---- menus ----
const SOURCES = ['image', 'video', 'audio', 'bundle']
export const sourceItems = at => SOURCES.map(kind => ({ label: `${names[kind]} 가져오기…`, run: () => picker(kind, at) }))
export const addItems = at => [{ label: '영상 컷 추가', run: () => addCut(at) }, { label: '생성 노드 추가', run: () => addGen(at) }, { sep: true }, ...sourceItems(at)]
export function nodeMenu(node) {
  const ids = s.sel.includes(node.id) ? s.sel : [node.id], hash = node.data.ref?.source === 'library' ? node.data.ref.compositeHash : null
  const cut = node.kind === 'cut', runs = cut || node.kind === 'gen', rep = runs ? repTake(node) : null
  // A sound's result is an audio candidate, not a library item, so it has no detail page.
  const openable = rep && takeOutput(rep) !== 'audio'
  return [
    runs && { label: '생성', run: () => runFor(node.id) },
    s.open.includes(node.id) && { label: '접기', run: () => foldFrame(node.id) },
    { label: '설정·상세 열기', run: () => showInspector(true) },
    runs && { label: cut ? '워크플로 바꾸기' : '생성 설정 바꾸기', run: () => changeWorkflow(node.id) },
    cut && { label: '앞 컷에서 이어가기', run: () => continueFromPrevious(node.id) },
    runs && { label: ids.length > 1 ? '복제 (선택 전체)' : '복제', run: () => duplicateCuts(ids) },
    openable && { label: '결과 상세에서 열기', run: () => openDetail(rep.resultHash) },
    rep && cut && { label: '결과 프레임 추출', run: () => extractFrom({ takeId: rep.id }) },
    hash && { label: '상세에서 열기', run: () => openDetail(hash) },
    hash && node.kind === 'video' && { label: '프레임 추출', run: () => extractFrom({ nodeId: node.id }) },
    { sep: true },
    { label: ids.length > 1 ? `삭제 (${ids.length}개)` : '삭제', danger: true, run: () => removeNodes(ids) },
  ]
}
function takeMenu(cut, take) {
  return [
    take.resultHash && { label: '대표로 지정', run: () => pickTake(cut.id, take.id) },
    take.resultHash && takeOutput(take) !== 'audio' && { label: '상세에서 열기', run: () => openDetail(take.resultHash) },
    take.resultHash && cut.kind === 'cut' && { label: '프레임 추출', run: () => extractFrom({ takeId: take.id }) },
    { sep: true },
    { label: '같은 시드로 다시 생성', disabled: s.runBusy, run: () => takeAction('rerun-canvas', take.id) },
    { label: '새 시드로 다시 생성', disabled: s.runBusy, run: () => takeAction('rerun-new', take.id) },
  ]
}
function onContextMenu(event) {
  if (!s.project || event.target.closest('input, textarea, select, .vc-float, .vc-toast, .vc-seq-player, .vc-controls, .vc-tray-wrap')) return
  event.preventDefault()
  const chip = event.target.closest('.vc-link-chip')
  if (chip) return chip.dataset.edge ? showMenu(event.clientX, event.clientY, linkMenu(chip.dataset.edge)) : undefined
  const nodeElement = event.target.closest('.vc-node'), media = event.target.closest('.vc-media[data-take]'), slot = event.target.closest('.vc-slot[data-edge]'), edgeEl = event.target.closest('.vc-edge')
  const edgeId = edgeEl?.dataset.edge || slot?.dataset.edge
  const node = nodeById(nodeElement?.dataset.id)
  if (node && !s.sel.includes(node.id)) { applySelection([node.id]); void task(() => request('read_node', { id: node.id })) }
  if (media && (node?.kind === 'cut' || node?.kind === 'gen')) {
    const take = s.project.takes.find(item => item.id === media.dataset.take)
    if (take) return showMenu(event.clientX, event.clientY, takeMenu(node, take))
  }
  if (edgeId) {
    const edge = s.project.edges.find(item => item.id === edgeId), from = nodeById(edge?.from)
    return showMenu(event.clientX, event.clientY, from && frameRole(from) === 'link' ? linkMenu(edgeId) : [{ label: '연결 끊기', danger: true, run: () => removeEdge(edgeId) }])
  }
  if (node) return showMenu(event.clientX, event.clientY, nodeMenu(node))
  if (s.sel.length || s.edgeSel) applySelection([])
  showMenu(event.clientX, event.clientY, addItems(toStage(event.clientX, event.clientY)))
}

// ---- pointer: select, move, pan, connect ----
let drag = null
const formControl = 'button, input, select, textarea, audio, summary'
function onPointerDown(event) {
  if (!s.project || event.button !== 0 || event.target.closest('.vc-controls, .vc-float, .vc-toasts, .vc-seq-player, .vc-link-chip, .vc-tray-wrap, .vc-empty-canvas')) return
  const target = event.target
  const out = target.closest('.vc-output')
  if (out) return startLink(event, out.closest('[data-id]').dataset.id, null)
  const input = target.closest('.vc-input')
  if (input) {
    // A frame folded into a link has no card to drag from: replace it by dropping something else on the slot.
    const edge = s.project.edges.find(item => item.id === input.closest('.vc-slot').dataset.edge)
    return edge && nodeEl(edge.from) ? startLink(event, edge.from, edge) : undefined
  }
  const edgeEl = target.closest('.vc-edge'), nodeElement = target.closest('.vc-node')
  if (document.activeElement?.closest?.('.vc-node') && document.activeElement !== nodeElement) document.activeElement.blur()
  if (edgeEl) {
    applySelection([]); s.edgeSel = edgeEl.dataset.edge
    drawEdges(); ctx.hooks.afterSelection?.()
    return
  }
  if (!nodeElement) {
    if (!event.shiftKey && (s.sel.length || s.edgeSel)) applySelection([])
    drag = { kind: 'pan', x: event.clientX, y: event.clientY, ox: s.x, oy: s.y, moved: false }
    return
  }
  const id = nodeElement.dataset.id, additive = event.shiftKey || event.ctrlKey || event.metaKey
  let collapse = null, changed = false
  if (additive) changed = applySelection(s.sel.includes(id) ? s.sel.filter(item => item !== id) : [...s.sel, id])
  else if (!s.sel.includes(id)) changed = applySelection([id])
  else if (s.sel.length > 1) collapse = id
  if (changed && s.selection) void task(() => request('read_node', { id: s.selection }))
  if (target.closest(formControl)) return
  drag = { kind: 'nodes', x: event.clientX, y: event.clientY, moved: false, collapse, items: s.sel.map(item => ({ id: item, node: nodeById(item), el: nodeEl(item) })).filter(item => item.node && item.el).map(item => ({ ...item, ox: item.node.x, oy: item.node.y })) }
}
function onPointerMove(event) {
  if (link) return updateLink(event)
  if (!drag) return
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y
  if (!drag.moved) {
    if (Math.abs(dx) + Math.abs(dy) <= 4) return
    drag.moved = true
    $('canvas').setPointerCapture?.(event.pointerId)
  }
  if (drag.kind === 'pan') { s.x = drag.ox + dx; s.y = drag.oy + dy; return transform() }
  for (const item of drag.items) { item.el.style.left = `${item.ox + dx / s.zoom}px`; item.el.style.top = `${item.oy + dy / s.zoom}px` }
  drawEdges()
}
function onPointerUp(event) {
  if (link) return releaseLink(event)
  if (!drag) return
  const done = drag; drag = null
  if (done.kind !== 'nodes') return
  if (!done.moved) {
    if (done.collapse) { applySelection([done.collapse]); void task(() => request('read_node', { id: done.collapse })) }
    return
  }
  const dx = (event.clientX - done.x) / s.zoom, dy = (event.clientY - done.y) / s.zoom
  // Optimistic: the nodes stay where they were dropped while the edit saves.
  const ops = done.items.map(item => { item.node.x = Math.round(item.ox + dx); item.node.y = Math.round(item.oy + dy); return { op: 'move', id: item.id, x: item.node.x, y: item.node.y } })
  void ui(() => edit(ops))
}
function onKeyDown(event) {
  if (!s.project || $('modal').open) return
  if (event.key === 'Escape') {
    if (link) endLink()
    else if (s.sel.length || s.edgeSel) applySelection([])
    return
  }
  if (event.target.closest?.('input, textarea, select, [contenteditable]')) return
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault()
    if (s.edgeSel) void removeEdge(s.edgeSel)
    else if (s.sel.length) void removeNodes([...s.sel])
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
    event.preventDefault()
    void duplicateCuts([...s.sel])
  } else if ((event.key === 'Enter' || event.key === ' ') && event.target.classList?.contains('vc-node')) {
    event.preventDefault()
    applySelection([event.target.dataset.id])
  }
}
export function bindCanvas() {
  const canvas = $('canvas')
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', () => { if (link) endLink(); drag = null })
  canvas.addEventListener('contextmenu', onContextMenu)
  document.addEventListener('keydown', onKeyDown)
  canvas.addEventListener('dblclick', event => {
    if (event.target.closest(formControl)) return
    const hash = event.target.closest('[data-hash]')?.dataset.hash
    if (hash) void openDetail(hash)
  })
  canvas.addEventListener('wheel', event => {
    if (!s.project || link || event.target.closest('.vc-seq-player, .vc-tray') || (event.target.closest('textarea') && document.activeElement === event.target)) return
    event.preventDefault()
    const rect = canvas.getBoundingClientRect()
    zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX - rect.x, event.clientY - rect.y)
  }, { passive: false })
  const middle = () => [canvas.clientWidth / 2, canvas.clientHeight / 2]
  $('zoom-in').onclick = () => zoomAt(1.2, ...middle())
  $('zoom-out').onclick = () => zoomAt(1 / 1.2, ...middle())
  $('zoom').onclick = () => zoomAt(1 / s.zoom, ...middle())
  $('fit').onclick = () => fit()
  $('arrange').onclick = event => void ui(async () => { if (s.project.nodes.length) await edit(arrangeOps()) }, event.currentTarget)
  // 소재 선 on: every source line; off: only the lines of what is selected. Links and order rails always draw.
  $('edges-toggle').onclick = () => {
    s.edges = s.edges === 'all' ? 'selected' : 'all'
    $('edges-toggle').setAttribute('aria-pressed', String(s.edges === 'all'))
    drawEdges()
  }
}
