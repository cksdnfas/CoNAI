import { hhmm } from '../../shared/schedule.mjs'

export const ROLE = { adventurer: '모험가', guild: '길드 접수원', merchant: '상인', oracle: '신관' }
/** Rule-based NPCs of the life world (no profile, no memory), and what a construction is waiting for. */
export const NPC_ROLE = { merchant: '상인', producer: '생산자', builder: '건축가' }
export const CONSTRUCTION_STATE = { reserved: 'GM 심사 대기', approved: '승인 · 착공 대기', building: '공사 중', completed: '완공', rejected: 'GM 거절 · 환불', cancelled: '취소 · 환불', failed: '중단 · 환불' }
export const COMBAT_AI = { all: '매 턴', boss: '수호자만', off: '끔' }
export const SHIFT_TIMES = Array.from({ length: 48 }, (_, i) => [i * 30, hhmm(i * 30)])
/** The selected adventurer for the assistant: names and numbers, not whole item records or map strings. */
export const briefActor = a => a ? { profileId: a.profileId, name: a.name, role: a.role, level: a.level, rank: a.rank, phase: a.phase, hp: a.hp, mp: a.mp, gold: a.gold, stats: a.stats ?? null, calling: a.calling ?? null, supplies: a.supplies ?? null,
  equipment: Object.fromEntries(Object.entries(a.equipment ?? {}).map(([slot, item]) => [slot, item?.name ?? null])), bag: a.inventory.map(i => i.name), storage: (a.storage ?? []).length,
  expedition: a.expedition ? { zoneId: a.expedition.zoneId, title: a.expedition.title, kills: a.expedition.kills, steps: a.expedition.steps } : null, recentTrips: (a.journal ?? []).slice(-3) } : null
export const SLOT = { weapon: '무기', armor: '방어구', accessory: '장신구' }
export const PHASE = { town: '마을', rest: '휴식', travel: '입장', explore: '탐험', consider: '판단 중', combat: '전투', return: '귀환', dead: '사망' }
// live → broadcast modal, settings → 설정 › 모험; the rest are tabs of one guild window.
export const TABS = { live: '방송', quests: '의뢰', zones: '던전', shop: '상점', actors: '모험가', settings: '모험 설정' }
export const GUILD_TABS = ['quests', 'zones', 'shop', 'actors']
export const QUEST_ICON = { hunt: 'M14.5 17.5L4 7V4h3l10.5 10.5M13 19l6-6M16 16l4 4', clear: 'M4 18h16M5 18l-1-9 5 4 3-7 3 7 5-4-1 9', explore: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14', survey: 'M5 4.5h11a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11', recover: 'M12 3l6 7-6 11-6-11zM6 10h12' }
export const QUEST_UNIT = { hunt: '마리', clear: '마리', explore: '%', survey: '곳', recover: '개' }
export const P = {
  close: 'M6 6l12 12M18 6L6 18', tv: 'M3 8.5A2 2 0 0 1 5 6.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8.5 3l3.5 3.5L15.5 3', guild: 'M14.5 17.5L4 7V4h3l10.5 10.5M13 19l6-6M16 16l4 4',
  plus: 'M12 5v14M5 12h14', crown: 'M4 18h16M5 18l-1-9 5 4 3-7 3 7 5-4-1 9', lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3', eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3z', map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14',
  foe: 'M5 15c0-5 3-9 7-9s7 4 7 9v3H5zM9.5 12v1M14.5 12v1', skull: 'M12 3a8 8 0 0 0-5 14.3V20h10v-2.7A8 8 0 0 0 12 3zM9 13h.01M15 13h.01M10.5 20v-2M13.5 20v-2', chest: 'M4 10h16v9H4zM4 10a8 4 0 0 1 16 0M11 12h2v3h-2z', gem: 'M12 3l6 7-6 11-6-11zM6 10h12',
  door: 'M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M3 21h18M14 12h.01', flag: 'M5 21V4M5 4h11l-2 4 2 4H5', bag: 'M6 8h12l-1 12H7zM9 8V6a3 3 0 0 1 6 0v2', pen: 'M4 20l4-1L19 8l-3-3L5 16zM14 7l3 3', crate: 'M4 8l8-4 8 4v9l-8 4-8-4zM4 8l8 4 8-4M12 12v9', bed: 'M3 18v-8M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5M7 12h.01',
  coin: 'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0zM12 8v8M9.5 10h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4', step: 'M5 19c2 0 3-1.5 3-3s-1-3-3-3M13 13c2 0 3-1.5 3-3s-1-3-3-3M19 6v13',
}
export const parseTool = result => {
  if (result?.status === 'failed' || result?.result?.isError) throw new Error('이미지를 읽을 수 없어.')
  return JSON.parse(result?.result?.content?.find(c => c.type === 'text')?.text ?? '')
}

// Character sheet labels and icons: gear as rarity-coloured slots.
export const RARITY = { 일반: 'common', 고급: 'fine', 희귀: 'rare' }
export const ITEM_ICON = { weapon: 'M14.5 17.5L4 7V4h3l10.5 10.5M13 19l6-6M16 16l4 4', armor: 'M8 3l4 2 4-2 4 3-2 4v10H6V10L4 6zM12 5v15', accessory: 'M18 15a6 6 0 1 1-12 0 6 6 0 0 1 12 0zM9.5 6.5L12 3l2.5 3.5L12 9z' }
export const POTION_ICON = 'M9 3h6M10 3v5l-4.5 7.5A3.5 3.5 0 0 0 8.5 21h7a3.5 3.5 0 0 0 3-5.5L14 8V3M7.5 14h9'
export const STAT_ICON = { attack: 'M14.5 17.5L4 7V4h3l10.5 10.5M13 19l6-6', defense: 'M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z', speed: 'M13 3L5 14h6l-1 7 8-11h-6z', gold: P.coin }
export const STAT = [['attack', '공격'], ['defense', '방어'], ['hp', 'HP']]
export const POTION_TEXT = { health: '최대 HP 45% 회복 · 그 턴 공격 대신', mana: 'MP 12 회복 · 그 턴 공격 대신' }
export const OUTCOME = { death: '사망', completed: '의뢰 완료', returned: '귀환', recalled: '복귀' }
export const INTENT = { attack: '공격', charge: '강공격 준비', strike: '강공격 · 방어 대응', guard: '방어 태세', heal: '자가 회복' }
export const ENTITY = { chest: '보물상자', rest: '쉼터', trap: '함정', relic: '유물', landmark: '지하 기록실' }
export const gearBonus = item => STAT.filter(([key]) => item[key]).map(([key, name]) => `${name} +${item[key]}`).join(' · ') || '능력치 없음'
export const pct = (value, max) => `${max > 0 ? Math.max(0, Math.min(100, value / max * 100)) : 0}%`
export const stamp = at => { const d = new Date(at); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
export const clock = at => { const d = new Date(at); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
export const live = a => !!a.expedition && a.phase !== 'dead'
export const closed = q => ['completed', 'cancelled'].includes(q.status)
