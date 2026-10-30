import { randomUUID } from 'node:crypto'
import { MAP, WIDTH, HEIGHT, BUILDINGS, doorOf, GATE, runtimeMap, runtimePlaces, canWalk, tileAt, findPath } from '../../shared/tiles.mjs'
import { onDuty, shiftsOf } from '../../shared/schedule.mjs'
import { LIFE_ITEMS, FACILITIES, RECIPES, LIFE_ACTIONS } from '../../shared/life.mjs'
import { stats, log, QUIET } from './rules.mjs'
import { setLook, artProblem } from './game-art.mjs'
import { changeStatuses } from '../../shared/agents.mjs'
import { clipProse } from '../../shared/speech.mjs'

const ACTIVE = new Set(['reserved', 'approved', 'building'])
const MAX_STACK = 999, MAX_JOBS = 24
const integer = (n, min, max) => { if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`수량은 ${min}–${max} 사이 정수야.`); return n }
const need = (value, message) => { if (!value) throw new Error(message); return value }
export const lifeArtKey = b => `building:${b.id}:${b.designRevision}`
export const itemArtKey = i => `life-item:${i.id}:${i.designRevision}`
const defOf = (s, id) => need(s.items.find(i => i.id === id && i.stackable), '없는 생활 물품이야.')
const actorOf = (s, id) => need(s.actors.find(a => a.id === id && a.active && ['town', 'rest'].includes(a.phase)), '마을에 돌아온 주민을 골라줘.')
const quantityOf = (bag, id) => bag?.[id] ?? 0
function give(bag, id, quantity, cap = MAX_STACK) {
  const next = quantityOf(bag, id) + quantity
  need(Number.isSafeInteger(next) && next >= 0 && (quantity < 0 || next <= cap), '물품 수량이 부족하거나 보관 한도를 넘었어.')
  if (next) bag[id] = next
  else delete bag[id]
}
const takeMaterials = (bag, materials, sign) => { for (const [id, n] of Object.entries(materials)) give(bag, id, n * sign) }
/** Templates share functions, while ownership always retains the exact definition ID. */
function materialPlan(s, bag, wanted) {
  const plan = {}
  for (const [id, count] of Object.entries(wanted)) {
    let remaining = count
    for (const d of s.items.filter(d => d.id === id || d.templateId === id)) {
      const n = Math.min(remaining, quantityOf(bag, d.id))
      if (n) { plan[d.id] = n; remaining -= n }
    }
    need(!remaining, '견적의 자재가 부족해.')
  }
  return plan
}
const protectedDoors = l => [...l.buildings, ...l.constructions.filter(c => ACTIVE.has(c.status) && !c.buildingId && c.kind !== 'expansion').map(c => c.site)]
const funds = (s, c) => c.funding === 'public' ? s.life : need(s.actors.find(a => a.id === c.actorId), '공사 소유주를 찾을 수 없어.')
const balance = (s, c) => c.funding === 'public' ? s.life.treasury : funds(s, c).gold
const pay = (s, c, n) => { if (c.funding === 'public') s.life.treasury += n; else funds(s, c).gold += n }

export function newLife(minimal = true) {
  const buildings = BUILDINGS.map((b, i) => ({ ...b, id: `village-${i + 1}`, seeded: true,
    door: (() => { for (let x = b.x; x < b.x + b.w; x++) if (MAP[b.y + b.h - 1][x] === 'D') return { x, y: b.y + b.h }; return doorOf(b.role) })(),
    level: 1, designRevision: 1, ownership: 'public', ownerId: null })).filter(b => !minimal || ['inn', 'oracle'].includes(b.role))
  const tiles = MAP.map(row => [...row])
  if (minimal) for (const b of BUILDINGS.filter(b => !['inn', 'oracle'].includes(b.role))) {
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) tiles[y][x] = '.'
  }
  const makeNpc = (id, name, role, buildingRole, gold, stock) => {
    const b = buildings.find(b => b.role === (minimal ? 'inn' : buildingRole))
    return { id, name, role, buildingId: b.id, x: b.door.x, y: b.door.y, path: [], gold, stock, open: false }
  }
  return { epoch: randomUUID(), map: { revision: 1, width: WIDTH, height: HEIGHT, tiles: tiles.map(row => row.join('')) }, buildings,
    npcs: [makeNpc('trader', '다람 상인', 'merchant', 'merchant', 120, { timber: 30, stone: 30, herb: 20, hammer: 5, 'tea-cup': 5 }),
      makeNpc('producer', minimal ? '여관 조리사' : '찻집 장인', 'producer', 'tea', 60, { herb: 20, 'tea-cup': 5 }),
      makeNpc('builder', '마을 건축가', 'builder', 'guild', 0, {})],
    treasury: 0, materials: {}, constructions: [], production: [], placements: [], deliveryQuests: [],
    donations: { total: 0, reviewedTotal: 0 }, elapsed: 0, replenishedAt: 0, expanded: 0, reviewAt: 0 }
}
export function migrateLife(s) {
  // A missing life domain in an established save predates construction: preserve its original full town.
  s.life ??= newLife(false)
  s.life.donations ??= { total: 0, reviewedTotal: 0 }
  for (const def of LIFE_ITEMS) if (!s.items.some(i => i.id === def.id)) s.items.push(structuredClone(def))
  for (const a of s.actors) { a.stacks ??= {}; a.storedStacks ??= {} }
}
/** A plan reacts to new contributions/resources or actual progress, not another unchanged five-minute tick. */
export const lifeProgress = s => JSON.stringify([s.life.donations.total, s.life.treasury,
  Object.entries(s.life.materials).sort(([a], [b]) => a.localeCompare(b)), s.life.map.revision,
  s.zones.filter(z => z.cleared).map(z => z.id)])
