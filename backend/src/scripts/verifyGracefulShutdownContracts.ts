import assert from 'node:assert/strict';
import type { Express, RequestHandler } from 'express';
import {
  configureAppMiddleware,
  type AppMiddlewareDependencies,
} from '../startup/configureAppMiddleware';
import {
  SHUTDOWN_DRAIN_TIMEOUT_MS,
  SHUTDOWN_FORCE_EXIT_TIMEOUT_MS,
  createGracefulShutdownCoordinator,
  registerGracefulShutdownSignalHandlers,
  type GracefulShutdownDependencies,
  type GracefulShutdownServer,
} from '../startup/gracefulShutdown';
import { assembleSessionApiRoutes } from '../startup/initializeSessionMiddleware';

type ScenarioOptions = {
  isSafeSmokeMode: boolean;
  shouldOwnTempFileLifecycle: boolean;
  sendDuplicateSignal?: boolean;
};

type FakeTimer = {
  callback: () => void;
  delayMs: number;
  unrefCount: number;
};

function createFakeDependencies(
  events: string[],
  timers: FakeTimer[],
  overrides: Partial<GracefulShutdownDependencies> = {},
): GracefulShutdownDependencies {
  const record = (event: string) => {
    events.push(event);
  };

  return {
    shutdownRuntimeEventStreams: () => {
      record('sse');
      return 2;
    },
    stopFileWatcher: () => record('watcher:file'),
    stopCustomNodeWatcher: () => record('watcher:custom-node'),
    stopAutoScanScheduler: () => record('scheduler:auto-scan'),
    stopAutoTagScheduler: () => record('scheduler:auto-tag'),
    stopTempImageCleanupScheduler: () => record('scheduler:temp-image'),
    stopGenerationHistoryCleanupScheduler: () => record('scheduler:history-cleanup'),
    cleanupTempFiles: () => record('temp:cleanup'),
    stopTaggerDaemon: () => record('tagger'),
    shutdownJobTracker: () => record('job-tracker'),
    shutdownRuntimeJobs: () => {
      record('runtime-jobs');
      return 3;
    },
    closeMainDatabase: () => record('db:main'),
    closeUserSettingsDatabase: () => record('db:user'),
    closeApiGenerationDatabase: () => record('db:api-generation'),
    scheduleTimeout: (callback, delayMs) => {
      const timer: FakeTimer = { callback, delayMs, unrefCount: 0 };
      timers.push(timer);
      return {
        unref: () => {
          timer.unrefCount += 1;
        },
      };
    },
    processExit: (code) => record(`exit:${code}`),
    ...overrides,
  };
}

function createImmediateCloseServer(events: string[]): GracefulShutdownServer {
  return {
    close(callback) {
      events.push('http:close');
      callback?.();
      return this;
    },
    closeIdleConnections() {
      events.push('http:close-idle');
    },
    closeAllConnections() {
      events.push('http:close-all');
    },
  };
}

async function waitForTimer(timers: FakeTimer[], delayMs: number): Promise<FakeTimer> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const timer = timers.find((candidate) => candidate.delayMs === delayMs);
    if (timer) return timer;
    await Promise.resolve();
  }
  throw new Error(`Timer ${delayMs}ms was not scheduled`);
}

async function runScenario(options: ScenarioOptions) {
  const events: string[] = [];
  const timers: FakeTimer[] = [];
  const logMessages: string[] = [];
  const dependencies = createFakeDependencies(events, timers);
  const logger = {
    log: (...args: unknown[]) => logMessages.push(String(args[0])),
    warn: (...args: unknown[]) => logMessages.push(String(args[0])),
    error: (...args: unknown[]) => logMessages.push(String(args[0])),
  };
  const shutdown = createGracefulShutdownCoordinator({
    server: createImmediateCloseServer(events),
    isSafeSmokeMode: options.isSafeSmokeMode,
    shouldOwnTempFileLifecycle: options.shouldOwnTempFileLifecycle,
    dependencies,
    logger,
  });

  const firstSignal = shutdown('SIGTERM');
  const duplicateSignal = options.sendDuplicateSignal ? shutdown('SIGINT') : Promise.resolve();
  await Promise.all([firstSignal, duplicateSignal]);

  return { events, timers, logMessages, shutdown };
}

