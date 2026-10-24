import sharp from 'sharp'
export { normalizeStructuredOutputJson } from './llmPresetNormalization'

export type LlmResponseMode = 'text' | 'json'
type LlmJsonParseStrategy = 'none' | 'strict' | 'markdown_fence' | 'embedded_json' | 'invalid_escape_repaired'

export function buildJsonInstruction(responseMode: LlmResponseMode, structuredOutputJson: string | null) {
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

export function buildUserPrompt(prompt: string, contextValue: string | null) {
  if (!contextValue) {
    return prompt
  }

  return `Context:\n${contextValue}\n\nUser request:\n${prompt}`
}

export function parseImageDataUrl(value: unknown) {
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

export async function normalizeVisionImageDataUrl(value: unknown) {
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

const EMBEDDED_JSON_SCAN_MAX_LENGTH = 4_000_000
const EMBEDDED_JSON_SCAN_MAX_CANDIDATES = 500
const EMBEDDED_JSON_SCAN_MAX_WORK = 8_000_000

function extractFirstParseableJson(text: string) {
  // Only opening braces/brackets can start a JSON document. Prose can hold plenty of them, so the guard
  // is on actual work (balanced candidates parsed + characters walked), not on how many braces appear.
  const scanLength = Math.min(text.length, EMBEDDED_JSON_SCAN_MAX_LENGTH)
  let candidateCount = 0
  let scannedLength = 0

  for (let index = 0; index < scanLength; index += 1) {
    const char = text[index]
    if (char !== '{' && char !== '[') {
      continue
    }

    const candidate = extractBalancedJsonAt(text, index)
    // An unbalanced opener walks to the end of the text before failing, so charge that to the budget too.
    scannedLength += candidate ? candidate.length : text.length - index

    if (candidate) {
      const parsed = tryParseJsonTextWithInvalidEscapeRepair(candidate)
      if (parsed.ok) {
        return {
          value: parsed.value,
          repaired: parsed.repaired,
        }
      }

      candidateCount += 1
    }

    if (candidateCount >= EMBEDDED_JSON_SCAN_MAX_CANDIDATES || scannedLength >= EMBEDDED_JSON_SCAN_MAX_WORK) {
      return undefined
    }
  }

  return undefined
}

/** A JSON answer cut off before it closed. Its message names no provider detail, so callers may show it as is. */
export class LlmJsonTruncatedError extends Error {}

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

  // An answer that opens as JSON but never closes was cut off, usually by the token cap. Scanning it for embedded
  // JSON would return its first complete inner value (one list item, say) as if it were the whole answer.
  const body = text.trimStart().replace(/^```(?:json|JSON)?\s*/, '')
  if ((body.startsWith('{') || body.startsWith('[')) && !extractBalancedJsonAt(body, 0)) {
    throw new LlmJsonTruncatedError('LLM의 JSON 답이 중간에 끊겼어. 답변 한도를 늘리거나 요청 범위를 줄여줘.')
  }

  const embeddedJson = extractFirstParseableJson(text)
  if (embeddedJson !== undefined) {
    return { value: embeddedJson.value, strategy: embeddedJson.repaired ? 'invalid_escape_repaired' : 'embedded_json' }
  }

  throw new Error('LLM 응답이 JSON 형식이 아니야')
}
