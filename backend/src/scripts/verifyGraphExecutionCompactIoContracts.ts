import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const projectRoot = path.resolve(__dirname, '../../..')

function readSource(relativePath: string) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8')
}

const schemaSource = readSource('backend/src/database/userSettingsSchema.ts')
const migrationSource = readSource('backend/src/database/migrations/021_add_graph_execution_node_io.ts')
const executorSource = readSource('backend/src/services/graphWorkflowExecutor.ts')
const compactorSource = readSource('backend/src/services/graphWorkflowExecutionCompactor.ts')
const executionRoutesSource = readSource('backend/src/routes/graph-workflows/execution-routes.ts')

assert.match(
  schemaSource,
  /CREATE TABLE IF NOT EXISTS graph_execution_node_io/,
  'initial user settings schema should create the compact graph execution node IO table',
)
assert.match(
  migrationSource,
  /CREATE TABLE IF NOT EXISTS graph_execution_node_io/,
  'migration should create the compact graph execution node IO table for existing DBs',
)
assert.match(
  schemaSource,
  /direction TEXT NOT NULL CHECK\(direction IN \('input', 'output'\)\)/,
  'compact node IO table should store input/output direction explicitly',
)
assert.match(
  compactorSource,
  /GraphExecutionNodeIoModel\.replaceForExecution/,
  'compactor should persist compact node IO rows',
)
assert.match(
  compactorSource,
  /refKind: 'canonical_media_hash'/,
  'compactor should prefer canonical media hash references over file copies',
)
assert.match(
  compactorSource,
  /finalSourceArtifactIds/,
  'compactor should preserve artifacts referenced by final results',
)
assert.match(
  compactorSource,
  /context\.debugMode/,
  'compactor should keep detailed artifacts when graph debug mode is enabled',
)
assert.match(
  compactorSource,
  /runtimePaths\.tempDir, 'graph-executions'/,
  'compactor should delete only graph temp artifacts, not canonical upload files',
)

const persistIndex = executorSource.indexOf('persistCompactGraphExecutionNodeIo(context)')
const compactIndex = executorSource.indexOf('compactCompletedGraphExecutionArtifacts(context)')
const completeIndex = executorSource.indexOf("GraphExecutionModel.updateStatus(executionId, 'completed')")
assert.ok(persistIndex > -1, 'executor should persist compact node IO after node execution')
assert.ok(compactIndex > persistIndex, 'executor should compact transient artifacts after node IO persistence')
assert.ok(completeIndex > compactIndex, 'executor should mark completed after compacting execution outputs')

assert.match(
  executionRoutesSource,
  /node_io: nodeIo/,
  'execution detail route should expose compact node IO rows',
)

console.log('Graph execution compact IO contracts verified')
