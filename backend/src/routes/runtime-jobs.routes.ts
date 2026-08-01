import { Router, Request, Response } from 'express';
import { errorResponse, successResponse } from '@conai/shared';
import { asyncHandler } from '../middleware/asyncHandler';
import { routeParam } from './routeParam';
import { RuntimeJobRunner } from '../services/runtimeJobs/runtimeJobRunner';
import { RuntimeJobStore } from '../services/runtimeJobs/runtimeJobStore';
import { RUNTIME_JOB_KINDS, type RuntimeJobKind, type RuntimeJobStatus } from '../types/runtimeJob';

const router = Router();

const RUNTIME_JOB_STATUSES: readonly RuntimeJobStatus[] = ['queued', 'running', 'completed', 'failed', 'cancelled'];

/** Read the session account id without assuming an authenticated session exists. */
function resolveRequestAccountId(req: Request): number | null {
  const accountId = req.session?.accountId;
  return typeof accountId === 'number' ? accountId : null;
}

function isAdminRequest(req: Request): boolean {
  return req.session?.accountType === 'admin';
}

/**
 * 잡 조회/취소 접근 제어.
 *
 * 잡 시작 라우트의 권한(대량 삭제는 admin, 스캔은 optionalAuth)이 서로 다르므로,
 * 잡 레코드는 **시작한 계정 또는 admin** 에게만 연다. 계정 없이 시작된 잡
 * (인증 미구성 부트스트랩 모드 등)은 소유자를 특정할 수 없으므로 그대로 노출한다.
 */
function canAccessJob(req: Request, requestedByAccountId: number | null): boolean {
  if (requestedByAccountId === null || isAdminRequest(req)) {
    return true;
  }

  return resolveRequestAccountId(req) === requestedByAccountId;
}

function parseKindFilter(value: unknown): RuntimeJobKind | undefined {
  return typeof value === 'string' && (RUNTIME_JOB_KINDS as readonly string[]).includes(value)
    ? (value as RuntimeJobKind)
    : undefined;
}

function parseStatusFilter(value: unknown): RuntimeJobStatus[] | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  const requested = new Set(value.split(',').map((entry) => entry.trim()));
  const matched = RUNTIME_JOB_STATUSES.filter((status) => requested.has(status));
  return matched.length > 0 ? matched : undefined;
}

/**
 * GET /api/jobs
 * 잡 목록 조회 (kind / status / limit 필터)
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const jobs = RuntimeJobStore.list({
    kind: parseKindFilter(req.query.kind),
    status: parseStatusFilter(req.query.status),
    limit: Number(req.query.limit) || undefined,
    // 가시성 필터는 SQL 에서 끝낸다. 애플리케이션에서 걸러내면 limit 이 먼저 잘려 목록이 빈다.
    visibleToAccountId: isAdminRequest(req) ? undefined : resolveRequestAccountId(req),
  });

  return res.json(successResponse(jobs));
}));

/**
 * GET /api/jobs/:jobId
 * 잡 진행률 조회 — 이 라우트가 진행률의 **정본 계약**이다.
 */
router.get('/:jobId', asyncHandler(async (req: Request, res: Response) => {
  const jobId = routeParam(req.params.jobId);
  const ownership = RuntimeJobStore.getOwnership(jobId);

  if (!ownership) {
    return res.status(404).json(errorResponse('Job not found'));
  }

  if (!canAccessJob(req, ownership.requestedByAccountId)) {
    return res.status(403).json(errorResponse('Forbidden'));
  }

  const job = RuntimeJobStore.get(jobId);
  if (!job) {
    return res.status(404).json(errorResponse('Job not found'));
  }

  return res.json(successResponse(job));
}));

/**
 * POST /api/jobs/:jobId/cancel
 * 취소 요청 — DB 플래그를 먼저 쓰고, 이 프로세스가 실행 중이면 즉시 abort 한다.
 */
router.post('/:jobId/cancel', asyncHandler(async (req: Request, res: Response) => {
  const jobId = routeParam(req.params.jobId);
  const ownership = RuntimeJobStore.getOwnership(jobId);

  if (!ownership) {
    return res.status(404).json(errorResponse('Job not found'));
  }

  if (!canAccessJob(req, ownership.requestedByAccountId)) {
    return res.status(403).json(errorResponse('Forbidden'));
  }

  const current = RuntimeJobStore.get(jobId);
  if (current && current.status !== 'queued' && current.status !== 'running') {
    return res.status(409).json({
      ...errorResponse('이미 종료된 작업입니다'),
      code: 'JOB_ALREADY_FINISHED',
      data: current,
    });
  }

  const cancelled = RuntimeJobRunner.cancel(jobId);
  return res.status(202).json(successResponse(cancelled));
}));

export const runtimeJobRoutes = router;
