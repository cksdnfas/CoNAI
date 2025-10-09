import { Request, Response, NextFunction } from 'express';

export interface AppError extends Error {
  statusCode?: number;
  status?: string;
  isOperational?: boolean;
}

export const errorHandler = (
  err: AppError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  let error = { ...err };
  error.message = err.message;

  // Log error
  console.error('Error:', err);

  // Default error
  error.statusCode = error.statusCode || 500;
  error.status = error.status || 'error';

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

  res.status(error.statusCode || 500).json({
    success: false,
    error: error.message || 'Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

export const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(fn(req, res, next)).catch(next);