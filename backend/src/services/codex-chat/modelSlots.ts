import { randomUUID } from 'node:crypto'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import { ExternalApiProvider } from '../../models/ExternalApiProvider'
import { RatingScoreModel } from '../../models/RatingScore'
import { ChatProfileError } from './chatProfileError'
import { TYPESAFE_DEFAULT_MODEL } from '../judge/typesafeClient'
import { publishRuntimeEvent } from '../runtime-events/runtimeEventBus'
import { loadPostsSettings } from '../posts/postsSettings'

/**
 * The models of the LLM connections and the representative models (대표모델) that route to them.
 * A connection is a server (address, key, limits); each model row is one model it serves, listed under it in
 * Settings → LLM. A route row names no connection: it points at a model row (`target_slot_id`), so everything that
 * picked the route follows when the route is pointed elsewhere, across connections too. Five routes are built in, one
 * per part (chat, summary, translation, suggestions, judge); they are what each part uses when nothing picked a model,
 * and hold that part's default prompt. More routes can be named freely. Summary and suggestion routes without a target
 * follow the chat model. Chat profiles (per role, and their judge), judge presets, user profiles, chats and workflow
 * nodes reference rows of either kind by id and resolve them at request time. The table and the code keep the older
 * "slot" name; `is_default` / `is_default_judge` mirror the chat and judge routes' targets for older readers.
 */
export type ModelRole = 'chat' | 'summary' | 'translation' | 'suggest'

export const MODEL_ROLES: readonly ModelRole[] = ['chat', 'summary', 'translation', 'suggest']

/** What a profile uses a row for: one of its model roles, or its judge. */
export type ModelUseRole = ModelRole | 'judge'

/** The built-in routes, one per part. */
export type RouteKey = ModelUseRole

export const ROUTE_KEYS: readonly RouteKey[] = ['chat', 'summary', 'translation', 'suggest', 'judge']

const ROUTE_NAMES: Record<RouteKey, string> = { chat: '대화', summary: '요약', translation: '번역', suggest: '답장 추천', judge: '판단' }

/** Built-in routes that, without a target, follow the chat model. */
const FOLLOWS_CHAT: readonly RouteKey[] = ['summary', 'suggest']

/** Connections whose models chat roles can use. */
export const LLM_CONNECTION_TYPES: readonly string[] = ['llm_openai_compatible', 'llm_ollama']
/** Connections that hold models at all: the LLM ones and the TypeSafe decision models (judges only). */
export const MODEL_CONNECTION_TYPES: readonly string[] = [...LLM_CONNECTION_TYPES, 'decision_typesafe']

export type ModelSlot = {
  id: number
  /** `model`: a connection's model; `route`: a representative model pointing at one. */
  kind: 'model' | 'route'
  /** Routes: the connection of the model the route reaches ('' when it reaches none). */
  providerName: string
  /** The connection's display name (its name when it has none or is gone). */
  providerLabel: string
  /** Null when the connection is gone, or a route reaches no model. */
  providerType: string | null
  /** Routes: the model the route reaches ('' when none). */
  model: string
  /** `connection · model`, or `대표 · name` for a route; how pickers name the row. */
  label: string
  /** The built-in chat route: what a chat role with no model of its own uses, and where new profiles start. */
  isDefault: boolean
  /** The built-in judge route: what judges, board evaluations and topic relevance with no model of their own ask. */
  isDefaultJudge: boolean
  sortOrder: number
  /** Routes: the built-in part, null for a named one. */
  routeKey: RouteKey | null
  /** Routes: the name (a built-in route's is its part's). */
  routeName: string | null
  /** Routes: the model row it points at; null for none (summary / suggestions then follow the chat model). */
  targetSlotId: number | null
  /** Routes: no target of its own, so it follows the chat model. */
  followsChat: boolean
  /** Built-in routes: the part's default prompt ('' for the built-in text). */
  prompt: string
  /**
   * The highest rating tier (rating_tiers.id) of media this model may be shown; null: no ceiling. A route: null follows
   * its target's, NO_CEILING (-1) is none. Profiles that follow their model, workflow nodes and vision reviews use it
   * (chatContentRating.ts).
   */
  contentRatingTierId: number | null
  /** Model rows: the routes pointing at it (`key`: the built-in part, null for a named one). */
  routes: Array<{ id: number; name: string; key: RouteKey | null }>
  /** Profiles that reference this row, with what they use it for. */
  profiles: Array<{ id: number; name: string; roles: ModelUseRole[] }>
  /** Judge presets that ask this model (as the judge or as the escalation LLM). */
  judgePresets: Array<{ id: number; name: string }>
  /** User profiles that write reply suggestions with it. */
  userProfiles: number
  /** Chats whose completion reaction uses it. */
  chats: number
  contentEvaluations?: number
  createdDate: string
  updatedDate: string
}

/** The request-time lookup of a row: the model it reaches, and the route it came through. */
export type ModelTarget = { id: number; providerName: string; model: string; label: string; routeId: number | null }

