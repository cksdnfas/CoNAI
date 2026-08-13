import type { Request } from 'express';
import { AuthCredentials } from '../models/AuthCredentials';
import { AuthAccount, type AuthAccountRecord } from '../models/AuthAccount';
import {
  AuthAccessControlService,
  getResolvedAuthAccessEpoch,
  invalidateResolvedAuthAccessCache,
  type ResolvedAuthAccessRecord,
} from '../services/authAccessControlService';
import { isDirectLoopbackRequest } from '../utils/bootstrapAccess';

let configuredAuthCache: boolean | null = null;
const TRUSTED_BOOTSTRAP_USERNAME = 'Bootstrap';

/** Shared freshness window for session-cached access data. */
export const SESSION_ACCESS_CACHE_TTL_MS = 60_000;

/** The stamp registry is a process-local optimization, so it is bounded and drops oldest first. */
export const SESSION_ACCESS_STAMP_TRACKING_LIMIT = 10_000;

/**
 * When each session's access cache was last resolved, keyed by session id.
 *
 * This deliberately does not live in the session. express-session runs with `resave: false`, which
 * dirty-checks by content, so a timestamp inside the session body rewrote the row every time the
 * TTL lapsed and turned a read-only freshness check into a real auth.db write (measured: 8 writes
 * per 50 anonymous requests spread over ten minutes, against 0 for a session that carries no
 * stamp). Holding the stamp here leaves a still-fresh session byte-identical between requests, so
 * express-session skips the store write while the TTL keeps doing its job.
 *
 * Correctness never depends on this map. It only ever reports a session *stale*, which costs one
 * re-resolve that rewrites the same values; the access epoch stored in the session is what makes
 * permission changes land. A restart, an evicted entry, or a second process therefore only adds
 * cache misses — it can never serve revoked permissions.
 */
const sessionAccessStampBySid = new Map<string, number>();

/** Record that this session's cached access data was resolved just now. */
export function markSessionAccessCacheFresh(req: Request): void {
  const sid = req.sessionID;
  if (typeof sid !== 'string' || sid.length === 0) {
    return;
  }

  // Re-inserting moves the session to the end so eviction stays least-recently-resolved first.
  sessionAccessStampBySid.delete(sid);
  sessionAccessStampBySid.set(sid, Date.now());

  while (sessionAccessStampBySid.size > SESSION_ACCESS_STAMP_TRACKING_LIMIT) {
    const oldestSid = sessionAccessStampBySid.keys().next().value;
    if (oldestSid === undefined) {
      break;
    }
    sessionAccessStampBySid.delete(oldestSid);
  }
}

/** Check whether this process resolved the session's access cache inside the freshness window. */
function hasFreshSessionAccessStamp(req: Request): boolean {
  const sid = req.sessionID;
  if (typeof sid !== 'string') {
    return false;
  }

  const stampedAt = sessionAccessStampBySid.get(sid);
  return stampedAt !== undefined && Date.now() - stampedAt < SESSION_ACCESS_CACHE_TTL_MS;
}

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
  invalidateResolvedAuthAccessCache();
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
  req.session.accessCacheEpoch = getResolvedAuthAccessEpoch();
  // Sessions written before the stamp moved out of the session body still carry the dead field;
  // dropping it costs one write per pre-existing session and keeps stored sessions self-consistent.
  delete req.session.accessCacheUpdatedAt;
  markSessionAccessCacheFresh(req);
}

/** Populate the current session as the trusted personal-mode admin when auth is not configured. */
export function setTrustedBootstrapSession(req: Request, resolvedAccess: { groupKeys: string[]; permissionKeys: string[] }): void {
  // Leave a still-fresh bootstrap session untouched so express-session skips its per-request save.
  const isFreshBootstrapSession = req.session.authenticated === true
    && req.session.username === TRUSTED_BOOTSTRAP_USERNAME
    && req.session.accountId === undefined
    && req.session.accountType === 'admin'
    && req.session.accessCacheAccountId === undefined
    && Array.isArray(req.session.groupKeys)
    && Array.isArray(req.session.permissionKeys)
    && req.session.accessCacheEpoch === getResolvedAuthAccessEpoch()
    && hasFreshSessionAccessStamp(req);

  if (isFreshBootstrapSession) {
    return;
  }

  req.session.authenticated = true;
  req.session.username = TRUSTED_BOOTSTRAP_USERNAME;
  delete req.session.accountId;
  req.session.accountType = 'admin';
  req.session.groupKeys = resolvedAccess.groupKeys;
  req.session.permissionKeys = resolvedAccess.permissionKeys;
  delete req.session.accessCacheAccountId;
  req.session.accessCacheEpoch = getResolvedAuthAccessEpoch();
  delete req.session.accessCacheUpdatedAt;
  markSessionAccessCacheFresh(req);
}

