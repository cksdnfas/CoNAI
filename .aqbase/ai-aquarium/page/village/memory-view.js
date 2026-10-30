/** Account-scoped world and resident lore; the assistant edits the same draft as the user. */
const $ = id => document.getElementById(id)
const LINE = /^\[([^\]]+)\]\s*([\s\S]*)$/
const el = (tag, text, cls) => Object.assign(document.createElement(tag), { textContent: text ?? '', ...(cls ? { className: cls } : {}) })

export function createMemoryView({ toast, publish = () => {}, onOpen = () => {} }) {
  const layer = $('memory'), body = $('memory-body')
  let api = null, token = 0, revision = 0, profileId = null, tab = 'recent', query = '', offset = 0, data = null, editing = null, dirty = false, saving = false
  let original = false, profiles = [], translationProfile = null
  let translationJob = null
  const shown = entry => !original && entry.translation ? entry.translation : entry
  const button = (label, fn) => { const b = el('button', label); b.type = 'button'; b.addEventListener('click', () => Promise.resolve().then(fn).catch(e => toast(e.message))); return b }
  const close = () => {
    if (translationJob) { void api.llm.cancel(translationJob).catch(e => toast(e.message)); toast('번역을 취소하는 중이야. 원문은 그대로야.'); return }
    if (dirty || saving) { toast('편집 중인 항목을 저장하거나 취소해줘.'); return }
    layer.hidden = true; token++; revision++; publish()
  }
  const request = (op, args = {}) => api.server({ op, profileId, ...args })
  const snapshot = () => layer.hidden ? null : { profileId, tab, query, offset, total: data?.total, dirty,
    entries: (data?.entries ?? []).map(e => ({ id: e.id, revision: e.revision, title: e.title, keys: e.keys.slice(0, 5), content: e.content.slice(0, 240), enabled: e.enabled, constant: e.constant, state: e.state })),
    recent: tab === 'recent' ? (data?.lines ?? []).slice(-8).map(e => ({ at: e.at, text: e.text.slice(0, 400) })) : undefined,
    segments: tab === 'events' ? (data?.segments ?? []).map(e => ({ id: e.id, at: e.at, day: e.day, summary: e.summary, pending: e.pending, count: e.events.length, preview: e.events.slice(0, 3).map(event => event.text.slice(0, 240)) })) : undefined,
    next: data?.next,
    draft: editing ? { ...editing, sources: undefined } : null }

  async function load() {
    const mine = ++token
    const result = await request(tab === 'recent' ? 'memory' : tab === 'events' ? 'memory-events' : 'lore-list', { query, offset, ...(tab === 'events' && offset ? { before: offset } : {}) })
    if (mine !== token) return
    data = result; render(); publish()
  }
  function edit(entry) { editing = { ...entry, keys: [...(entry.keys ?? [])] }; dirty = false; render(); publish() }
  function renderEditor() {
    const form = el('div', '', 'lore-form')
    const field = (label, input) => { const l = el('label', label); l.append(input); form.append(l); return input }
    const display = shown(editing), editingTranslation = display !== editing
    form.append(el('p', `모델 원문: ${editing.language ?? '언어 미지정'} · ${editingTranslation ? `표시 번역: ${editing.translation.language}` : '원문 편집'}`, 'lore-help'))
    if (editing.language && !editing.translation) form.append(el('p', '표시용 번역이 없어 원문을 보여줘. 번역 만들기로 다시 만들 수 있어.', 'lore-help'))
    const title = field('제목', document.createElement('input')); title.maxLength = 80; title.value = display.title
    // One keyword per line: a keyword may hold a comma, and a comma list split it into two on every edit.
    const keys = field('키워드 · 한 줄에 하나', document.createElement('textarea')); keys.rows = 3; keys.value = display.keys.join('\n')
    const content = field('내용', document.createElement('textarea')); content.name = 'content'; content.maxLength = 2000; content.rows = 8; content.value = display.content
    const state = field('상태', document.createElement('select'))
    for (const [value, label] of [['active', '유효'], ['completed', '완료'], ['superseded', '대체됨']]) { const o = el('option', label); o.value = value; state.append(o) }
    state.value = editing.state ?? 'active'
    const constant = document.createElement('input'); constant.type = 'checkbox'; constant.checked = !!editing.constant; field('항상 적용', constant)
    const enabled = document.createElement('input'); enabled.type = 'checkbox'; enabled.checked = editing.enabled !== false; field('활성', enabled)
    const sync = () => {
      const text = { title: title.value, keys: keys.value.split('\n').map(s => s.trim()).filter(Boolean), content: content.value }
      if (editingTranslation) editing.translation = { ...editing.translation, ...text }
      else if (JSON.stringify([editing.title, editing.keys, editing.content]) !== JSON.stringify([text.title, text.keys, text.content])) Object.assign(editing, text, { translation: null })
      Object.assign(editing, { state: state.value, constant: constant.checked, enabled: enabled.checked }); dirty = true; revision++; publish()
    }
    for (const input of [title, keys, content, state, constant, enabled]) input.addEventListener('input', sync)
    const row = el('div', '', 'lore-controls')
    const freeze = busy => { saving = busy; for (const control of form.querySelectorAll('input,textarea,select,button')) control.disabled = busy }
    const save = button('저장', async () => {
      if (saving) return
      sync(); freeze(true)
      try { await request('lore-save', { entry: editing }); dirty = false; editing = null; await load() }
      finally { freeze(false); publish() }
    })
    row.append(save, button('취소', () => { if (saving) return; editing = null; dirty = false; render(); publish() }))
    const selector = field('번역 프로필 · 모델 원문/표시 언어 설정 사용', document.createElement('select'))
    selector.append(Object.assign(el('option', '프로필 선택'), { value: '' }))
    for (const profile of profiles.filter(p => p.translation?.enabled)) selector.append(Object.assign(el('option', profile.name), { value: String(profile.id) }))
    selector.value = String(translationProfile ?? '')
    selector.addEventListener('change', () => { translationProfile = Number(selector.value) || null })
    row.append(button('번역 만들기', async () => {
      if (saving) return
      if (!translationProfile || !api.llm?.wait) throw new Error('번역 모델이 설정된 프로필과 최신 메인이 필요해.')
      sync(); freeze(true)
      const source = { title: editing.title, keys: [...editing.keys], content: editing.content }
      const profile = profiles.find(p => p.id === translationProfile)
      const translate = async (value, direction) => {
        const job = await api.llm.start({ requestId: crypto.randomUUID(), profileId: translationProfile, mode: 'text', message: JSON.stringify(value), translation: { only: true, direction, fields: ['title', 'keys.*', 'content'] } })
        translationJob = job.jobId
        let done
        try { done = await api.llm.wait(job.jobId) } finally { translationJob = null }
        if (done.status !== 'completed' || !done.result?.translation?.json) throw new Error(done.error || '번역하지 못했어. 원문은 그대로야.')
        return done.result.translation.json
      }
      try {
        const canonical = await translate(source, 'model')
        const koreanSource = profile.translation.displayLanguage === 'ko' && (source.content.match(/[가-힣]/g)?.length ?? 0) > (source.content.match(/[a-z]/gi)?.length ?? 0)
        const display = koreanSource ? source : await translate(canonical, 'display')
        // A translation can outgrow the limits (a long Korean title in English); say so instead of failing at 저장.
        const over = text => text.title.trim().length > 80 || text.content.trim().length > 2000 || text.keys.length > 20 || text.keys.some(k => k.trim().length > 100)
        if (over(canonical) || over(display)) throw new Error('번역이 길이 한도(제목 80자, 내용 2000자, 키워드 100자·20개)를 넘었어. 원문을 줄이고 다시 번역해줘.')
        Object.assign(editing, canonical, { language: profile.translation.modelLanguage, translation: { ...display, language: profile.translation.displayLanguage } })
        original = false; dirty = true
      } finally { freeze(false); render(); publish() }
    }))
    if (editing.id) {
      let armed = false
      const remove = button('삭제', async () => {
        if (saving) return
        if (!armed) { armed = true; remove.textContent = '이 항목을 영구 삭제'; return }
        freeze(true)
        try { await request('lore-delete', { id: editing.id, revision: editing.revision }); dirty = false; editing = null; await load() }
        finally { freeze(false); publish() }
      })
      row.append(remove)
    }
    form.append(row)
    if (editing.sources?.length) {
      const details = el('details'); details.append(el('summary', '기억의 출처'))
      for (const source of editing.sources) details.append(el('p', source.text ?? `이전 요약 · ${new Date(source.at).toLocaleString()}`))
      form.append(details)
    }
    body.append(form)
  }
  function render() {
    revision++
    body.replaceChildren()
    // Text tabs on one line, the original/translation switch at its end.
    const tabs = el('div', '', 'lore-tabs')
    if (!editing) {
      for (const [value, label] of (profileId === 0 ? [['lore', '세계관 로어북']] : [['recent', '최근 기억'], ['lore', '장기 로어북'], ['events', '사건 기록']])) {
        const b = button(label, async () => { tab = value; offset = 0; query = ''; await load() }); b.setAttribute('aria-pressed', String(tab === value)); tabs.append(b)
      }
    }
    const view = button(original ? '번역 보기' : '원문 보기', () => { if (saving) return; original = !original; render(); publish() }); view.className = 'lore-view'
    tabs.append(view)
    body.append(tabs)
    if (profileId === 0) body.append(el('p', '이 어항의 모든 주민·신관·GM 프로필에 공통 적용돼. 저장 후 새로 시작하는 요청부터 반영돼.', 'lore-help'))
    if (editing) { renderEditor(); return }
    if (tab !== 'recent') {
      const search = el('div', '', 'lore-controls'), input = document.createElement('input'); input.type = 'search'; input.maxLength = 200; input.placeholder = '제목·내용·키워드 검색'; input.setAttribute('aria-label', '기억 검색'); input.value = query
      const run = async () => { query = input.value; offset = 0; await load() }
      search.append(input, button('검색', run)); input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); run().catch(e => toast(e.message)) } })
      if (tab === 'lore') search.append(button('새 항목', () => { edit({ title: '', content: '', keys: [], constant: profileId === 0, enabled: true, state: 'active' }); dirty = true; publish() }))
      body.append(search)
    }
    if (tab === 'recent') {
      if (data?.backlogged) body.append(el('p', '기억 정리가 밀려 새 활동을 쉬고 있어. 원문은 보존 중이야.', 'lore-help'))
      if (data?.selected) {
        const chosen = data.selected, details = el('details', '', 'lore-entry')
        details.append(el('summary', `최근 요청에 선택한 어항 로어 · 세계관 ${chosen.worldCount}개 / 개인 ${chosen.personalCount}개`))
        details.append(el('p', [...chosen.world.map(e => `세계관: ${e.title}`), ...chosen.personal.map(e => `개인: ${e.title}`)].join('\n') || '선택한 항목이 없어.'))
        body.append(details)
      }
      if (data?.summary) body.append(el('p', !original && data.displaySummary ? data.displaySummary : data.summary, 'mem-summary'))
      for (const entry of data?.lines ?? []) {
        const visible = !original && entry.displayText ? entry.displayText : entry.text
        const [, meta = '', text = visible] = LINE.exec(visible) ?? [], row = el('div', '', 'mem-line')
        row.append(el('time', meta, 'num'), el('p', text)); body.append(row)
      }
      if (!data?.summary && !data?.lines?.length) body.append(el('p', '아직 기억이 없어.', 'mem-empty'))
    } else if (tab === 'events') {
      for (const segment of data?.segments ?? []) {
        const section = el('section', '', 'lore-entry')
        section.append(el('h3', segment.day == null ? '이전 기록 · 게임 날짜 없음' : `${segment.day}일째${segment.pending ? ' · 정리 중' : ''}`))
        if (segment.summary) section.append(el('p', !original && segment.display_summary ? segment.display_summary : segment.summary))
        const details = el('details'); details.append(el('summary', `근거 원문 ${segment.events.length}개 · 정리 ${new Date(segment.at).toLocaleString()}`))
        for (const event of segment.events) {
          if (event.skipped) details.append(el('p', `자동 정리 건너뜀 · ${event.reason}`, 'lore-help'))
          details.append(el('p', !original && event.display_text ? event.display_text : event.text))
        }
        section.append(details); body.append(section)
      }
      if (!data?.segments?.length) body.append(el('p', '저장된 사건 묶음이 없어.', 'mem-empty'))
    } else {
      body.append(el('p', `${data?.total ?? 0}개 항목 · 한 책에 최대 500개`, 'lore-help'))
      for (const entry of data?.entries ?? []) {
        const display = shown(entry)
        const row = el('div', '', 'lore-entry')
        row.append(button(`${entry.enabled ? '' : '[꺼짐] '}${display.title}${entry.constant ? ' · 항상 적용' : ''}${entry.state === 'completed' ? ' · 완료' : entry.state === 'superseded' ? ' · 대체됨' : ''}`, () => edit(entry)), el('p', display.content.slice(0, 240)), el('small', display.keys.join(' · ')))
        body.append(row)
      }
    }
    if (tab !== 'recent') {
      const paging = el('div', '', 'lore-controls')
      if (offset) paging.append(button('처음', async () => { offset = 0; await load() }))
      if (data?.next != null) paging.append(button('다음', async () => { offset = data.next; await load() }))
      body.append(paging)
    }
  }
  async function open(id, name, nextTab = 'recent', search = '', page = 0) {
    if (!api) return
    if (dirty || saving) { toast('편집 중인 항목을 저장하거나 취소해줘.'); return }
    onOpen()
    const opening = ++token
    try { profiles = await api.server({ op: 'profiles' }) } catch (error) { toast(error.message); return }
    if (opening !== token) return
    translationProfile = profiles.find(p => p.id === Math.abs(id) && p.translation?.enabled)?.id // the DM's book is -its id ?? profiles.find(p => p.translation?.enabled)?.id ?? null
    profileId = id; tab = id === 0 ? 'lore' : nextTab; query = search; offset = page; editing = null
    layer.hidden = false; $('memory-title').textContent = id === 0 ? '어항 세계관 로어북' : `${name}의 기억`; body.replaceChildren()
    try { await load() } catch (error) { toast(error.message); close() }
  }
  async function prepare(args, name) {
    if (dirty || saving) throw new Error('편집 중인 항목을 저장하거나 취소해줘.')
    await open(args.profileId, name, 'lore')
    if (layer.hidden || profileId !== args.profileId) throw new Error('로어북을 먼저 열어줘.')
    const mine = token
    const existing = args.id ? await request('lore-get', { id: args.id }) : { title: '', content: '', keys: [], constant: profileId === 0, enabled: true, state: 'active' }
    if (mine !== token || profileId !== args.profileId) throw new Error('열린 로어북이 바뀌었어. 다시 시도해줘.')
    if (!existing) throw new Error('항목이 없어. 목록을 다시 확인해줘.')
    const patch = Object.fromEntries(['title', 'content', 'keys', 'language', 'translation', 'constant', 'enabled', 'state'].filter(k => args[k] !== undefined).map(k => [k, args[k]]))
    if (!args.translation && ['title', 'content', 'keys', 'language'].some(k => args[k] !== undefined)) patch.translation = null
    edit({ ...existing, ...patch }); dirty = true; publish()
  }

  $('memory-close').addEventListener('click', close)
  window.addEventListener('pagehide', () => { if (translationJob) void api.llm.cancel(translationJob).catch(() => {}) })
  layer.querySelector('.dim').addEventListener('click', close)
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !layer.hidden) close() })
  return { connect(next) { api = next }, open, prepare, snapshot, get dirty() { return dirty }, get revision() { return revision } }
}
