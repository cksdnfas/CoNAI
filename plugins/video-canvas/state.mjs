import { createAssistantState } from './assistant-state.mjs'
import { PORTS, GEN_PORTS, adapterOf, outputOf, withResults, staleUpstream } from './domain.mjs'
import { isTerminal, fraction } from './util.mjs'

export const DOCK_H = 212
// `sel` is the multi-selection; `selection` is the primary node the inspector and assistant follow. `open` lists the extracted
// frames the person pulled out as cards (the project's stored view keeps it); `edges` is 'all' sources' lines or only the selection's.
export const s = {
  project: null, projects: [], projectTotal: 0, nextOffset: null, home: { query: '', sort: 'updated', archived: false, loading: false },
  sel: [], selection: null, edgeSel: null, edges: 'all', x: 24, y: 24, zoom: 1, open: [], ghostEdge: null,
  launch: null, checks: null, tab: 'detail', batch: null, runBusy: false,
  wf: null, viewTake: {}, inspectorOpen: false, seqOpen: true, seqH: DOCK_H,
}
// hooks let lower modules call the renderers without importing them (no import cycles).
export const ctx = { api: null, hooks: {}, launchName: null, view: { last: null, views: {}, inspector: false, seq: true, seqH: DOCK_H } }
// The server's read of the selected node arrives after the selection is drawn; what shows it (the inspector's checks and guide,
// the card's warning badge) redraws when it does.
let nodeDetail = null
Object.defineProperty(s, 'nodeDetail', { enumerable: true, get: () => nodeDetail, set(value) { nodeDetail = value; if (value) ctx.hooks.nodeRead?.() } })
export const assistant = createAssistantState()
export const nodeById = id => s.project?.nodes?.find(node => node.id === id)
export const selected = () => nodeById(s.selection)
export const cuts = () => s.project?.nodes?.filter(node => node.kind === 'cut') ?? []
export const takesOf = cutId => (s.project?.takes ?? []).filter(take => take.cutId === cutId)
/** A take listed outside its own cut is titled by the cut and its ordinal; the workflow name is only secondary text. */
export function takeTitle(take) {
  const cut = s.project?.nodes?.find(node => node.id === take.cutId)
  return cut ? `${cut.data.name} · take ${takesOf(cut.id).findIndex(item => item.id === take.id) + 1}` : take.label
}
export const profileOf =cut => s.project?.profiles?.find(profile => profile.id === cut?.data.profileId)
/** The kind each input slot takes: a cut's typed slots and a generation node's image slots. */
export const SLOT_KINDS = { ...PORTS, ...GEN_PORTS }
/** Generation nodes' profiles (workflow or NovelAI); a cut's Director profiles stay out of this list. */
export const genProfiles = () => (s.project?.profiles ?? []).filter(profile => adapterOf(profile) !== 'director')
/** What a node feeds into a slot: a generation node's result kind (null until it has a profile), a frame is an image, a cut a video. */
export function outputKind(node) {
  if (node.kind === 'gen') { const profile = profileOf(node); return profile ? outputOf(profile) : null }
  return node.kind === 'frame' ? 'image' : node.kind === 'cut' ? 'video' : node.kind
}
/** A take's result kind; cut takes carry none and are videos. */
export const takeOutput = take => take.output ?? 'video'
/** A generation node's image inputs: the connections in slot order and the profile's image fields they fill. */
export function genInputs(node) {
  const edges = (s.project?.edges ?? []).filter(edge => edge.to === node.id).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
  return { edges, fields: profileOf(node)?.imageFieldIds ?? [] }
}
const finishedTakes = () => (s.project?.takes ?? []).filter(take => take.resultHash).length
const stamps = new WeakMap()
/** True while a server read or check is still about the canvas on screen: a take finishing changes no revision, but it can change a check. */
export function current(read) {
  if (!read) return false
  if (!stamps.has(read)) stamps.set(read, { revision: read.revision ?? s.project.revision, finished: finishedTakes() })
  const stamp = stamps.get(read)
  return stamp.revision === s.project.revision && stamp.finished === finishedTakes()
}
/** The server's check { errors, warnings } of a cut or generation node: the read of the open node, else the last full check. Nothing is judged here. */
export function checkOf(node) {
  if (s.nodeDetail?.node.id === node.id && s.nodeDetail.preview?.checks && current(s.nodeDetail)) return s.nodeDetail.preview.checks
  return current(s.checks) ? s.checks.cuts.find(item => item.id === node.id) ?? null : null
}
// The stale-input rule compares the upstream results recorded on a node's representing take (its snapshot) with each generation node's current result (what
// withResults adds): all of it is in the project the page loaded, so it runs here on every load with no check and no server call. The copy is made once per loaded project.
let resultsView = null
function staleOf(node) {
  if (resultsView?.project !== s.project) resultsView = { project: s.project, view: withResults(s.project), warnings: new Map() }
  if (!resultsView.warnings.has(node.id)) resultsView.warnings.set(node.id, staleUpstream(resultsView.view, node))
  return resultsView.warnings.get(node.id)
}
/** The stale-input warnings of a cut or generation node (its result was made from a generation node's older result): the server's own check when it is current, else the same rule run on the loaded project. */
export const staleWarnings = node => checkOf(node)?.warnings.filter(warning => warning.code === 'stale-input') ?? staleOf(node)
export const staleWarning = node => staleWarnings(node)[0] ?? null
/** The take that stands for the cut: the one marked on the cut, else the latest with a result. */
export function repTake(cut) {
  const takes = takesOf(cut.id)
  return takes.find(take => take.id === cut.data.pickTakeId && take.resultHash) ?? takes.filter(take => take.resultHash).at(-1) ?? null
}
/** A completed take whose result is not there yet: the server is still finishing it while it has a history row and has not given up on it. */
export const finishing = take => take.status === 'completed' && !take.resultHash && Boolean(take.historyId) && !take.postprocessFailed && !take.error
/** A failed take, or a completed one that will never have a result (no output, or its postprocessing failed). */
export const failedTake = take => take.status === 'failed' || take.status === 'completed' && !take.resultHash && !finishing(take)
const working = take => !isTerminal(take.status) && take.status !== 'proposed' || finishing(take)
/** The take shown on the node: the one picked with the switcher, else a running one, else the representing one. */
export function shownTake(cut) {
  const takes = takesOf(cut.id).filter(take => take.status !== 'discarded')
  return takes.find(take => take.id === s.viewTake[cut.id]) ?? takes.filter(working).at(-1) ?? repTake(cut) ?? takes.at(-1) ?? null
}
/** Cut IDs in sequence order; cuts the sequence does not list yet follow in canvas order. */
export function cutOrder() {
  const all = cuts().map(cut => cut.id), seq = [...new Set(s.project?.sequence ?? [])].filter(id => all.includes(id))
  return [...seq, ...all.filter(id => !seq.includes(id))]
}
export const prevCut = cut => { const order = cutOrder(); return nodeById(order[order.indexOf(cut.id) - 1]) }