/**
 * Shared freshness probe for the group/permission data cached inside a session.
 *
 * This reads only; it never writes to the session, so each caller decides on its own whether a
 * miss is worth re-stamping the cache. The TTL is the steady-state optimization, but the access
 * epoch is what makes the cache safe: every group/permission mutation bumps it (see
 * `invalidateResolvedAuthAccessCache`), so a session carrying an older epoch is never reported as
 * fresh and its permissions are re-resolved on the very next request. Anything the probe cannot
 * positively confirm — missing arrays, a different account, an unresolved stamp — is reported
 * stale so the caller falls back to a full re-resolve.
 */
export function hasFreshSessionAccessCache(req: Request, expectedAccountId: number | undefined): boolean {
  return Array.isArray(req.session?.groupKeys)
    && Array.isArray(req.session?.permissionKeys)
    && req.session?.accessCacheAccountId === expectedAccountId
    && req.session?.accessCacheEpoch === getResolvedAuthAccessEpoch()
    && hasFreshSessionAccessStamp(req);
}

/** Build the current auth-status payload while keeping additive compatibility. */
export function buildAuthStatusPayload(req: Request): AuthStatusPayload {
  const hasCredentials = hasConfiguredAuth();
  const accountId = req.session?.accountId;

  if (!hasCredentials) {
    if (!isDirectLoopbackRequest(req)) {
      return {
        hasCredentials,
        authenticated: false,
        username: null,
        accountId: null,
        accountType: null,
        isAdmin: false,
        groupKeys: [],
        permissionKeys: [],
      };
    }

    const bootstrapAccess = AuthAccessControlService.resolveBootstrapAccess();
    setTrustedBootstrapSession(req, bootstrapAccess);
    return {
      hasCredentials,
      authenticated: true,
      username: TRUSTED_BOOTSTRAP_USERNAME,
      accountId: null,
      accountType: 'admin',
      isAdmin: true,
      groupKeys: bootstrapAccess.groupKeys,
      permissionKeys: bootstrapAccess.permissionKeys,
    };
  }

  // The SPA shell embeds this payload on every full page load, so the previous unconditional
  // rewrite re-ran the (unmemoized) account resolution and re-serialized the session on every one
  // of those requests. When the session still carries the access cache the permission middleware
  // stamped, that work is redundant, so reuse it and leave the session untouched.
  //
  // Nothing below advances the cache stamp: this builder only ever consumes the window the
  // middleware owns. A miss therefore behaves exactly as before (resolve, then write the resolved
  // values) and this path can never introduce a session write that did not already happen.
  const canReuseSessionAccessCache = typeof accountId === 'number'
    ? hasFreshSessionAccessCache(req, accountId)
    // An authenticated session without an account id is legacy bootstrap residue, never a cached
    // anonymous session, so it always re-resolves and is downgraded to anonymous access.
    : req.session?.authenticated !== true && hasFreshSessionAccessCache(req, undefined);

  let resolvedAccess: ResolvedAuthAccessRecord;
  if (canReuseSessionAccessCache) {
    resolvedAccess = {
      groupKeys: req.session.groupKeys ?? [],
      permissionKeys: req.session.permissionKeys ?? [],
    };
  } else {
    resolvedAccess = typeof accountId === 'number'
      ? AuthAccessControlService.resolveForAccountId(accountId)
      : AuthAccessControlService.resolveForGroupKey('anonymous');
    req.session.groupKeys = resolvedAccess.groupKeys;
    req.session.permissionKeys = resolvedAccess.permissionKeys;
  }

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
