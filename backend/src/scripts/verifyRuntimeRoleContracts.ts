import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  isSplitRuntimeOptIn,
  normalizeRuntimeSideEffectRole,
  resolveRuntimeSideEffectRole,
  shouldServeHttpForRuntimeRole,
  shouldSkipHttpServerForRuntimeRole,
  wasSplitRuntimeRoleDemoted,
} from '../startup/runtimeRole';

assert.equal(normalizeRuntimeSideEffectRole('all'), 'all');
assert.equal(normalizeRuntimeSideEffectRole('api'), 'api');
assert.equal(normalizeRuntimeSideEffectRole('worker'), 'worker');
assert.equal(normalizeRuntimeSideEffectRole(' WORKER '), 'worker');
assert.equal(normalizeRuntimeSideEffectRole('bad-role'), null);

assert.equal(resolveRuntimeSideEffectRole({}), 'all');

// Split roles are unsupported and demote to 'all' unless the operator opted in.
assert.equal(resolveRuntimeSideEffectRole({ CONAI_RUNTIME_ROLE: 'worker' }), 'all');
assert.equal(resolveRuntimeSideEffectRole({ CONAI_RUNTIME_ROLE: 'api' }), 'all');
assert.equal(resolveRuntimeSideEffectRole({ CONAI_SIDE_EFFECT_ROLE: 'api' }), 'all');
assert.equal(resolveRuntimeSideEffectRole({ CONAI_RUNTIME_ROLE: 'worker', CONAI_SIDE_EFFECT_ROLE: 'api' }), 'all');
assert.equal(wasSplitRuntimeRoleDemoted({ CONAI_RUNTIME_ROLE: 'worker' }), true);
assert.equal(wasSplitRuntimeRoleDemoted({}), false);
assert.equal(wasSplitRuntimeRoleDemoted({ CONAI_RUNTIME_ROLE: 'all' }), false);
assert.equal(wasSplitRuntimeRoleDemoted({ CONAI_RUNTIME_ROLE: 'worker', CONAI_ALLOW_SPLIT_RUNTIME: 'true' }), false);

// The opt-in restores the requested split role, and CONAI_RUNTIME_ROLE still wins over CONAI_SIDE_EFFECT_ROLE.
assert.equal(isSplitRuntimeOptIn({ CONAI_ALLOW_SPLIT_RUNTIME: 'true' }), true);
assert.equal(isSplitRuntimeOptIn({ CONAI_ALLOW_SPLIT_RUNTIME: '1' }), true);
assert.equal(isSplitRuntimeOptIn({ CONAI_ALLOW_SPLIT_RUNTIME: ' YES ' }), true);
assert.equal(isSplitRuntimeOptIn({ CONAI_ALLOW_SPLIT_RUNTIME: 'false' }), false);
assert.equal(isSplitRuntimeOptIn({}), false);
assert.equal(resolveRuntimeSideEffectRole({ CONAI_RUNTIME_ROLE: 'worker', CONAI_ALLOW_SPLIT_RUNTIME: 'true' }), 'worker');
assert.equal(resolveRuntimeSideEffectRole({ CONAI_SIDE_EFFECT_ROLE: 'api', CONAI_ALLOW_SPLIT_RUNTIME: 'true' }), 'api');
assert.equal(
  resolveRuntimeSideEffectRole({
    CONAI_RUNTIME_ROLE: 'worker',
    CONAI_SIDE_EFFECT_ROLE: 'api',
    CONAI_ALLOW_SPLIT_RUNTIME: 'true',
  }),
  'worker',
);

assert.equal(shouldServeHttpForRuntimeRole('all', {}), true);
assert.equal(shouldServeHttpForRuntimeRole('api', {}), true);
assert.equal(shouldServeHttpForRuntimeRole('worker', {}), false);
assert.equal(shouldSkipHttpServerForRuntimeRole('worker', {}), true);
assert.equal(shouldServeHttpForRuntimeRole('worker', { CONAI_WORKER_HTTP: 'true' }), true);
assert.equal(shouldServeHttpForRuntimeRole('worker', { CONAI_WORKER_HTTP: '1' }), true);
assert.equal(shouldServeHttpForRuntimeRole('worker', { CONAI_WORKER_HTTP: 'yes' }), true);

