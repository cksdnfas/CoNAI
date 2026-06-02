import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeRuntimeSideEffectRole,
  resolveRuntimeSideEffectRole,
  shouldServeHttpForRuntimeRole,
  shouldSkipHttpServerForRuntimeRole,
} from '../startup/runtimeRole';

assert.equal(normalizeRuntimeSideEffectRole('all'), 'all');
assert.equal(normalizeRuntimeSideEffectRole('api'), 'api');
assert.equal(normalizeRuntimeSideEffectRole('worker'), 'worker');
assert.equal(normalizeRuntimeSideEffectRole(' WORKER '), 'worker');
assert.equal(normalizeRuntimeSideEffectRole('bad-role'), null);

assert.equal(resolveRuntimeSideEffectRole({}), 'all');
assert.equal(resolveRuntimeSideEffectRole({ CONAI_SIDE_EFFECT_ROLE: 'api' }), 'api');
assert.equal(resolveRuntimeSideEffectRole({ CONAI_RUNTIME_ROLE: 'worker', CONAI_SIDE_EFFECT_ROLE: 'api' }), 'worker');

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
const splitLauncherSource = fs.readFileSync(path.join(projectRoot, 'RUN_CoNAI.bat'), 'utf8');
const buildAndRunLauncherSource = fs.readFileSync(path.join(projectRoot, 'RUN_CoNAI_BUILD_AND_RUN.bat'), 'utf8');

assert.match(runnerSource, /--api/);
assert.match(runnerSource, /--worker/);
assert.match(runnerSource, /--skip-build/);
assert.match(runnerSource, /CONAI_RUNTIME_ROLE/);
assert.match(runnerSource, /CONAI_WORKER_HTTP/);
assert.match(runnerSource, /process\.execPath/);
assert.match(runnerSource, /\[BACKEND_ENTRY\]/);
assert.match(indexSource, /shouldSkipHttpServerForRuntimeRole/);
assert.match(indexSource, /HTTP server disabled/);

assert.equal(fs.existsSync(path.join(projectRoot, 'RUN_CoNAI.bat')), true);
assert.equal(fs.existsSync(path.join(projectRoot, 'RUN_CoNAI_API.bat')), true);
assert.equal(fs.existsSync(path.join(projectRoot, 'RUN_CoNAI_WORKER.bat')), true);
assert.equal(fs.existsSync(path.join(projectRoot, 'scripts', 'stop-existing-runtime.js')), true);
assert.equal(fs.existsSync(path.join(projectRoot, 'scripts', 'checkpoint-runtime-databases.js')), true);
assert.match(splitLauncherSource, /stop-existing-runtime\.js/);
assert.match(splitLauncherSource, /checkpoint-runtime-databases\.js/);
assert.match(splitLauncherSource, /--build-only/);
assert.match(splitLauncherSource, /--api --skip-build/);
assert.match(splitLauncherSource, /--worker --skip-build/);
assert.match(splitLauncherSource, /"%~dp0scripts\\run-built-if-needed\.js"/);
assert.match(stopExistingRuntimeSource, /Get-NetTCPConnection/);
assert.match(stopExistingRuntimeSource, /taskkill\.exe/);
assert.match(stopExistingRuntimeSource, /scripts\/run-built-if-needed\.js/);
assert.match(stopExistingRuntimeSource, /--api/);
assert.match(stopExistingRuntimeSource, /--worker/);
assert.match(stopExistingRuntimeSource, /isLegacyAllRunner/);
assert.match(stopExistingRuntimeSource, /NORMALIZED_ROOT_DIR/);
assert.match(stopExistingRuntimeSource, /NORMALIZED_BACKEND_ENTRY/);
assert.match(stopExistingRuntimeSource, /isCoNaiBackendEntryProcess/);
assert.doesNotMatch(stopExistingRuntimeSource, /hasBackendEntry/);
assert.match(checkpointRuntimeDatabasesSource, /wal_checkpoint\(TRUNCATE\)/);
assert.match(checkpointRuntimeDatabasesSource, /RUNTIME_DATABASE_DIR/);
assert.match(buildAndRunLauncherSource, /RUN_CoNAI\.bat/);

console.log('✅ Runtime role contracts verified');
