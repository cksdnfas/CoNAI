import { connectPlugin } from './conai-plugin.js'
import { starter, validateProject, defaultScenes, scenesDuration, applyControls, MOTIONS, CAPTION_POSITIONS } from './project.mjs'
import { draftRecovery } from './draft.mjs'
import { thumbnails } from './thumbs.js'
import { queueBridge } from './bridge.js'
import { masonry } from './masonry.js'
import { livePreview, previewFiles } from './live.js'
import { summarize, aiMessage, assetName, kindLabel, usageOf, defaultLabel, builtHtml, clock } from './changes.js'

const $ = id => document.getElementById(id)
let api, thumbs, grid, libraryMore, projectMore, project = starter(), saved = null, changed = 0, savedChange = 0, serial = 0, queryGeneration = 0
let renderJob = null, jobRunning = false, jobPercent = 0, aiJob = null, aiStopping = false, resultHash = null, pending = new Map(), busy = false, timer = null, lastMediaRefresh = 0, outputRetries = 0
let recovery, recoverable = null, draftTimer = null, recoveryReady = false, projectOffset = 0, projectNext = null, projectList = [], outputHistory = [], listGeneration = 0, historyGeneration = 0, saveRetry = null
let live = null, viewMode = 'live', scrubbing = false, draftNote = ''
let search = { kind: 'library', media: 'all', query: '', page: 1, total: 0 }, activeScene = null, renderer = null, rendererTimer = null, rendererOpen = false, composeArmed = false, shownSize = [1280, 720]
// Undo: snapshots of the whole draft, one per edit (typing and dragging in one field coalesce); lastSnap is the draft now.
let undoStack = [], lastSnap = '', lastGroup = '', lastGroupAt = 0, batch = null
// Instructing the AI: the conversation of this project, the scope of the next instruction and the marks on an output (page memory only).
let chat = [], scope = { kind: 'all' }, markers = [], markerSel = new Set(), markerSeq = 0, markTime = 0
let starting = false, startHold = false, controlsKey = ''
const stages = { draft: '제작 중', completed: '완료', archived: '보관' }
const jobStates = { completed: '완료', failed: '실패', cancelled: '취소', queued: '대기', running: '진행' }
const PANELS = ['ai', 'adjust', 'html'], UNDO_LIMIT = 50
const date = value => new Date(value).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const dirty = () => changed !== savedChange
const unique = () => crypto.randomUUID()
const svg = name => { const element = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', `#i-${name}`); element.append(use); return element }
const el = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element }
const refKey = reference => reference.source === 'library' ? `library:${reference.compositeHash}` : reference.source === 'files' ? `files:${reference.fileId}` : `${reference.source}:${reference.candidateId}`
const isVisual = asset => /^(image|video)\//.test(asset?.mimeType ?? '')
const isAudio = asset => asset?.mimeType?.startsWith('audio/')
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function unpack(value) {
  if (typeof value === 'string') value = JSON.parse(value)
  if (value?.isError) throw new Error(value.content?.filter(x => x.type === 'text').map(x => x.text).join('\n') || '도구 실행 실패')
  if (Array.isArray(value?.content)) return unpack(value.content.find(x => x.type === 'text')?.text ?? 'null')
  return value
}
async function tool(name, args = {}) {
  const response = await api.app.call(name, args)
  if (response.status !== 'completed') throw new Error(response.error || '조회에 실패했어.')
  return unpack(response.result)
}
// A tool that changes something runs as a host job: the call needs a request id and may return while the job still runs.
async function act(name, args = {}) {
  const response = await api.app.call(name, args, unique())
  const done = ['completed', 'failed', 'cancelled'].includes(response.status) ? response : await api.app.wait(response.id)
  if (done.status !== 'completed') throw new Error(done.error || '작업이 완료되지 않았어.')
  return unpack(done.result)
}
function button(label, fn, className = 'ghost') { const b = document.createElement('button'); b.textContent = label; b.className = className; b.onclick = () => Promise.resolve().then(fn).catch(error); return b }
const on = (id, action) => { $(id).onclick = () => Promise.resolve().then(action).catch(error) }

// ---------- Messages: toasts float over the page and never move the layout ----------
function toast(text, isError = false) {
  if (!text) return
  const box = $('toasts')
  if ([...box.children].some(node => node.firstElementChild.textContent === text)) return
  const node = el('div', `toast${isError ? ' error' : ''}`), close = button('', () => node.remove(), 'conai-icon-button sm')
  node.setAttribute('role', isError ? 'alert' : 'status'); close.title = '닫기'; close.setAttribute('aria-label', '닫기'); close.append(svg('x'))
  node.append(el('span', '', text), close); box.append(node)
  while (box.children.length > 4) box.firstElementChild.remove()
  setTimeout(() => node.remove(), isError ? 15000 : 5000)
}
const report = toast
const error = e => toast(e?.message ?? String(e), true)

// ---------- Draft ----------
const size = () => $('size').value.split('x').map(Number)
function ensureSizeOption(width, height) {
  if ($('size').querySelector(`option[value="${width}x${height}"]`)) return
  const option = document.createElement('option'); option.value = `${width}x${height}`; option.textContent = `${width}×${height}`; $('size').append(option)
}
function currentProject() {
  const [width, height] = size()
  return { ...project, title: $('title').value, stage: $('stage').value, width, height, fps: Number($('fps').value), duration: Number($('duration').value), html: $('html').value }
}
const form = () => validateProject(currentProject())
function setBadge(node, text, state, extra = '') {
  node.querySelector('.t').textContent = text; node.title = text
  node.className = `badge dot${extra ? ` ${extra}` : ''}${state ? ` ${state}` : ''}`
}
function drawSaveState() {
  setBadge($('save-state'), dirty() ? '저장 안 됨' : saved ? '저장됨' : '새 프로젝트', dirty() ? 'warn' : saved ? 'ok' : '')
  if (draftNote) $('save-state').title += ` · ${draftNote}`
}
function publish() {
  drawSaveState()
  $('undo').disabled = !undoStack.length
  const [width, height] = size()
  api?.publish({ revision: String(++serial), dirty: dirty(), data: {
    project: { fileId: saved?.fileId ?? null, revision: saved?.revision ?? null, title: $('title').value, stage: $('stage').value, width, height, fps: Number($('fps').value),
      duration: Number($('duration').value), assets: project.assets.map(asset => ({ ...asset, name: assetName(project.assets, asset) })), scenes: project.scenes ?? null, style: project.style ?? null, controls: project.controls ?? null, html: $('html').value },
    selectedScene: activeScene === null ? null : activeScene + 1, canUndo: undoStack.length > 0, view: viewMode,
    search: { query: search.query, kind: search.kind === 'library' ? search.media : search.kind, page: search.page }, renderJob, resultHash,
    renderer: renderer ? { ready: renderer.ready, browser: renderer.browser?.ok ?? false, install: renderer.install?.status ?? 'idle' } : null,
    projects: { items: projectList, query: $('project-query').value, stage: projectStage(), offset: projectOffset }, outputHistory, recoveryAvailable: !!recoverable,
  } })
}
function storeDraft() {
  clearTimeout(draftTimer)
  if (!recoveryReady || recoverable) return Promise.resolve(false)
  return dirty() ? recovery.save({ saved, project: currentProject(), updatedAt: Date.now() }) : recovery.clear()
}
const snapshot = () => JSON.stringify(currentProject())
const pushUndo = (text = lastSnap) => { undoStack.push(text); if (undoStack.length > UNDO_LIMIT) undoStack.shift() }
/** Makes the draft now the base for undo: a loaded project starts a new history, a run of the AI keeps the one before it. */
function rebase(keepUndo = false) {
  if (keepUndo) pushUndo(); else undoStack = []
  lastSnap = snapshot(); lastGroup = ''; $('undo').disabled = !undoStack.length
}
/** A change landed: count it, publish it, keep a recovery copy and show it in the preview. */
function touch() {
  changed++; publish(); clearTimeout(draftTimer); draftTimer = setTimeout(() => { void storeDraft() }, 800)
  if (starting && !startHold) endStart()
  if (showLive() && viewMode === 'output') setMode('live')
}
/** `group` joins consecutive edits of one field (typing, dragging a slider) into one undo step. */
function edit(group = '') {
  const text = snapshot(), now = Date.now()
  const joined = batch ? batch.pushed : group && group === lastGroup && now - lastGroupAt < 1500
  if (text !== lastSnap && !joined) { pushUndo(); if (batch) batch.pushed = true }
  lastSnap = text; lastGroup = batch ? '' : group; lastGroupAt = now
  touch()
}
/** Edits made by `run` share one undo step: the first one that changes the draft pushes it, the rest join it. */
function oneStep(run) {
  if (batch) return run()
  batch = { pushed: false }
  try { run() } finally { batch = null; lastGroup = '' }
}
function restoreSnapshot(text) { project = JSON.parse(text); updateForm(true) }
/** Replaces the draft with an earlier one; the draft it replaces stays undoable. */
function applySnapshot(text) { pushUndo(); restoreSnapshot(text); lastSnap = text; lastGroup = ''; touch() }
function undo() {
  if (recoverable) throw new Error('임시 초안을 먼저 처리해줘.')
  if (!undoStack.length) return
  const previous = undoStack.pop()
  restoreSnapshot(previous); lastSnap = previous; lastGroup = ''
  touch()
}

