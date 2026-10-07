import { AuthAccount } from '../models/AuthAccount';
import { AuthAccessControlService } from '../services/authAccessControlService';
import { hasConfiguredAuth } from '../routes/auth-route-helpers';
import type { McpRequester } from '../mcp/context';

/** Account-bound tools recheck the account; external unbound keys retain their own scope contract. */
export function requireRequesterPermission(requester: McpRequester | undefined, permission: string): void {
  if (!requester) return;
  const keys = requester.accountId === null
    ? (hasConfiguredAuth() ? [] : AuthAccessControlService.resolveBootstrapAccess().permissionKeys)
    : (AuthAccount.findById(requester.accountId)?.status === 'active' ? AuthAccessControlService.resolveForAccountId(requester.accountId).permissionKeys : []);
  if (!keys.includes(permission)) throw new Error(`Permission required: ${permission}`);
}
