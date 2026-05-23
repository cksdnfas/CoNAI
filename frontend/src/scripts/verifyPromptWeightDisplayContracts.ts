import assert from 'node:assert/strict'

import {
  buildGroupedPromptSections,
  formatGroupedPromptText,
  getImageExtractedPromptCards,
  getImagePromptTermItems,
  getImagePromptTerms,
} from '../lib/image-extracted-prompts'
import type { ImageRecord } from '../types/image'

const image = {
  composite_hash: 'prompt-weight-contract',
  file_type: 'image',
  ai_metadata: {
    prompts: {
      prompt: '(머리:1.2), stocking_(psg), crow \\(la+ darknesss\\)',
      negative_prompt: '(bad_hands:0.8), low_quality_(tag)',
    },
    raw_nai_parameters: null,
  },
} as unknown as ImageRecord

const positiveTerms = getImagePromptTermItems(image, 'positive')

assert.deepEqual(
  positiveTerms.map((term) => term.display),
  ['(머리:1.2)', 'stocking_(psg)', 'crow (la+ darknesss)'],
  'prompt display terms should preserve explicit weights and literal non-weight parentheses',
)

assert.deepEqual(
  positiveTerms.map((term) => term.searchValue),
  ['머리', 'stocking_(psg)', 'crow (la+ darknesss)'],
  'prompt search terms should remove only explicit weights',
)

assert.deepEqual(
  getImagePromptTerms(image, 'negative'),
  ['bad_hands', 'low_quality_(tag)'],
  'collection/search terms should dedupe by weightless prompt while preserving non-weight parentheses',
)

const cards = getImageExtractedPromptCards(image)
const positiveCard = cards.find((card) => card.id === 'positive-prompt')
assert(positiveCard, 'positive prompt card should exist')
assert.deepEqual(
  positiveCard.actionTerms?.map((term) => [term.display, term.searchValue]),
  [
    ['(머리:1.2)', '머리'],
    ['stocking_(psg)', 'stocking_(psg)'],
    ['crow (la+ darknesss)', 'crow (la+ darknesss)'],
  ],
  'prompt chips should show weighted text but send weightless search values',
)

const groupedSections = buildGroupedPromptSections(
  positiveTerms,
  [
    {
      query: '머리',
      matched_prompt: '머리',
      group_info: {
        id: 7,
        group_name: 'Body',
        display_order: 1,
        group_path: ['Body'],
      },
    },
  ] as any,
)
const groupedText = formatGroupedPromptText(groupedSections)

assert(groupedText.includes('(머리:1.2)'), 'grouped prompt display should keep explicit weight text')
assert(groupedText.includes('stocking_(psg)'), 'grouped prompt display should keep literal non-weight parentheses')

console.log('Prompt weight display/search contracts verified.')
