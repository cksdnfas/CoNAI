import { randomUUID } from 'node:crypto'
import { dayKey as dayOf, syncActors, expand, answerOracle, log } from './rules.mjs'
import { queueArt, artProblem, artToday, artDailyOf, lookBatch, lookInput, askLooks, applyLooks, LOOKS } from './game-art.mjs'
import { replyLengthOf, replyTimeoutMs, replyTimeoutMessage, replyExpired } from '../../shared/village-settings.mjs'
import { resultJson, busyError } from './answers.mjs'
import { dmInput, oracleInput } from './prompts.mjs'
import { dmKey } from '../memory/memory.mjs'
import { LIFE_GM } from '../../shared/life.mjs'
import { lifeAction, reviewConstruction, proposeLife, lifeProgress } from './life.mjs'
import { gmLifeMessage } from './life-prompts.mjs'
import { modelBudget, modelCall } from '../village/decider.mjs'
import { recordWait, recordDecision } from '../../shared/decision-log.mjs'
import { startBudgeted, outputCap, resultDiagnostic, dataLine } from '../llm-budget.mjs'
import { llmErrorText, payloadLost, requestReplaced, ADMISSION_RETRY_MS } from '../llm-errors.mjs'
import { budgetReason } from '../../shared/agents.mjs'
import { clipProse } from '../../shared/speech.mjs'

const townRequest = p => ['look', 'life', 'life-decision'].includes(p.kind)
export const operationKey = p => `${p.kind}:${p.actorId ?? p.zoneId ?? p.constructionId ?? 'gm'}`
const operationReady = (s, kind, now, subject = {}) => (s.operationFailures?.[operationKey({ kind, ...subject })]?.until ?? 0) <= now
/** Backlog pauses plugin deadlines, not the host's already-running model. Completed replies remain consumable. */
export function pausePending(s, paused, now) {
  const p = s.pending
  if (!p) return
  if (paused) { p.backlogSince ??= now; return }
  if (p.backlogSince === undefined) return
  const elapsed = Math.max(0, now - p.backlogSince)
  p.createdAt += elapsed; p.nextAt = now
  const q = s.actors.find(a => a.id === p.actorId)?.expedition?.question
  if (p.kind === 'judgement' && q?.id === p.questionId) { q.expiresAt += elapsed; if (Number.isFinite(q.at)) q.at += elapsed }
  delete p.backlogSince
}

/**
 * The one global AI request at a time: a judge call, a DM floor, an oracle, picture looks or an expedition decision.
 * `choose` picks and stores it; `runPending` starts it, follows it and applies the answer.
 */