export function lifeView(s) {
  const l = s.life
  return { ...l, map: runtimeMap(l), buildings: l.buildings.map(b => ({ ...b, artKey: lifeArtKey(b) })),
    catalog: { items: s.items.filter(i => i.stackable).map(i => ({ ...i, artKey: itemArtKey(i) })), facilities: FACILITIES,
      replenishment: { awakeSeconds: 300, gold: 30, maxGold: 200, materialUnits: 5, maxMaterialStock: 40 },
      gmBudget: { plansPerDay: s.settings.dmDailyLimit > 0 ? 1 : 0, reviewAttemptsPerDay: s.settings.dmDailyLimit, separateFromFloors: true },
      checkpointSeconds: 5, commandRetentionDays: 30 }, recipes: RECIPES }
}

/** Flood check prevents a building or chair from cutting off any previously reachable remaining tile. */
function reachable(map) {
  const start = GATE.tile, key = p => p.y * map.width + p.x, seen = new Set([key(start)]), queue = [start]
  for (let i = 0; i < queue.length; i++) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const p = { x: queue[i].x + dx, y: queue[i].y + dy }, k = key(p)
    if (canWalk(map, p.x, p.y) && !seen.has(k)) { seen.add(k); queue.push(p) }
  }
  return seen
}
function validateGeometry(before, after, buildings) {
  const old = reachable(before), next = reachable(after)
  for (let y = 0; y < before.height; y++) for (let x = 0; x < before.width; x++) {
    if (old.has(y * before.width + x) && canWalk(after, x, y)) need(next.has(y * after.width + x), '주요 이동로가 끊어지는 부지야.')
  }
  for (const b of buildings) need(canWalk(after, b.door.x, b.door.y) && next.has(b.door.y * after.width + b.door.x), '건물 출입구에 갈 수 없어.')
}
const grassSite = (map, site) => {
  for (let y = site.y; y < site.y + site.h; y++) for (let x = site.x; x < site.x + site.w; x++) if (!['.', ','].includes(tileAt(map, x, y))) return false
  return true
}
function siteOf(s, input, geometry = null) {
  const l = s.life, def = need(FACILITIES[input.kind] ?? (input.buildingId && l.buildings.find(b => b.id === input.buildingId && b.role === input.kind)), '지원하는 시설 종류를 골라줘.')
  if (input.kind === 'expansion') {
    need(!input.buildingId && ['east', 'south'].includes(input.direction), '동쪽이나 남쪽 인접 구역을 골라줘.')
    need(l.expanded < 3 && !l.constructions.some(c => ACTIVE.has(c.status) && c.kind === 'expansion'), '영역 확장은 세 번까지, 한 번에 하나만 가능해.')
    return { direction: input.direction }
  }
  if (input.buildingId) {
    const b = need(l.buildings.find(b => b.id === input.buildingId), '없는 건물이야.')
    need(b.role === def.role && b.level < 3 && !l.constructions.some(c => ACTIVE.has(c.status) && c.buildingId === b.id), '증축할 수 없는 시설이야.')
    return { x: b.x, y: b.y, w: b.w, h: b.h, door: b.door }
  }
  need(l.buildings.length + l.constructions.filter(c => ACTIVE.has(c.status) && !c.buildingId && c.kind !== 'expansion').length < 30, '시설은 30개까지야.')
  const map = geometry ?? runtimeMap(l), x = integer(input.x, 1, map.width - def.w - 1), y = integer(input.y, 1, map.height - def.h - 2)
  const site = { x, y, w: def.w, h: def.h, door: { x: x + Math.floor(def.w / 2), y: y + def.h } }
  need(grassSite(map, site), '빈 풀밭에만 지을 수 있어. 길·시설·예약 부지는 보호돼.')
  const trial = { ...l, constructions: [...l.constructions, { status: 'reserved', site, kind: input.kind }] }
  validateGeometry(map, runtimeMap(trial), [...protectedDoors(l), site])
  return site
}
function placementSite(s, input, geometry = null) {
  const l = s.life, map = geometry ?? runtimeMap(l)
  need(l.placements.length < 40, '설치 한도에 도달했어.')
  const x = integer(input.x, 1, map.width - 2), y = integer(input.y, 1, map.height - 2)
  need(grassSite(map, { x, y, w: 1, h: 1 }), '빈 풀밭에만 설치할 수 있어.')
  const trial = { ...l, placements: [...l.placements, { x, y }] }
  validateGeometry(map, runtimeMap(trial), protectedDoors(l))
  return { x, y }
}
export function lifeLandmarks(s) {
  return runtimePlaces(s.life).map(p => ({ name: p.name.replace(/ 앞$/, ''),
    x: p.tiles.reduce((n, t) => n + t.x, 0) / p.tiles.length, y: p.tiles.reduce((n, t) => n + t.y, 0) / p.tiles.length }))
}

