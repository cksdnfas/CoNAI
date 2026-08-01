import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 그룹 재매칭 폴링 계약.
 *
 * 잡 폴링 정책은 이제 공용 러너 클라이언트(`api-runtime-jobs.ts`)가 소유한다.
 * 예전 계약이 고정하던 `DEFAULT_POLL_INTERVAL_MS = 1000` 은 고정 1초 × 2시간 = 최대 7200 요청을
 * 만들었으므로, "가볍게 폴링한다" 는 원래 의도는 적응형 간격 위임으로 옮겼다.
 */

const sourceRoot = path.resolve(process.cwd(), 'src')

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(sourceRoot, relativePath), 'utf8')
}

const jobApi = readSource('lib/api-group-rematch-jobs.ts')
const groupApi = readSource('lib/api-groups.ts')
const autoFolderApi = readSource('lib/api-auto-folder-groups.ts')
const groupTypes = readSource('types/group.ts')

assert.match(
  groupTypes,
  /GroupRematchJobRecord/,
  'frontend must model group rematch job responses',
)
assert.match(
  jobApi,
  /\/api\/groups\/auto-collect-jobs\/\$\{jobId\}/,
  'frontend must poll the backend group rematch job route',
)

/* ------------------------------------------------------------------ *
 * 폴링 정책은 공용 러너에 위임한다 (고정 상수 금지).
 * ------------------------------------------------------------------ */

assert.match(
  jobApi,
  /from '@\/lib\/api-runtime-jobs'/,
  'group rematch polling must delegate to the shared runtime job client instead of owning a second policy',
)
assert.match(
  jobApi,
  /resolveRuntimeJobPollIntervalMs\(/,
  'group rematch polling should be lightweight: the interval must come from the shared adaptive policy',
)
assert.doesNotMatch(
  jobApi,
  /DEFAULT_POLL_INTERVAL_MS\s*=\s*\d/,
  'a hard-coded poll interval reintroduces the fixed 1s x 2h polling budget the runner replaced',
)
assert.match(
  jobApi,
  /RUNTIME_JOB_WAIT_TIMEOUT_MS/,
  'group rematch polling should allow long-running real data jobs',
)

/* ------------------------------------------------------------------ *
 * 호출부 시그니처 유지 — 단계별 이관 중에도 앱이 계속 동작해야 한다.
 * ------------------------------------------------------------------ */

assert.match(
  jobApi,
  /export async function resolveGroupRematchJobResponse<T>\(data: T \| GroupRematchJobRecord<T>\): Promise<T>/,
  'resolveGroupRematchJobResponse must keep its signature while call sites still expect the legacy result shape',
)
assert.match(
  groupApi,
  /resolveGroupRematchJobResponse\(response\.data\)/,
  'manual group auto-collect calls must resolve background jobs before returning old result shape',
)
assert.match(
  autoFolderApi,
  /resolveGroupRematchJobResponse\(response\.data\)/,
  'auto-folder rebuild calls must resolve background jobs before returning old result shape',
)

console.log('✅ Group rematch polling contracts verified')
