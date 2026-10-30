import { availableActions, budgetReason } from '../../shared/agents.mjs'
import { RECIPES, FACILITIES } from '../../shared/life.mjs'
import { gearOf, shopStock, gearPrice, potionPrice, POTIONS, innFee, hasFacility, STASH } from '../../shared/rpg-systems.mjs'
import { availableZones, availableQuests, skillsOf, stats } from './rules.mjs'
import { placeOf } from '../village/world.mjs'

/** Finite, feasible domain choices. Each option includes every consequential sub-choice;
 * no executor is allowed to choose a different item, shop, recipe, skill or destination. */
/** How every rest/sleep option ends, said once in the decision's instructions instead of in each option. */
export const REST_NOTE = '휴식·수면은 고른 조건까지 지속해. 새 요청·호명·배고픔의 높은 구간 진입은 기상/계속 쉴지 새 판단을 요청할 뿐 자동으로 깨우지 않아.'

export function villageOptions(s, a, r, world, now) {
  const out = [], add = (base, description, data = {}) => out.push({ ...base, label: description, description, data, actionId: base.id })
  for (const base of availableActions(s, 'village')) {
    const id = base.id
    if (r.asleep && !['wake', 'sleep', 'wait'].includes(id)) continue
    if (!base.builtin) { add(base, base.description); continue }
    if (id === 'eat') {
      for (const d of s.items.filter(d => d.capabilities?.includes('consume') && d.effect === 'restore')) {
        if (a.stacks?.[d.id] > 0) add(base, `${d.name} 1개 먹기: HP +8, MP +4, 배고픔 -25. 보유품 소비.`, { item: d.id })
        for (const n of s.life.npcs.filter(n => n.open && n.stock?.[d.id] > 0 && a.gold >= d.price))
          add(base, `${n.name}: ${d.name} 1개 구매 후 먹기, ${d.price}G. HP +8, MP +4, 배고픔 -25.`, { item: d.id, npcId: n.id })
      }
    } else if (id === 'shop') {
      for (const n of s.life.npcs.filter(n => n.open && n.role !== 'builder')) for (const d of s.items.filter(d => d.stackable && n.stock?.[d.id] > 0 && a.gold >= d.price))
        add(base, `${n.name}: ${d.name} 1개 구매, ${d.price}G. 소비하지 않고 소지.`, { item: d.id, npcId: n.id, amount: 1 })
      for (const d of shopStock(s).filter(d => a.gold >= gearPrice(d) && a.storage.length < STASH))
        add(base, `${d.name} 장비 구매, ${gearPrice(d)}G. 자동 착용하지 않아. 공격 ${d.attack}, 방어 ${d.defense}, HP ${d.hp}, 요구 레벨 ${d.level}.`, { item: d.id, gear: true })
    } else if (id === 'equip') {
      for (const i of gearOf(a)) {
        const d = s.items.find(d => d.id === i.itemId)
        if (d && d.level <= a.level && a.equipment[d.slot] !== i.id)
          add(base, `${d.name} 착용: ${d.slot}, 공격 ${d.attack}, 방어 ${d.defense}, HP ${d.hp}. 현재 장비 교체, 무료.`, { item: i.id })
      }
    } else if (id === 'sell') {
      if (hasFacility(s, 'merchant')) for (const i of gearOf(a).filter(i => !Object.values(a.equipment).includes(i.id))) {
        const d = s.items.find(d => d.id === i.itemId)
        if (d) add(base, `${d.name} 장비 1개 판매: +${Math.max(1, Math.floor(gearPrice(d) / 4))}G, 물품 소멸.`, { item: i.id })
      }
    } else if (id === 'supply') {
      if (hasFacility(s, 'merchant')) for (const [key, d] of Object.entries(POTIONS)) if (a.gold >= potionPrice(s, key))
        add(base, `${d.name} 1개 구매, ${potionPrice(s, key)}G. ${key === 'health' ? '사용 시 HP 45%' : '사용 시 MP 12'} 회복. 자동 사용하지 않아.`, { item: key })
    } else if (id === 'work') {
      for (const n of s.life.npcs.filter(n => n.open && n.role === 'producer'))
        add(base, `${n.name}의 생산 근무: 고용주의 약초 2개로 차 1개 제작, 20초 후 4G 보수. 고용주 자금·재료가 필요해.`, { npcId: n.id })
      for (const b of s.life.buildings.filter(b => b.role === a.role && a.role !== 'adventurer'))
        add(base, `${b.name}에서 ${a.role} 근무 시작/계속. 다른 행동을 고르면 근무 종료. 시간표는 참고 습관이야.`, { buildingId: b.id, staff: true })
    } else if (id === 'craft') {
      for (const recipe of RECIPES.filter(p => Object.entries(p.inputs).every(([id, n]) => (a.stacks?.[id] ?? 0) >= n)))
        for (const b of s.life.buildings.filter(b => b.role === recipe.role))
          add(base, `${b.name}: ${recipe.name ?? recipe.id} 제작. 재료 ${JSON.stringify(recipe.inputs)}, 도구 ${recipe.tool ?? '없음'}, 시설비 ${FACILITIES[b.role]?.fee ?? 0}G, 결과 ${JSON.stringify(recipe.output)}, ${recipe.seconds}초.`, { recipeId: recipe.id, buildingId: b.id })
    } else if (id === 'visit') {
      for (const p of world.geometry?.places ?? []) if (p.name !== placeOf(r, world)) add(base, `${p.name} 방문. 그 장소로 이동해.`, { place: p.name })
    } else if (id === 'rest' || id === 'sleep') {
      const conditions = [['morning', '다음 마을 아침(06:00)까지'], ['addressed', '새 요청이나 나를 부르는 방송 메시지가 올 때까지']]
      if (a.statuses?.fatigue > (id === 'sleep' ? 30 : 15)) conditions.push(['rested', '피로가 최저값이 될 때까지'])
      for (const [wakeCondition, label] of conditions) {
        const end = `${label} 지속해.`
        add(base, `${id === 'sleep' ? '현재 자리에서 잠들기: 피로 -30' : '현재 자리에서 휴식: 피로 -15'}. 무료. ${end}`, { lodging: 'rough', wakeCondition })
        for (const b of s.life.buildings.filter(b => b.role === 'inn' && a.gold >= innFee(a)))
          add(base, `${b.name} 유료 ${id === 'sleep' ? '수면' : '휴식'}: ${innFee(a)}G, HP/MP 회복, 피로 감소. ${end}`, { buildingId: b.id, lodging: 'inn', wakeCondition })
      }
    } else if (id === 'wake') {
      if (r.asleep) add(base, '현재 자리에서 깨어나기. 다음 일상 판단을 시작할 수 있어.')
    } else if (id === 'oracle') {
      if (s.settings.enabled && a.role === 'adventurer') for (const b of s.life.buildings.filter(b => b.role === 'oracle')) {
        const priest = s.actors.find(x => x.active && x.role === 'oracle'), here = world.residents?.find(r => r.profileId === priest?.profileId)
        add(base, `${b.name}에서 신탁 요청. ${priest ? `${priest.name}: ${priest.working && !here?.asleep && !here?.away ? '근무 중' : '비근무, 신탁은 근무/호출 가능 시까지 대기'}` : '신관 없음, 대기 필요'}. 직업·스킬은 모델이 제안하며 자동 헌금은 없어.`, { buildingId: b.id })
      }
    } else if (id === 'depart') {
      if (s.settings.enabled && a.role === 'adventurer') {
        const destinations = [...availableZones(s, a, now).map(z => ({ z, q: null })),
          ...availableQuests(s, a, now).map(q => ({ z: s.zones.find(z => z.id === q.zoneId), q }))]
        for (const { z, q } of destinations) for (const tactic of ['balanced', 'cautious'])
          add(base, `${z.name} (레벨 ${z.level}) 원정${q ? ` · 의뢰 ${q.title}, 보상 ${q.gold}G` : ' · 자유 탐험'}. 적 HP ${z.monster.hp}, 공격 ${z.monster.attack}, 방어 ${z.monster.defense}; 내 HP ${a.hp}/${stats(s, a).hp}. 전략 ${tactic}: ${tactic === 'cautious' ? '적 피해 계산에서 내 방어력 1.2배' : '기본 방어력'}. 전투 호출: ${budgetReason(s, a, 'combat', world.clock, now) ?? '호출 규칙상 대기 없음(호스트 접수는 별도)'}. 현재 장비·보급 그대로 출발.`, { zoneId: z.id, questId: q?.id ?? '', tactic })
      }
    } else if (id === 'donate') {
      if (a.gold >= 1) add(base, '공공 금고에 1G 기부.', { amount: 1 })
    } else add(base, base.description)
  }
  // Stable within the immutable request; values are trusted only after revalidation at execution.
  const counts = new Map()
  return out.map(o => { const n = counts.get(o.id) ?? 0; counts.set(o.id, n + 1); return { ...o, id: n ? `${o.id}_${n}` : o.id } })
}

