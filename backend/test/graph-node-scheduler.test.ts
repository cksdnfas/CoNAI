import './support/testTemp'
import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import { test } from 'node:test'
import { createExecutionAbortHandle, GraphAbortError } from '../src/services/graph-workflow-executor/execution-abort'
import { getGraphNodeThrottleActiveCount, runReadyGraphNodes } from '../src/services/graph-workflow-executor/node-scheduler'

test('a failed node notification cannot bypass sibling draining or replace the original failure', async () => {
  const names = ['CONAI_GRAPH_READY_NODE_CONCURRENCY', 'CONAI_GRAPH_EXTERNAL_GENERATION_NODE_CONCURRENCY']
  const previous = names.map(name => process.env[name])
  for (const name of names) process.env[name] = '2'
  const handle = createExecutionAbortHandle(1)
  const sibling = Promise.withResolvers<void>()
  const failure = new GraphAbortError({ kind: 'node_failure', nodeId: 'failed', message: 'engine failed' })
  let settled = false
  const running = runReadyGraphNodes({
    orderedNodeIds: ['failed', 'sibling'],
    dependenciesByNode: new Map(),
    signal: handle.signal,
    abort: handle.abort,
    getNodeThrottleLane: () => 'external_generation',
    executeNode: nodeId => nodeId === 'failed' ? Promise.reject(failure) : sibling.promise,
    onNodeSettled: nodeId => { if (nodeId === 'failed') throw new Error('log write failed') },
  }).then(() => { settled = true; return null }, error => { settled = true; return error })
  try {
    await setImmediate()
    assert.equal(handle.signal.aborted, true)
    assert.equal(settled, false, 'the graph must wait for the still-running sibling')
    sibling.resolve()
    assert.equal(await running, failure)
    assert.equal(getGraphNodeThrottleActiveCount('external_generation'), 0)
  } finally {
    sibling.resolve()
    await running
    for (const [index, name] of names.entries()) {
      if (previous[index] === undefined) delete process.env[name]
      else process.env[name] = previous[index]
    }
  }
})
