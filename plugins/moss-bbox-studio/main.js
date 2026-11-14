// MOSS BBox Studio: draw boxes, write the prompt of each one, and send the layout JSON to a registered ComfyUI workflow.
// No server module: settings and the draft live in api.storage, everything else goes through native /api routes.
import { connectPlugin } from './conai-plugin.js'
import {
  KINDS, RANDOM_OPTION, REGION_COLORS, SIZE_PRESETS, addRegion, buildLayout, buildPromptData, cloneDraft, compatibleFields, describeDraft, emptyMapping,
  emptySetup, guessFieldMapping, kindId, mappingIssues, megapixelsOf, moveRegion, nearestRatio, newDraft, normalizeBox, optionProblem, optionValue,
  parseLayoutPrompt, parseRatio, ratioChoices, rolesFor, selectChoices, setOptionValue, sizeConnected, sizeFromRatio, snapSize, splitOptionFields,
  stringifyLayout, withDropdownOptions,
} from './layout.js'

const $ = (id) => document.getElementById(id)
const esc = (value) => String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char])
const clamp = (value, low, high) => Math.min(high, Math.max(low, value))
const color = (index) => REGION_COLORS[index % REGION_COLORS.length]
const HASH = /^(?:[a-f0-9]{32}|[a-f0-9]{48})$/i
const TERMINAL = new Set(['completed', 'failed', 'cancelled'])
const STATUS_LABEL = { queued: '대기 중', dispatching: '보내는 중', running: '생성 중', completed: '완료', failed: '실패', cancelled: '취소됨' }
const MAX_JOBS = 50

const state = {
  tab: 'editor',
  side: 'prompt',
  resultsOpen: true,
  hovered: null,
  draft: newDraft(),
  sel: -1,
  source: null,
  previous: null,
  showImage: true,
  workflows: [],
  setup: emptySetup(),
  negative: '',
  seed: '',
  jobs: [],
  submitting: false,
  revision: 0,
}
let api

// ---- host calls -------------------------------------------------------------------------------------------------

async function call(path, init) {
  const response = await api.app.fetch(path, init)
  const body = await response.json().catch(() => null)
  if (!response.ok || body?.success === false) throw new Error(body?.error || body?.message || `요청이 실패했어 (HTTP ${response.status})`)
  return body
}

const jsonInit = (method, payload) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })

let storing = Promise.resolve()
function store(key, value) {
  storing = storing.then(async () => {
    const current = await api.storage.get(key).catch(() => null)
    await api.storage.set(key, value, current?.revision ?? null)
  }).catch(() => undefined)
  return storing
}
async function load(key) { return (await api.storage.get(key).catch(() => null))?.value ?? null }

let saveTimer
function scheduleDraftSave() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { void store('draft', draftValue()) }, 600)
}
/** The stored draft. A library or result image is reopened by its hash after a reload; an uploaded file only has a page-local blob URL. */
function draftValue() {
  const value = { draft: state.draft, negative: state.negative, seed: state.seed }
  if (!state.source?.hash) return value
  // A value is limited to 64 KiB: a source that does not fit is left out rather than losing the draft.
  const full = { ...value, source: state.source, showImage: state.showImage }
  return new TextEncoder().encode(JSON.stringify(full)).length < 60_000 ? full : value
}
/** Save without the typing delay, before leaving the page. */
const saveDraftNow = () => { clearTimeout(saveTimer); return store('draft', draftValue()) }
const saveSetup = () => store('setup', state.setup)
// A value is limited to 64 KiB: only the newest jobs keep their layout text, older ones are edited from the image's own prompt.
const saveJobs = () => store('jobs', state.jobs.map((job, index) => (index < 3 ? job : { ...job, layout: '' })))

function notify(message, error = false) {
  const element = $('status')
  element.textContent = message
  element.classList.toggle('error', error)
}
const guard = (task) => async (...args) => { try { await task(...args) } catch (error) { notify(error.message, true) } }

// ---- derived values ---------------------------------------------------------------------------------------------

const workflow = () => state.workflows.find((item) => item.id === state.setup.workflowId) ?? null
const workflowFields = () => workflow()?.marked_fields ?? []
const setupIssues = () => (workflow() ? mappingIssues(workflowFields(), state.setup.mapping, state.draft.size) : ['사용할 워크플로우를 골라줘.'])
const optionField = (id) => splitOptionFields(workflowFields(), state.setup.mapping).adjustable.find((field) => field.id === id)
const ICON = {
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>',
}
const hasContent = () => state.draft.items.length > 0 || state.draft.summary.trim() !== ''

// ---- editor rendering -------------------------------------------------------------------------------------------

function renderCanvasFrame() {
  const [width, height] = state.draft.size
  const canvas = $('canvas')
  canvas.style.setProperty('--ratio', `${width} / ${height}`)
  canvas.style.setProperty('--ratio-n', String(width / height))
  const image = state.source && state.showImage
  canvas.classList.toggle('has-image', Boolean(image))
  canvas.style.setProperty('--image', image ? `url("${state.source.url}")` : 'none')
  renderSizeControl()
  $('img-toggle').hidden = !state.source
  $('show-img').checked = state.showImage
}

const ratioField = () => workflowFields().find((field) => field.id === state.setup.mapping.ratio)

