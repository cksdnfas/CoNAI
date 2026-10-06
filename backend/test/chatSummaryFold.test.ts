import assert from 'node:assert/strict'
import { test } from 'node:test'
import { turnsToFold } from '../src/services/codex-chat/llmChatContext'

test('nothing is folded while every unsummarized turn fits', () => {
  assert.equal(turnsToFold(14, 14, 6), 0)
  assert.equal(turnsToFold(0, 0, 6), 0)
})

test('an overflow folds at least a batch, and everything that overflows', () => {
  assert.equal(turnsToFold(20, 19, 6), 6)
  assert.equal(turnsToFold(40, 20, 6), 20)
})

test('the newest turn is never folded', () => {
  assert.equal(turnsToFold(3, 2, 6), 2)
  assert.equal(turnsToFold(1, 0, 6), 0)
})

test('20 turns with a batch of 6: verbatim turns stay between 14 and 20 with nothing lost', () => {
  const contextTurns = 20
  let summarized = 0
  for (let total = 1; total <= 80; total += 1) {
    // Request: every unsummarized turn must already fit.
    const pending = total - summarized
    assert.ok(pending <= contextTurns, `turn ${total}: ${pending} verbatim turns`)
    assert.equal(turnsToFold(pending, Math.min(pending, contextTurns), 6), 0)
    // After the reply: leave room for the next turn.
    summarized += turnsToFold(pending, Math.min(pending, contextTurns - 1), 6)
    assert.ok(total - summarized >= Math.min(total, 14))
  }
})
