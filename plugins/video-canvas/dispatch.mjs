import { cutEdges, sentField } from './domain.mjs'
import { $ } from './util.mjs'
import { s, nodeById, shownTake, activeChain, cutState, cutRunning, prevCut, upscaleRetry } from './state.mjs'
import { toast } from './toast.mjs'
import { showMenu, menuAt } from './menu.mjs'
import { request, ui, edit, reload, doCheck, openDetail, showInspector, RUN_ACTIONS } from './session.mjs'
import { cutActions } from './nodes.mjs'
import { genSettingItems } from './workflow.mjs'
import { applySelection, focusNode, removeNodes, removeEdge, duplicateCuts, pickTake, cycleTake, takeAction, runFor, chooseSetting, extractFrom, continueFromPrevious, onFieldChange, foldFrame, repull, moveLink, genSetting } from './actions.mjs'
import { openSettings } from './settings.mjs'
import { renderInspector, promptTabOf } from './inspector.mjs'
import { inkField } from './ink.mjs'
import { cancelExport, cancelChain, playExport } from './sequence.mjs'
import { nodeMenu } from './canvas.mjs'

const TAKE_ACTIONS = ['approve', 'discard', 'retry', 'cancel', 'rerun-take', 'rerun-canvas', 'rerun-new', 'upscale', 'upscale-again']
async function reorderEdge(edgeId, direction) {
  const edge = s.project.edges.find(item => item.id === edgeId)
  const peers = cutEdges(s.project, nodeById(edge.to), false).filter(item => item.port === edge.port).map(item => item.id)
  const from = peers.indexOf(edgeId), to = from + direction
  if (to < 0 || to >= peers.length) return
  peers.splice(from, 1); peers.splice(to, 0, edgeId)
  await edit([{ op: 'reorder', cut: edge.to, port: edge.port, order: peers }])
}
/** What a control's data attributes say an action is about; a menu item gives the same by hand. */
function contextOf(target) {
  const data = target.dataset
  return { id: target.closest('[data-id]')?.dataset.id, takeId: data.take, item: data.item, edge: data.edge, port: data.port, node: data.node, hash: data.hash, role: data.role, review: data.review, extraction: data.extraction, exportId: data.export, target }
}
function perform(action, { id, takeId, item, edge, port, node, hash, role, review, extraction, exportId, target }) {
  if (action === 'run' || action === 'propose') return void runFor(id, action === 'propose' ? 'propose' : 'now')
  if (TAKE_ACTIONS.includes(action)) return void takeAction(action, takeId)
  if (action === 'take-prev' || action === 'take-next') return cycleTake(id, action === 'take-prev' ? -1 : 1)
  if (action === 'take-pick') return void pickTake(id ?? s.project.takes.find(take => take.id === takeId).cutId, takeId ?? shownTake(nodeById(id)).id)
  if (action === 'node-menu') {
    const shown = nodeById(id)
    if (!shown) return
    if (!s.sel.includes(id)) { applySelection([id]); void ui(() => request('read_node', { id })) }
    const rect = target.getBoundingClientRect()
    return showMenu(rect.left, rect.bottom + 4, nodeMenu(shown), target)
  }
  if (action === 'fold-frame') return foldFrame(id)
  if (action === 'chain-cancel') return void (activeChain() && cancelChain(activeChain().id))
  if (action === 'check-all') return void ui(() => doCheck(), target)
  if (action === 'open-settings') { s.tab = 'detail'; if (id && s.selection !== id) applySelection([id]); return showInspector(true) }
  if (action === 'pick-setting') return chooseSetting(id, target)
  if (action === 'manage-settings') return void openSettings(role)
  if (action === 'continue-prev') return void continueFromPrevious(id)
  if (action === 'disconnect') return void removeEdge(edge)
  if (action === 'repull') return void repull(edge)
  if (action === 'move-link') return void moveLink(edge, port)
  if (action === 'select-node') return focusNode(node)
  if (action === 'edge-props' || action === 'take-expand') {
    const key = action === 'edge-props' ? `edge:${edge}` : `take:${takeId}`
    if (!s.insp.expanded.delete(key)) s.insp.expanded.add(key)
    return renderInspector()
  }
  if (action === 'remove') return void removeNodes([id])
  if (action === 'remove-selected') return void removeNodes([...s.sel])
  if (action === 'duplicate-selected') return void duplicateCuts([...s.sel])
  if (action === 'open-detail') return void openDetail(hash)
  if (action === 'extract') return void extractFrom({ nodeId: id })
  if (action === 'extract-take') return void extractFrom({ takeId })
  if (action === 'export-cancel') return void cancelExport(exportId)
  if (action === 'export-play') return playExport(exportId)
  if (action === 'keep') return toast('가져온 지문은 그대로 둘게. 변경 경고는 남아.')
  void ui(async () => {
    if (action === 'up' || action === 'down') return reorderEdge(edge, action === 'up' ? -1 : 1)
    if (action === 'seed') return edit([{ op: 'set', id, fields: { seed: crypto.getRandomValues(new Uint32Array(1))[0] & 2147483647 } }])
    if (action === 'refresh-take') { await request('get_take', { take_id: takeId }); return reload() }
    if (action === 'extraction-status' || action === 'extraction-cancel') { await request('extract_frame', { expected_revision: s.project.revision, extraction_id: extraction, cancel: action === 'extraction-cancel' }); return reload() }
    if (action === 'review') {
      const reviewed = nodeById(item) ?? s.project.takes.find(take => take.id === item)
      await request('human_review', { expected_revision: s.project.revision, ops: [{ op: 'review', id: reviewed.id, status: review, memo: reviewed.memo }] }); return reload()
    }
    if (action === 'fingerprint') { await request('accept_fingerprint', { expected_revision: s.project.revision, id: item }); return doCheck() }
    if (action === 'undo') { await request('undo', { expected_revision: s.project.revision }); return reload() }
  }, target)
}
const dispatch = target => perform(target.dataset.action, contextOf(target))

