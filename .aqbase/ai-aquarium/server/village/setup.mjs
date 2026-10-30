import { randomUUID } from 'node:crypto'
import { resultJson, busyError } from '../rpg/answers.mjs'
import { cleanTags, artProblem } from '../rpg/game-art.mjs'
import { MANAGEMENT, managementContext, actionLabel } from '../rpg/management.mjs'
import { managementReferences, prepareManagementActions } from '../rpg/targets.mjs'
import { ART_ACTIONS, displayText } from '../../shared/gm-actions.mjs'
import { parseEntry } from '../memory/lore.mjs'
import { line, dmKey } from '../memory/memory.mjs'
import { DEFAULT_SETTINGS, replyLengthOf, replyTimeoutMs, replyTimeoutMessage, replyExpired } from '../../shared/village-settings.mjs'
import { DAY_LENGTHS, clockOf } from '../../shared/clock.mjs'
import { startBudgeted, resultDiagnostic, dataLine } from '../llm-budget.mjs'
import { clipProse } from '../../shared/speech.mjs'
import { llmErrorText, PAYLOAD_LOST } from '../llm-errors.mjs'

/**
 * Setting up a world with a DM: the player talks with a chosen profile, which answers in its own voice and, with every
 * line, the world agreed so far (name, village scene, world-book entries, the first dungeon floor). The draft collects on
 * the page's card; nothing is saved to the village until the player presses 시작. The conversation lives on the slot.
 */
export const LORE_MAX = 10
const CONTENT_MAX = 2000, KEEP = 60
const POLL_MS = 1_500
const DEFAULT_SLOT = /^(?:첫 번째 마을|마을 \d+)$/

const text = (value, max) => clipProse(typeof value === 'string' ? value.replace(/\s+/g, ' ') : '', max)
const TAGS = { type: 'string', description: 'Danbooru식 영어 이미지 태그 6~16개, 쉼표로. 생김새·색·재질만' }
export const SETUP_ANSWER = { type: 'object', additionalProperties: false, required: ['say', 'title', 'scene', 'lore', 'removeLore', 'adventure'], properties: {
  say: { type: 'string', description: '플레이어에게 하는 GM의 말. 질문은 한 번에 한두 개' },
  title: { type: 'string', description: '세계(마을) 이름 30자 이내. 아직 없으면 빈 문자열' },
  scene: { type: 'string', description: '주민들이 지금 놓인 마을 상황 1~3문장. 아직 없으면 빈 문자열' },
  lore: { type: 'array', description: '이번에 새로 정했거나 고친 세계관 항목만. 그대로인 항목은 쓰지 마', items: { type: 'object', additionalProperties: false, required: ['title', 'content', 'keys', 'constant'], properties: {
    title: { type: 'string' }, content: { type: 'string', description: `${CONTENT_MAX}자 이내` }, keys: { type: 'array', items: { type: 'string' }, description: '이 항목을 불러올 키워드' },
    constant: { type: 'boolean', description: '세계 전체의 기본 규칙이라 항상 알아야 하면 true' } } } },
  removeLore: { type: 'array', items: { type: 'string' }, description: '없애기로 한 세계관 항목의 제목' },
  adventure: { type: 'object', additionalProperties: false, required: ['enabled', 'floorName', 'theme', 'monster', 'monsterLook', 'bossLook', 'sceneryLook'], properties: {
    enabled: { type: 'boolean', description: '마을 근처 던전 모험을 쓰는지' }, floorName: { type: 'string', description: '첫 층 이름' }, theme: { type: 'string', description: '첫 층 테마' },
    monster: { type: 'string', description: '첫 층 일반 몬스터 이름' }, monsterLook: TAGS, bossLook: { ...TAGS, description: '같은 종족 우두머리의 겉모습 영어 태그' }, sceneryLook: { ...TAGS, description: '첫 층 풍경 영어 태그' } } },
} }

/** World-book entries the setup may hold: valid lore entries, short enough to keep the whole draft in one request. */
function loreOf(list) {
  const out = []
  for (const raw of Array.isArray(list) ? list : []) {
    const title = text(raw?.title, 80), content = clipProse(raw?.content, CONTENT_MAX)
    let keys = [...new Set((Array.isArray(raw?.keys) ? raw.keys : []).map(k => text(k, 100)).filter(Boolean))].slice(0, 20)
    let always = raw?.constant === true
    if (!always && !keys.length) keys = [title]
    try { parseEntry({ title, content, keys, constant: always }) } catch { continue }
    out.push({ title, content, keys, constant: always })
  }
  return out
}
const adventureOf = (raw, before) => ({
  enabled: typeof raw?.enabled === 'boolean' ? raw.enabled : before.enabled,
  floorName: text(raw?.floorName, 40), theme: text(raw?.theme, 100), monster: text(raw?.monster, 40),
  monsterLook: cleanTags(raw?.monsterLook), bossLook: cleanTags(raw?.bossLook), sceneryLook: cleanTags(raw?.sceneryLook),
})
/** The DM's answer folded into the draft: name, scene and adventure are rewritten, lore entries change one by one. */
export function nextDraft(draft, answer) {
  const removed = new Set((Array.isArray(answer?.removeLore) ? answer.removeLore : []).map(t => text(t, 80)))
  const changed = loreOf(answer?.lore), titles = new Set(changed.map(e => e.title))
  const lore = loreOf([...draft.lore.filter(e => !removed.has(e.title) && !titles.has(e.title)), ...changed]).slice(-LORE_MAX)
  return { title: text(answer?.title?.replace?.(/[\\/]/g, ' '), 30) || draft.title, scene: text(answer?.scene, 500) || draft.scene, lore, adventure: adventureOf(answer?.adventure, draft.adventure) }
}
/** What still has to be decided before the world can start. */
export function missingOf(draft) {
  const out = []
  if (!draft.title) out.push('세계 이름')
  if (!draft.scene) out.push('마을 상황')
  if (!draft.lore.length) out.push('세계관 항목')
  if (draft.adventure.enabled && !draft.adventure.theme) out.push('첫 층 테마')
  if (draft.adventure.enabled && !draft.adventure.monster) out.push('첫 층 몬스터')
  return out
}

