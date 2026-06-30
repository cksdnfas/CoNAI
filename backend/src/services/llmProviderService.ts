import sharp from 'sharp'
import { ExternalApiProvider } from '../models/ExternalApiProvider'
import { normalizeOptionalString } from '../utils/valueNormalization'
import type { ProviderType } from '../types/externalApi'

type LlmResponseMode = 'text' | 'json'
type LlmJsonParseStrategy = 'none' | 'strict' | 'markdown_fence' | 'embedded_json' | 'invalid_escape_repaired'

export type LlmDebugEvent = {
  eventType: 'provider_response' | 'json_parse_failed'
  details: Record<string, unknown>
}

export type ExecuteLlmTextRequest = {
  providerName: string
  prompt: string
  systemPrompt?: string | null
  context?: string | null
  image?: string | null
  model?: string | null
  temperature?: number | null
  maxTokens?: number | null
  responseMode?: LlmResponseMode | null
  structuredOutputJson?: string | null
  onDebugEvent?: (event: LlmDebugEvent) => void
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

const MAX_DEBUG_TEXT_LENGTH = 20_000

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

function truncateDebugText(value: string) {
  if (value.length <= MAX_DEBUG_TEXT_LENGTH) {
    return value
  }

  return `${value.slice(0, MAX_DEBUG_TEXT_LENGTH)}\n...[truncated ${value.length - MAX_DEBUG_TEXT_LENGTH} chars]`
}

function stringifyDebugValue(value: unknown) {
  try {
    return truncateDebugText(JSON.stringify(value, null, 2))
  } catch {
    return '[unserializable]'
  }
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

function parseImageDataUrl(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  const match = trimmed.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
  if (!match) {
    return null
  }

  return {
    dataUrl: trimmed,
    mimeType: match[1].toLowerCase(),
    base64: match[2],
  }
}

async function normalizeVisionImageDataUrl(value: unknown) {
  const parsed = parseImageDataUrl(value)
  if (!parsed) {
    return null
  }

  if (parsed.mimeType === 'image/png' || parsed.mimeType === 'image/jpeg' || parsed.mimeType === 'image/jpg') {
    return parsed.dataUrl
  }

  try {
    const buffer = Buffer.from(parsed.base64, 'base64')
    const pngBuffer = await sharp(buffer, { animated: false }).png().toBuffer()
    return `data:image/png;base64,${pngBuffer.toString('base64')}`
  } catch {
    return parsed.dataUrl
  }
}

function stripImageDataUrlPrefix(value: string) {
  return value.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/i, '')
}

function buildOpenAiCompatibleUserContent(prompt: string, imageDataUrl: string | null, imageFormat: 'data_url' | 'raw_base64' = 'data_url') {
  if (!imageDataUrl) {
    return prompt
  }

  const imageUrl = imageFormat === 'raw_base64' ? stripImageDataUrlPrefix(imageDataUrl) : imageDataUrl
  return [
    { type: 'text', text: prompt },
    { type: 'image_url', image_url: { url: imageUrl } },
  ]
}

function shouldRetryOpenAiCompatibleImageAsRawBase64(status: number, errorText: string) {
  return status === 400 && /base64 encoded image|url.*base64|image.*base64/i.test(errorText)
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
  imageDataUrl: string | null
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
  const userPrompt = buildUserPrompt(params.prompt, params.contextValue)
  const buildBody = (imageFormat: 'data_url' | 'raw_base64') => {
    const body: Record<string, unknown> = {
      model: params.model,
      messages: [
        ...(systemMessage ? [{ role: 'system', content: systemMessage }] : []),
        { role: 'user', content: buildOpenAiCompatibleUserContent(userPrompt, params.imageDataUrl, imageFormat) },
      ],
    }

    if (params.temperature !== null) {
      body.temperature = params.temperature
    }

    if (params.maxTokens !== null) {
      body.max_tokens = params.maxTokens
    }

    return body
  }

  const endpoint = `${params.baseUrl.replace(/\/+$/, '')}/chat/completions`
  let response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(buildBody('data_url')),
  })

  let retriedRawBase64Image = false
  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    if (params.imageDataUrl && shouldRetryOpenAiCompatibleImageAsRawBase64(response.status, errorText)) {
      retriedRawBase64Image = true
      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(buildBody('raw_base64')),
      })
    } else {
      throw new Error(`OpenAI-compatible provider request failed (${response.status}): ${errorText || response.statusText}`)
    }
  }

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
    imagePayloadFormat: retriedRawBase64Image ? 'raw_base64' : params.imageDataUrl ? 'data_url' : null,
  }
}

async function executeOllamaRequest(params: {
  baseUrl: string
  model: string
  prompt: string
  systemPrompt: string | null
  contextValue: string | null
  imageDataUrl: string | null
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

  if (params.imageDataUrl) {
    body.images = [stripImageDataUrlPrefix(params.imageDataUrl)]
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
    imagePayloadFormat: params.imageDataUrl ? 'ollama_images_base64' : null,
  }
}

function tryParseJsonText(text: string) {
  try {
    return { ok: true as const, value: JSON.parse(text) }
  } catch {
    return { ok: false as const }
  }
}

function repairInvalidJsonStringEscapes(text: string) {
  let repaired = ''
  let inString = false
  let changed = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]

    if (!inString) {
      repaired += char
      if (char === '"') {
        inString = true
      }
      continue
    }

    if (char === '"') {
      repaired += char
      inString = false
      continue
    }

    if (char !== '\\') {
      repaired += char
      continue
    }

    const nextChar = text[index + 1]
    if (!nextChar) {
      repaired += char
      continue
    }

    if (/["\\/bfnrtu]/.test(nextChar)) {
      repaired += `${char}${nextChar}`
      index += 1
      continue
    }

    repaired += '\\\\'
    changed = true
  }

  return changed ? repaired : null
}