/** The size controls follow how the workflow takes its size: width and height, or an aspect ratio and megapixels. */
function renderSizeControl() {
  const [width, height] = state.draft.size
  if (state.setup.mapping.sizeMode === 'ratio') {
    const choices = ratioChoices(ratioField())
    const current = nearestRatio(choices, state.draft.size)
    $('size-ctl').innerHTML = `<select id="size-ratio" aria-label="종횡비">${current ? '' : '<option value="" selected>직접</option>'}${choices.map((choice) => `<option value="${esc(choice.value)}"${choice === current ? ' selected' : ''}>${esc(choice.value)}</option>`).join('')}</select>
      <input type="number" id="size-mp" min="0.1" step="0.1" value="${megapixelsOf(state.draft.size)}" aria-label="메가픽셀"><span class="sep">MP</span><span class="result">${width}×${height}</span>`
    return
  }
  const current = `${width}x${height}`
  const options = SIZE_PRESETS.map((preset) => ({ value: `${preset.size[0]}x${preset.size[1]}`, label: preset.id }))
  if (!options.some((option) => option.value === current)) options.unshift({ value: current, label: '직접' })
  $('size-ctl').innerHTML = `<select id="size-preset" aria-label="비율">${options.map((option) => `<option value="${option.value}"${option.value === current ? ' selected' : ''}>${esc(option.label)}</option>`).join('')}</select>
    <input type="number" id="size-w" min="64" step="16" value="${width}" aria-label="너비"><span class="sep">×</span><input type="number" id="size-h" min="64" step="16" value="${height}" aria-label="높이">`
}

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

function renderBoxes() {
  // A redraw keeps the hover highlight; a hovered region that no longer exists dims nothing.
  const focus = state.draft.items[state.hovered] ? state.hovered : null
  $('canvas').innerHTML = state.draft.items.map((item, index) => {
    const [x0, y0, x1, y1] = item.box
    const kind = KINDS.find((entry) => entry.id === item.label)?.label ?? ''
    return `<div class="bx${index === state.sel ? ' selected' : ''}${focus !== null && index !== focus ? ' dim' : ''}" tabindex="0" data-index="${index}" style="--c:${color(index)};left:${x0 * 100}%;top:${y0 * 100}%;width:${(x1 - x0) * 100}%;height:${(y1 - y0) * 100}%"><span class="tag">${index + 1} · ${esc(kind)}</span>${index === state.sel ? HANDLES.map((handle) => `<span class="handle" data-handle="${handle}"></span>`).join('') : ''}</div>`
  }).join('')
}

function renderRegionList() {
  $('region-count').textContent = `${state.draft.items.length}개`
  $('layers').innerHTML = state.draft.items.map((item, index) => {
    const kind = KINDS.find((entry) => entry.id === item.label)?.label ?? ''
    return `<li class="region-row${index === state.sel ? ' selected' : ''}${index === state.hovered ? ' hover' : ''}" tabindex="0" data-index="${index}" style="--c:${color(index)}"><span class="number">${index + 1}</span><span class="text"><span class="kind">${esc(kind)}</span><span class="caption${item.caption ? '' : ' empty'}">${esc(item.caption || '프롬프트 없음')}</span></span><button type="button" class="conai-icon-button sm" data-remove="${index}" aria-label="영역 ${index + 1} 삭제" title="삭제">${ICON.trash}</button></li>`
  }).join('')
}

/** The selected box in canvas pixels from the top-left corner, as the position fields show it. */
function renderCoords() {
  const item = state.draft.items[state.sel]
  if (!item) return
  const [width, height] = state.draft.size
  const [x0, y0, x1, y1] = item.box
  const values = { x: x0 * width, y: y0 * height, w: (x1 - x0) * width, h: (y1 - y0) * height }
  $('inspector').querySelectorAll('[data-geo]').forEach((input) => { if (document.activeElement !== input) input.value = Math.round(values[input.dataset.geo]) })
}

function renderInspector() {
  const host = $('inspector')
  const item = state.draft.items[state.sel]
  host.hidden = !item
  if (!item) { host.innerHTML = ''; return }
  host.innerHTML = `
    <div class="region-head" style="--c:${color(state.sel)}">
      <span class="number">${state.sel + 1}</span>
      <div class="conai-segmented" role="group" aria-label="영역 종류">${KINDS.map((kind) => `<button type="button" data-kind="${kind.id}" aria-pressed="${item.label === kind.id}">${kind.label}</button>`).join('')}</div>
      <button type="button" class="conai-icon-button sm" data-move="1" aria-label="위로 올리기" title="위로 올리기 (위에 그려짐)">${ICON.up}</button>
      <button type="button" class="conai-icon-button sm" data-move="-1" aria-label="아래로 내리기" title="아래로 내리기">${ICON.down}</button>
    </div>
    <label>영역 프롬프트<textarea data-field="caption">${esc(item.caption)}</textarea></label>
    ${item.label === 'text' ? `<label>그릴 글자<input data-field="text" value="${esc(item.text)}"></label>` : ''}
    <div class="geo">${[['x', 'X'], ['y', 'Y'], ['w', '너비'], ['h', '높이']].map(([key, label]) => `<label>${label}<input type="number" data-geo="${key}" step="1"></label>`).join('')}</div>`
  renderCoords()
}

function renderJson() {
  $('json').textContent = JSON.stringify(buildLayout(state.draft), null, 2)
}

function renderBanner() {
  const banner = $('banner')
  const { source, previous } = state
  if (!source && !previous) { banner.hidden = true; return }
  banner.hidden = false
  const parts = []
  if (source) {
    parts.push(`<b class="source-name">${esc(source.name)}</b>`)
    if (!source.layout) parts.push('<span class="badge warn">프롬프트만 가져옴</span>')
    if (source.skipped) parts.push(`<span class="badge warn">영역 ${source.skipped}개 못 읽음</span>`)
  }
  parts.push('<span class="conai-spacer"></span>')
  if (source) parts.push('<button type="button" data-banner="reset">원본으로 되돌리기</button><button type="button" class="ghost" data-banner="detach">이미지 떼기</button>')
  if (previous) parts.push('<button type="button" class="ghost" data-banner="restore">이전 초안 복원</button>')
  banner.innerHTML = parts.join('')
}