/** Consent transfers are explicit model choices; target/item/kind are inseparable.
 * The amount question uses the domain's existing 1–100 transfer/price range. */
export function socialOptions(s, a, targets) {
  const out = []
  const add = (base, to, description, data, maxAmount = null) => out.push({
    ...base, actionId: base.id, label: description, description, data: { target: to.profileId, ...data }, maxAmount, requiresAmount: maxAmount !== null,
  })
  for (const base of availableActions(s, 'social')) {
    if (!['gift', 'trade', 'request'].includes(base.id) && base.effect.transfer === 'none') { out.push(base); continue }
    for (const target of targets) {
      const b = s.actors.find(b => b.active && b.profileId === target.profileId)
      if (!b) continue
      const requesting = base.id === 'request', giver = requesting ? b : a, receiver = requesting ? a : b
      if (requesting) for (const kind of ['help', 'accompany']) add(base, b, `${b.name}에게 ${kind === 'help' ? '도움' : '동행'} 요청. 상대가 수락하면 함께 이동하며 골드·물품은 이전하지 않아.`, { kind })
      if (base.id !== 'trade' && base.effect.transfer !== 'item') {
        const max = Math.min(100, giver.gold, 1e9 - receiver.gold)
        if (max >= 1) add(base, b, `${base.label}: 수락하면 ${giver.name}가 ${receiver.name}에게 골드를 지급해. amount는 1–${max}G.`, { kind: 'gold' }, max)
      }
      if (base.effect.transfer === 'gold') continue
      for (const d of s.items.filter(d => d.stackable && (giver.stacks?.[d.id] ?? 0) > 0)) {
        const max = base.id === 'trade' ? Math.min(100, b.gold, 1e9 - a.gold) : Math.min(100, giver.stacks[d.id], 999 - (receiver.stacks?.[d.id] ?? 0))
        if (max < 1 || (receiver.stacks?.[d.id] ?? 0) >= 999) continue
        add(base, b, base.id === 'trade'
          ? `${a.name}의 ${d.name} 1개를 ${b.name}에게 판매 제안. 수락하면 ${b.name}가 ${a.name}에게 amount 골드(1–${max}G)를 지급해.`
          : `${base.label}: 수락하면 ${giver.name}의 ${d.name}를 ${receiver.name}에게 이전해. amount는 1–${max}개.`,
        { kind: 'item', item: d.id }, max)
      }
    }
  }
  const counts = new Map()
  return out.map((o, i) => { const count = counts.get(o.id) ?? 0; counts.set(o.id, count + 1); return { ...o, actionId: o.actionId ?? o.id, id: count ? `social_${i}` : o.id } })
}

