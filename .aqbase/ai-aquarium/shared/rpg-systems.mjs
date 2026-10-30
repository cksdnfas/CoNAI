// Small, deterministic economy and expedition records. Only the domain transaction mutates these.
export const QUEST_TYPES = { hunt: '토벌', clear: '수호자 공략', explore: '지도 탐사', survey: '기록실 조사', recover: '유물 회수' }
export const PATTERNS = { normal: '일반', charge: '강공격 예고', guard: '방어 태세', mend: '자가 회복' }
export const POTIONS = { health: { name: '회복약', price: 12 }, mana: { name: '마나약', price: 10 } }
/** What a skill does in a fight. The oracle picks one per skill; the names and words stay free text. */
export const SKILL_KINDS = { strike: '강한 한 방', double: '두 번 공격', pierce: '방어 무시', drain: '준 피해 절반 회복', heal: 'HP 30% 회복', guard: '받는 피해 크게 줄임' }
/** Paid at the inn after every expedition that ends on foot; without the money the rest takes twice as long. */
export const innFee = actor => 5 + actor.level * 2
/** Whoever holds `role` while it is open (its shift, see livelihood); off duty the shop and guild run without them. */
export const hasFacility = (state, role) => !state.life || state.life.buildings.some(b => b.role === role)
export const holder = (state, role) => !hasFacility(state, role) || state.open?.[role] === false ? null : state.actors.find(a => a.active && a.role === role) ?? null
/** A merchant in the village sells potions a fifth cheaper and keeps a better piece for every cleared floor. */
export const potionPrice = (state, key) => holder(state, 'merchant') ? Math.ceil(POTIONS[key].price * .8) : POTIONS[key].price
/** A guild clerk adds a fifth to every quest reward. */
export const clerkBonus = (state, gold) => holder(state, 'guild') ? Math.ceil(gold * .2) : 0
export function specialOf(state, zone) {
  const drop = state.items.find(i => i.id === zone.dropId)
  if (!isGear(drop)) return null
  const id = `special-${zone.id}`
  let def = state.items.find(i => i.id === id)
  if (!def) {
    def = { id, name: `상인 특제 ${drop.name}`, slot: drop.slot, level: drop.level, attack: drop.attack ? drop.attack + 2 + zone.level : 0, defense: drop.defense ? drop.defense + 1 + zone.level : 0, hp: drop.hp ? drop.hp + 5 + zone.level * 3 : 0, rarity: '희귀' }
    if (!def.attack && !def.defense && !def.hp) def.attack = 2
    state.items.push(def)
  }
  return def
}
/**
 * The bag holds what is worn plus loot found on the way (BAG pieces); everything else waits in the home storage.
 * Gear is chosen in town from both, so a resident walks in with its best pieces and nothing spare.
 */
export const BAG = 6, STASH = 40
export const isGear = item => !!item && !item.stackable && ['weapon', 'armor', 'accessory'].includes(item.slot)
export const gearOf = actor => [...actor.inventory, ...(actor.storage ?? [])]
/** Worn pieces into the bag, the rest into storage; a full storage sells its weakest spares. Returns how many were sold. */
export function stow(state, actor) {
  const worn = new Set(Object.values(actor.equipment).filter(Boolean)), all = gearOf(actor)
  actor.inventory = all.filter(i => worn.has(i.id)); actor.storage = all.filter(i => !worn.has(i.id))
  return 0
}
/** Gear on sale: the starting pieces and cleared floors' drops, plus the merchant's specials. */
export function shopStock(state) {
  if (!hasFacility(state, 'merchant')) return []
  const base = state.items.filter(d => isGear(d) && (['wood-sword', 'cloth'].includes(d.id) || state.zones.some(z => z.cleared && z.dropId === d.id)))
  return holder(state, 'merchant') ? [...base, ...state.zones.filter(z => z.cleared).map(z => specialOf(state, z)).filter(Boolean)] : base
}
export function questReward(type, count, level) {
  const units = type === 'explore' ? Math.ceil(count / 20) : type === 'clear' ? 4 : type === 'survey' ? 3 : type === 'recover' ? count * 3 : count
  return { gold: units * level * 8, xp: units * level * 10 }
}
export const gearScore = (item, job) => isGear(item) ? item.attack * (job === 'ranger' ? 5 : job === 'mage' ? 4 : 2) + item.defense * (job === 'warrior' ? 4 : 2) + item.hp * (job === 'warrior' ? .5 : .2) : 0
export const gearPrice = item => isGear(item) ? Math.ceil(20 + item.level * 12 + item.attack * 6 + item.defense * 6 + item.hp) : 0
export const power = stats => Math.round(stats.attack * 3 + stats.defense * 3 + stats.hp / 4)
export function recordExpedition(actor, zone, stats, now, outcome) {
  const e = actor.expedition
  if (!e) return
  actor.journal ??= []; actor.avoid ??= {}
  const record = { zoneId: zone.id, floor: zone.floor, at: now, outcome, reason: e.returnReason ?? (outcome === 'death' ? e.monster?.name ?? '함정' : ''), kills: e.kills ?? 0, steps: e.steps ?? 0, hp: actor.hp, damage: e.damage ?? 0, potions: e.potions ?? 0, questProgress: e.progressGained ?? 0 }
  actor.journal = [...actor.journal, record].slice(-6)
  const failure = outcome === 'death' || !!e.returnReason || (!e.kills && !e.progressGained)
  if (failure) {
    const previous = actor.avoid[zone.id], attempts = Math.min(6, (previous?.attempts ?? 0) + 1)
    actor.avoid[zone.id] = { attempts, until: now + Math.min(1800, 60 * 2 ** (attempts - 1)) * 1000, power: power(stats), reason: record.reason || '성과 없는 원정' }
  } else delete actor.avoid[zone.id]
}
export function retryAfter(actor, zone, stats, now) {
  const avoid = actor.avoid?.[zone.id]
  return avoid && power(stats) <= avoid.power * 1.1 ? Math.max(0, avoid.until - now) : 0
}
export function estimateFight(actor, stats, monster, foeHp, pattern, returnSteps) {
  const damage = Math.max(1, stats.attack - monster.defense), enemyHit = Math.max(1, Math.ceil(monster.attack * 1.15 - stats.defense))
  const rounds = Math.ceil(foeHp / damage) + (pattern === 'guard' || pattern === 'mend' ? 2 : 0)
  const expectedDamage = Math.max(0, rounds - 1) * enemyHit * (pattern === 'charge' ? 1.3 : 1)
  return { approximate: true, rounds, damagePerHit: enemyHit, expectedDamage: Math.ceil(expectedDamage), hpAfter: Math.floor(actor.hp - expectedDamage), healingAvailable: (actor.supplies?.health ?? 0) * Math.ceil(stats.hp * .45), returnSteps, pattern: PATTERNS[pattern] ?? PATTERNS.normal }
}
export function enemyIntent(entity, round) {
  const pattern = entity.pattern ?? 'normal'
  if (pattern === 'charge') return round % 4 === 0 ? 'charge' : round % 4 === 1 ? 'strike' : 'attack'
  if (pattern === 'guard' && round % 3 === 0) return 'guard'
  if (pattern === 'mend' && entity.hp < entity.monster.hp * .6 && (entity.heals ?? 0) < 3 && round % 4 === 2) return 'heal'
  return 'attack'
}