/** The preview and auto-build use the same bounded, validated candidates. `near` is a named saved-map place. */
export function siteCandidates(s, kind, count = 2, cursor = 0, near = null, map = runtimeMap(s.life), landmarks = lifeLandmarks(s)) {
  const def = kind === 'place' ? { w: 1, h: 1 } : need(FACILITIES[kind], '지원하는 시설 종류를 골라줘.')
  const landmark = near ? need(landmarks.find(p => p.name === near), '지도에 있는 기준 장소를 골라줘.') : null
  const total = (map.width - 2) * (map.height - 2), start = (cursor * 131) % total, positions = [], found = []
  const distance = (p, place) => (p.x + def.w / 2 - place.x) ** 2 + (p.y + def.h / 2 - place.y) ** 2
  for (let i = 0; i < total && (landmark || positions.length < 12); i++) {
    const at = (start + i) % total, x = 1 + at % (map.width - 2), y = 1 + Math.floor(at / (map.width - 2))
    if (x + def.w >= map.width || y + def.h + (kind === 'place' ? 0 : 1) >= map.height || !grassSite(map, { x, y, w: def.w, h: def.h })) continue
    positions.push({ x, y })
  }
  if (landmark) positions.sort((a, b) => distance(a, landmark) - distance(b, landmark))
  for (const p of positions.slice(0, 12)) {
    try {
      const site = kind === 'place' ? placementSite(s, p, map) : siteOf(s, { kind, ...p }, map)
      const nearest = landmarks.reduce((best, place) => !best || distance(p, place) < distance(p, best) ? place : best, null)
      const dx = nearest ? p.x + def.w / 2 - nearest.x : 0, dy = nearest ? p.y + def.h / 2 - nearest.y : 0
      const direction = Math.abs(dx) > Math.abs(dy) ? dx < 0 ? '서쪽' : '동쪽' : dy < 0 ? '북쪽' : '남쪽'
      found.push({ x: site.x, y: site.y, ...(site.door ? { door: site.door } : {}), ...(nearest ? { location: `${nearest.name} ${direction}` } : {}) })
      if (found.length >= count) break
    } catch { /* Reserved footprints, entrances and connected paths remain authoritative. */ }
  }
  return found
}

/** Small authoritative action menu, not a second map/placement algorithm. All candidates pass the execution validators.
 * Each kind tries at most 12 grass footprints, returns two sites (four chairs); the bounded map scan rotates per turn.
 */
