import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Response } from 'express';
import { RuntimeEventBroadcaster } from '../services/runtime-events/runtimeEventBroadcaster';
import { publishRuntimeEvent, resetRuntimeEventBusForTests } from '../services/runtime-events/runtimeEventBus';
import { isRuntimeEventStreamEnabled } from '../routes/events/event-stream.routes';
import { RUNTIME_EVENT_TOPICS } from '../types/runtimeEvents';

const backendSrc = path.resolve(__dirname, '..');

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.join(backendSrc, ...segments), 'utf8');
}

const streamRouteSource = readSource('routes', 'events', 'event-stream.routes.ts');
const streamAuthSource = readSource('routes', 'events', 'event-stream-auth.ts');
const broadcasterSource = readSource('services', 'runtime-events', 'runtimeEventBroadcaster.ts');
const busSource = readSource('services', 'runtime-events', 'runtimeEventBus.ts');
const indexSource = readSource('index.ts');
const registerAppRoutesSource = readSource('startup', 'registerAppRoutes.ts');
const userSettingsSchemaSource = readSource('database', 'userSettingsSchema.ts');
const queueJobExecutorsSource = readSource('services', 'generation-queue', 'queueJobExecutors.ts');

/* ------------------------------------------------------------------ *
 * RK-1: SSE 전송 계약 (헤더 + 소켓 타임아웃 해제 + 즉시 플러시)
 * ------------------------------------------------------------------ */

for (const requiredFragment of [
  'text/event-stream',
  'no-transform',
  'X-Accel-Buffering',
  'res.flushHeaders()',
  'res.socket?.setTimeout(0)',
]) {
  assert.ok(
    streamRouteSource.includes(requiredFragment),
    `event stream route must keep "${requiredFragment}" so SSE survives compression, proxies, and server.setTimeout(60000)`,
  );
}

assert.ok(
  /server\.setTimeout\?\.\(60000\)/.test(indexSource),
  'index.ts still applies a 60s server timeout, so the stream route must keep neutralizing it per socket',
);

/* ------------------------------------------------------------------ *
 * RK-2: 셧다운 순서 — 스트림을 먼저 닫아야 server.close() 가 drain 된다.
 * ------------------------------------------------------------------ */

const broadcasterShutdownIndex = indexSource.indexOf('RuntimeEventBroadcaster.shutdown()');
const serverCloseIndex = indexSource.indexOf('activeServer.close(');
assert.ok(broadcasterShutdownIndex > 0, 'index.ts must close runtime event streams during shutdown');
assert.ok(serverCloseIndex > 0, 'index.ts must still close the HTTP server during shutdown');
assert.ok(
  broadcasterShutdownIndex < serverCloseIndex,
  'RuntimeEventBroadcaster.shutdown() must run before activeServer.close(), otherwise open SSE sockets block the drain',
);

/* ------------------------------------------------------------------ *
 * RK-3: 장수명 스트림은 세션을 절대 쓰지 않는다.
 * ------------------------------------------------------------------ */

/** 주석은 금지 규칙을 설명하기 위해 그 이름을 언급하므로, 코드만 남기고 검사한다. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

for (const [label, source] of [
  ['event-stream.routes.ts', stripComments(streamRouteSource)],
  ['event-stream-auth.ts', stripComments(streamAuthSource)],
] as const) {
  for (const bannedFragment of ['requirePermission', 'optionalAuth', 'requireAuth', 'setTrustedBootstrapSession']) {
    assert.ok(
      !source.includes(bannedFragment),
      `${label} must not use ${bannedFragment}: session-mutating auth on a 30-minute stream reverts logouts at stream end`,
    );
  }

  assert.ok(
    !/req\.session(?:\?)?\.[A-Za-z_$][\w$]*\s*=(?!=)/.test(source),
    `${label} must never assign to req.session, or express-session rewrites a stale session row when the stream closes`,
  );
  assert.ok(
    !/delete\s+req\.session\./.test(source),
    `${label} must never delete session fields`,
  );
}

assert.ok(
  registerAppRoutesSource.includes("app.use('/api/events', runtimeEventStreamRoutes)"),
  'registerAppRoutes must mount the event stream without the shared session-mutating auth middlewares',
);
assert.ok(
  /const isRuntimeEventStreamRequest[\s\S]*?originalUrl\.startsWith\('\/api\/events\/'\)/.test(indexSource),
  'index.ts must exclude the stream path from the shared API rate limiter budget',
);

/* ------------------------------------------------------------------ *
 * Wave 2 #4 이후 결정: outbox 테이블도, DB 폴링 루프도 만들지 않는다.
 * ------------------------------------------------------------------ */