// ---- the running 이어 생성 and the one state vocabulary of a cut (the canvas card and the sequence dock both read it) ----
export const activeChain = () => (s.project?.chains ?? []).find(chain => !isTerminal(chain.status))
export const stepOf = cut => activeChain()?.steps.find(step => step.cutId === cut.id)
const WAITING = ['queued', 'pending', 'preparing', 'submitting', 'starting']
/** { key: empty|done|waiting|queued|generating|current|failed|proposed, word, ratio, take, step } */
export function cutState(cut) {
  const takes = takesOf(cut.id).filter(take => take.status !== 'discarded'), chain = activeChain(), step = stepOf(cut)
  const live = takes.filter(working).at(-1), last = takes.at(-1), ratio = live && !finishing(live) ? fraction(live.progress) : null
  const percent = ratio === null ? '' : ` ${Math.round(ratio * 100)}%`
  if (step && chain.current === cut.id && ['extracting', 'generating'].includes(step.status)) return { key: 'current', word: `이어 생성 ${chain.steps.indexOf(step) + 1}/${chain.steps.length}`, ratio, take: live ?? null, step }
  if (live) return WAITING.includes(live.status) ? { key: 'queued', word: '대기 중', ratio, take: live, step } : { key: 'generating', word: finishing(live) ? '마무리 중' : `생성 중${percent}`, ratio, take: live, step }
  if (step?.status === 'pending') return { key: 'waiting', word: '대기', ratio: null, take: null, step }
  if (last?.status === 'proposed') return { key: 'proposed', word: '승인 대기', ratio: null, take: last, step }
  // A cancelled latest take is not a result and not a failure: the cut reads as it did before the run (done by an earlier take, or empty).
  if (last && failedTake(last)) return { key: 'failed', word: '실패', ratio: null, take: last, step }
  const rep = repTake(cut)
  return rep ? { key: 'done', word: '', ratio: null, take: rep, step } : { key: 'empty', word: '', ratio: null, take: null, step }
}

