import type { Request } from 'express';
import { hasAdminAccess } from '../middleware/authMiddleware';
import type { McpRequester } from '../mcp/context';
import { hasConfiguredAuth } from '../services/auth/sessionAccess';

const REQUESTER_ACCOUNT_TYPES = ['admin', 'guest'] as const;
type RequesterAccountType = (typeof REQUESTER_ACCOUNT_TYPES)[number];

function isRequesterAccountType(value: unknown): value is RequesterAccountType {
  return REQUESTER_ACCOUNT_TYPES.includes(value as RequesterAccountType);
}

/** Return the current session account id when the request is tied to one. */
export function getRequesterAccountId(req: Request) {
  return typeof req.session?.accountId === 'number' ? req.session.accountId : null;
}

/** Return the current session account type when it is one of the app roles. */
export function getRequesterAccountType(req: Request) {
  const accountType = req.session?.accountType;
  return isRequesterAccountType(accountType) ? accountType : null;
}

/** The request's account as a service requester; only the no-account owner of an install without accounts is admin by default. */
export function getRequester(req: Request): McpRequester {
  const accountId = getRequesterAccountId(req);
  const accountType = getRequesterAccountType(req);
  return { accountId, accountType: accountType ?? (accountId === null && !hasConfiguredAuth() ? 'admin' : null) };
}

/** Check whether the current request is attached to an admin account, re-read so a demoted admin loses access at once. */
export function isAdminRequest(req: Request) {
  return hasAdminAccess(req);
}