function prompt(draft, playerLine) {
  const missing = missingOf(draft)
  return [
    '너는 이 작은 AI 마을(어항)의 GM이야. 플레이어와 대화하면서 이 세계의 기본 설정을 함께 만든다. 네 말투와 성격은 그대로 지켜.',
    '- 질문은 한 번에 한두 개. 플레이어가 막연하면 고를 수 있는 예시를 두세 개 제안해.',
    '- 플레이어가 정한 건 존중하고, 비어 있는 부분은 세계에 어울리게 네가 제안해서 채워도 돼. 제안한 건 제안이라고 말해.',
    missing.length
      ? `- 아직 정해야 하는 것: ${missing.join(', ')}. 대화 흐름 안에서 자연스럽게 이쪽으로 이끌어.`
      : '- 필수 설정이 다 찼어. 지금까지 정한 걸 짧게 정리하고, 화면의 "이대로 시작"을 누르면 시작되고 그 뒤에도 언제든 다듬을 수 있다고 알려줘. 더 다듬고 싶어 하면 계속 도와.',
    '- title·scene·adventure는 지금까지 합의한 값을 매번 전부 다시 써. lore에는 이번에 새로 정하거나 고친 항목만, removeLore에는 없애기로 한 항목 제목만.',
    '- lore는 주민 모두가 아는 세계 지식(규칙·지역·세력·역사·마법 등)을 항목별로. scene은 주민들이 지금 놓인 상황.',
    '- adventure는 마을 근처 던전 모험을 쓸지와 첫 층 설정. 이미지 태그는 영어.',
    '지금까지 정한 세계:', dataLine(draft),
    playerLine === null ? '(대화 시작) 플레이어에게 인사하고, 어떤 세계에서 이야기를 시작하고 싶은지 물어봐.' : `플레이어: ${playerLine}`,
  ].join('\n')
}
/**
 * After the world has started the same DM stays in the village: it talks about anything, and when the player wants
 * something changed it attaches one proposal. Nothing changes until the player applies it.
 */
export const LIVE_ANSWER = { type: 'object', additionalProperties: false, required: ['say', 'change'], properties: {
  say: { type: 'string', description: '플레이어에게 하는 GM의 말. 변경은 아직 미적용 제안: 적용하면 ~할게. 완료·지급됐다고 말하지 마.' },
  change: { type: 'object', additionalProperties: false, description: '바꾸자고 제안할 것. 바꿀 게 없으면 모든 칸을 비워(빈 문자열·빈 배열·0·keep)',
    required: ['title', 'scene', 'lore', 'removeLore', 'event', 'nextFloor', 'adventure', 'instructions', 'dayMinutes', 'sleep', 'actions'], properties: {
      actions: MANAGEMENT,
      title: { type: 'string', description: '새 세계 이름, 그대로면 빈 문자열' },
      scene: { type: 'string', description: '새 마을 상황 전체 문장, 그대로면 빈 문자열' },
      lore: SETUP_ANSWER.properties.lore, removeLore: SETUP_ANSWER.properties.removeLore,
      event: { type: 'string', description: '적용하면 일어날 사건을 조건부로 제안. 완료를 단정하지 마. 함께 제안한 관리 작업이 전부 성공할 때만 소식·주민 기억에 기록. 없으면 빈 문자열' },
      nextFloor: { type: 'string', description: '다음에 설계할 던전 층에 대한 플레이어의 바람, 없으면 빈 문자열' },
      adventure: { type: 'string', enum: ['keep', 'on', 'off'], description: '던전 모험 켜기/끄기' },
      instructions: { type: 'array', description: '주민별 어항 전용 지시문을 새로 쓴 것', items: { type: 'object', additionalProperties: false, required: ['name', 'text'], properties: { name: { type: 'string', description: '주민 이름 그대로' }, text: { type: 'string' } } } },
      dayMinutes: { type: 'number', description: `하루 길이(실제 분) ${DAY_LENGTHS.join('/')} 중 하나, 그대로면 0` },
      sleep: { type: 'string', enum: ['keep', 'on', 'off'], description: '밤에 잠자기' },
    } },
} }
/** The action catalog is discoverable by name, but ordinary chat doesn't need
 * all of its field definitions. Include only explicitly mentioned action groups.
 * This is prompt projection, not authorization: apply still resolves every target
 * and validates the canonical management action regardless of this schema. */
