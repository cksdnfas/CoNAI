import { z } from 'zod'
import type { ChatJudgePreset, PluginJudgeTurn, PluginLlmDecision, PluginLlmProfile } from '@conai/shared'
import type { ChatProfile } from '../codex-chat/chatProfiles'
import { ModelSlotStore } from '../codex-chat/modelSlots'
import { askableJudgeItems, ChatJudgePresetStore } from '../codex-chat/chatJudgePresets'
import { cutForJudge, logJudgeRun, runJudgeItems } from '../codex-chat/chatJudge'
import { judgeToolMatches } from '../codex-chat/chatJudgeLogs'
import { DEFAULT_FOLLOW_UP_DIRECTIVE, DEFAULT_NEXT_INSTRUCTIONS, DEFAULT_ROUTE_INSTRUCTIONS } from '../codex-chat/chatJudgeDefaults'
import { askJudge, choiceQuestion, resolveJudgeConnection, yesNoQuestion } from '../judge/judgeEngine'
import { onPluginChanged, PluginError } from './pluginStore'

const id = z.string().regex(/^[a-zA-Z][\w-]{0,39}$/)
const criteria = z.object({ yes: z.string().max(300), no: z.string().max(300) }).strict()
const question = { id, instructions: z.string().min(1).max(1000) }
const timeoutMs = z.number().int().min(1000).max(120_000).default(60_000)
const profileId = z.number().int().positive()
const decideSchema = z.object({
  profileId,
  state: z.record(z.string(), z.json()).refine(state => Buffer.byteLength(JSON.stringify(state)) <= 16 * 1024, 'state must be JSON within 16 KiB'),
  questions: z.array(z.discriminatedUnion('kind', [
    z.object({
      ...question, kind: z.literal('choice'),
      options: z.array(z.object({ id, description: z.string().max(300), yes: z.boolean().default(true) }).strict()).min(2).max(16)
        .refine(options => new Set(options.map(option => option.id)).size === options.length, 'option ids must be unique'),
    }).strict(),
    z.object({ ...question, kind: z.literal('yesno'), criteria: criteria.optional() }).strict(),
  ])).min(1).max(8).refine(questions => new Set(questions.map(question => question.id)).size === questions.length, 'question ids must be unique'),
  timeoutMs,
}).strict()
const turnSchema = z.object({
  profileId, stage: z.enum(['before', 'after']), user: z.string().min(1).max(100),
  conversation: z.array(z.object({ from: z.enum(['user', 'character']), name: z.string().min(1).max(100), text: z.string().trim().min(1).max(4000) }).strict()).min(1).max(40),
  actions: z.array(z.string().min(1).max(200)).max(40).default([]), timeoutMs,
}).strict()

// Provider exceptions can contain credentials or whole request bodies. Only this bounded host message leaves the bridge.
const JUDGE_FAILED = '판단에 실패했거나 일부 질문에 답하지 않았어. 모델 연결과 입력 길이를 확인해줘.'

function connectionOf(profile: ChatProfile, preset: ChatJudgePreset | null) {
  const target = ModelSlotStore.target(profile.judgeSlotId ?? preset?.modelSlotId ?? ModelSlotStore.routeId('judge'))
  if (!target) return null
  try { return resolveJudgeConnection(target.providerName, target.model) } catch { return null }
}

export function pluginJudgeSettings(profile: ChatProfile): PluginLlmProfile['judge'] {
  const preset = ChatJudgePresetStore.find(profile.judgePresetId)
  return {
    presetId: preset?.id ?? null, presetName: preset?.name.slice(0, 1000) ?? null, available: connectionOf(profile, preset) !== null,
    followUp: preset ? { ...preset.followUp, directive: (preset.followUp.directive || DEFAULT_FOLLOW_UP_DIRECTIVE).slice(0, 1000) } : null,
    fields: preset ? { ...preset.fields } : null,
    room: preset ? {
      window: preset.room.window,
      route: { ...preset.room.route, instructions: (preset.room.route.instructions || DEFAULT_ROUTE_INSTRUCTIONS).slice(0, 1000) },
      next: { ...preset.room.next, instructions: (preset.room.next.instructions || DEFAULT_NEXT_INSTRUCTIONS).slice(0, 1000) },
    } : null,
  }
}

type Authorized = { profile: ChatProfile; plugin: { digest: string } }
type Authorize = (profileId: number) => Authorized
const active = new Map<string, Set<AbortController>>()
onPluginChanged(pluginId => {
  for (const controller of active.get(pluginId) ?? []) controller.abort(new PluginError('플러그인이 바뀌었거나 꺼졌어.', 409))
})

