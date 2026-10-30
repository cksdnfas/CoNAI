import { randomUUID } from 'node:crypto'
import { clipProse } from '../../shared/speech.mjs'
import { agentSettings, migrateAgents, availableActions, ensureStatuses } from '../../shared/agents.mjs'
import { newLife, migrateLife, facilityIncome } from './life.mjs'
import { isGear, hasFacility, STASH } from '../../shared/rpg-systems.mjs'
import { generateDungeon, ensureObjectives, reveal, route, neighbors, SIZES } from './dungeon.mjs'
import { STAFF, SHIFT_DEFAULTS, WAGES, SALES_SHARE, OFFERING, shiftsOf, onDuty, parseShifts } from '../../shared/schedule.mjs'
import { DAY } from '../../shared/clock.mjs'
import { setLook, parseGameArt, ART_DAILY, artProblem } from './game-art.mjs'
import { QUEST_TYPES, PATTERNS, POTIONS, SKILL_KINDS, BAG, gearOf, clerkBonus, questReward, recordExpedition, estimateFight, enemyIntent } from '../../shared/rpg-systems.mjs'

export const ROLES = { adventurer: '모험가', guild: '길드 접수원', merchant: '상인', oracle: '신관' }
export const CLASSES = { warrior: '전사', ranger: '궁수', mage: '마법사' }
export const SLOTS = { weapon: '무기', armor: '방어구', accessory: '장신구' }
/** The hidden combat class behind a calling: the oracle picks one, the numbers follow it. */
export const BASIC_SKILL = { warrior: '강타', ranger: '조준 사격', mage: '마력탄' }
export const COMBAT_AI = { all: '매 턴 모델 판단' }
/** Which model picks combat moves: each fighter's judge model (cheap, quick), its own chat model, or one chosen profile. */
export const COMBAT_MODELS = { judge: '프로필 판단 모델', chat: '프로필 대화 모델' }
export const RPG_DEFAULTS = Object.freeze({
  enabled: false, dmProfileId: null, maxZones: 12, dmDailyLimit: 3, art: false,
  xpLoss: 10, goldLoss: 10, gearLoss: 10, reviveSeconds: 60, stepMs: 1000, roundMs: 2000, restSeconds: 60,
  shifts: SHIFT_DEFAULTS, gameArt: Object.freeze({ service: 'off', workflowId: null, promptField: null }), assetDaily: ART_DAILY,
})
/** Game pace from the settings: one dungeon step and one combat round (ms). */
const stepMs = state => state.settings.stepMs ?? RPG_DEFAULTS.stepMs
const roundMs = state => state.settings.roundMs ?? RPG_DEFAULTS.roundMs
/** Whether the fighter's own model picks this fight's moves, one call per round. */
export const combatAiOn = () => true
/** The village's local day; the DM limit and the combat AI budget both reset with it. */
export const dayKey = now => { const d = new Date(now); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` }
export const combatCallsToday = (state, now) => state.combatCalls?.day === dayKey(now) ? state.combatCalls.count : 0
/** Whether mid-expedition questions go to a model: the chosen judgement profile, or each fighter's judge model. */
export const asksJudgement = () => true
export const xpFor = level => 40 + level * 25
export const closedQuest = quest => ['completed', 'cancelled'].includes(quest.status)
export const rankOf = actor => ['F', 'E', 'D', 'C', 'B', 'A', 'S'][Math.min(6, Math.floor(actor.completed / 3), Math.floor((actor.level - 1) / 2))]
export const int = (value, min, max, label) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${label}: ${min}–${max} 사이 정수를 써줘.`)
  return value
}
export const shortText = (value, max, label) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}: 비어 있지 않은 문자열로 써줘.`)
  return value.trim()
}
const baseItems = () => [
  { id: 'wood-sword', name: '낡은 검', slot: 'weapon', level: 1, attack: 3, defense: 0, hp: 0, rarity: '일반' },
  { id: 'cloth', name: '천 갑옷', slot: 'armor', level: 1, attack: 0, defense: 2, hp: 5, rarity: '일반' },
  { id: 'forest-blade', name: '숲의 칼날', slot: 'weapon', level: 1, attack: 5, defense: 0, hp: 0, rarity: '고급' },
  { id: 'cave-mail', name: '광부의 갑옷', slot: 'armor', level: 2, attack: 0, defense: 4, hp: 10, rarity: '고급' },
  { id: 'ruin-ring', name: '유적 반지', slot: 'accessory', level: 3, attack: 3, defense: 2, hp: 8, rarity: '희귀' },
]
export function newRpg() {
  const state = { v: 5, life: newLife(), revision: 0, configRevision: 0, seq: 0, settings: { ...RPG_DEFAULTS }, actors: [], items: baseItems(), quests: [], logs: [], pending: null, assets: [], art: {}, nextAiAt: 0, dmRetryAt: 0, error: null, aiFailures: 0, aiPaused: false, daily: { day: '', count: 0 },
    zones: [
      { id: 'forest', name: '뿌리 지하 회랑', kind: 'dungeon', floor: 1, level: 1, kills: 0, expanded: false, cleared: false, seed: randomUUID(), design: { theme: '뿌리와 이끼로 덮인 지하', size: 'small', layout: 'rooms', enemies: 3 }, metrics: { entries: 0, deaths: 0, retreats: 0, damage: 0, steps: 0 }, dropId: 'forest-blade', monster: { name: '뿌리 슬라임', hp: 28, attack: 7, defense: 1 } },
    ] }
  migrateLife(state)
  migrateAgents(state)
  return state
}
export function migrateRpg(state, now = Date.now()) {
  migrateAgents(state)
  if (state.v >= 5) return state
  if (state.v >= 3) { migrateLife(state); state.v = 5; return state }
  if (state.v < 2) {
  state.zones.sort((a, b) => a.level - b.level)
  for (const [i, zone] of state.zones.entries()) {
    Object.assign(zone, { kind: 'dungeon', floor: i + 1, parentId: state.zones[i - 1]?.id ?? null, expanded: i < state.zones.length - 1, cleared: false, seed: randomUUID(), design: { theme: zone.name, size: 'small', layout: 'rooms', enemies: Math.min(6, 3 + Math.floor(zone.level / 3)) }, metrics: { entries: 0, deaths: 0, retreats: 0, damage: 0, steps: 0 } })
  }
  for (const actor of state.actors) if (actor.expedition) {
    const quest = state.quests.find(q => q.id === actor.questId), progress = quest?.progress
    returnHome(state, actor, now, false)
    if (quest) quest.progress = progress
  }
  // Old requests carry the old combat/content contract; cancel them through the service.
  state.pending = null; state.v = 2; state.configRevision++; delete state.settings.expansionKills
  log(state, '던전 탐험으로 전환 · 기존 원정 귀환, 캐릭터와 의뢰 보존', null, now)
  }
  for (const actor of state.actors) { actor.supplies ??= { health: 0, mana: 0 }; actor.journal ??= []; actor.avoid ??= {} }
  for (const zone of state.zones) if (zone.map) {
    ensureObjectives(zone.map)
    for (const entity of zone.map.entities) if (entity.kind === 'enemy') entity.pattern ??= entity.claimedBy ? 'normal' : entity.boss ? zone.design.bossPattern ?? 'charge' : 'normal'
  }
  for (const q of state.quests) q.type ??= 'hunt'
  state.v = 5; state.configRevision++
  migrateLife(state)
  return state
}
export const unlocked = (state, zone) => !zone.parentId || !!state.zones.find(z => z.id === zone.parentId)?.cleared
export function ensureFloor(zone) {
  zone.map ??= generateDungeon(zone.seed, zone.design, zone.monster)
  return zone.map
}
export function releaseEncounter(state, actor) {
  const zone = state.zones.find(z => z.id === actor.expedition?.zoneId)
  for (const entity of zone?.map?.entities ?? []) if (entity.claimedBy === actor.id) entity.claimedBy = null
}
export function stats(state, actor) {
  const bonuses = Object.values(actor.equipment).map(id => actor.inventory.find(item => item.id === id)).filter(Boolean).map(item => state.items.find(def => def.id === item.itemId)).filter(isGear)
  const job = actor.job
  return bonuses.reduce((s, item) => ({ hp: s.hp + item.hp, mp: s.mp, attack: s.attack + item.attack, defense: s.defense + item.defense, speed: s.speed }),
    { hp: 50 + actor.level * 12 + (job === 'warrior' ? 15 : 0), mp: 12 + actor.level * 3 + (job === 'mage' ? 15 : 0), attack: 7 + actor.level * 3 + (job === 'ranger' ? 2 : 0), defense: 1 + actor.level * 2 + (job === 'warrior' ? 1 : 0), speed: 5 + actor.level + (job === 'ranger' ? 3 : 0) })
}
/** `extra` rides along to the village: `quiet` keeps a line out of village news, `oracle` carries the priest's words. */
/** A routine dungeon line: shown in the broadcast, kept out of the village feed and residents' memories. */
export const QUIET = Object.freeze({ quiet: true })
export function log(state, text, actorId = null, now = Date.now(), extra = null) {
  state.logs.push({ id: ++state.seq, at: now, actorId, text: String(text), ...extra })
  state.logs = state.logs.slice(-100)
}
export function syncActors(state, residents) {
  for (const actor of state.actors) actor.active = residents.some(r => r.profileId === actor.profileId)
  for (const resident of residents) {
    let actor = state.actors.find(a => a.profileId === resident.profileId)
    if (!actor) {
      if (state.actors.length >= 60) throw new Error('보관 중인 RPG 주민이 60명이야.')
      const weapon = { id: randomUUID(), itemId: 'wood-sword' }, armor = { id: randomUUID(), itemId: 'cloth' }
      actor = {
        id: randomUUID(), profileId: resident.profileId, name: resident.name, role: 'adventurer', job: null, active: true,
        level: 1, xp: 0, gold: 0, completed: 0, deaths: 0, rank: 'F',
        inventory: [weapon, armor], storage: [], stacks: {}, storedStacks: {}, equipment: { weapon: weapon.id, armor: armor.id, accessory: null }, supplies: { health: 0, mana: 0 },
        journal: [], avoid: {}, phase: 'town', readyAt: 0, questId: null, expedition: null,
      }
      Object.assign(actor, { hp: stats(state, actor).hp, mp: stats(state, actor).mp })
      state.actors.push(actor)
    }
    actor.active = true; actor.name = resident.name
    ensureStatuses(state, actor)
  }
  for (const actor of state.actors.filter(a => !a.active && a.expedition)) returnHome(state, actor, Date.now(), false)
}
export function parseSettings(input, current, profiles) {
  if (!input || typeof input !== 'object') throw new Error('RPG 설정이 필요해.')
  const next = { ...current, ...agentSettings(current, input) }
  for (const key of ['judgeProfileId', 'judgeModel', 'combatModel', 'combatProfileId']) delete next[key]
  for (const key of ['enabled', 'art']) if (input[key] !== undefined) { if (typeof input[key] !== 'boolean') throw new Error('설정을 다시 확인해줘.'); next[key] = input[key] }
  for (const key of ['dmProfileId']) if (input[key] !== undefined) {
    if (input[key] !== null && !profiles.some(p => p.id === input[key])) throw new Error('사용할 수 있는 GM·판단 프로필을 골라줘.')
    next[key] = input[key]
  }
  for (const [key, min, max] of [['maxZones', 3, 30], ['dmDailyLimit', 1, 10], ['xpLoss', 0, 100], ['goldLoss', 0, 100], ['gearLoss', 0, 100], ['reviveSeconds', 10, 600], ['stepMs', 500, 3000], ['roundMs', 500, 6000], ['assetDaily', 0, 200]]) if (input[key] !== undefined) next[key] = int(input[key], min, max, key)
  next.shifts = parseShifts(input.shifts, shiftsOf(current))
  if (input.gameArt !== undefined) next.gameArt = parseGameArt(input.gameArt, current.gameArt)
  return next
}
export function addQuest(state, input, now) {
  if (!state.zones.some(z => z.id === input.zoneId)) throw new Error('던전 층을 다시 골라줘.')
  if (state.quests.filter(q => !closedQuest(q)).length >= 20) throw new Error('진행 중인 의뢰는 최대 20개야.')
  const type = input.type ?? 'hunt'
  if (!Object.hasOwn(QUEST_TYPES, type)) throw new Error('의뢰 종류를 확인해줘.')
  const title = shortText(input.title, 80, '의뢰 이름'), count = int(input.count, type === 'explore' ? 20 : 1, type === 'explore' ? 100 : type === 'recover' ? 3 : ['clear', 'survey'].includes(type) ? 1 : 20, '목표 수')
  const note = input.note === undefined ? '' : typeof input.note === 'string' ? input.note.trim() : null
  if (note === null) throw new Error('의뢰 내용은 문자열로 써줘.')
  const zone = state.zones.find(z => z.id === input.zoneId)
  if (!unlocked(state, zone)) throw new Error('아직 열리지 않은 층이야.')
  const quest = { id: randomUUID(), title, note, type, zoneId: zone.id, count, progress: 0, actorId: null, status: 'open', ...questReward(type, count, zone.level), source: 'user', createdAt: now }
  state.quests = state.quests.filter(q => !closedQuest(q)).concat(state.quests.filter(closedQuest).slice(-20), quest)
  log(state, `새 의뢰 · ${title}`, null, now)
  return quest
}
export function cancelQuest(state, questId, now, direct = false) {
  const quest = state.quests.find(q => q.id === questId && (direct || q.source === 'user'))
  if (!quest) throw new Error('사용자 의뢰를 찾을 수 없어.')
  if (quest.source === 'guild') throw new Error('길드 자동 의뢰는 다음 진행 때 다시 생겨서 GM 취소를 지원하지 않아.')
  if (quest.status === 'cancelled') { if (direct) throw new Error('이미 취소한 의뢰야.'); return }
  if (quest.status !== 'open') throw new Error('아직 맡지 않은 의뢰만 취소할 수 있어.')
  quest.status = 'cancelled'; quest.cancelledAt = now
  log(state, `의뢰 취소 · ${quest.title}`, null, now)
}
export function availableZones(state, actor, now = Date.now(), type = 'hunt') {
  return state.zones.filter(z => unlocked(state, z) && z.level <= actor.level + 1 && floorReady(state, z, now, type))
}
function floorReady(state, zone, now, type) {
  if (!zone.map || ['explore', 'survey'].includes(type)) return true
  if (zone.cleared && zone.map.resetAt <= now && !state.actors.some(a => a.expedition?.zoneId === zone.id)) return true
  return zone.map.entities.some(e => !e.done && (type === 'recover' ? e.kind === 'relic' : type === 'clear' ? e.boss : e.kind === 'enemy'))
}
export function availableQuests(state, actor, now = Date.now()) {
  return state.quests.filter(q => q.status === 'open' && availableZones(state, actor, now, q.type ?? 'hunt').some(z => z.id === q.zoneId))
}
export function addXp(state, actor, xp) {
  actor.xp += xp
  while (actor.level < 50 && actor.xp >= xpFor(actor.level)) { actor.xp -= xpFor(actor.level); actor.level++ }
  if (actor.level === 50) actor.xp = Math.min(actor.xp, xpFor(50) - 1)
  const rank = rankOf(actor)
  if (rank !== actor.rank) { actor.rank = rank; log(state, `${actor.name} · ${rank} 랭크 승급`, actor.id) }
}
export function returnHome(state, actor, now, complete = true) {
  releaseEncounter(state, actor)
  const zone = state.zones.find(z => z.id === actor.expedition?.zoneId)
  const quest = state.quests.find(q => q.id === actor.questId && q.actorId === actor.id && q.status === 'active')
  if (quest) {
    if (complete && quest.progress >= quest.count) {
      const bonus = clerkBonus(state, quest.gold)
      quest.status = 'completed'; quest.completedAt = now; actor.gold += quest.gold + bonus; actor.completed++
      addXp(state, actor, quest.xp)
      log(state, `${actor.name} · ${quest.title} 완료 +${quest.gold}G${bonus ? ` (접수원 +${bonus}G)` : ''}`, actor.id, now)
    } else { quest.status = 'open'; quest.actorId = null; if (!complete) {
      quest.progress = 0; delete quest.explored
      if (quest.type === 'recover') for (const entity of zone?.map?.entities ?? []) if (entity.collectedByQuest === quest.id) { entity.done = false; delete entity.collectedByQuest }
    } }
  }
  if (zone) recordExpedition(actor, zone, stats(state, actor), now, actor.hp <= 0 ? 'death' : quest?.status === 'completed' ? 'completed' : complete ? 'returned' : 'recalled')
  if (zone && actor.hp > 0 && actor.expedition) log(state, `${actor.name} 귀환 · ${zone.floor}층 처치 ${actor.expedition.kills ?? 0} · 받은 피해 ${actor.expedition.damage ?? 0}`, actor.id, now)
  actor.questId = null; actor.expedition = null; actor.phase = 'town'; actor.readyAt = now
}
export function die(state, actor, now, random) {
  const zone = state.zones.find(z => z.id === actor.expedition?.zoneId)
  if (zone?.metrics) zone.metrics.deaths++
  const xpLoss = Math.ceil(actor.xp * state.settings.xpLoss / 100), goldLoss = Math.ceil(actor.gold * state.settings.goldLoss / 100)
  actor.xp = Math.max(0, actor.xp - xpLoss); actor.gold = Math.max(0, actor.gold - goldLoss)
  const slots = Object.keys(SLOTS).filter(slot => actor.equipment[slot])
  let lost = ''
  if (slots.length && random() < state.settings.gearLoss / 100) {
    const slot = slots[Math.floor(random() * slots.length)], id = actor.equipment[slot], item = actor.inventory.find(i => i.id === id)
    lost = state.items.find(i => i.id === item?.itemId)?.name ?? ''
    actor.inventory = actor.inventory.filter(i => i.id !== id); actor.equipment[slot] = null
  }
  actor.hp = 0
  returnHome(state, actor, now, false)
  actor.phase = 'dead'; actor.hp = 0; actor.deaths++; actor.readyAt = now + state.settings.reviveSeconds * 1000
  log(state, `${actor.name} 사망 · EXP −${xpLoss} / ${goldLoss}G 손실${lost ? ` / ${lost} 소실` : ''}`, actor.id, now)
}
export function depart(state, actor, input, now) {
  if (actor.phase !== 'town' || !actor.active || actor.role !== 'adventurer') return false
  // Some models use "quest" for a commissioned hunt. It still requires a live, matching quest below.
  if (input.action !== 'hunt' && !(input.action === 'quest' && typeof input.questId === 'string' && input.questId)) throw new Error('모험 행동을 이해하지 못했어.')
  const zone = state.zones.find(z => z.id === input.zoneId && unlocked(state, z) && z.level <= actor.level + 1)
  if (!zone) throw new Error('현재 도전할 수 없는 지역이야.')
  const quest = input.questId ? availableQuests(state, actor, now).find(q => q.id === input.questId && q.zoneId === zone.id) : null
  if (input.questId && !quest) throw new Error('다른 주민이 이미 맡은 의뢰야.')
  if (!['balanced', 'aggressive', 'cautious'].includes(input.tactic)) throw new Error('전투 전략을 다시 골라야 해.')
  if (!availableZones(state, actor, now, quest?.type ?? 'hunt').some(z => z.id === zone.id)) { actor.readyAt = now + 30_000; return false }
  actor.idleChoices = 0
  if (quest) { quest.status = 'active'; quest.actorId = actor.id; actor.questId = quest.id }
  const map = ensureFloor(zone)
  // Repopulate only an empty, cleared floor after everyone has left. Geometry/discovery stay fixed.
  if (zone.cleared && map.resetAt <= now && !state.actors.some(a => a.expedition?.zoneId === zone.id)) {
    for (const entity of map.entities) { entity.done = false; entity.claimedBy = null; entity.heals = 0; delete entity.collectedByQuest; if (entity.monster) { entity.hp = entity.monster.hp; entity.pattern = entity.boss ? zone.design.bossPattern ?? 'charge' : 'normal' } }
    map.cycle++; map.resetAt = now + 60_000
  }
  actor.knowledge ??= {}
  actor.expedition = {
    id: randomUUID(), zoneId: zone.id, monster: null, level: zone.level, dropId: zone.dropId, foeHp: 0, kills: 0,
    target: quest ? quest.count - quest.progress : null, wasUncleared: !zone.cleared, tactic: input.tactic,
    title: typeof input.title === 'string' ? input.title : '',
    round: 0, position: map.entrance, targetAt: null, encounterId: null, startedAt: now, steps: 0,
  }
  zone.metrics.entries++; zone.firstEnteredAt ??= now
  discover(state, zone, actor)
  actor.phase = 'travel'; actor.readyAt = now + stepMs(state) * 5
  log(state, `${actor.name} → ${zone.floor}층 ${zone.name}`, actor.id, now)
  return true
}
function discover(state, zone, actor) {
  const map = zone.map, e = actor.expedition
  actor.knowledge ??= {}
  actor.knowledge[zone.id] = reveal(map, actor.knowledge[zone.id], e.position)
  map.explored = [...map.explored].map((c, i) => c === '1' || actor.knowledge[zone.id][i] === '1' ? '1' : '0').join('')
  const q = state.quests.find(q => q.id === actor.questId && q.status === 'active')
  if (q?.type === 'explore') {
    q.explored = reveal(map, q.explored, e.position)
    const tiles = [...map.tiles], found = tiles.filter((t, i) => t === '.' && q.explored[i] === '1').length
    const next = Math.min(q.count, Math.floor(found / tiles.filter(t => t === '.').length * 100))
    e.progressGained = (e.progressGained ?? 0) + Math.max(0, next - q.progress); q.progress = next
  }
}
function retreat(state, actor, now, reason) {
  releaseEncounter(state, actor)
  const e = actor.expedition, zone = state.zones.find(z => z.id === e.zoneId)
  e.encounterId = null; e.monster = null; e.targetAt = null; e.question = null; e.awaiting = null; e.choice = null; e.returnReason = reason ?? ''
  actor.phase = 'return'; actor.readyAt = now + stepMs(state)
  if (reason) { zone.metrics.retreats++; log(state, `${actor.name} · ${reason}, 출구로 귀환`, actor.id, now) }
}
export function answerJudgement(state, actor, questionId, output, now) {
  const e = actor?.expedition, question = e?.question
  if (!question || question.id !== questionId || actor.phase !== 'consider') return false
  if (!['continue', 'return'].includes(output.action)) throw new Error('탐험 판단을 이해하지 못했어.')
  if (output.action === 'return') retreat(state, actor, now, '모델 귀환 판단')
  else { actor.phase = question.resume; actor.readyAt = now + stepMs(state); e.question = null; log(state, `${actor.name} · 탐험 지속 판단`, actor.id, now, QUIET) }
  return true
}
export function judgementEstimate(state, actor) {
  const e = actor.expedition, zone = state.zones.find(z => z.id === e.zoneId), map = zone.map
  const entity = map.entities.find(x => x.kind === 'enemy' && !x.done && x.at === e.position)
  const back = route(map, e.position, map.entrance, actor.knowledge[zone.id])
  return entity ? estimateFight(actor, stats(state, actor), entity.monster, entity.hp, entity.pattern, back?.length ?? null) : { returnSteps: back?.length ?? null }
}
export function navigationOptions(state, actor) {
  const e = actor.expedition, zone = state.zones.find(z => z.id === e.zoneId), map = zone.map, seen = actor.knowledge[zone.id]
  const quest = state.quests.find(q => q.id === actor.questId)
  const xy = at => `(${at % map.width},${Math.floor(at / map.width)})`
  const options = [{ id: 'return', description: `현재 ${xy(e.position)}에서 출구 ${xy(map.entrance)}로 귀환, 알려진 경로 ${route(map, e.position, map.entrance, seen)?.length ?? '없음'}칸. 좌표는 (x,y), 왼쪽 위 (0,0) 기준.` }, { id: 'wait', description: `현재 ${xy(e.position)}에서 다음 판단까지 기다려.` }]
  for (let at = 0; at < map.tiles.length; at++) if (at !== e.position && map.tiles[at] === '.' && seen[at] === '1' && route(map, e.position, at, seen)?.length) {
    const entity = map.entities.find(x => x.at === at && !x.done)
    options.push({ id: `move_${at}`, description: `${xy(at)}로 ${route(map, e.position, at, seen).length}칸 이동. ${at === map.entrance ? '출구.' : ''} ${neighbors(map, at).some(n => seen[n] !== '1') ? '주변에 아직 조사하지 않은 칸이 있어.' : '주변이 이미 발견됐어.'} ${entity ? `${entity.kind}: ${entity.monster?.name ?? ''}` : '발견된 통로'}. 적을 만나면 전투, 함정은 피해를 줘.`, data: { targetAt: at } })
  }
  const here = map.entities.find(x => x.at === e.position && !x.done && canInteract(x, quest))
  if (here) options.push({ id: 'interact', description: `${xy(e.position)} ${here.kind} 이용: ${{ rest: 'HP 최대치 30%와 MP 8 회복, 쉼터 1회 소비', chest: `${zone.level * 8}G 획득, 상자 1회 소비`, relic: '현재 유물 회수 의뢰 진행 +1, 유물 회수', landmark: '현재 기록실 조사 의뢰 진행 +1' }[here.kind]}. 한 걸음 시간 소비.`, data: { entityId: here.id } })
  for (const key of ['health', 'mana']) if (actor.supplies?.[key] > 0) options.push({ id: `potion_${key}`, description: `${POTIONS[key].name} 1개 소비: ${key === 'health' ? 'HP 45%' : 'MP 12'} 회복.`, data: { potion: key } })
  return options
}
const canInteract = (entity, quest) => ['rest', 'chest'].includes(entity.kind) ||
  !!quest && quest.progress < quest.count && (entity.kind === 'relic' && quest.type === 'recover' || entity.kind === 'landmark' && quest.type === 'survey')
function walk(state, actor, zone, now, random) {
  const e = actor.expedition, map = zone.map, returning = actor.phase === 'return', seen = actor.knowledge[zone.id]
  if (returning && e.position === map.entrance) { returnHome(state, actor, now); return }
  const quest = state.quests.find(q => q.id === actor.questId)
  const s = stats(state, actor)
  const choice = e.navigationChoice
  if (choice) {
    e.navigationChoice = null; e.navigationAsk = null
    if (choice.action === 'return') { retreat(state, actor, now, '모델 귀환 선택'); return }
    if (choice.action === 'wait') { actor.readyAt = now + stepMs(state); return }
    if (choice.potion) { drinkChosen(state, actor, now, choice.potion); actor.readyAt = now + stepMs(state); return }
    if (Number.isInteger(choice.targetAt)) e.targetAt = choice.targetAt
  }
  const entity = map.entities.find(x => x.at === e.position && !x.done && (['enemy', 'trap'].includes(x.kind) || canInteract(x, quest)))
  if (entity && !returning) {
    if (entity.kind === 'enemy') {
      if (entity.claimedBy && entity.claimedBy !== actor.id) { actor.readyAt = now + stepMs(state) * 2; return }
      entity.claimedBy = actor.id; e.encounterId = entity.id; e.monster = { ...entity.monster }; e.foeHp = entity.hp; e.round = 0; e.enemyRound = 0; e.last = null; e.intent = enemyIntent(entity, 0); e.choice = null; e.targetAt = null
      e.awaiting = { id: randomUUID(), round: 0, since: now }
      e.enemyAt = now + roundMs(state)
      actor.phase = 'combat'; actor.readyAt = now + roundMs(state)
      log(state, `${actor.name} · ${entity.monster.name} 조우`, actor.id, now, entity.boss ? null : QUIET); return
    }
    if (entity.kind === 'trap' || choice?.entityId === entity.id) {
    if (entity.kind !== 'landmark') entity.done = true
    if ((entity.kind === 'relic' && quest?.type === 'recover') || (entity.kind === 'landmark' && quest?.type === 'survey')) {
      quest.progress = Math.min(quest.count, quest.progress + 1); e.progressGained = (e.progressGained ?? 0) + 1
      if (entity.kind === 'relic') entity.collectedByQuest = quest.id
      log(state, `${actor.name} · ${entity.kind === 'relic' ? '유물 회수' : '기록실 조사'} (${quest.progress}/${quest.count})`, actor.id, now, QUIET)
    }
    if (entity.kind === 'chest') { actor.gold += zone.level * 8; log(state, `${actor.name} · 상자 +${zone.level * 8}G`, actor.id, now, QUIET) }
    if (entity.kind === 'rest') { actor.hp = Math.min(s.hp, actor.hp + Math.ceil(s.hp * .3)); actor.mp = Math.min(s.mp, actor.mp + 8); log(state, `${actor.name} · 쉼터 회복`, actor.id, now, QUIET) }
    if (entity.kind === 'trap') { const damage = zone.level * 3; actor.hp = Math.max(0, actor.hp - damage); zone.metrics.damage += damage; e.damage = (e.damage ?? 0) + damage; log(state, `${actor.name} · 함정 −${damage}HP`, actor.id, now, QUIET); if (!actor.hp) { die(state, actor, now, random); return } }
    if (choice?.entityId === entity.id) { actor.readyAt = now + stepMs(state); return }
    }
  }
  if (!returning && (e.targetAt === null || e.targetAt === undefined || e.targetAt === e.position)) {
    e.targetAt = null; e.navigationAsk ??= { id: randomUUID(), since: now }; return
  }
  const target = returning ? map.entrance : e.targetAt, path = route(map, e.position, target, seen)
  if (!path?.length) { e.targetAt = null; e.navigationAsk ??= { id: randomUUID(), since: now }; return }
  e.targetAt = target; e.position = path[0]; e.steps++; zone.metrics.steps++; discover(state, zone, actor)
  actor.readyAt = now + stepMs(state)
}
/** An adventurer in town who has no calling yet, or has ranked up since the last one. */
export const needsOracle = (actor, now) => actor.active && actor.role === 'adventurer' && actor.phase === 'town' && (actor.oracleAt ?? 0) <= now && (!actor.calling || actor.calling.rank !== actor.rank)
export function oracleClass(output) {
  if (Object.hasOwn(CLASSES, output.class)) return output.class
  throw new Error('신탁 모델이 유효한 class를 고르지 않았어. 새 모델 판단을 기다려.')
}
/**
 * The staff's day. A role is open while its shift runs and someone holds it; the holder is paid when a shift it worked
 * ends, and pays the inn for each night it sleeps there (server.mjs sends a resident who can't pay to sleep outside).
 * Where everyone walks is the village's part (errands in server.mjs); this only keeps the books.
 */
export function livelihood(state, world, now) {
  const minute = world.clock ?? 0, shifts = shiftsOf(state.settings)
  state.open = Object.fromEntries(Object.keys(STAFF).map(role => [role, hasFacility(state, role) && state.actors.some(a => a.active && a.role === role && a.working)]))
  for (const actor of state.actors) {
    if (!actor.active || !Object.hasOwn(STAFF, actor.role)) { actor.onShift = false; continue }
    const r = world.residents.find(x => x.profileId === actor.profileId)
    const elapsed = Math.max(0, minute - (actor.workClock ?? minute))
    actor.workClock = minute
    if (actor.onShift) {
      const shift = shifts[actor.role], duration = (shift.close - shift.open + DAY) % DAY || DAY
      actor.wageFraction = (actor.wageFraction ?? 0) + WAGES[actor.role] * elapsed / duration
      const gold = Math.floor(actor.wageFraction)
      actor.gold += gold; actor.wageFraction -= gold
    }
    actor.onShift = !!actor.working && !!state.open[actor.role] && !!r && !r.asleep && !r.away
  }
}
export function answerOracle(state, actor, oracle, output, now, translation = null) {
  if (!actor?.active || actor.role !== 'adventurer') return false
  if (!output) throw new Error('신탁 답이 비어 있어.')
  const clazz = oracleClass(output)
  const clip = value => typeof value === 'string' ? value.trim() : ''
  const job = clip(output.job, 30)
  if (!job) throw new Error('신탁에 직업 이름이 없어.')
  const skills = (Array.isArray(output.skills) ? output.skills : []).map(k => {
    if (!clip(k?.name) || !Object.hasOwn(SKILL_KINDS, k?.kind)) throw new Error('신탁 모델이 유효한 스킬 이름·kind를 고르지 않았어. 새 모델 판단을 기다려.')
    return { name: clip(k.name), effect: clip(k.effect), kind: k.kind }
  })
  if (!skills.length) throw new Error('신탁에 스킬이 없어.')
  const say = typeof output.say === 'string' ? output.say.trim() : ''
  const first = !actor.calling
  const display = translation?.status === 'completed' ? translation.json : null
  actor.job = clazz; actor.calling = { job, skills, rank: actor.rank, at: now, by: oracle.name }; actor.oracleAt = 0
  if (display) actor.calling.translation = { language: translation.language, job: clip(display.job, 60), skills: skills.map((k, i) => ({ name: clip(display.skills?.[i]?.name, 40) || k.name, effect: clip(display.skills?.[i]?.effect, 160) || k.effect })) }
  // An offering for the shrine when the adventurer can spare it; the priest keeps it.
  const priest = state.actors.find(a => a.active && a.role === 'oracle' && a.profileId === oracle.profileId)
  actor.oracleRequested = false
  const s = stats(state, actor); actor.hp = Math.min(actor.hp, s.hp); actor.mp = Math.min(actor.mp, s.mp)
  log(state, `${actor.name} · ${first ? '신탁' : `${actor.rank} 랭크 신탁`} 「${job}」 · ${skills.map(k => k.name).join(', ')}`, actor.id, now, say ? { oracle: { profileId: oracle.profileId, name: oracle.name, say, ...(display ? { displaySay: typeof display.say === 'string' ? display.say : null, language: translation.sourceLanguage, displayLanguage: translation.language } : {}) } } : null)
  return true
}
/** Only explicitly model-assigned skill kinds are executable, including after migration. */
export const skillsOf = actor => (actor.calling?.skills ?? []).filter(k => typeof k.name === 'string' && Object.hasOwn(SKILL_KINDS, k.kind))
/** The skill used this turn: the one the model named, else a mending one when hurt, else the attacks in turn. */
function skillFor(actor, s, named) {
  return skillsOf(actor).find(k => k.name === named) ?? null
}
/** Consume only the named potion, never select one based on HP. */
function drinkChosen(state, actor, now, key) {
  const s = stats(state, actor); actor.supplies ??= { health: 0, mana: 0 }
  if (!Object.hasOwn(POTIONS, key) || !(actor.supplies[key] > 0)) return null
  actor.supplies[key]--
  if (key === 'health') actor.hp = Math.min(s.hp, actor.hp + Math.ceil(s.hp * .45)); else actor.mp = Math.min(s.mp, actor.mp + 12)
  actor.expedition.potions = (actor.expedition.potions ?? 0) + 1; log(state, `${actor.name} · ${POTIONS[key].name} 사용`, actor.id, now, QUIET)
  return key
}
/**
 * One step of every adventurer. `hooks.atGate(actor)` holds the walk into the dungeon until the resident has
 * reached the village's south road (with a safety limit).
 */
export function advance(state, now, random, hooks = {}) {
  for (const actor of state.actors) {
    if (!actor.active || actor.role !== 'adventurer' || actor.readyAt > now) continue
    if (actor.phase === 'dead' || actor.phase === 'rest') {
      const revived = actor.phase === 'dead'
      actor.phase = 'town'; actor.hp = stats(state, actor).hp; actor.mp = stats(state, actor).mp; actor.readyAt = now + 5_000
      if (revived) log(state, `${actor.name} 부활`, actor.id, now)
      continue
    }
    const e = actor.expedition
    if (!e) continue
    const zone = state.zones.find(z => z.id === e.zoneId)
    if (actor.phase === 'consider') {
      actor.phase = 'explore'; e.question = null; e.targetAt = null
      e.navigationAsk ??= { id: randomUUID(), since: now }
      continue
    }
    if (actor.phase === 'travel') {
      // Safety limit for a resident who never reaches the road (slow walkers need a few minutes from the inn).
      if (hooks.atGate && !hooks.atGate(actor)) { actor.readyAt = now + 500; continue }
      actor.phase = 'explore'; actor.readyAt = now + stepMs(state); continue
    }
    if (actor.phase === 'explore' || actor.phase === 'return') { walk(state, actor, zone, now, random); continue }
    if (actor.phase !== 'combat') continue
    const entity = zone.map.entities.find(x => x.id === e.encounterId && !x.done && x.claimedBy === actor.id)
    if (!entity) { e.encounterId = null; e.monster = null; e.awaiting = null; e.choice = null; actor.phase = 'explore'; continue }
    const s = stats(state, actor)
    // Resident turns and NPC turns have independent clocks. A missing answer
    // consumes no resident action; monsters and the rest of this loop keep moving.
    const choice = e.choice?.round === e.round ? e.choice : null
    if (!choice) {
      e.awaiting ??= { id: randomUUID(), round: e.round, since: now }
      monsterStep(state, actor, zone, entity, now, random)
      continue
    }
    const valid = availableActions(state, 'combat').find(a => a.id === choice.action)
    if (!valid || (choice.action === 'skill' && (actor.mp < 4 || !skillFor(actor, s, choice.skill))) ||
      (choice.action === 'potion' && !(actor.supplies?.[choice.potion] > 0)) || (!valid.builtin && actor.mp < valid.effect.mpCost)) {
      e.choice = null; e.awaiting = { id: randomUUID(), round: e.round, since: now }; actor.combatError = '선택한 행동이 더는 가능하지 않아. 새 모델 판단을 기다려.'
      monsterStep(state, actor, zone, entity, now, random); continue
    }
    const said = choice?.say ?? ''
    const custom = choice && availableActions(state, 'combat').find(a => a.id === choice.action && !a.builtin)
    const effect = custom && actor.mp >= custom.effect.mpCost ? custom.effect : null
    if (effect) {
      actor.mp -= effect.mpCost
      if (effect.fleeChance > 0 && random() < effect.fleeChance) { retreat(state, actor, now, custom.label); continue }
    }
    if (choice?.action === 'flee') choice.action = 'retreat'
    if (choice?.action === 'retreat') { if (said) log(state, `${actor.name} · "${said}"`, actor.id, now, { quiet: true }); retreat(state, actor, now, '스스로 후퇴'); continue }
    const potion = choice.action === 'potion' ? drinkChosen(state, actor, now, choice.potion) : null
    const intent = enemyIntent(entity, e.enemyRound ?? 0)
    const skill = !potion && choice.action === 'skill'
    const used = skill ? skillFor(actor, s, choice?.skill, e.round) : null
    const kind = skill ? used.kind : null, skillName = skill ? used.name : ''
    if (skill) actor.mp -= 4
    const guardSkill = kind === 'guard', guarding = guardSkill || (effect ? effect.guard > 0 : choice.action === 'guard')
    const critical = random() < (actor.job === 'ranger' ? .18 : .1)
    // Skills by kind; a mage's skills hit a quarter harder. A plain guard (not the guard skill) also hits softer.
    const boost = actor.job === 'mage' ? 1.25 : 1, foeGuard = intent === 'guard' ? .45 : 1, soft = guarding && !guardSkill ? .7 : 1
    const hit = (mult, pierce = false) => Math.max(1, Math.round((s.attack * mult * (critical ? 1.5 : 1) - (pierce ? 0 : e.monster.defense)) * foeGuard * soft))
    let damage = 0, healed = 0
    if (potion || kind === 'heal') damage = 0
    else if (!skill) damage = effect?.damage === 0 ? 0 : hit(effect?.damage ?? 1)
    else if (kind === 'double') damage = hit(.85 * boost) + hit(.85 * boost)
    else if (kind === 'pierce') damage = hit(1.3 * boost, true)
    else if (kind === 'drain') damage = hit(1.2 * boost)
    else if (kind === 'guard') damage = hit(boost)
    else damage = hit(1.5 * boost)
    if (kind === 'heal') healed = Math.min(s.hp - actor.hp, Math.ceil(s.hp * .3))
    if (kind === 'drain') healed = Math.min(s.hp - actor.hp, Math.floor(damage * .5))
    if (effect) healed = Math.min(s.hp - actor.hp, healed + Math.floor(s.hp * effect.heal))
    actor.hp += Math.max(0, healed)
    entity.hp = Math.max(0, entity.hp - damage); e.foeHp = entity.hp; e.round++
    e.last = { dealt: damage, taken: 0, healed: Math.max(0, healed), skill, skillName, kind, critical: !potion && critical, potion: potion ?? null, guarding, intent, say: said, ...(choice?.displaySay ? { displaySay: choice.displaySay } : {}), ai: !!choice && !choice.rules }
    e.choice = null; e.awaiting = null
    if (choice && (skill || said)) log(state, `${actor.name} · ${skill ? `「${skillName}」` : ''}${skill && said ? ' ' : ''}${said ? `"${said}"` : ''}`, actor.id, now, { quiet: true })
    if (e.foeHp === 0) {
      actor.gold += e.level * 5; addXp(state, actor, e.level * 12); e.kills++
      entity.done = true; entity.claimedBy = null; zone.kills++
      const quest = state.quests.find(q => q.id === actor.questId && q.actorId === actor.id && q.status === 'active'); if (quest && (quest.type ?? 'hunt') === 'hunt') { quest.progress = Math.min(quest.count, quest.progress + 1); e.progressGained = (e.progressGained ?? 0) + 1 }
      if (entity.boss && quest?.type === 'clear') { quest.progress = quest.count; e.progressGained = (e.progressGained ?? 0) + 1 }
      if (entity.boss && !zone.cleared) {
        zone.cleared = true; zone.clearedAt = now; zone.map.resetAt = now + 60_000
        log(state, `${zone.floor}층 공략 완료 · 다음 층 계단 개방`, actor.id, now)
      }
      if (random() < .35) {
        if (actor.inventory.length < BAG && (hasFacility(state, 'merchant') || gearOf(actor).length < BAG + STASH)) { actor.inventory.push({ id: randomUUID(), itemId: e.dropId }); log(state, `${actor.name} · ${state.items.find(i => i.id === e.dropId)?.name ?? '장비'} 획득`, actor.id, now) }
        else log(state, `${actor.name} · 가방이 가득 차 전리품을 가져올 수 없어`, actor.id, now)
      }
      log(state, `${actor.name} · ${e.monster.name} 처치`, actor.id, now, entity.boss ? null : QUIET)
      e.encounterId = null; e.monster = null; actor.phase = 'explore'; actor.readyAt = now + roundMs(state)
      continue
    }
    monsterStep(state, actor, zone, entity, now, random, effect ? 1 - effect.guard : guardSkill ? .4 : guarding ? .55 : 1)
    if (actor.phase === 'combat') e.awaiting = { id: randomUUID(), round: e.round, since: now }
  }
}
function monsterStep(state, actor, zone, entity, now, random, reduction = 1) {
  const e = actor.expedition
  if ((e.enemyAt ?? 0) > now) return
  const s = stats(state, actor), intent = enemyIntent(entity, e.enemyRound ?? 0)
  const dodged = random() < Math.min(.25, Math.max(0, s.speed - e.level * 2) * .01)
  const taken = ['charge', 'heal'].includes(intent) || dodged ? 0 : Math.max(1, Math.round((e.monster.attack * (.85 + random() * .3) * (intent === 'strike' ? 1.8 : 1) - s.defense * (e.tactic === 'cautious' ? 1.2 : 1)) * reduction))
  if (intent === 'heal') { entity.hp = Math.min(entity.monster.hp, entity.hp + Math.ceil(entity.monster.hp * .15)); entity.heals = (entity.heals ?? 0) + 1; e.foeHp = entity.hp }
  e.enemyRound = (e.enemyRound ?? 0) + 1; e.enemyAt = now + roundMs(state); e.intent = enemyIntent(entity, e.enemyRound)
  actor.hp = Math.max(0, actor.hp - taken); zone.metrics.damage += taken; e.damage = (e.damage ?? 0) + taken
  if (e.last) e.last.taken = taken
  actor.readyAt = now + roundMs(state)
  if (actor.hp === 0) die(state, actor, now, random)
}
export function expand(state, parent, proposal, now, direct = false) {
  if (parent.expanded || (!direct && !parent.cleared) || state.zones.length >= state.settings.maxZones) return null
  if (!proposal || proposal.kind !== 'dungeon') throw new Error('GM 던전 형식이 올바르지 않아.')
  const design = { theme: shortText(clipProse(proposal.theme, 100), 100, '층 테마'), size: proposal.size, layout: proposal.layout, enemies: int(proposal.enemies, 3, 10, '적 수'), bossPattern: proposal.bossPattern ?? 'charge' }
  if (!Object.hasOwn(PATTERNS, design.bossPattern)) throw new Error('수호자 행동 유형을 확인해줘.')
  if (!Object.hasOwn(SIZES, design.size) || !['maze', 'rooms', 'loops'].includes(design.layout)) throw new Error('층 규모나 구조를 확인해줘.')
  const level = Math.min(50, parent.level + 1), m = proposal.monster, item = proposal.item
  const name = shortText(clipProse(proposal.name, 40), 40, '지역 이름'), monsterName = shortText(clipProse(m?.name, 40), 40, '몬스터 이름'), itemName = shortText(clipProse(item?.name, 40), 40, '장비 이름')
  if (state.zones.some(z => z.name === name)) throw new Error('이미 있는 지역 이름이야.')
  if (!Object.hasOwn(SLOTS, item.slot)) throw new Error('장비 슬롯이 올바르지 않아.')
  const hp = int(m.hp, 15 + level * 8, 50 + level * 22, '몬스터 HP'), attack = int(m.attack, 2 + level * 2, 7 + level * 5, '몬스터 공격력'), defense = int(m.defense, 0, 2 + level * 3, '몬스터 방어력')
  if (hp + attack * 4 + defense * 5 > 100 + level * 45) throw new Error('몬스터 전력 예산을 넘었어.')
  const ia = int(item.attack, 0, level * 4 + 2, '장비 공격력'), id = int(item.defense, 0, level * 3 + 2, '장비 방어력'), ih = int(item.hp, 0, level * 10 + 5, '장비 HP')
  if (ia * 3 + id * 3 + ih > 18 + level * 14 || ia + id + ih === 0) throw new Error('장비 능력치 예산이 올바르지 않아.')
  const prompt = clipProse(proposal.visualPrompt, 600)
  const zoneId = randomUUID(), itemId = randomUUID()
  state.items.push({ id: itemId, name: itemName, slot: item.slot, level, attack: ia, defense: id, hp: ih, rarity: '희귀' })
  const zone = { id: zoneId, name, kind: 'dungeon', floor: parent.floor + 1, level, kills: 0, expanded: false, cleared: false, parentId: parent.id, seed: randomUUID(), design, metrics: { entries: 0, deaths: 0, retreats: 0, damage: 0, steps: 0 }, dropId: itemId, monster: { name: monsterName, hp, attack, defense }, visualPrompt: prompt, imageHash: null }
  state.zones.push(zone); parent.expanded = true
  // The DM's look for what it just made; anything left out is asked for later with the other pictures.
  setLook(state, `monster:${zoneId}`, m.look); setLook(state, `boss:${zoneId}`, proposal.bossLook); setLook(state, `item:${itemId}`, item.look)
  // The DM remembers what it designed: the floor, its theme and its monster.
  log(state, `${zone.floor}층 설계 완료 · ${name}${artProblem(state) ? ` · 그림은 아직 만들 수 없어: ${artProblem(state)}` : ''}`, null, now, { dmDesign: clipProse(`${zone.floor}층 「${name}」 · 테마: ${design.theme} · 몬스터: ${monsterName} · 보상: ${itemName}`, 300) })
  return zone
}
