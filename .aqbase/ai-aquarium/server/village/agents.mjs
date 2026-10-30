import { availableActions, actionContext, residentContext, budgetMode, budgetReason } from '../../shared/agents.mjs'
import { replyLengthOf, replyTimeoutMs } from '../../shared/village-settings.mjs'
import { residentDirective } from '../../shared/resident-instructions.mjs'
import { recordDecision, recordWait } from '../../shared/decision-log.mjs'
import { busy, route, freeNear, placeOf, resting } from './world.mjs'
import { clockOf } from '../../shared/clock.mjs'
import { startDecision, pollDecision, judgeTimeout, errorText, modelBudget } from './decider.mjs'
import { busyError } from '../rpg/answers.mjs'
import { payloadLost, requestReplaced, admissionRejected, ADMISSION_RETRY_MS } from '../llm-errors.mjs'
import { snapshotData } from '../llm-payloads.mjs'
import { line } from '../memory/memory.mjs'
import { modernHost, dataLine } from '../llm-budget.mjs'
import { villageOptions, socialOptions, REST_NOTE } from '../rpg/resident-options.mjs'

const SHAPE = { action: '행동 ID', target: 0, goal: '현재 목적', place: '장소 이름', item: '생활 물품 ID', npcId: '상인 ID', recipeId: '제작법 ID', amount: 1, kind: 'item/gold/help/accompany', detail: '행동 목적' }
// Reserve only the model's proposed partner, never its whole candidate list.
const reservedPartner = (world, profileId, except = null) => world.residents.some(r => {
  const intention = r.intention
  return r !== except && intention?.category === 'social' && !intention.reply && intention.target === profileId
})
const kindOf = p => p?.reply ? 'request reply' : 'everyday'
const offered = options => options.map(o => ({ id: o.id, label: o.label ?? o.id, category: o.category }))
const decisionOf = (r, i) => r.decisionLog?.find(e => e.id === i?.decisionId)
/** The chat fallback's catalogs (every good, market stock, place names): the judge's options and detail questions carry them. */
const judgeStateOf = ({ goods: _goods, market: _market, places: _places, ...state }) => state

