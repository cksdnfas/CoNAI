import type { Request } from 'express';

/** Return the current session account id when the request is tied to one. */
export function getRequesterAccountId(req: Request) {
  return typeof req.session?.accountId === 'number' ? req.session.accountId : null;
}

/** Return the current session account type when it is one of the app roles. */
export function getRequesterAccountType(req: Request) {
  return req.session?.accountType === 'admin' || req.session?.accountType === 'guest'
    ? req.session.accountType
    : null;
}

/** Check whether the current request is attached to an admin account. */
export function isAdminRequest(req: Request) {
  return getRequesterAccountType(req) === 'admin';
}
