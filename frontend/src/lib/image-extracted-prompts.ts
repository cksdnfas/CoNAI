import type { ImageAiRawNaiParameters, ImageRecord } from '@/types/image'
import type { PromptGroupResolveItem } from '@/types/prompt'

export interface ExtractedPromptCardItem {
  id: string
  title: string
  text: string
  tone: 'positive' | 'negative' | 'character' | 'neutral'
  badges?: string[]
}

function getTrimmedText(value?: string | null) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function getNormalizedComparableText(value?: string | null) {
  return getTrimmedText(value)?.replace(/\s+/g, ' ') ?? null
}

function getRawPositivePrompt(raw?: ImageAiRawNaiParameters | null) {
  return getTrimmedText(raw?.v4_prompt?.caption?.base_caption ?? raw?.prompt)
}

function getRawNegativePrompt(raw?: ImageAiRawNaiParameters | null) {
  return getTrimmedText(raw?.v4_negative_prompt?.caption?.base_caption ?? raw?.uc)
}

function getRawCharacterPrompts(raw?: ImageAiRawNaiParameters | null) {
  const captions = raw?.v4_prompt?.caption?.char_captions
  if (!Array.isArray(captions)) {
    return []
  }

  return captions
    .map((item) => getTrimmedText(item?.char_caption))
    .filter((value): value is string => Boolean(value))
}

function isProcessedPrompt(displayText: string, rawText?: string | null) {
  const normalizedDisplay = getNormalizedComparableText(displayText)
  const normalizedRaw = getNormalizedComparableText(rawText)

  return Boolean(normalizedDisplay && normalizedRaw && normalizedDisplay !== normalizedRaw)
}

function isLoraToken(value: string) {
  const trimmed = value.trim().toLowerCase()
  return trimmed.startsWith('<lora:') && trimmed.includes('>')
}

function splitPromptTokens(prompt?: string | null) {
  const trimmedPrompt = getTrimmedText(prompt)
  if (!trimmedPrompt) {
    return { loras: [] as string[], terms: [] as string[] }
  }

  const loras: string[] = []
  const terms: string[] = []

  trimmedPrompt
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => {
      if (isLoraToken(item)) {
        loras.push(item)
        return
      }

      terms.push(item)
    })

  return { loras, terms }
}

function cleanPromptTerm(term: string) {
  if (!term) {
    return ''
  }

  let cleaned = term
  let previousLength = -1

  while (cleaned.length !== previousLength) {
    previousLength = cleaned.length
    cleaned = cleaned.replace(/[()[\]{}]/g, '')
  }

  cleaned = cleaned.replace(/:[+-]?[\d.]+/g, '')
  cleaned = cleaned.replace(/_/g, ' ')
  cleaned = cleaned.replace(/\s+/g, ' ').trim()

  return cleaned
}

function removeLoraWeight(value: string) {
  return value.replace(/(<lora:[^:>]+)(?::[^>]+)?>/i, '$1>')
}

function formatLoraDisplayName(value: string) {
  const trimmed = value.trim()
  const matched = trimmed.match(/^<lora:([^:>]+)(?::[^>]+)?>$/i)
  const name = matched?.[1] ?? trimmed
  return name.replace(/_/g, ' ').trim()
}

function dedupePreservingOrder(values: string[]) {
  const seen = new Set<string>()
  const items: string[] = []

  values.forEach((value) => {
    const trimmed = value.trim()
    if (!trimmed) {
      return
    }

    const lookupKey = trimmed.toLowerCase()
    if (seen.has(lookupKey)) {
      return
    }

    seen.add(lookupKey)
    items.push(trimmed)
  })

  return items
}

function getPromptGroupingLabel(groupInfo?: PromptGroupResolveItem['group_info']) {
  const name = groupInfo?.group_name?.trim()
  if (!name || name === 'Unclassified') {
    return '미분류'
  }

  return name
}

function getPromptGroupingOrder(groupInfo?: PromptGroupResolveItem['group_info']) {
  if (!groupInfo || groupInfo.group_name === 'Unclassified') {
    return Number.MAX_SAFE_INTEGER
  }

  return 'display_order' in groupInfo && typeof groupInfo.display_order === 'number'
    ? groupInfo.display_order
    : Number.MAX_SAFE_INTEGER - 1
}

export function getImagePromptTerms(image: ImageRecord, type: 'positive' | 'negative') {
  const rawNaiParameters = image.ai_metadata?.raw_nai_parameters
  const promptText = type === 'positive'
    ? getTrimmedText(image.ai_metadata?.prompts?.prompt) ?? getRawPositivePrompt(rawNaiParameters)
    : getTrimmedText(image.ai_metadata?.prompts?.negative_prompt) ?? getRawNegativePrompt(rawNaiParameters)

  const { terms } = splitPromptTokens(promptText)
  return dedupePreservingOrder(
    terms
      .map((term) => cleanPromptTerm(term))
      .filter(Boolean),
  )
}

