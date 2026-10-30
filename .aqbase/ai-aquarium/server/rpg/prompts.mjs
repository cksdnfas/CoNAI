import { skillsOf, stats, judgementEstimate } from './rules.mjs'
import { SKILL_KINDS } from '../../shared/rpg-systems.mjs'
import { floorSummary } from './dungeon.mjs'
import { residentDirective } from '../../shared/resident-instructions.mjs'
import { replyLengthOf } from '../../shared/village-settings.mjs'
import { JUDGEMENT, DECISION, ORACLE, COMBAT, INTENT, CONTENT } from './answers.mjs'
import { availableActions, actionContext, residentContext } from '../../shared/agents.mjs'
import { dataLine } from '../llm-budget.mjs'

/** "하린이야" / "리아야": the copula after a name, by its last syllable. */
const isName = name => { const c = String(name).trim().slice(-1).charCodeAt(0) - 0xac00; return `${name}${c >= 0 && c <= 11171 && c % 28 === 0 ? '야' : '이야'}` }
/** Prompt material, kept small: the last three expeditions, skills with their effect, worn gear by name. */
const recentTrips = actor => [...(actor.journal ?? [])].reverse().map(j => ({ floor: j.floor, outcome: j.outcome, reason: j.reason || undefined, kills: j.kills, damage: j.damage }))
const skillLine = actor => skillsOf(actor).map(k => `${k.name}(${k.effect ? `${k.effect} · ` : ''}${SKILL_KINDS[k.kind]})`).join(', ')
const wornGear = (state, actor) => Object.values(actor.equipment).map(id => state.items.find(d => d.id === actor.inventory.find(i => i.id === id)?.itemId)?.name).filter(Boolean).join(', ')

function combatFacts(s, a, st, boss) {
  const e = a.expedition, foe = e.monster, myHit = Math.max(1, st.attack - foe.defense), foeHit = Math.max(1, Math.round(foe.attack - st.defense))
  return { round: e.round + 1, me: { level: a.level, attack: st.attack, defense: st.defense, hp: `${a.hp}/${st.hp}`, mp: `${a.mp}/${st.mp}`, tactic: e.tactic }, potions: { health: a.supplies?.health ?? 0, mana: a.supplies?.mana ?? 0 },
    enemy: { name: foe.name, hp: `${e.foeHp}/${foe.hp}`, attack: foe.attack, defense: foe.defense, boss, next: INTENT[e.intent] ?? INTENT.attack },
    estimate: { myHit, foeHit, roundsToWin: Math.ceil(e.foeHp / myHit), roundsToFall: Math.ceil(a.hp / foeHit) }, lastRound: e.last ? { dealt: e.last.dealt, taken: e.last.taken, healed: e.last.healed || undefined } : null }
}
export function combatInput(s, a, resident, ask, route = { profileId: a.profileId, judge: false, proxy: false }, tokens = replyLengthOf(null), timeoutMs) {
  const e = a.expedition, st = stats(s, a), c = a.calling
  const boss = !!s.zones.find(z => z.id === e.zoneId)?.map?.entities.find(x => x.id === e.encounterId)?.boss
  return { requestId: `rpg-combat:${ask.id}`, profileId: a.profileId, mode: 'text', useLorebooks: true, structuredOutput: { ...COMBAT, properties: { ...COMBAT.properties, action: { type: 'string', enum: availableActions(s, 'combat').map(a => a.id) } } }, maxTokens: tokens,
    timeoutMs,
    message: [residentDirective(resident), `너는 던전에서 싸우고 있는 모험가 ${isName(a.name)}. 이번 턴에 할 행동 하나를 골라.`,
      `${c ? `네 직업: ${c.job}. ` : '아직 신탁을 받지 않았어. '}네 스킬: ${skillLine(a)}`,
      dataLine(combatFacts(s, a, st, boss)),
      dataLine({ resident: residentContext(s, a) }),
      `행동 선택지: ${JSON.stringify(actionContext(availableActions(s, 'combat')))}`,
      'action: attack(기본 공격) / skill(스킬 하나, MP 4) / guard(방어) / potion(명시한 물약 한 개 사용) / flee(출구로 후퇴). estimate는 치명타·스킬을 뺀 대략값이야. skill이면 스킬 이름을 그대로 넣어. say는 원하면 하는 말, 없으면 빈 문자열. JSON만 답해.',
    ].filter(Boolean).join('\n') }
}

