import 'express-session';
import type { AuthAccountType } from './authAccount';

declare module 'express-session' {
  interface SessionData {
    authenticated?: boolean;
    username?: string;
    accountId?: number;
    accountType?: AuthAccountType;
    groupKeys?: string[];
    permissionKeys?: string[];
    accessCacheAccountId?: number;
    accessCacheUpdatedAt?: number;
    /** Access epoch captured when groupKeys/permissionKeys were last cached into the session. */
    accessCacheEpoch?: number;
  }
}