export function lifeGeometry(s, cursor = 0, focus = null, near = null) {
  const map = runtimeMap(s.life), out = { revision: map.revision, width: map.width, height: map.height }
  if (focus?.x !== undefined) {
    const x = Math.max(0, focus.x - 2), y = Math.max(0, focus.y - 2), width = Math.min(map.width - x, (focus.w ?? 1) + 4), height = Math.min(map.height - y, (focus.h ?? 1) + 5)
    out.window = { x, y, tiles: map.tiles.slice(y, y + height).map(row => row.slice(x, x + width)),
      entrances: protectedDoors(s.life).map(b => b.door).filter(p => p.x >= x && p.x < x + width && p.y >= y && p.y < y + height) }
    return out
  }
  const landmarks = lifeLandmarks(s)
  const candidates = (kind, count) => siteCandidates(s, kind, count, cursor, near, map, landmarks)
  out.landmarks = landmarks.slice(0, 12).map(p => p.name)
  out.buildSites = Object.fromEntries(Object.keys(FACILITIES).filter(kind => kind !== 'expansion').map(kind => [kind, candidates(kind, 2)]))
  out.placeSites = candidates('place', 4)
  out.expansionDirections = s.life.expanded < 3 && !s.life.constructions.some(c => ACTIVE.has(c.status) && c.kind === 'expansion') ? ['east', 'south'] : []
  return out
}
export function constructionQuote(s, input, direct = false) {
  const actor = direct ? null : actorOf(s, input.actorId), funding = direct ? 'public' : input.funding ?? 'private'
  need(['private', 'public'].includes(funding), '자금 출처를 골라줘.')
  const def = need(FACILITIES[input.kind] ?? (direct && input.buildingId && s.life.buildings.find(b => b.id === input.buildingId && b.role === input.kind)), '지원하는 시설 종류를 골라줘.'), site = siteOf(s, input)
  const building = input.buildingId && s.life.buildings.find(b => b.id === input.buildingId)
  if (building && !direct) need(building.ownership === funding && (funding === 'public' || building.ownerId === actor.id), '소유주와 자금 출처가 맞지 않아.')
  const level = building?.level ?? 1
  return { kind: input.kind, actorId: actor?.id ?? null, buildingId: building?.id ?? null, funding, site,
    gold: direct ? 0 : def.gold * level, materials: direct ? {} : Object.fromEntries(Object.entries(def.materials).map(([id, n]) => [id, n * level])),
    seconds: direct ? 0 : def.seconds * level, designRevision: building?.designRevision ?? 0 }
}
function reserve(s, input, now, direct = false) {
  need(direct || s.life.constructions.filter(c => ACTIVE.has(c.status)).length < 8, '대기 공사가 여덟 개야.')
  const q = constructionQuote(s, input, direct)
  if (!direct) {
    const actor = actorOf(s, q.actorId), bag = q.funding === 'public' ? s.life.materials : actor.stacks
    need(balance(s, q) >= q.gold, '견적의 골드가 부족해. 공공 자금은 기부로 모아줘.')
    q.materials = materialPlan(s, bag, q.materials)
    pay(s, q, -q.gold); takeMaterials(bag, q.materials, -1)
  }
  const c = { ...q, id: randomUUID(), status: 'reserved', createdAt: now, progress: 0, spentGold: 0, spentMaterials: {}, reason: '', reviewAt: 0 }
  s.life.constructions = [...s.life.constructions.filter(c => ACTIVE.has(c.status)), ...s.life.constructions.filter(c => !ACTIVE.has(c.status)).slice(-40), c]
  s.life.map.revision++ // reservation is represented in runtime geometry
  if (!direct) log(s, `${actorOf(s, q.actorId).name} · ${FACILITIES[c.kind].name} 공사 신청 · ${c.gold}G와 자재 예치`, q.actorId, now, { gmLife: true })
  return c
}
function refund(s, c, status, reason) {
  if (!ACTIVE.has(c.status)) return false
  const actor = s.actors.find(a => a.id === c.actorId), bag = c.funding === 'public' ? s.life.materials : actor.stacks
  // Escrow return is allowed to exceed the normal inventory cap: never destroy reserved property on refund.
  pay(s, c, c.gold - c.spentGold)
  for (const [id, n] of Object.entries(c.materials)) bag[id] = quantityOf(bag, id) + n - (c.spentMaterials[id] ?? 0)
  c.status = status; c.reason = reason; s.life.map.revision++
  return true
}
function income(s, b, amount) {
  const owner = b.ownership === 'private' && s.actors.find(a => a.id === b.ownerId)
  if (owner) owner.gold += amount
  else s.life.treasury += amount
}
/** Existing inn payments use the same facility ownership ledger, not a second currency. */
export function facilityIncome(s, role, amount) {
  const b = s.life?.buildings.find(b => b.role === role)
  if (b) income(s, b, amount)
}
function startProduction(s, actor, recipe, b) {
  const l = s.life
  need(l.production.length < MAX_JOBS && !l.production.some(j => j.actorId === actor.id), '이미 제작 중이거나 제작 대기열이 찼어.')
  const inputs = materialPlan(s, actor.stacks, recipe.inputs)
  need(!recipe.tool || s.items.some(d => (d.id === recipe.tool || d.templateId === recipe.tool) && quantityOf(actor.stacks, d.id) > 0), '도구가 부족해.')
  need(quantityOf(actor.stacks, recipe.output.itemId) + recipe.output.quantity <= MAX_STACK, '완성품을 보관할 공간이 없어.')
  const fee = FACILITIES[b.role]?.fee ?? 1
  need(actor.gold >= fee, '시설 이용료가 부족해.')
  actor.gold -= fee; income(s, b, fee); takeMaterials(actor.stacks, inputs, -1)
  l.production.push({ id: randomUUID(), actorId: actor.id, recipeId: recipe.id, buildingId: b.id, progress: 0, seconds: recipe.seconds / b.level, output: recipe.output })
}
export function lifeAction(s, input, now) {
  migrateLife(s)
  need(LIFE_ACTIONS.includes(input.action), '지원하지 않는 생활 행동이야.')
  const a = actorOf(s, input.actorId), l = s.life, n = input.quantity === undefined ? 1 : integer(input.quantity, 1, 99)
  if (input.action === 'construct') return reserve(s, input, now)
  if (input.action === 'cancel-construction') {
    const c = need(l.constructions.find(c => c.id === input.constructionId && c.actorId === a.id), '자신이 신청한 공사가 아니야.')
    refund(s, c, 'cancelled', '신청자가 취소했어.'); return c
  }
  if (input.action === 'temple-donate') {
    need(l.buildings.some(b => b.id === input.buildingId && b.role === 'oracle'), '실제 신전을 골라줘.')
    const amount = integer(input.amount, 1, 10000)
    need(a.gold >= amount, '골드가 부족해.')
    need(Number.isSafeInteger(l.donations.total + amount) && Number.isSafeInteger(l.treasury + amount), '헌금 기록 한도에 도달했어.')
    a.gold -= amount; l.treasury += amount; l.donations.total += amount
    log(s, `${a.name} · 신전 발전 헌금 ${amount}G · 누적 ${l.donations.total}G`, a.id, now, { gmLife: true })
    return { action: input.action, actorId: a.id, total: l.donations.total }
  }
  if (input.action === 'donate') {
    if (input.itemId) { const d = defOf(s, input.itemId); need(d.capabilities.includes('material'), '공공 자재만 기부할 수 있어.'); give(a.stacks, d.id, -n); give(l.materials, d.id, n) }
    else { const amount = integer(input.amount, 1, 10000); need(a.gold >= amount, '골드가 부족해.'); a.gold -= amount; l.treasury += amount }
  } else if (input.action === 'work') {
    const npc = need(l.npcs.find(npc => npc.id === input.npcId && npc.role === 'producer' && npc.open), '영업 중인 생산 담당을 골라줘.')
    need(l.production.length < MAX_JOBS && !l.production.some(j => j.actorId === a.id), '이미 작업 중이야.')
    need(npc.gold >= 4 && quantityOf(npc.stock, 'herb') >= 2 && quantityOf(npc.stock, 'tea-cup') < 40, '고용주의 자금·재료·창고 여유가 부족해.')
    npc.gold -= 4; give(npc.stock, 'herb', -2)
    l.production.push({ id: randomUUID(), actorId: a.id, npcId: npc.id, buildingId: npc.buildingId, progress: 0, seconds: 20, wage: 4, output: { itemId: 'tea-cup', quantity: 1 } })
  } else if (input.action === 'produce' || input.action === 'service') {
    const b = need(l.buildings.find(b => b.id === input.buildingId), '없는 시설이야.')
    if (input.action === 'produce') {
      const recipe = need(RECIPES.find(r => r.id === input.recipeId && r.role === b.role), '이 시설에서 만들 수 없는 물품이야.')
      startProduction(s, a, recipe, b)
    } else {
      need(b.role === 'home' || b.role === 'inn', '휴식 시설을 골라줘.')
      const fee = FACILITIES.home.fee; need(a.gold >= fee, '이용료가 부족해.')
      a.gold -= fee; income(s, b, fee); a.hp = Math.min(stats(s, a).hp, a.hp + 10 * b.level); a.mp = Math.min(stats(s, a).mp, a.mp + 5 * b.level)
      changeStatuses(s, a, { fatigue: -20, mood: 3 }, false, 'rule')
    }
  } else if (input.action === 'deliver') {
    const q = need(l.deliveryQuests.find(q => q.id === input.questId && q.status === 'open'), '접수 중인 납품 의뢰가 아니야.')
    need(n <= q.count - q.progress, '남은 납품량보다 많아.')
    const npc = l.npcs.find(p => p.id === q.npcId)
    const d = defOf(s, input.itemId ?? q.itemId)
    need(d.id === q.itemId || d.templateId === q.itemId, '의뢰에 맞는 물품이 아니야.')
    give(a.stacks, d.id, -n); give(npc.stock, d.id, n)
    a.gold += n * q.price; q.escrow -= n * q.price; q.progress += n
    if (q.progress === q.count) {
      q.status = 'completed'
      log(s, `${a.name} · ${q.title} 완료 · ${q.count}개 납품, 총 ${q.count * q.price}G`, a.id, now)
    }
  } else {
    const d = defOf(s, input.itemId)
    if (input.action === 'buy' || input.action === 'sell') {
      const npc = need(l.npcs.find(p => p.id === input.npcId && p.open), '영업 중인 NPC를 골라줘.')
      need(npc.role !== 'builder', '건설 담당은 물품 상인이 아니야.')
      const buying = input.action === 'buy', price = buying ? d.price : Math.max(1, Math.floor(d.price / 2)), cost = price * n
      need((buying ? a.gold : npc.gold) >= cost, '거래 상대의 골드가 부족해.')
      give(buying ? npc.stock : a.stacks, d.id, -n); give(buying ? a.stacks : npc.stock, d.id, n)
      a.gold += buying ? -cost : cost; npc.gold += buying ? cost : -cost
    } else if (input.action === 'store' || input.action === 'take') {
      const store = input.action === 'store'
      let capacity = 99
      if (input.buildingId) {
        const b = need(l.buildings.find(b => b.id === input.buildingId && b.role === 'warehouse'), '창고 시설을 골라줘.')
        const fee = FACILITIES.warehouse.fee; need(a.gold >= fee, '창고 이용료가 부족해.')
        a.gold -= fee; income(s, b, fee); capacity += b.level * 200
      }
      give(store ? a.stacks : a.storedStacks, d.id, -n); give(store ? a.storedStacks : a.stacks, d.id, n, store ? capacity : MAX_STACK)
    } else if (input.action === 'use') {
      need(d.capabilities.includes('consume') && d.effect === 'restore', '먹거나 마실 수 없는 물품이야.')
      give(a.stacks, d.id, -n); a.hp = Math.min(stats(s, a).hp, a.hp + n * 8); a.mp = Math.min(stats(s, a).mp, a.mp + n * 4)
      changeStatuses(s, a, { hunger: -25 * n, mood: 3 }, false, 'rule')
    } else if (input.action === 'place') {
      need(d.capabilities.includes('place') && l.placements.length < 40, '설치할 수 없거나 설치 한도에 도달했어.')
      need(n === 1, '설치는 한 번에 한 개씩이야.')
      const { x, y } = placementSite(s, input)
      give(a.stacks, d.id, -1); l.placements.push({ id: randomUUID(), itemId: d.id, ownerId: a.id, x, y }); l.map.revision++
    }
  }
  const label = { buy: '구매', sell: '판매', use: '소비', store: '보관', take: '꺼내기', produce: '제작 접수', work: '근무 접수', deliver: '납품', place: '설치', donate: '기부', service: '시설 이용' }[input.action]
  const item = s.items.find(d => d.id === input.itemId)
  log(s, `${a.name} · ${label}${item ? ` · ${item.name} ${n}개` : ''}`, a.id, now, QUIET)
  return { action: input.action, actorId: a.id }
}

