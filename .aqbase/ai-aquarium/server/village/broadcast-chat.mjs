import { busy, placeOf } from './world.mjs'
import { replyLengthOf, replyTimeoutMs, replyTimeoutMessage, replyExpired } from '../../shared/village-settings.mjs'
import { line } from '../memory/memory.mjs'
import { residentDirective } from '../../shared/resident-instructions.mjs'
import { busyError } from '../rpg/answers.mjs'
import { BUBBLE_MS, RETRY_MS, HIGHLIGHT_MS } from './constants.mjs'
import { josa, readTurn, looksLine } from './text.mjs'
import { resultDiagnostic } from '../llm-budget.mjs'
import { jsonData } from '../llm-json.mjs'
import { cancelAndWait } from '../llm-jobs.mjs'
import { llmErrorText, backoffMs, payloadLost, requestReplaced, ADMISSION_RETRY_MS } from '../llm-errors.mjs'
import { randomUUID } from 'node:crypto'
import { startDecision, pollDecision, modelBudget, modelCall } from './decider.mjs'
import { recordDecision, recordWait } from '../../shared/decision-log.mjs'

// Broadcast chat: the viewer's lines get a reply from the streamer; big dungeon moments get one reaction from a neighbour.
const SIDE_EXPIRE_MS = 5 * 60_000