/** The llm_chat_profiles slot column of each role. */
export const ROLE_SLOT_COLUMNS: Record<ModelRole, string> = {
  chat: 'model_slot_id',
  summary: 'summary_slot_id',
  translation: 'translation_slot_id',
  suggest: 'suggest_slot_id',
}

/** A route's own "no ceiling" (null on a route follows its target's). */
export const NO_CEILING = -1

const MODEL_MAX_LENGTH = 200
const ROUTE_NAME_MAX_LENGTH = 40
const ROUTE_PROMPT_MAX_LENGTH = 20000

type SlotRow = {
  id: number
  provider_name: string
  model: string
  is_default: number
  is_default_judge: number
  sort_order: number
  content_rating_tier_id: number | null
  is_route: number
  route_key: string | null
  route_name: string | null
  target_slot_id: number | null
  prompt: string | null
  created_date: string
  updated_date: string
}

type ProfileUseRow = { id: number; name: string; engine: string | null; model_slot_id: number | null; summary_slot_id: number | null; translation_slot_id: number | null; suggest_slot_id: number | null; judge_slot_id: number | null }

type Usage = {
  profiles: Map<number, ModelSlot['profiles']>
  judgePresets: Map<number, ModelSlot['judgePresets']>
  userProfiles: Map<number, number>
  chats: Map<number, number>
  contentEvaluations: Map<number, number>
}

function push<T>(map: Map<number, T[]>, key: number | null, value: T) {
  if (key === null) return
  const list = map.get(key) ?? []
  list.push(value)
  map.set(key, list)
}

function count(map: Map<number, number>, key: number | null) {
  if (key !== null) map.set(key, (map.get(key) ?? 0) + 1)
}

/** Every reference to every row, read once per listing. */
function collectUsage(): Usage {
  const db = getUserSettingsDb()
  const usage: Usage = { profiles: new Map(), judgePresets: new Map(), userProfiles: new Map(), chats: new Map(), contentEvaluations: new Map() }
  const profiles = db.prepare(`
    SELECT id, name, engine, model_slot_id, summary_slot_id, translation_slot_id, suggest_slot_id, judge_slot_id FROM llm_chat_profiles
    WHERE model_slot_id IS NOT NULL OR summary_slot_id IS NOT NULL OR translation_slot_id IS NOT NULL OR suggest_slot_id IS NOT NULL OR judge_slot_id IS NOT NULL
    ORDER BY sort_order ASC, id ASC
  `).all() as ProfileUseRow[]
  for (const profile of profiles) {
    const bySlot = new Map<number, ModelUseRole[]>()
    const add = (slotId: number | null, role: ModelUseRole) => {
      if (slotId !== null) bySlot.set(slotId, [...(bySlot.get(slotId) ?? []), role])
    }
    for (const role of MODEL_ROLES) add(profile[ROLE_SLOT_COLUMNS[role] as keyof ProfileUseRow] as number | null, role)
    add(profile.judge_slot_id, 'judge')
    for (const [slotId, roles] of bySlot) push(usage.profiles, slotId, { id: profile.id, name: profile.name, roles })
  }
  const presets = db.prepare('SELECT id, name, model_slot_id, escalation_slot_id FROM chat_judge_presets ORDER BY name COLLATE NOCASE ASC, id ASC').all() as Array<{ id: number; name: string; model_slot_id: number | null; escalation_slot_id: number | null }>
  for (const preset of presets) {
    push(usage.judgePresets, preset.model_slot_id, { id: preset.id, name: preset.name })
    if (preset.escalation_slot_id !== preset.model_slot_id) push(usage.judgePresets, preset.escalation_slot_id, { id: preset.id, name: preset.name })
  }
  for (const row of db.prepare('SELECT model_slot_id FROM chat_user_profiles WHERE model_slot_id IS NOT NULL').all() as Array<{ model_slot_id: number }>) count(usage.userProfiles, row.model_slot_id)
  for (const row of db.prepare('SELECT reaction_model_slot_id FROM codex_chat_threads WHERE reaction_model_slot_id IS NOT NULL').all() as Array<{ reaction_model_slot_id: number }>) count(usage.chats, row.reaction_model_slot_id)
  for (const row of db.prepare('SELECT model_slot_id FROM content_evaluation_settings WHERE model_slot_id IS NOT NULL').all() as Array<{model_slot_id:number}>) count(usage.contentEvaluations,row.model_slot_id)
  // Board knowledge evaluations keep their judge in the posts settings file.
  count(usage.contentEvaluations, loadPostsSettings().knowledge.judgeSlotId)
  return usage
}

function connectionOf(providerName: string) {
  const provider = ExternalApiProvider.findByName(providerName)
  return { label: provider?.display_name || providerName, type: provider?.provider_type ?? null }
}

function isRouteKey(value: unknown): value is RouteKey {
  return typeof value === 'string' && (ROUTE_KEYS as readonly string[]).includes(value)
}

