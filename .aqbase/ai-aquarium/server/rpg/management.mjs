import { randomUUID } from 'node:crypto'
import { FACILITIES, LIFE_ITEMS } from '../../shared/life.mjs'
import { BAG, STASH, QUEST_TYPES } from '../../shared/rpg-systems.mjs'
import { manageLife, manageStack, createLifeItem, itemArtKey, lifeGeometry, lifeLandmarks } from './life.mjs'
import { addQuest, cancelQuest, expand, shortText, int } from './rules.mjs'
import { artSubjects, artProblem, requestArt, queueArt } from './game-art.mjs'
import { ACTION_LABELS, ART_ACTIONS, actionLabel, displayText } from '../../shared/gm-actions.mjs'
import { managementReferences, resolveManagementAction, constructionName } from './targets.mjs'
import { manageAgents } from './social.mjs'
import { clipProse } from '../../shared/speech.mjs'
export { actionLabel } from '../../shared/gm-actions.mjs'

const str = (maxLength = 100) => ({ type: 'string', maxLength })
const num = (minimum, maximum) => ({ type: 'integer', minimum, maximum })
const choice = values => ({ type: 'string', enum: values })
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required })
const action = (type, properties = {}, required = Object.keys(properties)) => object({ type: choice([type]), ...properties }, ['type', ...required])
const look = str(300), id = str(200), position = { x: num(1, 80), y: num(1, 60) }
const goldFields = {
  add: { ...num(-1e9, 1e9), description: '지급·회수할 증감량. 더 줘=양수, 빼 줘=음수. 적용 시점 잔액에 더하고 0~10억으로 제한. set과 함께 쓰지 마.' },
  set: { ...num(0, 1e9), description: '잔액 자체를 이 값으로 맞출 때만. 지급·회수에는 add를 써. add와 함께 쓰지 마.' },
}
export const FLOOR_DESIGN = object({
  name: str(40), kind: choice(['dungeon']), theme: str(100), size: choice(['small', 'medium', 'large']), layout: choice(['maze', 'rooms', 'loops']),
  enemies: num(3, 10), bossPattern: choice(['charge', 'guard', 'mend']),
  monster: object({ name: str(40), hp: num(1, 2000), attack: num(0, 300), defense: num(0, 200), look }),
  item: object({ name: str(40), slot: choice(['weapon', 'armor', 'accessory']), attack: num(0, 202), defense: num(0, 152), hp: num(0, 505), look }),
  bossLook: look, visualPrompt: look,
})
export const MANAGEMENT = { type: 'array', maxItems: 24, description: '플레이어 승인 후 무료 실행. 대상은 이름 전체 또는 R1/B1 같은 짧은 ID로 지정. 카드 표시 전에 실제 대상을 확인하며 동명이인은 실패 사유와 후보를 표시.', items: { anyOf: [
  action('request-cancel', { requestId: str(160), reason: str(200) }, ['requestId']),
  action('status-definition', { definition: object({ id: str(40), name: str(40), description: str(300), kind: choice(['number', 'choice']), min: num(-10000, 10000), max: num(-10000, 10000),
    initial: { anyOf: [num(-10000, 10000), str(40)] }, values: { type: 'array', maxItems: 16, items: str(40) }, perHour: num(-100, 100), step: num(0, 100),
    low: num(-10000, 10000), high: num(-10000, 10000), lowHint: str(160), highHint: str(160), enabled: { type: 'boolean' } }, ['id']) }),
  action('status-remove', { statusId: str(40) }),
  action('status-set', { actorId: id, statusId: str(120), value: { anyOf: [num(-10000, 10000), str(40)] } }),
  action('relationship-set', { actorId: id, targetActorId: id, affinity: num(-100, 100), label: str(30) }),
  action('action-definition', { definition: object({ id: str(40), category: choice(['combat', 'social', 'village']), label: str(40), description: str(300), enabled: { type: 'boolean' },
    effect: object({ damage: { type: 'number', minimum: 0, maximum: 2 }, guard: { type: 'number', minimum: 0, maximum: .75 }, heal: { type: 'number', minimum: 0, maximum: .3 }, fleeChance: { type: 'number', minimum: 0, maximum: 1 },
      mpCost: num(0, 20), affinity: num(-20, 20), actorStatuses: { type: 'object', additionalProperties: { type: 'number', minimum: -30, maximum: 30 } },
      targetStatuses: { type: 'object', additionalProperties: { type: 'number', minimum: -30, maximum: 30 } }, needsAcceptance: { type: 'boolean' }, transfer: choice(['none', 'item', 'gold']), amount: num(1, 100), duration: num(5, 300), place: str(60) }, []) }, ['id', 'category']) }),
  action('agent-settings', { settings: object({ deciders: object(Object.fromEntries(['combat', 'social', 'village'].map(c => [c, object({ decider: choice(['judge', 'chat', 'rules']), minInterval: num(1, 3600), maxCallsPerHour: num(0, 120), maxCallsPerDay: num(0, 10000) }, [])])), []),
    conversationMaxTurns: num(2, 24), maxConversations: num(1, 3) }, []) }),
  action('build', { kind: choice(Object.keys(FACILITIES).filter(k => k !== 'expansion')),
    near: { ...str(60), description: '광장 옆처럼 장소를 말하면 geometry.landmarks의 이름을 넣고 x/y는 생략. 가까운 유효 부지 자동 선택.' },
    x: { ...position.x, description: '플레이어가 좌표를 직접 지정한 경우만. 기본은 생략(자동 부지).' },
    y: { ...position.y, description: '플레이어가 좌표를 직접 지정한 경우만. 기본은 생략(자동 부지).' } }, ['kind']),
  action('upgrade', { buildingId: id, level: num(2, 3) }, ['buildingId']),
  action('rename-building', { buildingId: id, name: str(60) }),
  action('move-building', { buildingId: id, ...position }),
  action('remove-building', { buildingId: id }),
  action('expand-map', { direction: choice(['east', 'south']) }),
  action('complete-construction', { constructionId: id }),
  action('cancel-construction', { constructionId: id }),
  action('npc', { npcId: id, ...goldFields, buildingId: id, itemId: id, quantity: num(0, 999) }, ['npcId']),
  action('resident-gold', { actorId: id, ...goldFields }, ['actorId']),
  action('create-item', { template: id, name: str(60), description: str(240), look, actorId: id, target: choice(['inventory', 'storage']), quantity: num(1, 99) }, ['template', 'name', 'description', 'look']),
  action('edit-item', { itemId: id, name: str(60), description: str(240), look }, ['itemId']),
  action('give-item', { actorId: id, itemId: id, target: choice(['inventory', 'storage']), quantity: num(1, 99) }),
  action('take-item', { actorId: id, itemId: id, target: choice(['inventory', 'storage']), quantity: num(1, 99), instanceId: id }, ['actorId', 'itemId', 'target', 'quantity']),
  action('create-quest', { zoneId: id, title: str(80), note: { type: 'string' }, questType: choice(Object.keys(QUEST_TYPES)), count: num(1, 100) }),
  action('cancel-quest', { questId: id }),
  action('design-floor', { parentId: id, design: FLOOR_DESIGN }),
  action('edit-floor', { zoneId: id, name: str(40), theme: str(100), monster: str(40), boss: str(40), itemId: id, itemName: str(40), monsterLook: look, bossLook: look, itemLook: look, sceneryLook: look }, ['zoneId']),
  action('redraw', { key: { ...id, maxLength: 250 }, look }, ['key']),
] } }

