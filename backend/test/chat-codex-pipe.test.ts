import './support/testTemp'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import type { ChildProcess } from 'node:child_process'
import { CodexAppServerClient } from '../src/services/codex-chat/codexAppServerClient'

test('a broken Codex stdin fails pending RPCs without an uncaught pipe error', async () => {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    pid: undefined, exitCode: null, signalCode: null,
  })
  const Client = CodexAppServerClient as unknown as new (child: ChildProcess) => CodexAppServerClient
  const client = new Client(child as unknown as ChildProcess)
  const exits: string[] = []
  client.on('exit', (reason: string) => exits.push(reason))
  const first = client.request('one', {})
  const second = client.request('two', {})
  child.stdin.emit('error', Object.assign(new Error('broken pipe'), { code: 'EPIPE' }))
  await Promise.all([
    assert.rejects(first, /stdin failed: broken pipe/),
    assert.rejects(second, /stdin failed: broken pipe/),
  ])
  assert.equal(client.isAlive, false)
  await assert.rejects(client.request('three', {}), /not running/)
  let exited = false
  void client.whenExited.then(() => { exited = true })
  await Promise.resolve()
  assert.equal(exited, false, 'the exit promise waits for the child to close')
  child.emit('close', 1, null)
  await client.whenExited
  assert.equal(exits.length, 1)
  child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy()
})