function routeKeyOf(row: Pick<SlotRow, 'is_route' | 'route_key'>): RouteKey | null {
  return row.is_route === 1 && isRouteKey(row.route_key) ? row.route_key : null
}

function routeNameOf(row: Pick<SlotRow, 'is_route' | 'route_key' | 'route_name'>) {
  const key = routeKeyOf(row)
  return key ? ROUTE_NAMES[key] : row.route_name ?? ''
}

function followsChatRow(row: Pick<SlotRow, 'is_route' | 'route_key' | 'target_slot_id'>) {
  const key = routeKeyOf(row)
  return row.target_slot_id === null && key !== null && FOLLOWS_CHAT.includes(key)
}

/** The built-in route of a part (created by the schema; null only on a database that skipped it). */
function routeRow(key: RouteKey) {
  return getUserSettingsDb().prepare('SELECT * FROM llm_model_slots WHERE is_route = 1 AND route_key = ? ORDER BY id ASC LIMIT 1').get(key) as SlotRow | undefined
}

/** The model row a route reaches: its target, or for summary / suggestions without one, the chat route's. */
function reachedId(row: SlotRow, rows?: Map<number, SlotRow>): number | null {
  if (row.is_route !== 1) return row.id
  const targetId = followsChatRow(row) ? (rows ? [...rows.values()].find((entry) => routeKeyOf(entry) === 'chat') : routeRow('chat'))?.target_slot_id ?? null : row.target_slot_id
  if (targetId === null) return null
  const target = rows ? rows.get(targetId) : getUserSettingsDb().prepare('SELECT * FROM llm_model_slots WHERE id = ?').get(targetId) as SlotRow | undefined
  return target && target.is_route !== 1 ? target.id : null
}

function toSlot(row: SlotRow, rows: Map<number, SlotRow>, usage: Usage, connections: Map<string, { label: string; type: string | null }>): ModelSlot {
  const isRoute = row.is_route === 1
  const reachedRowId = reachedId(row, rows)
  const reached = reachedRowId === null ? null : rows.get(reachedRowId) ?? null
  const providerName = reached?.provider_name ?? ''
  const connection = reached ? connections.get(providerName) ?? connectionOf(providerName) : { label: '', type: null }
  if (reached) connections.set(providerName, connection)
  const key = routeKeyOf(row)
  const name = isRoute ? routeNameOf(row) : null
  return {
    id: row.id,
    kind: isRoute ? 'route' : 'model',
    providerName,
    providerLabel: connection.label,
    providerType: connection.type,
    model: reached?.model ?? '',
    label: isRoute ? `대표 · ${name}` : `${connection.label} · ${row.model}`,
    isDefault: key === 'chat',
    isDefaultJudge: key === 'judge',
    sortOrder: row.sort_order,
    routeKey: key,
    routeName: name,
    targetSlotId: isRoute ? row.target_slot_id : null,
    followsChat: followsChatRow(row),
    prompt: key ? row.prompt ?? '' : '',
    contentRatingTierId: row.content_rating_tier_id ?? null,
    routes: isRoute ? [] : [...rows.values()].filter((entry) => entry.is_route === 1 && entry.target_slot_id === row.id).map((entry) => ({ id: entry.id, name: routeNameOf(entry), key: routeKeyOf(entry) })),
    profiles: usage.profiles.get(row.id) ?? [],
    judgePresets: usage.judgePresets.get(row.id) ?? [],
    userProfiles: usage.userProfiles.get(row.id) ?? 0,
    chats: usage.chats.get(row.id) ?? 0,
    contentEvaluations: usage.contentEvaluations.get(row.id) ?? 0,
    createdDate: row.created_date,
    updatedDate: row.updated_date,
  }
}

/** Routes that hold a model row in place; the chat route never does, it moves to another LLM row when its row goes. */
function holdingRoutes(slot: { routes?: ModelSlot['routes'] }) {
  return (slot.routes ?? []).filter((route) => route.key !== 'chat')
}

export function isSlotUsed(slot: Pick<ModelSlot, 'isDefaultJudge' | 'profiles' | 'judgePresets' | 'userProfiles' | 'chats' | 'contentEvaluations'> & { routes?: ModelSlot['routes'] }) {
  return slot.isDefaultJudge || holdingRoutes(slot).length > 0 || slot.profiles.length > 0 || slot.judgePresets.length > 0 || slot.userProfiles > 0 || slot.chats > 0 || (slot.contentEvaluations ?? 0) > 0
}