// ---------- Form ----------
function drawAspect() {
  const [width, height] = size()
  $('stage-box').style.setProperty('--ar', String(width / height))
  for (const choice of $('start-aspect').children) { const on = choice.dataset.size === `${width}x${height}`; choice.classList.toggle('active', on); choice.setAttribute('aria-pressed', String(on)) }
}
function updateForm(keepScene = false) {
  const keep = keepScene ? activeScene : null
  $('title').value = project.title; $('duration').value = project.duration; $('html').value = project.html
  ensureSizeOption(project.width, project.height); $('size').value = `${project.width}x${project.height}`
  $('stage').value = project.stage ?? 'draft'; $('fps').value = String(project.fps ?? 30)
  shownSize = size(); activeScene = keep !== null && keep < scenes().length ? keep : null; composeArmed = false
  drawAspect(); redraw(); publish(); showLive(0)
}
function redraw() { drawSources(); drawScenes(); drawAdjust(); drawScope(); if (starting) drawStart(); markSelected() }
function ensureIdle() {
  if (busy || pending.size || aiJob) throw new Error('대기 중인 저장·실행·AI 요청을 먼저 처리해줘.')
  if (recoverable) throw new Error('임시 초안을 복구하거나 버린 뒤 진행해줘.')
}
async function leaveDraft() {
  ensureIdle()
  if (!dirty()) return true
  const choice = await new Promise(resolve => {
    const dialog = $('leave-dialog')
    const close = value => { dialog.close(); resolve(value) }
    $('leave-save').onclick = () => close('save'); $('leave-discard').onclick = () => close('discard'); $('leave-cancel').onclick = () => close('cancel')
    dialog.oncancel = event => { event.preventDefault(); close('cancel') }
    dialog.showModal()
  })
  if (choice === 'save') return await saveProject() && !dirty()
  if (choice !== 'discard') return false
  return true
}
function resetOutput() {
  clearTimeout(timer); renderJob = null; jobRunning = false; resultHash = null; outputHistory = []; historyGeneration++
  chat = []; markers = []; markerSel = new Set(); scope = { kind: 'all' }
  $('output').pause(); $('output').removeAttribute('src'); $('output').load(); setMode('live')
  $('job').hidden = true; $('progress').value = 0; $('job-state').textContent = ''
  drawHistory(); drawChat(); drawMarkers(); drawScope()
}
/** Opens a read project as the draft; an AI run keeps its output history and the undo history before it. */
function applyLoaded(loaded, keepOutput = false) {
  if (!keepOutput) resetOutput()
  saved = { fileId: loaded.fileId, revision: loaded.revision }; project = loaded.project; changed++; savedChange = changed; saveRetry = null
  updateForm(); rebase(keepOutput)
}
async function newProject() {
  if (!await leaveDraft()) return
  resetOutput(); project = starter(); saved = null; changed++; savedChange = changed; saveRetry = null
  updateForm(); rebase(); drawHistory(); await storeDraft(); closeProjects(); startScreen(); report('새 프로젝트를 시작했어.')
}

// ---------- Scenes ----------
const scenes = () => project.scenes ?? (project.scenes = defaultScenes(project.title, project.assets).filter(scene => scene.asset !== null))
const build = (list = scenes(), [width, height] = size()) => builtHtml({ width, height, assets: project.assets, style: project.style, controls: project.controls }, list)
/** Whether the html is still exactly what the storyboard produced, so storyboard edits may rebuild it; hand- or AI-written html is never rebuilt without the note and its confirm. */
const composed = sizes => $('html').value === build(scenes(), sizes)
function changeScenes(change, automatic = composed(), group = '') {
  change()
  if (automatic) compose(false)
  else { composeArmed = false; redraw() }
  edit(group)
}
/** Style (caption size and colour, music volume) applies to html built from scenes; hand-written html keeps it for the next rebuild. */
function changeStyle(change, group = '') {
  const automatic = composed(), style = { ...(project.style ?? {}) }
  change(style)
  if (Object.keys(style).length) project.style = style; else delete project.style
  if (automatic) compose(false)
  else { composeArmed = false; redraw() }
  edit(group)
}
function compose(announce = true) {
  const list = scenes()
  // No scene still builds a 4-second title card. The card joins the storyboard, so composed() recognises what was built.
  if (!list.length) list.push({ asset: null, seconds: 4, caption: $('title').value || '새 영상' })
  $('html').value = build(list); $('duration').value = scenesDuration(list); composeArmed = false
  redraw()
  if (announce) report('장면대로 영상을 다시 구성했어.')
}
function selectScene(index) {
  activeScene = activeScene === index ? null : index
  // Picking a scene aims the next instruction at it, but never replaces marks the user chose on an output.
  if (scope.kind !== 'markers') scope = activeScene === null ? { kind: 'all' } : { kind: 'scene' }
  redraw()
  // Just past the caption's entrance, so the frame shows what the adjust tab is changing.
  if (activeScene !== null && viewMode === 'live') live?.seek(scenes().slice(0, index).reduce((start, item) => start + item.seconds, 0) + Math.min(0.8, scenes()[index].seconds / 2))
}
function drawScenes() {
  const list = scenes(), track = $('scenes'), byId = new Map(project.assets.map(asset => [asset.id, asset]))
  track.replaceChildren()
  list.forEach((scene, index) => {
    const asset = byId.get(scene.asset), card = el('button', `clip conai-media-card${activeScene === index ? ' active' : ''}`)
    card.type = 'button'; card.draggable = true; card.style.flexGrow = String(scene.seconds); card.title = `${index + 1}. ${scene.caption || '자막 없음'} · ${scene.seconds}초`
    const media = el('div', 'conai-media')
    if (isVisual(asset)) thumbs.into(media, refKey(asset.reference))
    media.append(el('span', 'conai-overlay-badge xs tl', String(index + 1)), el('span', 'conai-overlay-caption', scene.caption || '자막 없음'))
    card.append(media)
    card.onclick = () => selectScene(index)
    card.ondragstart = event => { event.dataTransfer.setData('text/plain', String(index)); card.classList.add('dragging') }
    card.ondragend = () => card.classList.remove('dragging')
    card.ondragover = event => { event.preventDefault(); card.classList.add('drop-before') }
    card.ondragleave = () => card.classList.remove('drop-before')
    card.ondrop = event => {
      event.preventDefault(); card.classList.remove('drop-before')
      const from = Number(event.dataTransfer.getData('text/plain'))
      if (Number.isInteger(from) && from !== index) moveScene(from, from < index ? index - 1 : index)
    }
    track.append(card)
  })
  const add = button('', () => changeScenes(() => { list.push({ asset: null, seconds: 4, caption: '' }); activeScene = list.length - 1 }), 'add conai-icon-button')
  add.title = '빈 장면 추가'; add.setAttribute('aria-label', '빈 장면 추가'); add.append(svg('plus')); track.append(add)
  const head = el('div', 'playhead'); head.id = 'playhead'; track.append(head)
  const music = $('music'); music.replaceChildren()
  for (const asset of project.assets.filter(isAudio)) {
    const row = el('div', 'music'), remove = button('', () => removeAsset(asset.id), 'conai-icon-button sm')
    remove.title = '배경 음악 빼기'; remove.setAttribute('aria-label', '배경 음악 빼기'); remove.append(svg('x'))
    row.append(svg('music'), el('span', '', `${assetName(project.assets, asset)} · 전체 구간`), remove); music.append(row)
  }
  const handEdited = list.length > 0 && !composed()
  $('board-summary').textContent = list.length ? `장면 ${list.length}개 · ${scenesDuration(list)}초${handEdited ? ' · HTML 직접 수정됨' : ''}` : ''
  drawPlayhead(live?.state.time ?? 0)
}
function drawPlayhead(time) {
  const head = $('playhead'), list = scenes(), clips = $('scenes').querySelectorAll('.clip')
  if (!head) return
  let start = 0
  for (let i = 0; i < list.length; i++) {
    if (time < start + list[i].seconds || i === list.length - 1) {
      const clip = clips[i]
      if (!clip) break
      head.style.left = `${clip.offsetLeft + Math.min(1, Math.max(0, (time - start) / list[i].seconds)) * clip.offsetWidth}px`; head.hidden = false
      return
    }
    start += list[i].seconds
  }
  head.hidden = true
}
function moveScene(from, to) {
  changeScenes(() => { const list = scenes(), [scene] = list.splice(from, 1); list.splice(to, 0, scene); activeScene = to })
}
function removeAsset(id) {
  startHold = true
  try {
    changeScenes(() => {
      project.assets = project.assets.filter(asset => asset.id !== id)
      project.scenes = scenes().filter(scene => scene.asset !== id)
      activeScene = null
    })
  } finally { startHold = false }
  markSelected()
}

// ---------- Sources of this video ----------
function drawSources() {
  const list = $('source-list'), assets = project.assets, usage = usageOf(assets, scenes())
  $('source-count').textContent = assets.length ? `${assets.length}개` : ''
  list.replaceChildren()
  if (!assets.length) { list.append(el('div', 'conai-empty', '아래에서 소재를 눌러 담아')); return }
  for (const asset of assets) {
    const row = el('div', 'conai-list-row sm src'), cover = el('span', 'cover'), main = el('span', 'conai-row-main'), name = el('input', 'src-name')
    if (isVisual(asset)) thumbs.into(cover, refKey(asset.reference)); else cover.append(svg('music'))
    name.value = assetName(assets, asset); name.maxLength = 40; name.setAttribute('aria-label', '소재 이름')
    name.onchange = () => { try { renameSource(asset.id, name.value) } catch (e) { name.value = assetName(project.assets, asset); error(e) } }
    main.append(name, el('small', 'conai-row-meta', `${kindLabel(asset)} · ${usage.get(asset.id)}`))
    const remove = button('', () => removeAsset(asset.id), 'conai-icon-button sm'); remove.title = '소재 빼기'; remove.setAttribute('aria-label', '소재 빼기'); remove.append(svg('x'))
    row.append(cover, main, remove); list.append(row)
  }
}
function renameSource(id, text) {
  const asset = project.assets.find(other => other.id === id), label = String(text ?? '').trim()
  if (!asset) throw new Error('그런 소재가 없어.')
  if (label.length > 40) throw new Error('소재 이름은 40자까지 쓸 수 있어.')
  if (label === assetName(project.assets, asset)) return
  if (label && project.assets.some(other => other.id !== id && assetName(project.assets, other) === label)) throw new Error('같은 이름의 소재가 있어.')
  if (label) asset.label = label; else delete asset.label
  redraw(); drawChat(); edit(`label:${id}`)
}

