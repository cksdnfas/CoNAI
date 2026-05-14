import assert from 'node:assert/strict'
import {
  DEFAULT_FILE_VERIFICATION_LOG_LIMIT,
  applyFileVerificationSettingsUpdate,
  parseFileVerificationLogLimit,
  readFileVerificationSettings,
  type FileVerificationSettingsUpdateDependencies,
} from '../routes/file-verification-route-helpers'

function createSettingsHarness(initial = { enabled: true, interval: 3600 }) {
  const state = { ...initial }
  const calls: string[] = []

  const dependencies: FileVerificationSettingsUpdateDependencies = {
    isFileVerificationEnabled() {
      calls.push('read:enabled')
      return state.enabled
    },
    getFileVerificationInterval() {
      calls.push('read:interval')
      return state.interval
    },
    updateFileVerificationEnabled(enabled: boolean) {
      calls.push(`update:enabled:${enabled}`)
      state.enabled = enabled
    },
    updateFileVerificationInterval(interval: number) {
      calls.push(`update:interval:${interval}`)
      state.interval = interval
    },
    restartScheduler() {
      calls.push('restart')
    },
  }

  return { calls, dependencies, state }
}

function verifyLogLimitParsing() {
  assert.equal(DEFAULT_FILE_VERIFICATION_LOG_LIMIT, 50)
  assert.equal(parseFileVerificationLogLimit(undefined), 50)
  assert.equal(parseFileVerificationLogLimit('', 50), 50)
  assert.equal(parseFileVerificationLogLimit('not-a-number', 50), 50)
  assert.equal(parseFileVerificationLogLimit('0', 50), 50)
  assert.equal(parseFileVerificationLogLimit('12px', 50), 12)
  assert.equal(parseFileVerificationLogLimit(['7', '8'], 50), 7)
  assert.equal(parseFileVerificationLogLimit('0x10', 50), 16)
  assert.equal(parseFileVerificationLogLimit('-1', 50), -1)
}

function verifySettingsReadShape() {
  const { calls, dependencies } = createSettingsHarness({ enabled: false, interval: 900 })

  assert.deepEqual(readFileVerificationSettings(dependencies), {
    enabled: false,
    interval: 900,
  })
  assert.deepEqual(calls, ['read:enabled', 'read:interval'])
}

function verifySettingsNoopUpdate() {
  const { calls, dependencies } = createSettingsHarness({ enabled: true, interval: 3600 })

  assert.deepEqual(applyFileVerificationSettingsUpdate({}, dependencies), {
    settings: { enabled: true, interval: 3600 },
    settingsChanged: false,
  })
  assert.deepEqual(calls, ['read:enabled', 'read:interval'])
}

function verifySettingsIgnoresUnsupportedTypes() {
  const { calls, dependencies } = createSettingsHarness({ enabled: true, interval: 3600 })

  assert.deepEqual(applyFileVerificationSettingsUpdate({ enabled: 'false', interval: '900' }, dependencies), {
    settings: { enabled: true, interval: 3600 },
    settingsChanged: false,
  })
  assert.deepEqual(calls, ['read:enabled', 'read:interval'])
}

function verifyBooleanSettingsUpdate() {
  const { calls, dependencies } = createSettingsHarness({ enabled: true, interval: 3600 })

  assert.deepEqual(applyFileVerificationSettingsUpdate({ enabled: false }, dependencies), {
    settings: { enabled: false, interval: 3600 },
    settingsChanged: true,
  })
  assert.deepEqual(calls, [
    'update:enabled:false',
    'restart',
    'read:enabled',
    'read:interval',
  ])
}

function verifyIntervalSettingsUpdate() {
  const { calls, dependencies } = createSettingsHarness({ enabled: true, interval: 3600 })

  assert.deepEqual(applyFileVerificationSettingsUpdate({ interval: 900 }, dependencies), {
    settings: { enabled: true, interval: 900 },
    settingsChanged: true,
  })
  assert.deepEqual(calls, [
    'update:interval:900',
    'restart',
    'read:enabled',
    'read:interval',
  ])
}

function verifyCombinedSettingsUpdateRestartsOnce() {
  const { calls, dependencies } = createSettingsHarness({ enabled: false, interval: 3600 })

  assert.deepEqual(applyFileVerificationSettingsUpdate({ enabled: true, interval: 1200 }, dependencies), {
    settings: { enabled: true, interval: 1200 },
    settingsChanged: true,
  })
  assert.deepEqual(calls, [
    'update:enabled:true',
    'update:interval:1200',
    'restart',
    'read:enabled',
    'read:interval',
  ])
}

verifyLogLimitParsing()
verifySettingsReadShape()
verifySettingsNoopUpdate()
verifySettingsIgnoresUnsupportedTypes()
verifyBooleanSettingsUpdate()
verifyIntervalSettingsUpdate()
verifyCombinedSettingsUpdateRestartsOnce()

console.log('✅ File verification route contracts verified')
