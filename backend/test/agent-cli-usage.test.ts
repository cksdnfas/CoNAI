import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

test('agent CLI usage: Codex and Claude windows normalize to session/weekly gauges', async () => {
  const temp = path.resolve(__dirname, '../../temp')
  fs.mkdirSync(temp, { recursive: true })
  process.env.RUNTIME_BASE_PATH = fs.mkdtempSync(path.join(temp, 'conai-cli-usage-test-'))
  const { claudeUsageWindows, codexUsageWindows } = await import('../src/services/agentCliUsage')

  // Pro accounts currently report only the weekly window; a model bucket follows the account-wide ones.
  const codex = codexUsageWindows({
    rateLimitsByLimitId: {
      spark: { limitId: 'spark', limitName: 'Spark', primary: { usedPercent: 12.4, windowDurationMins: 10080, resetsAt: 1791948507 } },
      codex: { limitId: 'codex', primary: { usedPercent: 34, windowDurationMins: 10080, resetsAt: 1791948507 }, secondary: { usedPercent: 120, windowDurationMins: 300, resetsAt: 1791900000 } },
    },
  })
  assert.deepEqual(codex.map((entry) => [entry.window, entry.model, entry.usedPercent]), [['session', null, 100], ['weekly', null, 34], ['weekly', 'Spark', 12]])
  assert.equal(codex[1].resetsAt, new Date(1791948507 * 1000).toISOString())
  assert.deepEqual(codexUsageWindows({ rateLimits: { primary: { usedPercent: 5, windowDurationMins: 300 }, secondary: null } }).map((entry) => entry.id), ['codex:session'])

  const claude = claudeUsageWindows({
    five_hour: { utilization: 99, resets_at: null },
    limits: [
      { kind: 'session', group: 'session', percent: 7, resets_at: '2026-10-09T05:50:00.052984+00:00', scope: null },
      { kind: 'weekly_all', group: 'weekly', percent: 2, resets_at: '2026-10-15T20:00:00.053004+00:00', scope: null },
      { kind: 'weekly_scoped', group: 'weekly', percent: 0, resets_at: '2026-10-15T20:00:00+00:00', scope: { model: { id: null, display_name: 'Fable' } } },
      { kind: 'spend', group: 'spend', percent: 50 },
    ],
  })
  assert.deepEqual(claude.map((entry) => [entry.window, entry.model, entry.usedPercent]), [['session', null, 7], ['weekly', null, 2], ['weekly', 'Fable', 0]])
  assert.equal(claude[0].resetsAt, '2026-10-09T05:50:00.052Z')
  // Older responses without `limits` still show the two account-wide windows.
  assert.deepEqual(claudeUsageWindows({ five_hour: { utilization: 7.6 }, seven_day: null }).map((entry) => [entry.id, entry.usedPercent]), [['session', 8]])
})
