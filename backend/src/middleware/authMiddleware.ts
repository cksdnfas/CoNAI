import { Request, Response, NextFunction } from 'express';
import { AuthAccount } from '../models/AuthAccount';
import { hasConfiguredAuth, setTrustedBootstrapSession } from '../routes/auth-route-helpers';
import { AuthAccessControlService } from '../services/authAccessControlService';

const SESSION_ACCESS_CACHE_TTL_MS = 60_000;

/**
 * Require authentication middleware.
 * When local auth is not configured, treat the app as trusted personal/bootstrap mode.
 */
export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  if (!hasConfiguredAuth()) {
    setTrustedBootstrapSession(req, AuthAccessControlService.resolveBootstrapAccess());
    next();
    return;
  }

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
  if (!hasConfiguredAuth()) {
    setTrustedBootstrapSession(req, AuthAccessControlService.resolveBootstrapAccess());
    next();
    return;
  }

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

  const now = Date.now();
  const cachedPermissionKeys = req.session.permissionKeys;
  const cachedGroupKeys = req.session.groupKeys;
  const cacheUpdatedAt = req.session.accessCacheUpdatedAt;
  const isFreshSessionAccessCache = Array.isArray(cachedPermissionKeys)
    && Array.isArray(cachedGroupKeys)
    && req.session.accessCacheAccountId === accountId
    && typeof cacheUpdatedAt === 'number'
    && now - cacheUpdatedAt < SESSION_ACCESS_CACHE_TTL_MS;

  if (isFreshSessionAccessCache) {
    return cachedPermissionKeys;
  }

  const resolvedAccess = AuthAccessControlService.resolveForAccountId(accountId);
  req.session.groupKeys = resolvedAccess.groupKeys;
  req.session.permissionKeys = resolvedAccess.permissionKeys;
  req.session.accessCacheAccountId = accountId;
  req.session.accessCacheUpdatedAt = now;
  return resolvedAccess.permissionKeys;
}

/** Resolve the current request as bootstrap, authenticated, or anonymous access. */
function resolveRequestPermissionKeys(req: Request): { permissionKeys: string[]; authenticated: boolean } {
  const hasCredentials = hasConfiguredAuth();

  if (!hasCredentials) {
    const resolvedAccess = AuthAccessControlService.resolveBootstrapAccess();
    setTrustedBootstrapSession(req, resolvedAccess);
    return { permissionKeys: resolvedAccess.permissionKeys, authenticated: true };
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
    setTrustedBootstrapSession(req, resolvedAccess);

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
 * Allow anonymous or bootstrap access when any resolved permission is present.
 * Returns 401 for unauthenticated requests without one of the permissions.
 */
export const allowAnonymousAnyPermission = (requiredPermissionKeys: readonly string[]) => (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const permissionKeySet = new Set(requiredPermissionKeys);
  const { permissionKeys, authenticated } = resolveRequestPermissionKeys(req);

  if (permissionKeys.some((permissionKey) => permissionKeySet.has(permissionKey))) {
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
    setTrustedBootstrapSession(req, AuthAccessControlService.resolveBootstrapAccess());
    next();
    return;
  }

  if (req.session?.authenticated === true) {
    next();
    return;
  }

  res.status(401).json({ error: 'Unauthorized' });
};
