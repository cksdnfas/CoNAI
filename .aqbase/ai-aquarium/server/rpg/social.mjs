import { clamp, changeStatuses, availableActions, agentSettings, statusDefinition, definitionsFor } from '../../shared/agents.mjs'
import { runtimePlaces } from '../../shared/tiles.mjs'
import { clipProse } from '../../shared/speech.mjs'

const need = (v, message) => { if (!v) throw new Error(message); return v }
const actor = (s, id) => need(s.actors.find(a => a.active && a.profileId === id), '마을에 없는 주민이야.')
export const REQUEST_TTL_MS = 10 * 60_000
function finishRequest(q, status, reason, now) {
  q.status = status; q.reason = String(reason); q.resolvedAt = now
  q.result = `${q.action.label}: ${status}${q.reason ? ` (${q.reason})` : ''}`
  return q
}
export function expireRequests(s, now) {
  for (const q of s.socialRequests ?? []) if (q.status === 'pending') {
    if ((q.expiresAt ?? q.createdAt + REQUEST_TTL_MS) <= now) finishRequest(q, 'expired', '응답 기한이 지났어.', now)
    else if (![q.from, q.to].every(id => s.actors.some(a => a.active && a.profileId === id))) finishRequest(q, 'expired', '요청 당사자가 마을을 떠났어.', now)
  }
}
export function cancelRequest(s, id, reason = '플레이어/GM이 취소했어.', now = Date.now()) {
  const q = need(s.socialRequests?.find(q => q.id === id), '없는 요청이야.')
  if (q.status !== 'pending') return { ...q, repeated: true }
  return finishRequest(q, 'cancelled', reason, now)
}
export function relationship(s, a, b) {
  need(a !== b, '다른 주민을 골라줘.')
  actor(s, a); actor(s, b)
  s.relationships ??= []
  let r = s.relationships.find(r => r.a === Math.min(a, b) && r.b === Math.max(a, b))
  if (!r) { need(s.relationships.length < 256, '저장된 관계 한도야.'); r = { a: Math.min(a, b), b: Math.max(a, b), affinity: 0, label: '지인', automatic: true }; s.relationships.push(r) }
  return r
}
export function setRelationship(s, a, b, affinity, label) {
  need(Number.isFinite(affinity), '관계 수치를 확인해줘.')
  const r = relationship(s, a, b)
  r.affinity = clamp(affinity, -100, 100)
  if (typeof label === 'string' && label.trim()) { r.label = label.trim(); r.automatic = false }
  return r
}
function affect(s, from, to, action, accepted = true) {
  const r = relationship(s, from.profileId, to.profileId)
  r.affinity = clamp(r.affinity + (accepted ? action.effect.affinity : -3), -100, 100)
  if (r.automatic === true) r.label = r.affinity >= 30 ? '친구' : r.affinity <= -60 ? '원수' : r.affinity <= -20 ? '라이벌' : '지인'
  const source = action.builtin || !accepted ? 'rule' : 'custom'
  changeStatuses(s, from, accepted ? action.effect.actorStatuses : { mood: -3 }, false, source)
  changeStatuses(s, to, accepted ? action.effect.targetStatuses : { mood: -1 }, false, source)
  return r
}
function transfer(s, from, to, kind, item, amount) {
  need(Number.isSafeInteger(amount) && amount >= 1 && amount <= 100, '이전 수량은 1–100이야.')
  need(['item', 'gold'].includes(kind), '물품 또는 골드 이전 종류를 명시해줘.')
  if (kind === 'item') {
    need(item && s.items.some(d => d.id === item && d.stackable), '이전할 생활 물품을 골라줘.')
    need((from.stacks?.[item] ?? 0) >= amount, '물품이 부족해.')
    need((to.stacks?.[item] ?? 0) + amount <= 999, '상대 가방 수량 한도야.')
    from.stacks[item] -= amount; to.stacks ??= {}; to.stacks[item] = (to.stacks[item] ?? 0) + amount
  } else {
    need(from.gold >= amount && to.gold + amount <= 1e9, '골드 잔액 또는 한도를 확인해줘.')
    from.gold -= amount; to.gold += amount
  }
}
/** Consent and effect are stored in the same RPG transaction. Terminal requests can never execute twice. */
export function answerRequest(s, id, profileId, answer, reason = '', now = Date.now()) {
  const q = need(s.socialRequests?.find(q => q.id === id), '없는 요청이야.')
  need(q.to === profileId, '요청을 받은 주민만 답할 수 있어.')
  if (q.status !== 'pending') return { ...q, repeated: true }
  need(['accept', 'refuse'].includes(answer), '수락 또는 거절로 답해줘.')
  expireRequests(s, now)
  if (q.status !== 'pending') return q
  // Stage both purses, inventories, statuses and the relationship. A failed accept commits only its terminal receipt.
  const trial = { ...s, actors: s.actors.map(a => [q.from, q.to].includes(a.profileId) ? structuredClone(a) : a),
    relationships: structuredClone(s.relationships ?? []), socialRequests: s.socialRequests.map(r => r === q ? { ...q } : r) }
  try {
    const result = applyAnswer(trial, id, profileId, answer, reason, now)
    for (const a of s.actors.filter(a => [q.from, q.to].includes(a.profileId))) Object.assign(a, trial.actors.find(x => x.id === a.id))
    s.relationships = trial.relationships
    Object.assign(q, result)
    return q
  } catch (error) { return finishRequest(q, 'failed', error?.message ?? error, now) }
}
function applyAnswer(s, id, profileId, answer, reason, now) {
  const q = s.socialRequests.find(q => q.id === id)
  const from = actor(s, q.from), to = actor(s, q.to), action = q.action
  if (answer === 'accept') {
    // Validate both legs of trade before mutating either purse or bag.
    if (action.id === 'trade') {
      need(q.item && s.items.some(d => d.id === q.item && d.stackable) && (from.stacks?.[q.item] ?? 0) >= 1 && (to.stacks?.[q.item] ?? 0) < 999, '거래할 물품이 부족하거나 가방이 가득해.')
      need(to.gold >= q.amount && from.gold + q.amount <= 1e9, '거래 골드가 부족해.')
      transfer(s, from, to, 'item', q.item, 1); transfer(s, to, from, 'gold', null, q.amount)
    } else if (action.id === 'gift' || action.effect.transfer !== 'none') {
      transfer(s, from, to, action.id === 'gift' ? q.kind : action.effect.transfer, q.item, q.amount)
    }
    else if (action.id === 'request' && ['item', 'gold'].includes(q.kind)) transfer(s, to, from, q.kind, q.item, q.amount)
    if (action.id === 'propose') { const r = relationship(s, q.from, q.to); r.label = '약혼'; r.automatic = false }
    if (action.id === 'invite' || (action.id === 'request' && ['help', 'accompany'].includes(q.kind))) {
      to.follow = { profileId: from.profileId, until: now + 120_000, detail: q.detail }
      if (q.place) from.travelGoal = { place: q.place, until: now + 120_000 }
      changeStatuses(s, from, { fatigue: -5, social: 5 }, false, 'rule')
    }
    if (action.id === 'gift') changeStatuses(s, to, { mood: 10 }, false, 'rule')
  }
  affect(s, from, to, action, answer === 'accept')
  q.status = answer === 'accept' ? 'accepted' : 'refused'; q.reason = String(reason); q.resolvedAt = now
  q.result = `${from.name} → ${to.name}: ${action.label} ${answer === 'accept' ? '수락' : '거절'}${q.reason ? ` (${q.reason})` : ''}`
  return q
}
export function socialAction(s, fromId, input, requestId, now) {
  s.socialRequests ??= []
  expireRequests(s, now)
  const old = s.socialRequests.find(q => q.id === requestId)
  if (old) return { ...old, repeated: true }
  const from = actor(s, fromId), to = actor(s, input.target)
  need(from !== to, '다른 주민을 골라줘.')
  const action = need(availableActions(s, 'social').find(a => a.id === input.id), '사용할 수 없는 교류 행동이야.')
  const place = String(input.place ?? action.effect.place ?? '')
  if (place && (action.id === 'invite' || input.kind === 'accompany')) need(runtimePlaces(s.life).some(p => p.name === place), '마을에 있는 정확한 장소를 골라줘.')
  if (action.effect.needsAcceptance) {
    need(s.socialRequests.filter(q => q.status === 'pending').length < 24, '대기 요청이 많아.')
    const amount = clamp(Number.isSafeInteger(input.amount) ? input.amount : action.effect.amount ?? 1, 1, 100)
    const kind = ['item', 'gold', 'help', 'accompany'].includes(input.kind) ? input.kind : input.item || ['gift', 'trade'].includes(action.id) ? 'item' : 'help'
    if (action.id === 'gift') need(['item', 'gold'].includes(kind), '선물 종류는 item 또는 gold로 명시해줘.')
    if (kind === 'item' || action.id === 'trade' || action.effect.transfer === 'item') need(input.item && s.items.some(d => d.id === input.item && d.stackable), '요청할 생활 물품을 골라줘.')
    const q = { id: requestId, from: fromId, to: to.profileId, action: structuredClone(action), item: typeof input.item === 'string' ? input.item : null,
      amount, kind, place, detail: String(input.detail ?? ''), status: 'pending', createdAt: now, expiresAt: now + REQUEST_TTL_MS }
    s.socialRequests = [...s.socialRequests.filter(q => q.status === 'pending'), ...s.socialRequests.filter(q => q.status !== 'pending').slice(-75), q]
    return q
  }
  if (action.id === 'attack') to.hp = Math.max(1, to.hp - 5)
  affect(s, from, to, action)
  if (action.id === 'talk') { changeStatuses(s, from, { social: 5 }, false, 'rule'); changeStatuses(s, to, { social: 5 }, false, 'rule') }
  return { result: `${from.name} → ${to.name}: ${action.label}`, status: 'applied' }
}
export function configureAgents(s, patch) {
  Object.assign(s.settings, agentSettings(s.settings, patch))
  for (const a of s.actors) changeStatuses(s, a, {})
  s.configRevision++
  return agentSettings(s.settings)
}
export function setResidentStatuses(s, profileId, values) {
  const a = actor(s, profileId)
  need(values && typeof values === 'object' && !Array.isArray(values) && Object.keys(values).length <= 32, '상태 값을 확인해줘.')
  for (const id of Object.keys(values)) need(definitionsFor(s, a).some(d => d.id === id && d.enabled), '없는 상태야.')
  return changeStatuses(s, a, values, true, 'manual')
}
export function manageAgents(s, input, now = Date.now()) {
  if (input.type === 'request-cancel') return cancelRequest(s, input.requestId, input.reason, now)
  if (input.type === 'status-set') return setResidentStatuses(s, actorById(s, input.actorId).profileId, { [input.statusId]: input.value })
  if (input.type === 'relationship-set') return setRelationship(s, actorById(s, input.actorId).profileId, actorById(s, input.targetActorId).profileId, input.affinity, input.label)
  if (input.type === 'status-definition' || input.type === 'status-remove') {
    const id = input.definition?.id ?? input.statusId, previous = s.settings.statusDefs.find(d => d.id === id)
    if (input.type === 'status-remove' && previous && !previous.builtin) return configureAgents(s, { statusDefs: s.settings.statusDefs.filter(d => d.id !== id) })
    const next = input.type === 'status-remove' ? { ...need(previous, '없는 상태야.'), enabled: false } : statusDefinition(input.definition, previous)
    return configureAgents(s, { statusDefs: [...s.settings.statusDefs.filter(d => d.id !== id), next] })
  }
  if (input.type === 'action-definition') {
    const d = input.definition
    return configureAgents(s, { actionCatalog: [...s.settings.actionCatalog.filter(a => a.id !== d.id || a.category !== d.category), d] })
  }
  if (input.type === 'agent-settings') return configureAgents(s, input.settings)
  return null
}
const actorById = (s, id) => need(s.actors.find(a => a.active && a.id === id), '없는 주민이야.')
