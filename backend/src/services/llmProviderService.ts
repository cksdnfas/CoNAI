import { ExternalApiProvider } from '../models/ExternalApiProvider'
import type { ProviderType } from '../types/externalApi'

type LlmResponseMode = 'text' | 'json'

export type ExecuteLlmTextRequest = {
  providerName: string
  prompt: string
  systemPrompt?: string | null
  context?: string | null
  model?: string | null
  temperature?: number | null
  maxTokens?: number | null
  responseMode?: LlmResponseMode | null
  structuredOutputJson?: string | null
}

export type ExecuteLlmTextResponse = {
  text: string
  json: unknown | null
  providerName: string
  providerType: ProviderType
  model: string | null
  responseMode: LlmResponseMode
  metadata: Record<string, unknown>
}

function normalizeOptionalString(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeOptionalNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return null
}

function parseProviderDefaultModel(additionalConfig: Record<string, any> | null | undefined) {
  const directDefaultModel = normalizeOptionalString(additionalConfig?.default_model)
  if (directDefaultModel) {
    return directDefaultModel
  }

  const nestedModel = normalizeOptionalString(additionalConfig?.model)
  if (nestedModel) {
    return nestedModel
  }

  return null
}

function parseProviderDefaultTemperature(additionalConfig: Record<string, any> | null | undefined) {
  const directDefaultTemperature = normalizeOptionalNumber(additionalConfig?.default_temperature)
  if (directDefaultTemperature !== null) {
    return directDefaultTemperature
  }

  return normalizeOptionalNumber(additionalConfig?.temperature)
}

function parseProviderDefaultMaxTokens(additionalConfig: Record<string, any> | null | undefined) {
  const directDefaultMaxTokens = normalizeOptionalNumber(additionalConfig?.default_max_tokens)
  if (directDefaultMaxTokens !== null) {
    return directDefaultMaxTokens
  }

  return normalizeOptionalNumber(additionalConfig?.max_tokens)
}

function normalizeStructuredOutputJson(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    throw new Error('구조화 출력 JSON 양식이 올바른 JSON이 아니야')
  }
}

function buildJsonInstruction(responseMode: LlmResponseMode, structuredOutputJson: string | null) {
  if (responseMode !== 'json' && !structuredOutputJson) {
    return null
  }

  if (!structuredOutputJson) {
    return 'Respond with valid JSON only. Do not wrap the JSON in markdown fences or extra prose.'
  }

  return [
    'Respond with valid JSON only. Do not wrap the JSON in markdown fences or extra prose.',
    'Match this JSON structure as closely as possible:',
    structuredOutputJson,
  ].join('\n\n')
}

function buildUserPrompt(prompt: string, contextValue: string | null) {
  if (!contextValue) {
    return prompt
  }

  return `Context:\n${contextValue}\n\nUser request:\n${prompt}`
}

function extractOpenAiCompatibleText(responseJson: any) {
  const firstChoice = Array.isArray(responseJson?.choices) ? responseJson.choices[0] : null
  const content = firstChoice?.message?.content

  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    const joinedText = content
      .map((entry) => {
        if (typeof entry === 'string') {
          return entry
        }

        if (entry && typeof entry === 'object' && typeof entry.text === 'string') {
          return entry.text
        }

        return ''
      })
      .filter(Boolean)
      .join('\n')

    if (joinedText.trim().length > 0) {
      return joinedText
    }
  }

  throw new Error('LLM provider returned no text content')
}

async function parseJsonResponse(response: Response) {
  const responseText = await response.text()
  if (!responseText) {
    return null
  }

  try {
    return JSON.parse(responseText)
  } catch (error) {
    throw new Error(`Provider response was not valid JSON: ${responseText.slice(0, 300)}`)
  }
}