// ---------- Adjust ----------
function setValue(input, value) { if (document.activeElement !== input) input.value = String(value) }
function drawAdjust() {
  const list = scenes(), scene = list[activeScene], built = composed(), style = project.style ?? {}
  $('adjust-note').hidden = built
  $('slideshow').querySelector('span').textContent = composeArmed ? 'HTML 덮어쓰기 확인' : '장면으로 다시 구성'
  $('scene-empty').hidden = !!scene; $('scene-fields').hidden = !scene; $('scene-tools').hidden = !scene
  $('scene-title').textContent = scene ? `장면 ${activeScene + 1}` : '장면'
  $('scene-meta').textContent = ''
  if (scene) {
    const asset = project.assets.find(other => other.id === scene.asset), first = activeScene === 0
    $('scene-meta').textContent = asset ? `${assetName(project.assets, asset)} · ${kindLabel(asset)}` : '빈 장면'; $('scene-meta').title = $('scene-meta').textContent
    $('scene-seconds').max = String(Math.max(20, scene.seconds)); setValue($('scene-seconds'), scene.seconds); $('scene-seconds-out').textContent = `${scene.seconds}초`
    setValue($('scene-motion'), scene.motion ?? MOTIONS[0])
    $('scene-transition').disabled = first; setValue($('scene-transition'), scene.transition ?? 0)
    $('scene-transition-out').textContent = first ? '—' : scene.transition ? `${scene.transition}초` : '없음'
    setValue($('scene-caption'), scene.caption)
    for (const choice of $('scene-position').children) { const on = choice.dataset.pos === (scene.captionPosition ?? CAPTION_POSITIONS[0]); choice.classList.toggle('active', on); choice.setAttribute('aria-pressed', String(on)) }
    $('scene-left').disabled = first; $('scene-right').disabled = activeScene === list.length - 1
  }
  $('duration-field').hidden = built
  setValue($('style-caption-size'), style.captionSize ?? 10); $('style-caption-size-out').textContent = `${style.captionSize ?? 10}%`
  setValue($('style-accent'), style.accent ?? '#ffffff'); $('style-accent-reset').disabled = !style.accent
  $('volume-field').hidden = !project.assets.some(isAudio)
  setValue($('style-volume'), style.musicVolume ?? 0.8); $('style-volume-out').textContent = `${Math.round((style.musicVolume ?? 0.8) * 100)}%`
  drawControls()
}
function drawControls() {
  const controls = project.controls ?? [], box = $('controls')
  $('controls-group').hidden = !controls.length; $('controls-count').textContent = controls.length ? `${controls.length}개` : ''
  const key = JSON.stringify(controls.map(c => [c.id, c.type, c.label, c.min, c.max, c.step, c.unit]))
  if (key !== controlsKey) { controlsKey = key; box.replaceChildren(...controls.map(controlField)) }
  for (const control of controls) syncControl(control)
}
const controlText = control => `${control.value}${control.unit ?? ''}`
/** One row per control the html exposes: a slider, a switch or a colour; changing it rewrites its custom property in the html. */
function controlField(control) {
  const row = el('div', 'field'), id = control.id
  row.dataset.control = id; row.append(el('span', 'fl', control.label))
  if (control.type === 'range') {
    const wrap = el('div', 'slider'), input = el('input'), out = el('output')
    input.type = 'range'; input.min = control.min; input.max = control.max; input.step = control.step; input.setAttribute('aria-label', control.label)
    input.oninput = () => { try { setControl(id, Number(input.value), `control:${id}`) } catch (e) { error(e) } }
    wrap.append(input, out); row.append(wrap)
  } else if (control.type === 'toggle') {
    const wrap = el('div', 'conai-segmented full'); wrap.setAttribute('role', 'group'); wrap.setAttribute('aria-label', control.label)
    for (const [value, label] of [[false, '끔'], [true, '켬']]) { const choice = button(label, () => setControl(id, value), ''); choice.dataset.value = String(value); wrap.append(choice) }
    row.append(wrap)
  } else {
    const input = el('input'); input.type = 'color'; input.setAttribute('aria-label', control.label)
    input.oninput = () => { try { setControl(id, input.value, `control:${id}`) } catch (e) { error(e) } }
    row.append(input)
  }
  return row
}
function syncControl(control) {
  const row = $('controls').querySelector(`[data-control="${control.id}"]`)
  if (!row) return
  if (control.type === 'range') { setValue(row.querySelector('input'), control.value); row.querySelector('output').textContent = controlText(control) }
  else if (control.type === 'toggle') for (const choice of row.querySelectorAll('button')) { const on = choice.dataset.value === String(control.value); choice.classList.toggle('active', on); choice.setAttribute('aria-pressed', String(on)) }
  else setValue(row.querySelector('input'), control.value)
}
/** Sets one control's value in the draft and in the html. */
function setControl(id, raw, group = '') {
  const control = project.controls?.find(other => other.id === id)
  if (!control) throw new Error('그런 조정 항목이 없어.')
  if (control.type === 'range') {
    const n = Number(raw)
    if (!Number.isFinite(n)) throw new Error(`${control.label}에는 숫자를 넣어줘.`)
    control.value = Number(Math.min(control.max, Math.max(control.min, control.min + Math.round((n - control.min) / control.step) * control.step)).toFixed(6))
  } else if (control.type === 'toggle') {
    if (typeof raw !== 'boolean') throw new Error(`${control.label}에는 켬이나 끔(true/false)을 넣어줘.`)
    control.value = raw
  } else {
    if (!/^#[0-9a-f]{6}$/i.test(raw)) throw new Error(`${control.label}에는 #rrggbb 색을 넣어줘.`)
    control.value = raw.toLowerCase()
  }
  $('html').value = applyControls($('html').value, project.controls)
  syncControl(control); edit(group)
}

// ---------- Library ----------
function markSelected() {
  const order = new Map(project.assets.map((asset, index) => [refKey(asset.reference), index + 1]))
  for (const tile of $('search-results').querySelectorAll('.tile')) {
    const index = order.get(tile.dataset.key)
    tile.classList.toggle('selected', !!index)
    tile.querySelector('.order')?.remove()
    if (index) tile.querySelector('.conai-media').append(el('span', 'order', String(index)))
  }
}
async function addAsset(reference, name = '') {
  if (recoverable) throw new Error('임시 초안을 먼저 처리해줘.')
  if (project.assets.some(a => JSON.stringify(a.reference) === JSON.stringify(reference))) return
  if (project.assets.length >= 24) throw new Error('소재는 24개까지 선택해줘.')
  const epoch = changed, id = `media_${crypto.randomUUID().slice(0, 8)}`
  const { assets } = await api.server({ op: 'inspect', assets: [{ id, reference }] })
  if (epoch !== changed) throw new Error('초안이 바뀌었어. 소재 추가를 다시 눌러줘.')
  const asset = assets[0], label = defaultLabel(name, project.assets)
  if (label) asset.label = label
  startHold = true
  try {
    changeScenes(() => {
      const list = scenes(), placeholder = isVisual(asset) && list.length && list.every(scene => scene.asset === null) ? list.splice(0) : null
      project.assets.push(asset)
      if (isVisual(asset)) list.push({ asset: asset.id, seconds: 4, caption: placeholder ? placeholder[0].caption : list.length ? '' : $('title').value })
    })
  } finally { startHold = false }
  markSelected()
}
async function toggleAsset(reference, name) {
  const found = project.assets.find(asset => refKey(asset.reference) === refKey(reference))
  if (found) { removeAsset(found.id); return }
  await addAsset(reference, name)
}
async function runSearch(append = false) {
  const generation = ++queryGeneration, { kind, media, query } = search, page = append ? search.page + 1 : 1
  if (kind !== 'library' && !query) {
    grid.note(el('div', 'conai-empty', kind === 'files' ? '파일 이름이나 내용으로 검색해' : '보고 싶은 장면을 문장으로 적어줘'))
    $('more').hidden = true; libraryMore.rearm(); publish(); return
  }
  $('library-loading').hidden = !append
  const result = kind === 'files' ? await tool('search_files', { query, limit: 30 }) : kind === 'meaning'
    ? await tool('search_images_by_meaning', { text: query, limit: 30 })
    : await tool('search_images', { ...(query ? { search_text: query } : {}), ...(media !== 'all' ? { media_type: media } : {}), page, limit: 30 })
  if (generation !== queryGeneration) return
  $('library-loading').hidden = true
  const entries = kind === 'files'
    ? result.hits.map(hit => hit.entry).filter(entry => /^(image|video|audio)\//.test(entry.mimeType ?? '')).map(entry => ({ reference: { source: 'files', fileId: entry.id }, label: entry.name, mime: entry.mimeType }))
    : result.images.map(image => ({ reference: { source: 'library', compositeHash: image.composite_hash }, label: image.prompt ?? '', mime: image.mime_type ?? (image.media_type === 'video' ? 'video/mp4' : 'image/png'), width: image.width, height: image.height, duration: image.duration }))
  if (!append) { grid.clear(); $('library-scroll').scrollTop = 0 }
  for (const item of entries) grid.add(tile(item), item.width && item.height ? item.height / item.width : item.mime?.startsWith('audio/') ? 2 / 3 : 1)
  if (!append && !entries.length) grid.note(el('div', 'conai-empty', '일치하는 소재가 없어'))
  search.page = page; search.total = result.total ?? entries.length
  $('more').hidden = kind !== 'library' || page * 30 >= (result.total ?? 0)
  markSelected(); publish()
  if (!append) libraryMore.rearm()
}
function tile(item) {
  const key = refKey(item.reference), node = el('button', 'tile conai-media-card'), media = el('div', 'conai-media')
  node.type = 'button'; node.dataset.key = key; node.title = item.label || '소재'
  media.style.aspectRatio = item.width && item.height ? `${item.width} / ${item.height}` : item.mime?.startsWith('audio/') ? '3 / 2' : '1'
  node.append(media)
  if (item.mime?.startsWith('audio/')) {
    const kind = el('span', 'conai-overlay-badge tl'); kind.append(svg('music'), document.createTextNode('오디오')); media.append(kind, el('span', 'conai-overlay-caption', item.label))
  } else {
    thumbs.into(media, key)
    if (item.mime?.startsWith('video/')) { const kind = el('span', 'conai-overlay-badge tl'); kind.append(svg('play'), document.createTextNode(item.duration ? `${Math.round(item.duration)}초` : '영상')); media.append(kind) }
    if (item.reference.source === 'files' && item.label) media.append(el('span', 'conai-overlay-caption', item.label))
  }
  node.onclick = () => toggleAsset(item.reference, item.label).catch(error)
  if (item.reference.source === 'library') {
    const open = el('button', 'open conai-icon-button overlay'); open.type = 'button'; open.title = '라이브러리에서 열기'; open.setAttribute('aria-label', '라이브러리에서 열기'); open.append(svg('external'))
    open.onclick = event => { event.stopPropagation(); void api.navigation.open(`/images/${item.reference.compositeHash}`).catch(error) }
    media.append(open)
  }
  return node
}
function setSearch(next) {
  Object.assign(search, next)
  for (const tab of document.querySelectorAll('#pane-sources [data-kind]')) tab.classList.toggle('active', tab.dataset.kind === search.kind)
  for (const chip of document.querySelectorAll('#media-filter [data-media]')) chip.classList.toggle('active', chip.dataset.media === search.media)
  $('media-filter').hidden = search.kind !== 'library'
  $('query').placeholder = { library: '프롬프트로 검색', files: '파일 이름·내용으로 검색', meaning: '장면을 문장으로 설명' }[search.kind]
  $('query').value = search.query
}

/** Loads the next page while the sentinel near the end of a list is in view; stops while the sentinel is hidden. */
function endless(sentinel, load) {
  let running = false
  const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) void run() }) : null
  function rearm() { if (!observer) return; observer.unobserve(sentinel); if (!sentinel.hidden) observer.observe(sentinel) }
  async function run() {
    if (running || sentinel.hidden) return
    running = true
    try { await load() } catch (e) { error(e) } finally { running = false; rearm() }
  }
  return { rearm }
}

