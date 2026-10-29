import './support/testTemp'
import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { DEFAULT_APPEARANCE_SETTINGS } from '../../frontend/src/lib/appearance-presets'
import { HEADER_NAVIGATION_VERSION } from '@conai/shared'
import { nativeSettingsRevision } from '../src/services/nativeEditRevision'
import {
  getDefaultSettingsFromEnvironment,
  hasMissingSettingsFields,
  mergeLoadedSettingsWithDefaults,
  normalizeLlmSettings,
} from '../src/services/settingsServiceStorage'

test('settings revisions include arbitrary nested children and ignore object key order', () => {
  const original = { widget: { children: [{ text: 'first' }], style: { b: 2, a: 1 } } }
  assert.equal(nativeSettingsRevision(original), nativeSettingsRevision({ widget: { style: { a: 1, b: 2 }, children: [{ text: 'first' }] } }))
  assert.notEqual(nativeSettingsRevision(original), nativeSettingsRevision({ widget: { children: [{ text: 'second' }], style: { b: 2, a: 1 } } }))
  assert.notEqual(nativeSettingsRevision({ hidden: 'guess' }), createHash('sha256').update('{"hidden":"guess"}').digest('hex'))
})

test('settings revision keys agree across simultaneous first starts and restarts', async (t) => {
  const roots = [0, 1].map(() => fs.mkdtempSync(path.join(os.tmpdir(), 'conai-settings-revision-')))
  t.after(() => { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }) })
  const program = "const { nativeSettingsRevision } = require('./src/services/nativeEditRevision.ts'); console.log('REVISION=' + nativeSettingsRevision({ hidden: 'guess' }))"
  const revision = (root: string, sessionSecret: string) => new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '-e', program], {
      cwd: process.cwd(),
      env: { ...process.env, RUNTIME_BASE_PATH: root, SESSION_SECRET: sessionSecret },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(stderr))
      const match = stdout.match(/REVISION=([0-9a-f]{64})/)
      if (!match) return reject(new Error(`Missing revision: ${stdout}`))
      resolve(match[1])
    })
  })
  const [first, second] = await Promise.all([revision(roots[0], ''), revision(roots[0], '')])
  assert.equal(first, second)
  assert.equal(await revision(roots[0], ''), first)
  const sessionSecret = 'test-only-session-secret-for-revision-key'
  const [derived, concurrent] = await Promise.all([revision(roots[1], sessionSecret), revision(roots[1], sessionSecret)])
  const key = createHmac('sha256', sessionSecret).update('conai:settings-revision:v1').digest('hex')
  assert.equal(derived, createHmac('sha256', key).update('{"hidden":"guess"}').digest('hex'))
  assert.equal(concurrent, derived)
  assert.equal(await revision(roots[1], ''), derived, 'the established key survives session configuration changes')
})

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

test('header flags stored before the pin version keep only the tools, while stored pins keep their order', () => {
  const defaults = getDefaultSettingsFromEnvironment()
  const legacy = mergeLoadedSettingsWithDefaults({
    general: { headerNavigation: { groups: true, chat: false, search: false, 'plugin:aa:bb': true }, headerNavigationOrder: ['settings', 'groups'] },
  }, defaults).general
  // Old "shown" pages do not become pins: the pages start from the default pins.
  assert.equal(legacy.headerNavigation.groups, false)
  assert.equal(legacy.headerNavigation.chat, true)
  assert.equal(legacy.headerNavigation['plugin:aa:bb'], undefined)
  assert.equal(legacy.headerNavigation.search, false)
  assert.deepEqual(legacy.headerNavigationOrder, defaults.general.headerNavigationOrder)
  assert.equal(legacy.headerNavigationVersion, HEADER_NAVIGATION_VERSION)

  const pinned = mergeLoadedSettingsWithDefaults({
    general: { ...legacy, headerNavigation: { ...legacy.headerNavigation, groups: true }, headerNavigationOrder: ['groups', 'home'] },
  }, defaults).general
  assert.equal(pinned.headerNavigation.groups, true)
  assert.deepEqual(pinned.headerNavigationOrder.slice(0, 2), ['groups', 'home'])
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
