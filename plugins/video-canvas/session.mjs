import { profilePublication, roleOf } from './domain.mjs'
import { excerpt, rejectedMessage, createRefreshQueue, projectRows, exportStates, chainStates } from './assistant-state.mjs'
import { names, statusNames, isTerminal, uuid } from './util.mjs'
import { s, ctx, assistant, nodeById, DOCK_H } from './state.mjs'
import { toast, notice, withBusy } from './toast.mjs'

let queue = Promise.resolve()
const api = () => ctx.api
export async function request(op, args = {}, options) {
  // `record: false` leaves the `lastEdit` section to the caller, which publishes several library calls as one edit.
  const { record = true, ...sent } = args
  const result = await api().server({ project_id: s.project?.id, ...sent, op }, options)
  if (result?.ok === false) {
    assistant.set('lastError', { op, status: result.status, message: result.error })
    if (result.outcome) assistant.set('lastRun', result.outcome, { takeId: result.outcome.takeId, seed: result.outcome.seed, status: result.outcome.status, inputDigest: result.outcome.inputDigest })
    publish()
    throw Object.assign(new Error(result.error), { status: result.status })
  }
  const section = op === 'read_canvas' && !args.full ? 'lastRead' : { read_node: 'lastNode', apply_ops: 'lastEdit', run_cut: 'lastRun', propose_run_cut: 'lastRun', get_take: 'lastRun', check: 'lastCheck', extract_frame: 'lastExtraction', export_sequence: 'lastExport', run_chain: 'lastChain', workflow_options: 'workflowOptions' }[op]
  if (section) {
    const shown = withAutoProfile(section, result)
    const summary = section === 'lastEdit' ? { revision: shown.revision, applied: shown.applied.length, rejected: shown.rejected.length }
      : section === 'lastRun' ? { takeId: shown.takeId ?? shown.id, seed: shown.seed, status: shown.status, jobId: shown.jobId, inputDigest: shown.inputDigest }
        : section === 'lastNode' ? { nodeId: shown.node.id, inputDigest: shown.preview?.inputDigest ?? null }
          : section === 'lastExtraction' || section === 'lastExport' || section === 'lastChain' ? { id: shown.id, status: shown.status, jobId: shown.jobId }
            : section === 'workflowOptions' ? { workflows: shown.workflows.length, servers: shown.servers.length, profiles: shown.profiles.length, ...(shown.presets ? { presets: shown.presets.length } : {}) }
              : section === 'lastCheck' ? { blocked: shown.cuts.some(cut => cut.blocked) } : { nextCursor: shown.nextCursor, nextEdgeCursor: shown.nextEdgeCursor }
    assistant.set(section, shown, shown.autoProfile ? { ...summary, autoProfile: shown.autoProfile } : summary)
    if (op === 'read_node') s.nodeDetail = result
    publish()
  }
  // The server made a cut setting because the library had none; the assistant reads it from the published result, a person is told here.
  if (result?.autoProfile && args.origin !== 'assistant') notice(`컷 설정이 없어서 "${result.autoProfile.label}" 워크플로로 기본 설정을 만들었어.`)
  if (record && ['create_project', 'save_profile', 'import_preset', 'duplicate_profile', 'save_settings', 'undo'].includes(op)) recordEdit(op, result, args.origin)
  return result
}
/** A call about the account's settings library (a library read, a setting saved, imported, copied, deleted, a default chosen): it names no project, whichever one is open. */
export const accountRequest = (op, args = {}) => request(op, { project_id: undefined, ...args })
// The server reports `autoProfile` once, on the call that created it. Waiting on the same take or chain republishes it without that
// field, so the section keeps showing it for that take or chain.
const autoSeen = new Map()
function withAutoProfile(section, result) {
  if (section !== 'lastRun' && section !== 'lastChain') return result
  const subject = result.takeId ?? result.id
  if (result.autoProfile) autoSeen.set(section, { subject, profile: result.autoProfile })
  else if (autoSeen.get(section)?.subject === subject) return { ...result, autoProfile: autoSeen.get(section).profile }
  return result
}
/** Publishes the `lastEdit` section for the operations that change the project or the settings library outside apply_ops. */
export const recordEdit = (op, result, origin) => recordEdits([[op, result]], origin)
/**
 * One `lastEdit` for the calls of one action, each as [op, result]. An assistant's call already got its settings in the published form (with
 * their role) from the server; a person's got the stored object, which is published here, so each setting is published exactly once.
 * Returns what the assistant's action reports back: the saved setting's ID and revision and the defaults.
 */
