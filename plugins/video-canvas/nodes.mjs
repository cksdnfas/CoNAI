import { MODES, PORTS, activePorts, cutEdges, adapterOf, continuationPort } from './domain.mjs'
import { $, esc, names, ports, outputNames, reviewNames, assetStates, thumbUrl, fileUrl, audioUrl, patch, icon } from './util.mjs'
import { s, ctx, nodeById, takesOf, profileOf, repTake, shownTake, cutOrder, prevCut, cutState, finishing, failedTake, frameRole, frameLabel, outputKind, takeOutput, genInputs, staleWarning, continuationOf } from './state.mjs'
import { inkHtml, inkAll } from './ink.mjs'
// The one control that names and changes a node's setting: its label is the setting's name, its menu the registered settings.
const settingButton = (profile, tip) => `<button class="vc-workflow sm" data-action="pick-setting" aria-haspopup="menu" title="${profile ? `${esc(profile.label)} · 설정 바꾸기` : tip}">${profile ? esc(profile.label) : '설정 고르기'}</button>`

const els = new Map()
export const nodeEl = id => els.get(id)

export function slotRows(cut) {
  // A generation node offers one image slot per mapped image field of its profile: the connected ones, then the next free one.
  if (cut.kind === 'gen') {
    const { edges, fields } = genInputs(cut), rows = edges.map(edge => ({ edge, port: 'image', active: true, position: edge.position }))
    if (edges.length < fields.length) rows.push({ edge: null, port: 'image', active: true, position: edges.length })
    return rows
  }
  const edges = cutEdges(s.project, cut, false), rows = []
  // A cut that follows another and is not continued yet offers its continuation slot (the start slot, a reference image in REF2VA),
  // so continuing from the cut before it is one click away.
  const offer = prevCut(cut) && !continuationOf(cut) ? continuationPort(cut.data.mode) : null
  for (const port of Object.keys(PORTS)) {
    const active = activePorts(cut.data.mode).includes(port), peers = edges.filter(edge => edge.port === port)
    peers.forEach(edge => rows.push({ edge, port, active, position: edge.position }))
    if (active && (!['start', 'end'].includes(port) || !peers.length)) rows.push({ edge: null, port, active, position: peers.length, ghost: offer === port })
    else if (port === 'start' && offer === 'start' && !peers.length) rows.push({ edge: null, port, active, position: 0, ghost: true })
  }
  return rows
}
const WAITING = ['queued', 'pending', 'preparing', 'submitting', 'starting']
const player = hash => `<div class="conai-media vc-player" data-hash="${esc(hash)}" data-paused><video preload="none" playsinline poster="${thumbUrl(hash)}" src="${fileUrl(hash)}"></video><button class="conai-icon-button overlay vc-playkey" data-media="play" aria-label="재생" title="재생">${icon('play')}</button><div class="vc-player-bar"><button class="conai-icon-button sm overlay" data-media="play" aria-label="재생" title="재생">${icon('play', 14)}</button><input class="vc-seek" type="range" min="0" max="1000" value="0" data-media="seek" aria-label="재생 위치"><button class="conai-icon-button sm overlay" data-media="mute" aria-pressed="false" aria-label="소리 끄기" title="소리 끄기">${icon('volume', 14)}</button><button class="conai-icon-button sm overlay" data-media="loop" aria-pressed="false" aria-label="반복" title="반복">${icon('repeat', 14)}</button></div></div>`
const holder = (text, cls = '') => `<div class="vc-empty ${cls}">${esc(text)}</div>`

