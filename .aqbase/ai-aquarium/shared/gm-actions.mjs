export const ACTION_LABELS = {
  'request-cancel': '교류 요청 취소',
  'status-definition': '상태 정의 편집', 'status-remove': '상태 비활성화', 'status-set': '주민 상태 값', 'relationship-set': '주민 관계',
  'action-definition': '행동 선택지 편집', 'agent-settings': 'AI 행동 설정',
  build: '시설 짓기', upgrade: '시설 증축', 'rename-building': '시설 이름', 'move-building': '시설 이동', 'remove-building': '시설 철거',
  'expand-map': '지도 확장', 'complete-construction': '즉시 완공', 'cancel-construction': '공사 취소', npc: 'NPC 편집',
  'resident-gold': '주민 골드', 'create-item': '물품 만들기', 'edit-item': '물품 편집', 'give-item': '물품 지급', 'take-item': '물품 회수',
  'create-quest': '길드 의뢰 등록', 'cancel-quest': '길드 의뢰 취소', 'design-floor': '다음 층 설계', 'edit-floor': '층 편집', redraw: '그림 다시 그리기',
}
export const ART_ACTIONS = ['create-item', 'design-floor', 'edit-floor', 'edit-item', 'redraw', 'build', 'upgrade']
export const displayText = value => String(value ?? '').replace(/(?:building-|life-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '대상')
/** Shared by the prompt memory, proposal preview and execution receipt. Never include raw model JSON. */
export function actionLabel(a, state = {}) {
  if (!a || typeof a !== 'object') return '잘못된 관리 작업'
  const text = value => displayText(value).slice(0, 60)
  const name = (list, id) => text(list?.find(x => (x.id ?? x.key) === id)?.name ?? list?.find(x => x.id === id)?.title ?? (id ? '대상 없음' : ''))
  const items = state.items ?? [...(state.life?.items ?? []), ...(state.actors ?? []).flatMap(a => a.inventory ?? [])]
  const building = name(state.life?.buildings, a.buildingId), actor = name(state.actors, a.actorId), item = name(items, a.itemId)
  const floor = name(state.zones, a.zoneId ?? a.parentId), target = a.target === 'storage' ? '창고' : '가방'
  const kinds = { merchant: '잡화점', guild: '모험가 길드', workshop: '공방', tea: '찻집', home: '주택', warehouse: '창고' }
  const position = a.x === undefined ? `${a.near ? `${text(a.near)} 근처 ` : ''}빈 부지 자동 선택` : `(${text(a.x)}, ${text(a.y)})`
  const gold = a.add !== undefined ? `${a.add >= 0 ? '+' : ''}${text(a.add)}G 증감` : a.set !== undefined || a.gold !== undefined ? `잔액 ${text(a.set ?? a.gold)}G로 지정` : ''
  const construction = state.life?.constructions?.find(c => c.id === a.constructionId)
  const constructionName = construction ? `${kinds[construction.kind] ?? '지도 확장'} 공사${construction.site?.x !== undefined ? ` (${construction.site.x}, ${construction.site.y})` : ''}` : '공사 대상 없음'
  const details = {
    'request-cancel': text(state.socialRequests?.find(q => q.id === a.requestId)?.action?.label ?? '대기 교류'),
    'status-definition': text(a.definition?.name ?? a.definition?.id), 'status-remove': text(a.statusId),
    'status-set': `${actor} · ${text(a.statusId)} → ${text(a.value)}`, 'relationship-set': `${actor} · ${name(state.actors, a.targetActorId)} · ${text(a.label)} ${text(a.affinity)}`,
    'action-definition': text(a.definition?.label ?? a.definition?.id), 'agent-settings': '주민 자신의 프로필 판단·행동 한도',
    build: `${kinds[a.kind] ?? text(a.kind)} · ${position}`,
    upgrade: `${building} · ${a.level ?? '다음'}단계`, 'rename-building': `${building} → ${text(a.name)}`,
    'move-building': `${building} → ${position}`, 'remove-building': building,
    'expand-map': a.direction === 'east' ? '동쪽 8칸' : '남쪽 8칸',
    'complete-construction': constructionName, 'cancel-construction': constructionName,
    npc: [name(state.life?.npcs, a.npcId), gold, a.buildingId && `직장 ${building}`, a.itemId && `${item} 재고 ${text(a.quantity)}개`].filter(Boolean).join(' · '),
    'resident-gold': `${actor} · ${gold}`,
    'create-item': `${text(a.name)} (${text(a.template)})${a.actorId ? ` → ${actor} ${target} ${a.quantity ?? 1}개` : ''}`,
    'edit-item': `${item}${a.name ? ` → ${text(a.name)}` : ''}${a.description !== undefined ? ' · 설명' : ''}${a.look !== undefined ? ' · 외형' : ''}`,
    'give-item': `${actor} ${target} · ${item} ${text(a.quantity)}개`, 'take-item': `${actor} ${target} · ${item} ${text(a.quantity)}개`,
    'create-quest': `${text(a.title)} · ${floor} · 목표 ${text(a.count)}`, 'cancel-quest': name(state.quests, a.questId),
    'design-floor': `${floor} 다음 · ${text(a.design?.name)}`,
    'edit-floor': [floor, a.name && `이름 ${text(a.name)}`, a.theme && '테마', a.monster && `몬스터 ${text(a.monster)}`, a.boss && `수호자 ${text(a.boss)}`, (a.itemId || a.itemName) && `전리품 ${text(a.itemName) || item}`, ['monsterLook', 'bossLook', 'itemLook', 'sceneryLook'].some(k => a[k] !== undefined) && '외형'].filter(Boolean).join(' · '),
    redraw: text(state.artSubjects?.find(s => s.key === a.key)?.name) || name([...(state.zones ?? []), ...(state.life?.buildings ?? []), ...items, ...(state.actors ?? [])], String(a.key ?? '').split(':')[1]) || text(a.key),
  }
  return `${ACTION_LABELS[a.type] ?? '알 수 없는 작업'} · ${details[a.type] ?? text(a.type)}`.slice(0, 240)
}