export function liveAnswer(playerLine = '') {
  const groups = [
    [/시설|건물|공방|찻집|여관|신전|창고|주택|짓|증축|철거|공사|부지|지도|build|construction|map/i,
      ['build', 'upgrade', 'rename-building', 'move-building', 'remove-building', 'expand-map', 'complete-construction', 'cancel-construction']],
    [/골드|돈|잔액|gold|npc|상인|직장|재고/i, ['resident-gold', 'npc']],
    [/물품|아이템|장비|지급|회수|item|inventory/i, ['create-item', 'edit-item', 'give-item', 'take-item']],
    [/의뢰|퀘스트|quest/i, ['create-quest', 'cancel-quest']],
    [/층|던전|몬스터|수호자|floor|dungeon/i, ['design-floor', 'edit-floor']],
    [/그림|외형|redraw/i, ['redraw']],
    [/상태|status/i, ['status-definition', 'status-remove', 'status-set']],
    [/관계|호감|relationship/i, ['relationship-set']],
    [/행동|판단|한도|agent|action-definition/i, ['action-definition', 'agent-settings']],
    [/교류|요청 취소|request-cancel/i, ['request-cancel']],
  ]
  const types = new Set(groups.filter(([pattern]) => pattern.test(playerLine)).flatMap(([, ids]) => ids))
  for (const definition of MANAGEMENT.items.anyOf) if (playerLine.includes(definition.properties.type.enum[0])) types.add(definition.properties.type.enum[0])
  const chosen = MANAGEMENT.items.anyOf.filter(d => types.has(d.properties.type.enum[0]))
  const actions = { ...MANAGEMENT, items: chosen.length ? { anyOf: chosen } : {
    type: 'object', properties: { type: { type: 'string', enum: MANAGEMENT.items.anyOf.map(d => d.properties.type.enum[0]) } },
    required: ['type'], description: '일반 대화에서는 actions를 비워. 관리 요청이면 해당 작업의 실제 대상과 매개변수를 사용해.',
  } }
  return { ...LIVE_ANSWER, properties: { ...LIVE_ANSWER.properties, change: { ...LIVE_ANSWER.properties.change,
    properties: { ...LIVE_ANSWER.properties.change.properties, actions } } } }
}
const LABELS = { title: '세계 이름', scene: '마을 상황', lore: '세계관', removeLore: '세계관 삭제', event: '사건 서술·기억', nextFloor: '다음 층 바람', adventure: '던전 모험', instructions: '주민 지시문', dayMinutes: '하루 길이', sleep: '밤에 잠자기', actions: '무료 관리 작업' }
/** A proposal in one line, for the DM's memory and the village feed. */
const describe = (change, game) => clipProse(displayText(Object.entries(change).filter(([k]) => !['actionLabels', 'actionErrors'].includes(k)).map(([k, v]) => `${LABELS[k]}(${k === 'lore' ? v.map(e => e.title).join(', ')
  : k === 'actions' ? v.map((a, i) => `${change.actionLabels?.[i] ?? actionLabel(a, game)}${change.actionErrors?.[i] ? `: ${change.actionErrors[i]}` : ''}`).join(', ') : k === 'instructions' ? v.map(i => i.name).join(', ') : Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? '켜기' : '끄기') : clipProse(String(v), 120)})`).join(' / ')), 1800)
