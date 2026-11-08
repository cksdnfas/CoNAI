// MOSS BBox Studio: draw boxes, write the prompt of each one, and send the layout JSON to a registered ComfyUI workflow.
// No server module: settings and the draft live in api.storage, everything else goes through native /api routes.
import { connectPlugin } from './conai-plugin.js'
import {
  FIELD_ROLES, KINDS, REGION_COLORS, SIZE_PRESETS, addRegion, buildLayout, buildPromptData, cloneDraft, describeDraft, guessFieldMapping,
  kindId, mappingIssues, moveRegion, newDraft, normalizeBox, parseLayoutPrompt, snapSize, stringifyLayout,
} from './layout.js'

const $ = (id) => document.getElementById(id)
const esc = (value) => String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char])
const clamp = (value, low, high) => Math.min(high, Math.max(low, value))
const color = (index) => REGION_COLORS[index % REGION_COLORS.length]
const HASH = /^[a-f0-9]{32}$/i
const TERMINAL = new Set(['completed', 'failed', 'cancelled'])
const STATUS_LABEL = { queued: '대기 중', dispatching: '보내는 중', running: '생성 중', completed: '완료', failed: '실패', cancelled: '취소됨' }
const MAX_STORED_JOBS = 8

const state = {
  tab: 'editor',
  draft: newDraft(),
  sel: -1,
  tool: 'select',
  source: null,
  previous: null,
  showImage: true,
  workflows: [],
  setup: { workflowId: null, mapping: { prompt: '', negative: '', width: '', height: '', seed: '' } },
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
  saveTimer = setTimeout(() => { void store('draft', { draft: state.draft, negative: state.negative, seed: state.seed }) }, 600)
}
const saveSetup = () => store('setup', state.setup)
// A value is limited to 64 KiB: only the newest jobs keep their layout text, older ones are edited from the image's own prompt.
const saveJobs = () => store('jobs', state.jobs.slice(0, MAX_STORED_JOBS).map((job, index) => (index < 3 ? job : { ...job, layout: '' })))

function notify(message, error = false) {
  const element = $('status')
  element.textContent = message
  element.classList.toggle('error', error)
}
const guard = (task) => async (...args) => { try { await task(...args) } catch (error) { notify(error.message, true) } }

// ---- derived values ---------------------------------------------------------------------------------------------

const workflow = () => state.workflows.find((item) => item.id === state.setup.workflowId) ?? null
const workflowFields = () => workflow()?.marked_fields ?? []
const setupIssues = () => (workflow() ? mappingIssues(workflowFields(), state.setup.mapping) : ['사용할 워크플로우를 골라줘.'])
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
  canvas.classList.toggle('select-tool', state.tool === 'select')
  $('size-badge').textContent = `${width}×${height}`
  const options = SIZE_PRESETS.map((preset) => ({ value: `${preset.size[0]}x${preset.size[1]}`, label: `${preset.id} · ${preset.size[0]}×${preset.size[1]}` }))
  const current = `${width}x${height}`
  if (!options.some((option) => option.value === current)) options.unshift({ value: current, label: `${width}×${height} (이미지 크기)` })
  $('size').innerHTML = options.map((option) => `<option value="${option.value}">${esc(option.label)}</option>`).join('')
  $('size').value = current
  $('img-toggle').hidden = !state.source
  $('show-img').checked = state.showImage
}

function renderBoxes() {
  $('canvas').innerHTML = state.draft.items.map((item, index) => {
    const [x0, y0, x1, y1] = item.box
    const kind = KINDS.find((entry) => entry.id === item.label)?.label ?? ''
    return `<div class="bx${index === state.sel ? ' selected' : ''}" tabindex="0" data-index="${index}" style="--c:${color(index)};left:${x0 * 100}%;top:${y0 * 100}%;width:${(x1 - x0) * 100}%;height:${(y1 - y0) * 100}%"><span class="tag">${index + 1} · ${esc(kind)}</span>${index === state.sel ? '<span class="handle" data-handle="1"></span>' : ''}</div>`
  }).join('')
}