export function createPending({ conai, read, write, sync, withContext }) {
  const starting = new Set()
  function chargeGm(owner, pending, now) {
    if (!['life', 'dm'].includes(pending.kind)) return
    write(owner, s => {
      if (s.pending?.input.requestId !== pending.input.requestId || s.pending.gmCharged || s.pending.lifeCharged) return
      if (pending.kind === 'dm') {
        if (s.daily.day !== dayOf(now)) s.daily = { day: dayOf(now), count: 0 }
        s.daily.count++
        s.pending.gmCharged = true
        return
      }
      if (s.life.gmDaily?.day !== dayOf(now)) s.life.gmDaily = { day: dayOf(now), plans: 0, reviews: 0 }
      s.life.gmDaily[pending.constructionId ? 'reviews' : 'plans']++
      s.pending.gmCharged = true
    })
  }
  /** `soft`: the model answered but the answer was unusable; only that request's subject waits, nothing pauses. */
  function fail(owner, pending, now, message, soft = false) {
    if (pending.jobId) chargeGm(owner, pending, now)
    message = llmErrorText(message)
    write(owner, s => {
      if (s.pending?.input.requestId !== pending.input.requestId) return
      s.pending = null
      if (pending.kind === 'look') { soft = true; s.lookRetryAt = now + 600_000 } // pictures wait; the adventure goes on
      if (pending.kind === 'life') {
        soft = true; s.life.reviewAt = s.life.elapsed + 120
        const c = s.life.constructions.find(c => c.id === pending.constructionId)
        if (c) c.reviewAt = s.life.elapsed + 120
      }
      if (pending.kind === 'life-decision') {
        const a = s.actors.find(a => a.id === pending.actorId)
        if (a) { a.lifeAt = s.life.elapsed + 60; a.lifeError = message }
        // An invalid game action is local feedback, not a failed expedition or a broken shared host.
        if (soft) { log(s, `주민 생활: ${message}`, a?.id ?? null, now, { quiet: true }); return }
      }
      const key = operationKey(pending), failures = (s.operationFailures?.[key]?.count ?? 0) + 1
      const delay = soft ? 5000 : failures >= 3 ? 600_000 : Math.min(300_000, failures * 60_000)
      ;(s.operationFailures ??= {})[key] = { kind: pending.kind, count: failures, until: now + delay, error: message }
      s.aiFailures = soft ? s.aiFailures ?? 0 : failures; s.aiPaused = false
      s.error = `${({ dm: 'GM 확장', judgement: '탐험 판단', oracle: '신탁', look: '그림 설정', life: 'GM 생활 심사', 'life-decision': '주민 생활' })[pending.kind] ?? '원정 결정'}: ${message}${!soft && failures >= 3 ? ' 이 작업만 10분 쉬어. 다른 AI 활동은 계속해.' : ''}`
      s.nextAiAt = now + 5000
      if (pending.kind === 'dm') s.dmRetryAt = now + 300_000
      const actor = s.actors.find(a => a.id === pending.actorId)
      if (pending.kind === 'oracle' && actor) actor.oracleAt = now + 600_000
      else if (actor && pending.kind !== 'life-decision') actor.readyAt = now + 60_000
      log(s, s.error, actor?.id ?? null, now, { quiet: true })
    })
  }
  async function runPending(owner, world, now, resting = new Set()) {
    let p = read(owner).pending
    if (!p) return
    const failed = (message, soft = false) => {
      if (p.kind === 'oracle') {
        const seeker = read(owner).actors.find(a => a.id === p.actorId)
        for (const r of world.residents.filter(r => [p.input.profileId, seeker?.profileId].includes(r.profileId)))
          recordWait(world, r, `신탁 모델 판단 재시도 대기: ${llmErrorText(message)}`, now, { kind: 'oracle' })
      }
      fail(owner, p, now, message, soft)
    }
    if (world.memoryBacklogged || p.backlogSince !== undefined) {
      write(owner, s => pausePending(s, !!world.memoryBacklogged, now), true, false)
      if (world.memoryBacklogged) return
      p = read(owner).pending
    }
    if (now < p.nextAt) return
    if (!read(owner).settings.enabled && !townRequest(p)) {
      write(owner, s => { if (s.pending?.input.requestId === p.input.requestId) s.pending = null })
      if (p.jobId) await conai.llm.cancel(p.jobId).catch(() => {})
      return
    }
    const expired = replyExpired(p.createdAt, p.input.timeoutMs, now)
    if (expired && !p.jobId && !p.output) {
      failed(replyTimeoutMessage(p.input.timeoutMs)); return
    }
    if (!p.jobId && !p.output) {
      write(owner, s => { if (s.pending?.input.requestId === p.input.requestId) { s.pending.attempts++; s.pending.nextAt = now + 5_000 } })
      try {
        const job = await startBudgeted(conai, p.input, { settings: world.settings,
          ...(p.kind === 'oracle' ? { invoke: call => modelCall(call, modelBudget(write, owner, p.input.profileId, 'social', world, now)) } : {}),
          onDiagnostic: d => { write(owner, s => {
          s.budgetDiagnostic = d
          if (s.pending?.input.requestId === p.input.requestId) {
            if (p.input._budget) s.pending.input._budget = structuredClone(p.input._budget)
            else { delete s.pending.input._budget; delete s.pending.input.history }
          }
        }) } })
        if (!job) {
          const r = world.residents.find(r => r.profileId === p.input.profileId)
          if (r) recordWait(world, r, modelBudget(write, owner, r.profileId, 'social', world, now).reason(), now, { kind: 'oracle' })
          write(owner, s => { if (s.pending?.input.requestId === p.input.requestId) { s.pending = null; s.nextAiAt = now } })
          return
        }
        if (!world.running || (!read(owner).settings.enabled && !townRequest(p)) || read(owner).pending?.input.requestId !== p.input.requestId) { await conai.llm.cancel(job.jobId).catch(() => {}); return }
        write(owner, s => { if (s.pending?.input.requestId === p.input.requestId) {
          s.pending.jobId = job.jobId; s.pending.nextAt = now + 1000
          delete s.pending.input._budget; delete s.pending.input.history
          if (p.kind === 'look') askLooks(s, (job.budget?.subjectIds ?? []).map(id => p.keys[Number(id) - 1]).filter(Boolean))
        } })
      } catch (error) {
        // Busy host: wait for a free slot without spending an attempt or running into the timeout.
        if (requestReplaced(error)) write(owner, s => { if (s.pending?.input.requestId === p.input.requestId) {
          s.pending.input.requestId = `rpg:${randomUUID()}`; delete s.pending.input._budget
          s.pending.attempts = 0; s.pending.createdAt = now; s.pending.nextAt = now + ADMISSION_RETRY_MS
        } })
        else if (payloadLost(error)) failed(String(error.message), true)
        else if (busyError(error)) write(owner, s => { if (s.pending?.input.requestId === p.input.requestId) { s.pending.attempts--; s.pending.createdAt = now; s.pending.nextAt = now + 5_000 } })
        else if (read(owner).pending?.attempts >= 3) failed(String(error.message))
      }
      return
    }
    let job
    try { job = p.output ? { status: 'completed', result: { json: { ...p.defaults, ...p.output } } } : await conai.llm.get(p.jobId) } catch { failed('AI 작업을 다시 확인할 수 없어.'); return }
    if (!world.running || read(owner).pending?.input.requestId !== p.input.requestId) return
    if (['queued', 'running'].includes(job.status)) {
      if (expired) { await conai.llm.cancel(p.jobId).catch(() => {}); failed(replyTimeoutMessage(p.input.timeoutMs)); return }
      write(owner, s => { if (s.pending?.input.requestId === p.input.requestId) s.pending.nextAt = now + 2_000 }); return
    }
    if (job.status === 'cancelled' && !job.result && ['life', 'dm'].includes(p.kind)) {
      write(owner, s => {
        if (s.pending?.input.requestId !== p.input.requestId) return
        s.pending = null; s.nextAiAt = now + 5000
        s.error = 'GM 작업이 호스트에서 취소됐어. 결과가 없어 일일 사용량은 세지 않았어.'
      })
      return
    }
    chargeGm(owner, p, now)
    if (job.status !== 'completed') {
      failed(String(job.error || 'AI 작업이 중단됐어.')); return
    }
    try {
      const output = resultJson(job.result)
      sync(owner, world.residents)
      write(owner, s => {
        if ((!s.settings.enabled && !townRequest(p)) || s.pending?.input.requestId !== p.input.requestId) return
        s.budgetDiagnostic = resultDiagnostic(conai, job.result, s.budgetDiagnostic)
        const routedActor = s.actors.find(a => a.id === p.actorId)
        if (routedActor && p.route?.decider === 'chat') routedActor.agentRoute = { ...p.route, engine: job.result?.engine ?? null, model: job.result?.model ?? null }
        if (p.kind === 'life') {
          if (p.constructionId) reviewConstruction(s, p.constructionId, output, now)
          else {
            proposeLife(s, output, now)
            if (p.lifeProgress !== undefined) s.life.plannedProgress = p.lifeProgress
            if (p.donationTotal !== undefined) s.life.donations.reviewedTotal = Math.max(s.life.donations.reviewedTotal, p.donationTotal)
          }
          s.life.reviewAt = s.life.elapsed + 300
        } else if (p.kind === 'life-decision') {
          const actor = s.actors.find(a => a.id === p.actorId && a.active)
          if (actor && !resting.has(actor.profileId) && output.action !== 'none') lifeAction(s, { ...output, actorId: actor.id }, now)
          if (actor) { actor.lifeAt = s.life.elapsed + 60; actor.lifeError = null }
        } else if (p.kind === 'oracle') {
          const actor = s.actors.find(a => a.id === p.actorId && a.active), priest = s.actors.find(a => a.id === p.oracleId)
          if (actor) {
            answerOracle(s, actor, priest ?? { name: '신관', profileId: 0 }, output, now, job.result?.translation)
            for (const r of world.residents.filter(r => [actor.profileId, priest?.profileId].includes(r.profileId)))
              recordDecision(world, r, { id: p.input.requestId, kind: 'oracle', status: 'done', method: 'chat', engine: job.result?.engine, model: job.result?.model,
                chosen: { action: 'oracle', category: 'social', label: `${actor.calling.job}: ${actor.calling.skills.map(k => `${k.name}(${k.kind})`).join(', ')}` } }, now)
          }
        } else if (p.kind === 'look') {
          applyLooks(s, p.keys ?? [], output)
          queueArt(s, s.settings, now)
        } else {
          const parent = s.zones.find(z => z.id === p.zoneId)
          const zone = parent && expand(s, parent, output, now)
          if (zone) { queueArt(s, s.settings, now); s.dmWish = '' } // the player's wish went into this floor
        }
        s.pending = null
        if (s.operationFailures) delete s.operationFailures[operationKey(p)]
        if (p.kind !== 'life-decision') { s.error = null; s.aiFailures = 0; s.aiPaused = false }
        s.nextAiAt = now + 5_000
      })
    } catch (error) {
      failed(String(error.message), true)
    }
  }

  /** Picks the next request when none is pending. */
  function choose(owner, world, now, profiles, resting, hooks) {
    write(owner, s => {
      if (s.pending) return
      syncActors(s, world.residents)
      if (s.daily.day !== dayOf(now)) s.daily = { day: dayOf(now), count: 0 }
      if (s.life.gmDaily?.day !== dayOf(now)) s.life.gmDaily = { day: dayOf(now), plans: 0, reviews: 0 }
      const parent = s.settings.enabled && s.zones.find(z => !z.expanded && z.cleared)
      const dm = parent && operationReady(s, 'dm', now, { zoneId: parent.id }) && s.dmRetryAt <= now && s.zones.length < s.settings.maxZones && s.daily.count < s.settings.dmDailyLimit && profiles.find(p => p.id === s.settings.dmProfileId)
      // A priest off duty still holds the shrine: callings wait until it opens again.
      const shrine = s.actors.find(a => a.active && a.role === 'oracle' && profiles.some(p => p.id === a.profileId)), oracle = s.open?.oracle === false ? null : shrine
      const oracleWait = oracle && budgetReason(s, oracle, 'social', world.clock, now)
      if (oracleWait) for (const r of world.residents.filter(r => r.profileId === oracle.profileId || s.actors.some(a => a.profileId === r.profileId && a.oracleRequested)))
        recordWait(world, r, `신탁 호출 대기: ${oracleWait}`, now, { kind: 'oracle' })
      const seeker = !oracleWait && s.settings.enabled && oracle && s.actors.filter(a => a.oracleRequested && operationReady(s, 'oracle', now, { actorId: a.id }) && !resting.has(a.profileId) && (hooks.atShrine?.(a) ?? true)).sort((a, b) => a.readyAt - b.readyAt)[0]
      const gm = profiles.find(p => p.id === s.settings.dmProfileId)
      const construction = s.life.constructions.find(c => c.status === 'reserved' && (c.reviewAt ?? 0) <= s.life.elapsed && operationReady(s, 'life', now, { constructionId: c.id }))
      // All admitted terminal GM jobs consume their path's daily allowance. A no-op plan
      // cannot spend a construction review's allowance. Never plan speculatively while a review is queued.
      const reviewLife = construction && s.life.gmDaily.reviews < s.settings.dmDailyLimit
      const planLife = operationReady(s, 'life', now) && !s.life.constructions.some(c => c.status === 'reserved') && !dm && !seeker &&
        s.settings.dmDailyLimit > 0 && s.life.gmDaily.plans < 1 &&
        s.life.elapsed >= 300 && s.life.reviewAt <= s.life.elapsed &&
        (s.life.treasury >= 30 || s.life.donations.total > s.life.donations.reviewedTotal) &&
        lifeProgress(s) !== s.life.plannedProgress
      const batch = operationReady(s, 'look', now) && !artProblem(s) && (s.lookRetryAt ?? 0) <= now && (artToday(s, now) < artDailyOf(s.settings) || Object.values(s.art ?? {}).some(e => e.direct && !e.look)) && gm ? lookBatch(s, outputCap(gm, replyLengthOf(world.settings))) : []
      const cursor = s.life.promptCursor ?? 0
      let input, kind, actorId, zoneId, questionId, oracleId, keys, constructionId, defaults, personal = null
      if (gm && (reviewLife || planLife)) {
        kind = 'life'; constructionId = reviewLife ? construction.id : undefined; personal = dmKey(gm.id)
        input = { profileId: gm.id, structuredOutput: LIFE_GM, maxTokens: replyLengthOf(world.settings), message: gmLifeMessage(s, reviewLife ? construction : null, cursor) }
      } else if (dm) {
        kind = 'dm'; zoneId = parent.id; personal = dmKey(dm.id)
        input = dmInput(s, parent, dm, replyLengthOf(world.settings))
      } else if (seeker) {
        kind = 'oracle'; actorId = seeker.id; oracleId = oracle.id; personal = oracle.profileId
        input = oracleInput(seeker, oracle, world.residents, replyLengthOf(world.settings))
      } else {
        if (!batch.length) { s.nextAiAt = now + 10_000; return }
        kind = 'look'; keys = batch.map(x => x.key); personal = dmKey(s.settings.dmProfileId)
        input = { profileId: s.settings.dmProfileId, message: lookInput(batch), structuredOutput: LOOKS, maxTokens: replyLengthOf(world.settings) }
      }
      s.life.lastAiKind = kind
      if (kind === 'life') s.life.promptCursor = (cursor + 1) % 90
      s.pending = { kind, actorId, zoneId, questionId, oracleId, keys, constructionId, defaults,
        ...(kind === 'life' && !constructionId ? { lifeProgress: lifeProgress(s), donationTotal: s.life.donations.total } : {}),
        createdAt: now, nextAt: now, attempts: 0, jobId: null, input: withContext(owner, { ...input, _outputKind: ['dm', 'life', 'look', 'oracle'].includes(kind) ? kind : undefined, requestId: `rpg:${randomUUID()}`, mode: 'text', useLorebooks: true, timeoutMs: replyTimeoutMs(world.settings) }, personal, ['dm', 'life', 'look'].includes(kind) ? 'gm' : 'decision') }
    })
  }

  return { choose, runPending }
}