export function recordEdits(entries, origin) {
  const shown = entries.map(([op, result]) => [op, origin !== 'assistant' && result.profile ? { ...result, profile: { ...profilePublication(result.profile), role: roleOf(result.profile) } } : result])
  const last = key => shown.map(([, result]) => result[key]).filter(value => value !== undefined && value !== null).at(-1)
  const found = shown.find(([op]) => op === 'create_project' || op === 'undo')?.[1], profiles = shown.flatMap(([, result]) => result.profile ? [result.profile] : [])
  const done = { ...(last('profileId') ? { profileId: last('profileId') } : {}), ...(last('profileRevision') === undefined ? {} : { profileRevision: last('profileRevision') }), ...(last('settings') ? { settings: last('settings') } : {}) }
  assistant.set('lastEdit', { ...(last('revision') === undefined ? {} : { revision: last('revision') }), ...(found ? { projectId: found.id } : {}), ...done,
    ...(profiles.length ? { profiles } : {}), applied: shown.map(([op]) => ({ op })), rejected: [], tempIds: {} },
  { revision: last('revision'), applied: shown.length, rejected: 0 })
  publish()
  return done
}
function unwrap(result) {
  const out = result.result ?? result
  if (out.isError) throw new Error(out.content?.filter(part => part.type === 'text').map(part => part.text).join('\n'))
  if (!out.content) return out
  const text = out.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
  try { return JSON.parse(text) } catch { return text }
}
export async function native(name, args = {}) { return unwrap(await api().app.call(name, args)) }
export async function http(path) {
  const response = await api().app.fetch(path), body = await response.json()
  if (!response.ok || body.success === false) throw new Error(body.error ?? response.statusText)
  return body
}
/** Serialises page work so an edit never races the revision of the one before it. A person's error stays as an error toast;
 * an assistant action's error already goes back to the assistant, so the person only gets a passing notice. */
export function task(fn, { assistant: fromAssistant = false } = {}) {
  const next = queue.then(fn)
  // An error may carry a shorter `notice` for the person while its message goes back to the assistant whole.
  queue = next.catch(error => { notice(error.notice ?? error.message, !fromAssistant) })
  return next
}
export const queued = task
export const assistantTask = fn => task(fn, { assistant: true })
/** A user action: queued, its control busy while it runs, errors already toasted. */
export const ui = (fn, el) => withBusy(el, () => task(fn)).catch(() => {})
/** A background read (a watch loop) joins the queue, so a slow read never overwrites a newer revision. */
export const reloadQueued = () => task(reload)

