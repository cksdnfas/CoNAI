import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { claudeConfigDir } from '../src/services/claudeCli'
import type * as completion from '../src/services/codex-chat/claudeChatCompletion'
import { getAgentCliUsage } from '../src/services/agentCliUsage'

test('Claude usage renews only on explicit refresh, isolates the probe, and coalesces concurrent requests', async (t) => {
  const originalEnv = { api: process.env.ANTHROPIC_API_KEY, oauth: process.env.CLAUDE_CODE_OAUTH_TOKEN }
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN
  t.after(() => {
    for (const [key, value] of [['ANTHROPIC_API_KEY', originalEnv.api], ['CLAUDE_CODE_OAUTH_TOKEN', originalEnv.oauth]] as const) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
  const credentialPath = path.join(claudeConfigDir(), '.credentials.json')
  let expired = true
  const readFile = fs.readFileSync
  t.mock.method(fs, 'readFileSync', (...args: Parameters<typeof readFile>) => {
    if (args[0] === credentialPath) return JSON.stringify({ claudeAiOauth: { accessToken: 'test-token', expiresAt: expired ? 0 : Date.now() + 60000 } })
    return readFile(...args)
  })
  let probes = 0
  let usageCalls = 0
  let failAuth = false
  let failProbe = false
  let waitForProbe: Promise<void> | null = null
  let waitForUsage: Promise<void> | null = null
  t.mock.module('../src/services/codex-chat/claudeChatCompletion.ts', { namedExports: { CLAUDE_CHAT_PROVIDER: '__conai_claude_code__', streamClaudeChatCompletion: async (params: Parameters<typeof completion.streamClaudeChatCompletion>[0]) => {
    probes++
    assert.equal(params.maxToolRounds, 0)
    assert.equal(params.target.claudeSession, undefined)
    assert.equal(params.target.generation.maxTokens, 16)
    assert.equal(params.tools, undefined)
    assert.equal(params.hostTools, undefined)
    assert.equal(params.messages.length, 2)
    if (waitForProbe) await waitForProbe
    if (failProbe) throw new Error('private CLI output must not escape')
    expired = false
    failAuth = false
    return { content: 'OK' }
  } } })
  t.mock.method(globalThis, 'fetch', async () => {
    usageCalls++
    if (waitForUsage) await waitForUsage
    return new Response(JSON.stringify({ five_hour: { utilization: 12 } }), { status: failAuth ? 401 : 200 })
  })

  await t.test('passive polling, including cache bypass, never sends a model request', async () => {
    assert.match((await getAgentCliUsage('claude', true)).message ?? '', /만료/)
    assert.equal(probes, 0)
    assert.equal(usageCalls, 0)
  })
  await t.test('manual refresh sends one isolated request; a valid token sends none', async () => {
    assert.equal((await getAgentCliUsage('claude', true, true)).windows[0].usedPercent, 12)
    assert.equal(probes, 1)
    await getAgentCliUsage('claude', true, true)
    assert.equal(probes, 1)
  })
  await t.test('an HTTP 401 gets one renewal and one usage retry', async () => {
    failAuth = true
    const before = usageCalls
    assert.equal((await getAgentCliUsage('claude', true, true)).windows.length, 1)
    assert.equal(usageCalls - before, 2)
    assert.equal(probes, 2)
  })
  await t.test('concurrent manual refreshes share a single probe', async () => {
    expired = true
    let release!: () => void
    waitForProbe = new Promise<void>((resolve) => { release = resolve })
    const first = getAgentCliUsage('claude', true, true)
    const second = getAgentCliUsage('claude', true, true)
    release()
    const values = await Promise.all([first, second])
    assert.deepEqual(values[0], values[1])
    assert.equal(probes, 3)
    waitForProbe = null
  })
  await t.test('manual refresh waiting behind a passive query still renews once', async () => {
    failAuth = true
    let release!: () => void
    waitForUsage = new Promise<void>((resolve) => { release = resolve })
    const passive = getAgentCliUsage('claude', true)
    const manual = getAgentCliUsage('claude', true, true)
    release()
    await passive
    assert.equal((await manual).windows.length, 1)
    assert.equal(probes, 4)
    waitForUsage = null
  })
  await t.test('failed renewal neither loops nor exposes CLI output', async () => {
    expired = true
    failProbe = true
    const value = await getAgentCliUsage('claude', true, true)
    assert.equal(probes, 5)
    assert.equal(value.windows.length, 0)
    assert.ok(!value.message?.includes('private CLI output'))
  })
})