export function combatOptions(s, a) {
  const out = []
  for (const base of availableActions(s, 'combat')) {
    const add = (id, description, data = {}) => out.push({ ...base, id, description, data: { action: base.id, ...data } })
    if (base.id === 'skill') {
      if (a.mp >= 4) skillsOf(a).forEach((k, i) => add(`skill_${i}`, `${k.name}: ${k.kind}, ${k.effect || ''}. MP 4 소비.`, { skill: k.name }))
    } else if (base.id === 'potion') {
      for (const [key, n] of Object.entries(a.supplies ?? {})) if (n > 0 && Object.hasOwn(POTIONS, key))
        add(`potion_${key}`, `${POTIONS[key].name} 1개 소비: ${key === 'health' ? 'HP 최대치의 45%' : 'MP 12'} 회복. 이번 차례 공격 없음.`, { potion: key })
    } else if (!base.builtin && a.mp < base.effect.mpCost) continue
    else add(base.id, base.id === 'attack' ? '적 한 명 기본 공격. 피해는 공격력·적 방어력·치명타로 계산.' :
      base.id === 'guard' ? '약한 공격과 함께 이번 적 차례 피해 감소.' :
      base.id === 'flee' ? '현재 적과의 싸움을 중단하고 출구로 귀환.' : `${base.description} 효과 ${JSON.stringify(base.effect)}`)
  }
  out.push({ id: 'wait', description: '이번에는 행동하지 않고 다음 모델 판단을 기다려. 적은 계속 행동해.', data: { action: 'wait' } })
  return out
}
