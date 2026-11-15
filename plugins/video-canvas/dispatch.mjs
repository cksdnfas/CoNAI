import { cutEdges } from './domain.mjs'
import { $ } from './util.mjs'
import { s, nodeById, shownTake, activeChain } from './state.mjs'
import { toast } from './toast.mjs'
import { showMenu } from './menu.mjs'
import { request, ui, edit, reload, doCheck, openDetail, showInspector } from './session.mjs'
import { applySelection, removeNodes, removeEdge, duplicateCuts, pickTake, cycleTake, takeAction, runFor, changeWorkflow, extractFrom, continueFromPrevious, onFieldChange, foldFrame } from './actions.mjs'
import { cancelExport, cancelChain, playExport } from './sequence.mjs'
import { nodeMenu } from './canvas.mjs'

const TAKE_ACTIONS = ['approve', 'discard', 'retry', 'cancel', 'rerun-take', 'rerun-canvas', 'rerun-new']
async function reorderEdge(edgeId, direction) {
  const edge = s.project.edges.find(item => item.id === edgeId)
  const peers = cutEdges(s.project, nodeById(edge.to), false).filter(item => item.port === edge.port).map(item => item.id)
  const from = peers.indexOf(edgeId), to = from + direction
  if (to < 0 || to >= peers.length) return
  peers.splice(from, 1); peers.splice(to, 0, edgeId)
  await edit([{ op: 'reorder', cut: edge.to, port: edge.port, order: peers }])
}
function dispatch(target) {
  const action = target.dataset.action, id = target.closest('[data-id]')?.dataset.id, takeId = target.dataset.take, item = target.dataset.item
  if (action === 'run' || action === 'propose') return void runFor(id, action === 'propose' ? 'propose' : 'now')
  if (TAKE_ACTIONS.includes(action)) return void takeAction(action, takeId)
  if (action === 'take-prev' || action === 'take-next') return cycleTake(id, action === 'take-prev' ? -1 : 1)
  if (action === 'take-pick') return void pickTake(id ?? s.project.takes.find(take => take.id === takeId).cutId, takeId ?? shownTake(nodeById(id)).id)
  if (action === 'node-menu') {
    const node = nodeById(id)
    if (!node) return
    if (!s.sel.includes(id)) { applySelection([id]); void ui(() => request('read_node', { id })) }
    const rect = target.getBoundingClientRect()
    return showMenu(rect.left, rect.bottom + 4, nodeMenu(node))
  }
  if (action === 'fold-frame') return foldFrame(id)
  if (action === 'chain-cancel') return void (activeChain() && cancelChain(activeChain().id))
  if (action === 'check-all') return void ui(() => doCheck(), target)
  if (action === 'open-settings') { s.tab = 'detail'; if (id && s.selection !== id) applySelection([id]); return showInspector(true) }
  if (action === 'pick-workflow') return void changeWorkflow(id)
  if (action === 'continue-prev') return void continueFromPrevious(id)
  if (action === 'disconnect') return void removeEdge(target.dataset.edge)
  if (action === 'remove') return void removeNodes([id])
  if (action === 'remove-selected') return void removeNodes([...s.sel])
  if (action === 'duplicate-selected') return void duplicateCuts([...s.sel])
  if (action === 'open-detail') return void openDetail(target.dataset.hash)
  if (action === 'extract') return void extractFrom({ nodeId: id })
  if (action === 'extract-take') return void extractFrom({ takeId })
  if (action === 'export-cancel') return void cancelExport(target.dataset.export)
  if (action === 'export-play') return playExport(target.dataset.export)
  if (action === 'keep') return toast('가져온 지문은 그대로 둘게. 변경 경고는 남아.')
  void ui(async () => {
    if (action === 'up' || action === 'down') return reorderEdge(target.dataset.edge, action === 'up' ? -1 : 1)
    if (action === 'seed') return edit([{ op: 'set', id, fields: { seed: crypto.getRandomValues(new Uint32Array(1))[0] & 2147483647 } }])
    if (action === 'refresh-take') { await request('get_take', { take_id: takeId }); return reload() }
    if (action === 'extraction-status' || action === 'extraction-cancel') { await request('extract_frame', { expected_revision: s.project.revision, extraction_id: target.dataset.extraction, cancel: action === 'extraction-cancel' }); return reload() }
    if (action === 'review') {
      const reviewed = nodeById(item) ?? s.project.takes.find(take => take.id === item)
      await request('human_review', { expected_revision: s.project.revision, ops: [{ op: 'review', id: reviewed.id, status: target.dataset.review, memo: reviewed.memo }] }); return reload()
    }
    if (action === 'fingerprint') { await request('accept_fingerprint', { expected_revision: s.project.revision, id: item }); return doCheck() }
    if (action === 'undo') { await request('undo', { expected_revision: s.project.revision }); return reload() }
  }, target)
}
export function bindDispatch() {
  document.addEventListener('click', event => {
    const token = event.target.closest('[data-token]')
    if (token) {
      const field = $('insp-body').querySelector('[data-field=prompt]')
      field.value += ` @${token.dataset.token} `; field.dispatchEvent(new Event('change', { bubbles: true }))
      return
    }
    const tab = event.target.closest('[data-tab]')
    if (tab) { s.tab = tab.dataset.tab; showInspector(true, false); return }
    const target = event.target.closest('[data-action]')
    if (target && !target.disabled) dispatch(target)
  })
  document.addEventListener('change', event => {
    const field = event.target
    if (field.dataset && (field.dataset.field || field.dataset.prop || field.dataset.memo || field.dataset.pf)) void ui(() => onFieldChange(field))
  })
}
