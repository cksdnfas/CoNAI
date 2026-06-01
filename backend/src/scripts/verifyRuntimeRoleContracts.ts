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
const indexSource = fs.readFileSync(path.join(projectRoot, 'backend', 'src', 'index.ts'), 'utf8');

assert.match(runnerSource, /--api/);
assert.match(runnerSource, /--worker/);
assert.match(runnerSource, /CONAI_RUNTIME_ROLE/);
assert.match(runnerSource, /CONAI_WORKER_HTTP/);
assert.match(indexSource, /shouldSkipHttpServerForRuntimeRole/);
assert.match(indexSource, /HTTP server disabled/);

assert.equal(fs.existsSync(path.join(projectRoot, 'RUN_CoNAI_API.bat')), true);
assert.equal(fs.existsSync(path.join(projectRoot, 'RUN_CoNAI_WORKER.bat')), true);

console.log('✅ Runtime role contracts verified');

