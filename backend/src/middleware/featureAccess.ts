import { AuthAccount } from '../models/AuthAccount';
import { AuthAccessControlService, isActiveAdminAccount } from '../services/authAccessControlService';
import { hasConfiguredAuth } from '../services/auth/sessionAccess';
import type { McpRequester } from '../mcp/context';

/** The account's current keys; the bootstrap owner holds every key only while no accounts are configured. */
export function requesterPermissionKeys(requester: McpRequester): string[] {
  return requester.accountId === null
    ? (hasConfiguredAuth() ? [] : AuthAccessControlService.resolveBootstrapAccess().permissionKeys)
    : (AuthAccount.findById(requester.accountId)?.status === 'active' ? AuthAccessControlService.resolveForAccountId(requester.accountId).permissionKeys : []);
}

/** The account's current role, re-read rather than taken from the session or the browser. */
export function isRequesterAdmin(requester: McpRequester): boolean {
  return requester.accountId === null ? !hasConfiguredAuth() : isActiveAdminAccount(requester.accountId);
}

/** Claims admin and still is one: a cached or browser-supplied role never grants admin by itself. */
export function isConfirmedAdminRequester(requester: { accountId: number | null; accountType?: string | null }): boolean {
  return requester.accountType === 'admin' && isRequesterAdmin({ accountId: requester.accountId, accountType: 'admin' });
}

/** Account-bound tools recheck the account; HTTP MCP keys are checked through requireContextPermission. */
export function requireRequesterPermission(requester: McpRequester | undefined, permission: string): void {
  if (!requester) return;
  if (!requesterPermissionKeys(requester).includes(permission)) throw new Error(`Permission required: ${permission}`);
}

/** An HTTP MCP key's keys: those of the permission group it was given (none without one). */
export function keyGroupPermissionKeys(groupKey: string | null): string[] {
  return groupKey ? AuthAccessControlService.resolveForGroupKey(groupKey).permissionKeys : [];
}

/** The account's keys, or an HTTP MCP key's group's; internal calls with neither are not checked here. */
export function requireContextPermission(context: { requester?: McpRequester; keyGroup?: string | null }, permission: string): void {
  if (context.requester) {
    requireRequesterPermission(context.requester, permission);
    return;
  }
  if (context.keyGroup !== undefined && !keyGroupPermissionKeys(context.keyGroup).includes(permission)) throw new Error(`Permission required: ${permission}`);
}