// ---------- Start screen ----------
function startScreen() {
  starting = true; document.body.dataset.start = ''; $('start').hidden = false
  place(); drawStart(); void loadRecent().catch(error)
}
function endStart() {
  if (!starting) return
  starting = false; delete document.body.dataset.start; $('start').hidden = true
  place()
}
function holdStart(action) { startHold = true; try { return action() } finally { startHold = false } }
function drawStart() {
  const box = $('start-sources'); box.replaceChildren()
  if (!project.assets.length) box.append(el('div', 'conai-empty', '왼쪽에서 소재를 눌러 담아'))
  for (const asset of project.assets) {
    const item = el('div', 'start-thumb'), media = el('div', 'conai-media'), remove = button('', () => removeAsset(asset.id), 'conai-icon-button overlay sm')
    if (isVisual(asset)) thumbs.into(media, refKey(asset.reference)); else media.append(el('span', 'conai-overlay-caption', assetName(project.assets, asset)))
    item.title = assetName(project.assets, asset); remove.title = '소재 빼기'; remove.setAttribute('aria-label', '소재 빼기'); remove.append(svg('x'))
    item.append(media, remove); box.append(item)
  }
}
async function loadRecent() {
  const result = await api.server({ op: 'list', query: '', stage: 'active', offset: 0 }), box = $('start-recent')
  box.replaceChildren()
  for (const item of result.items.slice(0, 3)) {
    const card = button('', async () => { if (await leaveDraft()) await openProject(item.fileId, true) }, 'conai-media-card'), media = el('div', 'conai-media'), body = el('div', 'conai-media-body')
    if (item.cover) thumbs.into(media, item.cover); else { media.append(svg('film')); media.style.display = 'grid'; media.style.placeItems = 'center' }
    body.append(el('div', 'conai-media-title', item.title), el('div', 'conai-media-meta', `${stages[item.stage]} · ${date(item.updatedAt)}`))
    card.append(media, body); box.append(card)
  }
  if (!result.items.length) box.append(el('div', 'conai-empty', '최근 프로젝트가 없어'))
}
async function startWithAi() {
  const text = $('start-brief').value.trim()
  if (!text) { $('start-brief').focus(); throw new Error('어떤 영상인지 한 줄로 적어줘.') }
  if ($('start-profile').value) $('profile').value = $('start-profile').value
  if (!Number($('profile').value)) throw new Error('사용할 AI 프로필이 없어. 채팅 프로필을 먼저 만들어줘.')
  endStart(); openPanel('ai')
  await createWithAi({ brief: text })
}

// ---------- Projects ----------
const projectStage = () => document.querySelector('#project-filter [data-stage].active')?.dataset.stage ?? 'active'
function openProjects() {
  $('project-manager').hidden = false; $('drawer-backdrop').hidden = false; $('projects').setAttribute('aria-expanded', 'true')
  return projects()
}
function closeProjects() {
  $('project-manager').hidden = true; $('drawer-backdrop').hidden = true; $('projects').setAttribute('aria-expanded', 'false'); $('legacy-list').hidden = true
}
async function openProject(id, discard = false) {
  ensureIdle()
  if (dirty() && !discard) throw new Error('미저장 초안이 있어. 먼저 저장해줘.')
  const epoch = changed, loaded = await api.server({ op: 'read', fileId: id })
  if (epoch !== changed) throw new Error('불러오는 중 초안이 바뀌었어. 현재 편집을 유지했어.')
  applyLoaded(loaded); endStart(); await storeDraft(); closeProjects()
  await loadHistory()
}
async function projects(offset = 0) {
  const generation = ++listGeneration
  const result = await api.server({ op: 'list', query: $('project-query').value, stage: projectStage(), offset })
  if (generation !== listGeneration) return
  projectOffset = offset; projectNext = result.nextOffset
  projectList = offset ? [...projectList, ...result.items] : result.items
  if (!offset) { $('project-list').replaceChildren(); $('project-scroll').scrollTop = 0 }
  for (const item of result.items) {
    const row = button('', async () => { if (await leaveDraft()) await openProject(item.fileId, true) }, `conai-list-row prow${saved?.fileId === item.fileId ? ' selected' : ''}`)
    const cover = el('span', 'cover'), info = el('span', 'conai-row-main')
    if (item.cover) thumbs.into(cover, item.cover); else cover.append(svg('film'))
    info.append(el('strong', 'conai-row-title', item.title), el('small', 'conai-row-meta', `${stages[item.stage]} · ${date(item.updatedAt)}`))
    row.append(cover, info); $('project-list').append(row)
  }
  if (!projectList.length) $('project-list').replaceChildren(el('div', 'conai-empty', '프로젝트가 없어'))
  $('project-page').textContent = `${result.total}개`
  $('project-more').hidden = result.nextOffset === null
  publish()
  if (!offset) projectMore.rearm()
}
async function legacyProjects() {
  const result = await tool('search_files', { query: `HyperFrames ${$('project-query').value}`.trim(), limit: 50 })
  const list = $('legacy-list'); list.replaceChildren(); list.hidden = false
  const hits = result.hits.filter(x => x.entry.name.toLowerCase().endsWith('.json'))
  for (const hit of hits) {
    const row = button('', async () => { if (await leaveDraft()) await openProject(hit.entry.id, true) }, 'conai-list-row prow')
    const cover = el('span', 'cover'); cover.append(svg('file'))
    const info = el('span', 'conai-row-main'); info.append(el('strong', 'conai-row-title', hit.entry.name), el('small', 'conai-row-meta', '열면 목록에 등록돼'))
    row.append(cover, info); list.append(row)
  }
  if (!hits.length) list.append(el('div', 'conai-empty', '찾은 파일이 없어'))
}

// ---------- Outputs: the version strip of the result view ----------
async function loadHistory() {
  const generation = ++historyGeneration, id = saved?.fileId
  if (!id) { outputHistory = []; drawHistory(); return }
  const result = await api.server({ op: 'history', fileId: id })
  if (generation !== historyGeneration || saved?.fileId !== id) return
  outputHistory = result.items
  drawHistory(); publish()
  const latest = result.items[0]
  if (!renderJob && latest && ['queued', 'running'].includes(latest.status)) { renderJob = latest.jobId; void refreshJob().catch(error) }
}
function versionCard(item, number) {
  const running = jobRunning && item?.jobId === renderJob || !item
  const node = el(running ? 'div' : 'button', `ver conai-media-card${running ? ' running' : ''}${item?.compositeHash && item.compositeHash === resultHash ? ' selected' : ''}`), media = el('div', 'conai-media'), body = el('div', 'conai-media-body'), meta = el('div', 'conai-media-meta')
  if (!running) node.type = 'button'
  if (running) {
    const bar = el('progress'), percent = el('span', '', `${jobPercent}%`)
    bar.id = 'ver-progress'; bar.max = 100; bar.value = jobPercent; percent.id = 'ver-percent'
    const cancel = button('취소', () => mutation('cancel', 'p_hyperframes_cancel_render', { jobId: renderJob }), 'ghost')
    media.append(el('span', '', '출력 중'), bar); meta.append(percent, cancel)
    body.append(el('div', 'conai-media-title', `${number}차 출력`), meta)
    node.append(media, body); node.title = '출력 중'; return node
  }
  const state = item.status === 'completed' ? (item.preview ? '초안' : '최종 화질') : jobStates[item.status] ?? item.status
  media.append(el('span', `conai-overlay-badge tl${item.status === 'failed' ? ' destructive' : item.status === 'completed' ? '' : ' warn'}`, jobStates[item.status] ?? item.status))
  meta.append(el('span', '', date(item.createdAt)))
  if (saved && item.revision !== saved.revision) meta.append(el('span', '', '이전 저장본'))
  body.append(el('div', 'conai-media-title', `${number}차 · ${state}`), meta); node.append(media, body)
  if (item.compositeHash) { thumbs.into(media, `library:${item.compositeHash}`); node.title = '플레이어에서 보기'; node.onclick = () => showOutput(item.compositeHash).then(drawHistory).catch(error) }
  else { node.title = '작업 상태 확인'; node.onclick = async () => { renderJob = item.jobId; await refreshJob().catch(error); await loadHistory().catch(error) } }
  return node
}
function drawHistory() {
  $('identity').textContent = saved ? `리비전 ${saved.revision.slice(0, 8)}` : '저장 전'
  $('identity').title = saved ? `파일 ID ${saved.fileId}\n리비전 ${saved.revision}` : ''
  const strip = $('versions'), items = [...outputHistory].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  strip.replaceChildren()
  if (!saved) strip.append(el('div', 'conai-empty', '저장하고 출력하면 버전이 여기 쌓여'))
  else {
    if (jobRunning && renderJob && !items.some(item => item.jobId === renderJob)) strip.append(versionCard(null, items.length + 1))
    items.forEach((item, index) => strip.append(versionCard(item, items.length - index)))
  }
  drawResultInfo()
}
function drawResultInfo() {
  const item = outputHistory.find(other => other.compositeHash && other.compositeHash === resultHash)
  $('result-info').hidden = !(viewMode === 'output' && resultHash)
  $('result-revision').textContent = !item || !saved ? '' : item.revision === saved.revision ? '현재 저장본과 같음' : '이전 저장본'
}
async function showOutput(hash) {
  const fileId = saved?.fileId, jobId = renderJob
  const downloads = await tool('get_media_download', { composite_hashes: [hash] })
  const artifact = downloads.items[0]?.artifact
  if (!artifact) return false
  const media = await api.media.open(artifact.artifact_id)
  if (fileId !== saved?.fileId || jobId !== renderJob) return true
  resultHash = hash; lastMediaRefresh = Date.now()
  $('output').src = media.url; setMode('output')
  return true
}