export function reviewConstruction(s, id, output, now) {
  const c = need(s.life.constructions.find(c => c.id === id && c.status === 'reserved'), '이미 심사가 끝난 공사야.')
  if (!(typeof output?.approve === 'boolean' && typeof output.reason === 'string' && output.reason.trim())) throw Object.assign(new Error('GM 심사 사유와 결정을 확인해줘.'), { category: 'format' })
  c.reason = clipProse(output.reason, 240)
  if (!output.approve) refund(s, c, 'rejected', c.reason)
  else c.status = 'approved'
  log(s, `GM 공사 ${output.approve ? '승인' : '거절'} · ${FACILITIES[c.kind].name}: ${c.reason}`, c.actorId, now, { gmLife: true })
}
/** Cosmetic proposals inherit a bounded server template; no custom stat/effect/price execution. */
export function createLifeItem(s, item) {
    const base = need(LIFE_ITEMS.find(d => d.id === item.template), '지원하지 않는 물품 기능이야.')
    if (!(typeof item.name === 'string' && item.name.trim() && typeof item.description === 'string')) throw Object.assign(new Error('물품 설명을 확인해줘.'), { category: 'format' })
    const name = clipProse(item.name, 60), description = clipProse(item.description, 240)
    need(!s.items.some(i => i.stackable && i.name === name), '이미 같은 이름의 생활 물품이 있어.')
      need(s.items.filter(i => i.stackable).length < 60, '생활 물품 정의는 60개까지야.')
      const d = { ...structuredClone(base), id: `life-${randomUUID()}`, name, description, templateId: base.id }
      s.items.push(d); setLook(s, itemArtKey(d), item.look)
      return d
}
export function proposeLife(s, output, now) {
  const item = output?.item
  if (item?.template && !s.items.some(i => i.stackable && i.name === item.name?.trim())) {
      const d = createLifeItem(s, item), base = LIFE_ITEMS.find(i => i.id === item.template)
      // A new definition is obtainable, not text-only: finite initial stock replaces equivalent template stock.
      const npc = s.life.npcs.find(n => n.id === 'trader'), count = Math.min(3, quantityOf(npc.stock, base.id))
      if (count) { give(npc.stock, base.id, -count); give(npc.stock, d.id, count) }
      log(s, `GM 물품 정의 생성 · ${d.name}${artProblem(s) ? ` · 그림은 아직 만들 수 없어: ${artProblem(s)}` : ''}`, null, now, { gmLife: true })
  }
  const facility = output?.facility
  if (facility?.kind) {
    const actor = s.actors.find(a => a.active && ['town', 'rest'].includes(a.phase))
    if (!actor) { log(s, `공사를 신청할 마을 주민이 없어 시설은 건너뛰었어.${item?.template ? ' 물품은 유지했어.' : ''}`, null, now, { gmLife: true }); return }
    reserve(s, { ...facility, actorId: actor.id, funding: 'public' }, now)
  }
}
function expandMap(l, direction) {
  const m = l.map, width = m.width + (direction === 'east' ? 8 : 0), height = m.height + (direction === 'south' ? 8 : 0)
  const rows = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) =>
    x < m.width && y < m.height ? m.tiles[y][x] : x === width - 1 || y === height - 1 || x === 0 || y === 0 ? 'T' : '.'))
  if (direction === 'east') for (let y = 8; y <= 10; y++) rows[y][m.width - 1] = '='
  else for (let x = 14; x <= 16; x++) rows[m.height - 1][x] = '='
  m.width = width; m.height = height; m.tiles = rows.map(r => r.join('')); l.expanded++
}
function complete(s, c, now) {
  const l = s.life
  if (c.kind === 'expansion') expandMap(l, c.site.direction)
  else if (c.buildingId) {
    const b = need(l.buildings.find(b => b.id === c.buildingId && b.designRevision === c.designRevision), '증축 설계가 변경됐어.')
    b.level++; b.designRevision++
  } else {
    const d = FACILITIES[c.kind]
    l.buildings.push({ ...c.site, id: `building-${c.id}`, name: d.name, role: d.role, roof: d.roof, level: 1, designRevision: 1,
      ownership: c.funding, ownerId: c.funding === 'private' ? c.actorId : null })
    const npc = l.npcs.find(n => n.id === ({ merchant: 'trader', tea: 'producer', guild: 'builder' }[d.role]))
    if (npc && l.buildings.find(b => b.id === npc.buildingId)?.role === 'inn') {
      npc.buildingId = `building-${c.id}`; npc.path = []
    }
  }
  c.status = 'completed'; c.completedAt = now; l.map.revision++
  log(s, `${FACILITIES[c.kind]?.name ?? l.buildings.find(b => b.id === c.buildingId)?.name} 공사 완료`, c.actorId, now, { gmLife: true })
}