export function createBroadcastChat({ conai, store, memory, highlights, rpg, gallery, slots, judgeView, roomInstructions }, { streamOf }) {
  const { save, record, event } = store
  const selecting = new WeakSet()
  function sideJob(owner, world, r, kind, message, extra, now) {
    return { kind, from: r.profileId, expiresAt: now + SIDE_EXPIRE_MS, ...extra, jobId: null, createdAt: now, attempts: 0, lastAttempt: 0,
      input: { requestId: `${world.runId}:side:${++world.seq}`, profileId: r.profileId, mode: 'profile', roomKey: slots.roomKey(owner), roomTitle: slots.ofKey(owner).name, message, userName: kind === 'viewer' ? '시청자' : extra.about, maxTokens: replyLengthOf(world.settings), timeoutMs: replyTimeoutMs(world.settings) } }
  }
  function sideFail(owner, world, job, now, message) {
    message = llmErrorText(message)
    if (world.sideJob === job) world.sideJob = null
    const r = world.residents.find(x => x.profileId === job.from)
    for (const id of [job.jobId, job.selection?.jobId].filter(Boolean)) void cancelAndWait(conai, id, world).then(result => {
      if (id === job.jobId) memory.acceptProfileContext(r, job, result)
      if (store.isCurrent(owner, world)) save(owner, world)
    }).catch(error => conai.warn('broadcast cancellation:', error))
    if (job.kind === 'viewer' && r) event(owner, r, `${r.name}의 채팅 답장이 실패했어. ${String(message)}`, now)
  }
  /** Broadcast chat work: the viewer's queued lines first, then a neighbour's reaction to a recent dungeon moment. */
  async function side(owner, world, now) {
    const waiting = world.sideWaiting ??= []
    for (let i = waiting.length - 1; i >= 0; i--) {
      if (now >= waiting[i].expiresAt) {
        sideFail(owner, world, waiting[i], now, '대기열이 가득 차 기다리던 방송 항목의 유효기간이 끝났어.')
        waiting.splice(i, 1)
      }
    }
    if (!world.sideJob) {
      const ready = waiting.findIndex(p => p.retryAt <= now && world.residents.some(r => r.profileId === p.from))
      if (ready >= 0) world.sideJob = waiting.splice(ready, 1)[0]
    }
    const job = world.sideJob
    if (job && !job.jobId && now >= job.expiresAt) { sideFail(owner, world, job, now, '방송 항목의 유효기간이 끝났어.'); return }
    if (job && !job.approved) {
      const r = world.residents.find(r => r.profileId === job.from)
      if (!r) { world.sideJob = null; return }
      const wait = reason => recordWait(world, r, reason, now, { kind: 'broadcast' })
      const budget = modelBudget(rpg.agentWrite, owner, r.profileId, 'social', world, now)
      const retry = error => {
        if (world.sideJob !== job || !world.running) return
        wait(`방송 판단 재시도 대기: ${llmErrorText(error)}`)
        const rejected = busyError(error) || requestReplaced(error)
        job.selectionFailures = (job.selectionFailures ?? 0) + (rejected ? 0 : 1)
        job.retryAt = now + (rejected ? ADMISSION_RETRY_MS : backoffMs(job.selectionFailures))
        if (job.selection?.jobId || requestReplaced(error) || payloadLost(error)) job._decision = null
        job.selection = null; save(owner, world)
      }
      if (selecting.has(job)) { wait('방송 응답 여부 모델 판단을 기다려.'); return }
      if ((job.retryAt ?? 0) > now) return
      try {
        if (!job.selection) {
          job._decision ??= { input: memory.decorate(owner, { profileId: r.profileId, mode: 'text', userName: job.input.userName,
            timeoutMs: job.input.timeoutMs, maxTokens: job.input.maxTokens, requestId: `broadcast:${randomUUID()}`, structuredOutput: { action: 'reply 또는 ignore' },
            message: `${job.input.message}\n답할 의무는 없어. reply(답하기) 또는 ignore(답하지 않기)를 네가 정해.` }, r.profileId) }
          const input = job._decision.input
          const options = [{ id: 'reply', description: '이 방송 메시지에 답변을 작성해.' }, { id: 'ignore', description: '이 메시지에 답하지 않아. 다른 주민의 반응을 강제하지 않아.' }]
          selecting.add(job); save(owner, world)
          const decider = rpg.read(owner).settings.deciders.social.decider
          Promise.resolve(decider === 'judge' ? judgeView(owner, r.profileId, job.input.message) : null)
            .then(view => startDecision(conai, { profileId: r.profileId, decider,
              state: { message: job.input.message, instructions: r.instructions ?? '', ...view }, options, input, budget, settings: world.settings }))
            .then(async selected => {
              if (!world.running || world.sideJob !== job) { if (selected.jobId) await conai.llm.cancel(selected.jobId).catch(() => {}); return }
              if (selected.wait) { wait(selected.wait); job.retryAt = now + ADMISSION_RETRY_MS }
              else job.selection = selected
              save(owner, world)
            }).catch(retry).finally(() => selecting.delete(job))
          return
        }
        const output = await pollDecision(conai, job.selection)
        if (!output) { wait('방송 응답 여부 모델 판단을 기다려.'); return }
        if (!['reply', 'ignore'].includes(output.action)) throw new Error('방송 응답 선택이 유효하지 않아.')
        recordDecision(world, r, { kind: 'broadcast', chosen: { action: output.action, category: 'social', label: output.action },
          method: job.selection.route?.decider, engine: job.selection.route?.engine, model: job.selection.route?.model, status: 'done' }, now)
        if (output.action === 'ignore') { world.sideJob = null; return }
        job.approved = true
      } catch (error) { retry(error) }
      return
    }
    if (job && !job.jobId) {
      // Build outside-memory context only after this resident's conversation has finished.
      if (world.conversations?.some(c => c.pending?.from === job.from)) return
      if (job.queueBlocked) {
        delete job.queueBlocked; job.expiresAt ??= job.createdAt + SIDE_EXPIRE_MS
        job.retryAt = now; waiting.push(job); world.sideJob = null
        return
      }
      if (now >= job.expiresAt) { sideFail(owner, world, job, now, '방송 항목의 유효기간이 끝났어.'); return }
      if (now - job.lastAttempt < RETRY_MS) return
      job.attempts++; job.lastAttempt = now; save(owner, world)
      try {
        if (!job.checkpoint) {
          const resident = world.residents.find(r => r.profileId === job.from)
          const { threadId } = await conai.llm.room({ profileId: job.from, roomKey: job.input.roomKey, roomTitle: job.input.roomTitle })
          if (!world.running || world.sideJob !== job) return
          const context = memory.profileContext(owner, resident, job.input.message, { roomKey: job.input.roomKey, threadId, kind: 'broadcast' })
          job.input.expectedThreadId = threadId
          job.input.message = context.message; job.checkpoint = context.checkpoint; job.instructions = residentDirective(resident)
        }
        if (job.instructions) roomInstructions.set(job.input.expectedThreadId, job.instructions)
        const budget = modelBudget(rpg.agentWrite, owner, job.from, 'social', world, now)
        const started = await modelCall(() => conai.llm.start(jsonData(job.input)), budget)
        if (!started) { const r = world.residents.find(r => r.profileId === job.from); if (r) recordWait(world, r, budget.reason(), now, { kind: 'broadcast' }); return }
        if (!world.running || world.sideJob !== job) { await conai.llm.cancel(started.jobId).catch(() => {}); return }
        job.jobId = started.jobId
      } catch (error) {
        if ((busyError(error) || payloadLost(error) || requestReplaced(error)) && world.sideJob === job) {
          job.attempts--
          job.retryAt = now + ADMISSION_RETRY_MS
          if (!busyError(error)) job.input.requestId = `side:${randomUUID()}`
          waiting.push(job); world.sideJob = null
          event(owner, null, `${llmErrorText(error)} ${Math.ceil((job.retryAt - now) / 1000)}초 뒤, 항목 유효기간 안에서 다시 접수해.`, now)
          save(owner, world)
        }
        else if (world.sideJob === job && job.attempts >= 3) sideFail(owner, world, job, now, error.message)
      }
      return
    }
    if (job) {
      let result
      try { result = await conai.llm.get(job.jobId) } catch (error) { if (world.sideJob === job) sideFail(owner, world, job, now, error.message); return }
      if (world.sideJob !== job) return
      memory.acceptProfileContext(world.residents.find(r => r.profileId === job.from), job, result)
      if (result.status === 'queued' || result.status === 'running') {
        if (replyExpired(job.createdAt, job.input.timeoutMs, now)) { await conai.llm.cancel(job.jobId).catch(() => {}); sideFail(owner, world, job, now, replyTimeoutMessage(job.input.timeoutMs)) }
        return
      }
      const turn = result.status === 'completed' ? readTurn(result.result) : null
      if (!turn?.say) { sideFail(owner, world, job, now, result.error || '답변이 중단됐어.'); return }
      world.sideJob = null
      const r = world.residents.find(x => x.profileId === job.from)
      if (!r) return
      if (result.result?.profileRun?.followUpFailed || result.result?.profileRun?.incompleteMessageIds?.length) event(owner, r, '첫 발언은 남겼지만 후속 답변을 마치지 못했어.', now)
      gallery.collect(owner, result.result?.profileRun, r, now, job.jobId)
      r.agentBudgetDiagnostic = resultDiagnostic(conai, result.result, r.agentBudgetDiagnostic)
      if (job.kind === 'viewer') {
        record(owner, 'say', job.input.requestId, r.profileId, r.name, '시청자', turn.say, now, turn)
        memory.remember(owner, [r.profileId], line(now, '방송 채팅', `시청자 → ${r.name}: "${job.text}" / ${r.name} → 시청자: "${turn.say}"`), now, { knownFor: [r.profileId] })
      } else {
        record(owner, 'react', job.input.requestId, r.profileId, r.name, job.about, turn.say, now, turn)
        const watching = words => `${josa(r.name, "이", "가")} ${job.about}의 방송을 보며: "${words}" (장면: ${job.text})`
        memory.remember(owner, [r.profileId, job.aboutId], line(now, '방송 채팅', watching(turn.say)), now, { knownFor: [r.profileId] })
      }
      if (!r.away) { r.bubble = turn.say; r.bubbleUntil = now + BUBBLE_MS }
      return
    }
    world.side = (world.side ?? []).filter(t => now - t.at < SIDE_EXPIRE_MS && world.residents.some(r => r.profileId === t.profileId))
    const task = world.side.shift()
    if (task) {
      const r = world.residents.find(x => x.profileId === task.profileId), stream = streamOf(owner, r)
      r.addressedAt = task.at
      const message = [
        `너는 작은 마을에 사는 주민 ${r.name}이야. 지금 네 모습이 마을 방송으로 생중계되고 있어. 방송 화면: ${stream || `${placeOf(r)}에서 지내는 중`}.`,
        looksLine(await rpg.profilesNow(now), [r]),
        `방송을 보던 시청자가 채팅으로 말했어: "${task.text}"`,
        '방송 중인 너답게 시청자에게 답해줘. 프로필 언어로 네 성격을 살려 이야기해. 다른 사람의 대사, 이름표, 분석, 지시문, JSON은 쓰지 마. 이미지·로어 등은 네 프로필 도구와 판단 설정대로 사용해.',
      ].filter(Boolean).join('\n')
      world.sideJob = sideJob(owner, world, r, 'viewer', message, { text: task.text, expiresAt: task.at + SIDE_EXPIRE_MS }, now)
      return
    }
    const h = highlights.get(owner)
    if (!h || now - h.at > HIGHLIGHT_MS) return
    highlights.delete(owner)
    const watchers = world.residents.filter(o => o.profileId !== h.profileId && !o.away && !o.asleep && !busy(world, o))
    if (!watchers.length) return
    const streamer = world.residents.find(o => o.profileId === h.profileId)
    for (const r of watchers) {
    const message = [
      `너는 작은 마을에 사는 주민 ${r.name}이야. ${placeOf(r)}에서 마을 방송으로 ${h.name}의 던전 생중계를 보고 있어.`,
      `방금 방송에 나온 장면: ${h.text}`,
      looksLine(await rpg.profilesNow(now), [r, streamer]),
      '방송 채팅에 남길 반응을 네 성격과 프로필 언어대로 써줘. 다른 사람의 대사, 이름표, 분석, 지시문, JSON은 쓰지 마. 이미지·로어 등은 네 프로필 도구와 판단 설정대로 사용해.',
    ].filter(Boolean).join('\n')
    waiting.push({ ...sideJob(owner, world, r, 'react', message, { about: h.name, aboutId: h.profileId, text: h.text }, now), retryAt: now })
    }
  }

  return side
}
