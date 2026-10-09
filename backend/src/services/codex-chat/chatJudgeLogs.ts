import type { ChatJudgeItemResult, ChatJudgeItemStats, ChatJudgeLogItem, ChatJudgeLogRun, ChatJudgeOutcome, ChatJudgeRunStage } from '@conai/shared'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import { ensureProposalTable } from './chatProposals'

/**
 * The judge log: every judge call (chat_judge_runs: a chat turn's items, a group room's speaker, status fields, an
 * asset) with its answers (chat_judge_items), kept JUDGE_LOG_RETENTION_DAYS. What came of an answer is read back when
 * the log is viewed: whether the reply used the tools a yes kept, what the user did with its lore proposal, whether a
 * follow-up was answered.
 */

export const JUDGE_LOG_RETENTION_DAYS = 30
const PRUNE_INTERVAL_MS = 60 * 60 * 1000
const LIST_LIMIT_MAX = 200
const STATS_RUNS_MAX = 20_000

type RunRow = {
  id: number
  created_at: string
  thread_id: number | null
  profile_id: number | null
  preset_id: number
  stage: ChatJudgeRunStage
  message_id: number | null
  reply_id: string | null
  engine: 'typesafe' | 'llm'
  provider_name: string
  model: string
  latency_ms: number
  tokens: number | null
  error: string | null
  request: string | null
  tools_called: string | null
  follow_up_message_id: number | null
}

type ItemRow = {
  run_id: number
  item_id: string
  name: string
  probability: number | null
  confidence: number | null
  choice: string | null
  verdict: ChatJudgeItemResult['verdict']
  decided_by: ChatJudgeItemResult['decidedBy']
  action: ChatJudgeItemResult['action']
  tools: string | null
}

let lastPrune = 0

function pruneOld() {
  const now = Date.now()
  if (now - lastPrune < PRUNE_INTERVAL_MS) return
  lastPrune = now
  getUserSettingsDb().prepare(`DELETE FROM chat_judge_runs WHERE created_at < datetime('now', ?)`).run(`-${JUDGE_LOG_RETENTION_DAYS} days`)
}

function parseList(value: string | null): string[] | null {
  if (value === null) return null
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : null
  } catch {
    return null
  }
}

/** Whether a tool name matches an item's pattern (a trailing `*` matches a prefix). */
export function judgeToolMatches(pattern: string, name: string) {
  return pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : pattern === name
}

/** One answer as logged: the result plus the tools its item steers. */
export type JudgeLogItem = ChatJudgeItemResult & { tools: string[] }

/**
 * Answers about many things of one kind (each lore entry, past episode, status field) are logged one per thing; the
 * stats count them together under the kind.
 */
const GROUPED_ITEMS: Record<string, string> = { lore: '로어 판단', recall: '회상 판단', field: '상태 필드' }

function statsItemOf(itemId: string, name: string) {
  const kind = /^([a-z]+):/.exec(itemId)?.[1]
  return kind && GROUPED_ITEMS[kind] ? { itemId: kind, name: GROUPED_ITEMS[kind] } : { itemId, name }
}

export type NewJudgeRun = {
  threadId: number | null
  profileId: number | null
  presetId: number
  stage: ChatJudgeRunStage
  messageId: number | null
  replyId: string | null
  engine: 'typesafe' | 'llm'
  providerName: string
  model: string
  latencyMs: number
  tokens?: number | null
  error: string | null
  request: unknown
  items: JudgeLogItem[]
}

