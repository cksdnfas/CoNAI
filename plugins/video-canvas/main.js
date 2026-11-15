import { connectPlugin } from './conai-plugin.js'
import { $, esc, names, ports, isTerminal, fillIcons } from './util.mjs'
import { s, ctx, cuts, assistant } from './state.mjs'
import { notice, initToasts, dockToasts } from './toast.mjs'
import { initMenu, showMenu } from './menu.mjs'
import { request, queued, assistantTask, ui, edit, reload, publish, lockRunButtons, launchRun, doCheck, refreshQueued, loadView, saveView, openDetail, showInspector, forgetProject } from './session.mjs'
import { reveal } from './viewport.mjs'
import { renderNodes, bindNodes } from './nodes.mjs'
import { libraryName, watchExtraction } from './dialogs.mjs'
import { renderInspector } from './inspector.mjs'
import { renderSequence, bindSequence, startSequencePlayback, playExport, watchExports, watchChains, markSeqSelection } from './sequence.mjs'
import { loadProjects, renderHome, chooseProject, createProject, newProjectDialog, bindHome, bindTitle, settled, hasChosen } from './home.mjs'
import { drawEdges, renderTray, bindLinks } from './links.mjs'
import { renderFloat, bindCanvas, sourceItems } from './canvas.mjs'
import { select, focusNode, focusFrame, addCut } from './actions.mjs'
import { bindDispatch } from './dispatch.mjs'

