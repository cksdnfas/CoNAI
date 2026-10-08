import type { ChatJudgeItem } from '@conai/shared'
import { ExternalApiProvider } from '../../models/ExternalApiProvider'
import { readLlmConnectionConfig } from '../llmGenerationOptions'
import { callTypesafeSystemOne, TYPESAFE_DEFAULT_MODEL, type TypesafeQuestion } from '../typesafeClient'
import { completeChat, resolveChatCompletionTarget, type ChatCompletionTarget } from './llmChatCompletion'

/**
 * The two ways a judge answers the same typed questions: the TypeSafe decision model (calibrated probabilities), or
 * an LLM connection asked for a JSON object of probabilities (its own estimate). Both come back as one answer per
 * item: the probability of yes, and for a choice the option picked.
 */

export type JudgeAnswer = { probability: number; confidence: number | null; choice: string | null }

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
      model: model?.trim() || settings.defaultModel || TYPESAFE_DEFAULT_MODEL,
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

/** Options a question offers: a choice's own, or yes / no. */
function optionsOf(item: ChatJudgeItem) {
  return item.kind === 'choice' ? item.options : [{ label: 'yes', description: item.criteria.yes, yes: true }, { label: 'no', description: item.criteria.no, yes: false }]
}

export function typesafeQuestionOf(item: ChatJudgeItem): TypesafeQuestion {
  if (item.kind === 'choice') return { type: 'choice', instructions: item.instructions, criteria: Object.fromEntries(item.options.map((option) => [option.label, option.description || option.label])) }
  return item.criteria.yes && item.criteria.no
    ? { type: 'noul', instructions: item.instructions, criteria: { true: item.criteria.yes, false: item.criteria.no } }
    : { type: 'noul', instructions: item.instructions }
}

function clampProbability(value: unknown) {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : null
}

/** The answer from a probability per option: summed over the yes options, the top option picked. */
function answerFromDistribution(item: ChatJudgeItem, distribution: Record<string, unknown>, confidence: number | null): JudgeAnswer | null {
  const options = optionsOf(item)
  const values = options.map((option) => clampProbability(distribution[option.label]) ?? 0)
  const total = values.reduce((sum, value) => sum + value, 0)
  if (total <= 0) return null
  const normalized = values.map((value) => value / total)
  const top = normalized.indexOf(Math.max(...normalized))
  return {
    probability: options.reduce((sum, option, index) => sum + (option.yes ? normalized[index] : 0), 0),
    confidence: confidence ?? normalized[top],
    choice: item.kind === 'choice' ? options[top].label : null,
  }
}

async function askTypesafe(connection: Extract<JudgeConnection, { engine: 'typesafe' }>, state: unknown, items: ChatJudgeItem[], signal?: AbortSignal) {
  const questions = Object.fromEntries(items.map((item) => [item.id, typesafeQuestionOf(item)]))
  const request = { model: connection.model, state, questions }
  const response = await callTypesafeSystemOne({ baseUrl: connection.baseUrl, apiKey: connection.apiKey, model: connection.model, state, questions, signal, timeoutMs: connection.timeoutMs })
  const answers = new Map<string, JudgeAnswer>()
  for (const item of items) {
    const answer = response.answers[item.id]
    if (!answer) continue
    if (answer.type === 'noul') {
      const probability = clampProbability(answer.noul)
      if (probability !== null) answers.set(item.id, { probability, confidence: null, choice: null })
    } else if (answer.type === 'choice') {
      const parsed = answerFromDistribution(item, answer.probabilities ?? {}, clampProbability(answer.confidence))
      if (parsed) answers.set(item.id, { ...parsed, choice: typeof answer.choice === 'string' ? answer.choice : parsed.choice })
    }
  }
  return { answers, request, model: response.model || connection.model }
}

const LLM_JUDGE_PROMPT = [
  'You are a careful classifier. You read the state of a chat (JSON, in its original language) and answer each question about it.',
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

async function askLlm(connection: Extract<JudgeConnection, { engine: 'llm' }>, state: unknown, items: ChatJudgeItem[], signal?: AbortSignal) {
  const questions = Object.fromEntries(items.map((item) => [item.id, {
    question: item.instructions,
    options: Object.fromEntries(optionsOf(item).map((option) => [option.label, option.description || (option.yes ? 'yes' : 'no')])),
  }]))
  const request = { model: connection.model, state, questions }
  const target = { ...connection.target, generation: { ...connection.target.generation, maxTokens: 200 + 60 * items.length } }
  const timeout = AbortSignal.timeout(connection.target.timeoutMs ?? LLM_JUDGE_TIMEOUT_MS)
  const reply = await completeChat(target, [
    { role: 'system', content: LLM_JUDGE_PROMPT },
    { role: 'user', content: JSON.stringify({ state, questions }) },
  ], signal ? AbortSignal.any([signal, timeout]) : timeout)
  const parsed = parseJudgeJson(reply)
  if (!parsed) throw new JudgeError('판단 LLM이 JSON으로 답하지 않았어.')
  const answers = new Map<string, JudgeAnswer>()
  for (const item of items) {
    const distribution = parsed[item.id]
    if (!distribution || typeof distribution !== 'object') continue
    const answer = answerFromDistribution(item, distribution as Record<string, unknown>, null)
    if (answer) answers.set(item.id, answer)
  }
  return { answers, request, model: connection.model }
}

/** All items in one call. Items the judge left unanswered are missing from `answers`. */
export async function askJudge(connection: JudgeConnection, state: unknown, items: ChatJudgeItem[], signal?: AbortSignal) {
  return connection.engine === 'typesafe' ? askTypesafe(connection, state, items, signal) : askLlm(connection, state, items, signal)
}
