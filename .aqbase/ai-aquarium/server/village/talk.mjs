import { endConversation, placeOf, busy, freeNear, talkKey, pairKeys, resting } from './world.mjs'
import { availableActions, actionContext, residentContext, changeStatuses, budgetMode, budgetReason, definitionsFor } from '../../shared/agents.mjs'
import { recordWait, recordDecision } from '../../shared/decision-log.mjs'
import { resultDiagnostic, dataLine } from '../llm-budget.mjs'
import { llmErrorText, payloadLost, requestReplaced, hostStatus, ADMISSION_RETRY_MS } from '../llm-errors.mjs'
import { jsonData } from '../llm-json.mjs'
import { startDecision, pollDecision, judgeConversation, errorText, modelBudget, modelCall, conversationBudget, JUDGE_WINDOW } from './decider.mjs'
import { EARSHOT, replyLengthOf, replyTimeoutMs, replyTimeoutMessage, replyExpired } from '../../shared/village-settings.mjs'
import { clockOf } from '../../shared/clock.mjs'
import { shiftsOf, shiftLabel, weekdayOf } from '../../shared/schedule.mjs'
import { hasFacility } from '../../shared/rpg-systems.mjs'
import { line } from '../memory/memory.mjs'
import { residentDirective } from '../../shared/resident-instructions.mjs'
import { busyError } from '../rpg/answers.mjs'
import { AWAY, BUBBLE_MS, RETRY_MS, HIGHLIGHT_MS, POSTS } from './constants.mjs'
import { josa, dayOf, readTurn, looksLine } from './text.mjs'
import { cancelAndWait } from '../llm-jobs.mjs'

const TURN_GAP_MS = 1_500
const REPEAT_REST_MINUTES = 6 * 60 // game minutes the same residents wait to talk again after a copied line
const PHASE_TEXT = { travel: '던전에 들어가는 중', explore: '탐험하는 중', consider: '계속 갈지 고민하는 중', combat: '전투 중', return: '출구로 돌아가는 중' }

const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= EARSHOT