/** Player-approved GM operations share placement, completion, escrow and stack rules, never economy gates. */
export function manageLife(s, input, now) {
  const l = s.life, building = () => need(l.buildings.find(b => b.id === input.buildingId), '없는 시설이야.')
  if (['build', 'upgrade', 'expand-map'].includes(input.type)) {
    const b = input.type === 'upgrade' ? building() : null
    const kind = b?.role ?? (input.type === 'expand-map' ? 'expansion' : input.kind)
    let site = input
    if (input.type === 'build' && input.x === undefined && input.y === undefined) {
      site = siteCandidates(s, kind, 1, 0, input.near ?? null)[0]
      need(site, '자동 후보 12개 안에서 유효 부지를 찾지 못했어. 좌표를 지정하거나 지도를 확장해줘.')
    }
    const target = b ? (input.level === undefined ? b.level + 1 : integer(input.level, b.level + 1, 3)) : 1
    let c
    do {
      c = reserve(s, { ...site, kind, buildingId: b?.id }, now, true)
      complete(s, c, now)
    } while (b && b.level < target)
    const made = b ?? l.buildings.find(b => b.id === `building-${c.id}`)
    return made ? `${made.name} · (${made.x}, ${made.y}) · 단계 ${made.level}` : `지도 ${l.map.width}×${l.map.height}`
  }
  if (['complete-construction', 'cancel-construction'].includes(input.type)) {
    const c = need(l.constructions.find(c => c.id === input.constructionId && ACTIVE.has(c.status)), '진행 중인 공사가 아니야.')
    if (input.type === 'cancel-construction') { refund(s, c, 'cancelled', '플레이어가 GM에게 취소를 요청했어.'); return '공사 취소 · 남은 예치금·자재 반환' }
    // Release its own reservation while validating the exact site again. Refund only unspent escrow.
    const trial = { ...s, life: { ...l, constructions: l.constructions.filter(x => x !== c) } }
    siteOf(trial, { kind: c.kind, buildingId: c.buildingId, ...c.site })
    if (c.buildingId) need(buildingRevision(s, c), '증축 설계가 변경됐어.')
    refund(s, c, 'cancelled', 'GM 즉시 완공 · 남은 예치 반환')
    complete(s, c, now)
    return '즉시 완공 · 남은 예치금·자재 반환 (이미 쓴 몫은 유지)'
  }
  if (['rename-building', 'move-building', 'remove-building'].includes(input.type)) {
    const b = building()
    if (input.type === 'rename-building') {
      need(typeof input.name === 'string' && input.name.trim() && input.name.length <= 60, '시설 이름은 1–60자로 써줘.')
      b.name = input.name.trim(); return b.name
    }
    if (input.type === 'remove-building' && ['inn', 'oracle'].includes(b.role)) need(l.buildings.some(other => other.id !== b.id && other.role === b.role), '마지막 여관·신전은 철거할 수 없어. 주민 생활에 꼭 필요한 시설이야.')
    need(!l.constructions.some(c => ACTIVE.has(c.status) && c.buildingId === b.id), '진행 중인 증축을 먼저 완료하거나 취소해줘.')
    need(!l.production.some(j => j.buildingId === b.id), '이 시설의 생산 작업이 끝난 뒤 바꿔줘.')
    const before = runtimeMap(l)
    // Seeded buildings are also painted into the base map; removing only the object leaves invisible walls.
    if (b.seeded) {
      l.map.tiles = l.map.tiles.map((row, y) => y >= b.y && y < b.y + b.h ? row.slice(0, b.x) + '.'.repeat(b.w) + row.slice(b.x + b.w) : row)
    }
    l.buildings = l.buildings.filter(x => x !== b)
    if (input.type === 'move-building') {
      const map = runtimeMap(l), x = integer(input.x, 1, map.width - b.w - 1), y = integer(input.y, 1, map.height - b.h - 2)
      const moved = { ...b, x, y, seeded: false, door: { x: x + Math.floor(b.w / 2), y: y + b.h } }
      need(grassSite(map, moved), '빈 풀밭에만 옮길 수 있어.')
      l.buildings.push(moved)
    }
    validateGeometry(before, runtimeMap(l), protectedDoors(l))
    for (const npc of l.npcs) if (npc.buildingId === b.id) {
      const work = l.buildings.find(x => x.id === b.id) ?? l.buildings.find(x => x.role === 'inn') ?? l.buildings[0]
      npc.buildingId = work?.id ?? null; npc.path = []; npc.x = (work?.door ?? GATE.tile).x; npc.y = (work?.door ?? GATE.tile).y
    }
    l.map.revision++
    return `${b.name} · ${input.type === 'remove-building' ? '철거' : `(${input.x}, ${input.y})로 이동`}`
  }
  if (input.type === 'npc') {
    const npc = need(l.npcs.find(n => n.id === input.npcId), '없는 NPC야.')
    const changes = [], money = ['add', 'set', 'gold'].some(k => input[k] !== undefined)
    need(money || input.buildingId !== undefined || input.itemId !== undefined, '바꿀 NPC 항목이 없어.')
    if (money) changes.push(changeGold(npc, input))
    if (input.buildingId !== undefined) { const b = building(); npc.buildingId = b.id; npc.path = []; npc.x = b.door.x; npc.y = b.door.y; changes.push(`직장 ${b.name}`) }
    if (input.itemId !== undefined) {
      const d = defOf(s, input.itemId), before = quantityOf(npc.stock, d.id)
      give(npc.stock, d.id, integer(input.quantity, 0, MAX_STACK) - before); changes.push(`${d.name} 재고 ${before} → ${quantityOf(npc.stock, d.id)}개`)
    }
    return `${npc.name} · ${changes.join(' · ')}`
  }
  if (input.type === 'resident-gold') {
    const a = need(s.actors.find(a => a.id === input.actorId && a.active), '없는 주민이야.')
    return `${a.name} · ${changeGold(a, input)}`
  }
  throw new Error('지원하지 않는 생활 관리 작업이야.')
}
const buildingRevision = (s, c) => s.life.buildings.some(b => b.id === c.buildingId && b.designRevision === c.designRevision)

