import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Async handler wrapper for Express routes
 * Catches async errors and passes them to error handler middleware
 */
export const asyncHandler = (fn: RequestHandler): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/** Cancel request-owned work when its HTTP response is no longer wanted. */
export const cancellableAsyncHandler = (fn: (req: Request, res: Response, signal: AbortSignal) => unknown | Promise<unknown>): RequestHandler => asyncHandler(async (req, res) => {
  const controller = new AbortController();
  const abort = () => { if (!res.writableEnded) controller.abort(); };
  req.once('aborted', abort);
  res.once('close', abort);
  try { await fn(req, res, controller.signal); }
  finally { req.off('aborted', abort); res.off('close', abort); }
});
