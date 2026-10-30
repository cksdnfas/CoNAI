import { clockOf } from './clock.mjs'

export const safeDecisionText = v => typeof v === 'string' ? (/^(?:https?:\/\/|data:)/i.test(v.trim()) ? `내용: ${v}` : v) : ''
const text = safeDecisionText
const numeric = v => Number.isFinite(v) ? v : null
/** Explicit fields only: these entries also cross the host's private-page-key boundary. */
export function decisionLogOf(resident, limit = 30, compact = false) {
  return (resident.decisionLog ?? []).slice(0, limit).map(e => ({
    id: text(e.id), at: numeric(e.at), gameTime: text(e.gameTime), kind: text(e.kind), status: text(e.status),
    offeredCount: numeric(e.offeredCount) ?? e.options?.length ?? 0,
    ...(compact ? {} : { options: (e._catalog?.options ?? e.options ?? []).map(o => ({ id: text(o.id), label: text(o.label), category: text(o.category) })) }),
    chosen: e.chosen ? { action: text(e.chosen.action), label: text(e.chosen.label), category: text(e.chosen.category),
      target: numeric(e.chosen.target), targetName: text(e.chosen.targetName), place: text(e.chosen.place) } : null,
    method: text(e.method), engine: text(e.engine), model: text(e.model),
    probability: numeric(e.probability), confidence: numeric(e.confidence),
    effect: text(e.effect), failure: text(e.failure), reason: text(e.reason), count: numeric(e.count) ?? 1,
    lastAt: numeric(e.lastAt ?? e.at), lastGameTime: text(e.lastGameTime ?? e.gameTime),
  }))
}

export function recordDecision(world, resident, entry, now) {
  resident.decisionLog ??= []
  const result = decisionLogOf({ decisionLog: [{ at: now, gameTime: clockOf(world.clock).text, kind: 'everyday', status: 'chosen', ...entry }] })[0]
  result.id ||= `${result.kind}:${resident.profileId}:${now}`
  if (result.options.length) result._catalog = { options: result.options }
  delete result.options
  resident.decisionLog.unshift(result)
  resident.decisionLog.length = Math.min(30, resident.decisionLog.length)
  return result
}

export function recordWait(world, resident, reason, now, entry = {}) {
  const kind = entry.kind ?? 'everyday', previous = resident.decisionLog?.find(e => e.kind === kind)
  if (previous?.status === 'wait' && previous.reason === reason && previous.kind === kind) {
    previous.count = (previous.count ?? 1) + 1
    previous.lastAt = now; previous.lastGameTime = clockOf(world.clock).text
    return previous
  }
  return recordDecision(world, resident, { ...entry, kind, status: 'wait', reason, count: 1 }, now)
}