/** "대표모델 대화 · 세라, 미나 · 판단 프리셋 기본 · 사용자 프로필 2" — who holds a row, for refusals. */
function describeUse(slot: ModelSlot) {
  return [
    holdingRoutes(slot).length > 0 ? `대표모델 ${holdingRoutes(slot).map((route) => route.name).join(', ')}` : null,
    slot.profiles.length > 0 ? slot.profiles.map((profile) => profile.name).join(', ') : null,
    slot.judgePresets.length > 0 ? `판단 프리셋 ${slot.judgePresets.map((preset) => preset.name).join(', ')}` : null,
    slot.userProfiles > 0 ? `사용자 프로필 ${slot.userProfiles}` : null,
    slot.chats > 0 ? `채팅 반응 ${slot.chats}` : null,
    (slot.contentEvaluations ?? 0) > 0 ? '콘텐츠 평가' : null,
  ].filter(Boolean).join(' · ')
}

function modelName(value: unknown) {
  const model = typeof value === 'string' ? value.trim() : ''
  if (model.length < 1 || model.length > MODEL_MAX_LENGTH) throw new ChatProfileError('모델 ID를 적어줘. 200자까지 쓸 수 있어.')
  return model
}

/** A saved content rating ceiling: null (none) or an existing rating tier's id. */
export function contentRatingTier(value: unknown): number | null {
  if (value === null || value === '') return null
  const id = Number(value)
  if (!Number.isSafeInteger(id) || !RatingScoreModel.getAllTiers().some((tier) => tier.id === id)) throw new ChatProfileError('허용 등급을 찾을 수 없어. 평가 등급에서 다시 골라줘.')
  return id
}

function modelConnectionName(value: unknown) {
  const name = typeof value === 'string' ? value.trim() : ''
  const provider = name ? ExternalApiProvider.findByName(name) : null
  if (!provider || !MODEL_CONNECTION_TYPES.includes(provider.provider_type)) throw new ChatProfileError('LLM 연결을 찾을 수 없어.')
  return provider.provider_name
}

const LLM_ROW_SQL = `SELECT s.id FROM llm_model_slots s JOIN external_api_providers p ON p.provider_name = s.provider_name
  WHERE s.is_route = 0 AND p.provider_type IN (${LLM_CONNECTION_TYPES.map((type) => `'${type}'`).join(', ')})`

/** Points a built-in route at a row (or none), keeping the older default flags in step. */
function pointRoute(key: RouteKey, targetId: number | null) {
  const db = getUserSettingsDb()
  db.prepare("UPDATE llm_model_slots SET target_slot_id = ?, updated_date = datetime('now') WHERE is_route = 1 AND route_key = ?").run(targetId, key)
  if (key === 'chat') db.prepare('UPDATE llm_model_slots SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END').run(targetId ?? 0)
  if (key === 'judge') db.prepare('UPDATE llm_model_slots SET is_default_judge = CASE WHEN id = ? THEN 1 ELSE 0 END').run(targetId ?? 0)
}

/**
 * Keeps the chat route on an LLM model while any exists: its target when that is still an LLM row, else the first
 * LLM row. Chats fall back to it, so it is never left empty while there is something to point at.
 */
function settleChatRoute() {
  const db = getUserSettingsDb()
  const chat = routeRow('chat')
  if (!chat) return
  if (chat.target_slot_id !== null && db.prepare(`${LLM_ROW_SQL} AND s.id = ?`).get(chat.target_slot_id)) return
  const first = db.prepare(`${LLM_ROW_SQL} ORDER BY s.sort_order ASC, s.id ASC LIMIT 1`).get() as { id: number } | undefined
  pointRoute('chat', first?.id ?? null)
}

function insertRow(providerName: string, model: string) {
  const db = getUserSettingsDb()
  const sortOrder = ((db.prepare('SELECT MAX(sort_order) AS max FROM llm_model_slots WHERE is_route = 0').get() as { max: number | null }).max ?? -1) + 1
  // The name column is a leftover of named slots (unique, not shown); a fresh token keeps it unique.
  const id = Number(db.prepare('INSERT INTO llm_model_slots (name, provider_name, model, sort_order) VALUES (?, ?, ?, ?)').run(randomUUID(), providerName, model, sortOrder).lastInsertRowid)
  settleChatRoute()
  return id
}

function findRowId(providerName: string, model: string) {
  const row = getUserSettingsDb().prepare('SELECT id FROM llm_model_slots WHERE is_route = 0 AND provider_name = ? AND model = ? ORDER BY id ASC LIMIT 1').get(providerName, model) as { id: number } | undefined
  return row?.id ?? null
}

function allRows() {
  const rows = getUserSettingsDb().prepare('SELECT * FROM llm_model_slots').all() as SlotRow[]
  return new Map(rows.map((row) => [row.id, row]))
}

/** Routes first (built-in ones in part order, then named ones), then the models in list order. */
function listOrder(a: SlotRow, b: SlotRow) {
  if (a.is_route !== b.is_route) return b.is_route - a.is_route
  const keyRank = (row: SlotRow) => {
    const key = routeKeyOf(row)
    return key ? ROUTE_KEYS.indexOf(key) : ROUTE_KEYS.length
  }
  return keyRank(a) - keyRank(b) || a.sort_order - b.sort_order || a.id - b.id
}