async function verifyFullShutdownOrderAndIdempotency() {
  const result = await runScenario({
    isSafeSmokeMode: false,
    shouldOwnTempFileLifecycle: true,
    sendDuplicateSignal: true,
  });

  assert.deepEqual(result.events, [
    'sse',
    'http:close',
    'http:close-idle',
    'http:close-all',
    'watcher:file',
    'watcher:custom-node',
    'scheduler:auto-scan',
    'scheduler:auto-tag',
    'scheduler:temp-image',
    'scheduler:history-cleanup',
    'temp:cleanup',
    'tagger',
    'job-tracker',
    'runtime-jobs',
    'db:main',
    'db:user',
    'db:api-generation',
    'exit:0',
  ]);
  assert.deepEqual(
    result.timers.map((timer) => timer.delayMs),
    [SHUTDOWN_FORCE_EXIT_TIMEOUT_MS, SHUTDOWN_DRAIN_TIMEOUT_MS],
    'shutdown must retain the 10s force-exit guard and 3s HTTP drain bound',
  );
  assert.ok(result.timers.every((timer) => timer.unrefCount === 1), 'every shutdown timer must be unrefed exactly once');
  assert.equal(
    result.logMessages.filter((message) => message.includes('shutdown is already in progress')).length,
    1,
    'a duplicate signal must be ignored after the first coordinator run claims shutdown ownership',
  );
}

