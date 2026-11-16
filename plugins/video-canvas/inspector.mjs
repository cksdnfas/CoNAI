import { MODES, labelTable, resolvePrompt, cutEdges, adapterOf, outputOf } from './domain.mjs'
import { $, esc, names, ports, outputNames, reviewNames, badge, statusBadge, assetBadge, isTerminal, progressText, patch } from './util.mjs'
import { s, nodeById, selected, takesOf, repTake, takeTitle, profileOf, outputKind, takeOutput, genInputs, checkOf, staleWarnings, current } from './state.mjs'
import { lockRunButtons, request, task } from './session.mjs'
import { workflowHtml, settingsHtml, ensureOptions, genSettingsHtml, genFieldsHtml, guideTitle, wfOf } from './workflow.mjs'

const button = (action, label, data = '', cls = '') => `<button class="${cls}" data-action="${action}" ${data}>${label}</button>`
const toolbar = html => `<div class="toolbar">${html}</div>`
const nameOf = id => nodeById(id)?.data.name
const issues = (list, cls) => list.map(issue => `<p class="${cls}">${esc(issue.message)}</p>`).join('')
function review(item) {
  return `<h2 class="conai-group-head">검수</h2><div class="conai-segmented">${Object.entries(reviewNames).map(([value, label]) => button('review', label, `data-review="${value}" data-item="${esc(item.id)}" aria-pressed="${item.review === value}"`)).join('')}</div><label>메모<input data-memo="${esc(item.id)}" value="${esc(item.memo)}"></label>`
}
// A generation take carries its whole profile (a NovelAI one has the full settings): the card shows only which setting made it.
const profileSummary = profile => profile && adapterOf(profile) !== 'director' ? { label: profile.label, adapter: adapterOf(profile), output: outputOf(profile) } : profile
function takeCard(take) {
  const id = `data-take="${esc(take.id)}"`, cut = nodeById(take.cutId)
  return `<div class="conai-list-row"><div class="conai-row-main"><div class="toolbar"><span class="conai-row-title">${esc(takeTitle(take))}</span>${statusBadge(take.status)}${cut && repTake(cut)?.id === take.id ? badge('대표', 'ok') : ''}</div><span class="conai-row-meta">${esc(take.label)} · seed ${take.seed}${take.jobId ? ` · job ${esc(take.jobId)}` : ''}</span>${take.error ? `<p class="error">${esc(take.error)}</p>` : ''}<details data-keep="take:${esc(take.id)}"><summary>보낸 프롬프트·슬롯·프로필</summary><pre>${esc(JSON.stringify({ seed: take.seed, profile: profileSummary(take.profile), resolved: take.resolved }, null, 2))}</pre></details><div class="toolbar">
    ${take.status === 'proposed' && cut?.kind === 'cut' ? button('approve', '승인하고 생성', id, 'primary') + button('discard', '폐기', id) : button('refresh-take', '상태 갱신', id)}
    ${take.jobId && !isTerminal(take.status) ? button('cancel', '취소', id) : ''}
    ${take.status === 'failed' && !take.jobId ? button('retry', '같은 요청 재시도', id) : ''}
    ${take.resultHash ? button('take-pick', '대표로', id) + (cut?.kind === 'cut' ? button('extract-take', '프레임 뽑기', id) : '') + (takeOutput(take) === 'audio' ? '' : button('open-detail', '상세에서 열기', `data-hash="${esc(take.resultHash)}"`)) : ''}
    ${take.status === 'discarded' ? '' : button('rerun-take', '같은 시드·이 입력으로', id)}${button('rerun-canvas', '같은 시드·현재 입력으로', id)}${button('rerun-new', '새 시드·현재 입력으로', id)}
    </div>${review(take)}</div></div>`
}
// What the server's check says about a node: a generation node shows all of it, a cut (whose prompt problems are listed with its prompt) only the stale-input warning.
const staleIssue = node => issues(staleWarnings(node), 'warning')
const nodeIssues = node => { const check = checkOf(node); return check ? issues(check.errors, 'error') + issues(check.warnings, 'warning') : staleIssue(node) }
function slotEditors(cut) {
  // A generation node's inputs are labelled by the image field of its profile each one fills; a cut's by its prompt labels.
  const gen = cut.kind === 'gen', table = gen ? [] : labelTable(s.project, cut), { edges, fields } = gen ? genInputs(cut) : { edges: cutEdges(s.project, cut, false) }
  const fieldLabel = id => wfOf(profileOf(cut))?.generator.imageFields.find(field => field.id === id)?.label ?? id
  return edges.map(edge => {
    const node = nodeById(edge.from), kind = outputKind(node), duration = node.data.duration ?? repTake(node)?.resultDuration ?? 2
    const row = gen ? (fields[edge.position] ? fieldLabel(fields[edge.position]) : '') : table.filter(item => item.edgeId === edge.id).map(item => item.label).join(' / ')
    return `<details class="slot-editor" data-keep="${esc(edge.id)}"><summary>${esc(row || '미사용')} · ${esc(node.data.name)}</summary><p class="muted">${ports[edge.port]} ${edge.position + 1}</p>${toolbar(button('up', '↑', `data-edge="${esc(edge.id)}" aria-label="위로"`) + button('down', '↓', `data-edge="${esc(edge.id)}" aria-label="아래로"`) + button('disconnect', '연결 해제', `data-edge="${esc(edge.id)}"`))}
      ${kind === 'video' || kind === 'audio' ? `<div class="two"><label>시작(초)<input type="number" step="any" data-prop="trim_start" data-edge="${esc(edge.id)}" value="${edge.props.trim_start ?? 0}"></label><label>끝(초)<input type="number" step="any" data-prop="trim_end" data-edge="${esc(edge.id)}" value="${edge.props.trim_end ?? duration}"></label></div>` : ''}
      ${kind === 'video' ? `<label>영상 소리<select data-prop="media_mode" data-edge="${esc(edge.id)}">${[['video', '영상만'], ['audio', '소리만'], ['video_audio', '영상+소리']].map(([value, label]) => `<option value="${value}" ${(edge.props.media_mode ?? 'video') === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>오디오 슬롯 (0부터)<input type="number" data-prop="audioSlot" data-edge="${esc(edge.id)}" value="${edge.props.audioSlot ?? 0}"></label>` : ''}
      ${node.kind === 'bundle' ? `<div class="two"><label>번들 슬롯 (1–8)<input type="number" data-prop="slot" data-edge="${esc(edge.id)}" value="${edge.props.slot ?? edge.position + 1}"></label><label>강도<input type="number" step="any" data-prop="strength" data-edge="${esc(edge.id)}" value="${edge.props.strength ?? 1}"></label></div><label>설명<input data-prop="description" data-edge="${esc(edge.id)}" value="${esc(edge.props.description)}"></label>` : ''}</details>`
  }).join('') || '<p class="conai-empty">연결 없음</p>'
}
function cutHtml(cut) {
  const resolved = resolvePrompt(s.project, cut), table = labelTable(s.project, cut), takes = takesOf(cut.id).slice().reverse()
  return `<section>${workflowHtml(cut)}</section><section>${settingsHtml(cut)}</section>
    <section><h2 class="conai-group-head">3 · 모드·길이·시드</h2><label>모드<select data-field="mode">${MODES.map(mode => `<option ${mode === cut.data.mode ? 'selected' : ''}>${mode}</option>`).join('')}</select></label><div class="two"><label>길이(초)<input data-field="duration" type="number" step="any" value="${esc(cut.data.duration)}"></label><label>시드<input data-field="seed" type="number" value="${esc(cut.data.seed)}"></label></div>${toolbar(button('seed', '새 시드'))}</section>
    <section><h2 class="conai-group-head">4 · 입력 슬롯</h2>${slotEditors(cut)}</section>
    <section><h2 class="conai-group-head">5 · 프롬프트</h2><label>프롬프트<textarea data-field="prompt" rows="4">${esc(cut.data.prompt)}</textarea></label><div class="conai-chips">${[...new Set(table.map(row => row.name))].map(name => `<button class="conai-chip" data-token="${esc(name)}">@${esc(name)}</button>`).join('')}</div>
    <label>원문<textarea data-field="raw" rows="3">${esc(cut.data.raw)}</textarea></label>
    <details data-keep="resolved"><summary>전송될 프롬프트</summary><pre>${esc(resolved.prompt)}</pre>${resolved.table.length ? `<table class="label-table"><tbody>${resolved.table.map(row => `<tr><td>${esc(row.label)}</td><td>${esc(row.name)}</td><td>${ports[row.port]} · ${row.slot}</td></tr>`).join('')}</tbody></table>` : ''}</details>${resolved.errors.map(message => `<p class="error">${esc(message)}</p>`).join('')}${resolved.warnings.map(message => `<p class="warning">${esc(message)}</p>`).join('')}</section>
    <section><h2 class="conai-group-head">6 · 생성·이력</h2>${toolbar(button('run', '지금 생성', '', 'primary') + button('propose', '제안으로 올리기') + button('continue-prev', '앞 컷에서 이어가기'))}${staleIssue(cut)}${takes.length ? `<div class="conai-list">${takes.map(takeCard).join('')}</div>` : '<p class="conai-empty">아직 생성 이력이 없어.</p>'}</section>${review(cut)}${toolbar(button('remove', '노드 삭제', '', 'ghost'))}`
}
function usesHtml(node) {
  const uses = s.project.edges.filter(edge => edge.from === node.id)
  return `<h2 class="conai-group-head">쓰는 곳</h2>${uses.length ? `<ul class="conai-list">${uses.map(edge => `<li class="conai-list-row">${esc(nameOf(edge.to))} · ${ports[edge.port]}</li>`).join('')}</ul>` : '<p class="conai-empty">연결 없음</p>'}`
}
function mediaHtml(node) {
  const hash = node.data.ref?.source === 'library' ? node.data.ref.compositeHash : null
  return `${node.data.check ? `<div class="conai-chips">${assetBadge(node.data.check)}</div>` : ''}${toolbar((hash ? button('open-detail', '상세에서 열기', `data-hash="${esc(hash)}"`) : '') + (node.kind === 'video' && hash ? button('extract', '프레임 추출') : ''))}${usesHtml(node)}${review(node)}${toolbar(button('remove', '노드 삭제', '', 'ghost'))}`
}
// What the generation node's profile says about writing its prompt, read-only; the linked skill section comes from the server's node read.
function guideHtml(node, detail) {
  const profile = profileOf(node), link = profile?.guideSkill, guide = detail?.guide
  if (!profile?.instruction && !profile?.guide && !link) return ''
  return `<section><h2 class="conai-group-head">가이드</h2>${profile.instruction ? `<p class="vc-guide">${esc(profile.instruction)}</p>` : ''}${profile.guide ? `<p class="vc-guide">${esc(profile.guide)}</p>` : ''}${link ? `<p>가이드 스킬 · ${esc(guide?.skill?.title ?? guideTitle(link))}</p>` : ''}${guide?.guideWarning ? `<p class="warning">${esc(guide.guideWarning)}</p>` : ''}${guide?.skill?.text ? `<details data-keep="guide-skill"><summary>가이드 스킬 내용</summary><p class="vc-guide">${esc(guide.skill.text)}</p></details>` : ''}</section>`
}
function genHtml(node) {
  const profile = profileOf(node), nai = profile && adapterOf(profile) === 'nai', takes = takesOf(node.id).slice().reverse()
  const detail = s.nodeDetail?.node.id === node.id ? s.nodeDetail.preview : null
  const sizes = profile?.nai?.sizes ?? [], size = node.data.size ?? sizes[0]?.label
  const prompted = nai || Boolean(profile?.promptFieldId), seeded = nai || Boolean(profile?.seedFieldId)
  return `<section>${genSettingsHtml(node)}</section>
    <section><h2 class="conai-group-head">2 · 입력 이미지</h2>${slotEditors(node)}</section>
    ${guideHtml(node, detail)}
    <section><h2 class="conai-group-head">3 · 프롬프트·시드</h2>${prompted ? `<label>프롬프트<textarea data-field="prompt" rows="5">${esc(node.data.prompt)}</textarea></label>` : '<p class="muted">이 생성 설정은 프롬프트를 쓰지 않아.</p>'}
    ${nai ? `<label>크기<select data-field="size">${sizes.map(entry => `<option ${entry.label === size ? 'selected' : ''}>${esc(entry.label)}</option>`).join('')}${size && !sizes.some(entry => entry.label === size) ? `<option selected>${esc(size)}</option>` : ''}</select></label>` : ''}
    ${genFieldsHtml(node)}${seeded ? `<label>시드<input data-field="seed" type="number" value="${esc(node.data.seed)}"></label>${toolbar(button('seed', '새 시드'))}` : ''}</section>
    <section><h2 class="conai-group-head">4 · 생성·이력</h2>${toolbar(button('run', '지금 생성', '', 'primary'))}${nodeIssues(node)}${takes.length ? `<div class="conai-list">${takes.map(takeCard).join('')}</div>` : '<p class="conai-empty">아직 생성 이력이 없어.</p>'}</section>
    <section>${usesHtml(node)}</section>${review(node)}${toolbar(button('remove', '노드 삭제', '', 'ghost'))}`
}
function detailHtml() {
  if (s.sel.length > 1) return `<h2>${s.sel.length}개 선택</h2>${toolbar(button('duplicate-selected', '복제') + button('remove-selected', '선택 삭제', '', 'destructive'))}`
  const node = selected()
  if (!node) return '<p class="conai-empty">노드를 고르면 자세한 설정이 여기에 나와.</p>'
  const output = node.kind === 'gen' && outputKind(node) ? ` · ${outputNames[outputKind(node)]}` : ''
  return `<h2>${esc(names[node.kind])}${esc(output)} · ${esc(node.data.name)}</h2>${node.kind === 'cut' ? cutHtml(node) : node.kind === 'gen' ? genHtml(node) : mediaHtml(node)}`
}
function checksHtml() {
  if (!s.checks) return `<h2>전체 체크</h2>${toolbar(button('check-all', '전체 체크'))}<p class="conai-empty">아직 체크하지 않았어.</p>`
  return `<h2>전체 체크</h2>${toolbar(button('check-all', '다시 체크'))}<div class="conai-list">${Object.entries(s.checks.assets).map(([id, asset]) => `<div class="conai-list-row"><div class="conai-row-main"><span class="conai-row-title">${esc(nameOf(id))}</span>${asset.message ? `<p class="error">${esc(asset.message)}</p>` : ''}${asset.status === 'changed' ? toolbar(button('fingerprint', '새 파일로 갱신', `data-item="${esc(id)}"`) + button('keep', '그대로 두기')) : ''}</div>${assetBadge(asset)}</div>`).join('')}${s.checks.cuts.map(cut => `<div class="conai-list-row"><div class="conai-row-main"><span class="conai-row-title">${esc(nameOf(cut.id))}</span>${issues(cut.errors, 'error')}${issues(cut.warnings, 'warning')}</div>${cut.blocked ? badge('막힘', 'destructive') : badge('통과', 'ok')}</div>`).join('')}</div>`
}
function assistantHtml() {
  const proposals = (s.project?.takes ?? []).filter(take => take.status === 'proposed'), extractions = s.project?.extractions ?? []
  const sourceName = item => item.source?.nodeId ? nameOf(item.source.nodeId) : (take => take && takeTitle(take))(s.project.takes.find(take => take.id === item.source?.takeId))
  return `<h2>어시스턴트 변경</h2>${s.batch ? `<details><summary>적용 ${s.batch.applied.length} · 거절 ${s.batch.rejected.length}</summary><pre>${esc(JSON.stringify(s.batch, null, 2))}</pre></details>` : ''}${toolbar(button('undo', '직전 배치 되돌리기'))}${proposals.length ? `<h2 class="conai-group-head">생성 제안</h2><div class="conai-list">${proposals.map(takeCard).join('')}</div>` : ''}${extractions.length ? `<h2 class="conai-group-head">프레임 추출 작업</h2><div class="conai-list">${extractions.map(item => `<div class="conai-list-row"><div class="conai-row-main"><span class="conai-row-title">${esc(sourceName(item) ?? '프레임 추출')}</span>${progressText(item.progress) ? `<span class="conai-row-meta">${progressText(item.progress)}</span>` : ''}${item.error ? `<p class="error">${esc(item.error)}</p>` : ''}${item.jobId && !isTerminal(item.status) ? toolbar(button('extraction-status', '상태 갱신', `data-extraction="${esc(item.id)}"`) + button('extraction-cancel', '작업 취소', `data-extraction="${esc(item.id)}"`)) : ''}</div>${statusBadge(item.status)}</div>`).join('')}</div>` : ''}`
}
let shownFor = null, readKey = null
/** The open node's server read holds its checks and, for a generation node, the linked guide skill's title, text and warning. Selecting and every edit read the
 *  node themselves; this reads it again when it falls behind: a take finished since (that can make a check stale), or the guide was never read for this revision.
 *  The read redraws the inspector and the card when it arrives (the `nodeRead` hook). */
function readOpenNode(node) {
  const read = s.nodeDetail, behind = read?.node.id === node.id && read.revision === s.project.revision ? !current(read) : node.kind === 'gen' && Boolean(profileOf(node)?.guideSkill)
  const key = `${node.id}|${s.project.revision}|${s.project.takes.filter(take => take.resultHash).length}`
  if (!behind || readKey === key) return
  readKey = key
  void task(() => request('read_node', { id: node.id })).catch(() => {})
}
/** Redraws the detail panel; for the same selection the open sections and the field being typed in survive. */
export function renderInspector() {
  $('workspace').classList.toggle('insp-closed', !s.inspectorOpen)
  $('toggle-inspector').setAttribute('aria-pressed', String(s.inspectorOpen))
  // A closed panel costs nothing: it is filled when it opens.
  if (!s.inspectorOpen) return
  document.querySelectorAll('[data-tab]').forEach(tab => tab.setAttribute('aria-selected', String(tab.dataset.tab === s.tab)))
  const host = $('insp-body'), key = `${s.tab}|${s.selection}`
  if (shownFor !== key && host.contains(document.activeElement)) document.activeElement.blur?.()
  shownFor = key
  host.dataset.id = s.selection ?? ''
  const node = selected()
  if (s.tab === 'detail' && (node?.kind === 'cut' || node?.kind === 'gen') && !s.wf) ensureOptions().catch(() => {})
  if (s.tab === 'detail' && (node?.kind === 'cut' || node?.kind === 'gen')) readOpenNode(node)
  patch(host, s.tab === 'checks' ? checksHtml() : s.tab === 'assistant' ? assistantHtml() : detailHtml())
  lockRunButtons()
}
