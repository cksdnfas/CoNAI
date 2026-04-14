import { Request, Response, NextFunction } from 'express';
import { AuthAccount } from '../models/AuthAccount';
import { hasConfiguredAuth } from '../routes/auth-route-helpers';
import { AuthAccessControlService } from '../services/authAccessControlService';

/**
 * Require authentication middleware.
 * Returns 401 if not authenticated.
 */
export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  if (req.session?.authenticated === true) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

/**
 * Require an authenticated admin account.
 * Returns 403 when the session is not an admin.
 */
export const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (req.session?.authenticated !== true) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (req.session.accountType === 'admin') {
    next();
    return;
  }

  const accountId = req.session.accountId;
  if (typeof accountId === 'number') {
    const account = AuthAccount.findById(accountId);
    if (account?.account_type === 'admin' && account.status === 'active') {
      req.session.accountType = 'admin';
      req.session.username = account.username;
      next();
      return;
    }
  }

  res.status(403).json({ error: 'Forbidden' });
};

/** Refresh cached access data for the current authenticated account session. */
function refreshSessionAccess(req: Request): string[] {
  const accountId = req.session?.accountId;
  if (typeof accountId !== 'number') {
    return req.session?.permissionKeys ?? [];
  }

  const resolvedAccess = AuthAccessControlService.resolveForAccountId(accountId);
  req.session.groupKeys = resolvedAccess.groupKeys;
  req.session.permissionKeys = resolvedAccess.permissionKeys;
  return resolvedAccess.permissionKeys;
}

/** Resolve the current request as bootstrap, authenticated, or anonymous access. */
function resolveRequestPermissionKeys(req: Request): { permissionKeys: string[]; authenticated: boolean } {
  const hasCredentials = hasConfiguredAuth();

  if (!hasCredentials) {
    const resolvedAccess = AuthAccessControlService.resolveBootstrapAccess();
    req.session.groupKeys = resolvedAccess.groupKeys;
    req.session.permissionKeys = resolvedAccess.permissionKeys;
    return { permissionKeys: resolvedAccess.permissionKeys, authenticated: false };
  }

  if (req.session?.authenticated === true) {
    return { permissionKeys: refreshSessionAccess(req), authenticated: true };
  }

  const resolvedAccess = AuthAccessControlService.resolveForGroupKey('anonymous');
  req.session.groupKeys = resolvedAccess.groupKeys;
  req.session.permissionKeys = resolvedAccess.permissionKeys;
  return { permissionKeys: resolvedAccess.permissionKeys, authenticated: false };
}

/**
 * Require one resolved permission key for the current account.
 * Returns 403 when the authenticated session lacks the permission.
 */
export const requirePermission = (permissionKey: string) => (req: Request, res: Response, next: NextFunction): void => {
  const hasCredentials = hasConfiguredAuth();

  if (!hasCredentials) {
    const resolvedAccess = AuthAccessControlService.resolveBootstrapAccess();
    req.session.groupKeys = resolvedAccess.groupKeys;
    req.session.permissionKeys = resolvedAccess.permissionKeys;

    if (resolvedAccess.permissionKeys.includes(permissionKey)) {
      next();
      return;
    }

    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  if (req.session?.authenticated !== true) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const permissionKeys = refreshSessionAccess(req);
  if (permissionKeys.includes(permissionKey)) {
    next();
    return;
  }

  res.status(403).json({ error: 'Forbidden' });
};

/**
 * Allow anonymous or bootstrap access when the resolved permission is present.
 * Returns 401 for unauthenticated requests without the permission.
 */
export const allowAnonymousPermission = (permissionKey: string) => (req: Request, res: Response, next: NextFunction): void => {
  const { permissionKeys, authenticated } = resolveRequestPermissionKeys(req);

  if (permissionKeys.includes(permissionKey)) {
    next();
    return;
  }

  if (authenticated) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  res.status(401).json({ error: 'Unauthorized' });
};

/**
 * Optional authentication middleware.
 * - If auth credentials are NOT configured: allow access freely.
 * - If auth credentials ARE configured: require authentication.
 */
export const optionalAuth = (req: Request, res: Response, next: NextFunction): void => {
  const hasCredentials = hasConfiguredAuth();

  if (!hasCredentials) {
    next();
    return;
  }

  if (req.session?.authenticated === true) {
    next();
    return;
  }

  res.status(401).json({ error: 'Unauthorized' });
};