// ---------- Save, render, review ----------
async function completeRequest(id, raw) {
  const request = pending.get(id)
  if (!request) return
  pending.delete(id)
  const result = unpack(raw)
  if (request.kind === 'save' || request.kind === 'copy') {
    if ((saved?.fileId ?? null) !== request.originalFile) return
    saved = { fileId: result.fileId, revision: result.revision }; savedChange = request.epoch
    endStart()
    if (request.kind === 'copy') resetOutput()
    if (changed === request.epoch) { project = result.project; updateForm(true); lastSnap = snapshot() }
    else publish()
    await storeDraft(); saveRetry = null
    report(dirty() ? '저장했어. 저장 요청 후 편집한 초안은 남겨뒀어.' : request.kind === 'copy' ? '복사본을 저장하고 열었어.' : '저장했어.')
    drawHistory()
    if (!$('project-manager').hidden) await projects(0)
  } else if (request.kind === 'render') {
    renderJob = result.jobId; outputRetries = 0; await refreshJob(); await loadHistory(); publish()
  } else if (request.kind === 'cancel') {
    await refreshJob(); await loadHistory()
  }
}
async function mutation(kind, name, args) {
  if (busy || pending.size) throw new Error('진행 중인 요청을 먼저 확인해줘.')
  busy = true
  const operation = { kind, epoch: changed, originalFile: saved?.fileId ?? null }
  try {
    const response = await api.app.call(name, args, args.requestId ?? unique())
    pending.set(response.id, operation)
    if (response.status === 'pending') { report('앱 검토 카드에서 대상과 입력을 확인하고 적용해줘.'); return false }
    const done = ['completed', 'failed', 'cancelled'].includes(response.status) ? response : await api.app.wait(response.id)
    if (done.status !== 'completed') { pending.delete(response.id); saveRetry = null; throw new Error(done.error || '작업이 완료되지 않았어.') }
    await completeRequest(response.id, done.result)
    return true
  } finally { busy = false }
}
async function saveProject(copy = false) {
  if (recoverable) throw new Error('먼저 임시 초안을 복구하거나 버려줘.')
  const value = form()
  if (copy) { value.title = `${value.title.slice(0, 94)} (복사본)`; value.stage = 'draft' }
  const document = JSON.stringify(value)
  const input = { document, ...(!copy && saved ? { fileId: saved.fileId, revision: saved.revision } : {}) }, signature = JSON.stringify(input)
  if (!saveRetry || saveRetry.signature !== signature) saveRetry = { signature, requestId: unique() }
  return mutation(copy ? 'copy' : 'save', 'p_hyperframes_save_project', { ...input, requestId: saveRetry.requestId })
}
/** `fromUi`: a blocked attempt opens the renderer dialog instead of raising an error toast. */
async function render(preview = false, fromUi = false) {
  if (renderer && !renderer.ready) { openRenderer(); if (fromUi) return false; throw new Error('렌더러를 먼저 설치해줘.') }
  if (dirty() || !saved) { if (!await saveProject()) return false; if (dirty()) throw new Error('저장 중 바뀐 편집이 있어. 다시 저장해줘.') }
  return mutation('render', 'p_hyperframes_render', { ...saved, requestId: unique(), preview })
}
async function refreshJob() {
  clearTimeout(timer)
  for (const id of [...pending.keys()]) {
    const request = await api.app.getRequest(id)
    if (request.status === 'completed') await completeRequest(id, request.result)
    else if (['failed', 'cancelled'].includes(request.status)) { pending.delete(id); saveRetry = null; report(request.error || '요청이 취소됐어.', true) }
  }
  if (!renderJob) return
  const jobId = renderJob, id = saved?.fileId
  const job = await api.server({ op: 'job', jobId })
  if (jobId !== renderJob || saved?.fileId !== id) return
  const running = ['queued', 'running'].includes(job.status), was = jobRunning
  jobRunning = running; jobPercent = job.progress?.percentage ?? 0
  // A finished job changes its history entry (status, library result): read it again so the card is complete without a manual refresh.
  const entry = outputHistory.find(item => item.jobId === jobId)
  if (!running && (entry?.status !== job.status || (job.result?.compositeHash && entry.compositeHash !== job.result.compositeHash))) {
    await loadHistory()
    if (jobId !== renderJob || saved?.fileId !== id) return
  }
  $('job').hidden = !running
  $('progress').value = jobPercent
  $('job-state').textContent = job.status === 'queued' ? '대기 중' : `렌더링 ${jobPercent}%`
  if (was !== running) drawHistory()
  else if (running && $('ver-progress')) { $('ver-progress').value = jobPercent; $('ver-percent').textContent = `${jobPercent}%` }
  if (job.status === 'completed' && job.result?.compositeHash && resultHash !== job.result.compositeHash) {
    if (job.result.projectFileId !== id) return
    if (!await showOutput(job.result.compositeHash)) {
      report('영상은 저장됐어. 라이브러리에서 재생 준비 중이야.')
      if (outputRetries++ < 15 && !document.hidden) timer = setTimeout(() => refreshJob().catch(error), 2000)
      return
    }
    if (jobId !== renderJob || saved?.fileId !== id) return
    report(job.result.preview ? '초안 영상을 만들었어.' : 'MP4를 만들었어.')
    drawHistory()
  } else if (job.error) report(job.error, true)
  publish()
  if (running && !document.hidden) timer = setTimeout(() => refreshJob().catch(error), 2000)
}

// ---------- Live preview and result view ----------
/** Redraws the in-browser preview from the current draft; true when what it shows will change. */
function showLive(wait) {
  if (!live) return false
  const [width, height] = size()
  return live.show({ html: $('html').value, files: previewFiles(project.assets), width, height }, wait)
}
function drawTransport(state) {
  const duration = state.duration || Number($('duration').value) || 0
  $('scrub').max = String(duration)
  if (!scrubbing) $('scrub').value = String(state.time)
  $('clock').textContent = `${clock(state.time)} / ${clock(duration)}`
  const play = state.playing ? '일시정지 (Space)' : '재생 (Space)', mute = state.muted ? '소리 켜기' : '소리 끄기'
  $('play').replaceChildren(svg(state.playing ? 'pause' : 'play')); $('play').title = play; $('play').setAttribute('aria-label', play)
  $('mute').replaceChildren(svg(state.muted ? 'volume-x' : 'volume')); $('mute').title = mute; $('mute').setAttribute('aria-label', mute)
  drawPlayhead(state.time)
}
/** The viewer shows the live draft (편집) or the output being reviewed (결과 보기); hosts without previews keep the output player only. */
function setMode(mode) {
  viewMode = live ? mode : 'output'
  const output = viewMode === 'output'
  document.body.dataset.view = output && live ? 'result' : 'edit'
  $('live').hidden = output; $('transport').hidden = output; $('result-bar').hidden = !output; $('versions').hidden = !output
  $('output').hidden = !output || !resultHash; $('empty-preview').hidden = !output || !!resultHash
  $('empty-preview').textContent = live ? '아직 출력한 영상이 없어' : '앱을 업데이트하면 실시간 미리보기가 나와'
  if (output) live?.pause(); else $('output').pause()
  $('view-mode').hidden = !live
  for (const tab of document.querySelectorAll('#view-mode [data-mode]')) { tab.classList.toggle('active', tab.dataset.mode === viewMode); tab.setAttribute('aria-selected', String(tab.dataset.mode === viewMode)) }
  drawResultInfo(); drawMarkers(); drawScope()
}
function switchMode(mode) {
  setMode(mode)
  const latest = viewMode === 'output' && !resultHash ? outputHistory.find(item => item.compositeHash) : null
  if (latest) void showOutput(latest.compositeHash).then(drawHistory).catch(error)
}
const outputLength = () => Number.isFinite($('output').duration) && $('output').duration > 0 ? $('output').duration : Number($('duration').value) || 1
function sceneAt(time) {
  let start = 0
  const list = project.scenes ?? []
  for (let i = 0; i < list.length; i++) { start += list[i].seconds; if (time < start) return i + 1 }
  return list.length || null
}
function drawMarkers() {
  const box = $('markers'), pins = $('pins')
  box.hidden = !markers.length; pins.hidden = !markers.length || viewMode !== 'output'; box.replaceChildren(); pins.replaceChildren()
  if (!markers.length) return
  const head = el('div', 'conai-group-head'); head.append(el('span', '', `표시한 구간 ${markers.length}곳`)); box.append(head)
  const list = el('div', 'conai-list'); box.append(list)
  markers.forEach((marker, index) => {
    const row = el('div', 'conai-list-row sm interactive'), main = el('span', 'conai-row-main'), remove = el('button', 'conai-icon-button sm')
    main.append(el('span', 'conai-row-title', `${index + 1} · ${clock(marker.time)}${marker.scene ? ` · 장면 ${marker.scene}` : ''}`), el('small', 'conai-row-meta', marker.note || '메모 없음'))
    row.onclick = () => seekOutput(marker.time)
    remove.type = 'button'; remove.title = '표시 지우기'; remove.setAttribute('aria-label', '표시 지우기'); remove.append(svg('x')); remove.onclick = event => { event.stopPropagation(); removeMarker(marker.id) }
    row.append(main, remove); list.append(row)
    const pin = el('button', 'pin', String(index + 1)); pin.type = 'button'; pin.title = `${clock(marker.time)} · ${marker.note || '메모 없음'}`; pin.style.left = `${Math.min(97, Math.max(3, marker.time / outputLength() * 100))}%`
    pin.onclick = () => seekOutput(marker.time); pins.append(pin)
  })
}
function seekOutput(time) { if (viewMode !== 'output') switchMode('output'); $('output').currentTime = time }
function removeMarker(id) {
  markers = markers.filter(marker => marker.id !== id); markerSel.delete(id)
  if (!markerSel.size && scope.kind === 'markers') scope = { kind: 'all' }
  drawMarkers(); drawScope()
}
function openMark() {
  markTime = $('output').currentTime || 0; $('output').pause()
  $('mark-form').hidden = false; $('mark-note').value = ''; $('mark-note').focus()
}
function addMarker(note) {
  const marker = { id: ++markerSeq, time: Math.round(markTime * 10) / 10, scene: sceneAt(markTime), note: note.trim() }
  markers.push(marker); markers.sort((a, b) => a.time - b.time); markerSel.add(marker.id); scope = { kind: 'markers' }
  $('mark-form').hidden = true
  openPanel('ai'); drawMarkers(); drawScope()
}

