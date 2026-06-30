import type { Request } from 'express';
import { AuthCredentials } from '../models/AuthCredentials';
import { AuthAccount, type AuthAccountRecord } from '../models/AuthAccount';
import { AuthAccessControlService } from '../services/authAccessControlService';

let configuredAuthCache: boolean | null = null;
const TRUSTED_BOOTSTRAP_USERNAME = 'Bootstrap';

export type SessionAuthAccount = Pick<AuthAccountRecord, 'id' | 'username' | 'account_type'>;

export type SessionResponseAccount = {
  id: number | null;
  username: string;
  account_type: 'admin' | 'guest';
};

export interface AuthStatusPayload {
  hasCredentials: boolean;
  authenticated: boolean;
  username: string | null;
  accountId: number | null;
  accountType: 'admin' | 'guest' | null;
  isAdmin: boolean;
  groupKeys: string[];
  permissionKeys: string[];
}

/** Clear the cached configured-auth flag after bootstrap/auth mutations. */
export function invalidateConfiguredAuthCache(): void {
  configuredAuthCache = null;
}

/** Check whether local auth has a usable administrator configured. */
export function hasConfiguredAuth(): boolean {
  if (configuredAuthCache !== null) {
    return configuredAuthCache;
  }

  configuredAuthCache = AuthCredentials.exists() || AuthAccount.countActiveAdmins() > 0;
  return configuredAuthCache;
}

/** Populate the current session from one verified auth account. */
export function setAuthenticatedSession(req: Request, account: SessionAuthAccount): void {
  const resolvedAccess = AuthAccessControlService.resolveForAccountId(account.id);
  req.session.authenticated = true;
  req.session.username = account.username;
  req.session.accountId = account.id;
  req.session.accountType = account.account_type;
  req.session.groupKeys = resolvedAccess.groupKeys;
  req.session.permissionKeys = resolvedAccess.permissionKeys;
  req.session.accessCacheAccountId = account.id;
  req.session.accessCacheUpdatedAt = Date.now();
}

/** Populate the current session as the trusted personal-mode admin when auth is not configured. */
export function setTrustedBootstrapSession(req: Request, resolvedAccess: { groupKeys: string[]; permissionKeys: string[] }): void {
  req.session.authenticated = true;
  req.session.username = TRUSTED_BOOTSTRAP_USERNAME;
  delete req.session.accountId;
  req.session.accountType = 'admin';
  req.session.groupKeys = resolvedAccess.groupKeys;
  req.session.permissionKeys = resolvedAccess.permissionKeys;
  delete req.session.accessCacheAccountId;
  req.session.accessCacheUpdatedAt = Date.now();
}

/** Build the current auth-status payload while keeping additive compatibility. */
export function buildAuthStatusPayload(req: Request): AuthStatusPayload {
  const hasCredentials = hasConfiguredAuth();
  const accountId = req.session?.accountId;
  const resolvedAccess = typeof accountId === 'number'
    ? AuthAccessControlService.resolveForAccountId(accountId)
    : hasCredentials
      ? AuthAccessControlService.resolveForGroupKey('anonymous')
      : AuthAccessControlService.resolveBootstrapAccess();

  if (!hasCredentials) {
    setTrustedBootstrapSession(req, resolvedAccess);
    return {
      hasCredentials,
      authenticated: true,
      username: TRUSTED_BOOTSTRAP_USERNAME,
      accountId: null,
      accountType: 'admin',
      isAdmin: true,
      groupKeys: resolvedAccess.groupKeys,
      permissionKeys: resolvedAccess.permissionKeys,
    };
  }

  req.session.groupKeys = resolvedAccess.groupKeys;
  req.session.permissionKeys = resolvedAccess.permissionKeys;

  return {
    hasCredentials,
    authenticated: req.session?.authenticated === true,
    username: req.session?.username || null,
    accountId: accountId ?? null,
    accountType: req.session?.accountType ?? null,
    isAdmin: req.session?.accountType === 'admin',
    groupKeys: resolvedAccess.groupKeys,
    permissionKeys: resolvedAccess.permissionKeys,
  };
}

/** Build the shared authenticated-session response payload for login/setup/update flows. */
export function buildSessionAccountResponse(
  req: Request,
  message: string,
  account: SessionResponseAccount,
) {
  return {
    success: true,
    message,
    username: account.username,
    accountId: account.id,
    accountType: account.account_type,
    isAdmin: account.account_type === 'admin',
    groupKeys: req.session.groupKeys ?? [],
    permissionKeys: req.session.permissionKeys ?? [],
  };
}