function optionControl(field) {
  const value = optionValue(field, state.setup.options)
  const attrs = `data-option="${esc(field.id)}" aria-label="${esc(field.label || field.id)}"`
  if (field.type === 'select' && field.options?.length) {
    const current = String(value)
    const choices = selectChoices(field)
    // The control always shows what the workflow will use: a stored default the list lacks, or no value at all, gets its own entry.
    if (current === '') choices.unshift('')
    else if (!choices.includes(current)) choices.unshift(current)
    return `<select ${attrs}>${choices.map((choice) => `<option value="${esc(choice)}"${choice === current ? ' selected' : ''}>${choice === RANDOM_OPTION ? '무작위' : choice === '' ? '워크플로우 값' : esc(choice)}</option>`).join('')}</select>`
  }
  if (field.type === 'number') {
    const bound = (name) => (typeof field[name] === 'number' ? ` ${name}="${field[name]}"` : '')
    return `<input type="number" ${attrs} value="${esc(value)}"${bound('min')}${bound('max')} step="${typeof field.step === 'number' ? field.step : 'any'}">`
  }
  if (field.type === 'textarea') return `<textarea ${attrs}>${esc(value)}</textarea>`
  return `<input ${attrs} value="${esc(value)}">`
}

const syncOptionsReset = () => {
  const button = $('options-reset')
  if (button) button.disabled = !splitOptionFields(workflowFields(), state.setup.mapping).adjustable.some((field) => Object.hasOwn(state.setup.options, field.id))
}

/** Every workflow field the plugin does not fill itself (checkpoint, steps, CFG…), so the workflow can be tuned here. */
function renderOptions() {
  const host = $('options-box')
  const { adjustable } = splitOptionFields(workflowFields(), state.setup.mapping)
  host.hidden = !adjustable.length
  if (host.hidden) { host.innerHTML = ''; return }
  host.innerHTML = `<div class="options-head"><p class="conai-overline">워크플로우 옵션</p><button type="button" class="ghost" id="options-reset">기본값으로</button></div>
    ${adjustable.map((field) => `<label>${esc(field.label || field.id)}${optionControl(field)}</label>`).join('')}`
  syncOptionsReset()
}

function renderGenBar() {
  const current = workflow()
  $('wf-name').textContent = current ? current.name : '선택 안 함'
  $('generate').disabled = state.submitting
  $('generate').textContent = state.submitting ? '요청 중…' : '생성 요청'
  $('negative-box').hidden = !state.setup.mapping.negative
  $('negative').value = state.negative
  $('seed').value = state.seed
}

function renderTabs() {
  document.querySelectorAll('#tabs [data-tab]').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.tab === state.tab)))
  const editor = state.tab === 'editor'
  $('view-editor').hidden = !editor
  // The bar stays on the setup tab for its status text; its editor controls do not.
  $('wf-open').hidden = !editor
  $('generate').hidden = !editor
  const active = state.jobs.filter((job) => !TERMINAL.has(job.status)).length
  const toggle = $('results-toggle')
  toggle.hidden = !editor || !state.jobs.length
  toggle.setAttribute('aria-expanded', String(state.resultsOpen))
  toggle.textContent = `${state.resultsOpen ? '▾' : '▸'} 결과 ${active ? `${active}/` : ''}${state.jobs.length}`
  $('results').hidden = toggle.hidden || !state.resultsOpen
  $('view-setup').hidden = state.tab !== 'setup'
  document.querySelectorAll('#side-tabs [data-side]').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.side === state.side)))
  $('side-prompt').hidden = state.side !== 'prompt'
  $('json').hidden = state.side !== 'json'
}

function renderEditor() {
  $('summary').value = state.draft.summary
  $('meta').value = state.draft.meta.join(', ')
  renderCanvasFrame(); renderBoxes(); renderRegionList(); renderInspector(); renderJson(); renderBanner(); renderGenBar()
}

// ---- setup / results rendering ----------------------------------------------------------------------------------

function renderSetup() {
  const current = workflow()
  const fields = workflowFields()
  const mapping = state.setup.mapping
  const issues = current ? setupIssues() : []
  const name = (field) => field.label || field.id
  // The field id is shown only to tell apart fields that share a label.
  const option = (field, selected, list) => `<option value="${esc(field.id)}"${field.id === selected ? ' selected' : ''}>${esc(name(field))}${list.filter((other) => name(other) === name(field)).length > 1 ? ` (${esc(field.id)})` : ''}</option>`
  const row = (role) => {
    const list = compatibleFields(fields, role.id)
    return `<div class="maprow"><div class="role"><b>${role.label}</b>${role.required ? '<span class="badge">필수</span>' : ''}</div><label><select data-role="${role.id}" aria-label="${role.label} 칸"><option value="">연결 안 함</option>${list.map((field) => option(field, mapping[role.id], list)).join('')}</select></label></div>`
  }
  const roles = rolesFor(mapping)
  const modes = [['size', '너비·높이'], ['ratio', '종횡비·메가픽셀']]
  $('view-setup').innerHTML = `<div class="setup">
    <section>
      <label>워크플로우<select id="workflow-select"><option value="">선택 안 함</option>${state.workflows.map((item) => `<option value="${item.id}"${item.id === state.setup.workflowId ? ' selected' : ''}>${esc(item.name)}</option>`).join('')}</select></label>
      <div class="toolbar"><button type="button" id="reload-workflows">다시 불러오기</button></div>
      ${current ? `<p class="conai-overline field-gap">검사</p>
      <ul class="checks">${issues.length ? issues.map((issue) => `<li>${esc(issue)}</li>`).join('') : '<li><span class="badge ok">통과</span></li>'}
        ${sizeConnected(mapping) ? '' : '<li>크기 칸이 연결되지 않아 워크플로우 고정 크기로 생성돼 박스가 어긋날 수 있어.</li>'}</ul>` : ''}
    </section>
    <section>
      <p class="conai-overline">입력 칸 연결</p>
      ${current ? `${roles.filter((role) => !role.size).map(row).join('')}
      <div class="maphead"><p class="conai-overline">크기</p><div class="conai-segmented" role="group" aria-label="크기 연결 방식">${modes.map(([id, label]) => `<button type="button" data-size-mode="${id}" aria-pressed="${mapping.sizeMode === id}">${label}</button>`).join('')}</div></div>
      ${roles.filter((role) => role.size).map(row).join('')}` : ''}
    </section></div>`
}