export function getImageLoraModels(image: ImageRecord) {
  const metadataLoraSource = image.ai_metadata?.lora_models
  const metadataLoraValues = Array.isArray(metadataLoraSource) ? metadataLoraSource : []
  const metadataLoras = metadataLoraValues.map((item) => formatLoraDisplayName(removeLoraWeight(String(item))))

  const positiveLoras = splitPromptTokens(getTrimmedText(image.ai_metadata?.prompts?.prompt) ?? getRawPositivePrompt(image.ai_metadata?.raw_nai_parameters)).loras
  const negativeLoras = splitPromptTokens(getTrimmedText(image.ai_metadata?.prompts?.negative_prompt) ?? getRawNegativePrompt(image.ai_metadata?.raw_nai_parameters)).loras

  return dedupePreservingOrder([
    ...metadataLoras,
    ...positiveLoras.map((item) => formatLoraDisplayName(removeLoraWeight(item))),
    ...negativeLoras.map((item) => formatLoraDisplayName(removeLoraWeight(item))),
  ])
}

export function formatGroupedPromptText(terms: string[], resolvedItems: PromptGroupResolveItem[]) {
  if (terms.length === 0) {
    return ''
  }

  const resolvedByKey = new Map(
    resolvedItems.map((item) => [item.query.trim().toLowerCase(), item] as const),
  )

  const grouped = new Map<string, { label: string; order: number; prompts: string[] }>()

  terms.forEach((term) => {
    const resolvedItem = resolvedByKey.get(term.trim().toLowerCase())
    const label = getPromptGroupingLabel(resolvedItem?.group_info)
    const order = getPromptGroupingOrder(resolvedItem?.group_info)
    const existing = grouped.get(label)

    if (existing) {
      existing.prompts.push(term)
      return
    }

    grouped.set(label, {
      label,
      order,
      prompts: [term],
    })
  })

  return [...grouped.values()]
    .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label, 'ko'))
    .map((group) => `${group.label}\n${group.prompts.join(', ')}`)
    .join('\n\n')
}

/** Build reusable extracted prompt card data from an image record. */
export function getImageExtractedPromptCards(image: ImageRecord) {
  const prompts = image.ai_metadata?.prompts
  const rawNaiParameters = image.ai_metadata?.raw_nai_parameters

  const positiveText = getTrimmedText(prompts?.prompt) ?? getRawPositivePrompt(rawNaiParameters)
  const negativeText = getTrimmedText(prompts?.negative_prompt) ?? getRawNegativePrompt(rawNaiParameters)

  const promptCharacters = Array.isArray(prompts?.characters)
    ? prompts.characters.map((item) => getTrimmedText(item)).filter((value): value is string => Boolean(value))
    : []
  const rawCharacters = getRawCharacterPrompts(rawNaiParameters)
  const fallbackCharacterText = getTrimmedText(prompts?.character_prompt_text)
  const characterTexts = promptCharacters.length > 0 ? promptCharacters : rawCharacters.length > 0 ? rawCharacters : fallbackCharacterText ? [fallbackCharacterText] : []
  const loraModels = getImageLoraModels(image)

  const cards: ExtractedPromptCardItem[] = []

  if (positiveText) {
    cards.push({
      id: 'positive-prompt',
      title: '긍정 프롬프트',
      text: positiveText,
      tone: 'positive',
      badges: ['그룹', ...(isProcessedPrompt(positiveText, getRawPositivePrompt(rawNaiParameters)) ? ['가공됨'] : [])],
    })
  }

  characterTexts.forEach((text, index) => {
    cards.push({
      id: `character-prompt-${index + 1}`,
      title: characterTexts.length > 1 ? `캐릭터 ${index + 1}` : '캐릭터',
      text,
      tone: 'character',
    })
  })

  if (negativeText) {
    cards.push({
      id: 'negative-prompt',
      title: '부정 프롬프트',
      text: negativeText,
      tone: 'negative',
      badges: ['그룹', ...(isProcessedPrompt(negativeText, getRawNegativePrompt(rawNaiParameters)) ? ['가공됨'] : [])],
    })
  }

  if (loraModels.length > 0) {
    cards.push({
      id: 'lora-prompt',
      title: 'LoRA',
      text: loraModels.join(', '),
      tone: 'neutral',
    })
  }

  return cards
}