/** Mid-dungeon: carry on or head back. `own`: the adventurer answers for itself on the judge model. */
export function judgementInput(s, judging, zone, seen, judge, own, tokens) {
  const e = judging.expedition, st = stats(s, judging)
  return { profileId: judging.profileId, message: [
    `너는 던전에 있는 모험가 ${isName(judging.name)}. 지금 상황을 보고 계속 진행(continue)할지 출구로 귀환(return)할지 네가 정해.`,
    dataLine(residentContext(s, judging)),
    '발견한 정보만 보고 예상 피해·회복약·스킬·귀환 거리를 함께 판단해. 예상 수치는 치명타와 스킬을 뺀 보수적 근사치야. 이전 실패와 비교하고, 수호자라는 이유만으로 반복 귀환하지 마. 치명적인 위험이면 귀환해.',
    dataLine({
      reason: e.question.reason === 'boss' ? '수호자 앞' : '체력 낮음', level: judging.level, hp: `${judging.hp}/${st.hp}`, mp: `${judging.mp}/${st.mp}`,
      attack: st.attack, defense: st.defense, skills: skillLine(judging), potions: judging.supplies, estimate: judgementEstimate(s, judging),
      tactic: e.tactic, floor: zone.floor, steps: e.steps, kills: e.kills,
      foes: zone.map.entities.filter(x => x.kind === 'enemy' && !x.done && seen[x.at] === '1')
        .map(x => ({ name: x.monster.name, hp: x.hp, attack: x.monster.attack, defense: x.monster.defense, boss: !!x.boss })),
      recentTrips: recentTrips(judging), recent: s.logs.filter(l => l.actorId === judging.id).reverse().map(l => l.text),
    }),
    '위 내용은 입력 자료야. 자료를 반복하지 말고 최종 결정 하나만 출력해: {"action":"continue"} 또는 {"action":"return"}. 다른 필드와 설명은 쓰지 마.'].join('\n'), structuredOutput: JUDGEMENT, maxTokens: tokens }
}

/** The DM designs the floor after the one just cleared. */
export function dmInput(s, parent, dm, tokens) {
  const level = Math.min(50, parent.level + 1)
  return { profileId: dm.id, message:
    `너는 자율 탐험 던전의 GM이야. 공략한 층 다음의 ${parent.floor + 1}층을 설계해. kind는 반드시 dungeon. theme에는 층의 테마를 써. ` +
    'size는 small(15x15), medium(19x19), large(23x23) 중 하나. layout은 maze(미로), rooms(방 중심), loops(순환 통로) 중 하나. ' +
    'enemies는 일반 적 3~10마리. bossPattern은 charge(한 턴 예고 후 강공격), guard(주기적 방어), mend(제한된 자가 회복) 중 하나. ' +
    '수호자 1마리는 서버가 HP 1.5배/공격 1.15배로 추가해. 초기 층은 small, 적은 3~4마리를 권장해.\n' +
    `${dataLine({ previousFloor: floorSummary(parent), existingFloors: s.zones.map(z => z.name) })}\n` +
    `새 레벨 ${level}. 몬스터 hp ${15 + level * 8}~${50 + level * 22}, attack ${2 + level * 2}~${7 + level * 5}, defense 0~${2 + level * 3}. ` +
    `hp+attack*4+defense*5 <= ${100 + level * 45}. ` +
    `장비 attack 0~${level * 4 + 2}, defense 0~${level * 3 + 2}, hp 0~${level * 10 + 5}, attack*3+defense*3+hp <= ${18 + level * 14}. ` +
    '사망·후퇴가 잦으면 적 밀도와 공격력을 낮추고, 공략이 쉬우면 구조와 규모를 점진적으로 확장해. ' +
    '게임에 나오는 모든 것의 겉모습은 네가 정해: monster.look·bossLook·item.look은 생김새·색·재질을 묘사하는 영어 Danbooru 태그 6~16개(화풍·배경·사람 태그 없이), ' +
    'visualPrompt는 층 풍경 태그야. ' +
    (s.dmWish ? `플레이어가 다음 층에 바란 것: "${s.dmWish}". 규칙과 예산 안에서 최대한 반영해. ` : '') +
    '지정 JSON만 답해.',
  structuredOutput: CONTENT, maxTokens: tokens }
}

