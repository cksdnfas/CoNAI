import type { ImageAiRawNaiParameters, ImageRecord } from '@/types/image'

export interface ExtractedPromptCardItem {
  id: string
  title: string
  text: string
  tone: 'positive' | 'negative' | 'character'
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

  return cards
}
