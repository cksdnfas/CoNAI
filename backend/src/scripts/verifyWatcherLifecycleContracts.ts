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
import {
  MIN_WATCHER_POLLING_INTERVAL_MS,
  resolveWatcherPollingOptions,
} from '../services/fileWatcher/fileWatcherPathUtils';

const projectRoot = path.resolve(__dirname, '../../..');
const fileWatcherSource = fs.readFileSync(
  path.join(projectRoot, 'backend/src/services/fileWatcherService.ts'),
  'utf8',
);
const watcherMigrationSource = fs.readFileSync(
  path.join(projectRoot, 'backend/src/database/migrations/033_reset_prefilled_watcher_polling.ts'),
  'utf8',
);
const watchedFolderServiceSource = fs.readFileSync(
  path.join(projectRoot, 'backend/src/services/watchedFolderService.ts'),
  'utf8',
);
const runtimeStartupSource = fs.readFileSync(
  path.join(projectRoot, 'backend/src/startup/startRuntimeSideEffectServices.ts'),
  'utf8',
);

assert.equal(DEFAULT_WATCHER_READY_TIMEOUT_MS, 120_000);
assert.equal(resolveWatcherReadyTimeoutMs('45000'), 45_000);
assert.equal(resolveWatcherReadyTimeoutMs('0'), DEFAULT_WATCHER_READY_TIMEOUT_MS);
assert.equal(resolveWatcherReadyTimeoutMs('invalid'), DEFAULT_WATCHER_READY_TIMEOUT_MS);
assert.equal(MIN_WATCHER_POLLING_INTERVAL_MS, 2_000);
assert.deepEqual(
  resolveWatcherPollingOptions({ watcher_polling_interval: null }, 'C:\\local-media'),
  { usePolling: false, pollingInterval: undefined, pollingReason: 'default' },
  'a local folder with the null default must use the native watcher',
);
assert.deepEqual(
  resolveWatcherPollingOptions({ watcher_polling_interval: 100 }, 'C:\\local-media'),
  { usePolling: true, pollingInterval: 2_000, pollingReason: 'user-configured' },
  'explicit polling must retain the 2-second storm-safe floor',
);

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

async function verifyAbortListenerCleanup(): Promise<void> {
  const emitter = new EventEmitter();
  const controller = new AbortController();
  const readyPromise = waitForChokidarReady({
    watcher: emitter as unknown as FSWatcher,
    signal: controller.signal,
    timeoutMs: 50,
    timeoutMessage: 'timeout',
  });

  controller.abort(new Error('shutdown'));
  await assert.rejects(readyPromise, /shutdown/);
  assert.equal(emitter.listenerCount('ready'), 0);
  assert.equal(emitter.listenerCount('error'), 0);
}

assert.match(
  fileWatcherSource,
  /await waitForWatcherReady[\s\S]*?catch \(error\)[\s\S]*?await watcher\.close\(\)/,
  'a watcher that fails readiness must be closed before the error escapes',
);
assert.match(
  watcherMigrationSource,
  /SET watcher_polling_interval = NULL[\s\S]*WHERE watcher_polling_interval = 2000/,
  'migration 033 must reset the old forced-polling prefill to the null native default',
);
assert.match(
  watchedFolderServiceSource,
  /folderData\.watcher_polling_interval \?\? null/,
  'new watched folders must persist null instead of forcing polling',
);
assert.match(
  runtimeStartupSource,
  /watcherStartupController\?\.abort[\s\S]*watcherStartupPromise = \(async \(\) => \{[\s\S]*FileWatcherService\.initialize\(startupController\.signal\)[\s\S]*void watcherStartupPromise/,
  'watcher readiness must remain detached and abortable before shutdown drains it',
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

Promise.all([verifyReadyListenerCleanup(), verifyTimeoutListenerCleanup(), verifyAbortListenerCleanup()])
  .then(() => {
    console.log('✅ Watcher lifecycle contracts verified');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
