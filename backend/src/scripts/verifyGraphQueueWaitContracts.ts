import { type GenerationQueueJobRecord, type GenerationQueueJobStatus } from '../types/generationQueue'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  GRAPH_EXECUTION_CANCELLED_MESSAGE,
  isGraphQueueTerminalStatus,
  resolveGraphQueueTerminalJob,
  shouldRequestGraphQueueCancellation,
} from '../services/graph-workflow-executor/queue-wait'

type QueueStatusRecord = Pick<GenerationQueueJobRecord, 'status'>
type QueueTerminalRecord = Pick<GenerationQueueJobRecord, 'status' | 'failure_message'>

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

function assertThrows(fn: () => unknown, expectedMessage: string, message: string) {
  try {
    fn()
  } catch (error) {
    assertEqual(error instanceof Error ? error.message : String(error), expectedMessage, message)
    return
  }

  throw new Error(`${message}: expected an error with message ${expectedMessage}`)
}

function makeStatusRecord(status: GenerationQueueJobStatus): QueueStatusRecord {
  return { status }
}

function makeTerminalRecord(status: GenerationQueueJobStatus, failureMessage: string | null = null): QueueTerminalRecord {
  return {
    status,
    failure_message: failureMessage,
  }
}

function assertTerminalStatusContract() {
  const terminalStatuses: GenerationQueueJobStatus[] = ['completed', 'failed', 'cancelled']
  const activeStatuses: GenerationQueueJobStatus[] = ['queued', 'dispatching', 'running']

  for (const status of terminalStatuses) {
    assertEqual(isGraphQueueTerminalStatus(status), true, `${status} should be terminal for graph queue wait helpers`)
  }

  for (const status of activeStatuses) {
    assertEqual(isGraphQueueTerminalStatus(status), false, `${status} should not be terminal for graph queue wait helpers`)
  }
}

function assertCancellationGateContract() {
  assertEqual(shouldRequestGraphQueueCancellation(null), false, 'missing jobs should not request cancellation')
  assertEqual(shouldRequestGraphQueueCancellation(undefined), false, 'undefined jobs should not request cancellation')

  for (const status of ['queued', 'dispatching', 'running'] as GenerationQueueJobStatus[]) {
    assertEqual(
      shouldRequestGraphQueueCancellation(makeStatusRecord(status)),
      true,
      `${status} jobs should request graph queue cancellation`,
    )
  }

  for (const status of ['completed', 'failed', 'cancelled'] as GenerationQueueJobStatus[]) {
    assertEqual(
      shouldRequestGraphQueueCancellation(makeStatusRecord(status)),
      false,
      `${status} jobs should skip graph queue cancellation`,
    )
  }
}

function assertTerminalOutcomeContract() {
  const completed = makeTerminalRecord('completed')
  assertEqual(resolveGraphQueueTerminalJob(null, 123), null, 'missing terminal job records should be ignored and polled again')
  assertEqual(resolveGraphQueueTerminalJob(makeTerminalRecord('running'), 123), null, 'non-terminal job records should be ignored and polled again')
  assertEqual(resolveGraphQueueTerminalJob(completed, 123), completed, 'completed jobs should be returned')

  assertThrows(
    () => resolveGraphQueueTerminalJob(makeTerminalRecord('failed', 'worker exploded'), 456),
    'worker exploded',
    'failed jobs should surface their failure message',
  )
  assertThrows(
    () => resolveGraphQueueTerminalJob(makeTerminalRecord('failed'), 456),
    'Queue job 456 failed',
    'failed jobs without a message should use the queue job fallback message',
  )
  assertThrows(
    () => resolveGraphQueueTerminalJob(makeTerminalRecord('cancelled'), 789),
    GRAPH_EXECUTION_CANCELLED_MESSAGE,
    'cancelled jobs should use the shared graph execution cancellation sentinel',
  )
}

function assertGraphExecutionQueueColdBacklogContract() {
  const queueSource = readFileSync(resolve(process.cwd(), 'src/services/graphWorkflowExecutionQueue.ts'), 'utf8')
  assertTerminalStatusContract()
  if (!/claimNextQueued\('manual'\)/.test(queueSource) || !/claimNextQueued\('schedule'\)/.test(queueSource)) {
    throw new Error('graph workflow execution queue should claim bounded queued rows from DB by trigger type')
  }
  if (/private static queue: QueuedExecutionJob\[\]/.test(queueSource) || /this\.queue\./.test(queueSource)) {
    throw new Error('graph workflow execution queue must not keep the whole waiting backlog in an in-memory array')
  }
  if (!/findQueuedPositions\(Array\.from\(targetIds\)\)/.test(queueSource)) {
    throw new Error('graph workflow queue positions should be resolved from DB for the visible execution set')
  }
}

assertTerminalStatusContract()
assertCancellationGateContract()
assertTerminalOutcomeContract()
assertGraphExecutionQueueColdBacklogContract()

console.log('Graph queue wait contracts verified.')
