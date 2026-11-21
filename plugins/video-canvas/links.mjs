import { $, esc, clamp, ports, thumbUrl, patch } from './util.mjs'
import { continuationPort, activePorts } from './domain.mjs'
import { s, ctx, nodeById, cutOrder, allLinks, activeChain, frameSource, frameLabel, trayFrames, continues, activeContinuation, SLOT_KINDS } from './state.mjs'
import { nodeEl } from './nodes.mjs'
import { showMenu } from './menu.mjs'
import { openDetail } from './session.mjs'
import { applySelection, continueFromPrevious, linkMenu, takeOutFrame, eraseFrames } from './actions.mjs'

// ---- geometry ----
export const center = el => { const rect = el.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } }
export const curve = (a, b) => { const dx = clamp(Math.abs(b.x - a.x) / 2, 40, 220); return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}` }
export const inStage = (point, stage) => ({ x: (point.x - stage.x) / s.zoom, y: (point.y - stage.y) / s.zoom })

// ---- hover and selection emphasis (no redraw: classes only) ----
let hover = { node: null, edge: null }
function markHot() {
  const nodeHot = id => s.sel.includes(id) || hover.node === id
  for (const group of $('edge-layer').querySelectorAll('.vc-edge')) {
    const edge = group.dataset.edge
    group.classList.toggle('hot', Boolean(edge && edge === hover.edge) || group.classList.contains('src') && (nodeHot(group.dataset.from) || nodeHot(group.dataset.to)))
  }
}
const chipEls = new Map()
function syncChips(list) {
  const host = $('nodes'), keep = new Set()
  for (const chip of list) {
    keep.add(chip.key)
    let el = chipEls.get(chip.key)
    if (!el) { el = document.createElement('button'); el.dataset.chip = chip.key; chipEls.set(chip.key, el) }
    if (!el.isConnected) host.append(el)
    el.className = `vc-link-chip ${chip.cls}`; el.dataset.edge = chip.edge ?? ''; el.dataset.cut = chip.cut ?? ''
    el.style.left = `${chip.x}px`; el.style.top = `${chip.y}px`
    el.title = chip.title; el.setAttribute('aria-label', chip.title)
    if (chip.edge) el.setAttribute('aria-pressed', String(chip.edge === s.edgeSel))
    patch(el, chip.html)
  }
  for (const [key, el] of chipEls) if (!keep.has(key)) { el.remove(); chipEls.delete(key) }
}
const RUNNING = ['extracting', 'generating']
/**
 * Redraws every line and the chips that sit on them:
 * - a link (a frame of one cut's result feeding another cut) is a thick line with the frame as a chip at its middle;
 * - cuts that are not linked get a dotted order rail, with a 잇기 chip where the next cut can continue (an empty start slot, or a REF2VA cut);
 *   a frame on a slot the cut's mode ignores links nothing and draws dashed;
 * - source lines follow the 소재 선 toggle; links and rails always draw.
 */
export function drawEdges() {
  const layer = $('edge-layer')
  if (!s.project) { layer.innerHTML = ''; syncChips([]); return }
  const stage = $('stage').getBoundingClientRect()
  const slots = new Map([...$('nodes').querySelectorAll('.vc-slot[data-edge]')].filter(slot => slot.dataset.edge).map(slot => [slot.dataset.edge, slot]))
  const at = el => el && inStage(center(el), stage)
  const output = id => at(nodeEl(id)?.querySelector('.vc-output'))
  const mediaLeft = id => { const rect = nodeEl(id)?.querySelector('.vc-mw')?.getBoundingClientRect(); return rect && inStage({ x: rect.left, y: rect.top + rect.height / 2 }, stage) }
  const chain = activeChain(), links = allLinks(), linkIds = new Set(links.map(link => link.edge.id)), order = cutOrder().map(nodeById)
  const items = [], chips = []
  const middle = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  // order rails between consecutive cuts that are not chained
  // (a continuation frame on the start slot or among a REF2VA cut's reference images, or the cut before's frame on the end slot)
  const chained = new Set(allLinks(true).filter(link => (link.edge.port === 'end' || activeContinuation(link.edge)) && order[order.indexOf(link.target) - 1]?.id === link.source.id).map(link => link.target.id))
  const used = edge => { const cut = nodeById(edge.to); return cut?.kind !== 'cut' || activePorts(cut.data.mode).includes(edge.port) }
  order.forEach((cut, index) => {
    if (!index || chained.has(cut.id)) return
    const before = order[index - 1], a = output(before.id), b = mediaLeft(cut.id)
    if (!a || !b) return
    items.push({ cls: 'rail', d: curve(a, b), from: before.id, to: cut.id })
    if (continuationPort(cut.data.mode) === 'ref_image' || !s.project.edges.some(edge => edge.to === cut.id && edge.port === 'start')) chips.push({ key: `o:${cut.id}`, cls: 'offer', cut: cut.id, ...middle(a, b), html: '잇기', title: `${before.data.name}의 마지막 프레임으로 이어가기` })
  })
  for (const link of links) {
    const a = output(link.source.id), b = at(slots.get(link.edge.id)?.querySelector('.vc-input'))
    if (!a || !b) continue
    const single = used(link.edge) && (['start', 'end'].includes(link.edge.port) || continues(link.edge)), step = chain?.steps.find(item => item.cutId === link.target.id)
    const running = single && chain?.current === link.target.id && RUNNING.includes(step?.status)
    const label = frameLabel(link.frame)
    items.push({ cls: `${single ? 'chain' : 'refimg'}${used(link.edge) ? '' : ' unused'}${link.stale ? ' stale' : ''}${running ? ' run' : ''}`, d: curve(a, b), from: link.source.id, to: link.target.id, edge: link.edge.id, hit: true })
    chips.push({ key: `l:${link.edge.id}`, cls: 'link', edge: link.edge.id, ...middle(a, b), title: `${label} → ${link.target.data.name} ${ports[link.edge.port]}${link.stale ? ' · 앞 컷이 다시 만들어졌어. 다시 뽑기로 새 결과를 가져와.' : ''}`,
      html: `<img src="${thumbUrl(link.frame.data.ref.compositeHash)}" alt="">${link.stale ? '<span class="conai-overlay-badge xs warn">이전</span>' : ''}` })
  }
  // a frame pulled out as a card: the cut it came from points at it
  for (const node of s.project.nodes) {
    const source = node.kind === 'frame' && nodeEl(node.id) && frameSource(node), a = source && output(source.cut.id), b = source && mediaLeft(node.id)
    if (a && b) items.push({ cls: 'chain', d: curve(a, b), from: source.cut.id, to: node.id })
  }
  for (const edge of s.project.edges) {
    if (linkIds.has(edge.id)) continue
    const from = nodeById(edge.from), a = output(edge.from), b = at(slots.get(edge.id)?.querySelector('.vc-input'))
    if (!from || !a || !b) continue
    const pulled = from.kind === 'frame' && Boolean(frameSource(from)) && used(edge) && (['start', 'end'].includes(edge.port) || continues(edge))
    if (!pulled && s.edges !== 'all' && !s.sel.includes(edge.from) && !s.sel.includes(edge.to) && edge.id !== s.edgeSel) continue
    items.push({ cls: pulled ? 'chain' : `src${slots.get(edge.id).classList.contains('unused') ? ' unused' : ''}`, d: curve(a, b), from: edge.from, to: edge.to, edge: edge.id, kind: SLOT_KINDS[edge.port], hit: true })
  }
  layer.innerHTML = items.map(item => `<g class="vc-edge ${item.cls}${item.edge && item.edge === s.edgeSel ? ' sel' : ''}${item.edge && item.edge === s.ghostEdge ? ' ghost' : ''}" data-edge="${esc(item.edge ?? '')}" data-from="${esc(item.from)}" data-to="${esc(item.to)}" ${item.kind ? `data-kind="${item.kind}"` : ''}>${item.hit ? `<path class="hit" d="${item.d}"/>` : ''}<path class="line" d="${item.d}"/></g>`).join('')
  syncChips(chips)
  markHot()
}
function linkFrame(edgeId) { const edge = s.project.edges.find(item => item.id === edgeId); return edge && nodeById(edge.from) }

// ---- the tray: extracted frames that are used nowhere ----
let trayOpen = false
export function renderTray() {
  const frames = s.project ? trayFrames() : []
  if (!frames.length) trayOpen = false
  $('tray').hidden = !frames.length
  $('tray-chip').textContent = `남은 프레임 ${frames.length}`
  $('tray-chip').setAttribute('aria-pressed', String(trayOpen))
  $('tray-pop').hidden = !trayOpen
  if (trayOpen) patch($('tray-pop'), `<div class="vc-tray-head"><b>남은 프레임</b><button class="sm" data-tray="clear">모두 지우기</button></div><div class="vc-tray-grid">${frames.map(frame => `<div class="vc-tray-item" data-frame="${esc(frame.id)}"><span class="conai-media"><img src="${thumbUrl(frame.data.ref.compositeHash)}" alt="" loading="lazy"></span><span class="conai-media-title" title="${esc(frameLabel(frame))}">${esc(frameLabel(frame))}</span><span class="toolbar"><button class="sm" data-tray="open">꺼내기</button><button class="sm ghost" data-tray="erase">지우기</button></span></div>`).join('')}</div>`)
}
export function bindLinks() {
  const host = $('nodes')
  host.addEventListener('click', event => {
    const chip = event.target.closest('.vc-link-chip')
    if (!chip) return
    if (chip.dataset.cut) return void continueFromPrevious(chip.dataset.cut)
    applySelection([]); s.edgeSel = chip.dataset.edge
    drawEdges(); ctx.hooks.afterSelection?.()
    const rect = chip.getBoundingClientRect()
    showMenu(rect.left, rect.bottom + 4, linkMenu(chip.dataset.edge))
  })
  host.addEventListener('dblclick', event => {
    const chip = event.target.closest('.vc-link-chip[data-edge]'), hash = chip?.dataset.edge && linkFrame(chip.dataset.edge)?.data.ref.compositeHash
    if (hash) void openDetail(hash)
  })
  host.addEventListener('pointerover', event => {
    const chip = event.target.closest('.vc-link-chip'), node = event.target.closest('.vc-node')?.dataset.id ?? null, edge = chip?.dataset.edge || null
    if (hover.node === node && hover.edge === edge) return
    hover = { node, edge }; markHot()
  })
  host.addEventListener('pointerout', event => { if (!event.relatedTarget?.closest?.('.vc-node, .vc-link-chip') && (hover.node || hover.edge)) { hover = { node: null, edge: null }; markHot() } })
  $('edge-layer').addEventListener('pointerover', event => { const edge = event.target.closest('.vc-edge')?.dataset.edge || null; if (hover.edge !== edge) { hover = { node: null, edge }; markHot() } })
  $('edge-layer').addEventListener('pointerout', () => { if (hover.edge) { hover = { node: null, edge: null }; markHot() } })
  $('tray-chip').onclick = () => { trayOpen = !trayOpen; renderTray() }
  $('tray-pop').addEventListener('click', event => {
    const action = event.target.closest('[data-tray]')?.dataset.tray, id = event.target.closest('[data-frame]')?.dataset.frame
    if (action === 'open') { trayOpen = false; renderTray(); void takeOutFrame(id) }
    if (action === 'erase') void eraseFrames([id])
    if (action === 'clear') void eraseFrames(trayFrames().map(frame => frame.id))
  })
  document.addEventListener('pointerdown', event => { if (trayOpen && !event.target.closest('#tray')) { trayOpen = false; renderTray() } })
}