const projectRoot = path.resolve(__dirname, '..', '..', '..');
const runnerSource = fs.readFileSync(path.join(projectRoot, 'scripts', 'run-built-if-needed.js'), 'utf8');
const stopExistingRuntimeSource = fs.readFileSync(path.join(projectRoot, 'scripts', 'stop-existing-runtime.js'), 'utf8');
const checkpointRuntimeDatabasesSource = fs.readFileSync(path.join(projectRoot, 'scripts', 'checkpoint-runtime-databases.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(projectRoot, 'backend', 'src', 'index.ts'), 'utf8');
const gracefulShutdownSource = fs.readFileSync(path.join(projectRoot, 'backend', 'src', 'startup', 'gracefulShutdown.ts'), 'utf8');
const dockerfileSource = fs.readFileSync(path.join(projectRoot, 'Dockerfile'), 'utf8');
const rootPackageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const rootPackageLock = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package-lock.json'), 'utf8'));
const backendPackageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'backend', 'package.json'), 'utf8'));
const splitLauncherSource = fs.readFileSync(path.join(projectRoot, 'RUN_CoNAI.bat'), 'utf8');
const buildAndRunLauncherSource = fs.readFileSync(path.join(projectRoot, 'RUN_CoNAI_BUILD_AND_RUN.bat'), 'utf8');
const manualApiLauncherSource = fs.readFileSync(path.join(projectRoot, 'runtime-tools', 'manual', 'RUN_CoNAI_API_ONLY.bat'), 'utf8');
const manualWorkerLauncherSource = fs.readFileSync(path.join(projectRoot, 'runtime-tools', 'manual', 'RUN_CoNAI_WORKER_ONLY.bat'), 'utf8');
const graphQueueSource = fs.readFileSync(path.join(projectRoot, 'backend', 'src', 'services', 'graphWorkflowExecutionQueue.ts'), 'utf8');

