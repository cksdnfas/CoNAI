import type { WildcardTool } from '@/lib/api'
import type { FlattenedWildcardRecord } from './wildcard-inline-picker-helpers'

export type PromptSyntaxTokenKind = 'wildcard' | 'preprocess' | 'lora'

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
  naiItemCount: number | null
  comfyuiItemCount: number | null
  loraWeight: string | null
  previewItems: string[]
  fallbackMessage: string | null
}

const WILDCARD_TOKEN_REGEX = /\+\+([^+\r\n]+?)\+\+/g
const LORA_TOKEN_REGEX = /<lora:([^:>]+?)(?::([^>]+?))?>/gi
const MAX_PREVIEW_ITEMS = 3

function normalizePromptSyntaxName(value: string) {
  return value.trim().toLowerCase()
}

function buildPathText(record?: FlattenedWildcardRecord | null) {
  if (!record || record.path.length === 0) {
    return null
  }

  return record.path.join(' / ')
}

function countItemsForTool(record: FlattenedWildcardRecord, tool: WildcardTool) {
  return record.items.filter((item) => item.tool === tool).length
}

function createRecordMaps(records: FlattenedWildcardRecord[]) {
  const byId = new Map(records.map((record) => [record.id, record]))
  const childrenByParentId = new Map<number, FlattenedWildcardRecord[]>()

  for (const record of records) {
    if (record.parentId === null) {
      continue
    }

    const siblings = childrenByParentId.get(record.parentId) ?? []
    siblings.push(record)
    childrenByParentId.set(record.parentId, siblings)
  }

  return {
    byId,
    childrenByParentId,
  }
}

function collectRecordPreviewItems(
  record: FlattenedWildcardRecord,
  tool: WildcardTool,
  maps: ReturnType<typeof createRecordMaps>,
  visited: Set<number> = new Set(),
): string[] {
  if (visited.has(record.id)) {
    return []
  }

  visited.add(record.id)
  const previews = record.onlyChildren ? [] : record.items
    .filter((item) => item.tool === tool)
    .map((item) => item.content.trim())
    .filter(Boolean)

  if (record.includeChildren || record.onlyChildren) {
    const children = maps.childrenByParentId.get(record.id) ?? []
    for (const child of children) {
      previews.push(...collectRecordPreviewItems(child, tool, maps, visited))
    }
  }

  return previews
}

function buildPreviewState(
  kind: PromptSyntaxTokenKind,
  record: FlattenedWildcardRecord | null,
  tool: WildcardTool | undefined,
  maps: ReturnType<typeof createRecordMaps>,
) {
  if (!record || !tool) {
    return {
      previewItems: [] as string[],
      fallbackMessage: kind === 'lora' ? 'LoRA 태그로만 동작해.' : '프롬프트로 그대로 동작해.',
    }
  }

  const previewItems = Array.from(new Set(collectRecordPreviewItems(record, tool, maps))).slice(0, MAX_PREVIEW_ITEMS)
  if (previewItems.length > 0) {
    return {
      previewItems,
      fallbackMessage: null,
    }
  }

  return {
    previewItems: [],
    fallbackMessage: '연결된 항목이 없어서 프롬프트로 그대로 동작해.',
  }
}

function buildToken(
  kind: PromptSyntaxTokenKind,
  value: string,
  start: number,
  end: number,
  maps: ReturnType<typeof createRecordMaps>,
  options?: {
    record?: FlattenedWildcardRecord | null
    tool?: WildcardTool
    loraWeight?: string | null
  },
): PromptSyntaxToken {
  const record = options?.record ?? null
  const previewState = buildPreviewState(kind, record, options?.tool, maps)

  return {
    id: `${kind}:${start}:${end}:${value}`,
    key: `${kind}:${normalizePromptSyntaxName(record?.name ?? value)}`,
    kind,
    start,
    end,
    rawText: value,
    name: record?.name ?? value,
    count: 1,
    pathText: buildPathText(record),
    toolItemCount: record && options?.tool ? countItemsForTool(record, options.tool) : null,
    naiItemCount: record ? countItemsForTool(record, 'nai') : null,
    comfyuiItemCount: record ? countItemsForTool(record, 'comfyui') : null,
    loraWeight: options?.loraWeight?.trim() || null,
    previewItems: previewState.previewItems,
    fallbackMessage: previewState.fallbackMessage,
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

/** Detect recognized wildcard, preprocess, and LoRA syntax ranges inside one prompt-like field value. */
export function detectPromptSyntaxTokens(value: string, records: FlattenedWildcardRecord[], tool: WildcardTool) {
  if (!value) {
    return []
  }

  const maps = createRecordMaps(records)
  const wildcardByName = new Map(
    records
      .filter((record) => record.type === 'wildcard')
      .map((record) => [normalizePromptSyntaxName(record.name), record]),
  )
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

  for (const match of value.matchAll(WILDCARD_TOKEN_REGEX)) {
    const rawText = match[0]
    const wildcardName = match[1]?.trim()
    const start = match.index ?? -1

    if (!wildcardName || start < 0) {
      continue
    }

    const record = wildcardByName.get(normalizePromptSyntaxName(wildcardName))
    if (!record) {
      continue
    }

    tokens.push(buildToken('wildcard', rawText, start, start + rawText.length, maps, { record, tool }))
  }

  for (const match of value.matchAll(LORA_TOKEN_REGEX)) {
    const rawText = match[0]
    const loraName = match[1]?.trim()
    const start = match.index ?? -1

    if (!loraName || start < 0) {
      continue
    }

    const record = loraByName.get(normalizePromptSyntaxName(loraName))
    tokens.push(buildToken('lora', rawText, start, start + rawText.length, maps, {
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
      && !/<lora:/i.test(rawSegment)
      && !overlapsExistingRange(tokens, trimmedRange.start, trimmedRange.end)
    ) {
      const record = preprocessByName.get(normalizedSegment)
      if (record) {
        tokens.push(buildToken('preprocess', segmentValue, trimmedRange.start, trimmedRange.end, maps, { record, tool }))
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

  return 'LoRA'
}
