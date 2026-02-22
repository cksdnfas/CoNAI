import { wildcardApi, type WildcardWithItems } from '@/services/wildcard-api'
import { cleanPrompt } from '@/utils/prompt-cleaner'

let wildcardCache: WildcardWithItems[] | null = null
let cacheTimestamp = 0
const cacheTtl = 60000

async function loadWildcards(): Promise<WildcardWithItems[]> {
  const now = Date.now()

  if (wildcardCache && now - cacheTimestamp < cacheTtl) {
    return wildcardCache
  }

  try {
    const response = await wildcardApi.getAllWildcards(true)
    wildcardCache = response.data || []
    cacheTimestamp = now
    return wildcardCache
  } catch (error) {
    console.error('Failed to load wildcards:', error)
    return []
  }
}

export function invalidateWildcardCache(): void {
  wildcardCache = null
  cacheTimestamp = 0
}

function parseWeightListSyntax(text: string): string {
  const pattern = /\(([^,)]+),\s*([\d.,\s-]+)\)/g

  return text.replace(pattern, (match, tag, weights) => {
    const weightValues = (weights as string)
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0 && !Number.isNaN(parseFloat(value)))

    if (weightValues.length === 0) {
      return match
    }

    const randomWeight = weightValues[Math.floor(Math.random() * weightValues.length)]
    return `(${String(tag).trim()}:${randomWeight})`
  })
}

function parseWeightRangeSyntax(text: string): string {
  const pattern = /\(([^,)]+),\s*([-\d.]+)~([-\d.]+),\s*([\d.]+)\)/g

  return text.replace(pattern, (match, tag, minText, maxText, stepText) => {
    const min = parseFloat(minText as string)
    const max = parseFloat(maxText as string)
    const step = parseFloat(stepText as string)

    if (Number.isNaN(min) || Number.isNaN(max) || Number.isNaN(step) || step <= 0 || min >= max) {
      return match
    }

    const values: number[] = []
    for (let value = min; value <= max; value = parseFloat((value + step).toFixed(10))) {
      values.push(parseFloat(value.toFixed(2)))
    }

    if (values.length === 0) {
      return match
    }

    const randomValue = values[Math.floor(Math.random() * values.length)]
    return `(${String(tag).trim()}:${randomValue})`
  })
}

function cleanupWildcardWeights(text: string): string {
  const pattern = /\((\+\+[^+]+\+\+):[\d.]+\)/g
  return text.replace(pattern, '$1')
}

export interface ParseResult {
  text: string
  emptyWildcards: string[]
}

function collectAllItems(
  wildcard: WildcardWithItems,
  wildcardMap: Map<string, WildcardWithItems>,
  tool: 'comfyui' | 'nai',
): Array<{ content: string; tool: string }> {
  const items: Array<{ content: string; tool: string }> = []

  if (wildcard.items) {
    items.push(...wildcard.items.filter((item) => item.tool === tool))
  }

  if (wildcard.include_children === 1) {
    wildcardMap.forEach((child) => {
      if (child.parent_id === wildcard.id) {
        items.push(...collectAllItems(child, wildcardMap, tool))
      }
    })
  }

  return items
}

function parseRecursive(
  text: string,
  wildcardMap: Map<string, WildcardWithItems>,
  tool: 'comfyui' | 'nai',
  visited: Set<string>,
  emptyWildcards: Set<string>,
): string {
  const pattern = /\+\+([^+]+)\+\+/g

  const result = text.replace(pattern, (_match, nameText) => {
    const name = String(nameText)

    if (visited.has(name)) {
      return ''
    }

    const wildcard = wildcardMap.get(name)
    if (!wildcard) {
      emptyWildcards.add(name)
      return ''
    }

    const toolItems = collectAllItems(wildcard, wildcardMap, tool)
    if (toolItems.length === 0) {
      emptyWildcards.add(name)
      return ''
    }

    const randomIndex = Math.floor(Math.random() * toolItems.length)
    const selectedItem = toolItems[randomIndex]
    visited.add(name)
    const recursiveResult = parseRecursive(selectedItem.content, wildcardMap, tool, visited, emptyWildcards)
    visited.delete(name)
    return recursiveResult
  })

  const rangeParsed = parseWeightRangeSyntax(result)
  return parseWeightListSyntax(rangeParsed)
}

export async function parseWildcards(text: string, tool: 'comfyui' | 'nai'): Promise<ParseResult> {
  if (!text) {
    return { text, emptyWildcards: [] }
  }

  const wildcards = await loadWildcards()
  const wildcardMap = new Map<string, WildcardWithItems>()
  wildcards.forEach((wildcard) => wildcardMap.set(wildcard.name, wildcard))

  const processedText = cleanupWildcardWeights(text)
  const emptyWildcards = new Set<string>()

  let result = processedText
  if (processedText.includes('++')) {
    result = parseRecursive(processedText, wildcardMap, tool, new Set(), emptyWildcards)
  } else {
    result = parseWeightRangeSyntax(processedText)
    result = parseWeightListSyntax(result)
  }

  result = result.replace(/\s+/g, ' ').trim()

  return {
    text: result,
    emptyWildcards: Array.from(emptyWildcards),
  }
}

export interface ObjectParseResult {
  data: unknown
  emptyWildcards: string[]
}

export async function parseObjectWildcards(obj: unknown, tool: 'comfyui' | 'nai'): Promise<ObjectParseResult> {
  const emptyWildcardsSet = new Set<string>()

  async function parseRecursiveObject(value: unknown): Promise<unknown> {
    if (typeof value === 'string') {
      const result = await parseWildcards(value, tool)
      result.emptyWildcards.forEach((wildcard) => emptyWildcardsSet.add(wildcard))
      return cleanPrompt(result.text)
    }

    if (Array.isArray(value)) {
      return await Promise.all(value.map((item) => parseRecursiveObject(item)))
    }

    if (value && typeof value === 'object') {
      const inputRecord = value as Record<string, unknown>
      const result: Record<string, unknown> = {}
      const keys = Object.keys(inputRecord)
      for (const key of keys) {
        result[key] = await parseRecursiveObject(inputRecord[key])
      }
      return result
    }

    return value
  }

  const data = await parseRecursiveObject(obj)
  return {
    data,
    emptyWildcards: Array.from(emptyWildcardsSet),
  }
}

export function extractWildcardNames(text: string): string[] {
  const pattern = /\+\+([^+]+)\+\+/g
  const names: string[] = []
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    names.push(match[1])
  }

  return [...new Set(names)]
}
