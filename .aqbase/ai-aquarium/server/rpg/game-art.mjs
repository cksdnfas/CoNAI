import { createHash } from 'node:crypto'
import { parseDraw, DEFAULT_DRAW } from '../village/draw.mjs'
import { POTIONS } from '../../shared/rpg-systems.mjs'
import { clipProse } from '../../shared/speech.mjs'
import { dataLine } from '../llm-budget.mjs'

/**
 * Game pictures: monsters, guardians, items, potions, skills and floor backdrops. The DM writes what each one looks like
 * (English image tags); the game submits one library generation job per picture with its own service (게임 그림),
 * separate from the residents' drawings. Pictures stay in the library under their own groups; the game keeps hashes.
 */
export const ART_ROOT = 'AI 어항 게임'
export const ART_DAILY = 30
export const ART_QUEUE = 2 // jobs waiting at once; the rest wait their turn so the user's own generations are not crowded out
const TRIES = 2, ASKS = 2, BATCH = 10
const NAI_MODEL = 'nai-diffusion-5-full' // V5: the only family that can return an alpha channel
const SPRITE = { size: [1024, 1024], alpha: true }
// Fixed style per kind keeps every picture in one look; the DM's tags only say what the thing is.
export const ART_KINDS = {
  monster: { ...SPRITE, label: '몬스터', group: '몬스터', style: 'no humans, solo, single creature, full body, centered, fantasy monster, game sprite, clean lineart, cel shading', uc: 'text, watermark, signature, human, 1girl, 1boy, multiple monsters, scenery, frame, border, cropped' },
  boss: { ...SPRITE, label: '수호자', group: '몬스터', style: 'no humans, solo, single creature, full body, centered, imposing boss monster, fantasy, game sprite, clean lineart, cel shading, dramatic', uc: 'text, watermark, signature, human, 1girl, 1boy, multiple monsters, scenery, frame, border, cropped' },
  item: { ...SPRITE, label: '장비', group: '아이템', style: 'no humans, still life, single object, centered, fantasy game item icon, clean lineart, cel shading', uc: 'text, watermark, signature, human, hand, multiple objects, scenery, frame, border, cropped' },
  'life-item': { ...SPRITE, label: '생활 물품', group: '생활', style: 'no humans, single object, centered, fantasy game item icon, clean lineart, cel shading', uc: 'text, watermark, signature, human, hand, scenery, frame, border, cropped' },
  building: { ...SPRITE, label: '마을 시설', group: '시설', style: 'no humans, single building, entire building, orthographic three quarter top down view, south facing entrance, centered, fantasy village game sprite, clean lineart, cel shading', uc: 'text, watermark, signature, people, multiple buildings, scenery, frame, border, cropped' },
  potion: { ...SPRITE, label: '물약', group: '아이템', style: 'no humans, still life, single object, centered, potion bottle, fantasy game item icon, clean lineart, cel shading', uc: 'text, watermark, signature, human, hand, multiple objects, scenery, frame, border, cropped' },
  skill: { ...SPRITE, label: '스킬', group: '스킬', style: 'no humans, centered, fantasy game skill icon, magic emblem, symbolic, glowing effect, clean lineart', uc: 'text, watermark, signature, human, 1girl, 1boy, scenery, frame, border, cropped' },
  zone: { size: [1216, 832], alpha: false, label: '층 풍경', group: '풍경', style: 'no humans, scenery, fantasy dungeon interior, game background art, wide shot', uc: 'text, watermark, signature, people, ui' },
}

