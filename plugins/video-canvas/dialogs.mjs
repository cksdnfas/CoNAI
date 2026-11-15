import { $, esc, names, ports, statusNames, progressText, seconds, isTerminal, thumbUrl, fileUrl, audioUrl } from './util.mjs'
import { s, ctx, nodeById, cuts, profileOf, selected, takeTitle } from './state.mjs'
import { toast, notice } from './toast.mjs'
import { request, native, http, task, ui, edit, reload, reloadQueued, pinFrames } from './session.mjs'
import { freeSpots, spotsAt } from './viewport.mjs'

export const extractionWatches = new Map()
// Every dialog is title, fields, then one footer row: close/cancel and at most one primary action (#dialog-primary).
export function modal(title, body, { primary, close = '취소', danger = false, extra = '' } = {}) {
  $('modal').innerHTML = `<h2>${esc(title)}</h2>${body}<p id="dialog-message" class="error" role="alert" hidden></p><div class="conai-dialog-foot"><button id="dialog-close" class="ghost" data-close>${close}</button>${extra}${primary ? `<button id="dialog-primary" class="${danger ? 'destructive' : 'primary'}">${primary}</button>` : ''}</div>`
  if (!$('modal').open) $('modal').showModal()
}
export function confirmDialog(title, body, primary, danger = true) {
  return new Promise(resolve => {
    modal(title, body, { primary, danger })
    let ok = false
    $('dialog-primary').onclick = () => { ok = true; $('modal').close() }
    $('modal').addEventListener('close', () => resolve(ok), { once: true })
  })
}
/** A text prompt dialog; resolves with the trimmed text or null when cancelled. */
export function promptDialog(title, label, value, primary) {
  return new Promise(resolve => {
    modal(title, `<label>${esc(label)}<input id="prompt-text" value="${esc(value)}"></label>`, { primary })
    let result = null
    const submit = () => { if (!$('prompt-text').value.trim()) return notice('이름을 써줘.', true); result = $('prompt-text').value.trim(); $('modal').close() }
    $('dialog-primary').onclick = submit
    $('prompt-text').onkeydown = event => { if (event.key === 'Enter') submit() }
    $('modal').addEventListener('close', () => resolve(result), { once: true })
    $('prompt-text').select()
  })
}
export async function libraryName(hash, kind = 'image') {
  const path = (await http(`/api/images/${encodeURIComponent(hash)}`)).data?.original_file_path
  return path?.replace(/\\/g, '/').split('/').at(-1) || names[kind]
}
export async function importRows(rows, at) {
  const spots = at ? spotsAt(at, rows.length) : freeSpots(rows.length)
  const result = await edit(rows.map((row, index) => ({ op: `import_${row.kind}`, ref: row.ref, name: row.name, at: spots[index] })))
  if (result.applied.length) ctx.hooks.select(result.applied[0].id)
}
const memberCounts = members => ['image', 'video', 'audio'].map(kind => [kind, members.filter(member => member.kind === kind).length]).filter(([, count]) => count).map(([kind, count]) => `${names[kind]} ${count}`).join(' · ')
export async function picker(kind, at) {
  const library = kind === 'image' || kind === 'video'
  if (library && ctx.api.supports('pickMedia')) {
    const picked = await ctx.api.pickMedia({ kind, title: `${names[kind]} 가져오기` })
    if (picked.length) await ui(() => importRows(picked.map(item => ({ kind: item.kind, name: item.name, ref: { source: 'library', compositeHash: item.compositeHash } })), at))
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
      const profile = profileOf(selected())
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
      ? `<button class="conai-media-card" data-pick="${index}" aria-label="${esc([row.name, row.meta].filter(Boolean).join(' · '))}"><span class="conai-media"><img src="${thumbUrl(row.hash)}" alt="" loading="lazy"></span><span class="conai-media-body"><span class="conai-media-title">${esc(row.name)}</span>${row.meta ? `<span class="conai-media-meta">${esc(row.meta)}</span>` : ''}</span></button>`
      : row.candidateId
        ? `<div class="conai-list-row"><div class="conai-row-main"><span class="conai-row-title">${esc(row.name)}</span>${row.meta ? `<span class="conai-row-meta">${esc(row.meta)}</span>` : ''}<audio controls preload="none" src="${audioUrl(row.candidateId)}"></audio></div><button data-pick="${index}">가져오기</button></div>`
        : `<button class="conai-list-row" data-pick="${index}"><span class="conai-row-main"><span class="conai-row-title">${esc(row.name)}</span>${row.meta ? `<span class="conai-row-meta">${esc(row.meta)}</span>` : ''}</span></button>`).join('') || '<p class="conai-empty">찾은 소재가 없어.</p>'
    $('asset-next').hidden = !more
  }
  $('asset-results').onclick = event => {
    const index = event.target.closest('[data-pick]')?.dataset.pick
    if (index === undefined) return
    const row = rows[Number(index)]
    if (row.group) { group = row.group; void task(() => search()); return }
    void ui(async () => {
      await importRows([row], at)
      $('modal').close()
    })
  }
  $('asset-form').onsubmit = event => { event.preventDefault(); void task(() => search()) }
  $('asset-back').onclick = () => { group = null; void task(() => search()) }
  $('asset-next').onclick = () => { page++; offset += 20; void task(() => search(true)) }
  await task(() => search())
}
/**
 * The target an extraction connects to. A start/end slot is taken over by the server (the frame it held goes with its link when it
 * was extracted, is pending and unused elsewhere); a frame the person pulled out as a card is disconnected here and stays on the
 * canvas. A list slot (ref_image) is left alone: its old link is replaced by `afterFrames` once the new frame is connected.
 */
