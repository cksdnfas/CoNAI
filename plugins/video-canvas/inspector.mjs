import { MODES, PORTS, GEN_PORTS, LIMITS, activePorts, continuationPort, labelTable, readPrompt, resolvePrompt, unusedReference, cutEdges, adapterOf, outputOf } from './domain.mjs'
import { $, esc, names, ports, outputNames, reviewNames, badge, statusBadge, assetBadge, isTerminal, progressText, patch, icon, iconButton, thumbUrl } from './util.mjs'
import { s, nodeById, selected, takesOf, repTake, takeTitle, profileOf, outputKind, takeOutput, genInputs, checkOf, staleWarnings, current, cutRunning, cutState, cutOrder, prevCut, allLinks, continues, continuationOf, frameLabel } from './state.mjs'
import { inkHtml, inkAll, markedHtml } from './ink.mjs'
import { lockRunButtons, request, task } from './session.mjs'
import { cutActions, actionButton } from './nodes.mjs'
import { cutSettingsHtml, ensureOptions, genSettingsHtml, genFieldsHtml, guideTitle, wfOf } from './workflow.mjs'

// The detail panel: a sticky head (the node, its one main action and a menu) over flat sections of hairline rows. Expanded rows, the prompt
// tab and the prompt field's height live in s.insp, so a redraw keeps them; patch() keeps the focused field, its text and caret.
const nameOf = id => nodeById(id)?.data.name
const issues = (list, cls) => list.map(issue => `<p class="${cls}">${esc(issue.message ?? issue)}</p>`).join('')
const moreButton = (menu, attrs, label) => `<button type="button" class="conai-icon-button" data-imenu="${menu}" ${attrs} aria-haspopup="menu" aria-expanded="false" aria-label="${esc(label)}" title="${esc(label)}">${icon('more')}</button>`
const countOf = count => count === '' ? '' : `<span class="vc-count">${esc(count)}</span>`
const section = (id, title, body, count = '') => body ? `<section aria-labelledby="${id}"><h3 class="conai-group-head" id="${id}">${esc(title)}${countOf(count)}</h3>${body}</section>` : ''
const expanded = key => s.insp.expanded.has(key)
const domId = value => String(value).replace(/[^\w-]/g, '_')

/** A source node as a small tile: its library image or result, or an icon for what has no picture (a sound, a RefMod bundle). */
function tile(node) {
  const kind = node ? outputKind(node) : null
  const hash = node?.data.ref?.source === 'library' ? node.data.ref.compositeHash : node && (node.kind === 'cut' || node.kind === 'gen') ? repTake(node)?.resultHash : null
  if (hash && kind !== 'audio' && node.kind !== 'bundle') return `<span class="conai-media vc-tile"><img src="${thumbUrl(hash)}" alt="" loading="lazy"></span>`
  return `<span class="vc-tile vc-tile-icon" aria-hidden="true">${icon(node?.kind === 'bundle' ? 'layers' : kind === 'audio' ? 'music' : kind === 'video' ? 'film' : 'frame')}</span>`
}
const takeTile = take => take.resultHash && takeOutput(take) !== 'audio' ? `<span class="conai-media vc-tile wide"><img src="${thumbUrl(take.resultHash)}" alt="" loading="lazy"></span>`
  : `<span class="vc-tile wide vc-tile-icon" aria-hidden="true">${icon(takeOutput(take) === 'audio' ? 'music' : takeOutput(take) === 'image' ? 'frame' : 'film')}</span>`

// ---- review: the state as a segmented choice and the memo, on one row ----
const reviewRow = (item, label) => `<div class="vc-review" role="group" aria-label="${esc(label)}"><div class="conai-segmented" role="group" aria-label="검수 상태">${Object.entries(reviewNames).map(([value, name]) => `<button type="button" data-action="review" data-review="${value}" data-item="${esc(item.id)}" aria-pressed="${item.review === value}">${name}</button>`).join('')}</div><input data-memo="${esc(item.id)}" value="${esc(item.memo ?? '')}" aria-label="메모" placeholder="메모"></div>`
const reviewSection = node => section('insp-h-review', '검수', reviewRow(node, `${node.data.name} 검수`))
const reviewTone = review => review === 'pass' ? 'ok' : review === 'redo' ? 'warn' : ''