async function executeOpenAiCompatibleRequest(params: {
  baseUrl: string
  apiKey?: string | null
  model: string
  prompt: string
  systemPrompt: string | null
  contextValue: string | null
  temperature: number | null
  maxTokens: number | null
  responseMode: LlmResponseMode
  structuredOutputJson: string | null
}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (params.apiKey && params.apiKey.trim()) {
    headers.Authorization = `Bearer ${params.apiKey.trim()}`
  }

  const jsonInstruction = buildJsonInstruction(params.responseMode, params.structuredOutputJson)
  const systemMessage = [params.systemPrompt, jsonInstruction].filter((value): value is string => Boolean(value)).join('\n\n')
  const body: Record<string, unknown> = {
    model: params.model,
    messages: [
      ...(systemMessage ? [{ role: 'system', content: systemMessage }] : []),
      { role: 'user', content: buildUserPrompt(params.prompt, params.contextValue) },
    ],
  }

  if (params.temperature !== null) {
    body.temperature = params.temperature
  }

  if (params.maxTokens !== null) {
    body.max_tokens = params.maxTokens
  }

  const response = await fetch(`${params.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`OpenAI-compatible provider request failed (${response.status}): ${errorText || response.statusText}`)
  }

  const responseJson = await parseJsonResponse(response)
  const text = extractOpenAiCompatibleText(responseJson)

  return {
    text,
    raw: responseJson,
    model: normalizeOptionalString(responseJson?.model) ?? params.model,
  }
}

async function executeOllamaRequest(params: {
  baseUrl: string
  model: string
  prompt: string
  systemPrompt: string | null
  contextValue: string | null
  temperature: number | null
  maxTokens: number | null
  responseMode: LlmResponseMode
  structuredOutputJson: string | null
}) {
  const jsonInstruction = buildJsonInstruction(params.responseMode, params.structuredOutputJson)
  const systemBlock = [params.systemPrompt, jsonInstruction].filter((value): value is string => Boolean(value)).join('\n\n')

  const body: Record<string, unknown> = {
    model: params.model,
    prompt: buildUserPrompt(params.prompt, params.contextValue),
    stream: false,
  }

  if (systemBlock) {
    body.system = systemBlock
  }

  const options: Record<string, unknown> = {}
  if (params.temperature !== null) {
    options.temperature = params.temperature
  }
  if (params.maxTokens !== null) {
    options.num_predict = Math.max(1, Math.floor(params.maxTokens))
  }
  if (Object.keys(options).length > 0) {
    body.options = options
  }

  const response = await fetch(`${params.baseUrl.replace(/\/+$/, '')}/api/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`Ollama request failed (${response.status}): ${errorText || response.statusText}`)
  }

  const responseJson = await parseJsonResponse(response)
  const text = normalizeOptionalString(responseJson?.response)
  if (!text) {
    throw new Error('Ollama returned no text response')
  }

  return {
    text,
    raw: responseJson,
    model: normalizeOptionalString(responseJson?.model) ?? params.model,
  }
}

function parseRequestedJson(text: string, responseMode: LlmResponseMode) {
  if (responseMode !== 'json') {
    return null
  }

  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error('LLM 응답이 JSON 형식이 아니야')
  }
}

export async function executeLlmTextRequest(request: ExecuteLlmTextRequest): Promise<ExecuteLlmTextResponse> {
  const providerName = normalizeOptionalString(request.providerName)
  if (!providerName) {
    throw new Error('LLM 연결 이름이 필요해')
  }

  const prompt = normalizeOptionalString(request.prompt)
  if (!prompt) {
    throw new Error('LLM 프롬프트가 비어 있어')
  }

  const provider = ExternalApiProvider.findByName(providerName)
  if (!provider) {
    throw new Error(`LLM 연결을 찾을 수 없어: ${providerName}`)
  }

  if (!provider.is_enabled) {
    throw new Error(`LLM 연결이 비활성화되어 있어: ${provider.display_name}`)
  }

  const baseUrl = normalizeOptionalString(provider.base_url)
  if (!baseUrl) {
    throw new Error(`LLM 연결에 base_url이 없어: ${provider.display_name}`)
  }

  const structuredOutputJson = normalizeStructuredOutputJson(request.structuredOutputJson)
  const responseMode: LlmResponseMode = structuredOutputJson ? 'json' : 'text'
  const model = normalizeOptionalString(request.model) ?? parseProviderDefaultModel(provider.additional_config)
  if (!model) {
    throw new Error(`LLM 모델이 필요해: ${provider.display_name}`)
  }

  const apiKey = ExternalApiProvider.getDecryptedKey(provider.provider_name, true)
  const systemPrompt = normalizeOptionalString(request.systemPrompt)
  const contextValue = normalizeOptionalString(request.context)
  const temperature = normalizeOptionalNumber(request.temperature) ?? parseProviderDefaultTemperature(provider.additional_config)
  const maxTokens = normalizeOptionalNumber(request.maxTokens) ?? parseProviderDefaultMaxTokens(provider.additional_config)

  let result: Awaited<ReturnType<typeof executeOpenAiCompatibleRequest>> | Awaited<ReturnType<typeof executeOllamaRequest>>
  if (provider.provider_type === 'llm_ollama') {
    result = await executeOllamaRequest({
      baseUrl,
      model,
      prompt,
      systemPrompt,
      contextValue,
      temperature,
      maxTokens,
      responseMode,
      structuredOutputJson,
    })
  } else if (provider.provider_type === 'llm_openai_compatible') {
    result = await executeOpenAiCompatibleRequest({
      baseUrl,
      apiKey,
      model,
      prompt,
      systemPrompt,
      contextValue,
      temperature,
      maxTokens,
      responseMode,
      structuredOutputJson,
    })
  } else {
    throw new Error(`이 연결은 LLM 실행용 타입이 아니야: ${provider.display_name}`)
  }

  const jsonValue = parseRequestedJson(result.text, responseMode)
  const metadata = {
    provider_name: provider.provider_name,
    provider_display_name: provider.display_name,
    provider_type: provider.provider_type,
    base_url: baseUrl,
    model: result.model,
    response_mode: responseMode,
    has_json: jsonValue !== null,
    structured_output_json: structuredOutputJson,
    raw_response: result.raw,
  }

  return {
    text: result.text,
    json: jsonValue,
    providerName: provider.provider_name,
    providerType: provider.provider_type,
    model: result.model,
    responseMode,
    metadata,
  }
}