let resultsHtml = ''
/** The strip under the editor: one tile per result image, or one status tile for a job without an image yet. */
function renderResults() {
  const html = state.jobs.map((job) => {
    const ratio = `${job.size[0]} / ${job.size[1]}`
    const title = esc(`#${job.id} · ${job.workflowName} · 영역 ${job.regions}개 · ${job.size[0]}×${job.size[1]}`)
    if (job.hashes.length) return job.hashes.map((hash) => `<div class="tile" title="${title}"><div class="conai-media" style="--ratio:${ratio}"><img src="/api/images/${hash}/thumbnail" alt="작업 #${job.id} 결과" loading="lazy"><div class="tile-actions"><button type="button" class="conai-icon-button sm" data-edit="${job.id}:${hash}" title="편집기로 불러오기" aria-label="편집기로 불러오기">${ICON.edit}</button><button type="button" class="conai-icon-button sm" data-open="${hash}" title="상세 보기" aria-label="상세 보기">${ICON.open}</button></div></div></div>`).join('')
    const failed = job.status === 'failed' || Boolean(job.error)
    const tone = failed ? 'destructive' : job.status === 'completed' ? 'ok' : TERMINAL.has(job.status) ? '' : 'warn'
    const label = failed ? STATUS_LABEL.failed : job.status === 'completed' ? '처리 중' : STATUS_LABEL[job.status] ?? esc(job.status)
    return `<div class="tile" title="${job.error ? esc(job.error) : title}"><div class="conai-media pending" style="--ratio:${ratio}"><span class="badge ${tone}">${label}</span>${TERMINAL.has(job.status) ? `<span class="muted">#${job.id}</span>` : `<button type="button" class="ghost" data-cancel="${job.id}">취소</button>`}</div></div>`
  }).join('')
  // A poll that changed nothing keeps the thumbnails and the scroll position.
  if (html === resultsHtml) return
  resultsHtml = html
  $('results').innerHTML = html
}

function showTab(tab) {
  state.tab = tab
  renderTabs()
  if (tab === 'setup') renderSetup()
}

// ---- state changes ----------------------------------------------------------------------------------------------

// The host rejects a page snapshot with an array over 512 entries and republishes on every edit, so a long list shows its size; set_option names matching choices when a value is not one of them.
const PUBLISHED_CHOICE_LIMIT = 100

/** What a connected chat sees of the adjustable workflow fields: id, current value and the choices or range it may use. */
const describeOptions = () => splitOptionFields(workflowFields(), state.setup.mapping).adjustable.map((field) => {
  const choices = field.type === 'select' && field.options?.length ? selectChoices(field) : null
  return {
    id: field.id,
    label: field.label || field.id,
    type: field.type,
    value: optionValue(field, state.setup.options),
    changed: Object.hasOwn(state.setup.options, field.id),
    ...(choices && choices.length <= PUBLISHED_CHOICE_LIMIT ? { choices } : {}),
    ...(choices && choices.length > PUBLISHED_CHOICE_LIMIT ? { choiceCount: choices.length } : {}),
    ...(field.type === 'number' ? { min: field.min, max: field.max } : {}),
  }
})

function publish() {
  api.publish({
    revision: String(state.revision),
    dirty: false,
    data: {
      ...describeDraft(state.draft),
      selectedRegion: state.sel >= 0 ? state.sel + 1 : null,
      imageSource: state.source ? { kind: state.source.kind, name: state.source.name, compositeHash: state.source.hash ?? null } : null,
      workflow: workflow() ? { id: workflow().id, name: workflow().name, issues: setupIssues(), options: describeOptions() } : null,
      jobs: state.jobs.slice(0, 5).map((job) => ({ id: job.id, status: job.status, resultHashes: job.hashes })),
    },
  })
}

/** Everything that depends on the draft: call after any edit. `light` skips the parts a drag or typing keeps current itself. */
function changed({ light = false } = {}) {
  state.revision += 1
  scheduleDraftSave()
  if (light) { renderJson(); renderRegionList(); renderBoxes(); renderCoords() } else renderEditor()
  renderTabs()
  publish()
}

function regionAt(number) {
  const index = Number(number) - 1
  if (!Number.isInteger(index) || !state.draft.items[index]) throw new Error(`${number}번 영역이 없어.`)
  return index
}

function select(index) {
  state.sel = index
  renderBoxes(); renderRegionList(); renderInspector()
  publish()
}

function replaceDraft(draft, source) {
  if (hasContent()) state.previous = { draft: state.draft, source: state.source, negative: state.negative }
  state.draft = draft
  state.source = source
  state.sel = draft.items.length ? 0 : -1
  state.showImage = true
  state.tab = 'editor'
  state.side = 'prompt'
  changed()
}

function applySource({ kind, hash, name, url, size, prompt }) {
  const canvas = size?.[0] && size?.[1] ? [snapSize(size[0]), snapSize(size[1])] : [...state.draft.size]
  const parsed = parseLayoutPrompt(prompt, canvas)
  const draft = parsed?.draft ?? Object.assign(newDraft(canvas), { summary: String(prompt ?? '').trim() })
  replaceDraft(draft, { kind, hash, name, url, layout: Boolean(parsed), skipped: parsed?.skipped ?? 0, original: cloneDraft(draft) })
  // The banner shows the source and what could not be read; the region list shows the count.
  notify('')
}