// ---- takes: one row each, newest first ----
// A generation take carries its whole profile (a NovelAI one has the full settings): the detail shows only which setting made it.
const profileSummary = profile => profile && adapterOf(profile) !== 'director' ? { label: profile.label, adapter: adapterOf(profile), output: outputOf(profile) } : profile
function takeRow(take, { titled = false } = {}) {
  // Nothing new, an upscale included, starts on a cut that is running; `data-locked` keeps lockRunButtons from enabling the button again.
  const id = `data-take="${esc(take.id)}"`, cut = nodeById(take.cutId), upscaled = Boolean(take.upscaleOf), lock = cut && cutRunning(cut) ? `${id} disabled data-locked` : id
  const open = expanded(`take:${take.id}`), detailId = `insp-take-${domId(take.id)}`, rep = Boolean(cut) && repTake(cut)?.id === take.id
  const title = titled ? takeTitle(take) : `take ${takesOf(take.cutId).findIndex(item => item.id === take.id) + 1}`
  const reviewed = take.review && take.review !== 'pending' ? badge(`검수 ${reviewNames[take.review]}`, reviewTone(take.review)) : ''
  const meta = [take.seed === undefined ? '' : `seed ${take.seed}`, take.jobId ? `job ${take.jobId}` : '', isTerminal(take.status) ? '' : progressText(take.progress)].filter(Boolean).join(' · ')
  const result = take.resultHash, video = cut?.kind === 'cut'
  const tools = [
    result ? iconButton('star', '대표로', `data-action="take-pick" ${id} aria-pressed="${rep}"`, 'vc-star') : '',
    result && takeOutput(take) !== 'audio' ? iconButton('open', '상세에서 열기', `data-action="open-detail" data-hash="${esc(result)}"`) : '',
    result && video ? iconButton('upscale', upscaled ? '다시 업스케일' : '업스케일', `data-action="upscale" ${lock}`) + iconButton('frame', '프레임 뽑기', `data-action="extract-take" ${id}`) : '',
    take.jobId && !isTerminal(take.status) ? iconButton('stop', '취소', `data-action="cancel" ${id}`) : '',
    take.status === 'proposed' && video ? iconButton('check', '승인하고 생성', `data-action="approve" ${id}`) + iconButton('trash', '폐기', `data-action="discard" ${id}`) : '',
    take.status === 'failed' && !take.jobId && (!upscaled || take.request) ? iconButton('refresh', '같은 요청 재시도', `data-action="retry" ${id}`) : '',
    moreButton('take', id, `${title} 메뉴`),
    iconButton(open ? 'up' : 'down', open ? '접기' : '자세히', `data-action="take-expand" ${id} aria-expanded="${open}" aria-controls="${detailId}"`),
  ].join('')
  const detail = open ? `<div class="vc-take-detail" id="${detailId}"><pre>${esc(JSON.stringify({ seed: take.seed, profile: profileSummary(take.profile), resolved: take.resolved }, null, 2))}</pre>${reviewRow(take, `${title} 검수`)}</div>` : ''
  return `<li class="vc-take${open ? ' open' : ''}" data-take-row="${esc(take.id)}">${takeTile(take)}<div class="vc-take-main"><div class="vc-take-title"><span class="conai-row-title">${esc(title)}</span>${statusBadge(take.status)}${rep ? badge('대표', 'ok') : ''}${upscaled ? badge('업스케일') : ''}${reviewed}</div>${meta ? `<span class="conai-row-meta">${esc(meta)}</span>` : ''}</div>
    <div class="vc-take-tools">${tools}</div>${take.error ? `<p class="error vc-take-error">${esc(take.error)}</p>` : ''}${detail}</li>`
}
// What the server's check says about a node: a generation node shows all of it, a cut (whose prompt problems are listed with its prompt) only the stale-input warning.
const staleIssue = node => issues(staleWarnings(node), 'warning')
const nodeIssues = node => { const check = checkOf(node); return check ? issues(check.errors, 'error') + issues(check.warnings, 'warning') : staleIssue(node) }
function historyHtml(node) {
  const takes = takesOf(node.id).slice().reverse(), warned = node.kind === 'gen' ? nodeIssues(node) : staleIssue(node)
  return section('insp-h-takes', '이력', warned + (takes.length ? `<ul class="conai-list vc-takes" aria-labelledby="insp-h-takes">${takes.map(take => takeRow(take)).join('')}</ul>` : ''), takes.length || '')
}

