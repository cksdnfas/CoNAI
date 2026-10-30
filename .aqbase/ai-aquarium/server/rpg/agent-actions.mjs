import { randomUUID } from 'node:crypto'
import { availableActions, changeStatuses } from '../../shared/agents.mjs'
import { RECIPES } from '../../shared/life.mjs'
import { gearOf, shopStock, gearPrice, potionPrice, POTIONS, innFee, hasFacility, stow, STASH } from '../../shared/rpg-systems.mjs'
import { depart, stats } from './rules.mjs'
import { lifeAction, facilityIncome } from './life.mjs'

/** Execute exactly the model's choice. Missing details fail; never select a substitute. */
export function villageAction(s, profileId, input, now) {
  const a = s.actors.find(a => a.active && a.profileId === profileId)
  if (!a || !['town', 'rest'].includes(a.phase)) throw new Error('마을에 있는 주민만 생활할 수 있어.')
  const action = availableActions(s, 'village').find(x => x.id === input.action)
  if (!action) throw new Error('사용할 수 없는 생활 행동이야.')
  const beforeGold = a.gold
  const item = input.item && (s.items.find(d => d.id === input.item) ?? s.items.find(d => d.id === gearOf(a).find(g => g.id === input.item)?.itemId) ?? POTIONS[input.item])
  const need = (value, reason) => { if (!value) throw new Error(reason); return value }
  const spend = cost => { need(a.gold >= cost, '골드가 부족해.'); a.gold -= cost }
  if (action.id === 'eat') {
    if (input.npcId) lifeAction(s, { actorId: a.id, action: 'buy', npcId: input.npcId, itemId: input.item, quantity: 1 }, now)
    lifeAction(s, { actorId: a.id, action: 'use', itemId: input.item, quantity: 1 }, now)
  } else if (action.id === 'shop') {
    if (input.gear) {
      const d = need(shopStock(s).find(d => d.id === input.item), '판매 중인 장비가 아니야.')
      need(a.storage.length < STASH, '장비 보관 공간이 부족해.')
      spend(gearPrice(d)); a.storage.push({ id: randomUUID(), itemId: d.id })
    } else lifeAction(s, { actorId: a.id, action: 'buy', npcId: input.npcId, itemId: input.item, quantity: input.amount }, now)
  } else if (action.id === 'equip') {
    const i = need(gearOf(a).find(i => i.id === input.item), '보유 장비가 아니야.'), d = s.items.find(d => d.id === i.itemId)
    need(d && d.level <= a.level, '착용할 수 없는 장비야.')
    a.equipment[d.slot] = i.id; stow(s, a); a.hp = Math.min(a.hp, stats(s, a).hp)
  } else if (action.id === 'sell') {
    const i = need(gearOf(a).find(i => i.id === input.item && !Object.values(a.equipment).includes(i.id)), '판매할 미착용 장비가 아니야.')
    need(hasFacility(s, 'merchant'), '상점이 없어.')
    const d = need(s.items.find(d => d.id === i.itemId), '물품이 없어.')
    a.inventory = a.inventory.filter(x => x !== i); a.storage = a.storage.filter(x => x !== i); a.gold += Math.max(1, Math.floor(gearPrice(d) / 4))
  } else if (action.id === 'supply') {
    need(Object.hasOwn(POTIONS, input.item) && hasFacility(s, 'merchant'), '구매할 보급품과 상점을 확인해줘.')
    spend(potionPrice(s, input.item)); a.supplies[input.item] = (a.supplies[input.item] ?? 0) + 1
  } else if (action.id === 'rest' || action.id === 'sleep') {
    need(['morning', 'addressed', 'rested'].includes(input.wakeCondition), '휴식을 끝내고 다시 판단할 조건을 골라줘.')
    need(['inn', 'rough'].includes(input.lodging), '휴식 장소를 선택해야 해.')
    if (input.lodging === 'inn') {
      need(s.life.buildings.some(b => b.id === input.buildingId && b.role === 'inn'), '여관이 없어.')
      const fee = innFee(a); spend(fee); facilityIncome(s, 'inn', fee)
      a.hp = stats(s, a).hp; a.mp = stats(s, a).mp
    }
    changeStatuses(s, a, { fatigue: action.id === 'sleep' ? -30 : -15, mood: 3 }, false, 'rule')
    a.sleeping = action.id === 'sleep'
  } else if (action.id === 'wake') a.sleeping = false
  else if (action.id === 'work') {
    if (input.staff) {
      need(s.life.buildings.some(b => b.id === input.buildingId && b.role === a.role), '근무할 시설이 없어.')
      a.working = true
    } else lifeAction(s, { actorId: a.id, action: 'work', npcId: input.npcId }, now)
  } else if (action.id === 'craft') {
    const recipe = need(RECIPES.find(r => r.id === input.recipeId), '제작법을 선택해야 해.')
    need(s.life.buildings.some(b => b.id === input.buildingId && b.role === recipe.role), '제작 시설을 선택해야 해.')
    lifeAction(s, { actorId: a.id, action: 'produce', recipeId: recipe.id, buildingId: input.buildingId }, now)
  } else if (action.id === 'donate') lifeAction(s, { actorId: a.id, action: 'donate', amount: input.amount }, now)
  else if (action.id === 'depart') { a.phase = 'town'; depart(s, a, { ...input, action: 'hunt' }, now) }
  else if (action.id === 'oracle') {
    need(s.life.buildings.some(b => b.id === input.buildingId && b.role === 'oracle'), '신전이 없어.')
    a.oracleRequested = true
  } else if (!['visit', 'wait'].includes(action.id)) changeStatuses(s, a, action.effect.actorStatuses)
  if (action.id !== 'work') a.working = false
  a.goal = typeof input.goal === 'string' ? input.goal : action.label
  const details = [input.place, item?.name ?? (input.item ? input.item : ''), input.amount ? `${input.amount}${action.id === 'donate' ? 'G' : '개'}` : '',
    a.gold !== beforeGold ? `${a.gold - beforeGold > 0 ? '+' : ''}${a.gold - beforeGold}G (잔액 ${a.gold}G)` : ''].filter(Boolean)
  return { result: `${a.name}: ${action.label}${details.length ? ` · ${details.join(' · ')}` : ''}`, sleeping: a.sleeping, wakeCondition: ['rest', 'sleep'].includes(action.id) ? input.wakeCondition : null, duration: action.builtin ? 0 : action.effect.duration }
}
