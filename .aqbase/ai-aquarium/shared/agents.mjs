/** Save-slot policy. Descriptions are model context, never executable expressions. */
export const CATEGORIES = ['combat', 'social', 'village']
export const DECIDERS = ['judge', 'chat']
export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))
const number = (v, fallback, lo, hi) => clamp(Number.isFinite(v) ? v : fallback, lo, hi)
const text = v => typeof v === 'string' ? v.trim() : ''
const idOf = v => {
  if (typeof v !== 'string' || !/^[a-zA-Z][\w-]{0,39}$/.test(v)) throw new Error('ID는 영문으로 시작하는 1–40자 영문·숫자·_·-로 써줘.')
  return v
}
export const STATUS_DEFAULTS = [
  { id: 'mood', name: '기분', description: '즐거움과 의욕. 모욕과 거절에 낮아지고 호의에 높아져.', initial: 60, perHour: -1, lowHint: '쉬거나 좋아하는 사람을 만나.', highHint: '다른 주민에게 호의를 표현해.' },
  { id: 'hunger', name: '배고픔', description: '높을수록 배가 고파. 음식을 사서 먹으면 내려가.', initial: 20, perHour: 5, lowHint: '배가 불러.', highHint: '음식 구매와 섭취를 우선해.' },
  { id: 'fatigue', name: '피로', description: '높을수록 지쳤어. 휴식과 수면으로 내려가.', initial: 10, perHour: 4, lowHint: '활동할 힘이 있어.', highHint: '휴식하거나 잠을 자.' },
  { id: 'social', name: '사교 만족', description: '낮으면 외로워. 대화와 교류로 높아져.', initial: 50, perHour: -4, lowHint: '이웃과 이야기해.', highHint: '혼자 할 일도 해도 좋아.' },
].map(d => ({ kind: 'number', min: 0, max: 100, step: 30, low: 25, high: 75, enabled: true, builtin: true, ...d }))