const need = (v, message) => { if (!v) throw new Error(message); return v }
const stacks = bag => Object.entries(bag ?? {})
const gearCounts = bag => {
  const counts = new Map()
  for (const i of bag ?? []) counts.set(i.itemId, (counts.get(i.itemId) ?? 0) + 1)
  return [...counts]
}

/** IDs and bounded descriptions, not full dungeon maps, combat histories or archived quests. */
export function managementContext(s, playerLine = '', references = managementReferences(s)) {
  const parent = s.zones.findLast(z => !z.expanded), level = parent ? Math.min(50, parent.level + 1) : 1
  const near = lifeLandmarks(s).find(p => playerLine.includes(p.name))?.name ?? null
  const aliases = new Map(Object.entries(references).map(([alias, id]) => [`${alias[0]}:${id}`, alias]))
  const ref = (kind, id) => id == null ? id : aliases.get(`${kind}:${id}`) ?? id
  const counts = pairs => pairs.map(([id, n]) => [ref('I', id), n])
  return {
    agentSettings: {
      statusDefs: s.settings.statusDefs.map(({ id, name, kind, min, max, enabled }) => ({ id, name, kind, min, max, enabled })),
      actionCatalog: s.settings.actionCatalog.map(({ id, category, label, enabled }) => ({ id, category, label, enabled })),
      deciders: s.settings.deciders,
    },
    relationships: s.relationships,
    pendingRequests: (s.socialRequests ?? []).filter(q => q.status === 'pending').map(q => ({ requestId: q.id, from: q.from, to: q.to, action: q.action.label, expiresAt: q.expiresAt })),
    geometry: lifeGeometry(s, 0, null, near), facilityKinds: Object.fromEntries(Object.entries(FACILITIES).map(([k, d]) => [k, d.name])),
    buildings: s.life.buildings.map(({ id, name, role, x, y, level }) => ({ id: ref('B', id), name, role, x, y, level })),
    constructions: s.life.constructions.filter(c => ['reserved', 'approved', 'building'].includes(c.status)).map(c => ({ id: ref('C', c.id), name: constructionName(s, c), kind: c.kind, buildingId: ref('B', c.buildingId), status: c.status })),
    npcs: s.life.npcs.map(({ id, name, buildingId, gold, stock }) => ({ id: ref('N', id), name, buildingId: ref('B', buildingId), gold, stock: counts(stacks(stock)) })),
    residents: s.actors.filter(a => a.active).map(a => ({ id: ref('R', a.id), name: a.name, gold: a.gold, phase: a.phase, stacks: counts(stacks(a.stacks)), storedStacks: counts(stacks(a.storedStacks)),
      inventory: counts(gearCounts(a.inventory)), storage: counts(gearCounts(a.storage)), statuses: a.statuses, goal: a.goal })),
    items: s.items.map(({ id, name, templateId, stackable, slot }) => ({ id: ref('I', id), name, templateId: ref('T', templateId), stackable, slot })),
    templates: LIFE_ITEMS.map(({ id, name }) => ({ id: ref('T', id), name })),
    quests: s.quests.filter(q => ['open', 'active'].includes(q.status)).map(({ id, title, status, source }) => ({ id: ref('Q', id), title, status, source })),
    floors: s.zones.map(({ id, name, level, expanded, cleared, design, dropId, monster }) => ({ id: ref('F', id), name, level, expanded, cleared, theme: design.theme, dropId: ref('I', dropId), monster: monster.name })),
    nextFloor: { parentId: ref('F', parent?.id), level, maxFloors: s.settings.maxZones, monster: { hp: [15 + level * 8, 50 + level * 22], attack: [2 + level * 2, 7 + level * 5], defense: [0, 2 + level * 3], budget: `hp+attack*4+defense*5 <= ${100 + level * 45}` },
      item: { attack: [0, level * 4 + 2], defense: [0, level * 3 + 2], hp: [0, level * 10 + 5], budget: `attack*3+defense*3+hp <= ${18 + level * 14}, 모두 0은 금지` } },
    art: { problem: artProblem(s), subjects: artSubjects(s).map(({ key, name }) => ({ key: ref('A', key), name })) },
    note: '표시 이름 전체 또는 짧은 ID를 써. R=주민 N=NPC B=시설 I=물품 F=층 Q=의뢰 C=공사 T=템플릿 A=그림 G=장비 개체. 짧은 ID는 이번 대화에만 유효해. 목록은 일부이며 장비/재고는 [물품ID,수량] 묶음이야.',
  }
}

