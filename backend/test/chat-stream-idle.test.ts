import './support/testTemp'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStreamIdleWatch } from '../src/services/codex-chat/llmChatCompletion'

test('model idle protection pauses for overlapping tools and resumes after the last one', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const controller = new AbortController()
  const watch = createStreamIdleWatch(controller)
  watch.touch()
  t.mock.timers.tick(4 * 60_000)
  watch.toolStart()
  watch.toolStart()
  t.mock.timers.tick(10 * 60_000)
  watch.touch()
  watch.toolEnd()
  t.mock.timers.tick(10 * 60_000)
  assert.equal(controller.signal.aborted, false)
  watch.toolEnd()
  t.mock.timers.tick(5 * 60_000)
  assert.equal(controller.signal.aborted, true, 'a quiet model after the tools is still stopped')
  watch.close()
})

test('explicit cancellation remains effective while a tool is running', () => {
  const controller = new AbortController()
  const watch = createStreamIdleWatch(controller)
  watch.touch()
  watch.toolStart()
  controller.abort()
  assert.equal(controller.signal.aborted, true)
  watch.toolEnd()
  watch.close()
})