/** The priest gives an adventurer its first calling, or reworks it after a rank-up. */
export function oracleInput(seeker, oracle, residents, tokens) {
  const priest = residents.find(r => r.profileId === oracle.profileId), them = residents.find(r => r.profileId === seeker.profileId), c = seeker.calling
  return { profileId: oracle.profileId, structuredOutput: ORACLE, maxTokens: tokens, message: [residentDirective(priest),
    `너는 마을 신전의 신관 ${isName(oracle.name)}. 모험가 ${seeker.name}가 신탁을 받으러 왔어.`,
    c ? `${seeker.name}는 ${seeker.rank} 랭크로 올랐어. 지금 직업은 「${c.job}」, 스킬은 ${c.skills.map(k => k.name).join(', ')}야. 성장에 맞게 직업을 다듬고 스킬을 강화하거나 새로 더해줘.` : `${seeker.name}의 첫 직업과 스킬을 내려줘.`,
    them?.instructions ? dataLine({ seekerInstructions: them.instructions }) : '',
    '직업과 스킬은 글로만 존재하고 정해진 목록이나 제한이 없어. 이 모험가의 이름, 지금까지의 원정, 어울리는 분위기를 보고 자유롭게 지어줘.',
    dataLine({ name: seeker.name, level: seeker.level, rank: seeker.rank, completed: seeker.completed, deaths: seeker.deaths, recentTrips: recentTrips(seeker) }),
    `class: 숨은 전투 계열 하나. warrior(튼튼함·방어), ranger(빠름·치명타), mage(마력·스킬 피해 25% 더). job: 직업 이름. skills: 이름(name)·설명(effect)·전투 효과(kind)를 네가 선택한 스킬 목록. kind는 반드시 ${Object.entries(SKILL_KINDS).map(([k, v]) => `${k}(${v})`).join(', ')} 중 하나. 이름으로 효과를 추측하거나 누락을 기본 공격으로 대신하지 않아. class와 kind가 빠지거나 유효하지 않으면 기다리고 새 모델 판단을 요청해. say는 신관으로서 건네는 말. JSON만 답해.`,
  ].filter(Boolean).join('\n') }
}

/** An adventurer in town picks its next expedition (or a rest) from the open floors and quests. */
export function decisionInput(s, actor, resident, zones, quests, tokens) {
  return { profileId: actor.profileId, message: [residentDirective(resident),
    '너는 길드의 던전 탐험가야. 개방된 층 안에서 의뢰와 전투 전략을 골라. action은 원정 "hunt", 휴식 "rest" 두 가지야. ' +
    '수호자 공략 의뢰는 미로를 탐험해 수호자를 처치하면 완료돼. 토벌 의뢰는 지정 수만큼 처치해 귀환해. ' +
    '지도 탐사는 지정 탐색률, 기록실 조사는 방 방문, 유물 회수는 지정 개수 회수 후 귀환이 목표야. 사용자 의뢰를 우선 검토해. ' +
    '과거 원정 실패를 참고해 준비를 바꾸고, 후보에서 빠진 층은 재도전 대기 또는 자원 고갈 상태야. ' +
    'supplyPlan은 save(구매 안 함), balanced(보통 보급), stock(충분한 보급) 중 선택해. 자유 탐험은 questId를 빈 문자열로 써. ' +
    'cautious는 방어 보정, balanced는 균형, aggressive는 공격 의도야. 실제 스킬은 매 차례 네가 골라. title은 이번 원정의 제목이야. 네 말투로 써. JSON만 답해.',
    dataLine({
      name: actor.name, level: actor.level, rank: actor.rank, job: actor.calling?.job ?? '신탁 전', hp: actor.hp, mp: actor.mp,
      stats: stats(s, actor), skills: skillLine(actor), gear: wornGear(s, actor), gold: actor.gold, supplies: actor.supplies, recentTrips: recentTrips(actor),
      zones: s.zones.filter(z => zones.some(x => x.id === z.id) || quests.some(q => q.zoneId === z.id))
        .map(z => ({ id: z.id, name: z.name, floor: z.floor, level: z.level, cleared: z.cleared, theme: z.design.theme })),
      quests: quests.map(q => ({ id: q.id, zoneId: q.zoneId, type: q.type ?? 'hunt', title: q.title, note: q.note, count: q.count, progress: q.progress, gold: q.gold, source: q.source })),
    }),
    '출력은 action, zoneId, questId, tactic, supplyPlan, title 여섯 필드의 JSON 한 개야. 입력 자료를 반복하지 마. 사용자 의뢰 후보가 있으면 그중 하나를 선택하거나 rest로 준비해.',
  ].filter(Boolean).join('\n'), structuredOutput: DECISION, maxTokens: tokens }
}