async function importFromHash(hash) {
  if (!HASH.test(hash)) throw new Error('라이브러리 이미지를 찾을 수 없어.')
  notify('이미지를 불러오는 중…')
  const { data } = await call(`/api/images/${hash}`)
  applySource({
    kind: 'library', hash, name: String(data.original_file_path ?? '').split(/[\\/]/).pop() || '이미지',
    url: `/api/images/${hash}/thumbnail`, size: [data.width, data.height], prompt: data.ai_metadata?.prompts?.prompt,
  })
}

async function importFromFile(file) {
  if (!file.type.startsWith('image/')) throw new Error('이미지 파일만 가져올 수 있어.')
  notify('프롬프트를 읽는 중…')
  const form = new FormData()
  form.append('image', file, file.name)
  const { data } = await call('/api/images/extract-metadata', { method: 'POST', body: form })
  applySource({ kind: 'file', name: file.name, url: URL.createObjectURL(file), size: [data.width, data.height], prompt: data.ai_metadata?.prompts?.prompt })
}

async function editResult(jobId, hash) {
  const job = state.jobs.find((item) => item.id === jobId)
  if (!job) return
  // The layout we sent is exact; without it (an older job) the saved image's own prompt is read like any imported image.
  if (!job.layout) { await importFromHash(hash); return }
  applySource({ kind: 'result', hash, name: `작업 #${job.id}`, url: `/api/images/${hash}/thumbnail`, size: job.size, prompt: job.layout })
}

// ---- generation -------------------------------------------------------------------------------------------------

async function generate(seedOverride) {
  if (state.submitting) throw new Error('이미 요청을 보내는 중이야.')
  const current = workflow()
  const issues = setupIssues()
  if (!current || issues.length) { showTab('setup'); throw new Error(issues[0] ?? '연결 설정을 먼저 해줘.') }
  if (!hasContent()) throw new Error('영역이나 메인 프롬프트를 먼저 써줘.')
  state.submitting = true
  renderGenBar()
  try {
    const draft = cloneDraft(state.draft)
    const seed = seedOverride ?? state.seed
    const body = {
      service_type: 'comfyui',
      workflow_id: current.id,
      workflow_name: current.name,
      request_summary: `MOSS BBox Studio · 영역 ${draft.items.length}개`,
      request_payload: { prompt_data: buildPromptData(state.setup.mapping, { draft, negative: state.negative, seed, fields: workflowFields(), options: state.setup.options }) },
    }
    const result = await call('/api/generation-queue', jsonInit('POST', body))
    const id = result.record?.id
    if (!id) throw new Error('서버가 작업 번호를 돌려주지 않았어.')
    state.jobs.unshift({ id, status: result.record.status ?? 'queued', workflowName: current.name, layout: stringifyLayout(draft), size: [...draft.size], regions: draft.items.length, hashes: [], error: '', createdAt: Date.now() })
    state.jobs.length = Math.min(state.jobs.length, MAX_JOBS)
    void saveJobs()
    renderResults(); renderTabs(); publish(); startPolling()
    notify(`작업 #${id} 요청했어.`)
    return id
  } finally {
    state.submitting = false
    renderGenBar()
  }
}

let pollTimer = null
// A finished job may still wait for its image to be processed; a job the queue no longer lists stops being followed after six hours.
const jobNeedsWork = (job) => (!TERMINAL.has(job.status) && Date.now() - job.createdAt < 6 * 3_600_000) || (job.status === 'completed' && !job.hashes.length && Date.now() - job.createdAt < 10 * 60_000)

async function loadResults(job) {
  const { records } = await call(`/api/generation-history?queue_job_id=${job.id}&limit=20`)
  job.hashes = (records ?? []).filter((record) => record.generation_status === 'completed').map((record) => record.actual_composite_hash || record.composite_hash).filter(Boolean)
  const failed = (records ?? []).find((record) => record.generation_status === 'failed')
  if (!job.hashes.length && failed?.error_message) job.error = failed.error_message
}

const pollJobs = guard(async () => {
  const waiting = state.jobs.filter(jobNeedsWork)
  if (!waiting.length) { stopPolling(); return }
  // Each job is read on its own: the queue list pages finished jobs oldest-first, so a finished job would drop out of it.
  const results = await Promise.allSettled(waiting.map((job) => call(`/api/generation-queue/${job.id}`)))
  let failure = null
  for (const [index, result] of results.entries()) {
    const job = waiting[index]
    if (result.status === 'rejected') { failure ??= result.reason; continue }
    const record = result.value.data
    job.status = record.status
    if (record.failure_message) job.error = record.failure_message
    if (job.status === 'completed') await loadResults(job)
  }
  void saveJobs()
  renderResults(); renderTabs(); publish()
  if (failure) throw failure
})

function startPolling() { if (!pollTimer) pollTimer = setInterval(() => { void pollJobs() }, 4000) }
function stopPolling() { clearInterval(pollTimer); pollTimer = null }

// ---- workflows --------------------------------------------------------------------------------------------------

async function loadWorkflows() {
  // A select's choices usually live in a custom dropdown list, not in the field; without them a ratio like "4:3" would be sent where the list says "4:3 (Standard)".
  const [{ data }, { data: lists }] = await Promise.all([call('/api/workflows?active=true&kind=image'), call('/api/custom-dropdown-lists')])
  state.workflows = (data ?? []).map((item) => ({ id: item.id, name: item.name, marked_fields: withDropdownOptions(Array.isArray(item.marked_fields) ? item.marked_fields : [], lists) }))
  if (state.setup.workflowId && !workflow()) state.setup = emptySetup()
}

/** Redraw everything a connection change touches: the setup tab and the editor parts that depend on the workflow. */
function setupChanged() {
  renderSetup(); renderGenBar(); renderOptions(); renderSizeControl(); publish()
}

