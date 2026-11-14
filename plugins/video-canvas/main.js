import { connectPlugin } from './conai-plugin.js'
import { MODES, PORTS, activePorts, cutEdges, labelTable, resolvePrompt } from './domain.mjs'
import { createAssistantState, createRefreshQueue, excerpt, rejectedMessage } from './assistant-state.mjs'

const $ = id => document.getElementById(id)
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const names = { image: '이미지', video: '비디오', audio: '오디오', bundle: '레퍼런스 번들', cut: '영상 컷', frame: '프레임' }
const ports = { start: '시작 프레임', end: '끝 프레임', ref_image: '참조 이미지', ref_video: '참조 영상', ref_audio: '참조 오디오', refmod: '번들' }
const reviewNames = { pending: '대기', pass: '통과', redo: '다시' }
const statusNames = { preparing: '준비 중', submitting: '제출 중', starting: '시작 중', pending: '대기', queued: '대기', running: '진행 중', processing: '처리 중', completed: '완료', failed: '실패', cancelled: '취소됨', proposed: '제안', discarded: '폐기됨' }
const assetStates = { ready: ['확인됨', 'ok'], changed: ['변경됨', 'warn'], 'no-permission': ['권한 없음', 'destructive'], missing: ['없음', 'destructive'], unverified: ['확인 실패', 'warn'] }
const badge = (label, cls = '') => `<span class="badge ${cls}">${esc(label)}</span>`
const statusBadge = status => badge(statusNames[status] ?? status, status === 'completed' ? 'ok' : status === 'failed' ? 'destructive' : '')
const assetBadge = check => check ? badge(...(assetStates[check.status] ?? [check.status])) : ''
const progressText = progress => progress?.total ? `${progress.processed}/${progress.total}` : ''
const seconds = value => `${Number(Number(value).toFixed(1))}초`
const s = { project: null, projects: [], selection: null, edges: 'all', x: 24, y: 24, zoom: 1, launch: null, checks: null, tab: 'input', batch: null, nodeDetail: null, runBusy: false }
const assistant = createAssistantState(), extractionWatches = new Map()
let api, queue = Promise.resolve(), previewObserver, launchName = null
const selected = () => s.project?.nodes.find(node => node.id === s.selection)
const cuts = () => s.project?.nodes.filter(node => node.kind === 'cut') ?? []
function notice(message, error = false) { $('message').textContent = message; $('message').className = error ? 'error' : 'muted' }
async function request(op, args = {}, options) {
  const result = await api.server({ project_id: s.project?.id, ...args, op }, options)
  if (result?.ok === false) {
    assistant.set('lastError', { op, status: result.status, message: result.error })
    if (result.outcome) assistant.set('lastRun', result.outcome, { takeId: result.outcome.takeId, seed: result.outcome.seed, status: result.outcome.status, inputDigest: result.outcome.inputDigest })
    publish()
    throw Object.assign(new Error(result.error), { status: result.status })
  }
  const section = op === 'read_canvas' && !args.full ? 'lastRead' : { read_node: 'lastNode', apply_ops: 'lastEdit', run_cut: 'lastRun', propose_run_cut: 'lastRun', get_take: 'lastRun', check: 'lastCheck', extract_frame: 'lastExtraction' }[op]
  if (section) {
    const summary = section === 'lastEdit' ? { revision: result.revision, applied: result.applied.length, rejected: result.rejected.length }
      : section === 'lastRun' ? { takeId: result.takeId ?? result.id, seed: result.seed, status: result.status, inputDigest: result.inputDigest }
        : section === 'lastNode' ? { nodeId: result.node.id, inputDigest: result.preview?.inputDigest ?? null }
          : section === 'lastExtraction' ? { id: result.id, status: result.status, jobId: result.jobId }
            : section === 'lastCheck' ? { blocked: result.cuts.some(cut => cut.blocked) } : { nextCursor: result.nextCursor, nextEdgeCursor: result.nextEdgeCursor }
    assistant.set(section, result, summary)
    if (op === 'read_node') s.nodeDetail = result
    publish()
  }
  if (['create_project', 'save_profile', 'undo'].includes(op)) {
    assistant.set('lastEdit', { revision: result.revision, projectId: result.id,
      ...(op === 'save_profile' ? { profiles: result.profiles } : {}), applied: [{ op }], rejected: [], tempIds: {} },
    { revision: result.revision, applied: 1, rejected: 0 })
    publish()
  }
  return result
}
function unwrap(result) {
  const native = result.result ?? result
  if (native.isError) throw new Error(native.content?.filter(part => part.type === 'text').map(part => part.text).join('\n'))
  if (!native.content) return native
  const text = native.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
  try { return JSON.parse(text) } catch { return text }
}
async function native(name, args = {}) { return unwrap(await api.app.call(name, args)) }
async function http(path) {
  const response = await api.app.fetch(path), body = await response.json()
  if (!response.ok || body.success === false) throw new Error(body.error ?? response.statusText)
  return body
}
function task(fn) {
  const next = queue.then(fn)
  queue = next.catch(error => { notice(error.message, true) })
  return next
}
async function reload() {
  if (s.project) s.project = await request('read_canvas', { full: true })
  if (s.project?.nodes.some(node => node.id === s.selection)) await request('read_node', { id: s.selection })
  render()
}
async function edit(ops, revision = s.project.revision, origin = 'human') {
  const prepared = ops.map(op => op.op === 'import_launch' ? { ...op, name: op.name ?? launchName ?? names.image, ref: { source: 'library', compositeHash: s.launch.compositeHash } } : op)
  const result = await request('apply_ops', { ops: prepared, expected_revision: revision, origin })
  if (origin === 'assistant') s.batch = result
  await reload()
  notice(`${result.applied.length}건 적용했어.`)
  if (result.applied.some(item => item.op.op === 'import_launch')) {
    s.launch = null
    await api.navigation.open('/ext/video-canvas/canvas')
  }
  if (result.rejected.length) throw new Error(rejectedMessage(result))
  return result
}
function publish() {
  if (!api) return
  if (s.project) {
    s.projects = s.projects.map(project => project.id === s.project.id ? { ...project, nodeCount: s.project.nodes.length } : project)
    assistant.set('canvas', excerpt(s.project))
  }
  assistant.set('projects', s.projects.map(({ id, name, nodeCount }) => ({ id, name, nodeCount })), { total: s.projects.length })
  assistant.set('pendingExtractions', (s.project?.extractions ?? []).map(({ id, jobId, status, progress, resultHashes, nodeIds, error, rejected }) => ({ id, jobId, status, progress, resultHashes, nodeIds, error, rejected })))
  api.publish(assistant.snapshot({ projectId: s.project?.id ?? null, selection: s.selection ? [s.selection] : [], launch: s.launch }, s.project?.revision ?? 0))
}
function slotRows(cut) {
  const edges = cutEdges(s.project, cut, false), rows = []
  for (const port of Object.keys(PORTS)) {
    const active = activePorts(cut.data.mode).includes(port), peers = edges.filter(edge => edge.port === port)
    peers.forEach(edge => rows.push({ edge, port, active, position: edge.position }))
    if (active && (!['start', 'end'].includes(port) || !peers.length)) rows.push({ edge: null, port, active, position: peers.length })
  }
  return rows
}
function render() {
  $('projects').innerHTML = '<option value="">프로젝트를 골라줘</option>' + s.projects.map(project => `<option value="${esc(project.id)}">${esc(project.name)}</option>`).join('')
  $('projects').value = s.project?.id ?? ''
  $('revision').textContent = s.project ? `rev ${s.project.revision}` : ''
  $('counts').innerHTML = `<dt>노드</dt><dd>${s.project?.nodes.length ?? 0}</dd><dt>검수 통과 컷</dt><dd>${cuts().filter(cut => cut.review === 'pass').length} / ${cuts().length}</dd>`
  renderLaunch(); renderNodes(); renderInspector(); lockRunButtons(); publish()
}
function renderLaunch() {
  $('launch').hidden = !s.launch
  if (!s.launch) return
  $('launch').innerHTML = `<span class="conai-media launch-thumb"><img src="/api/images/${encodeURIComponent(s.launch.compositeHash)}/thumbnail" alt=""></span><b>${esc(launchName ?? names.image)}</b><select id="launch-target" aria-label="이미지 가져올 곳"><option value="">새 이미지 노드</option>${cuts().flatMap(cut => ['start', 'end', 'ref_image'].map(port => `<option value="${esc(`${cut.id}|${port}`)}">${esc(cut.data.name)} · ${ports[port]}</option>`)).join('')}</select><button data-launch="import" class="primary" ${s.project ? '' : 'disabled'}>가져오기</button><button data-launch="dismiss" class="ghost">그만두기</button>${s.project ? '' : '<span class="muted">프로젝트를 먼저 골라줘.</span>'}`
}
async function libraryName(hash, kind = 'image') {
  const path = (await http(`/api/images/${encodeURIComponent(hash)}`)).data?.original_file_path
  return path?.replace(/\\/g, '/').split('/').at(-1) || names[kind]
}
function renderNodes() {
  previewObserver?.disconnect()
  $('nodes').innerHTML = (s.project?.nodes ?? []).map(node => {
    const last = s.project.takes.filter(take => take.cutId === node.id).at(-1)
    const members = node.data.check?.members ?? node.data.members ?? []
    return `<article class="vc-node" data-id="${esc(node.id)}" data-kind="${esc(node.kind)}" style="left:${node.x}px;top:${node.y}px" tabindex="0" aria-label="${esc(node.data.name)}" aria-selected="${node.id === s.selection}">
      <small>${names[node.kind]}${node.kind === 'cut' ? ` · ${esc(node.data.mode)} · ${node.data.duration}초` : ''}</small><h3>${esc(node.data.name)}</h3>
      ${node.kind === 'bundle' ? `<div class="conai-chips">${['image', 'video', 'audio'].map(kind => [kind, members.filter(member => member.kind === kind).length]).filter(([, count]) => count).map(([kind, count]) => badge(`${names[kind]} ${count}`)).join('')}</div>` : ''}
      ${node.data.ref?.source === 'library' ? `<img data-thumb="${esc(node.data.ref.compositeHash)}" alt="" loading="lazy">` : ''}
      ${node.kind === 'cut' ? `<div class="vc-slots">${slotRows(node).map(row => {
        const source = s.project.nodes.find(node => node.id === row.edge?.from)
        return `<div class="vc-slot ${row.active ? '' : 'unused'}" data-edge="${esc(row.edge?.id ?? '')}" data-port="${row.port}" data-position="${row.position}"><button class="vc-input" aria-label="${ports[row.port]}에 연결"></button><span>${ports[row.port]} ${['start', 'end'].includes(row.port) ? '' : row.position + 1}</span><span>${esc(source?.data.name ?? '비어 있음')}</span></div>`
      }).join('')}</div><p class="muted">${esc(node.data.raw || node.data.prompt)}</p><small>${esc(last ? statusNames[last.status] ?? last.status : '생성 전')} · seed ${node.data.seed}</small>` : `<div class="conai-chips">${assetBadge(node.data.check)}${node.review === 'pending' ? '' : badge(reviewNames[node.review], node.review === 'pass' ? 'ok' : 'warn')}</div><button draggable="true" class="vc-output" aria-label="이 소재 연결"></button>`}
    </article>`
  }).join('')
  previewObserver = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      const image = entry.target
      image.src = `/api/images/${encodeURIComponent(image.dataset.thumb)}/thumbnail`
      previewObserver.unobserve(image)
    }
  }, { root: $('canvas') })
  document.querySelectorAll('[data-thumb]').forEach(image => previewObserver.observe(image))
  transform()
  requestAnimationFrame(drawEdges)
}
function transform() {
  $('stage').style.transform = `translate(${s.x}px,${s.y}px) scale(${s.zoom})`
  $('zoom').textContent = `${Math.round(s.zoom * 100)}%`
}
function drawEdges() {
  if (!s.project || s.edges === 'off') { $('edges').innerHTML = ''; return }
  const stage = $('stage').getBoundingClientRect()
  $('edges').innerHTML = s.project.edges.filter(edge => s.edges !== 'selected' || [edge.from, edge.to].includes(s.selection)).map(edge => {
    const source = document.querySelector(`[data-id="${CSS.escape(edge.from)}"] .vc-output`)
    const target = document.querySelector(`[data-edge="${CSS.escape(edge.id)}"] .vc-input`)
    if (!source || !target) return ''
    const a = source.getBoundingClientRect(), b = target.getBoundingClientRect()
    const x1 = (a.x + a.width / 2 - stage.x) / s.zoom, y1 = (a.y + a.height / 2 - stage.y) / s.zoom
    const x2 = (b.x + b.width / 2 - stage.x) / s.zoom, y2 = (b.y + b.height / 2 - stage.y) / s.zoom
    const cut = s.project.nodes.find(node => node.id === edge.to), kind = PORTS[edge.port]
    return `<path data-kind="${kind}" class="${activePorts(cut.data.mode).includes(edge.port) ? '' : 'unused'}" d="M${x1},${y1} C${x1 + 80},${y1} ${x2 - 80},${y2} ${x2},${y2}"/>`
  }).join('')
}
const button = (action, label, data = '', cls = '') => `<button class="${cls}" data-action="${action}" ${data}>${label}</button>`
const field = (label, key, value, type = 'text') => `<label>${label}<input data-field="${key}" type="${type}" value="${esc(value)}"></label>`
function review(item) {
  return `<h2 class="conai-group-head">검수</h2><div class="conai-segmented">${Object.entries(reviewNames).map(([value, label]) => button('review', label, `data-review="${value}" data-item="${esc(item.id)}" aria-pressed="${item.review === value}"`)).join('')}</div><label>메모<input data-memo="${esc(item.id)}" value="${esc(item.memo)}"></label>`
}
const nameOf = id => s.project.nodes.find(node => node.id === id)?.data.name
const toolbar = html => `<div class="toolbar">${html}</div>`
function renderInspector() {
  const node = selected()
  if (s.tab === 'assistant') $('assistant-panel').setAttribute('aria-current', 'true'); else $('assistant-panel').removeAttribute('aria-current')
  if (s.tab === 'checks' && s.checks) {
    $('inspector').innerHTML = `<h2>전체 체크</h2><div class="conai-list">${Object.entries(s.checks.assets).map(([id, asset]) => `<div class="conai-list-row"><div class="conai-row-main"><span class="conai-row-title">${esc(nameOf(id))}</span>${asset.message ? `<p class="error">${esc(asset.message)}</p>` : ''}${asset.status === 'changed' ? toolbar(button('fingerprint', '새 파일로 갱신', `data-item="${esc(id)}"`) + button('keep', '그대로 두기')) : ''}</div>${assetBadge(asset)}</div>`).join('')}${s.checks.cuts.map(cut => `<div class="conai-list-row"><div class="conai-row-main"><span class="conai-row-title">${esc(nameOf(cut.id))}</span>${issues(cut.errors, 'error')}${issues(cut.warnings, 'warning')}</div>${cut.blocked ? badge('막힘', 'destructive') : badge('통과', 'ok')}</div>`).join('')}</div>`
    return
  }
  if (s.tab === 'assistant') {
    const proposals = (s.project?.takes ?? []).filter(take => take.status === 'proposed'), extractions = s.project?.extractions ?? []
    const sourceName = item => item.source?.nodeId ? nameOf(item.source.nodeId) : s.project.takes.find(take => take.id === item.source?.takeId)?.label
    $('inspector').innerHTML = `<h2>어시스턴트 변경</h2>${s.batch ? `<details><summary>적용 ${s.batch.applied.length} · 거절 ${s.batch.rejected.length}</summary><pre>${esc(JSON.stringify(s.batch, null, 2))}</pre></details>` : ''}${toolbar(button('undo', '직전 배치 되돌리기'))}${proposals.length ? `<h2 class="conai-group-head">생성 제안</h2><div class="conai-list">${proposals.map(takeCard).join('')}</div>` : ''}${extractions.length ? `<h2 class="conai-group-head">프레임 추출 작업</h2><div class="conai-list">${extractions.map(item => `<div class="conai-list-row"><div class="conai-row-main"><span class="conai-row-title">${esc(sourceName(item) ?? '프레임 추출')}</span>${progressText(item.progress) ? `<span class="conai-row-meta">${progressText(item.progress)}</span>` : ''}${item.error ? `<p class="error">${esc(item.error)}</p>` : ''}${item.jobId && !isTerminal(item.status) ? toolbar(button('extraction-status', '상태 갱신', `data-extraction="${esc(item.id)}"`) + button('extraction-cancel', '작업 취소', `data-extraction="${esc(item.id)}"`)) : ''}</div>${statusBadge(item.status)}</div>`).join('')}</div>` : ''}`
    return
  }
  if (!node) { $('inspector').innerHTML = '<p class="conai-empty">선택 없음</p>'; return }
  const uses = node.kind === 'cut' ? [] : s.project.edges.filter(edge => edge.from === node.id)
  $('inspector').innerHTML = `<h2>${names[node.kind]}</h2>${field('이름', 'name', node.data.name)}${node.kind === 'cut' ? cutInspector(node) : `${node.data.check ? `<div class="conai-chips">${assetBadge(node.data.check)}</div>` : ''}${toolbar(button('preview', '미리보기') + (node.kind === 'video' ? button('extract', '프레임 추출') : ''))}<h2 class="conai-group-head">쓰는 곳</h2>${uses.length ? `<ul class="conai-list">${uses.map(edge => `<li class="conai-list-row">${esc(nameOf(edge.to))} · ${ports[edge.port]}</li>`).join('')}</ul>` : '<p class="conai-empty">연결 없음</p>'}`}${review(node)}${toolbar(button('remove', '노드 삭제', '', 'ghost'))}`
}
const issues = (list, cls) => list.map(issue => `<p class="${cls}">${esc(issue.message)}</p>`).join('')
function cutInspector(cut) {
  const resolved = resolvePrompt(s.project, cut), table = labelTable(s.project, cut)
  const all = cutEdges(s.project, cut, false), takes = s.project.takes.filter(take => take.cutId === cut.id).reverse()
  return `<div class="conai-tabs"><button data-tab="input" aria-selected="${s.tab !== 'generate'}">입력·프롬프트</button><button data-tab="generate" aria-selected="${s.tab === 'generate'}">생성·이력</button></div>
    ${s.tab === 'generate' ? `<label>생성 프로필<select data-field="profileId"><option value="">골라줘</option>${s.project.profiles.map(profile => `<option value="${esc(profile.id)}" ${cut.data.profileId === profile.id ? 'selected' : ''}>${esc(profile.label)}</option>`).join('')}</select></label><div class="two">${field('길이(초)', 'duration', cut.data.duration, 'number')}${field('시드', 'seed', cut.data.seed, 'number')}</div>${toolbar(button('seed', '새 시드') + button('run', '지금 생성', '', 'primary') + button('propose', '제안으로 올리기'))}<h2 class="conai-group-head">생성 이력</h2>${takes.length ? `<div class="conai-list">${takes.map(takeCard).join('')}</div>` : '<p class="conai-empty">없음</p>'}` : `
    <label>모드<select data-field="mode">${MODES.map(mode => `<option ${mode === cut.data.mode ? 'selected' : ''}>${mode}</option>`).join('')}</select></label>
    <h2 class="conai-group-head">입력 슬롯·순서</h2>
    ${all.map(edge => {
      const node = s.project.nodes.find(node => node.id === edge.from), row = table.filter(row => row.edgeId === edge.id).map(row => row.label).join(' / ')
      return `<details class="slot-editor" draggable="true" data-order="${esc(edge.id)}" data-port="${edge.port}"><summary>${esc(row || '미사용')} · ${esc(node.data.name)}</summary><p class="muted">${ports[edge.port]} ${edge.position + 1}</p>${toolbar(button('up', '↑', `data-edge="${esc(edge.id)}" aria-label="위로"`) + button('down', '↓', `data-edge="${esc(edge.id)}" aria-label="아래로"`) + button('disconnect', '연결 해제', `data-edge="${esc(edge.id)}"`))}
      ${node.kind === 'video' || node.kind === 'audio' ? `<div class="two"><label>시작(초)<input type="number" step="any" data-prop="trim_start" data-edge="${esc(edge.id)}" value="${edge.props.trim_start ?? 0}"></label><label>끝(초)<input type="number" step="any" data-prop="trim_end" data-edge="${esc(edge.id)}" value="${edge.props.trim_end ?? node.data.duration ?? 2}"></label></div>` : ''}
      ${node.kind === 'video' ? `<label>영상 소리<select data-prop="media_mode" data-edge="${esc(edge.id)}">${[['video', '영상만'], ['audio', '소리만'], ['video_audio', '영상+소리']].map(([value, label]) => `<option value="${value}" ${(edge.props.media_mode ?? 'video') === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>오디오 슬롯 (0부터)<input type="number" data-prop="audioSlot" data-edge="${esc(edge.id)}" value="${edge.props.audioSlot ?? 0}"></label>` : ''}
      ${node.kind === 'bundle' ? `<div class="two"><label>번들 슬롯 (1–8)<input type="number" data-prop="slot" data-edge="${esc(edge.id)}" value="${edge.props.slot ?? edge.position + 1}"></label><label>강도<input type="number" step="any" data-prop="strength" data-edge="${esc(edge.id)}" value="${edge.props.strength ?? 1}"></label></div><label>설명<input data-prop="description" data-edge="${esc(edge.id)}" value="${esc(edge.props.description)}"></label>` : ''}</details>`
    }).join('')}
    <div class="two"><label>소재<select id="connect-from">${s.project.nodes.filter(node => node.kind !== 'cut').map(node => `<option value="${esc(node.id)}">${esc(node.data.name)}</option>`).join('')}</select></label><label>슬롯<select id="connect-port">${Object.entries(ports).map(([port, label]) => `<option value="${port}">${label}</option>`).join('')}</select></label></div>${toolbar(button('connect', '슬롯에 넣기'))}
    <h2 class="conai-group-head">프롬프트</h2><label>간단 프롬프트<textarea data-field="prompt" rows="4">${esc(cut.data.prompt)}</textarea></label><div class="conai-chips">${[...new Set(table.map(row => row.name))].map(name => `<button class="conai-chip" data-token="${esc(name)}">@${esc(name)}</button>`).join('')}</div>
    <label>사운드<textarea data-field="soundscape" rows="2">${esc(cut.data.soundscape)}</textarea></label><label>음악<textarea data-field="music" rows="2">${esc(cut.data.music)}</textarea></label><label>원문<textarea data-field="raw" rows="3">${esc(cut.data.raw)}</textarea></label>`}
    <h2 class="conai-group-head">전송될 프롬프트</h2><pre>${esc(resolved.prompt)}${resolved.soundscape ? `\n사운드: ${esc(resolved.soundscape)}` : ''}${resolved.music ? `\n음악: ${esc(resolved.music)}` : ''}</pre>${s.tab === 'generate' && resolved.table.length ? `<table class="label-table"><tbody>${resolved.table.map(row => `<tr><td>${esc(row.label)}</td><td>${esc(row.name)}</td><td>${ports[row.port]} · ${row.slot}</td></tr>`).join('')}</tbody></table>` : ''}${resolved.errors.map(message => `<p class="error">${esc(message)}</p>`).join('')}${resolved.warnings.map(message => `<p class="warning">${esc(message)}</p>`).join('')}`
}
function takeCard(take) {
  const id = `data-take="${esc(take.id)}"`
  return `<div class="conai-list-row"><div class="conai-row-main"><div class="toolbar"><span class="conai-row-title">${esc(take.label)}</span>${statusBadge(take.status)}</div><span class="conai-row-meta">seed ${take.seed}${take.jobId ? ` · job ${esc(take.jobId)}` : ''}</span>${take.error ? `<p class="error">${esc(take.error)}</p>` : ''}<details><summary>보낸 프롬프트·슬롯·프로필</summary><pre>${esc(JSON.stringify({ seed: take.seed, profile: take.profile, resolved: take.resolved }, null, 2))}</pre></details><div class="toolbar">
    ${take.status === 'proposed' ? button('approve', '승인하고 생성', id, 'primary') + button('discard', '폐기', id) : button('refresh-take', '상태 갱신', id)}
    ${take.jobId && !['completed', 'failed', 'cancelled'].includes(take.status) ? button('cancel', '취소', id) : ''}
    ${take.status === 'failed' && !take.jobId ? button('retry', '같은 요청 재시도', id) : ''}
    ${take.resultHash ? button('extract-take', '프레임 뽑기', id) + button('preview-take', '결과 보기', id) : ''}
    ${take.status === 'discarded' ? '' : button('rerun-take', '같은 시드·이 입력으로', id)}${button('rerun-canvas', '같은 시드·현재 입력으로', id)}${button('rerun-new', '새 시드·현재 입력으로', id)}
    </div>${review(take)}</div></div>`
}
// Every dialog is title, fields, then one footer row: close/cancel and at most one primary action (#dialog-primary).
function modal(title, body, { primary, close = '취소', danger = false } = {}) {
  $('modal').innerHTML = `<h2>${esc(title)}</h2>${body}<div class="conai-dialog-foot"><button id="dialog-close" class="ghost" data-close>${close}</button>${primary ? `<button id="dialog-primary" class="${danger ? 'destructive' : 'primary'}">${primary}</button>` : ''}</div>`
  if (!$('modal').open) $('modal').showModal()
}
function select(id) {
  s.selection = id; s.nodeDetail = null; s.tab = 'input'; render()
  if (id) return request('read_node', { id })
}
async function loadProjects() {
  s.projects = []
  let offset = 0
  for (;;) {
    const page = await request('list_projects', { offset })
    s.projects.push(...page.projects)
    if (page.projects.length < 40) break
    offset += 40
  }
}
async function chooseProject(id) {
  assistant.clear(); s.nodeDetail = null
  if (!id) { s.project = null; select(null); return }
  s.project = { id }
  s.selection = null; s.checks = null
  await reload()
}
async function createProject(name) {
  s.project = await request('create_project', { name })
  await loadProjects(); render()
}
async function importRows(rows) {
  const result = await edit(rows.map((row, index) => ({ op: `import_${row.kind}`, ref: row.ref, name: row.name, at: { x: (80 + index * 24 - s.x) / s.zoom, y: (80 + index * 24 - s.y) / s.zoom } })))
  if (result.applied.length) select(result.applied[0].id)
}
const memberCounts = members => ['image', 'video', 'audio'].map(kind => [kind, members.filter(member => member.kind === kind).length]).filter(([, count]) => count).map(([kind, count]) => `${names[kind]} ${count}`).join(' · ')
async function picker(kind) {
  const library = kind === 'image' || kind === 'video'
  if (library && api.supports('pickMedia')) {
    const picked = await api.pickMedia({ kind, title: `${names[kind]} 가져오기` })
    if (picked.length) await task(() => importRows(picked.map(item => ({ kind: item.kind, name: item.name, ref: { source: 'library', compositeHash: item.compositeHash } }))))
    return
  }
  modal(`${names[kind]} 가져오기`, `<form id="asset-form"><label class="conai-search"><input id="asset-query" type="search" aria-label="검색" placeholder="${{ audio: '오디오 그룹', bundle: '번들 이름' }[kind] ?? '프롬프트'}"></label></form><div id="asset-group" class="toolbar" hidden><button id="asset-back" class="ghost">← 그룹</button><b id="asset-group-name"></b></div><div id="asset-results" class="${library ? 'picker-grid' : 'conai-list picker-list'}"></div><div class="toolbar"><button id="asset-next" hidden>더 보기</button></div>`)
  let page = 1, offset = 0, group = null, cursor = null, rows = []
  async function search(next = false) {
    if (!next) { page = 1; offset = 0; cursor = null; rows = [] }
    const query = $('asset-query').value
    let more = false
    if (library) {
      const result = await native('search_images', { search_text: query, media_type: kind, page, limit: 20 })
      // search_images omits file paths; the per-item library lookup supplies the original file name.
      const fileNames = await Promise.all(result.images.map(item => libraryName(item.composite_hash, kind)))
      rows.push(...result.images.map((item, index) => ({ kind, hash: item.composite_hash, name: fileNames[index], meta: [item.width && item.height ? `${item.width}×${item.height}` : '', item.duration ? seconds(item.duration) : ''].filter(Boolean).join(' · '), ref: { source: 'library', compositeHash: item.composite_hash } })))
      more = page * 20 < result.total
    } else if (kind === 'audio') {
      if (group) {
        const result = await native('list_audio_candidates', { group_id: group.id, limit: 20, offset })
        rows.push(...result.candidates.map(item => ({ kind, name: item.name, candidateId: item.candidate_id, meta: [item.duration_seconds == null ? '' : seconds(item.duration_seconds), { selected: '선택됨', rejected: '제외' }[item.review] ?? ''].filter(Boolean).join(' · '), ref: { source: 'audio', candidateId: item.candidate_id } })))
        more = offset + 20 < result.total
      } else {
        const result = await native('list_audio_groups', { search: query, limit: 20, ...(cursor ? { cursor } : {}) })
        rows.push(...result.items.map(item => ({ group: item, name: item.name, meta: item.candidate_count == null ? '' : `후보 ${item.candidate_count}개` })))
        cursor = result.next_cursor
        more = Boolean(cursor)
      }
    } else {
      const records = (await http('/api/refmods')).data
      const profile = s.project.profiles.find(profile => profile.id === selected()?.data.profileId)
      const result = await native('list_comfy_refmods', { ...(profile ? { workflow_id: profile.workflowId } : {}), ...(profile?.serverId ? { server_id: profile.serverId } : {}) })
      rows = result.entries.filter(item => item.name.includes(query)).map(item => {
        const record = records.find(record => record.name === item.name && record.server_id === result.server_id)
        return { kind, name: item.name, meta: [memberCounts(item.members), item.description || item.concept].filter(Boolean).join(' · '), ref: { name: item.name, ...(record ? { recordId: record.id } : {}) } }
      })
    }
    $('asset-form').hidden = Boolean(group)
    $('asset-group').hidden = !group
    $('asset-group-name').textContent = group?.name ?? ''
    $('asset-results').innerHTML = rows.map((row, index) => library
      ? `<button class="conai-media-card" data-pick="${index}" aria-label="${esc([row.name, row.meta].filter(Boolean).join(' · '))}"><span class="conai-media"><img src="/api/images/${encodeURIComponent(row.hash)}/thumbnail" alt="" loading="lazy"></span><span class="conai-media-body"><span class="conai-media-title">${esc(row.name)}</span>${row.meta ? `<span class="conai-media-meta">${esc(row.meta)}</span>` : ''}</span></button>`
      : row.candidateId
        ? `<div class="conai-list-row"><div class="conai-row-main"><span class="conai-row-title">${esc(row.name)}</span>${row.meta ? `<span class="conai-row-meta">${esc(row.meta)}</span>` : ''}<audio controls preload="none" src="/api/audio/candidates/${encodeURIComponent(row.candidateId)}/file"></audio></div><button data-pick="${index}">가져오기</button></div>`
        : `<button class="conai-list-row" data-pick="${index}"><span class="conai-row-main"><span class="conai-row-title">${esc(row.name)}</span>${row.meta ? `<span class="conai-row-meta">${esc(row.meta)}</span>` : ''}</span></button>`).join('') || '<p class="conai-empty">찾은 소재가 없어.</p>'
    $('asset-next').hidden = !more
  }
  $('asset-results').onclick = event => {
    const index = event.target.closest('[data-pick]')?.dataset.pick
    if (index === undefined) return
    const row = rows[Number(index)]
    if (row.group) { group = row.group; void task(() => search()); return }
    void task(async () => {
      await importRows([row])
      $('modal').close()
    })
  }
  $('asset-form').onsubmit = event => { event.preventDefault(); void task(() => search()) }
  $('asset-back').onclick = () => { group = null; void task(() => search()) }
  $('asset-next').onclick = () => { page++; offset += 20; void task(() => search(true)) }
  await task(() => search())
}
async function preview(ref, target, title = '미리보기') {
  let path
  if (ref.source === 'library') {
    const result = await native('get_media_download', { composite_hashes: [ref.compositeHash] })
    const artifact = result.items[0]?.artifact
    if (!artifact) throw new Error(result.items[0]?.error ?? '미리보기를 열 수 없어.')
    const media = await api.media.open(artifact.artifact_id)
    path = media.url
  } else if (ref.source === 'audio') path = `/api/audio/candidates/${ref.candidateId}/file`
  else throw new Error('이 소재의 미리보기는 원래 앱 화면에서 열어줘.')
  const type = ref.source === 'audio' ? 'audio' : selected()?.kind === 'video' || target?.tagName === 'VIDEO' || target === 'video' ? 'video' : 'img'
  if (target === 'video') target = undefined
  const element = target ?? document.createElement(type)
  element.src = path
  if (type !== 'img') element.controls = true
  if (!target) { modal(title, '<div id="media-preview"></div>', { close: '닫기' }); $('media-preview').append(element) }
}
async function extractionDialog({ nodeId, takeId } = {}) {
  const node = s.project.nodes.find(node => node.id === nodeId), take = s.project.takes.find(take => take.id === takeId)
  if (take && !take.resultHash) throw new Error('결과 해시가 준비될 때까지 기다려줘.')
  if (node && (node.kind !== 'video' || node.data.ref.source !== 'library')) throw new Error('라이브러리 영상만 프레임을 뽑을 수 있어.')
  if (!node && !take) throw new Error('영상 노드나 준비된 take를 골라줘.')
  modal(`프레임 추출 · ${node?.data.name ?? take.label}`, `<video id="frame-player" controls></video><label>위치<select id="frame-position"><option value="first">첫 프레임</option><option value="middle">가운데</option><option value="last" selected>마지막 프레임</option><option value="current">현재 재생 위치</option><option value="seconds">시간(초)</option><option value="index">프레임 번호</option></select></label><p id="frame-current-note" class="warning" hidden>재생 위치는 한 프레임 어긋날 수 있어. 정확히 뽑으려면 프레임 번호를 골라줘.</p><label id="frame-seconds-field" hidden>시간(초)<input id="frame-seconds" type="number" step="any" min="0" value="0"></label><label id="frame-index-field" hidden>프레임 번호 (0부터)<input id="frame-index" type="number" min="0" value="0"></label><label>형식<select id="frame-format"><option>png</option><option>webp</option></select></label><label>연결할 곳<select id="frame-target"><option value="">연결 안 함</option>${cuts().filter(cut => cut.id !== take?.cutId).flatMap(cut => ['start', 'end', 'ref_image'].map(port => `<option value="${esc(`${cut.id}|${port}`)}">${esc(cut.data.name)} · ${ports[port]}</option>`)).join('')}</select></label><p id="extract-result" role="status"></p><div id="extract-job" class="toolbar" hidden><button id="extract-status">상태 갱신</button><button id="extract-cancel">작업 취소</button></div>`, { primary: '추출' })
  $('frame-position').onchange = () => {
    const position = $('frame-position').value
    $('frame-current-note').hidden = position !== 'current'
    $('frame-seconds-field').hidden = position !== 'seconds'
    $('frame-index-field').hidden = position !== 'index'
  }
  const ref = node?.data.ref ?? { source: 'library', compositeHash: take.resultHash }
  await preview(ref, $('frame-player'))
  let extraction
  const status = result => {
    extraction = result
    $('extract-result').textContent = result.error ?? [statusNames[result.status] ?? result.status, progressText(result.progress), result.nodeIds?.length ? `프레임 ${result.nodeIds.length}개` : '', result.rejected?.length ? `연결 실패: ${result.rejected.map(item => item.reason).join(', ')}` : ''].filter(Boolean).join(' · ')
    $('extract-result').className = result.error ? 'error' : ''
    $('extract-job').hidden = isTerminal(result.status)
    $('dialog-primary').disabled = true
    $('dialog-close').textContent = '닫기'
  }
  $('dialog-primary').onclick = () => void task(async () => {
    const position = $('frame-position').value, target = $('frame-target').value.split('|')
    const result = await request('extract_frame', { expected_revision: s.project.revision, node_id: nodeId, take_id: takeId, format: $('frame-format').value,
      ...(['first', 'middle', 'last'].includes(position) ? { position } : position === 'index' ? { frame_index: Number($('frame-index').value) } : { at_seconds: [position === 'current' ? $('frame-player').currentTime : Number($('frame-seconds').value)] }),
      ...(target[0] ? { target: { cut: target[0], port: target[1] } } : {}) })
    status(result)
    await reload()
    if (!isTerminal(result.status)) watchExtraction(result.id, status)
  })
  for (const cancel of [false, true]) $(cancel ? 'extract-cancel' : 'extract-status').onclick = () => void task(async () => {
    if (cancel) extractionWatches.get(extraction.id)?.abort()
    status(await request('extract_frame', { expected_revision: s.project.revision, extraction_id: extraction.id, cancel }))
    await reload()
  })
}
const isTerminal = status => ['completed', 'failed', 'cancelled'].includes(status)
function watchExtraction(id, update) {
  if (extractionWatches.has(id)) return
  const controller = new AbortController()
  extractionWatches.set(id, controller)
  void (async () => {
    try {
      while (!controller.signal.aborted) {
        const result = await request('extract_frame', { extraction_id: id, wait_seconds: 30 }, { signal: controller.signal })
        if (update && $('extract-result')) update(result)
        await reload()
        if (isTerminal(result.status)) break
      }
    } catch (error) { if (!controller.signal.aborted) notice(error.message, true) }
    finally { extractionWatches.delete(id) }
  })()
}
async function profileDialog() {
  const [workflows, servers] = await Promise.all([native('list_workflows', {}), native('list_comfyui_servers', {})])
  const rows = Array.isArray(workflows) ? workflows : workflows.workflows ?? []
  const serverRows = Array.isArray(servers) ? servers : servers.servers ?? []
  const tags = [...new Set(serverRows.flatMap(server => server.routing_tags ?? (server.routing_tags_json ? JSON.parse(server.routing_tags_json) : [])))]
  modal('생성 프로필', `<label>프로필<select id="profile-existing"><option value="">새 프로필</option>${s.project.profiles.map(profile => `<option value="${esc(profile.id)}">${esc(profile.label)}</option>`).join('')}</select></label><label>이름<input id="profile-label"></label><label>워크플로우<select id="profile-workflow"><option value="">골라줘</option>${rows.map(workflow => `<option value="${esc(workflow.id)}">${esc(workflow.name)}</option>`).join('')}</select></label><p id="profile-fields-missing" class="warning" hidden>워크플로우 편집에서 Director와 숫자 시드를 Marked Field로 열어줘.</p><label>Director 필드<select id="profile-director"></select></label><label>시드 필드<select id="profile-seed"></select></label><div class="two"><label>서버<select id="profile-server"><option value="">자동</option>${serverRows.map(server => `<option value="${esc(server.id)}">${esc(server.name)}</option>`).join('')}</select></label><label>서버 태그<select id="profile-tag"><option value="">없음</option>${tags.map(tag => `<option>${esc(tag)}</option>`).join('')}</select></label></div><label>Director overrides (JSON)<textarea id="profile-overrides" rows="5">{}</textarea></label>`, { primary: '저장' })
  // A saved server or tag missing from the current lists stays selectable so saving does not drop it.
  const choose = (select, value, label) => {
    if (value && ![...select.options].some(option => option.value === String(value))) select.add(new Option(label, value))
    select.value = value ?? ''
  }
  async function fields(profile) {
    const details = await native('get_workflow_details', { workflow_id: Number($('profile-workflow').value) })
    const options = filter => details.input_schema.filter(filter).map(field => `<option value="${esc(field.id)}">${esc(field.label || field.id)}</option>`).join('')
    $('profile-director').innerHTML = options(field => field.type === 'node' && field.node_editor === 'minimax_h3_director_dasiwa')
    $('profile-seed').innerHTML = options(field => field.type === 'number' && field.seed_rule)
    $('profile-fields-missing').hidden = Boolean($('profile-director').options.length && $('profile-seed').options.length)
    if (profile) { $('profile-director').value = profile.directorFieldId; $('profile-seed').value = profile.seedFieldId }
  }
  $('profile-workflow').onchange = () => void task(() => fields())
  $('profile-existing').onchange = () => void task(async () => {
    const profile = s.project.profiles.find(profile => profile.id === $('profile-existing').value)
    if (!profile) return
    $('profile-label').value = profile.label; $('profile-workflow').value = profile.workflowId
    choose($('profile-server'), profile.serverId, `서버 #${profile.serverId}`); choose($('profile-tag'), profile.serverTag, profile.serverTag)
    $('profile-overrides').value = JSON.stringify(profile.overrides ?? {}, null, 2)
    await fields(profile)
  })
  $('dialog-primary').onclick = () => void task(async () => {
    const profile = { label: $('profile-label').value, workflowId: Number($('profile-workflow').value), directorFieldId: $('profile-director').value, seedFieldId: $('profile-seed').value, overrides: JSON.parse($('profile-overrides').value),
      ...($('profile-existing').value ? { id: $('profile-existing').value } : {}), ...($('profile-server').value ? { serverId: Number($('profile-server').value) } : {}), ...($('profile-tag').value ? { serverTag: $('profile-tag').value } : {}) }
    await request('save_profile', { expected_revision: s.project.revision, profile })
    await reload(); $('modal').close()
  })
}
async function runCut(args = {}, op = 'run_cut') {
  const cut = args.cut_id ?? selected()?.id
  const take = await request(op, { cut_id: cut, ...args })
  await reload(); notice(`${statusNames[take.status] ?? take.status} · seed ${take.seed ?? '—'}`)
  return take
}
function lockRunButtons() {
  $('generate').disabled = s.runBusy
  for (const button of document.querySelectorAll('[data-action]')) if (['run', 'propose', 'approve', 'discard', 'retry', 'cancel', 'rerun-take', 'rerun-canvas', 'rerun-new'].includes(button.dataset.action)) button.disabled = s.runBusy
}
function launchRun(args = {}, op = 'run_cut') {
  if (s.runBusy) {
    if (args.origin === 'assistant') throw new Error('생성 요청을 처리 중이야. lastRun 상태를 먼저 읽어줘.')
    return Promise.resolve()
  }
  const captured = { cut_id: selected()?.id, requestId: crypto.randomUUID(), ...args }
  s.runBusy = true; lockRunButtons()
  const promise = task(async () => {
    const queued = { ...captured, expected_revision: captured.expected_revision ?? s.project.revision }
    if (op === 'run_cut' && queued.mode === 'propose') queued.input_digest = (await request('read_node', { id: queued.cut_id })).preview.inputDigest
    return runCut(queued, op)
  })
  const unlock = () => { s.runBusy = false; lockRunButtons() }
  promise.then(unlock, unlock)
  return promise
}
async function doCheck(args = {}) {
  s.checks = await request('check', { expected_revision: s.project.revision, ...args })
  s.tab = 'checks'; await reload(); return s.checks
}
async function reorder(edgeId, direction, targetId) {
  const edge = s.project.edges.find(edge => edge.id === edgeId)
  const peers = cutEdges(s.project, s.project.nodes.find(node => node.id === edge.to), false).filter(item => item.port === edge.port).map(item => item.id)
  const from = peers.indexOf(edgeId), to = targetId ? peers.indexOf(targetId) : from + direction
  if (to < 0 || to >= peers.length) return
  peers.splice(from, 1); peers.splice(to, 0, edgeId)
  await edit([{ op: 'reorder', cut: edge.to, port: edge.port, order: peers }])
}
function bind() {
  $('projects').onchange = event => void task(() => chooseProject(event.target.value))
  $('new-project').onclick = () => {
    modal('프로젝트 만들기', '<label>이름<input id="project-name"></label>', { primary: '만들기' })
    $('dialog-primary').onclick = () => void task(async () => { await createProject($('project-name').value); $('modal').close() })
    $('project-name').onkeydown = event => { if (event.key === 'Enter') $('dialog-primary').click() }
    $('project-name').focus()
  }
  // picker queues its own requests; running it inside task() would wait on itself while the host picker is open.
  document.querySelectorAll('[data-import]').forEach(button => { button.onclick = () => {
    if (!s.project) return notice('프로젝트부터 만들어줘.', true)
    picker(button.dataset.import).catch(error => notice(error.message, true))
  } })
  $('add-cut').onclick = () => void task(async () => { const result = await edit([{ op: 'add_node', kind: 'cut', name: '새 영상 컷', at: { x: (120 - s.x) / s.zoom, y: (80 - s.y) / s.zoom } }]); select(result.applied[0]?.id) })
  $('profiles').onclick = () => void task(profileDialog)
  $('check-all').onclick = () => void task(() => doCheck())
  $('generate').onclick = () => void launchRun()
  $('extract-selected').onclick = () => void task(() => extractionDialog({ nodeId: s.selection }))
  $('arrange').onclick = () => void task(() => edit(s.project.nodes.map((node, index) => ({ op: 'move', id: node.id, x: (index % 3) * 350 + 20, y: Math.floor(index / 3) * 380 + 20 }))))
  $('assistant-panel').onclick = () => { s.tab = 'assistant'; renderInspector() }
  $('launch').onclick = event => {
    const action = event.target.closest('[data-launch]')?.dataset.launch
    if (action === 'dismiss') void task(async () => { s.launch = null; render(); await api.navigation.open('/ext/video-canvas/canvas') })
    if (action === 'import') void task(() => { const [cut, port] = $('launch-target').value.split('|'); return edit([{ op: 'import_launch', ...(cut ? { target: { cut, port } } : {}) }]) })
  }
  document.querySelectorAll('[data-edges]').forEach(button => { button.onclick = () => {
    s.edges = button.dataset.edges
    document.querySelectorAll('[data-edges]').forEach(item => item.setAttribute('aria-pressed', String(item === button)))
    drawEdges()
  } })
  $('zoom-in').onclick = () => { s.zoom *= 1.2; transform(); drawEdges() }
  $('zoom-out').onclick = () => { s.zoom /= 1.2; transform(); drawEdges() }
  $('fit').onclick = () => {
    if (!s.project?.nodes.length) return
    const nodes = s.project.nodes, minX = Math.min(...nodes.map(node => node.x)), minY = Math.min(...nodes.map(node => node.y))
    const maxX = Math.max(...nodes.map(node => node.x + 300)), maxY = Math.max(...nodes.map(node => node.y + 380))
    s.zoom = Math.min($('canvas').clientWidth / (maxX - minX + 48), $('canvas').clientHeight / (maxY - minY + 48), 1)
    s.x = 24 - minX * s.zoom; s.y = 24 - minY * s.zoom; transform(); drawEdges()
  }
  let drag
  $('canvas').onpointerdown = event => {
    if (event.target.closest('button')) return
    const nodeEl = event.target.closest('.vc-node'), node = s.project?.nodes.find(node => node.id === nodeEl?.dataset.id)
    drag = { id: node?.id, x: event.clientX, y: event.clientY, ox: node?.x ?? s.x, oy: node?.y ?? s.y, moved: false }
    if (node) { s.selection = node.id; s.tab = 'input'; document.querySelectorAll('.vc-node').forEach(el => el.setAttribute('aria-selected', String(el === nodeEl))); renderInspector(); lockRunButtons(); publish(); void task(() => request('read_node', { id: node.id })) }
    $('canvas').setPointerCapture(event.pointerId)
  }
  $('canvas').onpointermove = event => {
    if (!drag) return
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true
    if (drag.id) {
      const el = document.querySelector(`[data-id="${CSS.escape(drag.id)}"]`)
      el.style.left = `${drag.ox + dx / s.zoom}px`; el.style.top = `${drag.oy + dy / s.zoom}px`; drawEdges()
    } else { s.x = drag.ox + dx; s.y = drag.oy + dy; transform() }
  }
  $('canvas').onpointerup = event => {
    if (!drag) return
    const previous = drag; drag = null
    if (previous.id && previous.moved) void task(() => edit([{ op: 'move', id: previous.id, x: previous.ox + (event.clientX - previous.x) / s.zoom, y: previous.oy + (event.clientY - previous.y) / s.zoom }]))
  }
  $('canvas').onkeydown = event => { const id = event.target.closest('.vc-node')?.dataset.id; if (id && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); select(id) } }
  let draggedSource, draggedOrder
  document.ondragstart = event => {
    const source = event.target.closest('.vc-output'), order = event.target.closest('[data-order]')
    draggedSource = source?.closest('[data-id]').dataset.id
    draggedOrder = order?.dataset.order
    event.dataTransfer.setData('text/plain', draggedSource ?? draggedOrder ?? '')
  }
  document.ondragover = event => { if (event.target.closest('.vc-slot,[data-order]')) event.preventDefault() }
  document.ondrop = event => {
    const slot = event.target.closest('.vc-slot'), order = event.target.closest('[data-order]')
    if (slot && draggedSource) { event.preventDefault(); void task(() => edit([{ op: 'connect', from: draggedSource, to: slot.closest('[data-id]').dataset.id, port: slot.dataset.port, position: Number(slot.dataset.position) }])) }
    if (order && draggedOrder && s.project.edges.find(edge => edge.id === draggedOrder)?.port === order.dataset.port) { event.preventDefault(); void task(() => reorder(draggedOrder, 0, order.dataset.order)) }
  }
  $('inspector').onchange = event => {
    const nodeId = s.selection
    void task(async () => {
    const target = event.target
    if (target.dataset.field) await edit([{ op: 'set', id: nodeId, fields: { [target.dataset.field]: ['seed', 'duration'].includes(target.dataset.field) ? Number(target.value) : target.value } }])
    if (target.dataset.prop) await edit([{ op: 'set', id: target.dataset.edge, fields: { props: { [target.dataset.prop]: ['description', 'media_mode'].includes(target.dataset.prop) ? target.value : Number(target.value) } } }])
    if (target.dataset.memo) {
      const item = s.project.nodes.find(node => node.id === target.dataset.memo) ?? s.project.takes.find(take => take.id === target.dataset.memo)
      await request('human_review', { expected_revision: s.project.revision, ops: [{ op: 'review', id: item.id, status: item.review, memo: target.value }] }); await reload()
    }
    })
  }
  $('inspector').onclick = event => {
    const target = event.target.closest('button')
    if (!target) return
    if (target.dataset.tab) { s.tab = target.dataset.tab; renderInspector(); return }
    if (target.dataset.token) {
      const field = document.querySelector('[data-field=prompt]')
      field.value += ` @${target.dataset.token} `; field.dispatchEvent(new Event('change', { bubbles: true })); return
    }
    const runAction = target.dataset.action, takeId = target.dataset.take
    if (['run', 'propose', 'approve', 'discard', 'retry', 'cancel', 'rerun-take', 'rerun-canvas', 'rerun-new'].includes(runAction)) {
      const take = s.project.takes.find(take => take.id === takeId)
      const args = runAction === 'run' || runAction === 'propose' ? { mode: runAction === 'propose' ? 'propose' : 'now' }
        : runAction.startsWith('rerun-') ? { cut_id: take.cutId, take_id: takeId, profile_id: selected()?.data.profileId ?? take.profile.id, inputs: runAction === 'rerun-take' ? 'take' : 'canvas', new_seed: runAction === 'rerun-new' }
          : { action: runAction, take_id: takeId, input_digest: take.inputDigest }
      void launchRun(args)
      return
    }
    void task(async () => {
      const action = target.dataset.action, takeId = target.dataset.take, node = selected()
      if (action === 'extraction-status' || action === 'extraction-cancel') { await request('extract_frame', { expected_revision: s.project.revision, extraction_id: target.dataset.extraction, cancel: action === 'extraction-cancel' }); return reload() }
      if (action === 'refresh-take') { await request('get_take', { take_id: takeId }); return reload() }
      if (action === 'extract' || action === 'extract-take') return extractionDialog({ nodeId: action === 'extract' ? node.id : undefined, takeId })
      if (action === 'preview-take') { const take = s.project.takes.find(take => take.id === takeId); return preview({ source: 'library', compositeHash: take.resultHash }, 'video', '생성 결과') }
      if (action === 'preview') return preview(node.data.ref, undefined, node.data.name)
      if (action === 'disconnect') return edit([{ op: 'disconnect', id: target.dataset.edge }])
      if (action === 'up' || action === 'down') return reorder(target.dataset.edge, action === 'up' ? -1 : 1)
      if (action === 'connect') return edit([{ op: 'connect', from: $('connect-from').value, to: node.id, port: $('connect-port').value }])
      if (action === 'seed') { const bytes = crypto.getRandomValues(new Uint32Array(1)); return edit([{ op: 'set', id: node.id, fields: { seed: bytes[0] & 2147483647 } }]) }
      if (action === 'review') {
        const item = s.project.nodes.find(node => node.id === target.dataset.item) ?? s.project.takes.find(take => take.id === target.dataset.item)
        await request('human_review', { expected_revision: s.project.revision, ops: [{ op: 'review', id: item.id, status: target.dataset.review, memo: item.memo }] }); return reload()
      }
      if (action === 'fingerprint') { await request('accept_fingerprint', { expected_revision: s.project.revision, id: target.dataset.item }); return doCheck() }
      if (action === 'keep') return notice('가져온 지문은 그대로 둘게. 변경 경고는 남아.')
      if (action === 'undo') { await request('undo', { expected_revision: s.project.revision }); return reload() }
      if (action === 'remove') {
        modal('이 노드를 지울까?', `<p>${esc(node.data.name)}와 연결선을 지워. 생성 이력은 남아.</p>`, { primary: '지우기', danger: true })
        $('dialog-primary').onclick = () => void task(async () => { await edit([{ op: 'remove', id: node.id }]); s.selection = null; $('modal').close(); render() })
      }
    })
  }
  $('modal').onclick = event => { if (event.target.closest('[data-close]')) $('modal').close() }
  $('modal').addEventListener('close', () => {
    for (const controller of extractionWatches.values()) controller.abort()
    $('modal').querySelectorAll('video,audio').forEach(media => { media.pause(); media.removeAttribute('src'); media.load() })
  })
  new ResizeObserver(drawEdges).observe($('canvas'))
}
const actions = {
  'video-canvas.read': args => {
    if (args.section) { assistant.page(args.section, args.cursor); publish(); return }
    return request('read_canvas', { ...args, origin: 'assistant' })
  },
  'video-canvas.read_node': args => request('read_node', { ...args, origin: 'assistant' }),
  'video-canvas.select': args => task(async () => { if (args.project_id) await chooseProject(args.project_id); if (args.id) await select(args.id); publish() }),
  'video-canvas.edit': args => task(async () => {
    if (args.create_name) { await createProject(args.create_name); return { id: s.project.id, revision: s.project.revision } }
    if (args.profile_json || args.undo) { const result = await request(args.undo ? 'undo' : 'save_profile', { origin: 'assistant', expected_revision: args.expected_revision, ...(args.profile_json ? { profile: JSON.parse(args.profile_json) } : {}) }); await reload(); return { revision: result.revision } }
    const ops = JSON.parse(args.ops)
    if (ops.some(op => op.op === 'remove')) throw new Error('삭제는 video-canvas.remove 검토 작업으로 요청해줘.')
    return edit(ops, args.expected_revision, 'assistant')
  }),
  'video-canvas.check': args => task(() => doCheck({ ...args, origin: 'assistant' })),
  'video-canvas.run_cut': args => launchRun({ ...args, origin: 'assistant' }),
  'video-canvas.propose_run_cut': args => launchRun({ ...args, origin: 'assistant' }, 'propose_run_cut'),
  'video-canvas.remove': args => task(() => edit([{ op: 'remove', id: args.id }], args.expected_revision, 'assistant')),
  'video-canvas.extract_frame': (args, context) => task(async () => {
    const result = await request('extract_frame', { ...args, origin: 'assistant' }, { signal: context?.signal })
    await reload()
    if (!args.cancel && !isTerminal(result.status)) watchExtraction(result.id)
  }),
}
api = await connectPlugin(actions)
if (api.supports('launch.image') && api.launch?.image) {
  s.launch = { compositeHash: api.launch.image.compositeHash, kind: 'image' }
  libraryName(s.launch.compositeHash).then(name => { launchName = name; renderLaunch() }, error => notice(error.message, true))
}
bind()
try { await loadProjects(); if (s.projects.length) await chooseProject(s.projects[0].id); else render() } catch (error) { notice(error.message, true) }
const refreshQueued = createRefreshQueue(() => task(async () => { if (s.project) { s.project = await request('refresh'); render() } }))
const refresh = event => {
  if (!s.project) return
  const jobId = event?.payload?.job_id
  if (jobId != null && !s.project.takes.some(take => take.jobId === jobId)) return
  void refreshQueued().catch(error => notice(error.message, true))
}
api.events.on('queue.job.status', refresh)
api.events.on('history.record.status', refresh)
api.events.on('resync', refresh)