export const ChatJudgeLogStore = {
  add(run: NewJudgeRun) {
    const db = getUserSettingsDb()
    pruneOld()
    return db.transaction(() => {
      const result = db.prepare(`INSERT INTO chat_judge_runs (thread_id, profile_id, preset_id, stage, message_id, reply_id, engine, provider_name, model, latency_ms, tokens, error, request)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(run.threadId, run.profileId, run.presetId, run.stage, run.messageId, run.replyId, run.engine, run.providerName, run.model,
        Math.round(run.latencyMs), run.tokens ?? null, run.error, run.request === undefined ? null : JSON.stringify(run.request))
      const runId = Number(result.lastInsertRowid)
      const insert = db.prepare(`INSERT INTO chat_judge_items (run_id, item_id, name, probability, confidence, choice, verdict, decided_by, action, tools) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      for (const item of run.items) insert.run(runId, item.itemId, item.name, item.probability, item.confidence, item.choice, item.verdict, item.decidedBy, item.action, item.tools.length ? JSON.stringify(item.tools) : null)
      return runId
    })()
  },

  /** The tools the steered reply called (once it ends). */
  setToolsCalled(runId: number, tools: string[]) {
    getUserSettingsDb().prepare('UPDATE chat_judge_runs SET tools_called = ? WHERE id = ?').run(JSON.stringify([...new Set(tools)]), runId)
  },

  setFollowUpMessage(runId: number, messageId: number) {
    getUserSettingsDb().prepare('UPDATE chat_judge_runs SET follow_up_message_id = ? WHERE id = ?').run(messageId, runId)
  },

  list(filter: { profileId?: number; presetId?: number; itemId?: string; verdict?: string; stage?: string; threadId?: number; beforeId?: number; limit?: number } = {}): ChatJudgeLogRun[] {
    const db = getUserSettingsDb()
    ensureProposalTable(db)
    const where: string[] = []
    const values: unknown[] = []
    if (filter.profileId) { where.push('r.profile_id = ?'); values.push(filter.profileId) }
    if (filter.presetId) { where.push('r.preset_id = ?'); values.push(filter.presetId) }
    if (filter.threadId) { where.push('r.thread_id = ?'); values.push(filter.threadId) }
    if (filter.stage && /^[a-z]+$/.test(filter.stage)) { where.push('r.stage = ?'); values.push(filter.stage) }
    if (filter.beforeId) { where.push('r.id < ?'); values.push(filter.beforeId) }
    if (filter.itemId || filter.verdict) {
      const conditions = ['i.run_id = r.id']
      // A kind counted together in the stats (lore, recall, field) filters all its answers.
      if (filter.itemId && GROUPED_ITEMS[filter.itemId]) { conditions.push('i.item_id LIKE ?'); values.push(`${filter.itemId}:%`) }
      else if (filter.itemId) { conditions.push('i.item_id = ?'); values.push(filter.itemId) }
      if (filter.verdict === 'failed') conditions.push("i.decided_by = 'fallback'")
      else if (filter.verdict) { conditions.push('i.verdict = ?'); values.push(filter.verdict) }
      where.push(`EXISTS (SELECT 1 FROM chat_judge_items i WHERE ${conditions.join(' AND ')})`)
    }
    const limit = Math.min(LIST_LIMIT_MAX, Math.max(1, filter.limit ?? 50))
    const runs = db.prepare(`SELECT r.*, COALESCE(t.title, '') AS thread_title, COALESCE(p.name, '') AS profile_name, COALESCE(j.name, '') AS preset_name
      FROM chat_judge_runs r
      LEFT JOIN codex_chat_threads t ON t.id = r.thread_id
      LEFT JOIN llm_chat_profiles p ON p.id = r.profile_id
      LEFT JOIN chat_judge_presets j ON j.id = r.preset_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY r.id DESC LIMIT ?`).all(...values, limit) as Array<RunRow & { thread_title: string; profile_name: string; preset_name: string }>
    if (runs.length === 0) return []
    const items = db.prepare(`SELECT * FROM chat_judge_items WHERE run_id IN (${runs.map(() => '?').join(', ')})`).all(...runs.map((run) => run.id)) as ItemRow[]
    const outcomes = outcomeReader()
    return runs.map((run) => {
      let request: unknown = null
      try { request = run.request ? JSON.parse(run.request) : null } catch { request = null }
      return {
        id: run.id,
        createdAt: run.created_at,
        threadId: run.thread_id,
        threadTitle: run.thread_title,
        profileId: run.profile_id,
        profileName: run.profile_name,
        presetId: run.preset_id,
        presetName: run.preset_name,
        stage: run.stage,
        engine: run.engine,
        providerName: run.provider_name,
        model: run.model,
        latencyMs: run.latency_ms,
        error: run.error,
        request,
        items: items.filter((item) => item.run_id === run.id).map((item): ChatJudgeLogItem => ({ ...resultOf(item, run.stage), outcome: outcomes(run, item) })),
      }
    })
  },

  /** Per item over the last `days` days (at most STATS_RUNS_MAX runs), newest preset names first. */
  stats(filter: { profileId?: number; presetId?: number; days?: number } = {}): ChatJudgeItemStats[] {
    const db = getUserSettingsDb()
    ensureProposalTable(db)
    const where = [`r.created_at >= datetime('now', ?)`]
    const values: unknown[] = [`-${Math.min(JUDGE_LOG_RETENTION_DAYS, Math.max(1, filter.days ?? 7))} days`]
    if (filter.profileId) { where.push('r.profile_id = ?'); values.push(filter.profileId) }
    if (filter.presetId) { where.push('r.preset_id = ?'); values.push(filter.presetId) }
    const runs = db.prepare(`SELECT * FROM chat_judge_runs r WHERE ${where.join(' AND ')} ORDER BY r.id DESC LIMIT ${STATS_RUNS_MAX}`).all(...values) as RunRow[]
    if (runs.length === 0) return []
    const byId = new Map(runs.map((run) => [run.id, run]))
    const items = db.prepare(`SELECT i.* FROM chat_judge_items i JOIN chat_judge_runs r ON r.id = i.run_id WHERE ${where.join(' AND ')} ORDER BY i.run_id DESC`).all(...values) as ItemRow[]
    const outcomes = outcomeReader()
    type Tally = ChatJudgeItemStats & { probabilitySum: number; probabilityCount: number; latencySum: number; tokenSum: number; tokenRuns: number; toolOffered: number; toolUsed: number; loreProposed: number; loreSaved: number; followUps: number; answered: number }
    const tallies = new Map<string, Tally>()
    for (const item of items) {
      const run = byId.get(item.run_id)
      if (!run) continue
      const counted = statsItemOf(item.item_id, item.name)
      const key = `${run.preset_id}:${run.stage}:${counted.itemId}`
      let tally = tallies.get(key)
      if (!tally) {
        tally = { presetId: run.preset_id, itemId: counted.itemId, name: counted.name, stage: run.stage, runs: 0, yes: 0, no: 0, uncertain: 0, failed: 0, averageProbability: null, toolUseRate: null, loreSaveRate: null, followUpAnswerRate: null, averageLatencyMs: null, averageTokens: null,
          probabilitySum: 0, probabilityCount: 0, latencySum: 0, tokenSum: 0, tokenRuns: 0, toolOffered: 0, toolUsed: 0, loreProposed: 0, loreSaved: 0, followUps: 0, answered: 0 }
        tallies.set(key, tally)
      }
      tally.runs += 1
      tally.latencySum += run.latency_ms
      if (run.tokens !== null) { tally.tokenSum += run.tokens; tally.tokenRuns += 1 }
      if (item.decided_by === 'fallback') tally.failed += 1
      else tally[item.verdict] += 1
      if (item.probability !== null) { tally.probabilitySum += item.probability; tally.probabilityCount += 1 }
      const outcome = outcomes(run, item)
      if (outcome.toolUsed !== null) { tally.toolOffered += 1; if (outcome.toolUsed) tally.toolUsed += 1 }
      if (outcome.lore === 'proposed' || outcome.lore === 'saved' || outcome.lore === 'dismissed') { tally.loreProposed += 1; if (outcome.lore === 'saved') tally.loreSaved += 1 }
      if (outcome.followUp === 'sent' || outcome.followUp === 'answered') { tally.followUps += 1; if (outcome.followUp === 'answered') tally.answered += 1 }
    }
    const rate = (part: number, whole: number) => (whole > 0 ? part / whole : null)
    return [...tallies.values()].map(({ probabilitySum, probabilityCount, latencySum, tokenSum, tokenRuns, toolOffered, toolUsed, loreProposed, loreSaved, followUps, answered, ...stats }) => ({
      ...stats,
      averageProbability: rate(probabilitySum, probabilityCount),
      averageLatencyMs: rate(latencySum, stats.runs),
      averageTokens: rate(tokenSum, tokenRuns),
      toolUseRate: rate(toolUsed, toolOffered),
      loreSaveRate: rate(loreSaved, loreProposed),
      followUpAnswerRate: rate(answered, followUps),
    }))
  },
}

function resultOf(item: ItemRow, stage: ChatJudgeRunStage): ChatJudgeItemResult {
  return { itemId: item.item_id, name: item.name, stage, probability: item.probability, confidence: item.confidence, choice: item.choice, verdict: item.verdict, decidedBy: item.decided_by, action: item.action }
}

/** Reads what came of an item, with the lookups it needs (lore proposals by reply, the user answering a follow-up). */
function outcomeReader() {
  const db = getUserSettingsDb()
  const loreOf = db.prepare("SELECT saved, dismissed FROM chat_proposals WHERE thread_id = ? AND reply_id = ? AND kind = 'lore' ORDER BY id LIMIT 1")
  const answeredAfter = db.prepare("SELECT 1 FROM codex_chat_messages WHERE thread_id = ? AND role = 'user' AND id > ? LIMIT 1")
  return (run: RunRow, item: ItemRow): ChatJudgeOutcome => {
    const tools = parseList(item.tools) ?? []
    const called = parseList(run.tools_called)
    const offered = item.action === 'offered' && tools.length > 0
    const toolUsed = offered && called !== null ? called.some((name) => tools.some((pattern) => judgeToolMatches(pattern, name))) : null
    let lore: ChatJudgeOutcome['lore'] = null
    if (offered && run.reply_id && tools.some((pattern) => judgeToolMatches(pattern, 'save_lore'))) {
      const row = loreOf.get(run.thread_id, run.reply_id) as { saved: number; dismissed: number } | undefined
      lore = !row ? 'none' : row.saved === 1 ? 'saved' : row.dismissed === 1 ? 'dismissed' : 'proposed'
    }
    let followUp: ChatJudgeOutcome['followUp'] = null
    if (item.action === 'follow-up') {
      followUp = run.follow_up_message_id === null ? 'none' : answeredAfter.get(run.thread_id, run.follow_up_message_id) ? 'answered' : 'sent'
    }
    return { toolUsed, lore, followUp }
  }
}