export function withArtNotice(said, reason) {
  if (!reason || said.includes('그림은 아직 만들 수 없어:') || said.includes(reason)) return said
  return `${said}\n그림은 아직 만들 수 없어: ${reason} 길드 설정 → 게임 그림을 열어줘.`
}
/** One proposal, cleaned: only real changes stay; null when nothing would change. */
export function proposalOf(raw, world, game = null, references = null) {
  if (raw?.actions !== undefined && (!Array.isArray(raw.actions) || raw.actions.slice(0, 24).some(a => !a || typeof a !== 'object' || Array.isArray(a) || typeof a.type !== 'string'))) throw new Error('관리 작업은 type이 있는 객체 배열이어야 해.')
  const out = {}
  const title = text(raw?.title?.replace?.(/[\\/]/g, ' '), 30), scene = text(raw?.scene, 500)
  if (title) out.title = title
  if (scene && scene !== world.settings.scene) out.scene = scene
  const lore = loreOf(raw?.lore).slice(0, LORE_MAX); if (lore.length) out.lore = lore
  const removeLore = [...new Set((Array.isArray(raw?.removeLore) ? raw.removeLore : []).map(t => text(t, 80)).filter(Boolean))]; if (removeLore.length) out.removeLore = removeLore
  const event = text(raw?.event, 300); if (event) out.event = event
  const nextFloor = text(raw?.nextFloor, 300); if (nextFloor) out.nextFloor = nextFloor
  if (raw?.adventure === 'on' || raw?.adventure === 'off') out.adventure = raw.adventure === 'on'
  const instructions = (Array.isArray(raw?.instructions) ? raw.instructions : []).map(i => ({ name: text(i?.name), text: clipProse(i?.text) }))
  if (instructions.length) out.instructions = instructions
  if (DAY_LENGTHS.includes(raw?.dayMinutes) && raw.dayMinutes !== (world.settings.dayMinutes ?? DEFAULT_SETTINGS.dayMinutes)) out.dayMinutes = raw.dayMinutes
  if (raw?.sleep === 'on' || raw?.sleep === 'off') out.sleep = raw.sleep === 'on'
  if (Array.isArray(raw?.actions) && raw.actions.length) {
    if (game) {
      Object.assign(out, prepareManagementActions(game, raw.actions.slice(0, 24), references))
      out.actions.push(...structuredClone(raw.actions.slice(24)))
      out.actionLabels.push(...raw.actions.slice(24).map(() => '보류 · 다음 차례에 요청해줘'))
    }
    else out.actions = structuredClone(raw.actions)
  }
  return Object.keys(out).length ? out : null
}
/** What the DM knows about the village right now; the player's words come last. */
export function livePrompt(context, playerLine) {
  const instructions = [
    '너는 이 작은 AI 마을(어항)의 GM이야. 플레이어와 편하게 이야기하는 상대이자 이 세계의 이야기꾼이다. 네 말투와 성격은 그대로 지켜.',
    '- 잡담·질문·상담은 그냥 대화로 답해. 마을 소식과 주민 근황은 아래 자료를 근거로, 지어내지 말고.',
    '- 대기 중인 교류를 취소하려면 actions의 request-cancel에 management.pendingRequests의 requestId와 reason을 넣어. 적용 카드 승인 전에는 취소됐다고 말하지 마.',
    '- 상태와 행동도 actions로 제안할 수 있어: status-definition(공용 정의 추가·수정), status-remove(비활성화), status-set(주민 한 명의 값), relationship-set(두 주민 관계), action-definition(분류별 선택지와 제한된 effect), agent-settings(deciders/대화 한도). 상태 정의는 슬롯 공용이지만 값은 주민별이야. 기본 상태의 ID·종류와 프로필에서 온 정의는 바꾸지 마. 판단은 각 주민 자신의 프로필 judge/chat 또는 rules만 사용하며 별도 판단 프로필은 없어. 자유 설명은 실행 코드가 아니야.',
    '- 플레이어가 바꾸고 싶어 하면 change에 실제 실행 작업을 담아 제안해. 아직 적용된 것이 아니야. 플레이어가 적용을 누르면 게임 골드·재료·공공 금고 지출 없이 즉시 실행하며 별도 공사 심사·일일 GM 한도는 없어. 자동 공사·발전·층 설계의 경제와 한도는 그대로야.',
    '- say와 event는 반드시 미적용 제안으로 말해: "적용하면 공방을 지을게", "적용하면 200G를 더 줄게". 적용 전에는 "세워졌어/들어갔어/지급했어/완료했어"라고 말하지 마. event도 성공을 전제하지 않는 조건부 문장으로 써. 함께 제안한 관리 작업이 하나라도 실패하면 사건 소식·주민 기억은 기록하지 않아.',
    '- 골드 지급·회수는 현재 잔액을 계산해 덮어쓰지 말고 add로 증감해. "200 더 줘"는 add:200, "50 빼 줘"는 add:-50. "잔액을 200으로 맞춰"라고 명시한 경우만 set:200. add와 set은 하나만 쓰며 적용 시점 잔액에 반영해 0~10억으로 제한해. AI 주민은 resident-gold의 actorId, 생활 NPC만 npc의 npcId를 써.',
    '- 신축은 자동 부지가 기본이야. 플레이어가 좌표를 직접 말하지 않았으면 x/y를 쓰지 마. "광장 옆"처럼 장소를 말하면 build.near에 geometry.landmarks의 이름(예: 광장)을 넣어. geometry.buildSites는 현재 검증한 빈 부지와 가까운 장소·방향 예시야. 임의 좌표를 추측하지 마.',
    '- actions 도구: 시설 build(좌표 생략은 유효 부지 자동 선택), upgrade(3단계까지), rename-building, move-building, remove-building; expand-map(동/남쪽, 총 3번); complete-construction/cancel-construction; npc(재고 수량·골드·직장); resident-gold; create-item(기존 생활 template만, actorId를 넣으면 즉시 지급), edit-item(이름·설명·외형만), give-item/take-item(가방/개인 창고); create-quest/cancel-quest(미수락 의뢰만); design-floor(지금 다음 층 생성, 입장은 이전 층 공략 후); edit-floor(이름·테마·몬스터/수호자 이름·전리품·외형); redraw(그림 한도 면제, 이미지 서비스 작업은 비동기).',
    '- 대상 참조는 표시 이름 전체를 써도 돼. 주민 actorId:"QA LiteLLM Direct"처럼 이름을 넣거나 이번 문맥의 R1(주민), N1(NPC), B1(시설), I1(물품), F1(층), Q1(의뢰), C1(공사), T1(템플릿), A1(그림)을 그대로 써. 대소문자와 공백은 무시하지만 부분 이름·추측은 허용하지 않아. 같은 이름이 여럿이면 짧은 ID로 지정해. 카드는 실제 대상으로 확인한 뒤 표시돼.',
    '- 부지는 management 자료를 사용해. 새 층은 nextFloor의 능력치 범위·예산을 지켜. 새로 만든 대상의 후속 작업은 다음 대화에서 조회해. 한 번에 앞 24작업을 검토/적용하고 나머지는 다음 차례로 보류해.',
    '- 마지막 여관과 신전은 철거할 수 없어. 이동도 유효한 풀밭·출입구·연결 경로가 있어야 해. 길드 자동 의뢰는 다시 생기므로 취소할 수 없고 사용자 미수락 의뢰만 취소해. 골드는 0~10억이야. GM 카드의 그림 요청은 모두 자동 그림 일일 한도에서 제외돼.',
    '- title/scene/lore/removeLore/event/nextFloor/adventure/instructions/dayMinutes/sleep도 지원해. event는 소식과 기억만 남기며 건물·물품 등 실제 효과가 아니야. nextFloor는 미래 설계 바람만 저장해. 지금 실제로 바꾸려면 actions를 써.',
    '- 임의 코드·새 게임 규칙·새 프로필/NPC 생성·지원하지 않는 지형 편집·층 구조나 기존 전투 능력치 변경은 할 수 없어. 부지/보관 한도, 진행 중인 생산·증축, 장착 장비, 맡은 의뢰 등의 제약은 남아. 불가능한 요청은 못 한다고 분명히 말하고 실제 지원 대안을 제시해. 문장만 쓰고 바뀐다고 약속하지 마.',
    '- 층/몬스터/아이템을 만들거나 외형을 바꿀 때 영어 외형 태그를 채워. management.art.problem이 있으면 그림 생성 완료를 약속하지 마. 설정 경고와 안내 버튼은 서버가 답에 한 번 붙이니 say에 같은 경고를 반복해서 복사하지 마. NovelAI는 설정을 신뢰하고 자동 감지하지 않아. 외부 이미지 서비스 요금은 무료 게임 조작과 별개야.',
    '- 바꿀 게 없으면 change는 전부 비워. 무엇이든 바꾸자고 먼저 강요하지 마.',
    '- lore에는 새로 쓰거나 고칠 항목만, removeLore에는 없앨 항목 제목만.',
  ].join('\n')
  return `${instructions}\n지금 마을:\n${dataLine(context)}\n플레이어: ${playerLine}`
}
const historyOf = messages => messages.map(m => `${m.from === 'dm' ? 'GM' : '플레이어'}: ${m.text}`)
/** Conversations saved before the DM stayed on are in setup mode until their world was started. */
const modeOf = setup => setup.mode ?? (setup.appliedAt ? 'live' : 'setup')

