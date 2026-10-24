import './support/testTemp'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_APPEARANCE_SETTINGS } from '../../frontend/src/lib/appearance-presets'
import {
  getDefaultSettingsFromEnvironment,
  hasMissingSettingsFields,
  normalizeLlmSettings,
} from '../src/services/settingsServiceStorage'

test('legacy LLM presets preserve content, timestamps and current-preset precedence in each collection', () => {
  const date = '2024-01-02T03:04:05.000Z'
  const current = { id: 'current', name: 'System', content: 'Current system', createdAt: date, updatedAt: date }
  const legacy = { id: ' legacy ', name: ' Legacy ', createdAt: ' 2024-01-02T03:04:05Z ', updatedAt: 'invalid', systemPrompt: '  system  ', prompt: '  positive  ', structuredOutputJson: '{"b":2}' }
  const record = { id: 'legacy', name: 'Legacy', createdAt: date, updatedAt: date }
  assert.deepEqual(normalizeLlmSettings({
    builtinSeedVersion: 2,
    systemPromptPresets: [current],
    presets: [
      legacy,
      { id: 'current', name: 'Repeated ID', systemPrompt: 'Ignored' },
      { id: 'other', name: 'SYSTEM', systemPrompt: 'Ignored' },
      { id: 'invalid', name: 'Invalid', systemPrompt: '', prompt: ' ', structuredOutputJson: 'invalid' },
      null,
      'invalid',
    ],
  }), {
    builtinSeedVersion: 2,
    systemPromptPresets: [current, { ...record, content: '  system  ' }],
    promptPresets: [{ ...record, content: '  positive  ' }],
    structuredOutputJsonPresets: [{ ...record, content: '{\n  "b": 2\n}' }],
  })
})

test('settings migration checks every supported section without treating key order as a missing field', () => {
  const defaults = getDefaultSettingsFromEnvironment()
  assert.equal(hasMissingSettingsFields(defaults, defaults), false)
  assert.equal(hasMissingSettingsFields(Object.fromEntries(Object.entries(defaults).reverse()), defaults), false)
  const sections = [
    'general', 'general.headerNavigation', 'aiRuntime', 'tagger', 'similarity', 'kaloscope',
    'embedding', 'appearance', 'metadataExtraction', 'thumbnail', 'imageSave',
    'generationThrottle.novelai', 'generationThrottle.codex', 'generationThrottle.reservations',
    'videoOptimization', 'llm',
  ]
  for (const path of sections) {
    const loaded: Record<string, unknown> = JSON.parse(JSON.stringify(defaults))
    let section = loaded
    for (const key of path.split('.')) section = section[key] as Record<string, unknown>
    delete section[Object.keys(section)[0]]
    assert.equal(hasMissingSettingsFields(loaded, defaults), true, path)
  }
  assert.throws(() => hasMissingSettingsFields({ ...defaults, general: 'invalid' }, defaults), TypeError)
})

test('server and first-paint appearance defaults agree while each settings object owns its theme and slots', () => {
  const first = getDefaultSettingsFromEnvironment().appearance
  const second = getDefaultSettingsFromEnvironment().appearance
  assert.deepEqual(first, DEFAULT_APPEARANCE_SETTINGS)
  assert.equal(first.customPrimaryColor, '#f95e14')
  assert.equal(first.customSecondaryColor, '#ffb59a')
  assert.equal(first.desktopPageColumnsMinWidth, 1280)
  first.customPrimaryColor = '#000000'
  first.presetSlots[0].label = 'Edited'
  assert.equal(second.customPrimaryColor, '#f95e14')
  assert.equal(DEFAULT_APPEARANCE_SETTINGS.customPrimaryColor, '#f95e14')
  assert.equal(second.presetSlots[0].label, 'Slot 1')
  assert.equal(DEFAULT_APPEARANCE_SETTINGS.presetSlots[0].label, 'Slot 1')
})