// ---------- Renderer ----------
async function refreshRenderer() {
  clearTimeout(rendererTimer)
  const before = renderer
  renderer = await api.server({ op: 'status' })
  if (before?.install?.status === 'running' && renderer.install?.status === 'completed') report('렌더러를 설치했어.')
  drawRenderer(); publish()
  if (renderer.install?.status === 'running' && !document.hidden) rendererTimer = setTimeout(() => refreshRenderer().catch(error), 2000)
}
function check(id, state, note) {
  const node = $(`check-${id}`); node.className = `st ${state}`; node.replaceChildren(state === 'ok' ? svg('check') : state === 'no' ? svg('x') : '')
  $(`check-${id}-note`).textContent = note
}
function openRenderer() {
  rendererOpen = true
  if (!$('renderer-dialog').open) $('renderer-dialog').showModal()
  if (renderer) drawRenderer()
  void refreshRenderer().catch(error)
}
function closeRenderer() { rendererOpen = false; if ($('renderer-dialog').open) $('renderer-dialog').close() }
function drawRenderer() {
  const r = renderer, install = r.install ?? { status: 'idle', log: [] }, running = install.status === 'running', browser = r.browser ?? { ok: false }, pack = r.package ?? { ok: false }
  setBadge($('renderer'), r.ready ? '출력 가능' : running ? '렌더러 설치 중' : pack.ok ? 'Chromium 필요' : '출력 준비 필요', r.ready ? 'ok' : 'warn', 'renderer-badge')
  // Editing and the live preview need no renderer; the dialog opens from the badge or an output attempt.
  const hint = r.ready ? '' : '렌더러를 먼저 설치해줘'
  $('preview').title = hint || '초안 화질 MP4로 빠르게 렌더'; $('render').title = hint || '최종 화질 MP4로 렌더'
  if (!rendererOpen) return
  $('renderer-title').textContent = r.ready ? '렌더러 준비됨' : running ? '렌더러 설치 중' : !browser.ok ? 'Chromium을 찾을 수 없어' : '렌더러를 설치해야 영상을 만들 수 있어'
  check('browser', browser.ok ? 'ok' : 'no', browser.ok ? browser.path : '없음')
  check('package', pack.ok ? 'ok' : running ? 'run' : 'no', pack.ok ? `HyperFrames ${pack.version}` : running ? '내려받는 중' : 'npm 설치 · 몇 분')
  const log = running ? install.log.join('\n') : [
    install.status === 'failed' || install.status === 'cancelled' ? install.error : '',
    browser.ok ? '' : 'Docker로 실행 중이면 CoNAI 이미지를 새로 빌드해줘(Chromium 포함).\n직접 실행 중이면 Chrome이나 Edge를 설치하거나 PUPPETEER_EXECUTABLE_PATH에 브라우저 경로를 지정해줘.',
  ].filter(Boolean).join('\n\n')
  $('renderer-log').textContent = log ?? ''; $('renderer-log').hidden = !log
  $('renderer-admin').hidden = r.ready || r.canInstall
  const canStart = !pack.ok && !running
  $('install').hidden = !canStart || !r.canInstall
  $('install-cancel').hidden = !running || !r.canInstall
  $('renderer-recheck').hidden = running
}

// ---------- AI: scope, mentions, the conversation and its changes ----------
function scopeInfo() {
  const list = scenes()
  if (scope.kind === 'scene' && list[activeScene]) return { kind: 'scene', index: activeScene, label: `장면 ${activeScene + 1}만` }
  if (scope.kind === 'markers') {
    const chosen = markers.map((marker, index) => ({ ...marker, n: index + 1 })).filter(marker => markerSel.has(marker.id))
    if (chosen.length) return { kind: 'markers', markers: chosen, label: `표시 ${chosen.map(marker => marker.n).join('·')}` }
  }
  return { kind: 'all', label: '전체 영상' }
}
function drawScope() {
  const info = scopeInfo(), box = $('scope-chips')
  const chip = (label, active, action) => { const b = button(label, action, 'conai-chip'); b.setAttribute('aria-pressed', String(active)); return b }
  box.replaceChildren(chip('전체 영상', info.kind === 'all', () => { scope = { kind: 'all' }; markerSel.clear(); drawScope() }))
  if (scenes()[activeScene]) box.append(chip(`장면 ${activeScene + 1}만`, info.kind === 'scene', () => { scope = { kind: 'scene' }; markerSel.clear(); drawScope() }))
  markers.forEach((marker, index) => box.append(chip(`표시 ${index + 1}`, info.kind === 'markers' && markerSel.has(marker.id), () => {
    // Choosing a mark while another scope is active starts a new choice; the old marks are not carried along.
    if (scope.kind !== 'markers') markerSel.clear()
    if (markerSel.has(marker.id)) markerSel.delete(marker.id); else markerSel.add(marker.id)
    scope = markerSel.size ? { kind: 'markers' } : { kind: 'all' }; drawScope()
  })))
}
const MENTION = /[@＠]/
/** A request's ＠names as small source chips. */
function withRefs(text) {
  const names = project.assets.map(asset => assetName(project.assets, asset)).sort((a, b) => b.length - a.length)
  if (!names.length || !MENTION.test(text)) return [document.createTextNode(text)]
  const pattern = new RegExp(`[@＠](${names.map(escapeRegExp).join('|')})`, 'g'), nodes = []
  let last = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) nodes.push(document.createTextNode(text.slice(last, match.index)))
    const asset = project.assets.find(other => assetName(project.assets, other) === match[1]), chip = el('span', 'ref')
    if (isVisual(asset)) thumbs.into(chip, refKey(asset.reference))
    chip.append(document.createTextNode(match[1])); nodes.push(chip); last = match.index + match[0].length
  }
  if (last < text.length) nodes.push(document.createTextNode(text.slice(last)))
  return nodes
}
function drawMention() {
  const menu = $('mention-menu'); menu.replaceChildren()
  if (!project.assets.length) menu.append(el('div', 'conai-empty', '이 영상의 소재가 없어'))
  for (const asset of project.assets) {
    const name = assetName(project.assets, asset), item = button('', () => insertMention(name), 'ghost')
    item.setAttribute('role', 'menuitem'); item.append(el('span', '', name), el('small', 'muted', kindLabel(asset))); menu.append(item)
  }
}
function insertMention(name) {
  const box = $('brief'), start = box.selectionStart ?? box.value.length, end = box.selectionEnd ?? start
  box.setRangeText(`@${name} `, start, end, 'end'); box.focus(); closeMenus()
}
function drawChat() {
  const box = $('chat'); box.replaceChildren()
  if (!chat.length) box.append(el('div', 'conai-empty', '지시를 보내면 대화가 여기 쌓여'))
  const profileName = $('profile').selectedOptions?.[0]?.textContent || 'AI'
  for (const message of chat) {
    const node = el('div', `msg ${message.who === 'me' ? 'me' : 'ai'}${message.error ? ' error' : ''}`), text = el('p')
    node.append(el('div', 'who', message.who === 'me' ? `나 · ${message.scope}` : profileName))
    text.append(...(message.who === 'me' ? withRefs(message.text) : [document.createTextNode(message.text)])); node.append(text)
    if (message.changes) {
      if (message.changes.length) {
        const list = el('ul', 'changes')
        for (const change of message.changes) { const row = el('li'); row.append(el('span', '', change.text)); if (change.note) row.append(el('em', '', change.note)); list.append(row) }
        node.append(list)
      } else {
        node.append(el('p', 'muted', '바뀐 내용이 없어.'))
        node.append(el('p', 'muted', '고른 프로필이 이 플러그인의 저장 도구(p_hyperframes_save_project)를 쓸 수 있어야만 수정이 저장돼. 프로필의 도구 설정을 확인해줘.'))
      }
    }
    const actions = el('div', 'msg-actions')
    if (message.changes?.length && message.before) actions.append(message.reverted ? el('span', 'muted', '되돌렸어') : button('이 변경 되돌리기', () => revertAi(message)))
    if (message.threadId) { const open = button('작업 대화', () => api.navigation.openChat(message.threadId)); open.prepend(svg('chat')); actions.append(open) }
    if (actions.children.length) node.append(actions)
    box.append(node)
  }
  box.parentElement.scrollTop = box.parentElement.scrollHeight
}
/** Puts the draft back as it was before the run; the replaced draft stays undoable and the saved project is untouched until the next save. */
function revertAi(message) {
  if (recoverable) throw new Error('임시 초안을 먼저 처리해줘.')
  applySnapshot(message.before); message.reverted = true; drawChat()
  report('AI가 바꾸기 전 초안으로 되돌렸어. 저장하면 반영돼.')
}
function setAiBusy(busyNow) { $('ai-cancel').hidden = !busyNow; $('ai').disabled = busyNow }
async function createWithAi({ brief: given } = {}) {
  if (aiJob) throw new Error('AI 작업이 진행 중이야.')
  const brief = (given ?? $('brief').value).trim(), profileId = Number($('profile').value)
  if (!profileId) throw new Error('사용할 AI 프로필이 없어. 채팅 프로필을 먼저 만들어줘.')
  if (!brief) { $('brief').focus(); throw new Error('AI에게 요청할 내용을 적어줘.') }
  if (dirty() || !saved) if (!await saveProject()) return
  const epoch = changed, beforeText = snapshot(), before = JSON.parse(beforeText), info = scopeInfo()
  const message = aiMessage({ brief, scope: info, assets: project.assets, scenes: scenes(), fileId: saved.fileId, revision: saved.revision })
  const reply = { who: 'ai', text: 'AI가 소재를 찾고 영상을 고치는 중…' }
  chat.push({ who: 'me', scope: info.label, text: brief }, reply)
  if (given === undefined) $('brief').value = ''
  openPanel('ai'); drawChat(); setAiBusy(true); aiStopping = false
  try {
    const job = await api.llm.start({ requestId: unique(), profileId, mode: 'profile', message })
    aiJob = job.jobId
    // 중단 pressed while the run was still starting had no job to cancel; it stops the run as soon as there is one.
    if (aiStopping) await api.llm.cancel(aiJob)
    // The run has no plugin deadline; one SDK wait ends within ten minutes, so wait again until the job finishes or is cancelled.
    let done = null
    while (!done) done = await api.llm.wait(aiJob).catch(e => { if (e?.name === 'TimeoutError') return null; throw e })
    if (done.status !== 'completed') throw new Error(done.error || 'AI 작업이 끝나지 않았어.')
    reply.text = done.result?.text || '작업 대화에서 결과를 확인해줘.'; reply.threadId = done.result?.profileRun?.threadId ?? null
    aiJob = null
    if (!dirty() && epoch === changed) {
      const loaded = await api.server({ op: 'read', fileId: saved.fileId })
      if (epoch === changed) {
        // Compared as the AI saved it: opening the project would invent scenes for a save that has none.
        const after = JSON.parse(JSON.stringify(loaded.project))
        applyLoaded(loaded, true); setMode('live'); await storeDraft()
        reply.changes = summarize(before, after); reply.before = beforeText
      }
    }
  } catch (e) { reply.text = e.message ?? String(e); reply.error = true }
  finally { aiJob = null; setAiBusy(false); drawChat() }
}