export function createAgents({ conai, store, rpg, memory, judgeView }, talk) {
  const starting = new WeakSet()
  const remember = (owner, world, ids, result, now) => {
    if (!result || world.memoryBacklogged) return
    store.event(owner, null, result, now)
    memory.remember(owner, ids, line(now, '마을', result), now)
  }
  const waiting = (world, r, reason, now, p = r.agentJob) => recordWait(world, r, reason, now, {
    kind: kindOf(p), options: p?.request ? offered(p.request.options) : [],
    method: p?.route?.decider ?? p?.request?.decider, engine: p?.route?.engine, model: p?.route?.model,
  })
  const fail = (world, r, now, error) => {
    const message = errorText(error), entry = decisionOf(r, r.intention)
    if (entry) { entry.status = 'failed'; entry.failure = message }
    waiting(world, r, `판단·실행 실패 후 재시도를 기다리고 있어. ${message}`, now, r.agentJob ?? r.intention)
    r.agentError = message
    r.agentFailures = (r.agentFailures ?? 0) + 1
    r.nextAt = now + Math.min(120_000, 5000 * 2 ** Math.min(5, r.agentFailures))
    r.agentJob = null; r.intention = null
  }
  async function cancel(world) {
    for (const r of world.residents) {
      const job = r.agentJob; r.agentJob = null; r.intention = null
      if (job?.jobId) await conai.llm.cancel(job.jobId).catch(() => {})
    }
  }
  function launch(owner, world, r, p, now) {
    if (starting.has(p)) return
    starting.add(p)
    const launchedAt = Date.now()
    const request = snapshotData(p.request)
    const judged = request.decider === 'judge' ? judgeStateOf(request.state) : null
    Promise.resolve(judged && judgeView(owner, r.profileId, dataLine(judged))).then(view => startDecision(conai, { ...request,
      state: judged ? { ...judged, ...view } : request.state, settings: world.settings,
      onDiagnostic: d => { r.agentBudgetDiagnostic = d; p.request = { ...request, input: structuredClone(request.input) }; store.save(owner, world) },
      budget: modelBudget(rpg.agentWrite, owner, r.profileId, p.category, world, now),
    })).then(async result => {
      if (r.agentJob !== p || !world.running) { if (result.jobId) await conai.llm.cancel(result.jobId).catch(() => {}); return }
      p.request = { ...request, input: structuredClone(request.input) }
      if (result.wait) {
        waiting(world, r, result.wait, now, p)
        if (!p.selectedOption) r.agentJob = null
      } else Object.assign(p, result)
      store.save(owner, world)
    }).catch(error => {
      if (r.agentJob !== p) return
      const failedAt = now + Math.max(0, Date.now() - launchedAt)
      if (requestReplaced(error)) {
        r.agentJob = null; r.nextAt = now + ADMISSION_RETRY_MS
        waiting(world, r, '플러그인 변경으로 이전 요청을 버리고 새 모델 판단을 기다려.', now, p); store.save(owner, world); return
      }
      p.attempts = (p.attempts ?? 0) + (busyError(error) ? 0 : 1)
      p.error = { message: errorText(error), busy: busyError(error), terminal: payloadLost(error) }
      let delay = busyError(error) ? ADMISSION_RETRY_MS : 5000
      if (!admissionRejected(error)) rpg.agentWrite(owner, s => {
        delay = Math.max(delay, s.settings.deciders[p.category].minInterval * 1000)
        const b = s.actors.find(a => a.profileId === r.profileId)?.agentBudget?.[p.category]
        if (b) b.nextAt = Math.max(b.nextAt, failedAt + delay)
      })
      p.retryAt = failedAt + delay
      waiting(world, r, `모델 응답 재시도 대기: ${p.error.message}`, failedAt, p)
      store.save(owner, world)
    }).finally(() => starting.delete(p))
  }
  function targetsOf(world, r, now) {
    return world.residents.filter(o => o !== r && !o.away && !o.asleep && !o.agentJob && !o.intention &&
      (o.restUntil ?? 0) <= now && !reservedPartner(world, o.profileId, r) && !busy(world, o) && o.errand !== 'depart' && !resting(world, r.profileId, o.profileId))
  }
  function destination(world, s, r, intent) {
    const target = world.residents.find(x => x.profileId === intent.target)
    if (intent.category === 'social') return target ? { tile: freeNear(world, target, r), name: `${target.name}에게` } : null
    const action = availableActions(s, 'village').find(a => a.id === intent.action)
    const places = world.geometry?.places ?? []
    const named = places.find(p => p.name === (intent.place || action?.effect.place))
    if ((intent.place || action?.effect.place) && (intent.action === 'visit' || !action?.builtin) && !named) throw new Error('마을에 없는 목적지야.')
    if (named && (intent.action === 'visit' || !action?.builtin)) return { tile: freeNear(world, named.tiles[0], r), name: named.name }
    if (intent.action === 'visit') throw new Error('모델이 방문할 장소를 고르지 않았어.')
    const npc = intent.npcId && s.life.npcs.find(n => n.id === intent.npcId)
    const b = s.life.buildings.find(b => b.id === (intent.buildingId ?? npc?.buildingId))
    if ((intent.buildingId || intent.npcId) && !b) throw new Error('선택한 시설이 없어.')
    if (b) return { tile: freeNear(world, { x: b.x + Math.floor(b.w / 2), y: b.y + b.h }, r), name: b.name }
    return { tile: { x: r.x, y: r.y }, name: placeOf(r, world) }
  }
  async function execute(owner, world, r, now) {
    const i = r.intention, s = rpg.read(owner), entry = decisionOf(r, i)
    if (i.reply) {
      const q = rpg.replyRequest(owner, i.reply, r.profileId, i.action, i.detail ?? '', now)
      if (!q.repeated) remember(owner, world, [q.from, q.to], q.result, now)
      if (entry) { entry.status = q.status === 'failed' ? 'failed' : 'done'; entry.effect = q.result ?? q.status; entry.failure = q.status === 'failed' ? q.reason : '' }
      r.intention = null; r.agentError = null; r.agentFailures = 0; return
    }
    if (i.category === 'social' && !targetsOf(world, r, now).some(t => t.profileId === i.target)) {
      const target = world.residents.find(t => t.profileId === i.target)
      if (target && !target.away && !target.asleep && !resting(world, r.profileId, target.profileId)) {
        i.partnerWaitAt ??= now
        if (now - i.partnerWaitAt >= 120_000) throw new Error('상대가 계속 교류할 수 없어. 기다림을 끝내고 새 모델 판단을 요청해.')
        waiting(world, r, '모델이 고른 상대가 하던 일을 마치기를 기다리고 있어.', now, i)
        return
      }
      throw new Error('모델이 고른 상대가 지금 교류할 수 없어.')
    }
    if (i.partnerWaitAt !== undefined) { i.at = now; delete i.partnerWaitAt }
    const d = destination(world, s, r, i)
    if (!d) throw new Error('행동 대상이 마을에 없어.')
    if (entry && !entry.chosen.place) entry.chosen.place = d.name
    if (Math.hypot(d.tile.x - r.x, d.tile.y - r.y) > 1.5) {
      if (!r.path.length) {
        r.path = route(r, d.tile, world.geometry?.map)
        if (!r.path.length) throw new Error('목적지로 가는 길이 없어.')
      }
      r.destination = d.name; r.activity = 'walk'
      if (r.posted) r.breakUntil = now + 30_000
      if (now - i.at > 120_000) throw new Error('목적지 이동 시간이 초과됐어.')
      if (entry) entry.effect = `${d.name} 이동 중`
      return
    }
    let result
    if (i.category === 'social') {
      const target = world.residents.find(x => x.profileId === i.target)
      result = rpg.interact(owner, r.profileId, { ...i, id: i.action }, i.requestId, now)
      if (!result.repeated && i.action !== 'talk') remember(owner, world, [r.profileId, target.profileId], result.result ?? `${r.name} → ${target.name}: ${result.action?.label} 제안`, now)
      const began = talk.begin(owner, world, r, target, now)
      if (entry) entry.effect = result.result ?? `${r.name} → ${target.name}: ${result.action?.label ?? i.action}`
      if (!began && entry) entry.effect += ' · 대화는 시작하지 못했어. 다음 교류는 새 모델 판단이 필요해.'
    } else {
      result = rpg.performVillage(owner, r.profileId, i, i.requestId, now)
      if (result.sleeping !== undefined) r.asleep = result.sleeping
      if (i.lodging) r.lodging = i.lodging
      if (result.wakeCondition) {
        const hunger = s.settings.statusDefs.find(d => d.id === 'hunger' && d.enabled)
        r.restPlan = { condition: result.wakeCondition, untilClock: result.wakeCondition === 'morning' ? (Math.floor((world.clock - 360) / 1440) + 1) * 1440 + 360 : null,
          requests: s.socialRequests.filter(q => q.to === r.profileId && q.status === 'pending').map(q => q.id), addressedAt: r.addressedAt ?? 0,
          hungry: !!hunger && (s.actors.find(a => a.profileId === r.profileId)?.statuses?.hunger ?? 0) >= hunger.high }
        r.activity = i.action === 'sleep' ? 'sleep' : 'rest'
      } else r.restPlan = null
      if (i.action === 'oracle') r.errand = 'oracle'
      // Routine state changes stay in the decision log. Production records its actual completion.
      if (!result.repeated && !['visit', 'rest', 'sleep', 'wake', 'work', 'craft', 'oracle', 'wait'].includes(i.action))
        remember(owner, world, [r.profileId], result.result, now)
      if (result.duration) { r.restUntil = now + result.duration * 1000; r.nextAt = r.restUntil; r.activity = i.action === 'sleep' ? 'sleep' : 'rest' }
      if (entry) entry.effect = result.result
    }
    if (entry) entry.status = 'done'
    r.intention = null; r.agentError = null; r.agentFailures = 0
  }
  async function step(owner, world, now) {
    for (const r of world.residents) {
      if (world.memoryBacklogged) {
        r.agentPausedAt ??= now
        waiting(world, r, '기억 정리가 밀려 새 판단과 대화를 기다리고 있어.', now)
        continue
      }
      if (r.agentPausedAt !== undefined) {
        const elapsed = now - r.agentPausedAt
        if (r.agentJob) { r.agentJob.at += elapsed; if (r.agentJob.retryAt) r.agentJob.retryAt += elapsed }
        if (r.intention) r.intention.at += elapsed
        delete r.agentPausedAt
      }
      const unavailable = busy(world, r) || r.away || (r.errand === 'depart') || (r.restUntil ?? 0) > now
      const job = r.agentJob, timeout = job && (job.route?.decider !== 'chat' && job.request.decider === 'judge' ? judgeTimeout(job.request.input.timeoutMs) : job.request.input.timeoutMs)
      if (job && (unavailable || now - job.at > timeout + 30_000)) {
        if (job.jobId) await conai.llm.cancel(job.jobId).catch(() => {})
        if (!unavailable) fail(world, r, now, new Error('주민 판단 대기 시간이 지났어.'))
        else { r.agentJob = null; r.intention = null }
      }
      if (unavailable) { r.intention = null; continue }
      const s = rpg.read(owner), a = s.actors.find(a => a.active && a.profileId === r.profileId)
      if (!a) continue
      if (r.restPlan && !r.agentJob && !r.intention) {
        const plan = r.restPlan, hunger = s.settings.statusDefs.find(d => d.id === 'hunger' && d.enabled), fatigue = s.settings.statusDefs.find(d => d.id === 'fatigue' && d.enabled)
        const ready = plan.condition === 'morning' && world.clock >= plan.untilClock ||
          plan.condition === 'rested' && fatigue && a.statuses.fatigue <= fatigue.min ||
          (r.addressedAt ?? 0) > plan.addressedAt ||
          s.socialRequests.some(q => q.to === r.profileId && q.status === 'pending' && !plan.requests.includes(q.id)) ||
          !plan.hungry && hunger && a.statuses.hunger >= hunger.high
        if (!ready) { waiting(world, r, '모델이 선택한 휴식 종료 조건을 기다리고 있어.', now); continue }
        r.restPlan = null; r.nextAt = Math.min(r.nextAt ?? now, now)
        waiting(world, r, '휴식 조건이나 관련 상황이 바뀌어 기상/다음 행동의 모델 판단을 요청해.', now)
      }
      if (a.travelGoal && !r.intention && !r.agentJob) {
        const place = world.geometry?.places.find(p => p.name === a.travelGoal.place)
        const tile = place && freeNear(world, place.tiles[0], r)
        if (tile && a.travelGoal.until > now && Math.hypot(tile.x - r.x, tile.y - r.y) > 1.5) {
          if (!r.path.length) r.path = route(r, tile, world.geometry?.map)
          if (r.path.length) { r.destination = place.name; r.goal = `${place.name}에 함께 가기`; r.activity = 'walk'; continue }
        }
        rpg.agentWrite(owner, st => { st.actors.find(x => x.id === a.id).travelGoal = null })
      }
      if (a.follow?.until > now && !r.intention) {
        const lead = world.residents.find(x => x.profileId === a.follow.profileId)
        if (lead && Math.hypot(lead.x - r.x, lead.y - r.y) > 2 && !r.path.length) { r.path = route(r, freeNear(world, lead, r), world.geometry?.map); r.destination = `${lead.name}와 동행`; r.activity = 'walk' }
      }
      try {
        const p = r.agentJob
        if (p) {
          if (p.error) {
            if (!p.error.terminal && (p.error.busy || p.attempts < 3)) {
              const reason = now < p.retryAt ? `모델 응답 재시도 대기: ${p.error.message}` : budgetReason(s, a, p.category, world.clock, now)
              if (reason) { waiting(world, r, reason, now, p); continue }
              p.error = null; launch(owner, world, r, p, now); continue
            }
            throw new Error(p.error.message)
          }
          if (!p.jobId && !p.output) { launch(owner, world, r, p, now); continue }
          let output = await pollDecision(conai, p)
          if (r.agentJob !== p || !world.running) continue
          if (!output) continue
          if (output.action === 'wait') {
            waiting(world, r, '모델이 다음 판단까지 기다리기로 했어.', now, p); r.agentJob = null; continue
          }
          let option = p.request.options.find(o => o.id === output.action)
          if (!option) throw new Error('목록에 없는 주민 행동이야.')
          if (p.selectedOption) {
            output = { ...p.selectedOutput, amount: option.data.amount }
            option = p.selectedOption
          } else if (option.requiresAmount && p.route?.decider === 'judge') {
            p.selectedOption = option; p.selectedOutput = { ...output, ...option.data }
            const options = Array.from({ length: option.maxAmount }, (_, i) => ({
              id: `amount_${i + 1}`, description: `${i + 1}${option.actionId === 'trade' || option.data.kind === 'gold' ? 'G' : '개'}`, data: { amount: i + 1 },
            }))
            const state = { resident: residentContext(s, a), choice: option.description }
            const input = memory.decorate(owner, { requestId: `${world.runId}:agent:${++world.seq}`, profileId: r.profileId, mode: 'text',
              message: `이미 고른 행동의 수량/가격만 골라. ${option.description}\n${dataLine(state)}\n가능한 수량의 정확한 action ID를 답해: ${JSON.stringify(options.map(({ id, description }) => ({ id, description })))}`,
              structuredOutput: SHAPE, maxTokens: replyLengthOf(world.settings), timeoutMs: replyTimeoutMs(world.settings) }, r.profileId)
            p.request = { profileId: r.profileId, decider: 'judge', state, options, input }
            p.output = null; p.jobId = null; p.at = now
            waiting(world, r, '선택한 교류의 수량/가격 모델 판단을 기다려.', now, p)
            continue
          }
          Object.assign(output, option.data)
          if (option.requiresAmount && (!Number.isSafeInteger(output.amount) || output.amount < 1 || output.amount > option.maxAmount))
            throw new Error('선택한 교류의 가능한 수량/금액을 모델이 골라야 해.')
          p.reply = option.reply; p.target = option.target
          const target = output.target ?? (p.targets.length === 1 ? p.targets[0] : null)
          if (!output.place && ['visit', 'invite'].includes(option.actionId ?? option.id) && p.request.state.places.length === 1) output.place = p.request.state.places[0]
          if (!p.reply && option.category === 'social' && !p.targets.includes(target)) throw new Error('모델이 유효한 교류 상대를 고르지 않았어.')
          // Commit the claim synchronously, before another pending answer is consumed.
          if (!p.reply && option.category === 'social' && reservedPartner(world, target, r)) throw new Error('다른 주민이 먼저 상대에게 다가가고 있어. 새 모델 판단을 기다려.')
          if (output.place !== undefined && typeof output.place !== 'string') throw new Error('장소는 마을의 장소 이름이어야 해.')
          r.agentRoute = p.route; r.goal = String(output.goal ?? option.label ?? option.id)
          rpg.agentWrite(owner, st => { const x = st.actors.find(x => x.id === a.id); x.goal = r.goal; x.agentRoute = p.route })
          const id = p.request.input.requestId
          recordDecision(world, r, { id, kind: kindOf(p), options: offered(p.request.options),
            chosen: { action: option.actionId ?? option.id, label: option.label ?? option.id, category: option.category,
              target: p.reply ? p.target : option.category === 'social' ? target : null,
              targetName: world.residents.find(t => t.profileId === (p.reply ? p.target : option.category === 'social' ? target : null))?.name ?? '', place: output.place ?? '' },
            method: p.route?.decider, engine: p.route?.engine, model: p.route?.model, probability: output.probability, confidence: output.confidence,
            effect: p.route?.decider === 'direct' ? '선택지가 하나라 모델 호출 없이 실행해.' : '',
          }, now)
          r.intention = { ...output, action: option.actionId ?? option.id, decider: p.route?.decider, category: option.category, target,
            reply: p.reply, decisionId: id, requestId: id, at: now }
          r.agentJob = null
        }
        if (r.intention) { await execute(owner, world, r, now); continue }
        if (r.path.length) continue
        if (reservedPartner(world, r.profileId)) { waiting(world, r, '모델이 교류를 선택한 주민이 다가오기를 기다리고 있어.', now); continue }
        if (r.nextAt > now) {
          waiting(world, r, r.agentError ? `판단·실행 실패 후 재시도를 기다리고 있어. ${r.agentError}` : '사용자가 설정한 최소 호출 간격을 기다리고 있어.', now)
          continue
        }
        const targets = targetsOf(world, r, now), incoming = s.socialRequests.filter(q => q.to === r.profileId && q.status === 'pending')
        const q = incoming[0], category = 'village'
        const requestEffect = q => {
          const name = s.actors.find(a => a.profileId === q.from)?.name ?? '상대'
          const item = s.items.find(d => d.id === q.item)?.name ?? '물품'
          if (q.action.id === 'propose') return `${name}의 청혼이야. 수락하면 서로 약혼해.`
          if (q.action.id === 'invite') return `${name}와 ${q.place}에 함께 가는 초대야.`
          if (q.action.id === 'trade') return `내가 ${name}에게 ${q.amount}G를 지급하고 ${item} 1개를 받아.`
          if (q.kind === 'help') return `${name}의 도움 요청이야. 수락하면 도움 관계를 맺어. 골드·물품 이전은 없어.`
          if (q.kind === 'accompany') return `${name}를 따라 함께 이동하는 요청이야. 골드·물품 이전은 없어.`
          const goods = q.kind === 'gold' ? `${q.amount}G` : `${item} ${q.amount}개`
          return q.action.id === 'request' ? `내가 ${name}에게 ${goods}를 제공하는 요청이야.` : `${name}가 내게 ${goods}를 제공해.`
        }
        const replies = incoming.flatMap((q, index) => ['accept', 'refuse'].map(answer => ({
          id: index ? `${answer}_${index}` : answer, actionId: answer, reply: q.id, target: q.from, category: 'social',
          label: `${s.actors.find(a => a.profileId === q.from)?.name ?? '떠난 주민'}의 ${q.action.label ?? q.action.id} ${answer === 'accept' ? '수락' : '거절'}`,
          description: `${q.detail ?? ''} · ${requestEffect(q)} ${answer === 'accept' ? '지금 수락하고 검증된 효과 실행.' : '지금 거절, 이전 없음.'} 다른 행동을 먼저 골라도 돼. ${Math.max(0, Math.ceil((q.expiresAt - now) / 1000))}초 뒤 만료.`,
        })))
        const actions = [...villageOptions(s, a, r, world, now), ...(!r.asleep && targets.length ? socialOptions(s, a, targets) : []), ...replies]
        const options = actions.map((o, i) => ({ ...o, actionId: o.actionId ?? o.id, id: actions.some((other, j) => j !== i && other.id === o.id) ? `${o.category}_${i}` : o.id }))
        const waitingEntry = { request: { options, decider: s.settings.deciders[category].decider } }
        if (!options.length) { waiting(world, r, '사용할 수 있는 행동이 없어.', now, waitingEntry); continue }
        const mode = budgetMode(s, a, category, world.clock, now)
        if (mode === 'wait') { waiting(world, r, budgetReason(s, a, category, world.clock, now), now, waitingEntry); continue }
        if (!modernHost(conai)) {
          const reserved = (world.conversations?.length ?? 0) + Number(!!world.summary) + Number(!!world.sideJob) + Number(!!s.pending) +
            s.actors.filter(a => a.phase === 'combat' && a.expedition?.awaiting && !a.expedition.choice).length
          if (world.residents.filter(o => o.agentJob).length >= Math.min(2, Math.max(0, 4 - reserved))) {
            waiting(world, r, '이전 호스트의 모델 실행 자리가 나기를 기다리고 있어.', now, waitingEntry); continue
          }
        }
        r.nextAt = now + s.settings.deciders[category].minInterval * 1000
        const state = { resident: residentContext(s, a, targets.map(r => r.profileId)), instructions: r.instructions ?? '', scene: world.settings.scene,
          time: world.clock, timeText: clockOf(world.clock).text, place: placeOf(r, world), posted: !!r.posted, lastError: r.agentError ?? null,
          sleeping: !!r.asleep, habitualShifts: s.settings.shifts, inventory: a.inventory, equipment: a.equipment, supplies: a.supplies,
          production: s.life.production.filter(j => j.actorId === a.id).map(j => ({ progress: j.progress, seconds: j.seconds, buildingId: j.buildingId })),
          goods: s.items.filter(d => d.stackable).map(d => ({ id: d.id, name: d.name, price: d.price, capabilities: d.capabilities })),
          market: s.life.npcs.filter(n => n.open).map(n => ({ id: n.id, role: n.role, stock: Object.entries(n.stock ?? {}).filter(([, count]) => count > 0) })),
          nearby: targets.map(o => ({ profileId: o.profileId, name: o.name, distance: Math.round(Math.hypot(o.x - r.x, o.y - r.y)) })),
          places: (world.geometry?.places ?? []).map(p => p.name),
          request: q ? { id: q.id, from: q.from, action: q.action.id, detail: q.detail, kind: q.kind, item: q.item, amount: q.amount } : null }
        const input = memory.decorate(owner, { requestId: `${world.runId}:agent:${++world.seq}`, profileId: r.profileId, mode: 'text',
          message: [residentDirective(r), world.settings.scene, `지금은 ${state.timeText}이야.`, '너 자신의 필요·관계·기억과 목표로 지금 할 행동 하나를 골라. 마을 생활과 교류 중 무엇을 할지도 네가 정해. 목록의 action ID만 사용해. 목표(goal)와 대상 프로필 ID(target), 필요한 item/amount/kind/place/detail을 채워. 근무 중 교류는 가능하지만 일하기 외의 생활 행동(휴식 포함)을 실행하면 근무가 끝나.',
            REST_NOTE, dataLine(state), `행동 선택지: ${JSON.stringify(actionContext(options))}`].join('\n'), structuredOutput: SHAPE,
          maxTokens: replyLengthOf(world.settings), timeoutMs: replyTimeoutMs(world.settings) }, r.profileId, { purpose: 'decision', settings: world.settings })
        const details = []
        if (options.some(o => o.category === 'social' && !o.reply) && targets.length >= 2) details.push({ id: 'target', instructions: '새 교류 행동이라면 상대를 골라. 받은 요청 답변은 선택지에 지정된 상대에게 전달돼.',
          options: targets.map(r => ({ id: `resident_${r.profileId}`, description: r.name, value: r.profileId })) })
        if (state.places.length >= 2 && options.some(o => ['visit', 'invite'].includes(o.actionId))) details.push({ id: 'place', instructions: '방문이나 초대라면 갈 장소를 골라. 식사·근무는 실제 시설로 안내해.',
          options: state.places.map((name, i) => ({ id: `place_${i}`, description: name, value: name })) })
        const request = { profileId: r.profileId, decider: mode, state, options, details, input, instructions: `필요·지시·기억과 목표를 읽고 마을 생활과 교류를 포함한 전체 선택지에서 지금 할 행동 하나를 골라. ${REST_NOTE}` }
        const pending = { at: now, category, targets: state.nearby.map(o => o.profileId), request }
        r.agentJob = pending; store.save(owner, world); launch(owner, world, r, pending, now)
      } catch (error) { fail(world, r, now, error) }
    }
  }
  return { step, cancel }
}
