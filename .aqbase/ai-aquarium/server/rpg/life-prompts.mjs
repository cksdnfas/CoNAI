import { LIFE_ITEMS, FACILITIES } from '../../shared/life.mjs'
import { lifeGeometry } from './life.mjs'
import { dataLine } from '../llm-budget.mjs'

// Project complete records; the shared budget selects against the real profile context.
const nameOf = value => String(value ?? '')
const itemRows = s => s.items.filter(d => d.stackable)
const itemDef = d => ({ id: d.id, name: nameOf(d.name), template: d.templateId ?? d.id, capabilities: d.capabilities, price: d.price, ...(d.effect ? { effect: d.effect } : {}) })
const buildings = s => s.life.buildings.map(b => ({
  id: b.id, name: nameOf(b.name), role: b.role, level: b.level, ownerId: b.ownerId, ownership: b.ownership,
  x: b.x, y: b.y, w: b.w, h: b.h, door: b.door,
}))
const publicMaterials = s => Object.fromEntries(LIFE_ITEMS.filter(d => d.capabilities.includes('material')).map(base => [
  base.id, s.items.filter(d => d.id === base.id || d.templateId === base.id).reduce((sum, d) => sum + (s.life.materials[d.id] ?? 0), 0),
]))
const menuNotice = '자료는 실제 목록이야. 프로필 문맥에 맞춰 일부 항목이 생략될 수 있어. 보이는 정확한 ID만 사용하고 생략된 항목이 없다고 단정하지 마.'
const geometryNotice = 'geometry는 서버의 현재 지도 리비전·경계야. 새 construct는 해당 kind의 buildSites에서, place는 placeSites에서 좌표를 그대로 골라. 출입구·길·예약 부지 검증을 통과한 후보만 있어. 빈 목록은 이번 탐색에서 후보를 못 찾았다는 뜻이니 좌표를 추측하지 말고 다른 행동을 해. expansion은 expansionDirections 중 하나. 실행 때 다시 검증해.'

export function gmLifeMessage(s, construction, cursor) {
  const l = s.life
  if (construction) return [
    '너는 생활 세계의 GM이야. 아래 예치된 견적·소유·부지를 보고 approve와 reason으로 심사해. 게임 내 승인만 하며 호스트·이미지 비용은 승인하지 않아. item.template와 facility.kind는 비워.',
    'geometry.window는 예약 부지를 포함한 실제 충돌 지도의 발췌야. x,y는 발췌 원점, entrances는 보호할 출입구야. 부지·전역 경로는 서버가 예약 때 검증했고 실행 때도 보호해.',
    dataLine({
      construction: { id: construction.id, actorId: construction.actorId, kind: construction.kind, funding: construction.funding,
        buildingId: construction.buildingId, site: construction.site, gold: construction.gold, seconds: construction.seconds,
        materials: Object.entries(construction.materials).map(([id, quantity]) => {
          const d = s.items.find(d => d.id === id)
          return { id, template: d?.templateId ?? id, name: nameOf(d?.name), quantity }
        }) },
      facility: FACILITIES[construction.kind], geometry: lifeGeometry(s, cursor, construction.site),
    }),
  ].join('\n')
  return [
    '너는 생활 세계의 GM이야. 누적 신전 발전 헌금 total, 이미 판단한 reviewedTotal, 실제 완공 시설·던전 진척을 보고 마을 발전을 판단해. 헌금은 보상표가 아니며 돈을 만들어내지 않아. 공공 자금·자재 범위 안의 시설/인접 확장 또는 서버 템플릿 생활 물품을 제안할 수 있어. 시설은 예치·별도 공사 심사를 거쳐야 해. 필요 없으면 item.template와 facility.kind를 비워. 변화 없는 판단은 반복하지 않아. 임의 효과·가격·코드는 불가능해. 호스트·이미지 비용을 승인하지 않아.',
    menuNotice, geometryNotice,
    dataLine({ treasury: l.treasury, donations: l.donations, clearedFloors: s.zones.filter(z => z.cleared).map(z => z.floor), materials: publicMaterials(s), facilities: FACILITIES,
      templates: LIFE_ITEMS.map(itemDef), existingItems: itemRows(s, cursor).map(d => ({ id: d.id, name: nameOf(d.name) })),
      catalogTotal: s.items.filter(d => d.stackable).length, buildingTotal: l.buildings.length,
      buildings: buildings(s, cursor), geometry: lifeGeometry(s, cursor) }),
  ].join('\n')
}
