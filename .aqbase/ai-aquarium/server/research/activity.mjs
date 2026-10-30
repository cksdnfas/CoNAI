import { randomUUID } from 'node:crypto'

export const RESEARCH_LIMITS = Object.freeze({ residents: 3, rounds: 3, posts: 8 })
const active = activity => activity?.status === 'running'

/** Normalize only the explicit, published-post research scope. No inferred sources or profiles. */
export function researchInput(body, world) {
  if (typeof body.requestId !== 'string' || !/^[A-Za-z0-9:_-]{8,160}$/.test(body.requestId)) throw new Error('조사 요청 ID가 필요해.')
  if (!Number.isSafeInteger(body.revision) || body.revision !== world.revision) throw new Error('마을이 변경됐어. 새로 확인해줘.')
  const topic = typeof body.topic === 'string' ? body.topic.trim() : ''
  if (!topic || topic.length > 500) throw new Error('조사 주제는 1–500자로 써줘.')
  const ids = (value, min, max, label) => {
    if (!Array.isArray(value) || value.length < min || value.length > max || value.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(value).size !== value.length) throw new Error(`${label} 선택을 확인해줘.`)
    return [...value].sort((a, b) => a - b)
  }
  const postIds = ids(body.postIds, 1, RESEARCH_LIMITS.posts, '자료')
  const profileIds = ids(body.profileIds, 2, RESEARCH_LIMITS.residents, '주민')
  if (profileIds.some(id => !world.residents.some(r => r.profileId === id))) throw new Error('지금 마을의 주민을 골라줘.')
  const rounds = body.rounds ?? 1
  if (!Number.isSafeInteger(rounds) || rounds < 1 || rounds > RESEARCH_LIMITS.rounds) throw new Error('토론 회차는 1–3이야.')
  return { requestId: body.requestId, topic, postIds, profileIds, rounds, budget: researchBudget(body.budget) }
}

/** Call/turn caps older pages, assistants and saves still send: accepted and ignored. */
const LEGACY_BUDGET_KEYS = ['perTurnModelCalls', 'perTurnToolCalls', 'totalModelCalls', 'totalToolCalls']

/**
 * Time limits only. How many tool rounds a resident's turn may take is the app's tool round limit (Settings › 채팅 ›
 * 자원 › 도구 사용), the same for every profile and plugin; the aquarium keeps no call budget of its own.
 */
export function researchBudget(value) {
  const raw = value ?? {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(k => !['timeoutMs', 'totalTimeoutMs', ...LEGACY_BUDGET_KEYS].includes(k))) throw new Error('조사 제한 시간을 확인해줘.')
  const integer = (key, fallback, min, max) => {
    const value = raw[key] ?? fallback
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`조사 제한 시간 ${key}는 ${min}–${max} 정수여야 해.`)
    return value
  }
  return { timeoutMs: integer('timeoutMs', 300000, 1000, 600000), totalTimeoutMs: integer('totalTimeoutMs', 1800000, 1000, 7200000) }
}

/** Persistent identities must be saved before submitting any host job. */
export function beginResearch(input, previous, now = Date.now()) {
  if (previous?.requestId === input.requestId) {
    const normalized = { ...previous.input, budget: researchBudget(previous.input.budget) }
    if (JSON.stringify(normalized) !== JSON.stringify(input)) throw new Error('같은 요청 ID로 조사 내용을 바꿀 수 없어.')
    previous.input = normalized
    return previous
  }
  if (active(previous)) throw new Error('이미 조사 중이야. 먼저 중단해줘.')
  return { activityId: randomUUID(), requestId: input.requestId, input, status: 'running',
    createdAt: now, updatedAt: now, round: 0, jobId: null, sources: [], discussion: [], draft: null, error: null }
}

export function researchResidents(activity) {
  return new Set(active(activity) ? activity.input.profileIds : [])
}

/** Invalidate locally before awaiting cancellation; late results can no longer mutate the activity. */
export function cancelResearch(activity, now = Date.now()) {
  if (!active(activity)) return null
  const jobId = activity.jobId
  activity.status = 'cancelled'
  activity.updatedAt = now
  return jobId
}

export function acceptsResearchResult(activity, activityId, jobId) {
  return active(activity) && activity.activityId === activityId && activity.jobId === jobId
}
