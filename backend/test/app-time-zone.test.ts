import './support/scratchRuntime'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import { test } from 'node:test'
import express from 'express'
import { normalizeTimeZoneName, previewFileNamePattern, renderFileNameStem, timeZoneOffsetLabel, zonedDateParts } from '@conai/shared'
import { generalSettingsRoutes } from '../src/routes/settings/general-settings.routes'
import { settingsService } from '../src/services/settingsService'
import { SETTINGS_FILE_PATH, getDefaultSettingsFromEnvironment, mergeLoadedSettingsWithDefaults } from '../src/services/settingsServiceStorage'
import { getDateFolder } from '../src/utils/mediaStoragePaths'

const processZone = () => new Intl.DateTimeFormat().resolvedOptions().timeZone

test('time zone names: IANA zones only, stored in canonical spelling', () => {
  assert.equal(normalizeTimeZoneName('Asia/Seoul'), 'Asia/Seoul')
  assert.equal(normalizeTimeZoneName('asia/seoul'), 'Asia/Seoul')
  assert.equal(normalizeTimeZoneName('UTC'), 'UTC')
  assert.equal(normalizeTimeZoneName('America/St_Johns'), 'America/St_Johns')
  // Offsets and POSIX rules mean something else to TZ ('+09:00' is UTC−9 there), so they never pass.
  for (const value of ['', 'Mars/Olympus', '+09:00', 'EST5EDT', 'Etc/GMT-9', ' Asia/Seoul', 'Asia/Seoul\n', '../etc/localtime', 42, null, undefined]) {
    assert.equal(normalizeTimeZoneName(value), '', JSON.stringify(value))
  }
  assert.equal(timeZoneOffsetLabel('Asia/Seoul'), 'UTC+09:00')
  assert.equal(timeZoneOffsetLabel('UTC'), 'UTC')
  assert.equal(timeZoneOffsetLabel('America/St_Johns', new Date(Date.UTC(2026, 10, 23))), 'UTC−03:30')
})

test('file name preview renders the date tokens in the zone it is given', () => {
  const date = new Date(Date.UTC(2026, 10, 23, 20, 5, 9))
  assert.deepEqual(previewFileNamePattern('{yyyy}{MM}{dd}_{HH}{mm}{ss}', 'generated', { date, timeZone: 'Asia/Seoul' }), ['20261124_050509.png'])
  assert.deepEqual(previewFileNamePattern('{yyyy}{MM}{dd}_{HH}{mm}{ss}', 'generated', { date, timeZone: 'UTC' }), ['20261123_200509.png'])
  assert.equal(renderFileNameStem('{HH}', { date, timeZone: 'America/St_Johns' }), '16')
})

test('app time zone: server zone by default, applied process-wide on save, kept on disk, invalid refused', async (t) => {
  const startEnv = process.env.TZ
  const startZone = processZone()
  t.after(() => {
    if (startEnv === undefined) delete process.env.TZ
    else process.env.TZ = startEnv
  })

  // Default: nothing changes.
  assert.equal(settingsService.loadSettings().general.timeZone, '')
  assert.equal(processZone(), startZone)
  assert.equal(process.env.TZ, startEnv)

  const app = express()
  app.use(express.json())
  app.use('/api/settings', generalSettingsRoutes)
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const call = async (url: string, method = 'GET', body?: unknown) => {
    const response = await fetch(origin + url, { method, headers: { 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
    return { status: response.status, body: await response.json() }
  }

  const info = await call('/api/settings/time-zone')
  assert.equal(info.body.data.serverTimeZone, startZone)
  assert.equal(info.body.data.timeZone, startZone)

  for (const timeZone of ['Mars/Olympus', '+09:00', 9, 'EST5EDT']) {
    assert.equal((await call('/api/settings/general', 'PUT', { timeZone })).status, 400, JSON.stringify(timeZone))
  }
  assert.equal(settingsService.loadSettings().general.timeZone, '')
  assert.equal(processZone(), startZone)

  // A zone other than the one this machine runs in, sent in another spelling.
  const target = startZone === 'Asia/Seoul' ? 'America/St_Johns' : 'Asia/Seoul'
  const saved = await call('/api/settings/general', 'PUT', { timeZone: target.toLowerCase() })
  assert.equal(saved.status, 200)
  assert.equal(saved.body.data.general.timeZone, target)
  assert.equal(processZone(), target, 'applied without a restart')
  const instant = new Date(Date.UTC(2026, 10, 23, 20, 5, 9))
  const expected = zonedDateParts(instant, target)
  assert.equal(instant.getHours(), expected.hour, 'local getters read the new zone')
  assert.equal(renderFileNameStem('{yyyy}{MM}{dd}_{HH}', { date: instant }), `${expected.year}${String(expected.month).padStart(2, '0')}${String(expected.day).padStart(2, '0')}_${String(expected.hour).padStart(2, '0')}`)
  assert.equal(getDateFolder(instant), `${expected.year}-${String(expected.month).padStart(2, '0')}-${String(expected.day).padStart(2, '0')}`)
  assert.equal((await call('/api/settings/time-zone')).body.data.timeZone, target)
  assert.equal((await call('/api/settings/time-zone')).body.data.serverTimeZone, startZone)

  // A restart reads the saved zone back; a hand-edited unknown one falls back to the server zone.
  const stored = JSON.parse(fs.readFileSync(SETTINGS_FILE_PATH, 'utf8'))
  assert.equal(stored.general.timeZone, target)
  assert.equal(mergeLoadedSettingsWithDefaults(stored, getDefaultSettingsFromEnvironment()).general.timeZone, target)
  assert.equal(mergeLoadedSettingsWithDefaults({ ...stored, general: { ...stored.general, timeZone: 'Mars/Olympus' } }, getDefaultSettingsFromEnvironment()).general.timeZone, '')
  assert.equal(mergeLoadedSettingsWithDefaults({ ...stored, general: { ...stored.general, timeZone: undefined } }, getDefaultSettingsFromEnvironment()).general.timeZone, '')

  // Back to the server's own zone (Windows Node keeps the last TZ after the variable goes away; the service undoes that).
  const reset = await call('/api/settings/general', 'PUT', { timeZone: '' })
  assert.equal(reset.status, 200)
  assert.equal(reset.body.data.general.timeZone, '')
  assert.equal(processZone(), startZone)
  assert.equal(instant.getHours(), zonedDateParts(instant, startZone).hour)
})