function renderRegionList() {
  $('region-count').textContent = `${state.draft.items.length}개`
  $('layers').innerHTML = state.draft.items.map((item, index) => {
    const kind = KINDS.find((entry) => entry.id === item.label)?.label ?? ''
    return `<li class="region-row${index === state.sel ? ' selected' : ''}" tabindex="0" data-index="${index}" style="--c:${color(index)}"><span class="number">${index + 1}</span><span class="text"><span class="kind">${esc(kind)}</span><span class="caption${item.caption ? '' : ' empty'}">${esc(item.caption || '아직 비어 있어')}</span></span><button type="button" class="ghost" data-remove="${index}" aria-label="영역 ${index + 1} 삭제">✕</button></li>`
  }).join('')
}

function coordsText(index) {
  const bbox = buildLayout(state.draft).items[index]?.bbox
  return bbox ? `y ${bbox[0]} ~ ${bbox[2]} · x ${bbox[1]} ~ ${bbox[3]}` : ''
}

function renderCoords() {
  const element = $('inspector').querySelector('[data-coords]')
  if (element) element.textContent = coordsText(state.sel)
}

function renderInspector() {
  const host = $('inspector')
  const item = state.draft.items[state.sel]
  if (!item) { host.innerHTML = ''; return }
  host.innerHTML = `
    <div class="selected-title" style="--c:${color(state.sel)}"><span class="number">${state.sel + 1}</span><p class="conai-overline">선택한 영역</p></div>
    <div class="conai-segmented" role="group" aria-label="영역 종류">${KINDS.map((kind) => `<button type="button" data-kind="${kind.id}" aria-pressed="${item.label === kind.id}">${kind.label}</button>`).join('')}</div>
    <label class="field-gap">영역 프롬프트<textarea rows="6" data-field="caption">${esc(item.caption)}</textarea></label>
    ${item.label === 'text' ? `<label>그릴 글자<input data-field="text" value="${esc(item.text)}"></label>` : ''}
    <p class="coords" data-coords></p>
    <div class="order"><button type="button" data-move="-1">아래로</button><button type="button" data-move="1">위로</button></div>`
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
    parts.push(`<span class="badge ok">가져옴</span><span>${esc(source.name)} · ${source.layout ? `영역 ${source.original.items.length}개를 읽었어.` : '레이아웃 프롬프트가 아니라서 메인 프롬프트로만 가져왔어.'}${source.skipped ? ` 읽지 못한 영역 ${source.skipped}개는 건너뛰었어.` : ''}</span>`)
    parts.push('<span class="conai-spacer"></span><button type="button" data-banner="reset">원본 영역으로 되돌리기</button><button type="button" class="ghost" data-banner="detach">이미지 떼기</button>')
  }
  if (previous) parts.push(`${source ? '' : '<span class="conai-spacer"></span>'}<button type="button" class="ghost" data-banner="restore">이전 초안 복원</button>`)
  banner.innerHTML = parts.join('')
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
  $('genbar').hidden = !editor
  $('json-box').hidden = !editor
  $('view-results').hidden = state.tab !== 'results'
  $('view-setup').hidden = state.tab !== 'setup'
  const active = state.jobs.filter((job) => !TERMINAL.has(job.status)).length
  $('job-count').textContent = state.jobs.length ? `${active ? `${active}/` : ''}${state.jobs.length}` : ''
}

