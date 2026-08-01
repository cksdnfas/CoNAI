export type RuntimeSideEffectRole = 'all' | 'api' | 'worker';

export function normalizeRuntimeSideEffectRole(value?: string | null): RuntimeSideEffectRole | null {
  const normalized = value?.trim().toLowerCase();

  if (normalized === 'all' || normalized === 'api' || normalized === 'worker') {
    return normalized;
  }

  return null;
}

/** Report the split role the environment asked for, before any demotion is applied. */
export function requestedRuntimeSideEffectRole(env: NodeJS.ProcessEnv = process.env): RuntimeSideEffectRole {
  return normalizeRuntimeSideEffectRole(env.CONAI_RUNTIME_ROLE || env.CONAI_SIDE_EFFECT_ROLE) ?? 'all';
}

/** Check whether the operator explicitly opted into the unsupported split runtime. */
export function isSplitRuntimeOptIn(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.CONAI_ALLOW_SPLIT_RUNTIME?.trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

/**
 * Resolve the effective role. split roles (`api`/`worker`) are unsupported and demote to `all`
 * unless the operator opted in, so bypassing the launcher cannot resurrect the split topology.
 */
export function resolveRuntimeSideEffectRole(env: NodeJS.ProcessEnv = process.env): RuntimeSideEffectRole {
  const requested = requestedRuntimeSideEffectRole(env);

  if (requested === 'all' || isSplitRuntimeOptIn(env)) {
    return requested;
  }

  // 로그는 호출자(index.ts)가 남긴다. 이 함수는 순수하게 유지한다.
  return 'all';
}

/** Report whether the current env asked for a split role that was demoted to `all`. */
export function wasSplitRuntimeRoleDemoted(env: NodeJS.ProcessEnv = process.env): boolean {
  return requestedRuntimeSideEffectRole(env) !== 'all' && !isSplitRuntimeOptIn(env);
}

export function shouldServeHttpForRuntimeRole(
  runtimeRole: RuntimeSideEffectRole,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (runtimeRole !== 'worker') {
    return true;
  }

  const rawWorkerHttp = env.CONAI_WORKER_HTTP?.trim().toLowerCase();
  return rawWorkerHttp === 'true' || rawWorkerHttp === '1' || rawWorkerHttp === 'yes';
}

export function shouldSkipHttpServerForRuntimeRole(
  runtimeRole: RuntimeSideEffectRole,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return !shouldServeHttpForRuntimeRole(runtimeRole, env);
}

