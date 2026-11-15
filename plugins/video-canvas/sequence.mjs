import { $, esc, clamp, statusNames, isTerminal, fileUrl, thumbUrl, progressText, fraction, patch, icon } from './util.mjs'
import { s, ctx, nodeById, repTake, cutOrder, profileOf, activeChain, stepOf, cutState, finishing, allLinks, DOCK_H } from './state.mjs'
import { toast } from './toast.mjs'
import { showMenu } from './menu.mjs'
import { request, ui, edit, reload, reloadQueued, saveView } from './session.mjs'
import { confirmDialog } from './dialogs.mjs'
import { continueFromPrevious, repull, removeEdge } from './actions.mjs'

const secs = value => `${Number(Number(value).toFixed(2))}초`
// ---- lengths: real clip lengths come from the loaded video metadata; the cut's nominal duration only stands in until a result is known ----
const durations = new Map(), probing = new Set()
function probe(hash) {
  if (durations.has(hash) || probing.has(hash)) return
  probing.add(hash)
  const video = document.createElement('video'), done = () => { video.removeAttribute('src'); video.load?.() }
  video.preload = 'metadata'
  video.onloadedmetadata = () => { if (Number.isFinite(video.duration) && !durations.has(hash)) { durations.set(hash, video.duration); renderSequence() } done() }
  video.onerror = done
  video.src = fileUrl(hash)
}
const nominal = cut => Number(cut.data.duration) || 0
/** Length of the cut's representing clip; `real` is false while only the nominal value is known. */
function lengthOf(cut) {
  const take = repTake(cut), real = take ? durations.get(take.resultHash) : undefined
  return real === undefined ? { value: nominal(cut), real: false } : { value: real, real: true }
}
// ---- dock size: 212px by default, never below 154px nor above the workspace minus 240px; collapsed it is the head only ----
const MIN_H = 154
const maxHeight = () => { const height = $('workspace').clientHeight; return height ? Math.max(MIN_H, height - 240) : Infinity }
const dockHeight = height => clamp(Math.round(height), MIN_H, maxHeight())
/** Shows the chosen height, clamped to what the workspace allows now; the chosen height itself stays as it is. */
function showDockHeight() {
  $('sequence').style.setProperty('--vc-dock-h', `${dockHeight(s.seqH)}px`)
  ctx.hooks.layoutChanged?.()
}
/** Sets (and with `persist` remembers) the dock height; every change goes through the layout-changed path. */
export function setDockHeight(height, persist = true) {
  s.seqH = dockHeight(height)
  showDockHeight()
  if (persist) { ctx.view.seqH = s.seqH; saveView() }
}
// ---- the one state vocabulary on a card (the canvas card says the same words) ----
function cardState(cut) {
  const state = cutState(cut), percent = state.ratio === null ? '' : ` ${Math.round(state.ratio * 100)}%`
  if (state.step?.status === 'skipped') return ['건너뜀', '']
  if (state.key === 'waiting' || state.key === 'queued') return ['대기', '']
  const working = state.take && finishing(state.take) ? '마무리 중' : `생성 중${percent}`
  if (state.key === 'current') return state.step.status === 'extracting' ? ['프레임 뽑는 중', ''] : [working, 'warn']
  if (state.key === 'generating') return [working, 'warn']
  if (state.key === 'proposed') return ['승인 대기', 'warn']
  if (state.key === 'failed') return ['실패', 'destructive']
  return null
}
const stepNames = { pending: '대기', skipped: '건너뜀', extracting: '프레임 뽑는 중', generating: '생성 중', completed: '완료', failed: '실패', cancelled: '취소됨' }
// ---- strip: one row of cards, a joint between neighbours, the last export in its own column at the right ----
const sameList = (a, b) => a.length === b.length && a.every((id, index) => id === b[index])
function jointHtml(cut, link) {
  return link
    ? `<button class="vc-seq-join chained" data-join="${esc(cut.id)}" data-edge="${esc(link.edge.id)}" title="${link.stale ? '앞 컷에서 이어진 프레임 · 앞 컷이 다시 만들어졌어' : '앞 컷에서 이어진 프레임'}" aria-label="앞 컷에서 이어진 프레임" aria-haspopup="menu">${icon('link', 12)}</button>`
    : `<button class="vc-seq-join" data-join="${esc(cut.id)}" title="앞 컷에서 잇기" aria-label="앞 컷에서 잇기">${icon('plus', 12)}</button>`
}
function itemHtml(cut, index, order, links, length) {
  const take = repTake(cut), badge = cardState(cut), step = stepOf(cut), chain = activeChain()
  const before = order[index - 1]?.id, back = links.find(link => link.target.id === cut.id && link.edge.port === 'start' && link.source.id !== before)
  const lengthTitle = step?.error ?? (length.real ? '실제 길이' : '예상 길이(결과가 아직 없어)')
  return `<button class="conai-media-card vc-seq-item" draggable="true" data-seq="${esc(cut.id)}" ${chain?.current === cut.id ? 'data-current' : ''} title="${esc(`${cut.data.name}${step?.error ? ` · ${step.error}` : ''}`)}" aria-label="${esc(cut.data.name)}"><span class="conai-media">${take ? `<img src="${thumbUrl(take.resultHash)}" alt="" loading="lazy">` : '<span class="vc-seq-none">생성 전</span>'}<span class="conai-overlay-badge tl">${index + 1}</span><span class="conai-overlay-badge xs tr" title="${esc(lengthTitle)}">${length.real ? '' : '~'}${secs(length.value)}</span>${badge ? `<span class="conai-overlay-badge br ${badge[1]}">${esc(badge[0])}</span>` : ''}${back ? `<span class="conai-overlay-badge xs bl" title="시작 프레임: ${esc(back.source.data.name)}">↩ ${order.findIndex(item => item.id === back.source.id) + 1}</span>` : ''}<i class="vc-seq-progress"></i></span></button>`
}
function exportHtml(order, chain) {
  const item = (s.project?.exports ?? []).at(-1)
  if (!item) return ''
  const ready = order.map(repTake).filter(Boolean).map(take => take.id), stale = Boolean(chain) || !sameList(item.takeIds ?? [], ready)
  if (item.resultHash) probe(item.resultHash)
  const length = durations.get(item.resultHash) ?? (Number(item.duration) || 0)
  if (!isTerminal(item.status)) {
    const value = fraction(item.progress), text = `합본 만드는 중${value === null ? '' : ` ${Math.round(value * 100)}%`}`
    return `<div class="vc-seq-export" data-export-card><span class="conai-media vc-export-media"><span class="vc-export-text" title="${esc(statusNames[item.status] ?? item.status)} ${esc(progressText(item.progress))}">${esc(text)}</span><button class="sm vc-export-cancel" data-action="export-cancel" data-export="${esc(item.id)}">취소</button><i class="vc-seq-progress" style="width:${Math.round((value ?? 0) * 100)}%"></i></span></div>`
  }
  if (item.status === 'completed' && item.resultHash) {
    return `<div class="vc-seq-export" data-export-card ${stale ? 'data-stale' : ''}><button class="conai-media-card" data-action="export-play" data-export="${esc(item.id)}" title="여기서 재생" aria-label="합본 재생"><span class="conai-media vc-export-media"><img src="${thumbUrl(item.resultHash)}" alt="" loading="lazy"><span class="conai-overlay-badge xs tl">${stale ? '이전 합본' : '합본'}${length ? ` · ${secs(length)}` : ''}</span></span></button><button class="conai-icon-button sm overlay vc-export-open" data-action="open-detail" data-hash="${esc(item.resultHash)}" aria-label="상세에서 열기" title="상세에서 열기">${icon('maximize', 14)}</button></div>`
  }
  return `<div class="vc-seq-export" data-export-card ${stale ? 'data-stale' : ''}><span class="conai-media vc-export-media"><span class="vc-export-text error" title="${esc(item.error ?? '')}">${esc(statusNames[item.status] ?? item.status)}${item.error ? ` · ${esc(item.error)}` : ''}</span><span class="conai-overlay-badge xs tl">${stale ? '이전 합본' : '합본'}</span></span></div>`
}
const scrubHtml = (order, lengths) => order.map((cut, index) => `<button class="vc-scrub-seg" data-scrub="${esc(cut.id)}" style="flex-grow:${lengths[index].value || 1}" title="${esc(cut.data.name)}" ${repTake(cut) ? '' : 'disabled'}><i></i></button>`).join('')
// The running chain takes the place of the 이어 생성 button: finished steps out of all, the cut being worked on and its step, cancel.
function chainHtml(chain) {
  if (!chain) return ''
  const done = chain.steps.filter(step => ['completed', 'skipped'].includes(step.status)).length, cut = nodeById(chain.current)?.data.name
  const step = chain.steps.find(item => item.cutId === chain.current), where = cut ? ` · ${cut}${step ? ` ${stepNames[step.status] ?? step.status}` : ''}` : ''
  const label = `이어 생성 ${done}/${chain.steps.length}${chain.cancelRequested ? ' · 취소 중' : ''}${where}`
  return `<span class="vc-chain-label" title="${esc(label)}">${esc(label)}</span><button class="sm" data-chain-cancel="${esc(chain.id)}" ${chain.cancelRequested ? 'disabled' : ''}>취소</button>`
}
let followedGen = null
export function renderSequence() {
  const order = cutOrder().map(nodeById), chain = activeChain(), collapsed = !s.seqOpen || !order.length
  const dock = $('sequence')
  dock.classList.toggle('collapsed', collapsed)
  dock.style.setProperty('--vc-dock-h', `${dockHeight(s.seqH)}px`)
  patch($('seq-collapse'), icon(collapsed ? 'up' : 'down'))
  $('seq-collapse').setAttribute('aria-expanded', String(!collapsed))
  for (const cut of order) { const take = repTake(cut); if (take) probe(take.resultHash) }
  const lengths = order.map(lengthOf), links = allLinks(true)
  $('seq-total').textContent = order.length ? `${order.length}컷 · ${lengths.every(length => length.real) ? '' : '~'}${secs(lengths.reduce((sum, length) => sum + length.value, 0))}` : ''
  patch($('seq-scrub'), scrubHtml(order, lengths))
  patch($('seq-list'), order.map((cut, index) => (index ? jointHtml(cut, links.find(link => link.target.id === cut.id && ['start', 'end'].includes(link.edge.port) && link.source.id === order[index - 1].id)) : '') + itemHtml(cut, index, order, links, lengths[index])).join(''))
  patch($('seq-export'), exportHtml(order, chain))
  patch($('seq-chain-state'), chainHtml(chain))
  $('seq-chain-state').hidden = !chain
  $('seq-chain').hidden = Boolean(chain)
  patch($('seq-chain'), `이어 생성${order.some(repTake) ? icon('down', 14) : ''}`)
  lockExport(); lockChain()
  markPlayhead(); markSeqSelection()
  // The card being generated scrolls into view once, so a long strip shows what is happening.
  const busy = order.find(cut => ['generating', 'current'].includes(cutState(cut).key)), key = busy && `${busy.id}:${cutState(busy).take?.id ?? chain?.id}`
  if (key && key !== followedGen) $('seq-list').querySelector(`[data-seq="${CSS.escape(busy.id)}"]`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  followedGen = key ?? null
}
/** The ring on a card means "selected on the canvas", both ways. */
export function markSeqSelection() {
  for (const item of $('seq-list').querySelectorAll('[data-seq]')) item.setAttribute('aria-selected', String(s.sel.includes(item.dataset.seq)))
}
let exportStarting = false
const exportRunning = () => (s.project?.exports ?? []).some(item => !isTerminal(item.status))
/** The export control stays locked while a start request, a running export or a running chain exists; a join needs at least two cuts. */
function lockExport() {
  const button = $('seq-export-btn'), order = cutOrder(), chain = activeChain()
  button.disabled = exportStarting || exportRunning() || Boolean(chain) || order.length < 2
  button.title = order.length < 2 ? '합본은 컷이 2개 이상 있어야 만들 수 있어.' : chain ? '이어 생성이 끝나면 만들 수 있어.' : exportRunning() ? '내보내기가 진행 중이야.' : ''
}
// ---- reorder (drag in the strip) ----
let dragged = null
function bindStrip() {
  const list = $('seq-list')
  list.addEventListener('dragstart', event => { dragged = event.target.closest('[data-seq]')?.dataset.seq; event.dataTransfer?.setData('text/plain', dragged ?? '') })
  list.addEventListener('dragover', event => { if (dragged && event.target.closest('[data-seq]')) { event.preventDefault(); markDrop(event) } })
  list.addEventListener('dragend', () => { dragged = null; markDrop() })
  list.addEventListener('drop', event => {
    const over = event.target.closest('[data-seq]')
    if (!dragged || !over) return
    event.preventDefault()
    const after = isAfter(event, over), order = cutOrder().filter(id => id !== dragged)
    order.splice(order.indexOf(over.dataset.seq) + (after ? 1 : 0), 0, dragged)
    dragged = null; markDrop()
    reorder(order)
  })
  list.addEventListener('click', event => {
    const join = event.target.closest('[data-join]')
    if (join) return joint(join)
    const id = event.target.closest('[data-seq]')?.dataset.seq
    if (id) ctx.hooks.focusNode(id)
  })
  list.addEventListener('dblclick', event => { const id = event.target.closest('[data-seq]')?.dataset.seq; if (id) startSequencePlayback(id) })
  // The strip scrolls sideways, so the plain wheel does too.
  list.addEventListener('wheel', event => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || list.scrollWidth <= list.clientWidth) return
    event.preventDefault(); list.scrollLeft += event.deltaY
  }, { passive: false })
}
/** The joint between two cards: a linked one offers 다시 뽑기 / 연결 끊기, an unlinked one continues from the cut before. */
function joint(button) {
  const edge = button.dataset.edge
  if (!edge) return void continueFromPrevious(button.dataset.join)
  const rect = button.getBoundingClientRect()
  showMenu(rect.left, rect.bottom + 4, [{ label: '다시 뽑기', run: () => repull(edge) }, { label: '연결 끊기', danger: true, run: () => removeEdge(edge) }])
}
const isAfter = (event, item) => { const rect = item.getBoundingClientRect(); return event.clientX > rect.x + rect.width / 2 }
function markDrop(event) {
  $('seq-list').querySelectorAll('.drop-before, .drop-after').forEach(item => item.classList.remove('drop-before', 'drop-after'))
  const over = event?.target.closest('[data-seq]')
  if (over && over.dataset.seq !== dragged) over.classList.add(isAfter(event, over) ? 'drop-after' : 'drop-before')
}
export function reorder(order) {
  if (JSON.stringify(order) === JSON.stringify(cutOrder())) return
  s.project.sequence = order; renderSequence()
  return ui(() => edit([{ op: 'sequence', order }]))
}
// ---- continuous playback: two videos, the next clip preloads while the current one plays ----
let player = null
const videos = () => [$('seq-a'), $('seq-b')]
function loadClip(video, clip) {
  if (!clip) { video.removeAttribute('src'); video.load?.(); return }
  video.preload = 'auto'; video.src = fileUrl(clip.hash); video.load?.()
}
function front() { return videos()[player.front] }
const showPlayer = on => { $('seq-player').hidden = !on }
let followed = null
/** Transport, scrubber and the playing card follow the video: the play button, time, segment fills and the 3px bar on the card. */
export function markPlayhead() {
  const list = $('seq-list'), segments = [...$('seq-scrub').querySelectorAll('[data-scrub]')]
  list.querySelectorAll('[data-playing]').forEach(item => { item.removeAttribute('data-playing'); item.querySelector('.vc-seq-progress').style.width = '0' })
  const video = player && front(), playing = Boolean(player) && !video.paused
  patch($('seq-play'), `${icon(playing ? 'pause' : 'play', 14)}<span>${playing ? '일시정지' : '전체 재생'}</span>`)
  $('seq-play').disabled = !cutOrder().map(nodeById).some(repTake) && !player
  $('seq-halt').disabled = !player
  const total = player ? player.total : cutOrder().map(nodeById).reduce((sum, cut) => sum + lengthOf(cut).value, 0)
  const clip = player?.clips[player.index], elapsed = player ? player.starts[player.index] + (video.currentTime || 0) : 0
  $('seq-time').textContent = total ? `${Number(elapsed.toFixed(1))} / ${secs(total)}` : ''
  if (!player) { followed = null }
  const index = clip?.cutId ? segments.findIndex(segment => segment.dataset.scrub === clip.cutId) : -1, ratio = clip ? clamp((video.currentTime || 0) / (clip.duration || 1), 0, 1) : 0
  segments.forEach((segment, i) => { segment.querySelector('i').style.width = index < 0 ? '0' : `${i < index ? 100 : i === index ? ratio * 100 : 0}%`; segment.toggleAttribute('data-playing', i === index) })
  const item = clip?.cutId && list.querySelector(`[data-seq="${CSS.escape(clip.cutId)}"]`)
  if (item) {
    item.setAttribute('data-playing', ''); item.querySelector('.vc-seq-progress').style.width = `${ratio * 100}%`
    // The playing cut is scrolled into view once, when it starts, so the user can still scroll the strip while it plays.
    if (followed !== clip.cutId) { followed = clip.cutId; item.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }) }
  }
}
export function stopPlayback() {
  if (!player) return
  player = null
  for (const video of videos()) { video.pause(); loadClip(video, null) }
  showPlayer(false)
  markPlayhead()
}
export function playClips(clips) {
  stopPlayback()
  player = { clips, index: 0, front: 0, total: clips.reduce((sum, clip) => sum + clip.duration, 0), starts: clips.map((_, i) => clips.slice(0, i).reduce((sum, clip) => sum + clip.duration, 0)) }
  showPlayer(true)
  const [a, b] = videos()
  a.classList.add('front'); b.classList.remove('front')
  loadClip(a, clips[0]); loadClip(b, clips[1])
  void a.play?.()
  markPlayhead()
}
function advance() {
  if (!player) return
  if (player.index + 1 >= player.clips.length) return stopPlayback()
  const old = front()
  player.index++; player.front = 1 - player.front
  const next = front()
  next.classList.add('front'); old.classList.remove('front')
  void next.play?.()
  loadClip(old, player.clips[player.index + 1])
  markPlayhead()
}
/** Plays the cuts that have a result, from the start or (given a cut) from that cut on. */
export function startSequencePlayback(fromCutId) {
  const order = cutOrder().map(nodeById), ready = order.filter(repTake), from = typeof fromCutId === 'string' ? order.findIndex(cut => cut.id === fromCutId) : 0
  if (!ready.length) return toast('재생할 결과가 아직 없어. 먼저 생성해줘.', { error: true })
  if (!from && ready.length < order.length) toast(`결과가 없는 컷 ${order.length - ready.length}개는 건너뛰고 재생해.`)
  const clips = ready.filter(cut => order.indexOf(cut) >= from)
  if (!clips.length) return toast('이 컷부터는 재생할 결과가 없어.', { error: true })
  s.seqOpen = true; renderSequence()
  playClips(clips.map(cut => ({ cutId: cut.id, name: cut.data.name, hash: repTake(cut).resultHash, duration: lengthOf(cut).value || 1 })))
}
// ---- export ----
const exportWatches = new Map()
const chainWatches = new Map()
/** Stops following exports and chains (leaving a project). */
export function abortExportWatches() {
  for (const controller of [...exportWatches.values(), ...chainWatches.values()]) controller.abort()
  exportWatches.clear(); chainWatches.clear()
}
function watchExport(id) {
  if (exportWatches.has(id)) return
  const controller = new AbortController(), projectId = s.project.id
  exportWatches.set(id, controller)
  void (async () => {
    try {
      while (!controller.signal.aborted) {
        const result = await request('export_sequence', { project_id: projectId, export_id: id, wait_seconds: 30 }, { signal: controller.signal })
        await reloadQueued()
        if (isTerminal(result.status)) break
      }
    } catch (error) { if (!controller.signal.aborted) toast(error.message, { error: true }) }
    finally { exportWatches.delete(id) }
  })()
}
/** Called after every project read: an export still running (also one started elsewhere) keeps being followed. */
export function watchExports() {
  for (const item of s.project?.exports ?? []) if (!isTerminal(item.status)) watchExport(item.id)
}
export async function startExport() {
  const order = cutOrder().map(nodeById), ready = order.filter(repTake), missing = order.filter(cut => !repTake(cut))
  if (exportStarting || exportRunning() || activeChain()) return
  if (order.length < 2) return toast('합본은 컷이 2개 이상 있어야 만들 수 있어.', { error: true })
  if (ready.length < 2) return toast('결과가 있는 컷이 2개 이상 있어야 합본을 만들 수 있어. 먼저 생성해줘.', { error: true })
  if (missing.length && !await confirmDialog('결과가 없는 컷이 있어', `<p>${missing.map(cut => esc(cut.data.name)).join(', ')}에는 쓸 수 있는 결과가 없어.</p><p>이 컷들을 빼고 나머지 ${ready.length}개로 합본을 만들까?</p>`, '빼고 내보내기', false)) return
  exportStarting = true; lockExport()
  try {
    await ui(async () => {
      const result = await request('export_sequence', { expected_revision: s.project.revision, ...(missing.length ? { cut_ids: ready.map(cut => cut.id) } : {}) })
      await reload()
      watchExport(result.id)
      toast('합본 내보내기를 시작했어.')
    }, $('seq-export-btn'))
  } finally { exportStarting = false; lockExport() }
}
export function cancelExport(id) {
  return ui(async () => {
    exportWatches.get(id)?.abort(); exportWatches.delete(id)
    await request('export_sequence', { export_id: id, cancel: true })
    await reload()
  })
}
// ---- chain: 이어 생성 runs on the server; the page starts it and follows it like an export ----
let chainStarting = false
function lockChain() {
  const button = $('seq-chain'), order = cutOrder().map(nodeById), unprofiled = order.filter(cut => !profileOf(cut))
  button.disabled = chainStarting || !order.length || unprofiled.length > 0
  button.title = unprofiled.length ? `${unprofiled.map(cut => cut.data.name).join(', ')}에 워크플로가 없어. 먼저 골라줘.` : '앞 컷의 마지막 프레임으로 이어서 차례로 생성'
}
function watchChain(id) {
  if (chainWatches.has(id)) return
  const controller = new AbortController(), projectId = s.project.id
  const completed = chain => chain?.steps.filter(step => step.status === 'completed').length ?? 0
  let finished = completed(s.project.chains?.find(chain => chain.id === id))
  chainWatches.set(id, controller)
  void (async () => {
    try {
      while (!controller.signal.aborted) {
        // A short wait keeps the step state fresh; the finished chain is read back through the queue.
        const result = await request('run_chain', { project_id: projectId, chain_id: id, wait_seconds: 8 }, { signal: controller.signal })
        if (isTerminal(result.status)) { await reloadQueued(); break }
        if (s.project?.id !== projectId || controller.signal.aborted) continue
        s.project.chains = (s.project.chains ?? []).map(chain => chain.id === id ? result : chain); ctx.hooks.render?.()
        // A cut that just finished has a result: its node and thumbnail show it now, not when the whole chain ends.
        if (completed(result) > finished) { finished = completed(result); await reloadQueued() }
      }
    } catch (error) { if (!controller.signal.aborted) toast(error.message, { error: true }) }
    finally { if (chainWatches.get(id) === controller) chainWatches.delete(id) }
  })()
}
/** Called after every project read: a chain still running (also one the assistant started) keeps being followed. */
export function watchChains() {
  for (const chain of s.project?.chains ?? []) if (!isTerminal(chain.status)) watchChain(chain.id)
}
async function startChain(regenerate) {
  if (chainStarting || activeChain()) return
  chainStarting = true; lockChain()
  try {
    await ui(async () => {
      const chain = await request('run_chain', { expected_revision: s.project.revision, regenerate })
      await reload()
      watchChain(chain.id)
      toast('이어 생성을 시작했어.')
    }, $('seq-chain'))
  } finally { chainStarting = false; lockChain() }
}
function chooseChain(event) {
  const order = cutOrder().map(nodeById), rect = event.currentTarget.getBoundingClientRect()
  if (!order.some(repTake)) return void startChain(false)
  showMenu(rect.left, rect.top - 84, [
    { label: '결과 없는 컷만 이어 생성', run: () => startChain(false) },
    { label: '전부 다시 생성', run: () => startChain(true) },
  ])
}
export function cancelChain(id) {
  return ui(async () => {
    chainWatches.get(id)?.abort(); chainWatches.delete(id)
    await request('run_chain', { chain_id: id, cancel: true })
    await reload()
  })
}
export function playExport(id) {
  const item = s.project.exports?.find(item => item.id === id)
  if (!item?.resultHash) return
  s.seqOpen = true; renderSequence()
  playClips([{ cutId: null, name: '합본', hash: item.resultHash, duration: durations.get(item.resultHash) ?? (Number(item.duration) || 1) }])
}
export function bindSequence() {
  bindStrip()
  const toggle = () => { s.seqOpen = !s.seqOpen; ctx.view.seq = s.seqOpen; saveView(); renderSequence(); ctx.hooks.layoutChanged?.() }
  $('seq-collapse').onclick = toggle
  $('seq-chain').onclick = chooseChain
  $('seq-export-btn').onclick = () => void startExport()
  $('seq-chain-state').onclick = event => { const id = event.target.closest('[data-chain-cancel]')?.dataset.chainCancel; if (id) void cancelChain(id) }
  $('seq-scrub').onclick = event => { const id = event.target.closest('[data-scrub]')?.dataset.scrub; if (id) startSequencePlayback(id) }
  $('seq-play').onclick = () => {
    if (!player) return startSequencePlayback()
    const video = front()
    if (video.paused) void video.play?.(); else video.pause()
    markPlayhead()
  }
  $('seq-halt').onclick = stopPlayback
  $('seq-stop').onclick = stopPlayback
  for (const video of videos()) {
    video.addEventListener('ended', advance)
    for (const type of ['play', 'pause']) video.addEventListener(type, () => { if (player && video === front()) markPlayhead() })
    video.addEventListener('timeupdate', () => { if (player && video === front()) markPlayhead() })
    video.addEventListener('loadedmetadata', () => {
      // The real length replaces the cut's nominal duration so the position indicator stays true.
      const index = player?.clips.findIndex(clip => fileUrl(clip.hash) === new URL(video.src, window.location.href).pathname)
      if (index >= 0 && Number.isFinite(video.duration)) { if (!durations.has(player.clips[index].hash)) { durations.set(player.clips[index].hash, video.duration); renderSequence() } player.clips[index].duration = video.duration; player.total = player.clips.reduce((sum, clip) => sum + clip.duration, 0); player.starts = player.clips.map((_, i) => player.clips.slice(0, i).reduce((sum, clip) => sum + clip.duration, 0)) }
    })
  }
  $('seq-big').onclick = () => $('seq-big').setAttribute('aria-pressed', String($('seq-player').classList.toggle('big')))
  $('seq-player').addEventListener('dblclick', () => { if (player) void ctx.hooks.openDetail(player.clips[player.index].hash) })
  // Drag the hairline on the dock's top edge to resize; double-click resets, the arrow keys nudge.
  const handle = $('seq-resize')
  let resize = null
  handle.addEventListener('pointerdown', event => { event.preventDefault(); handle.setPointerCapture?.(event.pointerId); resize = { y: event.clientY, height: dockHeight(s.seqH) } })
  handle.addEventListener('pointermove', event => { if (resize) setDockHeight(resize.height + resize.y - event.clientY, false) })
  const done = () => { if (resize) { resize = null; setDockHeight(s.seqH) } }
  handle.addEventListener('pointerup', done); handle.addEventListener('pointercancel', done)
  handle.addEventListener('dblclick', () => setDockHeight(DOCK_H))
  handle.addEventListener('keydown', event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); setDockHeight(dockHeight(s.seqH) + (event.key === 'ArrowUp' ? 16 : -16)) } })
  window.addEventListener('resize', () => { if (!$('workspace').hidden) showDockHeight() })
}