function renderEditor() {
  $('summary').value = state.draft.summary
  $('meta').value = state.draft.meta.join(', ')
  renderCanvasFrame(); renderBoxes(); renderRegionList(); renderInspector(); renderJson(); renderBanner(); renderGenBar()
  document.querySelectorAll('#tools [data-tool]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.tool === state.tool)))
}

// ---- setup / results rendering ----------------------------------------------------------------------------------

function renderSetup() {
  const current = workflow()
  const fields = workflowFields()
  const mapping = state.setup.mapping
  const issues = current ? setupIssues() : []
  const option = (field, selected) => `<option value="${esc(field.id)}"${field.id === selected ? ' selected' : ''}>${esc(field.label || field.id)} (${esc(field.id)})</option>`
  const compatible = (role) => fields.filter((field) => (role.id === 'prompt' || role.id === 'negative' ? ['text', 'textarea'].includes(field.type) : field.type === 'number'))
  $('view-setup').innerHTML = `<div class="setup">
    <section>
      <label>사용할 워크플로우<select id="workflow-select"><option value="">선택 안 함</option>${state.workflows.map((item) => `<option value="${item.id}"${item.id === state.setup.workflowId ? ' selected' : ''}>${esc(item.name)} (#${item.id})</option>`).join('')}</select></label>
      <p class="conai-overline field-gap">검사 결과</p>
      <ul class="checks">${current ? (issues.length ? issues.map((issue) => `<li><span class="badge warn">확인</span><span>${esc(issue)}</span></li>`).join('') : '<li><span class="badge ok">통과</span><span>생성에 필요한 칸이 모두 연결돼 있어.</span></li>') : ''}
        ${current && !mapping.width ? '<li><span class="badge warn">참고</span><span>크기 칸이 없어서 워크플로우에 고정된 크기로 생성돼. 캔버스 크기가 이와 다르면 박스 위치가 어긋나.</span></li>' : ''}</ul>
      <div class="toolbar field-gap"><button type="button" id="reload-workflows">워크플로우 다시 불러오기</button></div>
    </section>
    <section>
      <p class="conai-overline">입력 칸 연결</p>
      ${current ? FIELD_ROLES.map((role) => `<div class="maprow"><div class="role"><b>${role.label}</b></div><label><select data-role="${role.id}" aria-label="${role.label} 칸"><option value="">연결 안 함</option>${compatible(role).map((field) => option(field, mapping[role.id])).join('')}</select></label><span class="badge ${mapping[role.id] ? 'ok' : ''}">${mapping[role.id] ? '연결됨' : role.required ? '필수' : '선택'}</span></div>`).join('') : ''}    </section></div>`
}

function renderResults() {
  const host = $('view-results')
  if (!state.jobs.length) { host.innerHTML = '<p class="conai-empty">아직 요청한 작업이 없어. 편집기에서 “생성 요청”을 눌러줘.</p>'; return }
  host.innerHTML = `<div class="jobs">${state.jobs.map((job) => {
    const tone = job.status === 'completed' ? 'ok' : job.status === 'failed' ? 'destructive' : TERMINAL.has(job.status) ? '' : 'warn'
    const cancelable = !TERMINAL.has(job.status)
    const ratio = `${job.size[0]} / ${job.size[1]}`
    return `<section>
      <div class="job-head"><b>#${job.id}</b><span class="badge ${tone}">${STATUS_LABEL[job.status] ?? esc(job.status)}</span><span class="muted">${esc(job.workflowName)} · 영역 ${job.regions}개 · ${job.size[0]}×${job.size[1]}</span>${cancelable ? `<button type="button" class="ghost" data-cancel="${job.id}">취소</button>` : ''}</div>
      ${job.error ? `<p class="muted">${esc(job.error)}</p>` : ''}
      <div class="tiles">${job.hashes.map((hash) => `<div class="tile"><div class="conai-media-card"><div class="conai-media" style="--ratio:${ratio}"><img src="/api/images/${hash}/thumbnail" alt="작업 #${job.id} 결과" loading="lazy"></div></div><div class="actions"><button type="button" data-edit="${job.id}:${hash}">이 결과로 편집</button><button type="button" class="ghost" data-open="${hash}">이미지 상세 열기</button></div></div>`).join('')}
      ${job.status === 'completed' && !job.hashes.length ? '<p class="muted">결과 이미지를 처리하는 중이야…</p>' : ''}</div></section>`
  }).join('')}</div>`
}

function showTab(tab) {
  state.tab = tab
  renderTabs()
  if (tab === 'setup') renderSetup()
  if (tab === 'results') renderResults()
}

// ---- state changes ----------------------------------------------------------------------------------------------

function publish() {
  api.publish({
    revision: String(state.revision),
    dirty: false,
    data: {
      ...describeDraft(state.draft),
      selectedRegion: state.sel >= 0 ? state.sel + 1 : null,
      imageSource: state.source ? { kind: state.source.kind, name: state.source.name, compositeHash: state.source.hash ?? null } : null,
      workflow: workflow() ? { id: workflow().id, name: workflow().name, issues: setupIssues() } : null,
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
  changed()
}

function applySource({ kind, hash, name, url, size, prompt }) {
  const canvas = size?.[0] && size?.[1] ? [snapSize(size[0]), snapSize(size[1])] : [...state.draft.size]
  const parsed = parseLayoutPrompt(prompt, canvas)
  const draft = parsed?.draft ?? Object.assign(newDraft(canvas), { summary: String(prompt ?? '').trim() })
  replaceDraft(draft, { kind, hash, name, url, layout: Boolean(parsed), skipped: parsed?.skipped ?? 0, original: cloneDraft(draft) })
  notify(parsed ? `영역 ${draft.items.length}개를 읽었어.` : '이 이미지의 프롬프트는 레이아웃(JSON)이 아니야. 메인 프롬프트로만 가져왔어.')
}

async function importFromHash(hash) {
  if (!HASH.test(hash)) throw new Error('이미지 해시는 32자리 영문·숫자야.')
  notify('이미지를 불러오는 중…')
  const { data } = await call(`/api/images/${hash}`)
  applySource({
    kind: 'library', hash, name: String(data.original_file_path ?? '').split(/[\\/]/).pop() || hash.slice(0, 8),
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
      request_payload: { prompt_data: buildPromptData(state.setup.mapping, { draft, negative: state.negative, seed }) },
    }
    const result = await call('/api/generation-queue', jsonInit('POST', body))
    const id = result.record?.id
    if (!id) throw new Error('서버가 작업 번호를 돌려주지 않았어.')
    state.jobs.unshift({ id, status: result.record.status ?? 'queued', workflowName: current.name, layout: stringifyLayout(draft), size: [...draft.size], regions: draft.items.length, hashes: [], error: '', createdAt: Date.now() })
    void saveJobs()
    renderTabs(); publish(); startPolling()
    notify(`작업 #${id}을 요청했어. “결과” 탭에서 볼 수 있어.`)
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
  const { records } = await call('/api/generation-queue?mine=true&service_type=comfyui')
  for (const job of waiting) {
    const record = (records ?? []).find((item) => item.id === job.id)
    if (record) {
      job.status = record.status
      if (record.failure_message) job.error = record.failure_message
    }
    if (job.status === 'completed') await loadResults(job)
  }
  void saveJobs()
  renderTabs(); publish()
  if (state.tab === 'results') renderResults()
})

function startPolling() { if (!pollTimer) pollTimer = setInterval(() => { void pollJobs() }, 4000) }
function stopPolling() { clearInterval(pollTimer); pollTimer = null }

// ---- workflows --------------------------------------------------------------------------------------------------

async function loadWorkflows() {
  const { data } = await call('/api/workflows?active=true&kind=image')
  state.workflows = (data ?? []).map((item) => ({ id: item.id, name: item.name, marked_fields: Array.isArray(item.marked_fields) ? item.marked_fields : [] }))
  if (state.setup.workflowId && !workflow()) state.setup = { workflowId: null, mapping: { prompt: '', negative: '', width: '', height: '', seed: '' } }
}

function chooseWorkflow(id) {
  state.setup.workflowId = id || null
  state.setup.mapping = id ? guessFieldMapping(workflowFields()) : { prompt: '', negative: '', width: '', height: '', seed: '' }
  void saveSetup()
  renderSetup(); renderGenBar(); publish()
  if (id) notify(setupIssues().length ? '워크플로우를 골랐어. 아래 연결을 확인해줘.' : '워크플로우를 골랐어. 편집기에서 생성할 수 있어.')
}

// ---- events -----------------------------------------------------------------------------------------------------

function bindEditor() {
  const canvas = $('canvas')
  let drag = null
  const fractions = (event) => {
    const rect = canvas.getBoundingClientRect()
    return [clamp((event.clientX - rect.left) / rect.width, 0, 1), clamp((event.clientY - rect.top) / rect.height, 0, 1)]
  }

  canvas.addEventListener('pointerdown', (event) => {
    const [x, y] = fractions(event)
    const box = event.target.closest('.bx')
    if (box && state.tool === 'select') {
      const index = Number(box.dataset.index)
      const resize = Boolean(event.target.dataset.handle) && index === state.sel
      if (index !== state.sel) select(index)
      drag = { mode: resize ? 'resize' : 'move', index, x, y, box: [...state.draft.items[index].box] }
    } else if (state.tool === 'draw') {
      state.draft.items.push({ label: 'object', caption: '', text: '', box: [x, y, x, y] })
      state.sel = state.draft.items.length - 1
      drag = { mode: 'draw', index: state.sel, x, y, box: [x, y, x, y] }
      renderBoxes(); renderRegionList(); renderInspector()
    } else return
    canvas.setPointerCapture(event.pointerId)
  })

  canvas.addEventListener('pointermove', (event) => {
    if (!drag) return
    const [x, y] = fractions(event)
    const item = state.draft.items[drag.index]
    const [x0, y0, x1, y1] = drag.box
    if (drag.mode === 'move') {
      const width = x1 - x0, height = y1 - y0
      const left = clamp(x0 + x - drag.x, 0, 1 - width), top = clamp(y0 + y - drag.y, 0, 1 - height)
      item.box = [left, top, left + width, top + height]
    } else if (drag.mode === 'resize') {
      item.box = [x0, y0, clamp(x1 + x - drag.x, x0 + 0.03, 1), clamp(y1 + y - drag.y, y0 + 0.03, 1)]
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
      const box = normalizeBox(state.draft.items[index].box)
      if (!box) { state.draft.items.splice(index, 1); state.sel = state.draft.items.length - 1 } else { state.draft.items[index].box = box; state.tool = 'select' }
      changed()
      $('inspector').querySelector('[data-field="caption"]')?.focus()
    } else changed({ light: true })
  }
  canvas.addEventListener('pointerup', finish)
  canvas.addEventListener('pointercancel', finish)

  const hover = (index) => {
    $('layers').querySelectorAll('.region-row').forEach((row) => row.classList.toggle('hover', Number(row.dataset.index) === index))
    canvas.querySelectorAll('.bx').forEach((box) => box.classList.toggle('dim', index !== null && Number(box.dataset.index) !== index))
  }
  $('layers').addEventListener('mouseover', (event) => { const row = event.target.closest('.region-row'); hover(row ? Number(row.dataset.index) : null) })
  $('layers').addEventListener('mouseleave', () => hover(null))
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
  $('tools').addEventListener('click', (event) => {
    const tool = event.target.closest('[data-tool]')?.dataset.tool
    if (!tool) return
    state.tool = tool
    document.querySelectorAll('#tools [data-tool]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.tool === tool)))
    renderCanvasFrame()
  })
  $('size').addEventListener('change', (event) => {
    const [width, height] = event.target.value.split('x').map(Number)
    state.draft.size = [width, height]
    changed()
  })
  $('show-img').addEventListener('change', (event) => { state.showImage = event.target.checked; renderCanvasFrame() })
  $('summary').addEventListener('input', (event) => { state.draft.summary = event.target.value; changed({ light: true }) })
  $('meta').addEventListener('input', (event) => { state.draft.meta = event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean); changed({ light: true }) })
  $('negative').addEventListener('input', (event) => { state.negative = event.target.value; scheduleDraftSave() })
  $('seed').addEventListener('input', (event) => { state.seed = event.target.value; scheduleDraftSave() })

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
  $('generate').addEventListener('click', guard(async () => { await generate() }))
  $('import-open').addEventListener('click', () => { $('hash-input').value = ''; $('import-dialog').showModal() })
  $('import-close').addEventListener('click', () => $('import-dialog').close())
  $('import-hash').addEventListener('click', guard(async () => { await importFromHash($('hash-input').value.trim()); $('import-dialog').close() }))
  $('file').addEventListener('change', guard(async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) { await importFromFile(file); $('import-dialog').close() }
  }))
  $('new-draft').addEventListener('click', () => {
    replaceDraft(newDraft(state.draft.size), null)
    notify('새 초안을 시작했어. 이전 초안은 위 배너에서 복원할 수 있어.')
  })

  $('view-setup').addEventListener('change', guard(async (event) => {
    if (event.target.id === 'workflow-select') { chooseWorkflow(Number(event.target.value) || null); return }
    const role = event.target.dataset.role
    if (role) {
      state.setup.mapping[role] = event.target.value
      void saveSetup()
      renderSetup(); renderGenBar(); publish()
    }
  }))
  $('view-setup').addEventListener('click', guard(async (event) => {
    if (event.target.id !== 'reload-workflows') return
    await loadWorkflows(); renderSetup(); renderGenBar(); publish()
    notify('워크플로우 목록을 다시 불러왔어.')
  }))
  $('view-results').addEventListener('click', guard(async (event) => {
    const edit = event.target.closest('[data-edit]')?.dataset.edit
    if (edit) { const [jobId, hash] = edit.split(':'); await editResult(Number(jobId), hash); return }
    const open = event.target.closest('[data-open]')?.dataset.open
    if (open) { await api.navigation.open(`/images/${open}`); return }
    const cancel = event.target.closest('[data-cancel]')?.dataset.cancel
    if (cancel) { await call(`/api/generation-queue/${cancel}/cancel`, { method: 'POST' }); void pollJobs() }
  }))
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
  'moss-bbox-studio.import_image': async ({ compositeHash }) => { await importFromHash(String(compositeHash)) },
  'moss-bbox-studio.generate': async ({ seed } = {}) => { await generate(seed === undefined ? undefined : String(seed)) },
}