/** A changed option alters what a request sends, so it counts as an edit of the draft for review cards. */
function optionsChanged() {
  state.revision += 1
  void saveSetup()
  syncOptionsReset()
  publish()
}

/** Set one option from the panel or the assistant; throws why a value cannot be used. */
function applyOption(field, entry) {
  const problem = entry.trim() === '' ? '' : optionProblem(field, entry)
  if (problem) throw new Error(problem)
  state.setup.options = setOptionValue(state.setup.options, field, entry)
  optionsChanged()
}

function chooseWorkflow(id) {
  state.setup.workflowId = id || null
  state.setup.mapping = id ? guessFieldMapping(workflowFields()) : emptyMapping()
  state.setup.options = {}
  void saveSetup()
  setupChanged()
}

// ---- events -----------------------------------------------------------------------------------------------------

function bindEditor() {
  const canvas = $('canvas')
  let drag = null
  const fractions = (event) => {
    const rect = canvas.getBoundingClientRect()
    return [clamp((event.clientX - rect.left) / rect.width, 0, 1), clamp((event.clientY - rect.top) / rect.height, 0, 1)]
  }

  // Boxes overlap, so the hit is decided by geometry instead of stacking order: the smallest box under the pointer wins
  // (a background box never hides the ones inside it) and equal sizes go to the later, upper one, as in the image detail region map.
  const boxAt = (x, y) => {
    let hit = -1
    let hitArea = Infinity
    state.draft.items.forEach((item, index) => {
      const [x0, y0, x1, y1] = item.box
      const area = (x1 - x0) * (y1 - y0)
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1 && area <= hitArea) { hit = index; hitArea = area }
    })
    return hit
  }

  // Dragging a box moves it, its handles resize it, and dragging on empty canvas draws a new one; a plain click on empty canvas deselects.
  canvas.addEventListener('pointerdown', (event) => {
    const [x, y] = fractions(event)
    // Only the selected box has handles, and they keep priority over a smaller box under them.
    const handle = event.target.dataset.handle
    const index = handle ? state.sel : boxAt(x, y)
    if (index >= 0) {
      if (index !== state.sel) select(index)
      drag = { mode: handle ? 'resize' : 'move', handle, index, x, y, box: [...state.draft.items[index].box] }
    } else drag = { mode: 'draw', index: -1, x, y }
    canvas.setPointerCapture(event.pointerId)
  })

  canvas.addEventListener('pointermove', (event) => {
    const [x, y] = fractions(event)
    if (!drag) {
      if (event.pointerType === 'mouse') { const index = boxAt(x, y); hover(index < 0 ? null : index) }
      return
    }
    if (drag.mode === 'draw' && drag.index < 0) {
      if (Math.hypot(x - drag.x, y - drag.y) < 0.01) return
      state.draft.items.push({ label: 'object', caption: '', text: '', box: [drag.x, drag.y, drag.x, drag.y] })
      state.sel = drag.index = state.draft.items.length - 1
      renderRegionList(); renderInspector()
    }
    const item = state.draft.items[drag.index]
    if (drag.mode === 'move') {
      const [x0, y0, x1, y1] = drag.box
      const width = x1 - x0, height = y1 - y0
      const left = clamp(x0 + x - drag.x, 0, 1 - width), top = clamp(y0 + y - drag.y, 0, 1 - height)
      item.box = [left, top, left + width, top + height]
    } else if (drag.mode === 'resize') {
      const [x0, y0, x1, y1] = drag.box
      const dx = x - drag.x, dy = y - drag.y, least = 0.03
      item.box = [
        drag.handle.includes('w') ? clamp(x0 + dx, 0, x1 - least) : x0,
        drag.handle.includes('n') ? clamp(y0 + dy, 0, y1 - least) : y0,
        drag.handle.includes('e') ? clamp(x1 + dx, x0 + least, 1) : x1,
        drag.handle.includes('s') ? clamp(y1 + dy, y0 + least, 1) : y1,
      ]
    } else {
      item.box = [Math.min(drag.x, x), Math.min(drag.y, y), Math.max(drag.x, x), Math.max(drag.y, y)]
    }
    renderBoxes(); renderCoords(); renderJson()
  })

  const finish = () => {
    if (!drag) return
    const { mode, index } = drag
    drag = null
    if (mode === 'draw') {
      if (index < 0) { if (state.sel >= 0) select(-1); return }
      const box = normalizeBox(state.draft.items[index].box)
      if (!box) { state.draft.items.splice(index, 1); state.sel = state.draft.items.length - 1 } else state.draft.items[index].box = box
      changed()
      $('inspector').querySelector('[data-field="caption"]')?.focus()
    } else changed({ light: true })
  }
  canvas.addEventListener('pointerup', finish)
  canvas.addEventListener('pointercancel', finish)

  const hover = (index) => {
    state.hovered = index
    $('layers').querySelectorAll('.region-row').forEach((row) => row.classList.toggle('hover', Number(row.dataset.index) === index))
    canvas.querySelectorAll('.bx').forEach((box) => box.classList.toggle('dim', index !== null && Number(box.dataset.index) !== index))
  }
  $('layers').addEventListener('mouseover', (event) => { const row = event.target.closest('.region-row'); hover(row ? Number(row.dataset.index) : null) })
  $('layers').addEventListener('mouseleave', () => hover(null))
  canvas.addEventListener('pointerleave', () => { if (!drag) hover(null) })
  $('layers').addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove]')
    if (remove) {
      state.draft.items.splice(Number(remove.dataset.remove), 1)
      state.sel = clamp(state.sel, state.draft.items.length ? 0 : -1, state.draft.items.length - 1)
      changed(); return
    }
    const row = event.target.closest('.region-row')
    if (row) select(Number(row.dataset.index))
  })
  $('layers').addEventListener('keydown', (event) => {
    const row = event.target.closest('.region-row')
    if (row && (event.key === 'Enter' || event.key === ' ') && event.target === row) { event.preventDefault(); select(Number(row.dataset.index)) }
  })

  $('add-region').addEventListener('click', () => { state.sel = addRegion(state.draft); changed() })
  $('size-ctl').addEventListener('change', (event) => {
    const { id, value } = event.target
    const [width, height] = state.draft.size
    const number = Number(value)
    let size = null
    if (id === 'size-preset') size = value.split('x').map(Number)
    else if (id === 'size-w' && number > 0) size = [snapSize(number), height]
    else if (id === 'size-h' && number > 0) size = [width, snapSize(number)]
    else if (id === 'size-ratio' && value) size = sizeFromRatio(parseRatio(value), megapixelsOf(state.draft.size))
    else if (id === 'size-mp' && number > 0) size = sizeFromRatio(nearestRatio(ratioChoices(ratioField()), state.draft.size)?.ratio ?? width / height, number)
    if (size) state.draft.size = size
    changed()
  })
  $('show-img').addEventListener('change', (event) => { state.showImage = event.target.checked; renderCanvasFrame() })
  $('summary').addEventListener('input', (event) => { state.draft.summary = event.target.value; changed({ light: true }) })
  $('meta').addEventListener('input', (event) => { state.draft.meta = event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean); changed({ light: true }) })
  $('negative').addEventListener('input', (event) => { state.negative = event.target.value; scheduleDraftSave() })
  $('seed').addEventListener('input', (event) => { state.seed = event.target.value; scheduleDraftSave() })

  $('options-box').addEventListener('change', (event) => {
    const field = optionField(event.target.dataset.option)
    if (!field) return
    try { applyOption(field, event.target.value) } catch (error) { notify(error.message, true) }
    // Show what the workflow will use now: the kept value, or the earlier one when this entry was refused or blank.
    event.target.value = optionValue(field, state.setup.options)
  })
  $('options-box').addEventListener('click', (event) => {
    if (event.target.id !== 'options-reset') return
    state.setup.options = {}
    renderOptions()
    optionsChanged()
  })

  $('inspector').addEventListener('click', (event) => {
    const kind = event.target.closest('[data-kind]')?.dataset.kind
    if (kind) { state.draft.items[state.sel].label = kindId(kind); changed(); return }
    const move = event.target.closest('[data-move]')?.dataset.move
    if (move) { state.sel = moveRegion(state.draft, state.sel, Number(move)); changed() }
  })
  $('inspector').addEventListener('input', (event) => {
    const field = event.target.dataset.field
    if (!field) return
    state.draft.items[state.sel][field] = event.target.value
    changed({ light: true })
  })
  $('inspector').addEventListener('change', (event) => {
    if (!event.target.dataset.geo) return
    const [width, height] = state.draft.size
    const read = (key) => Number($('inspector').querySelector(`[data-geo="${key}"]`).value)
    const box = normalizeBox([read('x') / width, read('y') / height, (read('x') + read('w')) / width, (read('y') + read('h')) / height])
    if (box) state.draft.items[state.sel].box = box
    changed()
  })

  $('banner').addEventListener('click', (event) => {
    const action = event.target.closest('[data-banner]')?.dataset.banner
    if (action === 'reset' && state.source) { state.draft = cloneDraft(state.source.original); state.sel = state.draft.items.length ? 0 : -1; changed() }
    if (action === 'detach') { state.source = null; changed() }
    if (action === 'restore' && state.previous) {
      const { draft, source, negative } = state.previous
      state.previous = null; state.draft = draft; state.source = source; state.negative = negative; state.sel = draft.items.length ? 0 : -1
      changed()
    }
  })

  const stage = document.querySelector('.stage')
  stage.addEventListener('dragover', (event) => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); canvas.classList.add('dropping') } })
  stage.addEventListener('dragleave', () => canvas.classList.remove('dropping'))
  stage.addEventListener('drop', guard(async (event) => {
    event.preventDefault(); canvas.classList.remove('dropping')
    const file = event.dataTransfer?.files?.[0]
    if (file) await importFromFile(file)
  }))
}