function editDetails({ title, stage }) {
  if (recoverable) throw new Error('임시 초안을 먼저 처리해줘.')
  if (title !== undefined) {
    if (typeof title !== 'string' || !title.trim() || title.length > 100) throw new Error('제목은 1~100자로 입력해줘.')
    $('title').value = title
  }
  if (stage !== undefined) {
    if (!Object.hasOwn(stages, stage)) throw new Error('프로젝트 상태를 확인해줘.')
    $('stage').value = stage
  }
  edit('details')
}
/** The page assistant's scene edit: the same fields and rebuild rules as the adjust tab. Scenes are numbered from 1. */
function editScene({ index, seconds, caption, motion, transition, captionPosition }) {
  if (recoverable) throw new Error('임시 초안을 먼저 처리해줘.')
  const list = scenes(), scene = list[index - 1]
  if (!scene) throw new Error(list.length ? `장면 ${index}번이 없어. 장면은 1~${list.length}번이야.` : '장면이 없어.')
  if (seconds !== undefined && !(seconds >= 0.5 && seconds <= 60)) throw new Error('장면 길이는 0.5~60초로 정해줘.')
  if (caption !== undefined && (typeof caption !== 'string' || caption.length > 200)) throw new Error('자막은 200자까지 쓸 수 있어.')
  if (motion !== undefined && !MOTIONS.includes(motion)) throw new Error(`움직임은 ${MOTIONS.join(', ')} 중에서 골라줘.`)
  if (transition !== undefined && !(transition >= 0 && transition <= 2)) throw new Error('전환은 0~2초로 정해줘.')
  if (captionPosition !== undefined && !CAPTION_POSITIONS.includes(captionPosition)) throw new Error(`자막 위치는 ${CAPTION_POSITIONS.join(', ')} 중에서 골라줘.`)
  changeScenes(() => {
    if (seconds !== undefined) scene.seconds = Math.round(seconds * 10) / 10
    if (caption !== undefined) scene.caption = caption
    if (motion !== undefined) setOptional(scene, 'motion', motion, MOTIONS[0])
    if (transition !== undefined) setOptional(scene, 'transition', Math.round(transition * 10) / 10, 0)
    if (captionPosition !== undefined) setOptional(scene, 'captionPosition', captionPosition, CAPTION_POSITIONS[0])
    activeScene = index - 1
  }, composed())
}
function setOptional(scene, key, value, fallback) { if (value === fallback) delete scene[key]; else scene[key] = value }
/** The page assistant's style edit: caption size/colour, music volume, size, frame rate and (for hand-written html) the length. */
function editStyle({ captionSize, accent, musicVolume, size: sizeText, fps, duration }) {
  if (recoverable) throw new Error('임시 초안을 먼저 처리해줘.')
  if (captionSize !== undefined && !(captionSize >= 3 && captionSize <= 25)) throw new Error('자막 크기는 3~25 사이로 정해줘.')
  if (accent !== undefined && accent !== '' && !/^#[0-9a-f]{6}$/i.test(accent)) throw new Error('자막 색은 #rrggbb 형식으로 써줘.')
  if (musicVolume !== undefined && !(musicVolume >= 0 && musicVolume <= 1)) throw new Error('음악 볼륨은 0~1 사이로 정해줘.')
  if (fps !== undefined && ![24, 30].includes(fps)) throw new Error('프레임은 24 또는 30이야.')
  if (duration !== undefined && (!(duration >= 1 && duration <= 120) || composed())) throw new Error(composed() ? '장면으로 만든 영상은 장면 길이의 합이 영상 길이야.' : '영상 길이는 1~120초로 정해줘.')
  let sized = null
  if (sizeText !== undefined) {
    const [width, height] = String(sizeText).split('x').map(Number)
    if (!(width >= 64 && height >= 64 && width <= 1920 && height <= 1920 && width % 2 === 0 && height % 2 === 0 && width * height <= 1920 * 1080)) throw new Error('화면 크기는 64~1920 사이 짝수, 1920×1080 이하로 정해줘.')
    ensureSizeOption(width, height); sized = `${width}x${height}`
  }
  // One call is one undo step, however many fields it sets.
  oneStep(() => {
    if (sized) { $('size').value = sized; applySize() }
    if (fps !== undefined) { $('fps').value = String(fps); edit('fps') }
    if (duration !== undefined) { $('duration').value = String(duration); edit('duration') }
    if (captionSize !== undefined || accent !== undefined || musicVolume !== undefined) changeStyle(style => {
      if (captionSize !== undefined) style.captionSize = captionSize
      if (accent !== undefined) { if (accent) style.accent = accent.toLowerCase(); else delete style.accent }
      if (musicVolume !== undefined) style.musicVolume = musicVolume
    })
  })
}
function nameSource({ source, label }) {
  if (recoverable) throw new Error('임시 초안을 먼저 처리해줘.')
  const asset = project.assets.find(other => other.id === source || assetName(project.assets, other) === source)
  if (!asset) throw new Error('그런 소재가 없어. 소재 ID나 이름을 확인해줘.')
  renameSource(asset.id, label)
}
async function restoreDraft() {
  if (!recoverable) return
  if (dirty() || busy || pending.size || aiJob) throw new Error('현재 작업을 먼저 마쳐줘.')
  const draft = recoverable
  if (!draft.project || draft.project.format !== 'conai.hyperframes.v1' || typeof draft.project.html !== 'string' || !Array.isArray(draft.project.assets)
    || (draft.saved && (!/^[a-f0-9]{32}$/.test(draft.saved.fileId) || !/^[a-f0-9]{64}$/.test(draft.saved.revision)))) throw new Error('임시 초안 형식을 확인할 수 없어.')
  resetOutput(); project = draft.project; saved = draft.saved ?? null; recoverable = null; changed++; savedChange = changed - 1
  $('recovery').hidden = true; document.querySelector('main').inert = false
  endStart(); updateForm(); rebase(); report('임시 초안을 복구했어. 저장본이 바뀌었다면 덮어쓰지 않고 저장 충돌을 알려줄 거야.')
  void loadHistory().catch(error)
}

// ---------- Panels, menus and responsive placement ----------
const wide = matchMedia('(min-width: 1200px)'), twoColumns = matchMedia('(min-width: 900px)')
function showPanel(tab) {
  document.body.dataset.panel = tab
  for (const id of PANELS) $(`tab-${id}`).hidden = id !== tab
  if ($('pane-sources').parentElement === $('panel')) $('pane-sources').hidden = tab !== 'sources'
  for (const choice of document.querySelectorAll('[data-ptab]')) { const on = choice.dataset.ptab === tab; choice.classList.toggle('active', on); choice.setAttribute('aria-selected', String(on)) }
}
function selectMtab(tab) {
  document.body.dataset.mtab = tab
  for (const choice of document.querySelectorAll('[data-mtab]')) { const on = choice.dataset.mtab === tab; choice.classList.toggle('active', on); choice.setAttribute('aria-selected', String(on)) }
  if (PANELS.includes(tab)) showPanel(tab)
}
function openPanel(tab) { showPanel(tab); if (!twoColumns.matches) selectMtab(tab) }
/**
 * Wide: sources | preview | panel. From 900 to 1199px the sources become the panel's first tab, so the preview keeps the
 * width; a panel stacked under the timeline left a short window no room for the preview. Under 900px one column: the
 * sources and the panel sit under the preview and the mobile tabs pick one. The start screen needs the sources as a column.
 */
function place() {
  const main = $('workspace'), center = $('pane-center'), panel = $('panel'), sources = $('pane-sources'), mode = $('view-mode')
  const column = wide.matches || (twoColumns.matches && starting), tabbed = twoColumns.matches && !column
  panel.classList.toggle('conai-sidebar', twoColumns.matches); panel.classList.toggle('end', twoColumns.matches)
  sources.classList.toggle('conai-sidebar', column)
  if (column) main.prepend(sources); else if (tabbed) panel.append(sources); else center.append(sources)
  if (twoColumns.matches) main.append(panel); else center.append(panel)
  $('ptab-sources').hidden = !tabbed
  sources.hidden = tabbed && document.body.dataset.panel !== 'sources'
  if (!tabbed && document.body.dataset.panel === 'sources') showPanel('ai')
  if (twoColumns.matches) document.querySelector('.top').insertBefore(mode, $('renderer')); else $('stage-bar').append(mode)
}
const MENUS = [['export-menu', 'export'], ['mention-menu', 'mention']]
function closeMenus() { for (const [menu, trigger] of MENUS) { $(menu).hidden = true; $(trigger).setAttribute('aria-expanded', 'false') } }
function toggleMenu(menu, trigger) {
  const open = $(menu).hidden
  closeMenus(); $(menu).hidden = !open; $(trigger).setAttribute('aria-expanded', String(open))
  return open
}
const isTextField = target => !!target?.closest?.('textarea, select, [contenteditable], input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=color])')

// ---------- Wiring ----------
api = await connectPlugin({
  'hyperframes.search': args => { setSearch({ kind: args.kind === 'files' || args.kind === 'meaning' ? args.kind : 'library', media: ['image', 'video'].includes(args.kind) ? args.kind : 'all', query: args.query ?? '' }); return runSearch(false) },
  'hyperframes.add_library': args => addAsset({ source: 'library', compositeHash: args.hash }),
  'hyperframes.add_file': args => addAsset({ source: 'files', fileId: args.fileId }),
  'hyperframes.open': args => openProject(args.fileId),
  'hyperframes.replace_html': ({ before, after }) => { if (recoverable) throw new Error('임시 초안을 먼저 처리해줘.'); if (!before || $('html').value.split(before).length !== 2) throw new Error('문구가 정확히 한 곳에 일치해야 해.'); $('html').value = $('html').value.replace(before, () => after); drawScenes(); drawAdjust(); edit() },
  'hyperframes.save': () => saveProject(), 'hyperframes.render': args => render(args.preview), 'hyperframes.refresh': refreshJob,
  'hyperframes.projects': args => {
    $('project-query').value = args.query ?? ''
    for (const chip of document.querySelectorAll('#project-filter [data-stage]')) chip.classList.toggle('active', chip.dataset.stage === (args.stage ?? 'active'))
    return projects(args.offset ?? 0)
  },
  'hyperframes.details': editDetails, 'hyperframes.copy': () => saveProject(true), 'hyperframes.restore_draft': restoreDraft,
  'hyperframes.history': () => loadHistory(),
  'hyperframes.new': () => { if (dirty()) throw new Error('현재 초안을 먼저 저장해줘.'); return newProject() },
  'hyperframes.scene': editScene, 'hyperframes.style': editStyle,
  'hyperframes.control': ({ id, value, enabled, color }) => {
    if (recoverable) throw new Error('임시 초안을 먼저 처리해줘.')
    const type = project.controls?.find(control => control.id === id)?.type
    setControl(id, type === 'toggle' ? enabled : type === 'color' ? color : value)
  },
  'hyperframes.name_source': nameSource, 'hyperframes.undo': undo,
})
queueBridge(api)
thumbs = thumbnails(api)
grid = masonry($('search-results'))
libraryMore = endless($('more'), () => runSearch(true))
projectMore = endless($('project-more'), () => projectNext !== null ? projects(projectNext) : undefined)
if (api.supports('preview')) live = livePreview(api, $('live'), { onState: drawTransport, onError: e => report(`실시간 미리보기를 열지 못했어: ${e.message}`, true) })
setMode('live')
on('play', () => live?.toggle()); on('mute', () => live?.mute(!live.state.muted))
$('scrub').addEventListener('input', () => { scrubbing = true; live?.seek(Number($('scrub').value)) })
$('scrub').addEventListener('change', () => { scrubbing = false })
for (const tab of document.querySelectorAll('#view-mode [data-mode]')) tab.onclick = () => switchMode(tab.dataset.mode)
recovery = draftRecovery(api.storage, (text, isError) => {
  // Routine "kept a copy" notes ride on the save badge; a stopped recovery copy needs a toast that stays readable.
  if (isError) toast(text, true); else { draftNote = text; drawSaveState() }
})
for (const id of ['title', 'duration', 'stage']) $(id).addEventListener('input', () => edit(id))
$('html').addEventListener('input', () => { edit('html'); drawScenes(); drawAdjust() })
$('fps').addEventListener('change', () => edit('fps'))
function applySize() { const automatic = composed(shownSize); shownSize = size(); drawAspect(); changeScenes(() => {}, automatic) }
$('size').addEventListener('change', applySize)
for (const choice of $('start-aspect').children) choice.onclick = () => holdStart(() => { ensureSizeOption(...choice.dataset.size.split('x').map(Number)); $('size').value = choice.dataset.size; applySize() })
// Scene fields (adjust tab). `composed()` is read before the change so a storyboard that built the html keeps rebuilding it.
const withScene = (group, change) => { const scene = scenes()[activeScene]; if (scene) changeScenes(() => change(scene), composed(), `${group}:${activeScene}`) }
$('scene-seconds').addEventListener('input', () => { const value = Math.round(Number($('scene-seconds').value) * 10) / 10; $('scene-seconds-out').textContent = `${value}초`; withScene('seconds', scene => { scene.seconds = value }) })
$('scene-motion').addEventListener('change', () => withScene('motion', scene => setOptional(scene, 'motion', $('scene-motion').value, MOTIONS[0])))
$('scene-transition').addEventListener('input', () => { const value = Math.round(Number($('scene-transition').value) * 10) / 10; withScene('transition', scene => setOptional(scene, 'transition', value, 0)) })
$('scene-caption').addEventListener('input', () => withScene('caption', scene => { scene.caption = $('scene-caption').value.slice(0, 200) }))
for (const choice of $('scene-position').children) choice.onclick = () => withScene('position', scene => setOptional(scene, 'captionPosition', choice.dataset.pos, CAPTION_POSITIONS[0]))
on('scene-left', () => moveScene(activeScene, activeScene - 1)); on('scene-right', () => moveScene(activeScene, activeScene + 1))
on('scene-remove', () => {
  const list = scenes(), scene = list[activeScene]
  if (!scene) return
  if (scene.asset && list.filter(other => other.asset === scene.asset).length === 1) removeAsset(scene.asset)
  else changeScenes(() => { list.splice(activeScene, 1); activeScene = null })
})
$('style-caption-size').addEventListener('input', () => { const value = Number($('style-caption-size').value); $('style-caption-size-out').textContent = `${value}%`; changeStyle(style => { style.captionSize = value }, 'style-size') })
$('style-accent').addEventListener('input', () => changeStyle(style => { style.accent = $('style-accent').value }, 'style-accent'))
on('style-accent-reset', () => changeStyle(style => { delete style.accent }))
$('style-volume').addEventListener('input', () => { const value = Math.round(Number($('style-volume').value) * 100) / 100; $('style-volume-out').textContent = `${Math.round(value * 100)}%`; changeStyle(style => { style.musicVolume = value }, 'style-volume') })
on('slideshow', () => {
  if (!composed() && !composeArmed) { composeArmed = true; drawAdjust(); return }
  compose(); edit()
})
for (const tab of document.querySelectorAll('#pane-sources [data-kind]')) tab.onclick = () => { setSearch({ kind: tab.dataset.kind }); runSearch().catch(error) }
for (const chip of document.querySelectorAll('#media-filter [data-media]')) chip.onclick = () => { setSearch({ media: chip.dataset.media }); runSearch().catch(error) }
let searchTimer = null
$('query').addEventListener('input', () => { clearTimeout(searchTimer); search.query = $('query').value.trim(); if (search.kind === 'library') searchTimer = setTimeout(() => runSearch().catch(error), 400) })
$('query').addEventListener('keydown', event => { if (event.key === 'Enter') { clearTimeout(searchTimer); search.query = $('query').value.trim(); runSearch().catch(error) } })
for (const tab of document.querySelectorAll('[data-ptab]')) tab.onclick = () => showPanel(tab.dataset.ptab)
for (const tab of document.querySelectorAll('[data-mtab]')) tab.onclick = () => selectMtab(tab.dataset.mtab)
wide.addEventListener('change', place); twoColumns.addEventListener('change', place)
on('save', () => saveProject()); on('save-copy', () => saveProject(true)); on('undo', undo)
on('export', () => { toggleMenu('export-menu', 'export') })
on('render', () => { closeMenus(); return render(false, true) }); on('preview', () => { closeMenus(); return render(true, true) })
on('projects', () => $('project-manager').hidden ? openProjects() : closeProjects()); on('close-projects', closeProjects)
$('drawer-backdrop').onclick = closeProjects
$('project-query').addEventListener('keydown', event => { if (event.key === 'Enter') void projects().catch(error) })
let projectTimer = null
$('project-query').addEventListener('input', () => { clearTimeout(projectTimer); projectTimer = setTimeout(() => projects().catch(error), 300) })
for (const chip of document.querySelectorAll('#project-filter [data-stage]')) chip.onclick = () => { for (const other of document.querySelectorAll('#project-filter [data-stage]')) other.classList.toggle('active', other === chip); projects().catch(error) }
on('legacy-projects', legacyProjects)
on('files', async () => {
  const file = saved ? await tool('get_file_info', { file_id: saved.fileId }) : null
  await api.navigation.open(file?.parentId ? `/files?folder=${file.parentId}` : '/files')
})
on('new', newProject)
on('discard', async () => { if (!saved) throw new Error('저장한 프로젝트가 없어.'); if (await leaveDraft()) return openProject(saved.fileId, true) })
on('cancel', () => mutation('cancel', 'p_hyperframes_cancel_render', { jobId: renderJob }))
on('restore-draft', restoreDraft)
on('discard-recovery', async () => {
  if ($('discard-recovery').textContent !== '임시 초안 삭제 확인') { $('discard-recovery').textContent = '임시 초안 삭제 확인'; return }
  if (!await recovery.clear()) throw new Error('임시 초안을 지우지 못했어. 다른 창의 편집 상태를 확인하고 다시 열어줘.')
  recoverable = null; $('recovery').hidden = true; document.querySelector('main').inert = false; publish(); startScreen()
})
on('result', () => api.navigation.open(`/images/${resultHash}`)); on('ai', createWithAi)
$('brief').addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); createWithAi().catch(error) } })
on('ai-cancel', () => { aiStopping = true; if (aiJob) return api.llm.cancel(aiJob) })
on('mention', () => { if (toggleMenu('mention-menu', 'mention')) drawMention() })
on('start-ai', startWithAi)
on('start-blank', endStart)
on('start-html', () => { endStart(); openPanel('html'); $('html').focus(); $('html').select() })
on('mark', openMark)
$('mark-form').addEventListener('submit', event => { event.preventDefault(); addMarker($('mark-note').value) })
on('mark-cancel', () => { $('mark-form').hidden = true })
$('output').addEventListener('timeupdate', () => { $('result-clock').textContent = `${clock($('output').currentTime)} / ${clock(outputLength())}` })
$('output').addEventListener('loadedmetadata', () => { $('result-clock').textContent = `${clock($('output').currentTime)} / ${clock(outputLength())}`; drawMarkers() })
on('renderer', openRenderer)
on('renderer-recheck', refreshRenderer); on('renderer-close', closeRenderer)
$('renderer-dialog').addEventListener('close', () => { rendererOpen = false })
on('install', async () => { renderer = { ...renderer, install: await act('p_hyperframes_install_renderer') }; drawRenderer(); await refreshRenderer() })
on('install-cancel', async () => { await act('p_hyperframes_cancel_renderer_install'); await refreshRenderer() })
document.addEventListener('click', event => { if (!event.target.closest?.('.export, .mention')) closeMenus() })
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveProject().catch(error) }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z' && !isTextField(event.target)) { event.preventDefault(); try { undo() } catch (e) { error(e) } }
  if (event.key === 'Escape') { closeMenus(); if (!$('project-manager').hidden) closeProjects() }
  if (event.code === 'Space' && live && viewMode === 'live' && !event.target.closest?.('input, textarea, select, button, [contenteditable]')) { event.preventDefault(); live.toggle() }
})
api.onSaved(({ proposalId, result }) => completeRequest(proposalId, result).catch(error))
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearTimeout(timer); clearTimeout(rendererTimer); if (dirty()) void storeDraft() }
  else { void refreshJob().catch(error); if (renderer?.install?.status === 'running') void refreshRenderer().catch(error) }
})
window.addEventListener('pagehide', () => { clearTimeout(timer); clearTimeout(draftTimer); clearTimeout(rendererTimer) })
$('output').addEventListener('error', () => {
  if (resultHash && Date.now() - lastMediaRefresh > 30000) void showOutput(resultHash).catch(error)
})
place(); showPanel('ai'); selectMtab('timeline'); setSearch({}); updateForm(); rebase(); drawHistory(); drawChat()
document.querySelector('main').inert = true
try {
  recoverable = await recovery.load(); recoveryReady = true
  if (recoverable) {
    $('recovery').hidden = false
    $('recovery-title').textContent = `임시 보관한 초안이 있어: ${recoverable.project?.title || '새 영상'} · ${date(recoverable.updatedAt)}`
    publish()
  }
} catch (e) { error(new Error(`임시 초안을 읽지 못했어: ${e.message}`)) }
document.querySelector('main').inert = !!recoverable
// A recoverable draft waits behind the notice; the start screen of the new project stays under it.
if (!api.files[0]) startScreen()
const results = await Promise.allSettled([
  refreshRenderer(),
  api.llm.profiles().then(profiles => { for (const p of profiles) for (const id of ['profile', 'start-profile']) { const option = document.createElement('option'); option.value = String(p.id); option.textContent = p.name; $(id).append(option) } }),
  runSearch(),
])
for (const result of results) if (result.status === 'rejected') error(result.reason)
if (api.files[0] && !recoverable) await openProject(api.files[0].id).catch(error)
