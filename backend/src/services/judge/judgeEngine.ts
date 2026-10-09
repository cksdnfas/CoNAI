import type { ChatJudgeItem } from '@conai/shared'
import { ExternalApiProvider } from '../../models/ExternalApiProvider'
import { readLlmConnectionConfig } from '../llmGenerationOptions'
import { callTypesafeSystemOne, TYPESAFE_DEFAULT_MODEL, type TypesafeQuestion, type TypesafeResponse } from './typesafeClient'
import { isCallerAbort, readUsageCounts, recordLlmUsage } from '../llmUsage'
import { resolveChatCompletionTarget, streamChatCompletion, type ChatCompletionTarget } from '../codex-chat/llmChatCompletion'
import { primaryModelOf } from '../codex-chat/modelSlots'

/**
 * The judge: typed questions about a state (any JSON — a conversation, an image's tags), answered either by the
 * TypeSafe decision model (calibrated probabilities) or by an LLM connection asked for a JSON object of probabilities
 * (its own estimate). Both come back as one answer per question: the probability of yes, the option picked, and the
 * probability of every option. Chat turns, group rooms and asset reviews all ask through here.
 */

/** One question: a yes/no (`noul`, criteria optional) or a choice among labelled options, some of which count as yes. */
export type JudgeQuestion = Pick<ChatJudgeItem, 'id' | 'kind' | 'instructions' | 'criteria' | 'options'>

export type JudgeAnswer = {
  /** Probability of yes (choice: summed over the yes options). */
  probability: number
  confidence: number | null
  /** choice: the option picked. */
  choice: string | null
  /** choice: every option's probability, normalized; null for a yes/no. */
  distribution: Record<string, number> | null
}

export type JudgeConnection =
  | { engine: 'typesafe'; providerName: string; model: string; baseUrl: string | null; apiKey: string | null; timeoutMs: number | null }
  | { engine: 'llm'; providerName: string; model: string; target: ChatCompletionTarget }

export class JudgeError extends Error {}

const LLM_JUDGE_TIMEOUT_MS = 60_000

/** A connection the judge calls, by name; throws JudgeError when it is missing, off, or not a judge connection. */
export function resolveJudgeConnection(providerName: string, model: string | null | undefined): JudgeConnection {
  const provider = ExternalApiProvider.findByName(providerName)
  if (!provider) throw new JudgeError(`판단 연결을 찾을 수 없어: ${providerName}`)
  if (!provider.is_enabled) throw new JudgeError(`판단 연결이 꺼져 있어: ${provider.display_name}`)
  if (provider.provider_type === 'decision_typesafe') {
    let config: Record<string, unknown> = {}
    try { config = typeof provider.additional_config === 'string' ? JSON.parse(provider.additional_config) : (provider.additional_config as Record<string, unknown> | null) ?? {} } catch { config = {} }
    const settings = readLlmConnectionConfig(config)
    return {
      engine: 'typesafe',
      providerName,
      model: model?.trim() || primaryModelOf(providerName) || TYPESAFE_DEFAULT_MODEL,
      baseUrl: provider.base_url,
      apiKey: ExternalApiProvider.getDecryptedKey(providerName, true),
      timeoutMs: settings.timeoutMs,
    }
  }
  try {
    const target = resolveChatCompletionTarget(providerName, { model: model?.trim() || null, generation: { temperature: 0, reasoningEffort: 'none' } })
    return { engine: 'llm', providerName, model: target.model, target }
  } catch (error) {
    throw new JudgeError(error instanceof Error ? error.message : String(error))
  }
}

/** Whether the judge could call this connection's model (a TypeSafe decision connection or an LLM one). */
export function isJudgeConnectionReady(providerName: string, model: string | null | undefined) {
  try {
    resolveJudgeConnection(providerName, model)
    return true
  } catch {
    return false
  }
}

/** Options a question offers: a choice's own, or yes / no. */
function optionsOf(question: JudgeQuestion) {
  return question.kind === 'choice' ? question.options : [{ label: 'yes', description: question.criteria.yes, yes: true }, { label: 'no', description: question.criteria.no, yes: false }]
}

export function typesafeQuestionOf(question: JudgeQuestion): TypesafeQuestion {
  if (question.kind === 'choice') return { type: 'choice', instructions: question.instructions, criteria: Object.fromEntries(question.options.map((option) => [option.label, option.description || option.label])) }
  return question.criteria.yes && question.criteria.no
    ? { type: 'noul', instructions: question.instructions, criteria: { true: question.criteria.yes, false: question.criteria.no } }
    : { type: 'noul', instructions: question.instructions }
}

function clampProbability(value: unknown) {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : null
}

/** The answer from a probability per option: summed over the yes options, the top option picked. */
function answerFromDistribution(question: JudgeQuestion, distribution: Record<string, unknown>, confidence: number | null): JudgeAnswer | null {
  const options = optionsOf(question)
  const values = options.map((option) => clampProbability(distribution[option.label]) ?? 0)
  const total = values.reduce((sum, value) => sum + value, 0)
  if (total <= 0) return null
  const normalized = values.map((value) => value / total)
  const top = normalized.indexOf(Math.max(...normalized))
  return {
    probability: options.reduce((sum, option, index) => sum + (option.yes ? normalized[index] : 0), 0),
    confidence: confidence ?? normalized[top],
    choice: question.kind === 'choice' ? options[top].label : null,
    distribution: question.kind === 'choice' ? Object.fromEntries(options.map((option, index) => [option.label, normalized[index]])) : null,
  }
}