function tryParseJsonTextWithInvalidEscapeRepair(text: string) {
  const parsed = tryParseJsonText(text)
  if (parsed.ok) {
    return { ...parsed, repaired: false as const }
  }

  const repairedText = repairInvalidJsonStringEscapes(text)
  if (!repairedText) {
    return { ok: false as const }
  }

  const repairedParsed = tryParseJsonText(repairedText)
  if (!repairedParsed.ok) {
    return { ok: false as const }
  }

  return { ok: true as const, value: repairedParsed.value, repaired: true as const }
}

function extractMarkdownJsonFence(text: string) {
  const trimmed = text.trim()
  const match = trimmed.match(/^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/)
  return match?.[1]?.trim() ?? null
}

function extractBalancedJsonAt(text: string, startIndex: number) {
  const openingChar = text[startIndex]
  if (openingChar !== '{' && openingChar !== '[') {
    return null
  }

  const closingChar = openingChar === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === openingChar) {
      depth += 1
    } else if (char === closingChar) {
      depth -= 1
      if (depth === 0) {
        return text.slice(startIndex, index + 1)
      }
    }
  }

  return null
}

function extractFirstParseableJson(text: string) {
  for (let index = 0; index < text.length; index += 1) {
    const candidate = extractBalancedJsonAt(text, index)
    if (!candidate) {
      continue
    }

    const parsed = tryParseJsonTextWithInvalidEscapeRepair(candidate)
    if (parsed.ok) {
      return {
        value: parsed.value,
        repaired: parsed.repaired,
      }
    }
  }

  return undefined
}

export function parseRequestedJson(text: string, responseMode: LlmResponseMode): {
  value: unknown | null
  strategy: LlmJsonParseStrategy
} {
  if (responseMode !== 'json') {
    return { value: null, strategy: 'none' }
  }

  const strictParse = tryParseJsonText(text)
  if (strictParse.ok) {
    return { value: strictParse.value, strategy: 'strict' }
  }

  const repairedStrictParse = tryParseJsonTextWithInvalidEscapeRepair(text)
  if (repairedStrictParse.ok && repairedStrictParse.repaired) {
    return { value: repairedStrictParse.value, strategy: 'invalid_escape_repaired' }
  }

  const fencedText = extractMarkdownJsonFence(text)
  if (fencedText) {
    const fencedParse = tryParseJsonText(fencedText)
    if (fencedParse.ok) {
      return { value: fencedParse.value, strategy: 'markdown_fence' }
    }

    const repairedFencedParse = tryParseJsonTextWithInvalidEscapeRepair(fencedText)
    if (repairedFencedParse.ok && repairedFencedParse.repaired) {
      return { value: repairedFencedParse.value, strategy: 'invalid_escape_repaired' }
    }
  }

  const embeddedJson = extractFirstParseableJson(text)
  if (embeddedJson !== undefined) {
    return { value: embeddedJson.value, strategy: embeddedJson.repaired ? 'invalid_escape_repaired' : 'embedded_json' }
  }

  throw new Error('LLM 응답이 JSON 형식이 아니야')
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
  const imageDataUrl = await normalizeVisionImageDataUrl(request.image)
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
      imageDataUrl,
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
      imageDataUrl,
      temperature,
      maxTokens,
      responseMode,
      structuredOutputJson,
    })
  } else {
    throw new Error(`이 연결은 LLM 실행용 타입이 아니야: ${provider.display_name}`)
  }

  request.onDebugEvent?.({
    eventType: 'provider_response',
    details: {
      providerName: provider.provider_name,
      providerType: provider.provider_type,
      model: result.model,
      responseMode,
      textLength: result.text.length,
      text: truncateDebugText(result.text),
      rawResponse: stringifyDebugValue(result.raw),
    },
  })

  let parsedJson: ReturnType<typeof parseRequestedJson>
  try {
    parsedJson = parseRequestedJson(result.text, responseMode)
  } catch (error) {
    request.onDebugEvent?.({
      eventType: 'json_parse_failed',
      details: {
        providerName: provider.provider_name,
        providerType: provider.provider_type,
        model: result.model,
        responseMode,
        textLength: result.text.length,
        text: truncateDebugText(result.text),
        rawResponse: stringifyDebugValue(result.raw),
      },
    })
    throw error
  }

  const metadata = {
    provider_name: provider.provider_name,
    provider_display_name: provider.display_name,
    provider_type: provider.provider_type,
    base_url: baseUrl,
    model: result.model,
    response_mode: responseMode,
    has_json: parsedJson.value !== null,
    json_parse_strategy: parsedJson.strategy,
    structured_output_json: structuredOutputJson,
    has_image: Boolean(imageDataUrl),
    image_payload_format: result.imagePayloadFormat,
    raw_response: result.raw,
  }

  return {
    text: result.text,
    json: parsedJson.value,
    providerName: provider.provider_name,
    providerType: provider.provider_type,
    model: result.model,
    responseMode,
    metadata,
  }
}