/** The open project's row in the list, kept as current as the canvas itself (counts, name, revision and when it last changed). */
function currentRow(row, project) {
  const next = { ...row, name: project.name, revision: project.revision, nodeCount: project.nodes.length, cutCount: project.nodes.filter(node => node.kind === 'cut').length }
  // Rows carry SQLite timestamps (UTC, no zone); every revision bump on the server stamps the project as updated.
  return row.revision === project.revision ? next : { ...next, updated: new Date().toISOString().slice(0, 19).replace('T', ' ') }
}
export function publish() {
  if (!api()) return
  if (s.project) {
    s.projects = s.projects.map(project => project.id === s.project.id ? currentRow(project, s.project) : project)
    assistant.set('canvas', excerpt(s.project))
  }
  assistant.set('projects', projectRows(s.projects), { total: s.projectTotal || s.projects.length, nextOffset: s.nextOffset })
  assistant.set('pendingExports', exportStates(s.project))
  assistant.set('pendingChains', chainStates(s.project))
  assistant.set('pendingExtractions', (s.project?.extractions ?? []).map(({ id, jobId, status, progress, resultHashes, nodeIds, error, rejected }) => ({ id, jobId, status, progress, resultHashes, nodeIds, error, rejected })))
  api().publish(assistant.snapshot({ projectId: s.project?.id ?? null, selection: [...s.sel], launch: s.launch }, s.project?.revision ?? 0))
}
/** A chain that ended since the last read: success offers to play the sequence, failure names the cut and the reason. */
function announceChain(chain) {
  if (chain.status === 'completed') return toast('이어 생성이 끝났어.', { action: { label: '보기', run: () => ctx.hooks.playSequence?.() } })
  if (chain.status === 'cancelled') return toast('이어 생성을 취소했어.')
  const step = chain.steps.find(item => item.status === 'failed'), name = nodeById(step?.cutId)?.data.name
  toast(`이어 생성이 멈췄어${name ? `: ${name}` : ''}${step?.error ?? chain.error ? ` · ${step?.error ?? chain.error}` : ''}`, { error: true })
}
/** Replaces the open project and announces what finished since the last read. */
export function setProject(next) {
  const prev = s.project
  s.project = next
  if (s.open.length) s.open = s.open.filter(id => next.nodes.some(node => node.id === id))
  if (prev?.id === next.id && prev.takes && next.takes) {
    const before = new Map(prev.takes.map(take => [take.id, take.status]))
    for (const take of next.takes) if (take.status === 'completed' && before.has(take.id) && before.get(take.id) !== 'completed') {
      const cut = nodeById(take.cutId)
      toast(`${cut?.data.name ?? '컷'} 생성이 끝났어.`, { action: { label: '보기', run: () => ctx.hooks.focusNode?.(take.cutId, take.id) } })
    }
    const done = new Map((prev.exports ?? []).map(item => [item.id, item.status]))
    const running = new Set((prev.chains ?? []).filter(chain => !isTerminal(chain.status)).map(chain => chain.id))
    for (const chain of next.chains ?? []) if (isTerminal(chain.status) && running.has(chain.id)) announceChain(chain)
  }
  ctx.hooks.render?.()
  ctx.hooks.watchExports?.()
  ctx.hooks.watchChains?.()
}
/** A read that lands after the project was left (or another one opened) must not bring the old project back. */
async function readOpen(op, args) {
  const id = s.project?.id
  if (!id) return
  const next = await request(op, args)
  if (s.project?.id === id) setProject(next)
}
export async function reload() {
  await readOpen('read_canvas', { full: true })
  if (s.selection && nodeById(s.selection)) await request('read_node', { id: s.selection })
}
export async function edit(ops, revision = s.project.revision, origin = 'human') {
  const prepared = ops.map(op => op.op === 'import_launch' ? { ...op, name: op.name ?? ctx.launchName ?? names.image, ref: { source: 'library', compositeHash: s.launch.compositeHash } } : op)
  let result
  try { result = await request('apply_ops', { ops: prepared, expected_revision: revision, origin }) } catch (error) {
    // Optimistic moves and reorders were applied locally first; the server state (positions, order, revision) wins again.
    await reload().catch(() => {})
    throw error
  }
  if (origin === 'assistant') s.batch = result
  await reload()
  // The server places nodes for everyone (a chain, the assistant); the view follows only what this person's edit created.
  if (origin === 'human') {
    const created = result.applied.filter(item => { const type = item.op.op ?? item.op.type; return type === 'add_node' || type.startsWith('import_') }).at(-1)
    if (created) ctx.hooks.reveal?.(created.id)
  }
  if (origin === 'assistant') toast(`어시스턴트가 ${result.applied.length}건 적용했어.`)
  if (result.applied.some(item => item.op.op === 'import_launch')) {
    s.launch = null
    await api().navigation.open('/ext/video-canvas/canvas')
  }
  // The lastEdit pointer in rejectedMessage is for the assistant; a person only needs the reasons.
  if (result.rejected.length) {
    const reasons = result.rejected.map(item => item.reason).join(' / ')
    throw origin === 'assistant' ? Object.assign(new Error(rejectedMessage(result)), { notice: reasons }) : new Error(reasons)
  }
  return result
}
export async function runCut(args = {}, op = 'run_cut') {
  const take = await request(op, { cut_id: args.cut_id ?? s.selection, ...args })
  delete s.viewTake[take.cutId ?? args.cut_id]
  await reload()
  toast(take.upscaleOf ? `업스케일 ${statusNames[take.status] ?? take.status}` : `${statusNames[take.status] ?? take.status} · seed ${take.seed ?? '—'}`)
  return take
}
export const RUN_ACTIONS = ['run', 'propose', 'approve', 'discard', 'retry', 'cancel', 'rerun-take', 'rerun-canvas', 'rerun-new', 'upscale', 'upscale-again']
export function lockRunButtons() {
  // A button locked because its cut is running stays disabled when the page's own run ends.
  for (const button of document.querySelectorAll('[data-action]')) if (RUN_ACTIONS.includes(button.dataset.action)) button.disabled = s.runBusy || 'locked' in button.dataset
}
export function launchRun(args = {}, op = 'run_cut') {
  if (s.runBusy) {
    if (args.origin === 'assistant') throw new Error('생성 요청을 처리 중이야. lastRun 상태를 먼저 읽어줘.')
    return Promise.resolve()
  }
  const captured = { cut_id: s.selection, requestId: uuid(), ...args }
  s.runBusy = true; lockRunButtons()
  const promise = task(async () => {
    const queued = { ...captured, expected_revision: captured.expected_revision ?? s.project.revision }
    if (op === 'run_cut' && queued.mode === 'propose') queued.input_digest = (await request('read_node', { id: queued.cut_id })).preview.inputDigest
    return runCut(queued, op)
  }, { assistant: args.origin === 'assistant' })
  const unlock = () => { s.runBusy = false; lockRunButtons() }
  promise.then(unlock, unlock)
  return promise
}
export async function doCheck(args = {}) {
  s.checks = await request('check', { expected_revision: s.project.revision, ...args })
  s.tab = 'checks'; showInspector(true, false); await reload(); return s.checks
}
export const refreshQueued = createRefreshQueue(() => task(() => readOpen('refresh')))