// ---- the detail panel's menus: what does not fit its one main button and its icon rows ----
/** A menu list without separators at its ends or next to each other. */
const tidy = list => list.filter(Boolean).filter((item, index, all) => !item.sep || (index > 0 && index < all.length - 1 && !all[index + 1].sep))
/** A run action offered in a menu is locked as its button would be (lockRunButtons). */
const menuAction = (entry, context) => ({ label: entry.label, disabled: entry.disabled || (RUN_ACTIONS.includes(entry.action) && s.runBusy), run: () => perform(entry.action, context) })
function nodeItems(node, trigger) {
  const run = node.kind === 'cut' || node.kind === 'gen', cut = node.kind === 'cut'
  // The head shows the first of the node's actions as its button; the rest come first here.
  const rest = run ? cutActions(node, cutState(node)).slice(1) : []
  return tidy([
    ...rest.map(entry => menuAction(entry, { id: node.id, takeId: entry.take, target: trigger })),
    cut && menuAction({ action: 'propose', label: '제안으로 올리기' }, { id: node.id, target: trigger }),
    cut && prevCut(node) && { label: '앞 컷에서 이어가기', run: () => continueFromPrevious(node.id) },
    run && { label: '복제', run: () => duplicateCuts([node.id]) },
    { sep: true },
    { label: '노드 삭제', danger: true, run: () => removeNodes([node.id]) },
  ])
}
function takeItems(take, trigger) {
  const cut = nodeById(take.cutId), context = { id: take.cutId, takeId: take.id, target: trigger }
  // An upscale take runs again as an upscale (only once it ended with no result, and not while its cut runs); a generation take again with the seed and inputs chosen.
  const again = take.upscaleOf ? [upscaleRetry(take) && { ...menuAction({ action: 'upscale-again', label: '다시 업스케일' }, context), ...(cut && cutRunning(cut) ? { disabled: true } : {}) }] : [
    take.status !== 'discarded' && menuAction({ action: 'rerun-take', label: '같은 시드·이 입력으로' }, context),
    menuAction({ action: 'rerun-canvas', label: '같은 시드·현재 입력으로' }, context),
    menuAction({ action: 'rerun-new', label: '새 시드·현재 입력으로' }, context),
  ]
  return tidy([{ label: '상태 갱신', run: () => perform('refresh-take', context) }, { sep: true }, ...again])
}
function openMenu(button) {
  const node = nodeById($('insp-panel').dataset.id), take = s.project?.takes.find(item => item.id === button.dataset.take)
  if (button.dataset.imenu === 'node' && node) return menuAt(button, nodeItems(node, button))
  if (button.dataset.imenu === 'take' && take) return menuAt(button, takeItems(take, button))
  if (button.dataset.imenu === 'gen-settings' && node) return menuAt(button, genSettingItems(node, action => genSetting(node.id, action)))
}

// ---- the prompt field: its tabs and the @name chips ----
const caretKey = field => `${$('insp-panel').dataset.id}:${field.dataset.field}`
/**
 * A chip (under the field, on an input row, an unnamed-reference warning) puts `@name` at the caret of the prompt text shown (replacing
 * what is selected), spaced from the words around it, keeps the focus there and saves. From the 전송 tab it opens the text that is sent.
 */