/**
 * The village DM: the guild's DM setting is the one source, the conversation's DM follows it. A guild without a DM yet
 * takes the conversation's. The name is known once the conversation has met that profile.
 */
export function dmOf(rpg, owner, world) {
  const id = rpg.read(owner).settings.dmProfileId ?? world.setup?.dm.id ?? null
  return id ? { id, name: world.setup?.dm.id === id ? world.setup.dm.name : 'GM' } : null
}
/** Whose memory the village keeps: every resident, and the DM under its own key. */
export const memoryKeysOf = (rpg, owner, world) => { const dm = dmOf(rpg, owner, world); return [...world.residents.map(r => r.profileId), ...(dm ? [dmKey(dm.id)] : [])] }

export function createSetup({ conai, store, memory, rpg, slots }) {
  /** The draft a new conversation starts from: what the slot already has. */
  function currentDraft(owner, world) {
    const slot = slots.ofKey(owner), game = rpg.read(owner), first = game.zones[0]
    return {
      title: DEFAULT_SLOT.test(slot.name) ? '' : slot.name,
      scene: world.settings.scene === DEFAULT_SETTINGS.scene ? '' : world.settings.scene,
      lore: loreOf(memory.lore.list(owner, 0).entries.slice(0, LORE_MAX)),
      adventure: { enabled: !!game.settings.enabled, floorName: first?.name ?? '', theme: first?.design.theme ?? '', monster: first?.monster?.name ?? '',
        monsterLook: game.art?.[`monster:${first?.id}`]?.look ?? '', bossLook: game.art?.[`boss:${first?.id}`]?.look ?? '', sceneryLook: first?.visualPrompt ?? '' },
    }
  }
  /** The village as the live DM sees it: settings, world book, residents, recent news and the dungeon. */
  function contextOf(owner, world, playerLine = '') {
    const game = rpg.read(owner), clock = clockOf(world.clock)
    const references = managementReferences(game)
    return {
      world: slots.ofKey(owner).name, time: `${clock.label} · ${clock.day}일째`, awake: !!world.running, scene: world.settings.scene,
      rules: { dayMinutes: world.settings.dayMinutes ?? DEFAULT_SETTINGS.dayMinutes, sleep: world.settings.sleep ?? DEFAULT_SETTINGS.sleep },
      lore: memory.lore.all(owner, 0).map(e => ({ title: e.title, content: e.content, enabled: e.enabled, state: e.state })),
      residents: world.residents.map(r => ({ name: r.name, where: r.destination, asleep: !!r.asleep, away: !!r.away, instructions: r.instructions ?? '' })),
      recent: store.history(owner).reverse().map(e => e.kind === 'say' ? `${e.name} → ${e.recipient}: ${e.text}` : `${e.kind === 'dm' ? 'GM: ' : ''}${e.text}`),
      adventure: game.settings.enabled ? { floors: game.zones.map(z => `${z.floor}층 ${z.name}${z.cleared ? '(공략)' : ''}`), adventurers: game.actors.filter(a => a.active && a.role === 'adventurer').map(a => `${a.name} Lv.${a.level} ${a.phase}`), nextFloorWish: game.dmWish || '' } : null,
      management: managementContext(game, playerLine, references),
      references,
    }
  }
  const message = (from, value, now, extra = {}) => ({ id: randomUUID(), from, text: value, at: now, ...extra })

  /** Starts the DM's next line; `playerLine` null opens the conversation. */
  async function turn(owner, world, playerLine, now) {
    const setup = world.setup, requestId = `setup:${randomUUID()}`, live = modeOf(setup) === 'live'
    if (setup.job) throw new Error('GM이 답을 쓰는 중이야.')
    const timeoutMs = replyTimeoutMs(world.settings)
    setup.job = { requestId, jobId: null, startedAt: now, nextAt: now + POLL_MS, line: playerLine, timeoutMs }; setup.error = null; setup.revision++
    try {
    await rpg.ensureArt(owner, now)
    if (world.setup !== setup || setup.job?.requestId !== requestId) return
    const history = historyOf(playerLine === null ? setup.messages : setup.messages.slice(0, -1))
    const { references, ...context } = live ? contextOf(owner, world, playerLine ?? '') : {}
    if (live) setup.job.references = references
    const input = live
      ? { message: livePrompt(context, playerLine ?? '(GM 창을 열었다) 짧게 인사하고 마을의 지금 모습을 한두 문장으로 전해.'), structuredOutput: liveAnswer(playerLine ?? '') }
      : { message: prompt(setup.draft, playerLine), structuredOutput: SETUP_ANSWER }
    // Like a resident's turn: matching world lore, the DM's own long-term lore and its memory. While the world is being
    // made the conversation itself is the history; afterwards the DM's memory holds the conversation and the village.
    const base = { requestId, profileId: setup.dm.id, mode: 'text', ...input, userName: '플레이어', maxTokens: replyLengthOf(world.settings), useLorebooks: true, timeoutMs }
    const { translation: _, ...request } = memory.decorate(owner, live ? base : { ...base, history }, dmKey(setup.dm.id), { purpose: 'gm', settings: world.settings })
      setup.job.input = request
      const job = await startBudgeted(conai, request, { settings: world.settings, onDiagnostic: d => { setup.budgetDiagnostic = d; store.save(owner, world) } })
      if (setup.job?.requestId === requestId) setup.job.jobId = job.jobId
      else await conai.llm.cancel(job.jobId).catch(() => {})
    } catch (error) {
      if (setup.job?.requestId !== requestId) return
      setup.job = null; setup.revision++
      setup.error = busyError(error) ? 'GM이 다른 답을 쓰는 중이야. 잠시 뒤 다시 보내줘.' : `GM을 부르지 못했어. ${String(error?.message ?? '').slice(0, 160)}`
    }
  }

  /** Picks the DM. A village that already has residents talks with it as the live DM, a new one sets up its world first. */
  async function open(owner, world, dmProfileId, now) {
    const profile = (await conai.llm.profiles()).find(p => p.id === dmProfileId)
    if (!profile) throw new Error('GM으로 쓸 수 있는 프로필을 골라줘.')
    if (world.setup?.dm.id === dmProfileId) { rpg.setDm(owner, dmProfileId); return }
    meet(owner, world, profile)
    rpg.setDm(owner, profile.id)
    await cancel(world)
    await turn(owner, world, null, now)
  }
  /** A new DM starts its own conversation; the draft of the world stays. */
  function meet(owner, world, profile) {
    const mode = world.setup ? modeOf(world.setup) : world.residents.length ? 'live' : 'setup'
    world.setup = { dm: { id: profile.id, name: profile.name }, mode, messages: [], draft: world.setup?.draft ?? currentDraft(owner, world), job: null, error: null, revision: (world.setup?.revision ?? 0) + 1, appliedAt: world.setup?.appliedAt ?? null }
  }
  /**
   * Keeps the conversation's DM the village DM after the guild settings changed it (or a save from before both were one
   * thing). Returns true when the conversation changed.
   */
  async function follow(owner, world) {
    const id = rpg.read(owner).settings.dmProfileId
    if (!world.setup) return false
    if (!id) { rpg.setDm(owner, world.setup.dm.id); return false }
    if (world.setup.dm.id === id) return false
    const profile = (await conai.llm.profiles().catch(() => [])).find(p => p.id === id)
    if (!profile) return false
    await cancel(world)
    meet(owner, world, profile)
    return true
  }
  async function say(owner, world, value, now) {
    const setup = world.setup
    if (!setup) throw new Error('GM부터 골라줘.')
    if (setup.job) throw new Error('GM이 답을 쓰는 중이야.')
    const said = typeof value === 'string' ? value.trim() : ''
    if (!said) throw new Error('GM에게 할 말을 써줘.')
    setup.messages = [...setup.messages, message('player', said, now)].slice(-KEEP)
    await turn(owner, world, said, now)
  }
  /** Asks again for the line that failed: the opening, or the player's last words. */
  async function retry(owner, world, now) {
    const setup = world.setup
    if (!setup || setup.job) return
    const last = setup.messages.at(-1)
    if (last?.from === 'dm') return // nothing failed
    await turn(owner, world, last ? last.text : null, now)
  }
  /** Follows the DM's running answer; returns true when the conversation changed. */
  async function poll(owner, world, now) {
    const job = world.setup?.job
    if (!job?.jobId && job?.input?._budget?.payloadLost) {
      world.setup.job = null; world.setup.error = PAYLOAD_LOST; world.setup.revision++
      return true
    }
    if (!job?.jobId || job.nextAt > now) return false
    const fail = reason => { world.setup.job = null; world.setup.error = reason; world.setup.revision++; return true }
    const timeoutMs = job.timeoutMs
    if (replyExpired(job.startedAt, timeoutMs, now)) { await conai.llm.cancel(job.jobId).catch(() => {}); return fail(replyTimeoutMessage(timeoutMs, 'GM 답')) }
    let result
    try { result = await conai.llm.get(job.jobId) } catch { return fail('GM 답을 확인하지 못했어. 다시 보내줘.') }
    if (world.setup?.job?.requestId !== job.requestId) return false
    if (['queued', 'running'].includes(result.status)) { job.nextAt = now + POLL_MS; return false }
    if (result.status !== 'completed') return fail(`GM 답이 중단됐어. ${llmErrorText(result.error ?? '')}`.trim())
    world.setup.budgetDiagnostic = resultDiagnostic(conai, result.result, world.setup.budgetDiagnostic)
    let answer
    try { answer = resultJson(result.result) } catch (error) { return fail(`GM 답의 형식이 맞지 않았어. ${error.message} 다시 보내줘.`) }
    try {
    if (!answer || typeof answer !== 'object' || Array.isArray(answer)) throw new Error('답은 객체여야 해.')
    const setup = world.setup
    const game = rpg.read(owner)
    // Older pending turns captured only art aliases; preserve their binding too.
    const references = job.references ?? (job.artKeys ? { ...managementReferences(game), ...Object.fromEntries(job.artKeys.map((key, i) => [`A${i + 1}`, key])) } : null)
    const change = modeOf(setup) === 'live' ? proposalOf(answer.change, world, game, references) : null
    let said = String(answer?.say ?? '').trim() || '…'
    const artRelevant = modeOf(setup) === 'live'
      ? Array.isArray(answer?.change?.actions) && answer.change.actions.some(a => ART_ACTIONS.includes(a?.type))
      : answer?.adventure?.enabled
    const artSetup = artRelevant && artProblem(rpg.read(owner))
    said = withArtNotice(said, artSetup)
    // The exchange goes into the DM's memory once it is complete, the player's words first.
    const remember = text => memory.remember(owner, [dmKey(setup.dm.id)], line(now, 'GM 대화', text), now)
    if (job.line !== null) remember(`플레이어 → 나: "${job.line}"`)
    remember(`나 → 플레이어: "${said}"`)
    if (modeOf(setup) === 'live') {
      if (change) remember(`내가 제안함: ${describe(change, rpg.read(owner))}`)
      setup.messages = [...setup.messages, message('dm', said, now, { ...(artSetup ? { artSetup } : {}), ...(change ? { proposal: { change, status: 'pending' } } : {}) })].slice(-KEEP)
    } else {
      setup.draft = nextDraft(setup.draft, answer)
      setup.messages = [...setup.messages, message('dm', said, now, artSetup ? { artSetup } : {})].slice(-KEEP)
    }
    setup.job = null; setup.error = null; setup.revision++
    return true
    } catch (error) { return fail(`GM 답을 처리하지 못했어. ${String(error.message).slice(0, 160)} 다시 요청해줘.`) }
  }
  async function cancel(world) {
    const jobId = world.setup?.job?.jobId
    if (world.setup?.job) { world.setup.job = null; world.setup.revision++ }
    if (jobId) await conai.llm.cancel(jobId).catch(() => {})
  }
  /** World-book entries saved by title: an existing entry of that title is updated and keeps its state. */
  const putLore = (owner, entries, now) => {
    for (const entry of entries) {
      const current = memory.lore.byTitle(owner, 0, entry.title)
      memory.lore.put(owner, 0, { ...entry, ...(current ? { id: current.id, revision: current.revision, enabled: current.enabled, state: current.state } : {}) }, now, 'dm')
    }
  }
  /** Saves the drafted world into the slot: one transaction for the world book, the slot name, the scene and the guild. */
  function apply(owner, account, world, now) {
    const setup = world.setup
    if (!setup) throw new Error('GM과 먼저 세계관을 정해줘.')
    if (setup.job) throw new Error('GM 답을 기다린 뒤 시작해줘.')
    const missing = missingOf(setup.draft)
    if (missing.length) throw new Error(`아직 정할 게 있어: ${missing.join(', ')}`)
    const d = setup.draft, slot = slots.ofKey(owner)
    let dungeonResult
    conai.db.transaction(() => {
      if (slot.name !== d.title) slots.rename(account, slot.id, d.title)
      putLore(owner, d.lore, now)
      dungeonResult = rpg.setupWorld(owner, setup.dm.id, d.adventure, world.residents)
    })()
    world.settings = { ...world.settings, scene: d.scene }; world.revision++
    setup.appliedAt = now; setup.mode = 'live'; setup.revision++
    setup.messages = [...setup.messages, message('dm', `세계 설정을 적용했어. ${dungeonResult}`, now)].slice(-KEEP)
    memory.remember(owner, [dmKey(setup.dm.id)], line(now, 'GM 대화', `플레이어와 함께 세계 「${d.title}」를 열었어. 마을 상황: ${d.scene}`), now)
  }
  /** Applies one live proposal of the DM; the DM's words about it go to the village feed and, for an event, into every memory. */
  function applyProposal(owner, account, world, messageId, now) {
    const cached = world
    world = structuredClone(world)
    const setup = world.setup, entry = setup?.messages.find(m => m.id === messageId && m.proposal)
    if (!entry || entry.proposal.status !== 'pending') throw new Error('이미 처리했거나 없는 제안이야.')
    if (setup.job) throw new Error('GM 답을 기다린 뒤 적용해줘.')
    rpg.checkpointLife(owner)
    const p = entry.proposal.change ?? {}, slot = slots.ofKey(owner), results = []
    const run = (label, execute) => {
      try {
        const output = conai.db.transaction(execute)()
        results.push({ ok: true, label: displayText(label), text: displayText(output?.repeated ? '이미 실행한 요청이야. 중복 실행하지 않았어.' : output?.text ?? String(output ?? '반영됨')), ...(output?.artSetup ? { artSetup: output.artSetup } : {}) })
      } catch (error) { results.push({ ok: false, label: displayText(label), text: displayText(error.message).slice(0, 400) }) }
    }
    conai.db.transaction(() => {
      if (p.title) run(LABELS.title, () => { if (slot.name !== p.title) slots.rename(account, slot.id, p.title); return p.title })
      for (const lore of p.lore ?? []) run(`${LABELS.lore} · ${lore.title}`, () => { putLore(owner, [lore], now); return lore.content })
      for (const title of p.removeLore ?? []) run(`${LABELS.removeLore} · ${title}`, () => {
        const current = memory.lore.byTitle(owner, 0, title)
        if (!current) throw new Error('지울 세계관 항목을 찾을 수 없어.')
        memory.lore.remove(owner, 0, current.id, current.revision); return '삭제됨'
      })
      if (p.nextFloor) run(LABELS.nextFloor, () => { rpg.setWish(owner, p.nextFloor); return `${p.nextFloor} (바람 저장, 층 생성은 아님)` })
      if (p.adventure !== undefined) run(LABELS.adventure, () => { rpg.setEnabled(owner, p.adventure, world.residents); return p.adventure ? '켜기' : '끄기' })
      if (p.scene) run(LABELS.scene, () => { world.settings = { ...world.settings, scene: p.scene }; world.revision++; return p.scene })
      for (const i of p.instructions ?? []) run(`${LABELS.instructions} · ${i.name}`, () => {
        const r = world.residents.find(r => r.name === i.name)
        if (!r) throw new Error('주민을 찾을 수 없어.')
        r.instructions = i.text; world.revision++; return i.text || '지시문 지움'
      })
      if (p.dayMinutes) run(LABELS.dayMinutes, () => {
        if (!DAY_LENGTHS.includes(p.dayMinutes)) throw new Error('지원하지 않는 하루 길이야.')
        world.settings = { ...world.settings, dayMinutes: p.dayMinutes }; world.revision++; return `${p.dayMinutes}분`
      })
      if (p.sleep !== undefined) run(LABELS.sleep, () => { world.settings = { ...world.settings, sleep: p.sleep }; world.revision++; return p.sleep ? '켜기' : '끄기' })
      const actions = Array.isArray(p.actions) ? p.actions : []
      const actionStart = results.length
      {
        const prepared = prepareManagementActions(rpg.read(owner), actions.slice(0, 24))
        for (const [index, action] of prepared.actions.entries()) run(p.actionLabels?.[index] ?? prepared.actionLabels[index], () => {
          const error = p.actionErrors?.[index] ?? prepared.actionErrors[index]
          if (error) throw new Error(error)
          return rpg.manage(owner, action, `gm:${messageId}:${index}`, now)
        })
      }
      if (actions.length > 24) results.push({ ok: false, skipped: true, deferred: true, label: LABELS.actions, text: `앞 24작업을 처리했어. 나머지 ${actions.length - 24}작업은 보류했으니 다음 차례에 요청해줘.` })
      if (p.event) {
        if (results.slice(actionStart).some(r => !r.ok)) results.push({ ok: false, skipped: true, label: LABELS.event, text: '함께 제안한 관리 작업이 실패해서 사건 소식과 주민 기억은 기록하지 않았어.' })
        else run(LABELS.event, () => {
          const event = displayText(p.event)
          store.record(owner, 'dm', `dm:${randomUUID()}`, setup.dm.id, setup.dm.name, '', event, now)
          memory.remember(owner, world.residents.map(r => r.profileId), line(now, '마을', event), now)
          return `${event} (소식·주민 기억에 기록)`
        })
      }
      if (!results.length) results.push({ ok: false, label: '빈 제안', text: '실행할 변경이 없어. 다시 요청해줘.' })
      const summary = results.map(r => `${r.skipped ? '건너뜀' : r.ok ? '완료' : '실패'} · ${r.label}: ${r.text}`).join('\n')
      store.record(owner, 'dm', `dm:${randomUUID()}`, setup.dm.id, setup.dm.name, '', clipProse(summary, 2000), now)
      memory.remember(owner, [dmKey(setup.dm.id)], line(now, 'GM 적용 결과', summary), now)
      entry.proposal.results = results
      entry.proposal.status = results.every(r => r.ok) ? 'applied' : results.some(r => r.ok) ? 'partial' : 'failed'
      const artSetup = results.find(r => r.artSetup)?.artSetup || (actions.some(a => a?.type === 'redraw') && artProblem(rpg.read(owner)))
      if (artSetup) { entry.proposal.artSetup = artSetup; entry.text = withArtNotice(entry.text, artSetup) }
      setup.revision++
      store.save(owner, world)
    })()
    Object.assign(cached, world)
  }
  function dismiss(owner, world, messageId) {
    const entry = world.setup?.messages.find(m => m.id === messageId && m.proposal)
    if (!entry || entry.proposal.status !== 'pending') throw new Error('이미 처리했거나 없는 제안이야.')
    entry.proposal.status = 'dismissed'; world.setup.revision++
    memory.remember(owner, [dmKey(world.setup.dm.id)], line(Date.now(), 'GM 대화', `플레이어가 내 제안을 거절했어: ${describe(entry.proposal.change, rpg.read(owner))}`), Date.now())
  }
  /** What the page shows: small on every poll (with the DM's last words for the HUD), whole when it asks for the conversation. */
  function brief(world) {
    const s = world.setup
    if (!s) return null
    const last = s.messages.findLast(m => m.from === 'dm')
    return { revision: s.revision, busy: !!s.job, appliedAt: s.appliedAt, dm: s.dm, mode: modeOf(s), budgetDiagnostic: s.budgetDiagnostic ?? null, last: last ? { id: last.id, text: last.text.slice(0, 120), proposal: last.proposal?.status === 'pending' } : null }
  }
  const full = world => world.setup ? { ...brief(world), messages: world.setup.messages, draft: world.setup.draft, missing: missingOf(world.setup.draft), error: world.setup.error, labels: LABELS } : null
  return { open, follow, say, retry, poll, cancel, apply, applyProposal, dismiss, brief, full }
}

