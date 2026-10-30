import { STAFF, WEEKDAYS, shiftsOf } from '../../shared/schedule.mjs'
import { createDrawPicker, NO_DRAW } from '../ui/draw-picker.js'
import { node, setOptions } from '../ui/dom.js'
import { ROLE, COMBAT_AI, SHIFT_TIMES } from './common.js'

export function createSettings({ guild, layer, face, status, publish, request, toast, openMenu, close }) {
  const $ = id => document.getElementById(id)
  /* Settings: three pages of 설정 (모험 · 전투 · 역할). Ids stay, so drafts and the assistant work the same. */
  const row = (label, control, help = '', extra = '') => `<div class="set-row"${extra}><span class="set-label"${help ? ` data-tip="${help}"` : ''}>${label}</span><div class="set-control">${control}</div></div>`
  const num = (key, label, min, max, step = 1, unit = '', help = '') => row(`<label for="rpg-${key}">${label}</label>`,
    `<div class="rpg-num"><button type="button" data-num="${key}" data-by="-1" aria-label="${label} 줄이기">−</button>` +
    `<input id="rpg-${key}" type="number" min="${min}" max="${max}" step="${step}">` +
    `<button type="button" data-num="${key}" data-by="1" aria-label="${label} 늘리기">+</button></div>` +
    `${unit ? `<span class="set-unit">${unit}</span>` : ''}`, help)
  const toggle = (key, label, help) => row(`<label for="rpg-${key}">${label}</label>`, `<label class="switch"><input id="rpg-${key}" type="checkbox"><i></i></label>`, help)
  const pick = (key, label, help) => row(`<label for="rpg-${key}">${label}</label>`, `<select id="rpg-${key}"></select>`, help)
  const pages = {
    adventure: `<section class="set-group"><h3>모험</h3>${toggle('enabled', '자율 모험', '켜면 주민 모델이 원정·신탁 방문 여부를 선택할 수 있어. 보급·장비도 모델이 직접 골라.')}
        ${pick('dm', 'GM', '세계와 던전을 함께 맡는 프로필이야. GM 창의 대화 상대이고, 층을 다 공략하면 다음 층을 설계해.')}${num('maxZones', '최대 층', 3, 30, 1, '층')}${num('dmDailyLimit', '자동 GM 하루 한도', 1, 10, 1, '회', '자동 층은 완성 때, 생활 계획·심사는 요청 때 세. 플레이어가 GM 제안을 적용하는 작업은 한도에서 제외돼.')}</section>
      <section id="rpg-art-section" class="set-group"><h3>게임 그림</h3>${row('그림 방식', '<div id="rpg-art-service" class="seg"><button type="button" data-service="off">안 그림</button><button type="button" data-service="novelai">NovelAI</button><button type="button" data-service="comfyui">ComfyUI</button></div>', '선택한 서비스로 새 몬스터·수호자·아이템·층의 그림을 자동 생성해. NovelAI 연결은 자동 감지하지 않아. 외부 서비스 요금은 별도야.')}
        <div id="rpg-art-comfy" class="set-row draw-comfy" hidden><span class="set-label">워크플로우</span><div class="set-control"><select id="rpg-art-workflow" aria-label="게임 그림 워크플로우"></select><select id="rpg-art-field" aria-label="프롬프트를 넣을 입력칸"></select></div></div>
        ${num('assetDaily', '하루 한도', 0, 200, 1, '<span id="rpg-artToday"></span>', '자동 그림의 하루 한도야. GM 카드의 새 층·물품·외형 편집·다시 그리기는 모두 제외돼. 한 장씩 따로 접수해.')}</section>
      <section class="set-group"><h3>속도</h3>${num('stepMs', '탐험 한 칸', 500, 3000, 100, 'ms')}${num('roundMs', '전투 한 턴', 500, 6000, 100, 'ms')}</section>
      <section class="set-group"><h3>사망</h3>${num('reviveSeconds', '부활 대기', 10, 600, 10, '초')}${num('xpLoss', '경험치 손실', 0, 100, 1, '%')}${num('goldLoss', '소지금 손실', 0, 100, 1, '%')}${num('gearLoss', '장비 소실 확률', 0, 100, 1, '%', '착용 장비 하나를 잃을 확률이야.')}</section>`,
    combat: `<section class="set-group"><h3>전투 AI</h3><p class="lore-help ag-help">모든 주민 전투 차례와 던전 탐사 선택은 자기 모델이 정해. 판단 방식·간격·시간당·하루 한도는 <b>AI 행동 → 전투·원정</b> 한 줄에서 설정해. 응답 대기 중에는 해당 주민만 행동하지 않으며 몬스터와 다른 주민은 계속 진행해. 실패·한도 초과에도 규칙 행동으로 대신하지 않아.</p></section>`,
    roles: `<section class="set-group"><h3>역할</h3><div id="rpg-roles"></div></section><section class="set-group"><h3>근무</h3><div id="rpg-shifts"></div></section>`,
  }
  const settingPages = Object.entries(pages).map(([id, html]) => {
    const page = document.createElement('div'); page.className = 'rpg-settings'; page.dataset.page = id; page.innerHTML = html
    ;($(`tab-${id}`) ?? layer.querySelector('.rpg-panel')).append(page)
    if (!$(`tab-${id}`)) page.hidden = true
    return page
  })
  const settingsControls = () => settingPages.flatMap(page => [...page.querySelectorAll('input, select, button')])
  const notice = node('div', '', 'conai-notice'), dismiss = node('button', '확인했어', 'btn')
  notice.dataset.combatMigrationNotice = ''
  notice.hidden = !guild.world?.rpg?.combatMigrationNotice || guild.world.rpg.combatMigrationNotice.dismissed
  notice.append(node('p', '이전 전투 끔/수호자만 설정은 매 차례 모델 판단으로 바뀌었어. AI 행동의 전투·탐사 호출 한도를 확인해줘.'), dismiss)
  dismiss.addEventListener('click', () => request('combat-notice-dismiss', { saveId: guild.world.save?.id }).catch(e => toast(e.message)))
  settingPages.find(p => p.dataset.page === 'combat').prepend(notice)
  for (const page of settingPages) {
    // −/+ beside each number: step within its range and report it like typing does.
    page.addEventListener('click', event => {
      const day = event.target.closest('[data-weekday]')
      if (day) { workDay(day, day.getAttribute('aria-pressed') !== 'true'); page.dispatchEvent(new Event('change')); return }
      const button = event.target.closest('[data-num]'); if (!button) return
      const input = $(`rpg-${button.dataset.num}`), step = Number(input.step) || 1, value = Number(input.value) || 0
      const next = Math.max(Number(input.min), Math.min(Number(input.max), Math.round((value + step * Number(button.dataset.by)) / step) * step))
      if (next !== value) { input.value = String(next); input.dispatchEvent(new Event('input', { bubbles: true })) }
    })
    page.addEventListener('input', () => { guild.settingsDirty = true; status(); guild.changed(); publish() })
    page.addEventListener('change', () => { guild.settingsDirty = true; status(); guild.changed(); publish() })
  }
  const artPicker = createDrawPicker({ service: $('rpg-art-service'), comfy: $('rpg-art-comfy'), workflow: $('rpg-art-workflow'), field: $('rpg-art-field') },
    { list: () => guild.api?.app.call('list_workflows', { active_only: true }) ?? null, get: () => guild.artDraft, set: next => { guild.artDraft = next; guild.settingsDirty = true; status(); guild.changed(); publish() }, toast })
  const numeric = ['maxZones', 'dmDailyLimit', 'xpLoss', 'goldLoss', 'gearLoss', 'reviveSeconds', 'stepMs', 'roundMs', 'assetDaily']
  function resetSettings() {
    if (!guild.world?.rpg) return
    const s = guild.world.rpg.settings; guild.configRevision = guild.world.rpg.configRevision
    $('rpg-enabled').checked = s.enabled
    setOptions($('rpg-dm'), [['', '없음'], ...guild.profiles.map(p => [p.id, p.name])]); $('rpg-dm').value = s.dmProfileId ?? ''
    for (const key of numeric) $(`rpg-${key}`).value = s[key]
    $('rpg-artToday').textContent = `오늘 ${guild.world.rpg.dm.art?.today ?? 0}장`
    guild.artDraft = { ...NO_DRAW, ...s.gameArt }; artPicker.render()
    // Jobs and skills come from the oracle; here only who does what in the village.
    $('rpg-roles').replaceChildren(...guild.world.rpg.actors.map(actor => {
      const line = node('div', '', 'set-row rpg-role-row'), who = node('span', '', 'set-label rpg-role-who')
      // The adventurer's job sits under the name, so a long one never pushes the role picker to its own line.
      const name = node('span', '', 'rpg-role-name'); name.append(node('b', actor.name))
      if (actor.role === 'adventurer') name.append(node('small', actor.calling?.translation?.job || actor.calling?.job || '신탁 전'))
      who.append(face(actor.profileId, actor.name), name)
      const select = document.createElement('select'); select.dataset.profileId = actor.profileId; select.dataset.key = 'role'; select.setAttribute('aria-label', `${actor.name} 역할`)
      setOptions(select, Object.entries(ROLE)); select.value = actor.role
      const control = node('div', '', 'set-control'); control.append(select); line.append(who, control)
      return line
    }))
    // Working hours per staff role: open and close in half hours, and the days it works (lit) or takes off.
    const shifts = shiftsOf(s)
    $('rpg-shifts').replaceChildren(...Object.entries(STAFF).map(([role, label]) => {
      const line = node('div', '', 'set-row rpg-shift-row'); line.dataset.role = role
      const time = key => {
        const select = document.createElement('select'); select.dataset.shift = key; select.setAttribute('aria-label', `${label} ${key === 'open' ? '출근' : '퇴근'} 시간`)
        setOptions(select, SHIFT_TIMES); select.value = String(shifts[role][key]); return select
      }
      const hours = node('span', '', 'rpg-shift-hours'); hours.append(time('open'), node('span', '–', 'set-unit'), time('close'))
      const days = node('span', '', 'rpg-shift-days')
      days.append(...WEEKDAYS.map((name, i) => { const b = node('button', name); b.type = 'button'; b.dataset.weekday = String(i); workDay(b, !shifts[role].off.includes(i)); return b }))
      const control = node('div', '', 'set-control'); control.append(hours, days)
      line.append(node('span', label, 'set-label'), control); return line
    }))
    guild.settingsDirty = false; status(); guild.changed()
  }
  function workDay(button, on) { button.setAttribute('aria-pressed', String(on)); button.dataset.tip = `${WEEKDAYS[button.dataset.weekday]}요일 ${on ? '근무' : '휴무'}` }
  const shiftsDraft = () => Object.fromEntries([...document.querySelectorAll('.rpg-shift-row')].map(line => [line.dataset.role, {
    open: Number(line.querySelector('[data-shift="open"]').value), close: Number(line.querySelector('[data-shift="close"]').value),
    off: [...line.querySelectorAll('[data-weekday]')].filter(b => b.getAttribute('aria-pressed') !== 'true').map(b => Number(b.dataset.weekday)) }]))
  function settingsDraft() {
    const settings = { enabled: $('rpg-enabled').checked, dmProfileId: $('rpg-dm').value ? Number($('rpg-dm').value) : null }
    for (const key of numeric) settings[key] = Number($(`rpg-${key}`).value)
    const roles = guild.world.rpg.actors.map(a => ({ profileId: a.profileId, role: document.querySelector(`#rpg-roles [data-profile-id="${a.profileId}"][data-key="role"]`)?.value ?? a.role }))
    settings.shifts = shiftsDraft()
    settings.gameArt = { ...guild.artDraft }
    return { revision: guild.configRevision, settings, roles }
  }
  /** Applies the adventure draft; the settings window's 적용 calls it after the village part. Throws on refusal. */
  async function saveSettings() {
    if (!guild.settingsDirty || !guild.world?.rpg) return
    guild.busy = true; status()
    try { await request('rpg-configure', settingsDraft()); resetSettings() } finally { guild.busy = false; status(); publish() }
  }
  function prepareSettings(args) {
    if (!guild.world?.rpg) throw new Error('길드를 먼저 열어줘.')
    const input = args.settings ?? {}
    for (const key of numeric) if (input[key] !== undefined && (!Number.isInteger(input[key]) || input[key] < Number($(`rpg-${key}`).min) || input[key] > Number($(`rpg-${key}`).max))) throw new Error('설정 범위를 확인해줘.')
    for (const key of ['enabled']) if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new Error('설정을 확인해줘.')
    if (input.dmProfileId !== undefined && input.dmProfileId !== 0 && !guild.profiles.some(p => p.id === input.dmProfileId)) throw new Error('GM 프로필을 다시 골라줘.')
    if (input.gameArt !== undefined && (!['off', 'novelai', 'comfyui'].includes(input.gameArt?.service) || (input.gameArt.service === 'comfyui' && (!Number.isInteger(input.gameArt.workflowId) || input.gameArt.workflowId < 1 || typeof input.gameArt.promptField !== 'string' || !input.gameArt.promptField)))) throw new Error('게임 그림 방식을 확인해줘. ComfyUI면 워크플로우와 입력칸도 골라.')
    const seen = new Set()
    for (const entry of args.roles ?? []) {
      if (!guild.world.rpg.actors.some(a => a.profileId === entry.profileId) || seen.has(entry.profileId) || !Object.hasOwn(ROLE, entry.role)) throw new Error('주민 역할을 확인해줘.')
      seen.add(entry.profileId)
    }
    if ((args.roles ?? []).filter(entry => entry.role === 'oracle').length > 1) throw new Error('신관은 한 명만 둘 수 있어.')
    const half = x => x === undefined || (Number.isInteger(x) && x >= 0 && x < 1440 && x % 30 === 0)
    for (const [role, shift] of Object.entries(input.shifts ?? {})) {
      if (!Object.hasOwn(STAFF, role) || !shift || !half(shift.open) || !half(shift.close)) throw new Error('근무 시간을 확인해줘. 30분 단위 분(0~1410)으로 적어.')
      if (shift.off !== undefined && (!Array.isArray(shift.off) || shift.off.length > 6 || !shift.off.every(d => Number.isInteger(d) && d >= 0 && d < 7))) throw new Error('휴무 요일을 확인해줘. 0=월 … 6=일.')
    }
    // Only roles or working hours → the 역할 page; anything else → 모험.
    const onlyRoles = Object.keys(input).every(key => key === 'shifts')
    close(); guild.tab = 'settings'; if (!guild.settingsDirty) resetSettings(); openMenu?.(onlyRoles && (args.roles?.length || input.shifts) ? 'roles' : 'adventure')
    for (const key of numeric) if (input[key] !== undefined) $(`rpg-${key}`).value = input[key]
    for (const key of ['enabled']) if (input[key] !== undefined) $(`rpg-${key}`).checked = input[key]
    if (input.dmProfileId !== undefined) $('rpg-dm').value = input.dmProfileId || ''
    if (input.gameArt !== undefined) { guild.artDraft = input.gameArt.service === 'comfyui' ? { service: 'comfyui', workflowId: input.gameArt.workflowId, promptField: input.gameArt.promptField } : { ...NO_DRAW, service: input.gameArt.service }; artPicker.render() }
    for (const entry of args.roles ?? []) document.querySelector(`#rpg-roles [data-profile-id="${entry.profileId}"][data-key="role"]`).value = entry.role
    for (const [role, shift] of Object.entries(input.shifts ?? {})) {
      const line = document.querySelector(`.rpg-shift-row[data-role="${role}"]`)
      for (const key of ['open', 'close']) if (shift[key] !== undefined) line.querySelector(`[data-shift="${key}"]`).value = String(shift[key])
      if (shift.off) for (const b of line.querySelectorAll('[data-weekday]')) workDay(b, !shift.off.includes(Number(b.dataset.weekday)))
    }
    guild.settingsDirty = true; status(); guild.changed(); publish()
  }

  return { settingPages, settingsControls, resetSettings, settingsDraft, saveSettings, prepareSettings }
}
