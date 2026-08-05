import { deepEqual, doesNotMatch, equal, match, ok } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isRuntimeJobTerminal, resolveRuntimeJobPollIntervalMs } from '../lib/api-runtime-jobs'

/**
 * 잡 진행률 UI 계약.
 *
 * 핵심은 두 가지다.
 * 1. 폴링이 **종료 상태에서 멈춘다** — 고정 상수 interval 은 금지한다.
 * 2. 백엔드/프론트 잡 타입 미러가 어긋나지 않는다.
 */

const frontendTypesSource = readFileSync(resolve(process.cwd(), 'src/types/runtime-job.ts'), 'utf8')
const backendTypesSource = readFileSync(resolve(process.cwd(), '../backend/src/types/runtimeJob.ts'), 'utf8')
const apiSource = readFileSync(resolve(process.cwd(), 'src/lib/api-runtime-jobs.ts'), 'utf8')
const hookSource = readFileSync(resolve(process.cwd(), 'src/lib/use-runtime-job.ts'), 'utf8')
const progressComponentSource = readFileSync(resolve(process.cwd(), 'src/components/common/runtime-job-progress.tsx'), 'utf8')
const groupRematchApiSource = readFileSync(resolve(process.cwd(), 'src/lib/api-group-rematch-jobs.ts'), 'utf8')
const bridgeSource = readFileSync(resolve(process.cwd(), 'src/features/runtime-events/use-runtime-event-query-bridge.ts'), 'utf8')
const folderSettingsHookSource = readFileSync(resolve(process.cwd(), 'src/features/settings/use-folder-settings-tab.ts'), 'utf8')

/** Extract one string-literal union declared as `export type <name> = 'a' | 'b'`. */
function readUnionLiterals(source: string, typeName: string): string[] {
  const declaration = new RegExp(`export type ${typeName} =([\\s\\S]*?)\\r?\\n\\r?\\n`).exec(source)
  if (!declaration) {
    throw new Error(`expected ${typeName} to be declared as a string literal union`)
  }

  return [...declaration[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]).sort()
}

function assertTypeMirrorHasNoDrift() {
  for (const typeName of ['RuntimeJobKind', 'RuntimeJobStatus']) {
    deepEqual(
      readUnionLiterals(frontendTypesSource, typeName),
      readUnionLiterals(backendTypesSource, typeName),
      `${typeName} must stay identical between backend and frontend runtime job types`,
    )
  }

  match(
    frontendTypesSource,
    /export interface RuntimeJobProgress \{[\s\S]*?total: number[\s\S]*?processed: number[\s\S]*?succeeded: number[\s\S]*?failed: number[\s\S]*?skipped: number[\s\S]*?percentage: number[\s\S]*?currentLabel: string \| null/,
    'the progress mirror must carry every field the backend writes',
  )
}

function assertApiSurface() {
  match(apiSource, /\/api\/jobs\/\$\{jobId\}/, 'the job client must read the canonical progress route')
  match(apiSource, /\/api\/jobs\/\$\{jobId\}\/cancel/, 'the job client must call the cancel route')
  match(apiSource, /export function isRuntimeJobTerminal/, 'terminal detection must be shared, not re-derived per surface')
  match(apiSource, /export function isRuntimeJobRecord/, 'callers must be able to detect a 202 job response')
}

function assertPollingPolicy() {
  match(
    hookSource,
    /queryKey: runtimeJobQueryKey\(jobId\)/,
    'the job hook must use the shared query key builder so the SSE bridge can invalidate the same entry',
  )
  match(
    hookSource,
    /export const RUNTIME_JOB_QUERY_KEY = 'runtime-job'/,
    "the job query key prefix must stay 'runtime-job'",
  )
  match(
    hookSource,
    /refetchInterval: \(query\) => \{[\s\S]*?isRuntimeJobTerminal\(query\.state\.data\?\.status\)[\s\S]*?return false/,
    'polling must stop as soon as the job reaches a terminal state',
  )
  doesNotMatch(
    hookSource,
    /refetchInterval: \d/,
    'a constant refetchInterval keeps polling a finished job forever',
  )
  match(
    hookSource,
    /document\.visibilityState === 'hidden'/,
    'a hidden tab must not keep polling a job',
  )
  match(
    hookSource,
    /queryClient\.setQueryData\(runtimeJobQueryKey\(job\.jobId\), job\)/,
    'the 202 response must seed the cache so the first render already shows progress',
  )
}

function assertProgressComponent() {
  match(progressComponentSource, /cancel\?:/, 'the progress component must accept a cancel handler')
  match(progressComponentSource, /isCancelling/, 'the cancel button must show its pending state')
  match(progressComponentSource, /job\.progress\.currentLabel/, 'the progress component must render the current target label')
  match(
    progressComponentSource,
    /job\.status === 'cancelled'/,
    'a cancelled job must be labelled as partially completed, because processed items are not rolled back',
  )
}

function assertLegacyDelegation() {
  match(
    groupRematchApiSource,
    /from '@\/lib\/api-runtime-jobs'/,
    'the legacy group rematch client must delegate its polling policy to the shared runtime job client',
  )
  doesNotMatch(
    groupRematchApiSource,
    /DEFAULT_POLL_INTERVAL_MS\s*=\s*\d/,
    'the legacy client must not keep its own fixed polling constant',
  )
}

function assertStreamHintWiring() {
  match(
    bridgeSource,
    /case 'job\.status': \{[\s\S]*?invalidateQueries\(\{[\s\S]*?queryKey: \[RUNTIME_JOB_QUERY_KEY, payload\.job_id\]/,
    'the SSE job hint must only invalidate the job query; progress values stay on the polling contract',
  )
  doesNotMatch(
    bridgeSource,
    /payload\.(?:progress|processed|percentage)/,
    'the job hint carries no progress numbers, so the bridge must never read them',
  )
}

function assertMigratedCallSites() {
  match(
    folderSettingsHookSource,
    /useRuntimeJobAction<ScanAllSummary>\(scanAllWatchedFolders/,
    'scan-all must be tracked as a job instead of awaiting a synchronous response',
  )
  doesNotMatch(
    folderSettingsHookSource,
    /const summary = await scanAllWatchedFolders\(\)/,
    'awaiting scan-all reintroduces the 60s socket timeout failure the runner removed',
  )
}

function assertPollingBackoffBehaviour() {
  equal(resolveRuntimeJobPollIntervalMs(0), 500, 'a freshly started job must be polled tightly')
  equal(resolveRuntimeJobPollIntervalMs(4), 500)
  equal(resolveRuntimeJobPollIntervalMs(5), 2_000, 'a quiet job must back off')
  equal(resolveRuntimeJobPollIntervalMs(21), 5_000, 'a long quiet job must back off further')
  ok(resolveRuntimeJobPollIntervalMs(1_000) <= 5_000, 'the backoff must stay bounded')

  equal(isRuntimeJobTerminal('running'), false)
  equal(isRuntimeJobTerminal('queued'), false)
  equal(isRuntimeJobTerminal('completed'), true)
  equal(isRuntimeJobTerminal('failed'), true)
  equal(isRuntimeJobTerminal('cancelled'), true)
  equal(isRuntimeJobTerminal(undefined), false, 'an unloaded job must not be treated as finished')
}

assertTypeMirrorHasNoDrift()
assertApiSurface()
assertPollingPolicy()
assertProgressComponent()
assertLegacyDelegation()
assertStreamHintWiring()
assertMigratedCallSites()
assertPollingBackoffBehaviour()

console.log('Runtime job UI contracts verified.')