// Every `task` below belongs to a page action from the assistant (the person's own two launch-bar tasks use `queued`).
const task = assistantTask
// The host's chat bridge answers a page action after ~20s, so no single call waits longer than this; the assistant calls again.
const waitFor = seconds => Math.min(Math.max(Number(seconds) || 0, 0), 15)
// wait_take's id → the server call that waits on it (it takes the id under the same name).
const WAITS = [['take_id', 'get_take'], ['cut_id', 'get_take'], ['chain_id', 'run_chain'], ['export_id', 'export_sequence'], ['extraction_id', 'extract_frame']]
let launchName = null
function renderLaunch() {
  $('launch').hidden = !s.launch
  if (!s.launch) return
  $('launch').innerHTML = `<span class="conai-media launch-thumb"><img src="/api/images/${encodeURIComponent(s.launch.compositeHash)}/thumbnail" alt=""></span><b>${esc(launchName ?? names.image)}</b><select id="launch-target" aria-label="이미지 가져올 곳"><option value="">새 이미지 노드</option>${cuts().flatMap(cut => ['start', 'end', 'ref_image'].map(port => `<option value="${esc(`${cut.id}|${port}`)}">${esc(cut.data.name)} · ${ports[port]}</option>`)).join('')}</select><button data-launch="import" class="primary" ${s.project ? '' : 'disabled'}>가져오기</button><button data-launch="dismiss" class="ghost">그만두기</button>${s.project ? '' : '<span class="muted">프로젝트를 먼저 골라줘.</span>'}`
}
function render() {
  const open = Boolean(s.project)
  $('home').hidden = open; $('home-bar').hidden = open; $('workspace').hidden = !open; $('project-bar').hidden = !open
  dockToasts()
  if (open) {
    // The revision is only a tooltip now: the bar has no room for it.
    if ($('project-title-input').hidden) { $('project-title').textContent = s.project.name; $('project-title').title = `눌러서 이름 바꾸기 · rev ${s.project.revision}` }
    renderNodes(); renderInspector(); renderSequence(); renderTray()
    requestAnimationFrame(() => { drawEdges(); renderFloat() })
    $('canvas').classList.toggle('empty', !s.project.nodes.length)
  } else renderHome()
  renderLaunch(); lockRunButtons(); publish()
}
Object.assign(ctx.hooks, {
  render, renderInspector, focusNode, focusFrame, select, openDetail, watchExports, watchChains, reveal, playSequence: startSequencePlayback, markSeqSelection,
  layoutChanged() { drawEdges() },
  showExport: playExport,
  afterSelection() { renderInspector(); renderFloat(); drawEdges() },
})
function bindHeader() {
  $('new-project').onclick = () => void newProjectDialog()
  $('back-home').onclick = () => void ui(() => chooseProject(null))
  $('add-cut').onclick = () => void addCut()
  $('empty-add').onclick = () => void addCut()
  $('add-source').onclick = event => { const rect = event.currentTarget.getBoundingClientRect(); showMenu(rect.left, rect.bottom + 4, sourceItems(undefined)) }
  $('toggle-inspector').onclick = () => showInspector(!s.inspectorOpen)
  $('insp-close').onclick = () => showInspector(false)
  $('launch').onclick = event => {
    const action = event.target.closest('[data-launch]')?.dataset.launch
    if (action === 'dismiss') void queued(async () => { s.launch = null; render(); await ctx.api.navigation.open('/ext/video-canvas/canvas') })
    if (action === 'import') void queued(() => { const [cut, port] = $('launch-target').value.split('|'); return edit([{ op: 'import_launch', ...(cut ? { target: { cut, port } } : {}) }]) })
  }
  $('modal').onclick = event => { if (event.target.closest('[data-close]')) $('modal').close() }
  $('modal').addEventListener('close', () => {
    $('modal').querySelectorAll('video,audio').forEach(media => { media.pause(); media.removeAttribute('src'); media.load?.() })
  })
  window.addEventListener('pagehide', () => saveView(true))
}
const actions = {
  'video-canvas.read': args => {
    if (args.section) { assistant.page(args.section, args.cursor); publish(); return }
    return request('read_canvas', { ...args, origin: 'assistant' })
  },
  'video-canvas.read_node': args => request('read_node', { ...args, origin: 'assistant' }),
  'video-canvas.select': args => task(async () => { if (args.project_id) await chooseProject(args.project_id); if (args.id) await select(args.id); publish() }),
  'video-canvas.list_projects': args => task(async () => {
    Object.assign(s.home, { query: args.query ?? '', sort: args.sort ?? 'updated', archived: args.archived ?? false })
    const page = await request('list_projects', { offset: args.offset ?? 0, limit: args.limit, query: args.query, sort: args.sort, archived: args.archived })
    s.projects = args.offset ? [...s.projects, ...page.projects] : page.projects
    s.projectTotal = page.total ?? s.projects.length; s.nextOffset = page.nextOffset ?? null
    if (!s.project) renderHome()
    publish()
  }),
  'video-canvas.workflow_options': () => task(async () => { s.wf = await request('workflow_options'); renderInspector() }),
  'video-canvas.rename_project': args => task(async () => { await request('rename_project', { project_id: args.project_id, name: args.name }); if (s.project?.id === args.project_id) await reload(); await loadProjects() }),
  'video-canvas.archive_project': args => task(async () => { await request('archive_project', { project_id: args.project_id, archived: args.archived }); await loadProjects() }),
  'video-canvas.duplicate_project': args => task(async () => { await request('duplicate_project', { project_id: args.project_id, name: args.name }); await loadProjects() }),
  'video-canvas.delete_project': args => task(async () => {
    await request('delete_project', { project_id: args.project_id, name: args.name })
    if (s.project?.id === args.project_id) await chooseProject(null); else await loadProjects()
    // After leaving: forgetting while the project is still open would save its viewport back.
    void forgetProject(args.project_id)
  }),
  'video-canvas.sequence': args => task(() => edit([{ op: 'sequence', order: args.order }], args.expected_revision, 'assistant')),
  'video-canvas.export_sequence': async (args, context) => {
    const call = extra => request('export_sequence', { ...args, ...extra, origin: 'assistant' }, { signal: context?.signal })
    const projectId = s.project?.id, seconds = waitFor(args.wait_seconds)
    // Starting joins the queue like any edit; waiting on a running export must not block it.
    let id = args.export_id
    if (!id) {
      const started = await task(async () => { const result = await call({ wait_seconds: undefined }); await reload(); return result })
      if (!seconds) return
      id = started.id
    }
    await call({ project_id: projectId, export_id: id, wait_seconds: seconds })
    await task(reload)
  },
  'video-canvas.edit': args => task(async () => {
    // One server operation creates the project with its profile; no revision of another project is involved.
    if (args.create_name) {
      const { profileId } = await createProject(args.create_name, args.profile_json ? JSON.parse(args.profile_json) : undefined)
      return { id: s.project.id, revision: s.project.revision, ...(profileId ? { profileId } : {}) }
    }
    if (args.profile_json || args.undo) { const result = await request(args.undo ? 'undo' : 'save_profile', { origin: 'assistant', expected_revision: args.expected_revision, ...(args.profile_json ? { profile: JSON.parse(args.profile_json) } : {}) }); await reload(); return { revision: result.revision } }
    const ops = JSON.parse(args.ops)
    if (ops.some(op => op.op === 'remove')) throw new Error('삭제는 video-canvas.remove 검토 작업으로 요청해줘.')
    return edit(ops, args.expected_revision, 'assistant')
  }),
  'video-canvas.check': args => task(() => doCheck({ ...args, origin: 'assistant' })),
  'video-canvas.run_cut': async (args, context) => {
    // The run starts inside the queue and under the run lock without waiting; the wait follows outside both, by take id.
    const { wait_seconds: requested, ...start } = args, projectId = s.project?.id, seconds = waitFor(requested)
    const take = await launchRun({ ...start, origin: 'assistant' })
    if (!seconds || !take) return
    await request('get_take', { project_id: projectId, take_id: take.takeId ?? take.id, wait_seconds: seconds }, { signal: context?.signal })
    await task(reload)
  },
  // The one waiting action: the id it receives says what to wait for, and the answer lands in that thing's own section.
  'video-canvas.wait_take': async (args, context) => {
    const given = WAITS.filter(([key]) => args[key]), projectId = s.project?.id
    if (given.length !== 1) throw new Error(`${WAITS.map(([key]) => key).join(', ')} 중 하나만 줘.`)
    const [[key, op]] = given
    const result = await request(op, { project_id: projectId, [key]: args[key], wait_seconds: waitFor(args.wait_seconds) }, { signal: context?.signal })
    await task(reload)
    if (key === 'extraction_id' && s.project?.id === projectId && !isTerminal(result.status)) watchExtraction(result.id)
  },
  'video-canvas.run_chain': async (args, context) => {
    // Starting joins the queue like any edit; waiting on the chain must not block it.
    const projectId = s.project?.id, seconds = waitFor(args.wait_seconds)
    let id = args.chain_id
    if (!id) {
      const started = await task(async () => { const result = await request('run_chain', { ...args, wait_seconds: undefined, origin: 'assistant' }, { signal: context?.signal }); await reload(); return result })
      if (!seconds) return
      id = started.id
    }
    await request('run_chain', { project_id: projectId, chain_id: id, cancel: args.cancel, wait_seconds: seconds }, { signal: context?.signal })
    await task(reload)
  },
  'video-canvas.propose_run_cut': args => launchRun({ ...args, origin: 'assistant' }, 'propose_run_cut'),
  'video-canvas.remove': args => task(() => edit([{ op: 'remove', id: args.id }], args.expected_revision, 'assistant')),
  'video-canvas.extract_frame': async (args, context) => {
    // Start (or look up) inside the queue without waiting; a requested wait runs outside it, by extraction id.
    const { wait_seconds: requested, ...start } = args, projectId = s.project?.id, seconds = waitFor(requested)
    let result = await task(async () => { const started = await request('extract_frame', { ...start, origin: 'assistant' }, { signal: context?.signal }); await reload(); return started })
    if (args.cancel) return
    if (seconds && !isTerminal(result.status)) {
      result = await request('extract_frame', { project_id: projectId, extraction_id: result.id, wait_seconds: seconds }, { signal: context?.signal })
      await task(reload)
    }
    if (s.project?.id === projectId && !isTerminal(result.status)) watchExtraction(result.id)
  },
}
// A page action waits for the page start (the remembered-project restore) and for any project switch under way,
// so it never runs against whichever project happens to be loaded at that moment.
let booted = Promise.resolve()
const gated = Object.fromEntries(Object.entries(actions).map(([id, handler]) => [id, async (args, context) => { await booted; await settled(); return handler(args, context) }]))
ctx.api = await connectPlugin(gated)
fillIcons(); initToasts(); initMenu(); bindHeader(); bindNodes(); bindCanvas(); bindLinks(); bindDispatch(); bindHome(); bindTitle(); bindSequence()
if (ctx.api.supports('launch.image') && ctx.api.launch?.image) {
  s.launch = { compositeHash: ctx.api.launch.image.compositeHash, kind: 'image' }
  libraryName(s.launch.compositeHash).then(name => { launchName = name; ctx.launchName = name; renderLaunch() }, error => notice(error.message, true))
}
// The restore runs in the queue and gives up if anything was chosen meanwhile: a late restore must never replace a project
// the assistant created or the person opened.
booted = (async () => {
  try {
    await loadView()
    void loadProjects().catch(error => notice(error.message, true))
    const last = ctx.view.last
    if (!last) return render()
    await queued(async () => {
      if (hasChosen()) return
      try { await chooseProject(last) } catch { s.project = null; render(); void forgetProject(last) }
    })
  } catch (error) { notice(error.message, true); render() }
})()
await booted
const refresh = event => {
  if (!s.project) return
  const jobId = event?.payload?.job_id
  if (jobId != null && !s.project.takes.some(take => take.jobId === jobId)) return
  void refreshQueued().catch(error => notice(error.message, true))
}
ctx.api.events.on('queue.job.status', refresh)
ctx.api.events.on('history.record.status', refresh)
ctx.api.events.on('resync', refresh)
