import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const generationQueueSource = fs.readFileSync(path.resolve(process.cwd(), 'src/models/GenerationQueue.ts'), 'utf8')
const cleanupServiceSource = fs.readFileSync(path.resolve(process.cwd(), 'src/services/cleanupService.ts'), 'utf8')
const queueDebugMetaSource = fs.readFileSync(path.resolve(process.cwd(), 'src/services/generation-queue/queueDebugMeta.ts'), 'utf8')

assert.match(
  generationQueueSource,
  /export const DEFAULT_TERMINAL_PAYLOAD_RETAIN_LIMIT = 2000/,
  'terminal queue payload cleanup should retain the latest 2000 terminal jobs by default',
)

assert.match(
  generationQueueSource,
  /export const COMPACTED_TERMINAL_REQUEST_PAYLOAD = JSON\.stringify\(\{ pruned: true \}\)/,
  'terminal queue payload cleanup should compact old payloads to a small marker instead of deleting rows',
)

assert.match(
  generationQueueSource,
  /const TERMINAL_QUEUE_STATUSES: GenerationQueueJobStatus\[\] = \['completed', 'failed', 'cancelled'\]/,
  'terminal queue payload cleanup must only target completed, failed, and cancelled jobs',
)

assert.match(
  generationQueueSource,
  /static pruneTerminalRequestPayloads/,
  'GenerationQueueModel should expose a dedicated terminal payload pruning method',
)

assert.match(
  generationQueueSource,
  /WITH retained_recent AS \([\s\S]*ORDER BY COALESCE\(completed_at, started_at, queued_at, created_date\) DESC, id DESC[\s\S]*LIMIT \?/,
  'terminal payload pruning should retain the newest terminal rows by completion/queue ordering',
)

assert.match(
  generationQueueSource,
  /UPDATE generation_queue_jobs[\s\S]*SET request_payload = \?[\s\S]*status IN/,
  'terminal payload pruning should update request_payload only, preserving queue rows and history links',
)

assert.doesNotMatch(
  generationQueueSource,
  /DELETE\s+FROM\s+generation_queue_jobs/i,
  'terminal payload pruning must not delete generation_queue_jobs rows',
)

assert.match(
  cleanupServiceSource,
  /GenerationQueueModel\.pruneTerminalRequestPayloads\(\)/,
  'cleanup service should invoke terminal queue payload pruning',
)

assert.match(
  cleanupServiceSource,
  /if \(!dryRun\) \{[\s\S]*pruneOldGenerationQueuePayloads\(\)/,
  'cleanup service should skip queue payload pruning during dry runs',
)

/** Comments explain the legacy fallback by name, so contracts about code must ignore them. */
function stripComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

// PAYLOAD-2: debug bookkeeping moved to its own columns, so it must never rewrite the payload blob.
assert.doesNotMatch(
  stripComments(queueDebugMetaSource),
  /request_payload/,
  'queue debug metadata must never read or rewrite request_payload (PAYLOAD-2)',
)

assert.match(
  queueDebugMetaSource,
  /GenerationQueueModel\.updateDebugMeta\(record\.id, meta\)/,
  'queue debug metadata writes should go through the dedicated debug_meta column update',
)

const updateDebugMetaBody = generationQueueSource.slice(
  generationQueueSource.indexOf('static updateDebugMeta('),
  generationQueueSource.indexOf('/** Find one queue job for API responses'),
)
assert.match(
  updateDebugMetaBody,
  /UPDATE generation_queue_jobs\s*SET debug_meta = \?,\s*debug_enabled = \?/,
  'debug metadata updates must write only the debug columns, never request_payload (PAYLOAD-2)',
)
assert.doesNotMatch(
  stripComments(updateDebugMetaBody),
  /request_payload/,
  'debug metadata updates must not touch request_payload (PAYLOAD-2)',
)

// Pruning compacts request_payload only, so debug_meta survives for already-finished jobs
// that graph executors still resolve results from.
assert.doesNotMatch(
  generationQueueSource.match(/static pruneTerminalRequestPayloads[\s\S]*?^  }/m)?.[0] ?? '',
  /debug_meta|debug_enabled/,
  'terminal payload pruning must leave debug_meta intact so completed graph jobs stay resolvable',
)

console.log('Generation queue payload pruning contracts verified.')
