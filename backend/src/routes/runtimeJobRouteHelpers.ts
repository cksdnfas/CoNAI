import type { Request, Response } from 'express';
import { errorResponse, successResponse } from '@conai/shared';
import { RuntimeJobRunner } from '../services/runtimeJobs/runtimeJobRunner';
import { RuntimeJobConflictError } from '../services/runtimeJobs/runtimeJobStore';
import type { RuntimeJobKind } from '../types/runtimeJob';

/**
 * Start one runtime job from a route: 202 + the job record, 409 + the live job when its slot is taken.
 * Progress and the final result are read from `GET /api/jobs/:jobId`.
 */
export function respondWithStartedJob(
  req: Request,
  res: Response,
  kind: RuntimeJobKind,
  params: object,
  conflictMessage: string,
) {
  try {
    const job = RuntimeJobRunner.start(kind, params, {
      requestedByAccountId: typeof req.session?.accountId === 'number' ? req.session.accountId : null,
    });
    return res.status(202).json(successResponse(job));
  } catch (error) {
    if (error instanceof RuntimeJobConflictError) {
      return res.status(409).json({
        ...errorResponse(conflictMessage),
        code: 'JOB_ALREADY_RUNNING',
        data: error.liveJob,
      });
    }

    return res.status(500).json(errorResponse(error instanceof Error ? error.message : 'Failed to start job'));
  }
}
