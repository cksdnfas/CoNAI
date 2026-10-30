import { FACILITIES, LIFE_ITEMS } from '../../shared/life.mjs'
import { ACTION_LABELS, actionLabel, displayText } from '../../shared/gm-actions.mjs'
import { artSubjects } from './game-art.mjs'

const normalize = value => typeof value === 'string' ? value.replace(/\s+/gu, '').toLowerCase() : ''
const FIELDS = { actorId: 'R', targetActorId: 'R', npcId: 'N', buildingId: 'B', itemId: 'I', zoneId: 'F', parentId: 'F', questId: 'Q', constructionId: 'C', template: 'T', key: 'A', instanceId: 'G' }
const LABELS = { R: '주민', N: 'NPC', B: '시설', I: '물품', F: '층', Q: '의뢰', C: '공사', T: '물품 템플릿', A: '그림', G: '장비 개체' }
const at = p => p?.x !== undefined ? `(${p.x}, ${p.y})` : ''
export function constructionName(s, c) {
  const base = FACILITIES[c.kind]?.name ?? c.kind
  const where = c.kind === 'expansion' ? `${c.site.direction === 'east' ? '동쪽' : '남쪽'} 인접 구역`
    : c.buildingId ? `${s.life.buildings.find(b => b.id === c.buildingId)?.name ?? '시설'} 증축` : `${at(c.site)} ${c.site.w}×${c.site.h}`
  return `${base} · ${where}`
}

/** Complete target domain, independent of the capped prompt lists. Aliases are scoped to one captured GM turn. */
function catalogs(s) {
  const data = {
    R: s.actors.filter(a => a.active).map(a => ({ id: a.id, name: a.name, detail: `프로필 ${a.profileId}` })),
    N: s.life.npcs,
    B: s.life.buildings.map(b => ({ ...b, detail: at(b) })),
    I: s.items,
    F: s.zones.map(z => ({ ...z, detail: `${z.floor}층` })),
    Q: s.quests.map(q => ({ id: q.id, name: q.title, detail: q.status })),
    C: s.life.constructions.map(c => ({ id: c.id, name: constructionName(s, c),
      names: [FACILITIES[c.kind]?.name ?? c.kind, `${FACILITIES[c.kind]?.name ?? c.kind} 공사`], detail: c.status })),
    T: LIFE_ITEMS,
    A: artSubjects(s).map(a => ({ id: a.key, name: a.name, detail: a.kind })),
    G: s.actors.filter(a => a.active).flatMap(a => ['inventory', 'storage'].flatMap(target =>
      (a[target] ?? []).map(i => ({ id: i.id, name: s.items.find(d => d.id === i.itemId)?.name ?? '없는 장비',
        actorId: a.id, itemId: i.itemId, target, detail: `${a.name} ${target === 'storage' ? '창고' : '가방'}${Object.values(a.equipment).includes(i.id) ? ' · 장착 중' : ''}` })))),
  }
  return Object.fromEntries(Object.entries(data).map(([kind, rows]) => [kind, rows.map((row, i) => ({ ...row, alias: `${kind}${i + 1}` }))]))
}

const referencesOf = lists => Object.fromEntries(Object.values(lists).flatMap(rows => rows.map(r => [r.alias, r.id])))
export const managementReferences = s => referencesOf(catalogs(s))

function resolve(rows, value, kind, references) {
  const token = normalize(value)
  if (!token) throw new Error(`${LABELS[kind]}의 ID 또는 표시 이름을 넣어줘.`)
  const byId = rows.find(r => normalize(r.id) === token)
  if (byId) return byId
  const reference = Object.entries(references).find(([alias]) => alias.startsWith(kind) && normalize(alias) === token)
  if (reference) {
    const row = rows.find(r => r.id === reference[1])
    if (!row) throw new Error(`${LABELS[kind]} 참조 ${reference[0]}의 대상이 사라졌거나 선택 범위가 바뀌었어. 다시 제안해줘.`)
    return row
  }
  const matches = rows.filter(r => [r.name, ...(r.names ?? [])].some(name => normalize(name) === token))
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) {
    const candidates = matches.slice(0, 8).map(r => `${r.name} [${r.alias}${r.detail ? ` · ${r.detail}` : ''}]`).join(', ')
    throw new Error(displayText(`${LABELS[kind]} 이름 "${value}"이 여러 대상과 같아. 후보: ${candidates}${matches.length > 8 ? ` 외 ${matches.length - 8}개` : ''}. 짧은 ID를 골라 다시 제안해줘.`))
  }
  throw new Error(displayText(`${LABELS[kind]} "${value}"을 찾을 수 없어. 표시 이름 전체 또는 문맥의 짧은 ID를 써줘.`))
}

/** Canonical IDs are frozen before preview; execution calls the same resolver before the existing domain validators. */
export function resolveManagementAction(s, input, references = null, lists = catalogs(s)) {
  references ??= referencesOf(lists)
  const out = structuredClone(input)
  for (const [field, kind] of Object.entries(FIELDS)) {
    if (out[field] === undefined) continue
    let rows = lists[kind]
    if (field === 'instanceId') rows = rows.filter(r => r.actorId === out.actorId && r.target === out.target && r.itemId === out.itemId)
    out[field] = resolve(rows, out[field], kind, references).id
  }
  return out
}

export function prepareManagementActions(s, actions, references = null) {
  const lists = catalogs(s), resolved = [], labels = [], errors = []
  references ??= referencesOf(lists)
  for (const action of actions) {
    try {
      const out = resolveManagementAction(s, action, references, lists)
      resolved.push(out); labels.push(actionLabel(out, s)); errors.push(null)
    } catch (error) {
      resolved.push(structuredClone(action)); labels.push(`${ACTION_LABELS[action.type] ?? '관리 작업'} · 대상 확인 필요`)
      errors.push(String(error.message))
    }
  }
  return { actions: resolved, actionLabels: labels, actionErrors: errors }
}