async function execute<T>(pluginId: string, input: { profileId: number; timeoutMs: number }, authorized: Authorized, authorize: Authorize, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controllers = active.get(pluginId) ?? new Set<AbortController>()
  if (controllers.size >= 4) throw new PluginError('플러그인 판단 4개가 실행 중이야. 완료 후 다시 시도해줘.', 429)
  const controller = new AbortController()
  controllers.add(controller)
  active.set(pluginId, controllers)
  const check = () => {
    if (authorize(input.profileId).plugin.digest !== authorized.plugin.digest) throw new PluginError('플러그인 버전이 바뀌었어.', 409)
  }
  const timeout = setTimeout(() => controller.abort(new PluginError('판단 제한 시간을 넘었어.', 408)), input.timeoutMs)
  const permissions = setInterval(() => {
    try { check() } catch (error) { controller.abort(error) }
  }, 1000)
  timeout.unref(); permissions.unref()
  try {
    const result = await run(controller.signal)
    controller.signal.throwIfAborted()
    check()
    return result
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason
    if (error instanceof PluginError) throw error
    throw new PluginError(JUDGE_FAILED)
  } finally {
    clearTimeout(timeout); clearInterval(permissions)
    controllers.delete(controller)
    if (!controllers.size) active.delete(pluginId)
  }
}

/** Authorization stays in pluginLlm, shared with replies, assets and profile discovery. */
export function callPluginJudge(pluginId: string, method: 'decide' | 'judgeTurn', raw: unknown, authorize: Authorize): Promise<PluginLlmDecision | PluginJudgeTurn> {
  if (method === 'decide') {
    const input = decideSchema.parse(raw)
    const authorized = authorize(input.profileId)
    const connection = connectionOf(authorized.profile, ChatJudgePresetStore.find(authorized.profile.judgePresetId))
    if (!connection) throw new PluginError('판단 모델이 없어. 프로필의 판단 모델이나 판단 대표모델을 정해줘.', 409)
    const questions = input.questions.map(question => question.kind === 'choice'
      ? choiceQuestion(question.id, question.instructions, question.options.map(option => [option.id, option.description, option.yes]))
      : yesNoQuestion(question.id, question.instructions, question.criteria))
    return execute(pluginId, input, authorized, authorize, async signal => {
      try {
        const run = await askJudge(connection, input.state, questions, signal, { purpose: 'judge', profileId: input.profileId })
        return { engine: connection.engine, model: run.model.slice(0, 200), answers: Object.fromEntries(run.answers), error: run.answers.size < questions.length ? JUDGE_FAILED : null }
      } catch {
        signal.throwIfAborted()
        return { engine: connection.engine, model: connection.model, answers: {}, error: JUDGE_FAILED }
      }
    })
  }
  const input = turnSchema.parse(raw)
  const authorized = authorize(input.profileId)
  const { profile } = authorized
  const preset = ChatJudgePresetStore.find(profile.judgePresetId)
  const connection = preset ? connectionOf(profile, preset) : null
  const empty = { presetId: null, engine: null, model: null, directive: '', offered: [], withheld: [], followUp: false, items: [], error: null }
  if (!preset || !connection) return Promise.resolve(empty)
  const setup = { preset, providerName: connection.providerName, model: connection.model }
  const items = askableJudgeItems(preset.items).filter(item => item.stage === input.stage
    && (input.stage !== 'before' || !item.tools.length || item.tools.some(pattern => input.actions.some(name => judgeToolMatches(pattern, name)))))
  // As in a native chat: no askable items, or follow-ups turned off, asks nothing and logs nothing.
  if (!items.length || (input.stage === 'after' && preset.followUp.maxConsecutive <= 0)) {
    return Promise.resolve({ ...empty, presetId: preset.id, engine: connection.engine, model: connection.model })
  }
  const conversation = input.conversation.map(entry => ({ ...entry, text: cutForJudge(entry.text) }))
  return execute(pluginId, input, authorized, authorize, async signal => {
    const run = await runJudgeItems(setup, profile, items, window => ({
      character: profile.name, user: input.user, conversation: conversation.slice(-window),
    }), signal, { usage: { purpose: 'judge', profileId: profile.id } })
    signal.throwIfAborted()
    // The admin judge log keeps the real error as native turns do; only the bounded message leaves the bridge.
    logJudgeRun({ setup, threadId: null, profileId: profile.id, stage: input.stage, messageId: null, replyId: null, run })
    return {
      presetId: preset.id, engine: connection.engine, model: connection.model,
      directive: run.results.filter(result => result.action === 'offered').map(result => items.find(item => item.id === result.itemId)?.directive ?? '').filter(Boolean).join('\n'),
      offered: run.results.filter(result => result.action === 'offered').flatMap(result => result.tools),
      withheld: run.results.filter(result => result.action === 'withheld').flatMap(result => result.tools),
      followUp: input.stage === 'after' && run.results.some(result => result.action === 'follow-up'),
      items: run.results.map(({ itemId, name, verdict, probability, action }) => ({ itemId, name, verdict, probability, action })),
      error: run.error ? JUDGE_FAILED : null,
    }
  })
}