export async function extractionTarget(cutId, port, position) {
  if (port === 'ref_image') return { cut: cutId, port, ...(position === undefined ? {} : { position }) }
  const held = s.project.edges.find(edge => edge.to === cutId && edge.port === port)
  if (!held || !s.open.includes(held.from)) return { cut: cutId, port, replace: true }
  await edit([{ op: 'disconnect', id: held.id }])
  return { cut: cutId, port }
}
export async function extractionDialog({ nodeId, takeId, target: preset, after } = {}) {
  const node = nodeById(nodeId), take = s.project.takes.find(take => take.id === takeId)
  if (take && !take.resultHash) throw new Error('결과 해시가 준비될 때까지 기다려줘.')
  if (node && (node.kind !== 'video' || node.data.ref.source !== 'library')) throw new Error('라이브러리 영상만 프레임을 뽑을 수 있어.')
  if (!node && !take) throw new Error('영상 노드나 준비된 take를 골라줘.')
  const targets = cuts().filter(cut => cut.id !== take?.cutId).flatMap(cut => ['start', 'end', 'ref_image'].map(port => `${cut.id}|${port}`))
  modal(`프레임 추출 · ${node?.data.name ?? takeTitle(take)}`, `<video id="frame-player" controls></video><label>위치<select id="frame-position"><option value="first">첫 프레임</option><option value="middle">가운데</option><option value="last" selected>마지막 프레임</option><option value="current">현재 재생 위치</option><option value="seconds">시간(초)</option><option value="index">프레임 번호</option></select></label><p id="frame-current-note" class="warning" hidden>재생 위치는 한 프레임 어긋날 수 있어. 정확히 뽑으려면 프레임 번호를 골라줘.</p><label id="frame-seconds-field" hidden>시간(초)<input id="frame-seconds" type="number" step="any" min="0" value="0"></label><label id="frame-index-field" hidden>프레임 번호 (0부터)<input id="frame-index" type="number" min="0" value="0"></label><label>형식<select id="frame-format"><option>png</option><option>webp</option></select></label><label>연결할 곳<select id="frame-target"><option value="">연결 안 함</option>${targets.map(value => { const [cutId, port] = value.split('|'); return `<option value="${esc(value)}" ${preset && `${preset.cut}|${preset.port}` === value ? 'selected' : ''}>${esc(nodeById(cutId).data.name)} · ${ports[port]}</option>` }).join('')}</select></label><p id="extract-result" role="status"></p><div id="extract-job" class="toolbar" hidden><button id="extract-status">상태 갱신</button><button id="extract-cancel">작업 취소</button></div>`, { primary: '추출' })
  $('frame-position').onchange = () => {
    const position = $('frame-position').value
    $('frame-current-note').hidden = position !== 'current'
    $('frame-seconds-field').hidden = position !== 'seconds'
    $('frame-index-field').hidden = position !== 'index'
  }
  $('frame-player').src = fileUrl(node?.data.ref.compositeHash ?? take.resultHash)
  let extraction
  const status = result => {
    extraction = result
    settleExtraction(result)
    $('extract-result').textContent = result.error ?? [statusNames[result.status] ?? result.status, progressText(result.progress), result.nodeIds?.length ? `프레임 ${result.nodeIds.length}개` : '', result.rejected?.length ? `연결 실패: ${result.rejected.map(item => item.reason).join(', ')}` : ''].filter(Boolean).join(' · ')
    $('extract-result').className = result.error ? 'error' : ''
    $('extract-job').hidden = isTerminal(result.status)
    $('dialog-primary').disabled = true
    $('dialog-close').textContent = '닫기'
  }
  $('dialog-primary').onclick = () => void ui(async () => {
    const position = $('frame-position').value, [cutId, port] = $('frame-target').value.split('|')
    // The link this dialog was opened to replace is only replaced when its slot is still the chosen target.
    const replacing = Boolean(preset) && `${preset.cut}|${preset.port}` === $('frame-target').value
    const target = cutId ? await extractionTarget(cutId, port, replacing ? preset.position : undefined) : null
    const result = await request('extract_frame', { expected_revision: s.project.revision, node_id: nodeId, take_id: takeId, format: $('frame-format').value,
      ...(['first', 'middle', 'last'].includes(position) ? { position } : position === 'index' ? { frame_index: Number($('frame-index').value) } : { at_seconds: [position === 'current' ? $('frame-player').currentTime : Number($('frame-seconds').value)] }),
      ...(target ? { target } : {}) })
    // A frame extracted without a target has no link to live on, so it stays on the canvas as a card.
    if (!target) afterFrames(result.id, pinFrames)
    else if (replacing && after) afterFrames(result.id, after)
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
const afterExtraction = new Map()
/** Runs `run(nodeIds)` once the extraction has ended with frames; a failed or cancelled one leaves everything as it was. */
export const afterFrames = (id, run) => afterExtraction.set(id, run)
export function settleExtraction(result) {
  const run = afterExtraction.get(result.id)
  if (!run || !isTerminal(result.status)) return
  afterExtraction.delete(result.id)
  if (result.nodeIds?.length) run(result.nodeIds)
}
export function watchExtraction(id, update) {
  if (extractionWatches.has(id)) return
  const controller = new AbortController(), projectId = s.project.id
  extractionWatches.set(id, controller)
  void (async () => {
    try {
      while (!controller.signal.aborted) {
        const result = await request('extract_frame', { project_id: projectId, extraction_id: id, wait_seconds: 30 }, { signal: controller.signal })
        if (update && $('extract-result')) update(result)
        settleExtraction(result)
        await reloadQueued()
        if (isTerminal(result.status)) {
          if (result.status === 'completed' && result.nodeIds?.length) toast('프레임을 뽑았어.', { action: { label: '보기', run: () => ctx.hooks.focusFrame?.(result.nodeIds[0]) } })
          break
        }
      }
    } catch (error) { if (!controller.signal.aborted) notice(error.message, true) }
    finally { extractionWatches.delete(id) }
  })()
}
