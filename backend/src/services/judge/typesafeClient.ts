/**
 * TypeSafe System One API (the Jev decision model): `POST {base}/v1/systemone` with a state and typed questions,
 * answered with probabilities instead of text. TypeSafe itself (https://api.typesafe.ai, model `jev-latest`) and
 * OpenRouter (https://openrouter.ai/api, model `~typesafe/jev-latest`) serve the same path.
 */

export const TYPESAFE_DEFAULT_BASE_URL = 'https://api.typesafe.ai'
export const TYPESAFE_DEFAULT_MODEL = 'jev-latest'
const DEFAULT_TIMEOUT_MS = 20_000

export type TypesafeQuestion =
  | { type: 'noul'; instructions: string; criteria?: { true: string; false: string } }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }

export type TypesafeAnswer =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: 'score'; score: number; probabilities: Record<string, number>; confidence: number }

export type TypesafeResponse = { model: string; answers: Record<string, TypesafeAnswer>; usage?: { input_tokens?: number; output_tokens?: number } }

export class TypesafeError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message)
  }
}

/** The API root: a pasted `…/v1` or `…/v1/systemone` is trimmed back to it. */
export function typesafeApiBase(baseUrl: string | null | undefined) {
  const trimmed = (baseUrl ?? '').trim().replace(/\/+$/, '') || TYPESAFE_DEFAULT_BASE_URL
  return trimmed.replace(/\/v1(?:\/systemone)?$/, '')
}

function headers(apiKey: string | null | undefined) {
  const result: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
  if (apiKey?.trim()) result.Authorization = `Bearer ${apiKey.trim()}`
  return result
}

function errorText(json: unknown, fallback: string) {
  const error = (json as { error?: unknown; message?: unknown; detail?: unknown } | null)
  const value = error?.error ?? error?.message ?? error?.detail
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && typeof (value as { message?: unknown }).message === 'string') return (value as { message: string }).message
  return fallback
}

/** Model ids at `GET {base}/v1/models`; on a shared router (OpenRouter) only the TypeSafe ones. */
export async function listTypesafeModels(baseUrl: string | null | undefined, apiKey: string | null | undefined) {
  const response = await fetch(`${typesafeApiBase(baseUrl)}/v1/models`, { headers: headers(apiKey), signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new TypesafeError(`모델 목록을 가져오지 못했어 (${response.status})`, response.status)
  const json = await response.json() as { data?: Array<{ id?: unknown }>; models?: Array<{ id?: unknown } | string> }
  const ids = [...(json.data ?? []), ...(json.models ?? [])].map((entry) => (typeof entry === 'string' ? entry : typeof entry.id === 'string' ? entry.id : '')).filter(Boolean)
  const decision = ids.filter((id) => /jev|typesafe/i.test(id))
  return [...new Set(decision.length > 0 ? decision : ids)]
}

/** One System One request. `timeoutMs` bounds the whole call; `signal` stops it early. */
export async function callTypesafeSystemOne(params: {
  baseUrl: string | null | undefined
  apiKey: string | null | undefined
  model: string
  state: unknown
  questions: Record<string, TypesafeQuestion>
  signal?: AbortSignal
  timeoutMs?: number | null
}): Promise<TypesafeResponse> {
  const signals = [AbortSignal.timeout(params.timeoutMs ?? DEFAULT_TIMEOUT_MS), ...(params.signal ? [params.signal] : [])]
  let response: Response
  try {
    response = await fetch(`${typesafeApiBase(params.baseUrl)}/v1/systemone`, {
      method: 'POST',
      headers: headers(params.apiKey),
      body: JSON.stringify({ model: params.model, state: params.state, questions: params.questions }),
      signal: AbortSignal.any(signals),
    })
  } catch (error) {
    params.signal?.throwIfAborted()
    throw new TypesafeError(error instanceof Error && error.name === 'TimeoutError' ? '판단 모델 응답이 늦어 시간 초과됐어.' : `판단 모델에 연결하지 못했어: ${error instanceof Error ? error.message : String(error)}`)
  }
  const text = await response.text()
  let json: unknown = null
  try { json = text ? JSON.parse(text) : null } catch { json = null }
  if (!response.ok) throw new TypesafeError(`판단 모델 요청 실패 (${response.status}): ${errorText(json, text.slice(0, 200))}`, response.status)
  const answers = (json as { answers?: unknown } | null)?.answers
  if (!answers || typeof answers !== 'object') throw new TypesafeError('판단 모델 응답에 answers가 없어.')
  return json as TypesafeResponse
}
