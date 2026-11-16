import { $, esc, badge, ago, thumbUrl, icon } from './util.mjs'
import { s, ctx, assistant } from './state.mjs'
import { toast } from './toast.mjs'
import { showMenu } from './menu.mjs'
import { request, ui, reload, setProject, saveView, publish, recordEdit, forgetProject } from './session.mjs'
import { transform, fit } from './viewport.mjs'
import { confirmDialog, promptDialog, extractionWatches } from './dialogs.mjs'
import { abortExportWatches, stopPlayback } from './sequence.mjs'

const PAGE = 24
let token = 0
/** One page of the project list from the server (search, sort and the archive filter run there); `reset` starts over. */
export async function loadProjects(reset = true) {
  const home = s.home
  if (!reset && (home.loading || s.nextOffset === null)) return
  const mine = ++token
  home.loading = true; renderHome()
  try {
    const page = await request('list_projects', { offset: reset ? 0 : s.nextOffset, limit: PAGE, query: home.query || undefined, sort: home.sort, archived: home.archived })
    if (mine !== token) return
    s.projects = reset ? page.projects : [...s.projects, ...page.projects]
    s.projectTotal = page.total ?? s.projects.length
    s.nextOffset = page.nextOffset ?? null
  } finally { if (mine === token) { home.loading = false; renderHome(); publish() } }
}
const cardHtml = project => `<article class="vc-card${project.archived ? ' archived' : ''}" data-project="${esc(project.id)}"><button class="conai-media-card boxed vc-card-open" data-open="${esc(project.id)}"><span class="conai-media vc-cover">${project.cover ? `<img src="${thumbUrl(project.cover)}" alt="" loading="lazy">` : '<span class="vc-cover-empty">비어 있어</span>'}</span><span class="conai-media-body"><span class="conai-media-title">${esc(project.name)}</span><span class="conai-media-meta"><span>컷 ${project.cutCount ?? 0}개${project.archived ? ' · 보관됨' : ''}</span><span>${esc(ago(project.updated))}</span></span></span></button><button class="conai-icon-button sm overlay vc-card-menu" data-menu="${esc(project.id)}" aria-label="프로젝트 메뉴" aria-haspopup="menu">${icon('more')}</button></article>`
export function renderHome() {
  const home = s.home
  $('home-grid').innerHTML = s.projects.map(cardHtml).join('') || (home.loading ? '' : `<p class="conai-empty">${home.query ? '찾는 프로젝트가 없어.' : home.archived ? '보관한 프로젝트가 없어.' : '아직 프로젝트가 없어. 새 프로젝트로 시작해봐.'}</p>`)
  $('home-count').textContent = s.projects.length ? `${s.projects.length} / ${s.projectTotal}개` : ''
  $('home-more').hidden = s.nextOffset === null
  $('home-more').disabled = home.loading
  $('home-archived').setAttribute('aria-pressed', String(home.archived))
  // The assistant can search too; the controls follow what the list shows.
  if (document.activeElement !== $('home-query')) $('home-query').value = home.query
  $('home-sort').value = home.sort
  $('home-grid').setAttribute('aria-busy', String(home.loading))
}
// A choice (opening, creating, leaving) is final: a read that started for an earlier choice drops its result, and the remembered-project
// restore at page start gives up once anything was chosen. Page actions wait on `settled()` so none runs against a half-switched page.
let choices = 0, switching = Promise.resolve()
export const settled = () => switching
export const hasChosen = () => choices > 0
/** Opens a project (or, with no id, goes back to the project list) and restores the remembered viewport. */
export async function chooseProject(id) {
  // The project that is already open keeps its published sections, playback and watches.
  if (id && s.project?.id === id) return
  const mine = ++choices, run = openProject(id, () => mine === choices)
  switching = run.catch(() => {})
  await run
}
async function openProject(id, current) {
  assistant.clear(); s.nodeDetail = null; s.sel = []; s.selection = null; s.edgeSel = null; s.checks = null; s.viewTake = {}; s.tab = 'detail'
  abortExportWatches(); stopPlayback()
  for (const controller of extractionWatches.values()) controller.abort()
  if (!id) {
    const written = saveView(true, true)
    s.project = null; s.open = []
    await written
    ctx.hooks.render()
    return loadProjects()
  }
  s.project = null
  let project
  try { project = await request('read_canvas', { project_id: id, full: true }) } catch (error) {
    ctx.hooks.render()
    void loadProjects().catch(() => {})
    throw error
  }
  if (!current()) return
  const view = ctx.view.views[id]
  Object.assign(s, { x: view?.x ?? 24, y: view?.y ?? 24, zoom: view?.zoom ?? 1, open: view?.open ?? [] })
  setProject(project)
  transform()
  if (!view) requestAnimationFrame(() => fit())
}
export async function createProject(name, profile, preset) {
  const project = await request('create_project', { name, ...(profile ? { profile } : {}), ...(preset ? { preset } : {}) })
  await chooseProject(project.id)
  // Opening the project clears the published sections; the creation is still the last edit.
  recordEdit('create_project', project)
  void loadProjects().catch(() => {})
  return project
}
const menuFor = project => [
  { label: '이름 변경', run: () => renameProject(project) },
  { label: '복제', run: () => duplicateProject(project) },
  { label: project.archived ? '보관 해제' : '보관', run: () => ui(async () => { await request('archive_project', { project_id: project.id, archived: !project.archived }); toast(project.archived ? '보관을 풀었어.' : '보관함으로 옮겼어.'); await loadProjects() }) },
  { sep: true },
  { label: '삭제', danger: true, run: () => deleteProject(project) },
]
export async function renameProject(project) {
  const name = await promptDialog('프로젝트 이름 변경', '이름', project.name, '바꾸기')
  if (name && name !== project.name) await ui(async () => { await request('rename_project', { project_id: project.id, name }); await (s.project?.id === project.id ? reload() : loadProjects()) })
}
function duplicateProject(project) {
  return ui(async () => {
    const copy = await request('duplicate_project', { project_id: project.id })
    await loadProjects()
    toast(`${project.name}을(를) 복제했어.`, copy?.id ? { action: { label: '열기', run: () => ui(() => chooseProject(copy.id)) } } : {})
  })
}
async function deleteProject(project) {
  const ok = await confirmDialog('프로젝트를 지울까?', `<p><b>${esc(project.name)}</b>의 노드·연결·생성 이력·시퀀스와 내보내기 기록이 지워져. 되돌릴 수 없어.</p><p class="muted">라이브러리에 있는 이미지·영상·오디오 원본과 이미 만들어진 결과 파일은 지워지지 않아.</p>`, '지우기')
  if (ok) await ui(async () => {
    const result = await request('delete_project', { project_id: project.id, name: project.name })
    void forgetProject(project.id)
    toast(result.cleanupErrors?.length ? `프로젝트는 지웠는데 정리하지 못한 게 있어: ${result.cleanupErrors.join(' / ')}` : '프로젝트를 지웠어.', { error: Boolean(result.cleanupErrors?.length) })
    await loadProjects()
  })
}
export function bindHome() {
  let timer
  const search = () => { clearTimeout(timer); s.home.query = $('home-query').value.trim(); void ui(() => loadProjects()) }
  $('home-query').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 300) })
  $('home-query').addEventListener('keydown', event => { if (event.key === 'Enter') search() })
  $('home-sort').onchange = () => { s.home.sort = $('home-sort').value; void ui(() => loadProjects()) }
  $('home-archived').onclick = () => { s.home.archived = !s.home.archived; void ui(() => loadProjects()) }
  $('home-more').onclick = event => void ui(() => loadProjects(false), event.currentTarget)
  $('home-grid').addEventListener('click', event => {
    const open = event.target.closest('[data-open]')?.dataset.open, menu = event.target.closest('[data-menu]')
    if (open) void ui(() => chooseProject(open))
    if (menu) { const rect = menu.getBoundingClientRect(); showMenu(rect.left, rect.bottom, menuFor(s.projects.find(project => project.id === menu.dataset.menu))) }
  })
  $('home-grid').addEventListener('contextmenu', event => {
    const card = event.target.closest('[data-project]')
    if (!card) return
    event.preventDefault()
    showMenu(event.clientX, event.clientY, menuFor(s.projects.find(project => project.id === card.dataset.project)))
  })
}
export function newProjectDialog() {
  return promptDialog('새 프로젝트', '이름', '', '만들기').then(name => { if (name) return ui(() => createProject(name)) })
}
/** The project title in the header: click to rename in place. */
export function bindTitle() {
  const title = $('project-title'), input = $('project-title-input')
  const open = () => { if (!s.project) return; input.value = s.project.name; title.hidden = true; input.hidden = false; input.focus(); input.select() }
  const close = commit => {
    if (input.hidden) return
    const name = input.value.trim()
    input.hidden = true; title.hidden = false
    if (commit && name && name !== s.project?.name) void ui(async () => { await request('rename_project', { project_id: s.project.id, name }); await reload() })
  }
  title.onclick = open
  title.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open() } }
  input.onkeydown = event => { if (event.key === 'Enter') close(true); if (event.key === 'Escape') close(false) }
  input.onblur = () => close(true)
}