// A generation node's result is a picture, a clip or a sound (a sound's result is an audio candidate, not a library hash).
const resultMedia = take => ({
  image: `<div class="conai-media vc-fill" data-hash="${esc(take.resultHash)}"><img loading="lazy" alt="" src="${thumbUrl(take.resultHash)}"></div>`,
  audio: `<div class="vc-audio"><audio controls preload="none" src="${audioUrl(take.resultHash)}"></audio></div>`,
})[takeOutput(take)] ?? player(take.resultHash)
// ---- cut and generation card: head, result (always 16:9, so the card and its ports keep their size), settings, slots, prompt, one action row ----
function resultHtml(cut, state) {
  const take = shownTake(cut), running = ['queued', 'generating', 'current'].includes(state.key)
  const bar = running ? `<i class="vc-pbar${state.ratio === null ? ' indeterminate' : ''}" ${state.ratio === null ? '' : `style="width:${Math.round(state.ratio * 100)}%"`}></i>` : ''
  if (take?.resultHash) return resultMedia(take) + bar
  const text = state.step?.status === 'extracting' && state.key === 'current' ? '프레임 뽑는 중…'
    : state.key === 'current' && !state.take ? '만드는 중…'
      : state.key === 'waiting' ? '이어 생성 차례를 기다리는 중'
        : take ? takeText(take) : '아직 결과 없어'
  return holder(text, take && failedTake(take) ? 'error' : '') + bar
}
// What the media says for a take that has no result to play.
const takeText = take => failedTake(take) ? (take.upscaleOf ? '업스케일이 실패했어' : '생성이 실패했어') : take.status === 'proposed' ? '승인을 기다리는 제안이야' : take.status === 'cancelled' ? '취소됐어'
  : finishing(take) ? '마무리 중…' : WAITING.includes(take.status) ? '대기 중…' : take.upscaleOf ? '업스케일 중…' : '만드는 중…'
// The 업스케일 mark of an upscale take, the take pill (‹ 2/3 ›) and the 대표 star sit on the result's top right.
function toolsHtml(cut) {
  const takes = takesOf(cut.id).filter(take => take.status !== 'discarded'), take = shownTake(cut)
  if (!take) return ''
  const mark = take.upscaleOf ? '<span class="conai-overlay-badge xs">업스케일</span>' : ''
  const index = takes.indexOf(take), pill = takes.length < 2 ? ''
    : `<span class="vc-pill"><button class="conai-icon-button sm overlay" data-action="take-prev" aria-label="이전 take" title="이전 take" ${index <= 0 ? 'disabled' : ''}>${icon('left', 14)}</button><span class="vc-take-pos">${index + 1}/${takes.length}</span><button class="conai-icon-button sm overlay" data-action="take-next" aria-label="다음 take" title="다음 take" ${index >= takes.length - 1 ? 'disabled' : ''}>${icon('right', 14)}</button></span>`
  const star = take.resultHash ? `<button class="conai-icon-button sm overlay vc-star" data-action="take-pick" data-take="${esc(take.id)}" aria-pressed="${repTake(cut)?.id === take.id}" aria-label="대표 take" title="대표 take">${icon('star', 14)}</button>` : ''
  return mark + pill + star
}
const reviewHtml = node => node.review === 'pending' ? '' : `<span class="conai-overlay-badge tl ${node.review === 'pass' ? 'ok' : 'warn'}">${esc(reviewNames[node.review])}</span>`
// An asset that is not in order says so on the media; a healthy one shows nothing.
const checkHtml = node => { const check = node.data.check; return check && check.status !== 'ready' ? `<span class="conai-overlay-badge tr ${assetStates[check.status]?.[1] ?? 'warn'}">${esc(assetStates[check.status]?.[0] ?? check.status)}</span>` : '' }
// A cut or generation node whose result was made from a connected generation node's older result: the server's own message is the tooltip.
const staleHtml = node => { const warning = staleWarning(node); return warning ? `<span class="conai-overlay-badge bl warn" title="${esc(warning.message)}">예전 생성물</span>` : '' }
const moreButton = `<button class="conai-icon-button sm" data-action="node-menu" aria-label="메뉴" title="메뉴">${icon('more')}</button>`
const cutHead = (cut, state) => `<span class="badge vc-num">${cutOrder().indexOf(cut.id) + 1}</span><input class="vc-name" data-field="name" value="${esc(cut.data.name)}" aria-label="이름"><span class="vc-state">${esc(state.word)}</span>${moreButton}`
function reasonHtml(state) {
  if (state.key !== 'failed') return ''
  const text = state.take?.error ?? (state.take?.upscaleOf ? '업스케일이 실패했어.' : '생성이 실패했어.')
  return `<p class="vc-error" title="${esc(text)}">${esc(text)}</p>`
}
/**
 * What a cut or generation node can do now, its main action first: [{ action, label, take?, primary?, disabled? }]. The card shows them all
 * as buttons; the detail panel shows the first as its one text button and puts the rest in its menu.
 */
