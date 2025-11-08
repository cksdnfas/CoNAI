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
