import 'express-session';
import type { AuthAccountType } from '../models/AuthAccount';

declare module 'express-session' {
  interface SessionData {
    authenticated?: boolean;
    username?: string;
    accountId?: number;
    accountType?: AuthAccountType;
    groupKeys?: string[];
    permissionKeys?: string[];
  }
}
