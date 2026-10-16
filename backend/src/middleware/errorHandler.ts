import { Request, Response, NextFunction } from 'express';

export interface AppError extends Error {
  statusCode?: number;
  /** Service errors carry the HTTP status here; body-parser and http-errors set both fields. */
  status?: number | string;
  isOperational?: boolean;
}

/** The HTTP status an error asks for, from `statusCode` or a numeric `status`; anything outside 4xx/5xx means 500. */
function resolveErrorStatus(err: AppError): number {
  const candidate = typeof err.statusCode === 'number' ? err.statusCode : typeof err.status === 'number' ? err.status : NaN;
  return Number.isInteger(candidate) && candidate >= 400 && candidate <= 599 ? candidate : 500;
}

export const errorHandler = (
  err: AppError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  let error = { ...err };
  error.message = err.message;

  // Log error with full details
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error('❌ API Error:', req.method, req.path);
  console.error('Error Message:', err.message);
  console.error('Error Stack:', err.stack);
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  error.statusCode = resolveErrorStatus(err);

  // Multer error handling
  if (err.message?.includes('LIMIT_FILE_SIZE')) {
    error.message = 'File too large';
    error.statusCode = 400;
  }

  if (err.message?.includes('LIMIT_UNEXPECTED_FILE')) {
    error.message = 'Unexpected field';
    error.statusCode = 400;
  }

  // SQLite error handling
  if (err.message?.includes('SQLITE_CONSTRAINT')) {
    error.message = 'Database constraint violation';
    error.statusCode = 400;
  }

  // A streamed response that already started can only be cut off; Express's default handler does that.
  if (res.headersSent) {
    next(err);
    return;
  }

  res.status(error.statusCode).json({
    success: false,
    error: error.message || 'Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};