function insertToken(token) {
  const cut = nodeById($('insp-panel').dataset.id), name = token.dataset.token, opened = cut?.kind === 'cut' && promptTabOf(cut) === 'sent'
  if (opened) { s.insp.tab[cut.id] = sentField(cut); renderInspector() }
  const field = $('insp-body').querySelector('textarea[data-field="prompt"], textarea[data-field="raw"]')
  if (!field) return
  const text = field.value, end = text.length
  // A click keeps the focus in the field (the chip takes no focus on mousedown); a keyboard press comes from the chip, so the caret the field had is used.
  const caret = !opened && document.activeElement === field ? { start: field.selectionStart, end: field.selectionEnd } : s.insp.caret[caretKey(field)] ?? { start: end, end }
  const start = Math.min(caret.start ?? end, end), stop = Math.min(Math.max(caret.end ?? start, start), end)
  const before = text.slice(0, start), after = text.slice(stop)
  const insert = `${before && !/\s$/.test(before) ? ' ' : ''}@${name}${/^\s/.test(after) ? '' : ' '}`
  field.value = before + insert + after
  field.focus({ preventScroll: true })
  field.setSelectionRange(start + insert.length, start + insert.length)
  s.insp.caret[caretKey(field)] = { start: start + insert.length, end: start + insert.length }
  inkField(field)
  field.dispatchEvent(new Event('change', { bubbles: true }))
}
function choosePromptTab(button) {
  // The field goes with its tab without a focusout, so its caret is kept here for a chip pressed later.
  const field = $('insp-body').querySelector('textarea[data-field]')
  if (field && document.activeElement === field) s.insp.caret[caretKey(field)] = { start: field.selectionStart, end: field.selectionEnd }
  s.insp.tab[$('insp-panel').dataset.id] = button.dataset.ptab
  renderInspector()
  $('insp-body').querySelector(`[data-ptab="${button.dataset.ptab}"]`)?.focus()
}
/** The detail panel's tab rows (its 선택/체크/어시스턴트 tabs and the prompt's tabs): ←/→ move and choose, Home/End go to the ends. */
function onTabKey(event) {
  const tab = event.target.closest?.('#inspector [role=tab]'), tabs = tab ? [...tab.closest('[role=tablist]').querySelectorAll('[role=tab]')] : []
  if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const at = tabs.indexOf(tab), next = tabs[event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (at + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]
  next.focus(); next.click()
}
export function bindDispatch() {
  // A chip takes no focus, so the prompt keeps its caret and selection for it.
  document.addEventListener('mousedown', event => { if (event.target.closest('[data-token]')) event.preventDefault() })
  document.addEventListener('click', event => {
    const token = event.target.closest('[data-token]')
    if (token) return insertToken(token)
    const tab = event.target.closest('[data-tab]')
    if (tab) { s.tab = tab.dataset.tab; showInspector(true, false); return }
    const promptTab = event.target.closest('[data-ptab]')
    if (promptTab) return choosePromptTab(promptTab)
    const menu = event.target.closest('[data-imenu]')
    if (menu) return openMenu(menu)
    // The 안 쓰는 연결 group stays as the person left it, per node (it opens by itself for a continuation frame there).
    const summary = event.target.closest('#insp-body details.vc-unused > summary')
    if (summary) { s.insp.unused[$('insp-panel').dataset.id] = !summary.parentElement.open; return }
    const target = event.target.closest('[data-action]')
    if (target) { if (!target.disabled) dispatch(target); return }
    // A check row selects its node wherever it is clicked.
    const row = event.target.closest('[data-select-node]')
    if (row && !event.target.closest('input, select, textarea, a')) focusNode(row.dataset.selectNode)
  })
  document.addEventListener('keydown', onTabKey)
  document.addEventListener('change', event => {
    const field = event.target
    if (field.dataset && (field.dataset.field || field.dataset.prop || field.dataset.memo || field.dataset.pf)) void ui(() => onFieldChange(field))
  })
  // The prompt field keeps its caret for a chip pressed from the keyboard, and the height the person dragged it to across redraws.
  document.addEventListener('focusout', event => {
    const field = event.target
    if (field.tagName === 'TEXTAREA' && field.dataset.field && field.closest('#insp-body')) s.insp.caret[caretKey(field)] = { start: field.selectionStart, end: field.selectionEnd }
  })
  document.addEventListener('pointerup', event => {
    const field = event.target.closest?.('#insp-body textarea[data-field]')
    if (field?.style.height) s.insp.height[$('insp-panel').dataset.id] = Math.round(field.offsetHeight)
  })
}
