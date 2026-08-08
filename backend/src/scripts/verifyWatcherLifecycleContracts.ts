import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import type { FSWatcher } from 'chokidar';
import {
  DEFAULT_WATCHER_READY_TIMEOUT_MS,
  resolveWatcherReadyTimeoutMs,
  waitForChokidarReady,
} from '../services/watcherLifecycleUtils';

const projectRoot = path.resolve(__dirname, '../../..');
const fileWatcherSource = fs.readFileSync(
  path.join(projectRoot, 'backend/src/services/fileWatcherService.ts'),
  'utf8',
);

assert.equal(DEFAULT_WATCHER_READY_TIMEOUT_MS, 120_000);
assert.equal(resolveWatcherReadyTimeoutMs('45000'), 45_000);
assert.equal(resolveWatcherReadyTimeoutMs('0'), DEFAULT_WATCHER_READY_TIMEOUT_MS);
assert.equal(resolveWatcherReadyTimeoutMs('invalid'), DEFAULT_WATCHER_READY_TIMEOUT_MS);

async function verifyReadyListenerCleanup(): Promise<void> {
  const emitter = new EventEmitter();
  let readyCalled = false;
  const readyPromise = waitForChokidarReady({
    watcher: emitter as unknown as FSWatcher,
    timeoutMs: 50,
    timeoutMessage: 'timeout',
    onReady: () => {
      readyCalled = true;
    },
  });

  emitter.emit('ready');
  await readyPromise;
  assert.equal(readyCalled, true);
  assert.equal(emitter.listenerCount('ready'), 0);
  assert.equal(emitter.listenerCount('error'), 0);
}

async function verifyTimeoutListenerCleanup(): Promise<void> {
  const emitter = new EventEmitter();
  await assert.rejects(
    waitForChokidarReady({
      watcher: emitter as unknown as FSWatcher,
      timeoutMs: 5,
      timeoutMessage: 'watcher timeout',
    }),
    /watcher timeout/,
  );
  assert.equal(emitter.listenerCount('ready'), 0);
  assert.equal(emitter.listenerCount('error'), 0);
}

assert.match(
  fileWatcherSource,
  /await waitForWatcherReady[\s\S]*?catch \(error\)[\s\S]*?await watcher\.close\(\)/,
  'a watcher that fails readiness must be closed before the error escapes',
);
assert.match(
  fileWatcherSource,
  /restartWatcher\(folderId: number, retryState\?: WatcherRetryState\)[\s\S]*?startWatcher\(folderId, retryState\)/,
  'watcher replacement must carry retry state into the new registry entry',
);

const maxAttemptGuardIndex = fileWatcherSource.indexOf('if (entry.retryAttempts >= this.MAX_RETRY_ATTEMPTS)');
const retryIncrementIndex = fileWatcherSource.indexOf('entry.retryAttempts += 1', maxAttemptGuardIndex);
assert.ok(maxAttemptGuardIndex >= 0 && retryIncrementIndex > maxAttemptGuardIndex,
  'the retry limit must be checked before incrementing so the configured final attempt actually runs');
assert.match(
  fileWatcherSource,
  /const failedEntry = this\.watcherRegistry\.get\(folderId\)[\s\S]*?failedEntry\.retryAttempts < this\.MAX_RETRY_ATTEMPTS/,
  'restart failures must continue from the replacement entry instead of the stale entry',
);

Promise.all([verifyReadyListenerCleanup(), verifyTimeoutListenerCleanup()])
  .then(() => {
    console.log('✅ Watcher lifecycle contracts verified');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
