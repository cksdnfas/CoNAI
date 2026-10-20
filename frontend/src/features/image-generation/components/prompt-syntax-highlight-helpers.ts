import {
  countWildcardItemsForTool,
  type FlattenedWildcardRecord,
  type PromptWildcardTool,
} from './wildcard-inline-picker-helpers'

export type PromptSyntaxTokenKind = 'wildcard' | 'preprocess' | 'lora' | 'comment'

export type PromptSyntaxToken = {
  id: string
  key: string
  kind: PromptSyntaxTokenKind
  start: number
  end: number
  rawText: string
  name: string
  count: number
  pathText: string | null
  toolItemCount: number | null
  generalItemCount: number | null
  naiItemCount: number | null
  comfyuiItemCount: number | null
  loraWeight: string | null
  wildcardId: number | null
  fallbackMessage: string | null
}

const LORA_TOKEN_REGEX = /<lora:([^:>]+?)(?::([^>]+?))?>/gi
const PROMPT_COMMENT_TOKEN_REGEX = /\/\/([^/\r\n]+?)\/\//g

function normalizePromptSyntaxName(value: string) {
  return value.trim().toLowerCase()
}

function buildPathText(record?: FlattenedWildcardRecord | null) {
  if (!record || record.path.length === 0) {
    return null
  }

  return record.path.join(' / ')
}

function buildToken(
  kind: PromptSyntaxTokenKind,
  value: string,
  start: number,
  end: number,
  options?: {
    record?: FlattenedWildcardRecord | null
    tool?: PromptWildcardTool
    loraWeight?: string | null
  },
): PromptSyntaxToken {
  const record = options?.record ?? null

  return {
    id: `${kind}:${start}:${end}:${value}`,
    key: kind === 'comment' ? 'comment:prompt-preset' : `${kind}:${normalizePromptSyntaxName(record?.name ?? value)}`,
    kind,
    start,
    end,
    rawText: value,
    name: kind === 'comment' ? '프리셋 주석' : record?.name ?? value,
    count: 1,
    pathText: buildPathText(record),
    toolItemCount: record && options?.tool ? countWildcardItemsForTool(record.itemCounts, options.tool) : null,
    generalItemCount: record?.itemCounts.general ?? null,
    naiItemCount: record?.itemCounts.nai ?? null,
    comfyuiItemCount: record?.itemCounts.comfyui ?? null,
    loraWeight: options?.loraWeight?.trim() || null,
    wildcardId: record?.id ?? null,
    fallbackMessage: record ? null : kind === 'comment' ? '프리셋 주석이야. 생성 요청 전에는 제거돼.' : kind === 'lora' ? 'LoRA 태그로만 동작해.' : '프롬프트로 그대로 동작해.',
  }
}

function overlapsExistingRange(tokens: PromptSyntaxToken[], start: number, end: number) {
  return tokens.some((token) => start < token.end && end > token.start)
}

function adjustTrimmedRange(value: string, start: number, end: number) {
  let nextStart = start
  let nextEnd = end

  while (nextStart < nextEnd && /\s/.test(value[nextStart] ?? '')) {
    nextStart += 1
  }

  while (nextEnd > nextStart && /\s/.test(value[nextEnd - 1] ?? '')) {
    nextEnd -= 1
  }

  return {
    start: nextStart,
    end: nextEnd,
  }
}

/** Detect recognized preprocess, comment, and LoRA syntax ranges inside one prompt-like field value. */
export function detectPromptSyntaxTokens(value: string, records: FlattenedWildcardRecord[], tool: PromptWildcardTool) {
  if (!value) {
    return []
  }

  // 와일드카드·태그 그룹 토큰은 입력창 칩(prompt-random-token)이 담당한다
  const preprocessByName = new Map(
    records
      .filter((record) => record.type === 'chain' && !record.isAutoCollected)
      .map((record) => [normalizePromptSyntaxName(record.name), record]),
  )
  const loraByName = new Map(
    records
      .filter((record) => record.isAutoCollected)
      .map((record) => [normalizePromptSyntaxName(record.name), record]),
  )

  const tokens: PromptSyntaxToken[] = []

  for (const match of value.matchAll(PROMPT_COMMENT_TOKEN_REGEX)) {
    const rawText = match[0]
    const commentName = match[1]?.trim()
    const start = match.index ?? -1

    if (!commentName || start < 0) {
      continue
    }

    tokens.push(buildToken('comment', rawText, start, start + rawText.length))
  }

  for (const match of value.matchAll(LORA_TOKEN_REGEX)) {
    const rawText = match[0]
    const loraName = match[1]?.trim()
    const start = match.index ?? -1

    if (!loraName || start < 0) {
      continue
    }

    const record = loraByName.get(normalizePromptSyntaxName(loraName))
    tokens.push(buildToken('lora', rawText, start, start + rawText.length, {
      record,
      tool,
      loraWeight: match[2] ?? null,
    }))
  }

  let segmentStart = 0

  for (let index = 0; index <= value.length; index += 1) {
    const character = value[index]
    const isBoundary = index === value.length || character === ',' || character === '\n' || character === '\r'

    if (!isBoundary) {
      continue
    }

    const rawSegment = value.slice(segmentStart, index)
    const trimmedRange = adjustTrimmedRange(value, segmentStart, index)
    const segmentValue = value.slice(trimmedRange.start, trimmedRange.end)
    const normalizedSegment = normalizePromptSyntaxName(segmentValue)

    if (
      normalizedSegment
      && !rawSegment.includes('++')
      && !rawSegment.includes('__')
      && !/<lora:/i.test(rawSegment)
      && !overlapsExistingRange(tokens, trimmedRange.start, trimmedRange.end)
    ) {
      const record = preprocessByName.get(normalizedSegment)
      if (record) {
        tokens.push(buildToken('preprocess', segmentValue, trimmedRange.start, trimmedRange.end, { record, tool }))
      }
    }

    segmentStart = index + 1
  }

  return tokens.sort((left, right) => left.start - right.start || left.end - right.end)
}

/** Collapse repeated prompt syntax matches into compact unique summary entries for the inspector row. */
export function summarizePromptSyntaxTokens(tokens: PromptSyntaxToken[]) {
  const byKey = new Map<string, PromptSyntaxToken>()

  for (const token of tokens) {
    const existing = byKey.get(token.key)
    if (existing) {
      existing.count += 1
      continue
    }

    byKey.set(token.key, { ...token })
  }

  return Array.from(byKey.values())
}

/** Return the compact Korean label used by the token summary UI. */
export function getPromptSyntaxKindLabel(kind: PromptSyntaxTokenKind) {
  if (kind === 'wildcard') {
    return '와일드카드'
  }

  if (kind === 'preprocess') {
    return '전처리'
  }

  if (kind === 'comment') {
    return '주석'
  }

  return 'LoRA'
}