assert.match(runnerSource, /--split/);
assert.match(runnerSource, /--api/);
assert.match(runnerSource, /--worker/);
assert.match(runnerSource, /spawn\(process\.execPath, \[BACKEND_ENTRY\]/);
assert.match(runnerSource, /--skip-build/);
assert.match(runnerSource, /CONAI_RUNTIME_ROLE/);
assert.match(runnerSource, /CONAI_WORKER_HTTP/);
assert.match(runnerSource, /hasExplicitSingleRoleArg/);
assert.match(runnerSource, /startsWith\('--runtime-role='/);
assert.match(runnerSource, /process\.execPath/);
assert.match(runnerSource, /\[BACKEND_ENTRY\]/);
// The launcher gates the unsupported split runtime behind an explicit opt-in.
assert.match(runnerSource, /CONAI_ALLOW_SPLIT_RUNTIME/);
assert.match(runnerSource, /assertSplitRuntimeOptIn/);
assert.match(indexSource, /shouldSkipHttpServerForRuntimeRole/);
assert.match(indexSource, /HTTP server disabled/);
assert.match(indexSource, /const customNodeSyncSkipped = !shouldRunWorkerStartupTasks/);
assert.match(indexSource, /Custom node filesystem sync skipped in API\/smoke runtime/);
assert.match(indexSource, /Custom node sync: skipped in API\/smoke runtime/);
assert.match(indexSource, /wasSplitRuntimeRoleDemoted/);
assert.match(indexSource, /Split runtime role demoted to "all"/);
assert.match(indexSource, /shouldOwnTempFileLifecycle/);
assert.match(indexSource, /createGracefulShutdownCoordinator\(\{[\s\S]*shouldOwnTempFileLifecycle/);
assert.match(gracefulShutdownSource, /if \(shouldOwnTempFileLifecycle\)/);
assert.match(dockerfileSource, /^FROM node:24-bookworm-slim AS build$/m);
assert.match(dockerfileSource, /^FROM node:24-bookworm-slim AS runtime$/m);
assert.doesNotMatch(dockerfileSource, /^FROM node:20-/m);
assert.match(dockerfileSource, /CONAI_RUNTIME_ROLE=all/);
assert.doesNotMatch(dockerfileSource, /CONAI_RUNTIME_ROLE=api/);
// The default built-runtime entry point is single-process.
assert.match(rootPackageJson.scripts['start:built'], /--all/);
assert.doesNotMatch(rootPackageJson.scripts['start:built'], /--split/);
assert.match(rootPackageJson.scripts['start:built:api'], /--api/);
assert.match(rootPackageJson.scripts['start:built:worker'], /--worker/);
assert.equal(rootPackageJson.dependencies['better-sqlite3'], '^13.0.2');
assert.equal(backendPackageJson.dependencies['better-sqlite3'], '^13.0.2');
assert.equal(rootPackageLock.packages[''].dependencies['better-sqlite3'], '^13.0.2');
assert.equal(rootPackageLock.packages.backend.dependencies['better-sqlite3'], '^13.0.2');

assert.equal(fs.existsSync(path.join(projectRoot, 'RUN_CoNAI.bat')), true);
assert.equal(fs.existsSync(path.join(projectRoot, 'RUN_CoNAI_API.bat')), false);
assert.equal(fs.existsSync(path.join(projectRoot, 'RUN_CoNAI_WORKER.bat')), false);
assert.equal(fs.existsSync(path.join(projectRoot, 'runtime-tools', 'manual', 'RUN_CoNAI_API_ONLY.bat')), true);
assert.equal(fs.existsSync(path.join(projectRoot, 'runtime-tools', 'manual', 'RUN_CoNAI_WORKER_ONLY.bat')), true);
assert.equal(fs.existsSync(path.join(projectRoot, 'scripts', 'stop-existing-runtime.js')), true);
assert.equal(fs.existsSync(path.join(projectRoot, 'scripts', 'checkpoint-runtime-databases.js')), true);
assert.match(splitLauncherSource, /stop-existing-runtime\.js/);
assert.match(splitLauncherSource, /ensure-workspace-dependencies\.js/);
assert.match(splitLauncherSource, /checkpoint-runtime-databases\.js/);
assert.match(splitLauncherSource, /--all/);
assert.doesNotMatch(splitLauncherSource, /--split/);
assert.match(splitLauncherSource, /"%~dp0scripts\\run-built-if-needed\.js"/);
assert.ok(
  splitLauncherSource.indexOf('stop-existing-runtime.js')
    < splitLauncherSource.indexOf('ensure-workspace-dependencies.js'),
);
assert.ok(
  splitLauncherSource.indexOf('ensure-workspace-dependencies.js')
    < splitLauncherSource.indexOf('checkpoint-runtime-databases.js'),
);
assert.match(runnerSource, /ensureWorkspaceDependencies/);
assert.ok(runnerSource.indexOf('ensureWorkspaceDependencies();') < runnerSource.indexOf('const status = isBuildStale();'));
// The manual split launchers stay, but they must opt in and warn that split is unsupported.
assert.match(manualApiLauncherSource, /--api/);
assert.match(manualApiLauncherSource, /CONAI_ALLOW_SPLIT_RUNTIME/);
assert.match(manualApiLauncherSource, /UNSUPPORTED/i);
assert.match(manualWorkerLauncherSource, /--worker/);
assert.match(manualWorkerLauncherSource, /CONAI_ALLOW_SPLIT_RUNTIME/);
assert.match(manualWorkerLauncherSource, /UNSUPPORTED/i);
assert.match(stopExistingRuntimeSource, /Get-NetTCPConnection/);
assert.match(stopExistingRuntimeSource, /taskkill\.exe/);
assert.match(stopExistingRuntimeSource, /scripts\/run-built-if-needed\.js/);
assert.match(stopExistingRuntimeSource, /--api/);
assert.match(stopExistingRuntimeSource, /--worker/);
assert.match(stopExistingRuntimeSource, /--split/);
assert.match(stopExistingRuntimeSource, /isLegacyAllRunner/);
assert.match(stopExistingRuntimeSource, /NORMALIZED_ROOT_DIR/);
assert.match(stopExistingRuntimeSource, /NORMALIZED_BACKEND_ENTRY/);
assert.match(stopExistingRuntimeSource, /isCoNaiBackendEntryProcess/);
assert.doesNotMatch(stopExistingRuntimeSource, /hasBackendEntry/);
assert.match(checkpointRuntimeDatabasesSource, /wal_checkpoint\(TRUNCATE\)/);
assert.match(checkpointRuntimeDatabasesSource, /RUNTIME_DATABASE_DIR/);
assert.match(buildAndRunLauncherSource, /RUN_CoNAI\.bat/);
// A process that never started the graph workflow queue must not claim jobs (A-1 regression guard).
assert.match(graphQueueSource, /private static processQueue\(\)\s*\{\s*if \(!this\.initialized\)/);

console.log('✅ Runtime role contracts verified');