function inventory(s, a, item, input, sign) {
  const n = int(input.quantity, 1, 99, '수량'), target = input.target
  need(['inventory', 'storage'].includes(target), '가방이나 창고를 골라줘.')
  if (item.stackable) { manageStack(s, a, item, target, n * sign); return }
  const bag = target === 'storage' ? a.storage : a.inventory
  if (sign > 0) {
    need(bag.length + n <= (target === 'storage' ? STASH : BAG), '장비 보관 한도를 넘었어.')
    for (let i = 0; i < n; i++) bag.push({ id: randomUUID(), itemId: item.id })
  } else {
    const items = bag.filter(i => i.itemId === item.id && (!input.instanceId || i.id === input.instanceId) && !Object.values(a.equipment).includes(i.id)).slice(0, n)
    need(items.length === n, '장착하지 않은 해당 장비 수량이 부족해.')
    for (const item of items) bag.splice(bag.indexOf(item), 1)
  }
}

/** Called inside the RPG store transaction; failures roll back the entire individual operation. */
export function applyManagement(s, input, now) {
  need(input && Object.hasOwn(ACTION_LABELS, input.type), '지원하지 않는 GM 작업이야.')
  input = resolveManagementAction(s, input)
  if (['request-cancel', 'status-definition', 'status-remove', 'status-set', 'relationship-set', 'action-definition', 'agent-settings'].includes(input.type)) {
    manageAgents(s, input, now)
    return { text: `${actionLabel(input, s)} · 적용했어` }
  }
  const actor = () => need(s.actors.find(a => a.id === input.actorId && a.active), '없는 주민이야.')
  const item = () => need(s.items.find(i => i.id === input.itemId), '없는 물품이야.')
  const beforeArt = new Set(ART_ACTIONS.includes(input.type) ? artSubjects(s).map(a => a.key) : [])
  let result
  if (input.type === 'create-item') {
    const d = createLifeItem(s, input)
    if (input.actorId) inventory(s, actor(), d, { quantity: input.quantity ?? 1, target: input.target ?? 'inventory' }, 1)
    result = `${d.name}${input.actorId ? ' · 지급됨' : ' · 정의 생성 (지급은 별도 요청)'}`
  } else if (input.type === 'edit-item') {
    const d = item()
    need(input.name !== undefined || input.description !== undefined || input.look !== undefined, '바꿀 항목이 없어.')
    if (input.name !== undefined) d.name = shortText(clipProse(input.name, d.stackable ? 60 : 40), d.stackable ? 60 : 40, '물품 이름')
    if (input.description !== undefined) d.description = shortText(clipProse(input.description, 240), 240, '물품 설명')
    if (input.look !== undefined) requestArt(s, d.stackable ? itemArtKey(d) : `item:${d.id}`, input.look, true)
    result = d.name
  } else if (['give-item', 'take-item'].includes(input.type)) {
    const a = actor(), d = item(); inventory(s, a, d, input, input.type === 'give-item' ? 1 : -1)
    result = `${a.name} · ${input.target === 'storage' ? '창고' : '가방'} · ${d.name} ${input.quantity}개 ${input.type === 'give-item' ? '지급' : '회수'}`
  } else if (input.type === 'create-quest') {
    const q = addQuest(s, { ...input, title: clipProse(input.title, 80), note: clipProse(input.note, 500), type: input.questType }, now); result = `${q.title} · 등록`
  } else if (input.type === 'cancel-quest') {
    cancelQuest(s, input.questId, now, true); result = `${s.quests.find(q => q.id === input.questId).title} · 취소`
  } else if (input.type === 'design-floor') {
    const parent = need(s.zones.find(z => z.id === input.parentId), '이전 층을 찾을 수 없어.')
    const z = need(expand(s, parent, input.design, now, true), '이미 다음 층이 있거나 최대 층 수에 도달했어.')
    s.dmWish = ''; result = `${z.floor}층 ${z.name}${parent.cleared ? '' : ' (입장은 이전 층 공략 후)'}`
  } else if (input.type === 'edit-floor') {
    const z = need(s.zones.find(z => z.id === input.zoneId), '없는 던전 층이야.')
    need(Object.keys(input).some(k => !['type', 'zoneId'].includes(k)), '바꿀 층 항목이 없어.')
    if (input.name !== undefined) {
      const name = shortText(clipProse(input.name, 40), 40, '층 이름')
      need(!s.zones.some(other => other !== z && other.name === name), '같은 이름의 층이 있어.'); z.name = name
    }
    if (input.theme !== undefined) z.design.theme = shortText(clipProse(input.theme, 100), 100, '층 테마')
    if (input.monster !== undefined) z.monster.name = shortText(clipProse(input.monster, 40), 40, '몬스터 이름')
    if (input.boss !== undefined) z.monster.bossName = shortText(clipProse(input.boss, 40), 40, '수호자 이름')
    if (input.itemId !== undefined) { const d = item(); need(!d.stackable, '층 전리품은 장비여야 해.'); z.dropId = d.id }
    const drop = s.items.find(i => i.id === z.dropId)
    if (input.itemName !== undefined) need(drop, '전리품이 없어.').name = shortText(clipProse(input.itemName, 40), 40, '전리품 이름')
    for (const e of z.map?.entities ?? []) if (e.kind === 'enemy') e.monster.name = e.boss ? z.monster.bossName || `${z.monster.name} 수호자` : z.monster.name
    for (const a of s.actors) if (a.expedition?.zoneId === z.id && a.expedition.monster) {
      const e = z.map?.entities.find(e => e.id === a.expedition.encounterId)
      if (e) a.expedition.monster.name = e.monster.name
    }
    for (const [field, key] of [['monsterLook', `monster:${z.id}`], ['bossLook', `boss:${z.id}`], ['itemLook', `item:${z.dropId}`], ['sceneryLook', `zone:${z.id}`]]) {
      if (input[field] !== undefined) requestArt(s, key, input[field], true)
    }
    result = actionLabel(input, s)
  } else if (input.type === 'redraw') {
    need(!artProblem(s), artProblem(s))
    const subject = need(artSubjects(s).find(a => a.key === input.key), '그림 대상을 찾을 수 없어.')
    need(input.look || subject.look, '다시 그릴 겉모습 태그가 필요해.')
    requestArt(s, input.key, input.look, true, true); result = `${subject.name} · 무료 그림 요청 저장 (완성 전에는 이전 그림 유지)`
  } else result = manageLife(s, input, now)
  if ((s.pending?.kind === 'life' && input.constructionId && s.pending.constructionId === input.constructionId) ||
      (s.pending?.kind === 'dm' && input.type === 'design-floor' && s.pending.zoneId === input.parentId)) {
    s.obsoleteJobId = s.pending.jobId ?? null; s.pending = null
  }
  const usesArt = ART_ACTIONS.includes(input.type)
  if (usesArt) for (const subject of artSubjects(s)) if (!beforeArt.has(subject.key)) requestArt(s, subject.key, undefined, true)
  queueArt(s, s.settings, now)
  return { text: displayText(result), ...(usesArt && artProblem(s) ? { artSetup: artProblem(s) } : {}) }
}