async function askTypesafe(connection: Extract<JudgeConnection, { engine: 'typesafe' }>, state: unknown, questions: JudgeQuestion[], signal?: AbortSignal) {
  const typed = Object.fromEntries(questions.map((question) => [question.id, typesafeQuestionOf(question)]))
  const request = { model: connection.model, state, questions: typed }
  const startedAt = Date.now()
  const meter = (ok: boolean, response?: TypesafeResponse) => recordLlmUsage({
    purpose: 'judge', engine: 'typesafe', providerName: connection.providerName, model: response?.model || connection.model,
    tokens: response ? readUsageCounts(response) : null, latencyMs: Date.now() - startedAt, ok,
  })
  let response: TypesafeResponse
  try {
    response = await callTypesafeSystemOne({ baseUrl: connection.baseUrl, apiKey: connection.apiKey, model: connection.model, state, questions: typed, signal, timeoutMs: connection.timeoutMs })
  } catch (error) {
    if (!signal || !isCallerAbort(signal)) meter(false)
    throw error
  }
  meter(true, response)
  const counts = readUsageCounts(response)
  const answers = new Map<string, JudgeAnswer>()
  for (const question of questions) {
    const answer = response.answers[question.id]
    if (!answer) continue
    if (answer.type === 'noul') {
      const probability = clampProbability(answer.noul)
      if (probability !== null) answers.set(question.id, { probability, confidence: null, choice: null, distribution: null })
    } else if (answer.type === 'choice') {
      const parsed = answerFromDistribution(question, answer.probabilities ?? {}, clampProbability(answer.confidence))
      if (parsed) answers.set(question.id, { ...parsed, choice: typeof answer.choice === 'string' && question.options.some((option) => option.label === answer.choice) ? answer.choice : parsed.choice })
    }
  }
  return { answers, request, model: response.model || connection.model, tokens: counts ? counts.inputTokens + counts.outputTokens : null }
}

const LLM_JUDGE_PROMPT = [
  'You are a careful classifier. You read a state (JSON, in its original language) and answer each question about it.',
  'For every question, give a probability for each of its options (numbers from 0 to 1 that sum to 1). Judge only from the state; read each question literally.',
  'Reply with one JSON object and nothing else: {"<question id>": {"<option>": <probability>, ...}, ...}.',
].join('\n')

/** The first JSON object in a reply (fenced or not). */
export function parseJudgeJson(text: string): Record<string, unknown> | null {
  const unfenced = text.replace(/```(?:json)?/gi, '')
  const start = unfenced.indexOf('{')
  const end = unfenced.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(unfenced.slice(start, end + 1))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

async function askLlm(connection: Extract<JudgeConnection, { engine: 'llm' }>, state: unknown, questions: JudgeQuestion[], signal?: AbortSignal) {
  const asked = Object.fromEntries(questions.map((question) => [question.id, {
    question: question.instructions,
    options: Object.fromEntries(optionsOf(question).map((option) => [option.label, option.description || (option.yes ? 'yes' : 'no')])),
  }]))
  const request = { model: connection.model, state, questions: asked }
  const target = { ...connection.target, generation: { ...connection.target.generation, maxTokens: 200 + 60 * questions.length } }
  const timeout = AbortSignal.timeout(connection.target.timeoutMs ?? LLM_JUDGE_TIMEOUT_MS)
  const result = await streamChatCompletion({
    target,
    messages: [
      { role: 'system', content: LLM_JUDGE_PROMPT },
      { role: 'user', content: JSON.stringify({ state, questions: asked }) },
    ],
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    usage: { purpose: 'judge' },
  })
  const parsed = parseJudgeJson(result.content.trim())
  if (!parsed) throw new JudgeError('판단 LLM이 JSON으로 답하지 않았어.')
  const answers = new Map<string, JudgeAnswer>()
  for (const question of questions) {
    const distribution = parsed[question.id]
    if (!distribution || typeof distribution !== 'object') continue
    const answer = answerFromDistribution(question, distribution as Record<string, unknown>, null)
    if (answer) answers.set(question.id, answer)
  }
  return { answers, request, model: connection.model, tokens: result.usage ? result.usage.inputTokens + result.usage.outputTokens : null }
}

/** All questions in one call. Questions the judge left unanswered are missing from `answers`. */
export async function askJudge(connection: JudgeConnection, state: unknown, questions: JudgeQuestion[], signal?: AbortSignal) {
  return connection.engine === 'typesafe' ? askTypesafe(connection, state, questions, signal) : askLlm(connection, state, questions, signal)
}

/** A choice question built in code (not a preset item): `options` as [label, description, counts as yes]. */
export function choiceQuestion(id: string, instructions: string, options: Array<[label: string, description: string, yes: boolean]>): JudgeQuestion {
  return { id, kind: 'choice', instructions, criteria: { yes: '', no: '' }, options: options.map(([label, description, yes]) => ({ label, description, yes })) }
}

/** A yes/no question built in code. */
export function yesNoQuestion(id: string, instructions: string, criteria: { yes: string; no: string } = { yes: '', no: '' }): JudgeQuestion {
  return { id, kind: 'noul', instructions, criteria, options: [] }
}