export function cutActions(cut, state) {
  const take = state.take
  // A cut whose shown take has a result can be upscaled while nothing runs on it (an upscale take upscales the take it came from).
  const shown = cut.kind === 'cut' ? shownTake(cut) : null, upscale = shown?.resultHash ? [{ action: 'upscale', label: '업스케일', take: shown.id }] : []
  if (state.key === 'empty') return [{ action: 'run', label: '생성', primary: true }]
  if (state.key === 'done') return [{ action: 'run', label: '다시 생성' }, ...upscale]
  // A finished job has nothing left to cancel while its result is being finished.
  if (state.key === 'queued' || state.key === 'generating') return [take?.jobId && !finishing(take) ? { action: 'cancel', label: '취소', take: take.id } : { label: '취소', disabled: true }]
  if (state.key === 'current') return [{ action: 'chain-cancel', label: '취소' }]
  // A failed upscale runs again as an upscale: a retry only while its request was made and no job was (a failure while preparing has no request
  // for the server to resend), else a new take on its source. 다시 생성 stays a plain run of the cut.
  if (state.key === 'failed' && take.upscaleOf) return [{ action: take.request && !take.jobId ? 'retry' : 'upscale-again', label: '다시 업스케일', take: take.id, primary: true }, { action: 'run', label: '다시 생성' }]
  if (state.key === 'failed') return [{ action: take.jobId ? 'rerun-canvas' : 'retry', label: '다시 생성', take: take.id, primary: true }, ...upscale]
  if (state.key === 'proposed' && cut.kind === 'cut') return [{ action: 'approve', label: '승인하고 생성', take: take.id, primary: true }, { action: 'discard', label: '폐기', take: take.id }]
  return [{ label: repTake(cut) ? '다시 생성' : '생성', disabled: true }]
}
export const actionButton = item => `<button${item.primary ? ' class="primary"' : ''}${item.action ? ` data-action="${item.action}"` : ''}${item.take ? ` data-take="${esc(item.take)}"` : ''}${item.disabled ? ' disabled' : ''}>${esc(item.label)}</button>`
const actionsHtml = (cut, state) => cutActions(cut, state).map(actionButton).join('')
function slotsHtml(cut) {
  return `<div class="vc-slots">${slotRows(cut).map(row => {
    const source = nodeById(row.edge?.from), ghost = !row.edge && row.ghost
    const text = source ? (source.kind === 'frame' && frameRole(source) === 'link' ? frameLabel(source) : source.data.name) : ''
    return `<div class="vc-slot ${row.active ? '' : 'unused'}${ghost ? ' ghost-row' : ''}" data-edge="${esc(row.edge?.id ?? '')}" data-port="${row.port}" data-position="${row.position}"><button class="vc-input" aria-label="${ports[row.port]}에 연결"></button><span class="vc-slot-port">${ports[row.port]} ${['start', 'end'].includes(row.port) ? '' : row.position + 1}</span>${row.edge ? `<span class="vc-slot-src" title="${esc(text)}">${esc(text)}</span><button class="conai-icon-button sm vc-unlink" data-action="disconnect" data-edge="${esc(row.edge.id)}" aria-label="연결 해제" title="연결 해제">${icon('x', 14)}</button>` : ghost ? '<button class="ghost sm vc-ghost" data-action="continue-prev">앞 컷에서 잇기</button>' : '<span class="vc-slot-src muted">비어 있음</span>'}</div>`
  }).join('')}</div>`
}
function formHtml(node) {
  const profile = profileOf(node)
  return `<div class="vc-settings">${settingButton(profile, '컷 설정 고르기')}
    <select data-field="mode" aria-label="모드" title="모드">${MODES.map(mode => `<option ${mode === node.data.mode ? 'selected' : ''}>${mode}</option>`).join('')}</select>
    <input class="vc-duration" type="number" data-field="duration" min="1" step="any" value="${esc(node.data.duration)}" aria-label="길이(초)" title="길이(초)"></div>
    ${slotsHtml(node)}
    ${inkHtml(node, `<textarea data-field="prompt" rows="2" placeholder="프롬프트 (@이름으로 연결한 소재를 불러)" aria-label="프롬프트">${esc(node.data.prompt)}</textarea>`)}`
}
const genHead = (node, state) => { const kind = outputKind(node); return `<span class="badge vc-out" data-output="${esc(kind ?? '')}">${esc(kind ? outputNames[kind] : '생성 설정 필요')}</span><input class="vc-name" data-field="name" value="${esc(node.data.name)}" aria-label="이름"><span class="vc-state">${esc(state.word)}</span>${moreButton}` }
function genFormHtml(node) {
  const profile = profileOf(node), nai = profile && adapterOf(profile) === 'nai', sizes = profile?.nai?.sizes ?? []
  const size = node.data.size ?? sizes[0]?.label
  // A workflow without a prompt field takes no prompt; NovelAI always does.
  const prompted = nai || Boolean(profile?.promptFieldId)
  return `<div class="vc-settings gen${nai ? ' sized' : ''}">${settingButton(profile, '생성 설정 고르기')}${nai ? `<select data-field="size" aria-label="크기" title="크기">${sizes.map(entry => `<option ${entry.label === size ? 'selected' : ''}>${esc(entry.label)}</option>`).join('')}${size && !sizes.some(entry => entry.label === size) ? `<option selected>${esc(size)}</option>` : ''}</select>` : ''}</div>
    ${slotsHtml(node)}
    ${prompted ? `<textarea data-field="prompt" rows="2" placeholder="프롬프트" aria-label="프롬프트">${esc(node.data.prompt)}</textarea>` : ''}`
}
// ---- source card: flush media, one caption row ----
function sourceMedia(node) {
  const ref = node.data.ref
  if (node.kind === 'bundle') {
    const members = node.data.check?.members ?? node.data.members ?? []
    return `<div class="conai-chips vc-members">${['image', 'video', 'audio'].map(kind => [kind, members.filter(member => member.kind === kind).length]).filter(([, count]) => count).map(([kind, count]) => `<span class="badge">${esc(names[kind])} ${count}</span>`).join('') || '<span class="badge">비어 있음</span>'}</div>`
  }
  if (ref?.source === 'library' && node.kind === 'audio') return `<audio controls preload="none" src="${fileUrl(ref.compositeHash)}"></audio>`
  if (ref?.source === 'library') return node.kind === 'video' ? player(ref.compositeHash) : `<div class="conai-media vc-thumb" data-hash="${esc(ref.compositeHash)}"><img loading="lazy" alt="" src="${thumbUrl(ref.compositeHash)}"></div>`
  if (node.kind === 'audio' && ref?.source === 'audio') return `<audio controls preload="none" src="${audioUrl(ref.candidateId)}"></audio>`
  return ''
}
function captionHtml(node) {
  const open = node.kind === 'frame' && s.open.includes(node.id)
  return `<span class="vc-dot"></span>${open ? `<small class="muted">프레임</small><span class="vc-cap-text" title="${esc(frameLabel(node))}">${esc(frameLabel(node))}</span><button class="ghost sm" data-action="fold-frame">접기</button>` : `<input class="vc-name" data-field="name" value="${esc(node.data.name)}" aria-label="이름">`}${moreButton}`
}
function create(node) {
  const el = document.createElement('article')
  el.className = 'vc-node'; el.dataset.id = node.id; el.dataset.kind = node.kind; el.tabIndex = 0
  const output = `<button class="vc-output" aria-label="${node.kind === 'cut' ? '이 컷의 결과 연결' : node.kind === 'gen' ? '이 생성 노드의 결과 연결' : '이 소재 연결'}" ${node.kind === 'cut' ? 'title="결과를 끌어서 다른 컷에 연결 (참조 영상 · 시작/끝 프레임 · 참조 이미지)"' : node.kind === 'gen' ? 'title="결과를 끌어서 맞는 슬롯에 연결 (이미지: 시작/끝 프레임 · 참조 이미지 · 입력 이미지, 영상: 참조 영상, 오디오: 참조 오디오)"' : ''}></button>`
  el.innerHTML = node.kind === 'cut' || node.kind === 'gen'
    ? `<div class="vc-head" data-r="head"></div><div class="vc-mw"><div class="vc-media vc-result" data-r="media"></div><div class="vc-tools" data-r="tools"></div><div data-r="badge"></div>${output}</div><div class="vc-body"><div data-r="status"></div><div data-r="form"></div><div class="vc-actions" data-r="actions"></div></div>`
    : `<div class="vc-mw"><div class="vc-media" data-r="media"></div><div data-r="badge"></div>${output}</div><div class="vc-cap" data-r="head"></div>`
  $('nodes').append(el)
  els.set(node.id, el)
  return el
}
/** Patches only the nodes whose content changed; an unchanged player keeps playing and a focused field keeps its text.
 *  A frame folded into a link or parked in the tray has no card. */