/** Resident conversations use native profile rooms; only aquarium context and effects live here. */
export function createTalk({ conai, random, store, rpg, memory, gallery, highlights, slots, judgeView, roomInstructions }) {
  const { save, record, event } = store
  const working = new WeakSet()
  const sync = world => { world.conversation = world.conversations?.[0] ?? null; world.pending = world.conversations?.find(c => c.pending)?.pending ?? null }
  const current = (world, c) => world.running && world.conversations?.includes(c)
  const budget = (owner, profileId, world, now, c) => conversationBudget(modelBudget(rpg.agentWrite, owner, profileId, 'social', world, now), c.admission ??= {})
  const wait = (world, r, reason, now) => { if (r) recordWait(world, r, reason, now) }
  const cancelPending = async (world, pending) => {
    if (!pending?.jobId) return
    const job = await cancelAndWait(conai, pending.jobId, world)
    memory.acceptProfileContext(world.residents.find(r => r.profileId === pending.from), pending, job)
  }
  conai.tools.register({
    name: 'turn', scope: 'organize',
    description: 'Apply one aquarium conversation effect during the host-bound resident turn. Speech needs no tool. Each kind executes once per turn; changed retries are rejected.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['kind'], properties: {
      kind: { type: 'string', enum: ['act', 'reply', 'end', 'statuses'] },
      act: { type: 'object', additionalProperties: false, required: ['id', 'target'], properties: { id: { type: 'string' }, target: { type: 'integer' }, item: { type: 'string' }, amount: { type: 'integer' }, kind: { type: 'string', enum: ['item', 'gold', 'help', 'accompany'] }, place: { type: 'string' }, detail: { type: 'string' } } },
      reply: { type: 'object', additionalProperties: false, required: ['requestId', 'answer'], properties: { requestId: { type: 'string' }, answer: { type: 'string', enum: ['accept', 'refuse'] }, reason: { type: 'string' } } },
      statuses: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'value'], properties: { id: { type: 'string' }, value: { type: ['number', 'string'] } } } },
    } },
    handler: (args, context) => {
      const owner = slots.active(store.ownerOf(context.account)), world = store.load(owner)
      const run = context.run
      const c = run && world.conversations?.find(c => c.pending?.input.requestId === run.requestId && c.pending.from === run.profileId), p = c?.pending
      if (!c || !p || !current(world, c) || !p.attempts || p.input.mode !== 'profile' || p.input.roomKey !== slots.roomKey(owner) ||
          (p.threadId && p.threadId !== run.threadId)) throw new Error('활성 대화 차례가 아니야.')
      if (world.revision !== p.revision || rpg.read(owner).configRevision !== p.gameRevision) throw new Error('대화 설정이 바뀌었어. 새 차례를 기다려.')
      if (!['act', 'reply', 'end', 'statuses'].includes(args.kind)) throw new Error('없는 대화 효과야.')
      const fingerprint = JSON.stringify(args[args.kind] ?? null), previous = p.effects?.[args.kind]
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new Error('이미 실행한 대화 효과를 다른 내용으로 재시도할 수 없어.')
        return { ...previous.result, repeated: true }
      }
      const from = world.residents.find(r => r.profileId === p.from), now = Date.now()
      if (!from || from.away || from.asleep) throw new Error('말하는 주민이 자리에 없어.')
      memory.acceptProfileContext(from, p, { ...run, delivery: { threadId: run.threadId } })
      let result = { applied: true }
      if (args.kind === 'act') {
        if (!p.offered.includes(args.act?.id) || !c.participants.includes(args.act?.target) || args.act.target === p.from) throw new Error('이 차례에 허용되지 않은 교류나 상대야.')
        result = rpg.interact(owner, p.from, args.act, `${p.input.requestId}:act`, now)
      } else if (args.kind === 'reply') {
        if (!args.reply?.requestId) throw new Error('받은 요청 ID가 필요해.')
        result = rpg.replyRequest(owner, args.reply.requestId, p.from, args.reply.answer, args.reply.reason, now)
      } else if (args.kind === 'statuses') {
        if (!Array.isArray(args.statuses)) throw new Error('상태 변경 목록이 필요해.')
        rpg.agentWrite(owner, s => {
          const a = s.actors.find(a => a.profileId === p.from)
          if (!a || a.profileJudge?.fields?.enabled === false) throw new Error('이 주민의 상태 변경은 꺼져 있어.')
          for (const update of args.statuses) {
            const d = definitionsFor(s, a).find(d => d.id === update.id && d.enabled && !d.valueReadonly)
            if (!d || (d.builtin && !['mood', 'social'].includes(d.id))) throw new Error('실제 행동이 필요하거나 수정할 수 없는 상태야.')
            if (d.kind === 'number' ? !Number.isFinite(update.value) : !d.values.includes(update.value)) throw new Error('상태 값이 정의에 맞지 않아.')
          }
          for (const update of args.statuses) {
            const d = definitionsFor(s, a).find(d => d.id === update.id)
            changeStatuses(s, a, { [d.id]: d.kind === 'number' ? update.value - a.statuses[d.id] : update.value }, d.kind === 'choice')
          }
        })
      } else p.end = true
      if (!result.repeated) {
        const effect = result.result ?? (args.kind === 'end' ? `${from.name}가 대화를 마치기로 했어.` : args.kind === 'act'
          ? `${from.name} → ${world.residents.find(r => r.profileId === args.act.target)?.name ?? args.act.target}: ${result.action?.label ?? args.act.id} 제안` : `${from.name}의 상태 변경: ${JSON.stringify(args.statuses)}`)
        event(owner, from, effect, now)
        memory.remember(owner, c.participants, line(now, placeOf(from), effect), now, { knownFor: [p.from] })
        recordDecision(world, from, { id: `${p.input.requestId}:${args.kind}`, kind: 'conversation', status: 'done',
          chosen: { action: args.kind, category: 'social' }, method: 'chat', effect }, now)
      }
      ;(p.effects ??= {})[args.kind] = { fingerprint, result }
      save(owner, world)
      return result
    },
  })
  function begin(owner, world, a, b, now) {
    world.conversations ??= []
    if (world.memoryBacklogged) { wait(world, a, '기억 정리가 밀려 새 판단과 대화를 기다리고 있어.', now); return false }
    if (a === b || a.away || b.away || a.asleep || b.asleep || a.agentJob || b.agentJob || b.intention || busy(world, a) || busy(world, b) || world.conversations.length >= rpg.read(owner).settings.maxConversations) return false
    for (const [k, until] of Object.entries(world.talkRest ?? {})) if (until <= world.clock) delete world.talkRest[k]
    if (resting(world, a.profileId, b.profileId)) return false
    for (const r of [a, b]) { r.path = []; const p = freeNear(world, r, r); r.x = p.x; r.y = p.y; r.activity = 'talk' }
    world.conversations.push({ id: `${world.runId}:conversation:${++world.seq}`, a: a.profileId, b: b.profileId, participants: [a.profileId, b.profileId],
      speaker: a.profileId, turn: 0, consecutive: 0, lines: [], nextAt: now, pending: null })
    sync(world)
    event(owner, a, `${a.name}와 ${b.name}가 이야기를 시작했어`, now)
    return true
  }
  /** Who else is close enough to `r` to hear or see what it does. */
  const bystanders = (world, r, ...except) => world.residents.filter(o => o !== r && !o.away && !o.asleep && !except.includes(o) && near(o, r))

  /** What a resident's broadcast shows right now, or '' when it is not in the dungeon. */
  function streamOf(owner, r) {
    const game = rpg.read(owner)
    if (!game.settings.enabled) return ''
    const actor = game.actors.find(a => a.active && a.profileId === r.profileId)
    if (actor?.phase === 'dead') return '던전에서 쓰러져 부활을 기다리는 중'
    const e = actor?.expedition
    if (!e || !AWAY.has(actor.phase)) return ''
    const zone = game.zones.find(z => z.id === e.zoneId)
    return `던전 ${zone?.floor ?? '?'}층 ${zone?.name ?? ''}에서 ${PHASE_TEXT[actor.phase] ?? '탐험하는 중'}${actor.phase === 'combat' && e.monster ? ` (${josa(e.monster.name, '과', '와')} 싸우는 중)` : ''}`
  }
  /** One line of broadcast news for village talk; free, it only rides along in the turn that is made anyway. */
  function newsOf(owner, world, now, ...except) {
    const live = world.residents.filter(o => o.away && !except.includes(o)).map(o => { const s = streamOf(owner, o); return s && `${o.name}(${s})` }).filter(Boolean)
    const h = highlights.get(owner), fresh = h && now - h.at < HIGHLIGHT_MS ? ` 방금 방송에 나온 장면: ${h.text}.` : ''
    return live.length || fresh ? `마을 방송:${live.length ? ` 지금 ${live.join(', ')} 모습이 생중계되고 있어.` : ''}${fresh} 화제로 삼아도 되고 안 해도 돼.` : ''
  }

  function fail(owner, world, c, now, message) {
    const replaced = requestReplaced(message)
    message = llmErrorText(message)
    if (Object.keys(c.pending?.effects ?? {}).length) message += ' 발언은 끝내지 못했지만 이미 적용한 교류·상태·종료 효과는 기록대로 유지해.'
    if (!replaced) {
      for (const id of c.participants) {
        const r = world.residents.find(r => r.profileId === id)
        if (r) recordDecision(world, r, { kind: 'conversation', status: 'failed', chosen: { action: 'end', category: 'social' },
          reason: `다음 차례를 진행할 수 없어 대화를 종료했어. ${message}`, failure: message }, now)
      }
      for (const pending of [c.pending, c.nextChoice]) void cancelPending(world, pending)
        .then(() => { if (store.isCurrent(owner, world)) save(owner, world) }).catch(error => conai.warn('conversation cancellation:', error))
      endConversation(world, now, random, c); sync(world)
      event(owner, null, `대화를 종료했어. ${message}`, now)
      return
    }
    c.pending = null
    delete c.admission
    const r = world.residents.find(r => r.profileId === c.speaker)
    if (c.nextChoice) {
      c.selection = { from: c.nextChoice.from ?? c.speaker, to: c.participants.find(id => id !== c.speaker), stage: 'next', requestId: `${world.runId}:${++world.seq}` }
      c.nextChoice = null
    }
    if (r) { wait(world, r, `모델 응답 재시도 대기: ${message}`, now); r.agentError = message; r.agentFailures = (r.agentFailures ?? 0) + (replaced ? 0 : 1); c.nextAt = now + (replaced ? ADMISSION_RETRY_MS : Math.min(120_000, 5000 * 2 ** Math.min(5, r.agentFailures))) }
    sync(world)
    event(owner, null, `대화를 잠시 쉬어. ${message}`, now)
  }

  async function submit(owner, world, now, c = world.conversation) {
    const p = c.pending
    p.lastAttempt = now; p.attempts++
    if (p.instructions) roomInstructions.set(p.input.expectedThreadId, p.instructions)
    save(owner, world) // Keep the request identity before crossing the host boundary; retries reuse it.
    try {
      const job = await modelCall(() => conai.llm.start(jsonData(p.input)), budget(owner, p.from, world, now, c))
      if (!job) { fail(owner, world, c, now, budget(owner, p.from, world, now, c).reason()); return }
      if (!current(world, c) || c.pending !== p) {
        const final = await cancelAndWait(conai, job.jobId, world)
        memory.acceptProfileContext(world.residents.find(r => r.profileId === p.from), p, final)
        return
      }
      p.jobId = job.jobId
    } catch (error) {
      if (requestReplaced(error)) { fail(owner, world, c, now, error); return }
      if ([400, 401, 403, 404].includes(hostStatus(error))) { fail(owner, world, c, now, error); return }
      wait(world, world.residents.find(r => r.profileId === p.from), `모델 응답 재시도 대기: ${errorText(error)}`, now)
      if (busyError(error)) p.attempts-- // the host is busy, not broken: try again on the next poll
      else if (c.pending === p && (payloadLost(error) || p.attempts >= 3)) fail(owner, world, c, now, `답변을 시작하지 못했어. ${error.message}`)
    }
  }

  /** A staff resident's job, hours and purse for its talk prompt; empty for everyone else. */
  const dutyLine = (owner, world, r) => {
    const game = rpg.read(owner)
    if (!game.settings.enabled) return ''
    const actor = game.actors.find(a => a.active && a.profileId === r.profileId), shift = actor && shiftsOf(game.settings)[actor.role]
    if (!shift || !hasFacility(game, actor.role)) return ''
    const now = shift.off.includes(weekdayOf(world.clock)) ? '오늘은 쉬는 날이야.' : r.posted ? '지금은 근무 중이야.' : '지금은 근무 시간이 아니야.'
    return `너는 마을의 ${POSTS[actor.role]}이야. 근무 시간은 ${shiftLabel(shift)}. ${now} 가진 돈은 ${actor.gold}G.`
  }

  /**
   * A reply identical to a line the same resident already said in this or the previous conversation of these residents.
   * Recording it would feed the room history the same line again, so the model keeps copying it.
   */
  const sameLine = text => String(text ?? '').normalize('NFC').replace(/\s+/g, ' ').trim()
  const repeatsOwnLine = (world, c, r, say) => {
    if (!r) return false
    const text = sameLine(say), mine = l => l.profileId === r.profileId || (l.profileId === undefined && l.name === r.name)
    const previous = c.participants.filter(id => id !== r.profileId).flatMap(id => world.recentTalks?.[talkKey([r.profileId, id])] ?? [])
    return [...c.lines, ...previous].some(l => mine(l) && sameLine(l.text) === text)
  }

  /** How a conversation starts: a fresh topic, or a follow-up of what the same residents said last time. */
  function opener(world, c, to) {
    const last = world.recentTalks?.[talkKey(c.participants)]
    if (!last?.length) return `${to.name}에게 네 목표에 맞는 이야기를 꺼내줘.`
    return `${to.name}와 지난번에 나눈 마지막 말: ${last.map(l => `${l.name}: "${l.text}"`).join(' / ')}\n이 말을 되풀이하지 말고, 그 뒤로 새로 생긴 일이나 다른 화제로 ${to.name}에게 이야기를 꺼내줘.`
  }

  async function speak(owner, world, now, c = world.conversation) {
    const from = world.residents.find(r => r.profileId === c.speaker)
    const to = world.residents.find(r => c.participants.includes(r.profileId) && r !== from && !r.away && !r.asleep)
    if (!from || !to) { endConversation(world, now, random, c); return }
    if (world.sideJob?.from === from.profileId && world.sideJob.jobId) {
      c.nextAt = now + ADMISSION_RETRY_MS
      wait(world, from, '이 주민의 방송 답변이 끝나면 이어서 이야기해.', now)
      return
    }
    const game = rpg.read(owner), actor = game.actors.find(a => a.profileId === from.profileId)
    if (c.admission?.turn !== c.turn || c.admission?.profileId !== from.profileId) c.admission = { turn: c.turn, profileId: from.profileId }
    const offered = availableActions(game, 'social').map(a => a.id)
    const capped = budgetReason(game, actor, 'social', world.clock, now, false)
    if (capped) { fail(owner, world, c, now, capped); return }
    if (!c.admission.ticket && (actor.agentBudget?.social?.nextAt ?? 0) > now) { c.nextAt = actor.agentBudget.social.nextAt; wait(world, from, budgetReason(game, actor, 'social', world.clock, now), now); return }
    const mode = budgetMode(game, actor, 'social', world.clock, now, !c.admission.ticket)
    if (mode === 'wait' && !c.admission.ticket) { wait(world, from, budgetReason(game, actor, 'social', world.clock, now), now); c.nextAt = now + RETRY_MS; return }
    if (!current(world, c) || world.memoryBacklogged) return
    const others = bystanders(world, from, to).map(r => r.name)
    const looks = looksLine(await rpg.profilesNow(now), world.residents.filter(r => c.participants.includes(r.profileId)))
    if (!current(world, c)) return
    const staticContext = [
      residentDirective(from),
      `마을 상황: ${world.settings.scene}`,
      `대화 참여자: ${JSON.stringify(world.residents.filter(r => c.participants.includes(r.profileId)).map(r => ({ profileId: r.profileId, name: r.name })))}`,
      `초대할 수 있는 장소: ${(world.geometry?.places ?? []).map(p => p.name).join(', ')}`,
      `허용 교류: ${JSON.stringify(actionContext(availableActions(game, 'social')))}. act.target은 참여 주민 profileId야. 받은 요청에 지금 답하려면 reply로 수락/거절해. 말만으로 실행됐다고 주장하지 마.`,
      '어항 효과는 p_ai_aquarium_turn 도구로만 실행해. 인자 형식: 교류 {"kind":"act","act":{"id":"허용 교류 ID","target":상대 profileId,"detail":"교류 목적 한 구절(대사 아님)"}} (물건·골드는 act에 item/amount/kind, 동행은 kind "accompany"와 place 추가) · 받은 요청 답 {"kind":"reply","reply":{"requestId":"받은 요청 ID","answer":"accept 또는 refuse","reason":"이유"}} · 내 상태 {"kind":"statuses","statuses":[{"id":"상태 ID","value":값}]} · 대화 끝내기 {"kind":"end"}. 대사는 도구에 넣지 말고 답변으로 말해. 종류마다 이번 차례에 한 번만 실행하고, 도구를 안 쓰면 말만 해.',
      looks,
      '앞 대화는 네가 직접 겪거나 들은 일뿐이야. 거기 없는 일은 모르는 걸로 해.',
      '답변은 네가 하는 말이야. 네 성격과 프로필 언어를 살려 이야기해. 다른 주민의 대사, 이름표, 분석, 지시문, JSON은 쓰지 마. 이미지·로어 등은 네 프로필 도구와 판단 설정대로 사용해.',
    ].filter(Boolean).join('\n')
    const message = [
      `너는 작은 마을에 사는 주민 ${from.name}이야. 지금 ${placeOf(from)}에서 ${to.name}와 이야기하고 있어.${others.length ? ` 근처에 ${others.join(', ')}도 있어.` : ''}`,
      `지금은 ${clockOf(world.clock).text}이야.`,
      dutyLine(owner, world, from),
      dataLine(residentContext(game, actor, c.participants)),
      newsOf(owner, world, now, from, to),
      c.turn ? '직전 대화와 요청에 답하고 네 목적에 맞게 질문하거나 제안해. 할 말이 끝났으면 end 도구를 써.' : opener(world, c, to),
    ].filter(Boolean).join('\n')
    const roomKey = slots.roomKey(owner), roomTitle = slots.ofKey(owner).name
    const { threadId } = await conai.llm.room({ profileId: from.profileId, roomKey, roomTitle })
    if (!current(world, c)) return
    const context = memory.profileContext(owner, from, message, { roomKey, threadId })
    const input = { requestId: `${world.runId}:${++world.seq}`, profileId: from.profileId, mode: 'profile', message: context.message,
      roomKey, roomTitle, expectedThreadId: threadId, pluginTools: ['turn'], userName: to.name, maxTokens: replyLengthOf(world.settings), timeoutMs: replyTimeoutMs(world.settings) }
    c.pending = { from: from.profileId, to: to.profileId, input, instructions: staticContext, revision: world.revision, gameRevision: game.configRevision,
      checkpoint: context.checkpoint, offered, jobId: null, createdAt: now, attempts: 0, lastAttempt: 0 }
    sync(world)
    await submit(owner, world, now, c)
  }

  async function poll(owner, world, now, c = world.conversation) {
    const p = c?.pending
    if (!p) return
    if (!p.jobId) {
      if (replyExpired(p.createdAt, p.input.timeoutMs, now)) fail(owner, world, c, now, replyTimeoutMessage(p.input.timeoutMs))
      else if (now - p.lastAttempt >= RETRY_MS) await submit(owner, world, now, c)
      return
    }
    let job
    try { job = await conai.llm.get(p.jobId) } catch (error) { if (c.pending === p) fail(owner, world, c, now, error.message); return }
    if (!current(world, c) || c.pending !== p) return
    memory.acceptProfileContext(world.residents.find(r => r.profileId === p.from), p, job)
    if (job.status === 'queued' || job.status === 'running') {
      if (replyExpired(p.createdAt, p.input.timeoutMs, now)) { await conai.llm.cancel(p.jobId).catch(() => {}); fail(owner, world, c, now, replyTimeoutMessage(p.input.timeoutMs)) }
      return
    }
    if (job.status === 'cancelled') { fail(owner, world, c, now, '답변 작업이 취소됐어.'); return }
    const speaker = world.residents.find(r => r.profileId === p.from)
    if (speaker && job.result?.profileRun) gallery.collect(owner, job.result.profileRun, speaker, now, p.jobId)
    if (speaker && (job.result?.profileRun?.followUpFailed || job.result?.profileRun?.incompleteMessageIds?.length)) event(owner, speaker, '첫 발언은 남겼지만 후속 답변을 마치지 못했어.', now)
    const turn = job.status === 'completed' ? readTurn(job.result) : null
    if (job.status === 'completed' && p.end && !turn?.say) { endConversation(world, now, random, c); sync(world); return }
    if (!turn?.say) { fail(owner, world, c, now, job.error || '답변이 중단됐어.'); return }
    if (repeatsOwnLine(world, c, speaker, turn.say)) {
      // Every pair of these residents rests for a while in game time, so the copied line is not requested again right away.
      world.talkRest ??= {}
      for (const k of pairKeys(c.participants)) world.talkRest[k] = world.clock + REPEAT_REST_MINUTES
      // The discarded input also delivered the speaker's memory/lore checkpoint and its own tool effects:
      // the next turn resends the full context instead of only rows after that checkpoint.
      if (speaker) speaker.profileMemory = null
      // Drop the copied reply from the resident's room history too, or the next turn copies it again.
      await conai.llm.discard({ jobId: p.jobId }).catch(error => conai.warn('repeated reply discard:', error))
      if (!current(world, c) || c.pending !== p) return
      fail(owner, world, c, now, '방금까지 한 말과 똑같은 대사라 기록하지 않고 대화를 마쳤어. 이 주민들은 게임 시간 6시간 동안 새 대화를 쉬어.')
      return
    }
    c.pending = null; sync(world)
    const from = world.residents.find(r => r.profileId === p.from), to = world.residents.find(r => r.profileId === p.to)
    if (!from || !to) { endConversation(world, now, random, c); return }
    record(owner, 'say', p.input.requestId, from.profileId, from.name, to.name, turn.say, now, turn)
    recordDecision(world, from, { id: p.input.requestId, kind: 'conversation', status: 'done',
      chosen: { action: p.end ? 'end' : p.effects?.act?.result?.action?.id ?? 'speak', category: 'social', target: to.profileId, targetName: to.name },
      method: 'chat', engine: job.result?.engine, model: job.result?.model, effect: turn.say }, now)
    from.agentBudgetDiagnostic = resultDiagnostic(conai, job.result, from.agentBudgetDiagnostic)
    const place = placeOf(from), saying = words => `${from.name} → ${to.name}: "${words}"`
    memory.remember(owner, [from.profileId, to.profileId], line(now, place, saying(turn.say)), now, { knownFor: [from.profileId] })
    const overheard = bystanders(world, from, to).map(r => r.profileId)
    if (overheard.length) memory.remember(owner, overheard, line(now, place, `(근처에서 들림) ${saying(turn.say)}`), now)
    from.bubble = turn.say; from.bubbleUntil = now + BUBBLE_MS
    const day = dayOf(now)
    world.daily = world.daily?.day === day ? { day, count: world.daily.count + 1 } : { day, count: 1 }
    from.agentFailures = 0; from.agentError = null
    c.lines.push({ from: 'character', profileId: from.profileId, name: from.name, text: turn.say }); c.lines = c.lines.slice(-40); c.turn++
    rpg.agentWrite(owner, s => { for (const a of s.actors.filter(a => [from.profileId, to.profileId].includes(a.profileId))) changeStatuses(s, a, { social: 5 }, false, 'rule') })
    if (p.end || c.turn >= rpg.read(owner).settings.conversationMaxTurns) { endConversation(world, now, random, c); return }
    c.selection = { from: from.profileId, to: to.profileId, requestId: p.input.requestId }
    save(owner, world)
    await selectSpeaker(owner, world, c, now)
  }
  async function selectSpeaker(owner, world, c, now) {
    const p = c.selection, from = world.residents.find(r => r.profileId === p.from), to = world.residents.find(r => r.profileId === p.to)
    if (!from || !to) { endConversation(world, now, random, c); return }
    const game = rpg.read(owner), actor = game.actors.find(a => a.profileId === from.profileId)
    try {
    c.nextAt = now + TURN_GAP_MS
    const candidates = world.residents.filter(r => r !== from && !r.agentJob && !r.intention && !r.away && !r.asleep && near(from, r) &&
      (c.participants.includes(r.profileId) || (!busy(world, r) && !c.participants.some(id => resting(world, r.profileId, id)))))
    const options = [...candidates.map(r => ({ id: `resident_${r.profileId}`, label: r.name, description: `${r.name}가 이어서 답하고 필요하면 대화에 참여` })), { id: 'end', description: '대화 종료' }]
    const instructions = String(actor.profileJudge?.room?.next?.enabled ? actor.profileJudge.room.next.instructions : '내용상 아직 답·질문·목적이 남으면 적절한 주민이 이어서 말해. 대화가 끝났으면 end.')
    const nextState = { conversation: judgeConversation(c.lines, from, actor.profileJudge?.room?.window ?? JUDGE_WINDOW, conai),
      resident: { profileId: from.profileId, name: from.name, goal: actor.goal ?? '' }, instructions: from.instructions ?? '',
      scene: world.settings.scene, timeText: clockOf(world.clock).text }
    const input = p.choiceInput ??= memory.decorate(owner, { requestId: `${p.requestId}:next`, profileId: from.profileId, timeoutMs: replyTimeoutMs(world.settings), maxTokens: replyLengthOf(world.settings), structuredOutput: { action: 'resident_ID 또는 end' },
      message: `${instructions}\n${dataLine(nextState)}\n행동 선택지: ${JSON.stringify(options)}` }, from.profileId, { purpose: 'decision', settings: world.settings })
    // The state already carries the conversation, so the judge gets the character, summary and lore, not memory lines.
    if (game.settings.deciders.social.decider === 'judge') Object.assign(nextState, await judgeView(owner, from.profileId, nextState.conversation.map(l => l.text).join('\n'), { window: 0 }))
    nextState.requests = residentContext(game, actor).requests
    p.candidates ??= candidates.map(r => r.profileId)
    const nextChoice = await startDecision(conai, { profileId: from.profileId, decider: game.settings.deciders.social.decider, state: nextState,
      options, input, instructions, settings: world.settings, onDiagnostic: d => { from.agentBudgetDiagnostic = d; save(owner, world) }, budget: budget(owner, from.profileId, world, now, c) })
    if (!current(world, c)) { if (nextChoice.jobId) await conai.llm.cancel(nextChoice.jobId).catch(() => {}); return }
    if (nextChoice.wait) { fail(owner, world, c, now, nextChoice.wait); return }
    c.nextChoice = nextChoice
    c.nextChoice.from = from.profileId
    c.nextChoice.candidates = p.candidates
    c.nextChoice.threshold = actor.profileJudge?.room?.next?.enabled ? actor.profileJudge.room.next.continueThreshold : 0
    c.nextChoice.createdAt = now; c.nextChoice.timeoutMs = input.timeoutMs
    c.selection = null; save(owner, world)
    } catch (error) {
      if (requestReplaced(error)) {
        p.choiceInput = null; p.requestId = `${world.runId}:${++world.seq}`; c.nextAt = now + ADMISSION_RETRY_MS
        wait(world, from, '플러그인 변경으로 새 대화 진행 판단을 기다려.', now); save(owner, world); return
      }
      if (!busyError(error)) throw error
      // The spoken turn is already committed. Only this selection stage retries.
      wait(world, from, `모델 응답 재시도 대기: ${errorText(error)}`, now)
      c.nextAt = now + RETRY_MS; from.agentError = errorText(error); save(owner, world)
    }
  }
  async function advance(owner, world, c, now) {
    if (c.selection) { if (now >= c.nextAt) await selectSpeaker(owner, world, c, now); return }
    if (c.nextChoice) {
      const n = c.nextChoice
      if (replyExpired(n.createdAt, n.timeoutMs, now)) { if (n.jobId) await conai.llm.cancel(n.jobId).catch(() => {}); throw new Error('대화 진행 판단 시간이 지났어.') }
      const output = await pollDecision(conai, n)
      if (!current(world, c) || !output) return
      const from = world.residents.find(r => r.profileId === n.from)
      if (from) recordDecision(world, from, { kind: 'conversation', chosen: { action: output.action, category: 'social' },
        method: n.route?.decider, engine: n.route?.engine, model: n.route?.model, probability: output.probability, confidence: output.confidence }, now)
      const next = n.candidates.find(id => output.action === `resident_${id}`)
      if (output.action === 'end') { endConversation(world, now, random, c); return }
      if (!next) throw new Error('목록에 없는 다음 발언자야. 새 모델 판단을 기다려.')
      const r = world.residents.find(r => r.profileId === next)
      if (!c.participants.includes(next)) {
        if (!r || r.agentJob || r.intention || busy(world, r) || c.participants.some(id => resting(world, next, id))) throw new Error('고른 상대가 대화할 수 없어. 새 모델 판단을 기다려.')
        c.participants.push(next); r.path = []; r.activity = 'talk'
      }
      c.nextChoice = null
      c.speaker = next
    }
    if (c.pending) await poll(owner, world, now, c)
    else if (!world.memoryBacklogged && now >= c.nextAt) await speak(owner, world, now, c)
  }
  function tick(owner, world, now) {
    if (world.memoryBacklogged) {
      for (const c of world.conversations ?? []) {
        c.backlogSince ??= now
        for (const id of c.participants) wait(world, world.residents.find(r => r.profileId === id), '기억 정리가 밀려 새 판단과 대화를 기다리고 있어.', now)
      }
      return
    }
    for (const c of [...(world.conversations ?? [])]) {
      if (c.backlogSince !== undefined) {
        const elapsed = now - c.backlogSince
        if (c.pending) c.pending.createdAt += elapsed
        if (c.nextChoice) c.nextChoice.createdAt += elapsed
        delete c.backlogSince
      }
      if (working.has(c)) continue
      if (c.participants.some(id => world.residents.some(r => r.profileId === id && (r.away || r.asleep)))) {
        for (const pending of [c.pending, c.nextChoice]) void cancelPending(world, pending)
          .then(() => { if (store.isCurrent(owner, world)) save(owner, world) }).catch(error => conai.warn('conversation cancellation:', error))
        endConversation(world, now, random, c); continue
      }
      working.add(c)
      advance(owner, world, c, now).catch(error => {
        if (!current(world, c)) return
        if (busyError(error)) c.nextAt = now + 5000
        else fail(owner, world, c, now, error)
      }).finally(() => { working.delete(c); sync(world); if (store.isCurrent?.(owner, world) !== false) save(owner, world) })
    }
  }
  async function cancel(world) {
    const jobs = []
    for (const c of [...(world.conversations ?? [])]) {
      if (c.pending?.jobId) jobs.push(c.pending)
      if (c.nextChoice?.jobId) jobs.push(c.nextChoice)
      endConversation(world, Date.now(), random, c)
    }
    await Promise.all(jobs.map(pending => cancelPending(world, pending)))
  }
  return { bystanders, streamOf, newsOf, poll, speak, begin, tick, cancel }
}