// ---- remembered project and viewport ----
let viewTimer, viewRevision = null, viewWrites = Promise.resolve()
// api.storage rejects a write that does not carry the stored revision, so the revision is tracked and writes run one at a time.
const writeView = () => viewWrites = viewWrites.then(async () => {
  try { viewRevision = (await ctx.api.storage.set('view', ctx.view, viewRevision))?.revision ?? null } catch {
    try { viewRevision = (await ctx.api.storage.set('view', ctx.view, (await ctx.api.storage.get('view')).revision ?? null))?.revision ?? null } catch (error) { notice(`화면 위치를 저장하지 못했어: ${error.message}`, true) }
  }
})
export async function loadView() {
  const stored = await ctx.api.storage.get('view').catch(() => null)
  viewRevision = stored?.revision ?? null
  if (stored?.value) ctx.view = { last: stored.value.last ?? null, views: stored.value.views ?? {}, inspector: stored.value.inspector ?? false, seq: stored.value.seq ?? true, seqH: stored.value.seqH ?? DOCK_H }
  s.inspectorOpen = ctx.view.inspector; s.seqOpen = ctx.view.seq; s.seqH = ctx.view.seqH
}
/** Opens or closes the detail panel; `remember` keeps the choice for the next visit. */
export function showInspector(open, remember = true) {
  s.inspectorOpen = open
  if (remember) { ctx.view.inspector = open; saveView() }
  ctx.hooks.renderInspector?.()
}
/** Remembers the open project and viewport; `now` writes before a page navigation. `leaving` keeps the viewport but forgets the project as the one to reopen. */
export function saveView(now = false, leaving = false) {
  clearTimeout(viewTimer)
  ctx.view.last = leaving ? null : s.project?.id ?? null
  if (s.project) {
    delete ctx.view.views[s.project.id]
    // `open` lists the extracted frames the person pulled out of their links as cards.
    ctx.view.views[s.project.id] = { x: s.x, y: s.y, zoom: s.zoom, ...(s.open.length ? { open: s.open } : {}) }
  }
  if (now) return writeView()
  viewTimer = setTimeout(writeView, 250)
}
/** Pins frames to the canvas as cards (an extraction made with 연결 안 함). */
export function pinFrames(ids) {
  s.open = [...new Set([...s.open, ...ids])]
  saveView()
}
/** A project that no longer exists keeps no remembered viewport. */
export function forgetProject(id) {
  delete ctx.view.views[id]
  if (ctx.view.last === id) ctx.view.last = null
  return saveView(true)
}
// Navigating away reloads the page, so edits still queued must land first.
export const openDetail = async hash => { await task(() => {}); await saveView(true); await ctx.api.navigation.open(`/images/${hash}`) }
