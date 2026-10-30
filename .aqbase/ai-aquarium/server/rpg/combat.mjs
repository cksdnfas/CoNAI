import { navigationOptions, stats } from './rules.mjs'
import { combatOptions } from './resident-options.mjs'
import { replyLengthOf, replyTimeoutMs } from '../../shared/village-settings.mjs'
import { residentContext, budgetMode, budgetReason } from '../../shared/agents.mjs'
import { recordDecision, recordWait } from '../../shared/decision-log.mjs'
import { residentDirective } from '../../shared/resident-instructions.mjs'
import { startDecision, pollDecision, modelBudget, errorText } from '../village/decider.mjs'
import { backoffMs, admissionBusy, requestReplaced, ADMISSION_RETRY_MS } from '../llm-errors.mjs'
import { dataLine } from '../llm-budget.mjs'
import { randomUUID } from 'node:crypto'

/** Independent resident jobs. There is no battle-wide lock or rules fallback. */
export function createCombat({ conai, read, write, withContext, judgeView }) {
  const fights = new Map()
  async function stopFights() {
    const pending = [...fights.values()], jobs = pending.map(f => f.jobId).filter(Boolean); fights.clear()
    for (const p of pending) write(p.owner, s => {
      const a = s.actors.find(a => a.id === p.actorId), e = a?.expedition
      const field = e?.awaiting?.id === p.askId ? 'awaiting' : e?.navigationAsk?.id === p.askId ? 'navigationAsk' : null
      if (field) { e[field] = { id: randomUUID(), round: e[field].round, since: e[field].since }; a.combatRetry = null }
    }, true, false)
    for (const id of jobs) await conai.llm.cancel(id).catch(() => {})
  }
  async function combatStep(owner, world, now) {
    for (const a of read(owner).actors.filter(a => a.active)) {
      const combat = a.phase === 'combat', ask = combat ? a.expedition?.awaiting : a.phase === 'explore' ? a.expedition?.navigationAsk : null
      const key = `${owner}:${a.id}`, r = world.residents.find(r => r.profileId === a.profileId), kind = combat ? 'combat' : 'expedition'
      const wait = reason => { if (r) recordWait(world, r, reason, now, { kind }) }
      let p = fights.get(key)
      if (p && p.askId !== ask?.id) {
        fights.delete(key); if (p.jobId) await conai.llm.cancel(p.jobId).catch(() => {}); p = null
      }
      if (!ask || a.expedition?.choice || a.expedition?.navigationChoice) continue
      if (world.memoryBacklogged) { wait('기억 정리가 밀려 모델 판단을 기다리고 있어.'); continue }
      if (p?.starting) { wait('모델 응답을 기다리고 있어.'); continue }
      if (p && (p.output || p.jobId)) {
        try {
          const output = await pollDecision(conai, p)
          if (fights.get(key) !== p || !world.running) continue
          if (!output) { wait('모델 응답을 기다리고 있어.'); continue }
          const option = p.options.find(o => o.id === output.action)
          if (!option) throw new Error('목록에 없는 행동이야. 새 모델 판단을 기다려.')
          write(owner, s => {
            const live = s.actors.find(x => x.id === a.id), e = live?.expedition
            if (!live?.active || !world.residents.some(r => r.profileId === live.profileId) || (combat ? e?.awaiting : e?.navigationAsk)?.id !== ask.id) return
            const chosen = { action: option.id, ...option.data, say: typeof output.say === 'string' ? output.say : '' }
            if (combat && chosen.action === 'wait') e.awaiting = { id: randomUUID(), round: ask.round, since: now }
            else if (combat) e.choice = { ...chosen, round: ask.round }
            else e.navigationChoice = chosen
            live.agentRoute = p.route; live.combatError = null; live.combatRetry = null
          }, true, false)
          if (r) recordDecision(world, r, { id: ask.id, kind, status: 'chosen', options: p.options.map(o => ({ id: o.id, label: o.description, category: 'combat' })),
            chosen: { action: option.id, label: option.description, category: 'combat' }, method: p.route?.decider, engine: p.route?.engine, model: p.route?.model,
            probability: output.probability, confidence: output.confidence }, now)
          fights.delete(key); continue
        } catch (error) { p.error = error; p.terminal = true; p.jobId = null; p.output = null }
      }
      if (p?.error) {
        const message = errorText(p.error)
        write(owner, s => { const x = s.actors.find(x => x.id === a.id); if (x) {
          const rejected = admissionBusy(p.error) || requestReplaced(p.error)
          const failures = (x.combatRetry?.failures ?? 0) + (rejected ? 0 : 1)
          x.combatError = message; x.combatRetry = { failures, until: now + (rejected ? ADMISSION_RETRY_MS : backoffMs(failures)) }
          if ((requestReplaced(p.error) || p.terminal && !admissionBusy(p.error)) && x.expedition) x.expedition[combat ? 'awaiting' : 'navigationAsk'] = { id: randomUUID(), round: ask.round, since: now }
        } }, true, false)
        wait(`모델 판단 실패 후 재시도 대기: ${message}`); fights.delete(key); continue
      }
      const s = read(owner), live = s.actors.find(x => x.id === a.id)
      if ((live.combatRetry?.until ?? 0) > now) { wait(`모델 판단 실패 후 재시도 대기: ${live.combatError}`); continue }
      const reason = budgetReason(s, live, 'combat', world.clock, now)
      if (reason) { wait(reason); continue }
      const options = ask._decision?.options ?? (combat ? combatOptions(s, live) : navigationOptions(s, live))
      const state = ask._decision?.state ?? { resident: residentContext(s, live), maximum: stats(s, live), supplies: live.supplies, equipment: live.equipment,
        expedition: { ...live.expedition, awaiting: undefined, navigationAsk: undefined, choice: undefined, navigationChoice: undefined },
        quest: s.quests.find(q => q.id === live.questId), instructions: r?.instructions ?? '', scene: world.settings.scene, time: world.clock,
        options: options.map(o => ({ id: o.id, description: o.description })), lastFailure: live.combatError }
      const instructions = combat ? '네 차례의 행동을 골라. 몬스터는 네 판단 대기 중에도 자기 차례에 행동해. 공격·스킬·물약의 실제 효과와 비용을 확인해. 목록의 정확한 action ID를 답해.' :
        '원정의 다음 목적지·시설 이용·물약·귀환·대기를 골라. 의뢰 완료나 낮은 HP도 정보일 뿐 행동을 강제하지 않아. 발견한 통로만 이동 가능해. 목록의 정확한 action ID를 답해.'
      if (ask._decision?.payloadLost) { wait('판단 자료 스냅샷을 복원할 수 없어. 새 판단을 기다려.'); write(owner, s => {
        const e = s.actors.find(x => x.id === a.id)?.expedition
        if (e) e[combat ? 'awaiting' : 'navigationAsk'] = { id: randomUUID(), round: ask.round, since: now }
      }, true, false); continue }
      const input = ask._decision?.input ?? withContext(owner, { requestId: `rpg:${ask.id}`, profileId: a.profileId, mode: 'text',
        message: [residentDirective(r), instructions, dataLine(state)].join('\n'),
        structuredOutput: { type: 'object', required: ['action'], properties: { action: { type: 'string', enum: options.map(o => o.id) }, say: { type: 'string' } }, additionalProperties: false },
        maxTokens: replyLengthOf(world.settings), timeoutMs: replyTimeoutMs(world.settings) }, a.profileId)
      const decider = budgetMode(s, live, 'combat', world.clock, now)
      // The judge reads the character, its memory summary and recent lines and the lore this fight calls up.
      if (decider === 'judge' && !state.memory) Object.assign(state, await judgeView(owner, a.profileId, dataLine(state)))
      if (!ask._decision) write(owner, s => {
        const e = s.actors.find(x => x.id === a.id)?.expedition, pending = combat ? e?.awaiting : e?.navigationAsk
        if (pending?.id === ask.id) pending._decision = { options, state, input }
      }, true, false)
      p = { owner, actorId: a.id, askId: ask.id, options, starting: true }; fights.set(key, p)
      const mine = p
      startDecision(conai, { profileId: a.profileId, decider, state, options, input, instructions,
        settings: world.settings, budget: modelBudget(write, owner, a.profileId, 'combat', world, now),
        onDiagnostic: diagnostic => write(owner, s => {
          const actor = s.actors.find(x => x.id === a.id), e = actor?.expedition, pending = combat ? e?.awaiting : e?.navigationAsk
          if (pending?.id === ask.id) { actor.budgetDiagnostic = diagnostic; pending._decision.input = structuredClone(input) }
        }, true, false) })
        .then(async result => {
          if (fights.get(key) !== mine) { if (result.jobId) await conai.llm.cancel(result.jobId).catch(() => {}); return }
          if (result.wait) { wait(result.wait); fights.delete(key) } else Object.assign(mine, result, { starting: false })
        }).catch(error => { mine.starting = false; mine.error = error })
    }
  }
  return { combatStep, stopFights }
}
