import { closeDatabase } from '../database/init';
import { initializeUserSettingsDb, closeUserSettingsDb } from '../database/userSettingsDb';
import { RuntimeJobRunner, registerRuntimeJobHandlers } from '../services/runtimeJobs';

/**
 * `execution: 'subprocess'` 잡의 러너 스크립트.
 *
 * 부모가 `runtime_jobs` 에 잡 행을 이미 만들어 두었으므로, 이 프로세스는 job id 하나만 받아
 * 레지스트리에서 핸들러를 찾아 실행한다. 진행률/취소/완료는 모두 같은 테이블을 경유하므로
 * 예전처럼 부모와 파일로 상태를 주고받지 않는다.
 */

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) {
    return null;
  }
  return process.argv[index + 1] ?? null;
}

function requireJobId(): string {
  const jobId = readArg('--job-id') ?? process.env.CONAI_RUNTIME_JOB_ID ?? null;
  if (!jobId) {
    throw new Error('Missing required argument: --job-id');
  }
  return jobId;
}

async function main(): Promise<void> {
  const jobId = requireJobId();

  // 잡 상태 정본은 user.db 에 있다. 부모와 별개의 커넥션이지만 WAL 이라 동시 읽기/쓰기가 안전하다.
  initializeUserSettingsDb();
  registerRuntimeJobHandlers();

  try {
    await RuntimeJobRunner.runExisting(jobId);
  } finally {
    closeDatabase();
    closeUserSettingsDb();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