function bindChrome() {
  $('tabs').addEventListener('click', (event) => { const tab = event.target.closest('[data-tab]')?.dataset.tab; if (tab) showTab(tab) })
  $('side-tabs').addEventListener('click', (event) => { const side = event.target.closest('[data-side]')?.dataset.side; if (side) { state.side = side; renderTabs() } })
  $('results-toggle').addEventListener('click', () => { state.resultsOpen = !state.resultsOpen; renderTabs() })
  $('generate').addEventListener('click', guard(async () => { await generate() }))
  $('wf-open').addEventListener('click', () => showTab('setup'))
  // Older hosts cannot open the library picker; the option stays hidden there rather than asking for a typed hash.
  $('pick-library').hidden = !api.supports('pickMedia')
  $('pick-library').addEventListener('click', guard(async () => {
    const [picked] = await api.pickMedia({ kind: 'image', max: 1 })
    if (picked) await importFromHash(picked.compositeHash)
  }))
  $('pick-file').addEventListener('click', () => $('file').click())
  $('file').addEventListener('change', guard(async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) await importFromFile(file)
  }))
  $('new-draft').addEventListener('click', () => { replaceDraft(newDraft(state.draft.size), null) })

  $('view-setup').addEventListener('change', guard(async (event) => {
    if (event.target.id === 'workflow-select') { chooseWorkflow(Number(event.target.value) || null); return }
    const role = event.target.dataset.role
    if (role) {
      state.setup.mapping[role] = event.target.value
      void saveSetup()
      setupChanged()
    }
  }))
  $('view-setup').addEventListener('click', guard(async (event) => {
    const mode = event.target.closest('[data-size-mode]')?.dataset.sizeMode
    if (mode) {
      const mapping = state.setup.mapping
      mapping.sizeMode = mode
      const guess = guessFieldMapping(workflowFields())
      for (const role of rolesFor(mapping).filter((item) => item.size)) mapping[role.id] ||= guess[role.id]
      void saveSetup()
      setupChanged()
      return
    }
    if (event.target.id !== 'reload-workflows') return
    await loadWorkflows(); setupChanged()
  }))
  $('results').addEventListener('click', guard(async (event) => {
    const edit = event.target.closest('[data-edit]')?.dataset.edit
    if (edit) { const [jobId, hash] = edit.split(':'); await editResult(Number(jobId), hash); return }
    const open = event.target.closest('[data-open]')?.dataset.open
    // The page is reloaded on the way back, so the draft and its image are stored before leaving.
    if (open) { await saveDraftNow(); await api.navigation.open(`/images/${open}`); return }
    const cancel = event.target.closest('[data-cancel]')?.dataset.cancel
    if (cancel) { await call(`/api/generation-queue/${cancel}/cancel`, { method: 'POST' }); void pollJobs(); return }
    // A tap shows the actions of one tile where there is no hover.
    const tile = event.target.closest('.tile')
    $('results').querySelectorAll('.tile.open').forEach((other) => { if (other !== tile) other.classList.remove('open') })
    tile?.classList.toggle('open')
  }))
  // The strip scrolls sideways; a vertical wheel moves it too.
  $('results').addEventListener('wheel', (event) => {
    const strip = event.currentTarget
    if (event.deltaX || strip.scrollWidth <= strip.clientWidth) return
    event.preventDefault()
    strip.scrollLeft += event.deltaY
  }, { passive: false })
}