// ---- extracted frames: a frame taken from another cut's result is a link, not a card ----
/** The cut and take an extracted frame came from, when both are still in this project (a duplicated project's frames point to takes that are not). */
export function frameSource(node) {
  const takeId = node.kind === 'frame' ? node.data.origin?.takeId : null
  const take = takeId && s.project.takes.find(item => item.id === takeId), cut = take && nodeById(take.cutId)
  return cut?.kind === 'cut' ? { cut, take } : null
}
/** card: a node on the canvas · link: folded into an edge between two cuts · tray: extracted and not used anywhere. */
export function frameRole(node) {
  const origin = node.kind === 'frame' ? node.data.origin : null
  if (!origin || s.open.includes(node.id)) return 'card'
  const outgoing = s.project.edges.filter(edge => edge.from === node.id), source = frameSource(node)
  if (source) return !outgoing.length ? 'tray' : outgoing.some(edge => edge.to === source.cut.id) ? 'card' : 'link'
  if (origin.takeId) return 'card'
  return !outgoing.length && nodeById(origin.nodeId) ? 'tray' : 'card'
}
export const trayFrames = () => (s.project?.nodes ?? []).filter(node => frameRole(node) === 'tray')
/**
 * Every edge that comes from a folded frame: { edge, frame, source, take, target, stale }.
 * `withOpen` also counts frames pulled out as cards, which still chain their cuts.
 */
export function allLinks(withOpen = false) {
  const links = []
  for (const edge of s.project?.edges ?? []) {
    const frame = nodeById(edge.from)
    if (frame?.kind !== 'frame') continue
    if (frameRole(frame) !== 'link' && !(withOpen && s.open.includes(frame.id) && frameSource(frame) && frameSource(frame).cut.id !== edge.to)) continue
    const { cut: source, take } = frameSource(frame), target = nodeById(edge.to)
    if (target) links.push({ edge, frame, source, take, target, stale: repTake(source)?.id !== take.id })
  }
  return links
}
const POSITIONS = { first: '처음', middle: '가운데', last: '마지막' }
/** "Cut 1 · 마지막": which cut, and where in it, a frame was taken from. */
export function frameLabel(frame) {
  const origin = frame.data.origin, source = frameSource(frame)?.cut ?? nodeById(origin?.nodeId)
  const where = POSITIONS[origin?.position] ?? (origin?.seconds != null ? `${Number(Number(origin.seconds).toFixed(1))}초` : origin?.frame_index != null ? `${origin.frame_index}번` : '')
  return [source?.data.name, where].filter(Boolean).join(' · ') || frame.data.name
}