async function verifyDrainAndForceTimeoutCallbacks() {
  const events: string[] = [];
  const timers: FakeTimer[] = [];
  const dependencies = createFakeDependencies(events, timers);
  const server: GracefulShutdownServer = {
    close() {
      events.push('http:close-pending');
      return this;
    },
    closeIdleConnections: () => events.push('http:close-idle'),
    closeAllConnections: () => events.push('http:close-all'),
  };
  const shutdown = createGracefulShutdownCoordinator({
    server,
    isSafeSmokeMode: false,
    shouldOwnTempFileLifecycle: true,
    dependencies,
    logger: {
      log: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  });

  const shutdownPromise = shutdown('SIGTERM');
  const forceTimer = await waitForTimer(timers, SHUTDOWN_FORCE_EXIT_TIMEOUT_MS);
  const drainTimer = await waitForTimer(timers, SHUTDOWN_DRAIN_TIMEOUT_MS);
  assert.equal(forceTimer.unrefCount, 1, 'force-exit timer must be unrefed');
  assert.equal(drainTimer.unrefCount, 1, 'HTTP drain timer must be unrefed');

  forceTimer.callback();
  assert.equal(events.at(-1), 'exit:1', 'the 10s timeout callback must force a failing process exit');
  drainTimer.callback();
  await shutdownPromise;

  assert.ok(events.indexOf('http:close-all') < events.indexOf('watcher:file'), 'the 3s drain timeout must close remaining sockets before service cleanup');
  assert.ok(events.includes('db:api-generation'), 'drain timeout fallback must continue through final database cleanup');
}

async function verifyServerCloseErrorsStayIsolated() {
  const events: string[] = [];
  const timers: FakeTimer[] = [];
  const warnings: string[] = [];
  const dependencies = createFakeDependencies(events, timers);
  const server: GracefulShutdownServer = {
    close() {
      events.push('http:close:throw');
      throw new Error('close failed');
    },
    closeIdleConnections() {
      events.push('http:close-idle:throw');
      throw new Error('close idle failed');
    },
    closeAllConnections() {
      events.push('http:close-all:throw');
      throw new Error('close all failed');
    },
  };
  const shutdown = createGracefulShutdownCoordinator({
    server,
    isSafeSmokeMode: false,
    shouldOwnTempFileLifecycle: true,
    dependencies,
    logger: {
      log: () => undefined,
      warn: (...args: unknown[]) => warnings.push(String(args[0])),
      error: () => undefined,
    },
  });

  await shutdown('SIGTERM');

  assert.deepEqual(events.slice(0, 4), ['sse', 'http:close:throw', 'http:close-idle:throw', 'http:close-all:throw']);
  assert.ok(events.includes('watcher:file') && events.includes('db:api-generation') && events.includes('exit:0'));
  assert.deepEqual(warnings.slice(0, 3), [
    '⚠️  Error closing HTTP server:',
    '⚠️  Error closing idle HTTP connections:',
    '⚠️  Error closing remaining HTTP connections:',
  ]);
}

async function verifySafeSmokeBranch() {
  const result = await runScenario({
    isSafeSmokeMode: true,
    shouldOwnTempFileLifecycle: true,
  });

  assert.deepEqual(result.events, [
    'sse',
    'http:close',
    'http:close-idle',
    'http:close-all',
    'temp:cleanup',
    'job-tracker',
    'runtime-jobs',
    'db:main',
    'db:user',
    'db:api-generation',
    'exit:0',
  ]);
}

async function verifyApiRoleTempOwnershipBranch() {
  const result = await runScenario({
    isSafeSmokeMode: false,
    shouldOwnTempFileLifecycle: false,
  });

  assert.ok(!result.events.includes('temp:cleanup'), 'the API role must not clean shared temp/canvas files');
  assert.ok(result.events.includes('watcher:file'), 'role ownership must not change the existing non-smoke stop calls');
  assert.ok(result.events.includes('tagger'), 'role ownership must not change the existing non-smoke daemon stop call');
  assert.ok(result.events.indexOf('runtime-jobs') < result.events.indexOf('db:user'));
}

async function verifySignalRegistration() {
  const listeners = new Map<string, () => void>();
  const shutdownSignals: string[] = [];
  registerGracefulShutdownSignalHandlers(
    async (signal) => {
      shutdownSignals.push(signal);
    },
    {
      on: (signal, listener) => {
        listeners.set(signal, listener);
      },
    },
  );

  assert.deepEqual([...listeners.keys()], ['SIGTERM', 'SIGINT']);
  listeners.get('SIGTERM')?.();
  listeners.get('SIGINT')?.();
  await Promise.resolve();
  assert.deepEqual(shutdownSignals, ['SIGTERM', 'SIGINT'], 'each signal listener must forward its own signal name');
}

function createNamedHandler(name: string, labels: Map<RequestHandler, string>): RequestHandler {
  const handler: RequestHandler = (_req, _res, next) => next();
  labels.set(handler, name);
  return handler;
}

async function verifyMiddlewareAndBootstrapAssemblyOrder() {
  const installed: string[] = [];
  const labels = new Map<RequestHandler, string>();
  const rateLimitOptions: Array<Parameters<AppMiddlewareDependencies['createRateLimiter']>[0]> = [];
  const app = {
    set: (key: string, value: unknown) => {
      installed.push(`set:${key}:${String(value)}`);
      return app;
    },
    use: (...args: unknown[]) => {
      const path = typeof args[0] === 'string' ? args[0] : null;
      const handler = (path ? args[1] : args[0]) as RequestHandler;
      const fallbackLabel = installed.filter((entry) => entry.startsWith('use:')).length === 0 ? 'nonce' : 'unknown';
      installed.push(`use:${path ? `${path}:` : ''}${labels.get(handler) ?? fallbackLabel}`);
      return app;
    },
  } as unknown as Express;
  let limiterIndex = 0;
  const limiterNames = ['api-limiter', 'upload-limiter', 'read-only-limiter'];
  const dependencies: AppMiddlewareDependencies = {
    createBodyParsers: () => ({
      json: createNamedHandler('json-parser', labels),
      urlencoded: createNamedHandler('urlencoded-parser', labels),
    }),
    createCompression: () => createNamedHandler('compression', labels),
    createCors: () => createNamedHandler('cors', labels),
    createHelmet: () => createNamedHandler('helmet', labels),
    createRateLimiter: (options) => {
      rateLimitOptions.push(options);
      const handler = createNamedHandler(limiterNames[limiterIndex] ?? `limiter-${limiterIndex}`, labels);
      limiterIndex += 1;
      return handler;
    },
    defaultCompressionFilter: () => true,
    log: () => undefined,
    randomNonce: () => 'test-nonce',
    resolveBodyLimitsMb: () => ({ default: 5, bulk: 25, media: 50 }),
  };
  const middleware = configureAppMiddleware(app, {}, dependencies);
  const sessionHandler = createNamedHandler('session', labels);

  const assembly = await assembleSessionApiRoutes({
    app,
    apiLimiter: middleware.apiLimiter,
    initializeSession: () => {
      app.use(sessionHandler);
    },
    beforeRoutes: () => {
      installed.push('before-routes');
      return 'custom-node-sync';
    },
    registerRoutes: () => {
      installed.push('routes');
      return 'registered';
    },
  });

  assert.deepEqual(installed, [
    'set:trust proxy:false',
    'use:nonce',
    'use:helmet',
    'use:cors',
    'use:compression',
    'use:json-parser',
    'use:urlencoded-parser',
    'use:session',
    'use:/api:api-limiter',
    'before-routes',
    'routes',
  ]);
  assert.deepEqual(assembly, { beforeRoutesResult: 'custom-node-sync', routeRegistration: 'registered' });

  const apiSkip = rateLimitOptions[0]?.skip as ((request: unknown) => boolean | Promise<boolean>) | undefined;
  assert.equal(typeof apiSkip, 'function');
  assert.equal(await apiSkip?.({ originalUrl: '/api/images', session: { accountType: 'admin' } }), true, 'admins must bypass the API limiter');
  assert.equal(await apiSkip?.({ originalUrl: '/api/events/runtime', session: {} }), true, 'runtime SSE reconnects must bypass the API limiter');
  assert.equal(await apiSkip?.({ originalUrl: '/api/images', session: {} }), false, 'ordinary API requests must remain rate limited');
}

async function main() {
  await verifyFullShutdownOrderAndIdempotency();
  await verifyDrainAndForceTimeoutCallbacks();
  await verifyServerCloseErrorsStayIsolated();
  await verifySafeSmokeBranch();
  await verifyApiRoleTempOwnershipBranch();
  await verifySignalRegistration();
  await verifyMiddlewareAndBootstrapAssemblyOrder();
  console.log('✅ Graceful shutdown and middleware lifecycle contracts verified');
}

void main();