api = await connectPlugin(actions)
bindEditor()
bindChrome()

const [savedDraft, savedSetup, savedJobs] = await Promise.all([load('draft'), load('setup'), load('jobs')])
if (savedDraft?.draft?.items) {
  state.draft = savedDraft.draft
  state.negative = String(savedDraft.negative ?? '')
  state.seed = String(savedDraft.seed ?? '')
  state.sel = state.draft.items.length ? 0 : -1
}
if (savedSetup?.mapping) state.setup = { workflowId: savedSetup.workflowId ?? null, mapping: { ...state.setup.mapping, ...savedSetup.mapping } }
if (Array.isArray(savedJobs)) state.jobs = savedJobs.filter((job) => Number.isInteger(job?.id) && Array.isArray(job.hashes) && Array.isArray(job.size))

try { await loadWorkflows() } catch (error) { notify(`워크플로우를 불러오지 못했어: ${error.message}`, true) }
if (state.setup.workflowId && !workflow()) chooseWorkflow(null)

renderEditor(); renderTabs(); publish()
if (!workflow()) { if (!$('status').classList.contains('error')) notify('연결 설정에서 생성에 쓸 워크플로우를 먼저 골라줘.') } else notify('영역을 그리고 프롬프트를 써줘.')

api.events.on('queue.job.status', (event) => {
  const jobId = event?.payload?.job_id ?? event?.job_id
  if (state.jobs.some((job) => job.id === jobId)) void pollJobs()
})
api.events.on('resync', () => { void pollJobs() })
if (state.jobs.some(jobNeedsWork)) { void pollJobs(); startPolling() }

const launched = api.launch?.image?.compositeHash
if (launched) await guard(() => importFromHash(launched))()
