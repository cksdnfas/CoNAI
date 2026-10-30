import { svg } from '../ui/dom.js'
import { P } from '../guild/common.js'
import { budgetText } from '../../shared/village-settings.mjs'

/*
 * The research window: a person writes a topic, names published post IDs and picks 2–3 residents, and presses 시작.
 * The server (`research-start`, `research-cancel`, `research-draft`) runs it and the village state carries `research`.
 * The assistant only fills the form (`ai-aquarium.research_prepare`). A finished result goes to the app's own
 * knowledge change proposals (pending review), never straight to a post.
 */
export const RESEARCH = { topic: 500, posts: 8, residents: [2, 3], rounds: 3,
  /**
   * The server's time bounds (`server/research/activity.mjs`) as [min, max, default] in ms. How many tool rounds a
   * resident's turn takes is the app's tool round limit (Settings › 채팅 › 자원 › 도구 사용), not set here.
   */
  budget: { timeoutMs: [1000, 600000, 300000], totalTimeoutMs: [1000, 7200000, 1800000] } }
const TIMES = [['timeoutMs', 'research-turn-time'], ['totalTimeoutMs', 'research-total-time']]
const defaultBudget = () => Object.fromEntries(TIMES.map(([k]) => [k, RESEARCH.budget[k][2]]))
const inBudget = (k, v) => Number.isSafeInteger(v) && v >= RESEARCH.budget[k][0] && v <= RESEARCH.budget[k][1]
const minutes = ms => Number.isFinite(ms) ? String(Math.round(ms / 6000) / 10) : ''
const STATUS = { running: '진행 중', completed: '끝남 · 검증 전 결과', cancelled: '중단됨', failed: '실패' }
const BOOK = 'M5 4.5h11a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11M9 8.5h6M9 11.5h4'
const PROPOSALS = '/posts?kind=knowledge&section=proposals'

/** `"12, 7 30"` → `[12, 7, 30]`; null when any entry is not a positive integer. */
export function parsePostIds(text) {
  const parts = String(text ?? '').split(/[\s,]+/).filter(Boolean)
  if (parts.some(p => !/^\d+$/.test(p) || Number(p) < 1 || !Number.isSafeInteger(Number(p)))) return null
  return [...new Set(parts.map(Number))]
}