export function statusDefinition(input, previous = null) {
  const id = idOf(input?.id), builtin = STATUS_DEFAULTS.find(d => d.id === id)
  if (id.startsWith('profile_')) throw new Error('profile_로 시작하는 상태 ID는 프로필 정의 전용이야.')
  const d = { ...previous, ...input }, kind = builtin?.kind ?? previous?.kind ?? d.kind
  if (!['number', 'choice'].includes(kind)) throw new Error('상태 종류는 number 또는 choice야.')
  if (previous?.builtin && input.kind && input.kind !== previous.kind) throw new Error('기본 상태의 종류는 바꿀 수 없어.')
  const min = number(d.min, 0, -10000, 10000), max = number(d.max, 100, min, 10000)
  const values = [...new Set((Array.isArray(d.values) ? d.values : []).map(v => text(v, 40)).filter(Boolean))].slice(0, 16)
  if (kind === 'choice' && values.length < 2) throw new Error('선택 상태는 2–16개 값을 넣어줘.')
  return { id, name: text(d.name, 40) || id, description: text(d.description, 300), kind, min, max,
    initial: kind === 'choice' ? values.includes(d.initial) ? d.initial : values[0] : number(d.initial, min, min, max),
    values, perHour: kind === 'number' ? number(d.perHour, 0, -100, 100) : 0,
    step: number(d.step, 10, 0, 100), low: number(d.low, min, min, max), high: number(d.high, max, min, max),
    lowHint: text(d.lowHint, 160), highHint: text(d.highHint, 160), enabled: d.enabled !== false, builtin: !!builtin }
}
const builtin = (category, id, label, description, effect = {}) => ({ category, id, label, description, enabled: true, builtin: true, effect })
export const ACTION_DEFAULTS = [
  ...[['attack', '공격'], ['skill', '스킬'], ['guard', '방어'], ['potion', '물약'], ['flee', '도망']].map(([id, label]) => builtin('combat', id, label, `${label}로 이번 전투 차례를 진행해.`)),
  builtin('social', 'talk', '대화', '서로 관심사와 목적을 이야기해.'),
  builtin('social', 'gift', '선물', '내 물품이나 골드를 상대에게 제안해. 수락해야 이전해.', { needsAcceptance: true, affinity: 8 }),
  builtin('social', 'request', '부탁', 'item/gold/help/accompany를 부탁해. 상대가 수락하거나 거절해.', { needsAcceptance: true, affinity: 3 }),
  builtin('social', 'propose', '청혼', '상대가 동의하면 약혼해.', { needsAcceptance: true, affinity: 15 }),
  builtin('social', 'compliment', '칭찬', '진심으로 칭찬해.', { affinity: 5, targetStatuses: { mood: 5 } }),
  builtin('social', 'argue', '논쟁', '의견에 반대하거나 모욕해.', { affinity: -8, targetStatuses: { mood: -8 } }),
  builtin('social', 'attack', '다툼', '죽이지 않는 몸싸움. 상대 HP·기분과 관계가 나빠져.', { affinity: -15, targetStatuses: { mood: -15 } }),
  builtin('social', 'invite', '초대', '함께 다른 장소로 가자고 제안해.', { needsAcceptance: true, affinity: 4 }),
  builtin('social', 'apologize', '사과', '잘못을 인정하고 관계를 회복해.', { affinity: 6, targetStatuses: { mood: 5 } }),
  builtin('social', 'trade', '거래', '내 물품을 제시한 골드에 팔아. 상대 수락과 잔액·수량 확인이 필요해.', { needsAcceptance: true, affinity: 2 }),
  ...[['eat', '식사'], ['rest', '휴식'], ['sleep', '수면'], ['work', '일하기'], ['shop', '장보기'], ['visit', '방문'], ['craft', '제작'], ['donate', '기부']].map(([id, label]) => builtin('village', id, label, `${label}를 실제 생활 규칙으로 실행해.`)),
  ...[['equip', '장비 착용'], ['sell', '장비 판매'], ['supply', '보급 구매'], ['depart', '원정 출발'], ['oracle', '신탁 방문'], ['wake', '기상'], ['wait', '기다리기']].map(([id, label]) => builtin('village', id, label, `${label}. 세부 대상과 비용을 읽고 선택해.`)),
]
function deltas(value) {
  const entries = Array.isArray(value) ? value.map(d => [d?.id, d?.delta]) : Object.entries(value ?? {})
  if (entries.length > 16 || new Set(entries.map(([id]) => id)).size !== entries.length) throw new Error('상태 효과는 중복 없이 최대 16개야.')
  return Object.fromEntries(entries.map(([id, delta]) => {
    idOf(id)
    if (!Number.isFinite(delta)) throw new Error('상태 효과의 delta는 숫자야.')
    return [id, clamp(delta, -30, 30)]
  }))
}
export function actionDefinition(input, previous = null) {
  const id = idOf(input?.id), category = input?.category
  if (!CATEGORIES.includes(category)) throw new Error('행동 분류를 확인해줘.')
  const base = ACTION_DEFAULTS.find(a => a.category === category && a.id === id), d = { ...previous, ...input }, e = { ...previous?.effect, ...d.effect }
  return { id, category, label: text(d.label, 40) || id, description: text(d.description, 300), enabled: d.enabled !== false, builtin: !!base,
    effect: {
      damage: number(e.damage, 1, 0, 2), guard: number(e.guard, 0, 0, .75), heal: number(e.heal, 0, 0, .3),
      fleeChance: number(e.fleeChance, 0, 0, 1), mpCost: Math.round(number(e.mpCost, 0, 0, 20)),
      affinity: number(e.affinity, 0, -20, 20), actorStatuses: deltas(e.actorStatuses), targetStatuses: deltas(e.targetStatuses),
      needsAcceptance: !!base?.effect.needsAcceptance || e.needsAcceptance === true || ['item', 'gold'].includes(e.transfer),
      transfer: ['item', 'gold'].includes(e.transfer) ? e.transfer : 'none',
      amount: Math.round(number(e.amount, 1, 1, 100)), duration: number(e.duration, 30, 5, 300), place: text(e.place, 60),
    } }
}
export function agentSettings(current = {}, patch = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('AI 행동 설정을 확인해줘.')
  const defs = current.statusDefs ?? STATUS_DEFAULTS, actions = current.actionCatalog ?? ACTION_DEFAULTS
  const statusDefs = patch.statusDefs ?? defs, actionCatalog = patch.actionCatalog ?? actions
  if (!Array.isArray(statusDefs) || statusDefs.length > 16) throw new Error('공용 상태는 최대 16개야.')
  if (!Array.isArray(actionCatalog)) throw new Error('행동 목록을 확인해줘.')
  const normalizedDefs = statusDefs.map(d => statusDefinition(d, defs.find(p => p.id === d.id)))
  for (const d of STATUS_DEFAULTS) if (!normalizedDefs.some(x => x.id === d.id)) normalizedDefs.push(statusDefinition({ ...d, enabled: false }))
  if (normalizedDefs.length > 16 || new Set(normalizedDefs.map(d => d.id)).size !== normalizedDefs.length) throw new Error('상태 ID 중복 또는 16개 한도야.')
  const normalizedActions = actionCatalog.map(d => actionDefinition(d, actions.find(p => p.id === d.id && p.category === d.category)))
  for (const a of ACTION_DEFAULTS) if (!normalizedActions.some(x => x.id === a.id && x.category === a.category)) normalizedActions.push(actionDefinition({ ...a, enabled: false }))
  // No count cap: the host's judge takes any number of options, and a category grows with the built-in actions.
  if (new Set(normalizedActions.map(a => `${a.category}:${a.id}`)).size !== normalizedActions.length) throw new Error('같은 분류에 행동 ID가 중복됐어.')
  if (patch.actionCatalog !== undefined || patch.statusDefs !== undefined) for (const a of normalizedActions) {
    for (const id of new Set([...Object.keys(a.effect.actorStatuses), ...Object.keys(a.effect.targetStatuses)])) {
      if (!normalizedDefs.some(d => d.id === id && d.kind === 'number')) throw new Error(`행동 ${a.label}: 현재 슬롯에 없는 숫자 상태 ${id}야.`)
    }
  }
  const deciders = Object.fromEntries(CATEGORIES.map(c => {
    const oldMode = c === 'combat' ? current.combatModel : current.judgeModel
    const old = c !== 'combat' && oldMode === 'profile' && !current.judgeProfileId ? 'rules' : oldMode === undefined ? 'judge' : oldMode === 'judge' ? 'judge' : 'chat'
    const d = { decider: old, minInterval: c === 'village' ? 20 : 1, maxCallsPerHour: null, maxCallsPerDay: null, ...current.deciders?.[c], ...patch.deciders?.[c] }
    if (patch.deciders?.[c]?.unlimitedHour === true) d.maxCallsPerHour = null
    if (patch.deciders?.[c]?.unlimitedDay === true) d.maxCallsPerDay = null
    if (d.decider === 'rules') d.decider = 'judge'
    if (!DECIDERS.includes(d.decider)) throw new Error('판단 방식은 judge/chat 중 하나야.')
    const cap = (v, max) => {
      if (v === null || v === undefined || v === '') return null
      if (!Number.isSafeInteger(v) || v < 0 || v > max) throw new Error(`호출 한도는 빈 값(무제한) 또는 0–${max} 정수야.`)
      return v
    }
    return [c, { decider: d.decider, minInterval: number(d.minInterval, 20, 1, 3600), maxCallsPerHour: cap(d.maxCallsPerHour, 120),
      maxCallsPerDay: cap(d.maxCallsPerDay, 10000) }]
  }))
  return { statusDefs: normalizedDefs, actionCatalog: normalizedActions, deciders,
    conversationMaxTurns: Math.round(number(patch.conversationMaxTurns ?? current.conversationMaxTurns, 8, 2, 24)),
    maxConversations: Math.round(number(patch.maxConversations ?? current.maxConversations, 3, 1, 3)) }
}
export function migrateAgents(s) {
  if ((s.agentVersion ?? 0) < 5 && ['off', 'boss'].includes(s.settings.combatAi) && !s.combatMigrationNotice)
    s.combatMigrationNotice = { from: s.settings.combatAi, dismissed: false }
  if ((s.agentVersion ?? 0) < 4 && ['decision', 'judgement'].includes(s.pending?.kind)) { s.obsoleteJobId = s.pending.jobId ?? null; s.pending = null }
  if (!s.agentVersion && ['judgement', 'life-decision'].includes(s.pending?.kind)) { s.obsoleteJobId = s.pending.jobId ?? null; s.pending = null }
  if ((s.agentVersion ?? 0) < 4 && s.settings.actionCatalog) {
    for (const action of ACTION_DEFAULTS) if (!s.settings.actionCatalog.some(a => a.id === action.id && a.category === action.category)) s.settings.actionCatalog.push(action)
  }
  Object.assign(s.settings, agentSettings(s.settings))
  if ((s.agentVersion ?? 0) < 4 && Number.isFinite(s.settings.combatDaily)) s.settings.deciders.combat.maxCallsPerDay = Math.min(s.settings.deciders.combat.maxCallsPerDay ?? Infinity, s.settings.combatDaily)
  delete s.settings.combatAi; delete s.settings.combatDaily; delete s.settings.autoSupply; delete s.settings.combatWait
  for (const key of ['judgeProfileId', 'judgeModel', 'combatModel', 'combatProfileId']) delete s.settings[key]
  s.relationships ??= []
  for (const r of s.relationships) r.automatic ??= !['약혼', '배우자', '연인'].includes(r.label)
  s.socialRequests ??= []
  for (const a of s.actors) {
    if (a.agentError !== undefined) { a.combatError ??= a.agentError; delete a.agentError }
    if (a.agentRoute?.decider === 'rules') a.agentRoute = null
    ensureStatuses(s, a)
  }
  s.agentVersion = 5
  return s
}
export const definitionsFor = (s, a) => [...(s.settings.statusDefs ?? STATUS_DEFAULTS), ...(a.profileStatusDefs ?? [])]
export const statusValue = (d, v) => d.kind === 'choice' ? d.values.includes(v) ? v : d.initial : number(v, d.initial, d.min, d.max)
export function ensureStatuses(s, a) {
  const before = a.statuses ?? {}
  a.statuses = Object.fromEntries(definitionsFor(s, a).map(d => [d.id, statusValue(d, before[d.id])]))
  return a.statuses
}
export function changeStatuses(s, a, changes, absolute = false, source = 'custom') {
  ensureStatuses(s, a)
  for (const [id, value] of Object.entries(changes ?? {})) {
    const d = definitionsFor(s, a).find(d => d.id === id && d.enabled)
    if (!d || (d.valueReadonly && source !== 'manual')) continue
    if (absolute) {
      if (d.kind === 'number' ? !Number.isFinite(value) : !d.values.includes(value)) throw new Error('상태 값을 확인해줘.')
      a.statuses[id] = statusValue(d, value)
    } else if (d.kind === 'number' && Number.isFinite(value)) a.statuses[id] = statusValue(d, a.statuses[id] + (source === 'rule' ? value : clamp(value, -d.step, d.step)))
  }
  return a.statuses
}
export function driftStatuses(s, a, hours, sleeping = false) {
  ensureStatuses(s, a)
  for (const d of definitionsFor(s, a)) if (d.enabled && !d.valueReadonly && d.kind === 'number') {
    const drift = d.id === 'fatigue' && sleeping ? -20 : d.perHour
    a.statuses[d.id] = statusValue(d, a.statuses[d.id] + drift * Math.max(0, hours))
  }
}
export function syncProfileStatuses(s, a, profile) {
  if (!profile) { ensureStatuses(s, a); return }
  a.profileStatusDefs = (profile?.statusBlocks ?? []).flatMap(b => (b.fields ?? []).map(f => {
    const values = Array.isArray(f.values) ? f.values.filter(v => typeof v === 'string').slice(0, 16) : []
    const min = Number.isFinite(f.min) ? f.min : 0, max = Number.isFinite(f.max) ? Math.max(min, f.max) : Math.max(min, 100)
    return { id: `profile_${b.key}_${f.name}`.slice(0, 120), name: `${b.name}: ${f.label || f.name}`, description: f.label || f.name,
      kind: values.length ? 'choice' : 'number', values, min, max, initial: values.length ? values[0] : min,
      step: Number.isFinite(f.step) ? Math.max(0, f.step) : 10, perHour: 0, enabled: true, readonly: true, valueReadonly: !!f.readonly, builtin: false }
  })).slice(0, 16)
  a.profileJudge = profile?.judge ?? null
  a.profileEngine = profile?.engine ?? null
  ensureStatuses(s, a)
}
export function residentContext(s, a, relevant = []) {
  return { profileId: a.profileId, name: a.name, goal: a.goal ?? '', role: a.role, level: a.level, rank: a.rank, calling: a.calling ?? null, gold: a.gold, hp: a.hp, mp: a.mp,
    statuses: definitionsFor(s, a).filter(d => d.enabled).map(d => ({ id: d.id, name: d.name, description: d.description, value: a.statuses?.[d.id] ?? d.initial,
      hint: d.kind === 'number' ? a.statuses?.[d.id] <= d.low ? d.lowHint : a.statuses?.[d.id] >= d.high ? d.highHint : '' : '' })),
    relationships: (s.relationships ?? []).filter(r => (r.a === a.profileId && relevant.includes(r.b)) || (r.b === a.profileId && relevant.includes(r.a))),
    requests: (s.socialRequests ?? []).filter(r => r.status === 'pending' && (r.from === a.profileId || r.to === a.profileId))
      .map(r => ({ id: r.id, from: r.from, to: r.to, action: r.action.id, item: r.item, amount: r.amount, kind: r.kind, detail: r.detail })),
    items: Object.entries(a.stacks ?? {}).filter(([, n]) => n > 0) }
}
export const availableActions = (s, category) => (s.settings.actionCatalog ?? ACTION_DEFAULTS).filter(a => a.category === category && a.enabled)
export const actionContext = actions => actions.map(({ id, label, description, category }) => ({ id, label, description, category }))
/** Slot-wide real-day budget: accelerated game time cannot multiply daily model spend. UTC day. */
function dailyCall(s, category, limit, now) {
  const day = new Date(now).toISOString().slice(0, 10)
  if (s.agentDaily?.day !== day) s.agentDaily = { day, combat: 0, social: 0, village: 0 }
  if (limit != null && (s.agentDaily[category] ?? 0) >= limit) return false
  s.agentDaily[category] = (s.agentDaily[category] ?? 0) + 1
  return true
}
/** User-configured admission limits, without choosing an action for the resident. */
export function budgetReason(s, a, category, clock, now, interval = true) {
  const d = s.settings.deciders?.[category] ?? agentSettings().deciders[category]
  const b = a.agentBudget?.[category], count = b?.hour === Math.floor((clock ?? 0) / 60) ? b.count : 0
  const daily = s.agentDaily?.day === new Date(now).toISOString().slice(0, 10) ? s.agentDaily[category] ?? 0 : 0
  if (interval && (b?.nextAt ?? 0) > now) return '사용자가 설정한 최소 호출 간격을 기다리고 있어.'
  if (d.maxCallsPerHour != null && count >= d.maxCallsPerHour) return '사용자가 설정한 마을 시간당 호출 한도에 닿았어.'
  if (d.maxCallsPerDay != null && daily >= d.maxCallsPerDay) return '사용자가 설정한 실제 하루 호출 한도에 닿았어.'
  return null
}
export function budgetMode(s, a, category, clock, now, interval = true) {
  const d = s.settings.deciders?.[category] ?? agentSettings().deciders[category]
  if (budgetReason(s, a, category, clock, now, interval)) return 'wait'
  return d.decider === 'rules' ? 'judge' : d.decider
}
/** Reserve each actual host attempt, including retries; busy/no-model responses refund this exact reservation. */
export function reserveBudget(s, a, category, clock, now, interval = true) {
  if (budgetMode(s, a, category, clock, now, interval) === 'wait') return null
  const d = s.settings.deciders?.[category] ?? agentSettings().deciders[category], hour = Math.floor((clock ?? 0) / 60)
  a.agentBudget ??= {}
  const old = a.agentBudget[category], b = old?.hour === hour ? old : { hour, count: 0, nextAt: old?.nextAt ?? 0, serial: old?.serial ?? 0 }
  a.agentBudget[category] = b
  if (!dailyCall(s, category, d.maxCallsPerDay, now)) return null
  const previousNextAt = b.nextAt ?? 0
  b.count++; b.serial = (b.serial ?? 0) + 1
  if (interval) b.nextAt = Math.max(previousNextAt, now + d.minInterval * 1000)
  return { profileId: a.profileId, category, hour, day: s.agentDaily.day, serial: b.serial, previousNextAt }
}
export function refundBudget(s, ticket) {
  const b = s.actors.find(a => a.profileId === ticket.profileId)?.agentBudget?.[ticket.category]
  if (b?.hour === ticket.hour) {
    b.count = Math.max(0, b.count - 1)
    if (b.serial === ticket.serial) b.nextAt = ticket.previousNextAt
  }
  if (s.agentDaily?.day === ticket.day) s.agentDaily[ticket.category] = Math.max(0, (s.agentDaily[ticket.category] ?? 0) - 1)
}
export function takeBudget(s, a, category, clock, now) {
  const mode = budgetMode(s, a, category, clock, now)
  return !['rules', 'wait'].includes(mode) && reserveBudget(s, a, category, clock, now) ? mode : 'wait'
}
export function extraCall(s, a, category, clock, now = Date.now()) {
  return !!reserveBudget(s, a, category, clock, now)
}