function plainTarget(row: Pick<SlotRow, 'id' | 'provider_name' | 'model'>, routeId: number | null): ModelTarget {
  return { id: row.id, providerName: row.provider_name, model: row.model, label: `${connectionOf(row.provider_name).label} · ${row.model}`, routeId }
}

function routeName(value: unknown, exceptId: number) {
  const name = typeof value === 'string' ? value.trim() : ''
  if (name.length < 1 || name.length > ROUTE_NAME_MAX_LENGTH) throw new ChatProfileError('대표모델 이름은 1자 이상 40자 이하로 적어줘.')
  const taken = (getUserSettingsDb().prepare('SELECT id, route_key, route_name FROM llm_model_slots WHERE is_route = 1 AND id != ?').all(exceptId) as Array<Pick<SlotRow, 'id' | 'route_key' | 'route_name'>>)
    .some((row) => (isRouteKey(row.route_key) ? ROUTE_NAMES[row.route_key] : row.route_name ?? '').toLowerCase() === name.toLowerCase())
  if (taken) throw new ChatProfileError('같은 이름의 대표모델이 이미 있어.')
  return name
}

/** A route's target: a model row (never another route) on a connection the route's part can use; null when allowed. */
function routeTarget(value: unknown, key: RouteKey | null): number | null {
  if (value === null || value === undefined || value === '') {
    if (key === 'chat' && getUserSettingsDb().prepare(LLM_ROW_SQL).get()) throw new ChatProfileError('대화 대표모델은 비워둘 수 없어.')
    if (key === null) throw new ChatProfileError('대표모델이 가리킬 모델을 골라줘.')
    return null
  }
  const id = Number(value)
  const row = Number.isSafeInteger(id) ? getUserSettingsDb().prepare('SELECT * FROM llm_model_slots WHERE id = ?').get(id) as SlotRow | undefined : undefined
  if (!row) throw new ChatProfileError('모델을 찾을 수 없어.')
  if (row.is_route === 1) throw new ChatProfileError('대표모델은 연결의 모델만 가리킬 수 있어.')
  const type = ExternalApiProvider.findByName(row.provider_name)?.provider_type
  const kinds = key === 'judge' || key === null ? MODEL_CONNECTION_TYPES : LLM_CONNECTION_TYPES
  if (!type || !kinds.includes(type)) throw new ChatProfileError(type === 'decision_typesafe' ? `${key ? ROUTE_NAMES[key] : '이'} 대표모델은 LLM 연결의 모델만 가리킬 수 있어. 판단 모델은 판단 대표모델에만 쓸 수 있어.` : '쓸 수 있는 연결의 모델을 골라줘.')
  return row.id
}

/** A route's ceiling: null follows its target, NO_CEILING is none, else a rating tier. */
function routeRatingTier(value: unknown) {
  return Number(value) === NO_CEILING && value !== null && value !== '' ? NO_CEILING : contentRatingTier(value)
}

function routePrompt(value: unknown) {
  const prompt = typeof value === 'string' ? value.trim() : ''
  if (prompt.length > ROUTE_PROMPT_MAX_LENGTH) throw new ChatProfileError('기본 프롬프트는 20000자까지 쓸 수 있어.')
  return prompt
}

/** Board readiness (topic relevance, evaluations) follows the judge route; a change refreshes it. */
function publishJudgeChange() {
  publishRuntimeEvent({ name: 'posts.changed', topic: 'posts', visibility: 'all', payload: { postId: null, kind: 'post' } })
}

