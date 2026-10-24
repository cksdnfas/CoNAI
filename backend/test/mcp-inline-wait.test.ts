import './support/testTemp'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveMcpInlineWaitMs } from '../src/mcp/context'

test('inline MCP jobs preserve immediate returns and the published chat/HTTP wait bounds', () => {
  for (const source of ['codex-chat', 'llm-chat'] as const) {
    assert.equal(resolveMcpInlineWaitMs(source, undefined), 30_000)
    assert.equal(resolveMcpInlineWaitMs(source, 0), 0)
    assert.equal(resolveMcpInlineWaitMs(source, 1), 1000)
    assert.equal(resolveMcpInlineWaitMs(source, 120), 30_000)
  }
  for (const source of ['http', undefined] as const) {
    assert.equal(resolveMcpInlineWaitMs(source, undefined), 60_000)
    assert.equal(resolveMcpInlineWaitMs(source, 0), 0)
    assert.equal(resolveMcpInlineWaitMs(source, 1), 1000)
    assert.equal(resolveMcpInlineWaitMs(source, 600), 120_000)
    assert.equal(resolveMcpInlineWaitMs(source, -1), 0)
  }
})
