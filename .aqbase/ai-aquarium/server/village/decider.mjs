import { resultJson } from '../rpg/answers.mjs'
import { reserveBudget, refundBudget, budgetReason } from '../../shared/agents.mjs'
import { startBudgeted, estimateTokens } from '../llm-budget.mjs'
import { llmErrorText, admissionRejected, PAYLOAD_LOST } from '../llm-errors.mjs'
import { jsonData } from '../llm-json.mjs'

export const judgeTimeout = value => Number.isFinite(value) ? Math.max(1000, Math.min(1_800_000, value)) : undefined
export const errorText = llmErrorText
/** Recent lines a judge reads when the profile's judge preset sets no room window (the conversation judge's default). */
export const JUDGE_WINDOW = 12

/** Who decides, as its profile editor holds it: tagline, the persona prompt and its enabled text sections. */
export function characterOf(profile) {
  const details = profile?.details ?? {}
  const sections = (Array.isArray(details.promptSections) ? details.promptSections : [])
    .filter(s => s?.enabled && s.kind === 'text' && String(s.content ?? '').trim()).map(s => s.title ? `${s.title}\n${s.content}` : s.content)
  return { name: profile?.name ?? '', tagline: profile?.tagline ?? '', persona: [details.systemPrompt, ...sections].filter(Boolean).join('\n\n') }
}
/**
 * What a judge reads besides the situation and the options: the character and what it remembers of this situation
 * (memory summary, its latest lines in the profile's judge window, the lore the situation calls up). `window: 0`
 * leaves the lines out where the state already carries the conversation.
 */