export const gameArtOf = settings => ({ ...DEFAULT_DRAW, ...(settings?.gameArt ?? {}) })
export const artOn = settings => gameArtOf(settings).service !== 'off'
export const artDailyOf = settings => Number.isSafeInteger(settings?.assetDaily) ? settings.assetDaily : ART_DAILY
export const parseGameArt = (input, current) => parseDraw(input, current ?? DEFAULT_DRAW)
const dayOf = now => { const d = new Date(now); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` }
export const artToday = (state, now) => state.artDaily?.day === dayOf(now) ? state.artDaily.count : 0

export function artProblem(state) {
  const setting = gameArtOf(state.settings)
  if (setting.service === 'off') return '게임 그림이 꺼져 있어. 길드 설정의 게임 그림에서 NovelAI나 ComfyUI를 골라줘.'
  if (setting.service === 'comfyui' && (!setting.workflowId || !setting.promptField)) return 'ComfyUI 워크플로우와 프롬프트 입력칸을 골라줘.'
  if (state.artIssue) return state.artIssue
  if (setting.service === 'comfyui' && (state.artService?.signature !== JSON.stringify(setting) || !state.artService?.ready)) return state.artService?.reason || 'ComfyUI 워크플로우 사용 가능 여부를 확인해야 해.'
  return ''
}

/** Only existing SDK tools; NovelAI selection is the user's configuration, not an authentication probe. */
export async function checkGameArt(conai, settings) {
  const setting = gameArtOf(settings), signature = JSON.stringify(setting)
  if (setting.service !== 'comfyui') return { signature, ready: setting.service === 'novelai', reason: setting.service === 'off' ? artProblem({ settings }) : '' }
  if (!setting.workflowId || !setting.promptField) return { signature, ready: false, reason: 'ComfyUI 워크플로우와 프롬프트 입력칸을 골라줘.' }
  try {
    const { toolJson } = await import('./answers.mjs')
    const [workflows, routing] = await Promise.all([
      conai.tools.call('list_workflows', { active_only: true }).then(toolJson),
      conai.tools.call('get_generation_routing_options', { workflow_id: setting.workflowId }).then(toolJson),
    ])
    const workflow = workflows.find(w => w.id === setting.workflowId)
    if (!workflow?.input_fields.some(f => f.id === setting.promptField && ['text', 'textarea'].includes(f.type))) throw new Error('워크플로우의 글 입력칸을 찾을 수 없어.')
    if (!routing.auto_servers?.length) throw new Error('이 워크플로우에서 자동 생성할 활성 ComfyUI 서버가 없어.')
    return { signature, ready: true, reason: '' }
  } catch (error) { return { signature, ready: false, reason: `게임 그림 설정을 확인해줘: ${error.message}`.slice(0, 300) } }
}

/** The model's tags, cleaned: comma separated, no weights or brackets, at most 300 characters. */
export function cleanTags(value) {
  if (typeof value !== 'string') return ''
  return clipProse(value.replace(/:\s*-?\d+(?:\.\d+)?/g, ' ').replace(/[{}[\]()<>:|\\]/g, ' ').split(/[,\r\n]+/)
    .map(tag => clipProse(tag.replace(/\s+/g, ' '), 60)).filter(Boolean).join(', '), 300)
}

const entryOf = (state, key) => (state.art ??= {})[key] ??= {}
const skillKey = (actor, skill) => `skill:${actor.id}:${skill.name}`

/** Everything that can have a picture, most visible first, with what the DM wrote and the picture it has. */
export function artSubjects(state) {
  const art = state.art ?? {}, out = []
  const add = (key, kind, name, about, look = art[key]?.look ?? '', hash = art[key]?.hash ?? null) => out.push({ key, kind, name, about, look, hash })
  const open = z => !z.parentId || !!state.zones.find(p => p.id === z.parentId)?.cleared
  const zones = [...state.zones].sort((a, b) => open(b) - open(a) || a.floor - b.floor)
  for (const z of zones) if (z.monster) {
    add(`monster:${z.id}`, 'monster', z.monster.name, `${z.floor}층 「${z.name}」(${z.design?.theme ?? ''})의 일반 몬스터`)
    add(`boss:${z.id}`, 'boss', z.monster.bossName || `${z.monster.name} 수호자`, `${z.floor}층의 수호자. 같은 종족의 우두머리로 더 크고 위압적`)
  }
  const owned = new Set(state.actors.flatMap(a => [...(a.inventory ?? []), ...(a.storage ?? [])].map(i => i.itemId)))
  const items = [...state.items].sort((a, b) => owned.has(b.id) - owned.has(a.id))
  for (const item of items.filter(i => !i.stackable)) add(`item:${item.id}`, 'item', item.name, `${item.rarity} ${({ weapon: '무기', armor: '방어구', accessory: '장신구' })[item.slot] ?? ''} · Lv.${item.level}`)
  for (const [key, def] of Object.entries(POTIONS)) add(`potion:${key}`, 'potion', def.name, key === 'health' ? '체력을 회복하는 붉은 물약' : '마력을 회복하는 푸른 물약')
  for (const actor of state.actors) if (actor.active && actor.calling) for (const skill of actor.calling.skills) add(skillKey(actor, skill), 'skill', skill.name, `${actor.calling.job}의 스킬 · ${skill.effect || skill.kind}`)
  for (const z of zones) add(`zone:${z.id}`, 'zone', z.name, z.design?.theme ?? '', z.visualPrompt || art[`zone:${z.id}`]?.look || '', z.imageHash ?? null)
  for (const b of state.life?.buildings ?? []) add(`building:${b.id}:${b.designRevision}`, 'building', b.name, `${b.role} · ${b.w}×${b.h} · 단계 ${b.level}`)
  for (const i of items.filter(i => i.stackable)) add(`life-item:${i.id}:${i.designRevision}`, 'life-item', i.name, i.description ?? i.category)
  return out
}

/** Store what the DM wrote for one subject. Floors keep it on the zone, where the backdrop always lived. */
export function setLook(state, key, tags) {
  if (!artSubjects(state).some(s => s.key === key)) return false
  const look = cleanTags(tags)
  if (!look) return false
  if (key.startsWith('zone:')) { const zone = state.zones.find(z => z.id === key.slice(5)); if (zone) zone.visualPrompt = look }
  entryOf(state, key).look = look
  return true
}
export function setHash(state, key, hash) {
  if (!artSubjects(state).some(s => s.key === key)) return false
  if (key.startsWith('zone:')) { const zone = state.zones.find(z => z.id === key.slice(5)); if (zone) zone.imageHash = hash }
  entryOf(state, key).hash = hash
}

/** Invalidate superseded work by a new generation identity; retain the old image until replacement succeeds. */
export function queueArtCancellation(state, jobId) {
  if (!Number.isSafeInteger(jobId)) return
  state.artCancellations ??= []
  if (!state.artCancellations.some(a => a.jobId === jobId)) state.artCancellations.push({ jobId, attempts: 0, nextAt: 0 })
}
export function requestArt(state, key, tags, direct = false, force = false) {
  const subject = artSubjects(state).find(s => s.key === key)
  if (!subject) throw new Error('그림 대상을 찾을 수 없어.')
  const same = tags === undefined || cleanTags(tags) === subject.look
  if (!force && same && subject.hash && !state.art?.[key]?.requested) return false
  if (tags !== undefined && !setLook(state, key, tags)) throw new Error('겉모습 영어 태그를 써줘.')
  const entry = entryOf(state, key)
  if (!force && same && state.assets.some(a => (a.key ?? `zone:${a.zoneId}`) === key)) {
    if (direct) { entry.direct = true; for (const a of state.assets) if ((a.key ?? `zone:${a.zoneId}`) === key) a.direct = true }
    return false
  }
  entry.generation = (entry.generation ?? 0) + 1
  entry.tries = 0; entry.asked = 0; entry.requested = true; entry.direct = direct
  state.assets = state.assets.filter(a => {
    if ((a.key ?? `zone:${a.zoneId}`) !== key) return true
    queueArtCancellation(state, a.jobId); return false
  })
  return true
}
/** Ready pictures for the page: { key: hash }. */
export function artHashes(state) {
  return Object.fromEntries(Object.entries(state.art ?? {}).filter(([key, e]) => e.hash && !key.startsWith('zone:')).map(([key, e]) => [key, e.hash]))
}

/** submit_generation_job arguments for one picture. */
export function artJob(gameArt, subject, attempt = 0) {
  const kind = ART_KINDS[subject.kind], prompt = `${kind.style}, ${subject.look}`
  const common = { group_path: `${ART_ROOT}/${kind.group}`, idempotency_key: `rpg-art:${createHash('sha1').update(subject.key).digest('hex').slice(0, 24)}:${attempt}` }
  if (gameArt.service === 'novelai') {
    const [width, height] = kind.size
    return { ...common, service_type: 'novelai', request_payload: { prompt, negative_prompt: kind.uc, model: NAI_MODEL, width, height, n_samples: 1, // One sample per request: multi-sample NovelAI requests cost Anlas.
      ...(kind.alpha ? { transparent_background: true } : {}) } }
  }
  if (gameArt.service === 'comfyui' && gameArt.workflowId && gameArt.promptField) return { ...common, service_type: 'comfyui', workflow_id: gameArt.workflowId, inputs: { [gameArt.promptField]: prompt } }
  return null
}

/** Fill the picture queue up to ART_QUEUE from subjects that have tags but no picture, within today's limit. */
export function queueArt(state, settings, now) {
  if (artProblem(state)) return 0
  const day = dayOf(now)
  if (state.artDaily?.day !== day) state.artDaily = { day, count: 0 }
  state.assets ??= []
  // Skills renamed by a later oracle leave old entries behind; drop them.
  const live = new Set(artSubjects(state).map(s => s.key))
  for (const key of Object.keys(state.art ?? {})) if (/^(skill|building|life-item):/.test(key) && !live.has(key) && !state.assets.some(a => a.key === key)) delete state.art[key]
  let added = 0
  for (const subject of artSubjects(state).sort((a, b) => Number(!!state.art?.[b.key]?.direct) - Number(!!state.art?.[a.key]?.direct))) {
    if (state.assets.length >= ART_QUEUE) break
    const entry = state.art?.[subject.key]
    if (!entry?.direct && state.artDaily.count >= artDailyOf(settings)) continue
    if (!subject.look || (subject.hash && !entry?.requested) || (entry?.tries ?? 0) >= TRIES || state.assets.some(a => (a.key ?? `zone:${a.zoneId}`) === subject.key)) continue
    const input = artJob(gameArtOf(settings), { ...subject, key: `${state.life.epoch}:${subject.key}:${entry?.generation ?? 0}` }, entry?.tries ?? 0)
    if (!input) return added
    entryOf(state, subject.key).tries = (entry?.tries ?? 0) + 1
    state.assets.push({ key: subject.key, epoch: state.life.epoch, direct: !!entry?.direct, input, createdAt: now, nextAt: now, jobId: null, historyId: null, attempts: 0 })
    if (!entry?.direct) state.artDaily.count++
    added++
  }
  return added
}

/** Subjects still waiting for the DM to describe them (each asked at most twice). */
export function lookBatch(state, outputTokens = null) {
  return artSubjects(state).filter(s => !s.look && (state.art?.[s.key]?.asked ?? 0) < ASKS)
    .sort((a, b) => Number(!!state.art?.[b.key]?.direct) - Number(!!state.art?.[a.key]?.direct)).slice(0, outputTokens == null ? BATCH : Math.max(1, Math.min(BATCH, Math.floor(outputTokens / 180))))
}
export const LOOKS = { type: 'object', additionalProperties: false, required: ['looks'], properties: { looks: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'tags'], properties: {
  id: { type: 'string', description: '입력 항목의 id 그대로' }, tags: { type: 'string', description: '겉모습을 묘사하는 영어 이미지 태그, 쉼표로 구분' } } } } } }
export function lookInput(subjects) {
  return [
    '너는 이 자율 탐험 던전 게임의 GM이자 아트 디렉터야. 게임에 나오는 모든 것의 겉모습은 네가 정해. 아래 항목마다 이미지 생성 모델에 넣을 영어 태그를 써.',
    'tags: Danbooru식 영어 태그를 쉼표로. 생김새·색·재질·특징만 써. 화풍·품질·배경·구도 태그와 사람은 쓰지 마(게임이 붙여). 몬스터는 종족과 생김새, 수호자는 같은 종족의 더 크고 위압적인 모습, 장비·물약은 물건 자체, 스킬은 그 기술을 상징하는 문양이나 효과, 층 풍경은 장소의 모습을 묘사해. 이름이 한국어여도 뜻과 분위기를 살려서 영어로.',
    dataLine(subjects.map((s, i) => ({ id: String(i + 1), kind: ART_KINDS[s.kind].label, name: s.name, about: s.about }))),
    '출력은 {"looks":[{"id":"1","tags":"..."}]} 형식의 JSON 하나야. 모든 id에 답해.',
  ].join('\n')
}
/** Mark a batch as asked; `keys` travel with the pending request so the answer maps back by position. */
export function askLooks(state, keys) { for (const key of keys) { const e = entryOf(state, key); e.asked = (e.asked ?? 0) + 1 } }
export function applyLooks(state, keys, output) {
  if (!Array.isArray(output?.looks)) throw new Error('그림 설정 답이 비어 있어.')
  const subjects = artSubjects(state)
  let set = keys.filter(key => !subjects.some(s => s.key === key) || subjects.some(s => s.key === key && s.look)).length
  for (const entry of output.looks) {
    const key = keys[Number(entry?.id) - 1]
    if (key && subjects.some(s => s.key === key && !s.look) && setLook(state, key, entry?.tags)) set++
  }
  if (!set) throw new Error('그림 설정에 쓸 태그가 없어.')
  return set
}
