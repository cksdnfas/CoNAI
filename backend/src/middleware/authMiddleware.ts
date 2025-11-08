import { Request, Response, NextFunction } from 'express';
import { AuthCredentials } from '../models/AuthCredentials';

/**
 * Require authentication middleware
 * Returns 401 if not authenticated
 */
export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  if (req.session?.authenticated === true) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

/**
 * Optional authentication middleware
 * - If auth credentials are NOT configured: Allow access freely
 * - If auth credentials ARE configured: Require authentication
 */
export const optionalAuth = (req: Request, res: Response, next: NextFunction): void => {
  const hasCredentials = AuthCredentials.exists();

  if (!hasCredentials) {
    // No auth configured yet - allow free access
    next();
  } else {
    // Auth is configured - require authentication
    if (req.session?.authenticated === true) {
      next();
    } else {
      res.status(401).json({ error: 'Unauthorized' });
    }
  }
};