/** `gold` is retained only for already-saved absolute proposals; new proposals use explicit add/set. */
function changeGold(target, input) {
  const fields = ['add', 'set', 'gold'].filter(k => input[k] !== undefined)
  need(fields.length === 1, '골드는 add(더하기·빼기) 또는 set(잔액 지정) 중 하나만 써줘.')
  const before = target.gold
  const value = fields[0] === 'add' ? before + integer(input.add, -1e9, 1e9) : integer(input[fields[0]], 0, 1e9)
  target.gold = Math.max(0, Math.min(1e9, value))
  return `골드 ${before}G → ${target.gold}G${value !== target.gold ? ' (0~10억 한도 적용)' : ''}`
}

export function manageStack(s, actor, item, target, quantity) {
  const stored = target === 'storage'
  need(['inventory', 'storage'].includes(target), '가방이나 창고를 골라줘.')
  const cap = stored ? 99 + Math.max(0, ...s.life.buildings.filter(b => b.role === 'warehouse').map(b => b.level)) * 200 : MAX_STACK
  give(stored ? actor.storedStacks : actor.stacks, item.id, quantity, cap)
}

/** dt comes only from the live process, never a persisted timestamp: no sleep/restart catch-up. */
export function advanceLife(s, world, dt, now) {
  const l = s.life
  if (!world.running || dt <= 0) return
  l.elapsed += dt
  const shifts = shiftsOf(s.settings), map = runtimeMap(l)
  for (const npc of l.npcs) {
    npc.open = onDuty(shifts, npc.role === 'merchant' ? 'merchant' : 'guild', world.clock ?? 600)
    const b = l.buildings.find(b => b.id === npc.buildingId), work = npc.role === 'builder' ? l.constructions.find(c => ['approved', 'building'].includes(c.status)) : null
    const target = npc.open ? work?.site.door ?? b?.door ?? GATE.tile : { x: 12 + l.npcs.indexOf(npc) * 2, y: 17 }
    if (!canWalk(map, Math.round(npc.x), Math.round(npc.y))) { npc.x = GATE.tile.x; npc.y = GATE.tile.y; npc.path = [] }
    if (npc.path.some(p => !canWalk(map, p.x, p.y))) npc.path = []
    if (!npc.path.length) npc.path = findPath(map, npc, target)
    let budget = dt * 1.5
    while (budget > 0 && npc.path.length) {
      const p = npc.path[0], distance = Math.hypot(p.x - npc.x, p.y - npc.y)
      if (distance <= budget) { npc.x = p.x; npc.y = p.y; npc.path.shift(); budget -= distance }
      else { npc.x += (p.x - npc.x) * budget / distance; npc.y += (p.y - npc.y) * budget / distance; budget = 0 }
    }
  }
  if (l.elapsed - l.replenishedAt >= 300) {
    l.replenishedAt = l.elapsed
    for (const npc of l.npcs.filter(n => n.role !== 'builder')) {
      npc.gold = Math.max(npc.gold, Math.min(200, npc.gold + 30))
      for (const id of npc.id === 'trader' ? ['timber', 'stone', 'herb'] : ['herb']) if (quantityOf(npc.stock, id) < 40) give(npc.stock, id, Math.min(5, 40 - quantityOf(npc.stock, id)))
    }
  }
  const producer = l.npcs.find(n => n.id === 'producer')
  if (producer.open && quantityOf(producer.stock, 'herb') >= 2 && quantityOf(producer.stock, 'tea-cup') < 20) {
    producer.work = (producer.work ?? 0) + dt
    if (producer.work >= 10) { producer.work = 0; give(producer.stock, 'herb', -2); give(producer.stock, 'tea-cup', 1) }
  }
  if (!l.deliveryQuests.some(q => q.status === 'open') && producer.gold >= 12) {
    producer.gold -= 12
    const workplace = l.buildings.find(b => b.id === producer.buildingId)
    l.deliveryQuests = [...l.deliveryQuests.slice(-19), { id: randomUUID(), npcId: producer.id, title: `${workplace?.name ?? producer.name}의 찻잎 납품`, itemId: 'herb', count: 4, progress: 0, price: 3, escrow: 12, status: 'open' }]
  }
  for (const job of l.production) {
    const a = s.actors.find(a => a.id === job.actorId), b = l.buildings.find(b => b.id === job.buildingId)
    if (!a?.active || !b) continue
    job.progress = Math.min(job.seconds, job.progress + dt)
    const npc = job.npcId && l.npcs.find(n => n.id === job.npcId), bag = npc ? npc.stock : a.stacks
    if (job.progress === job.seconds && quantityOf(bag, job.output.itemId) + job.output.quantity <= MAX_STACK) {
      give(bag, job.output.itemId, job.output.quantity); a.gold += job.wage ?? 0; job.done = true
      const item = s.items.find(d => d.id === job.output.itemId)
      log(s, `${a.name} · ${item?.name ?? '물품'} ${job.output.quantity}개 제작 완료${job.wage ? ` · 고용주에게 납품, 보수 +${job.wage}G` : ' · 소지품에 수령'}`, a.id, now)
    }
  }
  l.production = l.production.filter(j => !j.done)
  const builder = l.npcs.find(n => n.role === 'builder')
  const c = (!builder || builder.open) && l.constructions.find(c => c.status === 'approved' || c.status === 'building')
  if (c) {
    const existing = c.buildingId && l.buildings.find(b => b.id === c.buildingId)
    if (c.buildingId && (!existing || existing.designRevision !== c.designRevision)) {
      refund(s, c, 'failed', '설계가 변경돼 공사를 마무리할 수 없어.'); return
    }
    if (builder && c.site.door && Math.hypot(builder.x - c.site.door.x, builder.y - c.site.door.y) > .1) return
    if (c.status === 'approved') c.recipientId = builder?.id ?? null
    c.status = 'building'; c.progress = Math.min(c.seconds, c.progress + dt)
    const spent = Math.floor(c.gold * c.progress / c.seconds), delta = spent - c.spentGold
    c.spentGold = spent
    const recipient = c.recipientId && l.npcs.find(n => n.id === c.recipientId)
    if (recipient) recipient.gold += delta
    else l.constructionSink = (l.constructionSink ?? 0) + delta
    for (const [id, n] of Object.entries(c.materials)) c.spentMaterials[id] = Math.floor(n * c.progress / c.seconds)
    if (c.progress === c.seconds) complete(s, c, now)
  }
}
