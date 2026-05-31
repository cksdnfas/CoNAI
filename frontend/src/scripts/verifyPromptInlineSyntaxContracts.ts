import { equal } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolvePromptDetectedCharacterCandidates } from '../features/image-generation/components/use-prompt-inline-autocomplete'
import { resolveActiveDanbooruGroupQuery, resolveActivePromptTextQuery } from '../features/image-generation/components/prompt-inline-token-scanner'
import { resolveActiveWildcardQuery } from '../features/image-generation/components/wildcard-inline-picker-helpers'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

equal(resolveActiveDanbooruGroupQuery('__Gro', 5)?.query, 'Gro')
equal(resolveActiveDanbooruGroupQuery('__Group__', 3), null, 'closed group tokens must not reopen group suggestions')
equal(resolveActiveDanbooruGroupQuery('__Group[0~3]<1k>__', 7), null, 'completed group modifiers must not reopen group suggestions')
equal(resolveActiveWildcardQuery('++Wild', 6)?.query, 'Wild')
equal(resolveActiveWildcardQuery('++Wild++', 4), null, 'closed wildcard tokens must not reopen wildcard suggestions')
equal(resolveActivePromptTextQuery('tag', 3)?.query, 'tag')
equal(resolveActivePromptTextQuery('tag, ', 5), null, 'comma-completed empty prompt segments must stay quiet')
equal(resolveActivePromptTextQuery(', ,', 2), null, 'empty comma segments must stay quiet')
equal(resolveActivePromptTextQuery('__Group__', 4), null, 'closed group syntax must not fall back to tag suggestions')
equal(resolveActivePromptTextQuery('++Wild++', 4), null, 'closed wildcard syntax must not fall back to tag suggestions')
equal(resolvePromptDetectedCharacterCandidates('asuna, __Hair[2]__, ++pose++').length, 1, 'character detection must ignore completed group and wildcard syntax')
equal(resolvePromptDetectedCharacterCandidates('asuna, __Hair[2]__, ++pose++')[0]?.query, 'asuna')

const settingsSource = source('features/image-generation/components/prompt-inline-syntax-settings.ts')
equal(
  settingsSource.includes("const DEFAULT_PRIORITY: PromptInlineSyntaxSource[] = ['danbooru-group', 'preprocess', 'wildcard', 'tag']"),
  true,
  'default prompt syntax priority must be group > preprocess > wildcard > tag',
)
equal(
  settingsSource.includes("suppressCompletedTokenPopups: true"),
  true,
  'completed token popup suppression must remain on',
)
equal(
  settingsSource.includes('characterRelatedTags: true'),
  true,
  'detected character related-tag chips should be enabled by default',
)

const panelSource = source('features/image-generation/components/wildcard-syntax-settings-panel.tsx')
for (const syntax of ['__Group__', '__Group[3]__', '__Group[0~3]__', '__Group<1k>__', '__Group<-100>__', '++Wildcard++']) {
  equal(panelSource.includes(syntax), true, `settings panel should document ${syntax}`)
}

const inlineFieldSource = source('features/image-generation/components/wildcard-inline-picker-field.tsx')
equal(
  inlineFieldSource.includes("activeSource === 'danbooru-group'"),
  true,
  'inline picker must route __ queries to the tag group popup',
)
equal(
  inlineFieldSource.includes("activeSource === 'preprocess'"),
  true,
  'inline picker must route preprocess matches separately from tag suggestions',
)
equal(
  inlineFieldSource.includes('activeDetectedCharacter'),
  true,
  'inline picker must expose detected character chips with a related-tag popup',
)

console.log('Prompt inline syntax contracts verified')