export async function judgeView({ rpg, memory }, owner, profileId, situation, { window } = {}) {
  const profile = (await rpg.profilesNow(Date.now())).find(p => p.id === profileId) ?? null
  return { character: characterOf(profile), memory: memory.judgeContext(owner, profileId, situation, window ?? profile?.judge?.room?.window ?? JUDGE_WINDOW) }
}
export function modelBudget(write, owner, profileId, category, world, now) {
  return {
    take: (interval = true) => world.memoryBacklogged ? null : write(owner, s => {
      const a = s.actors.find(a => a.profileId === profileId && a.active)
      return a ? reserveBudget(s, a, category, world.clock, now, interval) : null
    }, true, false),
    refund: ticket => write(owner, s => refundBudget(s, ticket), true, false),
    reason: (interval = true) => world.memoryBacklogged ? '기억 정리가 밀려 새 판단과 대화를 기다리고 있어.' : write(owner, s => {
      const a = s.actors.find(a => a.profileId === profileId && a.active)
      return a ? budgetReason(s, a, category, world.clock, now, interval) : '판단할 주민이 없어.'
    }, true, false),
  }
}
/** Every model call consumes a cap unit; only the first call sets the turn interval. */
export function conversationBudget(base, admission) {
  return {
    reason: () => base.reason(!admission.ticket),
    take: () => {
      const ticket = base.take(!admission.ticket)
      if (ticket && !admission.ticket) admission.ticket = ticket
      return ticket
    },
    refund: ticket => {
      base.refund(ticket)
      if (admission.ticket?.serial === ticket.serial) delete admission.ticket
    },
  }
}
export async function modelCall(call, budget, noModel = () => false, usable = () => false) {
  const ticket = budget?.take()
  if (budget && !ticket) return null
  let responded = false
  try {
    const result = await call()
    responded = true
    if (result?.error && !usable(result)) throw new Error(errorText(result.error))
    if (ticket && noModel(result)) budget.refund(ticket)
    return result
  } catch (error) {
    if (ticket && !responded && admissionRejected(error)) budget.refund(ticket)
    throw error
  }
}
/** Speaker-relative, non-empty valid lines in the configured judgment window. */
export function judgeConversation(lines, speaker, window = 12, conai) {
  const selected = lines.slice(-Math.max(1, Math.min(40, window))).map(l => ({
    from: l.profileId !== undefined ? l.profileId === speaker.profileId ? 'character' : 'user' : l.name === speaker.name ? 'character' : 'user',
    name: String(l.name ?? ''), text: String(l.text ?? '').trim(),
  })).filter(l => l.text)
  return selected
}
/** Only the resident's own profile is ever used. Missing judge support/model falls back to its chat model. */
export async function startDecision(conai, { profileId, decider, state, options, input, instructions = '현재 상황에 맞는 행동 하나를 골라.', details = [], budget, settings, onDiagnostic }) {
  if (input._budget?.payloadLost) throw Object.assign(new Error(PAYLOAD_LOST), { terminal: true, noModelCall: true })
  const unavailable = () => ({ wait: budget?.reason?.() || '사용자가 설정한 호출 한도 때문에 판단을 기다리고 있어.' })
  if (decider === 'wait') return unavailable()
  if (!options.length) return { wait: '사용할 수 있는 행동이 없어.' }
  // Even a sole feasible action is not permission to execute it. The model may wait.
  if (options.length === 1 && options[0].id === 'wait') return { wait: '지금 가능한 선택지는 기다리기뿐이야.' }
  if (options.length === 1) options = [...options, { id: 'wait', description: '아무 행동도 하지 않고 다음 판단까지 기다려.' }]
  if (decider === 'judge' && typeof conai.llm.decide === 'function') {
    try {
      const questions = [...(options.length > 1 ? [{ id: 'action', kind: 'choice', instructions,
        options: options.map(o => ({ id: o.id, description: o.description || o.label || o.id })) },
      ] : []),
        ...details.map(d => ({ id: d.id, kind: 'choice', instructions: d.instructions, options: d.options.map(({ id, description }) => ({ id, description })) }))]
      // The options are the question's own; a state copy of them (the chat fallback's listing) would send them twice.
      const { options: _listed, ...judged } = state
      // The host owns judge-model context handling; this estimate is diagnostic only.
      const fitted = jsonData(judged)
      const diagnostics = { inputSize: estimateTokens(fitted) + estimateTokens(questions), outputReserve: null, contextTokens: null, shrinks: 0, timeoutMs: judgeTimeout(input.timeoutMs) }
      onDiagnostic?.(diagnostics)
      const request = jsonData({ profileId, state: fitted, timeoutMs: judgeTimeout(input.timeoutMs), questions })
      const result = await modelCall(() => conai.llm.decide(request), budget, () => false,
        result => options.length === 1 || options.some(o => o.id === result.answers?.action?.choice))
      if (!result) return unavailable()
      const answer = options.length === 1 ? { choice: options[0].id } : result.answers?.action
      if (!options.some(o => o.id === answer?.choice)) throw new Error('판단 답에 유효한 행동이 없어.')
      if (result.error) onDiagnostic?.({ ...diagnostics, outputNotice: `행동 답은 유지했어. ${errorText(result.error)}` })
      const chosenDetails = Object.fromEntries(details.flatMap(d => {
        const option = d.options.find(o => o.id === result.answers?.[d.id]?.choice)
        return option ? [[d.id, option.value]] : []
      }))
      return { output: { action: answer.choice, probability: answer.probability, confidence: answer.confidence, ...chosenDetails }, route: { profileId, decider: 'judge', engine: result.engine, model: result.model } }
    } catch (error) {
      if (!errorText(error).startsWith('판단 모델이 없어')) throw error
    }
  }
  if (typeof conai.llm.start !== 'function') return { wait: '사용할 수 있는 판단 모델이나 채팅 모델이 없어.' }
  input.profileId = profileId; input.mode = 'text'
  const job = await startBudgeted(conai, input, { settings, purpose: 'decision', onDiagnostic, invoke: call => modelCall(call, budget) })
  if (!job) return unavailable()
  return { jobId: job.jobId, route: { profileId, decider: 'chat', fallback: decider === 'judge', engine: null, model: null } }
}
export async function pollDecision(conai, pending) {
  if (pending.output) return pending.output
  const job = await conai.llm.get(pending.jobId)
  if (['running', 'queued'].includes(job.status)) return null
  if (job.status !== 'completed') throw new Error(llmErrorText(job.error || '판단 답변이 중단됐어.'))
  if (pending.route) { pending.route.engine = job.result?.engine; pending.route.model = job.result?.model }
  return resultJson(job.result)
}
