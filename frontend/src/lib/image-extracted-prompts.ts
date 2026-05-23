import { shellCatalog } from '@/i18n/resources'
import type { TranslationInput, TranslationParams } from '@/i18n'
import type { ImageAiRawNaiParameters, ImageRecord } from '@/types/image'
import type { PromptGroupResolveItem } from '@/types/prompt'

export interface ExtractedPromptActionTerm {
  display: string
  searchValue: string
}

export interface ExtractedPromptGroupedSection {
  id: string
  label: string
  prompts: ExtractedPromptActionTerm[]
  hierarchyPath?: string[]
  kind: 'root' | 'child' | 'unclassified'
}

export interface PromptGroupingDisplayOptions {
  classificationDepth: number
  treatDanbooruAsRoot: boolean
}

const DEFAULT_PROMPT_GROUPING_DISPLAY_OPTIONS: PromptGroupingDisplayOptions = {
  classificationDepth: 1,
  treatDanbooruAsRoot: false,
}

export type ExtractedPromptActionScope = 'positive' | 'negative' | 'lora'

export interface ExtractedPromptCardItem {
  id: string
  title: string
  text: string
  tone: 'positive' | 'negative' | 'character' | 'neutral'
  actionScope?: ExtractedPromptActionScope
  actionTerms?: ExtractedPromptActionTerm[]
  badges?: string[]
  groupedSections?: ExtractedPromptGroupedSection[]
}

interface ExtractedPromptCardLabels {
  positivePrompt: string
  negativePrompt: string
  character: string
  characterIndexed: (index: number) => string
  processedBadge: string
}

type TranslateText = (input: TranslationInput, variables?: TranslationParams) => string

const EXTRACTED_PROMPT_LABEL_KEYS = {
  positivePrompt: 'extractedPromptLabels.positivePrompt',
  negativePrompt: 'extractedPromptLabels.negativePrompt',
  character: 'extractedPromptLabels.character',
  characterIndexed: 'extractedPromptLabels.characterIndexed',
  processedBadge: 'extractedPromptLabels.processedBadge',
  unclassified: 'extractedPromptLabels.unclassified',
} as const

function formatStaticCatalogText(template: string, variables?: TranslationParams) {
  if (!variables) {
    return template
  }

  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const value = variables[key]
    return value === undefined || value === null ? match : String(value)
  })
}

function getStaticCatalogText(key: string, variables?: TranslationParams) {
  const catalog = shellCatalog as Record<string, Partial<Record<'ko' | 'en', string>>>
  const template = catalog[key]?.ko ?? catalog[key]?.en ?? key
  return formatStaticCatalogText(template, variables)
}

function translateOrFallback(translate: TranslateText | undefined, key: string, variables?: TranslationParams) {
  return translate ? translate(key, variables) : getStaticCatalogText(key, variables)
}

const DEFAULT_EXTRACTED_PROMPT_CARD_LABELS: ExtractedPromptCardLabels = {
  positivePrompt: getStaticCatalogText(EXTRACTED_PROMPT_LABEL_KEYS.positivePrompt),
  negativePrompt: getStaticCatalogText(EXTRACTED_PROMPT_LABEL_KEYS.negativePrompt),
  character: getStaticCatalogText(EXTRACTED_PROMPT_LABEL_KEYS.character),
  characterIndexed: (index) => getStaticCatalogText(EXTRACTED_PROMPT_LABEL_KEYS.characterIndexed, { index }),
  processedBadge: getStaticCatalogText(EXTRACTED_PROMPT_LABEL_KEYS.processedBadge),
}

