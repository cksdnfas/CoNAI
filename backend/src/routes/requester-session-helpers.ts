import type { Request } from 'express';
import { hasAdminAccess } from '../middleware/authMiddleware';

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

/** Check whether the current request is attached to an admin account, re-read so a demoted admin loses access at once. */
export function isAdminRequest(req: Request) {
  return hasAdminAccess(req);
}
