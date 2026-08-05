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

// ---------------------------------------------------------------------------
// PAYLOAD-3: base64 image inputs live in a content-addressed store, refcounted per job.
// ---------------------------------------------------------------------------
const queueInputStoreSource = fs.readFileSync(path.resolve(process.cwd(), 'src/services/generation-queue/queueInputStore.ts'), 'utf8')
const prepareComfyPromptDataSource = fs.readFileSync(path.resolve(process.cwd(), 'src/services/prepareComfyPromptData.ts'), 'utf8')
const queueActionRoutesSource = fs.readFileSync(path.resolve(process.cwd(), 'src/routes/generation-queue/queue-action-routes.ts'), 'utf8')
const publicWorkflowRoutesSource = fs.readFileSync(path.resolve(process.cwd(), 'src/routes/public-workflows.routes.ts'), 'utf8')

// The store must not sit under `temp/`, which is mounted as a public static directory.
assert.doesNotMatch(
  stripComments(queueInputStoreSource),
  /runtimePaths\.tempDir/,
  'stored queue inputs must not live under the statically served temp directory (PAYLOAD-3)',
)
assert.match(
  queueInputStoreSource,
  /path\.join\(runtimePaths\.basePath, 'queue-inputs'\)/,
  'stored queue inputs should live in their own non-served directory',
)

// Blobs are addressed by content, which is what makes a 32-way duplicate submission store one file.
assert.match(
  queueInputStoreSource,
  /crypto\.createHash\('sha256'\)\.update\(buffer\)\.digest\('hex'\)/,
  'queue inputs must be content-addressed so duplicate submissions share one file (PAYLOAD-3)',
)
assert.match(
  queueInputStoreSource,
  /fs\.renameSync\(stagingPath, absolutePath\)/,
  'queue input writes must land atomically so a crash cannot leave a truncated blob at its hash address',
)

// Lifetime is anchored to payload compaction, never to a bare terminal status.
assert.match(
  generationQueueSource,
  /const released = releaseQueueInputsForJobs\(prunableJobIds\)/,
  'pruning must release the inputs of exactly the jobs whose payloads it compacted (PAYLOAD-3)',
)
assert.match(
  generationQueueSource,
  /registerQueueInputRefs\(jobId, collectQueueInputRefs\(data\.request_payload\)\)/,
  'every queue job creation (including retries) must register its claim on referenced inputs',
)
assert.match(
  queueInputStoreSource,
  /WHERE sha256 = \? LIMIT 1/,
  'input deletion must be guarded by a refcount lookup, not by the releasing job alone',
)

// Backward compatibility (plan §1-8): payloads with inline base64 must still dispatch.
assert.match(
  prepareComfyPromptDataSource,
  /if \(isQueueInputRef\(value\)\) \{[\s\S]*?resolveQueueInputFilePath\(value\)/,
  'dispatch must resolve stored queue input references (PAYLOAD-3)',
)
assert.match(
  prepareComfyPromptDataSource,
  /const base64 = normalizeBase64ImageData\(payload\.dataUrl\)/,
  'the inline dataUrl dispatch path must be kept for rows written before PAYLOAD-3 (plan §1-8)',
)

// Both enqueue surfaces externalize before the payload is written.
assert.match(
  queueActionRoutesSource,
  /externalizeQueueInputDataUrls\(normalizeWorkflowNumericPromptValues\(workflowMarkedFields, promptData\)\)\.value/,
  'the queue enqueue route must externalize base64 inputs before persisting the payload',
)
assert.match(
  publicWorkflowRoutesSource,
  /externalizeQueueInputDataUrls\(/,
  'the public workflow enqueue route must externalize base64 inputs before persisting the payload',
)
assert.match(
  queueActionRoutesSource,
  /const enqueueCount = service_type === 'codex' \? codexJobCount : \(enqueue_count \?\? 1\)/,
  'one enqueue request must expand server-side instead of re-uploading the payload per copy',
)

console.log('Generation queue payload pruning contracts verified.')
