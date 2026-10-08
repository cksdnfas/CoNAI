import { AuthAccount } from '../models/AuthAccount';
import { AuthAccessControlService } from '../services/authAccessControlService';
import { hasConfiguredAuth } from '../routes/auth-route-helpers';
import type { McpRequester } from '../mcp/context';

/** The account's current keys; the bootstrap owner holds every key only while no accounts are configured. */
export function requesterPermissionKeys(requester: McpRequester): string[] {
  return requester.accountId === null
    ? (hasConfiguredAuth() ? [] : AuthAccessControlService.resolveBootstrapAccess().permissionKeys)
    : (AuthAccount.findById(requester.accountId)?.status === 'active' ? AuthAccessControlService.resolveForAccountId(requester.accountId).permissionKeys : []);
}

/** The account's current role, re-read rather than taken from the session or the browser. */
export function isRequesterAdmin(requester: McpRequester): boolean {
  if (requester.accountId === null) return !hasConfiguredAuth();
  const account = AuthAccount.findById(requester.accountId);
  return account?.status === 'active' && account.account_type === 'admin';
}

/** Account-bound tools recheck the account; external unbound keys retain their own scope contract. */
export function requireRequesterPermission(requester: McpRequester | undefined, permission: string): void {
  if (!requester) return;
  if (!requesterPermissionKeys(requester).includes(permission)) throw new Error(`Permission required: ${permission}`);
}