// ---- inputs: grouped by slot, one hairline row per connection ----
const limitOf = port => ['start', 'end'].includes(port) ? 1 : LIMITS[port]
function propsHtml(source, edge) {
  const kind = outputKind(source), id = `data-edge="${esc(edge.id)}"`, duration = source.data.duration ?? repTake(source)?.resultDuration ?? 2
  const number = (prop, label, value, step = '') => `<label>${label}<input type="number" ${step} data-prop="${prop}" ${id} value="${esc(value)}"></label>`
  return [
    ...(kind === 'video' || kind === 'audio' ? [number('trim_start', '시작(초)', edge.props.trim_start ?? 0, 'step="any"'), number('trim_end', '끝(초)', edge.props.trim_end ?? duration, 'step="any"')] : []),
    ...(kind === 'video' ? [`<label>영상 소리<select data-prop="media_mode" ${id}>${[['video', '영상만'], ['audio', '소리만'], ['video_audio', '영상+소리']].map(([value, label]) => `<option value="${value}" ${(edge.props.media_mode ?? 'video') === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>`, number('audioSlot', '오디오 슬롯 (0부터)', edge.props.audioSlot ?? 0)] : []),
    ...(source.kind === 'bundle' ? [number('slot', '번들 슬롯 (1–8)', edge.props.slot ?? edge.position + 1), number('strength', '강도', edge.props.strength ?? 1, 'step="any"'), `<label class="wide">설명<input data-prop="description" ${id} value="${esc(edge.props.description ?? '')}"></label>`] : []),
  ].join('')
}
/** Where a connection the mode ignores can go instead: a REF2VA cut takes images among its reference images, another mode on its empty start slot. */
function moveOf(cut, edge) {
  if (PORTS[edge.port] !== 'image') return null
  if (cut.data.mode === 'REF2VA') return edge.port === 'ref_image' ? null : { port: 'ref_image', label: '참조 이미지로 옮기기' }
  return edge.port !== 'start' && !s.project.edges.some(other => other.to === cut.id && other.port === 'start') ? { port: 'start', label: '시작 프레임으로 옮기기' } : null
}
/**
 * A cut's reference label (Picture 2, RefMod 1) is a chip that puts its @name into the prompt, in its kind's mark colour; one the sent
 * text never names is hollow with a dashed warning edge, and says so in its name.
 */
function labelChip(cut, source, label, missing, kind) {
  if (cut.kind !== 'cut' || !source) return badge(label)
  const insert = `프롬프트에 넣기: @${source.data.name}`
  return `<button type="button" class="conai-chip vc-label k-${kind}${missing ? ' missing' : ''}" data-token="${esc(source.data.name)}" title="${esc(missing ? `프롬프트에 없음 · ${insert}` : insert)}" aria-label="${esc(`${label}, ${insert}${missing ? ', 프롬프트에 없음' : ''}`)}">${esc(label)}</button>`
}
function inputRow(node, edge, { label, link, peers, unused = false, missing = false, kind = 'image' }) {
  const source = nodeById(edge.from), id = `data-edge="${esc(edge.id)}"`, name = source ? (source.kind === 'frame' && link ? frameLabel(source) : source.data.name) : '?'
  const props = source ? propsHtml(source, edge) : '', propsId = `insp-props-${domId(edge.id)}`, open = Boolean(props) && expanded(`edge:${edge.id}`)
  const move = unused && node.kind === 'cut' ? moveOf(node, edge) : null
  const marks = (label ? labelChip(node, source, label, missing, kind) : '') + (link && continues(edge) ? `<span class="vc-mark" title="앞 컷에서 이어짐">${icon('link', 12)}<span class="vc-sr">앞 컷에서 이어짐</span></span>` : '') + (link?.stale ? badge('이전', 'warn') : '')
  const tools = [
    link?.stale ? iconButton('refresh', '다시 뽑기', `data-action="repull" ${id}`) : '',
    peers > 1 ? iconButton('up', '위로', `data-action="up" ${id}`) + iconButton('down', '아래로', `data-action="down" ${id}`) : '',
    props ? iconButton('sliders', '연결 설정', `data-action="edge-props" ${id} aria-expanded="${open}" aria-controls="${propsId}"`) : '',
    move ? iconButton('move', move.label, `data-action="move-link" ${id} data-port="${move.port}"`) : '',
    iconButton('x', '연결 해제', `data-action="disconnect" ${id}`),
  ].join('')
  return `<li class="vc-in${unused ? ' unused' : ''}">${tile(source)}<span class="vc-in-main"><span class="conai-row-title" title="${esc(name)}">${esc(name)}</span>${marks ? `<span class="vc-in-marks">${marks}</span>` : ''}</span><span class="vc-in-tools">${tools}</span>
    ${open ? `<div class="vc-in-props" id="${propsId}" role="group" aria-label="${esc(name)} 연결 설정">${props}</div>` : ''}</li>`
}
function inputsHtml(node) {
  const gen = node.kind === 'gen', edges = gen ? genInputs(node).edges : cutEdges(s.project, node, false)
  const links = new Map(allLinks(true).filter(link => link.target.id === node.id).map(link => [link.edge.id, link]))
  // A generation node's inputs are labelled by the image field of its profile each one fills; a cut's by its prompt labels.
  const fields = gen ? genInputs(node).fields : [], table = gen ? [] : labelTable(s.project, node), warnings = gen ? [] : resolvePrompt(s.project, node).warnings
  const fieldLabel = id => wfOf(profileOf(node))?.generator.imageFields.find(field => field.id === id)?.label ?? id
  const labelOf = edge => gen ? (fields[edge.position] ? fieldLabel(fields[edge.position]) : '') : table.filter(item => item.edgeId === edge.id).map(item => item.label.replace(/^<|>$/g, '')).join(' / ')
  const active = gen ? Object.keys(GEN_PORTS) : activePorts(node.data.mode)
  const ignored = edge => gen ? Boolean(profileOf(node)) && !fields[edge.position] : !active.includes(edge.port)
  // A cut that follows another and is not continued yet offers its continuation slot, even one its mode does not use (connecting there switches the mode).
  const offer = !gen && prevCut(node) && !continuationOf(node) ? continuationPort(node.data.mode) : null
  const used = edges.filter(edge => !ignored(edge)), unused = edges.filter(ignored)
  const groups = Object.keys(gen ? GEN_PORTS : PORTS).filter(port => active.includes(port) || port === offer || used.some(edge => edge.port === port)).map(port => {
    const rows = used.filter(edge => edge.port === port), headId = `insp-port-${port}`, limit = gen ? fields.length : limitOf(port)
    const items = rows.map(edge => inputRow(node, edge, { label: labelOf(edge), link: links.get(edge.id), peers: rows.length, missing: warnings.includes(unusedReference(nameOf(edge.from))), kind: table.find(item => item.edgeId === edge.id)?.type })).join('')
      + (port === offer ? `<li class="vc-in vc-in-offer"><button type="button" class="ghost vc-offer" data-action="continue-prev">${icon('link')}앞 컷에서 이어가기</button></li>` : '')
    const head = gen ? '' : `<h4 class="vc-port-head" id="${headId}">${ports[port]}${countOf(limit ? `${rows.length}/${limit}` : rows.length)}</h4>`
    return `<div class="vc-port">${head}${items ? `<ul class="conai-list vc-inputs" aria-labelledby="${gen ? 'insp-h-inputs' : headId}">${items}</ul>` : ''}</div>`
  }).join('')
  // A continuation frame left on a slot the mode ignores is worth seeing: the group opens for it until the person closes it.
  const open = s.insp.unused[node.id] ?? unused.some(continues)
  const rest = unused.length ? `<details class="vc-unused" data-keep="unused:${esc(node.id)}"${open ? ' open' : ''}><summary>${icon('right', 14)}안 쓰는 연결 ${unused.length}</summary>`
    + `<ul class="conai-list vc-inputs" aria-label="안 쓰는 연결">${unused.map(edge => inputRow(node, edge, { label: '', link: links.get(edge.id), peers: 1, unused: true })).join('')}</ul></details>` : ''
  return section('insp-h-inputs', gen ? '입력 이미지' : '입력', groups + rest, gen && profileOf(node) ? `${used.length}/${fields.length}` : '')
}

// ---- the prompt: one field frame with text tabs (프롬프트 | 원문 | 전송) ----
const PROMPT_TABS = [['prompt', '프롬프트'], ['raw', '원문'], ['sent', '전송']]
/** The prompt tab a cut shows: the one the person last chose, else the text that is sent (원문 when it has text). */
export const promptTabOf = cut => s.insp.tab[cut.id] ?? (String(cut.data.raw ?? '').trim() ? 'raw' : 'prompt')
const heightStyle = node => s.insp.height[node.id] ? ` style="height:${s.insp.height[node.id]}px"` : ''
const chipsHtml = list => list.length ? `<div class="conai-chips vc-tokens" role="group" aria-label="@이름 넣기">${list.map(name => `<button type="button" class="conai-chip" data-token="${esc(name)}">@${esc(name)}</button>`).join('')}</div>` : ''
function promptHtml(cut) {
  const resolved = resolvePrompt(s.project, cut), table = labelTable(s.project, cut), raw = Boolean(String(cut.data.raw ?? '').trim()), tab = promptTabOf(cut)
  const described = resolved.errors.length || resolved.warnings.length ? ' aria-describedby="insp-prompt-issues"' : ''
  const tabs = PROMPT_TABS.map(([key, label]) => {
    const on = key === tab, note = raw && key === 'raw' ? '보내는 글' : raw && key === 'prompt' ? '보내지 않음' : ''
    return `<button type="button" role="tab" id="insp-ptab-${key}" data-ptab="${key}" aria-selected="${on}" aria-controls="insp-ppanel" tabindex="${on ? 0 : -1}"${note ? ` title="${note}"` : ''}${raw && key === 'prompt' ? ' class="unsent"' : ''}>${label}${raw && key === 'raw' ? '<span class="vc-tab-dot" aria-hidden="true"></span>' : ''}${note ? `<span class="vc-sr">, ${note}</span>` : ''}</button>`
  }).join('')
  // 전송 marks each label in its kind's colour, as the field marks the @name it came from.
  const read = tab === 'sent' ? readPrompt(s.project, cut, cut.data.raw || cut.data.prompt, table) : null
  const sent = read && `<pre class="vc-sent" tabindex="0" aria-label="전송될 프롬프트">${markedHtml(read.prompt, read.sent, true)}</pre>${resolved.table.length ? `<table class="label-table"><tbody>${resolved.table.map(row => `<tr><td><mark class="vc-ref k-${row.type}">${esc(row.label)}</mark></td><td>${esc(row.name)}</td><td>${ports[row.port]} · ${row.slot}</td></tr>`).join('')}</tbody></table>` : ''}`
  const panel = tab === 'sent' ? sent : inkHtml(cut, `<textarea data-field="${tab}" rows="10" aria-labelledby="insp-ptab-${tab}"${described}${heightStyle(cut)}>${esc(cut.data[tab] ?? '')}</textarea>`, 'insp-caret-line')
  // A reference the sent text never names: its warning puts the @name in, as its chip does.
  const unnamed = new Map(cutEdges(s.project, cut).map(edge => nameOf(edge.from)).filter(Boolean).map(name => [unusedReference(name), name]))
  const found = resolved.errors.map(message => `<p class="error">${esc(message)}</p>`).join('') + resolved.warnings.map(message => unnamed.has(message)
    ? `<button type="button" class="warning vc-warn-token" data-token="${esc(unnamed.get(message))}" title="${esc(`프롬프트에 넣기: @${unnamed.get(message)}`)}" aria-label="${esc(`${message}, 프롬프트에 넣기`)}">${icon('plus', 12)}<span>${esc(message)}</span></button>`
    : `<p class="warning">${esc(message)}</p>`).join('')
  return `<div class="vc-frame"><div class="vc-frame-tabs" role="tablist" aria-label="프롬프트 보기">${tabs}</div><div class="vc-frame-panel" role="tabpanel" id="insp-ppanel" aria-labelledby="insp-ptab-${tab}">${panel}</div></div>
    ${tab === 'sent' ? '' : `<p class="vc-caret-line" id="insp-caret-line" aria-hidden="true"></p>${chipsHtml([...new Set(table.map(row => row.name))])}`}<div id="insp-prompt-issues" class="vc-issues">${found}</div>`
}

// ---- head: the node, its state, its one main action and its menu ----
const headOf = (title, meta, end) => `<div class="vc-ihead"><div class="vc-ihead-text"><h2 class="vc-ihead-name" title="${esc(title)}">${esc(title)}</h2>${meta ? `<span class="vc-ihead-meta">${esc(meta)}</span>` : ''}</div>${end}</div>`
function headHtml(node) {
  const run = node.kind === 'cut' || node.kind === 'gen', state = run ? cutState(node) : null
  const kind = node.kind === 'cut' ? `${names.cut} ${cutOrder().indexOf(node.id) + 1}` : node.kind === 'gen' && outputKind(node) ? `${names.gen} · ${outputNames[outputKind(node)]}` : names[node.kind]
  const hash = node.data.ref?.source === 'library' ? node.data.ref.compositeHash : null
  const main = run ? cutActions(node, state)[0] : node.kind === 'video' && hash ? { action: 'extract', label: '프레임 추출' } : null
  // Generating is the panel's one filled button; cancelling or a locked run stays plain, as on the card.
  return headOf(node.data.name, [kind, state?.word].filter(Boolean).join(' · '), (main ? actionButton({ ...main, primary: main.primary || main.action === 'run' }) : '')
    + (!run && hash ? iconButton('open', '상세에서 열기', `data-action="open-detail" data-hash="${esc(hash)}"`) : '') + moreButton('node', '', `${node.data.name} 메뉴`))
}

// ---- the views ----
function cutBody(cut) {
  const id = `insp-${domId(cut.id)}`
  const trio = `<div class="vc-trio"><div class="vc-cell"><label for="${id}-mode">모드</label><select id="${id}-mode" data-field="mode">${MODES.map(mode => `<option ${mode === cut.data.mode ? 'selected' : ''}>${mode}</option>`).join('')}</select></div>
    <div class="vc-cell"><label for="${id}-duration">길이(초)</label><input id="${id}-duration" data-field="duration" type="number" min="1" step="any" value="${esc(cut.data.duration)}"></div>
    <div class="vc-cell"><label for="${id}-seed">시드</label><span class="vc-control"><input id="${id}-seed" data-field="seed" type="number" value="${esc(cut.data.seed)}">${iconButton('dice', '새 시드', 'data-action="seed"')}</span></div></div>`
  return section('insp-h-settings', '설정', cutSettingsHtml(cut) + trio) + inputsHtml(cut) + section('insp-h-prompt', '프롬프트', promptHtml(cut)) + historyHtml(cut) + reviewSection(cut)
}
const linkRow = (id, meta) => `<li class="conai-list-row sm"><button type="button" class="vc-row-link" data-action="select-node" data-node="${esc(id)}">${esc(nameOf(id) ?? id)}</button><span class="conai-row-meta">${esc(meta)}</span></li>`
function usesHtml(node) {
  const uses = s.project.edges.filter(edge => edge.from === node.id)
  return section('insp-h-uses', '쓰는 곳', uses.length ? `<ul class="conai-list" aria-labelledby="insp-h-uses">${uses.map(edge => linkRow(edge.to, ports[edge.port])).join('')}</ul>` : '', uses.length || '')
}
// What the generation node's profile says about writing its prompt, read-only and folded; the linked skill section comes from the server's node read.
function guideHtml(node, detail) {
  const profile = profileOf(node), link = profile?.guideSkill, guide = detail?.guide
  if (!profile?.instruction && !profile?.guide && !link) return ''
  return `<details class="vc-guide-box" data-keep="guide"><summary>${icon('right', 14)}가이드</summary>${profile.instruction ? `<p class="vc-guide">${esc(profile.instruction)}</p>` : ''}${profile.guide ? `<p class="vc-guide">${esc(profile.guide)}</p>` : ''}${link ? `<p>가이드 스킬 · ${esc(guide?.skill?.title ?? guideTitle(link))}</p>` : ''}${guide?.guideWarning ? `<p class="warning">${esc(guide.guideWarning)}</p>` : ''}${guide?.skill?.text ? `<p class="vc-guide">${esc(guide.skill.text)}</p>` : ''}</details>`
}
function genBody(node) {
  const profile = profileOf(node), nai = profile && adapterOf(profile) === 'nai', id = `insp-${domId(node.id)}`
  const detail = s.nodeDetail?.node.id === node.id ? s.nodeDetail.preview : null
  const sizes = profile?.nai?.sizes ?? [], size = node.data.size ?? sizes[0]?.label
  const prompted = nai || Boolean(profile?.promptFieldId), seeded = nai || Boolean(profile?.seedFieldId)
  const prompt = prompted ? `<div class="vc-frame"><textarea data-field="prompt" rows="10" aria-label="프롬프트"${heightStyle(node)}>${esc(node.data.prompt)}</textarea></div>` : ''
  const sizeRow = nai ? `<div class="vc-field-row"><label for="${id}-size">크기</label><select id="${id}-size" data-field="size">${sizes.map(entry => `<option ${entry.label === size ? 'selected' : ''}>${esc(entry.label)}</option>`).join('')}${size && !sizes.some(entry => entry.label === size) ? `<option selected>${esc(size)}</option>` : ''}</select></div>` : ''
  const fields = genFieldsHtml(node)
  const seedRow = seeded ? `<div class="vc-field-row"><label for="${id}-seed">시드</label><span class="vc-control"><input id="${id}-seed" data-field="seed" type="number" value="${esc(node.data.seed)}">${iconButton('dice', '새 시드', 'data-action="seed"')}</span></div>` : ''
  return section('insp-h-settings', '설정', genSettingsHtml(node)) + inputsHtml(node) + guideHtml(node, detail)
    + section('insp-h-prompt', prompted ? '프롬프트' : '값', prompt + sizeRow + (fields ? `<div class="vc-form">${fields}</div>` : '') + seedRow) + historyHtml(node) + usesHtml(node) + reviewSection(node)
}
const mediaBody = node => (node.data.check ? `<div class="conai-chips vc-asset">${assetBadge(node.data.check)}</div>` : '') + usesHtml(node) + reviewSection(node)
function detailView() {
  if (s.sel.length > 1) {
    const nodes = s.sel.map(nodeById).filter(Boolean)
    return { head: headOf(`${s.sel.length}개 선택`, '', iconButton('copy', '복제', 'data-action="duplicate-selected"') + iconButton('trash', '선택 삭제', 'data-action="remove-selected"')),
      body: `<ul class="conai-list" aria-label="선택한 노드">${nodes.map(node => linkRow(node.id, names[node.kind])).join('')}</ul>` }
  }
  const node = selected()
  if (!node) return { head: '', body: '<p class="conai-empty">선택한 노드가 없어.</p>' }
  return { head: headHtml(node), body: node.kind === 'cut' ? cutBody(node) : node.kind === 'gen' ? genBody(node) : mediaBody(node) }
}
function checksView() {
  const head = headOf('전체 체크', '', `<button class="primary" data-action="check-all">${s.checks ? '다시 체크' : '전체 체크'}</button>`)
  if (!s.checks) return { head, body: '' }
  // A row selects its node: the name is the button, a click anywhere else on the row does the same.
  // A long name ends in … inside its button (a flex button cannot cut its own text); the whole name is its tooltip.
  const row = (id, body, end) => `<li class="vc-check-row" data-select-node="${esc(id)}"><span class="vc-check-main"><button type="button" class="vc-row-link" data-action="select-node" data-node="${esc(id)}" title="${esc(nameOf(id) ?? id)}"><span class="conai-row-title">${esc(nameOf(id) ?? id)}</span></button>${body}</span><span class="vc-check-end">${end}</span></li>`
  const assets = Object.entries(s.checks.assets).map(([id, asset]) => row(id, asset.message ? `<p class="error">${esc(asset.message)}</p>` : '',
    assetBadge(asset) + (asset.status === 'changed' ? iconButton('refresh', '새 파일로 갱신', `data-action="fingerprint" data-item="${esc(id)}"`) + iconButton('check', '그대로 두기', 'data-action="keep"') : ''))).join('')
  const cuts = s.checks.cuts.map(cut => row(cut.id, issues(cut.errors, 'error') + issues(cut.warnings, 'warning'), cut.blocked ? badge('막힘', 'destructive') : badge('통과', 'ok'))).join('')
  return { head, body: section('insp-h-assets', '소재', assets ? `<ul class="conai-list" aria-labelledby="insp-h-assets">${assets}</ul>` : '') + section('insp-h-cuts', '생성', cuts ? `<ul class="conai-list" aria-labelledby="insp-h-cuts">${cuts}</ul>` : '') }
}
function extractionRow(item) {
  const id = `data-extraction="${esc(item.id)}"`, source = item.source?.nodeId ? nameOf(item.source.nodeId) : (take => take && takeTitle(take))(s.project.takes.find(take => take.id === item.source?.takeId))
  const tools = item.jobId && !isTerminal(item.status) ? `<div class="vc-take-tools">${iconButton('refresh', '상태 갱신', `data-action="extraction-status" ${id}`)}${iconButton('stop', '작업 취소', `data-action="extraction-cancel" ${id}`)}</div>` : ''
  return `<li class="vc-take"><span class="vc-tile wide vc-tile-icon" aria-hidden="true">${icon('frame')}</span><div class="vc-take-main"><div class="vc-take-title"><span class="conai-row-title">${esc(source ?? '프레임 추출')}</span>${statusBadge(item.status)}</div>${progressText(item.progress) ? `<span class="conai-row-meta">${progressText(item.progress)}</span>` : ''}</div>${tools}${item.error ? `<p class="error vc-take-error">${esc(item.error)}</p>` : ''}</li>`
}
function assistantView() {
  const proposals = (s.project?.takes ?? []).filter(take => take.status === 'proposed'), extractions = s.project?.extractions ?? []
  const batch = s.batch ? `<details data-keep="batch"><summary>적용 ${s.batch.applied.length} · 거절 ${s.batch.rejected.length}</summary><pre>${esc(JSON.stringify(s.batch, null, 2))}</pre></details>` : ''
  return { head: headOf('어시스턴트 변경', '', '<button data-action="undo">직전 배치 되돌리기</button>'),
    body: batch + section('insp-h-proposals', '생성 제안', proposals.length ? `<ul class="conai-list vc-takes" aria-labelledby="insp-h-proposals">${proposals.map(take => takeRow(take, { titled: true })).join('')}</ul>` : '', proposals.length || '')
      + section('insp-h-extractions', '프레임 추출 작업', extractions.length ? `<ul class="conai-list vc-takes" aria-labelledby="insp-h-extractions">${extractions.map(extractionRow).join('')}</ul>` : '', extractions.length || '') }
}
let shownFor = null, readKey = null, said = null
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
/** A prompt problem that appears while the person edits the open cut is read out (the list itself sits under the field); one there on selecting is not. */
function announce(node) {
  const key = node?.kind === 'cut' ? node.id : null, errors = key ? resolvePrompt(s.project, node).errors.join(' ') : ''
  if (key && said?.key === key && errors && said.errors !== errors) $('insp-live').textContent = errors
  said = { key, errors }
}
/** Redraws the detail panel; for the same selection the open sections, expanded rows, the prompt tab and the field being typed in survive. */
export function renderInspector() {
  $('workspace').classList.toggle('insp-closed', !s.inspectorOpen)
  $('toggle-inspector').setAttribute('aria-pressed', String(s.inspectorOpen))
  // A closed panel costs nothing: it is filled when it opens.
  if (!s.inspectorOpen) return
  document.querySelectorAll('#insp-tabs [data-tab]').forEach(tab => { const on = tab.dataset.tab === s.tab; tab.setAttribute('aria-selected', String(on)); tab.tabIndex = on ? 0 : -1 })
  const panel = $('insp-panel'), key = `${s.tab}|${s.selection}`
  panel.setAttribute('aria-labelledby', `insp-tab-${s.tab}`)
  if (shownFor !== key && panel.contains(document.activeElement)) document.activeElement.blur?.()
  shownFor = key
  panel.dataset.id = s.selection ?? ''
  const node = selected()
  if (s.tab === 'detail' && (node?.kind === 'cut' || node?.kind === 'gen') && !s.wf) ensureOptions().catch(() => {})
  if (s.tab === 'detail' && (node?.kind === 'cut' || node?.kind === 'gen')) readOpenNode(node)
  const view = s.tab === 'checks' ? checksView() : s.tab === 'assistant' ? assistantView() : detailView()
  $('insp-top').hidden = !view.head
  patch($('insp-top'), view.head, { neighbour: true })
  patch($('insp-body'), view.body, { neighbour: true })
  inkAll($('insp-body'))
  announce(s.tab === 'detail' && s.sel.length <= 1 ? node : null)
  lockRunButtons()
}