export function createResearchView({ app, request, toast, publish, onOpen }) {
  const stage = document.getElementById('stage')
  const layer = document.createElement('div'); layer.id = 'research'; layer.className = 'menu-layer life-layer'; layer.hidden = true
  layer.innerHTML = `<div class="dim"></div><section class="menu gw life-panel research-panel" role="dialog" aria-modal="true" aria-labelledby="research-heading">
    <header class="gw-head"><span class="gw-icon">${svg(BOOK)}</span><h2 id="research-heading">자료 조사</h2><span class="grow"></span><span id="research-state" class="gw-status"></span><button type="button" id="research-close" class="ib" data-tip="닫기" aria-label="닫기">${svg(P.close)}</button></header>
    <div id="research-draft" class="life-draft" role="region" aria-label="준비된 조사" hidden><span class="life-name"><b>어시스턴트가 조사 초안을 채웠어</b><small>확인하고 시작을 눌러야 실행돼.</small></span><button type="button" id="research-discard" class="btn">초안 지우기</button></div>
    <div class="life-body">
      <div id="research-current"></div>
      <section id="research-form" class="life-sec research-form" aria-label="새 조사"><h4>새 조사</h4>
        <label for="research-topic">주제</label><textarea id="research-topic" rows="3" maxlength="${RESEARCH.topic}" placeholder="예: 우리 게시판에 정리된 조명 설정의 차이점"></textarea>
        <label for="research-posts">읽을 게시글 ID <small>공개된 글 1–${RESEARCH.posts}개 · 쉼표나 띄어쓰기로 구분</small></label><input id="research-posts" inputmode="numeric" autocomplete="off" placeholder="예: 12, 30">
        <span class="research-label">참여 주민 <small>2–3명</small></span><div id="research-residents" class="life-opts" role="group" aria-label="참여 주민"></div>
        <div class="life-opts"><span class="research-label">토론</span><div class="stepper"><button type="button" id="research-rounds-down" aria-label="토론 회차 줄이기">−</button><output id="research-rounds" class="num">1</output><button type="button" id="research-rounds-up" aria-label="토론 회차 늘리기">+</button></div><span class="set-unit">회차</span></div>
        <details id="research-advanced" class="research-advanced"><summary>제한 시간</summary>
          <label for="research-turn-time">한 차례 제한 시간 <small>분 · 최대 10</small></label><input id="research-turn-time" type="number" inputmode="decimal" min="0.1" max="10" step="any" autocomplete="off">
          <label for="research-total-time">전체 제한 시간 <small>분 · 최대 120</small></label><input id="research-total-time" type="number" inputmode="decimal" min="0.1" max="120" step="any" autocomplete="off">
        </details>
        <p id="research-engine-note" class="life-note">지정한 게시글만 읽어. 주민 프로필에 정해진 엔진(직접 API·Claude Code·Codex·Pi)을 그대로 써. 프로필 설정이 조사에 맞지 않으면 앱이 이유와 함께 거절해. 주민 한 차례의 도구 사용 횟수는 앱의 도구 호출 반복 한도(설정 › 채팅 › 자원 › 도구 사용)를 따라. 시작하면 그 엔진의 사용량이 생겨. 결과는 검증되지 않은 초안이고 자동으로 게시하지 않아.</p>
        <p id="research-planned-budget" class="life-note"></p>
        <p id="research-invalid" class="life-note warn" hidden></p>
        <div class="life-opts"><button type="button" id="research-start" class="btn main">조사 시작</button></div>
      </section>
    </div></section>`
  stage.append(layer)
  const $ = id => document.getElementById(id)
  const blank = () => ({ topic: '', posts: '', profileIds: [], rounds: 1, budget: defaultBudget() })
  const ui = { form: blank(), prepared: false, busy: false, requestId: null, requestKey: '', proposal: null, proposalError: null }
  let signature = '', opener = null

  const research = () => app.world?.research ?? null
  const running = () => research()?.status === 'running'
  const nameOf = id => app.world?.residents.find(r => r.profileId === id)?.name ?? `#${id}`
  const h = (tag, cls, ...kids) => { const e = document.createElement(tag); if (cls) e.className = cls; e.append(...kids.filter(k => k !== null && k !== undefined && k !== false)); return e }
  const btn = (label, run, { main = false, id = '', disabled = false } = {}) => { const b = h('button', main ? 'btn main' : 'btn', label); b.type = 'button'; if (id) b.id = id; b.disabled = disabled || ui.busy; b.addEventListener('click', run); return b }
  async function busy(run) {
    if (ui.busy) return
    ui.busy = true; render()
    try { await run() } catch (error) { toast(error.message) } finally { ui.busy = false; render() }
  }

  /** What 시작 sends, or the reason it cannot be sent yet. */
  function input() {
    const f = ui.form, topic = f.topic.trim(), postIds = parsePostIds(f.posts)
    const error = !topic ? '주제를 써줘.' : topic.length > RESEARCH.topic ? `주제는 ${RESEARCH.topic}자까지야.`
      : !postIds || !postIds.length || postIds.length > RESEARCH.posts ? `게시글 ID를 1–${RESEARCH.posts}개 써줘.`
        : f.profileIds.length < RESEARCH.residents[0] || f.profileIds.length > RESEARCH.residents[1] ? '참여 주민을 2–3명 골라줘.'
          : TIMES.some(([k]) => !inBudget(k, f.budget[k])) ? '제한 시간은 한 차례 10분, 전체 120분까지 정해줘.' : ''
    return { error, body: error ? null : { topic, postIds, profileIds: [...f.profileIds], rounds: f.rounds, budget: { ...f.budget } } }
  }
  /** One request ID per exact input: a lost answer is resent with the same ID, a changed form gets a new one. */
  function requestIdOf(body) {
    const key = JSON.stringify(body)
    if (key !== ui.requestKey) { ui.requestKey = key; ui.requestId = `research:${crypto.randomUUID()}` }
    return ui.requestId
  }
  const start = () => busy(async () => {
    const { error, body } = input()
    if (error) throw new Error(error)
    await request('research-start', { ...body, requestId: requestIdOf(body), saveId: app.world.save?.id, revision: app.world.revision })
    ui.form = blank(); ui.prepared = false; ui.requestId = null; ui.requestKey = ''; syncForm(); publish()
  })
  const cancel = activityId => busy(() => request('research-cancel', { activityId }))
  /** A person's rerun: the finished activity's inputs go back into the form with a fresh request identity; nothing runs. */
  function rerun(r) {
    const l = r.limits ?? {}
    const budget = Object.fromEntries(TIMES.map(([k]) => [k, inBudget(k, l[k]) ? l[k] : RESEARCH.budget[k][2]]))
    ui.form = { topic: r.topic ?? '', posts: (r.postIds ?? []).join(', '), profileIds: [...(r.profileIds ?? [])], rounds: r.rounds ?? 1, budget }
    ui.prepared = false; ui.requestId = null; ui.requestKey = ''
    syncForm(); publish(); $('research-topic').focus({ preventScroll: true })
  }
  const navigate = path => busy(async () => {
    if (typeof app.api?.navigation?.open !== 'function') throw new Error('앱 페이지로 이동하려면 최신 CoNAI가 필요해.')
    await app.api.navigation.open(path)
  })
  /**
   * The result draft goes to the app's knowledge change proposals as a pending, unpublished document. The key is the
   * activity (a server UUID), so a resend after a lost answer returns the same proposal instead of a second one.
   */
  const propose = activityId => busy(async () => {
    const { research: r } = await app.api.server({ op: 'research-draft', activityId })
    if (!r?.draft) throw new Error('보낼 결과 초안이 없어.')
    // Citations are the excerpts the run actually read, in the app's knowledge source shape.
    const sources = (r.sources ?? []).map(s => ({ kind: 'post', postId: s.postId, commentId: null, url: null, contentVersion: s.contentVersion ?? null, contentHash: null,
      revision: s.revision, start: s.offset, end: s.end, quote: s.excerpt, observedAt: null }))
    const response = await app.api.app.fetch('/api/posts/knowledge/proposals', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'create', title: r.draft.title, body: r.draft.body, status: 'draft', sources, idempotencyKey: `research:${activityId}:draft` }) })
    const result = await response.json().catch(() => null)
    if (!response.ok) {
      const reason = typeof result?.error === 'string' ? result.error : `검토 요청을 만들지 못했어 (${response.status}).`
      // The app re-checks every citation against the live post; an edited, hidden or deleted source is rejected as-is.
      const stale = /출처|인용/.test(reason)
      ui.proposalError = { activityId, text: stale ? `${reason} 조사 뒤에 근거 게시글이 수정·비공개·삭제됐거나 지금 볼 수 없어서 이 결과는 보낼 수 없어. '이 주제로 다시 준비'를 누르고 지금 볼 수 있는 공개 게시글로 다시 조사해줘.` : reason }
      throw new Error(ui.proposalError.text)
    }
    ui.proposal = { activityId, id: result?.data?.id ?? null }; ui.proposalError = null
    toast('결과 초안을 문서 변경 제안으로 보냈어. 게시판에서 검토해줘.'); publish()
  })

  /* The form: fixed fields that keep focus; only the resident picker and the buttons follow the state. */
  function syncForm() {
    $('research-topic').value = ui.form.topic; $('research-posts').value = ui.form.posts; $('research-rounds').textContent = String(ui.form.rounds)
    for (const [k, id] of TIMES) $(id).value = minutes(ui.form.budget[k])
    // A drafted time is not hidden behind the collapsed section.
    if (TIMES.some(([k]) => ui.form.budget[k] !== RESEARCH.budget[k][2])) $('research-advanced').open = true
    renderForm()
  }
  function renderForm() {
    const residents = app.world?.residents ?? []
    ui.form.profileIds = ui.form.profileIds.filter(id => residents.some(r => r.profileId === id))
    $('research-residents').replaceChildren(...(residents.length ? residents.map(r => {
      const on = ui.form.profileIds.includes(r.profileId), b = btn(r.name, () => {
        ui.form.profileIds = on ? ui.form.profileIds.filter(id => id !== r.profileId) : [...ui.form.profileIds, r.profileId]
        changed()
      }, { disabled: !on && ui.form.profileIds.length >= RESEARCH.residents[1] })
      b.setAttribute('aria-pressed', String(on)); b.dataset.profileId = String(r.profileId); return b
    }) : [h('span', 'life-note', '주민부터 초대해줘.')]))
    $('research-rounds-down').disabled = ui.form.rounds <= 1; $('research-rounds-up').disabled = ui.form.rounds >= RESEARCH.rounds
    const b = ui.form.budget
    const turns = ui.form.profileIds.length * ui.form.rounds, valid = TIMES.every(([k]) => inBudget(k, b[k]))
    $('research-planned-budget').textContent = turns && valid
      ? `시작하면 주민 ${turns}차례와 마지막 요약 1회(도구 없음)를 실행해. 한 차례의 도구 사용은 앱의 도구 호출 반복 한도를 따르고, 한 차례 ${minutes(b.timeoutMs)}분·전체 ${minutes(b.totalTimeoutMs)}분이 지나면 멈춰. 실제 비용은 각 프로필의 엔진과 요금제에 따라 달라.`
      : '주민을 고르면 실행 계획을 보여 줘.'
    const { error } = input(), invalid = $('research-invalid')
    const typed = ui.form.topic || ui.form.posts || ui.form.profileIds.length
    invalid.hidden = !error || !typed; invalid.textContent = error
    $('research-form').hidden = running()
    $('research-start').disabled = ui.busy || !!error || running() || !app.api
    $('research-draft').hidden = !ui.prepared
  }
  function changed() { renderForm(); publish() }
  $('research-topic').addEventListener('input', event => { ui.form.topic = event.target.value; changed() })
  $('research-posts').addEventListener('input', event => { ui.form.posts = event.target.value; changed() })
  $('research-rounds-down').addEventListener('click', () => { ui.form.rounds = Math.max(1, ui.form.rounds - 1); syncForm(); publish() })
  $('research-rounds-up').addEventListener('click', () => { ui.form.rounds = Math.min(RESEARCH.rounds, ui.form.rounds + 1); syncForm(); publish() })
  for (const [k, id] of TIMES) $(id).addEventListener('input', event => { const v = event.target.value.trim(); ui.form.budget = { ...ui.form.budget, [k]: v === '' ? NaN : Math.round(Number(v) * 60000) }; changed() })
  $('research-start').addEventListener('click', start)
  $('research-discard').addEventListener('click', () => { ui.form = blank(); ui.prepared = false; syncForm(); publish() })

  /**
   * Actual use. Engines report different native counts — direct API calls or Claude Code/Pi agent turns, Codex
   * neither — so the server's known counters are named for what they are, jobs without a count are said to be
   * unmetered, and nothing unreported is shown as 0. The limit per turn is the app's tool round limit.
   */
  function budget(r) {
    const u = r.usage ?? {}
    // Activities from before 3.17 only have `modelCalls`.
    const calls = u.knownModelCalls ?? u.modelCalls ?? 0, turns = u.knownTurns ?? 0, unmetered = u.unmeteredJobs ?? 0
    const parts = [calls && `API 호출 ${calls}`, turns && `에이전트 차례 ${turns}`, unmetered && `집계 안 된 차례 ${unmetered}`].filter(Boolean)
    const text = `${parts.join('·') || 'API 호출·에이전트 차례 0'} · 도구 호출 ${typeof u.toolCalls === 'number' ? `${u.toolCalls}회` : '집계 안 됨'}`
    return { text, stop: r.limited ? '일부 주민은 앱의 도구 호출 반복 한도에 닿아 그 차례 발언이 부분 결과로 남았어. 다른 주민의 차례는 그대로 이어져. 표시된 발언을 확인해줘.' : '' }
  }
  /** The current or last activity: phase, sources that were actually read, discussion, result and stop/failure. */
  function renderCurrent() {
    const box = $('research-current'), r = research()
    if (!r) { box.replaceChildren(h('p', 'gw-empty', '아직 조사한 적이 없어. 주제와 게시글을 정해서 시작해 봐.')); return }
    const sources = Array.isArray(r.sources) ? r.sources : [], discussion = Array.isArray(r.discussion) ? r.discussion : []
    const { text: used, stop } = budget(r)
    // A non-failed activity with an error had parts withheld (e.g. a source is no longer accessible); say why.
    const failure = r.status === 'failed' ? r.error || '조사가 실패했어.'
      : r.error ? `${r.error}${r.status === 'running' ? '' : ' 그래서 지금 볼 수 없는 근거·토론·결과 초안은 숨겼어. 게시글 접근을 확인하고 다시 조사해줘.'}` : ''
    const proposalError = ui.proposalError?.activityId === r.activityId ? ui.proposalError.text : ''
    const head = h('div', 'life-title', h('b', '', r.topic), h('small', '', `${STATUS[r.status] ?? r.status} · 토론 ${r.round ?? 0}/${r.rounds}회차 · ${(r.profileIds ?? []).map(nameOf).join(', ')}`))
    head.id = 'research-phase'; head.dataset.status = r.status
    const notes = [
      Object.assign(h('p', 'life-note', used), { id: 'research-usage' }),
      stop ? Object.assign(h('p', 'life-note warn', stop), { id: 'research-budget' }) : null,
      failure ? Object.assign(h('p', 'life-note warn', failure + (r.budgetDiagnostic ? ` ${budgetText(r.budgetDiagnostic)} · 접수 시도 ${r.attempts ?? 0} · 호출 한도는 프로필/호스트 설정을 따라.` : '')), { id: 'research-error' }) : null,
      proposalError ? Object.assign(h('p', 'life-note warn', proposalError), { id: 'research-proposal-error' }) : null,
      r.status === 'cancelled' ? h('p', 'life-note', '중단된 조사야. 새로 시작하려면 아래에서 다시 정해줘.') : null,
      r.status !== 'running' && (r.status === 'failed' || !r.error) && !sources.length ? Object.assign(h('p', 'life-note warn', '실제로 읽은 근거가 없어. 게시글이 공개 상태이고 접근할 수 있는지 확인해줘.'), { id: 'research-empty' }) : null,
    ]
    const actions = h('div', 'life-opts')
    if (r.status === 'running') actions.append(btn('조사 중단', () => cancel(r.activityId), { id: 'research-cancel' }))
    if (r.draft && r.status === 'completed') {
      const sent = ui.proposal?.activityId === r.activityId
      actions.append(sent ? btn('변경 제안 열기', () => navigate(PROPOSALS), { main: true, id: 'research-proposals' })
        : btn('결과를 검토 요청으로 보내기', () => propose(r.activityId), { main: true, id: 'research-propose' }))
    }
    if (r.status === 'completed' || r.status === 'failed') actions.append(btn('이 주제로 다시 준비', () => rerun(r), { id: 'research-rerun' }))
    const sourceRows = sources.map(s => {
      const open = btn(`게시글 #${s.postId}`, () => navigate(`/posts?post=${s.postId}`)); open.classList.add('research-source-open'); open.dataset.postId = String(s.postId)
      const where = [`판 ${s.revision}`, s.contentVersion != null ? `지식 v${s.contentVersion}` : '', Number.isInteger(s.offset) ? `${s.offset}–${s.end}자` : ''].filter(Boolean).join(' · ')
      return h('div', 'research-source', open, h('small', '', where), h('blockquote', '', String(s.excerpt ?? '')))
    })
    const talk = discussion.map(d => h('div', 'research-line', h('b', '', `${nameOf(d.profileId)} · ${d.round}회차${d.sourceIndexes?.length ? ` · 근거 ${d.sourceIndexes.map(i => `#${sources[i]?.postId ?? '?'}`).join(', ')}` : ''}${d.limited ? ' · 한도 도달, 부분 발언' : ''}`), h('span', '', String(d.text ?? ''))))
    box.replaceChildren(h('section', 'life-sec', h('h4', '', '지금 조사'), head, ...notes.filter(Boolean), actions),
      h('section', 'life-sec', h('h4', '', `읽은 근거 ${sources.length}`), ...(sources.length ? sourceRows : [h('p', 'life-note', r.status === 'running' ? '아직 읽은 자료가 없어.' : '없음')])),
      h('section', 'life-sec', h('h4', '', '토론'), ...(talk.length ? talk : [h('p', 'life-note', r.status === 'running' ? '근거를 모으면 토론이 시작돼.' : '토론 기록이 없어.')])),
      ...(r.draft ? [h('section', 'life-sec', h('h4', '', '결과 초안 · 검토 전'), h('div', 'research-line', h('span', '', r.draft.body)))] : []))
  }
  function render() {
    if (layer.hidden) return
    const r = research()
    $('research-state').textContent = r ? STATUS[r.status] ?? r.status : ''
    renderCurrent(); renderForm()
  }

  function open() {
    onOpen?.()
    if (layer.hidden) { opener = document.activeElement; layer.hidden = false; syncForm() }
    signature = ''; render(); publish()
    $('research-topic').focus({ preventScroll: true })
  }
  function close() {
    if (layer.hidden) return
    layer.hidden = true
    if (opener?.isConnected) opener.focus({ preventScroll: true })
    publish()
  }
  $('research-close').addEventListener('click', close); layer.querySelector('.dim').addEventListener('click', close)
  document.addEventListener('keydown', event => { if (!layer.hidden && event.key === 'Escape') close() })

  return {
    open, close,
    /** The assistant's form: nothing runs until a person presses 조사 시작. */
    prepare(args) {
      if (!app.world) throw new Error('마을을 불러오는 중이야.')
      if (running()) throw new Error('이미 진행 중인 조사가 있어. 끝나거나 중단된 뒤에 준비해줘.')
      const known = args.profileIds?.filter(id => !app.world.residents.some(r => r.profileId === id)) ?? []
      if (known.length) throw new Error(`마을에 없는 주민이야: ${known.join(', ')}`)
      ui.form = { topic: args.topic ?? ui.form.topic, posts: args.postIds ? args.postIds.join(', ') : ui.form.posts, profileIds: args.profileIds ? [...new Set(args.profileIds)] : ui.form.profileIds, rounds: args.rounds ?? ui.form.rounds,
        budget: { ...ui.form.budget, ...Object.fromEntries(TIMES.filter(([k]) => args.budget?.[k] !== undefined).map(([k]) => [k, args.budget[k]])) } }
      ui.prepared = true
      open(); syncForm(); publish()
      const { error } = input()
      return { prepared: true, ready: !error, missing: error || null }
    },
    get dirty() { return ui.prepared },
    /** Another save slot: its residents and activities are not this one's, so the form and retry identity stay behind. */
    reset() { ui.form = blank(); ui.prepared = false; ui.requestId = null; ui.requestKey = ''; ui.proposal = null; ui.proposalError = null; signature = ''; syncForm() },
    update() {
      if (layer.hidden) return
      const r = research()
      const sig = JSON.stringify([r, app.world?.residents.map(x => [x.profileId, x.name]), !!app.api])
      if (sig !== signature) { signature = sig; render() }
    },
    snapshot() {
      const r = research()
      return {
        open: !layer.hidden,
        form: ui.prepared ? { topic: ui.form.topic, postIds: parsePostIds(ui.form.posts), profileIds: ui.form.profileIds, rounds: ui.form.rounds, budget: { ...ui.form.budget }, missing: input().error || null } : null,
        activity: r ? { activityId: r.activityId, status: r.status, topic: r.topic, postIds: r.postIds, profileIds: r.profileIds, rounds: r.rounds, round: r.round, error: r.error ?? null, limits: r.limits ?? null, usage: r.usage ?? null,
          sources: (r.sources ?? []).slice(0, 8).map(s => ({ postId: s.postId, revision: s.revision, contentVersion: s.contentVersion ?? null, offset: s.offset, end: s.end, excerpt: String(s.excerpt ?? '').slice(0, 240) })),
          discussionCount: (r.discussion ?? []).length, draftReady: !!r.draft, limited: r.limited === true, proposalSent: ui.proposal?.activityId === r.activityId } : null,
        note: `조사는 ai-aquarium.research_prepare로 주제·게시글 ID(공개 글 1–8개)·주민(2–3명, 프로필에 정해진 엔진 그대로)·토론 회차(1–3)·제한 시간(budget: timeoutMs 한 차례, totalTimeoutMs 전체, ms)만 채우고, 사람이 조사 시작을 눌러야 실행돼. 사용량은 엔진이 알려 준 수만 있어: usage.knownModelCalls(직접 API 호출)·usage.knownTurns(Claude Code/Pi 에이전트 차례)·usage.unmeteredJobs(수를 알려 주지 않은 Codex 등의 차례)이고, usage.modelCalls·usage.turns는 모든 차례가 그 단위일 때만 숫자, 아니면 null이야. 주민 한 차례의 도구 사용 횟수는 앱의 도구 호출 반복 한도(설정 › 채팅 › 자원 › 도구 사용)를 따르고 이 창에서 정하지 않아. 결과는 검증되지 않은 초안이며 사람이 검토 요청을 보내면 게시판의 문서 변경 제안으로 들어가 기존 검토를 거쳐. 자동 게시하지 않아.`,
      }
    },
  }
}
