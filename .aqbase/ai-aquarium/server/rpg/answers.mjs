import { CLASSES } from './rules.mjs'
import { SKILL_KINDS } from '../../shared/rpg-systems.mjs'
export { admissionBusy as busyError } from '../llm-errors.mjs'

/** What the adventure asks models for, and how their answers are read. */

export const resultJson = result => {
  if (result?.json && typeof result.json === 'object') return result.json
  try { return JSON.parse(String(result?.text ?? '').replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '')) } catch { throw Object.assign(new Error('AI 응답 형식이 올바르지 않아.'), { category: 'format' }) }
}
export const toolJson = result => {
  if (result?.isError) throw new Error('리소스 작업을 확인하지 못했어.')
  return JSON.parse(result?.content?.find(c => c.type === 'text')?.text ?? '')
}
export const JUDGEMENT = { type: 'object', additionalProperties: false, required: ['action'], properties: { action: { type: 'string', enum: ['continue', 'return'] } } }
export const DECISION = { type: 'object', additionalProperties: false, required: ['action', 'zoneId', 'questId', 'tactic', 'supplyPlan', 'title'], properties: {
  action: { type: 'string', enum: ['hunt', 'rest'], description: '의뢰 토벌과 자유 사냥은 모두 hunt, 휴식만 rest.' },
  zoneId: { type: 'string', description: '후보 지역의 id' }, questId: { type: 'string', description: '후보 의뢰의 id, 자유 사냥이나 휴식은 빈 문자열' },
  tactic: { type: 'string', enum: ['balanced', 'aggressive', 'cautious'] }, supplyPlan: { type: 'string', enum: ['save', 'balanced', 'stock'], description: '절약/일반 보급/충분한 보급' },
  title: { type: 'string', description: '이번 원정을 생방송한다면 붙일 제목. 네 말투로, 휴식이면 빈 문자열' },
} }
export const ORACLE = { type: 'object', additionalProperties: false, required: ['class', 'job', 'skills', 'say'], properties: {
  class: { type: 'string', enum: Object.keys(CLASSES), description: '숨은 전투 계열' }, job: { type: 'string', description: '직업 이름' },
  skills: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'effect', 'kind'], properties: { name: { type: 'string' }, effect: { type: 'string' }, kind: { type: 'string', enum: Object.keys(SKILL_KINDS), description: '전투 효과' } } } },
  say: { type: 'string', description: '신관이 건네는 신탁의 말' },
} }
export const COMBAT = { type: 'object', additionalProperties: false, required: ['action', 'skill', 'say'], properties: {
  action: { type: 'string', enum: ['attack', 'skill', 'guard', 'potion', 'retreat'] },
  skill: { type: 'string', description: 'skill일 때 쓸 스킬 이름, 아니면 빈 문자열' }, say: { type: 'string', description: '이번 턴에 외치는 짧은 한마디, 없으면 빈 문자열' },
} }
const ACTIONS = new Set(COMBAT.properties.action.enum)
export const INTENT = { attack: '평범한 공격', charge: '강공격 준비(다음 턴에 강하게 침)', strike: '지금 강공격', guard: '방어 태세(피해가 크게 줄어듦)', heal: '자가 회복' }
/** Invalid decisions are rejected, never replaced with an attack. */
export function readChoice(json) {
  if (!ACTIONS.has(json?.action)) throw new Error('유효한 전투 행동이 없어. 모델 판단을 기다려.')
  return { action: json.action, skill: typeof json.skill === 'string' ? json.skill : '', say: typeof json.say === 'string' ? json.say : '' }
}
export const CONTENT = {
  name: '다음 층 이름', kind: 'dungeon', theme: '층의 테마', size: 'small 또는 medium 또는 large', layout: 'maze 또는 rooms 또는 loops', enemies: 3,
  bossPattern: 'charge 또는 guard 또는 mend',
  monster: { name: '몬스터 이름', hp: 45, attack: 9, defense: 3, look: '몬스터 겉모습을 묘사하는 영어 이미지 태그' },
  bossLook: '이 층 수호자(같은 종족의 우두머리) 겉모습을 묘사하는 영어 이미지 태그',
  item: { name: '전리품 이름', slot: 'weapon 또는 armor 또는 accessory', attack: 5, defense: 1, hp: 0, look: '전리품 겉모습을 묘사하는 영어 이미지 태그' },
  visualPrompt: '층의 풍경을 묘사하는 영어 이미지 태그',
}