function resolveExtractedPromptCardLabels(translate?: TranslateText): ExtractedPromptCardLabels {
  if (!translate) {
    return DEFAULT_EXTRACTED_PROMPT_CARD_LABELS
  }

  return {
    positivePrompt: translateOrFallback(translate, EXTRACTED_PROMPT_LABEL_KEYS.positivePrompt),
    negativePrompt: translateOrFallback(translate, EXTRACTED_PROMPT_LABEL_KEYS.negativePrompt),
    character: translateOrFallback(translate, EXTRACTED_PROMPT_LABEL_KEYS.character),
    characterIndexed: (index) => translateOrFallback(translate, EXTRACTED_PROMPT_LABEL_KEYS.characterIndexed, { index }),
    processedBadge: translateOrFallback(translate, EXTRACTED_PROMPT_LABEL_KEYS.processedBadge),
  }
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

export function getImageExtractedPromptSummary(image: ImageRecord) {
  const prompts = image.ai_metadata?.prompts
  const rawNaiParameters = image.ai_metadata?.raw_nai_parameters

  const positivePrompt = getTrimmedText(prompts?.prompt) ?? getRawPositivePrompt(rawNaiParameters) ?? null
  const negativePrompt = getTrimmedText(prompts?.negative_prompt) ?? getRawNegativePrompt(rawNaiParameters) ?? null
  const promptCharacters = Array.isArray(prompts?.characters)
    ? prompts.characters.map((item) => getTrimmedText(item)).filter((value): value is string => Boolean(value))
    : []
  const rawCharacters = getRawCharacterPrompts(rawNaiParameters)
  const fallbackCharacterText = getTrimmedText(prompts?.character_prompt_text)
  const characterPrompts = promptCharacters.length > 0 ? promptCharacters : rawCharacters.length > 0 ? rawCharacters : fallbackCharacterText ? [fallbackCharacterText] : []

  return {
    positivePrompt,
    negativePrompt,
    characterPrompts,
    characterPromptText: characterPrompts.join(', ') || null,
  }
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

const WEIGHT_NUMBER_SOURCE = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)'
const WEIGHTED_PARENTHESES_PATTERN = new RegExp(`\\(([^()]+(?:[^()]*)?):${WEIGHT_NUMBER_SOURCE}\\)`, 'g')
const WEIGHTED_SQUARE_BRACKETS_PATTERN = new RegExp(`\\[([^\\[\\]]+(?:[^\\[\\]]*)?):${WEIGHT_NUMBER_SOURCE}\\]`, 'g')
const WEIGHTED_CURLY_BRACKETS_PATTERN = new RegExp(`\\{([^{}]+(?:[^{}]*)?):${WEIGHT_NUMBER_SOURCE}\\}`, 'g')

function removePromptWeights(term: string) {
  let cleaned = term
  let previous = ''

  while (cleaned !== previous) {
    previous = cleaned
    cleaned = cleaned
      .replace(WEIGHTED_PARENTHESES_PATTERN, '$1')
      .replace(WEIGHTED_SQUARE_BRACKETS_PATTERN, '$1')
      .replace(WEIGHTED_CURLY_BRACKETS_PATTERN, '$1')
  }

  return cleaned
}

function normalizePromptDisplayTerm(term: string) {
  return term
    .replace(/\\([()[\]{}])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanPromptTerm(term: string) {
  if (!term) {
    return ''
  }

  return removePromptWeights(normalizePromptDisplayTerm(term))
    .replace(/\s+/g, ' ')
    .trim()
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

function toPromptActionTerm(display: string, searchValue = display): ExtractedPromptActionTerm | null {
  const normalizedDisplay = display.trim()
  const normalizedSearchValue = searchValue.trim()

  if (!normalizedDisplay || !normalizedSearchValue) {
    return null
  }

  return {
    display: normalizedDisplay,
    searchValue: normalizedSearchValue,
  }
}

function dedupePromptActionTerms(values: ExtractedPromptActionTerm[]) {
  const seen = new Set<string>()
  const items: ExtractedPromptActionTerm[] = []

  values.forEach((value) => {
    const lookupKey = value.searchValue.trim().toLowerCase()
    if (!lookupKey || seen.has(lookupKey)) {
      return
    }

    seen.add(lookupKey)
    items.push(value)
  })

  return items
}

function getPromptTermItems(prompt?: string | null) {
  const { terms } = splitPromptTokens(prompt)

  return dedupePromptActionTerms(
    terms
      .map((term) => toPromptActionTerm(normalizePromptDisplayTerm(term), cleanPromptTerm(term)))
      .filter((term): term is ExtractedPromptActionTerm => Boolean(term)),
  )
}


function getPromptGroupingUnclassifiedLabel(translate?: TranslateText) {
  return translateOrFallback(translate, EXTRACTED_PROMPT_LABEL_KEYS.unclassified)
}

function getPromptGroupingLabel(groupInfo?: PromptGroupResolveItem['group_info'], translate?: TranslateText) {
  const name = groupInfo?.group_name?.trim()
  if (!name || name === 'Unclassified') {
    return getPromptGroupingUnclassifiedLabel(translate)
  }

  return name
}

function getPromptGroupingOrder(groupInfo?: PromptGroupResolveItem['group_info']) {
  if (!groupInfo || groupInfo.group_name === 'Unclassified') {
    return Number.MAX_SAFE_INTEGER
  }

  return typeof groupInfo.display_order === 'number'
    ? groupInfo.display_order
    : Number.MAX_SAFE_INTEGER - 1
}

function getPromptGroupingPath(groupInfo?: PromptGroupResolveItem['group_info'], translate?: TranslateText) {
  const path = Array.isArray(groupInfo?.group_path) ? groupInfo.group_path.filter(Boolean) : []
  if (path.length > 0) {
    return path
  }

  if (!groupInfo?.group_name || groupInfo.group_name === 'Unclassified') {
    return [getPromptGroupingUnclassifiedLabel(translate)]
  }

  return [groupInfo.group_name]
}

function isDanbooruRootGroupName(value?: string | null) {
  const normalized = value?.trim().toLowerCase()
  return normalized === 'danbooru' || normalized === '\uB2E8\uBD80\uB8E8'
}

function normalizePromptGroupingDisplayOptions(options?: Partial<PromptGroupingDisplayOptions>): PromptGroupingDisplayOptions {
  const parsedDepth = Number(options?.classificationDepth)
  return {
    classificationDepth: Number.isFinite(parsedDepth) ? Math.max(1, Math.min(6, Math.trunc(parsedDepth))) : DEFAULT_PROMPT_GROUPING_DISPLAY_OPTIONS.classificationDepth,
    treatDanbooruAsRoot: options?.treatDanbooruAsRoot ?? DEFAULT_PROMPT_GROUPING_DISPLAY_OPTIONS.treatDanbooruAsRoot,
  }
}

function getVisiblePromptGroupingPath(groupInfo: PromptGroupResolveItem['group_info'] | undefined, options: PromptGroupingDisplayOptions, translate?: TranslateText) {
  const sourcePath = getPromptGroupingPath(groupInfo, translate)
  const shiftedPath = !options.treatDanbooruAsRoot && isDanbooruRootGroupName(sourcePath[0])
    ? sourcePath.slice(1)
    : sourcePath
  const visiblePath = (shiftedPath.length > 0 ? shiftedPath : sourcePath).slice(0, options.classificationDepth)

  return visiblePath.length > 0 ? visiblePath : [getPromptGroupingUnclassifiedLabel(translate)]
}

function getPromptGroupingKind(
  groupInfo: PromptGroupResolveItem['group_info'] | undefined,
  visiblePath: string[],
  unclassifiedLabel: string,
): ExtractedPromptGroupedSection['kind'] {
  if (!groupInfo || groupInfo.group_name === 'Unclassified' || visiblePath[0] === unclassifiedLabel) {
    return 'unclassified'
  }

  return visiblePath.length <= 1 ? 'root' : 'child'
}

export function getImagePromptTermItems(image: ImageRecord, type: 'positive' | 'negative') {
  const rawNaiParameters = image.ai_metadata?.raw_nai_parameters
  const promptText = type === 'positive'
    ? getTrimmedText(image.ai_metadata?.prompts?.prompt) ?? getRawPositivePrompt(rawNaiParameters)
    : getTrimmedText(image.ai_metadata?.prompts?.negative_prompt) ?? getRawNegativePrompt(rawNaiParameters)

  return getPromptTermItems(promptText)
}

export function getImagePromptTerms(image: ImageRecord, type: 'positive' | 'negative') {
  return getImagePromptTermItems(image, type).map((term) => term.searchValue)
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

function normalizePromptActionTermInput(term: string | ExtractedPromptActionTerm): ExtractedPromptActionTerm | null {
  if (typeof term === 'string') {
    return toPromptActionTerm(term)
  }

  return toPromptActionTerm(term.display, term.searchValue)
}

export function buildGroupedPromptSections(
  terms: Array<string | ExtractedPromptActionTerm>,
  resolvedItems: PromptGroupResolveItem[],
  options?: Partial<PromptGroupingDisplayOptions>,
  translate?: TranslateText,
) {
  if (terms.length === 0) {
    return [] as ExtractedPromptGroupedSection[]
  }

  const displayOptions = normalizePromptGroupingDisplayOptions(options)
  const unclassifiedLabel = getPromptGroupingUnclassifiedLabel(translate)
  const resolvedByKey = new Map(
    resolvedItems.map((item) => [item.query.trim().toLowerCase(), item] as const),
  )

  const grouped = new Map<string, { id: string; label: string; order: number; prompts: ExtractedPromptActionTerm[]; hierarchyPath?: string[]; kind: ExtractedPromptGroupedSection['kind'] }>()

  terms.forEach((term) => {
    const promptTerm = normalizePromptActionTermInput(term)
    if (!promptTerm) {
      return
    }

    const resolvedItem = resolvedByKey.get(promptTerm.searchValue.trim().toLowerCase())
    const visiblePath = getVisiblePromptGroupingPath(resolvedItem?.group_info, displayOptions, translate)
    const label = visiblePath.join(' > ') || getPromptGroupingLabel(resolvedItem?.group_info, translate)
    const order = getPromptGroupingOrder(resolvedItem?.group_info)
    const hierarchyPath = getPromptGroupingPath(resolvedItem?.group_info, translate)
    const kind = getPromptGroupingKind(resolvedItem?.group_info, visiblePath, unclassifiedLabel)
    const existing = grouped.get(label)

    if (existing) {
      existing.prompts.push(promptTerm)
      return
    }

    grouped.set(label, {
      id: label.toLowerCase(),
      label,
      order,
      prompts: [promptTerm],
      hierarchyPath,
      kind,
    })
  })

  return Array.from(grouped.values())
    .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label, 'ko'))
    .map((group) => ({
      id: group.id,
      label: group.label,
      prompts: group.prompts,
      hierarchyPath: group.hierarchyPath,
      kind: group.kind,
    }))
}

export function formatGroupedPromptText(sections: ExtractedPromptGroupedSection[]) {
  if (sections.length === 0) {
    return ''
  }

  return sections
    .map((group) => `${group.label}\n${group.prompts.map((prompt) => prompt.display).join(', ')}`)
    .join('\n\n')
}

/** Build reusable extracted prompt card data from an image record. */
export function getImageExtractedPromptCards(
  image: ImageRecord,
  translate?: TranslateText,
) {
  const rawNaiParameters = image.ai_metadata?.raw_nai_parameters
  const { positivePrompt: positiveText, negativePrompt: negativeText, characterPrompts: characterTexts } = getImageExtractedPromptSummary(image)
  const loraModels = getImageLoraModels(image)
  const loraActionTerms = loraModels
    .map((item) => toPromptActionTerm(item))
    .filter((term): term is ExtractedPromptActionTerm => Boolean(term))
  const positivePromptTerms = getImagePromptTermItems(image, 'positive')
  const negativePromptTerms = getImagePromptTermItems(image, 'negative')
  const labels = resolveExtractedPromptCardLabels(translate)

  const cards: ExtractedPromptCardItem[] = []

  if (loraModels.length > 0) {
    cards.push({
      id: 'lora-prompt',
      title: 'LoRA',
      text: loraModels.join(', '),
      tone: 'neutral',
      actionScope: 'lora',
      actionTerms: loraActionTerms,
    })
  }

  if (positiveText) {
    cards.push({
      id: 'positive-prompt',
      title: labels.positivePrompt,
      text: positiveText,
      tone: 'positive',
      actionScope: 'positive',
      actionTerms: positivePromptTerms,
      badges: isProcessedPrompt(positiveText, getRawPositivePrompt(rawNaiParameters)) ? [labels.processedBadge] : undefined,
    })
  }

  characterTexts.forEach((text, index) => {
    cards.push({
      id: `character-prompt-${index + 1}`,
      title: characterTexts.length > 1 ? labels.characterIndexed(index + 1) : labels.character,
      text,
      tone: 'character',
    })
  })

  if (negativeText) {
    cards.push({
      id: 'negative-prompt',
      title: labels.negativePrompt,
      text: negativeText,
      tone: 'negative',
      actionScope: 'negative',
      actionTerms: negativePromptTerms,
      badges: isProcessedPrompt(negativeText, getRawNegativePrompt(rawNaiParameters)) ? [labels.processedBadge] : undefined,
    })
  }

  return cards
}