export const ModelSlotStore = {
  /** Routes, then the connections' models. */
  list() {
    const rows = allRows()
    const usage = collectUsage()
    const connections = new Map<string, { label: string; type: string | null }>()
    return [...rows.values()].sort(listOrder).map((row) => toSlot(row, rows, usage, connections))
  },

  find(slotId: number) {
    const rows = allRows()
    const row = rows.get(slotId)
    return row ? toSlot(row, rows, collectUsage(), new Map()) : null
  },

  /** The built-in chat route. */
  findDefault() {
    const id = ModelSlotStore.routeId('chat')
    return id === null ? null : ModelSlotStore.find(id)
  },

  /** The id of a part's built-in route (what new profiles and imported cards store for it). */
  routeId(key: RouteKey): number | null {
    return routeRow(key)?.id ?? null
  },

  /** A part's default prompt ('' when it keeps the built-in text). */
  routePrompt(key: RouteKey): string {
    return routeRow(key)?.prompt?.trim() ?? ''
  },

  /** Whether the row is a summary / suggestion route with no target, which follows whatever the chat role uses. */
  followsChat(slotId: number | null | undefined): boolean {
    if (slotId === null || slotId === undefined) return false
    const row = getUserSettingsDb().prepare('SELECT is_route, route_key, target_slot_id FROM llm_model_slots WHERE id = ?').get(slotId) as Pick<SlotRow, 'is_route' | 'route_key' | 'target_slot_id'> | undefined
    return row ? followsChatRow(row) : false
  },

  /** The connection + model a row reaches, without its usage (the request-time lookup); null when it reaches none. */
  target(slotId: number | null | undefined): ModelTarget | null {
    if (slotId === null || slotId === undefined) return null
    const row = getUserSettingsDb().prepare('SELECT * FROM llm_model_slots WHERE id = ?').get(slotId) as SlotRow | undefined
    if (!row) return null
    if (row.is_route !== 1) return plainTarget(row, null)
    const reachedRowId = reachedId(row)
    const reached = reachedRowId === null ? undefined : getUserSettingsDb().prepare('SELECT id, provider_name, model FROM llm_model_slots WHERE id = ?').get(reachedRowId) as Pick<SlotRow, 'id' | 'provider_name' | 'model'> | undefined
    return reached ? plainTarget(reached, row.id) : null
  },

  /** What the chat route reaches. */
  defaultTarget(): ModelTarget | null {
    return ModelSlotStore.target(ModelSlotStore.routeId('chat'))
  },

  /** What the judge route reaches, or null when it points nowhere. */
  defaultJudgeTarget(): ModelTarget | null {
    return ModelSlotStore.target(ModelSlotStore.routeId('judge'))
  },

  /** A row's content rating ceiling (see ModelSlot.contentRatingTierId); null for no ceiling or no such row. */
  contentRatingTierId(slotId: number | null | undefined): number | null {
    if (slotId === null || slotId === undefined) return null
    const row = getUserSettingsDb().prepare('SELECT * FROM llm_model_slots WHERE id = ?').get(slotId) as SlotRow | undefined
    if (!row) return null
    if (row.content_rating_tier_id === NO_CEILING) return null
    if (row.content_rating_tier_id !== null || row.is_route !== 1) return row.content_rating_tier_id ?? null
    const reachedRowId = reachedId(row)
    return reachedRowId === null ? null : ModelSlotStore.contentRatingTierId(reachedRowId)
  },

  /** The id when that row exists, else null. */
  existing(slotId: unknown): number | null {
    const id = Number(slotId)
    if (slotId === null || slotId === undefined || slotId === '' || !Number.isSafeInteger(id) || id <= 0) return null
    return ModelSlotStore.existingIds([id])[0] ?? null
  },

  /** Batch existence checks for profile lists, without slot usage or route hydration. */
  existingIds(slotIds: number[]): number[] {
    const ids = [...new Set(slotIds.filter((id) => Number.isSafeInteger(id) && id > 0))]
    if (!ids.length) return []
    return (getUserSettingsDb().prepare(`SELECT id FROM llm_model_slots WHERE id IN (${ids.map(() => '?').join(', ')})`).all(...ids) as Array<{ id: number }>).map((row) => row.id)
  },

  /**
   * A row id for a saved field: null for empty, else the row, which must exist and reach a connection of `kinds`
   * (a connection that is gone passes, so a profile saved before it went keeps saving; so does a route reaching no
   * model yet, which counts as unset until it does).
   */
  checked(slotId: unknown, kinds: readonly string[] = LLM_CONNECTION_TYPES): number | null {
    if (slotId === null || slotId === undefined || slotId === '') return null
    const id = ModelSlotStore.existing(slotId)
    if (id === null) throw new ChatProfileError('모델을 찾을 수 없어.')
    const target = ModelSlotStore.target(id)
    const type = target ? ExternalApiProvider.findByName(target.providerName)?.provider_type : undefined
    if (type && !kinds.includes(type)) throw new ChatProfileError(kinds.includes('decision_typesafe') ? '판단에 쓸 수 없는 모델이야.' : '판단 모델은 채팅에 쓸 수 없어. LLM 연결의 모델을 골라줘.')
    return id
  },

  /**
   * The row of a connection's model, created when missing; null when it does not exist and `create` is false.
   * An empty model means the connection's primary model. Callers that still send a connection + model pair (old
   * clients, MCP, card import) land on a row this way.
   */
  ensure(providerName: unknown, model: unknown, options: { create?: boolean } = {}): number | null {
    const connection = modelConnectionName(providerName)
    // A TypeSafe connection with no model of its own asks TypeSafe's default model.
    const fallback = () => primaryModelOf(connection) ?? (ExternalApiProvider.findByName(connection)?.provider_type === 'decision_typesafe' ? TYPESAFE_DEFAULT_MODEL : null)
    const name = typeof model === 'string' && model.trim() ? modelName(model) : fallback()
    if (!name) throw new ChatProfileError('이 연결에 등록된 모델이 없어. 설정 › LLM에서 모델을 먼저 추가해줘.')
    const found = findRowId(connection, name)
    if (found !== null || options.create === false) return found
    return insertRow(connection, name)
  },

  /** Model rows of one connection, in list order. */
  ofConnection(providerName: string) {
    return ModelSlotStore.list().filter((slot) => slot.kind === 'model' && slot.providerName === providerName)
  },

  /**
   * Make a connection's rows exactly `models` (in that order): missing ones are added, the rest removed. A row still in
   * use is never removed; the whole change is refused instead, naming who uses it.
   */
  syncConnection(providerName: unknown, models: unknown) {
    const connection = modelConnectionName(providerName)
    if (!Array.isArray(models)) throw new ChatProfileError('모델 목록이 필요해.')
    const wanted = [...new Set(models.map(modelName))]
    const db = getUserSettingsDb()
    db.transaction(() => {
      const current = ModelSlotStore.ofConnection(connection)
      const blocked = current.filter((slot) => !wanted.includes(slot.model) && isSlotUsed(slot))
      if (blocked.length > 0) {
        throw new ChatProfileError(`쓰는 곳이 있어서 뺄 수 없어: ${blocked.map((slot) => `${slot.model} (${describeUse(slot)})`).join(', ')}`)
      }
      for (const slot of current) {
        if (!wanted.includes(slot.model)) db.prepare('DELETE FROM llm_model_slots WHERE id = ?').run(slot.id)
      }
      for (const model of wanted) {
        if (findRowId(connection, model) === null) insertRow(connection, model)
      }
      // Rows of this connection follow the order of the list, inside the connection's place in the overall order.
      const ids = wanted.map((model) => findRowId(connection, model) as number)
      const orders = (db.prepare(`SELECT sort_order FROM llm_model_slots WHERE id IN (${ids.map(() => '?').join(', ') || 'NULL'}) ORDER BY sort_order ASC`).all(...ids) as Array<{ sort_order: number }>).map((row) => row.sort_order)
      ids.forEach((id, index) => db.prepare('UPDATE llm_model_slots SET sort_order = ? WHERE id = ?').run(orders[index], id))
      settleChatRoute()
    })()
    return ModelSlotStore.ofConnection(connection)
  },

  /** Change a model row's model or content rating ceiling; everything that references the row follows. Null when the row does not exist. */
  update(slotId: number, input: { model?: unknown; isDefault?: unknown; contentRatingTierId?: unknown }) {
    const db = getUserSettingsDb()
    const row = db.prepare('SELECT is_route FROM llm_model_slots WHERE id = ?').get(slotId) as { is_route: number } | undefined
    if (row?.is_route === 1) return ModelSlotStore.updateRoute(slotId, { contentRatingTierId: input.contentRatingTierId })
    const current = ModelSlotStore.target(slotId)
    if (!current) return null
    const model = input.model === undefined ? current.model : modelName(input.model)
    db.transaction(() => {
      const taken = findRowId(current.providerName, model)
      if (taken !== null && taken !== slotId) throw new ChatProfileError('이 연결에 같은 모델이 이미 있어.')
      db.prepare("UPDATE llm_model_slots SET model = ?, updated_date = datetime('now') WHERE id = ?").run(model, slotId)
      if (input.contentRatingTierId !== undefined) {
        db.prepare('UPDATE llm_model_slots SET content_rating_tier_id = ? WHERE id = ?').run(contentRatingTier(input.contentRatingTierId), slotId)
      }
      if (input.isDefault === true) ModelSlotStore.setDefault(slotId)
    })()
    if (model !== current.model) publishJudgeChange()
    return ModelSlotStore.find(slotId)
  },

  /** Points the chat route at a model row (the older "make default"). */
  setDefault(slotId: number) {
    const target = ModelSlotStore.target(slotId)
    if (!target) return null
    const id = ModelSlotStore.routeId('chat')
    if (id === null) return null
    ModelSlotStore.updateRoute(id, { targetSlotId: slotId })
    return ModelSlotStore.find(slotId)
  },

  /** Points the judge route at a model row, or with `on` false clears it when it points there. Null when the row does not exist. */
  setDefaultJudge(slotId: number, on: boolean) {
    const target = ModelSlotStore.target(slotId)
    if (!target) return null
    const judge = routeRow('judge')
    if (!judge) return null
    if (on) ModelSlotStore.updateRoute(judge.id, { targetSlotId: slotId })
    else if (judge.target_slot_id === slotId) ModelSlotStore.updateRoute(judge.id, { targetSlotId: null })
    return ModelSlotStore.find(slotId)
  },

  /** A named route pointing at a model row. */
  createRoute(input: { name?: unknown; targetSlotId?: unknown; contentRatingTierId?: unknown }) {
    const db = getUserSettingsDb()
    const name = routeName(input.name, 0)
    const target = routeTarget(input.targetSlotId, null)
    const tier = input.contentRatingTierId === undefined ? null : routeRatingTier(input.contentRatingTierId)
    const sortOrder = ((db.prepare('SELECT MAX(sort_order) AS max FROM llm_model_slots WHERE is_route = 1').get() as { max: number | null }).max ?? -1) + 1
    const id = Number(db.prepare("INSERT INTO llm_model_slots (name, provider_name, model, sort_order, is_route, route_name, target_slot_id, content_rating_tier_id) VALUES (?, '', '', ?, 1, ?, ?, ?)")
      .run(randomUUID(), sortOrder, name, target, tier).lastInsertRowid)
    return ModelSlotStore.find(id)
  },

  /**
   * Changes a route: its target (everything that picked the route follows), its name (named routes), its part's
   * default prompt (built-in routes) or its own content rating ceiling. Null when the route does not exist.
   */
  updateRoute(routeId: number, input: { name?: unknown; targetSlotId?: unknown; prompt?: unknown; contentRatingTierId?: unknown }) {
    const db = getUserSettingsDb()
    const row = db.prepare('SELECT * FROM llm_model_slots WHERE id = ? AND is_route = 1').get(routeId) as SlotRow | undefined
    if (!row) return null
    const key = routeKeyOf(row)
    db.transaction(() => {
      if (input.name !== undefined && key === null) db.prepare('UPDATE llm_model_slots SET route_name = ? WHERE id = ?').run(routeName(input.name, routeId), routeId)
      if (input.targetSlotId !== undefined) {
        const target = routeTarget(input.targetSlotId, key)
        if (key) pointRoute(key, target)
        else db.prepare('UPDATE llm_model_slots SET target_slot_id = ? WHERE id = ?').run(target, routeId)
      }
      if (input.prompt !== undefined && key !== null) db.prepare('UPDATE llm_model_slots SET prompt = ? WHERE id = ?').run(routePrompt(input.prompt) || null, routeId)
      if (input.contentRatingTierId !== undefined) db.prepare('UPDATE llm_model_slots SET content_rating_tier_id = ? WHERE id = ?').run(routeRatingTier(input.contentRatingTierId), routeId)
      db.prepare("UPDATE llm_model_slots SET updated_date = datetime('now') WHERE id = ?").run(routeId)
    })()
    if (input.targetSlotId !== undefined) publishJudgeChange()
    return ModelSlotStore.find(routeId)
  },

  /**
   * Removes an unused model row or named route (refused while anything references it; built-in routes stay).
   * The chat route moves to the first LLM row left when its model goes.
   */
  delete(slotId: number) {
    const slot = ModelSlotStore.find(slotId)
    if (!slot) return false
    if (slot.routeKey !== null) throw new ChatProfileError('기본 대표모델은 지울 수 없어.')
    if (isSlotUsed(slot)) throw new ChatProfileError(`쓰는 곳이 있어서 지울 수 없어: ${describeUse(slot)}`)
    const db = getUserSettingsDb()
    return db.transaction(() => {
      const deleted = db.prepare('DELETE FROM llm_model_slots WHERE id = ?').run(slotId).changes > 0
      settleChatRoute()
      return deleted
    })()
  },
}