// ---- boot -------------------------------------------------------------------------------------------------------

const actions = {
  'moss-bbox-studio.select_region': ({ number }) => { select(regionAt(number)) },
  'moss-bbox-studio.set_summary': ({ caption }) => { state.draft.summary = String(caption ?? ''); changed() },
  'moss-bbox-studio.set_region': (args) => {
    const corners = [args.x0, args.y0, args.x1, args.y1]
    const given = corners.filter((value) => value !== undefined).length
    if (given !== 0 && given !== 4) throw new Error('박스는 x0, y0, x1, y1 네 값을 함께 줘야 해.')
    const box = given === 4 ? normalizeBox(corners) : null
    if (given === 4 && !box) throw new Error('박스가 너무 작거나 캔버스 밖이야.')
    if (args.number === undefined) {
      state.sel = addRegion(state.draft, { label: args.kind, caption: args.caption, text: args.text, box })
    } else {
      const item = state.draft.items[regionAt(args.number)]
      if (args.kind !== undefined) item.label = kindId(args.kind)
      if (args.caption !== undefined) item.caption = String(args.caption)
      if (args.text !== undefined) item.text = String(args.text)
      if (box) item.box = box
      state.sel = regionAt(args.number)
    }
    changed()
  },
  'moss-bbox-studio.remove_region': ({ number }) => {
    state.draft.items.splice(regionAt(number), 1)
    state.sel = clamp(state.sel, state.draft.items.length ? 0 : -1, state.draft.items.length - 1)
    changed()
  },
  'moss-bbox-studio.set_size': ({ width, height }) => {
    if (width % 16 || height % 16) throw new Error('너비와 높이는 16의 배수여야 해.')
    state.draft.size = [width, height]
    changed()
  },
  'moss-bbox-studio.set_option': ({ id, value }) => {
    const field = optionField(String(id))
    if (!field) throw new Error(`조정할 수 있는 워크플로우 옵션 "${id}"가 없어. 페이지 데이터의 workflow.options에 있는 id를 써줘.`)
    applyOption(field, String(value ?? ''))
    renderOptions()
  },
  'moss-bbox-studio.import_image': async ({ compositeHash }) => { await importFromHash(String(compositeHash)) },
  'moss-bbox-studio.generate': async ({ seed } = {}) => { await generate(seed === undefined ? undefined : String(seed)) },
}

api = await connectPlugin(actions)
bindEditor()
bindChrome()

const [savedDraft, savedSetup, savedJobs] = await Promise.all([load('draft'), load('setup'), load('jobs')])
if (savedDraft?.draft?.items) {
  if (savedDraft.source?.hash && savedDraft.source.original?.items) { state.source = savedDraft.source; state.showImage = savedDraft.showImage !== false }
  state.draft = savedDraft.draft
  state.negative = String(savedDraft.negative ?? '')
  state.seed = String(savedDraft.seed ?? '')
  state.sel = state.draft.items.length ? 0 : -1
}
if (savedSetup?.mapping) state.setup = { workflowId: savedSetup.workflowId ?? null, mapping: { ...emptyMapping(), ...savedSetup.mapping }, options: savedSetup.options ?? {} }
if (Array.isArray(savedJobs)) state.jobs = savedJobs.filter((job) => Number.isInteger(job?.id) && Array.isArray(job.hashes) && Array.isArray(job.size))

try { await loadWorkflows() } catch (error) { notify(`워크플로우를 불러오지 못했어: ${error.message}`, true) }
if (state.setup.workflowId && !workflow()) chooseWorkflow(null)

renderEditor(); renderOptions(); renderResults(); renderTabs(); publish()
// The genbar shows a missing workflow ("선택 안 함"), so the status line only keeps a load error.
if (!$('status').classList.contains('error')) notify('')

api.events.on('queue.job.status', (event) => {
  const jobId = event?.payload?.job_id ?? event?.job_id
  if (state.jobs.some((job) => job.id === jobId)) void pollJobs()
})
api.events.on('resync', () => { void pollJobs() })
if (state.jobs.some(jobNeedsWork)) { void pollJobs(); startPolling() }

const launched = api.launch?.image?.compositeHash
if (launched) await guard(() => importFromHash(launched))()
