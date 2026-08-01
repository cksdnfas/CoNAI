import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 그룹 재매칭 잡 계약.
 *
 * 실행 위치(별도 Node 프로세스)와 "HTTP 라우트가 재매칭을 인라인으로 돌리지 않는다" 는 규칙은
 * 이관 전과 동일하다. 달라진 것은 상태 저장소뿐이라, 예전에 temp JSON 파일 / spawn / 전용
 * runtime role 을 고정하던 assert 들은 러너 기준으로 옮겨졌다.
 */

const projectRoot = path.resolve(__dirname, '../../..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

const groupRoutes = readSource('backend/src/routes/groups.mutation.routes.ts');
const autoFolderRoutes = readSource('backend/src/routes/autoFolderGroups.ts');
const jobService = readSource('backend/src/services/groupRematchJobService.ts');
const jobHandlers = readSource('backend/src/services/runtimeJobs/handlers/groupRematchHandlers.ts');
const jobRunner = readSource('backend/src/services/runtimeJobs/runtimeJobRunner.ts');

/* ------------------------------------------------------------------ *
 * 라우트 규약 (이관 전과 동일한 의도)
 * ------------------------------------------------------------------ */

assert.match(
  groupRoutes,
  /router\.get\('\/auto-collect-jobs\/:jobId'/,
  'group rematch jobs must expose a polling route',
);
assert.match(
  groupRoutes,
  /GroupRematchJobService\.startJobProcess\('group-auto-collect'/,
  'single-group rematch route must start a background job',
);
assert.match(
  groupRoutes,
  /GroupRematchJobService\.startJobProcess\('all-auto-collect'/,
  'all-group rematch route must start a background job',
);
assert.doesNotMatch(
  groupRoutes,
  /await AutoCollectionService\.runAutoCollectionForGroup/,
  'group rematch HTTP routes must not run synchronous DB rematch work inline',
);

assert.match(
  autoFolderRoutes,
  /GroupRematchJobService\.startJobProcess\('auto-folder-rebuild'/,
  'auto-folder rebuild route must start a background job',
);
assert.doesNotMatch(
  autoFolderRoutes,
  /await AutoFolderGroupService\.rebuildAllFolderGroups\(\)/,
  'auto-folder rebuild HTTP route must not run synchronous DB rebuild work inline',
);

/* ------------------------------------------------------------------ *
 * 상태 저장소 — temp JSON 파일에서 runtime_jobs 테이블로 이동했다.
 * ------------------------------------------------------------------ */

assert.match(
  jobService,
  /RuntimeJobRunner\.start\(/,
  'group rematch jobs must be started through the shared runtime job runner',
);
assert.match(
  jobService,
  /RuntimeJobStore\.get\(/,
  'group rematch job status must be read from the durable runtime job store',
);
assert.doesNotMatch(
  jobService,
  /runtimePaths\.tempDir/,
  'group rematch job status must not live in temp files: non-atomic writes broke polling mid-write',
);
assert.doesNotMatch(
  jobService,
  /spawn\(|writeFileSync|readdirSync/,
  'group rematch job bookkeeping must be delegated to the runner, not reimplemented with file/process plumbing',
);
assert.match(
  jobService,
  /function toLegacyStatus[\s\S]*?status === 'cancelled'/,
  'the legacy adapter must fold the new cancelled status into a terminal legacy status, or old pollers wait forever',
);

/* ------------------------------------------------------------------ *
 * 실행 위치 — 여전히 별도 Node 프로세스이고, 전용 runtime role 로 뜬다.
 * ------------------------------------------------------------------ */

assert.match(
  jobHandlers,
  /execution: 'subprocess'/,
  'group rematch jobs must keep running in a separate Node process',
);
assert.match(
  jobRunner,
  /spawn\(/,
  'the runner must own the child process spawn for subprocess jobs',
);
assert.match(
  jobRunner,
  /CONAI_RUNTIME_ROLE:\s*'runtime-job'/,
  'runtime job child processes must use a distinct runtime role',
);

/* ------------------------------------------------------------------ *
 * 실행 로직 소유 + 진행률/완료 보고
 * ------------------------------------------------------------------ */

assert.match(
  jobHandlers,
  /AutoCollectionService\.runAutoCollectionForGroup/,
  'group rematch handlers must own auto-collection execution',
);
assert.match(
  jobHandlers,
  /AutoFolderGroupService\.rebuildAllFolderGroups/,
  'group rematch handlers must own auto-folder rebuild execution',
);
assert.match(
  jobHandlers,
  /ctx\.report\(|ctx\.flush\(/,
  'group rematch handlers must publish progress',
);
assert.match(
  jobRunner,
  /RuntimeJobStore\.markCompleted\(/,
  'the runner must publish completion for every job it executes',
);

/* ------------------------------------------------------------------ *
 * 신규: 취소 가능해야 한다. all-auto-collect 는 수십 분이 걸릴 수 있다.
 * ------------------------------------------------------------------ */

assert.match(
  jobHandlers,
  /ctx\.throwIfCancelled\(\)/,
  'group rematch handlers must expose a cancellation checkpoint',
);

console.log('✅ Group rematch job contracts verified');