/** A connection's primary model: the chat route's model when it is on this connection, else its first row; null with none. */
export function primaryModelOf(providerName: string): string | null {
  const row = getUserSettingsDb().prepare('SELECT model FROM llm_model_slots WHERE is_route = 0 AND provider_name = ? ORDER BY is_default DESC, sort_order ASC, id ASC LIMIT 1').get(providerName) as { model: string } | undefined
  return row?.model ?? null
}

/** Rows of this connection that something still uses (what blocks deleting the connection), with who uses them. */
export function modelReferencesOfConnection(providerName: string): { models: string[] } {
  return { models: ModelSlotStore.ofConnection(providerName).filter(isSlotUsed).map((slot) => `${slot.model} (${describeUse(slot)})`) }
}

/** Drop a deleted connection's rows (all unused, see modelReferencesOfConnection). */
export function deleteModelsOfConnection(providerName: string) {
  const db = getUserSettingsDb()
  db.transaction(() => {
    db.prepare('DELETE FROM llm_model_slots WHERE is_route = 0 AND provider_name = ?').run(providerName)
    settleChatRoute()
  })()
}

/**
 * A connection saved with a `default_model` key (an API caller, an old client): the model becomes one of its rows
 * and the key is dropped, since a connection no longer holds a model of its own.
 */
export function adoptConnectionDefaultModel(providerName: string) {
  const db = getUserSettingsDb()
  const row = db.prepare('SELECT provider_type, additional_config FROM external_api_providers WHERE provider_name = ?').get(providerName) as { provider_type: string; additional_config: string | null } | undefined
  if (!row?.additional_config || !MODEL_CONNECTION_TYPES.includes(row.provider_type)) return
  let config: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(row.additional_config)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
    config = parsed as Record<string, unknown>
  } catch {
    return
  }
  if (!('default_model' in config) && !('model' in config)) return
  const model = [config.default_model, config.model].find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim()
  db.transaction(() => {
    if (model && findRowId(providerName, model) === null) insertRow(providerName, model)
    const next = { ...config }
    delete next.default_model
    delete next.model
    db.prepare('UPDATE external_api_providers SET additional_config = ?, updated_at = CURRENT_TIMESTAMP WHERE provider_name = ?').run(JSON.stringify(next), providerName)
  })()
}