assert.ok(
  !userSettingsSchemaSource.includes('runtime_events'),
  'the SSE channel must not introduce a runtime_events outbox table; the bus is in-process only',
);
assert.ok(
  !fs.existsSync(path.join(backendSrc, 'services', 'runtime-events', 'runtimeEventOutbox.ts')),
  'runtimeEventOutbox.ts must not exist: the single-process runtime needs no outbox',
);
for (const [label, source] of [
  ['runtimeEventBus.ts', busSource],
  ['runtimeEventBroadcaster.ts', broadcasterSource],
] as const) {
  assert.ok(
    !/getUserSettingsDb|db\.prepare|SELECT |INSERT INTO/.test(source),
    `${label} must not touch the database: adding DB polling to the item that removes polling defeats its purpose`,
  );
}
assert.ok(
  (broadcasterSource.match(/setInterval\(/g) ?? []).length === 1,
  'the broadcaster may only run the heartbeat timer, never a drain/poll loop',
);
assert.ok(
  /CONAI_ALLOW_SPLIT_RUNTIME/.test(busSource),
  'runtimeEventBus.ts must document that opt-in split runtimes do not receive cross-process events',
);

/* ------------------------------------------------------------------ *
 * emit 커버리지 — 발행 지점이 조용히 사라지는 회귀를 막는다.
 * ------------------------------------------------------------------ */

const emitSiteFiles: Array<[string, string[]]> = [
  ['services/generationQueueService.ts', ['queue.job.status', 'queue.job.cancel-requested', 'queue.job.created']],
  ['routes/generation-queue/queue-action-routes.ts', ['queue.job.created']],
  ['routes/public-workflows.routes.ts', ['queue.job.created']],
  ['services/graph-workflow-executor/execute-comfy.ts', ['queue.job.created']],
  ['services/graph-workflow-executor/execute-nai.ts', ['queue.job.created']],
  ['services/graph-workflow-executor/system-codex-operations.ts', ['queue.job.created']],
  ['models/GenerationHistory.ts', ['history.record.created', 'history.record.status']],
  ['models/GraphWorkflowSchedule.ts', ['publishGraphScheduleEvent']],
  ['models/GraphExecution.ts', ['publishGraphExecutionEvent']],
];

for (const [relativePath, requiredFragments] of emitSiteFiles) {
  const source = readSource(...relativePath.split('/'));
  assert.ok(
    /publish(?:RuntimeEvent|QueueJobEvent|HistoryRecordEvent|GraphScheduleEvent|GraphExecutionEvent)\(/.test(source),
    `${relativePath} must publish at least one runtime event`,
  );

  for (const fragment of requiredFragments) {
    assert.ok(source.includes(fragment), `${relativePath} must keep the "${fragment}" emit`);
  }
}

// E1 이 큐 전이를 전부 덮는다는 전제: 실행기는 자체 상태 쓰기를 하지 않고 transitionJob 을 경유한다.
assert.ok(
  (queueJobExecutorsSource.match(/context\.transitionJob\(/g) ?? []).length >= 5,
  'queue job executors must keep routing every transition through context.transitionJob so the E1 emit covers them',
);
assert.ok(
  !/GenerationQueueModel\.updateIfCurrentStatus\(/.test(queueJobExecutorsSource),
  'queue job executors must not bypass transitionJob with direct status writes',
);

/* ------------------------------------------------------------------ *
 * 킬 스위치
 * ------------------------------------------------------------------ */

assert.equal(isRuntimeEventStreamEnabled({}), true);
assert.equal(isRuntimeEventStreamEnabled({ CONAI_RUNTIME_EVENTS: 'off' }), false);
assert.equal(isRuntimeEventStreamEnabled({ CONAI_RUNTIME_EVENTS: ' OFF ' }), false);
assert.equal(isRuntimeEventStreamEnabled({ CONAI_RUNTIME_EVENTS: 'on' }), true);

/* ------------------------------------------------------------------ *
 * 인메모리 스모크 — 발행/가시성/토픽 필터/재생 버퍼
 * ------------------------------------------------------------------ */

type CapturedStream = { frames: string[]; res: Response };

function createCapturedResponse(): CapturedStream {
  const frames: string[] = [];
  const res = {
    writableEnded: false,
    write(chunk: string) {
      frames.push(chunk);
      return true;
    },
    end() {
      (this as unknown as { writableEnded: boolean }).writableEnded = true;
    },
  };

  return { frames, res: res as unknown as Response };
}

function parseEventNames(frames: string[]): string[] {
  return frames
    .join('')
    .split('\n')
    .filter((line) => line.startsWith('event: '))
    .map((line) => line.slice('event: '.length));
}

resetRuntimeEventBusForTests();
RuntimeEventBroadcaster.start();

const ownerStream = createCapturedResponse();
const otherStream = createCapturedResponse();
const adminStream = createCapturedResponse();
const scheduleOnlyStream = createCapturedResponse();

const ownerSubscription = RuntimeEventBroadcaster.register({
  res: ownerStream.res,
  accountId: 7,
  isAdmin: false,
  topics: [...RUNTIME_EVENT_TOPICS],
  resumeCursor: null,
  revalidateAccess: () => ({ ok: true }),
});
const otherSubscription = RuntimeEventBroadcaster.register({
  res: otherStream.res,
  accountId: 9,
  isAdmin: false,
  topics: [...RUNTIME_EVENT_TOPICS],
  resumeCursor: null,
  revalidateAccess: () => ({ ok: true }),
});
const adminSubscription = RuntimeEventBroadcaster.register({
  res: adminStream.res,
  accountId: 1,
  isAdmin: true,
  topics: [...RUNTIME_EVENT_TOPICS],
  resumeCursor: null,
  revalidateAccess: () => ({ ok: true }),
});
const scheduleOnlySubscription = RuntimeEventBroadcaster.register({
  res: scheduleOnlyStream.res,
  accountId: null,
  isAdmin: true,
  topics: ['graph-schedule'],
  resumeCursor: null,
  revalidateAccess: () => ({ ok: true }),
});

assert.deepEqual(parseEventNames(ownerStream.frames), ['hello'], 'a new subscriber must receive exactly one hello frame');
assert.equal(RuntimeEventBroadcaster.getStatus().subscriber_count, 4);

const accountEventId = publishRuntimeEvent({
  name: 'queue.job.status',
  topic: 'generation-queue',
  visibility: 'account',
  accountId: 7,
  payload: { job_id: 42 },
});

assert.ok(
  ownerStream.frames.join('').includes('event: queue.job.status'),
  'account-scoped events must reach the owning account',
);
assert.ok(
  !otherStream.frames.join('').includes('event: queue.job.status'),
  'account-scoped events must never leak to another account',
);
assert.ok(
  adminStream.frames.join('').includes('event: queue.job.status'),
  'admins must still see every account-scoped event, matching the existing queue list visibility',
);
assert.ok(
  !scheduleOnlyStream.frames.join('').includes('event: queue.job.status'),
  'subscribers must only receive the topics they asked for',
);
assert.ok(
  ownerStream.frames.join('').includes(`id: ${accountEventId}`),
  'data frames must carry the sequence id used as the SSE resume cursor',
);

publishRuntimeEvent({
  name: 'graph.schedule.changed',
  topic: 'graph-schedule',
  visibility: 'all',
  payload: { schedule_id: 3 },
});
assert.ok(
  scheduleOnlyStream.frames.join('').includes('event: graph.schedule.changed'),
  'visibility=all events must reach every subscriber of the topic',
);

// 재연결 재생: 커서 이후 이벤트만, 그리고 가시성 규칙을 유지한 채로 다시 흘러야 한다.
const resumeStream = createCapturedResponse();
const resumeSubscription = RuntimeEventBroadcaster.register({
  res: resumeStream.res,
  accountId: 7,
  isAdmin: false,
  topics: [...RUNTIME_EVENT_TOPICS],
  resumeCursor: accountEventId - 1,
  revalidateAccess: () => ({ ok: true }),
});
assert.deepEqual(
  parseEventNames(resumeStream.frames),
  ['hello', 'queue.job.status', 'graph.schedule.changed'],
  'a resumed stream must replay only the events after its cursor',
);

RuntimeEventBroadcaster.unregister(resumeSubscription.id);
RuntimeEventBroadcaster.unregister(otherSubscription.id);
RuntimeEventBroadcaster.unregister(adminSubscription.id);
RuntimeEventBroadcaster.unregister(scheduleOnlySubscription.id);

// 재생 버퍼가 넘치면 오래된 커서는 되돌릴 수 없으므로 전체 무효화를 요청해야 한다.
for (let index = 0; index < 600; index += 1) {
  publishRuntimeEvent({ name: 'queue.job.status', topic: 'generation-queue', payload: { job_id: index } });
}

const expiredStream = createCapturedResponse();
const expiredSubscription = RuntimeEventBroadcaster.register({
  res: expiredStream.res,
  accountId: 7,
  isAdmin: false,
  topics: [...RUNTIME_EVENT_TOPICS],
  resumeCursor: 1,
  revalidateAccess: () => ({ ok: true }),
});
assert.deepEqual(
  parseEventNames(expiredStream.frames),
  ['hello', 'reset'],
  'an unreplayable cursor must trigger a reset instead of a partial replay',
);
assert.ok(
  expiredStream.frames.join('').includes('"reason":"cursor-expired"'),
  'the reset reason must tell the client its cursor fell out of the replay window',
);
RuntimeEventBroadcaster.unregister(expiredSubscription.id);

assert.equal(RuntimeEventBroadcaster.getStatus().subscriber_count, 1);
assert.ok(ownerSubscription.id.length > 0);

const closedCount = RuntimeEventBroadcaster.shutdown();
assert.equal(closedCount, 1, 'shutdown must close every remaining stream');
assert.ok(
  ownerStream.frames.join('').includes('"reason":"server-restart"'),
  'shutdown must tell live clients to re-sync after the restart',
);
assert.equal(RuntimeEventBroadcaster.getStatus().subscriber_count, 0);

// 발행이 절대 throw 하지 않는다: 이벤트 실패가 큐 전이를 깨뜨려서는 안 된다.
const circularPayload: Record<string, unknown> = {};
circularPayload.self = circularPayload;
RuntimeEventBroadcaster.start();
const survivorStream = createCapturedResponse();
RuntimeEventBroadcaster.register({
  res: survivorStream.res,
  accountId: null,
  isAdmin: true,
  topics: [...RUNTIME_EVENT_TOPICS],
  resumeCursor: null,
  revalidateAccess: () => ({ ok: true }),
});
publishRuntimeEvent({ name: 'queue.job.created', topic: 'generation-queue', payload: circularPayload });
RuntimeEventBroadcaster.shutdown();
resetRuntimeEventBusForTests();

console.log('Runtime event stream contracts verified.');