export function renderNodes() {
  const host = $('nodes'), project = s.project
  if (host.dataset.project !== (project?.id ?? '')) { host.replaceChildren(); els.clear(); host.dataset.project = project?.id ?? '' }
  const live = new Set(), region = (el, name) => el.querySelector(`[data-r=${name}]`)
  for (const node of project?.nodes ?? []) {
    if (frameRole(node) !== 'card') continue
    live.add(node.id)
    // A cut and a generation node share the card: result with takes, form, one action row.
    const el = els.get(node.id) ?? create(node), cut = node.kind === 'cut', run = cut || node.kind === 'gen', state = run ? cutState(node) : null
    el.style.left = `${node.x}px`; el.style.top = `${node.y}px`
    el.setAttribute('aria-label', node.data.name)
    el.dataset.state = state?.key ?? ''
    if (run) el.classList.toggle('has-result', Boolean(repTake(node)))
    if (run) el.dataset.output = outputKind(node) ?? ''
    patch(region(el, 'head'), cut ? cutHead(node, state) : run ? genHead(node, state) : captionHtml(node))
    patch(region(el, 'media'), run ? resultHtml(node, state) : sourceMedia(node))
    patch(region(el, 'badge'), reviewHtml(node) + checkHtml(node) + (run ? staleHtml(node) : ''))
    const media = region(el, 'media'), shown = run ? shownTake(node) : null
    if (shown) media.dataset.take = shown.id; else delete media.dataset.take
    if (run) {
      patch(region(el, 'tools'), toolsHtml(node))
      patch(region(el, 'status'), reasonHtml(state))
      // The prompt being typed must not share a patched region with the action row, which changes with every progress event.
      patch(region(el, 'form'), cut ? formHtml(node) : genFormHtml(node))
      if (cut) inkAll(region(el, 'form'))
      patch(region(el, 'actions'), actionsHtml(node, state))
    }
  }
  for (const [id, el] of els) if (!live.has(id)) { el.remove(); els.delete(id) }
  markSelection()
}
export function markSelection() {
  for (const [id, el] of els) el.setAttribute('aria-selected', String(s.sel.includes(id)))
  ctx.hooks.markSeqSelection?.()
}
// ---- inline players ----
function sync(video) {
  const box = video.closest('.vc-player')
  if (!box) return
  const seek = box.querySelector('[data-media=seek]'), mute = box.querySelector('[data-media=mute]')
  box.toggleAttribute('data-paused', video.paused)
  for (const play of box.querySelectorAll('[data-media=play]')) { play.innerHTML = icon(video.paused ? 'play' : 'pause', play.classList.contains('vc-playkey') ? 16 : 14); play.setAttribute('aria-label', video.paused ? '재생' : '일시정지') }
  mute.setAttribute('aria-pressed', String(video.muted)); mute.innerHTML = icon(video.muted ? 'mute' : 'volume', 14)
  if (video.duration && document.activeElement !== seek) seek.value = String(Math.round(video.currentTime / video.duration * 1000))
}
export function bindNodes() {
  const host = $('nodes')
  host.addEventListener('click', event => {
    const control = event.target.closest('[data-media]')
    if (!control || control.type === 'range') return
    const video = control.closest('.vc-player').querySelector('video')
    const kind = control.dataset.media
    if (kind === 'play') { if (video.paused) void video.play?.(); else video.pause() }
    if (kind === 'mute') video.muted = !video.muted
    if (kind === 'loop') { video.loop = !video.loop; control.setAttribute('aria-pressed', String(video.loop)) }
    sync(video)
  })
  // A focused prompt grows, so the node's height (and where its connections attach) changes.
  for (const type of ['focusin', 'focusout']) host.addEventListener(type, event => { if (event.target.tagName === 'TEXTAREA') requestAnimationFrame(() => ctx.hooks.layoutChanged?.()) })
  host.addEventListener('input', event => {
    if (event.target.dataset?.media !== 'seek') return
    const video = event.target.closest('.vc-player').querySelector('video')
    if (video.duration) video.currentTime = Number(event.target.value) / 1000 * video.duration
  })
  for (const type of ['play', 'pause', 'timeupdate', 'volumechange', 'loadedmetadata', 'ended']) host.addEventListener(type, event => {
    if (event.target.tagName !== 'VIDEO') return
    // One clip plays at a time on the canvas.
    if (type === 'play') host.querySelectorAll('video').forEach(other => { if (other !== event.target) other.pause() })
    sync(event.target)
  }, true)
}
