import { CONTENT_PERMISSIONS, hasContentRight, type ContentRight } from '@conai/shared';
import { AuthAccount } from '../models/AuthAccount';
import { AuthAccessControlService, isActiveAdminAccount } from '../services/authAccessControlService';
import { hasConfiguredAuth } from '../services/auth/sessionAccess';
import type { McpRequester } from '../mcp/context';

const requesterGrants = new WeakMap<McpRequester, () => readonly string[]>();

/** Server-only authority: JSON, browser parameters and copies of a requester cannot carry this grant. */
export function withRequesterPermissionGrant(requester: McpRequester, currentPermissions: () => readonly string[]): McpRequester {
  const scoped = { accountId: requester.accountId, accountType: requester.accountType };
  requesterGrants.set(scoped, currentPermissions);
  return scoped;
}

/** The account's current keys; the bootstrap owner holds every key only while no accounts are configured. */
export function requesterPermissionKeys(requester: McpRequester): string[] {
  const keys = requester.accountId === null
    ? (hasConfiguredAuth() ? [] : AuthAccessControlService.resolveBootstrapAccess().permissionKeys)
    : (AuthAccount.findById(requester.accountId)?.status === 'active' ? AuthAccessControlService.resolveForAccountId(requester.accountId).permissionKeys : []);
  const lent = requesterGrants.get(requester)?.() ?? [];
  // Rights a shared plugin page lends (withRequesterPermissionGrant) never derive page keys or enter the access cache.
  return lent.length ? [...new Set([...keys, ...lent])] : keys;
}

/** An active account right now (or the bootstrap owner while no accounts are configured). */
export function isRequesterSignedIn(requester: McpRequester): boolean {
  return requester.accountId === null ? !hasConfiguredAuth() : AuthAccount.findById(requester.accountId)?.status === 'active';
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

/** Whether the account (or the bootstrap owner) holds one basic right right now. */
export function requesterHasRight(requester: McpRequester, right: ContentRight): boolean {
  return hasContentRight(requesterPermissionKeys(requester), right);
}

/** Same as requireRequesterPermission for one basic right; internal calls without a requester are not checked. */
export function requireRequesterRight(requester: McpRequester | undefined, right: ContentRight): void {
  requireRequesterPermission(requester, CONTENT_PERMISSIONS[right]);
}

/** An HTTP MCP key's keys: those of the permission group it was given (none without one). */
export function keyGroupPermissionKeys(groupKey: string | null): string[] {
  return groupKey ? AuthAccessControlService.resolveForGroupKey(groupKey).permissionKeys : [];
}

/** What "signed in" means for an HTTP MCP key: it has a permission group that still exists. */
export function keyHasGroup(groupKey: string | null): boolean {
  return groupKey ? AuthAccessControlService.resolveForGroupKey(groupKey).groupKeys.length > 0 : false;
}

/** The account's keys, or an HTTP MCP key's group's; internal calls with neither are not checked here. */
export function requireContextPermission(context: { requester?: McpRequester; keyGroup?: string | null }, permission: string): void {
  if (context.requester) {
    requireRequesterPermission(context.requester, permission);
    return;
  }
  if (context.keyGroup !== undefined && !keyGroupPermissionKeys(context.keyGroup).includes(permission)) throw new Error(`Permission required: ${permission}`);
}

/** requireContextPermission for one basic right. */
export function requireContextRight(context: { requester?: McpRequester; keyGroup?: string | null }, right: ContentRight): void {
  requireContextPermission(context, CONTENT_PERMISSIONS[right]);
}
