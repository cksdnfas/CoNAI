import type { Request } from 'express';
import { AuthCredentials } from '../models/AuthCredentials';
import { AuthAccount, type AuthAccountRecord } from '../models/AuthAccount';
import { AuthAccessControlService } from '../services/authAccessControlService';

export type SessionAuthAccount = Pick<AuthAccountRecord, 'id' | 'username' | 'account_type'>;

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

/** Check whether any auth credential or auth account is configured. */
export function hasConfiguredAuth(): boolean {
  return AuthCredentials.exists() || AuthAccount.exists();
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
