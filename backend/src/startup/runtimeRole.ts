export type RuntimeSideEffectRole = 'all' | 'api' | 'worker';

export function normalizeRuntimeSideEffectRole(value?: string | null): RuntimeSideEffectRole | null {
  const normalized = value?.trim().toLowerCase();

  if (normalized === 'all' || normalized === 'api' || normalized === 'worker') {
    return normalized;
  }

  return null;
}

export function resolveRuntimeSideEffectRole(env: NodeJS.ProcessEnv = process.env): RuntimeSideEffectRole {
  return normalizeRuntimeSideEffectRole(env.CONAI_RUNTIME_ROLE || env.CONAI_SIDE_EFFECT_ROLE) ?? 'all';
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

