import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

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
assert.match(
  jobApi,
  /DEFAULT_POLL_INTERVAL_MS\s*=\s*1000/,
  'group rematch polling should be lightweight',
)
assert.match(
  jobApi,
  /DEFAULT_TIMEOUT_MS\s*=\s*2\s*\*\s*60\s*\*\s*60\s*\*\s*1000/,
  'group rematch polling should allow long-running real data jobs',
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
